// Tests de las restricciones duras (MUST NOT CHANGE §25.1 fila IMP-20).

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  assertLayersAreRegisteredAndFrozen,
  assertNoAutomaticAuthority,
  assertNoMandatory23Drivers,
  assertNoP5Ampliation,
} from "../../src/imp20-experiments/constraints.mjs";
import { getLayer } from "../../src/imp20-experiments/layers.mjs";
import { EXPERIMENT_DESIGNS } from "../../src/imp20-experiments/designs.mjs";
import { baseDesign, designWithDrivers, designWithZ } from "./fixtures.mjs";

test("los diseños aceptados declaran la no-ampliación completa de P5", () => {
  for (const design of EXPERIMENT_DESIGNS) {
    const result = assertNoP5Ampliation(design);
    assert.equal(result.ok, true, design.identity.experimentId);
  }
});

test("un diseño que rescata/modifica P5 se rechaza (§13.9 no rescue)", () => {
  const design = baseDesign();
  design.rescueLayer = true;
  const result = assertNoP5Ampliation(design);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.code === "P5_AMPLIATION_DECLARED"));

  const missing = baseDesign();
  delete missing.nonAmpliation.s1Identity;
  const missingResult = assertNoP5Ampliation(missing);
  assert.equal(missingResult.ok, false);
  assert.ok(missingResult.errors.some((error) => error.code === "P5_AMPLIATION_UNDECLARED"));
});

test("el experimento de drivers es por muestra: sin 23 features obligatorias y con taxonomía cerrada (§7.2/§7.2.5)", () => {
  const drivers = designWithDrivers();
  const layer = drivers.layers[0];
  assert.equal(layer.mandatoryFeatures, false);
  assert.equal(layer.taxonomyClosed, true);
  assert.equal(assertNoMandatory23Drivers(drivers).ok, true);

  const forced = designWithDrivers();
  forced.layers[0].mandatoryFeatures = true;
  const forcedResult = assertNoMandatory23Drivers(forced);
  assert.equal(forcedResult.ok, false);
  assert.ok(forcedResult.errors.some((error) => error.code === "MANDATORY_23_FEATURES"));
});

test("ningún diseño concede admisión ni autoridad automática, ni segundo reward (§10.1/§8.7.4/§16–18)", () => {
  for (const design of EXPERIMENT_DESIGNS) {
    const result = assertNoAutomaticAuthority(design);
    assert.equal(result.ok, true, design.identity.experimentId);
  }

  const claiming = designWithZ();
  claiming.layers[0].autoAdmission = true;
  assert.ok(assertNoAutomaticAuthority(claiming).errors.some((error) => error.code === "AUTO_AUTHORITY_CLAIMED"));

  const secondReward = baseDesign();
  secondReward.layers[0].ownEconomicReward = true;
  assert.ok(assertNoAutomaticAuthority(secondReward).errors.some((error) => error.code === "SECOND_REWARD"));

  const metaPolicy = baseDesign();
  metaPolicy.topology = "HYBRID_GLOBAL_META_POLICY";
  const metaResult = assertNoAutomaticAuthority(metaPolicy);
  assert.equal(metaResult.ok, false);
  assert.ok(metaResult.errors.some((error) => error.code === "AUTOMATIC_META_POLICY"));

  metaPolicy.topologyResearchOnly = true;
  assert.equal(assertNoAutomaticAuthority(metaPolicy).ok, true, "la topología híbrida es candidata de research sin activación automática");
});

test("la semántica frozen de cada capa del diseño coincide con el catálogo; ediciones se rechazan", () => {
  const edited = baseDesign();
  edited.layers[0].frozenSemantics = "S2 con preferencia de compra ante shock al alza (inventada)";
  const result = assertLayersAreRegisteredAndFrozen(edited);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.code === "FROZEN_SEMANTICS_EDITED"));

  const unknownLayer = baseDesign();
  unknownLayer.layers[0].layerId = "S6";
  assert.ok(assertLayersAreRegisteredAndFrozen(unknownLayer).errors.some((error) => error.code === "UNKNOWN_LAYER"));
});

test("ninguna capa del catálogo declara parámetros económicos (§8: parameters son de instanciación, no de reward)", () => {
  for (const layerId of ["S2", "S3", "S4", "S5", "Z", "DRIVERS"]) {
    const layer = getLayer(layerId);
    assert.ok(layer && layer.frozenQuestion.length > 0);
    assert.ok(!/"reward"/i.test(layer.whatMustBeInstantiated || ""));
  }
});
