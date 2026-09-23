// Replay state machine P6 (IMP-12). Fuente: SPEC v1.1.1 §14.1 (mandato y
// límite: reconstruye una campaña de una versión experimental congelada desde
// opening obligation hasta terminal state; no entrena, no optimiza, no repara
// el diseño frozen), §14.3 (orden cronológico de los pasos por opportunity;
// WAIT no reduce remaining; la policy observa exclusivamente el historical
// decision view), §14.4 (append-only ledgers, costes una sola vez, sin fills
// con precios favorables ni residuos borrados), §14.5 (coverage por filled
// quantity; al deadline residual sin terminal rule válida es
// COVERAGE_INCOMPLETE), §14.7 (missing → no-fill, nunca precio ejecutable
// inventado), §14.9 (receipt y determinismo) y §14.10 (run statuses con
// dimensiones coexistentes, sin prioridad escalar inventada).
//
// El replay no computa B/H/V: eso es evaluación downstream (§14.6). Aquí se
// producen ledgers, coverage, statuses y provenance determinista.

import { executionParameterOf, versionKeyOf } from "../execution-contract/execution-contract.mjs";
import { selectEligibleReference, deriveSimulatedFillPrice } from "../execution-contract/causal-fill.mjs";
import { computeRemainingVolume, reconcileCoverage, COVERAGE_STATUSES } from "../procurement-contract/coverage-ownership.mjs";
import { RECONCILED_RULE_PREDECLARATION, reconcileControlQuantity } from "../sizing-controller/sizing-controller.mjs";
import { readDecisionView } from "../pit-views/index.mjs";
import {
  createImmutableLedger,
  coverageLedgerRow,
  DECISION_LEDGER_FIELDS,
  EXECUTION_LEDGER_FIELDS,
  COVERAGE_LEDGER_FIELDS,
} from "./ledgers.mjs";

export const EVALUATOR_ID = "P6-EVALUATOR";
export const SIZING_RULE_VERSION = RECONCILED_RULE_PREDECLARATION.ruleId;

// §14.10: los estados son dimensiones separadas (validity / availability /
// coverage / benchmark), no un enum exclusivo con prioridad escalar (§22 CCR-17).
export const RUN_STATUS_DIMENSION_DEFAULTS = Object.freeze({
  validity: "VALID_RUN",
  availability: null,
  coverage: null,
  benchmark: null,
});

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

// §14.2/§14.3 paso 2: el estado histórico de decisión se lee del decision
// view del manifest PIT de P4 congelado en el bundle; la provenance que se
// declara es la del manifest real, no una etiqueta fabricada. La policy
// observa únicamente esta vista (sin precios, benchmark u outcomes
// consumibles tras la frontera; §14.3).
function historicalDecisionState({ frontierDate, remainingVolume, executedVolume, unit, dataManifest, boundaryUtc }) {
  return {
    frontierDate,
    remainingVolume,
    executedVolume,
    unit,
    dataSource: {
      kind: "PIT_DATA_MANIFEST",
      manifestId: dataManifest.manifestId,
      manifestVersion: dataManifest.manifestVersion,
      boundaryUtc,
    },
  };
}

// §14.3 paso 2: en cada frontera se expone lo que la vista PIT declara
// consumible; las referencias de versión que alimentan el decision ledger
// (§14.4 "PIT input/version references") salen de la lectura real del
// manifest de IMP-06, no de una lista construida a mano.
function pitReferencesAtBoundary({ dataManifest, boundaryUtc, warnings }) {
  const view = readDecisionView(dataManifest, boundaryUtc);
  if (!view.ok) {
    warnings.push(`decision view unavailable at ${boundaryUtc}: ${view.reason ?? view.code ?? "vista PIT no legible"}`);
    return [];
  }
  return view.visible.map((entry) => ({
    key: entry.key,
    revisionId: entry.revisionId,
    consumableFromUtc: entry.consumableFromUtc,
  }));
}

// §13.6 regla 1 + §14.7: la referencia es la última observación at-or-before
// la frontera y el precio sale de la derivación frozen; sin precio elegible
// no hay fill y no se inventa precio ejecutable.
function attemptExecution({ bundle, opportunity }) {
  const selection = selectEligibleReference({
    observations: bundle.priceObservations,
    decisionTime: opportunity.decisionTimeUtc,
  });
  if (!selection.ok) {
    return { fill: false, executionPrice: null, referenceTimestamp: null, reason: `no-executable-price: ${selection.reason}` };
  }
  const slippageParameter = executionParameterOf(bundle.executionContract, "slippage");
  if (!slippageParameter || slippageParameter.status === "UNKNOWN" || !isFiniteNumber(slippageParameter.value)) {
    return { fill: false, executionPrice: null, referenceTimestamp: null, reason: "no-executable-price: el execution contract no declara un slippage utilizable (§13.6 regla 4)." };
  }
  const derived = deriveSimulatedFillPrice({
    referenceBestAsk: selection.reference.bestAsk,
    slippage: slippageParameter.value,
    referenceUnit: "EUR/MWh",
    slippageUnit: slippageParameter.unit ?? "EUR/MWh",
  });
  if (!derived.ok) {
    return { fill: false, executionPrice: null, referenceTimestamp: null, reason: `no-executable-price: ${derived.reason}` };
  }
  return { fill: true, executionPrice: derived.price, referenceTimestamp: selection.reference.timestamp, reason: null };
}

// §14.4 + §13.6 regla 2: cada coste económico entra exactamente una vez por
// fill. KNOWN del cost ledger P5.6 entra; UNKNOWN queda excluido expreso,
// nunca como cero (§13.6 regla 4).
//
// Representación embedded-vs-ledger (§13.6 regla 1 + §14.6): el slippage
// virtual de P5.6 ya va DENTRO de executionPrice (el fill sale de
// deriveSimulatedFillPrice = best ask + slippage y validateCausalFill lo
// exige), así que un coste KNOWN de kind VIRTUAL_SLIPPAGE cuyo amount coincide
// con el slippage del execution contract se marca embedded=true: el evaluator
// lo cuenta vía precio y no lo re-cuenta como coste additive (exactly once,
// §5.5). Un VIRTUAL_SLIPPAGE cuyo amount NO coincide con ese slippage deja la
// fila sin representación posible (no se elige entre doble conteo y omisión):
// es un motivo de invalididad y el run queda INVALID_RUN. Los fees van como
// filas additivas, fuera del executionPrice.
function knownCostsForFill({ bundle, sequence }) {
  const known = [];
  const excluded = [];
  const reconciliationProblems = [];
  const slippageParameter = executionParameterOf(bundle.executionContract, "slippage");
  for (const entry of bundle.costLedger.entries ?? []) {
    if (entry.status === "KNOWN") {
      const embedded = entry.kind === "VIRTUAL_SLIPPAGE"
        && slippageParameter !== null
        && isFiniteNumber(slippageParameter.value)
        && entry.amount === slippageParameter.value;
      if (entry.kind === "VIRTUAL_SLIPPAGE" && !embedded) {
        reconciliationProblems.push(`coste ${entry.costId} (VIRTUAL_SLIPPAGE, amount ${entry.amount}) no coincide con el slippage del execution contract embedded en executionPrice (${slippageParameter?.value ?? null}); la representación embedded-vs-ledger no reconcilia (§13.6/§14.6).`);
      }
      known.push({
        costId: entry.costId,
        kind: entry.kind,
        amount: entry.amount,
        unit: entry.unit,
        appliedTo: `request-${sequence}`,
        countedOnce: true,
        embedded,
      });
    } else {
      excluded.push({ costId: entry.costId, kind: entry.kind, status: entry.status, reason: entry.reason ?? null });
    }
  }
  return { known, excluded, reconciliationProblems };
}

function sizingVersionOf(bundle) {
  return versionKeyOf({ contentHash: bundle.sizingConfiguration?.contentHash });
}

export function runP6Replay(bundle, { runTimestampUtc = null } = {}) {
  const warnings = [];
  const invalidityReasons = [];
  const missingDataEvents = [];

  const openingObligation = bundle.openingContract.openingObligation;
  const unit = bundle.openingContract.unit;
  const dailyCapParameter = executionParameterOf(bundle.executionContract, "dailyQuantityCap");
  const dailyCap = isFiniteNumber(dailyCapParameter?.value) ? dailyCapParameter.value : null;
  const roundingTreatment = executionParameterOf(bundle.executionContract, "rounding")?.value ?? null;

  const decisionLedger = createImmutableLedger("DECISION", DECISION_LEDGER_FIELDS);
  const executionLedger = createImmutableLedger("EXECUTION", EXECUTION_LEDGER_FIELDS);
  const coverageLedger = createImmutableLedger("COVERAGE", COVERAGE_LEDGER_FIELDS);

  let executedVolume = 0;
  let remainingVolume = openingObligation;
  let sequence = 0;
  let filledOnFrontier = 0;
  let frontierDate = null;
  let armBlockedCode = null;

  // Las opportunities del calendario predeclarado se recorren en orden
  // cronológico del calendario materializado (§14.3 orden cronológico; el
  // buildDecisionCalendar ya entrega sorted). Un orden roto no se reordena:
  // se declara la anomalía y se corta; el replay no repara el diseño.
  const opportunities = bundle.decisionCalendar.opportunities;
  for (let index = 0; index < opportunities.length; index += 1) {
    const opportunity = opportunities[index];
    if (index > 0 && opportunity.date <= frontierDate) {
      invalidityReasons.push(`predeclared opportunities are not strictly chronological at ${opportunity.date}`);
      break;
    }
    const sameDay = frontierDate !== null && opportunity.date === frontierDate;
    if (!sameDay) {
      filledOnFrontier = 0;
    }

    sequence += 1;

    // Paso 2: exposición PIT en la frontera exacta (§14.3/§14.4).
    const pitReferences = pitReferencesAtBoundary({
      dataManifest: bundle.data.manifest,
      boundaryUtc: opportunity.decisionTimeUtc,
      warnings,
    });

    // Pasos 1–3: estado arrastrado + frontera + decisión del arm frozen.
    const state = historicalDecisionState({
      frontierDate: opportunity.date,
      remainingVolume,
      executedVolume,
      unit,
      dataManifest: bundle.data.manifest,
      boundaryUtc: opportunity.decisionTimeUtc,
    });
    if (typeof bundle.arm.assertDecisionInvariant === "function") {
      const invariant = bundle.arm.assertDecisionInvariant(state);
      if (!invariant.ok) {
        invalidityReasons.push(`arm decision invariant violated at ${opportunity.date}: ${invariant.code}`);
        break;
      }
    }
    const decision = bundle.arm.decideAtOpportunity({
      currentDate: opportunity.date,
      remainingVolumeMw: remainingVolume,
      executionNotionalMw: executedVolume,
    });
    if (!decision.ok) {
      if (decision.code === "DATA_BLOCKED" || decision.code === "INFEASIBLE_NO_OPPORTUNITIES") {
        // §14.7: faltante crítico sin conducta frozen → DATA_BLOCKED sin
        // inventar el paso siguiente. La campaña queda abierta, no reparada.
        armBlockedCode = decision.code;
      } else {
        invalidityReasons.push(`arm decision failed at ${opportunity.date}: ${decision.code}`);
      }
      decisionLedger.appendRow({
        sequence,
        decisionTimestamp: opportunity.decisionTimeUtc,
        frontier: opportunity.date,
        armVersion: bundle.arm.armVersion,
        policyVersion: bundle.arm.armVersion,
        action: null,
        requestedQuantity: 0,
        reason: decision.reason ?? decision.code,
        statusCodes: [decision.code],
        pitReferences,
      });
      coverageLedger.appendRow(coverageLedgerRow({
        sequence, asOfDate: opportunity.date, requestedQuantity: 0, filledQuantity: 0,
        noFillQuantity: 0, executedVolume, remainingVolume, unit,
      }));
      break;
    }

    const action = decision.action;
    // §14.3 paso 4: para BUY la requested quantity proviene del controller
    // común congelado (el sizing del bundle), no del arm. Si el arm declara
    // una cantidad distinta, la divergencia queda como warning visible y el
    // ledger registra la del controller común (§14.4: cantidades de P5.6
    // auditado); fail-closed si la derivación del controller no existe.
    let requestedQuantity = 0;
    if (action === "BUY") {
      const controllerSizing = reconcileControlQuantity({
        remainingVolumeMw: remainingVolume,
        remainingOpportunitiesCount: opportunities.length - index,
        controller: {
          lotSizeMw: bundle.sizingConfiguration.lotSizeMw,
          dailyCapMw: bundle.sizingConfiguration.dailyCapMw,
        },
        isLastScheduledOpportunity: index === opportunities.length - 1,
      });
      if (!controllerSizing.ok) {
        invalidityReasons.push(`sizing controller derivation failed at ${opportunity.date}: ${controllerSizing.code}`);
        decisionLedger.appendRow({
          sequence,
          decisionTimestamp: opportunity.decisionTimeUtc,
          frontier: opportunity.date,
          armVersion: bundle.arm.armVersion,
          policyVersion: bundle.arm.armVersion,
          action,
          requestedQuantity: 0,
          reason: controllerSizing.code,
          statusCodes: [action, controllerSizing.code],
          pitReferences,
        });
        break;
      }
      requestedQuantity = controllerSizing.requestedQuantityMw;
      if (isFiniteNumber(decision.requestedQuantityMw) && decision.requestedQuantityMw !== requestedQuantity) {
        warnings.push(`requested quantity divergence at ${opportunity.date}: arm declared ${decision.requestedQuantityMw}, common frozen controller derives ${requestedQuantity}; the ledger records the controller (§14.3 paso 4)`);
      }
    }
    decisionLedger.appendRow({
      sequence,
      decisionTimestamp: opportunity.decisionTimeUtc,
      frontier: opportunity.date,
      armVersion: bundle.arm.armVersion,
      policyVersion: bundle.arm.armVersion,
      action,
      requestedQuantity,
      reason: decision.feasibilityReason ?? null,
      statusCodes: [action, decision.feasibility ?? "OK"],
      pitReferences,
    });

    // Paso 5–7: BUY aplica P5.6; WAIT conserva remaining y consume tiempo
    // (§13.4). En CANAL_BUY llenar fill y account; en CANAL_WAIT nada más.
    if (action === "BUY") {
      const executed = attemptExecution({ bundle, opportunity });
      let fillable = requestedQuantity;
      let capConstrained = false;
      if (dailyCap !== null && fillable > dailyCap - filledOnFrontier) {
        fillable = Math.max(0, dailyCap - filledOnFrontier);
        capConstrained = true;
      }

      if (!executed.fill || fillable <= 0) {
        // §14.7: sin precio/ sin capacidad el request no se cubre; no-fill
        // completo y evento de faltante (§14.9).
        if (fillable <= 0) {
          warnings.push(`execution warning at ${opportunity.date}: nothing fillable under the daily quantity cap (requested ${requestedQuantity})`);
        } else {
          missingDataEvents.push({ asOf: opportunity.decisionTimeUtc, frontier: opportunity.date, reason: executed.reason });
        }
        executionLedger.appendRow({
          sequence,
          requestId: `request-${sequence}`,
          decisionTimestamp: opportunity.decisionTimeUtc,
          eligibleExecutionTimestamp: null,
          requestedQuantity,
          filledQuantity: 0,
          partialQuantity: 0,
          noFill: true,
          executionPrice: null,
          executionCosts: [],
          lotRoundingTreatment: roundingTreatment,
          executionContractVersion: bundle.execution.executionContractVersion,
        });
        coverageLedger.appendRow(coverageLedgerRow({
          sequence, asOfDate: opportunity.date, requestedQuantity, filledQuantity: 0,
          noFillQuantity: requestedQuantity, executedVolume, remainingVolume, unit,
        }));
        frontierDate = opportunity.date;
        continue;
      }

      // §14.4: no se eliminan residuos de partial fills. executionCosts
      // contados una vez; los UNKNOWN quedan fuera de la contabilidad con
      // razón documentada; nunca un valor cero inventado.
      const { known, excluded, reconciliationProblems } = knownCostsForFill({ bundle, sequence });
      if (reconciliationProblems.length > 0) {
        invalidityReasons.push(...reconciliationProblems);
      }
      executionLedger.appendRow({
        sequence,
        requestId: `request-${sequence}`,
        decisionTimestamp: opportunity.decisionTimeUtc,
        eligibleExecutionTimestamp: executed.referenceTimestamp,
        requestedQuantity,
        filledQuantity: fillable,
        partialQuantity: requestedQuantity - fillable,
        noFill: false,
        executionPrice: executed.executionPrice,
        executionCosts: known,
        lotRoundingTreatment: roundingTreatment,
        executionContractVersion: bundle.execution.executionContractVersion,
      });
      if (excluded.length > 0) {
        warnings.push(`costs excluded at request-${sequence}: ${excluded.map((item) => item.kind).join(", ")} (unknown, nunca cero)`);
      }

      // Paso 7: update de executed/remaining/coverage/tiempo. Coverage cambia
      // únicamente por filledQuantity (§14.5); conservación verificada.
      const after = computeRemainingVolume({
        openingObligation,
        executedVolume: executedVolume + fillable,
        openingUnit: unit,
        executedUnit: unit,
      });
      if (!after.computed) {
        invalidityReasons.push(`conservation violation at ${opportunity.date}: ${after.reason}`);
        break;
      }
      executedVolume = executedVolume + fillable;
      remainingVolume = after.remainingVolume;
      filledOnFrontier += fillable;
      if (capConstrained) {
        warnings.push(`partial fill at ${opportunity.date}: filled ${fillable} of requested ${requestedQuantity} (daily quantity constraint)`);
      }
      coverageLedger.appendRow(coverageLedgerRow({
        sequence, asOfDate: opportunity.date, requestedQuantity, filledQuantity: fillable,
        noFillQuantity: 0, executedVolume, remainingVolume, unit,
      }));
      frontierDate = opportunity.date;
      continue;
    }

    // §14.5: WAIT no reduce remaining. Row de coverage para auditar el paso
    // (requested=$0, filled=$0, noFill=$0) y se avanza (paso 8).
    coverageLedger.appendRow(coverageLedgerRow({
      sequence, asOfDate: opportunity.date, requestedQuantity: 0, filledQuantity: 0,
      noFillQuantity: 0, executedVolume, remainingVolume, unit,
    }));
    frontierDate = opportunity.date;
  }

  // §14.5: al deadline se aplica exactamente la terminal rule válida
  // predeclarada cuando exista. El replay no fabrica closing fill: sólo
  // reconcilia según IMP-02 coverage-ownership (terminal VERIFIED/amendments).
  const terminal = reconcileCoverage({
    openingObligation,
    executedVolume,
    remainingVolume,
    unit,
    terminalRuleStatus: bundle.openingContract.terminalRuleStatus ?? "UNVERIFIED",
    closeOutFill: null,
    obligationId: bundle.openingContract.obligationId,
    documentedAmendments: bundle.openingContract.amendments ?? [],
    residualAmendment: bundle.openingContract.residualAmendment ?? null,
  });

  const coverageStatus = (terminal.ok || COVERAGE_STATUSES.includes(terminal.coverageStatus))
    ? terminal.coverageStatus
    : "NOT_COMPUTABLE";

  // §14.10: dimensiones separadas, coexistentes, sin prioridad escalar:
  //  - validity: INVALID_RUN ante leakage/accounting/methodology insalvable.
  //  - availability: DATA_BLOCKED sólo si faltante crítico sin fallback frozen.
  //  - coverage: estado de cobertura al closure (residual abierto incluido).
  //  - benchmark: BENCHMARK_PROVISIONAL mientras B no esté reconciliado final
  //    (el replay consume benchmark configuration únicamente para evaluación;
  //    el status lo declara la config, no el replay).
  const validity = invalidityReasons.length > 0 ? "INVALID_RUN" : "VALID_RUN";
  const availability = armBlockedCode !== null ? "DATA_BLOCKED" : null;
  // §14.10: la única condición de benchmark en el vocabulario canónico es
  // BENCHMARK_PROVISIONAL. Cuando la config frozen declara su benchmark
  // reconciliado oficial, no hay condición provisional que declarar (null) y
  // el estado frozen de la config queda registrado tal cual en el receipt.
  const benchmarkStatus = bundle.benchmark.status === "RECONCILED_OFFICIAL" ? null : "BENCHMARK_PROVISIONAL";

  const receipt = {
    receiptKind: "P6_RUN_RECEIPT",
    experimentId: bundle.experiment.experimentId,
    experimentVersion: bundle.experiment.experimentVersion,
    campaignId: bundle.campaign.campaignId,
    armVersion: bundle.arm.armVersion,
    sizingControllerVersion: sizingVersionOf(bundle),
    sizingRuleVersion: SIZING_RULE_VERSION,
    executionContractVersion: bundle.execution.executionContractVersion,
    costLedgerVersion: bundle.execution.costLedgerVersion,
    datasetManifestId: bundle.data.manifest.manifestId,
    datasetManifestVersion: bundle.data.manifest.manifestVersion,
    benchmarkSourceVersion: bundle.benchmark.sourceVersion,
    benchmarkStatusDeclaredByConfig: bundle.benchmark.status,
    evaluatorId: EVALUATOR_ID,
    // §14.9: la evaluator version que firma el receipt es la que el bundle
    // congeló antes del run; no se sustituye por una constante local.
    evaluatorVersion: bundle.evaluator.evaluatorVersion,
    stochasticSeed: bundle.stochasticity?.seed ?? null,
    frozenBundleContentHash: bundle.contentHash,
    runTimestampUtc: runTimestampUtc,
    runStatus: {
      validity,
      availability,
      coverage: coverageStatus,
      benchmark: benchmarkStatus,
    },
    invalidityReasons,
    warnings,
    missingDataEvents,
    conservation: {
      declaration: "Opening = Executed + Remaining (§14.5)",
      openingObligation,
      executedVolume,
      remainingVolume,
      unit,
    },
  };

  return {
    ok: true,
    replay: {
      ledgers: {
        decision: decisionLedger.snapshot(),
        execution: executionLedger.snapshot(),
        coverage: coverageLedger.snapshot(),
      },
      terminalCoverage: {
        openingObligation,
        executedVolume,
        remainingVolume,
        unit,
        coverageStatus,
        reconcileErrors: terminal.errors ?? [],
      },
      status: receipt.runStatus,
      receipt,
    },
  };
}
