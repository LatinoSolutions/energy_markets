// Superficie pública de IMP-10: controlador Calendar-only / price-blind (A0)
// y experimental sizing controller compartido con A1. Fuente: SPEC v1.1.1
// §13.2, §13.4, §13.5 y §25.1/§25.2 (IMP-10). La aceptación del IMP no se
// autodeclara aquí; este módulo materializa el artefacto y sus guards.
export {
  buildDecisionCalendar,
  remainingOpportunities,
  validateDecisionCalendar,
} from "./decision-calendar.mjs";

export {
  IS_NOT_FINAL_SIZING_POLICY,
  RECONCILED_RULE_PREDECLARATION,
  CONTROLLER_KIND,
  assertSharedController,
  createSizingController,
  exactControlQuantity,
  reconcileControlQuantity,
} from "./sizing-controller.mjs";

export {
  FORBIDDEN_TIMING_INPUT_KEYS,
  assertPriceBlindness,
  createA0Baseline,
  validateA0TimingIndependence,
  validateA0TimingState,
} from "./a0-baseline.mjs";

export { contentHashOf, versionKeyOf } from "./versioning.mjs";
