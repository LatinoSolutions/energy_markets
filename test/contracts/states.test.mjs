import { test } from "node:test";
import assert from "node:assert/strict";

import {
  STATE_NAMESPACES,
  resolveState,
  namespacesForLabel,
  validateStateClaims,
} from "../../src/contracts/states.mjs";

test("DATA_BLOCKED vive a la vez en data_readiness y run_validity", () => {
  assert.equal(resolveState("data_readiness", "DATA_BLOCKED").ok, true);
  assert.equal(resolveState("run_validity", "DATA_BLOCKED").ok, true);
});

test("DATA_BLOCKED no se aplana al namespace de research", () => {
  const outcome = resolveState("research_verdict", "DATA_BLOCKED");
  assert.equal(outcome.ok, false);
  assert.equal(outcome.code, "UNKNOWN_STATE_VALUE");
  assert.deepEqual(outcome.allowedValues, ["PASS", "HOLD", "FAIL", "INVALID"]);
});

test("HOLD conserva su ámbito de research", () => {
  assert.equal(resolveState("research_verdict", "HOLD").ok, true);
  assert.equal(resolveState("run_validity", "HOLD").ok, false);
});

test("concept_maturity tiene exactamente los seis estados de §0.3", () => {
  const declared = STATE_NAMESPACES.concept_maturity.values;
  assert.deepEqual(declared, [
    "CANONICAL_FROZEN",
    "IMPLEMENTATION_READY",
    "AUDIT_DEPENDENT",
    "EVIDENCE_DEPENDENT",
    "BLOCKED",
    "OPEN_DECISION",
  ]);
});

test("OUT_OF_CURRENT_SCOPE no es un séptimo estado de madurez", () => {
  const asMaturity = resolveState("concept_maturity", "OUT_OF_CURRENT_SCOPE");
  assert.equal(asMaturity.ok, false);
  assert.equal(asMaturity.code, "UNKNOWN_STATE_VALUE");
  assert.equal(resolveState("scope_classification", "OUT_OF_CURRENT_SCOPE").ok, true);
});

test("IMPLEMENTATION_DETAIL no es un séptimo estado de madurez", () => {
  const asMaturity = resolveState("concept_maturity", "IMPLEMENTATION_DETAIL");
  assert.equal(asMaturity.ok, false);
  assert.equal(asMaturity.code, "UNKNOWN_STATE_VALUE");
  assert.equal(resolveState("materialization_classification", "IMPLEMENTATION_DETAIL").ok, true);
});

test("governance_event usa exactamente PROMOTE/HOLD/DEMOTE/HALT/ROLLBACK", () => {
  for (const value of ["PROMOTE", "HOLD", "DEMOTE", "HALT", "ROLLBACK"]) {
    assert.equal(resolveState("governance_event", value).ok, true);
  }
});

test("governance_event rechaza nombres no canónicos", () => {
  for (const value of ["ACTIVATION", "PROMOTION", "DEMOTION"]) {
    const outcome = resolveState("governance_event", value);
    assert.equal(outcome.ok, false);
    assert.equal(outcome.code, "UNKNOWN_STATE_VALUE");
  }
});

test("HOLD también vive en admisión por rol y governance", () => {
  assert.equal(resolveState("role_admission", "HOLD").ok, true);
  assert.equal(resolveState("governance_event", "HOLD").ok, true);
});

test("namespacesForLabel lista los ámbitos de un label compartido", () => {
  const namespaces = namespacesForLabel("DATA_BLOCKED").map((entry) => entry.namespace).sort();
  assert.deepEqual(namespaces, ["data_readiness", "run_validity"]);
});

test("un namespace desconocido se rechaza", () => {
  const outcome = resolveState("madurez", "CANONICAL_FROZEN");
  assert.equal(outcome.ok, false);
  assert.equal(outcome.code, "UNKNOWN_STATE_NAMESPACE");
  assert.ok(outcome.allowedNamespaces.includes("concept_maturity"));
});

test("un valor fuera del namespace se rechaza y lista los permitidos", () => {
  const outcome = resolveState("concept_maturity", "READY");
  assert.equal(outcome.ok, false);
  assert.equal(outcome.code, "UNKNOWN_STATE_VALUE");
  assert.ok(outcome.allowedValues.includes("IMPLEMENTATION_READY"));
});

test("un claim sin namespace se rechaza", () => {
  const outcome = validateStateClaims([{ value: "HOLD" }]);
  assert.equal(outcome.ok, false);
  assert.equal(outcome.errors[0].code, "UNKNOWN_STATE_NAMESPACE");
});

test("los estados canónicos de §0.3 y §14.10 quedan separados", () => {
  const maturity = resolveState("concept_maturity", "CANONICAL_FROZEN");
  const run = resolveState("run_validity", "VALID_RUN");
  const receipt = resolveState("receipt_kind", "IMP_RECEIPT");
  assert.equal(maturity.canonicalId, "concept_maturity:CANONICAL_FROZEN");
  assert.equal(run.canonicalId, "run_validity:VALID_RUN");
  assert.equal(receipt.canonicalId, "receipt_kind:IMP_RECEIPT");
});