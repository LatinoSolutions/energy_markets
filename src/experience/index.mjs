// Surface del contrato Experience (IMP-17). Fuente: SPEC v1.1.1 §§11–12
// (§11.5 ciclo offline sin mutación en caliente; §12.1 tres fuentes separadas;
// §12.2 contrato conceptual del registro; §12.3 combinación y atribución) y
// §25.1/§25.2 filas IMP-17 ("No mezclar fuerza probatoria; ninguna
// actualización hot"; "records versionados"; "casos sintéticos no cierran
// DEP-22 ni generan Real Experience").

export {
  EXPERIENCE_SOURCE_TYPES,
  COUNTERFACTUAL_LABEL,
  FILL_EVIDENCE_KINDS,
  isExperienceSourceType,
  probatoryForceOf,
  evidenceClassOfRecord,
  validateMixtureDeclaration,
  combineCorpusBySource,
} from "./source-types.mjs";

export {
  ARTIFACT_KIND,
  RECORD_STATES,
  HUMAN_INTERVENTION_KINDS,
  buildExperienceRecord,
  validateExperienceRecordShape,
  validateFill,
  validateHumanIntervention,
  recordIdentityOf,
  closeExperienceRecord,
} from "./record.mjs";

export {
  ATTRIBUTION_CODES,
  attributeOutcome,
  recommendationVsExecution,
  strategyCreditClaim,
} from "./attribution.mjs";

export {
  createExperienceRegistry,
  createActivePolicyVersionHolder,
} from "./registry.mjs";

export {
  experienceFromReplayOutput,
  REPLAY_PROJECTION_SCOPE,
} from "./replay-projection.mjs";
