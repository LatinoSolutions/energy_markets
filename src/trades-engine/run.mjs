// Orquestación de un run TRADES por misión (TR-05). Fuente:
// docs/canonical/v1_1_1/OWNER_PATCH_TRADES_MODE_2026-09-25.md
// (EM-SPEC-OWNER-PATCH-2026-09-25-03) §2 (la identidad de cada run lleva
// market, mission, source_mode, observation_rule y zone), §3 (reglas), §4
// (zonas) y §5.4 (HOUR walk-forward); TRADES_MODE_PLAN.md TR-05.
//
// Un run = UNA misión, UNA regla de observación y UNA zona (patch 03 §2): así el
// run_id identifica una sola zona y una sola regla. Todo loader filtra por zona
// (TRADES_MODE_PLAN.md non-negotiable), de modo que las filas y los días de otro
// tramo nunca llegan al episodio.
//
// Este módulo es PURO: recibe las filas de trades, el calendario del mercado y
// el resultado FROZEN del contrato TRADES-v1 (TR-04), y devuelve los episodios y
// la comparación de brazos de esa misión y regla. NO abre el lago, no corre
// escaneos y no elige parámetros mirando resultados. Si el contrato no está
// FROZEN (HOLD), falta la aprobación, no liga su configHash o falta la
// frescura/penalización de una misión, el run queda bloqueado (fail-closed): no
// se sustituye por cero.

import { CLIENT_SLOT } from "../exploratory/backtest.mjs";
import { OBSERVATION_RULE_LIST, SLOT_LABELS } from "../trades-bridge/constants.mjs";
import { buildDeleteIndex } from "../trades-source/delete-point-in-time.mjs";
import {
  TRADES_SOURCE_MODE,
  freezeApprovalProblem,
  tradesConfigHash,
  validateTradesContract,
} from "../execution-contract/trades-contract.mjs";
import { buildTradesComparison } from "./comparison.mjs";
import { TRADES_EPISODE_STATUS, TRADES_POLICIES, runTradesEpisode } from "./episode.mjs";
import { assignWalkForwardHours } from "./hour.mjs";
import {
  contractRowsForCampaign,
  filterDaysByZone,
  filterTradesByZone,
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

// El resultado FROZEN de `evaluateTradesFreeze` (TR-04) envuelve el contrato en
// `{decision, status, contract, candidate}`. El motor consume SIEMPRE ese
// contrato envuelto; pasar `result.contract` directo es un error (ver
// resolveFrozenConfig) y no debe aceptarse.
export function frozenContractOf(frozenResult) {
  const contract = frozenResult?.contract;
  if (!contract || typeof contract !== "object" || Array.isArray(contract)) return null;
  return contract;
}

// Config por misión y regla de observación desde el contrato congelado (TR-04).
// Sin frescura medida (UNKNOWN) el límite es null (fail-closed); sin penalización
// medida (UNKNOWN) es null y el fill no se calcula.
export function missionObservationConfig(frozenResult, missionKey, observationRule) {
  const definition = missionDefinition(missionKey);
  if (!definition.ok) return { ok: false, code: "UNKNOWN_MISSION" };
  const contract = frozenContractOf(frozenResult);
  const market = definition.definition.market;
  const entry = contract?.markets?.[market]?.missions?.[missionKey]?.observations?.[observationRule];
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

// Precondición del run: el RESULTADO del freeze (TR-04) debe ser FROZEN, con su
// contrato validado, la aprobación explícita de Bru ligada al configHash, el
// contrato marcado FROZEN y las 4 misiones con ambas reglas de observación
// medidas. Un freeze en HOLD no habilita ningún run TRADES. Pasar
// `result.contract` (sin `decision`) responde TRADES_CONTRACT_NOT_FROZEN.
export function resolveFrozenConfig(frozenResult) {
  if (!frozenResult || frozenResult.decision !== "FROZEN") {
    return {
      ok: false,
      code: "TRADES_CONTRACT_NOT_FROZEN",
      reason: "El resultado del freeze TRADES-v1 no está FROZEN; el freeze es un gate humano (TR-04) y sin él no se corre ninguna estrategia TRADES.",
    };
  }
  const contract = frozenContractOf(frozenResult);
  if (contract === null) {
    return {
      ok: false,
      code: "TRADES_CONTRACT_NOT_FROZEN",
      reason: "El resultado FROZEN no envuelve un contrato TRADES válido; el motor no consume contratos sin freeze.",
    };
  }
  if (contract.status !== "FROZEN") {
    return {
      ok: false,
      code: "TRADES_CONTRACT_NOT_FROZEN",
      reason: "El contrato no está marcado FROZEN; un candidato sin aprobación no habilita el run.",
    };
  }
  const validation = validateTradesContract(contract);
  if (!validation.ok) {
    return {
      ok: false,
      code: "INVALID_FROZEN_CONTRACT",
      reason: "El contrato congelado no satisface su schema; el run queda bloqueado para no correr con un contrato alterado.",
      errors: validation.errors,
    };
  }
  // La aprobación debe cubrir EXACTAMENTE el configHash del contrato (fail-closed):
  // aprobar un config no habilita otro distinto.
  const approvalProblem = freezeApprovalProblem(contract.approval, contract.configHash);
  if (approvalProblem) {
    return {
      ok: false,
      code: "FREEZE_APPROVAL_INVALID",
      reason: approvalProblem.message,
      errors: [approvalProblem],
    };
  }
  const missing = [];
  for (const missionKey of ["GAS_QUARTERLY", "GAS_MONTHLY", "POWER_QUARTERLY", "POWER_MONTHLY"]) {
    for (const rule of OBSERVATION_RULE_LIST) {
      const config = missionObservationConfig(frozenResult, missionKey, rule);
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
  return { ok: true, code: null, configHash: tradesConfigHash(contract) };
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

// Corre UNA misión en UNA zona bajo UNA regla de observación: por cada campaign
// de la zona, los tres brazos (A0, DIP10, HOUR). La hora del brazo HOUR se elige
// walk-forward sólo con episodios de Development anteriores (patch 03 §5.4); sin
// historia, el brazo HOUR no se corre (NOT_RUN_NO_HISTORY).
export function runTradesMission({
  missionKey,
  zone,
  observationRule,
  campaigns = [],
  rows = [],
  exchangeDays = [],
  frozenContract,
  slotLabels = SLOT_LABELS,
} = {}) {
  // Gate de freeze de TR-04 (fail-closed): sin FROZEN no corre ninguna estrategia.
  const frozen = resolveFrozenConfig(frozenContract);
  if (!frozen.ok) return { ok: false, code: frozen.code, reason: frozen.reason ?? null, errors: frozen.errors ?? [] };

  const definition = missionDefinition(missionKey);
  if (!definition.ok) return { ok: false, code: definition.code };
  const targetMw = targetMwFor(missionKey);
  if (targetMw === null) return { ok: false, code: "MISSING_TARGET_MW" };

  if (!isRunnableZone(zone)) return { ok: false, code: "ZONE_NOT_RUNNABLE", zone: zone ?? null };
  if (!OBSERVATION_RULE_LIST.includes(observationRule)) {
    return { ok: false, code: "UNKNOWN_OBSERVATION_RULE", observationRule: observationRule ?? null };
  }

  const config = missionObservationConfig(frozenContract, missionKey, observationRule);
  if (!config.ok) return { ok: false, code: config.code };
  if (config.freshnessLimitSeconds === null || config.penaltyEurMwh === null) {
    return { ok: false, code: "UNMEASURED_OBSERVATION_CONFIG", missionKey, observationRule };
  }

  const runnable = campaigns.filter((campaign) => campaign.zone === zone);
  const skipped = campaigns.filter((campaign) => campaign.zone !== zone).map((campaign) => campaign.campaignId);

  // Todo loader filtra por zona: ni las filas de trades de otra zona entran al
  // índice del contrato (revisión TR05-ZONE-FILTER-05).
  const zoneRows = filterTradesByZone({ rows, zone });
  const index = indexTradesByContract(zoneRows);

  const prepared = runnable.map((campaign) => {
    const contractRows = contractRowsForCampaign({ index, campaign });
    const { tradingDays } = tradingDaysForCampaign({ campaign, exchangeDays });
    // Guard de zona sobre los días: la ventana sale del calendario de la misión,
    // pero ningún día de otro tramo entra al episodio (TRADES_MODE_PLAN.md).
    const zoneDays = filterDaysByZone({ days: tradingDays, zone });
    const deleteIndex = buildDeleteIndex(contractRows);
    return { campaign, contractRows, tradingDays: zoneDays, deleteIndex };
  });

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
    // Sin historia de Development anterior, la hora no se puede elegir
    // walk-forward: el brazo HOUR no se corre y declara su propio estado, no un
    // INCOMPLETE de estrategia (revisión TR05-HOUR-STUB-07).
    arms.HOUR = hourSlot === null
      ? {
        ok: true,
        code: null,
        summary: {
          campaignId: campaign.campaignId,
          targetMw,
          status: TRADES_EPISODE_STATUS.NOT_RUN_NO_HISTORY,
          complete: false,
          boughtMw: 0,
          avgPriceEurMwh: null,
          slotLabel: null,
        },
        ledger: [],
      }
      : runArm({ campaign, tradingDays, rows: contractRows, deleteIndex, slotLabel: hourSlot, targetMw, policyId: "A0", observationRule, config });
    return {
      campaign,
      zone: campaign.zone,
      hour,
      arms: Object.fromEntries(Object.entries(arms).map(([armId, result]) => [armId, result.ok ? { summary: result.summary, ledger: result.ledger } : null])),
      armErrors: Object.fromEntries(Object.entries(arms).filter(([, result]) => !result.ok).map(([armId, result]) => [armId, result.code])),
    };
  });

  const comparison = buildTradesComparison({
    product: definition.definition.shortCode,
    episodes: episodes.map((episode) => ({ mission: episode.campaign.mission, maturity: episode.campaign.maturity, arms: episode.arms })),
    armLabels: TRADES_ARM_LABELS,
  });

  return {
    ok: true,
    code: null,
    missionKey,
    mission: missionKey,
    market: definition.definition.market,
    sourceMode: TRADES_SOURCE_MODE,
    observationRule,
    zone,
    targetMw,
    configHash: frozen.configHash,
    skipped,
    zoneFilter: {
      zone,
      rowsInZone: zoneRows.length,
      rowsOutOfZone: (rows?.length ?? 0) - zoneRows.length,
    },
    episodes,
    comparison,
  };
}