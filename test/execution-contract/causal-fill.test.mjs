import { test } from "node:test";
import assert from "node:assert/strict";

import {
  createGasQuarterlyExecutionContract,
  deriveSimulatedFillPrice,
  selectEligibleReference,
  toEpochMs,
  validateCausalFill,
} from "../../src/execution-contract/index.mjs";

const DECISION = "2026-01-15T11:00:00+01:00";

test("la referencia elegible es la última observación at-or-before la frontera", () => {
  const outcome = selectEligibleReference({
    observations: [
      { timestamp: "2026-01-15T09:30:00+01:00", bestAsk: 38.0 },
      { timestamp: "2026-01-15T10:30:00+01:00", bestAsk: 39.0 },
      { timestamp: DECISION, bestAsk: 40.0 },
    ],
    decisionTime: DECISION,
  });
  assert.equal(outcome.ok, true);
  assert.equal(outcome.reference.timestamp, DECISION);
  assert.equal(outcome.reference.bestAsk, 40.0);
});

test("una observación futura nunca es elegible", () => {
  const outcome = selectEligibleReference({
    observations: [
      { timestamp: "2026-01-15T10:30:00+01:00", bestAsk: 39.0 },
      { timestamp: "2026-01-15T11:30:00+01:00", bestAsk: 30.0 },
    ],
    decisionTime: DECISION,
  });
  assert.equal(outcome.ok, true);
  assert.equal(outcome.reference.bestAsk, 39.0);
});

test("sin observación at-or-before la frontera no hay referencia", () => {
  const outcome = selectEligibleReference({
    observations: [{ timestamp: "2026-01-15T11:30:00+01:00", bestAsk: 39.0 }],
    decisionTime: DECISION,
  });
  assert.equal(outcome.ok, false);
  assert.equal(outcome.code, "NO_ELIGIBLE_REFERENCE");
});

test("un empate de timestamp con precios distintos es ambiguo", () => {
  const outcome = selectEligibleReference({
    observations: [
      { timestamp: "2026-01-15T10:30:00+01:00", bestAsk: 39.0 },
      { timestamp: "2026-01-15T10:30:00+01:00", bestAsk: 39.5 },
    ],
    decisionTime: DECISION,
  });
  assert.equal(outcome.ok, false);
  assert.equal(outcome.code, "AMBIGUOUS_REFERENCE");
});

test("una frontera de decisión no parseable se rechaza", () => {
  const outcome = selectEligibleReference({ observations: [], decisionTime: "no-es-fecha" });
  assert.equal(outcome.ok, false);
  assert.equal(outcome.code, "INVALID_DECISION_TIME");
});

test("el precio simulado es best ask + slippage en la misma unidad", () => {
  const derived = deriveSimulatedFillPrice({ referenceBestAsk: 40.0, slippage: 0.15 });
  assert.equal(derived.ok, true);
  assert.equal(derived.price, 40.15);
});

test("unidades incompatibles no se convierten por suposición", () => {
  const derived = deriveSimulatedFillPrice({ referenceBestAsk: 40.0, slippage: 0.15, referenceUnit: "EUR/MWh", slippageUnit: "EUR/MW" });
  assert.equal(derived.ok, false);
  assert.equal(derived.price, null);
});

test("un fill causal válido pasa la validación", () => {
  const contract = createGasQuarterlyExecutionContract();
  const fill = {
    requestId: "REQ-1",
    decisionTime: DECISION,
    referenceObservation: { timestamp: "2026-01-15T10:30:00+01:00", bestAsk: 40.0 },
    executionPrice: 40.15,
  };
  const outcome = validateCausalFill({ fill, contract });
  assert.equal(outcome.ok, true);
  assert.deepEqual(outcome.errors, []);
});

test("un fill con precio futuro se rechaza", () => {
  const contract = createGasQuarterlyExecutionContract();
  const fill = {
    requestId: "REQ-2",
    decisionTime: DECISION,
    referenceObservation: { timestamp: "2026-01-15T11:30:00+01:00", bestAsk: 40.0 },
    executionPrice: 40.15,
  };
  const outcome = validateCausalFill({ fill, contract });
  assert.equal(outcome.ok, false);
  assert.ok(outcome.errors.some((error) => error.code === "FUTURE_PRICE_SELECTED"));
});

test("elegir retrospectivamente una observación no-latest se rechaza", () => {
  const contract = createGasQuarterlyExecutionContract();
  const fill = {
    requestId: "REQ-3",
    decisionTime: DECISION,
    referenceObservation: { timestamp: "2026-01-15T10:00:00+01:00", bestAsk: 39.0 },
    executionPrice: 39.15,
    candidateObservations: [
      { timestamp: "2026-01-15T10:00:00+01:00", bestAsk: 39.0 },
      { timestamp: "2026-01-15T10:30:00+01:00", bestAsk: 40.0 },
    ],
  };
  const outcome = validateCausalFill({ fill, contract });
  assert.equal(outcome.ok, false);
  assert.ok(outcome.errors.some((error) => error.code === "RETROSPECTIVE_SELECTION"));
});

test("un precio que no sale de la regla frozen se rechaza", () => {
  const contract = createGasQuarterlyExecutionContract();
  const fill = {
    requestId: "REQ-4",
    decisionTime: DECISION,
    referenceObservation: { timestamp: "2026-01-15T10:30:00+01:00", bestAsk: 40.0 },
    executionPrice: 40.0,
  };
  const outcome = validateCausalFill({ fill, contract });
  assert.equal(outcome.ok, false);
  assert.ok(outcome.errors.some((error) => error.code === "PRICE_NOT_DERIVED_FROM_RULE"));
});

test("un fill sin observación de precio disponible se rechaza", () => {
  const contract = createGasQuarterlyExecutionContract();
  const fill = { requestId: "REQ-5", decisionTime: DECISION, executionPrice: 40.15 };
  const outcome = validateCausalFill({ fill, contract });
  assert.equal(outcome.ok, false);
  assert.ok(outcome.errors.some((error) => error.code === "MISSING_ELIGIBLE_REFERENCE"));
});

test("toEpochMs rechaza valores no parseables", () => {
  assert.equal(toEpochMs("2026-01-15T11:00:00+01:00") !== null, true);
  assert.equal(toEpochMs(""), null);
  assert.equal(toEpochMs(undefined), null);
});
