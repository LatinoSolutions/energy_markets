// Superficie pública del productor de fuente de trades de TR-01. Fuente:
// OWNER_PATCH_TRADES_MODE_2026-09-25.md §3 y TRADES_MODE_PLAN.md TR-01.
// Reglas puras: elegibilidad PIT, dedup, Delete point-in-time, cobertura,
// inventario, calendario Power DE y decisión de fuente. No hay cálculo
// económico, ni estrategia, ni lectura de resultados.

export {
  BROKEN_SPREAD_POLICIES,
  DEFAULT_BROKEN_SPREAD_POLICY,
  ELIGIBILITY_REASON,
  AGGREGATOR,
  aggregateEligibility,
  classifyAggressor,
  eligibilityReasons,
  isEligibleTrade,
  measureBrokenSpreadPolicies,
  normalizedBrokenSpread,
} from "./eligibility.mjs";

export {
  dedupKey,
  dedupTrades,
  marketColumns,
  tradeObservationKey,
} from "./dedup.mjs";

export {
  DELETE_TM_SEMANTICS,
  buildDeleteIndex,
  eligibleTradesAt,
  isDeletedAt,
  isEligibleAt,
  measureDeleteTmSemantics,
  tradeEpochMs,
  tradeLegIdentity,
} from "./delete-point-in-time.mjs";

export {
  coverageByInstrumentDay,
  daysWithoutTrades,
  instrumentIdentity,
  summarizeInstrumentCoverage,
} from "./coverage.mjs";

export { buildTradesInventory } from "./inventory.mjs";

export { contractWindowsFromReference } from "./contract-windows.mjs";

export { buildTradesMeasurement, detectSchemaChanges } from "./aggregate.mjs";

export { createTradesMeasurementAccumulator } from "./measurement.mjs";

export {
  POWER_DE_CALENDAR_SOURCE,
  easterSunday,
  isPowerDeExchangeDay,
  powerDeExchangeDays,
  powerDeExchangeDaysBetween,
  powerDeHolidays,
} from "./power-calendar.mjs";

export {
  GAS_THE_CALENDAR_SOURCE,
  gasTheExchangeDays,
  gasTheExchangeDaysBetween,
  gasTheHolidays,
  isGasTheExchangeDay,
} from "./gas-calendar.mjs";

export {
  MISSION,
  classifyMission,
  densityFromIndexes,
  frontContract,
  marketOf,
  measurePatch0Density,
  measurePatch0FromCoverage,
  monthsToDelivery,
} from "./patch0-density.mjs";

export {
  LAKE_DERIVED_ARTIFACTS,
  SOURCE_DECISION_STATUS,
  SOURCE_IDS,
  buildDataSourceDecision,
  compareSourceInventories,
} from "./source-decision.mjs";

export { TRADES_SOURCE_PRODUCER_VERSION, buildTradesSourceManifest } from "./manifest.mjs";
