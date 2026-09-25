import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  BROKEN_SPREAD_POLICIES,
  MISSION,
  buildTradesMeasurement,
  createTradesMeasurementAccumulator,
  detectSchemaChanges,
} from "../../src/trades-source/index.mjs";
import { aggregateNdjson, streamMeasurement } from "../../operations/trades/TR-01/aggregate-trades-rows.mjs";
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
  // La ventana sale del calendario del contrato, no de la presencia de trades:
  // 2025-11-24 es un día esperado sin trade y sí cuenta como faltante.
  assert.equal(summary.daysWithoutTrades, 1);
  assert.equal(summary.windowDays, 3);
  assert.equal(summary.density, 2 / 3);
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

test("la agregación day-local da exactamente el mismo resultado que la carga completa", () => {
  const rows = [
    tradeRow({ TrdID: "1", TrdDate: "2025-11-20", Tm: "2025-11-20T10:00:00Z" }),
    tradeRow({ TrdID: "1", TrdDate: "2025-11-20", Tm: "2025-11-20T10:00:00Z", _pull_id: "pull-b" }),
    tradeRow({ TrdID: "2", TrdDate: "2025-11-21", Tm: "2025-11-21T10:00:00Z", FromBrokenSpread: "true", AgrsrAct: "" }),
    tradeRow({ TrdID: "3", TrdDate: "2025-11-21", Tm: "2025-11-21T11:00:00Z" }),
    tradeRow({ TrdID: "3", TrdDate: "2025-11-21", Tm: "2025-11-21T11:00:00Z", _pull_id: "pull-c" }),
    deleteRow({ TrdID: "3", TrdDate: "2025-11-21", Tm: "2025-11-21T12:00:00Z" }),
    tradeRow({ TrdID: "4", TrdDate: "2025-11-24", Tm: "2025-11-24T09:00:00Z" }),
  ];
  const text = [
    JSON.stringify({ _meta: { dateMin: "2025-11-20", dateMax: "2025-11-24" } }),
    ...rows.map((row) => JSON.stringify(row)),
  ].join("\n");
  const dayLocal = aggregateNdjson(text);
  delete dayLocal.sourceMeta;
  const fullLoad = buildTradesMeasurement({ rows });
  assert.deepEqual(dayLocal, fullLoad);
});

test("la densidad usa el catálogo del reference cuando se aporta", () => {
  const rows = [
    tradeRow({
      TrdID: "1",
      Cmdty: "POWER",
      Area: "DE",
      ShortCode: "DEBM",
      InstrumentISIN: "PWR-M-202106",
      Maturity: "202106",
      TrdDate: "2021-04-01",
      Tm: "2021-04-01T10:00:00Z",
    }),
  ];
  const referenceRows = [
    tradeRow({ Cmdty: "POWER", Area: "DE", ShortCode: "DEBM", InstrumentISIN: "PWR-M-202105", Maturity: "202105" }),
    tradeRow({ Cmdty: "POWER", Area: "DE", ShortCode: "DEBM", InstrumentISIN: "PWR-M-202106", Maturity: "202106" }),
  ];
  const measurement = buildTradesMeasurement({
    rows,
    densityCalendars: { [MISSION.POWER_MONTHLY]: ["2021-04-01"] },
    referenceRows,
  });
  assert.equal(measurement.patch0Density.length, 1);
  assert.equal(measurement.patch0Density[0].catalogSource, "REFERENCE");
  // El front 202105 no cotizó: el día cuenta como sin trades.
  assert.equal(measurement.patch0Density[0].years[0].daysWithoutTrades, 1);
});

test("el acumulador falla si un día reaparece fuera de orden", () => {
  const accumulator = createTradesMeasurementAccumulator();
  accumulator.addRows([tradeRow({ TrdDate: "2025-11-21" })]);
  assert.throws(
    () => accumulator.addRows([tradeRow({ TrdDate: "2025-11-20" })]),
    /fuera de orden/,
  );
});

test("la lectura por streaming del archivo da el mismo resultado que la carga completa", async () => {
  const rows = [
    tradeRow({ TrdID: "1", TrdDate: "2025-11-20", Tm: "2025-11-20T10:00:00Z" }),
    tradeRow({ TrdID: "1", TrdDate: "2025-11-20", Tm: "2025-11-20T10:00:00Z", _pull_id: "pull-b" }),
    tradeRow({ TrdID: "2", TrdDate: "2025-11-21", Tm: "2025-11-21T10:00:00Z", FromBrokenSpread: "true", AgrsrAct: "" }),
    deleteRow({ TrdID: "2", TrdDate: "2025-11-21", Tm: "2025-11-21T12:00:00Z" }),
    tradeRow({ TrdID: "4", TrdDate: "2025-11-24", Tm: "2025-11-24T09:00:00Z" }),
  ];
  const directory = mkdtempSync(join(tmpdir(), "tr01-"));
  const path = join(directory, "rows.ndjson");
  try {
    const body = [JSON.stringify({ _meta: { dateMin: "2025-11-20", dateMax: "2025-11-24" } }), ...rows.map((row) => JSON.stringify(row))];
    writeFileSync(path, `${body.join("\n")}\n`);
    const streamed = await streamMeasurement(path);
    const sourceMeta = streamed.sourceMeta;
    delete streamed.sourceMeta;
    assert.deepEqual(streamed, buildTradesMeasurement({ rows }));
    assert.equal(sourceMeta.dateMax, "2025-11-24");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
