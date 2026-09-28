// UI-01 — binding de datos del backend para las superficies visuales. Fuente:
// SPEC v1.1.1 §26.5 (la UI no es Source of Truth; sólo muestra lo que el
// boundary backend de IMP-29 expone) y docs/product/UI-01_VISUAL_REFERENCE_BRIEF.md
// (no manufacturar resultados de backtests, hechos de campaña ni evidencia).
//
// Un dato llega a la UI únicamente si:
//   1. resuelve a un registro/versión del manifest backend verificado, y
//   2. su valor coincide con el contenido canónico registrado (mismo hash).
// Todo lo demás se declara como estado explícito UNAVAILABLE, nunca como
// valor. No inventa datos downstream.

import { canonicalValueSha256 } from "../pit-views/pit-record.mjs";
import { resolveBackendRecord } from "../operator-interface/backend-records.mjs";

function bindRecord(backendIndex, { recordKey, revisionId, value }) {
  if (backendIndex === null) {
    return { ok: false, condition: "UNAVAILABLE", reason: "no verified backend manifest; there is no data to show (§26.5)" };
  }
  const resolved = resolveBackendRecord(backendIndex, recordKey, revisionId);
  if (resolved === null) {
    return { ok: false, condition: "UNAVAILABLE", reason: `"${recordKey}"/"${revisionId}" does not exist in the verified backend manifest` };
  }
  if (value === undefined || value === null) {
    return { ok: false, condition: "UNAVAILABLE", reason: `"${recordKey}"/"${revisionId}" is referenced but carries no canonical value` };
  }
  const hash = canonicalValueSha256(value);
  if (!hash.ok) {
    return { ok: false, condition: "UNAVAILABLE", reason: "the candidate value is not canonical serializable data" };
  }
  if (resolved.valueSha256 !== hash.sha256) {
    return { ok: false, condition: "UNAVAILABLE", reason: `the candidate value does not match the content recorded by "${recordKey}"/"${revisionId}" (§26.5)` };
  }
  return { ok: true, bound: { recordKey, revisionId, value, valueSha256: hash.sha256 } };
}

export { bindRecord };
