import { test } from "node:test";
import assert from "node:assert/strict";

import {
  BROKEN_SPREAD_POLICIES,
  buildTradesMeasurement,
  detectSchemaChanges,
} from "../../src/trades-source/index.mjs";
import { deleteRow, tradeRow } from "./fixtures.mjs";

function fixtureRows() {
  return [
    tradeRow({ TrdID: "1", Tm: "2025-11-20T10:00:00Z" }),
    tradeRow({ TrdID: "1", Tm: "2025-11-20T10:00:00Z", _pull_id: "pull-b" }),
    tradeRow({ TrdID: "2", Tm: "2025-11-20T11:00:00Z", FromBrokenSpread: "true", AgrsrAct: "" }),
    tradeRow({ TrdID: "3", TrdDate: "2025-11-21", Tm: "2025-11-21T10:00:00Z" }),
    deleteRow({ TrdID: "3", TrdDate: "2025-11-21", Tm: "2025-11-21T12:00:00Z" }),
    tradeRow({ TrdID: "4", InstrumentType: "Futures Spread" }),
  ];
}

test("buildTradesMeasurement integra dedup, elegibilidad, Delete PIT, cobertura e inventario", () => {
  const measurement = buildTradesMeasurement({ rows: fixtureRows() });
  assert.equal(measurement.artifactKind, "TR-01_TRADES_MEASUREMENT");
  assert.equal(measurement.dedup.inputCount, 6);
  assert.equal(measurement.dedup.uniqueCount, 5);
  assert.equal(measurement.dedup.duplicates, 1);
  assert.equal(measurement.eligibility.eligible, 3);
  assert.equal(measurement.eligibility.eligibleUnknownAggressor, 1);
  assert.equal(measurement.brokenSpreadPolicies.exclude.eligible, 2);
  assert.equal(measurement.deleteMeasurement.deletionTimeObserved, true);
  assert.equal(measurement.coverage.length, 2);
  assert.equal(measurement.inventory.tables.length, 0);
});

test("buildTradesMeasurement calcula densidad contra el calendario esperado", () => {
  const measurement = buildTradesMeasurement({
    rows: fixtureRows(),
    expectedDays: ["2025-11-20", "2025-11-21", "2025-11-24"],
  });
  const summary = measurement.instrumentSummaries.find((entry) => entry.instrument === "ISIN-DEFAULT");
  assert.equal(summary.daysWithTrades, 2);
  // 2025-11-24 queda fuera del rango observado (20..21): no cuenta ni como
  // cobertura ni como ausencia.
  assert.equal(summary.daysWithoutTrades, 0);
  assert.equal(summary.density, 1);
});

test("la política de broken spread es un parámetro declarado de la medición", () => {
  const include = buildTradesMeasurement({ rows: fixtureRows(), brokenSpreadPolicy: BROKEN_SPREAD_POLICIES.INCLUDE });
  const exclude = buildTradesMeasurement({ rows: fixtureRows(), brokenSpreadPolicy: BROKEN_SPREAD_POLICIES.EXCLUDE });
  assert.equal(include.eligibility.eligible, 3);
  assert.equal(exclude.eligibility.eligible, 2);
});

test("detectSchemaChanges señala el día en que cambia el conjunto de columnas", () => {
  const before = { TrdDate: "2026-06-11", Px: "1" };
  const after = { TrdDate: "2026-06-12", Px: "1", NewColumn: "x" };
  const detection = detectSchemaChanges([before, after]);
  assert.equal(detection.dayCount, 2);
  assert.equal(detection.changes.length, 1);
  assert.equal(detection.changes[0].trdDate, "2026-06-12");
  assert.deepEqual(detection.changes[0].addedColumns, ["NewColumn"]);
  assert.deepEqual(detection.changes[0].removedColumns, []);
});
