// Contrato conceptual del registro Experience (IMP-17). Fuente: SPEC v1.1.1
// §12.2 (piezas documentadas del registro: source type, Policy Version, state
// snapshot/frontier, outputs de Strategies y uncertainty, recommended action,
// executed action/fills, human intervention, next Procurement State,
// outcome/reward y benchmark version al cierre, timestamps), §12.1 (límites de
// cada fuente), §11.5 (Real Experience alimenta sólo el ciclo offline; no
// mutación en caliente) y §25.2 fila IMP-17 (records versionados) y nota
// ("casos sintéticos no cierran DEP-22 ni generan Real Experience").
//
// Regla del builder §12.2: "las piezas que sólo existen al cierre o cuando hay
// ejecución se registran en ese contexto; no se fabrican ejecuciones para
// completar un esquema". Fail-closed: pieza ausente = pendiente explícito,
// nunca inventada.

import { contentHashOf } from "../execution-contract/execution-contract.mjs";
import {
  isExperienceSourceType,
  FILL_EVIDENCE_KINDS,
} from "./source-types.mjs";

export const ARTIFACT_KIND = "EXPERIENCE_RECORD";

export const RECORD_STATES = Object.freeze({
  OPEN: "OPEN",
  CLOSED: "CLOSED",
});

export const HUMAN_INTERVENTION_KINDS = Object.freeze({
  VETO: "VETO",
  DELAY: "MODIFICATION_DELAY",
  MODIFICATION: "MODIFICATION",
});

const PERIODIC_ACTIONS = ["BUY", "WAIT"];

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function isFiniteNumberOrNull(value) {
  return value === null || (typeof value === "number" && Number.isFinite(value));
}

function fail(errors) {
  return { ok: errors.length === 0, errors };
}

function requireNonEmpty(field, value, errors, message) {
  if (!isNonEmptyString(value)) {
    errors.push({ field, code: "MISSING_REQUIRED", message: message ?? `La pieza obligatoria "${field}" de §12.2 falta y no se fabrica.` });
  }
}

function requireObject(field, value, errors, message) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    errors.push({ field, code: "MISSING_REQUIRED", message: message ?? `La pieza obligatoria "${field}" de §12.2 falta y no se fabrica.` });
  }
}

function requireFiniteNumberOrNull(field, value, errors, message) {
  if (!isFiniteNumberOrNull(value)) {
    errors.push({ field, code: "MISSING_REQUIRED", message: message ?? `La pieza "${field}" de §12.2 falta y no se inventa.` });
  }
}

// Validación de un fill como pieza de execution (§12.2 "executed action e
// información de execution/fill cuando aplique"). Un fill declara su propio
// evidence kind: REAL_FILL sólo dentro de REAL_EXECUTION; SIMULATED_FILL es lo
// que produce replay/shadow; COUNTERFACTUAL_FILL es el contrafactual modelado
// etiquetado (§12.1).
export function validateFill(fill, { sourceType }) {
  const errors = [];
  if (!fill || typeof fill !== "object" || Array.isArray(fill)) {
    return fail([{ field: "execution.fills[]", code: "INVALID_FILL", message: "El fill debe ser un objeto con su evidence kind." }]);
  }
  const kind = fill.evidenceKind;
  if (!Object.values(FILL_EVIDENCE_KINDS).includes(kind)) {
    errors.push({ field: "execution.fills[].evidenceKind", code: "MISSING_FILL_EVIDENCE_KIND", message: "Cada fill declara si es REAL_FILL, SIMULATED_FILL o COUNTERFACTUAL_FILL (§12.1)." });
  }
  if (kind === FILL_EVIDENCE_KINDS.REAL_FILL && sourceType !== "REAL_EXECUTION") {
    // §12.3: no se convierte retrospectivamente Replay en factual. Un fill
    // real dentro de una fuente simulada mezcla fuerza probatoria.
    errors.push({ field: "execution.fills[].evidenceKind", code: "PROBATORY_FORCE_MIXING", message: "REAL_FILL sólo existe en REAL_EXECUTION (§12.1/§12.3: la mezcla no convierte Replay en factual)." });
  }
  requireFiniteNumberOrNull("quantity", fill.quantity ?? null, errors);
  requireFiniteNumberOrNull("price", fill.price ?? null, errors, "Sin precio alcanzable el fill queda con price null y no-fill; no se inventa precio (§12.2).");
  requireNonEmpty("timestampUtc", fill.timestampUtc ?? null, errors, "El fill lleva su timestamp de ejecución; sin él la pieza no existe (§12.2).");
  return fail(errors);
}

// La intervención humana (§12.2) debe documentarse completa: kind, timestamp,
// razón y provenance. Una intervención sin trazabilidad desaparecería del
// dataset, lo que §12.3 prohíbe.
export function validateHumanIntervention(intervention) {
  const errors = [];
  if (!Object.values(HUMAN_INTERVENTION_KINDS).includes(intervention.kind)) {
    errors.push({ field: "humanIntervention.kind", code: "INVALID_INTERVENTION_KIND", message: "La intervención debe ser VETO, MODIFICATION o MODIFICATION_DELAY (§12.2)." });
  }
  requireNonEmpty("humanIntervention.timestampUtc", intervention.timestampUtc, errors, "La intervención lleva timestamp propio (§12.2).");
  requireNonEmpty("humanIntervention.reason", intervention.reason, errors, "La intervención lleva su razón (§12.2).");
  requireObject("humanIntervention.provenance", intervention.provenance, errors, "La intervención lleva provenance (§12.2).");
  return fail(errors);
}

// Validación de conformidad con §12.2. No valida para "completar el esquema":
// las piezas que no existen aún quedan explicit-pending (null + estado), no
// inventadas.
export function validateExperienceRecordShape(record) {
  const errors = [];
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    return fail([{ field: "record", code: "INVALID_RECORD", message: "Experience record ausente o malformado (§12.2)." }]);
  }

  // Source type (§12.2, primera pieza).
  if (!isExperienceSourceType(record.sourceType)) {
    errors.push({ field: "sourceType", code: "INVALID_SOURCE_TYPE", message: "sourceType debe ser REPLAY, SHADOW o REAL_EXECUTION (§12.1)." });
  }

  // Policy Version (§12.2): reconstruye la versión que generó la recomendación.
  requireNonEmpty("policyVersion", record.policyVersion, errors);

  // State snapshot / data frontier (§12.2): qué info estaba disponible bajo
  // known-at semantics; incluye referencia de datos con identity, nunca "datos".
  requireObject("stateSnapshot", record.stateSnapshot, errors);
  if (record.stateSnapshot && typeof record.stateSnapshot === "object") {
    requireNonEmpty("stateSnapshot.frontierUtc", record.stateSnapshot.frontierUtc, errors, "El frontier del state snapshot lleva su frontera exacta (§12.2).");
    requireObject("stateSnapshot.dataReference", record.stateSnapshot.dataReference, errors, "El state snapshot referencia su fuente de datos con identity/version (§12.2).");
  }

  // Outputs de Strategies admitidas y uncertainty: array (puede estar vacío si
  // no hubo evidencia de Strategies; se conserva vacío, no inventado).
  if (!Array.isArray(record.strategyOutputs)) {
    errors.push({ field: "strategyOutputs", code: "MISSING_REQUIRED", message: "strategyOutputs debe ser lista (puede ser vacía); sin ella no se reconstruye la evidencia consumida (§12.2)." });
  }

  // Recommended action (§12.2): se conservar la propuesta original. BUY/WAIT,
  // o null sólo con razón documentada (frontera sin decisión emitida); null
  // silencioso no existe aquí.
  if ((record.recommendedAction ?? null) === null && !isNonEmptyString(record.noRecommendationReason)) {
    errors.push({ field: "noRecommendationReason", code: "MISSING_NO_RECOMMENDATION_REASON", message: "Un null de recommendedAction sólo existe con su razón documentada en noRecommendationReason (§12.2: no se fabrica la pieza)." });
  }
  if (record.recommendedAction !== null && record.recommendedAction !== undefined
    && !PERIODIC_ACTIONS.includes(record.recommendedAction)) {
    errors.push({ field: "recommendedAction", code: "INVALID_ACTION", message: "recommendedAction sólo toma BUY o WAIT (§12.2)." });
  }

  // Execution (§12.2, cuando aplique): executedAction y fills declarados; los
  // fills se validan con fill.validateFill (evidence kind por fuente).
  if (record.execution !== null && record.execution !== undefined) {
    requireObject("execution", record.execution, errors);
    if (record.execution && typeof record.execution === "object") {
      if (record.execution.executedAction !== null && record.execution.executedAction !== undefined
        && !PERIODIC_ACTIONS.includes(record.execution.executedAction)) {
        errors.push({ field: "execution.executedAction", code: "INVALID_ACTION", message: "executedAction sólo toma BUY o WAIT cuando existe (§12.2)." });
      }
      if (record.execution.fills !== undefined && record.execution.fills !== null) {
        if (!Array.isArray(record.execution.fills)) {
          errors.push({ field: "execution.fills", code: "INVALID_FILL_LIST", message: "fills debe ser lista (puede ser vacía explicit)." });
        } else {
          record.execution.fills.forEach((fill, index) => {
            const fillCheck = validateFill(fill, { sourceType: record.sourceType });
            errors.push(...fillCheck.errors.map((error) => ({ ...error, field: `execution.fills[${index}].${error.field}` })));
          });
        }
      }
    }
  }

  // ¿En Replay los fills son siempre simulados? §12.1: sí, la ejecución es
  // calculada por el evaluador. Un fill de REPLAY/SHADOW sólo puede ser
  // SIMULATED_FILL o (en Real con intervención) COUNTERFACTUAL_FILL; la regla
  // específica REAL_FILL sólo en REAL_EXECUTION la fija validateFill.

  // Human intervention (§12.2, cuando exista): completa y trazable.
  if (record.humanIntervention !== null && record.humanIntervention !== undefined) {
    const interventionCheck = validateHumanIntervention(record.humanIntervention);
    errors.push(...interventionCheck.errors.map((e) => (e.field.startsWith("humanIntervention.") ? e : { ...e, field: `humanIntervention.${e.field}` })));
  }

  // Next Procurement State (§12.2): la transición de obligación/cobertura/
  // volumen/tiempo. En abierto puede ser la propia frontera (estado de
  // partida): se exige referencia, no un relato.
  if (record.nextState !== null && record.nextState !== undefined) {
    requireObject("nextState", record.nextState, errors);
  }

  // Outcome / reward y benchmark version (§12.2): "al cierre". En estado OPEN
  // son explicit-pending; CLOSED los exige porque el cierre ya sucedió y una
  // pieza ya existente no puede dejarse fuera (§12.2).
  if (record.recordState === RECORD_STATES.CLOSED) {
    requireObject("outcome", record.outcome, errors, "Un registro CLOSED debe llevar outcome/reward y benchmark version al cierre (§12.2).");
    if (record.outcome && typeof record.outcome === "object") {
      requireFiniteNumberOrNull("outcome.reward", record.outcome.reward ?? null, errors, "El reward del cierre es numérico o explicit-null no evaluable (§12.2).");
      requireNonEmpty("outcome.benchmarkVersion", record.outcome.benchmarkVersion, errors, "El cierre declara la versión de benchmark utilizada (§12.2).");
    }
  } else if (record.recordState !== RECORD_STATES.OPEN) {
    errors.push({ field: "recordState", code: "INVALID_RECORD_STATE", message: "recordState sólo toma OPEN o CLOSED (§12.2)." });
  }
  if (record.recordState === RECORD_STATES.OPEN && record.outcome != null) {
    errors.push({ field: "outcome", code: "OUTCOME_NOT_AT_CLOSURE", message: "El outcome sólo existe al cierre; un registro OPEN lo declara pending, nunca satisfecho (§12.2)." });
  }

  // Timestamps (§12.2): procedencia temporal de recomendación e intervención.
  requireNonEmpty("recommendedAtUtc", record.recommendedAtUtc, errors, "El timestamp de recomendación preserva el orden temporal (§12.2).");
  requireNonEmpty("recordedAtUtc", record.recordedAtUtc, errors, "El timestamp de registro preserva la procedencia de observación (§12.2).");

  // Provenance del registro: referencia externa trazable (run/receipt/registro
  // operativo) que dice de dónde sale el registro; sin ella no hay atribución
  // honesta posible.
  requireObject("provenance", record.provenance, errors);
  if (record.provenance && typeof record.provenance === "object") {
    requireNonEmpty("provenance.kind", record.provenance.kind, errors);
  }

  // Nota de alcance sintético (§25.2 nota IMP-17): si el registro es sintético
  // de prueba, debe llevarlo marcado y NO puede declararse Real Experience.
  if (record.synthetic === true) {
    if (record.sourceType === "REAL_EXECUTION") {
      errors.push({ field: "sourceType", code: "SYNTHETIC_REAL_FORBIDDEN", message: "Un caso sintético no genera Real Experience (§25.2 nota IMP-17)." });
    }
  }

  // No se adultera el sello Real: la marca proveedora de REAL sólo la pone la
  // ejecución efectiva; el schema la exige como sourceType, nunca como tag
  // añadido junto a otra fuente.
  if (record.synthetic !== true && record.sourceType === "REAL_EXECUTION") {
    requireObject("provenance.realExecutionEvidence", record.provenance.realExecutionEvidence, errors, "Un registro Real necesita provenance.realExecutionEvidence con referencia a la actuación efectiva; la etiqueta sola no demuestra (§25.2 nota y §12.1)." );
  }

  return fail(errors);
}

// Identidad versionada del registro (§25.2 "records versionados"): hash del
// contenido sin recordId (identidad content-addressed, como el receipt P6 de
// IMP-14). Mismo contenido → mismo recordId; corrección → recordId nuevo.
export function recordIdentityOf(record) {
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    return null;
  }
  const forIdentity = { ...record };
  delete forIdentity.recordId;
  return contentHashOf(forIdentity);
}

// Construye y congela un registro conforme §12.2. No completa esquema: las
// piezas inexistentes quedan explicit-pending. Devuelve { ok, record } o
// { ok: false, errors } fail-closed.
export function buildExperienceRecord(input = {}) {
  const record = {
    artifactKind: ARTIFACT_KIND,
    recordState: input.recordState ?? RECORD_STATES.OPEN,
    sourceType: input.sourceType ?? null,
    policyVersion: input.policyVersion ?? null,
    stateSnapshot: input.stateSnapshot ?? null,
    strategyOutputs: input.strategyOutputs ?? [],
    uncertainty: input.uncertainty ?? null,
    recommendedAction: input.recommendedAction ?? null,
    noRecommendationReason: input.noRecommendationReason ?? null,
    execution: input.execution ?? null,
    humanIntervention: input.humanIntervention ?? null,
    nextState: input.nextState ?? null,
    outcome: input.outcome ?? null,
    recommendedAtUtc: input.recommendedAtUtc ?? null,
    recordedAtUtc: input.recordedAtUtc ?? null,
    synthetic: input.synthetic ?? false,
    provenance: input.provenance ?? null,
  };
  // §12.2 "cuando aplique": un execution presente sin la lista de fills la
  // declara vacía explícita; no se fabrican fills para completar el esquema.
  if (record.execution && typeof record.execution === "object" && record.execution.fills === undefined) {
    record.execution = { ...record.execution, fills: [] };
  }
  const validation = validateExperienceRecordShape(record);
  if (!validation.ok) {
    return validation;
  }
  const recordId = recordIdentityOf(record);
  return { ok: true, record: Object.freeze({ ...record, recordId }) };
}

// Reclassificación al cierre (§12.2): un registro OPEN que llegó a cerrarse
// produce un NUEVO registro CLOSED (la identidad de contenido cambia); el
// original no se edita. El caller decide conservar ambos (append-only).
export function closeExperienceRecord({ record, outcome, nextState }) {
  if (record?.artifactKind !== ARTIFACT_KIND) {
    return { ok: false, code: "INVALID_RECORD", message: "Sólo se cierra un record Experience (§12.2)." };
  }
  if (record.recordState === RECORD_STATES.CLOSED) {
    return { ok: false, code: "ALREADY_CLOSED", message: "El registro ya está cerrado; el cierre es una pieza que ocurre una vez (§12.2)." };
  }
  return buildExperienceRecord({
    ...record,
    recordState: RECORD_STATES.CLOSED,
    outcome: outcome ?? null,
    nextState: nextState ?? record.nextState ?? null,
  });
}
