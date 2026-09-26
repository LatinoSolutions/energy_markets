// Productor de SOURCE_PERIOD_COVERAGE (DATA-02). Fuente: PLAN_STATUS.md DATA-02
// (Bru, 2026-09-26) y OWNER_PATCH_TRADES_MODE_2026-09-25.md §3.4 y §4.
//
// Mide, para cada campaign del zone plan de TR-02 y para cada fuente por
// separado, los días de su ventana con partición de trades y de TOB y, donde
// existe la medición de TR-01, los días con trade elegible del contrato. No elige
// fuente: la decisión queda PENDING_OWNER_DECISION para Bru.
//
// Uso: node build-source-period-coverage.mjs [--check]

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

import {
  PERIOD_COVERAGE_VERSION,
  indexArchivePartitions,
  indexLakePartitions,
  measureSourcePeriodCoverage,
} from "../../../src/trades-source/period-coverage.mjs";

export const INPUT_PATHS = Object.freeze({
  sourcePartitions: "operations/trades/DATA-02/source-partitions.json",
  zonePlan: "operations/trades/TR-02/trades-zone-plan.json",
  gasExchangeCalendar: "operations/audit/IMP-09/eex-exchange-calendar.json",
  powerExchangeCalendar: "operations/trades/TR-01/power-de-exchange-calendar.json",
  tr01Decision: "operations/trades/TR-01/DATA_SOURCE_DECISION.json",
  archiveMeasurementGas: "operations/trades/TR-01/TRADES_MEASUREMENT-gas-the.json",
  archiveMeasurementPower: "operations/trades/TR-01/TRADES_MEASUREMENT-power-de.json",
});
const ARTIFACT_PATH = "operations/trades/DATA-02/SOURCE_PERIOD_COVERAGE.json";
const MANIFEST_PATH = "operations/trades/DATA-02/SOURCE_PERIOD_COVERAGE.MANIFEST.json";
const PRODUCER_PATHS = Object.freeze([
  "operations/trades/DATA-02/build-source-period-coverage.mjs",
  "src/trades-source/period-coverage.mjs",
]);

// El lago no tiene TRADES_MEASUREMENT: el escaneo de trades elegibles es un job
// (TRADES_MODE_PLAN.md: los agentes no corren escaneos completos).
const LAKE_ELIGIBLE_PENDING = "Sin TRADES_MEASUREMENT del lago. Job pendiente: operations/trades/TR-01/extract-trades-rows.py --source lake --area cmdty=NATGAS/area=THE (y cmdty=POWER/area=DE) + aggregate-trades-rows.mjs, por la ruta de jobs de DATA-01.";

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

function sourceRange(decision, sourceId) {
  const inventory = decision.candidates?.find((candidate) => candidate.id === sourceId)?.inventory;
  if (!inventory?.dateMin || !inventory?.dateMax) {
    throw new Error(`DATA_SOURCE_DECISION no declara dateMin/dateMax de ${sourceId}; sin rango no se distingue hueco de fin de fuente.`);
  }
  return { from: inventory.dateMin, to: inventory.dateMax };
}

// La cobertura elegible del archivo sólo vale si la medición de TR-01 salió del
// mismo archivo que la decisión declara verificado.
function requireArchiveMeasurement(measurement, decision, path) {
  const archive = decision.candidates?.find((candidate) => candidate.id === "CLIENT_SEALED_ARCHIVE");
  const measuredSha = measurement?.sourceMeta?.archiveVerification?.sha256 ?? null;
  if (measurement?.sourceMeta?.source !== "archive" || measuredSha === null || measuredSha !== archive?.sha256) {
    throw new Error(`${path} no es una medición del archivo sellado declarado en DATA_SOURCE_DECISION.`);
  }
  return measurement.coverage;
}

export function buildSourcePeriodCoverage(inputs) {
  const { sourcePartitions, zonePlan, gasExchangeCalendar, powerExchangeCalendar, tr01Decision, archiveMeasurementGas, archiveMeasurementPower } = inputs;
  const archivePartitions = sourcePartitions.sources.CLIENT_SEALED_ARCHIVE.partitions;
  const measurement = measureSourcePeriodCoverage({
    zonePlan,
    exchangeDays: { GAS_THE: gasExchangeCalendar.exchangeDays, POWER_DE: powerExchangeCalendar.exchangeDays },
    sources: {
      CLIENT_SEALED_ARCHIVE: {
        range: sourceRange(tr01Decision, "CLIENT_SEALED_ARCHIVE"),
        partitions: archivePartitions,
        eligibleCoverage: {
          GAS_THE: requireArchiveMeasurement(archiveMeasurementGas, tr01Decision, INPUT_PATHS.archiveMeasurementGas),
          POWER_DE: requireArchiveMeasurement(archiveMeasurementPower, tr01Decision, INPUT_PATHS.archiveMeasurementPower),
        },
      },
      EEX_LAKE: {
        range: sourceRange(tr01Decision, "EEX_LAKE"),
        partitions: indexLakePartitions(sourcePartitions.sources.EEX_LAKE.listing),
        eligibleCoverage: { GAS_THE: null, POWER_DE: null },
        eligiblePendingReason: LAKE_ELIGIBLE_PENDING,
      },
    },
  });

  return {
    artifactKind: "DATA-02_SOURCE_PERIOD_COVERAGE",
    schemaVersion: "1.0",
    version: PERIOD_COVERAGE_VERSION,
    spec: "PLAN_STATUS.md DATA-02; OWNER_PATCH_TRADES_MODE_2026-09-25.md §3.4, §4",
    method: {
      tradePartitions: "Exchange Days de la ventana de la campaign con partición eex_derivative_trade del área de la misión. SEALED = sólo pulls sellados; PRESENT_WITH_EXCLUDED_PULLS = hay pulls sellados y otros excluidos por el cliente (el listado no prueba que el día esté completo); EXCLUDED_BY_CLIENT = todos los pulls del día excluidos; OUT_OF_SOURCE_RANGE = fuera del rango dateMin..dateMax de la fuente.",
      eligibleTrades: "Días de la ventana con al menos un trade elegible del contrato de la campaign (ShortCode|YYYYMM), desde el campo coverage de TRADES_MEASUREMENT de TR-01.",
      tobPartitions: "Igual que tradePartitions sobre eex_derivative_top_of_book; required sólo en PUENTE (patch 03 §4).",
      calendar: "La ventana sale del calendario de la misión y del mercado (patch 03 §3.4), nunca de la presencia de data.",
      noMixing: "Cada fuente se mide por separado; ningún campo combina fuentes.",
    },
    tr01Comparison: {
      decisionStatus: tr01Decision.status,
      selectedSource: tr01Decision.selectedSource,
      comparisonDifferences: tr01Decision.comparison?.differences ?? null,
      comparisonScope: "compareSourceInventories (src/trades-source/source-decision.mjs) compara sólo dateMax y la presencia de eex_derivative_reference; no mide días por período. Las TRADES_MEASUREMENT de TR-01 llevan calendarWindow 2025-08-12..2026-07-28 (puente).",
      periodDifferencesFoundHere: measurement.differences.length,
    },
    ownerDecision: {
      status: "PENDING_OWNER_DECISION",
      decidedBy: null,
      selectedSource: null,
      mixing: "NONE: ninguna fuente se completa con la otra sin una decisión explícita de Bru, versionada y visible por campaign.",
      blocks: ["FIX-03"],
      options: [
        { id: "CLIENT_SEALED_ARCHIVE_ONLY", consequence: "Ver summary.*.*.CLIENT_SEALED_ARCHIVE: campaigns sin trades quedan DATA_INCOMPLETE (patch 03 §3.4)." },
        { id: "EEX_LAKE_ONLY", consequence: "Ver summary.*.*.EEX_LAKE: el lago acaba en su dateMax (post-puente OUT_OF_SOURCE_RANGE) y no trae eex_derivative_reference; su cobertura de trades elegibles sigue NOT_MEASURED." },
        { id: "DECLARED_PER_PERIOD", consequence: "Fuente distinta por período, declarada y versionada; exige que cada artefacto downstream registre la fuente por campaign." },
      ],
    },
    summary: measurement.summary,
    differences: measurement.differences,
    campaigns: measurement.campaigns,
  };
}

function readInputs() {
  const bytes = {};
  const parsed = {};
  for (const [name, path] of Object.entries(INPUT_PATHS)) {
    bytes[name] = readFileSync(path);
    parsed[name] = JSON.parse(bytes[name].toString("utf8"));
  }
  return { bytes, parsed };
}

export function buildArtifacts({ bytes, parsed }) {
  const artifact = buildSourcePeriodCoverage(parsed);
  const artifactBytes = Buffer.from(`${JSON.stringify(artifact, null, 1)}\n`);
  const manifest = {
    artifactKind: "DATA-02_SOURCE_PERIOD_COVERAGE_MANIFEST",
    schemaVersion: "1.0",
    artifact: { path: ARTIFACT_PATH, sha256: sha256(artifactBytes) },
    inputs: Object.fromEntries(Object.entries(INPUT_PATHS).map(([name, path]) => [name, { path, sha256: sha256(bytes[name]) }])),
    producer: PRODUCER_PATHS.map((path) => ({ path, sha256: sha256(readFileSync(path)) })),
    ownerDecision: artifact.ownerDecision.status,
  };
  return { artifact, artifactBytes, manifestBytes: Buffer.from(`${JSON.stringify(manifest, null, 1)}\n`) };
}

function main() {
  const { artifact, artifactBytes, manifestBytes } = buildArtifacts(readInputs());
  if (process.argv.includes("--check")) {
    if (!readFileSync(ARTIFACT_PATH).equals(artifactBytes) || !readFileSync(MANIFEST_PATH).equals(manifestBytes)) {
      throw new Error("SOURCE_PERIOD_COVERAGE no es reproducible desde sus inputs.");
    }
    console.log("DATA-02 SOURCE_PERIOD_COVERAGE reproducible");
    return;
  }
  writeFileSync(ARTIFACT_PATH, artifactBytes);
  writeFileSync(MANIFEST_PATH, manifestBytes);
  console.log(`DATA-02 SOURCE_PERIOD_COVERAGE campaigns=${artifact.campaigns.length} differences=${artifact.differences.length} ownerDecision=${artifact.ownerDecision.status}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
