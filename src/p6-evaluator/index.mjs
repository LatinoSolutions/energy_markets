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
  EVALUATOR_VERSION,
  SIZING_RULE_VERSION,
  RUN_STATUS_DIMENSION_DEFAULTS,
} from "./replay.mjs";
