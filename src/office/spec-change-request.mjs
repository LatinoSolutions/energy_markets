// SPEC_CHANGE_REQUEST (IMP-26). Fuente: SPEC v1.1.1 §20.2.12 ("Si implementar
// revela una contradicción genuina con un requisito canónico frozen, o exige
// modificar semántica frozen, se detiene la rama afectada") y §20.2.14 (cambio
// de semántica frozen es límite real de escalación).
//
// Astra no aprueba su propio cambio arquitectónico: la solicitud vuelve a la
// autoridad de arquitectura/research. Una preferencia técnica local que preserva
// la SPEC no activa este proceso.

import { normalizeImpId } from "./canonical-graph.mjs";

// El IMP/subtask puede venir como "IMP-26" o "IMP-26 / ST-26.1"; la rama es el
// IMP afectado.
export function branchFromImpSubtask(impSubtask) {
  const match = /\bIMP-(\d{1,3})\b/.exec(String(impSubtask ?? ""));
  return match ? normalizeImpId(`IMP-${match[1]}`) : null;
}

export const SPEC_CHANGE_REQUEST_FIELDS = Object.freeze([
  "specVersion",
  "impSubtask",
  "sourceSections",
  "exactContradiction",
  "observedEvidence",
  "whyNotImplementable",
  "minimumChange",
  "downstreamImpact",
  "workSafelyCompleted",
  "workBlocked",
  "requestedAuthority",
]);

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function isNonEmptyList(value) {
  return Array.isArray(value) && value.length > 0;
}

export function buildSpecChangeRequest(input = {}) {
  const errors = [];
  for (const field of SPEC_CHANGE_REQUEST_FIELDS) {
    const value = input[field];
    const present = field === "workSafelyCompleted" || field === "workBlocked" ? isNonEmptyList(value) || isNonEmptyString(value) : isNonEmptyString(value);
    if (!present) errors.push({ field, code: "MISSING_REQUIRED", message: `El SPEC_CHANGE_REQUEST exige "${field}" (§20.2.12).` });
  }
  if (errors.length > 0) return { ok: false, errors, request: null };
  const branch = branchFromImpSubtask(input.impSubtask);
  if (input.requestedBy !== undefined && input.requestedBy !== null && input.requestedBy === input.requestedAuthority) {
    return { ok: false, errors: [{ field: "requestedAuthority", code: "SELF_APPROVAL", message: "La autoridad solicitada no puede ser el propio solicitante: Astra no aprueba su cambio arquitectónico (§20.2.12)." }], request: null };
  }
  const request = Object.freeze({
    kind: "SPEC_CHANGE_REQUEST",
    branch,
    resolved: false,
    specVersion: input.specVersion,
    impSubtask: input.impSubtask,
    sourceSections: input.sourceSections,
    exactContradiction: input.exactContradiction,
    observedEvidence: input.observedEvidence,
    whyNotImplementable: input.whyNotImplementable,
    minimumChange: input.minimumChange,
    downstreamImpact: input.downstreamImpact,
    workSafelyCompleted: input.workSafelyCompleted,
    workBlocked: input.workBlocked,
    requestedAuthority: input.requestedAuthority,
    requestedBy: input.requestedBy ?? null,
  });
  return { ok: true, errors: [], request };
}

// La rama afectada se detiene; el resto del trabajo elegible continúa.
export function stopsBranch(request, impId) {
  if (!request) return false;
  const branch = request.branch ?? branchFromImpSubtask(request.impSubtask);
  if (branch === null) return true;
  return branch === normalizeImpId(impId);
}

export function stopsWork(request, workBlocked) {
  if (!request || !Array.isArray(request.workBlocked)) return false;
  return request.workBlocked.includes(workBlocked);
}
