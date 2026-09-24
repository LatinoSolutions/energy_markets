// Tests del ciclo offline y su evidencia (IMP-19). Fuente: SPEC v1.1.1 §11.5,
// §15.4, §25.1 fila IMP-19 ("Nueva versión revalidada con evidencia válida";
// "activo no muta"), §25.2.3 IMP-19 y §25.2 nota IMP-17. Correcciones de
// revisión: IMP19-H1/H2 (2026-09-24) e IMP19-R1/R2 (revisión 2026-09-24).

import test from "node:test";
import assert from "node:assert/strict";

import { contentHashOf } from "../../src/execution-contract/execution-contract.mjs";
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
  openRewardConfig,
  frozenProtocol,
  forgedFrozenProtocol,
  pathRevalidation,
  frozenProcessFor,
} from "./fixtures.mjs";

const GAMMA_JUSTIFICATION = "horizonte finito sin descuento económico justificado (§11.2)";
const mdpArgs = { states: SYNTHETIC_MDP.states, actions: SYNTHETIC_MDP.actions, transitions: SYNTHETIC_MDP.transitions };
const FIXED_PROVENANCE = { kind: "test-fixture", authority: "test/learning/fixtures.mjs" };
const PRODUCED_AT = "2026-02-01T00:00:00Z";
const REAL_DATA_AUDIT = { scope: "REAL_DATA", auditPitRightsValid: true, realDataAdequate: true, sourceRef: "corpus-real-ref" };

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

// Réplica determinística de la candidate del ciclo: el builder es
// determinístico (mismos inputs → mismo contentHash), así el test materializa
// ANTES la evidencia bindida a la candidate que después el ciclo produce,
// porque el binding ya no la auto-materializa (IMP19-R2).
function cycleCandidate({ holder, candidateVersion = "policy-v2", corpus, learnerComparison = bestComparison(), provenance = FIXED_PROVENANCE, producedAtUtc = PRODUCED_AT }) {
  const produced = produceCandidatePolicyVersion({
    activeVersionHolder: holder,
    candidateVersion,
    basedOnCorpusHash: contentHashOf(corpus),
    learnerComparison,
    producedAtUtc,
    provenance,
  });
  if (!produced.ok) {
    throw new Error(`fixture candidate inválida: ${produced.code}`);
  }
  return produced.candidate;
}

// Candidate directa (fuera del ciclo) para tests unitarios de revalidación.
function directCandidate(holder, candidateVersion = "policy-v2") {
  const produced = produceCandidatePolicyVersion({ activeVersionHolder: holder, candidateVersion, learnerComparison: bestComparison(), provenance: { kind: "test" } });
  if (!produced.ok) {
    throw new Error(produced.code);
  }
  return produced.candidate;
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

test("IMP-19 §25.2.3 · el gate exige protocolo con contrato autorizado, no sólo hash válido", () => {
  const holder = createActivePolicyVersionHolder({ initialVersion: "policy-v1" });
  const cycle = runOfflineLearningCycle({
    activeVersionHolder: holder,
    corpus: supportCorpus(),
    corpusAudit: { scope: "SYNTHETIC_FIXTURE", sourceRef: "test/learning/fixtures.mjs" },
    rewardConfig: frozenRewardConfig(),
    protocol: forgedFrozenProtocol({ mixtureDeclaration: null }),
    supportEvaluation: sufficientSupport(),
    candidateVersion: "policy-v2",
    learnerComparison: bestComparison(),
    revalidation: null,
    producedAtUtc: PRODUCED_AT,
    evaluatedAtUtc: "2026-02-01T00:00:00Z",
    provenance: FIXED_PROVENANCE,
  });
  assert.equal(cycle.ok, false);
  assert.equal(cycle.code, "LEARNING_GATES_NOT_SATISFIED");
  assert.ok(cycle.reasons.some((reason) => reason.code === "PROTOCOL_CONTRACT_INVALID"));
  assert.equal(cycle.activeVersionUnchanged, true);
  assert.equal(holder.current(), "policy-v1");
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
  const corpus = supportCorpus();
  const learnerComparison = bestComparison();
  const revalidation = pathRevalidation({ candidate: cycleCandidate({ holder, corpus, learnerComparison }) });
  const cycle = runOfflineLearningCycle({
    activeVersionHolder: holder,
    corpus,
    corpusAudit: { scope: "SYNTHETIC_FIXTURE", sourceRef: "test/learning/fixtures.mjs" },
    rewardConfig: frozenRewardConfig(),
    supportEvaluation: sufficientSupport(),
    protocol: frozenProtocol(),
    candidateVersion: "policy-v2",
    learnerComparison,
    revalidation,
    producedAtUtc: PRODUCED_AT,
    evaluatedAtUtc: "2026-02-01T00:00:00Z",
    provenance: FIXED_PROVENANCE,
  });
  assert.equal(cycle.ok, true);
  assert.equal(cycle.outcome, "CANDIDATE_REVALIDATED_FIXTURE_ONLY");
  assert.equal(cycle.revalidation.verdict, "REVALIDATED");
  assert.equal(cycle.revalidation.binding.verified, true);
  assert.equal(cycle.fixtureOnly, true);
  assert.equal(cycle.promotionRecommended, true);
  assert.equal(cycle.candidate.candidateVersion, "policy-v2");
  assert.equal(cycle.activeVersionUnchanged, true);
  assert.equal(holder.current(), "policy-v1");
  assert.equal(cycle.steps.length, 7);
  // Paso 7 (governance) pertenece a IMP-24; el ciclo no activa.
  assert.equal(cycle.steps[6].owner, "IMP-24");
  assert.match(cycle.note, /sintético/);
});

test("IMP-19 §11.5 · sin evidencia de revalidación válida la candidate queda en HOLD", () => {
  const holder = createActivePolicyVersionHolder({ initialVersion: "policy-v1" });
  const corpus = supportCorpus();
  const learnerComparison = bestComparison();
  const revalidation = pathRevalidation({ candidate: cycleCandidate({ holder, corpus, learnerComparison }), evidenceValid: false });
  const cycle = runOfflineLearningCycle({
    activeVersionHolder: holder,
    corpus,
    corpusAudit: { scope: "SYNTHETIC_FIXTURE", sourceRef: "test/learning/fixtures.mjs" },
    rewardConfig: frozenRewardConfig(),
    supportEvaluation: sufficientSupport(),
    protocol: frozenProtocol(),
    candidateVersion: "policy-v2",
    learnerComparison,
    revalidation,
    producedAtUtc: PRODUCED_AT,
    evaluatedAtUtc: "2026-02-01T00:00:00Z",
    provenance: FIXED_PROVENANCE,
  });
  assert.equal(cycle.ok, true);
  assert.equal(cycle.outcome, "HOLD");
  assert.equal(cycle.promotionRecommended, false);
  assert.equal(holder.current(), "policy-v1");
  assert.equal(cycle.activeVersionUnchanged, true);
});

test("IMP-19 §15.4 · una revalidación sin evidencia referenciada se rechaza", () => {
  const holder = createActivePolicyVersionHolder({ initialVersion: "policy-v1" });
  const candidate = directCandidate(holder);
  const outcome = revalidateCandidate({ candidate, revalidation: { processRef: "rp", mode: "OOS", evaluatedAtUtc: "2026-02-01T00:00:00Z", evidenceValid: true } });
  assert.equal(outcome.ok, false);
  assert.equal(outcome.code, "INVALID_REVALIDATION");
  assert.ok(outcome.errors.some((error) => error.code === "MISSING_EVIDENCE_REF"));
});

test("IMP-19 §25.2.1 · construir el soporte no cierra DEP-19/20/21", () => {
  const holder = createActivePolicyVersionHolder({ initialVersion: "policy-v1" });
  const support = sufficientSupport();
  const comparison = bestComparison();
  const corpus = supportCorpus();
  const revalidation = pathRevalidation({ candidate: cycleCandidate({ holder, corpus, learnerComparison: comparison }) });
  const cycle = runOfflineLearningCycle({
    activeVersionHolder: holder,
    corpus,
    corpusAudit: { scope: "SYNTHETIC_FIXTURE", sourceRef: "test/learning/fixtures.mjs" },
    rewardConfig: frozenRewardConfig(),
    supportEvaluation: support,
    protocol: frozenProtocol(),
    candidateVersion: "policy-v2",
    learnerComparison: comparison,
    revalidation,
    producedAtUtc: PRODUCED_AT,
    evaluatedAtUtc: "2026-02-01T00:00:00Z",
    provenance: FIXED_PROVENANCE,
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
    producedAtUtc: PRODUCED_AT,
  });
  assert.equal(evidence.ok, true);
  assert.equal(evidence.bundle.closedByConstruction, false);
  assert.equal(evidence.bundle.fixtureOnly, true);
  assert.deepEqual(evidence.bundle.depClosure, { "DEP-19": DEP_STATUS.OPEN, "DEP-20": DEP_STATUS.OPEN, "DEP-21": DEP_STATUS.OPEN });
  assert.match(evidence.bundle.note, /PRODUCES_EVIDENCE/);
});

test("IMP19-H1 §11.5 paso 3 · ventana/campaña abierta no produce candidate", () => {
  const holder = createActivePolicyVersionHolder({ initialVersion: "policy-v1" });
  const openCorpus = [
    syntheticExperienceRecord({ campaignId: "GAS-Q-2024Q1", action: "BUY" }),
    syntheticExperienceRecord({ campaignId: "GAS-Q-2024Q1", action: "WAIT" }),
  ];
  const revalidation = pathRevalidation({ candidate: cycleCandidate({ holder, corpus: openCorpus }) });
  const cycle = runOfflineLearningCycle({
    activeVersionHolder: holder,
    corpus: openCorpus,
    corpusAudit: { scope: "SYNTHETIC_FIXTURE", sourceRef: "test/learning/fixtures.mjs" },
    rewardConfig: frozenRewardConfig(),
    supportEvaluation: sufficientSupport(),
    protocol: frozenProtocol(),
    candidateVersion: "policy-v2",
    learnerComparison: bestComparison(),
    revalidation,
    producedAtUtc: PRODUCED_AT,
    evaluatedAtUtc: "2026-02-01T00:00:00Z",
    provenance: FIXED_PROVENANCE,
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
  const candidate = directCandidate(holder);
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
  const candidate = directCandidate(holder);
  const tampered = { ...frozenProcessFor(), contentHash: "0".repeat(64) };
  const outcome = revalidateCandidate({ candidate, revalidation: pathRevalidation({ candidate, overrides: { frozenProcess: tampered } }) });
  assert.equal(outcome.ok, true);
  assert.equal(outcome.revalidated, false);
  assert.equal(outcome.verdict, "HOLD");
  assert.ok(outcome.binding.reasons.some((reason) => reason.code === "EVIDENCE_PROCESS_HASH_MISMATCH"));
});

test("IMP19-H2 §25.1 · evidencia bindía a la candidate revalidada verificándose por hash", () => {
  const holder = createActivePolicyVersionHolder({ initialVersion: "policy-v1" });
  const candidate = directCandidate(holder);
  const revalidation = pathRevalidation({ candidate });
  const verified = revalidateCandidate({ candidate, revalidation });
  assert.equal(verified.ok, true);
  assert.equal(verified.revalidated, true);
  assert.equal(verified.verdict, "REVALIDATED");
  assert.equal(verified.binding.verified, true);

  const otherCandidate = directCandidate(holder, "policy-v3");
  const mismatch = revalidateCandidate({ candidate: otherCandidate, revalidation: pathRevalidation({ candidate }) });
  assert.equal(mismatch.ok, true);
  assert.equal(mismatch.revalidated, false);
  assert.equal(mismatch.verdict, "HOLD");
  assert.ok(mismatch.binding.reasons.some((reason) => reason.code === "EVIDENCE_NOT_BOUND_TO_CANDIDATE"));
});

// IMP19-R1 (revisión 2026-09-24): el verdict se deriva del binding verificable;
// el input del caller (verdict declarado) nunca lo fija. Reproducción del
// hallazgo: evidenceValid:true + verdict:"REVALIDATED" + proceso malformado →
// revalidated:false PERO verdict:"REVALIDATED" (doble verdad).
test("IMP19-R1 §25.1 · el verdict declarado por el caller no sobrevive a un binding fallido", () => {
  const holder = createActivePolicyVersionHolder({ initialVersion: "policy-v1" });
  const candidate = directCandidate(holder);
  const outcome = revalidateCandidate({
    candidate,
    revalidation: {
      processRef: "frozen-shadow-process-v1",
      mode: "OOS",
      evaluatedAtUtc: "2026-02-01T00:00:00Z",
      evidenceValid: true,
      evidenceRef: "shadow-shakeout-1",
      verdict: "REVALIDATED",
    },
  });
  assert.equal(outcome.ok, true);
  assert.equal(outcome.revalidated, false);
  assert.equal(outcome.verdict, "HOLD");
  assert.equal(outcome.binding.verified, false);

  const negative = revalidateCandidate({
    candidate,
    revalidation: { processRef: "rp", mode: "OOS", evaluatedAtUtc: "2026-02-01T00:00:00Z", evidenceValid: false, evidenceRef: "ref", verdict: "REVALIDATED" },
  });
  assert.equal(negative.revalidated, false);
  assert.equal(negative.verdict, "HOLD");
});

// IMP19-R2 (revisión 2026-09-24): el binding no materializa la evidencia que
// verifica; sin evidencia aportada no hay revalidación.
test("IMP19-R2 §15.2 · el binding no fabrica la evidencia que verifica", () => {
  const holder = createActivePolicyVersionHolder({ initialVersion: "policy-v1" });
  const candidate = directCandidate(holder);
  const outcome = revalidateCandidate({
    candidate,
    revalidation: {
      processRef: "frozen-shadow-process-v1",
      mode: "SHADOW",
      evaluatedAtUtc: "2026-02-01T00:00:00Z",
      evidenceValid: true,
      evidenceRef: "shadow-shakeout-1",
      frozenProcess: frozenProcessFor(),
      evidence: undefined,
    },
  });
  assert.equal(outcome.ok, true);
  assert.equal(outcome.revalidated, false);
  assert.equal(outcome.verdict, "HOLD");
  assert.ok(outcome.binding.reasons.some((reason) => reason.code === "EVIDENCE_NOT_PROVIDED"));
});

// IMP19-R2 (revisión 2026-09-24): REAL_DATA no acepta records synthetic:true;
// un corpus sintético bajo scope declarado real no produce candidate.
test("IMP19-R2 §25.2.3 · REAL_DATA no acepta records synthetic:true", () => {
  const gates = evaluateLearningGates({
    corpus: [syntheticExperienceRecord()],
    corpusAudit: REAL_DATA_AUDIT,
    rewardConfig: frozenRewardConfig(),
    protocol: frozenProtocol(),
    supportEvaluation: sufficientSupport(),
  });
  assert.equal(gates.ok, false);
  assert.ok(gates.reasons.some((reason) => reason.code === "REAL_DATA_WITH_SYNTHETIC_RECORDS"));

  const holder = createActivePolicyVersionHolder({ initialVersion: "policy-v1" });
  const cycle = runOfflineLearningCycle({
    activeVersionHolder: holder,
    corpus: supportCorpus(),
    corpusAudit: REAL_DATA_AUDIT,
    rewardConfig: frozenRewardConfig(),
    supportEvaluation: sufficientSupport(),
    protocol: frozenProtocol(),
    candidateVersion: "policy-v2",
    learnerComparison: bestComparison(),
    revalidation: pathRevalidation({ candidate: cycleCandidate({ holder, corpus: supportCorpus() }) }),
    producedAtUtc: PRODUCED_AT,
    evaluatedAtUtc: "2026-02-01T00:00:00Z",
    provenance: FIXED_PROVENANCE,
  });
  assert.equal(cycle.ok, false);
  assert.equal(cycle.code, "LEARNING_GATES_NOT_SATISFIED");
  assert.ok(cycle.reasons.some((reason) => reason.code === "REAL_DATA_WITH_SYNTHETIC_RECORDS"));
});

// IMP19-R2 (revisión 2026-09-24): la evidencia lleva su marca fixtureOnly
// sellada por hash y el calificador FIXTURE_ONLY del outcome deriva de ella y
// del cotejo del corpus, no sólo de corpusAudit.scope.
test("IMP19-R2 §25.2.3 · la marca fixtureOnly de la evidencia cualifica el outcome", () => {
  const holder = createActivePolicyVersionHolder({ initialVersion: "policy-v1" });
  const corpus = supportCorpus({ synthetic: false });
  const learnerComparison = bestComparison();
  const candidate = cycleCandidate({ holder, corpus, learnerComparison });

  const syntheticRun = runOfflineLearningCycle({
    activeVersionHolder: holder,
    corpus,
    corpusAudit: REAL_DATA_AUDIT,
    rewardConfig: frozenRewardConfig(),
    supportEvaluation: sufficientSupport(),
    protocol: frozenProtocol(),
    candidateVersion: "policy-v2",
    learnerComparison,
    revalidation: pathRevalidation({ candidate, fixtureOnly: true }),
    producedAtUtc: PRODUCED_AT,
    evaluatedAtUtc: "2026-02-01T00:00:00Z",
    provenance: FIXED_PROVENANCE,
  });
  assert.equal(syntheticRun.outcome, "CANDIDATE_REVALIDATED_FIXTURE_ONLY");
  assert.equal(syntheticRun.fixtureOnly, true);

  const realRun = runOfflineLearningCycle({
    activeVersionHolder: holder,
    corpus,
    corpusAudit: REAL_DATA_AUDIT,
    rewardConfig: frozenRewardConfig(),
    supportEvaluation: sufficientSupport(),
    protocol: frozenProtocol(),
    candidateVersion: "policy-v2",
    learnerComparison,
    revalidation: pathRevalidation({ candidate, fixtureOnly: false }),
    producedAtUtc: PRODUCED_AT,
    evaluatedAtUtc: "2026-02-01T00:00:00Z",
    provenance: FIXED_PROVENANCE,
  });
  assert.equal(realRun.outcome, "CANDIDATE_REVALIDATED");
  assert.equal(realRun.fixtureOnly, false);
});

// La marca es parte de la identidad content-addressed de la evidencia: sin ella
// el materializador falla y el binding exige su presencia.
test("IMP19-R2 §25.2.3 · la evidencia sin marca fixtureOnly no se materializa ni verifica", () => {
  const holder = createActivePolicyVersionHolder({ initialVersion: "policy-v1" });
  const candidate = directCandidate(holder);
  const unmarked = materializeRevalidationEvidence({ process: frozenProcessFor(), candidate, evidenceRef: "shadow-shakeout-1" });
  assert.equal(unmarked.ok, false);
  assert.ok(unmarked.errors.some((error) => error.code === "MISSING_REAL_MARK"));
});

// IMP19-R3 (revisión 2026-09-24): si la comparación por mérito refuta al
// learner (§25.1/§25.2.3 IMP-19: "Q-learning compite por mérito"; "si la prueba
// refuta al learner, se registra el resultado"), el ciclo NO produce
// recomendación de promoción ni outcome CANDIDATE_REVALIDATED. Reproducción
// del hallazgo: learnerComparison refutado → outcome positivo y
// promotionRecommended:true con candidate.learnerRefuted:true (doble verdad).
test("IMP19-R3 §25.2.3 · learner refutado por mérito no queda recomendado para promoción", () => {
  const holder = createActivePolicyVersionHolder({ initialVersion: "policy-v1" });
  const corpus = supportCorpus();
  const refutedComparison = comparePoliciesByMerit({
    candidate: { name: "ALWAYS_BUY", policy: fixedPolicy({ states: SYNTHETIC_MDP.states, action: "BUY" }).policy },
    baselines: [
      { name: "LEARNER_OPTIMAL", policy: { A: "BUY", B: "WAIT", TERM: "WAIT" } },
    ],
    ...mdpArgs,
    gamma: 1,
    horizon: "finite",
    gammaJustification: GAMMA_JUSTIFICATION,
    initialStates: SYNTHETIC_MDP.initialStates,
  });
  assert.equal(refutedComparison.ok, true);
  assert.equal(refutedComparison.refuted, true);
  assert.equal(refutedComparison.selectedByMerit, false);
  const revalidation = pathRevalidation({ candidate: cycleCandidate({ holder, corpus, learnerComparison: refutedComparison }) });
  const cycle = runOfflineLearningCycle({
    activeVersionHolder: holder,
    corpus,
    corpusAudit: { scope: "SYNTHETIC_FIXTURE", sourceRef: "test/learning/fixtures.mjs" },
    rewardConfig: frozenRewardConfig(),
    supportEvaluation: sufficientSupport(),
    protocol: frozenProtocol(),
    candidateVersion: "policy-v2",
    learnerComparison: refutedComparison,
    revalidation,
    producedAtUtc: PRODUCED_AT,
    evaluatedAtUtc: "2026-02-01T00:00:00Z",
    provenance: FIXED_PROVENANCE,
  });
  assert.equal(cycle.ok, true);
  assert.equal(cycle.candidate.learnerRefuted, true);
  assert.equal(cycle.revalidation.revalidated, true);
  assert.equal(cycle.outcome, "LEARNER_REFUTED_FIXTURE_ONLY");
  assert.ok(!cycle.outcome.includes("CANDIDATE_REVALIDATED"));
  assert.equal(cycle.promotionRecommended, false);
  assert.match(cycle.note, /refuta al learner/);
  assert.equal(cycle.activeVersionUnchanged, true);
  assert.equal(holder.current(), "policy-v1");
});

// IMP19-R4 (revisión 2026-09-24): la traza del ciclo debe tener UNA sola
// entrada por paso y con estado consistente. Reproducción del hallazgo: con
// ventana cerrada y un gate fallido (reward OPEN) la traza contenía el paso 4
// DOS veces (executed:true y luego executed:false).
test("IMP19-R4 §11.5 · la traza del ciclo no duplica pasos ni se contradice", () => {
  const holder = createActivePolicyVersionHolder({ initialVersion: "policy-v1" });
  const truncated = runOfflineLearningCycle({
    activeVersionHolder: holder,
    corpus: supportCorpus(),
    corpusAudit: { scope: "SYNTHETIC_FIXTURE", sourceRef: "test/learning/fixtures.mjs" },
    rewardConfig: openRewardConfig(),
    supportEvaluation: sufficientSupport(),
    protocol: frozenProtocol(),
    candidateVersion: "policy-v2",
    learnerComparison: bestComparison(),
    revalidation: pathRevalidation({ candidate: cycleCandidate({ holder, corpus: supportCorpus() }) }),
    producedAtUtc: PRODUCED_AT,
    evaluatedAtUtc: "2026-02-01T00:00:00Z",
    provenance: FIXED_PROVENANCE,
  });
  assert.equal(truncated.ok, false);
  assert.equal(truncated.code, "LEARNING_GATES_NOT_SATISFIED");
  const step4Entries = truncated.steps.filter((entry) => entry.step === 4);
  assert.equal(step4Entries.length, 1);
  assert.equal(step4Entries[0].executed, false);
  const windowOpen = runOfflineLearningCycle({
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
    revalidation: pathRevalidation({ candidate: cycleCandidate({ holder, corpus: [syntheticExperienceRecord()] }) }),
    producedAtUtc: PRODUCED_AT,
    evaluatedAtUtc: "2026-02-01T00:00:00Z",
    provenance: FIXED_PROVENANCE,
  });
  assert.equal(windowOpen.ok, false);
  assert.equal(windowOpen.steps.filter((entry) => entry.step === 4).length, 1);
});
