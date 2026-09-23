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
