// Contratos de identidad y versión. Fuente: SPEC v1.1 §0 (control documental),
// §14.2 (identidades/versiones del bundle), §20.2.7 (WORK-PACKET),
// §20.2.8 (ST_RECEIPT) y §20.2.10 (IMP_RECEIPT). La serialización es
// IMPLEMENTATION DETAIL; los campos semánticos y su linkage son normativos.

const VERSION_PATTERN = /^v?\d+(?:\.\d+)+$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;

export function isVersionString(value) {
  return typeof value === "string" && VERSION_PATTERN.test(value);
}

export function isSha256(value) {
  return typeof value === "string" && SHA256_PATTERN.test(value);
}

// Una versión puede ser una versión documental (1.1) o una versión por
// content-hash del artefacto, como exige este workspace no-git.
export function isVersionLike(value) {
  if (isVersionString(value)) {
    return true;
  }
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return isSha256(value.contentHash);
  }
  return false;
}

function fail(errors) {
  return { ok: errors.length === 0, errors };
}

function requireNonEmpty(field, value, errors) {
  if (typeof value !== "string" || value.trim().length === 0) {
    errors.push({ field, code: "MISSING_REQUIRED", message: `Falta el campo obligatorio "${field}".` });
  }
}

function requireList(field, value, errors, allowEmpty = false) {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0)) {
    errors.push({ field, code: "MISSING_REQUIRED", message: `Falta el campo obligatorio "${field}".` });
  }
}

function requireObject(field, value, errors) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    errors.push({ field, code: "MISSING_REQUIRED", message: `Falta la identidad obligatoria "${field}".` });
  }
}

// Un baseline puede describirse como texto (estado de partida) o como versión
// content-hash; no se exige la forma textual si la representación versionada
// ya está presente.
function requireVersionLikeOrText(field, value, errors) {
  if (isVersionLike(value)) {
    return;
  }
  if (typeof value === "string" && value.trim().length > 0) {
    return;
  }
  errors.push({ field, code: "MISSING_VERSION", message: `"${field}" ausente o sin forma de versión.` });
}

// Identidad de la SPEC que gobierna el trabajo.
export function validateSpecIdentity(spec) {
  const errors = [];
  requireNonEmpty("spec.id", spec?.id, errors);
  requireNonEmpty("spec.version", spec?.version, errors);
  if (!isVersionString(spec?.version)) {
    errors.push({ field: "spec.version", code: "INVALID_VERSION", message: "spec.version no tiene forma de versión." });
  }
  if (!isSha256(spec?.sha256)) {
    errors.push({ field: "spec.sha256", code: "INVALID_SHA256", message: "spec.sha256 debe ser SHA-256 hex de 64 caracteres." });
  }
  return fail(errors);
}

const WORK_PACKET_REQUIRED = [
  "packetId",
  "project",
  "parentImp",
  "subtaskId",
  "objective",
  "allowedScope",
  "prohibitedScope",
  "sourceSections",
  "dependenciesConsumed",
  "frozenDecisions",
  "mustNotChange",
  "expectedOutputs",
  "subtaskAcceptance",
  "parentAcceptanceContext",
  "requiredTests",
  "requiredEvidence",
  "handoffFormat",
];

// WORK-PACKET: equivalente semántico de todos los campos de §20.2.7.
export function validateWorkPacket(packet) {
  const errors = [];
  if (!packet || typeof packet !== "object") {
    return fail([{ field: "(packet)", code: "MISSING_PACKET", message: "WORK-PACKET ausente." }]);
  }
  for (const field of WORK_PACKET_REQUIRED) {
    requireNonEmpty(field, packet[field], errors);
  }
  requireList("inputs", packet.inputs, errors);
  const specOutcome = validateSpecIdentity(packet.spec);
  errors.push(...specOutcome.errors);
  if (!isVersionLike(packet.baselineVersion)) {
    errors.push({ field: "baselineVersion", code: "MISSING_VERSION", message: "baselineVersion ausente o inválida." });
  }
  return fail(errors);
}

// ST_RECEIPT: §20.2.8. Un PASS del worker es recomendación, no aceptación.
const ST_RECEIPT_LIST_FIELDS = ["inputsUsed", "artifactsChanged", "testsRun", "testResults", "evidenceProduced"];
const ST_RECEIPT_EMPTY_OK_FIELDS = ["assumptions", "deviations", "dependencyFindings", "failuresRetries"];

// §20.2.5/.8: el receipt hereda la identidad del WORK-PACKET, así que debe
// declarar cada miembro (packet, subtask, parent, proyecto y SPEC ID/version/
// hash). Un objeto de identidad vacío o parcial no es trazable.
const RECEIPT_IDENTITY_REQUIRED = ["packetId", "subtaskId", "parentImp", "project", "specId", "specVersion", "specSha256"];

function validateReceiptIdentity(identity, errors) {
  if (!identity || typeof identity !== "object" || Array.isArray(identity)) {
    errors.push({ field: "packetSubtaskParentIdentity", code: "MISSING_REQUIRED", message: "El receipt no declara su identidad de packet/subtask/parent." });
    return;
  }
  for (const field of RECEIPT_IDENTITY_REQUIRED) {
    requireNonEmpty(`packetSubtaskParentIdentity.${field}`, identity[field], errors);
  }
  if (identity.specVersion !== undefined && !isVersionString(identity.specVersion)) {
    errors.push({ field: "packetSubtaskParentIdentity.specVersion", code: "INVALID_VERSION", message: "specVersion no tiene forma de versión." });
  }
  if (identity.specSha256 !== undefined && !isSha256(identity.specSha256)) {
    errors.push({ field: "packetSubtaskParentIdentity.specSha256", code: "INVALID_SHA256", message: "specSha256 debe ser SHA-256 hex de 64 caracteres." });
  }
}

export function validateStReceipt(receipt) {
  const errors = [];
  if (!receipt || typeof receipt !== "object") {
    return fail([{ field: "(receipt)", code: "MISSING_RECEIPT", message: "ST_RECEIPT ausente." }]);
  }
  validateReceiptIdentity(receipt.packetSubtaskParentIdentity, errors);
  requireNonEmpty("workerModelRoute", receipt.workerModelRoute, errors);
  requireVersionLikeOrText("startingBaseline", receipt.startingBaseline, errors);
  requireNonEmpty("result", receipt.result, errors);
  requireNonEmpty("recommendedStatus", receipt.recommendedStatus, errors);
  for (const field of ST_RECEIPT_LIST_FIELDS) {
    requireList(field, receipt[field], errors);
  }
  for (const field of ST_RECEIPT_EMPTY_OK_FIELDS) {
    requireList(field, receipt[field], errors, true);
  }
  if (!isVersionLike(receipt.resultingVersion)) {
    errors.push({ field: "resultingVersion", code: "MISSING_VERSION", message: "resultingVersion ausente o inválida." });
  }
  return fail(errors);
}

// IMP_RECEIPT: §20.2.10 y clarificación del Director (parent-acceptance-instructions).
// Sólo se produce cuando el gate completo del padre pasa.
const IMP_RECEIPT_LIST_FIELDS = ["requiredStIdentities", "reviewerRunIdentities", "evidenceTestHashes", "prerequisiteChecks"];

export function validateImpReceipt(receipt) {
  const errors = [];
  if (!receipt || typeof receipt !== "object") {
    return fail([{ field: "(receipt)", code: "MISSING_RECEIPT", message: "IMP_RECEIPT ausente." }]);
  }
  requireObject("specIdentity", receipt.specIdentity, errors);
  requireNonEmpty("impIdentity", receipt.impIdentity, errors);
  requireNonEmpty("scope", receipt.scope, errors);
  requireNonEmpty("outcome", receipt.outcome, errors);
  for (const field of IMP_RECEIPT_LIST_FIELDS) {
    requireList(field, receipt[field], errors);
  }
  requireList("unresolvedLimits", receipt.unresolvedLimits, errors, true);
  const specOutcome = validateSpecIdentity(receipt.specIdentity);
  errors.push(...specOutcome.errors);
  if (!isVersionLike(receipt.version)) {
    errors.push({ field: "version", code: "MISSING_VERSION", message: "version del IMP ausente o inválida." });
  }
  return fail(errors);
}

function sameIdentity(left, right) {
  return typeof left === "string" && left === right;
}

// Linkage de identidad/versión entre WORK-PACKET y ST_RECEIPT. Un receipt que
// no referencia el packet/subtask/parent/proyecto/SPEC correctos no es trazable:
// un hash coincidente no valida una tupla de identidad en conflicto (§20.2.5).
export function linkStReceiptToPacket(packet, receipt) {
  const errors = [];
  const identity = receipt?.packetSubtaskParentIdentity;
  validateReceiptIdentity(identity, errors);
  if (errors.length > 0) {
    return fail(errors);
  }
  if (!sameIdentity(identity.packetId, packet?.packetId)) {
    errors.push({ field: "packetSubtaskParentIdentity.packetId", code: "IDENTITY_MISMATCH", message: "packetId no coincide con el WORK-PACKET." });
  }
  if (!sameIdentity(identity.subtaskId, packet?.subtaskId)) {
    errors.push({ field: "packetSubtaskParentIdentity.subtaskId", code: "IDENTITY_MISMATCH", message: "subtaskId no coincide con el WORK-PACKET." });
  }
  if (!sameIdentity(identity.parentImp, packet?.parentImp)) {
    errors.push({ field: "packetSubtaskParentIdentity.parentImp", code: "IDENTITY_MISMATCH", message: "parentImp no coincide con el WORK-PACKET." });
  }
  if (!sameIdentity(identity.project, packet?.project)) {
    errors.push({ field: "packetSubtaskParentIdentity.project", code: "IDENTITY_MISMATCH", message: "project no coincide con el WORK-PACKET." });
  }
  if (!sameIdentity(identity.specId, packet?.spec?.id)) {
    errors.push({ field: "packetSubtaskParentIdentity.specId", code: "IDENTITY_MISMATCH", message: "specId no coincide con la SPEC del WORK-PACKET." });
  }
  if (!sameIdentity(identity.specVersion, packet?.spec?.version)) {
    errors.push({ field: "packetSubtaskParentIdentity.specVersion", code: "IDENTITY_MISMATCH", message: "specVersion no coincide con la SPEC del WORK-PACKET." });
  }
  if (identity.specSha256 !== packet?.spec?.sha256) {
    errors.push({ field: "packetSubtaskParentIdentity.specSha256", code: "IDENTITY_MISMATCH", message: "specSha256 no coincide con la SPEC del WORK-PACKET." });
  }
  return fail(errors);
}