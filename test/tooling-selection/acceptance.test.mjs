import { test } from "node:test";
import assert from "node:assert/strict";

import { selectMinimumTooling, TOOLING_DECISION } from "../../src/tooling-selection/decision.mjs";
import { reconcileKeyOutputs } from "../../src/tooling-selection/reconciliation.mjs";
import { makeAssessment, makeFixtures, makeOutputs, makeReconciliation, SELECTION_EVIDENCE } from "./fixtures.mjs";

// Acceptance de IMP-04 §25.1: "Salidas clave pueden reconciliarse
// independientemente; nueva plataforma sólo si audit demuestra necesidad".
// Los entregables del IMP son el capability assessment y la decisión
// fundamentada; aquí se comprueba que el record de selección los incluye y
// que los caminos inválidos se rechazan.

test("acceptance: las salidas clave se reconcilian de forma independiente antes de reutilizar", () => {
  const assessment = makeAssessment();
  const reconciliation = reconcileKeyOutputs({
    componentId: "SYN-TOOL-A",
    outputs: makeOutputs(),
    fixtures: makeFixtures(),
    keyOutputs: assessment.interfaceContract.outputs,
  });
  assert.equal(reconciliation.reconciled, true);

  const result = selectMinimumTooling({
    requiredCapabilities: ["benchmark.calculate", "reference.proxy"],
    assessments: [assessment],
    reconciliation,
    evidenceRefs: SELECTION_EVIDENCE,
  });
  assert.equal(result.ok, true);
  assert.equal(result.selection.decision, TOOLING_DECISION.REUSE);
  // Entregable IMP-04: el record incluye el capability assessment auditado
  // del componente elegido y la decisión fundamentada.
  assert.deepEqual(result.selection.targetAssessment, assessment);
  assert.equal(typeof result.selection.rationale, "string");
  assert.ok(result.selection.rationale.length > 0);
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
  assert.equal(accepted.selection.targetAssessment, null);
});

test("acceptance: una reconciliación fabricada sin comparaciones no sostiene la selección", () => {
  const assessment = makeAssessment();
  const fabricated = { componentId: "SYN-TOOL-A", reconciled: true, rejected: false };
  const result = selectMinimumTooling({
    requiredCapabilities: ["benchmark.calculate", "reference.proxy"],
    assessments: [assessment],
    reconciliation: fabricated,
    evidenceRefs: SELECTION_EVIDENCE,
  });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.code === "RECONCILIATION_WITHOUT_COMPARISONS"));
});

test("acceptance: una reconciliación que no cubre las salidas clave declaradas se rechaza", () => {
  const assessment = makeAssessment({
    interfaceContract: { inputs: ["SYN-input-price"], outputs: ["SYN-output-B", "SYN-output-C"] },
  });
  // Fixture de un subconjunto arbitrario: cubre una salida, no la otra.
  const partialReconciliation = makeReconciliation("SYN-TOOL-A");
  const result = selectMinimumTooling({
    requiredCapabilities: ["benchmark.calculate", "reference.proxy"],
    assessments: [assessment],
    reconciliation: partialReconciliation,
    evidenceRefs: SELECTION_EVIDENCE,
  });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.code === "KEY_OUTPUTS_NOT_COVERED"));
});

test("acceptance: una comparación no coincidente en la reconciliación impide la selección", () => {
  const assessment = makeAssessment();
  const divergent = makeReconciliation("SYN-TOOL-A", {
    comparisons: [{ outputId: "SYN-output-B", observed: 104, expected: 105, agreed: false, tolerance: 0 }],
    mismatches: [{ outputId: "SYN-output-B", reason: "VALUE_MISMATCH" }],
  });
  const result = selectMinimumTooling({
    requiredCapabilities: ["benchmark.calculate", "reference.proxy"],
    assessments: [assessment],
    reconciliation: divergent,
    evidenceRefs: SELECTION_EVIDENCE,
  });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.code === "COMPARISON_NOT_AGREED"));
});

test("acceptance: evidenceRefs inválidos (incluido [null]) no aprueban la selección", () => {
  const assessment = makeAssessment();
  const reconciliation = reconcileKeyOutputs({
    componentId: "SYN-TOOL-A",
    outputs: makeOutputs(),
    fixtures: makeFixtures(),
    keyOutputs: assessment.interfaceContract.outputs,
  });
  const base = {
    requiredCapabilities: ["benchmark.calculate", "reference.proxy"],
    assessments: [assessment],
    reconciliation,
  };

  const nullRefs = selectMinimumTooling({ ...base, evidenceRefs: [null] });
  assert.equal(nullRefs.ok, false);
  assert.ok(nullRefs.errors.some((error) => error.code === "INVALID_EVIDENCE_REF"));

  const malformed = selectMinimumTooling({ ...base, evidenceRefs: [{ kind: "audit" }] });
  assert.equal(malformed.ok, false);
  assert.ok(malformed.errors.some((error) => error.code === "MISSING_EVIDENCE_REF"));

  const malformedNecessity = selectMinimumTooling({
    requiredCapabilities: ["benchmark.calculate"],
    assessments: [makeAssessment({ declaredCapabilities: ["other.capability"], minimallyExtendable: false })],
    buildNecessity: { demonstrated: true, rationale: "Synthetic.", evidenceRefs: [null] },
    evidenceRefs: SELECTION_EVIDENCE,
  });
  assert.equal(malformedNecessity.ok, false);
  assert.equal(malformedNecessity.code, "INVALID_NECESSITY_EVIDENCE");
});
