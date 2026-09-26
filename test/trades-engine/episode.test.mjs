import { test } from "node:test";
import assert from "node:assert/strict";

import { OBSERVATION_RULES, SLOT_LABELS } from "../../src/trades-bridge/constants.mjs";
import { TRADES_POLICIES, runTobEpisode, runTradesEpisode } from "../../src/trades-engine/episode.mjs";
import { gasQuarterlyCampaign, gasQuarterlyTradeAt } from "./fixtures.mjs";

const campaign = gasQuarterlyCampaign();
const tradingDays = ["2025-09-01", "2025-09-02", "2025-09-03"];
const rows = [
  gasQuarterlyTradeAt({ day: "2025-09-01", slot: "11:00", price: 100 }),
  gasQuarterlyTradeAt({ day: "2025-09-02", slot: "11:00", price: 90 }),
  gasQuarterlyTradeAt({ day: "2025-09-03", slot: "11:00", price: 110 }),
];

function run(overrides = {}) {
  return runTradesEpisode({
    campaign,
    tradingDays,
    rows,
    targetMw: 2,
    policy: TRADES_POLICIES.A0,
    observationRule: OBSERVATION_RULES.LAST_TRADE,
    freshnessLimitSeconds: 900,
    penaltyEurMwh: 0.5,
    ...overrides,
  });
}

test("fill TRADES = trade observado + penalización + 0,15, sin duplicar el 0,15", () => {
  const result = run();
  assert.equal(result.ok, true);
  assert.equal(result.summary.complete, true);
  assert.equal(result.summary.status, "COMPLETE");
  assert.equal(result.summary.boughtMw, 2);
  const filled = result.ledger.filter((entry) => entry.filledMw > 0);
  assert.ok(filled.length > 0);
  for (const entry of filled) {
    assert.equal(entry.priceEurMwh, entry.price + 0.5 + 0.15);
    assert.equal(entry.observationRule, "LAST_TRADE");
    assert.equal(typeof entry.observationTm, "string");
  }
});

test("día sin trade elegible dentro de la frescura no arrastra precio y marca DATA_INCOMPLETE", () => {
  const result = run({ rows: [] });
  assert.equal(result.ok, true);
  assert.equal(result.summary.complete, false);
  assert.equal(result.summary.status, "DATA_INCOMPLETE");
  assert.equal(result.summary.noObservationDays, tradingDays.length);
  assert.equal(result.ledger.every((entry) => entry.price === null), true);
});

test("el hueco de data no deja superar el cap de 12 MW/día ni se cuenta como forcing de la estrategia", () => {
  // 60 MW, 6 días, sin observación los 2 primeros (revisión TR05-DAILY-CAP-03).
  const days = ["2023-09-01", "2023-09-04", "2023-09-05", "2023-09-06", "2023-09-07", "2023-09-08"];
  const rows = days.slice(2).map((day) => gasQuarterlyTradeAt({ day, slot: "11:00", price: 100 }));
  const params = { campaign, tradingDays: days, rows, targetMw: 60, observationRule: OBSERVATION_RULES.LAST_TRADE, freshnessLimitSeconds: 900, penaltyEurMwh: 0.5 };

  const dip = runTradesEpisode({ ...params, policy: TRADES_POLICIES.DIP10 });
  assert.equal(dip.ok, true);
  assert.equal(dip.ledger.every((entry) => entry.filledMw <= 12), true);
  assert.equal(dip.summary.complete, false);
  assert.equal(dip.summary.status, "DATA_INCOMPLETE");
  assert.equal(dip.summary.forcedDays, 0);
  assert.equal(dip.summary.hardRejected, false);
  assert.deepEqual(dip.ledger.map((entry) => entry.filledMw), [0, 0, 12, 12, 12, 12]);

  // A0, con la misma data, da el MISMO estado de data y tampoco es hard-rejected:
  // el forcing por falta de data es distinto del hard-reject de la estrategia
  // (patch 03 §3.4).
  const a0 = runTradesEpisode({ ...params, policy: TRADES_POLICIES.A0 });
  assert.equal(a0.summary.status, "DATA_INCOMPLETE");
  assert.equal(a0.summary.hardRejected, false);
  assert.equal(a0.ledger.every((entry) => entry.filledMw <= 12), true);
});

test("DEPTH no existe en TRADES y el fill falla cerrado", () => {
  const result = run({ fillModel: "DEPTH" });
  assert.equal(result.ok, false);
  assert.equal(result.code, "DEPTH_NOT_AVAILABLE_IN_TRADES");
});

test("penalización sin medir no se sustituye por cero", () => {
  const result = run({ penaltyEurMwh: null });
  assert.equal(result.ok, false);
  assert.equal(result.code, "PENALTY_UNKNOWN");
});

test("SLOT_VWAP corre como regla de observación del mismo motor", () => {
  const result = run({
    observationRule: OBSERVATION_RULES.SLOT_VWAP,
    rows: [
      gasQuarterlyTradeAt({ day: "2025-09-01", slot: "10:45", price: 100, size: "1" }),
      gasQuarterlyTradeAt({ day: "2025-09-02", slot: "10:45", price: 90, size: "1" }),
      gasQuarterlyTradeAt({ day: "2025-09-03", slot: "10:45", price: 110, size: "1" }),
    ],
  });
  assert.equal(result.ok, true);
  assert.equal(result.summary.complete, true);
  assert.equal(result.ledger.filter((entry) => entry.filledMw > 0).every((entry) => entry.observationRule === "SLOT_VWAP"), true);
});

test("el control TOB generalizado usa best ask + 0,15 y no toca el release v2", () => {
  const slotIndex = SLOT_LABELS.indexOf("11:00");
  const series = new Map(tradingDays.map((day, index) => [
    day,
    SLOT_LABELS.map((label, position) => (position === slotIndex ? { ask: 100 + index, askSz: 5, bid: 99, quoteTm: `${day}T09:00:00Z` } : null)),
  ]));
  const result = runTobEpisode({ campaign, tradingDays, series, slotIndex, targetMw: 2, policy: TRADES_POLICIES.A0 });
  assert.equal(result.ok, true);
  assert.equal(result.summary.complete, true);
  const filled = result.ledger.filter((entry) => entry.filledMw > 0);
  assert.ok(filled.length > 0);
  for (const entry of filled) {
    assert.equal(entry.priceEurMwh, entry.price + 0.15);
    assert.equal(entry.observationRule, "TOB");
  }
  const empty = runTobEpisode({ campaign, tradingDays, series: new Map(), slotIndex, targetMw: 2, policy: TRADES_POLICIES.A0 });
  assert.equal(empty.summary.status, "DATA_INCOMPLETE");
  assert.equal(empty.ledger.every((entry) => entry.status === "NO_QUOTE"), true);
});
