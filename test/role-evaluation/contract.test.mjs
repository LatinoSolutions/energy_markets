import { test } from "node:test";
import assert from "node:assert/strict";

import {
  COMPONENT_IDENTITY_FIELDS,
  ROLE_EVALUATION_FIELDS,
  ROLE_HYPOTHESIS_FIELDS,
  missingRoleEvaluationContent,
  validateComponentIdentity,
  validateRoleEvaluation,
} from "../../src/role-evaluation/contract.mjs";
import { makeEvaluation } from "./fixtures.mjs";

test("el contrato materializa los catorce campos semánticos de §11.6.2", () => {
  assert.equal(ROLE_HYPOTHESIS_FIELDS.length, 14);
  assert.deepEqual(
    ROLE_HYPOTHESIS_FIELDS.map((field) => field.specLabel),
    [
      "Exact role being tested",
      "Problem expected to improve",
      "Current comparator / existing mechanism",
      "Value hypothesis",
      "Required inputs",
      "Outputs",
      "Authority requested",
      "Integration boundary",
      "Failure modes",
      "Reproducibility requirements",
      "Cost / latency / operational burden",
      "Overlap assessment",
      "Evidence required for admission",
      "Removal / rollback path",
    ],
  );
  assert.equal(ROLE_EVALUATION_FIELDS.length, COMPONENT_IDENTITY_FIELDS.length + 14);
});

test("la identidad exige componente/rol/protocolo/versión exactos", () => {
  assert.equal(validateComponentIdentity(makeEvaluation()).ok, true);

  const noRole = makeEvaluation();
  delete noRole.roleClass;
  assert.equal(validateComponentIdentity(noRole).ok, false);

  const unknownRole = makeEvaluation({ roleClass: "S6" });
  const unknownRoleOutcome = validateComponentIdentity(unknownRole);
  assert.equal(unknownRoleOutcome.ok, false);
  assert.equal(unknownRoleOutcome.errors[0].code, "INVALID_REQUIRED_CONTENT");

  const noProtocolVersion = makeEvaluation();
  delete noProtocolVersion.protocolVersion;
  assert.equal(validateComponentIdentity(noProtocolVersion).ok, false);

  const badVersion = makeEvaluation({ componentVersion: "not-a-version" });
  assert.equal(validateComponentIdentity(badVersion).ok, false);
});

test("un contrato incompleto se rechaza y lista los campos faltantes", () => {
  const incomplete = makeEvaluation();
  delete incomplete.valueHypothesis;
  delete incomplete.removalRollbackPath;
  const outcome = validateRoleEvaluation(incomplete);
  assert.equal(outcome.ok, false);
  const fields = outcome.errors.map((error) => error.field);
  assert.equal(fields.includes("valueHypothesis"), true);
  assert.equal(fields.includes("removalRollbackPath"), true);
  assert.equal(validateRoleEvaluation(makeEvaluation()).ok, true);
});

test("una lista obligatoria con minItems 0 debe declararse explícitamente", () => {
  const noAuthorityField = makeEvaluation();
  delete noAuthorityField.authorityRequested;
  assert.equal(validateRoleEvaluation(noAuthorityField).ok, false);

  const emptyAuthority = makeEvaluation({ authorityRequested: [] });
  assert.equal(validateRoleEvaluation(emptyAuthority).ok, true);
});

test("coste/latencia/carga preserva el desconocido explícito y no admite omisión", () => {
  assert.equal(validateRoleEvaluation(makeEvaluation()).ok, true);

  const emptyUnknown = makeEvaluation({ costLatencyBurden: { unknown: true } });
  assert.equal(validateRoleEvaluation(emptyUnknown).ok, false);

  const emptyObject = makeEvaluation({ costLatencyBurden: {} });
  assert.equal(validateRoleEvaluation(emptyObject).ok, false);

  const measured = makeEvaluation({ costLatencyBurden: { cost: "SYNTHETIC", latency: "SYNTHETIC" } });
  assert.equal(validateRoleEvaluation(measured).ok, true);
});

test("el camino de retirada/rollback es obligatorio", () => {
  const missing = makeEvaluation();
  delete missing.removalRollbackPath;
  assert.equal(validateRoleEvaluation(missing).ok, false);

  const steps = makeEvaluation({ removalRollbackPath: { steps: ["SYN-step-1"] } });
  assert.equal(validateRoleEvaluation(steps).ok, true);

  const text = makeEvaluation({ removalRollbackPath: "Synthetic rollback path." });
  assert.equal(validateRoleEvaluation(text).ok, true);
});

test("missingRoleEvaluationContent coincide con la validación", () => {
  const incomplete = makeEvaluation();
  delete incomplete.outputs;
  assert.deepEqual(missingRoleEvaluationContent(incomplete), ["outputs"]);
  assert.deepEqual(missingRoleEvaluationContent(makeEvaluation()), []);
});