// Deduplicación de trades entre pulls del lago y entre el lago y el archivo del
// cliente. Fuente: OWNER_PATCH_TRADES_MODE_2026-09-25.md §3.1 "Deduplicación
// entre pulls con clave declarada en TR-01".
//
// Regla declarada: dos filas representan la misma observación de mercado si
// coinciden TODAS sus columnas de mercado (las que no empiezan con `_`). Las
// columnas `_` (provenance de la ingesta: `_pull_id`, `_retrieved_at_utc`,
// `_row_sha256`, etc.) cambian entre pulls y no identifican el trade; `_row_sha256`
// en particular difiere para la misma observación en otro pull. Es la misma
// convención que IMP-05 v2 y BT-01 v2 (observationKey = sha256 de todas las
// columnas de mercado, no `_`).
//
// Medición de TR-01 (2025-11-20, NATGAS/THE, dos pulls): 353 filas por pull,
// 353 claves únicas por pull, intersección 353 → los dos pulls son la misma
// observación duplicada. TrdID NO es único por pull (341 únicos de 353): un
// spread comparte TrdID entre sus patas, por eso la clave es el contenido
// completo y no TrdID solo.

import { createHash } from "node:crypto";

const isMarketColumn = (name) => !name.startsWith("_");

export function marketColumns(row) {
  return Object.keys(row)
    .filter(isMarketColumn)
    .sort()
    .map((name) => [name, row[name] ?? null]);
}

export function tradeObservationKey(row) {
  const payload = JSON.stringify(marketColumns(row));
  return createHash("sha256").update(payload).digest("hex");
}

export function dedupKey(row, { source = null } = {}) {
  const resolvedSource = source ?? row?._source ?? row?.source ?? null;
  return `${resolvedSource ?? ""}|${tradeObservationKey(row)}`;
}

// Deduplica preservando el orden de lectura determinista (se ordena por clave
// de contenido antes de quedarse con la primera aparición). Devuelve las filas
// únicas y el conteo de duplicados por clave.
export function dedupTrades(rows, { source = null } = {}) {
  const sorted = rows
    .map((row, index) => ({ row, index, key: dedupKey(row, { source }) }))
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : a.index - b.index));
  const unique = [];
  const duplicateCounts = {};
  const seen = new Set();
  for (const entry of sorted) {
    if (seen.has(entry.key)) {
      duplicateCounts[entry.key] = (duplicateCounts[entry.key] ?? 0) + 1;
      continue;
    }
    seen.add(entry.key);
    unique.push(entry.row);
  }
  return {
    rows: unique,
    duplicateCounts,
    duplicates: Object.values(duplicateCounts).reduce((sum, count) => sum + count, 0),
    uniqueCount: unique.length,
    inputCount: rows.length,
  };
}
