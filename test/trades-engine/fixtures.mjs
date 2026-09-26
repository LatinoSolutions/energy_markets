// Fixtures sintéticas para el motor TRADES (TR-05). Reproducen la forma de las
// filas del lago y de los slots sin copiar datos de mercado: los valores son
// inventados y sólo prueban la regla.

import { tradeRow, deleteRow as baseDeleteRow } from "../trades-source/fixtures.mjs";
import { SLOT_LABELS, HALVES } from "../../src/trades-bridge/constants.mjs";
import { slotEpochMs } from "../../src/trades-bridge/time.mjs";
import { TRADES_ENGINE_MISSIONS } from "../../src/trades-engine/missions.mjs";
import {
  TRADES_FREEZE_SCOPE,
  buildTradesFreezeCandidate,
  evaluateTradesFreeze,
} from "../../src/execution-contract/trades-contract.mjs";

export { tradeRow, baseDeleteRow as deleteRow };

// Fila de trade de una misión en el instante de un slot Berlin de un día.
export function missionTradeAt({ cmdty, area, shortCode, maturity, day, slot, price, size = "1", overrides = {} } = {}) {
  const epoch = slotEpochMs(day, slot);
  return tradeRow({
    Cmdty: cmdty,
    Area: area,
    ShortCode: shortCode,
    Maturity: maturity,
    TrdDate: day,
    Tm: new Date(epoch).toISOString(),
    Px: String(price),
    Sz: String(size),
    ...overrides,
  });
}

export function gasQuarterlyTradeAt({ day, slot, price, size = "1", overrides = {} } = {}) {
  return missionTradeAt({ cmdty: "NATGAS", area: "THE", shortCode: "G0BQ", maturity: "202601", day, slot, price, size, overrides });
}

export function gasMonthlyTradeAt({ day, slot, price, size = "1", overrides = {} } = {}) {
  return missionTradeAt({ cmdty: "NATGAS", area: "THE", shortCode: "G0BM", maturity: "202601", day, slot, price, size, overrides });
}

export function powerQuarterlyTradeAt({ day, slot, price, size = "1", overrides = {} } = {}) {
  return missionTradeAt({ cmdty: "POWER", area: "DE", shortCode: "DEBQ", maturity: "202601", day, slot, price, size, overrides });
}

export function powerMonthlyTradeAt({ day, slot, price, size = "1", overrides = {} } = {}) {
  return missionTradeAt({ cmdty: "POWER", area: "DE", shortCode: "DEBM", maturity: "202601", day, slot, price, size, overrides });
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

// Medición sintética del puente (TR-03) con cobertura y penalización medidas
// para las 4 misiones y las 2 reglas. Es la forma real que consume
// `deriveFreshnessForMission`/`derivePenaltyForMission`; no inventa un formato
// distinto del que produce TR-03 (revisión TR05-FREEZE-SHAPE-02).
function coverageForRule() {
  return {
    byHalf: {
      [HALVES.CALIBRATION]: { slotsTotal: 100, coverageByLimit: { "900": { coverage: 0.99 } } },
      [HALVES.EVALUATION]: { slotsTotal: 100, coverageByLimit: { "900": { coverage: 0.99 } } },
    },
  };
}

function gapsForRule() {
  return {
    byHalfByDip10StateByAggressorByLimit: [
      { combination: `900|${HALVES.CALIBRATION}|BELOW_MEAN|BUY`, mean: -0.5, count: 40 },
      { combination: `900|${HALVES.CALIBRATION}|BELOW_MEAN|SELL`, mean: -0.5, count: 20 },
    ],
  };
}

export function tradesBridgeMeasurement() {
  const markets = {};
  for (const definition of Object.values(TRADES_ENGINE_MISSIONS)) {
    if (!markets[definition.market]) markets[definition.market] = { market: definition.market, missions: {} };
    markets[definition.market].missions[definition.missionKey] = {
      summary: {
        coverage: { LAST_TRADE: coverageForRule(), SLOT_VWAP: coverageForRule() },
        gaps: { LAST_TRADE: gapsForRule(), SLOT_VWAP: gapsForRule() },
      },
    };
  }
  return { brokenSpreadPolicy: "INCLUDE", markets };
}

// Resultado FROZEN REAL del contrato TRADES-v1: pasa por `evaluateTradesFreeze`
// (TR-04) con la aprobación explícita de Bru ligada al configHash. No se inventa
// la forma `{decision, markets}` que el motor no puede consumir (revisión
// TR05-FREEZE-SHAPE-02).
export function frozenTradesResult({ measurement = tradesBridgeMeasurement(), ownerApproval = null } = {}) {
  const candidate = buildTradesFreezeCandidate({ measurement, deleteTmSemantics: "deletion-time" });
  const approval = ownerApproval ?? {
    approvalRef: "BRU-TRADES-FREEZE-TEST",
    approvedBy: { authority: "Bru", role: "OWNER" },
    decision: "APPROVED",
    scope: TRADES_FREEZE_SCOPE,
    approvedAtUtc: "2026-09-25T00:00:00Z",
    configHash: candidate.configHash,
  };
  return evaluateTradesFreeze({ measurement, deleteTmSemantics: "deletion-time", ownerApproval: approval });
}