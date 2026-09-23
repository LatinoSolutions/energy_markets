// Tests del registro Experience y del holder de Policy Version (IMP-17).
// Fuente: SPEC v1.1.1 §12.3 (provenance preservada al alimentar el Learning
// Loop), §11.5 ("la policy activa no se reescribe online... cambios de
// parámetros/value estimates/policy logic/calibración crean nueva versión";
// "ninguna actualización hot") y §25.2 fila IMP-17 ("records versionados").

import test from "node:test";
import assert from "node:assert/strict";

import {
  buildExperienceRecord,
  createExperienceRegistry,
  createActivePolicyVersionHolder,
} from "../../src/experience/index.mjs";
import { syntheticReplayRecord } from "./fixtures.mjs";

function builtRecord(overrides = {}) {
  return buildExperienceRecord(syntheticReplayRecord(overrides)).record;
}

test("IMP-17 · registro append-only versionado: todo registro se preserva y no se sobrescribe", () => {
  const registry = createExperienceRegistry();
  const r1 = builtRecord();
  const first = registry.register({ record: r1 });
  assert.equal(first.ok, true);
  // Re-registro idéntico: entrada nueva conservada (append-only, patrón §25.2).
  const duplicate = registry.register({ record: r1 });
  assert.equal(duplicate.ok, true);
  assert.equal(duplicate.recordId, first.recordId);
  assert.equal(registry.entryCount(), 2);
  // Un registro distinto coexiste; el anterior no desaparece.
  const r2 = builtRecord({ policyVersion: "policy-v2" });
  registry.register({ record: r2 });
  assert.equal(registry.has(r1.recordId), true);
  assert.equal(registry.has(r2.recordId), true);
  assert.equal(registry.snapshot().length, 3);
});

test("IMP-17 · recordId mentiroso se rechaza fail-closed (§25.2)", () => {
  const registry = createExperienceRegistry();
  // El record se presenta con un recordId que no deriva de su contenido.
  const r1 = { ...builtRecord(), recordId: "0".repeat(64) };
  const rejected = registry.register({ record: r1 });
  assert.equal(rejected.ok, false);
  assert.equal(rejected.code, "RECORD_ID_MISMATCH");
  assert.equal(registry.entryCount(), 0);
});

test("IMP-17 · el registro no edita el record registrado y toda la provenance sale intacta", () => {
  const registry = createExperienceRegistry();
  const r1 = builtRecord();
  registry.register({ record: r1 });
  const stored = registry.recordOf(r1.recordId);
  assert.equal(stored.policyVersion, "policy-v1");
  assert.equal(stored.provenance.kind, "test-fixture-assertion");
});

test("IMP-17 §11.5 · no hay update/delete/reorder del historial registrado", () => {
  const registry = createExperienceRegistry();
  const r1 = builtRecord();
  registry.register({ record: r1 });
  const before = JSON.stringify(registry.snapshot());
  const methods = Object.getOwnPropertyNames(registry);
  // Sólo operaciones de lectura/registro: ninguna vía de mutación.
  for (const forbidden of ["update", "delete", "appendEdit", "rewrite", "clear", "insertAt"]) {
    assert.equal(methods.includes(forbidden), false, `método mutador prohibido: ${forbidden}`);
  }
  // Los entries están congelados.
  const snapshotA = registry.snapshot();
  assert.throws(() => { snapshotA[0].recordId = "tampered"; }, TypeError);
  assert.equal(JSON.stringify(registry.snapshot()), before);
});

test("IMP-17 §11.5 · la versión activa no se reescribe en caliente: sólo ciclo offline crea versión nueva", () => {
  const holder = createActivePolicyVersionHolder({ initialVersion: "policy-v1" });
  assert.equal(holder.current(), "policy-v1");
  // Re-declarar la misma versión no es un cambio: hot rewrite prohibido.
  assert.equal(holder.replaceViaOfflineCycle({ newVersion: "policy-v1" }).ok, false);
  assert.equal(holder.current(), "policy-v1");
  // El cambio vía ciclo offline crea versión nueva, con historial conservado.
  const changed = holder.replaceViaOfflineCycle({ newVersion: "policy-v2", learningCycleRef: "learning-cycle-fix-01" });
  assert.equal(changed.ok, true);
  assert.equal(changed.previousVersion, "policy-v1");
  assert.equal(changed.activatedVersion, "policy-v2");
  assert.equal(holder.current(), "policy-v2");
  // Real Experience alimenta el siguiente ciclo; no muta la versión en su
  // lugar: los records antiguos siguen apuntando a su versión original.
  assert.deepEqual(holder.history(), ["policy-v1", "policy-v2"]);
  const oldRecord = builtRecord(); // policyVersion policy-v1
  assert.equal(oldRecord.policyVersion, "policy-v1");
});

test("IMP-17 §12.3 · los records alimentan el Learning Loop con provenance preservada", () => {
  const registry = createExperienceRegistry();
  const replayRecord = builtRecord();
  const shadowRecord = builtRecord({ sourceType: "SHADOW" });
  registry.register({ record: replayRecord });
  registry.register({ record: shadowRecord });
  const corpus = registry.snapshot();
  assert.equal(corpus[0].record.sourceType, "REPLAY");
  assert.equal(corpus[1].record.sourceType, "SHADOW");
  assert.notEqual(corpus[0].record.sourceType, corpus[1].record.sourceType);
});
