// Protocolo de mezcla/cadence (IMP-19, DEP-21). Fuente: SPEC v1.1.1 §12.3 ("Las
// tres fuentes pueden alimentar el Learning Loop únicamente con source
// provenance preservada. No se presentan con igual fuerza probatoria por
// defecto. Cualquier weighting, sampling o combinación debe predeclararse y
// versionarse"), §11.5 (Learning Loop con review/training OFFline; la cadence
// se materializa dentro de esas invariantes) y §25.2 fila IMP-19 (DEP-21
// "protocolo de mezcla/cadence"; PRODUCES_EVIDENCE "protocolo offline
// predeclarado/versionado con provenance conservada").
//
// El protocolo se construye declarado y versionado; sin declaración de mezcla
// (reusando el contrato de IMP-17) no se combinan fuentes. Cadence exige
// triggers explícitos de review/training: no hay cadencia implícita.

import { contentHashOf } from "../execution-contract/execution-contract.mjs";
import { validateMixtureDeclaration } from "../experience/index.mjs";

export const LEARNING_PROTOCOL_KIND = "DEP-21_LEARNING_PROTOCOL";
export const LEARNING_PROTOCOL_STATES = Object.freeze({ OPEN: "OPEN", FROZEN: "FROZEN" });

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function fail(errors) {
  return { ok: errors.length === 0, errors };
}

// Construye el protocolo DEP-21 con mezcla predeclarada/versionada y cadence
// explícita. La provenance de las fuentes vive en cada Experience record; el
// protocolo sólo fija las reglas de combinación y los disparadores, que no se
// infieren por defecto.
export function buildLearningProtocol({ mixtureDeclaration = null, cadence = null, declaredBy = null, protocolVersion = null, state = LEARNING_PROTOCOL_STATES.OPEN, frozenAtUtc = null } = {}) {
  const errors = [];
  if (!isNonEmptyString(protocolVersion)) {
    errors.push({ field: "protocolVersion", code: "MISSING_PROTOCOL_VERSION", message: "El protocolo offline se versiona (§12.3/§25.2 DEP-21)." });
  }
  if (!isNonEmptyString(declaredBy)) {
    errors.push({ field: "declaredBy", code: "MISSING_DECLARED_BY", message: "El protocolo declara quién lo predeclara (§12.3)." });
  }
  const mixtureCheck = validateMixtureDeclaration(mixtureDeclaration);
  if (!mixtureCheck.ok) {
    errors.push({ field: "mixtureDeclaration", code: mixtureCheck.code, message: mixtureCheck.message });
  }
  if (!cadence || typeof cadence !== "object" || Array.isArray(cadence)) {
    errors.push({ field: "cadence", code: "MISSING_CADENCE", message: "El protocolo declara su cadence de review/training (§11.5)." });
  } else {
    if (!isNonEmptyString(cadence.reviewTrigger)) {
      errors.push({ field: "cadence.reviewTrigger", code: "MISSING_REVIEW_TRIGGER", message: "La cadence declara cuándo se revisa (p. ej. al cierre de ventana/campaña) (§11.5)." });
    }
    if (!isNonEmptyString(cadence.trainingTrigger)) {
      errors.push({ field: "cadence.trainingTrigger", code: "MISSING_TRAINING_TRIGGER", message: "La cadence declara cuándo se entrena offline (§11.5)." });
    }
  }
  if (state !== LEARNING_PROTOCOL_STATES.OPEN && state !== LEARNING_PROTOCOL_STATES.FROZEN) {
    errors.push({ field: "state", code: "INVALID_PROTOCOL_STATE", message: "state sólo toma OPEN o FROZEN." });
  }
  if (state === LEARNING_PROTOCOL_STATES.FROZEN && !isNonEmptyString(frozenAtUtc)) {
    errors.push({ field: "frozenAtUtc", code: "MISSING_FROZEN_AT_UTC", message: "Un protocolo FROZEN lleva su sello UTC de congelación ex-ante (§15.2)." });
  }
  if (errors.length > 0) {
    return { ok: false, errors };
  }
  const core = {
    protocolKind: LEARNING_PROTOCOL_KIND,
    schemaVersion: "1.0",
    protocolVersion,
    state,
    declaredBy,
    frozenAtUtc: state === LEARNING_PROTOCOL_STATES.FROZEN ? frozenAtUtc : null,
    mixtureDeclaration: {
      declarationVersion: mixtureDeclaration.declarationVersion,
      weights: { ...mixtureDeclaration.weights },
      declaredBy: mixtureDeclaration.declaredBy,
    },
    cadence: {
      reviewTrigger: cadence.reviewTrigger,
      trainingTrigger: cadence.trainingTrigger,
      minClosedCampaigns: Number.isInteger(cadence.minClosedCampaigns) ? cadence.minClosedCampaigns : null,
    },
  };
  core.contentHash = contentHashOf(core);
  return { ok: true, protocol: Object.freeze(core) };
}

export function isLearningProtocol(value) {
  return Boolean(value) && typeof value === "object"
    && value.protocolKind === LEARNING_PROTOCOL_KIND
    && typeof value.contentHash === "string" && value.contentHash.length === 64;
}

// Verifica la integridad content-addressed del protocolo y su estado FROZEN
// antes de usarlo para evaluar/entrenar (§25.2.3 IMP-19).
export function assertProtocolFrozenBeforeEvaluation({ protocol = null, evaluatedAtUtc = null } = {}) {
  if (!isLearningProtocol(protocol)) {
    return { ok: false, code: "MISSING_PROTOCOL", message: "La evaluación necesita el protocolo DEP-21 materializado (§25.2 DEP-21)." };
  }
  const { contentHash, ...core } = protocol;
  if (contentHashOf(core) !== contentHash) {
    return { ok: false, code: "PROTOCOL_HASH_MISMATCH", message: "El protocolo fue alterado después de declararse: no gobierna la evaluación (§12.3/§15.2)." };
  }
  if (protocol.state !== LEARNING_PROTOCOL_STATES.FROZEN) {
    return { ok: false, code: "PROTOCOL_NOT_FROZEN", message: "Antes de entrenar/evaluar una candidate el protocolo aplicable debe estar congelado (§25.2.3 IMP-19)." };
  }
  if (isNonEmptyString(evaluatedAtUtc) && isNonEmptyString(protocol.frozenAtUtc) && evaluatedAtUtc < protocol.frozenAtUtc) {
    return { ok: false, code: "PROTOCOL_FROZEN_AFTER_EVALUATION", message: "El protocolo debe congelarse ANTES de la evaluación: el sello temporal es posterior (§15.2)." };
  }
  return { ok: true, code: "PROTOCOL_FROZEN" };
}