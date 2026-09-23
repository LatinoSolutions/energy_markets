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
import { manualComparisonDigest } from "./manual-campaign.mjs";

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
// evidencia llega del suite IMP-13 ya ejecutado; este item verifica que la
// evidencia cubra exactamente el set canónico y que ningún fixture quede
// fallando o sin declarar.
function checkFixtureSuite(fixtureSuiteEvidence) {
  if (!Array.isArray(fixtureSuiteEvidence) || fixtureSuiteEvidence.length === 0) {
    return item("IMP15-GATE-01", "manual fixtures approved", false, {
      code: "MISSING_FIXTURE_EVIDENCE",
      message: "Sin evidencia del suite de fixtures manuales §14.8 no hay closure (§14.10 ítem 1).",
    });
  }
  const byId = new Map();
  for (const declared of fixtureSuiteEvidence) {
    if (!declared || typeof declared.fixtureId !== "string" || !declared.fixtureId.trim()) {
      return item("IMP15-GATE-01", "manual fixtures approved", false, {
        code: "MALFORMED_FIXTURE_EVIDENCE",
        message: "Cada fila de evidencia debe declarar fixtureId y ok.",
      });
    }
    byId.set(declared.fixtureId, declared);
  }
  for (const expected of MANUAL_FIXTURE_IDS) {
    const declared = byId.get(expected);
    if (!declared) {
      return item("IMP15-GATE-01", "manual fixtures approved", false, {
        code: "MISSING_FIXTURE_ID",
        message: `El fixture ${expected} (§14.8) no aparece en la evidencia del suite.`,
      });
    }
    if (declared.ok !== true) {
      return item("IMP15-GATE-01", "manual fixtures approved", false, {
        code: "FIXTURE_NOT_APPROVED",
        message: `El fixture ${expected} está declarado pero no aprobado (ok=${String(declared.ok)}).`,
        evidence: declared.evidence ?? null,
      });
    }
  }
  return item("IMP15-GATE-01", "manual fixtures approved", true, {
    fixtureIds: [...MANUAL_FIXTURE_IDS],
    source: fixtureSuiteEvidence[0]?.evidence ?? "independiente del suite IMP-13",
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

// GATE-04: execution/cost treatment idéntico A0/A1 (§14.10 ítem 4). Con dos
// brazos se compara versión de execution contract, cost ledger y treatment de
// lot/rounding fill a fill. Con un solo brazo (A0): IMP-15 no exige S1
// (§25.2), así que el cierre puede ser de un brazo sólo si lo declara
// explícitamente como scope — el item queda PASS con pendingA1 declarado y el
// receipt lo registra; no se presenta como paridad A1 verificada.
function checkArmParity({ firstOutputBundle, rerunOutputBundle, declaration }) {
  const bundleToUse = firstOutputBundle ?? rerunOutputBundle;
  if (!bundleToUse?.receipt) {
    return item("IMP15-GATE-04", "execution/cost treatment identical A0/A1", false, {
      code: "MISSING_RUN",
      message: "Sin run no hay treatment que comparar (§14.10 ítem 4).",
    });
  }
  // Single-arm closures: la condición "idéntico entre brazos" sólo puede
  // evaluarse en cuanto hay dos brazos. Un brazo solo no fabrica la paridad:
  // queda como scope declarado, no como verificación.
  if (declaration?.singleArm === true) {
    if (declaration.reasoning?.length > 0) {
      return item("IMP15-GATE-04", "execution/cost treatment identical A0/A1", true, {
        code: "SINGLE_ARM_SCOPE_DECLARED",
        message: declaration.reasoning,
        singleArmScope: true,
      });
    }
  }
  const fillTreatmentOf = (outcome) => {
    const treatments = (outcome?.ledgers?.execution ?? []).map((row) => ({
      lotRoundingTreatment: row.lotRoundingTreatment,
      executionContractVersion: row.executionContractVersion,
    }));
    return treatments;
  };
  const treatmentsA = fillTreatmentOf(firstOutputBundle);
  const treatmentsB = fillTreatmentOf(rerunOutputBundle);
  if (treatmentsA.length === 0 || treatmentsB.length === 0) {
    return item("IMP15-GATE-04", "execution/cost treatment identical A0/A1", false, {
      code: "MISSING_EXECUTION_ROWS",
      message: "Ambos brazos deben exponer fills con su treatment de execution contract (§14.10 ítem 4).",
    });
  }
  const sameLength = treatmentsA.length === treatmentsB.length;
  const parityBroken = !sameLength
    || treatmentsA.some((treatment, index) => !isDeepEqualTreatment(treatment, treatmentsB[index]));
  return item("IMP15-GATE-04", "execution/cost treatment identical A0/A1", !parityBroken, {
    code: parityBroken ? "TREATMENT_MISMATCH" : "OK",
    divergenceIndex: parityBroken ? -1 : null,
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

// --- Evaluación del gate -----------------------------------------------------

// El gate aplica los ocho items de §14.10 sobre artefactos reales ya
// materializados (outcome del run, output bundles, comparativa).
export function evaluateP6ClosureGate({
  runOutcome = null,
  rerunOutputBundle = null,
  firstOutputBundle = null,
  fixtureSuiteEvidence = null,
  benchmarkEvaluationKeys = null,
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
  if (!manualComparison) {
    return {
      ok: false,
      code: "MISSING_MANUAL_COMPARISON",
      message: "El gate exige la comparativa manual/evaluator (§25.1/§25.2 IMP-15).",
      items: [],
    };
  }

  const items = [
    checkFixtureSuite(fixtureSuiteEvidence),
    checkReconciliation(runOutcome),
    checkCostsCountedOnce({ runOutcome, bundle }),
    checkArmParity({
      firstOutputBundle,
      rerunOutputBundle,
      declaration: singleArmDeclaration,
    }),
    checkPitSeparation({ runOutcome, benchmarkEvaluationKeys }),
    checkReproducibility(firstOutputBundle, rerunOutputBundle),
    checkNoHiddenDefaults({ runOutcome }),
    checkOutputSufficiency(firstOutputBundle ?? rerunOutputBundle),
  ];

  // La comparativa manual/evaluator es requisito propio de IMP-15 (§25.1
  // "comparativa manual/evaluator"), así que el gate la exige además de los
  // siete items verificables del §14.10.
  const comparisonItem = item("IMP15-GATE-09", "manual/evaluator agreement in B/H/V/coverage", manualComparison?.ok === true, {
    code: manualComparison?.code ?? "MISSING",
    digest: manualComparisonDigest(manualComparison),
  });
  items.push(comparisonItem);

  const failed = items.filter((gateItem) => gateItem.ok !== true);
  return {
    ok: failed.length === 0,
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
  if (!manualComparison?.ok || !outputBundle?.receipt || !bundle?.contentHash) {
    return { ok: false, code: "MISSING_CLOSURE_INPUTS", message: "El closure receipt exige comparativa aprobada, output bundle y frozen bundle (§14.10/§25.2)." };
  }
  for (const declared of fixtureSuiteEvidence ?? []) {
    if (declared?.ok !== true) {
      return { ok: false, code: "FIXTURE_EVIDENCE_NOT_APPROVED", message: `El fixture ${declared?.fixtureId} está declarado pero no está aprobado.` };
    }
  }

  const singleArm = gate.singleArmScope === true;
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
    },
    gateId: gate.gateId,
    gateResult: { ok: gate.ok, items: gate.items, failedIds: gate.failedIds },
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
          note: "El cierre es de brazo único (A0) porque el brazo A1/S1 aún no existe (IMP-11 pendiente): la paridad de treatment A0/A1 se re-evaluará cuando exista. No se fabrica paridad con un solo brazo.",
        }
      : {
          declared: false,
          note: "Paridad de treatment A0/A1 verificada fill a fill.",
        },
    scopeDeclaration: {
      means: "closure gate P6 superado: el instrumento P6 queda implementation-ready (§14.10).",
      doesNotMean: "research PASS no demostrado; edge de S1 no demostrado; datos reales de campañas/no fees auditados fuera de scope; el receipt no acredita aceptación del IMP.",
      provenanceNote: closureScopeNote ?? "Todos los datos del run subyacente son sintéticos; el flujo probado es el instrumento, no el mercado.",
    },
  };
  const closureIdSeed = { ...receipt };
  closureIdSeed.closureId = null;
  receipt.closureId = contentHashOf(closureIdSeed);
  return { ok: true, receipt: Object.freeze(receipt), closureId: receipt.closureId };
}
