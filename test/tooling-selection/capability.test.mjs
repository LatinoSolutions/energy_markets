import { test } from "node:test";
import assert from "node:assert/strict";

import {
  IP_EXPOSURE,
  RIGHTS_STATUS,
  evaluateCapabilityCoverage,
  isCapabilityAssessmentUsable,
  validateCapabilityAssessment,
} from "../../src/tooling-selection/capability.mjs";
import { makeAssessment } from "./fixtures.mjs";

test("un capability assessment completo es válido", () => {
  assert.equal(validateCapabilityAssessment(makeAssessment()).ok, true);
});

test("la ausencia de cualquier campo obligatorio del assessment se rechaza", () => {
  for (const field of [
    "componentId",
    "componentVersion",
    "role",
    "interfaceContract",
    "declaredCapabilities",
    "usageRights",
    "ipExposure",
    "minimallyExtendable",
    "limitations",
    "evidenceRefs",
  ]) {
    const assessment = makeAssessment();
    delete assessment[field];
    const outcome = validateCapabilityAssessment(assessment);
    assert.equal(outcome.ok, false, field);
    assert.ok(
      outcome.errors.some((error) => error.field === field || error.field?.startsWith(`${field}.`)),
      `${field}: ${JSON.stringify(outcome.errors)}`,
    );
  }
});

test("un contrato de interfaces sin inputs u outputs reales se rechaza", () => {
  assert.equal(validateCapabilityAssessment(makeAssessment({ interfaceContract: { inputs: [], outputs: ["x"] } })).ok, false);
  assert.equal(validateCapabilityAssessment(makeAssessment({ interfaceContract: { inputs: ["x"] } })).ok, false);
});

test("datos legibles no prueban derechos: unknown/denied no es usable", () => {
  for (const status of [RIGHTS_STATUS.DENIED, RIGHTS_STATUS.UNKNOWN]) {
    const assessment = makeAssessment({ usageRights: { status, evidenceRef: "SYN-RIGHTS-1" } });
    assert.equal(validateCapabilityAssessment(assessment).ok, true, `status ${status} sigue siendo declarable`);
    assert.equal(isCapabilityAssessmentUsable(assessment).usable, false, status);
  }
});

test("un usageRights sin evidencia se rechaza", () => {
  const assessment = makeAssessment({ usageRights: { status: RIGHTS_STATUS.PERMITTED } });
  const outcome = validateCapabilityAssessment(assessment);
  assert.equal(outcome.ok, false);
  assert.ok(outcome.errors.some((error) => error.field === "usageRights.evidenceRef"));
});

test("no exposure de IP implícita: implicit/unknown no habilitan uso", () => {
  for (const assessment of [IP_EXPOSURE.IMPLICIT, IP_EXPOSURE.UNKNOWN]) {
    const candidate = makeAssessment({ ipExposure: { assessment, rationale: "Synthetic." } });
    assert.equal(isCapabilityAssessmentUsable(candidate).usable, false, assessment);
  }
  const safe = makeAssessment();
  assert.equal(isCapabilityAssessmentUsable(safe).usable, true);
});

test("la cobertura es una operación de conjuntos contra lo requerido", () => {
  const assessment = makeAssessment();
  const coverage = evaluateCapabilityCoverage(assessment, ["benchmark.calculate", "reference.proxy", "intraday.audit"]);
  assert.deepEqual(coverage.covered, ["benchmark.calculate", "reference.proxy"]);
  assert.deepEqual(coverage.missing, ["intraday.audit"]);
  assert.equal(coverage.sufficient, false);

  const full = evaluateCapabilityCoverage(assessment, ["benchmark.calculate"]);
  assert.equal(full.sufficient, true);
});

test("capabilityOutputs sólo puede ligar capacidades a salidas de la interfaz", () => {
  const assessment = makeAssessment({
    interfaceContract: {
      inputs: ["SYN-input-price"],
      outputs: ["SYN-output-B"],
      capabilityOutputs: { "benchmark.calculate": ["SYN-output-X"] },
    },
  });
  const outcome = validateCapabilityAssessment(assessment);
  assert.equal(outcome.ok, false);
  assert.ok(outcome.errors.some((error) => error.code === "CAPABILITY_OUTPUT_NOT_IN_INTERFACE"));
  const empty = makeAssessment({
    interfaceContract: { inputs: ["SYN-input-price"], outputs: ["SYN-output-B"], capabilityOutputs: { "benchmark.calculate": [] } },
  });
  assert.ok(validateCapabilityAssessment(empty).errors.some((error) => error.code === "INVALID_CAPABILITY_OUTPUTS"));
});
