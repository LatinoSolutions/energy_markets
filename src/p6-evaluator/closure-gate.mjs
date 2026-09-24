// Closure gate P6 y receipt de cierre del instrumento (IMP-15). Fuente: SPEC
// v1.1.1 §14.10 ("El P6 closure gate exige conjuntamente: todos los manual
// fixtures aprobados; conciliación de opening obligation/fills/remaining;
// costes una sola vez; execution/cost treatment idéntico A0/A1; separación PIT
// de benchmark y execution views; reproducibilidad de runs idénticos; ausencia
// de hidden defaults/convenience fills y output suficiente para P5.7/P3 sin
// cambiar P6"), §14.5 (conciliación), §14.4 (append-only, costes una vez, sin
// fills fabricados), §14.9 (reproducibilidad) y §25.1/§25.2 fila IMP-15
// ("Closure receipt P6, comparativa manual/evaluator"; del gate: "closure gate
// P6 superado no equivale a research PASS").
//
// Fail-closed: un item que no puede evaluarse (evidencia ausente, ledgers no
// disponibles, brazo único) no pasa en silencio; el estado de alcance se
// declara explícito. El cierre es válido para el instrumento sobre la campaña
// en scope; NO acredita edge de S1, research PASS ni datos reales del cliente.

import { contentHashOf } from "../execution-contract/execution-contract.mjs";
import { compareReproducibility } from "./run-receipts.mjs";
import { compareManualVsEvaluator, manualComparisonDigest } from "./manual-campaign.mjs";
import { validateFixtureSuiteRunEvidence } from "./fixture-suite-evidence.mjs";

// Diez fixtures manuales canónicos de §14.8 (IDs del oracle independiente de
// IMP-13: operations/audit/IMP-13/fixture-oracle/independent-calculations.md).
export const MANUAL_FIXTURE_IDS = Object.freeze([
  "FX-P6-01-CONSTANT-PRICE",
  "FX-P6-02-ASCENDING-PRICE",
  "FX-P6-03-DESCENDING-PRICE",
  "FX-P6-04-WAIT-EVERY",
  "FX-P6-05-OVERLAPPING",
  "FX-P6-06-MISSING",
  "FX-P6-07-REVISED",
  "FX-P6-08-LOT-COSTS",
  "FX-P6-09-BENCHMARK-SUBSTITUTION",
  "FX-P6-10-NEUTRAL-UNDEFINED",
]);

const TOLERANCE = 1e-9;

function approximatelyEqual(left, right, tolerance = TOLERANCE) {
  return typeof left === "number" && typeof right === "number" && Number.isFinite(left) && Number.isFinite(right)
    && Math.abs(left - right) <= tolerance;
}

function item(id, name, ok, details = {}) {
  return { id, name, ok, ...details };
}

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

// --- Gate items -------------------------------------------------------------

// GATE-01: los diez fixtures manuales de §14.8 aprobados (§14.10). La
// evidencia es el artefacto de ejecución REAL del suite IMP-13
// (operations/audit/IMP-15/imp13-fixture-suite-run.json, producido por
// run-imp13-fixture-suite.mjs): no self-attestación del módulo bajo prueba.
function checkFixtureSuite(fixtureSuiteRunEvidence) {
  const validation = validateFixtureSuiteRunEvidence(fixtureSuiteRunEvidence, MANUAL_FIXTURE_IDS);
  if (!validation.ok) {
    return item("IMP15-GATE-01", "manual fixtures approved", false, validation);
  }
  return item("IMP15-GATE-01", "manual fixtures approved", true, {
    code: "OK",
    fixtureIds: [...MANUAL_FIXTURE_IDS],
    suiteLocator: validation.suiteLocator,
    suiteDigest: validation.digest,
  });
}

// GATE-02: conciliación de opening obligation/fills/remaining al cierre
// (§14.5) sobre el outcome real del run.
function checkReconciliation(runOutcome) {
  if (!runOutcome?.replay?.terminalCoverage) {
    return item("IMP15-GATE-02", "opening/fills/remaining reconciliation", false, {
      code: "MISSING_RUN_OUTCOME",
      message: "El gate exige el outcome real de runP6Replay (§14.10 ítem 2).",
    });
  }
  const terminal = runOutcome.replay.terminalCoverage;
  const reconciles = approximatelyEqual(
    terminal.openingObligation,
    terminal.executedVolume + terminal.remainingVolume,
  );
  return item("IMP15-GATE-02", "opening/fills/remaining reconciliation", reconciles, {
    code: reconciles ? "OK" : "RECONCILIATION_FAILURE",
    declared: {
      openingObligation: terminal.openingObligation,
      executedVolume: terminal.executedVolume,
      remainingVolume: terminal.remainingVolume,
      coverageStatus: terminal.coverageStatus,
    },
  });
}

// GATE-03: cada coste económico entra exactamente una vez (§14.4/§14.10): los
// costes de cada fill se declaran countedOnce, no hay costId repetido dentro
// de un fill y todo costId cargado existe KNOWN en el cost ledger config
// auditado (no hay costes inventados, y los UNKNOWN quedaron excluidos,
// nunca cero).
function checkCostsCountedOnce({ runOutcome, bundle }) {
  if (!runOutcome?.replay?.ledgers?.execution || !bundle?.costLedger) {
    return item("IMP15-GATE-03", "costs counted exactly once", false, {
      code: "MISSING_LEDGERS",
      message: "El item exige el execution ledger del run y el cost-ledger configuration auditado (§14.4).",
    });
  }
  const ledgerCostIds = new Set(
    (bundle.costLedger.entries ?? []).filter((entry) => entry.status === "KNOWN").map((entry) => entry.costId),
  );
  const problems = [];
  for (const fill of runOutcome.replay.ledgers.execution) {
    const rowCosts = fill.executionCosts ?? [];
    const seenInRow = new Set();
    for (const cost of rowCosts) {
      if (cost.countedOnce !== true) {
        problems.push(`${fill.requestId}: coste ${cost.costId} sin countedOnce.`);
      }
      if (seenInRow.has(cost.costId)) {
        problems.push(`${fill.requestId}: coste ${cost.costId} aparece dos veces dentro del mismo fill.`);
      }
      seenInRow.add(cost.costId);
      if (ledgerCostIds.size > 0 && !ledgerCostIds.has(cost.costId)) {
        problems.push(`${fill.requestId}: coste ${cost.costId} no existe KNOWN en el cost ledger auditado.`);
      }
      if (!isFiniteNumber(cost.amount)) {
        problems.push(`${fill.requestId}: coste ${cost.costId} sin amount finito.`);
      }
    }
  }
  return item("IMP15-GATE-03", "costs counted exactly once", problems.length === 0, {
    code: problems.length === 0 ? "OK" : "COST_DOUBLE_COUNT_OR_UNAUDITED",
    problems,
  });
}

// GATE-04: execution/cost treatment idéntico A0/A1 (§14.10 ítem 4). El item
// sólo se puede VERIFICAR con los dos brazos reales: compara treatment de
// lot/rounding y execution contract fill a fill entre A0 (firstOutputBundle)
// y A1 (a1OutputBundle, cuando exista). Con A0 solo:
//  - con declaración singleArm explícita: el ítem queda pending
//    (status NOT_EVALUATED) — no se fabrica paridad con un solo brazo ni
//    se responde con un string; el gate NO queda completo;
//  - sin declaración: fallo duro (SINGLE_ARM_PARITY_UNDECLARED) — el cierre
//    no declara su scope y el gate no fabrica la paridad.
// Comparar A0 contra su rerun sería comparar el mismo brazo consigo mismo
// (IMP15-H2), no verificación ninguna.
function checkArmParity({ firstOutputBundle, a1OutputBundle, declaration }) {
  if (!firstOutputBundle?.receipt) {
    return item("IMP15-GATE-04", "execution/cost treatment identical A0/A1", false, {
      code: "MISSING_RUN",
      message: "Sin run no hay treatment que comparar (§14.10 ítem 4).",
    });
  }
  const a1Present = a1OutputBundle?.receipt != null;
  if (!a1Present && declaration?.singleArm === true) {
    const reasoning = typeof declaration.reasoning === "string" ? declaration.reasoning.trim() : "";
    return item("IMP15-GATE-04", "execution/cost treatment identical A0/A1", false, {
      code: "A0_A1_NOT_EVALUATED",
      status: "NOT_EVALUATED",
      pending: true,
      singleArmScope: true,
      message: `Item de paridad A0/A1 NO evaluado: sólo existe el brazo A0. ${reasoning || "Sin razón declarada."}`,
    });
  }
  if (!a1Present) {
    return item("IMP15-GATE-04", "execution/cost treatment identical A0/A1", false, {
      code: "SINGLE_ARM_PARITY_UNDECLARED",
      message: "Sólo hay un brazo y el cierre no declara el scope de brazo único: el gate no fabrica la paridad A0/A1 y no la da por verificada (fail-closed, §14.10 ítem 4).",
    });
  }
  if (a1OutputBundle.receipt.armVersion === firstOutputBundle.receipt.armVersion) {
    return item("IMP15-GATE-04", "execution/cost treatment identical A0/A1", false, {
      code: "A1_NOT_DISTINCT",
      message: `El segundo brazo declarado usa la misma armVersion que A0 (${firstOutputBundle.receipt.armVersion}); no hay dos brazos distintos que comparar (§14.10 ítem 4).`,
    });
  }
  const fillTreatmentOf = (outcome) => (outcome?.ledgers?.execution ?? []).map((row) => ({
    lotRoundingTreatment: row.lotRoundingTreatment,
    executionContractVersion: row.executionContractVersion,
  }));
  const treatmentsA = fillTreatmentOf(firstOutputBundle);
  const treatmentsB = fillTreatmentOf(a1OutputBundle);
  if (treatmentsA.length === 0 || treatmentsB.length === 0) {
    return item("IMP15-GATE-04", "execution/cost treatment identical A0/A1", false, {
      code: "MISSING_EXECUTION_ROWS",
      message: "Ambos brazos deben exponer fills con su treatment de execution contract (§14.10 ítem 4).",
    });
  }
  // §14.10 ítem 4 ("execution/cost treatment idéntico A0/A1"): brazos con
  // distinto número de fills también rompen la paridad (IMP15-H5, review
  // 2026-09-23). -1 de findIndex significa "sin divergencia índice a índice",
  // no "paridad OK"; la condición !sameLength debe fallar por separado.
  const sameLength = treatmentsA.length === treatmentsB.length;
  const divergenceIndex = sameLength
    ? treatmentsA.findIndex((treatment, index) => !isDeepEqualTreatment(treatment, treatmentsB[index]))
    : -1;
  const parityBroken = !sameLength || divergenceIndex !== -1;
  return item("IMP15-GATE-04", "execution/cost treatment identical A0/A1", !parityBroken, {
    code: !sameLength ? "LENGTH_MISMATCH" : parityBroken ? "TREATMENT_MISMATCH" : "OK",
    divergenceIndex: divergenceIndex !== -1 ? divergenceIndex : null,
  });
}

function isDeepEqualTreatment(left, right) {
  return left.lotRoundingTreatment === right.lotRoundingTreatment
    && left.executionContractVersion === right.executionContractVersion;
}

// GATE-05: separación PIT del benchmark vs la execution view (§14.10 ítem 5):
// ninguna key consumible por la decision view (las que el decision ledger
// registró) coincide con la key de las filas del benchmark evaluado.
function checkPitSeparation({ runOutcome, benchmarkEvaluationKeys }) {
  const decisionRows = runOutcome?.replay?.ledgers?.decision ?? null;
  if (!Array.isArray(decisionRows) || !Array.isArray(benchmarkEvaluationKeys)) {
    return item("IMP15-GATE-05", "PIT separation of benchmark and execution views", false, {
      code: "MISSING_SEPARATION_INPUTS",
      message: "El item exige los pitReferences del decision ledger y las keys de la vista de benchmark (§14.3/§14.10 ítem 5).",
    });
  }
  if (benchmarkEvaluationKeys.length === 0) {
    return item("IMP15-GATE-05", "PIT separation of benchmark and execution views", false, {
      code: "EMPTY_EVALUATION_KEYS",
      message: "La vista de benchmark declara cero keys explícitas: fail-closed, no separación asumida.",
    });
  }
  const decisionKeys = new Set();
  for (const row of decisionRows) {
    for (const reference of row.pitReferences ?? []) {
      decisionKeys.add(reference.key);
    }
  }
  const overlap = benchmarkEvaluationKeys.filter((key) => decisionKeys.has(key));
  return item("IMP15-GATE-05", "PIT separation of benchmark and execution views", overlap.length === 0 && decisionKeys.size > 0, {
    code: decisionKeys.size === 0 ? "NO_DECISION_KEYS" : overlap.length === 0 ? "OK" : "VIEW_KEYS_OVERLAP",
    overlap,
  });
}

// GATE-06: reproducibilidad — los ledgers/economic outcomes de dos runs del
// mismo frozen bundle coinciden (§14.9/§14.10 ítem 6). Ningún bollgono
// declarativo: la comparación es sobre digests de contenido, no sobre etiquetas.
function checkReproducibility(firstOutputBundle, rerunOutputBundle) {
  const comparison = compareReproducibility({ outputBundle: firstOutputBundle }, { outputBundle: rerunOutputBundle });
  return item("IMP15-GATE-06", "identical-run reproducibility", comparison.ok === true, {
    code: comparison.ok === true ? "OK" : (comparison.code ?? "REPRODUCIBILITY_FAILURE"),
    differences: comparison.differences,
    receiptIds: comparison.receiptIds,
  });
}

// GATE-07: sin hidden defaults ni convenience fills (§14.10 ítem 7): cada fill
// tiene su decisión BUY en la secuencia correspondiente; los noFill no
// ejecutaron volumen; filled nunca excede requested; remaining nunca crece ni
// se vuelve negativo en la secuencia de coverage; un cierre COVERED con
// residual distinto de cero es un hidden default.
function checkNoHiddenDefaults({ runOutcome }) {
  const ledgers = runOutcome?.replay?.ledgers;
  if (!ledgers?.decision || !ledgers?.execution || !ledgers?.coverage) {
    return item("IMP15-GATE-07", "no hidden defaults / no convenience fills", false, {
      code: "MISSING_LEDGERS",
      message: "El item exige los tres ledgers del run (§14.4/§14.10 ítem 7).",
    });
  }
  const problems = [];
  const decisionsBySequence = new Map(ledgers.decision.map((row) => [row.sequence, row]));
  for (const fill of ledgers.execution) {
    const decision = decisionsBySequence.get(fill.sequence);
    if (!decision) {
      problems.push(`${fill.requestId}: fila de execution sin su fila de decisión correspondiente.`);
      continue;
    }
    if (fill.noFill === true) {
      if ((fill.filledQuantity ?? 0) !== 0) {
        problems.push(`${fill.requestId}: noFill con filledQuantity ${fill.filledQuantity} (convenience fill).`);
      }
      continue;
    }
    if (decision.action !== "BUY") {
      problems.push(`${fill.requestId}: fill sin BUY declarado en su decisión.`);
    }
    if (!(fill.filledQuantity > 0) || fill.filledQuantity > fill.requestedQuantity) {
      problems.push(`${fill.requestId}: filledQuantity debe respetar el request (filled ${fill.filledQuantity} vs requested ${fill.requestedQuantity}).`);
    }
  }
  let priorRemainingVolume = null;
  for (const coverageRow of ledgers.coverage) {
    if (priorRemainingVolume !== null && coverageRow.remainingVolume > priorRemainingVolume + TOLERANCE) {
      problems.push(`coverage[${coverageRow.sequence}]: remaining creció → se suprimió un residual (§14.5).`);
    }
    if (coverageRow.remainingVolume < -TOLERANCE) {
      problems.push(`coverage[${coverageRow.sequence}]: remaining negativo.`);
    }
    priorRemainingVolume = coverageRow.remainingVolume;
  }
  const terminal = runOutcome.replay.terminalCoverage;
  if (terminal.coverageStatus === "COVERED" && terminal.remainingVolume !== 0) {
    problems.push("terminal COVERED con remaining != 0: hidden default de cierre.");
  }
  return item("IMP15-GATE-07", "no hidden defaults / no convenience fills", problems.length === 0, {
    code: problems.length === 0 ? "OK" : "CONVENIENCE_FILL_OR_DEFAULT",
    problems,
  });
}

// GATE-08: output suficiente para P5.7/P3 sin cambiar P6 (§14.10 ítem 8): el
// output bundle del run contiene ledgers, coverage, status y receipt con las
// partes de evaluación explícitas (bhvByCampaign y pairedDeltaV como valores
// o null — nunca ausente en silencio); las métricas P3 viven downstream y no
// se exigen antes de que exista una serie multi-campaña y se soliciten.
function checkOutputSufficiency(outputBundle) {
  if (!outputBundle?.bundleKind || outputBundle.bundleKind !== "P6_OUTPUT_BUNDLE") {
    return item("IMP15-GATE-08", "output sufficient for P5.7/P3 without changing P6", false, {
      code: "MISSING_OUTPUT_BUNDLE",
      message: "El item exige el output bundle materializado del run (§14.10 ítem 8).",
    });
  }
  const missing = [];
  for (const component of ["ledgers", "terminalCoverage", "status", "receipt"]) {
    if (outputBundle[component] === undefined) missing.push(component);
  }
  for (const evaluationPart of ["bhvByCampaign", "pairedDeltaV", "sourceProxyRevisionStatus"]) {
    if (!Object.prototype.hasOwnProperty.call(outputBundle, evaluationPart)) {
      missing.push(`${evaluationPart} ausente (la parte debe declararse como valor o null explícito)`);
    }
  }
  if (missing.length > 0) {
    return item("IMP15-GATE-08", "output sufficient for P5.7/P3 without changing P6", false, {
      code: "INCOMPLETE_OUTPUT_BUNDLE",
      missing,
    });
  }
  const hasBhv = outputBundle.bhvByCampaign !== null && outputBundle.bhvByCampaign !== undefined;
  return item("IMP15-GATE-08", "output sufficient for P5.7/P3 without changing P6", true, {
    code: "OK",
    bhvByCampaignMaterialized: hasBhv,
    p3Metrics: "cuando existan campañas múltiples y se soliciten (§14.10 «dónde definidas y solicitadas»)",
  });
}

// La comparativa manual/evaluator es requisito propio de IMP-15 (§25.1
// "comparativa manual/evaluator"), así que el gate la exige además de los
// items verificables del §14.10. GATE-09 no se fía del flag ok de la
// comparativa declarada: exige que ambas evaluaciones reales estén presentes,
// recompute la comparativa con ellas y valide que los componentes
// B/H/V/coverage estén presentes, estén de acuerdo y que la comparativa
// declarada coincida con la recomputación (digest).
const REQUIRED_COMPARISON_COMPONENTS = Object.freeze([
  "H",
  "B",
  "V",
  "coverage.executedVolume",
  "coverage.remainingVolume",
  "coverage.status",
]);

function checkManualComparison({ manualEvaluation, campaignEvaluation, manualComparison }) {
  if (!manualEvaluation || !campaignEvaluation || !manualComparison || typeof manualComparison !== "object") {
    return item("IMP15-GATE-09", "manual/evaluator agreement in B/H/V/coverage", false, {
      code: "MISSING_EVALUATION_INPUTS",
      message: "GATE-09 exige las dos evaluaciones reales y la comparativa declarada; sin ellas no se revalida el acuerdo (fail-closed).",
    });
  }
  const problems = [];
  if (manualComparison.ok !== true) {
    problems.push(`la comparativa declarada no está aprobada (code ${manualComparison.code ?? "sin code"}).`);
  }
  if (!Array.isArray(manualComparison.components) || manualComparison.components.length === 0) {
    problems.push("la comparativa declarada no expone ningún componente verificado.");
  } else {
    const disagreeing = manualComparison.components.filter((component) => component?.agree !== true);
    if (disagreeing.length > 0) {
      problems.push(`algún componente de la comparativa declarada no está de acuerdo: ${disagreeing.map((component) => component?.component ?? "(sin nombre)")}.`);
    }
    const componentNames = new Set(manualComparison.components.map((component) => component?.component));
    for (const required of REQUIRED_COMPARISON_COMPONENTS) {
      if (!componentNames.has(required)) {
        problems.push(`falta el componente requerido ${required} en la comparativa declarada.`);
      }
    }
  }
  const recomputed = compareManualVsEvaluator({ manualEvaluation, campaignEvaluation });
  if (recomputed.ok !== true) {
    problems.push(`la recomputación con las evaluaciones reales no cierra (code ${recomputed.code}).`);
  }
  const declaredDigest = manualComparisonDigest(manualComparison);
  const recomputedDigest = manualComparisonDigest(recomputed);
  if (declaredDigest !== recomputedDigest) {
    problems.push("la comparativa declarada no coincide con la recomputación desde las evaluaciones reales (digest distinto).");
  }
  return item("IMP15-GATE-09", "manual/evaluator agreement in B/H/V/coverage", problems.length === 0, {
    code: problems.length === 0 ? "OK" : "MANUAL_EVALUATOR_AGREEMENT_NOT_REPRODUCIBLE",
    problems,
    digest: declaredDigest,
    recomputedDigest,
  });
}

// --- Evaluación del gate -----------------------------------------------------

// El gate aplica los ocho items de §14.10 más el item propio IMP-15
// (comparativa manual/evaluator) sobre artefactos reales ya materializados
// (outcome del run, output bundles, evaluaciones, evidencia del suite IMP-13).
// Cada item queda ok / pending / fallido; con items pending el gate deja de
// estar completo (gateComplete=false) y lo declara en pendingIds.
export function evaluateP6ClosureGate({
  runOutcome = null,
  rerunOutputBundle = null,
  firstOutputBundle = null,
  a1OutputBundle = null,
  fixtureSuiteEvidence = null,
  benchmarkEvaluationKeys = null,
  manualEvaluation = null,
  campaignEvaluation = null,
  manualComparison = null,
  bundle = null,
  singleArmDeclaration = null,
} = {}) {
  if (!Array.isArray(benchmarkEvaluationKeys) || benchmarkEvaluationKeys.length === 0) {
    return {
      ok: false,
      code: "MISSING_BENCHMARK_KEYS",
      message: "El gate exige las keys de la vista de evaluation del benchmark; sin ellas no se puede probar la separación PIT (§14.10 ítem 5).",
      items: [],
    };
  }

  const items = [
    checkFixtureSuite(fixtureSuiteEvidence),
    checkReconciliation(runOutcome),
    checkCostsCountedOnce({ runOutcome, bundle }),
    checkArmParity({
      firstOutputBundle,
      a1OutputBundle,
      declaration: singleArmDeclaration,
    }),
    checkPitSeparation({ runOutcome, benchmarkEvaluationKeys }),
    checkReproducibility(firstOutputBundle, rerunOutputBundle),
    checkNoHiddenDefaults({ runOutcome }),
    checkOutputSufficiency(firstOutputBundle ?? rerunOutputBundle),
  ];

  items.push(checkManualComparison({ manualEvaluation, campaignEvaluation, manualComparison }));

  const failed = items.filter((gateItem) => gateItem.ok !== true && gateItem.pending !== true);
  const pending = items.filter((gateItem) => gateItem.pending === true);
  return {
    ok: failed.length === 0,
    gateComplete: pending.length === 0,
    pendingIds: pending.map((gateItem) => gateItem.id),
    gateId: "P6_CLOSURE_GATE",
    specAuthority: "SPEC v1.1.1 §14.10 (closure gate A0+A1) + §25.1/§25.2 (IMP-15)",
    items,
    failedIds: failed.map((gateItem) => gateItem.id),
    singleArmScope: singleArmDeclaration?.singleArm === true,
  };
}

// --- Closure receipt ---------------------------------------------------------

// Receipt de cierre del instrumento P6. §14.10: "P6 sitúa su cierre como
// instrumento implementation-ready cuando este gate pasa. Su cumplimiento no
// demuestra edge de S1." El receipt materializa: el resultado del gate
// ítem a ítem; la comparativa manual/evaluator (vía independiente vs run);
// los receipts de los runs que sostuvieron el cierre; y una declaración de
// alcance fail-closed (ni research PASS ni datos reales del cliente).
export function materializeP6ClosureReceipt({
  gate = null,
  manualComparison = null,
  outputBundle = null,
  rerunOutputBundle = null,
  bundle = null,
  closureTimestampUtc = null,
  closureScopeNote = null,
  fixtureSuiteEvidence = null,
} = {}) {
  if (!gate?.ok) {
    return { ok: false, code: "CLOSURE_GATE_NOT_PASSED", failedIds: gate?.failedIds ?? [], message: "El closure receipt se materializa sólo con el gate aprobado (§14.10). Ningún item fallido se esconde." };
  }
  if (!outputBundle?.receipt || !bundle?.contentHash) {
    return { ok: false, code: "MISSING_CLOSURE_INPUTS", message: "El closure receipt exige output bundle y frozen bundle (§14.10/§25.2)." };
  }
  const comparisonValidated = validateManualComparisonReceiptInput(manualComparison);
  if (!comparisonValidated.ok) {
    return comparisonValidated;
  }
  const fixtureValidation = validateFixtureSuiteRunEvidence(fixtureSuiteEvidence, MANUAL_FIXTURE_IDS);
  if (!fixtureValidation.ok) {
    return { ok: false, code: fixtureValidation.code, message: fixtureValidation.message, failedFixtureIds: fixtureValidation.failedFixtureIds ?? [] };
  }

  const singleArm = gate.singleArmScope === true;
  const gateComplete = gate.gateComplete === true;
  const receipt = {
    receiptKind: "P6_CLOSURE_RECEIPT",
    closureId: null,
    closureTimestampUtc,
    experiment: { experimentId: outputBundle.receipt.experimentId, experimentVersion: outputBundle.receipt.experimentVersion },
    campaign: { campaignId: outputBundle.receipt.campaignId },
    instrumentDeclaration: {
      evaluatorId: outputBundle.receipt.evaluatorId,
      evaluatorVersion: outputBundle.receipt.evaluatorVersion,
      frozenBundleContentHash: outputBundle.receipt.frozenBundleContentHash,
      alignsWithGateSpec: gate.specAuthority,
      // §14.10: la declaración "implementation-ready por gate superado" queda
      // atada al gate COMPLETO; con items pending el receipt lo declara.
      gateComplete,
      pendingGateItemIds: gateComplete ? [] : (gate.pendingIds ?? []),
    },
    gateId: gate.gateId,
    gateResult: {
      ok: gate.ok,
      complete: gateComplete,
      items: gate.items,
      failedIds: gate.failedIds,
      pendingIds: gate.pendingIds ?? [],
    },
    fixtureSuiteRunEvidence: {
      suiteLocator: fixtureValidation.suiteLocator,
      suiteDigest: fixtureValidation.digest,
    },
    manualEvaluatorComparison: {
      code: manualComparison.code,
      components: manualComparison.components,
      declared: manualComparison.declared,
    },
    manualComparisonDigest: manualComparisonDigest(manualComparison),
    runsSupportingClosure: {
      runReceiptId: outputBundle.receipt.receiptId,
      runStatus: outputBundle.status,
      rerunReceiptId: rerunOutputBundle?.receipt?.receiptId ?? outputBundle.receipt.receiptId,
    },
    singleArmScope: singleArm
      ? {
          declared: true,
          note: "El cierre es de brazo único (A0) porque el brazo A1/S1 aún no existe (IMP-11 pendiente): el ítem de paridad treatment A0/A1 del gate §14.10 queda NOT_EVALUATED (pendiente), no verificado ni fabricado. Se re-evaluará cuando exista un brazo A1 distinto.",
        }
      : {
          declared: false,
          note: "Paridad de treatment A0/A1 verificada fill a fill entre brazos distintos.",
        },
    scopeDeclaration: {
      means: gateComplete
        ? "closure gate P6 completo superado: el instrumento P6 queda implementation-ready (§14.10)."
        : "instrumento P6 con todos los items evaluables del closure gate aprobados; el gate §14.10 COMPLETO queda pendiente de los items declarados en pendingGateItemIds, por lo que NO se declara implementation-ready por gate superado.",
      doesNotMean: "research PASS no demostrado; edge de S1 no demostrado; paridad A0/A1 no verificada en cierres de brazo único; datos reales de campañas/no fees auditados fuera de scope; el receipt no acredita aceptación del IMP.",
      provenanceNote: closureScopeNote ?? "Todos los datos del run subyacente son sintéticos; el flujo probado es el instrumento, no el mercado.",
    },
  };
  const closureIdSeed = { ...receipt };
  closureIdSeed.closureId = null;
  receipt.closureId = contentHashOf(closureIdSeed);
  return { ok: true, receipt: Object.freeze(receipt), closureId: receipt.closureId };
}

// La receipt exige una comparativa real con componentes completos y su digest;
// una etiqueta {ok:true} sin contenido no entra (§25.1/§25.2 IMP-15).
function validateManualComparisonReceiptInput(manualComparison) {
  if (!manualComparison || typeof manualComparison !== "object") {
    return { ok: false, code: "MISSING_CLOSURE_INPUTS", message: "El closure receipt exige la comparativa manual/evaluator (§25.2)." };
  }
  if (manualComparison.ok !== true) {
    return { ok: false, code: "MANUAL_EVALUATOR_COMPARISON_NOT_APPROVED", message: `La comparativa manual/evaluator no está aprobada (code ${manualComparison.code ?? "sin code"}).` };
  }
  if (manualComparison.code !== "MANUAL_EVALUATOR_AGREEMENT"
    || !Array.isArray(manualComparison.components)
    || manualComparison.components.length === 0
    || !manualComparison.components.every((component) => component?.agree === true)) {
    return { ok: false, code: "MANUAL_EVALUATOR_COMPARISON_INVALID", message: "La comparativa declarada no prueba el acuerdo B/H/V/coverage." };
  }
  return { ok: true };
}
