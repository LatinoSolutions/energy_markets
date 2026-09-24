// Registro de desconocidos visibles de los experimentos IMP-20. Fuente: SPEC
// v1.1.1 §25.1 fila IMP-20 ("desconocidos visibles") y §6.2/§7.2.1 (missing,
// stale, SURPRISE UNAVAILABLE, preservación de razones). Un diseño
// predeclarado sin desconocidos registrados, o con un desconocido sin razón,
// es un faltante disimulado y se rechaza fail-closed (§19.1: ningún input
// crítico ausente disimulado).

export const UNKNOWN_KINDS = Object.freeze([
  "AUDIT_MISSING",
  "DATA_NOT_OBSERVABLE",
  "HUMAN_DECISION",
  "SPEC_UNDETERMINED",
]);

export const HE_KIND = "HUMAN_DECISION";

export function isUnknownKind(value) {
  return UNKNOWN_KINDS.includes(value);
}

// Un desconocido requiere: subject, kind, reason (preservación de razón), uno
// o varios artefactos/sesiones a los que pertenece y la consecuencia
// declarada (qué ACTO queda bloqueado mientras exista).
export function validateUnknownEntry(unknown) {
  const errors = [];

  if (!unknown || typeof unknown !== "object") {
    return { ok: false, errors: [{ field: "unknowns[]", code: "INVALID_UNKNOWN", message: "La entrada de desconocido debe ser un objeto." }] };
  }

  if (typeof unknown.unknownId !== "string" || unknown.unknownId.trim().length === 0) {
    errors.push({ field: "unknowns[].unknownId", code: "MISSING_REQUIRED", message: "El desconocido necesita un identificador estable." });
  }
  if (typeof unknown.subject !== "string" || unknown.subject.trim().length === 0) {
    errors.push({ field: "unknowns[].subject", code: "MISSING_REQUIRED", message: "El desconocido necesita el sujeto específico que se desconoce." });
  }
  if (!isUnknownKind(unknown.kind)) {
    errors.push({ field: "unknowns[].kind", code: "INVALID_KIND", message: "kind debe ser AUDIT_MISSING, DATA_NOT_OBSERVABLE, HUMAN_DECISION o SPEC_UNDETERMINED." });
  }
  if (typeof unknown.reason !== "string" || unknown.reason.trim().length === 0) {
    errors.push({ field: "unknowns[].reason", code: "MISSING_REASON", message: "El desconocido debe preservar su razón; una ausencia sin razón es un faltante disimulado (§6.2)." });
  }
  if (unknown.kind !== HE_KIND && (typeof unknown.blockedAct !== "string" || unknown.blockedAct.trim().length === 0)) {
    errors.push({ field: "unknowns[].blockedAct", code: "MISSING_BLOCKED_ACT", message: "El desconocido técnico debe declarar qué acto queda bloqueado mientras exista." });
  }

  return { ok: errors.length === 0, errors };
}

export function validateUnknownsRegistry(unknowns) {
  if (!Array.isArray(unknowns) || unknowns.length === 0) {
    return {
      ok: false,
      errors: [
        {
          field: "unknowns",
          code: "UNKNOWN_NOT_VISIBLE",
          message: "El experimento no declaró ningún desconocido visible; un diseño sin desconocidos oculta el estado real del mapping y del audit (§25.1).",
        },
      ],
    };
  }

  const errors = [];
  for (const unknown of unknowns) {
    const result = validateUnknownEntry(unknown);
    if (!result.ok) {
      errors.push(...result.errors);
    }
  }

  const seen = new Set();
  for (const unknown of unknowns) {
    if (typeof unknown?.unknownId === "string") {
      if (seen.has(unknown.unknownId)) {
        errors.push({ field: "unknowns[].unknownId", code: "DUPLICATE_UNKNOWN", message: `Desconocido duplicado: ${unknown.unknownId}.` });
      }
      seen.add(unknown.unknownId);
    }
  }

  return { ok: errors.length === 0, errors };
}
