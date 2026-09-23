import { test } from "node:test";
import assert from "node:assert/strict";

import { deriveToolingDecision, selectMinimumTooling, TOOLING_DECISION } from "../../src/tooling-selection/decision.mjs";
import { reconcileKeyOutputs } from "../../src/tooling-selection/reconciliation.mjs";
import { inventoryOf, makeAssessment, makeFixtures, makeReconciliationEvidence, SELECTION_EVIDENCE } from "./fixtures.mjs";

// Acceptance de IMP-04 §25.1: "Salidas clave pueden reconciliarse
// independientemente; nueva plataforma sólo si audit demuestra necesidad".
// Los entregables del IMP son el capability assessment y la decisión
// fundamentada; aquí se comprueba que el record de selección los incluye y
// que los caminos inválidos se rechazan.

test("acceptance: las salidas clave se reconcilian de forma independiente antes de reutilizar", () => {
  const assessment = makeAssessment();
  const evidence = makeReconciliationEvidence("SYN-TOOL-A");
  // La reconciliación se recalcula desde la evidencia cruda; el validador no
  // acepta un resultado declarado.
  const recomputed = reconcileKeyOutputs({
    componentId: evidence.componentId,
    outputs: evidence.outputs,
    fixtures: evidence.fixtures,
    keyOutputs: assessment.interfaceContract.outputs,
  });
  assert.equal(recomputed.reconciled, true);

  const result = selectMinimumTooling({
    requiredCapabilities: ["benchmark.calculate", "reference.proxy"],
    assessments: [assessment],
    reconciliation: evidence,
    evidenceRefs: SELECTION_EVIDENCE,
  });
  assert.equal(result.ok, true);
  assert.equal(result.selection.decision, TOOLING_DECISION.REUSE);
  // Entregable IMP-04: el record incluye el capability assessment auditado
  // del componente elegido y la decisión fundamentada.
  assert.deepEqual(result.selection.targetAssessment, assessment);
  // La decisión está fundamentada en la traza de cobertura, no en un texto
  // libre (review IMP-04 2026-09-23: sólo se comprobaba texto no vacío).
  assert.deepEqual(result.selection.auditTrace, [{
    componentId: "SYN-TOOL-A",
    usable: true,
    rightsUnresolved: false,
    usabilityReasons: [],
    covered: ["benchmark.calculate", "reference.proxy"],
    missing: [],
    sufficient: true,
    minimallyExtendable: false,
  }]);
  assert.equal(
    result.selection.rationale,
    "Auditoría de [SYN-TOOL-A]: SYN-TOOL-A es el único componente usable que cubre [benchmark.calculate, reference.proxy].",
  );
});

test("acceptance: una plataforma nueva no procede sin componentes auditados, aunque la necesidad se autodeclare", () => {
  const result = selectMinimumTooling({
    requiredCapabilities: ["benchmark.calculate"],
    assessments: [],
    buildNecessity: { demonstrated: true, rationale: "Autodeclarada.", evidenceRefs: [{ kind: "audit", ref: "SYN-NEC-1" }] },
    evidenceRefs: SELECTION_EVIDENCE,
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, "NO_COMPONENTS_AUDITED");
});

test("acceptance: una plataforma nueva no procede si un componente con derechos pendientes ya cubre lo requerido", () => {
  const unresolved = makeAssessment({ usageRights: { status: "unknown", evidenceRef: "SYN-RIGHTS-PENDING" } });
  const result = selectMinimumTooling({
    requiredCapabilities: ["benchmark.calculate", "reference.proxy"],
    assessments: [unresolved],
    buildNecessity: { demonstrated: true, rationale: "Autodeclarada.", evidenceRefs: [{ kind: "audit", ref: "SYN-NEC-1" }] },
    evidenceRefs: SELECTION_EVIDENCE,
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, "BLOCKED_PENDING_RIGHTS_AUDIT");
  assert.deepEqual(result.candidateComponentIds, ["SYN-TOOL-A"]);
});

// Review IMP-04 2026-09-23 (revisión 7): un BUILD con un único assessment
// irrelevante y necesidad declarada se aprobaba sin comprobar que el audit
// cubriera todos los componentes pertinentes. El criterio «nueva plataforma
// sólo si audit demuestra necesidad» (§25.1 IMP-04) se prueba aquí contra el
// inventario del soporte: todos auditados, ninguno ajeno, ninguno con derechos
// pendientes y ninguno que cubra parte de lo requerido.
test("acceptance: una plataforma nueva sólo procede si la auditoría del inventario completo demuestra necesidad", () => {
  const insufficient = makeAssessment({ declaredCapabilities: ["other.capability"], minimallyExtendable: false });
  const required = ["benchmark.calculate"];
  const necessity = { demonstrated: true, rationale: "Synthetic audit: no usable component covers it.", evidenceRefs: [{ kind: "audit", ref: "SYN-NEC-1" }] };

  const rejected = selectMinimumTooling({ requiredCapabilities: required, assessments: [insufficient], auditInventory: inventoryOf([insufficient]), evidenceRefs: SELECTION_EVIDENCE });
  assert.equal(rejected.ok, false);
  assert.equal(rejected.code, "MISSING_NECESSITY");

  // Necesidad declarada pero sin inventario: no hay forma de saber si el
  // componente auditado es el único pertinente.
  const withoutInventory = selectMinimumTooling({ requiredCapabilities: required, assessments: [insufficient], buildNecessity: necessity, evidenceRefs: SELECTION_EVIDENCE });
  assert.equal(withoutInventory.ok, false);
  assert.equal(withoutInventory.code, "MISSING_AUDIT_INVENTORY");

  // El inventario reporta otro componente que no se auditó: el assessment
  // irrelevante no demuestra necesidad.
  const relevantButUnaudited = makeAssessment({ componentId: "SYN-TOOL-RELEVANT" });
  const incomplete = selectMinimumTooling({
    requiredCapabilities: required,
    assessments: [insufficient],
    buildNecessity: necessity,
    auditInventory: inventoryOf([insufficient, relevantButUnaudited]),
    evidenceRefs: SELECTION_EVIDENCE,
  });
  assert.equal(incomplete.ok, false);
  assert.equal(incomplete.code, "INVENTORY_NOT_AUDITED");
  assert.deepEqual(incomplete.componentIds, ["SYN-TOOL-RELEVANT"]);

  // Auditado el componente pertinente, cubre lo requerido: la decisión es
  // reutilizarlo, no construir, aunque la necesidad se declare.
  const complete = deriveToolingDecision({
    requiredCapabilities: required,
    assessments: [insufficient, relevantButUnaudited],
    buildNecessity: necessity,
    auditInventory: inventoryOf([insufficient, relevantButUnaudited]),
  });
  assert.equal(complete.ok, true);
  assert.equal(complete.decision, TOOLING_DECISION.REUSE);
  assert.equal(complete.targetComponentId, "SYN-TOOL-RELEVANT");

  // Un inventario pertinente con derechos pendientes deja el audit abierto,
  // aunque ese componente no cubra nada todavía.
  const pendingRights = makeAssessment({ componentId: "SYN-TOOL-PENDING", declaredCapabilities: ["other.capability"], usageRights: { status: "unknown", evidenceRef: "SYN-RIGHTS-PENDING" } });
  const openAudit = selectMinimumTooling({
    requiredCapabilities: required,
    assessments: [insufficient, pendingRights],
    buildNecessity: necessity,
    auditInventory: inventoryOf([insufficient, pendingRights]),
    evidenceRefs: SELECTION_EVIDENCE,
  });
  assert.equal(openAudit.ok, false);
  assert.equal(openAudit.code, "BLOCKED_PENDING_RIGHTS_AUDIT");
  assert.deepEqual(openAudit.candidateComponentIds, ["SYN-TOOL-PENDING"]);

  const accepted = selectMinimumTooling({
    requiredCapabilities: required,
    assessments: [insufficient],
    buildNecessity: necessity,
    auditInventory: inventoryOf([insufficient]),
    evidenceRefs: SELECTION_EVIDENCE,
  });
  assert.equal(accepted.ok, true);
  assert.deepEqual(accepted.selection.auditInventory, inventoryOf([insufficient]));
  assert.equal(accepted.selection.decision, TOOLING_DECISION.BUILD);
  assert.equal(accepted.selection.targetAssessment, null);
  assert.ok(accepted.selection.rationale.includes("Synthetic audit: no usable component covers it."));
  assert.deepEqual(accepted.selection.auditTrace.map((entry) => [entry.componentId, entry.covered]), [["SYN-TOOL-A", []]]);
});

test("acceptance: una reconciliación declarada (sin salidas ni fixtures) no sostiene la selección", () => {
  const assessment = makeAssessment();
  const fabricated = { componentId: "SYN-TOOL-A", reconciled: true, rejected: false };
  const result = selectMinimumTooling({
    requiredCapabilities: ["benchmark.calculate", "reference.proxy"],
    assessments: [assessment],
    reconciliation: fabricated,
    evidenceRefs: SELECTION_EVIDENCE,
  });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.code === "RECONCILIATION_NOT_VERIFIABLE"));
});

test("acceptance: comparaciones escritas a mano (con observado/esperado) siguen sin ser verificables", () => {
  const assessment = makeAssessment();
  const fabricated = {
    componentId: "SYN-TOOL-A",
    reconciled: true,
    rejected: false,
    comparisons: [{ outputId: "SYN-output-B", observed: 105, expected: 105, agreed: true, tolerance: 0 }],
    mismatches: [],
  };
  const result = selectMinimumTooling({
    requiredCapabilities: ["benchmark.calculate", "reference.proxy"],
    assessments: [assessment],
    reconciliation: fabricated,
    evidenceRefs: SELECTION_EVIDENCE,
  });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.code === "RECONCILIATION_NOT_VERIFIABLE"));
});

test("acceptance: una reconciliación que no cubre las salidas clave declaradas se rechaza", () => {
  const assessment = makeAssessment({
    interfaceContract: { inputs: ["SYN-input-price"], outputs: ["SYN-output-B", "SYN-output-C"] },
  });
  // Fixture de un subconjunto arbitrario: cubre una salida, no la otra.
  const partialReconciliation = makeReconciliationEvidence("SYN-TOOL-A");
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
  const divergent = makeReconciliationEvidence("SYN-TOOL-A", {
    fixtures: makeFixtures({ expectedValue: 104 }),
  });
  const result = selectMinimumTooling({
    requiredCapabilities: ["benchmark.calculate", "reference.proxy"],
    assessments: [assessment],
    reconciliation: divergent,
    evidenceRefs: SELECTION_EVIDENCE,
  });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.code === "NOT_RECONCILED"));
});

test("acceptance: un fixture no permitido o sin cómputo independiente no reconcilia", () => {
  const assessment = makeAssessment();
  const notPermitted = selectMinimumTooling({
    requiredCapabilities: ["benchmark.calculate", "reference.proxy"],
    assessments: [assessment],
    reconciliation: makeReconciliationEvidence("SYN-TOOL-A", { fixtures: makeFixtures({ permitted: false }) }),
    evidenceRefs: SELECTION_EVIDENCE,
  });
  assert.equal(notPermitted.ok, false);
  assert.ok(notPermitted.errors.some((error) => error.code === "FIXTURE_NOT_PERMITTED"));

  const notIndependent = selectMinimumTooling({
    requiredCapabilities: ["benchmark.calculate", "reference.proxy"],
    assessments: [assessment],
    reconciliation: makeReconciliationEvidence("SYN-TOOL-A", { fixtures: makeFixtures({ independentComputation: "" }) }),
    evidenceRefs: SELECTION_EVIDENCE,
  });
  assert.equal(notIndependent.ok, false);
  assert.ok(notIndependent.errors.some((error) => error.code === "FIXTURE_NOT_INDEPENDENT"));
});

test("acceptance: evidenceRefs inválidos (incluido [null]) no aprueban la selección", () => {
  const assessment = makeAssessment();
  const reconciliation = makeReconciliationEvidence("SYN-TOOL-A");
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
    auditInventory: inventoryOf([makeAssessment()]),
    evidenceRefs: SELECTION_EVIDENCE,
  });
  assert.equal(malformedNecessity.ok, false);
  assert.equal(malformedNecessity.code, "INVALID_NECESSITY_EVIDENCE");
});
