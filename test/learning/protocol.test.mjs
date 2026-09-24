// Tests del protocolo de mezcla/cadence (IMP-19, DEP-21). Fuente: SPEC v1.1.1
// §12.3/§11.5/§15.2.

import test from "node:test";
import assert from "node:assert/strict";

import {
  buildLearningProtocol,
  isLearningProtocol,
  assertProtocolFrozenBeforeEvaluation,
} from "../../src/learning/index.mjs";
import { frozenProtocol } from "./fixtures.mjs";

test("IMP-19 §12.3/§11.5 · el protocolo se predeclara y versiona con cadence explícita", () => {
  const outcome = buildLearningProtocol({
    protocolVersion: "dep21-protocol-v1",
    declaredBy: "test-fixture",
    mixtureDeclaration: { declarationVersion: "mix-v1", declaredBy: "test-fixture", weights: { REPLAY: 1, SHADOW: 0, REAL_EXECUTION: 0 } },
    cadence: { reviewTrigger: "campaign_close", trainingTrigger: "window_close" },
  });
  assert.equal(outcome.ok, true);
  assert.equal(isLearningProtocol(outcome.protocol), true);
  assert.equal(outcome.protocol.contentHash.length, 64);
});

test("IMP-19 §12.3 · sin declaración de mezcla no se combinan fuentes", () => {
  const outcome = buildLearningProtocol({
    protocolVersion: "dep21-protocol-v1",
    declaredBy: "test-fixture",
    mixtureDeclaration: null,
    cadence: { reviewTrigger: "campaign_close", trainingTrigger: "window_close" },
  });
  assert.equal(outcome.ok, false);
  assert.ok(outcome.errors.some((error) => error.code === "MISSING_MIXTURE_DECLARATION"));
});

test("IMP-19 §11.5 · la cadence exige triggers de review y training", () => {
  const outcome = buildLearningProtocol({
    protocolVersion: "dep21-protocol-v1",
    declaredBy: "test-fixture",
    mixtureDeclaration: { declarationVersion: "mix-v1", declaredBy: "test-fixture", weights: { REPLAY: 1 } },
    cadence: { reviewTrigger: "campaign_close" },
  });
  assert.equal(outcome.ok, false);
  assert.ok(outcome.errors.some((error) => error.code === "MISSING_TRAINING_TRIGGER"));
});

test("IMP-19 §25.2.3 · el protocolo debe estar FROZEN antes de evaluar", () => {
  const open = buildLearningProtocol({
    protocolVersion: "dep21-protocol-v1",
    declaredBy: "test-fixture",
    mixtureDeclaration: { declarationVersion: "mix-v1", declaredBy: "test-fixture", weights: { REPLAY: 1 } },
    cadence: { reviewTrigger: "campaign_close", trainingTrigger: "window_close" },
    state: "OPEN",
  });
  assert.equal(assertProtocolFrozenBeforeEvaluation({ protocol: open.protocol }).ok, false);
  assert.equal(assertProtocolFrozenBeforeEvaluation({ protocol: open.protocol }).code, "PROTOCOL_NOT_FROZEN");

  const frozen = frozenProtocol();
  assert.equal(assertProtocolFrozenBeforeEvaluation({ protocol: frozen, evaluatedAtUtc: "2026-02-01T00:00:00Z" }).ok, true);
});

test("IMP-19 §12.3/§15.2 · un protocolo alterado o congelado tarde no gobierna", () => {
  const frozen = frozenProtocol();
  const tampered = { ...frozen, cadence: { ...frozen.cadence, reviewTrigger: "otra_cosa" } };
  const mismatch = assertProtocolFrozenBeforeEvaluation({ protocol: tampered });
  assert.equal(mismatch.ok, false);
  assert.equal(mismatch.code, "PROTOCOL_HASH_MISMATCH");

  const late = assertProtocolFrozenBeforeEvaluation({ protocol: frozen, evaluatedAtUtc: "2025-12-31T00:00:00Z" });
  assert.equal(late.ok, false);
  assert.equal(late.code, "PROTOCOL_FROZEN_AFTER_EVALUATION");
});