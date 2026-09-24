// Tests IMP-16 parte 4: evaluación P3 de la serie ΔV y receipt de research.
// Fuente: SPEC v1.1.1 §5.6/§5.7/§5.8 (scoring y veredicto, sin PASS fabricado)
// y §25.2 DEP-13/14 ("FAIL/HOLD/INVALID no se ocultan ni se convierten en PASS
// para cerrar un gate posterior"). Fixtures sintéticos declarados.

import test from "node:test";
import assert from "node:assert/strict";

import {
  freezeP5Experiment,
  runP5Experiment,
  deriveDatasetQuality,
  deltaVSeriesFromRuns,
  p5ResearchEvaluation,
  materializeP5ExperimentReceipt,
} from "../../src/p5-experiment/index.mjs";
import { buildExperimentFixture } from "./fixtures.mjs";

// 8 quarters sellados del fixture (2021Q3..2023Q2, ≥2 años calendario).
const SEALED_CAMPAIGN_IDS = [
  "GAS-Q-2021Q3", "GAS-Q-2021Q4", "GAS-Q-2022Q1", "GAS-Q-2022Q2",
  "GAS-Q-2022Q3", "GAS-Q-2022Q4", "GAS-Q-2023Q1", "GAS-Q-2023Q2",
];

const RUN_ARGS = (fx) => ({
  frozen: null,
  oosReservation: fx.frozenReservation,
  runTimestampUtc: "2026-09-24T00:00:00Z",
  benchmarkRows: [
    { date: "2021-06-22", selected: 42 },
    { date: "2021-06-23", selected: 42 },
    { date: "2021-06-24", selected: 42 },
    { date: "2021-06-25", selected: 42 },
  ],
  product: null,
  windowStart: "2021-06-01",
  windowEnd: "2021-07-01",
});

function deterministicSeries() {
  // ΔV esperados del fixture: a/4 - b/12 (verificados en run.test.mjs).
  const pairs = [
    [12, 0], [18, 0], [12, 0], [24, 0], [24, 0], [18, 0], [0, 9], [0, 12],
  ];
  return pairs.map(([a, b], index) => ({
    campaignId: SEALED_CAMPAIGN_IDS[index],
    deltaV: a / 4 - b / 12,
    runReceiptId: `receipt-${index + 1}`,
  }));
}

test("§5.6: la serie ΔV con evidencia completa y benchmark no provisional puede PASS", () => {
  // Serie mixta con perdidos: mu y Sortino definidos (§5.6 exige nPlus>0 y
  // nMinus>0); mu = (18-2)/8 = 2, Sortino > 1.
  const series = SEALED_CAMPAIGN_IDS.map((campaignId, index) => ({
    campaignId,
    deltaV: index < 6 ? 3 : -1,
    runReceiptId: "r",
  }));
  const evaluation = p5ResearchEvaluation({ series, dataQuality: { coverage: "full", benchmarkProvisional: false } });
  assert.equal(evaluation.ok, true);
  assert.equal(evaluation.verdict, "PASS");
  assert.ok(evaluation.scoring.mu > 0);
  assert.ok(evaluation.scoring.sortino > 1);
  assert.equal(evaluation.minimumEvidence.minimumEvidenceMet, true);
  assert.equal(evaluation.minimumEvidence.quartersCompleted, 8);
  assert.equal(evaluation.campaignYearsDerived.length >= 2, true);
});

test("§5.8 FAIL: mu > 0 pero Sortino <= 1 (screen predeclarado) → FAIL conservado", () => {
  const series = SEALED_CAMPAIGN_IDS.map((campaignId, index) => ({
    campaignId,
    deltaV: index < 6 ? 6 : -9,
    runReceiptId: "r",
  }));
  const evaluation = p5ResearchEvaluation({ series, dataQuality: { coverage: "full", benchmarkProvisional: false } });
  assert.equal(evaluation.ok, true);
  assert.equal(evaluation.verdict, "FAIL");
  assert.ok(evaluation.scoring.mu > 0);
  assert.ok(evaluation.scoring.sortino <= 1);
});

test("§5.7 HOLD: serie por debajo del mínimo (8 trimestres, 2 años) nunca fabrica PASS", () => {
  const series = SEALED_CAMPAIGN_IDS.slice(0, 3).map((campaignId) => ({ campaignId, deltaV: 10, runReceiptId: "r" }));
  const evaluation = p5ResearchEvaluation({ series, dataQuality: { coverage: "full", benchmarkProvisional: false } });
  assert.equal(evaluation.ok, true);
  assert.equal(evaluation.verdict, "HOLD");
  assert.equal(evaluation.minimumEvidence.minimumEvidenceMet, false);
});

test("§5.6/§13.9: entradas sin ΔV definido no forman población; la serie no interpreta", () => {
  const series = [
    ...SEALED_CAMPAIGN_IDS.slice(0, 7).map((campaignId) => ({ campaignId, deltaV: 2, runReceiptId: "r" })),
    { campaignId: SEALED_CAMPAIGN_IDS[7], deltaV: null, runReceiptId: "r" },
  ];
  const evaluation = p5ResearchEvaluation({ series, dataQuality: { coverage: "full", benchmarkProvisional: false } });
  assert.equal(evaluation.ok, false);
  assert.equal(evaluation.code, "DELTA_V_SERIES_ISSUES");
  assert.equal(evaluation.verdict, "HOLD");
  assert.ok(evaluation.issues.length > 0);
});

test("§5.8/§13.6: calidad de datos derivada del frozen → HOLD si benchmark es provisional", () => {
  const fx = buildExperimentFixture({});
  const frozenOutcome = freezeP5Experiment(fx.freezeInput);
  assert.equal(frozenOutcome.ok, true);
  const frozen = frozenOutcome.frozen;
  const run = runP5Experiment({ ...RUN_ARGS(fx), frozen });
  assert.equal(run.ok, true);

  const dataQuality = deriveDatasetQuality({ frozen, runOutcome: run });
  assert.equal(dataQuality.ok, true);
  // B UNRECONCILED + parámetros P5.6 provisionales → benchmarkProvisional TRUE
  // (deriva del manifest congelado; el caller no puede declararlo false).
  assert.equal(dataQuality.dataQuality.benchmarkProvisional, true);
  // Coverage full: ambos brazos COVERED (runs reales del fixture).
  assert.equal(dataQuality.dataQuality.coverage, "full");

  const series = SEALED_CAMPAIGN_IDS.map((campaignId, index) => ({
    campaignId,
    deltaV: index < 6 ? 3 : -1,
    runReceiptId: "r",
  }));
  const evaluation = p5ResearchEvaluation({ series, dataQuality: dataQuality.dataQuality });
  // El estado real del repo (benchmark no reconciliado, P5.6 provisional) no
  // puede producir PASS, como el resultade elevatico; el HOLD es REAL:
  assert.equal(evaluation.verdict, "HOLD");
  assert.ok(evaluation.verdictReason.includes("provisional"));
});

test("§25.1: materialización del receipt IMP-16 con veredicto, costes y concentración", () => {
  const fx = buildExperimentFixture({});
  const frozenOutcome = freezeP5Experiment(fx.freezeInput);
  const frozen = frozenOutcome.frozen;
  const run = runP5Experiment({ ...RUN_ARGS(fx), frozen });

  const series = SEALED_CAMPAIGN_IDS.map((campaignId, index) => ({
    campaignId,
    deltaV: index < 6 ? run.deltaV.value : -1,
    runReceiptId: "r",
  }));
  const evaluation = p5ResearchEvaluation({ series, dataQuality: { coverage: "full", benchmarkProvisional: false } });

  const receipt = materializeP5ExperimentReceipt({ frozen, runOutcome: run, researchEvaluation: evaluation, runTimestampUtc: "2026-09-24T00:00:00Z" });
  assert.equal(receipt.ok, true);
  assert.equal(receipt.receipt.receiptKind, "IMP-16_P5_EXPERIMENT_RECEIPT");
  assert.equal(receipt.receipt.exAnteManifest.manifestContentHash, frozen.contentHash);
  assert.equal(receipt.receipt.deltaV.defined, true);
  assert.equal(receipt.receipt.oosReservation.intactAfterRun, true);
  assert.equal(receipt.receipt.p3ResearchEvaluation.evaluated, true);
  assert.equal(receipt.receipt.p3ResearchEvaluation.verdict, evaluation.verdict);
  // Los brazos quedan contenidos con sus receipts y B/H/V.
  assert.ok(receipt.receipt.arms.A0.runReceiptId);
  assert.ok(receipt.receipt.arms.A1.runReceiptId);
  assert.equal(receipt.receipt.arms.A1.configurationHash, frozen.s1Configuration.artifactHash);

  // Identity determinista del receipt (mismo contenido → mismo receiptId).
  const again = materializeP5ExperimentReceipt({ frozen, runOutcome: run, researchEvaluation: evaluation, runTimestampUtc: "2026-09-24T00:00:00Z" });
  assert.equal(receipt.receipt.receiptId, again.receipt.receiptId);
});

test("§5.8: un receipt sin veredicto lo declara NOT PROVIDED (nunca lo fabrica)", () => {
  const fx = buildExperimentFixture({});
  const frozen = freezeP5Experiment(fx.freezeInput).frozen;
  const run = runP5Experiment({ ...RUN_ARGS(fx), frozen });
  const individual = deltaVSeriesFromRuns({ series: [{ campaignId: "GAS-Q-2021Q3", runReceiptId: "r" }] });
  assert.equal(individual.values.length, 0);
  assert.equal(individual.problems.length, 1);

  const receipt = materializeP5ExperimentReceipt({ frozen, runOutcome: run, researchEvaluation: null });
  assert.equal(receipt.ok, true);
  assert.equal(receipt.receipt.p3ResearchEvaluation.evaluated, false);
  assert.ok(receipt.receipt.p3ResearchEvaluation.note.includes("nunca fabricado"));
});

test("fail-closed: receipt exige manifest congelado y run real", () => {
  const withoutFrozen = materializeP5ExperimentReceipt({ frozen: null, runOutcome: null });
  assert.equal(withoutFrozen.ok, false);
  assert.equal(withoutFrozen.code, "MISSING_FROZEN_EXPERIMENT");

  const frozen = buildExperimentFixture({});
  const outcome = materializeP5ExperimentReceipt({ frozen: frozen.freezeInput, runOutcome: null });
  assert.equal(outcome.ok, false);
  assert.equal(outcome.code, "MISSING_FROZEN_EXPERIMENT");
});
