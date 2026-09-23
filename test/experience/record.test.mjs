// Tests del contrato conceptual del registro Experience (IMP-17). Fuente:
// SPEC v1.1.1 §12.2 (piezas documendadas y regla "no se fabrican ejecuciones
// para completar un esquema"), §12.1 y §25.2 fila IMP-17 ("records
// versionados"; casos sintéticos no generan Real Experience). Fixtures
// sintéticos explícitos (no son datos del cliente).

import test from "node:test";
import assert from "node:assert/strict";

import {
  buildExperienceRecord,
  recordIdentityOf,
  closeExperienceRecord,
  validateExperienceRecordShape,
  ARTIFACT_KIND,
  RECORD_STATES,
} from "../../src/experience/index.mjs";
import { syntheticReplayRecord } from "./fixtures.mjs";

function syntheticValidRecord() {
  const built = buildExperienceRecord(syntheticReplayRecord());
  assert.equal(built.ok, true, JSON.stringify(built.errors ?? []));
  return built.record;
}

test("IMP-17 · un registro válido porta las piezas §12.2", () => {
  const record = syntheticValidRecord();
  assert.equal(record.artifactKind, ARTIFACT_KIND);
  assert.equal(record.sourceType, "REPLAY");
  assert.ok(typeof record.policyVersion === "string" && record.policyVersion.length > 0);
  assert.ok(record.stateSnapshot.frontierUtc);
  assert.ok(record.stateSnapshot.dataReference.manifestId);
  assert.equal(record.recommendedAction, "BUY");
  assert.equal(record.execution.executedAction, "BUY");
  assert.equal(record.execution.fills.length, 1);
  assert.ok(record.nextState);
  assert.ok(record.recommendedAtUtc);
  assert.ok(record.recordedAtUtc);
  assert.ok(record.provenance);
  assert.equal(Object.isFrozen(record), true);
});

test("IMP-17 · identidad versionada content-addressed (§25.2)", () => {
  const record = syntheticValidRecord();
  assert.equal(recordIdentityOf({ ...record }), record.recordId);
  // Mismo contenido → mismo recordId; corrección → id nuevo.
  const corrected = syntheticValidRecord();
  const different = buildExperienceRecord(syntheticReplayRecord({ policyVersion: "policy-v2" })).record;
  assert.equal(different.policyVersion, "policy-v2");
  assert.notEqual(different.recordId, record.recordId);
  assert.equal(different.recordId, recordIdentityOf({ ...different }));
});

test("IMP-17 · piezas obligatorias ausentes son fail-closed, nunca rellenadas", () => {
  const cases = [
    { override: { policyVersion: null } },
    { override: { stateSnapshot: null } },
    { override: { recommendedAtUtc: null } },
    { override: { recordedAtUtc: "  " } },
    { override: { provenance: null } },
    { override: { sourceType: "BACKTEST" } }, // no-canónica (§12.1)
  ];
  for (const { override } of cases) {
    const built = buildExperienceRecord(syntheticReplayRecord(override));
    assert.equal(built.ok, false, `deberia fallar con ${JSON.stringify(override)}`);
    assert.ok(built.errors.length > 0);
  }
});

test("IMP-17 · recommendedAction null sin razón documentada no existe", () => {
  const built = buildExperienceRecord(syntheticReplayRecord({ recommendedAction: null }));
  assert.equal(built.ok, false);
  assert.equal(built.errors[0].code, "MISSING_NO_RECOMMENDATION_REASON");
  const documented = buildExperienceRecord(syntheticReplayRecord({
    recommendedAction: null,
    noRecommendationReason: "DATA_BLOCKED: frontera sin decisión emitida (§14.7)",
    execution: null,
  }));
  assert.equal(documented.ok, true, JSON.stringify(documented.errors ?? []));
});

test("IMP-17 · no se fabrican ejecuciones/el fill real en fuente simulada mezcla fuerza probatoria", () => {
  const replayWithRealFill = buildExperienceRecord(syntheticReplayRecord({
    execution: {
      executedAction: "BUY",
      fills: [{
        evidenceKind: "REAL_FILL",
        quantity: 10,
        price: 24.35,
        timestampUtc: "2026-01-05T11:04:00Z",
      }],
    },
  }));
  assert.equal(replayWithRealFill.ok, false);
  assert.ok(replayWithRealFill.errors.some((e) => e.code === "PROBATORY_FORCE_MIXING"));
  assert.ok(replayWithRealFill.errors.some((e) => (e.field ?? "").includes("evidenceKind")));
});

test("IMP-17 · el outcome sólo existe al cierre (§12.2)", () => {
  // OPEN con outcome no permitido: la pieza existe en ese contexto o no existe.
  const openWithOutcome = buildExperienceRecord(syntheticReplayRecord({
    outcome: { reward: 12.5, benchmarkVersion: "bench-v1" },
  }));
  assert.equal(openWithOutcome.ok, false);
  assert.ok(openWithOutcome.errors.some((e) => e.code === "OUTCOME_NOT_AT_CLOSURE"));

  // CLOSED sin outcome: pieza ya existente pero declarada ausente → fail-closed.
  const closedWithoutOutcome = buildExperienceRecord(syntheticReplayRecord({ recordState: "CLOSED" }));
  assert.equal(closedWithoutOutcome.ok, false);
  assert.ok(closedWithoutOutcome.errors.some((e) => e.field === "outcome"));

  // Sólo existe cuando hay evaluación real: outcome null en CLOSED también es
  // fail (§12.2 exige la pieza al cierre; si no es evaluable, la evaluación
  // decidirá; el builder no fabrica reward).
  const closed = buildExperienceRecord(syntheticReplayRecord({
    recordState: "CLOSED",
    outcome: { reward: 3.2, benchmarkVersion: "bench-v1" },
  }));
  assert.equal(closed.ok, true, JSON.stringify(closed.errors ?? []));
});

test("IMP-17 · el cierre crea un registro nuevo; el original no se edita", () => {
  const open = syntheticValidRecord();
  const closed = closeExperienceRecord({
    record: open,
    outcome: { reward: 4.4, benchmarkVersion: "bench-v1" },
    nextState: { source: "test-fixture", executedVolume: 10, remainingVolume: 20, unit: "MW" },
  });
  assert.equal(closed.ok, true, JSON.stringify(closed.errors ?? []));
  assert.equal(closed.record.recordState, RECORD_STATES.CLOSED);
  assert.notEqual(closed.record.recordId, open.recordId);
  // El original queda intacto (append-only; ninguna actualización hot).
  assert.equal(open.recordState, "OPEN");
  // Cierre doble rechazado: la pieza ocurre una vez.
  const twice = closeExperienceRecord({ record: closed.record, outcome: { reward: 5, benchmarkVersion: "b" } });
  assert.equal(twice.ok, false);
  assert.equal(twice.code, "ALREADY_CLOSED");
});

test("IMP-17 · caso sintético no genera Real Experience (§25.2 nota)", () => {
  const built = buildExperienceRecord({ ...syntheticReplayRecord(), sourceType: "REAL_EXECUTION" });
  assert.equal(built.ok, false);
  assert.ok(built.errors.some((e) => e.code === "SYNTHETIC_REAL_FORBIDDEN")
    || built.errors.some((e) => e.code === "MISSING_REQUIRED" && e.field === "provenance.realExecutionEvidence"));
});

test("IMP-17 · sello Real exige evidencia de actuación efectiva, no etiqueta", () => {
  const bare = validateExperienceRecordShape({ ...syntheticReplayRecord(), synthetic: false, sourceType: "REAL_EXECUTION" });
  assert.equal(bare.ok, false);
  assert.ok(bare.errors.some((e) => (e.field ?? "").includes("realExecutionEvidence")));
});
