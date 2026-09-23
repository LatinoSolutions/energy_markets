// P6 evaluator/replay. Fuente: SPEC v1.1.1 §14 (contratos CANONICAL/FROZEN
// P6.1–P6.10) — construcción del replay y ledgers P6 (IMP-12).
export { buildReplayBundle } from "./input-bundle.mjs";
export {
  createImmutableLedger,
  coverageLedgerRow,
  DECISION_LEDGER_FIELDS,
  EXECUTION_LEDGER_FIELDS,
  COVERAGE_LEDGER_FIELDS,
} from "./ledgers.mjs";
export {
  runP6Replay,
  EVALUATOR_ID,
  SIZING_RULE_VERSION,
  RUN_STATUS_DIMENSION_DEFAULTS,
} from "./replay.mjs";
// Run receipts y reproducibilidad P6.9/P6.10 (IMP-14).
export {
  materializeRunReceipt,
  buildOutputBundle,
  createRunReceiptRegistry,
  compareReproducibility,
  receiptIdentityOf,
  outputBundleDigestsOf,
} from "./run-receipts.mjs";
// Campaña manual end-to-end y closure gate P6 (IMP-15).
export {
  evaluateCampaignManually,
  evaluateCampaignFromRun,
  compareManualVsEvaluator,
  manualComparisonDigest,
} from "./manual-campaign.mjs";
export {
  evaluateP6ClosureGate,
  materializeP6ClosureReceipt,
  MANUAL_FIXTURE_IDS,
} from "./closure-gate.mjs";
