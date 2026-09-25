import { test } from "node:test";
import assert from "node:assert/strict";

import { missionObservationConfig, resolveFrozenConfig, runTradesMission } from "../../src/trades-engine/run.mjs";
import { powerMonthlyTradeAt } from "./fixtures.mjs";

function observations(freshness = 900, penalty = 0.5) {
  const cell = { freshness: { status: "MEASURED", value: freshness }, penalty: { status: "MEASURED", value: penalty } };
  return { LAST_TRADE: { ...cell }, SLOT_VWAP: { ...cell } };
}

function fullContract() {
  const mission = (product, missionName, shortCode) => ({ product, mission: missionName, shortCode, observations: observations() });
  return {
    decision: "FROZEN",
    markets: {
      GAS_THE: { market: "GAS_THE", missions: { GAS_QUARTERLY: mission("Gas", "Quarterly", "G0BQ"), GAS_MONTHLY: mission("Gas", "Monthly", "G0BM") } },
      POWER_DE: { market: "POWER_DE", missions: { POWER_QUARTERLY: mission("Power", "Quarterly", "DEBQ"), POWER_MONTHLY: mission("Power", "Monthly", "DEBM") } },
    },
  };
}

test("resolveFrozenConfig exige FROZEN y las 4 misiones medidas", () => {
  assert.equal(resolveFrozenConfig(null).ok, false);
  assert.equal(resolveFrozenConfig({ decision: "HOLD" }).code, "TRADES_CONTRACT_NOT_FROZEN");
  const partial = { decision: "FROZEN", markets: { GAS_THE: { missions: { GAS_QUARTERLY: { observations: observations() } } } } };
  const partialResult = resolveFrozenConfig(partial);
  assert.equal(partialResult.ok, false);
  assert.equal(partialResult.code, "UNMEASURED_CONTRACT_PARAMETERS");
  assert.equal(resolveFrozenConfig(fullContract()).ok, true);
});

test("missionObservationConfig no inventa frescura ni penalización", () => {
  const contract = fullContract();
  assert.deepEqual(missionObservationConfig(contract, "POWER_MONTHLY", "LAST_TRADE"), {
    ok: true,
    code: null,
    freshnessLimitSeconds: 900,
    freshnessStatus: "MEASURED",
    penaltyEurMwh: 0.5,
    penaltyStatus: "MEASURED",
  });
  const unknown = { decision: "FROZEN", markets: { POWER_DE: { missions: { POWER_MONTHLY: { observations: { LAST_TRADE: { freshness: { status: "UNKNOWN" }, penalty: { status: "UNKNOWN" } } } } } } } };
  const config = missionObservationConfig(unknown, "POWER_MONTHLY", "LAST_TRADE");
  assert.equal(config.freshnessLimitSeconds, null);
  assert.equal(config.penaltyEurMwh, null);
});

test("runTradesMission corre las 4 misiones con sus brazos y salta las zonas no corridas", () => {
  const campaigns = [
    { campaignId: "POW-M-2026-01", product: "Power", mission: "Monthly", market: "POWER_DE", shortCode: "DEBM", maturity: "2026-01", zone: "DEVELOPMENT", windowStart: "2025-09-01", deadline: "2025-09-03" },
    { campaignId: "POW-M-2026-02", product: "Power", mission: "Monthly", market: "POWER_DE", shortCode: "DEBM", maturity: "2026-02", zone: "DEVELOPMENT", windowStart: "2025-10-01", deadline: "2025-10-03" },
    { campaignId: "POW-M-2025-08", product: "Power", mission: "Monthly", market: "POWER_DE", shortCode: "DEBM", maturity: "2025-08", zone: "PURGE", windowStart: "2025-07-01", deadline: "2025-07-28" },
  ];
  const rows = [
    powerMonthlyTradeAt({ day: "2025-09-01", slot: "11:00", price: 50 }),
    powerMonthlyTradeAt({ day: "2025-09-02", slot: "11:00", price: 48 }),
    powerMonthlyTradeAt({ day: "2025-09-03", slot: "11:00", price: 52 }),
    powerMonthlyTradeAt({ day: "2025-10-01", slot: "11:00", price: 50, overrides: { Maturity: "202602" } }),
    powerMonthlyTradeAt({ day: "2025-10-02", slot: "11:00", price: 48, overrides: { Maturity: "202602" } }),
    powerMonthlyTradeAt({ day: "2025-10-03", slot: "11:00", price: 52, overrides: { Maturity: "202602" } }),
  ];
  const exchangeDays = ["2025-09-01", "2025-09-02", "2025-09-03", "2025-10-01", "2025-10-02", "2025-10-03"];

  const result = runTradesMission({
    missionKey: "POWER_MONTHLY",
    campaigns,
    rows,
    exchangeDays,
    frozenContract: fullContract(),
  });
  assert.equal(result.ok, true);
  assert.equal(result.targetMw, 10);
  assert.deepEqual(result.skipped, ["POW-M-2025-08"]);
  assert.deepEqual(Object.keys(result.episodesByRule).sort(), ["LAST_TRADE", "SLOT_VWAP"]);
  for (const rule of ["LAST_TRADE", "SLOT_VWAP"]) {
    const episodes = result.episodesByRule[rule];
    assert.equal(episodes.length, 2);
    for (const episode of episodes) {
      assert.deepEqual(Object.keys(episode.arms).sort(), ["BASELINE", "DIP10", "HOUR"]);
      assert.equal(episode.arms.BASELINE.summary.targetMw, 10);
    }
    assert.equal(result.comparisons[rule].benchmarkRule, "MEAN_OF_OBSERVATION_PRICE");
  }
  // El segundo episodio elige hora walk-forward con el primero (sólo 11:00 tiene observación fresca).
  const second = result.episodesByRule.LAST_TRADE.find((episode) => episode.campaign.campaignId === "POW-M-2026-02");
  assert.equal(second.hour.historyOnlyDevelopment, true);
  assert.equal(second.hour.chosenSlot, "11:00");
});
