import { test } from "node:test";
import assert from "node:assert/strict";

import {
  coverageByInstrumentDay,
  daysWithoutTrades,
  instrumentIdentity,
  summarizeInstrumentCoverage,
} from "../../src/trades-source/index.mjs";
import { tradeRow } from "./fixtures.mjs";

test("coverage agrupa por instrumento y día con conteo, volumen y extremos de Tm", () => {
  const rows = [
    tradeRow({ TrdID: "1", Tm: "2025-11-20T10:00:00Z", Sz: "1" }),
    tradeRow({ TrdID: "2", Tm: "2025-11-20T11:00:00Z", Sz: "2" }),
    tradeRow({ TrdID: "3", TrdDate: "2025-11-21", Tm: "2025-11-21T10:00:00Z", Sz: "3" }),
  ];
  const records = coverageByInstrumentDay(rows);
  assert.equal(records.length, 2);
  const day20 = records.find((record) => record.trdDate === "2025-11-20");
  assert.equal(day20.eligibleCount, 2);
  assert.equal(day20.volumeSum, 3);
  assert.equal(day20.firstTm, "2025-11-20T10:00:00Z");
  assert.equal(day20.lastTm, "2025-11-20T11:00:00Z");
});

test("un día sin trades sólo existe contra el calendario esperado", () => {
  const missing = daysWithoutTrades({
    observedDays: ["2025-11-20", "2025-11-24"],
    expectedDays: ["2025-11-20", "2025-11-21", "2025-11-24"],
  });
  assert.deepEqual(missing, ["2025-11-21"]);
});

test("el resumen por instrumento calcula días sin trades y densidad contra el calendario", () => {
  const rows = [
    tradeRow({ TrdID: "1", TrdDate: "2025-11-20" }),
    tradeRow({ TrdID: "2", TrdDate: "2025-11-24" }),
  ];
  const records = coverageByInstrumentDay(rows);
  const summary = summarizeInstrumentCoverage(records, ["2025-11-20", "2025-11-21", "2025-11-24"]);
  assert.equal(summary.length, 1);
  assert.equal(summary[0].daysWithTrades, 2);
  assert.equal(summary[0].daysWithoutTrades, 1);
  assert.equal(summary[0].firstDate, "2025-11-20");
  assert.equal(summary[0].lastDate, "2025-11-24");
  assert.equal(summary[0].density, 2 / 3);
});

test("instrumentIdentity prefiere el ISIN y cae al par ShortCode|Maturity", () => {
  assert.equal(instrumentIdentity(tradeRow({ InstrumentISIN: "ISIN-X" })), "ISIN-X");
  assert.equal(instrumentIdentity(tradeRow({ InstrumentISIN: "", ShortCode: "DEBQ", Maturity: "202601" })), "DEBQ|202601");
});
