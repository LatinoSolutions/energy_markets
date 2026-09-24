// Tests de las guardas MUST NOT CHANGE de §25.1 fila IMP-22.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  assertActionSpaceInvariant,
  assertNoPoolingOrPortfolioAggregation,
  assertControllerIsNotFinalPolicy,
} from "../../src/imp22-sizing/constraints.mjs";
import { DESIGN_IDS, getDesign } from "../../src/imp22-sizing/designs.mjs";
import { deepCloneDesign } from "./fixtures.mjs";

test("pooling y portfolio aggregation están prohibidos por defecto (D18 D5; §23)", () => {
  for (const designId of Object.values(DESIGN_IDS)) {
    const design = getDesign(designId);
    assert.equal(assertNoPoolingOrPortfolioAggregation(design).ok, true, designId);
  }

  const pooled = getDesign(DESIGN_IDS.GAS_MONTHLY);
  pooled.portfolioAggregation = true;
  const pooledResult = assertNoPoolingOrPortfolioAggregation(pooled);
  assert.equal(pooledResult.ok, false);
  assert.ok(pooledResult.errors.some((error) => error.code === "POOLS_ACROSS_MISSIONS"));

  const undeclared = getDesign(DESIGN_IDS.POWER_MONTHLY);
  undeclared.separateEvaluation.byMission = false;
  const undeclaredResult = assertNoPoolingOrPortfolioAggregation(undeclared);
  assert.equal(undeclaredResult.ok, false);
  assert.ok(undeclaredResult.errors.some((error) => error.code === "SEPARATE_EVALUATION_UNDECLARED"));
});

test("action space no cambia sin versión, y nunca en silencio (§4.2; §23)", () => {
  const design = getDesign(DESIGN_IDS.GAS_MONTHLY);
  assert.equal(assertActionSpaceInvariant(design).ok, true, "NONE declarado");

  const silent = deepCloneDesign(design);
  delete silent.identity.actionSpaceVersion;
  const silentResult = assertActionSpaceInvariant(silent);
  assert.equal(silentResult.ok, false);
  assert.ok(silentResult.errors.some((error) => error.code === "ACTION_SPACE_VERSION_REQUIRED"));

  const undeclared = deepCloneDesign(design);
  delete undeclared.actionSpaceModification;
  const undeclaredResult = assertActionSpaceInvariant(undeclared);
  assert.equal(undeclaredResult.ok, false);
  assert.ok(undeclaredResult.errors.some((error) => error.code === "ACTION_SPACE_UNCHANGED_UNDECLARED"));

  const unversionedChange = deepCloneDesign(design);
  unversionedChange.actionSpaceModification = { addedAction: "BUY_PARTIAL_QUANTITY", dedicatedVersion: undefined };
  const changeResult = assertActionSpaceInvariant(unversionedChange);
  assert.equal(changeResult.ok, false);
  assert.ok(changeResult.errors.some((error) => error.code === "ACTION_SPACE_CHANGE_UNVERSIONED"));
});

test("el controller P5.2 compartido no se declara Sizing Policy final (§13.2; DEP-18)", () => {
  const design = getDesign(DESIGN_IDS.POWER_MONTHLY);
  assert.equal(assertControllerIsNotFinalPolicy(design).ok, true);

  const promoted = deepCloneDesign(design);
  promoted.controllerIsFinalSizingPolicy = true;
  const result = assertControllerIsNotFinalPolicy(promoted);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.code === "CONTROLLER_UPDATE_FORBIDDEN"));
});
