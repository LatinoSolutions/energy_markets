// Contrato del bundle económico obligatorio. Fuente: SPEC v1.1 §14.2
// (Required input bundle) con las reglas "No invented defaults" de §5.6 y
// §14.7 (missing se representa unavailable, con razón preservada). No se
// sustituyen faltantes por valores numéricos ni por supuestos silenciosos.

import { STATE_NAMESPACES } from "./states.mjs";
import { isVersionLike } from "./identities.mjs";

const AVAILABILITY_VALUES = STATE_NAMESPACES.data_availability.values;

export const REQUIRED_BUNDLE_INPUTS = [
  { key: "experiment", section: "§14.2", content: "ID y version", requiredFields: ["id"], fieldKinds: { id: "text" } },
  { key: "campaign", section: "§14.2", content: "ID, product, Mission y pertenencia Gas Quarterly", requiredFields: ["id", "product", "mission", "gasQuarterly"], fieldKinds: { id: "text", product: "text", mission: "text", gasQuarterly: "boolean" } },
  { key: "openingContract", section: "§14.2", content: "Opening obligation, fechas y deadline", requiredFields: ["openingObligation", "windowStart", "windowEnd", "deadline"], fieldKinds: { openingObligation: "obligation", windowStart: "text", windowEnd: "text", deadline: "text" } },
  { key: "decisionCalendar", section: "§14.2", content: "Oportunidades predeclaradas", requiredFields: ["opportunities"], fieldKinds: { opportunities: "list" } },
  { key: "arm", section: "§14.2", content: "Definición frozen de A0 o A1", requiredFields: ["definition"], fieldKinds: { definition: "text" } },
  { key: "a1Configuration", section: "§14.2", content: "S1 configuration/parameters congelados", requiredFields: ["s1Configuration"], fieldKinds: { s1Configuration: "config" } },
  { key: "data", section: "§14.2", content: "P4 point-in-time manifest con availability/version", requiredFields: ["pitManifest"], fieldKinds: { pitManifest: "manifest" } },
  { key: "sizing", section: "§14.2", content: "Configuración frozen del sizing controller", requiredFields: ["controllerConfiguration"], fieldKinds: { controllerConfiguration: "config" } },
  { key: "execution", section: "§14.2", content: "P5.6 execution-contract version", requiredFields: ["contractVersion"], fieldKinds: { contractVersion: "version" } },
  { key: "costs", section: "§14.2", content: "Cost-ledger configuration", requiredFields: ["ledgerConfiguration"], fieldKinds: { ledgerConfiguration: "config" } },
  { key: "benchmark", section: "§14.2", content: "Configuration/source version", requiredFields: ["sourceVersion"], fieldKinds: { sourceVersion: "version" } },
  { key: "evaluator", section: "§14.2", content: "Version", requiredFields: ["version"], fieldKinds: { version: "version" } },
  { key: "stochasticity", section: "§14.2", content: "Random seed sólo con componente estocástico aprobado", requiredFields: ["seed"], fieldKinds: { seed: "number" }, optional: true },
];

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

// §14.7: un campo obligatorio puede declararse indisponible a nivel de campo,
// pero entonces la razón se preserva y el bundle queda bloqueado; nunca cuenta
// como valor conocido.
function isUnavailableFieldValue(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value) && value.availability === "UNAVAILABLE";
}

// Un objeto que sólo contiene metadata de availability (sin contenido real)
// no es un valor económico conocido.
function isAvailabilityOnly(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  if (!Object.prototype.hasOwnProperty.call(value, "availability")) {
    return false;
  }
  return Object.keys(value).every((key) => key === "availability" || key === "reason");
}

function fieldValue(entry, field) {
  if (entry?.fields && Object.prototype.hasOwnProperty.call(entry.fields, field)) {
    return entry.fields[field];
  }
  return entry?.[field];
}

function isNonEmptyObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length > 0;
}

// Forma mínima soportada por cada campo obligatorio (§14.2). Una forma no
// soportada se rechaza explícitamente; no se adivina valor, unidad ni default.
//   text -> string no vacío            boolean -> booleano
//   number -> número finito            list -> array no vacío
//   version -> versión o content-hash (isVersionLike)
//   config -> string no vacío u objeto con contenido
//   manifest -> string no vacío u objeto con id no vacío y version válida
//   obligation -> string no vacío u objeto con value numérico finito y unit
function matchesFieldKind(kind, value) {
  switch (kind) {
    case "text":
      return typeof value === "string" && value.trim().length > 0;
    case "boolean":
      return typeof value === "boolean";
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    case "list":
      return Array.isArray(value) && value.length > 0;
    case "version":
      return isVersionLike(value);
    case "config":
      return (typeof value === "string" && value.trim().length > 0) || isNonEmptyObject(value);
    case "manifest":
      if (typeof value === "string") {
        return value.trim().length > 0;
      }
      return isNonEmptyObject(value)
        && typeof value.id === "string" && value.id.trim().length > 0
        && isVersionLike(value.version);
    case "obligation":
      if (typeof value === "string") {
        return value.trim().length > 0;
      }
      return isNonEmptyObject(value)
        && typeof value.value === "number" && Number.isFinite(value.value)
        && typeof value.unit === "string" && value.unit.trim().length > 0;
    default:
      return false;
  }
}

// Valida el bundle completo. Preserva la razón del faltante en lugar de
// poblarla. Rechaza cualquier default numérico inventado.
export function validateEconomicBundle(bundle) {
  const errors = [];
  const missing = [];
  const unavailable = [];

  if (!bundle || typeof bundle !== "object") {
    return { ok: false, blocked: true, errors: [{ field: "bundle", code: "MISSING_BUNDLE", message: "Bundle económico ausente." }], missing, unavailable };
  }

  for (const input of REQUIRED_BUNDLE_INPUTS) {
    const entry = bundle[input.key];

    if (entry === undefined || entry === null) {
      if (input.optional) {
        continue;
      }
      errors.push({ field: input.key, code: "MISSING_REQUIRED_INPUT", message: `Falta el required input "${input.key}" (${input.content}).` });
      continue;
    }

    if (typeof entry !== "object" || Array.isArray(entry)) {
      errors.push({ field: input.key, code: "INVALID_INPUT", message: `El required input "${input.key}" debe ser un objeto.` });
      continue;
    }

    if (!isVersionLike(entry.version)) {
      errors.push({ field: `${input.key}.version`, code: "MISSING_VERSION", message: `El required input "${input.key}" no declara versión congelable.` });
    }

    if (Object.prototype.hasOwnProperty.call(entry, "default")) {
      errors.push({ field: `${input.key}.default`, code: "INVENTED_DEFAULT", message: `"${input.key}" no puede declarar un default inventado.` });
    }

    if (entry.availability !== undefined && !AVAILABILITY_VALUES.includes(entry.availability)) {
      errors.push({ field: `${input.key}.availability`, code: "UNKNOWN_AVAILABILITY", message: `"${input.key}" usa availability no declarada.`, allowedValues: AVAILABILITY_VALUES });
    }

    if (entry.availability === "UNAVAILABLE") {
      if (isMissing(entry.reason)) {
        errors.push({ field: `${input.key}.reason`, code: "MISSING_REASON", message: `"${input.key}" está UNAVAILABLE pero no preserva la razón.` });
      } else {
        unavailable.push({ key: input.key, reason: entry.reason });
      }
      if (typeof entry.value === "number") {
        errors.push({ field: `${input.key}.value`, code: "INVENTED_DEFAULT", message: `"${input.key}" está UNAVAILABLE pero trae un valor numérico.` });
      }
    }

    for (const field of input.requiredFields) {
      const value = fieldValue(entry, field);
      const kind = input.fieldKinds?.[field] ?? "text";

      if (isUnavailableFieldValue(value)) {
        if (isMissing(value.reason)) {
          errors.push({ field: `${input.key}.${field}`, code: "MISSING_REASON", message: `"${input.key}.${field}" está UNAVAILABLE pero no preserva la razón.` });
        } else {
          unavailable.push({ key: input.key, field, reason: value.reason });
          missing.push({ key: input.key, field, reason: value.reason });
        }
        continue;
      }

      if (isAvailabilityOnly(value)) {
        if (entry.availability === "UNAVAILABLE") {
          missing.push({ key: input.key, field, reason: entry.reason ?? null });
          continue;
        }
        errors.push({ field: `${input.key}.${field}`, code: "MISSING_REQUIRED_FIELD", message: `"${input.key}.${field}" sólo declara availability, sin contenido económico conocido.` });
        continue;
      }

      if (isMissing(value)) {
        if (entry.availability === "UNAVAILABLE") {
          missing.push({ key: input.key, field, reason: entry.reason ?? null });
          continue;
        }
        errors.push({ field: `${input.key}.${field}`, code: "MISSING_REQUIRED_FIELD", message: `"${input.key}" no provee "${field}" (${input.content}).` });
        continue;
      }

      if (!matchesFieldKind(kind, value)) {
        if (entry.availability === "UNAVAILABLE") {
          missing.push({ key: input.key, field, reason: entry.reason ?? null });
          continue;
        }
        errors.push({ field: `${input.key}.${field}`, code: "INVALID_REQUIRED_FIELD", message: `"${input.key}.${field}" no tiene la forma mínima soportada (${kind}).` });
      }
    }
  }

  return {
    ok: errors.length === 0,
    blocked: unavailable.length > 0,
    errors,
    missing,
    unavailable,
  };
}