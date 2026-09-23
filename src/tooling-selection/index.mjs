// Superficie pública de la selección de herramienta mínima suficiente
// (IMP-04). Fuente: SPEC v1.1.1 §§6.4 y 20.1, y §25.1/§25.2.2 IMP-04. El módulo
// materializa el capability assessment, la decisión auditada
// reutilizar/extender/construir y la reconciliación independiente de salidas
// clave con fixtures permitidos. `real-tooling.mjs` aporta el entregable DEP-10
// sobre herramientas reales. No atribuye edge y no concede autoridad de
// producción.

export {
  IP_EXPOSURE,
  RIGHTS_STATUS,
  evaluateCapabilityCoverage,
  isCapabilityAssessmentUsable,
  validateCapabilityAssessment,
  validateEvidenceRef,
} from "./capability.mjs";

export {
  NO_PRODUCTION_AUTHORITY,
  SELECTION_BASIS,
  TOOLING_DECISION,
  deriveToolingDecision,
  selectMinimumTooling,
  validateToolingSelection,
} from "./decision.mjs";

export { reconcileKeyOutputs } from "./reconciliation.mjs";

export {
  EEX_DATA_USAGE_AUTHORIZATION,
  EEX_LAKE_ROOT,
  EEX_LAKE_SCHEMA_SAMPLES,
  EEX_READER_INTERFACE_OUTPUTS,
  EEX_READ_ENVIRONMENT_TOP_OF_BOOK_COLUMNS,
  EEX_VENV_PYTHON,
  IMP05_CALCULATION_CAPABILITIES,
  IMP05_CAPABILITY_SOURCES,
  IMP05_OFFICIAL_READ_CAPABILITIES,
  IMP05_REFERENCE_READ_CAPABILITIES,
  OFFICIAL_SETTLEMENT_SOURCE_SEARCH,
  REAL_BENCHMARK_COMPONENT_ID,
  REAL_EEX_READER_COMPONENT_ID,
  REAL_EEX_READ_ENVIRONMENT_COMPONENT_ID,
  EEX_READ_ENVIRONMENT_TRADE_COLUMNS,
  REAL_READ_SELECTION_EVIDENCE,
  REAL_SELECTION_EVIDENCE,
  REAL_TOOLING_ASSESSMENTS,
  REAL_TOOLING_INVENTORY,
  REFERENCE_READ_REQUIRED_OUTPUTS,
  buildEexReadEnvironmentReconciliation,
  buildRealToolingReconciliation,
  deriveRealImp05ToolingDecisions,
} from "./real-tooling.mjs";
