// Orquestación de un run TRADES por misión (TR-05). Fuente:
// docs/canonical/v1_1_1/OWNER_PATCH_TRADES_MODE_2026-09-25.md
// (EM-SPEC-OWNER-PATCH-2026-09-25-03) §3 (reglas), §4 (zonas), §5.4 (HOUR
// walk-forward) y TRADES_MODE_PLAN.md TR-05.
//
// Este módulo es PURO: recibe las filas de trades, el calendario del mercado y
// el contrato congelado (TR-04), y devuelve los episodios y la comparación de
// brazos por misión y regla de observación. NO abre el lago, no corre escaneos
// y no elige parámetros mirando resultados. Si el contrato no está FROZEN o
// falta la frescura/penalización de una misión, el run queda bloqueado
// (fail-closed): no se sustituye por cero.

import { CLIENT_SLOT } from "../exploratory/backtest.mjs";
import { OBSERVATION_RULE_LIST, SLOT_LABELS } from "../trades-bridge/constants.mjs";
import { buildDeleteIndex } from "../trades-source/delete-point-in-time.mjs";
import { buildTradesComparison } from "./comparison.mjs";
import { TRADES_EPISODE_STATUS, TRADES_POLICIES, runTradesEpisode } from "./episode.mjs";
import { assignWalkForwardHours } from "./hour.mjs";
import {
  contractRowsForCampaign,
  indexTradesByContract,
  isRunnableZone,
  tradingDaysForCampaign,
} from "./loaders.mjs";
import { missionDefinition, targetMwFor } from "./missions.mjs";

export const TRADES_ARMS = Object.freeze({ BASELINE: "BASELINE", DIP10: "DIP10", HOUR: "HOUR" });

export const TRADES_ARM_LABELS = Object.freeze({
  BASELINE: "Baseline · A0 11:00",
  DIP10: "DIP10 11:00",
  HOUR: "A0 at walk-forward hour",
});

// Config por misión y regla de observación desde el contrato congelado (TR-04).
// Sin frescura medida (UNKNOWN) el límite es null (fail-closed); sin penalización
// medida (UNKNOWN) es null y el fill no se calcula.
export function missionObservationConfig(frozenContract, missionKey, observationRule) {
  const definition = missionDefinition(missionKey);
  if (!definition.ok) return { ok: false, code: "UNKNOWN_MISSION" };
  const market = definition.definition.market;
  const entry = frozenContract?.markets?.[market]?.missions?.[missionKey]?.observations?.[observationRule];
  const freshness = entry?.freshness ?? null;
  const penalty = entry?.penalty ?? null;
  return {
    ok: true,
    code: null,
    freshnessLimitSeconds: freshness && freshness.status !== "UNKNOWN" ? freshness.value ?? null : null,
    freshnessStatus: freshness?.status ?? "MISSING",
    penaltyEurMwh: penalty && penalty.status === "MEASURED" ? penalty.value : null,
    penaltyStatus: penalty?.status ?? "MISSING",
  };
}

// Precondición del run: contrato FROZEN con las 4 misiones y ambas reglas de
// observación medidas. Un freeze en HOLD no habilita ningún run TRADES.
export function resolveFrozenConfig(frozenContract) {
  if (!frozenContract || frozenContract.decision !== "FROZEN") {
    return {
      ok: false,
      code: "TRADES_CONTRACT_NOT_FROZEN",
      reason: "El contrato TRADES-v1 no está FROZEN; el freeze es un gate humano (TR-04) y sin él no se corre ninguna estrategia TRADES.",
    };
  }
  const missing = [];
  for (const missionKey of ["GAS_QUARTERLY", "GAS_MONTHLY", "POWER_QUARTERLY", "POWER_MONTHLY"]) {
    for (const rule of OBSERVATION_RULE_LIST) {
      const config = missionObservationConfig(frozenContract, missionKey, rule);
      if (!config.ok) {
        missing.push({ missionKey, rule, reason: config.code });
        continue;
      }
      if (config.freshnessLimitSeconds === null) missing.push({ missionKey, rule, reason: "FRESHNESS_UNKNOWN" });
      if (config.penaltyEurMwh === null) missing.push({ missionKey, rule, reason: "PENALTY_UNKNOWN" });
    }
  }
  if (missing.length > 0) {
    return {
      ok: false,
      code: "UNMEASURED_CONTRACT_PARAMETERS",
      reason: "Faltan frescura o penalización medidas para alguna misión o regla; el run no se corre con parámetros inventados.",
      missing,
    };
  }
  return { ok: true, code: null };
}

function runArm({ campaign, tradingDays, rows, deleteIndex, slotLabel, targetMw, policyId, observationRule, config }) {
  const policy = TRADES_POLICIES[policyId];
  if (!policy) return { ok: false, code: "UNKNOWN_POLICY", summary: null, ledger: [] };
  return runTradesEpisode({
    campaign,
    tradingDays,
    rows,
    deleteIndex,
    slotLabel,
    targetMw,
    policy,
    observationRule,
    freshnessLimitSeconds: config.freshnessLimitSeconds,
    penaltyEurMwh: config.penaltyEurMwh,
  });
}

// Perfil horario A0 de un episodio (para el walk-forward del brazo HOUR).
function hourProfileForCampaign({ campaign, tradingDays, rows, deleteIndex, targetMw, observationRule, config, slotLabels }) {
  return slotLabels.map((slot) => {
    const result = runArm({ campaign, tradingDays, rows, deleteIndex, slotLabel: slot, targetMw, policyId: "A0", observationRule, config });
    return {
      slot,
      complete: result.ok ? result.summary.complete : false,
      avgPriceEurMwh: result.ok ? result.summary.avgPriceEurMwh : null,
      status: result.ok ? result.summary.status : result.code,
    };
  });
}

// Corre una misión completa: por cada campaign, los tres brazos (A0, DIP10,
// HOUR) bajo cada regla de observación (LAST_TRADE y SLOT_VWAP). La hora del
// brazo HOUR se elige walk-forward sólo con Development anterior.
export function runTradesMission({
  missionKey,
  campaigns = [],
  rows = [],
  exchangeDays = [],
  frozenContract,
  slotLabels = SLOT_LABELS,
} = {}) {
  const definition = missionDefinition(missionKey);
  if (!definition.ok) return { ok: false, code: definition.code };
  const targetMw = targetMwFor(missionKey);
  if (targetMw === null) return { ok: false, code: "MISSING_TARGET_MW" };

  const runnable = campaigns.filter((campaign) => isRunnableZone(campaign.zone));
  const skipped = campaigns.filter((campaign) => !isRunnableZone(campaign.zone)).map((campaign) => campaign.campaignId);
  const index = indexTradesByContract(rows);

  const prepared = runnable.map((campaign) => {
    const contractRows = contractRowsForCampaign({ index, campaign });
    const { tradingDays } = tradingDaysForCampaign({ campaign, exchangeDays });
    const deleteIndex = buildDeleteIndex(contractRows);
    return { campaign, contractRows, tradingDays, deleteIndex };
  });

  const comparisons = {};
  const episodesByRule = {};
  for (const observationRule of OBSERVATION_RULE_LIST) {
    const config = missionObservationConfig(frozenContract, missionKey, observationRule);
    if (!config.ok) return { ok: false, code: config.code };
    if (config.freshnessLimitSeconds === null || config.penaltyEurMwh === null) {
      return { ok: false, code: "UNMEASURED_OBSERVATION_CONFIG", missionKey, observationRule };
    }
    // Walk-forward del brazo HOUR bajo esta regla de observación.
    const hourAssignments = assignWalkForwardHours({
      episodes: prepared.map((item) => ({ ...item.campaign, windowStart: item.campaign.windowStart })),
      hourProfileOf: (episode) => {
        const item = prepared.find((entry) => entry.campaign.campaignId === episode.campaignId);
        return hourProfileForCampaign({
          campaign: item.campaign,
          tradingDays: item.tradingDays,
          rows: item.contractRows,
          deleteIndex: item.deleteIndex,
          targetMw,
          observationRule,
          config,
          slotLabels,
        });
      },
      slotLabels,
    });

    const episodes = prepared.map(({ campaign, contractRows, tradingDays, deleteIndex }) => {
      const hour = hourAssignments[campaign.campaignId];
      const arms = {
        BASELINE: runArm({ campaign, tradingDays, rows: contractRows, deleteIndex, slotLabel: CLIENT_SLOT, targetMw, policyId: "A0", observationRule, config }),
        DIP10: runArm({ campaign, tradingDays, rows: contractRows, deleteIndex, slotLabel: CLIENT_SLOT, targetMw, policyId: "DIP10", observationRule, config }),
      };
      const hourSlot = hour?.chosenSlot ?? null;
      arms.HOUR = hourSlot === null
        ? { ok: true, code: null, summary: { campaignId: campaign.campaignId, targetMw, status: TRADES_EPISODE_STATUS.INCOMPLETE, complete: false, boughtMw: 0, avgPriceEurMwh: null, slotLabel: null }, ledger: [] }
        : runArm({ campaign, tradingDays, rows: contractRows, deleteIndex, slotLabel: hourSlot, targetMw, policyId: "A0", observationRule, config });
      return {
        campaign,
        zone: campaign.zone,
        hour,
        arms: Object.fromEntries(Object.entries(arms).map(([armId, result]) => [armId, result.ok ? { summary: result.summary, ledger: result.ledger } : null])),
        armErrors: Object.fromEntries(Object.entries(arms).filter(([, result]) => !result.ok).map(([armId, result]) => [armId, result.code])),
      };
    });

    episodesByRule[observationRule] = episodes;
    comparisons[observationRule] = buildTradesComparison({
      product: definition.definition.shortCode,
      episodes: episodes.map((episode) => ({ mission: episode.campaign.mission, maturity: episode.campaign.maturity, arms: episode.arms })),
      armLabels: TRADES_ARM_LABELS,
    });
  }

  return {
    ok: true,
    code: null,
    missionKey,
    targetMw,
    skipped,
    episodesByRule,
    comparisons,
  };
}
