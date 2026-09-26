import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import {
  CAMPAIGN_STATUS,
  DAY_STATUS,
  classifyDay,
  indexArchivePartitions,
  indexLakePartitions,
  measureSourcePeriodCoverage,
  partitionKey,
} from "../../src/trades-source/period-coverage.mjs";
import { buildSourcePeriodCoverage } from "../../operations/trades/DATA-02/build-source-period-coverage.mjs";

const TRADE_GAS = partitionKey("eex_derivative_trade", "NATGAS", "THE");
const TOB_GAS = partitionKey("eex_derivative_top_of_book", "NATGAS", "THE");

const archivePath = (table, area, day, pull = "p1") =>
  `data/lake/v1/table=${table}/cmdty=NATGAS/area=${area}/trd_date=${day}/pull_id=${pull}/part.parquet`;
const excludedPath = (table, area, day, pull = "x1") =>
  `/var/lib/lake/v1/table=${table}/cmdty=NATGAS/area=${area}/trd_date=${day}/pull_id=${pull}/part.parquet`;

// Dos campaigns Gas Quarterly de juguete: una de Development (3 días) y una del
// puente (2 días). Las ventanas salen del calendario, no de la data.
const CALENDAR = ["2021-01-04", "2021-01-05", "2021-01-06", "2025-09-01", "2025-09-02"];
const ZONE_PLAN = {
  missions: {
    GAS_QUARTERLY: {
      product: "Gas",
      mission: "Quarterly",
      market: "GAS_THE",
      shortCode: "G0BQ",
      zones: {
        DEVELOPMENT: [{ campaignId: "GAS-Q-2021Q2", mission: "Quarterly", maturity: "2021Q2", shortCode: "G0BQ", windowStart: "2021-01-01", windowEnd: "2021-01-31" }],
        PUENTE: [{ campaignId: "GAS-Q-2026Q1", mission: "Quarterly", maturity: "2026Q1", shortCode: "G0BQ", windowStart: "2025-09-01", windowEnd: "2025-09-30" }],
      },
    },
  },
  purge: [],
};

function archiveFixture() {
  return indexArchivePartitions({
    fileEntries: [
      { archive_path: archivePath("eex_derivative_trade", "THE", "2025-09-01") },
      { archive_path: archivePath("eex_derivative_trade", "THE", "2025-09-02") },
      { archive_path: archivePath("eex_derivative_top_of_book", "THE", "2025-09-01") },
      { archive_path: archivePath("eex_derivative_top_of_book", "THE", "2025-09-02") },
      // Área de spread y tabla reference: no alimentan ninguna misión.
      { archive_path: archivePath("eex_derivative_trade", "THE___TTF", "2021-01-04") },
      { archive_path: archivePath("eex_derivative_reference", "THE", "2021-01-04") },
    ],
    exclusionEntries: [
      { source_path: excludedPath("eex_derivative_trade", "THE", "2021-01-04"), reason: "missing-date-completion-receipt" },
      { source_path: excludedPath("eex_derivative_trade", "THE", "2021-01-05"), reason: "missing-date-completion-receipt" },
      { source_path: excludedPath("eex_derivative_trade", "THE", "2021-01-06"), reason: "missing-date-completion-receipt" },
      { source_path: excludedPath("eex_derivative_top_of_book", "THE", "2025-09-02"), reason: "missing-date-completion-receipt" },
    ],
  });
}

function lakeFixture() {
  return indexLakePartitions({
    [TRADE_GAS]: { "2021-01-04": 1, "2021-01-05": 1, "2021-01-06": 1, "2025-09-01": 1, "2025-09-02": 0 },
    [TOB_GAS]: { "2025-09-01": 2, "2025-09-02": 2 },
  });
}

const ARCHIVE_ELIGIBLE = [
  { shortCode: "G0BQ", maturity: "202601", trdDate: "2025-09-01", eligibleCount: 4 },
  { shortCode: "G0BM", maturity: "202510", trdDate: "2025-09-02", eligibleCount: 9 },
];

function sources() {
  return {
    CLIENT_SEALED_ARCHIVE: {
      range: { from: "2020-11-02", to: "2026-09-11" },
      partitions: archiveFixture(),
      eligibleCoverage: { GAS_THE: ARCHIVE_ELIGIBLE, POWER_DE: null },
    },
    EEX_LAKE: {
      range: { from: "2020-11-02", to: "2025-09-01" },
      partitions: lakeFixture(),
      eligibleCoverage: { GAS_THE: null, POWER_DE: null },
      eligiblePendingReason: { GAS_THE: "job de escaneo del lago pendiente", POWER_DE: "job power pendiente" },
    },
  };
}

function measure(sourceMap = sources()) {
  return measureSourcePeriodCoverage({ zonePlan: ZONE_PLAN, exchangeDays: { GAS_THE: CALENDAR, POWER_DE: [] }, sources: sourceMap });
}

const campaign = (result, id) => result.campaigns.find((entry) => entry.campaignId === id);

test("el índice del archivo cuenta pulls sellados y excluidos sólo del área exacta de la misión", () => {
  const index = archiveFixture();
  assert.deepEqual(index[TRADE_GAS].included, { "2025-09-01": 1, "2025-09-02": 1 });
  assert.deepEqual(index[TRADE_GAS].excluded["2021-01-04"], { pulls: 1, reasons: ["missing-date-completion-receipt"] });
  assert.equal(Object.keys(index).some((key) => key.includes("THE___TTF") || key.includes("reference")), false);
});

test("classifyDay distingue sellado, pulls excluidos, excluido, ausente y fuera de rango", () => {
  const partitions = { included: { a: 1, b: 2 }, excluded: { b: { pulls: 1 }, c: { pulls: 1 } } };
  const range = { from: "a", to: "d" };
  assert.equal(classifyDay({ day: "a", partitions, range }), DAY_STATUS.SEALED);
  assert.equal(classifyDay({ day: "b", partitions, range }), DAY_STATUS.PRESENT_WITH_EXCLUDED_PULLS);
  assert.equal(classifyDay({ day: "c", partitions, range }), DAY_STATUS.EXCLUDED_BY_CLIENT);
  assert.equal(classifyDay({ day: "d", partitions, range }), DAY_STATUS.ABSENT);
  assert.equal(classifyDay({ day: "e", partitions, range }), DAY_STATUS.OUT_OF_SOURCE_RANGE);
});

test("una campaign de Development sin data en el archivo queda visible como NONE mientras el lago la cubre", () => {
  const result = measure();
  const dev = campaign(result, "GAS-Q-2021Q2");
  assert.equal(dev.windowExchangeDays, 3);
  assert.equal(dev.bySource.CLIENT_SEALED_ARCHIVE.tradePartitions.status, CAMPAIGN_STATUS.NONE);
  assert.equal(dev.bySource.CLIENT_SEALED_ARCHIVE.tradePartitions.dayCounts.EXCLUDED_BY_CLIENT, 3);
  assert.equal(dev.bySource.CLIENT_SEALED_ARCHIVE.eligibleTrades.status, CAMPAIGN_STATUS.NONE);
  assert.equal(dev.bySource.EEX_LAKE.tradePartitions.status, CAMPAIGN_STATUS.FULL);
  assert.deepEqual(result.summary.GAS_QUARTERLY.DEVELOPMENT.CLIENT_SEALED_ARCHIVE.campaignsWithoutTrades, ["GAS-Q-2021Q2"]);
  assert.deepEqual(result.summary.GAS_QUARTERLY.DEVELOPMENT.EEX_LAKE.campaignsWithoutTrades, []);
  assert.ok(result.differences.some((entry) => entry.campaignId === "GAS-Q-2021Q2"));
});

test("sin medición de trades elegibles la fuente queda NOT_MEASURED con su motivo, nunca cero", () => {
  const lake = campaign(measure(), "GAS-Q-2021Q2").bySource.EEX_LAKE.eligibleTrades;
  assert.deepEqual(lake, { status: CAMPAIGN_STATUS.NOT_MEASURED, reason: "job de escaneo del lago pendiente" });
});

test("los trades elegibles se cuentan sólo del contrato de la campaign y dentro de su ventana", () => {
  const eligible = campaign(measure(), "GAS-Q-2026Q1").bySource.CLIENT_SEALED_ARCHIVE.eligibleTrades;
  assert.equal(eligible.contract, "G0BQ|202601");
  assert.equal(eligible.daysWithTrades, 1);
  assert.equal(eligible.eligibleTrades, 4);
  assert.equal(eligible.status, CAMPAIGN_STATUS.PARTIAL);
});

test("TOB se exige sólo en el puente; un día con pulls excluidos no cuenta como sellado", () => {
  const result = measure();
  const bridge = campaign(result, "GAS-Q-2026Q1");
  assert.equal(bridge.bySource.CLIENT_SEALED_ARCHIVE.tobPartitions.required, true);
  assert.equal(bridge.bySource.CLIENT_SEALED_ARCHIVE.tobPartitions.status, CAMPAIGN_STATUS.FULL_WITH_EXCLUDED_PULLS);
  assert.deepEqual(result.summary.GAS_QUARTERLY.PUENTE.CLIENT_SEALED_ARCHIVE.campaignsRequiredTobNotSealed, ["GAS-Q-2026Q1"]);
  assert.equal(campaign(result, "GAS-Q-2021Q2").bySource.CLIENT_SEALED_ARCHIVE.tobPartitions.required, false);
});

test("un día después del final de la fuente es OUT_OF_SOURCE_RANGE, y un pull vacío del lago no cuenta", () => {
  const trades = campaign(measure(), "GAS-Q-2026Q1").bySource.EEX_LAKE.tradePartitions;
  assert.deepEqual(trades.notSealedDays, [{ day: "2025-09-02", status: DAY_STATUS.OUT_OF_SOURCE_RANGE }]);
  assert.equal(trades.status, CAMPAIGN_STATUS.PARTIAL);
});

test("sin mezcla: la medición de cada fuente es idéntica a medirla sola", () => {
  const both = measure();
  for (const sourceId of ["CLIENT_SEALED_ARCHIVE", "EEX_LAKE"]) {
    const alone = measure({ [sourceId]: sources()[sourceId] });
    for (const entry of alone.campaigns) {
      assert.deepEqual(campaign(both, entry.campaignId).bySource[sourceId], entry.bySource[sourceId]);
      assert.deepEqual(Object.keys(entry.bySource), [sourceId]);
    }
  }
});

function repoInputs() {
  const read = (path) => JSON.parse(readFileSync(path, "utf8"));
  return {
    sourcePartitions: read("operations/trades/DATA-02/source-partitions.json"),
    zonePlan: read("operations/trades/TR-02/trades-zone-plan.json"),
    gasExchangeCalendar: read("operations/audit/IMP-09/eex-exchange-calendar.json"),
    powerExchangeCalendar: read("operations/trades/TR-01/power-de-exchange-calendar.json"),
    tr01Decision: read("operations/trades/TR-01/DATA_SOURCE_DECISION.json"),
    archiveMeasurementGas: { sourceMeta: read("operations/trades/TR-01/TRADES_MEASUREMENT-gas-the.json").sourceMeta, coverage: [] },
    archiveMeasurementPower: { sourceMeta: read("operations/trades/TR-01/TRADES_MEASUREMENT-power-de.json").sourceMeta, coverage: [] },
  };
}

test("el productor registra PARCHE VERIFICADO sin declarar completos los datos del lago", () => {
  const artifact = buildSourcePeriodCoverage(repoInputs());
  assert.equal(artifact.ownerDecision.status, "PARCHE_VERIFICADO");
  assert.equal(artifact.ownerDecision.selectedSource, "CLIENT_SEALED_ARCHIVE_WITH_VERIFIED_LAKE_PATCH");
  assert.equal(artifact.ownerDecision.verificationStatus, "PENDING_LAKE_MEASUREMENT");
  assert.deepEqual(artifact.ownerDecision.unmeasuredLakeMarkets, ["GAS_THE", "POWER_DE"]);
});

test("fail-closed: una medición de trades que no viene del archivo verificado no se usa", () => {
  const inputs = repoInputs();
  inputs.archiveMeasurementGas.sourceMeta = { ...inputs.archiveMeasurementGas.sourceMeta, archiveVerification: { sha256: "otro" } };
  assert.throws(() => buildSourcePeriodCoverage(inputs), /no es una medición del archivo sellado/);
  const lakeRows = repoInputs();
  lakeRows.archiveMeasurementPower.sourceMeta = { ...lakeRows.archiveMeasurementPower.sourceMeta, source: "lake" };
  assert.throws(() => buildSourcePeriodCoverage(lakeRows), /no es una medición del archivo sellado/);
});

test("el artefacto comprometido es reproducible y muestra lo que la comparación de TR-01 no vio", () => {
  execFileSync(process.execPath, ["operations/trades/DATA-02/build-source-period-coverage.mjs", "--check"], { stdio: "pipe" });
  const artifact = JSON.parse(readFileSync("operations/trades/DATA-02/SOURCE_PERIOD_COVERAGE.json", "utf8"));
  assert.deepEqual(artifact.tr01Comparison.comparisonDifferences, []);
  assert.ok(artifact.tr01Comparison.periodDifferencesFoundHere > 0);
  assert.equal(artifact.campaigns.length, new Set(artifact.campaigns.map((entry) => `${entry.missionKey}|${entry.campaignId}`)).size);
});

// Medición del lago con la forma de TRADES_MEASUREMENT (sourceMeta = `_meta` de
// extract-trades-rows.py --source lake). El escaneo cubre todo el listado.
function lakeMeasurementFixture(inputs, overrides = {}) {
  const lake = inputs.sourcePartitions.sources.EEX_LAKE;
  const listed = Object.keys(lake.listing["eex_derivative_trade|NATGAS|THE"]).sort();
  return {
    artifactKind: "TR-01_TRADES_MEASUREMENT",
    sourceMeta: {
      artifactKind: "TR-01_TRADES_ROWS",
      source: "lake",
      lakeRoot: lake.inputs.lakeRoot,
      table: "eex_derivative_trade",
      area: "cmdty=NATGAS/area=THE",
      dateMin: listed[0],
      dateMax: listed.at(-1),
      dayCount: listed.length,
      ...overrides,
    },
    coverage: [
      { cmdty: "NATGAS", area: "THE", shortCode: "G0BQ", maturity: "202107", trdDate: "2021-03-01", eligibleCount: 3 },
      { cmdty: "NATGAS", area: "THE", shortCode: "G0BQ", maturity: "202107", trdDate: "2021-03-02", eligibleCount: 2 },
      // Otro contrato el mismo día: no cuenta para GAS-Q-2021Q3.
      { cmdty: "NATGAS", area: "THE", shortCode: "G0BM", maturity: "202104", trdDate: "2021-03-01", eligibleCount: 7 },
    ],
  };
}

test("con una medición del lago, sus trades elegibles dejan de ser NOT_MEASURED y se cuentan por contrato", () => {
  const inputs = repoInputs();
  sealLakeMeasurement(inputs, lakeMeasurementFixture(inputs));
  const artifact = buildSourcePeriodCoverage(inputs);
  const q3 = artifact.campaigns.find((entry) => entry.missionKey === "GAS_QUARTERLY" && entry.campaignId === "GAS-Q-2021Q3");
  const lake = q3.bySource.EEX_LAKE.eligibleTrades;
  assert.equal(lake.contract, "G0BQ|202107");
  assert.equal(lake.daysWithTrades, 2);
  assert.equal(lake.eligibleTrades, 5);
  assert.equal(lake.status, CAMPAIGN_STATUS.PARTIAL);
  assert.equal(artifact.summary.GAS_QUARTERLY[q3.zone].EEX_LAKE.eligibleTrades.NOT_MEASURED, 0);
  // Power sin medición del lago sigue NOT_MEASURED con su propio job.
  const power = artifact.campaigns.find((entry) => entry.market === "POWER_DE");
  assert.equal(power.bySource.EEX_LAKE.eligibleTrades.status, CAMPAIGN_STATUS.NOT_MEASURED);
  assert.match(power.bySource.EEX_LAKE.eligibleTrades.reason, /cmdty=POWER\/area=DE/);
  assert.deepEqual(artifact.ownerDecision.unmeasuredLakeMarkets, ["POWER_DE"]);
});

test("fail-closed: una medición del lago de otra fuente, área o escaneo recortado no se usa", () => {
  const cases = [
    [{ source: "archive" }, /no es una medición del lago/],
    [{ area: "cmdty=NATGAS/area=THE___TTF" }, /no es una medición del lago/],
    [{ lakeRoot: "/otro/lago" }, /no es una medición del lago/],
    [{ table: "eex_derivative_top_of_book" }, /no es una medición del lago/],
    [{ dateMin: "2021-01-04" }, /no escaneó todos los días/],
    [{ dayCount: 10 }, /no escaneó todos los días/],
  ];
  for (const [overrides, error] of cases) {
    const inputs = repoInputs();
    sealLakeMeasurement(inputs, lakeMeasurementFixture(inputs, overrides));
    assert.throws(() => buildSourcePeriodCoverage(inputs), error);
  }
});

function sealLakeMeasurement(inputs, measurement) {
  const bytes = Buffer.from(`${JSON.stringify(measurement)}\n`);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  inputs.lakeMeasurementGas = bytes;
  inputs.lakeMeasurementGasManifest = {
    artifactKind: "TR-01_TRADES_MEASUREMENT_MANIFEST",
    schemaVersion: "1.0",
    producer: "operations/trades/TR-01/aggregate-trades-rows.mjs",
    artifact: { path: "operations/trades/DATA-02/TRADES_MEASUREMENT-lake-gas-the.json", sha256 },
    input: { path: "rows-lake-gas-the.ndjson", sha256: "a".repeat(64) },
  };
}

test("fail-closed: medición del lago requiere manifest válido ligado a los bytes y al escaneo", () => {
  const inputs = repoInputs();
  sealLakeMeasurement(inputs, lakeMeasurementFixture(inputs));
  const original = inputs.lakeMeasurementGas;
  inputs.lakeMeasurementGas = Buffer.from(original.toString().replace('"eligibleCount":3', '"eligibleCount":9'));
  assert.throws(() => buildSourcePeriodCoverage(inputs), /manifest válido/);
  inputs.lakeMeasurementGas = original;
  inputs.lakeMeasurementGasManifest = null;
  assert.throws(() => buildSourcePeriodCoverage(inputs), /requiere medición y manifest/);
  sealLakeMeasurement(inputs, lakeMeasurementFixture(inputs));
  inputs.lakeMeasurementGasManifest.producer = "otro-productor";
  assert.throws(() => buildSourcePeriodCoverage(inputs), /manifest válido/);
  inputs.lakeMeasurementGas = null;
  assert.throws(() => buildSourcePeriodCoverage(inputs), /requiere medición y manifest/);
});
