import { test } from "node:test";
import assert from "node:assert/strict";

import { evaluateParentClosure, evaluateSubtaskClosure } from "../../src/office/closure.mjs";
import { REVIEW_VERDICTS } from "../../src/office/review.mjs";
import { CANONICAL_SPEC_IDENTITY } from "../../src/office/spec-binding.mjs";

function validImpReceipt() {
  return {
    specIdentity: { ...CANONICAL_SPEC_IDENTITY },
    impIdentity: "IMP-26",
    scope: "SPEC/IMP/scope/version del binding",
    outcome: "accepted",
    requiredStIdentities: ["ST-26.1", "ST-26.2"],
    reviewerRunIdentities: ["review-1"],
    evidenceTestHashes: ["sha256:deadbeef"],
    prerequisiteChecks: ["IMP-01 accepted", "IMP-25 accepted"],
    unresolvedLimits: [],
    version: { contentHash: "c".repeat(64) },
  };
}

function closedConditions(overrides = {}) {
  return {
    requiredSubtaskClosures: [{ subtaskId: "ST-26.1", accepted: true }, { subtaskId: "ST-26.2", accepted: true }],
    parentPrerequisitesSatisfied: true,
    realAuditEvidenceSatisfied: true,
    parentAcceptanceTestPassed: true,
    unresolvedSpecConflicts: [],
    frozenDecisionViolations: [],
    impReceipt: validImpReceipt(),
    ...overrides,
  };
}

test("ST accepted ≠ IMP accepted: la aceptación del hijo no cierra el parent (§20.2.10)", () => {
  const subtask = evaluateSubtaskClosure({ reviewVerdict: REVIEW_VERDICTS.APROBADO, testsRun: ["t"], evidenceProduced: ["e"] });
  assert.equal(subtask.ok, true);
  assert.equal(subtask.code, "ST_ACCEPTED");

  const parent = evaluateParentClosure(closedConditions({ parentAcceptanceTestPassed: false }));
  assert.equal(parent.ok, false);
  assert.equal(parent.closed, false);
  assert.ok(parent.failures.some((failure) => failure.code === "PARENT_ACCEPTANCE_FAILED"));
});

test("el parent sólo cierra con todas las condiciones de §20.2.10 y produce el IMP_RECEIPT", () => {
  const parent = evaluateParentClosure(closedConditions());
  assert.equal(parent.ok, true, JSON.stringify(parent.failures));
  assert.equal(parent.closed, true);
  assert.equal(parent.receipt.impIdentity, "IMP-26");
});

test("subtareas no aceptadas, prerequisitos caídos, audit/evidence pendiente o conflicto SPEC impiden el cierre", () => {
  assert.ok(evaluateParentClosure(closedConditions({ requiredSubtaskClosures: [{ subtaskId: "ST-26.1", accepted: false }] })).failures.some((failure) => failure.code === "SUBTASKS_NOT_ACCEPTED"));
  assert.ok(evaluateParentClosure(closedConditions({ parentPrerequisitesSatisfied: false })).failures.some((failure) => failure.code === "PREREQUISITES_UNSATISFIED"));
  assert.ok(evaluateParentClosure(closedConditions({ realAuditEvidenceSatisfied: false })).failures.some((failure) => failure.code === "AUDIT_EVIDENCE_UNSATISFIED"));
  assert.ok(evaluateParentClosure(closedConditions({ unresolvedSpecConflicts: ["SCR-1"] })).failures.some((failure) => failure.code === "SPEC_CONFLICT_OPEN"));
  assert.ok(evaluateParentClosure(closedConditions({ frozenDecisionViolations: ["benchmark"] })).failures.some((failure) => failure.code === "FROZEN_DECISION_VIOLATED"));
});

test("sin IMP_RECEIPT válido no hay cierre trazable (fail-closed)", () => {
  const noReceipt = evaluateParentClosure(closedConditions({ impReceipt: null }));
  assert.equal(noReceipt.closed, false);
  assert.ok(noReceipt.failures.some((failure) => failure.code === "IMP_RECEIPT_INVALID"));

  const invalid = validImpReceipt();
  delete invalid.specIdentity;
  const badReceipt = evaluateParentClosure(closedConditions({ impReceipt: invalid }));
  assert.equal(badReceipt.closed, false);
  assert.ok(badReceipt.failures.some((failure) => failure.code === "IMP_RECEIPT_INVALID"));
});
