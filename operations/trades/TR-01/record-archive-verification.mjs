// DATA-01: registra en `source-candidates.json` la verificación del archivo
// sellado que dejó el escaneo de TR-01, para que la decisión de fuente pueda
// cerrarse. Es I/O: lee el `_meta` (inventario + verificación) de los NDJSON que
// emite `extract-trades-rows.py --source archive` y actualiza el candidato
// CLIENT_SEALED_ARCHIVE. No decide nada: `build-trades-source-decision.mjs`
// corre después y aplica las reglas de src/trades-source/source-decision.mjs.
//
// Uso:
//   node record-archive-verification.mjs --gas-rows <ndjson> --power-rows <ndjson> \
//     --archive <path> --sha256 <hex> --bytes <n> [--candidates <path>]

import { createReadStream, readFileSync, writeFileSync } from "node:fs";
import readline from "node:readline";
import { pathToFileURL } from "node:url";

const CANDIDATES = "operations/trades/TR-01/source-candidates.json";

function argument(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index === -1 ? fallback : process.argv[index + 1];
}

// El `_meta` del archivo va al final del NDJSON (el inventario recién se conoce
// al terminar); se recorre en streaming y sólo se conserva la última `_meta`.
export async function readMeta(path) {
  const lines = readline.createInterface({ input: createReadStream(path), crlfDelay: Infinity });
  let meta = null;
  for await (const line of lines) {
    if (line.trim() === "") continue;
    const parsed = JSON.parse(line);
    if (parsed._meta) meta = parsed._meta;
  }
  return meta;
}

// Une el inventario de los dos mercados: unión de tablas, extremos de fecha.
export function mergeArchiveInventory(metas) {
  const tables = new Set();
  const tableInventory = {};
  let dateMin = null;
  let dateMax = null;
  for (const meta of metas) {
    for (const [table, counts] of Object.entries(meta?.tableInventory ?? {})) {
      tables.add(table);
      const previous = tableInventory[table] ?? { members: 0, rows: 0 };
      tableInventory[table] = { members: previous.members + (counts.members ?? 0), rows: previous.rows + (counts.rows ?? 0) };
    }
    if (meta?.dateMin && (dateMin === null || meta.dateMin < dateMin)) dateMin = meta.dateMin;
    if (meta?.dateMax && (dateMax === null || meta.dateMax > dateMax)) dateMax = meta.dateMax;
  }
  return { sourceLabel: "CLIENT_SEALED_ARCHIVE", tables: [...tables].sort(), tableInventory, dateMin, dateMax };
}

export function applyArchiveVerification(candidatesDocument, { inventory, archivePath, sha256, bytes }) {
  const candidates = candidatesDocument.candidates.map((candidate) => {
    if (candidate.id !== "CLIENT_SEALED_ARCHIVE") return candidate;
    return {
      ...candidate,
      path: archivePath,
      present: true,
      sha256,
      sha256Verified: true,
      observedBytes: bytes,
      inventory,
      verification: `SHA-256 y tamaño verificados por el escaneo de TR-01 (DATA-01), ${new Date().toISOString()}`,
    };
  });
  return { ...candidatesDocument, candidates };
}

async function main() {
  const gasRows = argument("--gas-rows");
  const powerRows = argument("--power-rows");
  const archivePath = argument("--archive");
  const sha256 = argument("--sha256");
  const bytes = Number.parseInt(argument("--bytes"), 10);
  const candidatesPath = argument("--candidates", CANDIDATES);
  for (const [flag, value] of Object.entries({ "--gas-rows": gasRows, "--power-rows": powerRows, "--archive": archivePath, "--sha256": sha256 })) {
    if (!value) throw new Error(`Falta ${flag}.`);
  }
  if (!Number.isInteger(bytes)) throw new Error("--bytes debe ser un entero.");

  const [gasMeta, powerMeta] = await Promise.all([readMeta(gasRows), readMeta(powerRows)]);
  const inventory = mergeArchiveInventory([gasMeta, powerMeta]);
  const document = JSON.parse(readFileSync(candidatesPath, "utf8"));
  const updated = applyArchiveVerification(document, { inventory, archivePath, sha256, bytes });
  writeFileSync(candidatesPath, `${JSON.stringify(updated, null, 2)}\n`);
  console.log(`TR-01 archive verification: tables=${inventory.tables.join(",")} dateMin=${inventory.dateMin} dateMax=${inventory.dateMax}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
