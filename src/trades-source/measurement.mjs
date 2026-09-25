// Acumulador day-local de la medición de TR-01. Fuente: TRADES_MODE_PLAN.md
// TR-01 (inventario, comparación de fuentes, regla de trade elegible, Delete PIT,
// cobertura por instrumento y día, días sin trades, duplicación, "pico de RAM
// medido") y OWNER_PATCH_TRADES_MODE_2026-09-25.md §3.
//
// El agregador de escaneo NO acumula la historia completa en memoria: consume
// las filas en orden de `TrdDate` y cierra cada día antes de pasar al siguiente.
// Todas las mediciones son asociativas entre días (el dedup, el índice Delete y
// la cobertura son day-local porque la identidad incluye TrdDate), así que el
// resultado es idéntico al de cargar todo de una vez. `addRows` acepta lotes de
// cualquier tamaño siempre que los días vengan en orden no decreciente; si un
// día reaparece fuera de orden, falla en vez de producir una medición sesgada.

import {
  DEFAULT_BROKEN_SPREAD_POLICY,
  aggregateEligibility,
  isEligibleTrade,
  measureBrokenSpreadPolicies,
} from "./eligibility.mjs";
import { dedupTrades } from "./dedup.mjs";
import { buildDeleteIndex, measureDeleteTmSemantics } from "./delete-point-in-time.mjs";
import { buildTradesInventory } from "./inventory.mjs";
import { coverageByInstrumentDay, summarizeInstrumentCoverage } from "./coverage.mjs";
import { measurePatch0FromCoverage } from "./patch0-density.mjs";

const ELIGIBILITY_TOTAL_KEYS = [
  "total",
  "eligible",
  "eligibleBrokenSpread",
  "eligibleNotBrokenSpread",
  "eligibleUnknownAggressor",
  "excluded",
];

function emptyDeleteMeasurement() {
  return {
    deleteRows: 0,
    deletesWithNewSibling: 0,
    deleteAfterNew: 0,
    deleteEqualNew: 0,
    deleteBeforeNew: 0,
    deleteUnparsableTm: 0,
    newWithoutDelete: 0,
    pairs: [],
  };
}

function sumInto(target, key, value) {
  target[key] = (target[key] ?? 0) + value;
}

export function createTradesMeasurementAccumulator({
  brokenSpreadPolicy = DEFAULT_BROKEN_SPREAD_POLICY,
  expected = null,
  densityCalendars = null,
  patch0MaxDistanceMonths = Infinity,
  referenceRows = null,
  referenceArea = null,
} = {}) {
  const eligibility = aggregateEligibility([]);
  const brokenSpreadPolicies = {
    include: aggregateEligibility([]),
    exclude: aggregateEligibility([]),
  };
  const duplicateCounts = {};
  const inventory = {
    rowCount: 0,
    tables: new Set(),
    commodities: new Set(),
    areas: new Set(),
    instruments: new Set(),
    dates: new Set(),
    byCommodityArea: new Map(),
  };
  const deleteMeasurement = emptyDeleteMeasurement();
  const coverage = [];
  const schema = { dayCount: 0, changes: [], previousSignature: null, previousColumns: null };

  let dedupInput = 0;
  let dedupUnique = 0;
  let dedupDuplicates = 0;
  let eligibleNewCount = 0;
  let deleteIndexSize = 0;
  let deleteIndexUnparsableTm = 0;

  let currentDay = null;
  let pending = [];

  function mergeEligibility(target, source) {
    for (const key of ELIGIBILITY_TOTAL_KEYS) sumInto(target, key, source[key] ?? 0);
    for (const [key, value] of Object.entries(source.reasonCounts ?? {})) sumInto(target.reasonCounts, key, value);
    for (const [key, value] of Object.entries(source.byAggressor ?? {})) sumInto(target.byAggressor, key, value);
  }

  function mergeInventory(snapshot) {
    inventory.rowCount += snapshot.rowCount;
    for (const table of snapshot.tables) inventory.tables.add(table);
    for (const commodity of snapshot.commodities) inventory.commodities.add(commodity);
    for (const area of snapshot.areas) inventory.areas.add(area);
    for (const instrument of snapshot.instruments) inventory.instruments.add(instrument);
    for (const [key, count] of Object.entries(snapshot.byCommodityArea)) {
      inventory.byCommodityArea.set(key, (inventory.byCommodityArea.get(key) ?? 0) + count);
    }
  }

  function flushDay(day, rows) {
    const deduped = dedupTrades(rows);
    dedupInput += deduped.inputCount;
    dedupUnique += deduped.uniqueCount;
    dedupDuplicates += deduped.duplicates;
    for (const [key, count] of Object.entries(deduped.duplicateCounts)) sumInto(duplicateCounts, key, count);

    const deleteIndexStats = {};
    const deleteIndex = buildDeleteIndex(deduped.rows, deleteIndexStats);
    deleteIndexSize += deleteIndex.size;
    deleteIndexUnparsableTm += deleteIndexStats.unparsableDeleteTm ?? 0;

    const newRows = deduped.rows.filter((row) => row?.UpdtAct !== "Delete");
    const eligibleNew = newRows.filter((row) => isEligibleTrade(row, { brokenSpreadPolicy }));
    eligibleNewCount += eligibleNew.length;
    for (const record of coverageByInstrumentDay(eligibleNew)) coverage.push(record);

    mergeEligibility(eligibility, aggregateEligibility(deduped.rows, { brokenSpreadPolicy }));
    const policies = measureBrokenSpreadPolicies(deduped.rows);
    mergeEligibility(brokenSpreadPolicies.include, policies.include);
    mergeEligibility(brokenSpreadPolicies.exclude, policies.exclude);

    const deleteSnapshot = measureDeleteTmSemantics(deduped.rows);
    for (const key of Object.keys(deleteMeasurement)) {
      if (key === "pairs") continue;
      sumInto(deleteMeasurement, key, deleteSnapshot[key] ?? 0);
    }
    deleteMeasurement.pairs.push(...deleteSnapshot.pairs);

    mergeInventory(buildTradesInventory(deduped.rows));
    if (day) inventory.dates.add(day);

    const columns = new Set();
    for (const row of rows) for (const key of Object.keys(row)) columns.add(key);
    const signature = [...columns].sort().join(",");
    if (schema.previousSignature !== null && signature !== schema.previousSignature) {
      schema.changes.push({
        trdDate: day,
        addedColumns: [...columns].filter((name) => !schema.previousColumns.has(name)).sort(),
        removedColumns: [...schema.previousColumns].filter((name) => !columns.has(name)).sort(),
      });
    }
    schema.previousSignature = signature;
    schema.previousColumns = columns;
    schema.dayCount += 1;
  }

  function addRows(rows) {
    for (const row of rows) {
      const day = row?.TrdDate ?? "";
      if (currentDay !== null && day !== currentDay) {
        if (day < currentDay) {
          throw new Error(`NDJSON fuera de orden por TrdDate: ${day} después de ${currentDay}`);
        }
        flushDay(currentDay, pending);
        pending = [];
      }
      currentDay = day;
      pending.push(row);
    }
  }

  function finish() {
    if (pending.length > 0 || (currentDay !== null && schema.dayCount === 0)) {
      flushDay(currentDay, pending);
      pending = [];
    }
    deleteMeasurement.deletionTimeObserved =
      deleteMeasurement.deletesWithNewSibling > 0 && deleteMeasurement.deleteBeforeNew === 0;

    const sortedDates = [...inventory.dates].sort();
    const measurement = {
      artifactKind: "TR-01_TRADES_MEASUREMENT",
      schemaVersion: "1.0",
      brokenSpreadPolicy,
      inventory: {
        sourceLabel: null,
        rowCount: inventory.rowCount,
        tables: [...inventory.tables].sort(),
        commodities: [...inventory.commodities].sort(),
        areas: [...inventory.areas].sort(),
        instrumentCount: inventory.instruments.size,
        instruments: [...inventory.instruments].sort(),
        dateMin: sortedDates[0] ?? null,
        dateMax: sortedDates[sortedDates.length - 1] ?? null,
        dateCount: sortedDates.length,
        byCommodityArea: Object.fromEntries([...inventory.byCommodityArea.entries()].sort()),
      },
      eligibility,
      brokenSpreadPolicies,
      dedup: {
        inputCount: dedupInput,
        uniqueCount: dedupUnique,
        duplicates: dedupDuplicates,
        duplicateRate: dedupInput === 0 ? null : dedupDuplicates / dedupInput,
      },
      deleteMeasurement,
      eligibleNewCount,
      deleteIndexSize,
      deleteIndexUnparsableTm,
      coverage,
      schemaChanges: { dayCount: schema.dayCount, changes: schema.changes },
    };

    if (expected !== null && expected !== undefined) {
      measurement.instrumentSummaries = summarizeInstrumentCoverage(coverage, expected);
    }
    if (densityCalendars !== null && densityCalendars !== undefined) {
      measurement.patch0Density = measurePatch0FromCoverage({
        coverageRecords: coverage,
        calendars: densityCalendars,
        referenceRows,
        referenceArea,
        maxDistanceMonths: patch0MaxDistanceMonths,
      });
    }
    return measurement;
  }

  return { addRows, finish };
}

// Carga completa (referencia y tests): ordena por día y delega en el mismo
// acumulador. El resultado es idéntico al del agregador day-local.
export function buildTradesMeasurement({
  rows,
  brokenSpreadPolicy = DEFAULT_BROKEN_SPREAD_POLICY,
  expected = null,
  expectedDays = undefined,
  densityCalendars = null,
  patch0MaxDistanceMonths = Infinity,
  referenceRows = null,
  referenceArea = null,
}) {
  const accumulator = createTradesMeasurementAccumulator({
    brokenSpreadPolicy,
    expected: expectedDays !== undefined ? expectedDays : expected,
    densityCalendars,
    patch0MaxDistanceMonths,
    referenceRows,
    referenceArea,
  });
  const sorted = rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) => {
      const left = a.row?.TrdDate ?? "";
      const right = b.row?.TrdDate ?? "";
      if (left < right) return -1;
      if (left > right) return 1;
      return a.index - b.index;
    })
    .map((entry) => entry.row);
  accumulator.addRows(sorted);
  return accumulator.finish();
}
