// Constantes de las mediciones de mercado del puente (TR-03). Fuente:
// TRADES_MODE_PLAN.md TR-03 ("Mediciones de mercado en el puente (sin
// estrategia): por mercado, misión, instrumento y slot (08:00-17:30 Berlin,
// cada 30 min), en 2025-08-12 .. 2026-07-28") y
// docs/canonical/v1_1_1/OWNER_PATCH_TRADES_MODE_2026-09-25.md §3-§4.
//
// Este módulo es puro: no lee el lago, el archivo del cliente ni resultados de
// estrategia. Sólo declara la ventana, la grilla de slots, las reglas de
// observación y los límites candidatos de frescura (que se congelan en TR-04).

import { TRADES_PATCH_IDENTITY } from "../oos-reservation/trades-zones.mjs";

export { TRADES_PATCH_IDENTITY };

export const TRADES_BRIDGE_VERSION = "TRADES_BRIDGE_V1";

export const TRADES_BRIDGE_ACCEPTANCE_TEST = "Mediciones de mercado del puente (2025-08-12..2026-07-28) sin leer ledgers ni resultados de estrategia: antigüedad del último trade elegible, cobertura por slot dentro de límites de frescura candidatos y diferencia observación TRADES vs best ask en el instante de decisión, por mercado, misión, instrumento, slot, distancia a entrega, lado agresor, estado DIP10 y mitad cronológica.";

// Patch 03 §4: el puente es la zona 2025-08-12 .. 2026-07-28 (TOB + TRADES).
export const BRIDGE_WINDOW = Object.freeze({
  startIso: "2025-08-12",
  endIso: "2026-07-28",
  zone: "PUENTE",
  role: "EXPLORATORY",
});

// Grilla del plan TR-03: 08:00-17:30 Europe/Berlin, cada 30 minutos (20 slots).
export const SLOT_STEP_SECONDS = 30 * 60;

function buildSlotLabels() {
  const labels = [];
  for (let minutes = 8 * 60; minutes <= 17 * 60 + 30; minutes += 30) {
    const hour = String(Math.floor(minutes / 60)).padStart(2, "0");
    const minute = String(minutes % 60).padStart(2, "0");
    labels.push(`${hour}:${minute}`);
  }
  return labels;
}

export const SLOT_LABELS = Object.freeze(buildSlotLabels());

// Patch 03 §3.2: dos reglas de observación TRADES. LAST_TRADE es la principal;
// SLOT_VWAP es la hipótesis secundaria.
export const OBSERVATION_RULES = Object.freeze({
  LAST_TRADE: "LAST_TRADE",
  SLOT_VWAP: "SLOT_VWAP",
});

export const OBSERVATION_RULE_LIST = Object.freeze([OBSERVATION_RULES.LAST_TRADE, OBSERVATION_RULES.SLOT_VWAP]);

// DECLARADO / PROVISIONAL (REGLA 2): la SPEC y el patch 03 no fijan el límite de
// frescura; TR-04 lo congela con esta medición. La grilla candidata es una
// elección de ingeniería declarada, no un valor canónico ni elegido mirando
// resultados de estrategia.
export const FRESHNESS_LIMIT_CANDIDATES_SECONDS = Object.freeze([900, 1800, 3600, 7200, 86400]);

// DIP10 (patch 03 §3.2): la observación de hoy contra la media de las últimas 10
// observaciones del episodio, con fallback a A0 si hay menos de 5
// (`src/exploratory/backtest.mjs:83-91`). Aquí sólo se calcula el ESTADO de
// compra; no se corre la estrategia ni se lee ningún ledger.
export const DIP10 = Object.freeze({
  LOOKBACK: 10,
  MIN_HISTORY: 5,
  BELOW_MEAN: "BELOW_MEAN",
  NOT_BELOW_MEAN: "NOT_BELOW_MEAN",
  INSUFFICIENT_HISTORY: "INSUFFICIENT_HISTORY",
});

export const HALVES = Object.freeze({
  CALIBRATION: "CALIBRATION",
  EVALUATION: "EVALUATION",
});

// Regla de slots del TOB (transcrita del release exploratorio v2,
// `operations/exploratory/v2/build_tob_slots.py`, que la UI verifica por hash).
// No se reescribe ni se re-corre v2: TR-03 construye su propia observación TOB
// con la misma regla, implementada una sola vez en JS.
export const TOB_SLOT_RULE = Object.freeze({
  instrumentType: "Simple Instrument",
  maxQuoteAgeSeconds: 900,
  tieRule: "min ask among rows sharing the latest Tm; equal asks keep the smaller known AskSz",
  filters: ["InstrumentType == Simple Instrument", "exact Maturity", "ask > 0", "bid < ask when bid present"],
});
