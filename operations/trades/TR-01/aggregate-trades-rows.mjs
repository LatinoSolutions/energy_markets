// Agregador del job de escaneo de TR-01. Lee el NDJSON que emite
// extract-trades-rows.py (o una fixture) y produce TRADES_MEASUREMENT.json +
// manifest. Las reglas viven en src/trades-source (única fuente de verdad); este
// script sólo hace I/O.
//
// El escaneo es day-local: lee el NDJSON línea por línea y cierra cada día antes
// de seguir, sin cargar la historia completa en memoria (TRADES_MODE_PLAN.md
// TR-01: "pico de RAM medido"). El acumulador vive en
// src/trades-source/measurement.mjs.
//
// Uso: node aggregate-trades-rows.mjs --in rows.ndjson --out TRADES_MEASUREMENT.json
//      [--check] [--market power-de|gas-the] [--reference reference.ndjson]
//      [--start YYYY-MM-DD --end YYYY-MM-DD]

import { createHash } from "node:crypto";
import { createReadStream, readFileSync, writeFileSync } from "node:fs";
import readline from "node:readline";
import { pathToFileURL } from "node:url";

import {
  DEFAULT_BROKEN_SPREAD_POLICY,
  MISSION,
  contractWindowsFromReference,
  createTradesMeasurementAccumulator,
  gasTheExchangeDaysBetween,
  measurePatch0FromCoverage,
  measureReferenceExpiryRelation,
  powerDeExchangeDaysBetween,
  summarizeInstrumentCoverage,
} from "../../../src/trades-source/index.mjs";

const HERE = new URL("./", import.meta.url).pathname;

// Área hive del mercado: rellena Cmdty/Area de las filas de reference cuando la
// tabla no los repite como columna (el escaneo ya filtró por esa área exacta).
const MARKET_AREAS = Object.freeze({
  "gas-the": { cmdty: "NATGAS", area: "THE" },
  "power-de": { cmdty: "POWER", area: "DE" },
});

// API de string para tests y `--check`: mismo acumulador day-local, entrando una
// fila por vez (el acumulador cierra el día cuando cambia TrdDate).
export function aggregateNdjson(text, { brokenSpreadPolicy = DEFAULT_BROKEN_SPREAD_POLICY, expectedDays, expected, densityCalendars, patch0MaxDistanceMonths = Infinity } = {}) {
  const accumulator = createTradesMeasurementAccumulator({
    brokenSpreadPolicy,
    expected: expectedDays !== undefined ? expectedDays : expected,
    densityCalendars,
    patch0MaxDistanceMonths,
  });
  let meta = null;
  for (const line of text.split("\n")) {
    if (line.trim() === "") continue;
    const parsed = JSON.parse(line);
    if (parsed._meta) {
      meta = parsed._meta;
      continue;
    }
    accumulator.addRows([parsed]);
  }
  const measurement = accumulator.finish();
  measurement.sourceMeta = meta;
  return measurement;
}

const REFERENCE_FIELDS = Object.freeze(["Cmdty", "Area", "ShortCode", "Maturity", "InstrumentISIN", "StartDate", "EndDate", "ExpiryDate"]);

// Streaming y sin filas repetidas: todos los consumidores (contract-windows.mjs,
// patch0-density.mjs) reducen por contrato con estos campos, así que el resultado
// es el mismo que con todas las filas. Una fila sin identidad se conserva tal cual.
export async function readReferenceRows(path) {
  const rows = [];
  const seen = new Set();
  const lines = readline.createInterface({ input: createReadStream(path), crlfDelay: Infinity });
  for await (const line of lines) {
    if (line.trim() === "") continue;
    const parsed = JSON.parse(line);
    if (parsed._meta) continue;
    const projected = {};
    for (const field of REFERENCE_FIELDS) {
      if (parsed[field] !== undefined && parsed[field] !== null && parsed[field] !== "") projected[field] = parsed[field];
    }
    if (projected.InstrumentISIN || projected.ShortCode || projected.Maturity) {
      const key = JSON.stringify(REFERENCE_FIELDS.map((field) => projected[field] ?? null));
      if (seen.has(key)) continue;
      seen.add(key);
    }
    rows.push(projected);
  }
  return rows;
}

function marketFromArgs() {
  const explicit = argument("--market");
  if (explicit) return explicit;
  if (process.argv.includes("--power-de")) return "power-de";
  return null;
}

// Añade las mediciones que dependen del calendario del mercado y de la tabla de
// referencia. La ventana sale del calendario (o del rango declarado con
// --start/--end), nunca de la presencia de trades.
function applyDerivedMeasurements(measurement, { market, start, end, referenceRows }) {
  if (!market) return measurement;
  const from = start ?? measurement.inventory.dateMin;
  const to = end ?? measurement.inventory.dateMax;
  if (!from || !to) return measurement;
  const isPower = market === "power-de";
  const exchangeDaysBetween = isPower ? powerDeExchangeDaysBetween : gasTheExchangeDaysBetween;
  const calendarDays = exchangeDaysBetween(from, to);
  const calendars = isPower
    ? { [MISSION.POWER_QUARTERLY]: calendarDays, [MISSION.POWER_MONTHLY]: calendarDays }
    : { [MISSION.GAS_QUARTERLY]: calendarDays, [MISSION.GAS_MONTHLY]: calendarDays };
  measurement.calendarWindow = {
    market,
    from,
    to,
    source: start && end ? "DECLARED_RANGE" : "OBSERVED_DATA_RANGE",
  };
  measurement.patch0Density = measurePatch0FromCoverage({
    coverageRecords: measurement.coverage,
    calendars,
    referenceRows,
    referenceArea: MARKET_AREAS[market] ?? null,
    maxDistanceMonths: isPower ? 3 : Infinity,
  });
  if (referenceRows) {
    const windows = contractWindowsFromReference(referenceRows, { exchangeDaysBetween });
    measurement.instrumentSummaries = summarizeInstrumentCoverage(measurement.coverage, windows);
    measurement.referenceExpiryRelation = measureReferenceExpiryRelation(referenceRows);
  }
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

// Hash del input por streaming: el archivo NDJSON puede pesar varios GB y no se
// carga entero en memoria.
function sha256FileStream(path) {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    createReadStream(path)
      .on("data", (chunk) => hash.update(chunk))
      .on("end", () => resolve(hash.digest("hex")))
      .on("error", reject);
  });
}

export async function streamMeasurement(inputPath) {
  const accumulator = createTradesMeasurementAccumulator();
  let meta = null;
  const lines = readline.createInterface({ input: createReadStream(inputPath), crlfDelay: Infinity });
  for await (const line of lines) {
    if (line.trim() === "") continue;
    const parsed = JSON.parse(line);
    if (parsed._meta) {
      meta = parsed._meta;
      continue;
    }
    accumulator.addRows([parsed]);
  }
  const measurement = accumulator.finish();
  measurement.sourceMeta = meta;
  return measurement;
}

async function main() {
  const inputPath = argument("--in");
  const outputPath = argument("--out", `${HERE}TRADES_MEASUREMENT.json`);
  if (!inputPath) throw new Error("Falta --in.");
  const inputSha256 = await sha256FileStream(inputPath);

  const market = marketFromArgs();
  const start = argument("--start");
  const end = argument("--end");
  const referencePath = argument("--reference");
  const referenceRows = referencePath ? await readReferenceRows(referencePath) : null;

  if (process.argv.includes("--check")) {
    const measurement = aggregateNdjson(readFileSync(inputPath, "utf8"));
    applyDerivedMeasurements(measurement, { market, start, end, referenceRows });
    const committed = readFileSync(outputPath);
    const artifactBytes = Buffer.from(`${JSON.stringify(measurement, null, 2)}\n`);
    if (!committed.equals(artifactBytes)) throw new Error("TRADES_MEASUREMENT no es reproducible desde el NDJSON.");
    console.log("TR-01 TRADES_MEASUREMENT reproducible");
    return;
  }

  const measurement = await streamMeasurement(inputPath);
  applyDerivedMeasurements(measurement, { market, start, end, referenceRows });

  const artifactBytes = Buffer.from(`${JSON.stringify(measurement, null, 2)}\n`);
  const artifactSha256 = createHash("sha256").update(artifactBytes).digest("hex");
  const manifestBytes = Buffer.from(`${JSON.stringify(buildManifest({ measurement, artifactSha256, inputPath, inputSha256 }), null, 2)}\n`);
  writeFileSync(outputPath, artifactBytes);
  writeFileSync(`${outputPath}.MANIFEST.json`, manifestBytes);
  console.log(`TR-01 TRADES_MEASUREMENT rows=${measurement.dedup.inputCount} eligible=${measurement.eligibility.eligible}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
