// Superficie pública del motor TRADES (TR-05), ruta versionada nueva. Fuente:
// docs/canonical/v1_1_1/OWNER_PATCH_TRADES_MODE_2026-09-25.md
// (EM-SPEC-OWNER-PATCH-2026-09-25-03) y TRADES_MODE_PLAN.md TR-05.
//
// El motor TRADES no edita `src/exploratory/backtest.mjs` ni `comparison.mjs`:
// los reutiliza (A0/DIP10 y horas de entrega) y vive aparte, con observación
// propia (`price`, `observationTm`, `observationRule`), fill propio
// (trade + penalización + 0,15) y comparación de ΔV entre brazos.

export {
  TRADES_ENGINE_MISSIONS,
  TRADES_ENGINE_VERSION,
  TRADES_TARGET_MW,
  isKnownMission,
  missionDefinition,
  missionKeyForContract,
  missionKeyForShortCode,
  targetMwFor,
} from "./missions.mjs";

export {
  OBSERVATION_FAILURE,
  buildObservation,
  decisionInstants,
  observationAtDecision,
  observationAtInstant,
} from "./observation.mjs";

export {
  RUNNABLE_ZONES,
  buildTobSlotsForMission,
  contractRowsForCampaign,
  filterDaysByZone,
  filterTradesByZone,
  indexTradesByContract,
  isRunnableZone,
  loadTobSeries,
  tobSlotsForCampaign,
  tradingDaysForCampaign,
} from "./loaders.mjs";

export {
  TRADES_DEPTH_AVAILABLE,
  TRADES_FILL_FAILURE,
  TRADES_FILL_MODELS,
  tradesFillPrice,
} from "./fill.mjs";

export {
  TRADES_EPISODE_STATUS,
  TRADES_OBSERVATION_RULE,
  TRADES_POLICIES,
  TRADES_RULES,
  runObservationEpisode,
  runTobEpisode,
  runTradesEpisode,
} from "./episode.mjs";

export {
  ABSOLUTE_V_ACROSS_MODES,
  TRADES_BENCHMARK_RULE,
  buildTradesComparison,
  pairwiseDeltaV,
  tradesBenchmarkProxy,
} from "./comparison.mjs";

export { assignWalkForwardHours, chooseHourFromHistory } from "./hour.mjs";

export { deliveryHoursForMission } from "./hours.mjs";

export {
  TRADES_IDENTITY_SCOPE_FIELDS,
  TRADES_JOB_KIND,
  TRADES_RUN_ID_PREFIX,
  buildTradesRunManifest,
  computeTradesRunIdentity,
  isTradesRunId,
} from "./identity.mjs";

export {
  TRADES_ARM_LABELS,
  TRADES_ARMS,
  frozenContractOf,
  missionObservationConfig,
  resolveFrozenConfig,
  runTradesMission,
} from "./run.mjs";
