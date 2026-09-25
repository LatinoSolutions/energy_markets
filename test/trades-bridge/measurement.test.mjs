import { test } from "node:test";
import assert from "node:assert/strict";

import {
  buildBridgeArtifact,
  measureBridgeCampaigns,
} from "../../src/trades-bridge/index.mjs";
import { askDay, askSeries, gasQuarterlyCampaign, gasQuarterlyTrade } from "./fixtures.mjs";

function run({ campaigns, rows, series, brokenSpreadPolicy = "INCLUDE" }) {
  const finished = measureBridgeCampaigns({ campaigns, askSeries: series, brokenSpreadPolicy, rows });
  return buildBridgeArtifact({ finished });
}

const ASKS = askSeries({
  "G0BQ|202601": { "2025-09-01": askDay(100), "2025-09-02": askDay(100) },
});

test("mide antigüedad, cobertura por slot y brecha trade->ask del puente", () => {
  const rows = [
    gasQuarterlyTrade({ TrdDate: "2025-09-01", Tm: "2025-09-01T09:00:00Z", Px: "90", TrdID: "1" }),
    gasQuarterlyTrade({ TrdDate: "2025-09-02", Tm: "2025-09-02T09:00:00Z", Px: "80", TrdID: "2" }),
  ];
  const { ok, artifact } = run({ campaigns: [gasQuarterlyCampaign()], rows, series: ASKS });
  assert.equal(ok, true);
  assert.equal(artifact.status, "MEASURED");

  const campaign = artifact.markets.GAS_THE.missions.GAS_QUARTERLY.campaigns[0];
  assert.equal(campaign.campaignId, "GAS-Q-2026Q1");
  assert.equal(campaign.instrument, "G0BQ|202601");
  assert.equal(campaign.slotsTotal, 40);

  // LAST_TRADE: día 1 los slots 11:00-17:30 (14) y día 2 los 20 (arrastra el
  // trade del día anterior). SLOT_VWAP sólo existe en el slot 11:00 de cada día.
  assert.equal(campaign.coverage.LAST_TRADE.slotsWithObservation, 34);
  assert.equal(campaign.coverage.SLOT_VWAP.slotsWithObservation, 2);
  assert.equal(campaign.coverage.LAST_TRADE.ageSeconds.count, 34);

  // No hay look-ahead: el slot 08:00 del día 1 no ve el trade de las 11:00.
  assert.equal(campaign.coverage.LAST_TRADE.bySlot[0].slotsWithObservation, 1);
  assert.equal(campaign.coverage.LAST_TRADE.bySlot[6].slotsWithObservation, 2);

  // Brecha: 20 slots con el trade de 90 (-10) y 14 con el de 80 (-20).
  assert.equal(campaign.gaps.LAST_TRADE.overall.count, 34);
  assert.equal(campaign.gaps.LAST_TRADE.overall.mean, (20 * -10 + 14 * -20) / 34);
  assert.equal(campaign.gaps.LAST_TRADE.overall.shareNegative, 1);
  assert.equal(campaign.gaps.SLOT_VWAP.overall.count, 2);

  // Distancia a entrega: 2025-09 -> 2026Q1 = 4 meses.
  assert.deepEqual(campaign.gaps.LAST_TRADE.byDistanceMonths.map((entry) => entry.distanceMonths), [4]);
  assert.equal(campaign.gaps.LAST_TRADE.byDistanceMonths[0].count, 34);
  assert.deepEqual(campaign.gaps.LAST_TRADE.byAggressor.map((entry) => entry.aggressor), ["BUY"]);
  // Con menos de 5 observaciones previas DIP10 no tiene estado (fallback A0).
  assert.deepEqual(campaign.gaps.LAST_TRADE.byDip10State.map((entry) => entry.dip10State), ["INSUFFICIENT_HISTORY"]);
  // Las dos fechas caen en la primera mitad del puente.
  assert.deepEqual(campaign.gaps.LAST_TRADE.byHalf.map((entry) => entry.half), ["CALIBRATION"]);

  // Resumen de misión: agrega las campaigns.
  const summary = artifact.markets.GAS_THE.missions.GAS_QUARTERLY.summary;
  assert.equal(summary.coverage.LAST_TRADE.slotsWithObservation, 34);
  assert.equal(summary.gaps.LAST_TRADE.overall.count, 34);
});

test("el Delete point-in-time retira el trade sólo desde el borrado", () => {
  const rows = [
    gasQuarterlyTrade({ TrdDate: "2025-09-01", Tm: "2025-09-01T08:00:00Z", Px: "95", TrdID: "10" }),
    gasQuarterlyTrade({ TrdDate: "2025-09-01", Tm: "2025-09-01T10:00:00Z", UpdtAct: "Delete", Px: "", TrdID: "10" }),
  ];
  const series = askSeries({ "G0BQ|202601": { "2025-09-01": askDay(100) } });
  const { artifact } = run({
    campaigns: [gasQuarterlyCampaign({ windowDays: ["2025-09-01"] })],
    rows,
    series,
  });
  const campaign = artifact.markets.GAS_THE.missions.GAS_QUARTERLY.campaigns[0];
  // 10:00Z es 12:00 Berlin (slot índice 8). El trade de 10:00 Berlin (índice 4)
  // sigue elegible en 10:00/10:30/11:00/11:30 (índices 4-7); en 12:00 (índice 8)
  // el Delete ya lo retiró.
  assert.equal(campaign.coverage.LAST_TRADE.slotsWithObservation, 4);
  assert.equal(campaign.coverage.LAST_TRADE.bySlot[4].slotsWithObservation, 1);
  assert.equal(campaign.coverage.LAST_TRADE.bySlot[7].slotsWithObservation, 1);
  assert.equal(campaign.coverage.LAST_TRADE.bySlot[8].slotsWithObservation, 0);
});

test("fail-closed sin windowDays: HOLD, no se inventa la ventana", () => {
  const campaign = gasQuarterlyCampaign();
  delete campaign.windowDays;
  const { ok, artifact } = run({ campaigns: [campaign], rows: [], series: ASKS });
  assert.equal(ok, false);
  assert.equal(artifact.status, "HOLD");
  assert.ok(artifact.errors.some((error) => error.code === "MISSING_WINDOW_DAYS"));
});

test("dos campaigns de la misma misión no se cruzan y el resumen suma", () => {
  const second = gasQuarterlyCampaign({
    campaignId: "GAS-Q-2026Q2",
    maturity: "2026Q2",
    legacyMaturity: "202604",
    windowStart: "2026-03-01",
    windowEnd: "2026-03-02",
    windowDays: ["2026-03-02"],
  });
  const series = askSeries({
    "G0BQ|202601": { "2025-09-01": askDay(100) },
    "G0BQ|202604": { "2026-03-02": askDay(200) },
  });
  const rows = [
    gasQuarterlyTrade({ TrdDate: "2025-09-01", Tm: "2025-09-01T09:00:00Z", Px: "90", TrdID: "1" }),
    gasQuarterlyTrade({ TrdDate: "2026-03-02", Tm: "2026-03-02T10:00:00Z", Px: "180", Maturity: "202604", TrdID: "2" }),
  ];
  const { artifact } = run({
    campaigns: [gasQuarterlyCampaign({ windowDays: ["2025-09-01"] }), second],
    rows,
    series,
  });
  const campaigns = artifact.markets.GAS_THE.missions.GAS_QUARTERLY.campaigns;
  assert.deepEqual(campaigns.map((entry) => entry.campaignId), ["GAS-Q-2026Q1", "GAS-Q-2026Q2"]);
  const summary = artifact.markets.GAS_THE.missions.GAS_QUARTERLY.summary;
  assert.equal(
    summary.coverage.LAST_TRADE.slotsTotal,
    campaigns.reduce((sum, entry) => sum + entry.coverage.LAST_TRADE.slotsTotal, 0),
  );
});
