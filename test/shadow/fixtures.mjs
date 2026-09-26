// Fixtures SINTÉTICOS de la sesión Shadow (IMP-18). No son datos prospectivos
// reales del cliente: ejercitan la ingeniería de captura sobre el manifest
// congelado del experimento P5. El carácter sintético queda declarado en la
// sesión y en el receipt; no cierra DEP-22 (precedente IMP-08/15, §25.2).
//
// Mecánica (4 fronteras, obligación 12 MW, lote 1, cap diario 12):
//   A1 (versión fija): BUY en D1, WAIT en el spike de D2, BUY en D3 y D4.
//   Baseline A0: BUY calendar en D1..D4 → divergencia ACCIÓN en D2.
//   La trayectoria posterior se alimenta por frontera posterior.

import { buildExperimentFixture } from "../p5-experiment/fixtures.mjs";
import { freezeP5Experiment } from "../../src/p5-experiment/index.mjs";
import { gasQuarterlyTradeAt, frozenTradesResult } from "../trades-engine/fixtures.mjs";

// --- TR-08: forward shadow con TOB vivo + registro paralelo TRADES ----------
// Fixtures SINTÉTICAS: reproducen la forma de las filas del lago sin copiar
// datos de mercado. El slot "12:00" Europe/Berlin de junio equivale a las
// 10:00Z del calendario congelado del fixture Shadow.

export const FORWARD_SLOT_LABEL = "12:00";
export const FORWARD_HISTORY_PRICES = Object.freeze(Array.from({ length: 10 }, () => 50));

export function forwardSeedPastPrices(overrides = {}) {
  const seed = {};
  for (const source of ["TOB", "LAST_TRADE", "SLOT_VWAP"]) {
    seed[source] = [...(overrides[source] ?? FORWARD_HISTORY_PRICES)];
  }
  return seed;
}

// Precios por frontera: LAST_TRADE por encima de la media sembrada en D1 (WAIT)
// y SLOT_VWAP por debajo (BUY), para ejercitar una divergencia de acción real.
const FORWARD_LAST_TRADE_PRICES = {
  "2021-06-22": 60,
  "2021-06-23": 39,
  "2021-06-24": 39.5,
  "2021-06-25": 39.7,
};
const FORWARD_VWAP_TRADE_PRICES = {
  "2021-06-22": 30,
  "2021-06-23": 39,
  "2021-06-24": 39.5,
  "2021-06-25": 39.7,
};

// Filas elegibles GAS_QUARTERLY (G0BQ/202601) de un día: dos trades dentro del
// slot que forman el VWAP y uno más tardío que es el LAST_TRADE.
export function forwardTradesForDate({ date }) {
  const vwapPrice = FORWARD_VWAP_TRADE_PRICES[date];
  const lastTradePrice = FORWARD_LAST_TRADE_PRICES[date];
  return [
    gasQuarterlyTradeAt({ day: date, slot: FORWARD_SLOT_LABEL, price: vwapPrice, size: "10", overrides: { Tm: `${date}T09:35:00.000000Z`, TrdID: `V1-${date}` } }),
    gasQuarterlyTradeAt({ day: date, slot: FORWARD_SLOT_LABEL, price: vwapPrice, size: "10", overrides: { Tm: `${date}T09:40:00.000000Z`, TrdID: `V2-${date}` } }),
    gasQuarterlyTradeAt({ day: date, slot: FORWARD_SLOT_LABEL, price: lastTradePrice, size: "1", overrides: { Tm: `${date}T09:55:00.000000Z`, TrdID: `L-${date}` } }),
  ];
}

export function forwardTradesFixture({ dates = ["2021-06-22", "2021-06-23", "2021-06-24", "2021-06-25"] } = {}) {
  return dates.flatMap((date) => forwardTradesForDate({ date }));
}

// Resultado FROZEN del contrato TRADES-v1 (TR-04) con la aprobación explícita
// del owner ligada al configHash: es el gate que el forward TRADES consume.
export function frozenTradesContractFixture() {
  return frozenTradesResult();
}

// Manifest P5 congelado del experimento, versión fija del brazo A1.
export function frozenShadowFixture() {
  const fx = buildExperimentFixture({});
  const frozen = freezeP5Experiment(fx.freezeInput);
  if (!frozen.ok) {
    throw new Error(`el manifest P5 del fixture no se congela: ${JSON.stringify(frozen.failures ?? frozen)}`);
  }
  return { fx, frozen: frozen.frozen };
}

// Pasos posteriores sintéticos: tras cada decisión llega la observación del
// día siguiente (31 horas después, ya sabemos el path posterior del día).
const POSTERIOR_BEST_ASKS = {
  "2021-06-22": { timestamp: "2021-06-22T17:00:00Z", bestAsk: 39.8 },
  "2021-06-23": { timestamp: "2021-06-23T17:00:00Z", bestAsk: 51.5 },
  "2021-06-24": { timestamp: "2021-06-24T17:00:00Z", bestAsk: 39.7 },
};

export function posteriorObservationsFor(frontierDate) {
  return POSTERIOR_BEST_ASKS[frontierDate] ? [POSTERIOR_BEST_ASKS[frontierDate]] : [];
}

// La ventana sightable en cada frontera: sólo observaciones que YA LLEGARON
// (timestamp <= upToUtc). El caller prospectivo pasa la ventana real; la
// captura la audita known-at y aborta ante fugas (KNOWN_AT_VIOLATION).
export function sightableObservationsFor({ frozen, upToUtc }) {
  const upToMs = Date.parse(upToUtc);
  if (!Number.isFinite(upToMs)) {
    throw new Error("upToUtc no es un instante parseable");
  }
  return (frozen.frozenBundles.a1.priceObservations ?? [])
    .filter((observation) => Date.parse(observation.timestamp) <= upToMs);
}

// Fixture de closes diarios del benchmark (disponible al cierre).
export function benchmarkDailyClosesFixture({ overridden = {} } = {}) {
  return [
    { date: "2021-06-22", close: 40 },
    { date: "2021-06-23", close: 45 },
    { date: "2021-06-24", close: 40 },
    { date: "2021-06-25", close: 40.2 },
    ...Object.entries(overridden).map(([date, close]) => ({ date, close })),
  ];
}
