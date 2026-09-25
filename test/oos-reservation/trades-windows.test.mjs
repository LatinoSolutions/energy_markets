import { test } from "node:test";
import assert from "node:assert/strict";

import {
  TRADES_MISSIONS,
  canonicalCampaignIdFromLegacy,
  legacyMaturityFor,
  materializeMissionCampaigns,
  materializeTradesWindows,
  monthlyWindow,
  quarterlyWindow,
} from "../../src/oos-reservation/trades-windows.mjs";

// Calendario sintético: TODOS los días naturales son Exchange Day. Con un
// calendario denso los deadlines caen en el último día del mes (o el anterior,
// para Monthly por el cutoff) y las ventanas son verificables a mano. No es el
// calendario real (esa es la evidencia de TR-01/IMP-09); es un fixture.
function dailyCalendar(startIso, endIso) {
  const days = [];
  const cursor = new Date(`${startIso}T00:00:00Z`);
  const end = new Date(`${endIso}T00:00:00Z`);
  while (cursor.getTime() <= end.getTime()) {
    days.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return days;
}

const CALENDAR = dailyCalendar("2020-01-01", "2026-12-31");
const HORIZON = "2026-09-11";

function mission(missionKey, overrides = {}) {
  return materializeMissionCampaigns({
    missionKey,
    exchangeDays: CALENDAR,
    horizonEndIso: HORIZON,
    ...overrides,
  });
}

test("quarterlyWindow 3-1-3: GAS-Q-2025Q3 = mar-2025..may-2025", () => {
  assert.deepEqual(quarterlyWindow("2025Q3"), { ok: true, code: null, windowStart: "2025-03-01", windowEnd: "2025-05-31" });
});

test("monthlyWindow 1-0-1: GAS-M-2025-09 = ago-2025", () => {
  assert.deepEqual(monthlyWindow("2025-09"), { ok: true, code: null, windowStart: "2025-08-01", windowEnd: "2025-08-31" });
});

test("materializa las 4 misiones por separado con IDs canónicos y cobertura NO_COVERAGE", () => {
  const result = materializeTradesWindows({
    gasExchangeDays: CALENDAR,
    powerExchangeDays: CALENDAR,
    horizonEndIso: HORIZON,
  });
  assert.equal(result.ok, true);
  assert.equal(Object.keys(result.missions).length, 4);
  for (const [missionKey, definition] of Object.entries(TRADES_MISSIONS)) {
    const campaigns = result.missions[missionKey].campaigns;
    assert.ok(campaigns.length > 0, `${missionKey} sin campaigns`);
    for (const campaign of campaigns) {
      assert.equal(campaign.product, definition.product);
      assert.equal(campaign.mission, definition.mission);
      assert.equal(campaign.shortCode, definition.shortCode);
      assert.equal(campaign.coverage.source, "TR-01_COVERAGE");
      assert.equal(campaign.coverage.status, "NO_COVERAGE");
    }
  }
  // Gas Quarterly: 2021Q2..2026Q4, 23 campaigns con este horizonte.
  assert.equal(result.missions.GAS_QUARTERLY.campaigns[0].campaignId, "GAS-Q-2021Q2");
  assert.equal(result.missions.GAS_QUARTERLY.campaigns.at(-1).campaignId, "GAS-Q-2026Q4");
  assert.equal(result.missions.GAS_QUARTERLY.campaigns.length, 23);
  // Gas Monthly: entrega 2020-12..2026-09, 70 campaigns.
  assert.equal(result.missions.GAS_MONTHLY.campaigns[0].campaignId, "GAS-M-2020-12");
  assert.equal(result.missions.GAS_MONTHLY.campaigns.at(-1).campaignId, "GAS-M-2026-09");
  assert.equal(result.missions.GAS_MONTHLY.campaigns.length, 70);
  // Power no se mezcla con Gas.
  assert.equal(result.missions.POWER_QUARTERLY.campaigns[0].campaignId, "POW-Q-2021Q2");
  assert.equal(result.missions.POWER_MONTHLY.campaigns[0].campaignId, "POW-M-2020-12");
});

test("el cutoff Monthly excluye el día anterior a la entrega", () => {
  // Con un calendario denso, el 2025-08-31 es el día previo a la entrega de
  // 2025-09: el deadline cae en 2025-08-30.
  const campaign = mission("GAS_MONTHLY").campaigns.find((item) => item.maturity === "2025-09");
  assert.equal(campaign.windowStart, "2025-08-01");
  assert.equal(campaign.deadline, "2025-08-30");
});

test("PRICE-BLIND: el productor no abre Px/AskPx/BidPx ni campos de resultado", () => {
  // Getters hostiles: si el productor copiara la fila con spread o leyera un
  // campo de precio, el test revienta. `OUTCOME_LIKE_FIELDS` NO se usa para
  // esto (filtra nombres de resultado, no campos de precio): se prueba leyendo
  // de verdad el productor, no una lista de nombres.
  const trap = (field) => ({
    get [field]() {
      throw new Error(`el productor abrió el campo de precio ${field}`);
    },
  });
  const record = {
    cmdty: "NATGAS",
    area: "THE",
    shortCode: "G0BQ",
    maturity: "202510",
    trdDate: "2025-06-02",
    eligibleCount: 7,
    volumeSum: 21,
  };
  // Object.defineProperties instala los getters SIN leerlos (a diferencia de un
  // spread, que los dispararía al construir el fixture).
  for (const field of ["Px", "AskPx", "BidPx", "outcome", "value"]) {
    Object.defineProperty(record, field, Object.getOwnPropertyDescriptor(trap(field), field));
  }
  const coverageRecords = [record];
  const result = materializeMissionCampaigns({
    missionKey: "GAS_QUARTERLY",
    exchangeDays: CALENDAR,
    coverageRecords,
    horizonEndIso: HORIZON,
  });
  assert.equal(result.ok, true);
  const campaign = result.campaigns.find((item) => item.maturity === "2025Q4");
  assert.equal(campaign.coverage.status, "OBSERVED");
  assert.equal(campaign.coverage.daysWithTrades, 1);
  assert.equal(campaign.coverage.totalEligibleTrades, 7);
  // La salida no arrastra ningún campo de precio.
  for (const item of result.campaigns) {
    for (const field of ["Px", "AskPx", "BidPx", "outcome", "value"]) {
      assert.equal(Object.prototype.hasOwnProperty.call(item.coverage, field), false);
    }
  }
});

test("la cobertura de TR-01 se anexa sin sustituir campaigns", () => {
  const coverageRecords = [
    { cmdty: "NATGAS", area: "THE", shortCode: "G0BQ", maturity: "202510", trdDate: "2025-06-02", eligibleCount: 7, volumeSum: 21 },
    { cmdty: "NATGAS", area: "THE", shortCode: "G0BQ", maturity: "202510", trdDate: "2025-06-03", eligibleCount: 3, volumeSum: 9 },
  ];
  const result = mission("GAS_QUARTERLY", { coverageRecords });
  // La campaign con cobertura la muestra...
  const covered = result.campaigns.find((item) => item.maturity === "2025Q4");
  assert.equal(covered.coverage.status, "OBSERVED");
  assert.equal(covered.coverage.daysWithTrades, 2);
  assert.equal(covered.coverage.totalEligibleTrades, 10);
  assert.equal(covered.coverage.volumeSum, 30);
  // ...y las que no la tienen siguen listadas.
  const withoutCoverage = result.campaigns.filter((item) => item.coverage.status === "NO_COVERAGE");
  assert.ok(withoutCoverage.length > 0);
  assert.equal(result.campaigns.length, 23);
});

test("sin calendario o sin horizonte falla cerrado, sin inventar ventanas", () => {
  assert.equal(materializeMissionCampaigns({ missionKey: "GAS_QUARTERLY", exchangeDays: [], horizonEndIso: HORIZON }).ok, false);
  assert.equal(materializeMissionCampaigns({ missionKey: "GAS_QUARTERLY", exchangeDays: CALENDAR, horizonEndIso: null }).ok, false);
  assert.equal(materializeMissionCampaigns({ missionKey: "NOT_A_MISSION", exchangeDays: CALENDAR, horizonEndIso: HORIZON }).ok, false);
});

test("legacy maturity ↔ identidad canónica (Gas/Power × Q/M)", () => {
  assert.equal(legacyMaturityFor("Quarterly", "2025Q4"), "202510");
  assert.equal(legacyMaturityFor("Monthly", "2025-09"), "202509");
  assert.equal(canonicalCampaignIdFromLegacy({ shortCode: "G0BQ", maturity: "202510" }), "GAS-Q-2025Q4");
  assert.equal(canonicalCampaignIdFromLegacy({ shortCode: "G0BM", maturity: "202509" }), "GAS-M-2025-09");
  assert.equal(canonicalCampaignIdFromLegacy({ shortCode: "DEBQ", maturity: "202601" }), "POW-Q-2026Q1");
  assert.equal(canonicalCampaignIdFromLegacy({ shortCode: "DEBM", maturity: "202608" }), "POW-M-2026-08");
  assert.equal(canonicalCampaignIdFromLegacy({ shortCode: "G0BQ", maturity: "202512" }), null);
  assert.equal(canonicalCampaignIdFromLegacy({ shortCode: "XXX", maturity: "202510" }), null);
});
