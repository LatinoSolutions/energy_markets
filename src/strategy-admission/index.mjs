// Superficie del Strategy Admission framework (ST-27.1). Fuente: SPEC v1.1
// §§8.7.1–8.7.4 (canales, contrato común, lifecycle y autoridad). Los
// consumidores importan este módulo directamente; no se modifica la superficie
// aceptada de src/contracts/index.mjs.

export {
  CHANNEL,
  CHANNEL_IDS,
  INTAKE_CHANNELS,
  isChannelId,
  validateChannelProvenance,
} from "./channels.mjs";

export {
  IDENTITY_FIELDS,
  RESERVED_STRATEGY_IDS,
  STRATEGY_CONTRACT_FIELDS,
  STRATEGY_CONTRACT_FIELD_KEYS,
  missingContractContent,
  validateStrategyCandidate,
  validateStrategyRegistration,
} from "./contract.mjs";

export {
  ADMISSION_AUTHORITY,
  MILESTONE_SEQUENCE,
  RESEARCH_VERDICT_NAMESPACE,
  STRATEGY_ADMISSION,
  STRATEGY_ADMISSION_NAMESPACE,
  STRATEGY_LIFECYCLE,
  STRATEGY_LIFECYCLE_NAMESPACE,
  canTransition,
  namespacesClaimingLabel,
  nextLifecycleStages,
  resolveAdmissionFromVerdict,
  resolveAdmissionStatus,
  resolveAdmissionValue,
  resolveLifecycleValue,
  resolveMilestoneStatus,
  validateExperimentReadiness,
} from "./lifecycle.mjs";

export {
  StrategyAdmissionRegistry,
  createStrategyAdmissionRegistry,
  validateEvidenceRef,
} from "./registry.mjs";
