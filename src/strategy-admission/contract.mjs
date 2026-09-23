// Contrato común de admisión: todos los campos semánticos de §8.7.2 y las
// validaciones que rechazan identidad en colisión, versión/provenance
// ausentes y contenido obligatorio incompleto. Fuente: SPEC v1.1 §8.7.2
// (Common Strategy Admission Contract) y §8.7.1 (canales). La serialización es
// IMPLEMENTATION DETAIL; el contenido semántico es normativo.

import { isVersionLike } from "../contracts/identities.mjs";
import { isChannelId, validateChannelProvenance } from "./channels.mjs";
import { resolveAdmissionStatus } from "./lifecycle.mjs";

// IDs canónicos de §8 que no pueden reutilizarse como Strategy Candidate
// (§8.7.2: "sin colisión con S1–S5").
export const RESERVED_STRATEGY_IDS = Object.freeze(["S1", "S2", "S3", "S4", "S5"]);

// Equivalente semántico de cada fila de la tabla §8.7.2, en su orden. Las
// listas con minItems 0 siguen siendo obligatorias: el campo debe existir
// explícitamente aunque su contenido sea vacío.
export const STRATEGY_CONTRACT_FIELDS = Object.freeze([
  { key: "strategyId", specLabel: "Unique Strategy ID", kind: "text", section: "§8.7.2" },
  { key: "canonicalName", specLabel: "Canonical name", kind: "text", section: "§8.7.2" },
  { key: "intakeChannel", specLabel: "Intake channel / provenance", kind: "channel", section: "§8.7.1/§8.7.2" },
  { key: "provenance", specLabel: "Intake channel / provenance", kind: "provenance", section: "§8.7.1/§8.7.2" },
  { key: "role", specLabel: "Role", kind: "text", section: "§8.7.2" },
  { key: "exactQuestion", specLabel: "Exact question answered", kind: "text", section: "§8.7.2" },
  { key: "rationale", specLabel: "Economic or decision rationale", kind: "text", section: "§8.7.2" },
  { key: "validationProposition", specLabel: "Falsifiable Hypothesis or explicit validation proposition", kind: "text", section: "§8.7.2" },
  { key: "observableInputs", specLabel: "Observable inputs", kind: "list", minItems: 1, section: "§8.7.2" },
  { key: "pointInTimeRequirements", specLabel: "Point-in-Time requirements", kind: "list", minItems: 1, section: "§8.7.2" },
  { key: "dataDependencies", specLabel: "Required data and data-readiness dependencies", kind: "list", minItems: 1, section: "§8.7.2" },
  { key: "evidenceOutput", specLabel: "Evidence output", kind: "text", section: "§8.7.2" },
  { key: "uncertaintySemantics", specLabel: "Uncertainty / unavailable semantics", kind: "text", section: "§8.7.2" },
  { key: "parameters", specLabel: "Parameters", kind: "list", minItems: 0, section: "§8.7.2" },
  { key: "calibrationBoundaries", specLabel: "Calibration boundaries", kind: "text", section: "§8.7.2" },
  { key: "refutationCriteria", specLabel: "Refutation criteria", kind: "text", section: "§8.7.2" },
  { key: "relationshipToExisting", specLabel: "Relationship to existing Strategies", kind: "text", section: "§8.7.2" },
  { key: "redundancyAssessment", specLabel: "Redundancy / overlap assessment", kind: "text", section: "§8.7.2" },
  { key: "comparatorBaseline", specLabel: "Experimental comparator / baseline", kind: "text", section: "§8.7.2" },
  { key: "ablationDesign", specLabel: "Ablation design when applicable", kind: "ablation", section: "§8.7.2" },
  { key: "economicEvaluationContract", specLabel: "Economic evaluation contract", kind: "text", section: "§8.7.2" },
  { key: "implementationScope", specLabel: "Implementation scope", kind: "text", section: "§8.7.2" },
  { key: "version", specLabel: "Version", kind: "version", section: "§8.7.2" },
  { key: "admissionStatus", specLabel: "Admission status", kind: "namespacedStatus", section: "§8.7.2" },
]);

export const STRATEGY_CONTRACT_FIELD_KEYS = Object.freeze(STRATEGY_CONTRACT_FIELDS.map((field) => field.key));

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

// "Ablation design when applicable": o hay diseño, o se declara explícitamente
// no aplicable con su razón. La ausencia total no es admisible.
function isAblationDesign(value) {
  if (Array.isArray(value)) {
    return value.length > 0;
  }
  if (!isNonEmptyObject(value)) {
    return false;
  }
  if (value.applicable === false) {
    return isNonEmptyString(value.rationale);
  }
  return true;
}

function matchesKind(field, value) {
  switch (field.kind) {
    case "text":
      return isNonEmptyString(value);
    case "list":
      return Array.isArray(value) && value.length >= (field.minItems ?? 0);
    case "version":
      return isVersionLike(value);
    case "channel":
      return isChannelId(value);
    case "ablation":
      return isAblationDesign(value);
    case "namespacedStatus":
      return isNonEmptyObject(value)
        && resolveAdmissionStatus(value.namespace, value.value).ok;
    case "provenance":
      return isNonEmptyObject(value);
    default:
      return false;
  }
}

// Campos que identifican al candidato antes de que exista contrato completo.
// Se usan para rechazar colisiones de identidad y provenance ausente.
export const IDENTITY_FIELDS = Object.freeze([
  "strategyId",
  "canonicalName",
  "intakeChannel",
  "provenance",
  "version",
  "admissionStatus",
]);

function validateFields(candidate, fields) {
  const errors = [];
  for (const field of fields) {
    const value = candidate?.[field.key];
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
        message: `"${field.key}" no satisface la forma mínima del contrato §8.7.2 (${field.kind}).`,
      });
    }
  }
  return errors;
}

// Validación de identidad/versión/provenance. Rechaza la colisión con S1–S5,
// la versión ausente y el provenance ausente antes de considerar el resto.
export function validateStrategyRegistration(candidate) {
  const errors = [];
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    return { ok: false, errors: [{ field: "(candidate)", code: "MISSING_CANDIDATE", message: "Strategy Candidate ausente." }] };
  }

  errors.push(...validateFields(candidate, STRATEGY_CONTRACT_FIELDS.filter((field) => IDENTITY_FIELDS.includes(field.key))));

  if (typeof candidate.strategyId === "string" && RESERVED_STRATEGY_IDS.includes(candidate.strategyId)) {
    errors.push({
      field: "strategyId",
      code: "IDENTITY_COLLISION",
      message: `"${candidate.strategyId}" colisiona con una Strategy canónica de §8 y no puede reutilizarse (§8.7.2).`,
      reservedIds: RESERVED_STRATEGY_IDS,
    });
  }

  const channelOutcome = validateChannelProvenance(candidate.intakeChannel, candidate.provenance);
  if (!channelOutcome.ok) {
    errors.push(...channelOutcome.errors);
  }

  return { ok: errors.length === 0, errors };
}

// Validación del contrato común completo (§8.7.2). Un contenido nominalmente
// completo no acredita readiness: eso se decide en el lifecycle (§8.7.3).
export function validateStrategyCandidate(candidate) {
  const registrationOutcome = validateStrategyRegistration(candidate);
  if (!registrationOutcome.ok) {
    return { ok: false, errors: registrationOutcome.errors };
  }

  const errors = validateFields(candidate, STRATEGY_CONTRACT_FIELDS);
  return { ok: errors.length === 0, errors };
}

export function missingContractContent(candidate) {
  return STRATEGY_CONTRACT_FIELDS
    .filter((field) => {
      const value = candidate?.[field.key];
      const present = field.kind === "list" ? Array.isArray(value) : !isMissing(value);
      return !present || !matchesKind(field, value);
    })
    .map((field) => field.key);
}
