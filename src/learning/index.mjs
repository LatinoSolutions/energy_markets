// Superficie del ciclo offline y aprendizaje Value/Policy (IMP-19). Fuente:
// SPEC v1.1.1 §25.1 fila IMP-19 ("Implementar ciclo offline y evaluar
// Value/Policy Learning"; acceptance "Nueva versión revalidada con evidencia
// válida; reward global; Q-learning compite por mérito"; MUST NOT "Bellman/
// value explícitos, algoritmo no obligatorio; gamma/tau no arbitrarios; activo
// no muta") y §25.2 fila IMP-19 (DEP-19/20/21). Secciones fuente: §§9–12,15.

export {
  GLOBAL_REWARD_ID,
  REWARD_ANCHOR,
  REWARD_CONFIG_STATES,
  CANONICAL_IDENTITY_TRANSFORM,
  assertSingleGlobalReward,
  validateRewardConfiguration,
  evaluateReward,
  contributionOf,
} from "./reward.mjs";

export {
  SUPPORT_STATUS,
  evaluateActionSupport,
  evaluateCampaignSamples,
  evaluateMarkovAdequacy,
  evaluateSupportSufficiency,
  campaignIdentityOf,
} from "./support.mjs";

export {
  BELLMAN,
  VALUE_FUNCTIONS,
  FIRST_RL_CANDIDATE,
  STOCHASTIC_POLICY,
  assertDiscountingDeclared,
  valueIteration,
  qLearning,
  fixedPolicy,
  evaluatePolicy,
  comparePoliciesByMerit,
} from "./value-learner.mjs";

export {
  LEARNING_PROTOCOL_KIND,
  LEARNING_PROTOCOL_STATES,
  buildLearningProtocol,
  isLearningProtocol,
  assertProtocolFrozenBeforeEvaluation,
} from "./protocol.mjs";

export {
  CANDIDATE_POLICY_KIND,
  CYCLE_STEPS,
  assertExperienceCorpus,
  evaluateLearningGates,
  produceCandidatePolicyVersion,
  revalidateCandidate,
  runOfflineLearningCycle,
} from "./offline-cycle.mjs";

export {
  DEP_EVIDENCE_KINDS,
  DEP_STATUS,
  LEARNING_EVIDENCE_KIND,
  materializeLearningEvidence,
} from "./evidence.mjs";