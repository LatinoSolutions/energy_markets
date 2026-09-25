// Agregador del job de escaneo de TR-01. Lee el NDJSON que emite
// extract-trades-rows.py (o una fixture) y produce TRADES_MEASUREMENT.json +
// manifest. Las reglas viven en src/trades-source (única fuente de verdad); este
// script sólo hace I/O.
//
// Uso: node aggregate-trades-rows.mjs --in rows.ndjson --out TRADES_MEASUREMENT.json
//      [--power-de] [--check]

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

import {
  DEFAULT_BROKEN_SPREAD_POLICY,
  buildTradesMeasurement,
  powerDeExchangeDaysBetween,
} from "../../../src/trades-source/index.mjs";

const HERE = new URL("./", import.meta.url).pathname;

export function aggregateNdjson(text, { brokenSpreadPolicy = DEFAULT_BROKEN_SPREAD_POLICY, expectedDays = null } = {}) {
  const rows = [];
  let meta = null;
  for (const line of text.split("\n")) {
    if (line.trim() === "") continue;
    const parsed = JSON.parse(line);
    if (parsed._meta) {
      meta = parsed._meta;
      continue;
    }
    rows.push(parsed);
  }
  const measurement = buildTradesMeasurement({ rows, brokenSpreadPolicy, expectedDays });
  measurement.sourceMeta = meta;
  return measurement;
}

function buildManifest({ measurement, artifactSha256, inputPath, inputSha256 }) {
  return {
    artifactKind: "TR-01_TRADES_MEASUREMENT_MANIFEST",
    schemaVersion: "1.0",
    producer: "operations/trades/TR-01/aggregate-trades-rows.mjs",
    artifact: { path: "operations/trades/TR-01/TRADES_MEASUREMENT.json", sha256: artifactSha256 },
    input: { path: inputPath, sha256: inputSha256 },
    counts: {
      rows: measurement.dedup.inputCount,
      unique: measurement.dedup.uniqueCount,
      eligible: measurement.eligibility.eligible,
      duplicates: measurement.dedup.duplicates,
    },
  };
}

function argument(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index === -1 ? fallback : process.argv[index + 1];
}

function main() {
  const inputPath = argument("--in");
  const outputPath = argument("--out", `${HERE}TRADES_MEASUREMENT.json`);
  if (!inputPath) throw new Error("Falta --in.");
  const inputBytes = readFileSync(inputPath);
  const inputSha256 = createHash("sha256").update(inputBytes).digest("hex");
  const meta = JSON.parse(inputBytes.toString("utf8").split("\n").find((line) => line.includes("_meta")) ?? "{}")._meta ?? null;
  let expectedDays = null;
  if (process.argv.includes("--power-de") && meta?.dateMin && meta?.dateMax) {
    expectedDays = powerDeExchangeDaysBetween(meta.dateMin, meta.dateMax);
  }
  const measurement = aggregateNdjson(inputBytes.toString("utf8"), { expectedDays });
  const artifactBytes = Buffer.from(`${JSON.stringify(measurement, null, 2)}\n`);
  const artifactSha256 = createHash("sha256").update(artifactBytes).digest("hex");
  const manifestBytes = Buffer.from(`${JSON.stringify(buildManifest({ measurement, artifactSha256, inputPath, inputSha256 }), null, 2)}\n`);
  if (process.argv.includes("--check")) {
    const committed = readFileSync(outputPath);
    if (!committed.equals(artifactBytes)) throw new Error("TRADES_MEASUREMENT no es reproducible desde el NDJSON.");
    console.log("TR-01 TRADES_MEASUREMENT reproducible");
    return;
  }
  writeFileSync(outputPath, artifactBytes);
  writeFileSync(`${outputPath}.MANIFEST.json`, manifestBytes);
  console.log(`TR-01 TRADES_MEASUREMENT rows=${measurement.dedup.inputCount} eligible=${measurement.eligibility.eligible}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
