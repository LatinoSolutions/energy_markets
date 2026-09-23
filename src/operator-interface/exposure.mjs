// Operator Interface Boundary — contrato de exposición de información. Fuente:
// SPEC v1.1.1 §26.2 (información mínima observable y su límite de
// interpretación), §26.5 (la UI no es una segunda Source of Truth y no calcula
// por su cuenta), §25.1 IMP-29 (acceptance: incertidumbre/stale/proxy/
// unavailable visibles; recomendación, fills hipotéticos y Real/intervención
// humana distintos) y §6.1/§6.2 (missing no se inventa; una versión concreta
// respalda un valor).
//
// El contrato expone la forma; no aporta datos. Cada observación es una
// referencia a un registro/versión canónico, nunca un cálculo de la interfaz:
// el valor presentado debe ser el de la versión canónica (valueSha256) o se
// rechaza. Una condición que no es un valor (missing, unavailable, etc.)
// conserva su razón y no admite un valor ficticio.
//
// PLACEHOLDER de contrato (no canónico): la SPEC no fija la serialización de
// una "observación de exposición". La forma asumida se documenta en
// buildExposureField; el contenido semántico (campos, condiciones y
// trazabilidad) es normativo.

import { isSha256 } from "../contracts/identities.mjs";
import { canonicalValueSha256 } from "../pit-views/pit-record.mjs";
import { toUtcTimestamp } from "../pit-views/time.mjs";

// Condiciones de datos que §26.2/§26.3 obligan a mantener visibles. Ninguna se
// convierte en un valor limpio que aparente conocimiento (§26.2 último párrafo).
export const EXPOSURE_CONDITION = Object.freeze({
  AVAILABLE: "AVAILABLE",
  PROXY: "PROXY",
  UNCERTAIN: "UNCERTAIN",
  STALE: "STALE",
  MISSING: "MISSING",
  UNAVAILABLE: "UNAVAILABLE",
  NOT_ADMITTED: "NOT_ADMITTED",
  NOT_YET_CLOSED: "NOT_YET_CLOSED",
  PENDING_AUTHORITY: "PENDING_AUTHORITY",
});

export const EXPOSURE_CONDITIONS = Object.freeze(Object.values(EXPOSURE_CONDITION));

// Condición de un valor presente y demostrado.
const VALUE_REQUIRED_CONDITIONS = Object.freeze([EXPOSURE_CONDITION.AVAILABLE]);
// Condiciones que pueden acompañar un valor pero lo marcan: proxy identificado
// (§6.2), incertidumbre explícita, dato stale por data health (§26.2).
const VALUE_OPTIONAL_CONDITIONS = Object.freeze([
  EXPOSURE_CONDITION.PROXY,
  EXPOSURE_CONDITION.UNCERTAIN,
  EXPOSURE_CONDITION.STALE,
]);
// Condiciones sin valor: la ausencia se declara, nunca se rellena (§26.2).
const VALUE_FORBIDDEN_CONDITIONS = Object.freeze([
  EXPOSURE_CONDITION.MISSING,
  EXPOSURE_CONDITION.UNAVAILABLE,
  EXPOSURE_CONDITION.NOT_ADMITTED,
  EXPOSURE_CONDITION.NOT_YET_CLOSED,
  EXPOSURE_CONDITION.PENDING_AUTHORITY,
]);

// Clase de la fuente canónica de cada sección. Distinguir la clase impide que
// un fill hipotético o un outcome se presenten como recomendación (§25.1
// IMP-29: "recomendación, fills hipotéticos y Real/intervención humana
// distintos"). No es una escala económica: es la identidad del productor.
export const EXPOSURE_SOURCE_KIND = Object.freeze({
  MARKET_CONTEXT: "MARKET_CONTEXT",
  CAMPAIGN_IDENTITY: "CAMPAIGN_IDENTITY",
  PROCUREMENT_WINDOW: "PROCUREMENT_WINDOW",
  POLICY_AUTHORITY: "POLICY_AUTHORITY",
  PROCUREMENT_STATE: "PROCUREMENT_STATE",
  RECOMMENDATION: "RECOMMENDATION",
  EXECUTION: "EXECUTION",
  STRATEGY_EVIDENCE: "STRATEGY_EVIDENCE",
  QUALITY_PROVENANCE: "QUALITY_PROVENANCE",
  PROXY_BENCHMARK: "PROXY_BENCHMARK",
  WORKING_MODE: "WORKING_MODE",
  HUMAN_INTERVENTION: "HUMAN_INTERVENTION",
  OUTCOME: "OUTCOME",
  GOVERNANCE_STATE: "GOVERNANCE_STATE",
});

// Filas de la tabla §26.2, en su orden, con la clase de fuente admitida. La
// recomendación, la ejecución y el outcome tienen clases separadas: una no se
// muestra como otra.
export const EXPOSURE_FIELDS = Object.freeze([
  { key: "marketContext", specLabel: "Market context", section: "§26.2", sourceKinds: [EXPOSURE_SOURCE_KIND.MARKET_CONTEXT] },
  { key: "campaignProductMission", specLabel: "Campaign, product y Mission", section: "§26.2", sourceKinds: [EXPOSURE_SOURCE_KIND.CAMPAIGN_IDENTITY] },
  { key: "procurementWindowAndDeadline", specLabel: "Procurement window and deadline", section: "§26.2", sourceKinds: [EXPOSURE_SOURCE_KIND.PROCUREMENT_WINDOW] },
  { key: "policyAndAuthority", specLabel: "Policy y autoridad", section: "§26.2", sourceKinds: [EXPOSURE_SOURCE_KIND.POLICY_AUTHORITY] },
  { key: "procurementState", specLabel: "Procurement State", section: "§26.2", sourceKinds: [EXPOSURE_SOURCE_KIND.PROCUREMENT_STATE] },
  { key: "recommendation", specLabel: "Recomendación", section: "§26.2", sourceKinds: [EXPOSURE_SOURCE_KIND.RECOMMENDATION] },
  { key: "strategyEvidence", specLabel: "Strategy evidence", section: "§26.2", sourceKinds: [EXPOSURE_SOURCE_KIND.STRATEGY_EVIDENCE] },
  { key: "qualityAndProvenance", specLabel: "Calidad y procedencia", section: "§26.2", sourceKinds: [EXPOSURE_SOURCE_KIND.QUALITY_PROVENANCE] },
  { key: "proxyBenchmarkStatus", specLabel: "Proxy / benchmark status", section: "§26.2", sourceKinds: [EXPOSURE_SOURCE_KIND.PROXY_BENCHMARK] },
  { key: "workingMode", specLabel: "Modo de trabajo", section: "§26.2", sourceKinds: [EXPOSURE_SOURCE_KIND.WORKING_MODE] },
  { key: "humanIntervention", specLabel: "Intervención humana", section: "§26.2", sourceKinds: [EXPOSURE_SOURCE_KIND.HUMAN_INTERVENTION] },
  { key: "outcomes", specLabel: "Outcomes", section: "§26.2", sourceKinds: [EXPOSURE_SOURCE_KIND.OUTCOME] },
  { key: "controlAndGovernance", specLabel: "Control y governance", section: "§26.2", sourceKinds: [EXPOSURE_SOURCE_KIND.GOVERNANCE_STATE] },
]);

export const EXPOSURE_FIELD_KEYS = Object.freeze(EXPOSURE_FIELDS.map((field) => field.key));

const FIELD_BY_KEY = new Map(EXPOSURE_FIELDS.map((field) => [field.key, field]));

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function fail(field, code, message) {
  return { ok: false, errors: [{ field, code, message }] };
}

function deepFreeze(value) {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) {
    return value;
  }
  for (const nested of Object.values(value)) {
    deepFreeze(nested);
  }
  return Object.freeze(value);
}

// Procedencia de una observación: identifica la versión canónica que respalda
// el valor. Sin ella un valor no se muestra (§26.5: la UI no calcula su propia
// verdad económica). `valueSha256` ata el valor mostrado a un contenido
// canónico concreto (mismo hash que IMP-06 fija por versión).
function validateProvenance(provenance, field, errors) {
  if (provenance === undefined || provenance === null) {
    errors.push({
      field: "provenance",
      code: "MISSING_PROVENANCE",
      message: `"${field.key}" con valor exige procedencia a un registro/versión canónico (§26.5).`,
    });
    return null;
  }
  if (typeof provenance !== "object" || Array.isArray(provenance)) {
    errors.push({ field: "provenance", code: "INVALID_PROVENANCE", message: "La procedencia debe ser un objeto." });
    return null;
  }
  if (!field.sourceKinds.includes(provenance.sourceKind)) {
    errors.push({
      field: "provenance.sourceKind",
      code: "SOURCE_KIND_MISMATCH",
      message: `"${field.key}" sólo admite fuentes ${field.sourceKinds.join(", ")}; recibida "${provenance.sourceKind ?? "ausente"}" (no se confunde recomendación con ejecución ni outcome, §25.1/§26.3).`,
    });
    return null;
  }
  if (!isNonEmptyString(provenance.recordKey) || !isNonEmptyString(provenance.revisionId) || !isSha256(provenance.valueSha256)) {
    errors.push({
      field: "provenance",
      code: "INCOMPLETE_PROVENANCE",
      message: "La procedencia requiere recordKey, revisionId y valueSha256 de 64 hex (§6.1/§25.2).",
    });
    return null;
  }
  return deepFreeze({
    sourceKind: provenance.sourceKind,
    recordKey: provenance.recordKey,
    revisionId: provenance.revisionId,
    valueSha256: provenance.valueSha256.toLowerCase(),
    evidenceRef: provenance.evidenceRef ?? null,
  });
}

// Construye una observación de exposición. Devuelve `{ ok, record }` o
// `{ ok:false, errors }`. El valor, si lo hay, procede de una versión canónica
// y su hash coincide con ella; una condición sin valor conserva su razón.
export function buildExposureField(input) {
  const errors = [];
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return fail("(observation)", "MISSING_OBSERVATION", "La observación de exposición está ausente.");
  }
  const field = FIELD_BY_KEY.get(input.field);
  if (field === undefined) {
    return fail("field", "UNKNOWN_EXPOSURE_FIELD", `"${input.field}" no es una sección observable de §26.2.`);
  }
  if (!EXPOSURE_CONDITIONS.includes(input.condition)) {
    return fail("condition", "UNKNOWN_EXPOSURE_CONDITION", `"${input.condition}" no es una condición visible admitida.`);
  }

  const hasValue = input.value !== undefined && input.value !== null;
  if (VALUE_FORBIDDEN_CONDITIONS.includes(input.condition)) {
    // §26.2/§26.5: una ausencia no se completa con datos ficticios.
    if (hasValue) {
      errors.push({
        field: "value",
        code: "INVENTED_VALUE",
        message: `"${field.key}" está en condición ${input.condition}: la ausencia se declara con razón, no se rellena con un valor (§26.2).`,
      });
    }
    if (!isNonEmptyString(input.reason)) {
      errors.push({
        field: "reason",
        code: "MISSING_REASON",
        message: `"${field.key}" en condición ${input.condition} debe preservar la razón (§6.2/§26.2).`,
      });
    }
    if (errors.length > 0) {
      return { ok: false, errors };
    }
    const record = {
      field: field.key,
      specLabel: field.specLabel,
      section: field.section,
      condition: input.condition,
      reason: input.reason,
    };
    if (input.provenance !== undefined && input.provenance !== null) {
      record.provenance = validateProvenanceWithoutValue(input.provenance, field, errors);
      if (errors.length > 0) {
        return { ok: false, errors };
      }
    }
    return { ok: true, record: deepFreeze(record) };
  }

  // Condiciones con valor (requerido en AVAILABLE; opcional en PROXY/UNCERTAIN/
  // STALE, que lo marcan pero no lo ocultan).
  const valueRequired = VALUE_REQUIRED_CONDITIONS.includes(input.condition);
  const valueOptional = VALUE_OPTIONAL_CONDITIONS.includes(input.condition);
  if (valueRequired && !hasValue) {
    errors.push({
      field: "value",
      code: "MISSING_VALUE",
      message: `"${field.key}" en condición ${input.condition} exige un valor canónico (§26.2).`,
    });
  }
  if (valueOptional && !isNonEmptyString(input.reason)) {
    errors.push({
      field: "reason",
      code: "MISSING_REASON",
      message: `"${field.key}" en condición ${input.condition} debe declarar la condición (proxy/incertidumbre/stale) con razón (§26.2).`,
    });
  }

  let provenance = null;
  if (hasValue) {
    const valueOutcome = canonicalValueSha256(input.value);
    if (!valueOutcome.ok) {
      errors.push({
        field: "value",
        code: "INVALID_VALUE",
        message: "El valor debe ser dato JSON serializable (null, boolean, string, número finito, arrays, objetos planos).",
      });
    } else {
      provenance = validateProvenance(input.provenance, field, errors);
      if (provenance !== null && provenance.valueSha256 !== valueOutcome.sha256) {
        errors.push({
          field: "value",
          code: "VALUE_PROVENANCE_MISMATCH",
          message: `El valor mostrado por "${field.key}" no es el de la versión canónica declarada (valueSha256 distinto): la UI no calcula otra verdad económica (§26.5).`,
        });
      }
    }
  } else if (input.provenance !== undefined && input.provenance !== null) {
    provenance = validateProvenanceWithoutValue(input.provenance, field, errors);
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  const record = {
    field: field.key,
    specLabel: field.specLabel,
    section: field.section,
    condition: input.condition,
    provenance,
    value: input.value,
  };
  if (!valueRequired) {
    record.reason = input.reason;
  }
  return { ok: true, record: deepFreeze(record) };
}

// Procedencia de una condición sin valor: identifica la versión de la que
// procede la observación (p. ej. el motivo de un faltante) sin atar un valor.
function validateProvenanceWithoutValue(provenance, field, errors) {
  if (typeof provenance !== "object" || Array.isArray(provenance)) {
    errors.push({ field: "provenance", code: "INVALID_PROVENANCE", message: "La procedencia debe ser un objeto." });
    return null;
  }
  if (!field.sourceKinds.includes(provenance.sourceKind)) {
    errors.push({
      field: "provenance.sourceKind",
      code: "SOURCE_KIND_MISMATCH",
      message: `"${field.key}" sólo admite fuentes ${field.sourceKinds.join(", ")}.`,
    });
    return null;
  }
  if (!isNonEmptyString(provenance.recordKey) || !isNonEmptyString(provenance.revisionId)) {
    errors.push({
      field: "provenance",
      code: "INCOMPLETE_PROVENANCE",
      message: "La procedencia requiere recordKey y revisionId (§6.1).",
    });
    return null;
  }
  return deepFreeze({
    sourceKind: provenance.sourceKind,
    recordKey: provenance.recordKey,
    revisionId: provenance.revisionId,
    valueSha256: null,
    evidenceRef: provenance.evidenceRef ?? null,
  });
}

// Proyección completa del boundary. Todas las secciones de §26.2 quedan
// presentes: las no observadas se declaran MISSING con razón, porque omitirlas
// daría a la interfaz una apariencia de cobertura que no existe (§26.2).
export function buildExposure({ boundaryUtc, observations = [] } = {}) {
  const boundary = toUtcTimestamp(boundaryUtc);
  if (!boundary.ok) {
    return { ok: false, errors: [{ field: "boundaryUtc", code: boundary.code, message: "El boundary de la exposición requiere timestamp con zona explícita (UTC)." }] };
  }
  if (!Array.isArray(observations)) {
    return { ok: false, errors: [{ field: "observations", code: "INVALID_OBSERVATIONS", message: "observations debe ser una lista." }] };
  }

  const errors = [];
  const byField = new Map();
  observations.forEach((observation, index) => {
    const outcome = buildExposureField(observation);
    if (!outcome.ok) {
      errors.push(...outcome.errors.map((error) => ({ ...error, field: `observations[${index}].${error.field}` })));
      return;
    }
    if (byField.has(outcome.record.field)) {
      errors.push({
        field: `observations[${index}]`,
        code: "DUPLICATE_EXPOSURE_FIELD",
        message: `La sección "${outcome.record.field}" se declara más de una vez; dos verdades sobre lo mismo.`,
      });
      return;
    }
    byField.set(outcome.record.field, outcome.record);
  });
  if (errors.length > 0) {
    return { ok: false, errors };
  }

  const fields = EXPOSURE_FIELDS.map((definition) => {
    const observed = byField.get(definition.key);
    if (observed !== undefined) {
      return observed;
    }
    return deepFreeze({
      field: definition.key,
      specLabel: definition.specLabel,
      section: definition.section,
      condition: EXPOSURE_CONDITION.MISSING,
      reason: "no provista por el backend en este scope; no se presume (§26.2)",
    });
  });

  const unavailable = fields
    .filter((field) => field.condition !== EXPOSURE_CONDITION.AVAILABLE)
    .map((field) => ({ field: field.field, condition: field.condition, reason: field.reason ?? null }));

  return {
    ok: true,
    exposure: deepFreeze({
      boundaryUtc: boundary.utc,
      fields,
      unavailable,
      // La exposición es estructuralmente completa aunque haya secciones
      // faltantes; la ausencia se conserva visible, no se esconde.
      structurallyComplete: true,
      hasUnavailableContent: unavailable.length > 0,
    }),
  };
}
