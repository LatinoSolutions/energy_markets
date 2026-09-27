import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import {
  CAMPAIGN_STATUS,
  DAY_STATUS,
  PATCH_COMPLETENESS_RULE,
  classifyDay,
  indexArchivePartitions,
  indexLakePartitions,
  measureSourcePeriodCoverage,
  partitionKey,
  resolveVerifiedPatchDays,
} from "../../src/trades-source/period-coverage.mjs";
import { buildArtifacts, buildSourcePeriodCoverage, INPUT_PATHS, OPTIONAL_INPUT_PATHS } from "../../operations/trades/DATA-02/build-source-period-coverage.mjs";
import { buildManifest as buildTradesMeasurementManifest } from "../../operations/trades/TR-01/aggregate-trades-rows.mjs";

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

test("PARCHE VERIFICADO elige archivo, lago normal y DATA_INCOMPLETE para día cortado", () => {
  const days = ["2021-03-01", "2021-03-02", "2021-03-03", "2021-03-04", "2021-03-05", "2021-03-08"];
  const records = days.map((trdDate, index) => ({
    shortCode: "G0BQ", maturity: "202107", trdDate,
    eligibleCount: index === 4 ? 1 : 10,
  }));
  const selected = resolveVerifiedPatchDays({
    campaign: { campaignId: "GAS-Q-2021Q3", mission: "Quarterly", maturity: "2021Q3", shortCode: "G0BQ" },
    windowDays: [days[0], days[3], days[4], "2021-03-09"],
    archivePartitions: { included: Object.fromEntries([days[0], days[1], days[2], days[5]].map((day) => [day, 1])), excluded: {} },
    archiveRange: { from: days[0], to: "2026-09-11" },
    lakePartitions: { included: Object.fromEntries(days.map((day) => [day, 1])), excluded: {} },
    lakeRange: { from: days[0], to: days.at(-1) },
    lakeCoverage: records,
  });
  assert.deepEqual(selected.map((row) => row.source), [
    "CLIENT_SEALED_ARCHIVE", "EEX_LAKE_PATCH", "DATA_INCOMPLETE", "DATA_INCOMPLETE",
  ]);
  assert.equal(selected[1].threshold, 5);
  assert.equal(selected[2].reason, "BELOW_COMPLETENESS_THRESHOLD");
  assert.equal(selected[3].reason, "LAKE_PARTITION_ABSENT");
  assert.equal(resolveVerifiedPatchDays({
    campaign: { campaignId: "GAS-Q-2021Q3", mission: "Quarterly", maturity: "2021Q3", shortCode: "G0BQ" },
    windowDays: [days[3]], archivePartitions: { included: {}, excluded: {} },
    archiveRange: { from: days[0], to: days.at(-1) },
    lakePartitions: { included: { [days[3]]: 1 }, excluded: {} },
    lakeRange: { from: days[0], to: days.at(-1) }, lakeCoverage: records,
  })[0].source, "DATA_INCOMPLETE");
});

test("un día del archivo con pulls incluidos y excluidos usa sólo el lago si supera la regla", () => {
  const days = ["2021-03-01", "2021-03-02", "2021-03-03", "2021-03-04", "2021-03-05"];
  const selected = resolveVerifiedPatchDays({
    campaign: { campaignId: "GAS-Q-2021Q3", mission: "Quarterly", maturity: "2021Q3", shortCode: "G0BQ" },
    windowDays: [days[3], days[4]],
    archivePartitions: { included: Object.fromEntries(days.map((day) => [day, 1])), excluded: {
      [days[3]]: { pulls: 1, reasons: ["missing-date-completion-receipt"] },
      [days[4]]: { pulls: 1, reasons: ["missing-date-completion-receipt"] },
    } },
    archiveRange: { from: days[0], to: days.at(-1) },
    lakePartitions: { included: Object.fromEntries(days.map((day) => [day, 1])), excluded: {} },
    lakeRange: { from: days[0], to: days.at(-1) },
    lakeCoverage: days.map((trdDate, index) => ({ shortCode: "G0BQ", maturity: "202107", trdDate, eligibleCount: index === 4 ? 1 : 10 })),
  });
  assert.deepEqual(selected.map((row) => row.source), ["EEX_LAKE_PATCH", "DATA_INCOMPLETE"]);
  assert.equal(selected[1].reason, "BELOW_COMPLETENESS_THRESHOLD");
});

test("los días con pulls excluidos nunca cuentan como pares normales del contrato", () => {
  const days = ["2021-03-01", "2021-03-02", "2021-03-03", "2021-03-04", "2021-03-05", "2021-03-06"];
  const selected = resolveVerifiedPatchDays({
    campaign: { campaignId: "GAS-Q-2021Q3", mission: "Quarterly", maturity: "2021Q3", shortCode: "G0BQ" },
    windowDays: [days[5]],
    archivePartitions: { included: Object.fromEntries(days.slice(0, 5).map((day) => [day, 1])),
      excluded: Object.fromEntries(days.slice(0, 4).map((day) => [day, { pulls: 1, reasons: ["missing-date-completion-receipt"] }])) },
    archiveRange: { from: days[0], to: days[5] },
    lakePartitions: { included: Object.fromEntries(days.map((day) => [day, 1])), excluded: {} },
    lakeRange: { from: days[0], to: days[5] },
    lakeCoverage: days.map((trdDate, index) => ({ shortCode: "G0BQ", maturity: "202107", trdDate, eligibleCount: index === 4 ? 100 : 3 })),
  });
  assert.deepEqual(selected, [{ day: days[5], source: "DATA_INCOMPLETE", reason: "INSUFFICIENT_PEER_DAYS", eligibleTrades: 3, peerDays: 1 }]);
});

test("un hueco de TOB requerido selecciona el día entero del lago sólo con TOB y trades completos", () => {
  const days = ["2025-09-01", "2025-09-02", "2025-09-03", "2025-09-04"];
  const input = {
    campaign: { campaignId: "GAS-Q-2026Q1", mission: "Quarterly", maturity: "2026Q1", shortCode: "G0BQ" },
    windowDays: [days[3]], tobRequired: true,
    archivePartitions: { included: Object.fromEntries(days.map((day) => [day, 1])), excluded: {} },
    archiveTobPartitions: { included: Object.fromEntries(days.map((day) => [day, 1])), excluded: {
      [days[3]]: { pulls: 1, reasons: ["missing-date-completion-receipt"] },
    } },
    archiveRange: { from: days[0], to: days[3] },
    lakePartitions: { included: Object.fromEntries(days.map((day) => [day, 1])), excluded: {} },
    lakeTobPartitions: { included: Object.fromEntries(days.map((day) => [day, 1])), excluded: {} },
    lakeRange: { from: days[0], to: days[3] },
    lakeCoverage: days.map((trdDate) => ({ shortCode: "G0BQ", maturity: "202601", trdDate, eligibleCount: 10 })),
  };
  assert.equal(resolveVerifiedPatchDays(input)[0].source, "EEX_LAKE_PATCH");
  assert.deepEqual(resolveVerifiedPatchDays({ ...input,
    lakeTobPartitions: { included: Object.fromEntries(days.slice(0, 3).map((day) => [day, 1])), excluded: {} },
  })[0], { day: days[3], source: "DATA_INCOMPLETE", reason: "LAKE_TOB_PARTITION_ABSENT" });
  assert.equal(resolveVerifiedPatchDays({ ...input,
    archiveTobPartitions: { included: Object.fromEntries(days.map((day) => [day, 1])), excluded: {} },
  })[0].source, "CLIENT_SEALED_ARCHIVE");
});

function repoInputs() {
  const read = (path) => JSON.parse(readFileSync(path, "utf8"));
  const inputs = {
    sourcePartitions: read("operations/trades/DATA-02/source-partitions.json"),
    zonePlan: read("operations/trades/TR-02/trades-zone-plan.json"),
    gasExchangeCalendar: read("operations/audit/IMP-09/eex-exchange-calendar.json"),
    powerExchangeCalendar: read("operations/trades/TR-01/power-de-exchange-calendar.json"),
    tr01Decision: read("operations/trades/TR-01/DATA_SOURCE_DECISION.json"),
  };
  for (const market of ["Gas", "Power"]) {
    const suffix = market === "Gas" ? "gas-the" : "power-de";
    sealArchiveMeasurement(inputs, market, {
      artifactKind: "TR-01_TRADES_MEASUREMENT",
      sourceMeta: read(`operations/trades/TR-01/TRADES_MEASUREMENT-${suffix}.json`).sourceMeta,
      coverage: [],
    });
  }
  return inputs;
}

function sealArchiveMeasurement(inputs, market, measurement) {
  const suffix = market === "Gas" ? "gas-the" : "power-de";
  const path = `operations/trades/TR-01/TRADES_MEASUREMENT-${suffix}.json`;
  const bytes = Buffer.from(`${JSON.stringify(measurement)}\n`);
  inputs[`archiveMeasurement${market}`] = bytes;
  inputs[`archiveMeasurement${market}Manifest`] = buildTradesMeasurementManifest({
    measurement: { dedup: { inputCount: 0, uniqueCount: 0, duplicates: 0 }, eligibility: { eligible: 0 } },
    artifactPath: path,
    artifactSha256: createHash("sha256").update(bytes).digest("hex"),
    inputPath: `rows-${suffix}.ndjson`,
    inputSha256: "a".repeat(64),
  });
}

test("el productor registra PARCHE VERIFICADO sin declarar completos los datos del lago", () => {
  const artifact = buildSourcePeriodCoverage(repoInputs());
  assert.equal(artifact.ownerDecision.status, "PARCHE_VERIFICADO");
  assert.equal(artifact.ownerDecision.selectedSource, "CLIENT_SEALED_ARCHIVE_WITH_VERIFIED_LAKE_PATCH");
  assert.equal(artifact.ownerDecision.verificationStatus, "PENDING_LAKE_MEASUREMENT");
  assert.deepEqual(artifact.ownerDecision.unmeasuredLakeMarkets, ["GAS_THE", "POWER_DE"]);
  assert.equal(artifact.ownerDecision.completenessRuleSha256,
    createHash("sha256").update(JSON.stringify(PATCH_COMPLETENESS_RULE)).digest("hex"));
  const gap = artifact.campaigns.find((entry) => entry.campaignId === "GAS-Q-2021Q3");
  assert.ok(gap.patch.days.some((entry) => entry.source === "DATA_INCOMPLETE"));
});

test("el hueco real de TOB Power del puente no se atribuye al archivo sellado", () => {
  const artifact = buildSourcePeriodCoverage(repoInputs());
  const power = artifact.campaigns.find((entry) => entry.campaignId === "POW-Q-2026Q3");
  assert.equal(power.bySource.CLIENT_SEALED_ARCHIVE.tradePartitions.notSealedDays.some((entry) => entry.day === "2026-04-17"), false);
  assert.equal(power.bySource.CLIENT_SEALED_ARCHIVE.tobPartitions.notSealedDays.some((entry) => entry.day === "2026-04-17"), true);
  assert.deepEqual(power.patch.days.find((entry) => entry.day === "2026-04-17"),
    { day: "2026-04-17", source: "DATA_INCOMPLETE", reason: "LAKE_NOT_MEASURED" });
});

test("la regla se fija sin consumir resultados de estrategia", () => {
  const inputs = repoInputs();
  const before = buildSourcePeriodCoverage(inputs);
  const after = buildSourcePeriodCoverage({
    ...inputs,
    strategyResults: { A0: { pnl: -999 }, A1: { pnl: 999 }, preferredSource: "EEX_LAKE" },
  });
  assert.deepEqual(after.ownerDecision.completenessRule, before.ownerDecision.completenessRule);
  assert.equal(after.ownerDecision.completenessRuleSha256, before.ownerDecision.completenessRuleSha256);
  assert.deepEqual(after.campaigns.map((item) => item.patch), before.campaigns.map((item) => item.patch));
});

test("fail-closed: una medición de trades que no viene del archivo verificado no se usa", () => {
  const inputs = repoInputs();
  const gas = JSON.parse(inputs.archiveMeasurementGas.toString());
  gas.sourceMeta.archiveVerification.sha256 = "otro";
  sealArchiveMeasurement(inputs, "Gas", gas);
  assert.throws(() => buildSourcePeriodCoverage(inputs), /no es una medición del archivo sellado/);
  const lakeRows = repoInputs();
  const power = JSON.parse(lakeRows.archiveMeasurementPower.toString());
  power.sourceMeta.source = "lake";
  sealArchiveMeasurement(lakeRows, "Power", power);
  assert.throws(() => buildSourcePeriodCoverage(lakeRows), /no es una medición del archivo sellado/);
});

test("fail-closed: la cobertura del archivo está ligada a su manifest de TR-01", () => {
  const inputs = repoInputs();
  inputs.archiveMeasurementGas = Buffer.from(inputs.archiveMeasurementGas.toString().replace('"coverage":[]', '"coverage":[{"eligibleCount":1001}]'));
  assert.throws(() => buildSourcePeriodCoverage(inputs), /manifest válido/);
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
  inputs.lakeMeasurementGasManifest = buildTradesMeasurementManifest({
    measurement: { dedup: { inputCount: 10, uniqueCount: 10, duplicates: 0 }, eligibility: { eligible: 5 } },
    artifactPath: "operations/trades/DATA-02/TRADES_MEASUREMENT-lake-gas-the.json",
    artifactSha256: sha256,
    inputPath: "rows-lake-gas-the.ndjson",
    inputSha256: "a".repeat(64),
  });
}

test("tras ambas mediciones del job, el productor reconstruye cobertura y manifest con días de parche", () => {
  const parsed = repoInputs();
  // Fixture contrafactual: tres días sellados del mismo contrato permiten
  // verificar el cuarto. El inventario real de marzo de 2021 los excluye.
  const archiveTrades = parsed.sourcePartitions.sources.CLIENT_SEALED_ARCHIVE.partitions[TRADE_GAS];
  for (const day of ["2021-03-01", "2021-03-02", "2021-03-03"]) {
    archiveTrades.included[day] = 1;
    delete archiveTrades.excluded[day];
  }
  const gas = lakeMeasurementFixture(parsed);
  gas.coverage = [
    { shortCode: "G0BQ", maturity: "202107", trdDate: "2021-03-01", eligibleCount: 10 },
    { shortCode: "G0BQ", maturity: "202107", trdDate: "2021-03-02", eligibleCount: 10 },
    { shortCode: "G0BQ", maturity: "202107", trdDate: "2021-03-03", eligibleCount: 10 },
    { shortCode: "G0BQ", maturity: "202107", trdDate: "2021-03-04", eligibleCount: 10 },
  ];
  sealLakeMeasurement(parsed, gas);
  // El segundo mercado también debe estar presente antes de RULE_APPLIED.
  parsed.lakeMeasurementPower = Buffer.from(JSON.stringify({ artifactKind: "TR-01_TRADES_MEASUREMENT", sourceMeta: {
    artifactKind: "TR-01_TRADES_ROWS", source: "lake", lakeRoot: parsed.sourcePartitions.sources.EEX_LAKE.inputs.lakeRoot,
    table: "eex_derivative_trade", area: "cmdty=POWER/area=DE",
    dateMin: "2020-11-02", dateMax: "2026-07-28", dayCount: 9999,
  }, coverage: [] }));
  parsed.lakeMeasurementPowerManifest = buildTradesMeasurementManifest({
    measurement: { dedup: { inputCount: 0, uniqueCount: 0, duplicates: 0 }, eligibility: { eligible: 0 } },
    artifactPath: OPTIONAL_INPUT_PATHS.lakeMeasurementPower,
    artifactSha256: createHash("sha256").update(parsed.lakeMeasurementPower).digest("hex"),
    inputPath: "rows-lake-power-de.ndjson", inputSha256: "a".repeat(64),
  });
  const bytes = Object.fromEntries(Object.keys({ ...INPUT_PATHS, ...OPTIONAL_INPUT_PATHS }).map((key) => [key,
    Buffer.isBuffer(parsed[key]) ? parsed[key] : Buffer.from(JSON.stringify(parsed[key]))]));
  const { artifact, artifactBytes, manifestBytes } = buildArtifacts({ parsed, bytes });
  const manifest = JSON.parse(manifestBytes.toString());
  assert.equal(artifact.ownerDecision.verificationStatus, "RULE_APPLIED");
  assert.ok(artifact.campaigns.some((entry) => entry.patch.days.some((day) => day.source === "EEX_LAKE_PATCH")));
  assert.equal(manifest.artifact.sha256, createHash("sha256").update(artifactBytes).digest("hex"));
  assert.equal(manifest.inputs.lakeMeasurementGas.sha256, createHash("sha256").update(parsed.lakeMeasurementGas).digest("hex"));
});

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
