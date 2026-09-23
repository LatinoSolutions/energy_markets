import { test } from "node:test";
import assert from "node:assert/strict";

import {
  ROLE_CLASS,
  ROLE_CLASSES,
  ROLE_CLASS_IDS,
  VALUE_DOMAIN,
  canClaimProcurementEdge,
  isRoleClassId,
  resolveRoleClass,
  roleRequiresSeparateAuthorityValidation,
  roleRequiresStrategyAdmissionGate,
  validateValueClaimDomain,
} from "../../src/role-evaluation/roles.mjs";

test("las cuatro clases candidatas de §11.6.1 quedan registradas", () => {
  assert.deepEqual(ROLE_CLASS_IDS, [
    "STRATEGY_EVIDENCE",
    "REPRESENTATION_LEARNING",
    "ENGINEERING_ORCHESTRATION",
    "EXECUTION_GOVERNANCE",
  ]);
  for (const id of ROLE_CLASS_IDS) {
    assert.equal(ROLE_CLASSES[id].section, "§11.6.1");
    assert.equal(typeof ROLE_CLASSES[id].admissionContract, "string");
  }
});

test("no existe un rol por defecto ni S6", () => {
  assert.equal(isRoleClassId("S6"), false);
  assert.equal(isRoleClassId("JEV"), false);
  assert.equal(isRoleClassId(undefined), false);
  const unknown = resolveRoleClass("S6");
  assert.equal(unknown.ok, false);
  assert.equal(unknown.code, "UNKNOWN_ROLE_CLASS");
  assert.deepEqual(unknown.allowedRoleClasses, ROLE_CLASS_IDS);
});

test("sólo Strategy/Evidence exige el gate §8.7 y sólo Execution/Governance la validación separada", () => {
  assert.equal(roleRequiresStrategyAdmissionGate(ROLE_CLASS.STRATEGY_EVIDENCE), true);
  assert.equal(roleRequiresStrategyAdmissionGate(ROLE_CLASS.REPRESENTATION_LEARNING), false);
  assert.equal(roleRequiresSeparateAuthorityValidation(ROLE_CLASS.EXECUTION_GOVERNANCE), true);
  assert.equal(roleRequiresSeparateAuthorityValidation(ROLE_CLASS.ENGINEERING_ORCHESTRATION), false);
});

test("sólo Strategy/Evidence puede reclamar procurement edge", () => {
  assert.equal(canClaimProcurementEdge(ROLE_CLASS.STRATEGY_EVIDENCE), true);
  assert.equal(canClaimProcurementEdge(ROLE_CLASS.ENGINEERING_ORCHESTRATION), false);

  const engineeringEdgeClaim = validateValueClaimDomain(
    ROLE_CLASS.ENGINEERING_ORCHESTRATION,
    VALUE_DOMAIN.PROCUREMENT_EDGE,
  );
  assert.equal(engineeringEdgeClaim.ok, false);
  assert.equal(engineeringEdgeClaim.code, "PROCUREMENT_EDGE_NOT_ALLOWED");

  const operationalClaim = validateValueClaimDomain(
    ROLE_CLASS.ENGINEERING_ORCHESTRATION,
    VALUE_DOMAIN.OPERATIONAL,
  );
  assert.equal(operationalClaim.ok, true);

  const strategyEdgeClaim = validateValueClaimDomain(
    ROLE_CLASS.STRATEGY_EVIDENCE,
    VALUE_DOMAIN.PROCUREMENT_EDGE,
  );
  assert.equal(strategyEdgeClaim.ok, true);
});

test("un dominio de valor desconocido o ausente se rechaza", () => {
  assert.equal(validateValueClaimDomain(ROLE_CLASS.STRATEGY_EVIDENCE, "EDGE").code, "UNKNOWN_VALUE_DOMAIN");
  assert.equal(validateValueClaimDomain(ROLE_CLASS.STRATEGY_EVIDENCE, "").code, "MISSING_VALUE_DOMAIN");
});