// Tests de atribución timing vs tamaño y de paridad de brazos (§13.7; §13.9).

import { test } from "node:test";
import assert from "node:assert/strict";

import { attributeTimingVsetSize, validateArmParity, ATTRIBUTION_ARMS } from "../../src/imp22-sizing/attribution.mjs";

function armValues(values) {
  return {
    baseline: values.baseline,
    timingOnly: values.timingOnly,
    sizingOnly: values.sizingOnly,
    timingAndSizing: values.timingAndSizing,
  };
}

test("la atribución descompone Delta V en componentes timing y sizing (§13.7)", () => {
  // Fixtures puramente aritméticos; V aquí son unidades de EUR/MWh synthetic.
  const result = attributeTimingVsetSize(armValues({
    baseline: 10,
    timingOnly: 12,      // +2 por timing
    sizingOnly: 11,      // +1 por sizing bajo calendar
    timingAndSizing: 14, // +4 total
  }));

  assert.equal(result.computable, true);
  assert.equal(result.status, "COMPUTED");
  assert.equal(result.totalDeltaQ, 4);
  assert.equal(result.timingComponent, 2);
  assert.equal(result.sizingComponentAtBaseline, 1);
  assert.equal(result.sizingComponentUnderTiming, 2);
  assert.equal(result.timingComponentUnderSizing, 3);
  assert.equal(typeof result.interactionResidue, "number");
});

test("brazos ausentes o no finitos quedan HOLD sin inventar componentes (§13.7 HOLD)", () => {
  const missingArm = attributeTimingVsetSize({ baseline: 10, timingOnly: 12, sizingOnly: 9 });
  assert.equal(missingArm.computable, false);
  assert.equal(missingArm.status, "HOLD");
  assert.deepEqual(missingArm.missingArms, ["timingAndSizing"]);

  const nanArm = attributeTimingVsetSize(armValues({ baseline: NaN, timingOnly: 1, sizingOnly: 1, timingAndSizing: 1 }));
  assert.equal(nanArm.computable, false);
  assert.equal(nanArm.status, "HOLD");
});

test("paridad de brazos: campos compartidos ausentes o divergentes invalidan la comparación (§13.6/§13.9)", () => {
  const parity = {
    obligationId: "OB-1",
    deadline: "2026-12-31",
    opportunitiesSchedule: "SCHED-V1",
    executionContractVersion: "EXEC-V1",
    benchmarkBVersion: "B-V1",
    costLedgerVersion: "COST-V1",
    splitVersion: "SPLIT-V1",
  };
  const arms = {};
  for (const armName of ATTRIBUTION_ARMS) {
    arms[armName] = { ...parity, sizingRole: armName === "baseline" ? "controller" : "candidate" };
  }
  const okResult = validateArmParity(arms);
  assert.equal(okResult.ok, true, JSON.stringify(okResult.errors));

  const drifting = structuredClone(arms);
  drifting.timingOnly.executionContractVersion = "EXEC-V2";
  const driftResult = validateArmParity(drifting);
  assert.equal(driftResult.ok, false);
  // La paridad execution/cost la decide el contrato aceptado del IMP-07:
  // el verifier delegado reporta la violación por brazo (HALLAZGO_TECNICO IMP22-H6).
  assert.ok(driftResult.errors.some((error) => error.code === "PARITY_VIOLATION" && error.field === "arms.timingOnly.executionContractVersion"));

  const missingField = structuredClone(arms);
  delete missingField.sizingOnly.benchmarkBVersion;
  const missingResult = validateArmParity(missingField);
  assert.equal(missingResult.ok, false);
  assert.ok(missingResult.errors.some((error) => error.code === "PARITY_FIELD_REQUIRED"));
});
