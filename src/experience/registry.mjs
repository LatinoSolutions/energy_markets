// Registro Experience y guarda de Policy Version activa (IMP-17). Fuente:
// SPEC v1.1.1 §12.3 ("Las tres fuentes pueden alimentar el Learning Loop
// únicamente con source provenance preservada"), §11.5 ("La policy activa no
// se reescribe online... cambios crean una nueva versión"; "Cada acción debe
// seguir siendo reconstruible mediante la versión que la produjo") y §25.2
// fila IMP-17 ("records versionados; ninguna actualización hot").
//
// El registro es append-only y content-addressed: un record corrige/redacta
// con recordId nuevo y el anterior se preserva. No existe API de update,
// delete o reorder de records. La Policy Version activa es un holder frozen:
// sólo un ciclo offline explícito crea un versión nueva, y ningún record
// registrado cambia su policyVersion declarada.

import { recordIdentityOf, ARTIFACT_KIND } from "./record.mjs";

// Registro append-only de Experience records (§12.3/§25.2). Cada registro
// re-deriva recordId del contenido recibido: un record mutado después de su
// build entra con identidad distinta o no entra si declara un recordId que no
// corresponde (fail-closed), y nunca sobrescribe un registro previo.
export function createExperienceRegistry() {
  const entries = [];
  const byRecordId = new Map();

  return {
    register({ record }) {
      if (!record || typeof record !== "object" || Array.isArray(record) || record.artifactKind !== ARTIFACT_KIND) {
        return { ok: false, code: "INVALID_RECORD", message: "Sólo se registran artifacts " + ARTIFACT_KIND + " (§12.2)." };
      }
      if (typeof record.recordId !== "string" || record.recordId.length === 0) {
        return { ok: false, code: "MISSING_RECORD_ID", message: "El record versionado declara su recordId (§25.2 fila IMP-17)." };
      }
      const derivedId = recordIdentityOf(record);
      if (derivedId !== record.recordId) {
        return { ok: false, code: "RECORD_ID_MISMATCH", message: "El recordId declarado no coincide con el contenido del record: el registro no puede atestiguar lo que no produjo (§25.2)." };
      }
      // Append-only: los re-registros idénticos se conservan (patrón receipts
      // IMP-14, §25.2 "no borrar runs previos").
      const entry = Object.freeze({
        recordId: record.recordId,
        registeredAtOrder: entries.length + 1,
        record,
      });
      entries.push(entry);
      if (!byRecordId.has(record.recordId)) {
        byRecordId.set(record.recordId, entry);
      }
      return { ok: true, recordId: record.recordId, entryCount: entries.length };
    },
    has(recordId) {
      return byRecordId.has(recordId);
    },
    recordOf(recordId) {
      return (byRecordId.get(recordId) ?? null)?.record ?? null;
    },
    // Preservación: snapshot congelado del historial completo (§12.3).
    snapshot() {
      return entries.map((entry) => Object.freeze({ ...entry }));
    },
    entryCount() {
      return entries.length;
    },
  };
}

// Guarda de Policy Version activa (§11.5). La activa no se reescribe online:
// no hay método de mutación de versión; el único cambio es replaceViaOfflineCycle
// con una versión NUEVA (distinta de la activa), que representa el resultado
// del ciclo offline de §11.5. El historial preserva la secuencia completa y
// cada record sigue reconstruible con la versión que lo produjo.
export function createActivePolicyVersionHolder({ initialVersion }) {
  if (typeof initialVersion !== "string" || initialVersion.trim().length === 0) {
    throw new TypeError("El holder de Policy Version necesita una versión inicial (§11.5).");
  }
  let current = initialVersion;
  const history = [initialVersion];

  return {
    // La versión activa sólo sale congelada: un caller no puede sobrescribir
    // el estado interno tocando el retorno.
    current() {
      return Object.freeze(current);
    },
    history() {
      return [...history];
    },
    // §11.5: cambio de parámetros/valor/lógica/calibración = versión nueva;
    // re-declarar la versión activa no es un cambio y se rechaza.
    replaceViaOfflineCycle({ newVersion, learningCycleRef }) {
      if (typeof newVersion !== "string" || newVersion.trim().length === 0) {
        return { ok: false, code: "MISSING_NEW_VERSION", message: "El ciclo offline produce una versión declarada (§11.5)." };
      }
      if (newVersion === current) {
        return { ok: false, code: "NO_HOT_REWRITE", message: "La versión activa no se reescribe ni se re-declara en caliente; cambios = versión nueva (§11.5)." };
      }
      if (!history.includes(newVersion)) {
        history.push(newVersion);
      }
      const previousVersion = current;
      current = newVersion;
      return { ok: true, previousVersion, activatedVersion: current, learningCycleRef: learningCycleRef ?? null };
    },
  };
}
