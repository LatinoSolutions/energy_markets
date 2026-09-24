// Tests protocolo Q07 predeclarado y frozen (IMP-21).
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import {
  validateQ07Protocol,
  verifyFrozenQ07Protocol,
  assertNoDocumentedHourPresupposition,
  Q07_PROTOCOL_ID,
  CANONICAL_SPEC_REF,
  CANONICAL_SPEC_SHA256,
  freezeQ07Protocol,
} from "../../src/imp21-q07/index.mjs";
import {
  createSyntheticFrozenProtocol,
  freezeSyntheticProtocol,
  mutateFrozen,
} from "./fixtures.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

test("verifica frozen acepta un protocolo completo, congelado y con hash", () => {
  const frozen = createSyntheticFrozenProtocol();
  assert.equal(frozen.protocolId, Q07_PROTOCOL_ID);
  assert.equal(frozen.status, "FROZEN_PRE_EXPERIMENT");
  assert.equal(frozen.contentHash.length, 64);
  assert.equal(verifyFrozenQ07Protocol(frozen).ok, true);
});

test("rechaza protocolo con un solo candidato: sin pares no hay comparación de horas", () => {
  const protocol = mutateFrozen(createSyntheticFrozenProtocol(), (candidate) => {
    candidate.candidates = [candidate.candidates[0]];
  });
  const validation = validateQ07Protocol(protocol);
  assert.equal(validation.ok, false);
  assert.equal(validation.code, "CANDIDATES_REQUIRED");
});

test("rechaza candidato de tipo desconocido", () => {
  const protocol = mutateFrozen(createSyntheticFrozenProtocol(), (candidate) => {
    candidate.candidates = [
      ...candidate.candidates,
      { ...candidate.candidates[0], kind: "SHADOW_MODE" },
    ];
  });
  assert.equal(validateQ07Protocol(protocol).ok, false);
});

test("rechaza sample binding con política OOS desconocida (no mezcla/selección favorable)", () => {
  const protocol = mutateFrozen(createSyntheticFrozenProtocol(), (candidate) => {
    candidate.sampleBinding = { ...candidate.sampleBinding, oosPolicy: "FREE_ACCESS" };
  });
  const validation = validateQ07Protocol(protocol);
  assert.equal(validation.ok, false);
  assert.equal(validation.code, "INVALID_SAMPLE_BINDING");
});

test("rechaza hora de referencia fuera de los candidatos predeclarados", () => {
  const protocol = mutateFrozen(createSyntheticFrozenProtocol(), (candidate) => {
    candidate.referenceHourId = "H_11_00_IMPUESTA";
  });
  assert.equal(validateQ07Protocol(protocol).code, "REFERENCE_HOUR_NOT_A_CANDIDATE");
});

test("hash del frozen: mutación posterior produce PROTOCOL_HASH_MISMATCH parecido a run.mjs", () => {
  const frozen = createSyntheticFrozenProtocol();
  const attack = { ...frozen, minObservations: frozen.minObservations + 1 };
  assert.equal(verifyFrozenQ07Protocol(attack).code, "PROTOCOL_HASH_MISMATCH");
  assert.equal(verifyFrozenQ07Protocol(frozen).ok, true);
});

test("no se fijan 11:00 ni settlement como hora óptima por documentación", () => {
  const frozen = createSyntheticFrozenProtocol();
  assert.equal(assertNoDocumentedHourPresupposition(frozen).code, "NO_DOCUMENTED_HOUR_PRESUPPOSITION");
  // Un sílabo con etiquetas "optimalHour" es rechazado por el guard.
  const injectada = { ...frozen, optimalHour: '"11:00"' };
  assert.equal(assertNoDocumentedHourPresupposition(injectada).code, "DOCUMENTED_HOUR_PRESUPPOSITION_REJECTED");
});

test("H1: el hash cubre la lógica de buckets y el protocolo congelado es serializable", () => {
  const base = createSyntheticFrozenProtocol();
  const altered = freezeSyntheticProtocol({
    buckets: base.buckets.map((bucket) => bucket.bucketId === "B_NO_DENIED"
      ? { ...bucket, predicate: { ...bucket.predicate, value: 1 } }
      : { ...bucket }),
  });
  // Dos protocolos que difieren SÓLO en la regla del bucket deben diferir.
  assert.notEqual(altered.contentHash, base.contentHash);
  // Round-trip JSON: si hubiera funciones (canonicalJson → undefined) el hash
  // del objeto re-serializado no coincidiría.
  const roundTripped = JSON.parse(JSON.stringify(base));
  assert.equal(verifyFrozenQ07Protocol(roundTripped).ok, true);
});

test("H3: CANONICAL_SPEC_SHA256 coincide con los bytes reales del doc canónico", () => {
  const bytes = readFileSync(resolve(repoRoot, CANONICAL_SPEC_REF));
  const real = createHash("sha256").update(bytes).digest("hex");
  assert.equal(CANONICAL_SPEC_SHA256, real);
});

test("H3: specSha256 no-hex o no-canónico se rechaza como binding de SPEC", () => {
  const notHex = mutateFrozen(createSyntheticFrozenProtocol(), (protocol) => {
    protocol.specSha256 = "z".repeat(64);
  });
  assert.equal(validateQ07Protocol(notHex).code, "INVALID_SPEC_SHA256");
  const invented = mutateFrozen(createSyntheticFrozenProtocol(), (protocol) => {
    protocol.specSha256 = "0".repeat(64);
  });
  assert.equal(validateQ07Protocol(invented).code, "SPEC_SHA256_NOT_CANONICAL");
});

test("ENDURECIMIENTO_14.9: forma cerrada y valores serializables en el protocolo (fail-closed)", () => {
  const frozen = createSyntheticFrozenProtocol();
  const core = { ...frozen };
  delete core.status;
  delete core.contentHash;
  assert.equal(validateQ07Protocol(core).ok, true);

  // Clave extra a nivel raíz: forma cerrada (§14.9 anti-mutación).
  const extraTopLevel = { ...core, extraKey: "x" };
  assert.equal(validateQ07Protocol(extraTopLevel).code, "UNEXPECTED_PROTOCOL_FIELDS");

  // Funciones en campos del protocolo: canonicalJson las deja caer como
  // undefined y el hash no cubriría su cuerpo; la validación las rechaza.
  const withFunction = { ...core, metrics: [{ metricId: "M", kind: () => "mutado" }] };
  assert.equal(validateQ07Protocol(withFunction).code, "NON_SERIALIZABLE_PROTOCOL_VALUE");

  const nestedFunction = { ...core, candidates: [{ ...core.candidates[0], hour: () => 11 }] };
  assert.equal(validateQ07Protocol(nestedFunction).code, "NON_SERIALIZABLE_PROTOCOL_VALUE");

  // Campos extra en sub-objetos declarados: rechazo (fail-closed).
  const extraMetrics = { ...core, metrics: [{ metricId: "M1", kind: "BOOLEAN", description: "d", extra: 1 }] };
  assert.equal(validateQ07Protocol(extraMetrics).code, "INVALID_METRICS");
  const extraCandidates = {
    ...core,
    candidates: [
      ...core.candidates,
      { hourId: "H_EXTRA", kind: "FIXED_HOUR_AND_MINUTES", hour: 10, extra: 1 },
    ],
  };
  assert.equal(validateQ07Protocol(extraCandidates).code, "INVALID_CANDIDATE");

  // freezeQ07Protocol aplica el mismo guard: no congela nada no serializable.
  assert.equal(freezeQ07Protocol(withFunction).ok, false);
  assert.equal(freezeQ07Protocol(extraTopLevel).ok, false);
});
