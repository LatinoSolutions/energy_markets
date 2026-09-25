// Agregación de las mediciones de TR-01 sobre filas de una fuente. Fuente:
// TRADES_MODE_PLAN.md TR-01 (inventario, comparación de fuentes, regla de trade
// elegible, Delete PIT, cobertura por instrumento y día, días sin trades,
// duplicación, "pico de RAM medido"). Es el único lugar donde viven las reglas: el
// extractor de I/O (operations/trades/TR-01/extract-trades-rows.py) sólo emite
// filas.
//
// Las mediciones se resuelven en un acumulador day-local (measurement.mjs): el
// dedup, el índice Delete y la cobertura son day-local porque la identidad
// incluye TrdDate. El escaneo completo NO acumula la historia de filas en
// memoria; consume un día por vez. `buildTradesMeasurement` conserva la ruta de
// carga completa como referencia y para tests.

export { buildTradesMeasurement } from "./measurement.mjs";

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
