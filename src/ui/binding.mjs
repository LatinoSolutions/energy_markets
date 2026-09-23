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
    return { ok: false, condition: "UNAVAILABLE", reason: "sin manifest backend verificado no hay dato que mostrar (§26.5)" };
  }
  const resolved = resolveBackendRecord(backendIndex, recordKey, revisionId);
  if (resolved === null) {
    return { ok: false, condition: "UNAVAILABLE", reason: `"${recordKey}"/"${revisionId}" no existe en el manifest backend verificado` };
  }
  if (value === undefined || value === null) {
    return { ok: false, condition: "UNAVAILABLE", reason: `"${recordKey}"/"${revisionId}" está referido pero no aporta valor canónico` };
  }
  const hash = canonicalValueSha256(value);
  if (!hash.ok) {
    return { ok: false, condition: "UNAVAILABLE", reason: "el valor candidato no es dato canónico serializable" };
  }
  if (resolved.valueSha256 !== hash.sha256) {
    return { ok: false, condition: "UNAVAILABLE", reason: `el valor candidato no coincide con el contenido registrado por "${recordKey}"/"${revisionId}" (§26.5)` };
  }
  return { ok: true, bound: { recordKey, revisionId, value, valueSha256: hash.sha256 } };
}

export { bindRecord };
