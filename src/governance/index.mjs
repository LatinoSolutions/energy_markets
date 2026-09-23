// Surface del enforcement externo del envelope y rollback (IMP-23).
// Fuente: SPEC v1.1.1 §§17–18, §25.1 fila IMP-23 y §25.2 nota IMP-23.

export {
  ENVELOPE_KIND,
  ENVELOPE_ACTIONS,
  AUTONOMY_LEVELS,
  GATE_KINDS,
  LIMIT_STATUSES,
  buildEnvelope,
  validateEnvelopeShape,
  envelopeVersionKeyOf,
  buildEnvelopeChangeProposal,
} from "./envelope.mjs";

export {
  CONTROLLER_KIND,
  LEVELS_WITH_BUY_AUTHORITY,
  createExternalEnvelopeController,
} from "./enforcement.mjs";

export {
  isVersionValidUnderEnvelope,
  resolveRollbackTarget,
  executeRollback,
  ROLLBACK_BLOCKED_CODE,
} from "./rollback.mjs";

export {
  GOVERNANCE_RECEIPT_KIND,
  TRANSITION_TYPES,
  buildGovernanceReceipt,
  receiptIdentityOf,
  createGovernanceReceiptRegistry,
} from "./receipts.mjs";
