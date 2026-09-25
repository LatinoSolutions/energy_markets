import { test } from "node:test";
import assert from "node:assert/strict";

import {
  contractWindowsFromReference,
  coverageByInstrumentDay,
  measureReferenceExpiryRelation,
  summarizeInstrumentCoverage,
} from "../../src/trades-source/index.mjs";
import { tradeRow } from "./fixtures.mjs";

const exchangeDaysBetween = (start, end) => [start, end];

test("la ventana de contrato sale del reference (StartDate..EndDate), no de los trades", () => {
  const referenceRows = [
    tradeRow({ InstrumentISIN: "ISIN-A", StartDate: "2025-11-18", EndDate: "2025-11-24", TrdDate: "2025-11-18" }),
    tradeRow({ InstrumentISIN: "ISIN-A", StartDate: "2025-11-17", EndDate: "2025-11-21", TrdDate: "2025-11-19" }),
  ];
  const windows = contractWindowsFromReference(referenceRows, { exchangeDaysBetween });
  assert.deepEqual(windows.get("ISIN-A"), ["2025-11-17", "2025-11-24"]);
});

test("una referencia sin StartDate/EndDate no inventa ventana", () => {
  const windows = contractWindowsFromReference(
    [tradeRow({ InstrumentISIN: "ISIN-B", StartDate: "", EndDate: "" })],
    { exchangeDaysBetween },
  );
  assert.equal(windows.has("ISIN-B"), false);
});

test("cobertura + ventana de contrato cuenta faltantes al inicio y al final", () => {
  const rows = [
    tradeRow({ InstrumentISIN: "ISIN-A", TrdID: "1", TrdDate: "2025-11-20" }),
    tradeRow({ InstrumentISIN: "ISIN-A", TrdID: "2", TrdDate: "2025-11-24" }),
  ];
  const referenceRows = [
    tradeRow({ InstrumentISIN: "ISIN-A", StartDate: "2025-11-18", EndDate: "2025-11-25" }),
  ];
  const windows = contractWindowsFromReference(referenceRows, {
    exchangeDaysBetween: () => ["2025-11-18", "2025-11-19", "2025-11-20", "2025-11-21", "2025-11-24"],
  });
  const summary = summarizeInstrumentCoverage(coverageByInstrumentDay(rows), windows);
  assert.equal(summary[0].instrument, "ISIN-A");
  assert.equal(summary[0].daysWithoutTrades, 3);
  assert.equal(summary[0].density, 2 / 5);
});

test("mide la relación EndDate (último día de negociación) vs ExpiryDate por contrato", () => {
  const referenceRows = [
    tradeRow({ InstrumentISIN: "ISIN-A", StartDate: "2025-11-01", EndDate: "2025-11-21", ExpiryDate: "2025-11-25" }),
    tradeRow({ InstrumentISIN: "ISIN-B", StartDate: "2025-11-01", EndDate: "2025-11-25", ExpiryDate: "2025-11-25" }),
    tradeRow({ InstrumentISIN: "ISIN-C", StartDate: "2025-11-01", EndDate: "2025-11-28", ExpiryDate: "2025-11-25" }),
    tradeRow({ InstrumentISIN: "ISIN-D", StartDate: "2025-11-01", EndDate: "", ExpiryDate: "2025-11-25" }),
  ];
  const relation = measureReferenceExpiryRelation(referenceRows);
  assert.equal(relation.contractCount, 4);
  assert.equal(relation.withEndDate, 3);
  assert.equal(relation.withExpiryDate, 4);
  assert.equal(relation.comparable, 3);
  assert.equal(relation.endDateBeforeExpiry, 1);
  assert.equal(relation.endDateEqualsExpiry, 1);
  assert.equal(relation.endDateAfterExpiry, 1);
});
