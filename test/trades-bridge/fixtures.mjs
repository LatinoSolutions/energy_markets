// Fixtures sintéticas para las mediciones del puente (TR-03). Reproducen la
// forma de las filas reales del lago sin copiar datos de mercado: los valores
// son inventados y sólo prueban la regla.

import { tradeRow as baseTradeRow } from "../trades-source/fixtures.mjs";
import { SLOT_LABELS } from "../../src/trades-bridge/constants.mjs";

export function gasQuarterlyTrade(overrides = {}) {
  return baseTradeRow({
    Cmdty: "NATGAS",
    Area: "THE",
    ShortCode: "G0BQ",
    Maturity: "202601",
    InstrumentISIN: "ISIN-G0BQ-202601",
    ...overrides,
  });
}

export function powerQuarterlyTrade(overrides = {}) {
  return baseTradeRow({
    Cmdty: "POWER",
    Area: "DE",
    ShortCode: "DEBQ",
    Maturity: "202601",
    InstrumentISIN: "ISIN-DEBQ-202601",
    ...overrides,
  });
}

export function tobRow(overrides = {}) {
  return {
    Cmdty: "NATGAS",
    Area: "THE",
    ShortCode: "G0BQ",
    Maturity: "202601",
    TrdDate: "2025-09-01",
    Tm: "2025-09-01T08:59:00Z",
    AskPx: "100",
    AskSz: "1",
    BidPx: "99",
    InstrumentType: "Simple Instrument",
    ...overrides,
  };
}

// Serie de asks por contrato/día con los 20 slots. `value` puede ser un número
// (todos los slots) o una función slotIndex -> ask|null.
export function askDay(value) {
  return SLOT_LABELS.map((_, index) => {
    const ask = typeof value === "function" ? value(index) : value;
    if (ask === null || ask === undefined) return null;
    return { ask, askSz: 1, bid: ask - 1, quoteTm: null };
  });
}

export function askSeries(entries) {
  const series = new Map();
  for (const [contract, days] of Object.entries(entries)) {
    series.set(contract, new Map(Object.entries(days)));
  }
  return series;
}

export function gasQuarterlyCampaign(overrides = {}) {
  return {
    campaignId: "GAS-Q-2026Q1",
    market: "GAS_THE",
    mission: "GAS_QUARTERLY",
    product: "Gas",
    shortCode: "G0BQ",
    maturity: "2026Q1",
    legacyMaturity: "202601",
    windowStart: "2025-09-01",
    windowEnd: "2025-11-30",
    deadline: "2025-11-28",
    windowDays: ["2025-09-01", "2025-09-02"],
    ...overrides,
  };
}
