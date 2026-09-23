// Safety / Autonomy Envelope (IMP-23). Fuente: SPEC v1.1.1 §17 (carácter
// externo, duro y no aprendible del envelope; tabla de campos mínimos;
// "La policy puede aprender qué hacer dentro de él; no puede relajarlo ni
// reescribirlo"), §16.2 (niveles canónicos A0–A4) y §25.1 fila IMP-23
// ("Envelope no aprendible; ... baseline experimental no autorizado por
// defecto").
//
// Límites reales, umbrales y autorizaciones son EVIDENCE-DEPENDENT (§17:
// "Sus valores reales, umbrales y límites cuantitativos se completan con
// contratos y evidencia; no se inventan durante la compilación"). Un campo
// sin límite aprobado queda EVIDENCE_PENDING y NO confiere autoridad:
// fail-closed. El IMP-23 materializa el soporte; verificar que una
// configuración ausente/invalidada no obtiene autoridad no fabrica el límite
// (§25.2 nota IMP-23).

import { contentHashOf } from "../execution-contract/execution-contract.mjs";
import { isVersionLike } from "../contracts/identities.mjs";

export const ENVELOPE_KIND = "SAFETY_AUTONOMY_ENVELOPE";

// Espacio de acción canónico: las mismas acciones periódicas del registro
// Experience (§12.2) son el action space admitido en este sistema.
export const ENVELOPE_ACTIONS = ["BUY", "WAIT"];

// Niveles canónicos §16.2. Autonomía de experimento (§13.9) es otra cosa: una
// etiqueta compartida no crea equivalencia.
export const AUTONOMY_LEVELS = ["A0", "A1", "A2", "A3", "A4"];

// Tipos de gate de admisión de datos/estado del envelope (§17:
// "Data-validity / OOD gates"; §18.3: datos inválidos, drift grave,
// deterioro económico material).
export const GATE_KINDS = ["DATA_VALIDITY", "OOD", "DRIFT", "ECONOMIC_DETERIORATION", "DEADLINE"];

// Un límite o umbral sólo confiere autoridad cuando está APROBADO con
// referencia de aprobación. Sin evidencia queda EVIDENCE_PENDING y no
// autoriza; nunca se sustituye por un default.
export const LIMIT_STATUSES = ["APPROVED", "EVIDENCE_PENDING"];

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function isFinitePositive(value) {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function isPlainTextOrNull({ value, reason }) {
  return isNonEmptyString(value) || (value === null && isNonEmptyString(reason));
}

// §12.2 usaBUY/WAIT como acciones periódicas; §17 exige declarar el espacio
// permitido. Fuera de él, la acción es rechazada por el controller.
function validateAllowedActions(allowedActions, errors) {
  if (!Array.isArray(allowedActions)) {
    errors.push({ field: "allowedActions", code: "MISSING_REQUIRED", message: "§17 exige \"Allowed action space\" admitido y declarado." });
    return;
  }
  const unique = [...new Set(allowedActions)];
  if (unique.length !== allowedActions.length) {
    errors.push({ field: "allowedActions", code: "DUPLICATE_ACTION", message: "Una sola verdad por elemento del action space." });
  }
  for (const action of allowedActions) {
    if (!ENVELOPE_ACTIONS.includes(action)) {
      errors.push({ field: "allowedActions", code: "INVALID_ACTION", message: `"${action}" no es una acción del espacio canónico ${ENVELOPE_ACTIONS.join("/")}.` });
    }
  }
}

function validateScope(scope, errors) {
  if (!scope || typeof scope !== "object" || Array.isArray(scope)) {
    errors.push({ field: "scope", code: "MISSING_REQUIRED", message: "§17 exige \"Authorized product / campaign / mission\" como ámbito autorizado." });
    return;
  }
  const declared = ["product", "campaign", "mission"].filter((key) => isNonEmptyString(scope[key]));
  if (declared.length === 0) {
    errors.push({ field: "scope", code: "MISSING_SCOPE", message: "El ámbito autorizado exige al menos de product, campaign o mission." });
  }
  for (const key of ["product", "campaign", "mission"]) {
    const value = scope[key] ?? null;
    if (!isPlainTextOrNull({ value, reason: scope[`${key}PendingReason`] })) {
      errors.push({ field: `scope.${key}`, code: "INVALID_SCOPE_FIELD", message: `scope.${key} es texto o explicit-pending con razón; null silencioso no existe (§25.2).` });
    }
  }
}

function validateQuantityLimits(quantityLimits, errors) {
  if (!Array.isArray(quantityLimits) || quantityLimits.length === 0) {
    errors.push({ field: "quantityLimits", code: "MISSING_REQUIRED", message: "§17 exige \"Quantity / sizing limits\" declarados; vacíos o ausentes no conceden autoridad de compra." });
    return;
  }
  const seen = new Set();
  for (const limit of quantityLimits) {
    if (!isNonEmptyString(limit?.limitId)) {
      errors.push({ field: "quantityLimits[].limitId", code: "MISSING_LIMIT_ID", message: "Cada límite declara su identidad." });
      continue;
    }
    if (seen.has(limit.limitId)) {
      errors.push({ field: `quantityLimits.${limit.limitId}`, code: "DUPLICATE_LIMIT", message: "Una sola verdad por límite declarado." });
    }
    seen.add(limit.limitId);
    if (!isFinitePositive(limit.maxValueMw) && !(limit.maxValueMw === null && isNonEmptyString(limit.reason))) {
      errors.push({ field: `quantityLimits.${limit.limitId}`, code: "INVALID_LIMIT_VALUE", message: "El límite es un valor MW positivo, o explicit-pending con razón documentada (§25.2)." });
    }
    if (!LIMIT_STATUSES.includes(limit.status)) {
      errors.push({ field: `quantityLimits.${limit.limitId}.status`, code: "INVALID_LIMIT_STATUS", message: `El status debe ser ${LIMIT_STATUSES.join(" | ")}.` });
    }
    if (limit.status === "EVIDENCE_PENDING" && limit.maxValueMw !== null && !isNonEmptyString(limit.reason)) {
      errors.push({ field: `quantityLimits.${limit.limitId}.reason`, code: "MISSING_REASON", message: "Un límite presente aún no aprobado ocupa pending con su razón (§17: no se inventan valores)." });
    }
    if (limit.status === "APPROVED") {
      if (!isNonEmptyString(limit.approvalRef)) {
        errors.push({ field: `quantityLimits.${limit.limitId}.approvalRef`, code: "MISSING_APPROVAL_REF", message: "Un límite APPROVED declara su aprobación con referencia explícita (§17: validación y aprobación del sizing)." });
      }
      if (!isFinitePositive(limit.maxValueMw)) {
        errors.push({ field: `quantityLimits.${limit.limitId}.status`, code: "APPROVED_WITHOUT_VALUE", message: "Un límite APPROVED lleva su valor real; el pending no se convierte en aprobado (§25.2 nota IMP-23)." });
      }
    }
    if (!(limit.provenance && isNonEmptyString(limit.provenance.authority) && isNonEmptyString(limit.provenance.locator))) {
      errors.push({ field: `quantityLimits.${limit.limitId}.provenance`, code: "NO_PROVENANCE", message: "Cada límite declara authority y locator (§25.2)." });
    }
  }
}

function validateGates(gates, errors) {
  if (!Array.isArray(gates) || gates.length === 0) {
    errors.push({ field: "gates", code: "MISSING_REQUIRED", message: "§17 exige \"Data-validity / OOD gates\" declarados como condiciones de admisión." });
    return;
  }
  const seen = new Set();
  for (const gate of gates) {
    if (!isNonEmptyString(gate?.gateId)) {
      errors.push({ field: "gates[].gateId", code: "MISSING_GATE_ID", message: "Cada gate declara su identidad." });
      continue;
    }
    if (seen.has(gate.gateId)) {
      errors.push({ field: `gates.${gate.gateId}`, code: "DUPLICATE_GATE", message: "Una sola verdad por gate declarado." });
    }
    seen.add(gate.gateId);
    if (!GATE_KINDS.includes(gate.kind)) {
      errors.push({ field: `gates.${gate.gateId}.kind`, code: "INVALID_GATE_KIND", message: `kind debe ser ${GATE_KINDS.join(" | ")} (§17/§18.3).` });
    }
    if (gate.hardGate !== true) {
      errors.push({ field: `gates.${gate.gateId}.hardGate`, code: "GATE_NOT_HARD", message: "Un gate del envelope es hard: su breach puede causar HALT/DEMOTE sin consentimiento de policy (§17/§18.3)." });
    }
    if (gate.threshold !== undefined) {
      const rawValue = gate.threshold?.value ?? null;
      // §17: el OOD gate declara su umbral. Un valor numérico (p.ej. OOD
      // score) es representable igual que texto; null sin razón no existe.
      const thresholdValueOk = isFiniteNumber(rawValue) || isPlainTextOrNull({ value: rawValue, reason: gate.threshold?.reason ?? null });
      if (!thresholdValueOk) {
        errors.push({ field: `gates.${gate.gateId}.threshold`, code: "INVALID_THRESHOLD", message: "El umbral es un valor numérico, texto explícito, o explicit-pending con razón (§25.2 nota IMP-23)." });
      }
      if (!LIMIT_STATUSES.includes(gate.threshold?.status)) {
        errors.push({ field: `gates.${gate.gateId}.threshold.status`, code: "INVALID_THRESHOLD_STATUS", message: `El status del umbral debe ser ${LIMIT_STATUSES.join(" | ")}.` });
      }
      if (gate.threshold?.status === "APPROVED" && !isNonEmptyString(gate.threshold.approvalRef)) {
        errors.push({ field: `gates.${gate.gateId}.threshold.approvalRef`, code: "MISSING_THRESHOLD_APPROVAL_REF", message: "Un umbral APPROVED declara su aprobación con referencia explícita (§17: gates declarados con su aprobación)." });
      }
      if (gate.threshold?.status === "EVIDENCE_PENDING" && rawValue !== null && !isNonEmptyString(gate.threshold.reason)) {
        errors.push({ field: `gates.${gate.gateId}.threshold.reason`, code: "MISSING_REASON", message: "Un umbral presente aún no aprobado ocupa pending con su razón (§17: no se inventan valores)." });
      }
    }
    if (!(gate.provenance && isNonEmptyString(gate.provenance.authority) && isNonEmptyString(gate.provenance.locator))) {
      errors.push({ field: `gates.${gate.gateId}.provenance`, code: "NO_PROVENANCE", message: "Cada gate declara authority y locator (§25.2)." });
    }
  }
}

function validatePolicyAuthorizations(authorizedPolicyVersions, errors) {
  if (!Array.isArray(authorizedPolicyVersions) || authorizedPolicyVersions.length === 0) {
    errors.push({ field: "authorizedPolicyVersions", code: "MISSING_REQUIRED", message: "§17 exige \"Authorized Policy Version / autonomy level\"; sin versión autorizada no hay autoridad operativa." });
    return;
  }
  const seen = new Set();
  for (const authorization of authorizedPolicyVersions) {
    if (!isNonEmptyString(authorization?.policyVersion)) {
      errors.push({ field: "authorizedPolicyVersions[].policyVersion", code: "MISSING_VERSION", message: "Cada autorización declara la Policy Version." });
      continue;
    }
    if (seen.has(authorization.policyVersion)) {
      errors.push({ field: `authorizedPolicyVersions.${authorization.policyVersion}`, code: "DUPLICATE_VERSION", message: "Una sola verdad por versión autorizada." });
    }
    seen.add(authorization.policyVersion);
    if (!isVersionLike(authorization.underEnvelopeVersion)) {
      errors.push({ field: `authorizedPolicyVersions.${authorization.policyVersion}.underEnvelopeVersion`, code: "MISSING_VERSION", message: "La autoridad de una versión es bajo un envelope concreto; se declara su versión de envelope (§17/§18.3)." });
    }
    if (!["VALID", "RETIRED"].includes(authorization.status)) {
      errors.push({ field: `authorizedPolicyVersions.${authorization.policyVersion}.status`, code: "INVALID_AUTHORIZATION_STATUS", message: "El status de la autorización debe ser VALID o RETIRED (§18.3: no basta haber sido aprobada en el pasado)." });
    }
  }
}

// Validación del envelope contra la tabla mínima de §17. El envelope es un
// configuration object congelado: mismo contenido → mismo versionKey.
export function validateEnvelopeShape(envelope) {
  const errors = [];
  if (!envelope || typeof envelope !== "object" || Array.isArray(envelope)) {
    return { ok: false, errors: [{ field: "(envelope)", code: "MISSING_ENVELOPE", message: "Envelope ausente (§17)." }] };
  }
  if (envelope.kind !== ENVELOPE_KIND) {
    errors.push({ field: "kind", code: "INVALID_KIND", message: `kind debe ser ${ENVELOPE_KIND} (§17).` });
  }
  if (!isVersionLike(envelope.envelopeVersion)) {
    errors.push({ field: "envelopeVersion", code: "MISSING_VERSION", message: "El envelope declara su versión congelable (§18.4 receipt de transición)." });
  }
  if (!AUTONOMY_LEVELS.includes(envelope.autonomyLevel)) {
    errors.push({ field: "autonomyLevel", code: "INVALID_AUTONOMY_LEVEL", message: `autonomyLevel debe ser un nivel canónico de §16.2: ${AUTONOMY_LEVELS.join(", ")}.` });
  }
  validateScope(envelope.scope, errors);
  validateAllowedActions(envelope.allowedActions, errors);
  validateQuantityLimits(envelope.quantityLimits, errors);
  if (!isPlainTextOrNull({ value: envelope.deadlineConstraints ?? null, reason: envelope.deadlinePendingReason ?? null })) {
    errors.push({ field: "deadlineConstraints", code: "INVALID_DEADLINE_CONSTRAINTS", message: "§17 exige \"Deadline / completion constraints\" declarados, o explicit-pending con razón." });
  }
  validateGates(envelope.gates, errors);
  validatePolicyAuthorizations(envelope.authorizedPolicyVersions, errors);
  if (!isPlainTextOrNull({ value: envelope.rollbackBaseline ?? null, reason: envelope.rollbackBaselinePendingReason ?? null })) {
    errors.push({ field: "rollbackBaseline", code: "INVALID_ROLLBACK_BASELINE", message: "El fallback de rollback se declara con su texto, o explicit-pending con razón (§18.3: dependencia operativa explícita)." });
  }
  return { ok: errors.length === 0, errors };
}

export function envelopeVersionKeyOf(envelope) {
  if (!isVersionLike(envelope?.envelopeVersion)) {
    return null;
  }
  return typeof envelope.envelopeVersion === "string"
    ? `version:${envelope.envelopeVersion}`
    : `hash:${envelope.envelopeVersion.contentHash}`;
}

// §17: "no puede relajarlo ni reescribirlo". El freeze debe ser PROFUNDO:
// los arrays anidados (quantityLimits, gates, allowedActions) y la
// provenance interna quedan igualmente sellados; si el caller conserva la
// referencia viva no puede mutar el envelope que el controller ejecuta
// (corrección a IMP23-ENV-MUT-01, revisión IMP-23).
function deepFreeze(value) {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) {
    return value;
  }
  Object.freeze(value);
  for (const key of Object.keys(value)) {
    deepFreeze(value[key]);
  }
  return value;
}

// Construye y congela el envelope (§17). Fail-closed: un envelope inválido
// no existe como autoridad.
export function buildEnvelope(input = {}) {
  const envelope = {
    kind: ENVELOPE_KIND,
    envelopeVersion: input.envelopeVersion ?? null,
    autonomyLevel: input.autonomyLevel ?? null,
    scope: input.scope ?? null,
    allowedActions: input.allowedActions ?? null,
    quantityLimits: input.quantityLimits ?? null,
    deadlineConstraints: input.deadlineConstraints ?? null,
    deadlinePendingReason: input.deadlinePendingReason ?? null,
    gates: input.gates ?? null,
    authorizedPolicyVersions: input.authorizedPolicyVersions ?? null,
    rollbackBaseline: input.rollbackBaseline ?? null,
    rollbackBaselinePendingReason: input.rollbackBaselinePendingReason ?? null,
    rollbackBaselineAuthorizationRef: input.rollbackBaselineAuthorizationRef ?? null,
    safeNonActionState: input.safeNonActionState ?? null,
    safeNonActionStateProvenance: input.safeNonActionStateProvenance ?? null,
  };
  const validation = validateEnvelopeShape(envelope);
  if (!validation.ok) {
    return validation;
  }
  return {
    ok: true,
    envelope: deepFreeze({
      ...envelope,
      contentHash: contentHashOf(envelope),
      versionKey: envelopeVersionKeyOf(envelope),
      authorityGranted: false,
    }),
  };
}

// Propuesta de cambio del envelope originada por Learning (§17: "Learning
// puede producir una propuesta de cambio futuro... esa propuesta no modifica
// la versión activa"). El artefacto produce un PROPOSAL separado, sin
// autoridad y sin vínculo al envelope activo: el caller lo recibe, nunca se
// aplica aquí.
export function buildEnvelopeChangeProposal({ trigger, proposedChanges } = {}) {
  if (!isNonEmptyString(trigger) || !proposedChanges || typeof proposedChanges !== "object" || Array.isArray(proposedChanges)) {
    return { ok: false, code: "INVALID_PROPOSAL", message: "La propuesta necesita su origen (trigger) y sus cambios propuestos (§17)." };
  }
  return {
    ok: true,
    proposal: Object.freeze({
      class: "ENVELOPE_CHANGE_PROPOSAL",
      trigger,
      proposedChanges: deepFreeze({ ...proposedChanges }),
      appliedToActiveEnvelope: false,
      authorityGranted: false,
    }),
  };
}
