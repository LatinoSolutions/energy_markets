import { test } from "node:test";
import assert from "node:assert/strict";

import {
  ADMISSION_AUTHORITY,
  MILESTONE_SEQUENCE,
  RESEARCH_VERDICT_NAMESPACE,
  STRATEGY_ADMISSION_NAMESPACE,
  STRATEGY_LIFECYCLE_NAMESPACE,
  canTransition,
  namespacesClaimingLabel,
  nextLifecycleStages,
  resolveAdmissionFromVerdict,
  resolveAdmissionStatus,
  resolveMilestoneStatus,
  validateExperimentReadiness,
} from "../../src/strategy-admission/lifecycle.mjs";

test("la secuencia de hitos de §8.7.3 conserva namespaces separados", () => {
  const namespaces = MILESTONE_SEQUENCE.map((entry) => entry.namespace);
  assert.deepEqual(namespaces, [
    STRATEGY_LIFECYCLE_NAMESPACE,
    STRATEGY_LIFECYCLE_NAMESPACE,
    STRATEGY_LIFECYCLE_NAMESPACE,
    STRATEGY_LIFECYCLE_NAMESPACE,
    RESEARCH_VERDICT_NAMESPACE,
    STRATEGY_ADMISSION_NAMESPACE,
  ]);
});

test("PASS vive en research_verdict y no se aplana con lifecycle ni admisión", () => {
  const claiming = namespacesClaimingLabel("PASS");
  assert.equal(claiming.length, 1);
  assert.equal(claiming[0].namespace, RESEARCH_VERDICT_NAMESPACE);

  const milestone = resolveMilestoneStatus(RESEARCH_VERDICT_NAMESPACE, "PASS");
  assert.equal(milestone.ok, true);
  assert.equal(milestone.canonicalId, "research_verdict:PASS");

  assert.equal(resolveAdmissionStatus(RESEARCH_VERDICT_NAMESPACE, "PASS").ok, false);
});

test("DATA_BLOCKED conserva sus dos ámbitos y exige namespace explícito", () => {
  const claiming = namespacesClaimingLabel("DATA_BLOCKED");
  assert.ok(claiming.length >= 2);
  assert.ok(claiming.some((entry) => entry.namespace === "data_readiness"));
  assert.ok(claiming.some((entry) => entry.namespace === "run_validity"));
});

test("las transiciones de lifecycle son deterministas y no saltan hitos", () => {
  assert.deepEqual(nextLifecycleStages("PROPOSED"), ["FORMALIZED"]);
  assert.equal(canTransition("PROPOSED", "FORMALIZED"), true);
  assert.equal(canTransition("PROPOSED", "EXPERIMENT_READY"), false);
  assert.equal(canTransition("FORMALIZED", "EXPERIMENT_READY"), true);
  assert.equal(canTransition("EXPERIMENT_READY", "UNDER_TEST"), true);
  assert.equal(canTransition("UNDER_TEST", "FORMALIZED"), false);
  assert.equal(canTransition("UNDER_TEST", "UNDER_TEST"), false);
});

test("EXPERIMENT-READY exige prerequisites y evidencia, no sólo campos completos", () => {
  assert.equal(validateExperimentReadiness({}).ok, false);

  const nominalOnly = validateExperimentReadiness({ prerequisitesSatisfied: ["SYN-prereq"] });
  assert.equal(nominalOnly.ok, false);
  assert.ok(nominalOnly.errors.some((error) => error.field === "readinessEvidence"));

  const complete = validateExperimentReadiness({
    prerequisitesSatisfied: ["SYN-prereq"],
    readinessEvidence: [{ kind: "readiness", ref: "SYN-READY" }],
  });
  assert.equal(complete.ok, true);
});

test("EXPERIMENT-READY rechaza prerequisites explícitamente falsos o vacíos", () => {
  const invalidPrerequisites = [
    false,
    null,
    "",
    [],
    {},
    { ref: "" },
    { ref: "SYN-prereq", satisfied: false },
    { ref: "SYN-prereq", met: false },
    { ref: "SYN-prereq", status: "UNSATISFIED" },
    { ref: "SYN-prereq", status: "PENDING" },
  ];

  for (const prerequisite of invalidPrerequisites) {
    const outcome = validateExperimentReadiness({
      prerequisitesSatisfied: [prerequisite],
      readinessEvidence: [{ kind: "readiness", ref: "SYN-READY" }],
    });
    assert.equal(outcome.ok, false, JSON.stringify(prerequisite));
    assert.ok(outcome.errors.some((error) => error.field === "prerequisitesSatisfied[0]"), JSON.stringify(prerequisite));
  }
});

test("EXPERIMENT-READY acepta referencias string y objetos de prerequisite satisfecho", () => {
  const outcome = validateExperimentReadiness({
    prerequisitesSatisfied: ["SYN-prereq", { ref: "SYN-prereq-2", satisfied: true }],
    readinessEvidence: [{ kind: "readiness", ref: "SYN-READY" }],
  });
  assert.equal(outcome.ok, true);
});

test("un veredicto PASS nunca admite por sí mismo", () => {
  const status = resolveAdmissionFromVerdict("PASS");
  assert.deepEqual(status, { namespace: STRATEGY_ADMISSION_NAMESPACE, value: "NOT_ADMITTED" });
});

test("la admisión sólo otorga rol Evidence Generator y niega autoridad de acción", () => {
  assert.deepEqual(ADMISSION_AUTHORITY.grants, ["EVIDENCE_GENERATOR_FOR_GLOBAL_CANDIDATE_POLICY"]);
  for (const denied of ["BUY_WAIT_AUTHORITY", "ORDER_AUTHORITY", "SIZING_AUTHORITY", "INDEPENDENT_ECONOMIC_REWARD"]) {
    assert.ok(ADMISSION_AUTHORITY.denies.includes(denied), denied);
  }
});

test("un namespace de hito desconocido se rechaza", () => {
  assert.equal(resolveMilestoneStatus("synthetic_namespace", "PASS").ok, false);
  assert.equal(resolveAdmissionStatus("synthetic_namespace", "PROPOSED").ok, false);
});
