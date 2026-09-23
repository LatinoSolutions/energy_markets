import { test } from "node:test";
import assert from "node:assert/strict";

import { selectMinimumTooling, TOOLING_DECISION } from "../../src/tooling-selection/decision.mjs";
import { reconcileKeyOutputs } from "../../src/tooling-selection/reconciliation.mjs";
import { makeAssessment, makeFixtures, makeOutputs, SELECTION_EVIDENCE } from "./fixtures.mjs";

// Acceptance de IMP-04 §25.1: "Salidas clave pueden reconciliarse
// independientemente; nueva plataforma sólo si audit demuestra necesidad".

test("acceptance: las salidas clave se reconcilian de forma independiente antes de reutilizar", () => {
  const assessment = makeAssessment();
  const reconciliation = reconcileKeyOutputs({ componentId: "SYN-TOOL-A", outputs: makeOutputs(), fixtures: makeFixtures() });
  assert.equal(reconciliation.reconciled, true);

  const result = selectMinimumTooling({
    requiredCapabilities: ["benchmark.calculate", "reference.proxy"],
    assessments: [assessment],
    reconciliation,
    evidenceRefs: SELECTION_EVIDENCE,
  });
  assert.equal(result.ok, true);
  assert.equal(result.selection.decision, TOOLING_DECISION.REUSE);
});

test("acceptance: una plataforma nueva sólo procede si la auditoría demuestra necesidad", () => {
  const insufficient = makeAssessment({ declaredCapabilities: ["other.capability"], minimallyExtendable: false });
  const required = ["benchmark.calculate"];

  const rejected = selectMinimumTooling({ requiredCapabilities: required, assessments: [insufficient], evidenceRefs: SELECTION_EVIDENCE });
  assert.equal(rejected.ok, false);

  const accepted = selectMinimumTooling({
    requiredCapabilities: required,
    assessments: [insufficient],
    buildNecessity: { demonstrated: true, rationale: "Synthetic audit: no usable component covers it.", evidenceRefs: [{ kind: "audit", ref: "SYN-NEC-1" }] },
    evidenceRefs: SELECTION_EVIDENCE,
  });
  assert.equal(accepted.ok, true);
  assert.equal(accepted.selection.decision, TOOLING_DECISION.BUILD);
});
