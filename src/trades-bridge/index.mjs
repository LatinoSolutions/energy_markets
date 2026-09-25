// Superficie pública del motor de medición del puente (TR-03). Fuente:
// TRADES_MODE_PLAN.md TR-03 y docs/canonical/v1_1_1/
// OWNER_PATCH_TRADES_MODE_2026-09-25.md §3-§4. Mediciones de mercado sin
// estrategia: no lee ledgers, fills ni resultados de estrategia.

export {
  BRIDGE_WINDOW,
  DIP10,
  DIP10_HISTORY_RULE,
  FRESHNESS_LIMIT_CANDIDATES_SECONDS,
  HALVES,
  OBSERVATION_RULES,
  OBSERVATION_RULE_LIST,
  SLOT_LABELS,
  SLOT_MIXED_AGGRESSOR,
  SLOT_STEP_SECONDS,
  TOB_SLOT_RULE,
  TRADES_BRIDGE_ACCEPTANCE_TEST,
  TRADES_BRIDGE_VERSION,
  TRADES_PATCH_IDENTITY,
} from "./constants.mjs";

export {
  berlinOffsetMinutes,
  berlinWallClockToEpochMs,
  bridgeHalves,
  dayEpochMs,
  halfOfDate,
  isWithinWindow,
  isoDateOfEpochMs,
  slotEpochMs,
  slotEpochsForDay,
} from "./time.mjs";

export {
  buildTobSlotSeries,
  tobContractKey,
  tobSlotsDocumentToSeries,
  tobSlotsForDay,
} from "./tob-slots.mjs";

export {
  AGE_BUCKET_LABELS,
  ageBucketOf,
  dip10State,
  parsePrice,
  parseSize,
  pickLastTrade,
  slotVwap,
} from "./observations.mjs";

export {
  buildBridgeArtifact,
  createBridgeMeasurementAccumulator,
  measureBridgeCampaigns,
  summarizeValues,
} from "./measurement.mjs";

export { TRADES_MISSIONS } from "../oos-reservation/trades-windows.mjs";
