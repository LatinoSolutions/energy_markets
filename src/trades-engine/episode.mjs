// Episodios del motor TRADES (TR-05): recorre la ventana de calendario de una
// campaign día a día y produce el ledger con observación propia (`price`,
// `observationTm`, `observationRule`). Fuente:
// docs/canonical/v1_1_1/OWNER_PATCH_TRADES_MODE_2026-09-25.md
// (EM-SPEC-OWNER-PATCH-2026-09-25-03) §3.2 (observación), §3.3 (fill), §3.4
// (ventana por calendario, data ausente = DATA_INCOMPLETE, distinta del
// hard-reject por forcing), §2 (el control TOB se generaliza para que el
// contraste del puente exista en las 4 misiones) y TRADES_MODE_PLAN.md TR-05.
//
// Reutiliza la lógica EXACTA de A0 y DIP10 del backtest exploratorio
// (`src/exploratory/backtest.mjs`), que NO se edita: DIP10 conserva su
// comparación contra la media de las últimas 10 observaciones con fallback a A0
// con menos de 5 (patch 03 §3.2). El núcleo `runObservationEpisode` es común a
// los dos modos; lo único que cambia es de dónde sale la observación y cómo se
// calcula el fill.

import {
  CLIENT_SLOT,
  DAILY_CAP_MW,
  LOT_MW,
  SLIPPAGE_EUR_MWH,
  a0Quantity,
  dipQuantity,
  minimumRequired,
} from "../exploratory/backtest.mjs";
import { OBSERVATION_RULES } from "../trades-bridge/constants.mjs";
import { TRADES_FILL_MODELS, tradesFillPrice } from "./fill.mjs";
import { observationAtDecision } from "./observation.mjs";

export const TRADES_EPISODE_STATUS = Object.freeze({
  COMPLETE: "COMPLETE",
  DATA_INCOMPLETE: "DATA_INCOMPLETE",
  INCOMPLETE: "INCOMPLETE",
  // Brazo HOUR sin historia de Development anterior: la hora no se puede elegir
  // walk-forward (patch 03 §5.4), así que NO se corre. Es un estado propio del
  // brazo, no un fallo de la estrategia (revisión TR05-HOUR-STUB-07).
  NOT_RUN_NO_HISTORY: "NOT_RUN_NO_HISTORY",
});

export const TRADES_OBSERVATION_RULE = Object.freeze({ TOB: "TOB" });

// Brazos del motor. A0 y DIP10 son los mismos del backtest exploratorio; el
// brazo HOUR se resuelve fuera del episodio (hora elegida walk-forward) y corre
// con A0 a esa hora. La política recibe `price` (trade o ask según el modo) y
// las observaciones pasadas.
export const TRADES_POLICIES = Object.freeze({
  A0: ({ remainingMw, daysLeftIncludingToday }) => a0Quantity({ remainingMw, daysLeftIncludingToday }),
  DIP10: ({ remainingMw, daysLeftIncludingToday, price, pastPrices }) =>
    dipQuantity({ remainingMw, daysLeftIncludingToday, ask: price, pastAsks: pastPrices, lookback: 10 }),
});

export const TRADES_RULES = Object.freeze({
  DAILY_CAP_MW,
  LOT_MW,
  SLIPPAGE_EUR_MWH,
  CLIENT_SLOT,
});

// Núcleo del episodio, común a TRADES y al control TOB generalizado.
//   - `observationAt(day)` -> { ok, code, observation } en el instante de decisión;
//   - `fillPriceOf(observation)` -> { ok, code, price }.
// Un día sin observación no se arrastra y no consume el mínimo obligatorio: si
// al final queda obligación y hubo huecos de data, el estado es DATA_INCOMPLETE.
export function runObservationEpisode({
  campaign,
  tradingDays = [],
  slotLabel = CLIENT_SLOT,
  targetMw,
  policy,
  observationAt,
  fillPriceOf,
  noObservationStatus = "NO_OBSERVATION",
} = {}) {
  if (typeof policy !== "function") {
    return { ok: false, code: "MISSING_POLICY", summary: null, ledger: [] };
  }
  if (typeof observationAt !== "function" || typeof fillPriceOf !== "function") {
    return { ok: false, code: "MISSING_OBSERVATION_SOURCE", summary: null, ledger: [] };
  }
  if (!Number.isFinite(targetMw) || targetMw <= 0) {
    return { ok: false, code: "MISSING_TARGET_MW", summary: null, ledger: [] };
  }

  let remainingMw = targetMw;
  let costEur = 0;
  let forcedDays = 0;
  let dataForcedDays = 0;
  let noObservationDays = 0;
  let staleDays = 0;
  const pastPrices = [];
  const ledger = [];

  for (let index = 0; index < tradingDays.length; index += 1) {
    const day = tradingDays[index];
    const daysLeft = tradingDays.length - index;
    const floor = minimumRequired(remainingMw, daysLeft);
    const result = observationAt(day, daysLeft);
    if (!result?.ok) {
      if (result?.code === "NO_OBSERVATION") noObservationDays += 1;
      else staleDays += 1;
      ledger.push({
        day,
        status: noObservationStatus,
        reason: result?.code ?? "NO_OBSERVATION",
        price: null,
        observationTm: null,
        observationRule: null,
        observationAgeSeconds: result?.ageSeconds ?? null,
        aggressor: null,
        requestedMw: 0,
        filledMw: 0,
        priceEurMwh: null,
        remainingMw,
      });
      continue;
    }
    const observation = result.observation;
    // Regla del cliente (`01_shared_campaign_rules.md` §5): la cantidad de un día
    // es un entero entre 0 y min(12 MW, remaining). El cap es DURO: nunca se
    // supera, ni siquiera para recuperar un hueco de data (revisión
    // TR05-DAILY-CAP-03; cap 12 MW/día, `01_shared_campaign_rules.md:94`).
    const proposed = policy({
      remainingMw,
      daysLeftIncludingToday: daysLeft,
      price: observation.price,
      pastPrices,
    });
    const wanted = Math.max(0, Math.min(remainingMw, DAILY_CAP_MW, proposed));
    // Forcing del cliente (`01_shared_campaign_rules.md` §6): si la estrategia
    // propone menos que el mínimo factible L_t, el sistema supervisor tendría que
    // intervenir y la estrategia queda rechazada. Si el propio L_t ya supera el
    // cap, NINGUNA decisión puede cumplirlo: la causa es el hueco de data, no la
    // estrategia, y no cuenta como hard-reject (patch 03 §3.4; revisión
    // TR05-DAILY-CAP-03).
    if (wanted < floor && floor <= DAILY_CAP_MW) forcedDays += 1;
    else if (wanted < floor) dataForcedDays += 1;
    const fill = fillPriceOf(observation);
    if (!fill?.ok) {
      return { ok: false, code: fill?.code ?? "FILL_FAILED", summary: null, ledger };
    }
    const filledMw = Math.max(0, wanted);
    costEur += filledMw * fill.price;
    remainingMw -= filledMw;
    pastPrices.push(observation.price);
    ledger.push({
      day,
      status: filledMw > 0 ? "FILLED" : "WAIT",
      reason: null,
      price: observation.price,
      observationTm: observation.observationTm,
      observationRule: observation.observationRule,
      observationAgeSeconds: observation.ageSeconds ?? null,
      aggressor: observation.aggressor ?? null,
      requestedMw: wanted,
      filledMw,
      priceEurMwh: fill.price,
      remainingMw,
    });
  }

  const boughtMw = targetMw - remainingMw;
  const complete = remainingMw === 0;
  const dataGap = noObservationDays + staleDays > 0;
  // Patch 03 §3.4: una obligación que no puede completarse por falta de
  // observación queda DATA_INCOMPLETE; si todas las decisiones tuvieron
  // observación y aun así no se completó, es INCOMPLETE de la estrategia.
  const status = complete
    ? TRADES_EPISODE_STATUS.COMPLETE
    : (dataGap ? TRADES_EPISODE_STATUS.DATA_INCOMPLETE : TRADES_EPISODE_STATUS.INCOMPLETE);

  return {
    ok: true,
    code: null,
    summary: {
      campaignId: campaign?.campaignId ?? null,
      targetMw,
      boughtMw,
      remainingMw,
      avgPriceEurMwh: boughtMw > 0 ? costEur / boughtMw : null,
      complete,
      status,
      forcedDays,
      dataForcedDays,
      noObservationDays,
      staleDays,
      hardRejected: forcedDays > 0,
      admissible: complete && forcedDays === 0,
      slotLabel,
    },
    ledger,
  };
}

// Episodio TRADES: observación de trade (LAST_TRADE / SLOT_VWAP) y fill
// trade + penalización + 0,15.
export function runTradesEpisode({
  rows,
  observationRule = OBSERVATION_RULES.LAST_TRADE,
  freshnessLimitSeconds = null,
  penaltyEurMwh = null,
  slippageEurMwh = SLIPPAGE_EUR_MWH,
  fillModel = TRADES_FILL_MODELS.CLIENT,
  deleteIndex = null,
  ...rest
} = {}) {
  const result = runObservationEpisode({
    ...rest,
    observationAt: (day) => observationAtDecision({
      rows,
      rule: observationRule,
      dayIso: day,
      slotLabel: rest.slotLabel ?? CLIENT_SLOT,
      freshnessLimitSeconds,
      deleteIndex,
    }),
    fillPriceOf: (observation) => tradesFillPrice({ observation, penaltyEurMwh, slippageEurMwh, fillModel }),
  });
  if (result.summary) result.summary.observationRule = observationRule;
  return result;
}

// Control TOB generalizado por misión (TR-05): observación = best ask del slot,
// fill = ask + 0,15 (contrato TOB, sin penalización TRADES). El release v2 no se
// reescribe: esta ruta es la que permite el contraste del puente en Power, cuyo
// TOB no está en v2.
export function runTobEpisode({
  series,
  slotIndex,
  slippageEurMwh = SLIPPAGE_EUR_MWH,
  ...rest
} = {}) {
  const result = runObservationEpisode({
    ...rest,
    observationAt: (day) => {
      const slots = series?.get?.(day) ?? series?.[day] ?? null;
      const entry = Array.isArray(slots) ? slots[slotIndex] : null;
      if (!entry) return { ok: false, code: "NO_OBSERVATION", observation: null };
      return {
        ok: true,
        code: null,
        observation: {
          price: entry.ask,
          observationTm: entry.quoteTm ?? null,
          observationRule: TRADES_OBSERVATION_RULE.TOB,
          ageSeconds: null,
          aggressor: null,
          askSz: entry.askSz ?? null,
        },
      };
    },
    fillPriceOf: (observation) => (Number.isFinite(observation.price)
      ? { ok: true, code: null, price: observation.price + slippageEurMwh }
      : { ok: false, code: "NO_OBSERVATION_PRICE", price: null }),
    noObservationStatus: "NO_QUOTE",
  });
  if (result.summary) result.summary.observationRule = TRADES_OBSERVATION_RULE.TOB;
  return result;
}
