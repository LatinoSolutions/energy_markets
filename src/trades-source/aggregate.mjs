// Agregación de las mediciones de TR-01 sobre filas de una fuente. Fuente:
// TRADES_MODE_PLAN.md TR-01 (inventario, comparación de fuentes, regla de trade
// elegible, Delete PIT, cobertura por instrumento y día, días sin trades,
// duplicación). Es el único lugar donde viven las reglas: el extractor de I/O
// (operations/trades/TR-01/extract-trades-rows.py) sólo emite filas; este módulo
// las mide. Todo es day-local: el índice de Delete y el dedup se resuelven con
// las filas de la ventana, sin acumular la historia completa en memoria.

import { aggregateEligibility, isEligibleTrade, measureBrokenSpreadPolicies, DEFAULT_BROKEN_SPREAD_POLICY } from "./eligibility.mjs";
import { dedupTrades } from "./dedup.mjs";
import { buildDeleteIndex, measureDeleteTmSemantics } from "./delete-point-in-time.mjs";
import { buildTradesInventory } from "./inventory.mjs";
import { coverageByInstrumentDay, summarizeInstrumentCoverage } from "./coverage.mjs";

export function buildTradesMeasurement({
  rows,
  brokenSpreadPolicy = DEFAULT_BROKEN_SPREAD_POLICY,
  expectedDays = null,
}) {
  const deduped = dedupTrades(rows);
  const deleteIndex = buildDeleteIndex(deduped.rows);
  const newRows = deduped.rows.filter((row) => row?.UpdtAct !== "Delete");
  const eligibleNew = newRows.filter((row) => isEligibleTrade(row, { brokenSpreadPolicy }));
  const coverage = coverageByInstrumentDay(eligibleNew);
  const schemaChanges = detectSchemaChanges(rows);

  const measurement = {
    artifactKind: "TR-01_TRADES_MEASUREMENT",
    schemaVersion: "1.0",
    brokenSpreadPolicy,
    inventory: buildTradesInventory(deduped.rows),
    eligibility: aggregateEligibility(deduped.rows, { brokenSpreadPolicy }),
    brokenSpreadPolicies: measureBrokenSpreadPolicies(deduped.rows),
    dedup: {
      inputCount: deduped.inputCount,
      uniqueCount: deduped.uniqueCount,
      duplicates: deduped.duplicates,
      duplicateRate: deduped.inputCount === 0 ? null : deduped.duplicates / deduped.inputCount,
    },
    deleteMeasurement: measureDeleteTmSemantics(deduped.rows),
    eligibleNewCount: eligibleNew.length,
    deleteIndexSize: deleteIndex.size,
    coverage,
    schemaChanges,
  };

  if (expectedDays !== null) {
    measurement.instrumentSummaries = summarizeInstrumentCoverage(coverage, expectedDays);
  }
  return measurement;
}

// El cambio de ingesta del 2026-06-12 se detecta por el conjunto de columnas
// presentes por día: si el esquema de un día difiere del día anterior, se
// reporta. Fuente: TRADES_MODE_PLAN.md TR-01 ("cambio de ingesta del
// 2026-06-12"). No afirma la causa: sólo señala los días donde el esquema cambió.
export function detectSchemaChanges(rows) {
  const columnsByDay = new Map();
  for (const row of rows) {
    const day = row?.TrdDate ?? "";
    if (!columnsByDay.has(day)) columnsByDay.set(day, new Set());
    const set = columnsByDay.get(day);
    for (const key of Object.keys(row)) set.add(key);
  }
  const days = [...columnsByDay.keys()].sort();
  const changes = [];
  let previousSignature = null;
  let previousColumns = null;
  for (const day of days) {
    const currentColumns = columnsByDay.get(day);
    const signature = [...currentColumns].sort().join(",");
    if (previousSignature !== null && signature !== previousSignature) {
      changes.push({
        trdDate: day,
        addedColumns: [...currentColumns].filter((name) => !previousColumns.has(name)).sort(),
        removedColumns: [...previousColumns].filter((name) => !currentColumns.has(name)).sort(),
      });
    }
    previousSignature = signature;
    previousColumns = currentColumns;
  }
  return { dayCount: days.length, changes };
}
