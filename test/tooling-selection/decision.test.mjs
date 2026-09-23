import { test } from "node:test";
import assert from "node:assert/strict";

import {
  NO_PRODUCTION_AUTHORITY,
  SELECTION_BASIS,
  TOOLING_DECISION,
  deriveToolingDecision,
  selectMinimumTooling,
  validateToolingSelection,
} from "../../src/tooling-selection/decision.mjs";
import { makeAssessment, makeReconciliationEvidence, SELECTION_EVIDENCE } from "./fixtures.mjs";

const BENCHMARK = ["benchmark.calculate", "reference.proxy"];

test("REUSE cuando un componente usable cubre todo lo requerido", () => {
  const assessment = makeAssessment();
  const derived = deriveToolingDecision({ requiredCapabilities: BENCHMARK, assessments: [assessment] });
  assert.equal(derived.ok, true);
  assert.equal(derived.decision, TOOLING_DECISION.REUSE);
  assert.equal(derived.targetComponentId, "SYN-TOOL-A");
  assert.deepEqual(derived.additions, []);
});

test("EXTEND sólo añade lo que falta y exige declaración de casi suficiente", () => {
  const extendable = makeAssessment({ minimallyExtendable: true });
  const derived = deriveToolingDecision({ requiredCapabilities: [...BENCHMARK, "intraday.audit"], assessments: [extendable] });
  assert.equal(derived.ok, true);
  assert.equal(derived.decision, TOOLING_DECISION.EXTEND);
  assert.deepEqual(derived.additions, ["intraday.audit"]);

  // Un componente usable no extensible que ya cubre parte de lo requerido no
  // habilita construir todo de nuevo.
  const notExtendable = makeAssessment({ minimallyExtendable: false });
  const blocked = deriveToolingDecision({ requiredCapabilities: [...BENCHMARK, "intraday.audit"], assessments: [notExtendable] });
  assert.equal(blocked.ok, false);
  assert.equal(blocked.code, "EXISTING_COVERAGE_NOT_RESOLVED");
});

test("BUILD sólo con necesidad demostrada por la auditoría", () => {
  const partial = makeAssessment({ declaredCapabilities: ["benchmark.calculate"], minimallyExtendable: false });
  const required = ["intraday.audit"];

  const withoutNecessity = deriveToolingDecision({ requiredCapabilities: required, assessments: [partial] });
  assert.equal(withoutNecessity.ok, false);
  assert.equal(withoutNecessity.code, "MISSING_NECESSITY");

  const withNecessity = deriveToolingDecision({
    requiredCapabilities: required,
    assessments: [partial],
    buildNecessity: { demonstrated: true, rationale: "Synthetic audit found no usable component.", evidenceRefs: [{ kind: "audit", ref: "SYN-NEC-1" }] },
  });
  assert.equal(withNecessity.ok, true);
  assert.equal(withNecessity.decision, TOOLING_DECISION.BUILD);
});

test("BUILD con necesidad demostrada se rechaza si ya existe un componente usable suficiente", () => {
  const sufficient = makeAssessment();
  const selection = {
    requiredCapabilities: BENCHMARK,
    decision: TOOLING_DECISION.BUILD,
    selectionBasis: SELECTION_BASIS.AUDIT,
    targetComponentId: null,
    additions: [...BENCHMARK],
    buildNecessity: { demonstrated: true, rationale: "Synthetic.", evidenceRefs: [{ kind: "audit", ref: "SYN-NEC-1" }] },
    reconciliation: null,
    evidenceRefs: SELECTION_EVIDENCE,
    grantsProductionAuthority: false,
  };
  const outcome = validateToolingSelection(selection, { requiredCapabilities: BENCHMARK, assessments: [sufficient] });
  assert.equal(outcome.ok, false);
  assert.ok(outcome.errors.some((error) => error.code === "BUILD_UNNECESSARY"));
});

test("derechos no permitidos o IP implícita excluyen al componente de REUSE/EXTEND", () => {
  const denied = makeAssessment({ usageRights: { status: "denied", evidenceRef: "SYN-RIGHTS-1" } });
  const deniedOutcome = deriveToolingDecision({ requiredCapabilities: BENCHMARK, assessments: [denied] });
  assert.equal(deniedOutcome.ok, false);
  assert.equal(deniedOutcome.code, "MISSING_NECESSITY");

  const implicitIp = makeAssessment({ ipExposure: { assessment: "implicit", rationale: "Synthetic." } });
  assert.equal(deriveToolingDecision({ requiredCapabilities: BENCHMARK, assessments: [implicitIp] }).ok, false);
});

test("la ambigüedad entre componentes iguales no se resuelve por preferencia", () => {
  const a = makeAssessment();
  const b = makeAssessment({ componentId: "SYN-TOOL-B" });
  const outcome = deriveToolingDecision({ requiredCapabilities: BENCHMARK, assessments: [a, b] });
  assert.equal(outcome.ok, false);
  assert.equal(outcome.code, "MULTIPLE_SUFFICIENT");
});

test("selectMinimumTooling exige reconciliación y no concede autoridad productiva", () => {
  const assessment = makeAssessment();
  const withoutReconciliation = selectMinimumTooling({ requiredCapabilities: BENCHMARK, assessments: [assessment], evidenceRefs: SELECTION_EVIDENCE });
  assert.equal(withoutReconciliation.ok, false);

  const withReconciliation = selectMinimumTooling({
    requiredCapabilities: BENCHMARK,
    assessments: [assessment],
    reconciliation: makeReconciliationEvidence("SYN-TOOL-A"),
    evidenceRefs: SELECTION_EVIDENCE,
  });
  assert.equal(withReconciliation.ok, true);
  assert.equal(withReconciliation.selection.decision, TOOLING_DECISION.REUSE);
  assert.equal(withReconciliation.selection.grantsProductionAuthority, false);
  assert.equal(withReconciliation.selection.authority, NO_PRODUCTION_AUTHORITY);
  assert.equal(withReconciliation.selection.selectionBasis, SELECTION_BASIS.AUDIT);
});

test("EXTEND no puede reimplementar capacidades existentes", () => {
  const extendable = makeAssessment({ minimallyExtendable: true });
  const required = [...BENCHMARK, "intraday.audit"];
  const selection = {
    requiredCapabilities: required,
    decision: TOOLING_DECISION.EXTEND,
    selectionBasis: SELECTION_BASIS.AUDIT,
    targetComponentId: "SYN-TOOL-A",
    additions: BENCHMARK,
    reconciliation: makeReconciliationEvidence("SYN-TOOL-A"),
    evidenceRefs: SELECTION_EVIDENCE,
    grantsProductionAuthority: false,
  };
  const outcome = validateToolingSelection(selection, { requiredCapabilities: required, assessments: [extendable] });
  assert.equal(outcome.ok, false);
  assert.ok(outcome.errors.some((error) => error.code === "ADDITIONS_NOT_MINIMAL"));
});

test("una selección por preferencia tecnológica se rechaza", () => {
  const assessment = makeAssessment();
  const selection = {
    requiredCapabilities: BENCHMARK,
    decision: TOOLING_DECISION.REUSE,
    selectionBasis: SELECTION_BASIS.PREFERENCE,
    targetComponentId: "SYN-TOOL-A",
    additions: [],
    reconciliation: makeReconciliationEvidence("SYN-TOOL-A"),
    evidenceRefs: SELECTION_EVIDENCE,
    grantsProductionAuthority: false,
  };
  const outcome = validateToolingSelection(selection, { requiredCapabilities: BENCHMARK, assessments: [assessment] });
  assert.equal(outcome.ok, false);
  assert.ok(outcome.errors.some((error) => error.code === "PREFERENCE_BASED_SELECTION"));
});

// Review IMP-04 2026-09-23: los duplicados no cuentan como capacidades distintas.
test("EXTEND con additions duplicadas no sustituye a la capacidad que falta", () => {
  const extendable = makeAssessment({ minimallyExtendable: true });
  const required = [...BENCHMARK, "missing.A", "missing.B"];
  const selection = {
    requiredCapabilities: required,
    decision: TOOLING_DECISION.EXTEND,
    selectionBasis: SELECTION_BASIS.AUDIT,
    targetComponentId: "SYN-TOOL-A",
    additions: ["missing.A", "missing.A"],
    reconciliation: makeReconciliationEvidence("SYN-TOOL-A"),
    evidenceRefs: SELECTION_EVIDENCE,
    grantsProductionAuthority: false,
  };
  const outcome = validateToolingSelection(selection, { requiredCapabilities: required, assessments: [extendable] });
  assert.equal(outcome.ok, false);
  assert.ok(outcome.errors.some((error) => error.code === "ADDITIONS_NOT_MINIMAL"));

  const derived = selectMinimumTooling({ requiredCapabilities: required, assessments: [extendable], reconciliation: makeReconciliationEvidence("SYN-TOOL-A"), evidenceRefs: SELECTION_EVIDENCE });
  assert.equal(derived.ok, true, JSON.stringify(derived));
  const exact = validateToolingSelection({ ...derived.selection, additions: ["missing.B", "missing.A"] }, { requiredCapabilities: required, assessments: [extendable] });
  assert.equal(exact.ok, true, JSON.stringify(exact));
});

test("las capacidades requeridas duplicadas se rechazan", () => {
  const required = [...BENCHMARK, BENCHMARK[0]];
  const derived = deriveToolingDecision({ requiredCapabilities: required, assessments: [makeAssessment()] });
  assert.equal(derived.ok, false);
  assert.equal(derived.code, "DUPLICATE_REQUIRED_CAPABILITIES");
});

// Review IMP-04 2026-09-23: validateToolingSelection aceptaba EXTEND aunque
// otro componente usable cubriera todas las capacidades requeridas; §6.4
// exige reutilizar el componente suficiente antes que extender uno casi
// suficiente.
test("EXTEND se rechaza cuando otro componente usable ya cubre todas las capacidades", () => {
  const extendable = makeAssessment({ minimallyExtendable: true });
  const sufficient = makeAssessment({
    componentId: "SYN-TOOL-B",
    declaredCapabilities: [...BENCHMARK, "intraday.audit"],
  });
  const required = [...BENCHMARK, "intraday.audit"];
  const selection = {
    requiredCapabilities: required,
    decision: TOOLING_DECISION.EXTEND,
    selectionBasis: SELECTION_BASIS.AUDIT,
    targetComponentId: "SYN-TOOL-A",
    additions: ["intraday.audit"],
    reconciliation: makeReconciliationEvidence("SYN-TOOL-A"),
    evidenceRefs: SELECTION_EVIDENCE,
    grantsProductionAuthority: false,
  };
  const outcome = validateToolingSelection(selection, { requiredCapabilities: required, assessments: [extendable, sufficient] });
  assert.equal(outcome.ok, false);
  const rejection = outcome.errors.find((error) => error.code === "REUSE_AVAILABLE");
  assert.ok(rejection);
  assert.deepEqual(rejection.candidateComponentIds, ["SYN-TOOL-B"]);

  const unrelatedAssessments = [extendable, makeAssessment({ componentId: "SYN-TOOL-B", declaredCapabilities: ["other.capability"] })];
  const derived = selectMinimumTooling({ requiredCapabilities: required, assessments: unrelatedAssessments, reconciliation: makeReconciliationEvidence("SYN-TOOL-A"), evidenceRefs: SELECTION_EVIDENCE });
  assert.equal(derived.ok, true, JSON.stringify(derived));
  assert.equal(derived.selection.decision, TOOLING_DECISION.EXTEND);
  const withoutSufficient = validateToolingSelection(derived.selection, { requiredCapabilities: required, assessments: unrelatedAssessments });
  assert.equal(withoutSufficient.ok, true, JSON.stringify(withoutSufficient));
});

test("EXTEND del propio componente suficiente se rechaza: REUSE es la decisión mínima", () => {
  const sufficient = makeAssessment({ minimallyExtendable: true });
  const selection = {
    requiredCapabilities: BENCHMARK,
    decision: TOOLING_DECISION.EXTEND,
    selectionBasis: SELECTION_BASIS.AUDIT,
    targetComponentId: "SYN-TOOL-A",
    additions: [],
    reconciliation: makeReconciliationEvidence("SYN-TOOL-A"),
    evidenceRefs: SELECTION_EVIDENCE,
    grantsProductionAuthority: false,
  };
  const outcome = validateToolingSelection(selection, { requiredCapabilities: BENCHMARK, assessments: [sufficient] });
  assert.equal(outcome.ok, false);
  assert.ok(outcome.errors.some((error) => error.code === "REUSE_AVAILABLE"));
});

const NECESSITY = { demonstrated: true, rationale: "Synthetic.", evidenceRefs: [{ kind: "audit", ref: "SYN-NEC-1" }] };

function buildSelection(overrides = {}) {
  return {
    requiredCapabilities: BENCHMARK,
    decision: TOOLING_DECISION.BUILD,
    selectionBasis: SELECTION_BASIS.AUDIT,
    targetComponentId: null,
    additions: [...BENCHMARK],
    buildNecessity: NECESSITY,
    reconciliation: null,
    evidenceRefs: SELECTION_EVIDENCE,
    grantsProductionAuthority: false,
    ...overrides,
  };
}

function reuseSelection(overrides = {}) {
  return {
    requiredCapabilities: BENCHMARK,
    decision: TOOLING_DECISION.REUSE,
    selectionBasis: SELECTION_BASIS.AUDIT,
    targetComponentId: "SYN-TOOL-A",
    additions: [],
    reconciliation: makeReconciliationEvidence("SYN-TOOL-A"),
    evidenceRefs: SELECTION_EVIDENCE,
    grantsProductionAuthority: false,
    ...overrides,
  };
}

// Review IMP-04 2026-09-23 punto 4: `assessments: []` + `demonstrated: true`
// daba BUILD ok.
test("BUILD sin componentes auditados se rechaza en derivación y en validación", () => {
  const derived = deriveToolingDecision({ requiredCapabilities: BENCHMARK, assessments: [], buildNecessity: NECESSITY });
  assert.equal(derived.ok, false);
  assert.equal(derived.code, "NO_COMPONENTS_AUDITED");

  const validated = validateToolingSelection(buildSelection(), { requiredCapabilities: BENCHMARK, assessments: [] });
  assert.equal(validated.ok, false);
  assert.ok(validated.errors.some((error) => error.code === "NO_COMPONENTS_AUDITED"));
});

// Review IMP-04 2026-09-23 punto 4: un componente que cubre todo pero con
// derechos `unknown` terminaba en BUILD.
test("derechos o IP unknown en un componente que cubre lo requerido bloquean BUILD", () => {
  for (const overrides of [
    { usageRights: { status: "unknown", evidenceRef: "SYN-RIGHTS-PENDING" } },
    { ipExposure: { assessment: "unknown", rationale: "Synthetic pending." } },
  ]) {
    const pending = makeAssessment(overrides);
    const derived = deriveToolingDecision({ requiredCapabilities: BENCHMARK, assessments: [pending], buildNecessity: NECESSITY });
    assert.equal(derived.ok, false);
    assert.equal(derived.code, "BLOCKED_PENDING_RIGHTS_AUDIT");
    assert.deepEqual(derived.blockedCapabilities, BENCHMARK);

    const validated = validateToolingSelection(buildSelection(), { requiredCapabilities: BENCHMARK, assessments: [pending] });
    assert.equal(validated.ok, false);
    assert.ok(validated.errors.some((error) => error.code === "BLOCKED_PENDING_RIGHTS_AUDIT"));
  }
});

test("derechos denegados o IP implícita auditados no bloquean un BUILD con necesidad", () => {
  for (const overrides of [
    { usageRights: { status: "denied", evidenceRef: "SYN-RIGHTS-DENIED" } },
    { ipExposure: { assessment: "implicit", rationale: "Synthetic exposure." } },
  ]) {
    const excluded = makeAssessment(overrides);
    const derived = deriveToolingDecision({ requiredCapabilities: BENCHMARK, assessments: [excluded], buildNecessity: NECESSITY });
    assert.equal(derived.ok, true, JSON.stringify(derived));
    assert.equal(derived.decision, TOOLING_DECISION.BUILD);
  }
});

test("EXTEND se bloquea si un componente con derechos pendientes ya cubre lo que se añadiría", () => {
  const extendable = makeAssessment({ minimallyExtendable: true });
  const pending = makeAssessment({
    componentId: "SYN-TOOL-P",
    declaredCapabilities: ["intraday.audit"],
    usageRights: { status: "unknown", evidenceRef: "SYN-RIGHTS-PENDING" },
  });
  const required = [...BENCHMARK, "intraday.audit"];
  const derived = deriveToolingDecision({ requiredCapabilities: required, assessments: [extendable, pending] });
  assert.equal(derived.ok, false);
  assert.equal(derived.code, "BLOCKED_PENDING_RIGHTS_AUDIT");
  assert.deepEqual(derived.candidateComponentIds, ["SYN-TOOL-P"]);
  assert.deepEqual(derived.blockedCapabilities, ["intraday.audit"]);
});

// Review IMP-04 2026-09-23 punto 5: REUSE elegido a mano entre varios
// suficientes era aceptado por la API pública.
test("validateToolingSelection rechaza REUSE elegido a mano entre varios suficientes", () => {
  const a = makeAssessment();
  const b = makeAssessment({ componentId: "SYN-TOOL-B" });
  const outcome = validateToolingSelection(reuseSelection(), { requiredCapabilities: BENCHMARK, assessments: [a, b] });
  assert.equal(outcome.ok, false);
  const ambiguity = outcome.errors.find((error) => error.code === "MULTIPLE_SUFFICIENT");
  assert.ok(ambiguity, JSON.stringify(outcome));
  assert.deepEqual(ambiguity.candidateComponentIds, ["SYN-TOOL-A", "SYN-TOOL-B"]);
});

// Review IMP-04 2026-09-23 punto 5: el assessment del componente elegido no se
// validaba (versión, evidencia de derechos, evidenceRefs).
test("validateToolingSelection exige el contrato completo del assessment elegido", () => {
  for (const [field, overrides] of [
    ["componentVersion", { componentVersion: undefined }],
    ["evidenceRefs", { evidenceRefs: [] }],
    ["evidenceRefs", { evidenceRefs: [null] }],
    ["usageRights.evidenceRef", { usageRights: { status: "permitted", evidenceRef: "" } }],
    ["extensionRationale", { minimallyExtendable: true, extensionRationale: undefined }],
  ]) {
    const broken = makeAssessment(overrides);
    const outcome = validateToolingSelection(reuseSelection(), { requiredCapabilities: BENCHMARK, assessments: [broken] });
    assert.equal(outcome.ok, false, field);
    const invalid = outcome.errors.find((error) => error.code === "INVALID_ASSESSMENT");
    assert.ok(invalid, `${field}: ${JSON.stringify(outcome)}`);
    assert.equal(invalid.componentId, "SYN-TOOL-A");
  }
  const valid = selectMinimumTooling({ requiredCapabilities: BENCHMARK, assessments: [makeAssessment()], reconciliation: makeReconciliationEvidence("SYN-TOOL-A"), evidenceRefs: SELECTION_EVIDENCE });
  assert.equal(validateToolingSelection(valid.selection, { requiredCapabilities: BENCHMARK, assessments: [makeAssessment()] }).ok, true);
});

// Validación adversarial IMP-04 2026-09-23: un REUSE válido con los campos
// descriptivos del record falseados pasaba.
test("validateToolingSelection rechaza un record cuyos campos contradicen la auditoría", () => {
  const assessment = makeAssessment();
  const valid = selectMinimumTooling({ requiredCapabilities: BENCHMARK, assessments: [assessment], reconciliation: makeReconciliationEvidence("SYN-TOOL-A"), evidenceRefs: SELECTION_EVIDENCE });
  assert.equal(valid.ok, true);
  for (const [field, value] of [
    ["requiredCapabilities", ["only.one"]],
    ["targetAssessment", { ...assessment, usageRights: { status: "unknown", evidenceRef: "X" } }],
    ["targetAssessment", undefined],
    ["auditTrace", []],
    ["rationale", "elegido por preferencia"],
    ["authority", "PRODUCTION"],
  ]) {
    const outcome = validateToolingSelection({ ...valid.selection, [field]: value }, { requiredCapabilities: BENCHMARK, assessments: [assessment] });
    assert.equal(outcome.ok, false, field);
    assert.ok(outcome.errors.some((error) => error.code === "RECORD_CONTRADICTS_AUDIT" && error.field === field), `${field}: ${JSON.stringify(outcome.errors)}`);
  }
});

// Validación adversarial IMP-04 2026-09-23: X cubre una capacidad, Y la otra,
// ninguno extensible → BUILD reconstruía ambas.
test("BUILD no reimplementa capacidades que componentes usables ya cubren por separado", () => {
  const x = makeAssessment({ componentId: "X", declaredCapabilities: ["benchmark.calculate"] });
  const y = makeAssessment({ componentId: "Y", declaredCapabilities: ["reference.proxy"] });
  const derived = deriveToolingDecision({ requiredCapabilities: BENCHMARK, assessments: [x, y], buildNecessity: NECESSITY });
  assert.equal(derived.ok, false);
  assert.equal(derived.code, "EXISTING_COVERAGE_NOT_RESOLVED");
  assert.deepEqual(derived.candidateComponentIds, ["X", "Y"]);
  assert.deepEqual(derived.coveredCapabilities, BENCHMARK);
});

test("EXTEND no añade una capacidad que otro componente usable ya cubre", () => {
  const extendable = makeAssessment({ minimallyExtendable: true });
  const other = makeAssessment({ componentId: "SYN-TOOL-C", declaredCapabilities: ["intraday.audit"] });
  const derived = deriveToolingDecision({ requiredCapabilities: [...BENCHMARK, "intraday.audit"], assessments: [extendable, other] });
  assert.equal(derived.ok, false);
  assert.equal(derived.code, "EXISTING_COVERAGE_NOT_RESOLVED");
  assert.deepEqual(derived.candidateComponentIds, ["SYN-TOOL-C"]);
});

test("validateToolingSelection rechaza una selección que no coincide con la derivada del audit", () => {
  const sufficient = makeAssessment();
  const other = makeAssessment({ componentId: "SYN-TOOL-B", declaredCapabilities: ["other.capability"] });
  const outcome = validateToolingSelection(
    reuseSelection({ targetComponentId: "SYN-TOOL-B", reconciliation: makeReconciliationEvidence("SYN-TOOL-B") }),
    { requiredCapabilities: BENCHMARK, assessments: [sufficient, other] },
  );
  assert.equal(outcome.ok, false);
  const mismatch = outcome.errors.find((error) => error.code === "DECISION_NOT_DERIVED_FROM_AUDIT");
  assert.ok(mismatch, JSON.stringify(outcome));
  assert.deepEqual(mismatch.expected, { decision: TOOLING_DECISION.REUSE, targetComponentId: "SYN-TOOL-A", additions: [] });
});

test("un mismo componente auditado dos veces se rechaza", () => {
  const derived = deriveToolingDecision({ requiredCapabilities: BENCHMARK, assessments: [makeAssessment(), makeAssessment()] });
  assert.equal(derived.ok, false);
  assert.equal(derived.code, "DUPLICATE_ASSESSMENTS");
});

test("el record de selección está congelado en profundidad y no congela los objetos del llamador", () => {
  const assessment = makeAssessment();
  const reconciliation = makeReconciliationEvidence("SYN-TOOL-A");
  const result = selectMinimumTooling({ requiredCapabilities: BENCHMARK, assessments: [assessment], reconciliation, evidenceRefs: SELECTION_EVIDENCE });
  assert.equal(result.ok, true);
  assert.throws(() => result.selection.additions.push("evil"), TypeError);
  assert.throws(() => { result.selection.reconciliation.outputs[0].value = 999; }, TypeError);
  assert.throws(() => { result.selection.targetAssessment.usageRights.status = "unknown"; }, TypeError);
  assert.equal(Object.isFrozen(assessment), false);
  assert.equal(Object.isFrozen(reconciliation.outputs[0]), false);
  assert.equal(validateToolingSelection(result.selection, { requiredCapabilities: BENCHMARK, assessments: [assessment] }).ok, true);
});
