// Tests del reward global (IMP-19, DEP-19). Fuente: SPEC v1.1.1 §10.1/§10.2/
// §10.3 y §25.1 fila IMP-19 ("reward global").

import test from "node:test";
import assert from "node:assert/strict";

import {
  GLOBAL_REWARD_ID,
  assertSingleGlobalReward,
  validateRewardConfiguration,
  evaluateReward,
  contributionOf,
} from "../../src/learning/index.mjs";
import { frozenRewardConfig, openRewardConfig } from "./fixtures.mjs";

test("IMP-19 §10.1 · existe un único reward global anclado a V=B-H", () => {
  assert.equal(assertSingleGlobalReward({ rewardId: GLOBAL_REWARD_ID, anchoredToProcurementValue: true, localRewards: [] }).ok, true);
});

test("IMP-19 §10.1/§10.2 · reward local o por Strategy se rechaza fail-closed", () => {
  const local = assertSingleGlobalReward({ rewardId: GLOBAL_REWARD_ID, anchoredToProcurementValue: true, localRewards: [{ strategy: "S1", reward: "accuracy" }] });
  assert.equal(local.ok, false);
  assert.ok(local.errors.some((error) => error.code === "LOCAL_REWARD_FORBIDDEN"));

  const perStrategy = assertSingleGlobalReward({ rewardId: GLOBAL_REWARD_ID, anchoredToProcurementValue: true, localRewards: [], perStrategyReward: true });
  assert.equal(perStrategy.ok, false);
  assert.ok(perStrategy.errors.some((error) => error.code === "PER_STRATEGY_REWARD_FORBIDDEN"));
});

test("IMP-19 §10.3 · doble conteo de costes en el reward se rechaza (entran en H una vez)", () => {
  const outcome = assertSingleGlobalReward({ rewardId: GLOBAL_REWARD_ID, anchoredToProcurementValue: true, localRewards: [], costsReenteredInReward: true });
  assert.equal(outcome.ok, false);
  assert.ok(outcome.errors.some((error) => error.code === "DOUBLE_COST_FORBIDDEN"));
});

test("IMP-19 §10.1/§25.2.3 · una configuración OPEN no puede portar parámetros inventados", () => {
  const noParams = validateRewardConfiguration(openRewardConfig());
  assert.equal(noParams.ok, true);
  const invented = validateRewardConfiguration(openRewardConfig({ transform: { kind: "AFFINE", scale: 2, offset: 1 } }));
  assert.equal(invented.ok, false);
  assert.ok(invented.errors.some((error) => error.code === "INVENTED_REWARD_PARAMS"));
});

test("IMP-19 §10.1 · una normalización declarada debe preservar el orden económico", () => {
  const preserving = validateRewardConfiguration(frozenRewardConfig({
    transform: {
      kind: "DECLARED",
      transformVersion: "g-v1",
      justification: "normalización monótona sobre distribuciones observadas",
      distributionEvidenceRef: "dist-ref-1",
      orderPreservation: [{ V: -10, R: -1 }, { V: 0, R: 0 }, { V: 10, R: 1 }],
    },
  }));
  assert.equal(preserving.ok, true);

  const inverting = validateRewardConfiguration(frozenRewardConfig({
    transform: {
      kind: "DECLARED",
      transformVersion: "g-bad",
      justification: "invierte el orden (mal)",
      distributionEvidenceRef: "dist-ref-2",
      orderPreservation: [{ V: -10, R: 1 }, { V: 10, R: -1 }],
    },
  }));
  assert.equal(inverting.ok, false);
  assert.ok(inverting.errors.some((error) => error.code === "ORDER_NOT_PRESERVED"));
});

test("IMP-19 §10.1 · g(V)=V es el candidato identidad y calcula R=V=B-H", () => {
  const outcome = evaluateReward({ B: 100, H: 92, config: frozenRewardConfig() });
  assert.equal(outcome.ok, true);
  assert.equal(outcome.V, 8);
  assert.equal(outcome.R, 8);
  assert.equal(outcome.transformKind, "IDENTITY");
});

test("IMP-19 §25.2.3 · una configuración OPEN no puntúa una candidate concreta", () => {
  const outcome = evaluateReward({ B: 100, H: 92, config: openRewardConfig() });
  assert.equal(outcome.ok, false);
  assert.equal(outcome.status, "HOLD");
  assert.equal(outcome.code, "REWARD_CONFIG_NOT_FROZEN");
});

test("IMP-19 §10.1 · una transformación declarada no interpola fuera de su evidencia", () => {
  const config = frozenRewardConfig({
    transform: {
      kind: "DECLARED",
      transformVersion: "g-v1",
      justification: "monótona",
      distributionEvidenceRef: "dist-ref-1",
      orderPreservation: [{ V: 0, R: 0 }, { V: 10, R: 2 }],
    },
  });
  const inRange = evaluateReward({ B: 10, H: 0, config });
  assert.equal(inRange.ok, true);
  assert.equal(inRange.R, 2);
  const outOfRange = evaluateReward({ B: 5, H: 0, config });
  assert.equal(outOfRange.ok, false);
  assert.equal(outOfRange.code, "REWARD_TRANSFORM_OUT_OF_EVIDENCE");
});

test("IMP-19 §10.2 · la contribución se deriva del mismo reward global", () => {
  const outcome = contributionOf({ R_full: 8, R_without_i: 5 });
  assert.equal(outcome.ok, true);
  assert.equal(outcome.contribution, 3);
  assert.equal(contributionOf({ R_full: null, R_without_i: 5 }).ok, false);
});