// Superficie del alcance IMP-21: evaluar Q07 (hora de decisión intradía) en
// protocolo separado (§25.1 fila IMP-21; §25.2.2 fila IMP-21; §25.2.3 IMP-21;
// §24 DEP-17; §§2, 15, 24).

export {
  Q07_PROTOCOL_ID,
  Q07_PROTOCOL_VERSION,
  CANONICAL_SPEC_REF,
  CANONICAL_SPEC_SHA256,
  INTRADAY_CANDIDATE_KINDS,
  BUCKET_PREDICATE_OPERATORS,
  BUCKET_OBSERVABLE_FIELDS,
  BUCKET_PREDICATE_FIELDS,
  ALLOWED_TIMING_CHANGE,
  PROTOCOL_FIELDS,
  OBLIGATION_BINDING_FIELDS,
  SAMPLE_BINDING_FIELDS,
  OOS_POLICIES,
  validateQ07Protocol,
  freezeQ07Protocol,
  verifyFrozenQ07Protocol,
  evaluateBucketPredicate,
  assertProtocolIdentityFor,
  assertNoDocumentedHourPresupposition,
} from "./protocol.mjs";

export {
  FILL_DENIED_NO_CAUSAL_SNAPSHOT,
  createIntradaySnapshotRegistry,
  selectCausalSnapshot,
  runQ07HourArm,
  assertHourArmsParity,
} from "./intraday-execution.mjs";

export {
  INTRADAY_AUDIT_SCOPE,
  evaluateIntradayAuditGate,
  consumeIntradayAuditBinding,
} from "./gates.mjs";

export {
  bucketSufficiencyOf,
  buildEntryHourProfile,
  assertProfileProducesNoSelection,
} from "./profile.mjs";
