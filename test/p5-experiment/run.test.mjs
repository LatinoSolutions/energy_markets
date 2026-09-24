// Tests IMP-16 parte 3: ejecución A0/A1 sobre el manifest congelado. Fuente:
// SPEC v1.1.1 §25.1 fila IMP-16 ("Delta V = H_A0 - H_A1 con B compartido;
// concentración/costes explícitos") y §13.4/§13.9 (paridad: A1 difiere solo
// por timing S1). Fixtures sintéticos declarados; la fórmula ΔV = a/4 - b/12
// se verifica numéricamente, no por aserto.

import test from "node:test";
import assert from "node:assert/strict";

import { contentHashOf } from "../../src/execution-contract/execution-contract.mjs";
import { freezeP5Experiment, runP5Experiment } from "../../src/p5-experiment/index.mjs";
import { buildExperimentFixture } from "./fixtures.mjs";

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

// (day2Premium=12, day3Premium=0) → ΔV esperado = 12/4 - 0 = +3:
//   A0 acumula el spike ejecutable en D2 (52.15); A1 espera (UNFAVORABLE de
//   S1) y redistribuye 3+4+5 bajo 40.15.
test("§25.1: A0/A1 corren sobre el manifest congelado y ΔV = H_A0 - H_A1 con B compartido", () => {
  const fx = buildExperimentFixture({});
  const frozen = freezeP5Experiment(fx.freezeInput);
  assert.equal(frozen.ok, true);

  const run = runP5Experiment({ ...RUN_ARGS(fx), frozen: frozen.frozen });
  assert.equal(run.ok, true);
  assert.equal(run.code, "P5_EXPERIMENT_RUN_COMPLETED");

  // Paridad operacional P5.6 entre bundles congelados (§13.6 regla 3).
  assert.equal(run.executionParity.ok, true);

  // B compartir: mismo benchmark para ambos brazos (§25.1).
  assert.equal(run.benchmark.sharedB, 42);

  // B/H/V por brazo con evaluación derivada de los ledgers reales (§14.6).
  assert.equal(run.arms.A0.evaluation.coverage.status, "COVERED");
  assert.equal(run.arms.A1.evaluation.coverage.status, "COVERED");
  assert.ok(Math.abs((run.arms.A0.evaluation.H) - (40.15 + (12 + 0) / 4)) < 1e-9);
  assert.ok(Math.abs((run.arms.A1.evaluation.H) - (40.15 + 0 / 3)) < 1e-9);
  assert.ok(Math.abs(run.deltaV.value - (12 / 4 - (0 / 12))) < 1e-9);
  assert.equal(run.deltaV.defined, true);
  assert.equal(run.deltaV.crossCheck.startsWith("V_A1 - V_A0 = Delta V"), true);

  // El brazo A1 ejecuta la regla S1: WAIT en el spike de FEATURES y
  // redistribución (3+4+5 en tres fronteras). Ambos brazos terminan cubiertos.
  assert.equal(run.arms.A0.evaluation.coverage.executedVolume, 12);
  assert.equal(run.arms.A1.evaluation.coverage.executedVolume, 12);

  // Concentración de fills: reparto por frontera y max share (§25.1).
  assert.equal(run.concentration.A1.maxFrontierShare, 5 / 12);
  assert.equal(run.concentration.A0.frontierSeries.length, 4);

  // Costes explícitos: additive y embedded sin doble conteo (§13.6 regla 1).
  assert.ok(Object.keys(run.costsByArm.A1.embedded).includes("cost.slippage.virtual"));
  assert.ok(Object.keys(run.costsByArm.A1.additive).length === 0 || !run.costsByArm.A1.additive["cost.fees.other"]);

  // La reserva OOS sigue sellada DESPUÉS del run (ningún consumo evaluativo).
  assert.equal(run.oosReservation.intactAfterRun, true);
  assert.equal(run.invalidRuns.length, 0);
});

test("§25.1: ΔV negativo se preserva (no se oculta ni corrige al vuelo)", () => {
  const fx = buildExperimentFixture({ campaignId: "GAS-Q-2022Q1", day2Premium: 0, day3Premium: 12 });
  const frozen = freezeP5Experiment(fx.freezeInput);
  const run = runP5Experiment({ ...RUN_ARGS(fx), frozen: frozen.frozen });
  assert.equal(run.ok, true);
  // ΔV = 0/4 - 12/12 = -1 (A1 esperó un día barato y pagó el precio alto
  // posterior): el resultado del experimento es FAIL-mecánica, no resecolo.
  assert.ok(Math.abs((run.deltaV.value) - (0 / 4 - 12 / 12)) < 1e-9);
});

test("§14.9: mismo frozen manifest + mismas entradas → mismos receipts (determinismo)", () => {
  const fx = buildExperimentFixture({});
  const frozen = freezeP5Experiment(fx.freezeInput);
  const first = runP5Experiment({ ...RUN_ARGS(fx), frozen: frozen.frozen });
  const second = runP5Experiment({ ...RUN_ARGS(fx), frozen: frozen.frozen });
  assert.equal(first.arms.A0.receiptId, second.arms.A0.receiptId);
  assert.equal(first.arms.A1.receiptId, second.arms.A1.receiptId);
  assert.equal(
    JSON.stringify(first.arms.A0.evaluation),
    JSON.stringify(second.arms.A0.evaluation),
  );
});

test("fail-closed: manifest congelado mutado no ejecuta (anti-mutación §14.9)", () => {
  const fx = buildExperimentFixture({});
  const frozen = freezeP5Experiment(fx.freezeInput);
  const mutated = { ...frozen.frozen, experiment: { ...frozen.frozen.experiment, experimentVersion: "v9" } };
  const outcome = runP5Experiment({ ...RUN_ARGS(fx), frozen: mutated });
  assert.equal(outcome.ok, false);
  assert.equal(outcome.code, "FROZEN_EXPERIMENT_HASH_MISMATCH");
});

test("fail-closed: frozen bundle mutado no ejecuta", () => {
  const fx = buildExperimentFixture({});
  const frozen = freezeP5Experiment(fx.freezeInput);
  // Mutación deep del bundle A1 con el contentHash del manifest re-firmado
  // sobre el contenido mutado: la integridad del manifest pasa, pero el hash
  // del propio bundle ya no recomputa (§14.9).
  const { contentHash, ...core } = frozen.frozen;
  const mutatedBundles = {
    ...core,
    frozenBundles: {
      a0: frozen.frozen.frozenBundles.a0,
      a1: { ...frozen.frozen.frozenBundles.a1, priceObservations: [{ timestamp: "1970-01-01T00:00:00Z", bestAsk: 1 }] },
    },
  };
  mutatedBundles.contentHash = contentHashOf(mutatedBundles);
  const outcome = runP5Experiment({ ...RUN_ARGS(fx), frozen: mutatedBundles });
  assert.equal(outcome.ok, false);
  assert.equal(outcome.code, "FROZEN_BUNDLE_HASH_MISMATCH");
});

test("fail-closed: sin la reserva OOS residente no hay run (la frontera no se re-verifica)", () => {
  const fx = buildExperimentFixture({});
  const frozen = freezeP5Experiment(fx.freezeInput);
  const outcome = runP5Experiment({ ...RUN_ARGS(fx), frozen: frozen.frozen, oosReservation: null });
  assert.equal(outcome.ok, false);
  assert.equal(outcome.code, "MISSING_OOS_RESERVATION");
});

test("fail-closed: benchmark no compartido aborta la comparación (§25.1 'con B compartido')", () => {
  const fx = buildExperimentFixture({});
  const frozen = freezeP5Experiment(fx.freezeInput);
  // Sin rows el benchmark de ambos brazos es undefined: el guard exige B
  // compartido y definido; una divergencia o ausencia no se concilia al vuelo.
  const outcome = runP5Experiment({ ...RUN_ARGS(fx), frozen: frozen.frozen, benchmarkRows: [] });
  assert.equal(outcome.ok, false);
  assert.equal(outcome.code, "BENCHMARK_NOT_SHARED");
});

test("§8.1: sin plan de features el brazo A1 cae a A0 con ΔV = 0 (UNKNOWN, no inventado)", () => {
  const fx = buildExperimentFixture({});
  const frozenOutcome = freezeP5Experiment({ ...fx.freezeInput, s1FeatureInputDeclarations: [] });
  assert.equal(frozenOutcome.ok, true);
  const frozen = frozenOutcome.frozen;
  assert.equal(frozen.s1FeaturePlan.entriesAvailable, 0);

  const run = runP5Experiment({ ...RUN_ARGS(fx), frozen });
  assert.equal(run.ok, true);
  // A1 sin features es A0: ΔV = 0 exacto, definido (accounting idéntico).
  assert.equal(run.deltaV.defined, true);
  assert.equal(Math.abs(run.deltaV.value), 0);
});
