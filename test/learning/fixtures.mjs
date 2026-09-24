// Fixtures sintéticos para tests de learning (IMP-19). Nada aquí son datos
// reales del cliente: los records se marcan synthetic y los MDP/parámetros son
// MECÁNICA de ingeniería, no evidencia de edge ni cierre de DEP-19/20/21. El
// scope SYNTHETIC_FIXTURE del corpusAudit lo hace explícito en el ciclo.

import { buildExperienceRecord, closeExperienceRecord } from "../../src/experience/index.mjs";
import { contentHashOf } from "../../src/execution-contract/execution-contract.mjs";
import { GLOBAL_REWARD_ID } from "../../src/learning/reward.mjs";
import { buildLearningProtocol, LEARNING_PROTOCOL_KIND } from "../../src/learning/protocol.mjs";
import {
  freezeOosShadowProcessArtifact,
  materializeRevalidationEvidence,
} from "../../src/learning/offline-cycle.mjs";

export function frozenProcessFor({ processRef = "frozen-shadow-process-v1", mode = "SHADOW", frozenAtUtc = "2026-01-01T00:00:00Z" } = {}) {
  const frozen = freezeOosShadowProcessArtifact({ processRef, mode, frozenAtUtc, declaredBy: "test-fixture (sintético, IMP-19)" });
  if (!frozen.ok) {
    throw new Error(`fixture process inválido: ${JSON.stringify(frozen.errors)}`);
  }
  return frozen.process;
}

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

// Protocolo content-addressed armado a mano (hash válido) pero con contrato
// semántico inválido: sirve para probar que el gate no confía en la sola
// integridad del hash (§25.2.3 IMP-19: "congelado y autorizado").
export function forgedFrozenProtocol(overrides = {}) {
  const core = {
    protocolKind: LEARNING_PROTOCOL_KIND,
    schemaVersion: "1.0",
    protocolVersion: "forged-protocol-v1",
    state: "FROZEN",
    declaredBy: "test-fixture (forjado, IMP-19)",
    frozenAtUtc: "2026-01-01T00:00:00Z",
    mixtureDeclaration: {
      declarationVersion: "mix-v1",
      declaredBy: "test-fixture (forjado, IMP-19)",
      weights: { REPLAY: 1 },
    },
    cadence: { reviewTrigger: "campaign_close", trainingTrigger: "window_close" },
    ...overrides,
  };
  core.contentHash = contentHashOf(core);
  return core;
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

export function closedWindowOutcome() {
  return { reward: 1, benchmarkVersion: "FIXTURE-BENCHMARK-V1" };
}

// §11.5 paso 3: el corpus del ciclo debe estar en cierre de ventana/campaña
// (records CLOSED, §12.2). El cierre produce un record NUEVO (append-only).
// synthetic=true por defecto (fixtures sintéticos); el cotejo real/synthetic
// del ciclo (IMP19-R2) usa synthetic=false para el camino REAL_DATA del test.
export function supportCorpus({ synthetic = true } = {}) {
  const openRecords = [
    syntheticExperienceRecord({ campaignId: "GAS-Q-2024Q1", action: "BUY", overrides: { synthetic } }),
    syntheticExperienceRecord({ campaignId: "GAS-Q-2024Q1", action: "WAIT", overrides: { synthetic } }),
    syntheticExperienceRecord({ campaignId: "GAS-Q-2024Q2", action: "BUY", overrides: { synthetic } }),
    syntheticExperienceRecord({ campaignId: "GAS-Q-2024Q2", action: "WAIT", overrides: { synthetic } }),
  ];
  return openRecords.map((record) => {
    const closed = closeExperienceRecord({ record, outcome: closedWindowOutcome() });
    if (!closed.ok) {
      throw new Error(`fixture closure inválida: ${JSON.stringify(closed.errors)}`);
    }
    return closed.record;
  });
}

export function markovStateDeclaration() {
  return {
    stateEncoding: "synthetic-[ProcurementState]",
    memory: { kind: "MARKOV", evidenceRef: "test/learning/fixtures.mjs#markov" },
  };
}

// IMP19-R2 (revisión 2026-09-24): la evidencia la materializa el caller (quien
// ejecutó el proceso congelado), contra una candidate concreta; el binding la
// verifica, nunca la fabrica. La marca fixtureOnly (true en fixtures
// sintéticos) queda sellada en el hash de la evidencia.
export function pathRevalidation({
  candidate,
  processRef = "frozen-shadow-process-v1",
  mode = "SHADOW",
  frozenAtUtc = "2026-01-01T00:00:00Z",
  evidenceValid = true,
  evaluatedAtUtc = "2026-02-01T00:00:00Z",
  fixtureOnly = true,
  overrides = {},
} = {}) {
  const frozenProcess = freezeOosShadowProcessArtifact({ processRef, mode, frozenAtUtc, declaredBy: "test-fixture (sintético, IMP-19)" }).process;
  const materialized = materializeRevalidationEvidence({ process: frozenProcess, candidate, evidenceRef: "shadow-shakeout-1", producedAtUtc: evaluatedAtUtc, fixtureOnly });
  if (!materialized.ok) {
    throw new Error(`fixture evidence inválida: ${JSON.stringify(materialized.errors)}`);
  }
  return {
    processRef,
    mode,
    evaluatedAtUtc,
    evidenceValid,
    evidenceRef: "shadow-shakeout-1",
    frozenProcess,
    evidence: materialized.evidence,
    ...overrides,
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