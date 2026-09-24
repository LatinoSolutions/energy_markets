// Tests protocolo Q07 predeclarado y frozen (IMP-21).
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  validateQ07Protocol,
  verifyFrozenQ07Protocol,
  assertNoDocumentedHourPresupposition,
  Q07_PROTOCOL_ID,
} from "../../src/imp21-q07/index.mjs";
import { createSyntheticFrozenProtocol, mutateFrozen } from "./fixtures.mjs";

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
