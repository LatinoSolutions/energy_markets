// Tests del ciclo offline y su evidencia (IMP-19). Fuente: SPEC v1.1.1 §11.5,
// §15.4, §25.1 fila IMP-19 ("Nueva versión revalidada con evidencia válida";
// "activo no muta") y §25.2.3 IMP-19.

import test from "node:test";
import assert from "node:assert/strict";

import { createActivePolicyVersionHolder } from "../../src/experience/index.mjs";
import {
  valueIteration,
  fixedPolicy,
  comparePoliciesByMerit,
  evaluateSupportSufficiency,
  evaluateLearningGates,
  assertExperienceCorpus,
  produceCandidatePolicyVersion,
  revalidateCandidate,
  runOfflineLearningCycle,
  materializeLearningEvidence,
  materializeRevalidationEvidence,
  DEP_STATUS,
} from "../../src/learning/index.mjs";
import {
  SYNTHETIC_MDP,
  supportCorpus,
  syntheticExperienceRecord,
  markovStateDeclaration,
  frozenRewardConfig,
  frozenProtocol,
  pathRevalidation,
  frozenProcessFor,
} from "./fixtures.mjs";

const GAMMA_JUSTIFICATION = "horizonte finito sin descuento económico justificado (§11.2)";
const mdpArgs = { states: SYNTHETIC_MDP.states, actions: SYNTHETIC_MDP.actions, transitions: SYNTHETIC_MDP.transitions };

function bestComparison() {
  const vi = valueIteration({ ...mdpArgs, gamma: 1, horizon: "finite", gammaJustification: GAMMA_JUSTIFICATION });
  return comparePoliciesByMerit({
    candidate: { name: "VALUE_ITERATION", policy: vi.policy },
    baselines: [
      { name: "ALWAYS_BUY", policy: fixedPolicy({ states: SYNTHETIC_MDP.states, action: "BUY" }).policy },
      { name: "ALWAYS_WAIT", policy: fixedPolicy({ states: SYNTHETIC_MDP.states, action: "WAIT" }).policy },
    ],
    ...mdpArgs,
    gamma: 1,
    horizon: "finite",
    gammaJustification: GAMMA_JUSTIFICATION,
    initialStates: SYNTHETIC_MDP.initialStates,
  });
}

function sufficientSupport() {
  return evaluateSupportSufficiency({ records: supportCorpus(), stateDeclaration: markovStateDeclaration(), minimumCampaigns: 2 });
}

test("IMP-19 §25.2 · el ciclo exige Experience válida realmente disponible", () => {
  assert.equal(assertExperienceCorpus({ corpus: [] }).ok, false);
  assert.equal(assertExperienceCorpus({ corpus: [{ artifactKind: "OTHER" }] }).code, "INVALID_EXPERIENCE_CORPUS");
  assert.equal(assertExperienceCorpus({ corpus: supportCorpus() }).ok, true);
});

test("IMP-19 §25.2.3 · los gates bloquean la evaluación con datos reales inadecuados", () => {
  const gates = evaluateLearningGates({
    corpusAudit: { scope: "REAL_DATA", auditPitRightsValid: true, realDataAdequate: false, sourceRef: "corpus-real-ref" },
    rewardConfig: frozenRewardConfig(),
    protocol: frozenProtocol(),
    supportEvaluation: sufficientSupport(),
    evaluatedAtUtc: "2026-02-01T00:00:00Z",
  });
  assert.equal(gates.ok, false);
  assert.ok(gates.reasons.some((reason) => reason.code === "REAL_DATA_NOT_ADEQUATE"));
});

test("IMP-19 §25.2.3 · reward/protocol sin congelar no habilitan la candidate", () => {
  const gates = evaluateLearningGates({
    corpusAudit: { scope: "SYNTHETIC_FIXTURE", sourceRef: "fixture-ref" },
    rewardConfig: { configVersion: "open", state: "OPEN", costsEnteredOnceInH: true, reward: { rewardId: "GLOBAL_PROCUREMENT_REWARD", anchoredToProcurementValue: true, localRewards: [] } },
    protocol: frozenProtocol(),
    supportEvaluation: sufficientSupport(),
    evaluatedAtUtc: "2026-02-01T00:00:00Z",
  });
  assert.equal(gates.ok, false);
  assert.ok(gates.reasons.some((reason) => reason.code === "REWARD_CONFIG_NOT_FROZEN"));
});

test("IMP-19 §11.5 · la candidate debe ser nueva y partir de una comparación evaluada", () => {
  const holder = createActivePolicyVersionHolder({ initialVersion: "policy-v1" });
  const same = produceCandidatePolicyVersion({ activeVersionHolder: holder, candidateVersion: "policy-v1", learnerComparison: bestComparison(), provenance: { kind: "test" } });
  assert.equal(same.ok, false);
  assert.equal(same.code, "CANDIDATE_EQUALS_ACTIVE");

  const noComparison = produceCandidatePolicyVersion({ activeVersionHolder: holder, candidateVersion: "policy-v2", learnerComparison: null, provenance: { kind: "test" } });
  assert.equal(noComparison.ok, false);
  assert.equal(noComparison.code, "MISSING_LEARNER_COMPARISON");

  const ok = produceCandidatePolicyVersion({ activeVersionHolder: holder, candidateVersion: "policy-v2", learnerComparison: bestComparison(), producedAtUtc: "2026-02-01T00:00:00Z", provenance: { kind: "test" } });
  assert.equal(ok.ok, true);
  assert.equal(ok.candidate.basedOnActiveVersion, "policy-v1");
  assert.equal(holder.current(), "policy-v1");
});

test("IMP-19 §11.5/§15.4 · ciclo offline produce candidate revalidada y NO muta la activa", () => {
  const holder = createActivePolicyVersionHolder({ initialVersion: "policy-v1" });
  const cycle = runOfflineLearningCycle({
    activeVersionHolder: holder,
    corpus: supportCorpus(),
    corpusAudit: { scope: "SYNTHETIC_FIXTURE", sourceRef: "test/learning/fixtures.mjs" },
    rewardConfig: frozenRewardConfig(),
    supportEvaluation: sufficientSupport(),
    protocol: frozenProtocol(),
    candidateVersion: "policy-v2",
    learnerComparison: bestComparison(),
    revalidation: pathRevalidation(),
    producedAtUtc: "2026-02-01T00:00:00Z",
    evaluatedAtUtc: "2026-02-01T00:00:00Z",
    provenance: { kind: "test-fixture", authority: "test/learning/fixtures.mjs" },
  });
  assert.equal(cycle.ok, true);
  assert.equal(cycle.outcome, "CANDIDATE_REVALIDATED_FIXTURE_ONLY");
  assert.equal(cycle.revalidation.binding.verified, true);
  assert.equal(cycle.fixtureOnly, true);
  assert.equal(cycle.promotionRecommended, true);
  assert.equal(cycle.candidate.candidateVersion, "policy-v2");
  assert.equal(cycle.activeVersionUnchanged, true);
  assert.equal(holder.current(), "policy-v1");
  assert.equal(cycle.steps.length, 7);
  // Paso 7 (governance) pertenece a IMP-24; el ciclo no activa.
  assert.equal(cycle.steps[6].owner, "IMP-24");
  assert.match(cycle.note, /SYNTHETIC_FIXTURE/);
});

test("IMP-19 §11.5 · sin evidencia de revalidación válida la candidate queda en HOLD", () => {
  const holder = createActivePolicyVersionHolder({ initialVersion: "policy-v1" });
  const cycle = runOfflineLearningCycle({
    activeVersionHolder: holder,
    corpus: supportCorpus(),
    corpusAudit: { scope: "SYNTHETIC_FIXTURE", sourceRef: "test/learning/fixtures.mjs" },
    rewardConfig: frozenRewardConfig(),
    supportEvaluation: sufficientSupport(),
    protocol: frozenProtocol(),
    candidateVersion: "policy-v2",
    learnerComparison: bestComparison(),
    revalidation: pathRevalidation({ evidenceValid: false }),
    producedAtUtc: "2026-02-01T00:00:00Z",
    evaluatedAtUtc: "2026-02-01T00:00:00Z",
    provenance: { kind: "test-fixture" },
  });
  assert.equal(cycle.ok, true);
  assert.equal(cycle.outcome, "HOLD");
  assert.equal(cycle.promotionRecommended, false);
  assert.equal(holder.current(), "policy-v1");
  assert.equal(cycle.activeVersionUnchanged, true);
});

test("IMP-19 §15.4 · una revalidación sin evidencia referenciada se rechaza", () => {
  const holder = createActivePolicyVersionHolder({ initialVersion: "policy-v1" });
  const candidate = produceCandidatePolicyVersion({ activeVersionHolder: holder, candidateVersion: "policy-v2", learnerComparison: bestComparison(), provenance: { kind: "test" } }).candidate;
  const outcome = revalidateCandidate({ candidate, revalidation: { processRef: "rp", mode: "OOS", evaluatedAtUtc: "2026-02-01T00:00:00Z", evidenceValid: true } });
  assert.equal(outcome.ok, false);
  assert.equal(outcome.code, "INVALID_REVALIDATION");
  assert.ok(outcome.errors.some((error) => error.code === "MISSING_EVIDENCE_REF"));
});

test("IMP-19 §25.2.1 · construir el soporte no cierra DEP-19/20/21", () => {
  const holder = createActivePolicyVersionHolder({ initialVersion: "policy-v1" });
  const support = sufficientSupport();
  const comparison = bestComparison();
  const cycle = runOfflineLearningCycle({
    activeVersionHolder: holder,
    corpus: supportCorpus(),
    corpusAudit: { scope: "SYNTHETIC_FIXTURE", sourceRef: "test/learning/fixtures.mjs" },
    rewardConfig: frozenRewardConfig(),
    supportEvaluation: support,
    protocol: frozenProtocol(),
    candidateVersion: "policy-v2",
    learnerComparison: comparison,
    revalidation: pathRevalidation(),
    producedAtUtc: "2026-02-01T00:00:00Z",
    evaluatedAtUtc: "2026-02-01T00:00:00Z",
    provenance: { kind: "test-fixture" },
  });
  const evidence = materializeLearningEvidence({
    rewardConfig: frozenRewardConfig(),
    supportEvaluation: support,
    protocol: frozenProtocol(),
    learnerComparison: comparison,
    candidate: cycle.candidate,
    revalidation: cycle.revalidation,
    cycle,
    scope: "SYNTHETIC_FIXTURE",
    producedAtUtc: "2026-02-01T00:00:00Z",
  });
  assert.equal(evidence.ok, true);
  assert.equal(evidence.bundle.closedByConstruction, false);
  assert.equal(evidence.bundle.fixtureOnly, true);
  assert.deepEqual(evidence.bundle.depClosure, { "DEP-19": DEP_STATUS.OPEN, "DEP-20": DEP_STATUS.OPEN, "DEP-21": DEP_STATUS.OPEN });
  assert.match(evidence.bundle.note, /PRODUCES_EVIDENCE/);
});
test("IMP19-H1 §11.5 paso 3 · ventana/campaña abierta no produce candidate", () => {
  const holder = createActivePolicyVersionHolder({ initialVersion: "policy-v1" });
  const cycle = runOfflineLearningCycle({
    activeVersionHolder: holder,
    corpus: [
      syntheticExperienceRecord({ campaignId: "GAS-Q-2024Q1", action: "BUY" }),
      syntheticExperienceRecord({ campaignId: "GAS-Q-2024Q1", action: "WAIT" }),
    ],
    corpusAudit: { scope: "SYNTHETIC_FIXTURE", sourceRef: "test/learning/fixtures.mjs" },
    rewardConfig: frozenRewardConfig(),
    supportEvaluation: sufficientSupport(),
    protocol: frozenProtocol(),
    candidateVersion: "policy-v2",
    learnerComparison: bestComparison(),
    revalidation: pathRevalidation(),
    producedAtUtc: "2026-02-01T00:00:00Z",
    evaluatedAtUtc: "2026-02-01T00:00:00Z",
    provenance: { kind: "test-fixture" },
  });
  assert.equal(cycle.ok, false);
  assert.equal(cycle.code, "LEARNING_GATES_NOT_SATISFIED");
  assert.ok(cycle.reasons.some((reason) => reason.code === "EVALUATION_WINDOW_NOT_CLOSED"));
  assert.equal(cycle.steps[2].step, 3);
  assert.equal(cycle.steps[2].executed, false);
  assert.equal(cycle.steps[2].openRecords, 2);
  assert.equal(cycle.activeVersionUnchanged, true);
  assert.equal(holder.current(), "policy-v1");
  assert.equal(evaluateLearningGates({
    corpus: [syntheticExperienceRecord()],
    corpusAudit: { scope: "SYNTHETIC_FIXTURE", sourceRef: "test/learning/fixtures.mjs" },
    rewardConfig: frozenRewardConfig(),
    protocol: frozenProtocol(),
    supportEvaluation: sufficientSupport(),
  }).reasons.some((reason) => reason.code === "EVALUATION_WINDOW_NOT_CLOSED"), true);
});

test("IMP19-H2 §25.1 · evidencia testiguada a la mano sin proceso congelado no revalida", () => {
  const holder = createActivePolicyVersionHolder({ initialVersion: "policy-v1" });
  const candidate = produceCandidatePolicyVersion({ activeVersionHolder: holder, candidateVersion: "policy-v2", learnerComparison: bestComparison(), provenance: { kind: "test" } }).candidate;
  const outcome = revalidateCandidate({
    candidate,
    revalidation: { processRef: "frozen-shadow-process-v1", mode: "SHADOW", evaluatedAtUtc: "2026-02-01T00:00:00Z", evidenceValid: true, evidenceRef: "shadow-shakeout-1" },
  });
  assert.equal(outcome.ok, true);
  assert.equal(outcome.revalidated, false);
  assert.equal(outcome.verdict, "HOLD");
  assert.equal(outcome.binding.verified, false);
  assert.ok(outcome.binding.reasons.some((reason) => reason.code === "EVIDENCE_PROCESS_MALFORMED"));
});

test("IMP19-H2 §15.2 · proceso congelado alterado hace fallar el binding de la evidencia", () => {
  const holder = createActivePolicyVersionHolder({ initialVersion: "policy-v1" });
  const candidate = produceCandidatePolicyVersion({ activeVersionHolder: holder, candidateVersion: "policy-v2", learnerComparison: bestComparison(), provenance: { kind: "test" } }).candidate;
  const tampered = { ...frozenProcessFor(), contentHash: "0".repeat(64) };
  const outcome = revalidateCandidate({ candidate, revalidation: pathRevalidation({ overrides: { frozenProcess: tampered } }) });
  assert.equal(outcome.ok, true);
  assert.equal(outcome.revalidated, false);
  assert.equal(outcome.verdict, "HOLD");
  assert.ok(outcome.binding.reasons.some((reason) => reason.code === "EVIDENCE_PROCESS_HASH_MISMATCH"));
});

test("IMP19-H2 §25.1 · evidencia bindía a la candidate revalidada verificándose por hash", () => {
  const holder = createActivePolicyVersionHolder({ initialVersion: "policy-v1" });
  const candidate = produceCandidatePolicyVersion({ activeVersionHolder: holder, candidateVersion: "policy-v2", learnerComparison: bestComparison(), provenance: { kind: "test" } }).candidate;
  const process = frozenProcessFor();
  const evidence = materializeRevalidationEvidence({ process, candidate, evidenceRef: "shadow-shakeout-1" }).evidence;
  const verified = revalidateCandidate({ candidate, revalidation: pathRevalidation({ overrides: { evidence } }) });
  assert.equal(verified.ok, true);
  assert.equal(verified.revalidated, true);
  assert.equal(verified.binding.verified, true);

  const otherCandidate = produceCandidatePolicyVersion({ activeVersionHolder: holder, candidateVersion: "policy-v3", learnerComparison: bestComparison(), provenance: { kind: "test" } }).candidate;
  const mismatch = revalidateCandidate({ candidate: otherCandidate, revalidation: pathRevalidation({ overrides: { evidence } }) });
  assert.equal(mismatch.ok, true);
  assert.equal(mismatch.revalidated, false);
  assert.equal(mismatch.verdict, "HOLD");
  assert.ok(mismatch.binding.reasons.some((reason) => reason.code === "EVIDENCE_NOT_BOUND_TO_CANDIDATE"));
});
