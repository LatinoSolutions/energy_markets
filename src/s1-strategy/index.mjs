// Superficie pública de IMP-11: instanciar S1 mínimo y A1. Fuente: SPEC v1.1.1
// §8.1 (S1 — Relative Price Location), §8.6 (calibración compartida), §13
// (primer experimento canónico P5) y §25.1/§25.2 fila IMP-11 (feature
// definitions, search space y configuration version; A1=A0+S1). La aceptación
// del IMP no se autodeclara aquí: este módulo materializa el artefacto, sus
// guards y su acceptance.

export {
  FORBIDDEN_A1_TIMING_INPUT_KEYS,
  HORIZON_KINDS,
  IMP11_ACCEPTANCE_TEST,
  IMP11_MUST_NOT_CHANGE,
  REFERENCE_FAMILIES,
  S1_CANONICAL_FEATURES,
  S1_EXPERIMENT_MISSION,
  S1_EXPERIMENT_PRODUCT,
  S1_SEMANTIC_IDENTITY,
  TRAJECTORY_FEATURE_KEYS,
  assertHorizonsSeparated,
  assertSemanticIdentityIntact,
  validateA1TimingState,
  validateHorizonDeclaration,
  validateStaticLocationFeatures,
} from "./feature-definitions.mjs";

export {
  buildCausalReference,
  computeS1Features,
} from "./causal-reference.mjs";

export {
  assertPointInSearchSpace,
  assertSearchSpacePredeclared,
  defineSearchSpace,
} from "./search-space.mjs";

export {
  CALIBRATION_BASES,
  FAVORABLE_WHEN,
  assertConfigurationFrozen,
  createS1Configuration,
} from "./configuration.mjs";

export {
  assertA1IsA0PlusS1,
  assertTimingIndependentOfProcurementState,
  createA1Arm,
  probeForbiddenTimingInputsRejected,
  probeStaticLocationTiming,
  probeTimingIndependentOfProcurementState,
  s1Preference,
} from "./a1-arm.mjs";

export {
  assertThresholdsFrozenBeforeOos,
  calibrateDevelopment,
} from "./calibration.mjs";

export {
  evaluateImp11Acceptance,
  materializeGasQuarterlyS1,
} from "./acceptance.mjs";
