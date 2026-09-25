// Calendario de negociación de Power DE (TR-01). Fuente: EEX Holiday Calendar
// (Derivatives + Emissions Spot), columna Power (PDF oficial enlazado en
// src/trades-source/power-calendar.mjs). Genera el artefacto versionado y su
// manifest. Uso: node build-power-de-calendar.mjs [--check]

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

import {
  POWER_DE_CALENDAR_SOURCE,
  powerDeExchangeDays,
  powerDeHolidays,
} from "../../../src/trades-source/index.mjs";

const HERE = new URL("./", import.meta.url).pathname;
const ARTIFACT = `${HERE}power-de-exchange-calendar.json`;
const MANIFEST = `${HERE}power-de-exchange-calendar.MANIFEST.json`;
const YEARS = [2020, 2021, 2022, 2023, 2024, 2025, 2026];

const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");

export function buildCalendarArtifact() {
  const holidaysByYear = {};
  const exchangeDays = [];
  for (const year of YEARS) {
    holidaysByYear[year] = powerDeHolidays(year);
    exchangeDays.push(...powerDeExchangeDays(year));
  }
  return {
    artifactKind: "TR-01_POWER_DE_EXCHANGE_CALENDAR",
    schemaVersion: "1.0",
    market: "POWER/DE",
    source: POWER_DE_CALENDAR_SOURCE,
    method: "Días hábiles Mon-Fri menos los festivos de la columna Power del PDF oficial (regla continua). Pascua por algoritmo Gregoriano anónimo.",
    years: YEARS,
    holidaysByYear,
    exchangeDayCount: exchangeDays.length,
    exchangeDays,
  };
}

export function buildCalendarManifest({ artifact, artifactSha256 }) {
  return {
    artifactKind: "TR-01_POWER_DE_EXCHANGE_CALENDAR_MANIFEST",
    schemaVersion: "1.0",
    artifact: { path: "operations/trades/TR-01/power-de-exchange-calendar.json", sha256: artifactSha256 },
    source: artifact.source,
    years: artifact.years,
    exchangeDayCount: artifact.exchangeDayCount,
  };
}

function main() {
  const artifact = buildCalendarArtifact();
  const artifactBytes = Buffer.from(`${JSON.stringify(artifact, null, 2)}\n`);
  const artifactSha256 = digest(artifactBytes);
  const manifestBytes = Buffer.from(`${JSON.stringify(buildCalendarManifest({ artifact, artifactSha256 }), null, 2)}\n`);
  if (process.argv.includes("--check")) {
    if (!artifactBytes.equals(readFileSync(ARTIFACT)) || !manifestBytes.equals(readFileSync(MANIFEST))) {
      throw new Error("El calendario Power DE no es reproducible.");
    }
    console.log(`TR-01 Power DE calendar reproducible (${artifact.exchangeDayCount} Exchange Days)`);
    return;
  }
  writeFileSync(ARTIFACT, artifactBytes);
  writeFileSync(MANIFEST, manifestBytes);
  console.log(`TR-01 Power DE calendar: ${artifact.exchangeDayCount} Exchange Days 2020-2026`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
