// Superficie del alcance IMP-22: investigación de Sizing Policy y
// extensiones de misión (§25.1 fila IMP-22; §§4,5,11,23; DEP-12/DEP-18 §24).

export {
  IMP22_EXPERIMENT_ID_PATTERN,
  IMP22_SIZING_CANDIDATE_ID_PATTERN,
  IMP22_RESERVE_ID_PATTERN,
  MISSION_IDS,
  isImp22ExperimentId,
  isImp22SizingCandidateId,
  isImp22ReserveId,
  validateIdentity,
} from "./identity.mjs";

export {
  MISSIONS,
  MISSION_MINIMUM_EVIDENCE,
  PRODUCTS,
  CADENCES,
  getMission,
  isMissionId,
  isMinimumEvidenceInstalled,
  validateMissionExtension,
} from "./missions.mjs";

export {
  SIZING_FAMILIES,
  CONSTRAINT_STATUSES,
  SIZING_CANDIDATE_FIELDS,
  validateSizingCandidate,
} from "./sizing-candidate.mjs";

export { RESERVE_STATUS, validateMissionReserve, reserveContentHashOf, IMP09_OOS_PRODUCT, IMP09_OOS_MISSION } from "./reserve.mjs";

export { COVERAGE_IDENTITY, validateCoverageDeclarations, validateCoverageTrace, validateGuardCoverage } from "./coverage.mjs";

export { ATTRIBUTION_ARMS, attributeTimingVsetSize, validateArmParity } from "./attribution.mjs";

export {
  assertNoPoolingOrPortfolioAggregation,
  assertActionSpaceInvariant,
  assertControllerIsNotFinalPolicy,
} from "./constraints.mjs";

export { IMP22_DESIGN_FIELDS, validateExperimentDesign, validateFreezeBeforeEvaluation } from "./experiment-design.mjs";

export { makeDesign } from "./builder.mjs";

export { DESIGN_IDS, EXPERIMENT_DESIGNS, SIZING_CANDIDATE_IDS, getDesign } from "./designs.mjs";

export { createImp22DesignRegistry } from "./registry.mjs";
