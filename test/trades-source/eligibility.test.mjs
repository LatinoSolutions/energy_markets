import { test } from "node:test";
import assert from "node:assert/strict";

import {
  AGGREGATOR,
  BROKEN_SPREAD_POLICIES,
  ELIGIBILITY_REASON,
  aggregateEligibility,
  classifyAggressor,
  eligibilityReasons,
  isEligibleTrade,
  measureBrokenSpreadPolicies,
} from "../../src/trades-source/index.mjs";
import { tradeRow } from "./fixtures.mjs";

test("un trade outright New es elegible por defecto (broken spread INCLUDE)", () => {
  assert.equal(isEligibleTrade(tradeRow()), true);
  assert.deepEqual(eligibilityReasons(tradeRow()), []);
});

test("la regla §3.1 excluye spread, tipo no Exchange, Px vacío, VolumeOnly y filas no-New", () => {
  const spread = tradeRow({ InstrumentType: "Futures Spread", Maturity: "" });
  assert.deepEqual(eligibilityReasons(spread), [ELIGIBILITY_REASON.INSTRUMENT_NOT_SIMPLE]);

  const registration = tradeRow({ TrdType: "Trade Registration" });
  assert.deepEqual(eligibilityReasons(registration), [ELIGIBILITY_REASON.TRD_TYPE_NOT_EXCHANGE]);

  const volumeOnly = tradeRow({ Px: "", VolumeOnly: "true" });
  assert.deepEqual(eligibilityReasons(volumeOnly), [
    ELIGIBILITY_REASON.PX_EMPTY,
    ELIGIBILITY_REASON.VOLUME_ONLY,
  ]);

  const deleted = tradeRow({ UpdtAct: "Delete" });
  assert.deepEqual(eligibilityReasons(deleted), [ELIGIBILITY_REASON.NOT_A_NEW_UPDATE]);
});

test("broken spread se incluye o excluye según la política declarada", () => {
  const broken = tradeRow({ FromBrokenSpread: "true", AgrsrAct: "" });
  assert.equal(isEligibleTrade(broken, { brokenSpreadPolicy: BROKEN_SPREAD_POLICIES.INCLUDE }), true);
  assert.deepEqual(eligibilityReasons(broken, { brokenSpreadPolicy: BROKEN_SPREAD_POLICIES.EXCLUDE }), [
    ELIGIBILITY_REASON.BROKEN_SPREAD_EXCLUDED,
  ]);
});

test("los trades sin AgrsrAct forman su propio grupo y nunca se asignan a un lado", () => {
  assert.equal(classifyAggressor(tradeRow({ AgrsrAct: "" })), AGGREGATOR.UNKNOWN);
  assert.equal(classifyAggressor(tradeRow({ AgrsrAct: "SELL" })), AGGREGATOR.SELL);
  assert.equal(classifyAggressor(tradeRow({ AgrsrAct: "BUY" })), AGGREGATOR.BUY);

  const rows = [
    tradeRow({ TrdID: "1", FromBrokenSpread: "true", AgrsrAct: "" }),
    tradeRow({ TrdID: "2", FromBrokenSpread: "false", AgrsrAct: "SELL" }),
    tradeRow({ TrdID: "3", InstrumentType: "Futures Spread" }),
  ];
  const counts = aggregateEligibility(rows);
  assert.equal(counts.total, 3);
  assert.equal(counts.eligible, 2);
  assert.equal(counts.eligibleBrokenSpread, 1);
  assert.equal(counts.eligibleNotBrokenSpread, 1);
  assert.equal(counts.eligibleUnknownAggressor, 1);
  assert.equal(counts.byAggressor[AGGREGATOR.UNKNOWN], 1);
  assert.equal(counts.byAggressor[AGGREGATOR.SELL], 1);
  assert.equal(counts.reasonCounts[ELIGIBILITY_REASON.INSTRUMENT_NOT_SIMPLE], 1);
});

test("measureBrokenSpreadPolicies mide ambas políticas sin elegir ninguna", () => {
  const rows = [
    tradeRow({ TrdID: "1", FromBrokenSpread: "true", AgrsrAct: "" }),
    tradeRow({ TrdID: "2", FromBrokenSpread: "false", AgrsrAct: "SELL" }),
  ];
  const measured = measureBrokenSpreadPolicies(rows);
  assert.equal(measured.include.eligible, 2);
  assert.equal(measured.exclude.eligible, 1);
  assert.equal(measured.exclude.reasonCounts[ELIGIBILITY_REASON.BROKEN_SPREAD_EXCLUDED], 1);
});
