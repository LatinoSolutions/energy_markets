// Fixtures sintéticas para los tests del framework de evaluación por rol.
// Todos los componentes, protocolos y evidencias son explícitamente
// sintéticos: no representan capacidades reales, valor empírico, admisión ni
// integración (ST-28.1). JEV no aparece con rol asignado.

import { ROLE_CLASS } from "../../src/role-evaluation/roles.mjs";

export function makeEvaluation(overrides = {}) {
  const base = {
    componentId: "SYN-COMPONENT-01",
    componentVersion: "0.1.0",
    roleClass: ROLE_CLASS.ENGINEERING_ORCHESTRATION,
    protocolId: "SYN-PROTOCOL-1",
    protocolVersion: "1.0.0",
    exactRole: "Synthetic engineering/orchestration role under test.",
    problemToImprove: "Synthetic workflow problem; explicitly not a procurement claim.",
    currentComparator: "Synthetic existing mechanism used as comparator.",
    valueHypothesis: "Synthetic measurable operational improvement.",
    requiredInputs: ["SYN-input-A"],
    outputs: ["SYN-output-A"],
    authorityRequested: [],
    integrationBoundary: "Synthetic boundary; no real integration surface.",
    failureModes: ["SYN-failure-1"],
    reproducibilityRequirements: ["SYN-repro-1"],
    costLatencyBurden: { unknown: true, reason: "Synthetic unknown; preserved explicitly." },
    overlapAssessment: "Synthetic overlap assessed against Paperclip, S1-S5 and Candidate Policy.",
    evidenceRequiredForAdmission: ["SYN-admission-evidence-1"],
    removalRollbackPath: { path: "Synthetic removal path back to the existing mechanism." },
  };
  return { ...base, ...overrides };
}

export function makeStrategyEvidenceEvaluation(overrides = {}) {
  return makeEvaluation({
    componentId: "SYN-STRATEGY-COMP",
    roleClass: ROLE_CLASS.STRATEGY_EVIDENCE,
    valueHypothesis: "Synthetic incremental decision value hypothesis.",
    ...overrides,
  });
}

export function makeLearningEvaluation(overrides = {}) {
  return makeEvaluation({
    componentId: "SYN-LEARNING-COMP",
    roleClass: ROLE_CLASS.REPRESENTATION_LEARNING,
    ...overrides,
  });
}

export function makeExecutionGovernanceEvaluation(overrides = {}) {
  return makeEvaluation({
    componentId: "SYN-GOV-COMP",
    roleClass: ROLE_CLASS.EXECUTION_GOVERNANCE,
    authorityRequested: ["SYNTHETIC_AUTHORITY_UNDER_REVIEW"],
    ...overrides,
  });
}

export const SYNTHETIC_READINESS = {
  prerequisitesSatisfied: ["SYN-prereq-protocol-declared"],
  readinessEvidence: [{ kind: "readiness", ref: "SYN-READY-1" }],
};

export const SYNTHETIC_STRATEGY_GATE = {
  accepted: true,
  frameworkRef: "operations/receipts/IMP-27-ST-1.json",
  section: "§8.7",
};

export function evidence(ref, kind = "evaluation") {
  return { kind, ref };
}

export function driveToReady(registry, evaluation, readiness = SYNTHETIC_READINESS) {
  registry.registerComponent(evaluation);
  return registry.markEvaluationReady(evaluation.componentId, evaluation.roleClass, readiness);
}

export function driveToOutcome(registry, evaluation, outcomeValue, context = {}) {
  driveToReady(registry, evaluation, context.readiness ?? SYNTHETIC_READINESS);
  return registry.recordOutcome(evaluation.componentId, evaluation.roleClass, outcomeValue, {
    evidenceRefs: context.evidenceRefs ?? [evidence("SYN-OUTCOME-EVIDENCE-1")],
  });
}