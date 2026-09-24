// Experimento P5 — IMP-16. Fuente: SPEC v1.1.1 §25.1 fila IMP-16 ("Confirmar
// reserva OOS intacta, congelar bundle P5 completo y ejecutar A0/A1") y §25.2
// fila IMP-16 (DEP-01–09 bundle económico P5; DEP-12 campañas reservadas y
// frontera intacta; produce DEP-13/14 versión P5).
//
// Superficie pública del experimento P5: confirmación de la reserva OOS
// intacta, congelación ex-ante del bundle P5 (manifest con versiones
// definitivas + frozen bundles P6 por brazo), ejecución A0/A1 con Delta V de
// B compartido, evaluación P3 de la serie ΔV y receipt de research.

export { confirmOosReservationIntact } from "./oos-intact.mjs";
export { deriveS1FeaturePlan } from "./s1-features.mjs";
export {
  P5_EXPERIMENT_MANIFEST_KIND,
  P5_EXPERIMENT_SCOPES,
  DELTA_V_DECLARATION,
  NO_RESCUE_DECLARATION,
  freezeP5Experiment,
} from "./freeze.mjs";
export {
  runP5Experiment,
  verifyFrozenIntegrity,
  costsOf,
  concentrationOf,
} from "./run.mjs";
export {
  deriveDatasetQuality,
  deltaVSeriesFromRuns,
  p5ResearchEvaluation,
} from "./verdict.mjs";
export { materializeP5ExperimentReceipt, gateResearchEvaluationAgainstFrozen } from "./receipt.mjs";
