// Fixtures sintéticos para tests de learning (IMP-19). Nada aquí son datos
// reales del cliente: los records se marcan synthetic y los MDP/parámetros son
// MECÁNICA de ingeniería, no evidencia de edge ni cierre de DEP-19/20/21. El
// scope SYNTHETIC_FIXTURE del corpusAudit lo hace explícito en el ciclo.

import { buildExperienceRecord } from "../../src/experience/index.mjs";
import { GLOBAL_REWARD_ID } from "../../src/learning/reward.mjs";
import { buildLearningProtocol } from "../../src/learning/protocol.mjs";

export function frozenRewardConfig(overrides = {}) {
  return {
    configVersion: "reward-config-v1",
    state: "FROZEN",
    frozenAtUtc: "2026-01-01T00:00:00Z",
    declaredBy: "test-fixture (sintético, IMP-19)",
    costsEnteredOnceInH: true,
    reward: {
      rewardId: GLOBAL_REWARD_ID,
      anchoredToProcurementValue: true,
      localRewards: [],
      perStrategyReward: false,
      costsReenteredInReward: false,
    },
    transform: { kind: "IDENTITY", formula: "g(V)=V" },
    ...overrides,
  };
}

export function openRewardConfig(overrides = {}) {
  return {
    configVersion: "reward-config-open",
    state: "OPEN",
    costsEnteredOnceInH: true,
    reward: {
      rewardId: GLOBAL_REWARD_ID,
      anchoredToProcurementValue: true,
      localRewards: [],
    },
    transform: null,
    ...overrides,
  };
}

export function frozenProtocol(overrides = {}) {
  const built = buildLearningProtocol({
    protocolVersion: "dep21-protocol-v1",
    declaredBy: "test-fixture (sintético, IMP-19)",
    mixtureDeclaration: {
      declarationVersion: "mix-v1",
      declaredBy: "test-fixture (sintético, IMP-19)",
      weights: { REPLAY: 1, SHADOW: 0, REAL_EXECUTION: 0 },
    },
    cadence: { reviewTrigger: "campaign_close", trainingTrigger: "window_close", minClosedCampaigns: 2 },
    state: "FROZEN",
    frozenAtUtc: "2026-01-01T00:00:00Z",
    ...overrides,
  });
  if (!built.ok) {
    throw new Error(`fixture protocol inválido: ${JSON.stringify(built.errors)}`);
  }
  return built.protocol;
}

export function syntheticExperienceRecord({ policyVersion = "policy-v1", campaignId = "GAS-Q-2024Q1", action = "BUY", sourceType = "REPLAY", overrides = {} } = {}) {
  const built = buildExperienceRecord({
    recordState: "OPEN",
    sourceType,
    policyVersion,
    stateSnapshot: {
      frontierUtc: "2026-01-05T11:00:00Z",
      frontierDate: "2026-01-05",
      pitReferences: [],
      dataReference: { kind: "PIT_DATA_MANIFEST", manifestId: "FIXTURE-MANIFEST", manifestVersion: "v1" },
    },
    strategyOutputs: [],
    recommendedAction: action,
    execution: null,
    humanIntervention: null,
    nextState: { source: "test-fixture", campaignId, remainingVolume: 50, unit: "MW" },
    outcome: null,
    recommendedAtUtc: "2026-01-05T11:00:00Z",
    recordedAtUtc: "2026-01-05T11:05:00Z",
    synthetic: true,
    provenance: { kind: "test-fixture-assertion", campaignId, authority: "test/learning/fixtures.mjs" },
    ...overrides,
  });
  if (!built.ok) {
    throw new Error(`fixture record inválido: ${JSON.stringify(built.errors)}`);
  }
  return built.record;
}

export function supportCorpus() {
  return [
    syntheticExperienceRecord({ campaignId: "GAS-Q-2024Q1", action: "BUY" }),
    syntheticExperienceRecord({ campaignId: "GAS-Q-2024Q1", action: "WAIT" }),
    syntheticExperienceRecord({ campaignId: "GAS-Q-2024Q2", action: "BUY" }),
    syntheticExperienceRecord({ campaignId: "GAS-Q-2024Q2", action: "WAIT" }),
  ];
}

export function markovStateDeclaration() {
  return {
    stateEncoding: "synthetic-[ProcurementState]",
    memory: { kind: "MARKOV", evidenceRef: "test/learning/fixtures.mjs#markov" },
  };
}

// MDP declarado (BUY/WAIT), terminando en TERM. La acción óptima difiere por
// estado para que una policy fija no alcance el óptimo: así el learner compite
// por mérito y un baseline puede ganar/empatar según el caso.
export const SYNTHETIC_MDP = Object.freeze({
  states: ["A", "B", "TERM"],
  actions: ["BUY", "WAIT"],
  transitions: [
    { state: "A", action: "BUY", nextState: "TERM", probability: 1, reward: 10 },
    { state: "A", action: "WAIT", nextState: "TERM", probability: 1, reward: 0 },
    { state: "B", action: "BUY", nextState: "TERM", probability: 1, reward: 0 },
    { state: "B", action: "WAIT", nextState: "TERM", probability: 1, reward: 10 },
  ],
  initialStates: ["A", "B"],
});