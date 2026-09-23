// Fixtures sintéticas para los tests del Strategy Admission framework.
// Todos los candidatos, experimentos y evidencias son explícitamente
// sintéticos: no representan candidatos reales, edge ni admisión (ST-27.1).

import { CHANNEL } from "../../src/strategy-admission/channels.mjs";
import { STRATEGY_LIFECYCLE_NAMESPACE, STRATEGY_ADMISSION_NAMESPACE } from "../../src/strategy-admission/lifecycle.mjs";

export function makeCandidate(overrides = {}) {
  const base = {
    strategyId: "CAND-SYN-01",
    canonicalName: "Synthetic Admission Candidate 01",
    intakeChannel: CHANNEL.HYPOTHESIS_TO_CANDIDATE,
    provenance: {
      hypothesisRef: "SYN-HYP-1",
      experimentRef: "SYN-EXP-1",
      outcomeRef: "SYN-OUT-1",
    },
    role: "Evidence Generator candidate (synthetic role).",
    exactQuestion: "Synthetic question answered by the candidate.",
    rationale: "Synthetic rationale; not a procurement value claim.",
    validationProposition: "Synthetic falsifiable proposition.",
    observableInputs: ["SYN-input-A"],
    pointInTimeRequirements: ["SYN-PIT-rule"],
    dataDependencies: ["SYN-DATA-dep"],
    evidenceOutput: "Synthetic evidence bundle.",
    uncertaintySemantics: "UNAVAILABLE preserved explicitly; no invented value.",
    parameters: ["SYN-param=0"],
    calibrationBoundaries: "Synthetic calibration boundary.",
    refutationCriteria: "Synthetic refutation criterion.",
    relationshipToExisting: "Distinct from S1-S5 in synthetic terms.",
    redundancyAssessment: "Synthetic overlap assessed.",
    comparatorBaseline: "Synthetic comparator; not Benchmark B.",
    ablationDesign: { applicable: false, rationale: "Synthetic single-layer candidate." },
    economicEvaluationContract: "Synthetic application of §5/§10; no real run.",
    implementationScope: "Synthetic scope only.",
    version: "0.1.0",
    admissionStatus: { namespace: STRATEGY_LIFECYCLE_NAMESPACE, value: "PROPOSED" },
  };
  return { ...base, ...overrides };
}

export function makeChannel1Candidate(overrides = {}) {
  return makeCandidate(overrides);
}

export function makeChannel2Candidate(overrides = {}) {
  return makeCandidate({
    strategyId: "CAND-SYN-02",
    canonicalName: "Synthetic Discovery Candidate 02",
    intakeChannel: CHANNEL.RESEARCH_DISCOVERY,
    provenance: {
      discoveryRef: "SYN-DISC-1",
      researchQuestionRef: "SYN-RQ-1",
      hypothesisRef: "SYN-HYP-2",
    },
    ...overrides,
  });
}

export function makeChannel3Candidate(overrides = {}) {
  return makeCandidate({
    strategyId: "CAND-SYN-03",
    canonicalName: "Synthetic Bru-supplied Candidate 03",
    intakeChannel: CHANNEL.PREDEFINED_STRATEGY_BY_BRU,
    provenance: {
      sourceRef: "SYN-SOURCE-BRU",
      discoveryOmitted: true,
    },
    ...overrides,
  });
}

export const SYNTHETIC_READINESS = {
  prerequisitesSatisfied: ["SYN-prereq-PIT", "SYN-prereq-data"],
  readinessEvidence: [{ kind: "readiness", ref: "SYN-READY-1" }],
};

export function evidence(ref, kind = "experiment") {
  return { kind, ref };
}

export function driveToUnderTest(registry, candidate, experimentId = "SYN-EXPERIMENT-1") {
  registry.register(candidate);
  registry.transition(candidate.strategyId, "FORMALIZED");
  registry.transition(candidate.strategyId, "EXPERIMENT_READY", SYNTHETIC_READINESS);
  registry.transition(candidate.strategyId, "UNDER_TEST", { experimentId });
  return experimentId;
}

export { STRATEGY_LIFECYCLE_NAMESPACE, STRATEGY_ADMISSION_NAMESPACE };
