// Fill del motor TRADES (TR-05). Fuente:
// docs/canonical/v1_1_1/OWNER_PATCH_TRADES_MODE_2026-09-25.md
// (EM-SPEC-OWNER-PATCH-2026-09-25-03) §3.3 ("trade observado + penalización
// trade->ask + 0,15 EUR/MWh de slippage, sin omitir ni contar dos veces el
// 0,15") y §2 ("el fill model DEPTH no existe en TRADES").
//
// Reutiliza `deriveTradesFillPrice` del contrato TRADES-v1 (TR-04) para que el
// fill y el contrato congelado no puedan divergir. La penalización es un
// parámetro de misión; si no está medida, el fill queda fail-closed (nunca se
// sustituye por cero). El modo DEPTH se rechaza explícitamente: el volumen
// negociado no es profundidad (patch 03 §2).

import { deriveTradesFillPrice } from "../execution-contract/trades-contract.mjs";
import { SLIPPAGE_EUR_MWH } from "../exploratory/backtest.mjs";

export const TRADES_FILL_MODELS = Object.freeze({ CLIENT: "CLIENT" });

// El plan TR-05 exige que `DEPTH` no exista en TRADES.
export const TRADES_DEPTH_AVAILABLE = false;

export const TRADES_FILL_FAILURE = Object.freeze({
  DEPTH_NOT_AVAILABLE_IN_TRADES: "DEPTH_NOT_AVAILABLE_IN_TRADES",
  NO_OBSERVATION_PRICE: "NO_OBSERVATION_PRICE",
  PENALTY_UNKNOWN: "PENALTY_UNKNOWN",
});

export function tradesFillPrice({
  observation,
  penaltyEurMwh,
  slippageEurMwh = SLIPPAGE_EUR_MWH,
  fillModel = TRADES_FILL_MODELS.CLIENT,
} = {}) {
  if (fillModel === "DEPTH" || fillModel !== TRADES_FILL_MODELS.CLIENT) {
    return { ok: false, code: TRADES_FILL_FAILURE.DEPTH_NOT_AVAILABLE_IN_TRADES, price: null };
  }
  if (!observation || typeof observation.price !== "number" || !Number.isFinite(observation.price)) {
    return { ok: false, code: TRADES_FILL_FAILURE.NO_OBSERVATION_PRICE, price: null };
  }
  if (penaltyEurMwh === null || penaltyEurMwh === undefined || !Number.isFinite(penaltyEurMwh)) {
    return { ok: false, code: TRADES_FILL_FAILURE.PENALTY_UNKNOWN, price: null };
  }
  return deriveTradesFillPrice({ tradePrice: observation.price, penaltyEurMwh, slippageEurMwh });
}
