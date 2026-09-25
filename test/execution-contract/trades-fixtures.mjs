// Fixtures sintéticas compartidas por los tests de TR-04. NO son la medición
// real del puente (TR-03 es un job que lanza Bru) ni una aprobación real de Bru.
//
// La medición se construye con el PRODUCTOR REAL de TR-03
// (`measureBridgeCampaigns` + `buildBridgeArtifact`), no con una forma inventada:
// así los tests fallan si el contrato vuelve a leer una ruta que TR-03 no publica
// (los artefactos de TR-03 llevan los cortes dentro de `missions[m].summary`).
// Todos los precios son inventados y sólo prueban la regla.

import {
  buildBridgeArtifact,
  BRIDGE_WINDOW,
  bridgeHalves,
  measureBridgeCampaigns,
  SLOT_LABELS,
  slotEpochMs,
} from "../../src/trades-bridge/index.mjs";
import { TRADES_FREEZE_SCOPE } from "../../src/execution-contract/index.mjs";

// Una misión por mercado/tenor, con su propio contrato (ShortCode|Maturity) y su
// lado agresor declarado. El offset `penalty` es el gap constante que el
// productor convierte en la penalización (ask = trade + penalty => gap = -penalty).
const MISSION_SPECS = Object.freeze([
  { missionKey: "GAS_QUARTERLY", market: "GAS_THE", cmdty: "NATGAS", area: "THE", shortCode: "G0BQ", product: "Gas", mission: "Quarterly", maturity: "2026Q1", legacyMaturity: "202601", aggressor: "BUY", penalty: 2 },
  { missionKey: "GAS_MONTHLY", market: "GAS_THE", cmdty: "NATGAS", area: "THE", shortCode: "G0BM", product: "Gas", mission: "Monthly", maturity: "2026-02", legacyMaturity: "202602", aggressor: "", penalty: 2.5 },
  { missionKey: "POWER_QUARTERLY", market: "POWER_DE", cmdty: "POWER", area: "DE", shortCode: "DEBQ", product: "Power", mission: "Quarterly", maturity: "2026Q1", legacyMaturity: "202601", aggressor: "SELL", penalty: 1 },
  { missionKey: "POWER_MONTHLY", market: "POWER_DE", cmdty: "POWER", area: "DE", shortCode: "DEBM", product: "Power", mission: "Monthly", maturity: "2026-02", legacyMaturity: "202602", aggressor: "", penalty: 0.5 },
]);

const CALIBRATION_START = "2025-09-01";
const EVALUATION_START = bridgeHalves(BRIDGE_WINDOW).evaluationStartIso;

function weekdays(startIso, count) {
  const days = [];
  let cursor = new Date(`${startIso}T00:00:00Z`).getTime();
  while (days.length < count) {
    const date = new Date(cursor);
    const dow = date.getUTCDay();
    if (dow !== 0 && dow !== 6) days.push(date.toISOString().slice(0, 10));
    cursor += 86400000;
  }
  return days;
}

function askDay(value) {
  return SLOT_LABELS.map(() => ({ ask: value, askSz: 1, bid: value - 1, quoteTm: null }));
}

function tradeRow({ spec, day, slotLabel, price, aggressor }) {
  return {
    AgrsrAct: aggressor,
    Area: spec.area,
    Cmdty: spec.cmdty,
    Currency: "EUR",
    FromBrokenSpread: "false",
    InstrumentISIN: `ISIN-${spec.shortCode}-${spec.legacyMaturity}`,
    InstrumentType: "Simple Instrument",
    Maturity: spec.legacyMaturity,
    Px: String(price),
    ShortCode: spec.shortCode,
    Sz: "1",
    Tm: new Date(slotEpochMs(day, slotLabel)).toISOString(),
    TrdDate: day,
    TrdID: `${spec.shortCode}-${day}-${slotLabel}`,
    TrdType: "Exchange",
    UOM: "MWh",
    UpdtAct: "New",
    VolumeOnly: "",
  };
}

// Construye una medición REAL con el productor de TR-03. `penalties` permite fijar
// el gap por misión; `contaminationPenalty` añade días de la mitad de evaluación
// con otro gap para probar que NO contaminan la calibración.
export function measurementFixture({ penalties = {}, days = 40, contaminationPenalty = null, evaluationDays = 0 } = {}) {
  const calibrationDays = weekdays(CALIBRATION_START, days);
  const evaluationDaysList = contaminationPenalty === null ? [] : weekdays(EVALUATION_START, evaluationDays || 10);
  const campaigns = [];
  const rows = [];
  const askSeries = new Map();

  for (const spec of MISSION_SPECS) {
    const penalty = penalties[spec.missionKey] ?? spec.penalty;
    const windowDays = [...calibrationDays, ...evaluationDaysList];
    campaigns.push({
      campaignId: `${spec.shortCode}-FIXTURE`,
      market: spec.market,
      mission: spec.missionKey,
      product: spec.product,
      shortCode: spec.shortCode,
      maturity: spec.maturity,
      legacyMaturity: spec.legacyMaturity,
      windowStart: windowDays[0],
      windowEnd: windowDays[windowDays.length - 1],
      deadline: windowDays[windowDays.length - 1],
      windowDays,
    });

    const seriesDays = new Map();
    for (let index = 0; index < windowDays.length; index += 1) {
      const day = windowDays[index];
      const price = 100 - index;
      const isContamination = index >= calibrationDays.length;
      const gapOffset = isContamination ? contaminationPenalty : penalty;
      seriesDays.set(day, askDay(price + gapOffset));
      for (const slotLabel of SLOT_LABELS) {
        rows.push(tradeRow({ spec, day, slotLabel, price, aggressor: spec.aggressor }));
      }
    }
    askSeries.set(`${spec.shortCode}|${spec.legacyMaturity}`, seriesDays);
  }

  const finished = measureBridgeCampaigns({ campaigns, askSeries, brokenSpreadPolicy: "INCLUDE", rows });
  const { ok, artifact, errors } = buildBridgeArtifact({ finished });
  if (!ok) throw new Error(`measurementFixture HOLD: ${JSON.stringify(errors)}`);
  return artifact;
}

// Decisión de fuente de TR-01 sintética. Por defecto no declara política
// concreta (la medición es la fuente congelable).
export function sourceDecisionFixture({ brokenSpreadPolicy = null } = {}) {
  return {
    brokenSpreadPolicy,
    measurements: { deleteTmSemantics: { value: "deletion-time" } },
  };
}

// FIXTURE: aprobación sintética, NO es una decisión real de Bru.
export function approvalFor(configHash) {
  return {
    approvalRef: "OWNER-DECISION-TR-04-FIXTURE",
    approvedBy: { authority: "Bru", role: "owner" },
    decision: "APPROVED",
    scope: TRADES_FREEZE_SCOPE,
    approvedAtUtc: "2026-09-25T00:00:00Z",
    configHash,
  };
}

export function frozenInput(overrides = {}) {
  return {
    measurement: measurementFixture(),
    sourceDecision: sourceDecisionFixture(),
    deleteTmSemantics: "deletion-time",
    ...overrides,
  };
}