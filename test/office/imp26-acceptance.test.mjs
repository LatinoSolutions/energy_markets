// Acceptance de ingeniería de IMP-26 contra el criterio de §25.1 (fila IMP-26):
// "Project OFF impide dispatch; falta de REQUIRES* bloquea y RESOLVES/PRODUCES
// propio abierto no; ST accepted no cierra parent; tests y evidencia falsos no
// pasan review; contradicción genera SPEC_CHANGE_REQUEST de rama; READY bajo
// selecciona sólo IMP elegible, sin inventar scope; failover y review
// independiente quedan registrados cuando corresponde." Fixtures sintéticos:
// prueban ingeniería, no disponibilidad factual ni procurement.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { buildCanonicalGraph, getImp } from "../../src/office/canonical-graph.mjs";
import { evaluateEligibility } from "../../src/office/eligibility.mjs";
import { evaluateParentClosure, evaluateSubtaskClosure } from "../../src/office/closure.mjs";
import { REVIEW_VERDICTS, evaluateReviewIndependence, reviewSubtask } from "../../src/office/review.mjs";
import { buildSpecChangeRequest, stopsBranch } from "../../src/office/spec-change-request.mjs";
import { CONTINUATION_ACTIONS, resolveContinuation } from "../../src/office/continuation.mjs";
import { hashSpecBytes, CANONICAL_SPEC_IDENTITY } from "../../src/office/spec-binding.mjs";
import { SPEC_DOC_PATH, packetFor, receiptFor, realGraph } from "./fixtures.mjs";

test("IMP-26: el grafo canónico se vincula al doc v1.1.1 vigente por contenido", () => {
  const outcome = buildCanonicalGraph({ specMarkdown: readFileSync(SPEC_DOC_PATH, "utf8") });
  assert.equal(outcome.ok, true);
  assert.equal(outcome.graph.spec.sha256, CANONICAL_SPEC_IDENTITY.sha256);
  assert.equal(hashSpecBytes(readFileSync(SPEC_DOC_PATH)), CANONICAL_SPEC_IDENTITY.sha256);
  assert.match(getImp(outcome.graph, "IMP-26").acceptanceTest, /Project OFF impide dispatch/);
});

test("IMP-26 acceptance: Project OFF impide dispatch", () => {
  const outcome = resolveContinuation({ graph: realGraph(), projectOn: false, readyCount: 0, threshold: 3 });
  assert.equal(outcome.action, CONTINUATION_ACTIONS.PROJECT_OFF);
  assert.equal(outcome.selected, null);
});

test("IMP-26 acceptance: falta de REQUIRES* bloquea y RESOLVES/PRODUCES propio abierto no", () => {
  const graph = realGraph();
  // IMP-26 exige IMP-01 e IMP-25 accepted; con sólo IMP-01, bloquea.
  const blocked = evaluateEligibility({ graph, impId: "IMP-26", projectOn: true, acceptedInstances: [{ imp: "IMP-01" }] });
  assert.equal(blocked.eligible, false);
  assert.equal(blocked.blockers[0].code, "REQUIRES_MISSING");
  // IMP-03 tiene RESOLVES_AUDIT/PRODUCES_EVIDENCE propios abiertos y no por ello se bloquea.
  const producer = evaluateEligibility({ graph, impId: "IMP-03", projectOn: true, acceptedInstances: [{ imp: "IMP-01" }] });
  assert.equal(producer.eligible, true, JSON.stringify(producer.blockers));
});

test("IMP-26 acceptance: ST accepted no cierra parent", () => {
  const subtask = evaluateSubtaskClosure({ reviewVerdict: REVIEW_VERDICTS.APROBADO, testsRun: ["t"], evidenceProduced: ["e"] });
  assert.equal(subtask.ok, true);
  const parent = evaluateParentClosure({
    requiredSubtaskClosures: [{ subtaskId: "ST-26.1", accepted: true }],
    parentPrerequisitesSatisfied: true,
    realAuditEvidenceSatisfied: true,
    parentAcceptanceTestPassed: false,
    unresolvedSpecConflicts: [],
    frozenDecisionViolations: [],
    impReceipt: null,
  });
  assert.equal(parent.closed, false);
});

test("IMP-26 acceptance: tests y evidencia falsos no pasan review", () => {
  const packet = packetFor("IMP-26");
  const receipt = receiptFor(packet);
  receipt.testsRun = [];
  receipt.testResults = [];
  receipt.evidenceProduced = [];
  const outcome = reviewSubtask({ packet, receipt });
  assert.equal(outcome.verdict, REVIEW_VERDICTS.CAMBIOS);
});

test("IMP-26 acceptance: contradicción genera SPEC_CHANGE_REQUEST de rama", () => {
  const { ok, request } = buildSpecChangeRequest({
    specVersion: "1.1.1",
    impSubtask: "IMP-26 / ST-26.1",
    sourceSections: "§20.2.15",
    exactContradiction: "El runtime vigente no expone el grafo canónico que el contrato exige consumir.",
    observedEvidence: "operations/audit/IMP-25/capability-mapping.md#G5",
    whyNotImplementable: "Falta la representación de elegibilidad en el runtime.",
    minimumChange: "Extender el contrato de handoff con la regla §20.2.4.",
    downstreamImpact: "Dispatch y continuation.",
    workSafelyCompleted: ["auditoría"],
    workBlocked: ["dispatch de IMP-26"],
    requestedAuthority: "architecture/research",
  });
  assert.equal(ok, true);
  assert.equal(stopsBranch(request, "IMP-26"), true);
  assert.equal(stopsBranch(request, "IMP-27"), false);
});

test("IMP-26 acceptance: READY bajo selecciona sólo IMP elegible, sin inventar scope", () => {
  const outcome = resolveContinuation({ graph: realGraph(), projectOn: true, readyCount: 0, threshold: 3, acceptedInstances: [{ imp: "IMP-01" }, { imp: "IMP-25" }], auditSatisfied: ["DEP-27"] });
  assert.equal(outcome.action, CONTINUATION_ACTIONS.SELECT);
  assert.ok(Object.prototype.hasOwnProperty.call(realGraph().imps, outcome.selected.id));
});

test("IMP-26 acceptance: failover y review independiente quedan registrados cuando corresponde", () => {
  const failover = evaluateReviewIndependence({ author: "deepseek", command: "opus", reviewer: "reviewer-2", failover: true });
  assert.equal(failover.ok, true);
  assert.equal(failover.record.failover, true);
  assert.equal(failover.record.command, "opus");
  const selfReview = evaluateReviewIndependence({ author: "deepseek", command: "opus", reviewer: "deepseek" });
  assert.equal(selfReview.ok, false);
  assert.equal(selfReview.code, "REVIEWER_IS_AUTHOR");
});
