// Productor de SOURCE_PERIOD_COVERAGE (DATA-02). Fuente: PLAN_STATUS.md DATA-02
// (Bru, 2026-09-26) y OWNER_PATCH_TRADES_MODE_2026-09-25.md §3.4 y §4.
//
// Mide, para cada campaign del zone plan de TR-02 y para cada fuente por
// separado, los días de su ventana con partición de trades y de TOB y, donde
// existe la medición de TR-01, los días con trade elegible del contrato. Registra
// la política PARCHE VERIFICADO de Bru sin presumir que el lago ya fue medido.
//
// Uso: node build-source-period-coverage.mjs [--check]

import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

import {
  MARKET_AREAS,
  PARTITION_TABLES,
  PERIOD_COVERAGE_VERSION,
  PATCH_COMPLETENESS_RULE,
  partitionKey,
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
  archiveMeasurementGasManifest: "operations/trades/TR-01/TRADES_MEASUREMENT-gas-the.json.MANIFEST.json",
  archiveMeasurementPower: "operations/trades/TR-01/TRADES_MEASUREMENT-power-de.json",
  archiveMeasurementPowerManifest: "operations/trades/TR-01/TRADES_MEASUREMENT-power-de.json.MANIFEST.json",
});
// Mediciones del lago: salida del job de escaneo (no lo corre un agente). Si el
// archivo no existe, la cobertura elegible del lago queda NOT_MEASURED.
export const OPTIONAL_INPUT_PATHS = Object.freeze({
  lakeMeasurementGas: "operations/trades/DATA-02/TRADES_MEASUREMENT-lake-gas-the.json",
  lakeMeasurementGasManifest: "operations/trades/DATA-02/TRADES_MEASUREMENT-lake-gas-the.json.MANIFEST.json",
  lakeMeasurementPower: "operations/trades/DATA-02/TRADES_MEASUREMENT-lake-power-de.json",
  lakeMeasurementPowerManifest: "operations/trades/DATA-02/TRADES_MEASUREMENT-lake-power-de.json.MANIFEST.json",
});
const ARTIFACT_PATH = "operations/trades/DATA-02/SOURCE_PERIOD_COVERAGE.json";
const MANIFEST_PATH = "operations/trades/DATA-02/SOURCE_PERIOD_COVERAGE.MANIFEST.json";
const PRODUCER_PATHS = Object.freeze([
  "operations/trades/DATA-02/build-source-period-coverage.mjs",
  "src/trades-source/period-coverage.mjs",
]);

// El escaneo de trades elegibles del lago es un job (TRADES_MODE_PLAN.md: los
// agentes no corren escaneos completos).
const LAKE_ELIGIBLE_PENDING = {
  GAS_THE: `Sin TRADES_MEASUREMENT del lago para cmdty=NATGAS/area=THE. Job DATA02_LAKE_SCAN pendiente: ${OPTIONAL_INPUT_PATHS.lakeMeasurementGas}`,
  POWER_DE: `Sin TRADES_MEASUREMENT del lago para cmdty=POWER/area=DE. Job DATA02_LAKE_SCAN pendiente: ${OPTIONAL_INPUT_PATHS.lakeMeasurementPower}`,
};

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
function requireArchiveMeasurement(measurementBytes, manifest, decision, path) {
  const legacyPath = "operations/trades/TR-01/TRADES_MEASUREMENT.json";
  if (!Buffer.isBuffer(measurementBytes) || manifest?.artifactKind !== "TR-01_TRADES_MEASUREMENT_MANIFEST"
    || manifest.schemaVersion !== "1.0"
    || manifest.producer !== "operations/trades/TR-01/aggregate-trades-rows.mjs"
    || ![path, legacyPath].includes(manifest.artifact?.path)
    || manifest.artifact?.sha256 !== sha256(measurementBytes)
    || typeof manifest.input?.path !== "string" || !manifest.input.path
    || !/^[0-9a-f]{64}$/.test(manifest.input?.sha256 ?? "")) {
    throw new Error(`${path} no tiene un manifest válido que vincule la medición del archivo a sus bytes.`);
  }
  const measurement = JSON.parse(measurementBytes.toString("utf8"));
  const archive = decision.candidates?.find((candidate) => candidate.id === "CLIENT_SEALED_ARCHIVE");
  const measuredSha = measurement?.sourceMeta?.archiveVerification?.sha256 ?? null;
  if (measurement?.sourceMeta?.source !== "archive" || measuredSha === null || measuredSha !== archive?.sha256) {
    throw new Error(`${path} no es una medición del archivo sellado declarado en DATA_SOURCE_DECISION.`);
  }
  return measurement.coverage;
}

// La cobertura elegible del lago sólo vale si la medición salió del mismo lago y
// área que el listado de particiones y si el escaneo recorrió todos sus días: un
// escaneo recortado (--start/--end/--max-days) haría pasar días no leídos por
// días sin trades.
function requireLakeMeasurement(measurementBytes, manifest, lake, market, path) {
  if (measurementBytes === null && manifest === null) return null;
  if (measurementBytes === null || manifest === null || !Buffer.isBuffer(measurementBytes)) {
    throw new Error(`${path} requiere medición y manifest del productor juntos.`);
  }
  const validHash = (value) => typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
  if (manifest.artifactKind !== "TR-01_TRADES_MEASUREMENT_MANIFEST"
    || manifest.schemaVersion !== "1.0"
    || manifest.producer !== "operations/trades/TR-01/aggregate-trades-rows.mjs"
    || manifest.artifact?.path !== path
    || manifest.artifact?.sha256 !== sha256(measurementBytes)
    || typeof manifest.input?.path !== "string" || !manifest.input.path
    || !validHash(manifest.input?.sha256)) {
    throw new Error(`${path} no tiene un manifest válido que vincule la medición al escaneo.`);
  }
  const measurement = JSON.parse(measurementBytes.toString("utf8"));
  const meta = measurement?.sourceMeta ?? {};
  const { cmdty, area } = MARKET_AREAS[market];
  const listedDays = Object.keys(lake.listing[partitionKey(PARTITION_TABLES.TRADES, cmdty, area)] ?? {}).sort();
  const sameSource = meta.source === "lake"
    && meta.table === PARTITION_TABLES.TRADES
    && meta.area === `cmdty=${cmdty}/area=${area}`
    && meta.lakeRoot === lake.inputs?.lakeRoot;
  if (measurement.artifactKind !== "TR-01_TRADES_MEASUREMENT" || !sameSource || !Array.isArray(measurement.coverage)) {
    throw new Error(`${path} no es una medición del lago ${lake.inputs?.lakeRoot} para cmdty=${cmdty}/area=${area}.`);
  }
  const scanCoversListing = listedDays.length > 0
    && meta.dateMin <= listedDays[0]
    && meta.dateMax >= listedDays.at(-1)
    && Number(meta.dayCount) >= listedDays.length;
  if (!scanCoversListing) {
    throw new Error(`${path} no escaneó todos los días del listado del lago (${listedDays[0]}..${listedDays.at(-1)}, ${listedDays.length} días).`);
  }
  return measurement.coverage;
}

export function buildSourcePeriodCoverage(inputs) {
  const { sourcePartitions, zonePlan, gasExchangeCalendar, powerExchangeCalendar, tr01Decision, archiveMeasurementGas, archiveMeasurementPower } = inputs;
  const archivePartitions = sourcePartitions.sources.CLIENT_SEALED_ARCHIVE.partitions;
  const lake = sourcePartitions.sources.EEX_LAKE;
  const lakeEligible = {
    GAS_THE: requireLakeMeasurement(inputs.lakeMeasurementGas ?? null, inputs.lakeMeasurementGasManifest ?? null, lake, "GAS_THE", OPTIONAL_INPUT_PATHS.lakeMeasurementGas),
    POWER_DE: requireLakeMeasurement(inputs.lakeMeasurementPower ?? null, inputs.lakeMeasurementPowerManifest ?? null, lake, "POWER_DE", OPTIONAL_INPUT_PATHS.lakeMeasurementPower),
  };
  const lakeNotMeasured = Object.keys(lakeEligible).filter((market) => lakeEligible[market] === null);
  const measurement = measureSourcePeriodCoverage({
    zonePlan,
    exchangeDays: { GAS_THE: gasExchangeCalendar.exchangeDays, POWER_DE: powerExchangeCalendar.exchangeDays },
    sources: {
      CLIENT_SEALED_ARCHIVE: {
        range: sourceRange(tr01Decision, "CLIENT_SEALED_ARCHIVE"),
        partitions: archivePartitions,
        eligibleCoverage: {
          GAS_THE: requireArchiveMeasurement(archiveMeasurementGas, inputs.archiveMeasurementGasManifest, tr01Decision, INPUT_PATHS.archiveMeasurementGas),
          POWER_DE: requireArchiveMeasurement(archiveMeasurementPower, inputs.archiveMeasurementPowerManifest, tr01Decision, INPUT_PATHS.archiveMeasurementPower),
        },
      },
      EEX_LAKE: {
        range: sourceRange(tr01Decision, "EEX_LAKE"),
        partitions: indexLakePartitions(lake.listing),
        eligibleCoverage: lakeEligible,
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
      noMixing: "Cada fuente se mide por separado; patch.days elige el día entero (trades y TOB requerido), compara sólo con pares normales sellados del archivo de igual ShortCode y distancia a entrega, y deja los no verificables DATA_INCOMPLETE.",
    },
    tr01Comparison: {
      decisionStatus: tr01Decision.status,
      selectedSource: tr01Decision.selectedSource,
      comparisonDifferences: tr01Decision.comparison?.differences ?? null,
      comparisonScope: "compareSourceInventories (src/trades-source/source-decision.mjs) compara sólo dateMax y la presencia de eex_derivative_reference; no mide días por período. Las TRADES_MEASUREMENT de TR-01 llevan calendarWindow 2025-08-12..2026-07-28 (puente).",
      periodDifferencesFoundHere: measurement.differences.length,
    },
    ownerDecision: {
      status: "PARCHE_VERIFICADO",
      decidedBy: "Bru, PLAN_STATUS.md DATA-02 (2026-09-26)",
      selectedSource: "CLIENT_SEALED_ARCHIVE_WITH_VERIFIED_LAKE_PATCH",
      baseSource: "CLIENT_SEALED_ARCHIVE",
      patchSource: "EEX_LAKE_PATCH",
      rule: "Un día con trades o TOB requerido ausente, totalmente excluido o con pulls incluidos y excluidos en el archivo sólo puede cubrirse entero con el lago tras verificar sus particiones y los trades elegibles frente a días normales sellados del mismo ShortCode de otras maturities a igual distancia de su propia entrega; si no se verifica, DATA_INCOMPLETE.",
      verificationStatus: lakeNotMeasured.length > 0 ? "PENDING_LAKE_MEASUREMENT" : "RULE_APPLIED",
      unmeasuredLakeMarkets: lakeNotMeasured,
      completenessRule: PATCH_COMPLETENESS_RULE,
      completenessRuleSha256: sha256(Buffer.from(JSON.stringify(PATCH_COMPLETENESS_RULE))),
      provenance: "patch.days declara la fuente de cada día de cada campaign; DATA_INCOMPLETE conserva los huecos que no pasan la regla.",
      blocks: lakeNotMeasured.length ? ["FIX-03: requiere medición completa del lago antes de reconstruir días faltantes"] : [],
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
    parsed[name] = name.startsWith("archiveMeasurement") && !name.endsWith("Manifest")
      ? bytes[name] : JSON.parse(bytes[name].toString("utf8"));
  }
  for (const [name, path] of Object.entries(OPTIONAL_INPUT_PATHS)) {
    bytes[name] = existsSync(path) ? readFileSync(path) : null;
    parsed[name] = bytes[name] === null ? null : name.endsWith("Manifest") ? JSON.parse(bytes[name].toString("utf8")) : bytes[name];
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
    inputs: Object.fromEntries(Object.entries({ ...INPUT_PATHS, ...OPTIONAL_INPUT_PATHS }).map(([name, path]) =>
      [name, { path, sha256: bytes[name] === null || bytes[name] === undefined ? null : sha256(bytes[name]) }])),
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
