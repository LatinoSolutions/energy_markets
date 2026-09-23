// Surface de la Operator Interface Boundary de IMP-29. Fuente: SPEC v1.1.1
// §26, §25.1/§25.2.2 fila IMP-29. No implementa frontend ni elige charting
// library (§26.6); materializa el contrato de exposición, la alineación
// temporal y el boundary de controles sobre las vistas canónicas de IMP-06 y
// los contratos de IMP-01.

export {
  EXPOSURE_CONDITION,
  EXPOSURE_CONDITIONS,
  EXPOSURE_FIELDS,
  EXPOSURE_FIELD_KEYS,
  EXPOSURE_SOURCE_KIND,
  buildExposure,
  buildExposureField,
} from "./exposure.mjs";

export {
  EXECUTION_CLASS,
  EXECUTION_CLASSES,
  HUMAN_INTERVENTION_CLASS,
  WORKING_MODE,
  WORKING_MODES,
  buildOperatorTimeline,
  reconcileOperatorTimeline,
} from "./timeline.mjs";

export {
  AUTHORIZED_COMMANDS,
  GOVERNANCE_COMMAND,
  GOVERNANCE_COMMANDS,
  INTERVENTION_COMMAND,
  INTERVENTION_COMMANDS,
  authorizeOperatorCommand,
  buildHumanIntervention,
  projectGovernanceState,
} from "./controls.mjs";

export {
  backendIndexFromManifest,
  backendRefOf,
  parseBackendRef,
  resolveBackendRecord,
} from "./backend-records.mjs";
