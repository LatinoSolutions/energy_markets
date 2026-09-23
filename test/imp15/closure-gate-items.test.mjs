// Suite IMP-15 — items GATE-03/05/07/08 del closure gate §14.10 y rama
// positiva de GATE-04 (paridad A0/A1 con dos brazos reales). Cubre la
// evidencia fail-closed exigida por el acceptance de IMP-15 ("vistas
// separadas" §14.10 ítem 5; "cero convenience fills" §14.10 ítem 7): una
// violación de cada ítem NO cierra. Fuente: SPEC v1.1.1 §14.10, §14.4,
// §14.5, §25.1/§25.2 fila IMP-15. Fixture compartida: campaign-fixture.mjs
// (campaña Gas Quarterly sintética, oracle IMP-15).

import test from "node:test";
import assert from "node:assert/strict";

import {
  buildOutputBundle,
  evaluateP6ClosureGate,
  runP6Replay,
} from "../../src/p6-evaluator/index.mjs";

import {
  frozenCampaignBundle,
  manualAndRunEvaluations,
  loadImp13SuiteRunEvidence,
  BENCHMARK_EVALUATION_KEYS,
} from "./campaign-fixture.mjs";

function deepCopy(value) {
  return JSON.parse(JSON.stringify(value));
}

const SINGLE_ARM_DECLARATION = {
  singleArm: true,
  reasoning: "escenario de brazo único declarado",
};

// Escenario real completo con GATE-04 pendiente por brazo único: base para
// graduar los fallos por ítem sin tocar los demás preconditions.
function baseScenario({ capMw = 12 } = {}) {
  const bundle = frozenCampaignBundle({ dailyCapMw: capMw });
  const runOutcome = runP6Replay(bundle, { runTimestampUtc: "2026-09-23T00:00:00Z" });
  assert.equal(runOutcome.ok, true);
  const first = buildOutputBundle({ bundle, replayOutcome: runOutcome });
  assert.equal(first.ok, true);
  const rerun = buildOutputBundle({
    bundle,
    replayOutcome: runP6Replay(bundle, { runTimestampUtc: "2026-09-23T01:00:00Z" }),
  });
  const { manualEvaluation, campaignEvaluation, comparison } = manualAndRunEvaluations(runOutcome);
  assert.equal(manualEvaluation.ok, true);
  assert.equal(campaignEvaluation.ok, true);
  assert.equal(comparison.ok, true);
  return {
    bundle,
    runOutcome,
    firstOutputBundle: first.outputBundle,
    rerunOutputBundle: rerun.outputBundle,
    manualEvaluation,
    campaignEvaluation,
    manualComparison: comparison,
  };
}

function evaluateGate(base, overrides = {}) {
  return evaluateP6ClosureGate({
    runOutcome: base.runOutcome,
    firstOutputBundle: base.firstOutputBundle,
    rerunOutputBundle: base.rerunOutputBundle,
    a1OutputBundle: null,
    fixtureSuiteEvidence: loadImp13SuiteRunEvidence(),
    benchmarkEvaluationKeys: BENCHMARK_EVALUATION_KEYS,
    manualEvaluation: base.manualEvaluation,
    campaignEvaluation: base.campaignEvaluation,
    manualComparison: base.manualComparison,
    bundle: base.bundle,
    singleArmDeclaration: SINGLE_ARM_DECLARATION,
    ...overrides,
  });
}

test("IMP-15: GATE-03 costes contados exactamente una vez — limpio pasa; doble conteo en un fill y coste alterado no cierran (fail-closed)", () => {
  const base = baseScenario();
  const cleanGate = evaluateGate(base);
  const cleanItem = cleanGate.items.find((gateItem) => gateItem.id === "IMP15-GATE-03");
  assert.equal(cleanItem.ok, true);
  assert.equal(cleanItem.code, "OK");

  // Coste declarado dos veces dentro del mismo fill: doble conteo detectado.
  const runWithDuplicate = deepCopy(base.runOutcome);
  const fillRows = runWithDuplicate.replay.ledgers.execution;
  fillRows[0].executionCosts = [
    ...fillRows[0].executionCosts,
    { ...fillRows[0].executionCosts[0] },
  ];
  const duplicateGate = evaluateGate({
    ...base,
    runOutcome: runWithDuplicate,
  });
  const duplicateItem = duplicateGate.items.find((gateItem) => gateItem.id === "IMP15-GATE-03");
  assert.equal(duplicateItem.ok, false);
  assert.equal(duplicateItem.code, "COST_DOUBLE_COUNT_OR_UNAUDITED");
  assert.ok(duplicateItem.problems.some((problem) => problem.includes("dos veces dentro del mismo fill")));
  assert.equal(duplicateGate.failedIds.includes("IMP15-GATE-03"), true);

  // Coste sin countedOnce y coste no-KKNOWN en el ledger auditado: tampoco cierra.
  const runTampered = deepCopy(base.runOutcome);
  const tamperedCosts = runTampered.replay.ledgers.execution[0].executionCosts;
  const strayCost = { ...tamperedCosts[0], costId: "cost.invented.not.in.ledger", countedOnce: true };
  runTampered.replay.ledgers.execution[0].executionCosts = [
    { ...tamperedCosts[0], countedOnce: undefined },
    strayCost,
  ];
  const tamperedGate = evaluateGate({ ...base, runOutcome: runTampered });
  const tamperedItem = tamperedGate.items.find((gateItem) => gateItem.id === "IMP15-GATE-03");
  assert.equal(tamperedItem.ok, false);
  assert.ok(tamperedItem.problems.some((problem) => problem.includes("sin countedOnce")));
  assert.ok(tamperedItem.problems.some((problem) => problem.includes("no existe KNOWN en el cost ledger")));
});

test("IMP-15: GATE-05 separación PIT — keys disjuntas cierran; overlap con la decision view NO cierra (fail-closed)", () => {
  const base = baseScenario();
  const cleanGate = evaluateGate(base);
  const cleanItem = cleanGate.items.find((gateItem) => gateItem.id === "IMP15-GATE-05");
  assert.equal(cleanItem.ok, true);
  assert.equal(cleanItem.code, "OK");

  // Una key de evaluación coincide con la key registrada por el decision
  // ledger: solapamiento de vistas, el ítem no pasa.
  const overlappingKeys = [...BENCHMARK_EVALUATION_KEYS, "G0BQ.FX15.reference"];
  const overlapGate = evaluateGate(base, { benchmarkEvaluationKeys: overlappingKeys });
  const overlapItem = overlapGate.items.find((gateItem) => gateItem.id === "IMP15-GATE-05");
  assert.equal(overlapItem.ok, false);
  assert.equal(overlapItem.code, "VIEW_KEYS_OVERLAP");
  assert.deepEqual(overlapItem.overlap, ["G0BQ.FX15.reference"]);
  assert.equal(overlapGate.failedIds.includes("IMP15-GATE-05"), true);
});

test("IMP-15: GATE-07 cero convenience fills — run limpio cierra; noFill con volumen y COVERED con residual no cierran (fail-closed)", () => {
  const base = baseScenario();
  const cleanGate = evaluateGate(base);
  const cleanItem = cleanGate.items.find((gateItem) => gateItem.id === "IMP15-GATE-07");
  assert.equal(cleanItem.ok, true);
  assert.equal(cleanItem.code, "OK");

  // noFill con filledQuantity != 0 (convenience fill), sin mutar el run real.
  const runWithConvenienceFill = deepCopy(base.runOutcome);
  runWithConvenienceFill.replay.ledgers.execution[0] = {
    ...runWithConvenienceFill.replay.ledgers.execution[0],
    noFill: true,
  };
  const convenienceGate = evaluateGate({ ...base, runOutcome: runWithConvenienceFill });
  const convenienceItem = convenienceGate.items.find((gateItem) => gateItem.id === "IMP15-GATE-07");
  assert.equal(convenienceItem.ok, false);
  assert.equal(convenienceItem.code, "CONVENIENCE_FILL_OR_DEFAULT");
  assert.ok(convenienceItem.problems.some((problem) => problem.includes("convenience fill")));
  assert.equal(convenienceGate.failedIds.includes("IMP15-GATE-07"), true);

  // Terminal COVERED con residual != 0: hidden default de cierre.
  const runWithResidual = deepCopy(base.runOutcome);
  runWithResidual.replay.terminalCoverage = {
    ...runWithResidual.replay.terminalCoverage,
    remainingVolume: 0.5,
  };
  runWithResidual.replay.ledgers.coverage = [
    ...runWithResidual.replay.ledgers.coverage,
    {
      ...runWithResidual.replay.ledgers.coverage[runWithResidual.replay.ledgers.coverage.length - 1],
      remainingVolume: 0.5,
    },
  ];
  const residualGate = evaluateGate({ ...base, runOutcome: runWithResidual });
  const residualItem = residualGate.items.find((gateItem) => gateItem.id === "IMP15-GATE-07");
  assert.equal(residualItem.ok, false);
  assert.ok(residualItem.problems.some((problem) => problem.includes("terminal COVERED con remaining != 0")));
});

test("IMP-15: GATE-08 output suficiente para P5.7/P3 — completo cierra; bundle incompleto o sin kind no cierran (fail-closed)", () => {
  const base = baseScenario();
  const cleanGate = evaluateGate(base);
  const cleanItem = cleanGate.items.find((gateItem) => gateItem.id === "IMP15-GATE-08");
  assert.equal(cleanItem.ok, true);
  assert.equal(cleanItem.code, "OK");

  // Parte de evaluación ausente: la parte debe declararse valor o null
  // explícito, nunca omitirse en silencio.
  const incompleteBundle = deepCopy(base.firstOutputBundle);
  delete incompleteBundle.bhvByCampaign;
  const incompleteGate = evaluateGate(base, { firstOutputBundle: incompleteBundle });
  const incompleteItem = incompleteGate.items.find((gateItem) => gateItem.id === "IMP15-GATE-08");
  assert.equal(incompleteItem.ok, false);
  assert.equal(incompleteItem.code, "INCOMPLETE_OUTPUT_BUNDLE");
  assert.ok(incompleteItem.missing.some((missing) => missing.includes("bhvByCampaign ausente")));
  assert.equal(incompleteGate.failedIds.includes("IMP15-GATE-08"), true);

  // Bundle que no declara su bundleKind: no hay output bundle materializado.
  const noBundle = deepCopy(base.firstOutputBundle);
  noBundle.bundleKind = "SOMETHING_ELSE";
  const noBundleGate = evaluateGate(base, { firstOutputBundle: noBundle });
  const noBundleItem = noBundleGate.items.find((gateItem) => gateItem.id === "IMP15-GATE-08");
  assert.equal(noBundleItem.ok, false);
  assert.equal(noBundleItem.code, "MISSING_OUTPUT_BUNDLE");
});

test("IMP-15: GATE-04 con brazo A1 real distinto — treatment idéntico cierra el ítem; treatment divergente no cierra y señala el fill (IMP15-H2)", () => {
  const base = baseScenario({ capMw: 12 });
  // Segundo brazo real: controller distinto (cap 24 MW) → armVersion distinta
  // en el receipt, mismas treatment de execution contract fill a fill.
  const a1Bundle = frozenCampaignBundle({ dailyCapMw: 24 });
  const a1Run = runP6Replay(a1Bundle, { runTimestampUtc: "2026-09-23T02:00:00Z" });
  assert.equal(a1Run.ok, true);
  const a1Output = buildOutputBundle({ bundle: a1Bundle, replayOutcome: a1Run });
  assert.equal(a1Output.ok, true);
  assert.notEqual(
    a1Output.outputBundle.receipt.armVersion,
    base.firstOutputBundle.receipt.armVersion,
  );

  const parityGate = evaluateGate(base, { a1OutputBundle: a1Output.outputBundle, singleArmDeclaration: null });
  const parityItem = parityGate.items.find((gateItem) => gateItem.id === "IMP15-GATE-04");
  assert.equal(parityItem.ok, true);
  assert.equal(parityItem.code, "OK");
  assert.equal(parityItem.divergenceIndex, null);
  assert.equal(parityGate.gateComplete, true);
  assert.ok(!parityGate.failedIds.includes("IMP15-GATE-04"));

  // Con paridad rota el ítem falla y el divergenceIndex señala el fill.
  const tamperedA1 = {
    ...a1Output.outputBundle,
    ledgers: {
      ...a1Output.outputBundle.ledgers,
      execution: a1Output.outputBundle.ledgers.execution.map((row, index) => (
        index === 2 ? { ...row, lotRoundingTreatment: "OTHER_TREATMENT" } : row
      )),
    },
  };
  const mismatchGate = evaluateGate(base, { a1OutputBundle: tamperedA1, singleArmDeclaration: null });
  const mismatchItem = mismatchGate.items.find((gateItem) => gateItem.id === "IMP15-GATE-04");
  assert.equal(mismatchItem.ok, false);
  assert.equal(mismatchItem.code, "TREATMENT_MISMATCH");
  assert.equal(mismatchItem.divergenceIndex, 2);
  assert.equal(mismatchGate.failedIds.includes("IMP15-GATE-04"), true);
});
