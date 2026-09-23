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

  const notExtendable = makeAssessment({ minimallyExtendable: false });
  const blocked = deriveToolingDecision({ requiredCapabilities: [...BENCHMARK, "intraday.audit"], assessments: [notExtendable] });
  assert.equal(blocked.ok, false);
  assert.equal(blocked.code, "MISSING_NECESSITY");
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

  const exact = validateToolingSelection({ ...selection, additions: ["missing.B", "missing.A"] }, { requiredCapabilities: required, assessments: [extendable] });
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

  const withoutSufficient = validateToolingSelection(
    selection,
    { requiredCapabilities: required, assessments: [extendable, makeAssessment({ componentId: "SYN-TOOL-B", declaredCapabilities: ["other.capability"] })] },
  );
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
