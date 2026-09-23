// Contrato de evaluación por componente/rol: identidad exacta de
// componente/rol/protocolo/versión y todos los campos semánticos de §11.6.2.
// Fuente: SPEC v1.1 §11.6.2 (Role-specific value hypothesis) y §11.6.1 (clases).
// La serialización es IMPLEMENTATION DETAIL; el contenido semántico es
// normativo. Completar los campos no acredita valor empírico ni autoridad: eso
// se decide, como máximo, en el registro y sus gates (§11.6.3/§11.6.4).

import { isVersionLike } from "../contracts/identities.mjs";
import { isRoleClassId } from "./roles.mjs";

// Identidad exigida antes de cualquier evaluación: "exact component/role/
// protocol/version identity" (packet acceptance 1, §25.2.1 instancia de
// ejecución).
export const COMPONENT_IDENTITY_FIELDS = Object.freeze([
  { key: "componentId", specLabel: "Exact component identity", kind: "text", section: "§11.6.2" },
  { key: "componentVersion", specLabel: "Component version", kind: "version", section: "§11.6.2/§25.2.1" },
  { key: "roleClass", specLabel: "Candidate role class", kind: "roleClass", section: "§11.6.1" },
  { key: "protocolId", specLabel: "Evaluation protocol identity", kind: "text", section: "§11.6.2" },
  { key: "protocolVersion", specLabel: "Evaluation protocol version", kind: "version", section: "§11.6.2" },
]);

// Equivalente semántico de cada fila de la tabla §11.6.2, en su orden. Las
// listas con minItems 0 siguen siendo obligatorias: el campo debe existir
// explícitamente aunque su valor sea vacío (p. ej. autoridad solicitada).
export const ROLE_HYPOTHESIS_FIELDS = Object.freeze([
  { key: "exactRole", specLabel: "Exact role being tested", kind: "text", section: "§11.6.2" },
  { key: "problemToImprove", specLabel: "Problem expected to improve", kind: "text", section: "§11.6.2" },
  { key: "currentComparator", specLabel: "Current comparator / existing mechanism", kind: "text", section: "§11.6.2" },
  { key: "valueHypothesis", specLabel: "Value hypothesis", kind: "text", section: "§11.6.2" },
  { key: "requiredInputs", specLabel: "Required inputs", kind: "list", minItems: 1, section: "§11.6.2" },
  { key: "outputs", specLabel: "Outputs", kind: "list", minItems: 1, section: "§11.6.2" },
  { key: "authorityRequested", specLabel: "Authority requested", kind: "list", minItems: 0, section: "§11.6.2" },
  { key: "integrationBoundary", specLabel: "Integration boundary", kind: "text", section: "§11.6.2" },
  { key: "failureModes", specLabel: "Failure modes", kind: "list", minItems: 1, section: "§11.6.2" },
  { key: "reproducibilityRequirements", specLabel: "Reproducibility requirements", kind: "list", minItems: 1, section: "§11.6.2" },
  { key: "costLatencyBurden", specLabel: "Cost / latency / operational burden", kind: "costBurden", section: "§11.6.2" },
  { key: "overlapAssessment", specLabel: "Overlap assessment", kind: "text", section: "§11.6.2" },
  { key: "evidenceRequiredForAdmission", specLabel: "Evidence required for admission", kind: "list", minItems: 1, section: "§11.6.2" },
  { key: "removalRollbackPath", specLabel: "Removal / rollback path", kind: "rollback", section: "§11.6.2" },
]);

export const ROLE_EVALUATION_FIELDS = Object.freeze([...COMPONENT_IDENTITY_FIELDS, ...ROLE_HYPOTHESIS_FIELDS]);
export const ROLE_EVALUATION_FIELD_KEYS = Object.freeze(ROLE_EVALUATION_FIELDS.map((field) => field.key));

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function isMissing(value) {
  if (value === undefined || value === null) {
    return true;
  }
  if (typeof value === "string") {
    return value.trim().length === 0;
  }
  if (Array.isArray(value)) {
    return value.length === 0;
  }
  if (typeof value === "object") {
    return Object.keys(value).length === 0;
  }
  return false;
}

function isNonEmptyObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length > 0;
}

// §11.6.2/§11.6.3: coste, latencia y carga operacional se contrastan, no se
// asumen. Un desconocido se declara explícitamente con razón; lo que no se
// admite es omitirlo o presentarlo como cero.
function isCostBurden(value) {
  if (!isNonEmptyObject(value)) {
    return false;
  }
  if (value.unknown === true) {
    return isNonEmptyString(value.reason);
  }
  return isNonEmptyString(value.cost) || isNonEmptyString(value.latency) || isNonEmptyString(value.operationalBurden);
}

// §11.6.2 y §11.6.4: la retirada/rollback debe quedar declarada como camino
// concreto, no como intención genérica.
function isRollbackPath(value) {
  if (isNonEmptyString(value)) {
    return true;
  }
  if (!isNonEmptyObject(value)) {
    return false;
  }
  return isNonEmptyString(value.path) || isNonEmptyString(value.target) || (Array.isArray(value.steps) && value.steps.length > 0);
}

function matchesKind(field, value) {
  switch (field.kind) {
    case "text":
      return isNonEmptyString(value);
    case "roleClass":
      return isRoleClassId(value);
    case "list":
      return Array.isArray(value) && value.length >= (field.minItems ?? 0);
    case "version":
      return isVersionLike(value);
    case "costBurden":
      return isCostBurden(value);
    case "rollback":
      return isRollbackPath(value);
    default:
      return false;
  }
}

function validateFields(evaluation, fields) {
  const errors = [];
  for (const field of fields) {
    const value = evaluation?.[field.key];
    // Una lista obligatoria con minItems 0 se declara con un array explícito,
    // incluso vacío: su ausencia total sigue siendo contenido faltante.
    const present = field.kind === "list" ? Array.isArray(value) : !isMissing(value);
    if (!present) {
      errors.push({
        field: field.key,
        code: "MISSING_REQUIRED",
        message: `Falta el contenido obligatorio "${field.specLabel}" (${field.section}).`,
      });
      continue;
    }
    if (!matchesKind(field, value)) {
      errors.push({
        field: field.key,
        code: "INVALID_REQUIRED_CONTENT",
        message: `"${field.key}" no satisface la forma mínima del contrato §11.6.2 (${field.kind}).`,
      });
    }
  }
  return errors;
}

// Identidad exacta de componente/rol/protocolo/versión. Un componente sin rol
// declarado no obtiene uno por defecto (§11.6: JEV no tiene rol
// predeterminado).
export function validateComponentIdentity(evaluation) {
  if (!evaluation || typeof evaluation !== "object" || Array.isArray(evaluation)) {
    return { ok: false, errors: [{ field: "(evaluation)", code: "MISSING_EVALUATION", message: "Evaluación por rol ausente." }] };
  }
  const errors = validateFields(evaluation, COMPONENT_IDENTITY_FIELDS);
  return { ok: errors.length === 0, errors };
}

// Contrato §11.6.2 completo. La readiness no se deriva de completar campos:
// eso se decide con gates explícitos en el registro.
export function validateRoleHypothesis(evaluation) {
  const identityOutcome = validateComponentIdentity(evaluation);
  if (!identityOutcome.ok) {
    return { ok: false, errors: identityOutcome.errors };
  }
  const errors = validateFields(evaluation, ROLE_HYPOTHESIS_FIELDS);
  return { ok: errors.length === 0, errors };
}

export function validateRoleEvaluation(evaluation) {
  return validateRoleHypothesis(evaluation);
}

export function missingRoleEvaluationContent(evaluation) {
  return ROLE_EVALUATION_FIELDS
    .filter((field) => {
      const value = evaluation?.[field.key];
      const present = field.kind === "list" ? Array.isArray(value) : !isMissing(value);
      return !present || !matchesKind(field, value);
    })
    .map((field) => field.key);
}