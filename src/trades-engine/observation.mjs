// Observación TRADES del motor (TR-05): campo propio `price`, `observationTm`
// y `observationRule`, point-in-time y con límite de frescura. Fuente:
// docs/canonical/v1_1_1/OWNER_PATCH_TRADES_MODE_2026-09-25.md
// (EM-SPEC-OWNER-PATCH-2026-09-25-03) §3.1 (trade elegible PIT), §3.2
// (LAST_TRADE principal, SLOT_VWAP secundaria) y §3.4 ("día de decisión sin
// trade elegible dentro del límite de frescura = sin observación; no se arrastra
// un precio indefinidamente"); TRADES_MODE_PLAN.md TR-05.
//
// El motor NO lee `entry.ask` para TRADES: la observación es un trade (o un
// VWAP de trades) y se expone como `price`, para que el benchmark proxy del
// motor TRADES lo consuma explícitamente y no devuelva null en silencio.
//
// No-look-ahead: la elegibilidad PIT sólo admite `Tm <= instante de decisión`
// (`eligibleTradesAt`), así que un trade posterior a la decisión nunca entra.
// Un trade con Delete posterior deja de ser elegible sólo desde el Delete
// (`delete-point-in-time.mjs`). Un límite de frescura desconocido (null) NO se
// sustituye por infinito: fail-closed, sin observación.

import { OBSERVATION_RULES, SLOT_STEP_SECONDS } from "../trades-bridge/constants.mjs";
import { pickLastTrade, slotVwap } from "../trades-bridge/observations.mjs";
import { slotEpochMs } from "../trades-bridge/time.mjs";
import { buildDeleteIndex, eligibleTradesAt } from "../trades-source/delete-point-in-time.mjs";

export const OBSERVATION_FAILURE = Object.freeze({
  NO_OBSERVATION: "NO_OBSERVATION",
  STALE_OBSERVATION: "STALE_OBSERVATION",
  FRESHNESS_LIMIT_UNKNOWN: "FRESHNESS_LIMIT_UNKNOWN",
  UNKNOWN_RULE: "UNKNOWN_RULE",
});

// Instante de decisión de un slot de Berlin y arranque de su ventana de VWAP.
export function decisionInstants({ dayIso, slotLabel }) {
  const decisionEpochMs = slotEpochMs(dayIso, slotLabel);
  const slotStartEpochMs = decisionEpochMs - SLOT_STEP_SECONDS * 1000;
  return { decisionEpochMs, slotStartEpochMs };
}

// Construye la observación a partir de trades YA filtrados por PIT. Devuelve
// null cuando la regla no tiene observación (sin trade / sin volumen).
export function buildObservation({ eligibleTrades, rule, decisionEpochMs, slotStartEpochMs }) {
  if (rule === OBSERVATION_RULES.SLOT_VWAP) {
    const vwap = slotVwap(eligibleTrades, { slotStartEpochMs, decisionEpochMs });
    if (vwap === null) return null;
    return {
      price: vwap.vwap,
      observationEpochMs: vwap.lastEpochMs,
      observationTm: new Date(vwap.lastEpochMs).toISOString(),
      observationRule: rule,
      aggressor: vwap.aggressor,
      volume: vwap.volume,
      tradeCount: vwap.count,
    };
  }
  if (rule !== OBSERVATION_RULES.LAST_TRADE) {
    return null;
  }
  const last = pickLastTrade(eligibleTrades);
  if (last === null) return null;
  return {
    price: last.price,
    observationEpochMs: last.epochMs,
    observationTm: new Date(last.epochMs).toISOString(),
    observationRule: OBSERVATION_RULES.LAST_TRADE,
    aggressor: last.aggressor,
    volume: null,
    tradeCount: 1,
  };
}

// Observación en el instante de decisión, con PIT y frescura. `rows` puede
// incluir filas Delete (se usan como índice, no como observación). `deleteIndex`
// se puede inyectar para no reconstruirlo por día.
export function observationAtDecision({
  rows,
  rule,
  dayIso,
  slotLabel,
  freshnessLimitSeconds,
  deleteIndex = null,
} = {}) {
  if (rule !== OBSERVATION_RULES.LAST_TRADE && rule !== OBSERVATION_RULES.SLOT_VWAP) {
    return { ok: false, code: OBSERVATION_FAILURE.UNKNOWN_RULE, observation: null, ageSeconds: null };
  }
  const { decisionEpochMs, slotStartEpochMs } = decisionInstants({ dayIso, slotLabel });
  const index = deleteIndex ?? buildDeleteIndex(rows ?? []);
  const eligibleTrades = eligibleTradesAt(rows ?? [], decisionEpochMs, { deleteIndex: index });
  const observation = buildObservation({ eligibleTrades, rule, decisionEpochMs, slotStartEpochMs });
  if (observation === null) {
    return { ok: false, code: OBSERVATION_FAILURE.NO_OBSERVATION, observation: null, ageSeconds: null, decisionEpochMs };
  }
  const ageSeconds = (decisionEpochMs - observation.observationEpochMs) / 1000;
  if (freshnessLimitSeconds === null || freshnessLimitSeconds === undefined) {
    return { ok: false, code: OBSERVATION_FAILURE.FRESHNESS_LIMIT_UNKNOWN, observation: null, ageSeconds, decisionEpochMs };
  }
  if (ageSeconds > freshnessLimitSeconds) {
    return { ok: false, code: OBSERVATION_FAILURE.STALE_OBSERVATION, observation: null, ageSeconds, decisionEpochMs };
  }
  return {
    ok: true,
    code: null,
    decisionEpochMs,
    observation: { ...observation, ageSeconds },
  };
}
