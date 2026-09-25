// Observaciones TRADES del puente (patch 03 §3.2): LAST_TRADE (principal) y
// SLOT_VWAP (hipótesis secundaria), su antigüedad y el estado DIP10. Fuente:
// docs/canonical/v1_1_1/OWNER_PATCH_TRADES_MODE_2026-09-25.md §3.2-§3.3 y
// TRADES_MODE_PLAN.md TR-03.
//
// Funciones puras: reciben filas ya filtradas por la regla de elegibilidad de
// mercado y por el point-in-time de Delete (src/trades-source). No leen el lago
// ni resultados de estrategia, y no calculan fills.

import { classifyAggressor, AGGREGATOR } from "../trades-source/eligibility.mjs";
import { tradeEpochMs } from "../trades-source/delete-point-in-time.mjs";
import { DIP10, FRESHNESS_LIMIT_CANDIDATES_SECONDS } from "./constants.mjs";

export function parsePrice(row) {
  const value = Number(row?.Px);
  return Number.isFinite(value) ? value : null;
}

export function parseSize(row) {
  const value = Number(row?.Sz);
  return Number.isFinite(value) ? value : null;
}

// Último trade elegible de una lista ya ordenable por Tm. `trades` debe venir ya
// filtrada (elegibilidad de mercado + PIT en el instante de decisión).
export function pickLastTrade(trades) {
  let best = null;
  for (const row of trades) {
    const epoch = tradeEpochMs(row?.Tm);
    const price = parsePrice(row);
    if (epoch === null || price === null) continue;
    if (best === null || epoch > best.epochMs) {
      best = { row, epochMs: epoch, price, aggressor: classifyAggressor(row) };
    }
  }
  return best;
}

// VWAP de los trades elegibles del slot que termina en el instante de decisión
// (Tm en (slotStart, decision]). Sin volumen válido no hay VWAP (no se inventa
// una media simple disfrazada de VWAP). El lado agresor es el único de la
// ventana, o UNKNOWN si está mezclado o falta.
export function slotVwap(trades, { slotStartEpochMs, decisionEpochMs }) {
  let volume = 0;
  let notional = 0;
  let lastEpoch = null;
  const aggressors = new Set();
  let count = 0;
  for (const row of trades) {
    const epoch = tradeEpochMs(row?.Tm);
    const price = parsePrice(row);
    if (epoch === null || price === null) continue;
    if (epoch <= slotStartEpochMs || epoch > decisionEpochMs) continue;
    const size = parseSize(row);
    count += 1;
    if (lastEpoch === null || epoch > lastEpoch) lastEpoch = epoch;
    aggressors.add(classifyAggressor(row));
    if (size !== null && size > 0) {
      volume += size;
      notional += price * size;
    }
  }
  if (count === 0 || volume <= 0) return null;
  const known = [...aggressors].filter((value) => value !== AGGREGATOR.UNKNOWN);
  return {
    vwap: notional / volume,
    volume,
    count,
    lastEpochMs: lastEpoch,
    aggressor: known.length === 1 && aggressors.size === 1 ? known[0] : AGGREGATOR.UNKNOWN,
  };
}

// Estado de compra de DIP10 (patch 03 §3.2): la observación de hoy contra la
// media de las últimas 10 observaciones del episodio, con fallback a A0 si hay
// menos de 5. Aquí sólo se calcula el estado; la estrategia no corre.
export function dip10State({ previousValues, value, lookback = DIP10.LOOKBACK, minHistory = DIP10.MIN_HISTORY }) {
  const window = previousValues.slice(-lookback);
  if (window.length < Math.min(lookback, minHistory)) return DIP10.INSUFFICIENT_HISTORY;
  const reference = window.reduce((sum, entry) => sum + entry, 0) / window.length;
  return value < reference ? DIP10.BELOW_MEAN : DIP10.NOT_BELOW_MEAN;
}

export const AGE_BUCKET_LABELS = Object.freeze(["LE_15M", "LE_30M", "LE_1H", "LE_2H", "LE_24H", "GT_24H"]);

// Etiqueta de antigüedad contra la grilla candidata. `GT_24H` agrupa todo lo más
// viejo que el último candidato (incluido "sin trade previo").
export function ageBucketOf(ageSeconds, limits = FRESHNESS_LIMIT_CANDIDATES_SECONDS) {
  for (let index = 0; index < limits.length; index += 1) {
    if (ageSeconds <= limits[index]) return AGE_BUCKET_LABELS[index];
  }
  return AGE_BUCKET_LABELS[AGE_BUCKET_LABELS.length - 1];
}
