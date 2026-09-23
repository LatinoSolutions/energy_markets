// Governance receipts de transición (IMP-23). Fuente: SPEC v1.1.1 §18.4:
// "Los tipos de transición registrados son PROMOTE, HOLD, DEMOTE, HALT y
// ROLLBACK. Cada transición produce un receipt versionado que contiene:
// Gate/evidencia que la desencadena. Policy Version anterior. Nuevo
// estado/versión. Nivel de autonomía. Versión del envelope." y "Las
// transiciones deben permitir reconstruir por qué una versión obtuvo,
// conservó o perdió autoridad."
//
// Los receipts son content-addressed y el registro append-only: no existe
// update ni delete (mismo patrón que los Experience records de IMP-17 y los
// run receipts de IMP-14).

import { contentHashOf } from "../execution-contract/execution-contract.mjs";
import { STATE_NAMESPACES, resolveState } from "../contracts/states.mjs";

export const GOVERNANCE_RECEIPT_KIND = "GOVERNANCE_TRANSITION_RECEIPT";

// Una sola verdad: la lista canónica de §18.4 vive en el contrato de estados
// (src/contracts/states.mjs, aceptado en IMP-01); el receipt la CONSUME, no
// la redeclara (corrección IMP23-TRANS-DUP-03, revisión IMP-23).
export const TRANSITION_TYPES = STATE_NAMESPACES.governance_event.values;

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

// Los cinco campos de §18.4; sin uno el transition no es reconstruible y no
// es un receipt. Fail-closed.
export function buildGovernanceReceipt(input = {}) {
  const transitionType = input.transitionType ?? null;
  const canonicalTransition = transitionType === null ? null : resolveState("governance_event", transitionType);
  if (canonicalTransition === null || !canonicalTransition.ok) {
    return { ok: false, code: "INVALID_TRANSITION_TYPE", message: `Los tipos declarados son ${TRANSITION_TYPES.join(", ")} (§18.4, namespace governance_event).` };
  }
  if (!isNonEmptyString(input.triggerGate) && !isNonEmptyString(input.triggerEvidenceRef)) {
    return { ok: false, code: "MISSING_TRIGGER", message: "El receipt declara el gate/evidencia que desencadena la transición (§18.4)." };
  }
  if (!isNonEmptyString(input.previousState)) {
    return { ok: false, code: "MISSING_PREVIOUS_STATE", message: "El receipt declara la Policy Version/nuevo estado anterior (§18.4)." };
  }
  if (!isNonEmptyString(input.newState)) {
    return { ok: false, code: "MISSING_NEW_STATE", message: "El receipt declara el nuevo estado/versión (§18.4)." };
  }
  if (!isNonEmptyString(input.autonomyLevel)) {
    return { ok: false, code: "MISSING_AUTONOMY_LEVEL", message: "El receipt declara el nivel de autonomía (§18.4)." };
  }
  if (!isNonEmptyString(input.envelopeVersionKey)) {
    return { ok: false, code: "MISSING_ENVELOPE_VERSION", message: "El receipt declara la versión del envelope (§18.4)." };
  }
  if (!isNonEmptyString(input.atUtc)) {
    return { ok: false, code: "MISSING_TIMESTAMP", message: "La transición declara su instante (§6.1)." };
  }
  const receipt = {
    artifactKind: GOVERNANCE_RECEIPT_KIND,
    transitionType,
    triggerGate: input.triggerGate ?? null,
    triggerEvidenceRef: input.triggerEvidenceRef ?? null,
    previousState: input.previousState,
    newState: input.newState,
    autonomyLevel: input.autonomyLevel,
    envelopeVersionKey: input.envelopeVersionKey,
    executedAtUtc: input.atUtc,
  };
  const receiptId = contentHashOf(receipt);
  return { ok: true, receipt: Object.freeze({ ...receipt, receiptId }) };
}

export function receiptIdentityOf(receipt) {
  if (!receipt || typeof receipt !== "object" || Array.isArray(receipt) || receipt.artifactKind !== GOVERNANCE_RECEIPT_KIND) {
    return null;
  }
  const forIdentity = { ...receipt };
  delete forIdentity.receiptId;
  return contentHashOf(forIdentity);
}

// Registro append-only de receipts de governance (§18.4). Re-registro
// idéntico se conservan; el primero declara la verdad.

export function createGovernanceReceiptRegistry() {
  const entries = [];
  const byReceiptId = new Map();

  return {
    register({ receipt }) {
      if (!receipt || typeof receipt !== "object" || Array.isArray(receipt) || receipt.artifactKind !== GOVERNANCE_RECEIPT_KIND) {
        return { ok: false, code: "INVALID_RECEIPT", message: "Sólo se registran artifacts GOVERNANCE_TRANSITION_RECEIPT (§18.4)." };
      }
      if (typeof receipt.receiptId !== "string" || receipt.receiptId.length === 0) {
        return { ok: false, code: "MISSING_RECEIPT_ID", message: "El receipt versionado declara su receiptId (§18.4)." };
      }
      if (receiptIdentityOf(receipt) !== receipt.receiptId) {
        return { ok: false, code: "RECEIPT_ID_MISMATCH", message: "El receiptId declarado no coincide con el contenido: el registro no atestigua lo que no produjo (§25.2)." };
      }
      const entry = Object.freeze({
        receiptId: receipt.receiptId,
        registeredAtOrder: entries.length + 1,
        receipt,
      });
      entries.push(entry);
      if (!byReceiptId.has(receipt.receiptId)) {
        byReceiptId.set(receipt.receiptId, entry);
      }
      return { ok: true, receiptId: receipt.receiptId, entryCount: entries.length };
    },
    has(receiptId) {
      return byReceiptId.has(receiptId);
    },
    receiptOf(receiptId) {
      return (byReceiptId.get(receiptId) ?? null)?.receipt ?? null;
    },
    transitionsOfType(type) {
      return entries.filter((entry) => entry.receipt.transitionType === type).map((entry) => entry.receipt);
    },
    snapshot() {
      return entries.map((entry) => Object.freeze({ ...entry }));
    },
    entryCount() {
      return entries.length;
    },
  };
}
