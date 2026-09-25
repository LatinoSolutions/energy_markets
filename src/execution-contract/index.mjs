// Superficie pública del execution contract y cost ledger P5.6 de IMP-07.
// Fuente: SPEC v1.1.1 §13.6 (reglas frozen), §14.2/§14.4 (versión del contrato
// y campos del ledger) y §5.5 (coste desconocido nunca cero). Materializa el
// contrato aplicable a ambos brazos y sus validadores; no cierra DEP-05 como
// dato real ni declara P5.6 válido mientras los parámetros sigan
// provisionales o desconocidos.

export {
  CLIENT_PACKAGE_PROVENANCE,
  EXECUTION_PARAMETER_DEFINITIONS,
  GAS_QUARTERLY_EXECUTION_PARAMETERS,
  IMP07_ACCEPTANCE_TEST,
  P56_FROZEN_RULES,
  PARAMETER_STATUSES,
  assertArmParity,
  contentHashOf,
  createGasQuarterlyExecutionContract,
  evaluateP56Validity,
  executionParameterOf,
  validateExecutionContract,
  versionKeyOf,
} from "./execution-contract.mjs";

export {
  COST_KINDS,
  COST_STATUSES,
  createGasQuarterlyCostLedger,
  sumKnownLedgerCosts,
  validateCostLedger,
} from "./cost-ledger.mjs";

export {
  deriveSimulatedFillPrice,
  selectEligibleReference,
  toEpochMs,
  validateCausalFill,
} from "./causal-fill.mjs";

export {
  BRIDGE_GATE_THRESHOLDS,
  DECLARED_BROKEN_SPREAD_POLICIES,
  FRESHNESS_COVERAGE_TARGET,
  MIN_PENALTY_OBSERVATIONS,
  TRADES_BRIDGE_GATE,
  TRADES_CONTRACT_ACCEPTANCE_TEST,
  TRADES_CONTRACT_ID,
  TRADES_CONTRACT_VERSION,
  TRADES_CONTROL_SOURCE_MODE,
  TRADES_FREEZE_SCOPE,
  TRADES_FROZEN_RULES,
  TRADES_MISSING_DATA_RULES,
  TRADES_PENALTY_AGGRESSION_RULE,
  TRADES_PENALTY_SIGN_RULE,
  TRADES_SENSITIVITY_GRID,
  TRADES_SOURCE_MODE,
  TRADES_VERSION_LABEL,
  buildTradesFreezeCandidate,
  deriveFreshnessForMission,
  derivePenaltyForMission,
  deriveTradesFillPrice,
  evaluateTradesFreeze,
  freezeApprovalProblem,
  isDeclaredBrokenSpreadPolicy,
  tradesConfigHash,
  validateTradesContract,
} from "./trades-contract.mjs";
