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

// IMP-24: materialización del governor de Production Governance. Fuente:
// SPEC v1.1.1 §25.1 fila IMP-24, §25.2 nota IMP-24 (tres hitos) y §§16–18.
export {
  PRODUCTION_GOVERNOR_KIND,
  RESEARCH_RECEIPT_KIND,
  SHADOW_EVIDENCE_KIND,
  STAGE_RECEIPT_KINDS,
  PROMOTION_GATES,
  FORBIDDEN_AUTHORITY_ROLES,
  PROTECTED_GOVERNANCE_DOMAINS,
  FIRST_ACTIVATION_REFUSAL_CODE,
  FIRST_ACTIVATION_SCOPE,
  GOVERNANCE_CHANGE_SCOPE_PREFIX,
  POLICY_VERSION_PROMOTION_SCOPE_PREFIX,
  receiveGovernanceEvidence,
  evaluateAutonomyPromotionGate,
  createProductionGovernor,
} from "./production-governor.mjs";
