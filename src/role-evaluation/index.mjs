// Superficie del framework de evaluación por rol de componentes externos
// (ST-28.1). Fuente: SPEC v1.1 §§11.6.1–11.6.4. Los consumidores importan este
// módulo directamente; no se modifica la superficie aceptada de
// src/contracts/index.mjs ni de src/strategy-admission/index.mjs.

export {
  ROLE_CLASS,
  ROLE_CLASSES,
  ROLE_CLASS_IDS,
  VALUE_DOMAIN,
  canClaimProcurementEdge,
  isRoleClassId,
  resolveRoleClass,
  roleRequiresSeparateAuthorityValidation,
  roleRequiresStrategyAdmissionGate,
  validateValueClaimDomain,
} from "./roles.mjs";

export {
  COMPONENT_IDENTITY_FIELDS,
  ROLE_EVALUATION_FIELDS,
  ROLE_EVALUATION_FIELD_KEYS,
  ROLE_HYPOTHESIS_FIELDS,
  missingRoleEvaluationContent,
  validateComponentIdentity,
  validateRoleEvaluation,
  validateRoleHypothesis,
} from "./contract.mjs";

export {
  RESEARCH_VERDICT_NAMESPACE,
  ROLE_ADMISSION,
  ROLE_ADMISSION_AUTHORITY,
  ROLE_ADMISSION_NAMESPACE,
  ROLE_ADMISSION_VALUES,
  hasProductiveAuthority,
  initialAuthorityGrant,
  isRoleAdmissionLabel,
  namespacesClaimingRoleLabel,
  resolveRoleAdmissionValue,
  roleAdmissionAuthority,
} from "./outcomes.mjs";

export {
  EVALUATION_STATE,
  RoleEvaluationRegistry,
  createRoleEvaluationRegistry,
  validateEvidenceRef,
} from "./registry.mjs";