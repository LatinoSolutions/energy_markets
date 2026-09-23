// Tests de fuentes separadas y mezcla (IMP-17). Fuente: SPEC v1.1.1 §12.1
// (tres fuentes, qué es factual y qué permanece simulado en cada una),
// §12.3 ("no se presentan con igual fuerza probatoria por defecto; cualquier
// weighting/sampling/combining debe predeclararse y versionarse") y §25.1
// fila IMP-17 ("Replay simulado, Shadow factual limitado y Real factual
// distinguibles; no mezclar fuerza probatoria").

import test from "node:test";
import assert from "node:assert/strict";

import {
  EXPERIENCE_SOURCE_TYPES,
  probatoryForceOf,
  evidenceClassOfRecord,
  combineCorpusBySource,
  validateMixtureDeclaration,
  FILL_EVIDENCE_KINDS,
} from "../../src/experience/index.mjs";
import { buildExperienceRecord } from "../../src/experience/index.mjs";
import { syntheticReplayRecord, syntheticShadowRecord } from "./fixtures.mjs";

test("IMP-17 · las tres fuentes son distinguibles por su clase probatoria (§25.1)", () => {
  assert.equal(probatoryForceOf("REPLAY"), "SIMULATED");
  assert.equal(probatoryForceOf("SHADOW"), "FACTUAL_LIMITED");
  assert.equal(probatoryForceOf("REAL_EXECUTION"), "FACTUAL");
  assert.equal(Object.keys(EXPERIENCE_SOURCE_TYPES).length, 3);
  // Una fuente desconocida no hereda fuerza de nadie.
  assert.equal(probatoryForceOf("SHADOW_LITE"), null);
});

test("IMP-17 · la clase de cada record la pone su fuente, no la mezcla", () => {
  const replayRecord = buildExperienceRecord(syntheticReplayRecord()).record;
  const shadowRecord = buildExperienceRecord(syntheticShadowRecord({
    execution: { executedAction: "BUY", fills: [] },
  })).record;
  assert.equal(evidenceClassOfRecord(replayRecord), "SIMULATED");
  assert.equal(evidenceClassOfRecord(shadowRecord), "FACTUAL_LIMITED");
  // Los fills de Shadow permanecen SIMULATED_FILL salvo ejecución real (§12.1);
  // un fill real en Shadow está prohibido.
  const shadowWithRealFill = buildExperienceRecord(syntheticShadowRecord({
    execution: {
      executedAction: "BUY",
      fills: [{ evidenceKind: FILL_EVIDENCE_KINDS.REAL_FILL, quantity: 5, price: 24.2, timestampUtc: "2026-01-06T11:04:00Z" }],
    },
  }));
  assert.equal(shadowWithRealFill.ok, false);
  assert.ok(shadowWithRealFill.errors.some((e) => e.code === "PROBATORY_FORCE_MIXING"));
});

test("IMP-17 · mezcla sin predeclaración versionada es fail-closed (§12.3)", () => {
  const replayRecord = buildExperienceRecord(syntheticReplayRecord()).record;
  const shadowRecord = buildExperienceRecord(syntheticShadowRecord({ execution: { executedAction: "BUY", fills: [] } })).record;
  const noDeclaration = combineCorpusBySource({ records: [replayRecord, shadowRecord] });
  assert.equal(noDeclaration.ok, false);
  assert.equal(noDeclaration.code, "MIXING_NOT_PREDECLARED");
  assert.equal(noDeclaration.bySource, undefined);
});

test("IMP-17 · declaración incompleta se rechaza (§12.3)", () => {
  const withoutVersion = validateMixtureDeclaration({
    weights: { REPLAY: 1, SHADOW: 0 },
    declaredBy: "test",
  });
  assert.equal(withoutVersion.ok, false);
  assert.equal(withoutVersion.code, "MISSING_DECLARATION_VERSION");
  const withNonCanonicalSource = validateMixtureDeclaration({
    declarationVersion: "decl-v1",
    weights: { SHADOW_LITE: 1 },
    declaredBy: "test",
  });
  assert.equal(withNonCanonicalSource.ok, false);
  assert.equal(withNonCanonicalSource.code, "UNKNOWN_SOURCE_IN_WEIGHTS");
});

test("IMP-17 · corpus combinado conserva provenance por fuente y nunca iguala fuerza (§12.3)", () => {
  const replayRecord = buildExperienceRecord(syntheticReplayRecord()).record;
  const shadowRecord = buildExperienceRecord(syntheticShadowRecord({ execution: { executedAction: "BUY", fills: [] } })).record;
  const combined = combineCorpusBySource({
    records: [replayRecord, shadowRecord],
    mixtureDeclaration: {
      declarationVersion: "decl-v1",
      weights: { REPLAY: 1, SHADOW: 0.5 },
      declaredBy: "test-fixture (predeclaración sintética de prueba)",
    },
  });
  assert.equal(combined.ok, true, JSON.stringify(combined.message ?? ""));
  assert.equal(combined.bySource.REPLAY.evidenceClass, "SIMULATED");
  assert.equal(combined.bySource.SHADOW.evidenceClass, "FACTUAL_LIMITED");
  // La mezcla no fabrica una cuarta fuente ni label común: cada registro queda
  // bajo su fuente con su provenance propio.
  assert.equal(combined.bySource.REPLAY.records[0].sourceType, "REPLAY");
  assert.equal(combined.bySource.SHADOW.records[0].sourceType, "SHADOW");
  assert.equal(combined.bySource.REPLAY.records[0].provenance.kind, "test-fixture-assertion");
});
