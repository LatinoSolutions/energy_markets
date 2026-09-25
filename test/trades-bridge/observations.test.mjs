import { test } from "node:test";
import assert from "node:assert/strict";

import { DIP10, FRESHNESS_LIMIT_CANDIDATES_SECONDS } from "../../src/trades-bridge/constants.mjs";
import {
  ageBucketOf,
  dip10State,
  pickLastTrade,
  slotVwap,
} from "../../src/trades-bridge/observations.mjs";
import { slotEpochMs } from "../../src/trades-bridge/time.mjs";
import { gasQuarterlyTrade } from "./fixtures.mjs";

const DECISION = slotEpochMs("2025-09-01", "11:00");

test("pickLastTrade devuelve el trade con Tm máximo", () => {
  const trades = [
    gasQuarterlyTrade({ Tm: "2025-09-01T08:00:00Z", Px: "90" }),
    gasQuarterlyTrade({ Tm: "2025-09-01T08:59:00Z", Px: "91" }),
    gasQuarterlyTrade({ Tm: "2025-09-01T07:00:00Z", Px: "89" }),
  ];
  const last = pickLastTrade(trades);
  assert.equal(last.price, 91);
  assert.equal(new Date(last.epochMs).toISOString(), "2025-09-01T08:59:00.000Z");
});

test("slotVwap pondera por volumen y respeta la ventana (slotStart, decision]", () => {
  const trades = [
    gasQuarterlyTrade({ Tm: "2025-09-01T08:30:00Z", Px: "999", Sz: "1" }), // fuera: == slotStart
    gasQuarterlyTrade({ Tm: "2025-09-01T08:45:00Z", Px: "90", Sz: "1" }),
    gasQuarterlyTrade({ Tm: "2025-09-01T08:55:00Z", Px: "100", Sz: "3" }),
    gasQuarterlyTrade({ Tm: "2025-09-01T09:00:00Z", Px: "200", Sz: "1" }), // dentro: == decision
  ];
  const vwap = slotVwap(trades, { slotStartEpochMs: DECISION - 1800000, decisionEpochMs: DECISION });
  assert.equal(vwap.vwap, (90 * 1 + 100 * 3 + 200 * 1) / 5);
  assert.equal(vwap.volume, 5);
  assert.equal(vwap.count, 3);
});

test("slotVwap marca UNKNOWN si el lado agresor está mezclado y null sin volumen", () => {
  const mixed = slotVwap([
    gasQuarterlyTrade({ Tm: "2025-09-01T08:45:00Z", Px: "90", Sz: "1", AgrsrAct: "BUY" }),
    gasQuarterlyTrade({ Tm: "2025-09-01T08:50:00Z", Px: "90", Sz: "1", AgrsrAct: "SELL" }),
  ], { slotStartEpochMs: DECISION - 1800000, decisionEpochMs: DECISION });
  assert.equal(mixed.aggressor, "UNKNOWN");
  const empty = slotVwap([], { slotStartEpochMs: DECISION - 1800000, decisionEpochMs: DECISION });
  assert.equal(empty, null);
  const noVolume = slotVwap([gasQuarterlyTrade({ Tm: "2025-09-01T08:45:00Z", Sz: "" })], {
    slotStartEpochMs: DECISION - 1800000,
    decisionEpochMs: DECISION,
  });
  assert.equal(noVolume, null);
});

test("dip10State distingue falta de historia, por debajo y por encima de la media", () => {
  assert.equal(dip10State({ previousValues: [1, 2, 3], value: 0 }), DIP10.INSUFFICIENT_HISTORY);
  assert.equal(dip10State({ previousValues: [100, 100, 100, 100, 100], value: 90 }), DIP10.BELOW_MEAN);
  assert.equal(dip10State({ previousValues: [100, 100, 100, 100, 100], value: 110 }), DIP10.NOT_BELOW_MEAN);
});

test("ageBucketOf etiqueta contra la grilla candidata declarada", () => {
  assert.equal(ageBucketOf(0), "LE_15M");
  assert.equal(ageBucketOf(FRESHNESS_LIMIT_CANDIDATES_SECONDS[0]), "LE_15M");
  assert.equal(ageBucketOf(FRESHNESS_LIMIT_CANDIDATES_SECONDS[1]), "LE_30M");
  assert.equal(ageBucketOf(FRESHNESS_LIMIT_CANDIDATES_SECONDS.at(-1) + 1), "GT_24H");
});
