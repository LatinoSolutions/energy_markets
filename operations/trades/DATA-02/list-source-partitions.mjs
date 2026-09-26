// Inventario de particiones por día de las dos fuentes candidatas (DATA-02).
// Fuente: PLAN_STATUS.md DATA-02 (hallazgos DATA-01 del 2026-09-26 sobre
// `extraido/exclusions.jsonl`).
//
// Sólo lee nombres: `files.jsonl` y `exclusions.jsonl` del archivo extraído y
// los directorios `trd_date=` del lago. No abre ningún parquet (TRADES_MODE_PLAN.md
// "Non-negotiable semantics": nada de escaneos completos desde la Oficina).
//
// Uso: node list-source-partitions.mjs [--archive-dir DIR] [--lake-root DIR]

import { createHash } from "node:crypto";
import { createReadStream, existsSync, readdirSync, writeFileSync } from "node:fs";
import readline from "node:readline";
import { pathToFileURL } from "node:url";

import {
  MARKET_AREAS,
  PARTITION_TABLES,
  indexArchivePartitions,
  partitionKey,
} from "../../../src/trades-source/period-coverage.mjs";

const HERE = new URL("./", import.meta.url).pathname;
export const PARTITIONS_PATH = `${HERE}source-partitions.json`;
const DEFAULT_ARCHIVE_DIR = "/srv/data/eex-client-archive/extraido";
const DEFAULT_LAKE_ROOT = "/srv/hot-data/EEX";

function argument(name, fallback) {
  const index = process.argv.indexOf(name);
  return index === -1 ? fallback : process.argv[index + 1];
}

async function readJsonl(path, hash) {
  const entries = [];
  const input = createReadStream(path);
  input.on("data", (chunk) => hash.update(chunk));
  const lines = readline.createInterface({ input, crlfDelay: Infinity });
  for await (const line of lines) {
    if (line.trim() !== "") entries.push(JSON.parse(line));
  }
  return entries;
}

// Cada día del lago cuenta sus pulls (subdirectorios de `trd_date=`).
export function listLakePartitions(lakeRoot) {
  const listing = {};
  for (const table of Object.values(PARTITION_TABLES)) {
    for (const { cmdty, area } of Object.values(MARKET_AREAS)) {
      const key = partitionKey(table, cmdty, area);
      const dir = `${lakeRoot}/table=${table}/cmdty=${cmdty}/area=${area}`;
      listing[key] = {};
      if (!existsSync(dir)) continue;
      for (const name of readdirSync(dir).sort()) {
        if (!name.startsWith("trd_date=")) continue;
        listing[key][name.slice("trd_date=".length)] = readdirSync(`${dir}/${name}`).length;
      }
    }
  }
  return listing;
}

async function main() {
  const archiveDir = argument("--archive-dir", DEFAULT_ARCHIVE_DIR);
  const lakeRoot = argument("--lake-root", DEFAULT_LAKE_ROOT);
  const filesHash = createHash("sha256");
  const exclusionsHash = createHash("sha256");
  const fileEntries = await readJsonl(`${archiveDir}/files.jsonl`, filesHash);
  const exclusionEntries = await readJsonl(`${archiveDir}/exclusions.jsonl`, exclusionsHash);
  const document = {
    artifactKind: "DATA-02_SOURCE_PARTITIONS",
    schemaVersion: "1.0",
    method: "Listado de nombres de partición; no se abre ningún parquet.",
    sources: {
      CLIENT_SEALED_ARCHIVE: {
        inputs: {
          files: { path: `${archiveDir}/files.jsonl`, sha256: filesHash.digest("hex"), entries: fileEntries.length },
          exclusions: { path: `${archiveDir}/exclusions.jsonl`, sha256: exclusionsHash.digest("hex"), entries: exclusionEntries.length },
        },
        partitions: indexArchivePartitions({ fileEntries, exclusionEntries }),
      },
      EEX_LAKE: {
        inputs: { lakeRoot },
        listing: listLakePartitions(lakeRoot),
      },
    },
  };
  writeFileSync(PARTITIONS_PATH, `${JSON.stringify(document, null, 1)}\n`);
  console.log(`DATA-02 source-partitions: archive files=${fileEntries.length} exclusions=${exclusionEntries.length}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
