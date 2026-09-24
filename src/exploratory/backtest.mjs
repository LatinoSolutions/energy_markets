// Backtest exploratorio de procurement sobre best ask real (owner patch
// EM-SPEC-OWNER-PATCH-2026-09-24-02 §2-§4). Resultados EXPLORATORY: no son
// evidencia final ni consumen la reserva OOS de §13.8.
//
// Reglas del cliente (paquete 2026-09-23, ESTADO_INPUTS.csv): 3-1-3 Quarterly,
// 1-0-1 Monthly con cutoff del día previo a la entrega, BUY/WAIT una vez por
// día hábil EEX, lotes de 1 MW, cap 12 MW/día, posición final = target exacto,
// L_t = max(0, remaining - 12*(días_restantes_incl_hoy - 1)); si una estrategia
// necesita forcing en cualquier día, queda rechazada.
//
// Fill conservador (UI-04 TODO §3): solo contra un ask real y fresco del slot
// (el loader ya descarta quotes con más de 15 min, spreads y libro cruzado),
// precio = ask + slippage 0,15 EUR/MWh. Dos modelos: CLIENT (cantidad completa,
// regla del cliente) y DEPTH (máximo el AskSz visible del quote).

import { reconcileControlQuantity } from "../sizing-controller/sizing-controller.mjs";

export const SLIPPAGE_EUR_MWH = 0.15;
export const DAILY_CAP_MW = 12;
export const LOT_MW = 1;
export const CLIENT_SLOT = "11:00";
export const FILL_MODELS = Object.freeze({ CLIENT: "CLIENT", DEPTH: "DEPTH" });

// Owner patch 02 §1.
export const TARGET_MW = Object.freeze({ G0BQ: 60, G0BM: 10 });

function addMonths(yyyymm, delta) {
  const year = Number(yyyymm.slice(0, 4));
  const month = Number(yyyymm.slice(4, 6)) - 1 + delta;
  const y = year + Math.floor(month / 12);
  const m = ((month % 12) + 12) % 12 + 1;
  return `${y}${String(m).padStart(2, "0")}`;
}

// Días hábiles del episodio según la regla de calendario del cliente.
export function episodeTradingDays({ product, maturity, exchangeDays }) {
  const months = product === "G0BQ"
    ? [addMonths(maturity, -4), addMonths(maturity, -3), addMonths(maturity, -2)]
    : [addMonths(maturity, -1)];
  const inWindow = exchangeDays.filter((day) => months.includes(day.slice(0, 4) + day.slice(5, 7)));
  if (product !== "G0BM") {
    return inWindow;
  }
  const deliveryStart = `${maturity.slice(0, 4)}-${maturity.slice(4, 6)}-01`;
  const dayBefore = new Date(Date.parse(`${deliveryStart}T00:00:00Z`) - 86400000).toISOString().slice(0, 10);
  return inWindow.filter((day) => day !== dayBefore);
}

export function minimumRequired(remainingMw, daysLeftIncludingToday) {
  return Math.max(0, remainingMw - DAILY_CAP_MW * (daysLeftIncludingToday - 1));
}

// A0 = práctica del cliente: calendario, price-blind, controlador canónico.
export function a0Quantity({ remainingMw, daysLeftIncludingToday }) {
  const decision = reconcileControlQuantity({
    remainingVolumeMw: remainingMw,
    remainingOpportunitiesCount: daysLeftIncludingToday,
    isLastScheduledOpportunity: daysLeftIncludingToday === 1,
    controller: { lotSizeMw: LOT_MW, dailyCapMw: DAILY_CAP_MW },
  });
  return decision.ok ? decision.requestedQuantityMw : 0;
}

// "Buy the dip" exploratorio: compra al cap cuando el ask de hoy está por debajo
// de la media de los asks observados en los `lookback` días previos del mismo
// contrato y slot (solo pasado, PIT); si no, solo el mínimo factible L_t.
export function dipQuantity({ remainingMw, daysLeftIncludingToday, ask, pastAsks, lookback = 10 }) {
  const floor = minimumRequired(remainingMw, daysLeftIncludingToday);
  const window = pastAsks.slice(-lookback);
  if (window.length < Math.min(lookback, 5)) {
    return Math.max(floor, a0Quantity({ remainingMw, daysLeftIncludingToday }));
  }
  const reference = window.reduce((sum, value) => sum + value, 0) / window.length;
  const wanted = ask < reference ? Math.min(DAILY_CAP_MW, remainingMw) : 0;
  return Math.max(floor, wanted);
}

function quoteAt(series, day, slotIndex) {
  return series[day]?.[slotIndex] ?? null;
}

// Recorre un episodio día a día. `policy` recibe solo información hasta el slot
// de hoy. Devuelve el ledger y el resumen; nunca completa con precios inventados.
export function runEpisode({ series, tradingDays, slotIndex, targetMw, policy, fillModel }) {
  let remainingMw = targetMw;
  let costEur = 0;
  let forcedDays = 0;
  let noQuoteDays = 0;
  let noQuoteWithObligationDays = 0;
  const pastAsks = [];
  const ledger = [];
  for (let index = 0; index < tradingDays.length; index += 1) {
    const day = tradingDays[index];
    const daysLeft = tradingDays.length - index;
    const quote = quoteAt(series, day, slotIndex);
    const floor = minimumRequired(remainingMw, daysLeft);
    if (quote === null) {
      noQuoteDays += 1;
      // Sin quote no hay compra posible: si ese día había mínimo obligatorio, el hueco
      // es de data, no de la estrategia, y se cuenta aparte.
      if (floor > 0) {
        noQuoteWithObligationDays += 1;
      }
      ledger.push({ day, status: "NO_QUOTE", filledMw: 0, remainingMw });
      continue;
    }
    const wanted = Math.min(remainingMw, policy({ remainingMw, daysLeftIncludingToday: daysLeft, ask: quote.ask, pastAsks }));
    if (wanted < floor) {
      forcedDays += 1;
    }
    const depthMw = fillModel === FILL_MODELS.DEPTH ? Math.floor(quote.askSz ?? 0) : Infinity;
    const filledMw = Math.max(0, Math.min(wanted, depthMw));
    const priceEurMwh = quote.ask + SLIPPAGE_EUR_MWH;
    costEur += filledMw * priceEurMwh;
    remainingMw -= filledMw;
    pastAsks.push(quote.ask);
    ledger.push({ day, status: filledMw > 0 ? "FILLED" : "WAIT", ask: quote.ask, askSz: quote.askSz, quoteTm: quote.quoteTm, requestedMw: wanted, filledMw, priceEurMwh, remainingMw });
  }
  const boughtMw = targetMw - remainingMw;
  return {
    targetMw,
    boughtMw,
    remainingMw,
    avgPriceEurMwh: boughtMw > 0 ? costEur / boughtMw : null,
    forcedDays,
    noQuoteDays,
    noQuoteWithObligationDays,
    complete: remainingMw === 0,
    admissible: remainingMw === 0 && forcedDays === 0,
    ledger,
  };
}

export const POLICIES = Object.freeze({
  A0: (context) => a0Quantity(context),
  DIP10: (context) => dipQuantity({ ...context, lookback: 10 }),
});
