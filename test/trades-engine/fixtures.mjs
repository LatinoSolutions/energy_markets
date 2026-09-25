// Fixtures sintéticas para el motor TRADES (TR-05). Reproducen la forma de las
// filas del lago y de los slots sin copiar datos de mercado: los valores son
// inventados y sólo prueban la regla.

import { tradeRow, deleteRow as baseDeleteRow } from "../trades-source/fixtures.mjs";
import { SLOT_LABELS } from "../../src/trades-bridge/constants.mjs";
import { slotEpochMs } from "../../src/trades-bridge/time.mjs";

export { tradeRow, baseDeleteRow as deleteRow };

// Trade del contrato Gas Q 2026Q1 en el instante de un slot Berlin de un día.
export function gasQuarterlyTradeAt({ day, slot, price, size = "1", overrides = {} } = {}) {
  const epoch = slotEpochMs(day, slot);
  return tradeRow({
    Cmdty: "NATGAS",
    Area: "THE",
    ShortCode: "G0BQ",
    Maturity: "202601",
    TrdDate: day,
    Tm: new Date(epoch).toISOString(),
    Px: String(price),
    Sz: String(size),
    ...overrides,
  });
}

export function powerMonthlyTradeAt({ day, slot, price, size = "1", overrides = {} } = {}) {
  const epoch = slotEpochMs(day, slot);
  return tradeRow({
    Cmdty: "POWER",
    Area: "DE",
    ShortCode: "DEBM",
    Maturity: "202601",
    TrdDate: day,
    Tm: new Date(epoch).toISOString(),
    Px: String(price),
    Sz: String(size),
    ...overrides,
  });
}

export function gasQuarterlyCampaign(overrides = {}) {
  return {
    campaignId: "GAS-Q-2026Q1",
    product: "Gas",
    mission: "Quarterly",
    market: "GAS_THE",
    shortCode: "G0BQ",
    maturity: "2026Q1",
    zone: "DEVELOPMENT",
    windowStart: "2025-09-01",
    windowEnd: "2025-11-30",
    deadline: "2025-09-03",
    ...overrides,
  };
}

// Serie TOB por contrato -> día -> slots, con un único ask en el slot pedido.
export function tobDocument({ contract = "G0BQ|202601", day = "2025-09-01", slot = "11:00", ask = 100 } = {}) {
  const slots = SLOT_LABELS.map((label) => (label === slot ? { ask, askSz: 1, bid: ask - 1, quoteTm: null } : null));
  return { slotsBerlin: [...SLOT_LABELS], series: { [contract]: { [day]: slots } } };
}

// Contrato congelado mínimo para una misión, con frescura y penalización
// medidas en ambas reglas de observación. `status` permite probar el HOLD.
export function frozenContract({ missionKey = "GAS_QUARTERLY", market = "GAS_THE", freshness = 900, penalty = 0.5, status = "FROZEN" } = {}) {
  const observations = {
    LAST_TRADE: {
      freshness: { status: "MEASURED", value: freshness },
      penalty: { status: "MEASURED", value: penalty },
    },
    SLOT_VWAP: {
      freshness: { status: "MEASURED", value: freshness },
      penalty: { status: "MEASURED", value: penalty },
    },
  };
  return {
    decision: status,
    contractId: "EXEC-TRADES-v1",
    versionLabel: "TRADES-v1",
    markets: {
      [market]: {
        market,
        missions: {
          [missionKey]: { product: "Gas", mission: "Quarterly", shortCode: "G0BQ", observations },
        },
      },
    },
  };
}
