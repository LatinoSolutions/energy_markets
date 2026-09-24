// Tests entry-hour performance profile Q07 (IMP-21).
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  bucketSufficiencyOf,
  buildEntryHourProfile,
  assertProfileProducesNoSelection,
  verifyFrozenQ07Protocol,
} from "../../src/imp21-q07/index.mjs";
import {
  createSyntheticFrozenProtocol,
  createSyntheticIntradayAudit,
  FIXTURE_SNAPSHOTS,
  FIXTURE_BENCHMARK_B,
  mutateAndRefreeze,
} from "./fixtures.mjs";
import { createIntradaySnapshotRegistry } from "../../src/imp21-q07/index.mjs";

const registry = createIntradaySnapshotRegistry("SYNTHETIC_FIXTURE_SOURCE", FIXTURE_SNAPSHOTS);

test("suficiencia: bajo el mínimo predeclarado el bucket es evidencia INSUFICIENTE, no PASS", () => {
  assert.deepEqual(bucketSufficiencyOf({ observationCount: 5, minObservations: 5 }), { status: "SUFFICIENT", eligible: true });
  assert.deepEqual(bucketSufficiencyOf({ observationCount: 4, minObservations: 5 }), { status: "INSUFFICIENT_EVIDENCE_BELOW_MIN", eligible: false });
  assert.deepEqual(bucketSufficiencyOf({ observationCount: -1, minObservations: 5 }), { status: "INVALID_BUCKET_INPUT", eligible: false });
});

test("sin audit intradía: la evaluación queda BLOQUEADA y el faltante se conserva explícito", () => {
  const outcome = buildEntryHourProfile({
    frozen: createSyntheticFrozenProtocol(),
    snapshotRegistry: registry,
    benchmarkB: FIXTURE_BENCHMARK_B,
  });
  assert.equal(outcome.ok, false);
  assert.equal(outcome.code, "EVALUATION_BLOCKED_NO_INTRADAY_AUDIT");
  assert.equal(outcome.profile, null);
  assert.equal(outcome.supportOnly, true);
  assert.match(outcome.blocker, /DEP-17/);
});

test("protocolo no frozen no alimenta el profile", () => {
  const outcome = buildEntryHourProfile({
    frozen: { ...createSyntheticFrozenProtocol(), status: "FREE_PREVIEW" },
    snapshotRegistry: registry,
    intradayAudit: createSyntheticIntradayAudit(),
    benchmarkB: FIXTURE_BENCHMARK_B,
  });
  assert.equal(outcome.ok, false);
  assert.equal(outcome.code, "PROTOCOL_NOT_FROZEN");
});

test("profile completo con audit aceptado: filas por hora, deltas y paridad", () => {
  const frozen = createSyntheticFrozenProtocol();
  const outcome = buildEntryHourProfile({
    frozen,
    snapshotRegistry: registry,
    intradayAudit: createSyntheticIntradayAudit(),
    benchmarkB: FIXTURE_BENCHMARK_B,
  });
  assert.equal(outcome.ok, true);
  const profile = outcome.profile;
  assert.equal(profile.hourRows.length, 3);
  const byHour = Object.fromEntries(profile.hourRows.map((row) => [row.hourId, row]));
  // deltaVsReferenceHour en H: H_09_15 es la referencia declarada.
  assert.equal(byHour.H_09_15.deltaVsReferenceHour, null);
  assert.equal(byHour.H_13_45.deltaVsReferenceHour, 2004 - 2064);
  assert.equal(byHour.W_09_17.deltaVsReferenceHour, 2004 - 2064);
  // V = B − H (§14.6) por fila.
  assert.equal(byHour.H_09_15.V, FIXTURE_BENCHMARK_B - 2064);
  assert.equal(byHour.H_13_45.V, FIXTURE_BENCHMARK_B - 2004);
  // Suficiencia de fila con el mínimo declarado (5).
  for (const row of profile.hourRows) {
    assert.equal(row.sufficiency.status, "SUFFICIENT");
  }
  // Buckets: sin denegals y con cobertura completa en todos los brazos del fixture.
  for (const row of profile.hourRows) {
    for (const bucket of row.buckets) {
      assert.equal(bucket.sufficiency.status, "SUFFICIENT", `${row.hourId}/${bucket.bucketId}`);
    }
  }
});

test("bucket bajo mínimo: INSUFFICIENT_EVIDENCE_BELOW_MIN visible, no sustituido", () => {
  const frozen = createSyntheticFrozenProtocol({
    minObservations: 9,
  });
  const outcome = buildEntryHourProfile({
    frozen,
    snapshotRegistry: registry,
    intradayAudit: createSyntheticIntradayAudit(),
    benchmarkB: FIXTURE_BENCHMARK_B,
  });
  assert.equal(outcome.ok, true);
  for (const row of outcome.profile.hourRows) {
    assert.equal(row.sufficiency.status, "INSUFFICIENT_EVIDENCE_BELOW_MIN");
  }
});

test("el profile consumido no reclama el audit como evidencia generada por IMP-21", () => {
  const outcome = buildEntryHourProfile({
    frozen: createSyntheticFrozenProtocol(),
    snapshotRegistry: registry,
    intradayAudit: createSyntheticIntradayAudit(),
    benchmarkB: FIXTURE_BENCHMARK_B,
  });
  assert.equal(outcome.profile.auditConsumption.consumed.evidenceRole.includes("no evidencia del experimento"), true);
});

test("el profile no emite hora óptima ni selección automática", () => {
  const outcome = buildEntryHourProfile({
    frozen: createSyntheticFrozenProtocol(),
    snapshotRegistry: registry,
    intradayAudit: createSyntheticIntradayAudit(),
    benchmarkB: FIXTURE_BENCHMARK_B,
  });
  assert.equal(assertProfileProducesNoSelection(outcome.profile).code, "NO_MANDATED_HOUR_SELECTION");
});

test("H2: protocolo mutado post-freeze (contentHash falsificado) NO alimenta el profile", () => {
  const frozen = createSyntheticFrozenProtocol();
  const outcome = buildEntryHourProfile({
    frozen: { ...frozen, hourRows: undefined, contentHash: "falsificado" },
    snapshotRegistry: registry,
    intradayAudit: createSyntheticIntradayAudit(),
    benchmarkB: FIXTURE_BENCHMARK_B,
  });
  assert.equal(outcome.ok, false);
  assert.equal(outcome.code, "PROTOCOL_HASH_MISMATCH");
  assert.equal(outcome.profile, null);
  assert.equal(verifyFrozenQ07Protocol({ ...frozen, contentHash: "falsificado" }).code, "PROTOCOL_HASH_MISMATCH");
});

test("H4: cobertura causal distinta entre horas no aborta el profile", () => {
  const frozen = mutateAndRefreeze(createSyntheticFrozenProtocol(), (protocol) => {
    protocol.candidates = [
      { hourId: "W_EARLY", kind: "DYNAMIC_WINDOW", windowStartHour: 9, windowEndHour: 11 },
      { hourId: "W_LATE", kind: "DYNAMIC_WINDOW", windowStartHour: 12, windowEndHour: 17 },
    ];
    protocol.referenceHourId = null;
  });
  const outcome = buildEntryHourProfile({
    frozen,
    snapshotRegistry: registry,
    intradayAudit: createSyntheticIntradayAudit(),
    benchmarkB: FIXTURE_BENCHMARK_B,
  });
  assert.equal(outcome.ok, true, `profile: ${outcome.code}`);
  const byHour = Object.fromEntries(outcome.profile.hourRows.map((row) => [row.hourId, row]));
  assert.equal(byHour.W_EARLY.coverageFraction, 0);
  assert.equal(byHour.W_LATE.coverageFraction, 1);
  // El bucket B_NO_DENIED distingue el brazo con denegaciones del que no.
  const earlyNoDenied = byHour.W_EARLY.buckets.find((b) => b.bucketId === "B_NO_DENIED");
  const lateNoDenied = byHour.W_LATE.buckets.find((b) => b.bucketId === "B_NO_DENIED");
  assert.equal(earlyNoDenied.passesMetric, false);
  assert.equal(lateNoDenied.passesMetric, true);
});
