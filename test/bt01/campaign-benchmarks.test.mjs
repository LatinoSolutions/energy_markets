import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

import {
  buildCampaignBenchmarkArtifact,
  buildCampaignBenchmarkManifest,
  rowsArtifactPath,
  artifactPath,
  manifestPath,
  VERSIONS,
} from "../../operations/audit/BT-01/build-campaign-benchmarks.mjs";

const sha256 = (value) => createHash("sha256").update(value).digest("hex");

function fixture({ instruments = ["ISIN-1", "ISIN-1"], includeUnknownInstrument = false } = {}) {
  const value = {
    artifactKind: "BT-01_CAMPAIGN_PROXY_ROWS",
    schemaVersion: "1.0",
    calendar: { path: "calendar.json", sha256: "c".repeat(64) },
    campaignPopulation: { path: "results.json", sha256: "r".repeat(64) },
    sourceFileHashes: { "table=fixture/part.parquet": "f".repeat(64) },
    campaigns: [{
      campaignKey: "G0BQ-202601",
      product: "G0BQ",
      maturity: "202601",
      mission: "quarterly",
      windowRule: "3-1-3",
      windowStart: "2025-09-01",
      windowEnd: "2025-12-01",
      expectedDates: ["2025-09-01", "2025-09-02", "2025-09-03"],
      perDate: [
        {
          trdDate: "2025-09-01",
          sourceCounts: {},
          rows: [
            { instrument: instruments[0], instrumentType: "Simple Instrument", trdDate: "2025-09-01", tmUtc: "2025-09-01T15:00:00Z", price: 50, bid: null, ask: null, rowHash: "a" },
            { instrument: instruments[0], instrumentType: "Simple Instrument", trdDate: "2025-09-01", tmUtc: "2025-09-01T15:01:00Z", price: null, bid: 48, ask: 52, rowHash: "b" },
          ],
        },
        {
          trdDate: "2025-09-02",
          sourceCounts: {},
          rows: [
            { instrument: instruments[1], instrumentType: "Simple Instrument", trdDate: "2025-09-02", tmUtc: "2025-09-02T15:00:00Z", price: 60, bid: null, ask: null, rowHash: "c" },
            { instrument: instruments[1], instrumentType: "Simple Instrument", trdDate: "2025-09-02", tmUtc: "2025-09-02T15:01:00Z", price: null, bid: 58, ask: 62, rowHash: "d" },
          ],
        },
        { trdDate: "2025-09-03", sourceCounts: {}, rows: [] },
      ],
    }],
  };
  if (includeUnknownInstrument) {
    value.campaigns[0].perDate[0].rows.push({ instrument: "ISIN-1", instrumentType: "", trdDate: "2025-09-01", tmUtc: "2025-09-01T15:02:00Z", price: 999, bid: null, ask: null, rowHash: "unknown-type" });
  }
  return value;
}

function buildFixture(rowsArtifact) {
  return buildCampaignBenchmarkArtifact({
    rowsArtifact,
    rowsArtifactSha256: "x".repeat(64),
    exchangeDays: ["2025-09-01", "2025-09-02", "2025-09-03"],
    calendarSha256: rowsArtifact.calendar.sha256,
  });
}

test("BT-01 produce B con ventana 3-1-3, peso diario igual y missing sin rellenar", () => {
  const rowsArtifact = fixture();
  const artifact = buildFixture(rowsArtifact);
  const [campaign] = artifact.campaigns;

  assert.deepEqual(campaign.benchmarkWindow, { rule: "3-1-3", startInclusive: "2025-09-01", endExclusive: "2025-12-01" });
  assert.equal(campaign.benchmark.B, 55); // Daily references are 50 and 60; missing day is not a zero.
  assert.equal(campaign.benchmark.coverage, "2/3");
  assert.deepEqual(campaign.benchmark.missingDates, ["2025-09-03"]);
  assert.equal(campaign.perDate[2].dailyReference, null);
});

test("BT-01 mantiene proxy provisional separado de official y rechaza identidad ambigua", () => {
  const artifact = buildFixture(fixture({ instruments: ["ISIN-1", "ISIN-2"] }));
  const [campaign] = artifact.campaigns;

  assert.equal(campaign.status.status, "B_NOT_DEFINED");
  assert.equal(campaign.status.officialSettlement, "UNKNOWN; sin fuente oficial en el alcance BT-01");
  assert.equal(campaign.status.officialDates, 0);
  assert.equal(campaign.reconciliation.equivalent, false);
  assert.equal(campaign.reconciliation.N, 0);
  assert.equal(campaign.perDate[0].defined, false);
  assert.equal(campaign.perDate[0].instrumentIdentityAmbiguous, true);
  assert.equal(campaign.perDate[0].dailyReference, null);
});

test("BT-01 excluye filas cuyo tipo de instrumento está vacío o no es Simple Instrument", () => {
  const artifact = buildFixture(fixture({ includeUnknownInstrument: true }));
  const [campaign] = artifact.campaigns;

  assert.equal(campaign.perDate[0].dailyReference, 50);
  assert.equal(campaign.perDate[0].excludedRowsUnsupportedInstrument, 1);
});

test("BT-01 rechaza fechas esperadas que no coinciden con el calendario o perDate incompleto", () => {
  const rowsArtifact = fixture();
  const incompleteExpected = structuredClone(rowsArtifact);
  incompleteExpected.campaigns[0].expectedDates.pop();
  assert.throws(() => buildFixture(incompleteExpected), /Fechas esperadas no coinciden con el calendario IMP-09/);

  const missingTradingDate = structuredClone(rowsArtifact);
  assert.throws(() => buildCampaignBenchmarkArtifact({
    rowsArtifact: missingTradingDate,
    rowsArtifactSha256: "x".repeat(64),
    exchangeDays: [...missingTradingDate.campaigns[0].expectedDates, "2025-09-04"],
    calendarSha256: missingTradingDate.calendar.sha256,
  }), /Fechas esperadas no coinciden con el calendario IMP-09/);

  const incompletePerDate = structuredClone(rowsArtifact);
  incompletePerDate.campaigns[0].perDate.pop();
  assert.throws(() => buildFixture(incompletePerDate), /Fechas diarias no coinciden con las fechas esperadas/);
});

test("BT-01 worker aplica la identidad y accesibilidad declaradas por el wrapper IMP-05", () => {
  const input = {
    campaignKey: "G0BM-202509",
    trdDate: "2025-09-01",
    sourceCounts: {},
    sourceFiles: [],
    rows: [{
      instrument: "ISIN-1",
      instrumentType: "Simple Instrument",
      trdDate: "2025-09-01",
      tmUtc: "2025-09-01T15:00:00Z",
      price: 50,
      bid: null,
      ask: null,
      rowHash: "row-1",
    }],
  };
  const workerPath = new URL("../../operations/audit/BT-01/calculate-campaign-daily-proxies.mjs", import.meta.url);
  const result = spawnSync("node", [workerPath.pathname], { input: `${JSON.stringify(input)}\n`, encoding: "utf8" });

  assert.equal(result.status, 0, result.stderr);
  const daily = JSON.parse(result.stdout);
  assert.equal(daily.dailyReference, 50);
  assert.equal(daily.defined, true);
  assert.deepEqual(daily.instrumentIdentities, ["ISIN-1"]);
  assert.equal(daily.sourceRowHashCount, 1);
  assert.equal(daily.sourceFiles.length, 0);
});

test("BT-01 worker agrega miles de filas únicas sin cambiar la fórmula IMP-05", () => {
  const input = {
    campaignKey: "G0BM-202509",
    trdDate: "2025-09-01",
    sourceCounts: {},
    sourceFiles: [],
    rows: Array.from({ length: 5000 }, (_, index) => ({
      instrument: "ISIN-1",
      instrumentType: "Simple Instrument",
      trdDate: "2025-09-01",
      tmUtc: "2025-09-01T15:00:00Z",
      price: index + 1,
      bid: null,
      ask: null,
      rowHash: `row-${index}`,
    })),
  };
  const workerPath = new URL("../../operations/audit/BT-01/calculate-campaign-daily-proxies.mjs", import.meta.url);
  const result = spawnSync("node", [workerPath.pathname], { input: `${JSON.stringify(input)}\n`, encoding: "utf8" });

  assert.equal(result.status, 0, result.stderr);
  const daily = JSON.parse(result.stdout);
  assert.equal(daily.dailyReference, 2500.5);
  assert.deepEqual(daily.strictCounts, { trades: 5000, midpoints: 0 });
  assert.equal(daily.sourceRowHashCount, 5000);
});

test("BT-01 worker procesa filas por lotes y conserva el resultado y provenance", () => {
  const rows = Array.from({ length: 1200 }, (_, index) => ({
    instrument: "ISIN-1", instrumentType: "Simple Instrument", trdDate: "2025-09-01",
    tmUtc: "2025-09-01T15:00:00Z", price: index + 1, bid: null, ask: null, rowHash: `stream-${index}`,
  }));
  const header = { type: "begin", campaignKey: "G0BM-202509", trdDate: "2025-09-01" };
  const chunks = [header];
  for (let index = 0; index < rows.length; index += 128) {
    chunks.push({ type: "rows", campaignKey: "G0BM-202509", rows: rows.slice(index, index + 128) });
  }
  chunks.push({
    type: "end", campaignKey: "G0BM-202509", sourceCounts: { trades: { filesAvailable: 1, filesWithMaturityRows: 1 } },
    sourceFiles: [{ path: "fixture.parquet", sha256: "f".repeat(64) }], exclusions: {},
  });
  const workerPath = new URL("../../operations/audit/BT-01/calculate-campaign-daily-proxies.mjs", import.meta.url);
  const streamed = spawnSync("node", [workerPath.pathname], { input: `${chunks.map((record) => JSON.stringify(record)).join("\n")}\n`, encoding: "utf8" });
  assert.equal(streamed.status, 0, streamed.stderr);
  const daily = JSON.parse(streamed.stdout);
  assert.equal(daily.dailyReference, 600.5);
  assert.equal(daily.sourceRows, 1200);
  assert.equal(daily.sourceRowHashCount, 1200);
  assert.equal(daily.sourceFiles[0].path, "fixture.parquet");
  assert.deepEqual(daily.strictCounts, { trades: 1200, midpoints: 0 });
});

test("BT-01 worker activa el fallback IMP-05 cuando la ventana estricta no tiene datos utilizables", () => {
  const input = {
    campaignKey: "G0BM-202509",
    trdDate: "2025-09-01",
    sourceCounts: {},
    sourceFiles: [],
    rows: [{
      instrument: "ISIN-1",
      instrumentType: "Simple Instrument",
      trdDate: "2025-09-01",
      tmUtc: "2025-09-01T14:30:00Z", // 16:30 CEST: fallback, fuera del intervalo estricto.
      price: 42,
      bid: null,
      ask: null,
      rowHash: "row-fallback",
    }],
  };
  const workerPath = new URL("../../operations/audit/BT-01/calculate-campaign-daily-proxies.mjs", import.meta.url);
  const result = spawnSync("node", [workerPath.pathname], { input: `${JSON.stringify(input)}\n`, encoding: "utf8" });

  assert.equal(result.status, 0, result.stderr);
  const daily = JSON.parse(result.stdout);
  assert.equal(daily.dailyReference, 42);
  assert.equal(daily.windowUsed, "nearby-60m");
  assert.equal(daily.fallbackUsed, true);
  assert.deepEqual(daily.fallbackCounts, { trades: 1, midpoints: 0 });
});

test("BT-01 artifact y manifest reales son reproducibles y bound a hashes de inputs", () => {
  const rowsBytes = readFileSync(rowsArtifactPath);
  const rowsArtifact = JSON.parse(rowsBytes);
  const rowsArtifactSha256 = sha256(rowsBytes);
  const calendarBytes = readFileSync(new URL("../../operations/audit/IMP-09/eex-exchange-calendar.json", import.meta.url));
  const calendar = JSON.parse(calendarBytes);
  const artifact = buildCampaignBenchmarkArtifact({ rowsArtifact, rowsArtifactSha256, exchangeDays: calendar.exchangeDays, calendarSha256: sha256(calendarBytes) });
  const artifactBytes = Buffer.from(`${JSON.stringify(artifact, null, 2)}\n`);
  const artifactSha256 = sha256(artifactBytes);
  const manifest = buildCampaignBenchmarkManifest({ artifact, artifactSha256, rowsArtifact, rowsArtifactSha256 });

  assert.deepEqual(artifactBytes, readFileSync(artifactPath));
  assert.deepEqual(Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`), readFileSync(manifestPath));
  assert.equal(manifest.artifact.sha256, artifactSha256);
  assert.equal(manifest.inputs.rowsArtifact.sha256, rowsArtifactSha256);
  assert.ok(Object.keys(manifest.inputs.sourceFileHashes).length > 0);
  assert.ok(artifact.campaigns.some((campaign) => campaign.product === "G0BQ"));
  assert.ok(artifact.campaigns.some((campaign) => campaign.product === "G0BM"));
  assert.ok(artifact.campaigns.some((campaign) => Number.isFinite(campaign.benchmark.B)));

  const expectedCalendarDays = new Set(calendar.exchangeDays);
  for (const campaign of artifact.campaigns) {
    assert.deepEqual(campaign.expectedDates, calendar.exchangeDays.filter((date) => date >= campaign.benchmarkWindow.startInclusive && date < campaign.benchmarkWindow.endExclusive));
    assert.ok(campaign.expectedDates.every((date) => expectedCalendarDays.has(date)));
    assert.equal(campaign.benchmark.expectedDatesCount, campaign.expectedDates.length);
    assert.deepEqual(campaign.benchmark.missingDates, campaign.expectedDates.filter((date) => !campaign.perDate.some((record) => record.trdDate === date && record.defined)));
    assert.equal(campaign.status.status, campaign.benchmark.B === null ? "B_NOT_DEFINED" : "BENCHMARK_PROVISIONAL");
    assert.equal(campaign.status.officialDates, 0);
    assert.equal(campaign.reconciliation.equivalent, false);
    for (const dateRecord of campaign.perDate) {
      assert.match(dateRecord.sourceRowHashes.digest, /^[a-f0-9]{64}$/);
      assert.ok(dateRecord.sourceFiles.length > 0 || dateRecord.sourceRows === 0);
      for (const source of dateRecord.sourceFiles) {
        assert.equal(manifest.inputs.sourceFileHashes[source.path], source.sha256);
      }
    }
  }
});

test("BT-01 v2 worker: dedup por observationKey y ventana con fracción de segundo (BT04-C1-PROXY-WINDOW-DEDUP)", () => {
  const row = (over) => ({ instrument: "ISIN-1", instrumentType: "Simple Instrument", trdDate: "2025-09-01", bid: null, ask: null, ...over });
  const input = {
    campaignKey: "G0BQ-202601",
    trdDate: "2025-09-01",
    sourceCounts: {},
    sourceFiles: [],
    rows: [
      // Dos trades distintos (TrdID distinto) con igual Tm y precio: los dos cuentan.
      row({ tmUtc: "2025-09-01T15:05:00.1Z", price: 40, rowHash: "r1", observationKey: "trade-A" }),
      row({ tmUtc: "2025-09-01T15:05:00.1Z", price: 40, rowHash: "r2", observationKey: "trade-B" }),
      // Re-pull de trade-A con otro _row_sha256: es la misma observación.
      row({ tmUtc: "2025-09-01T15:05:00.1Z", price: 40, rowHash: "r3", observationKey: "trade-A" }),
      row({ tmUtc: "2025-09-01T15:10:00Z", price: 70, rowHash: "r4", observationKey: "trade-C" }),
      // 17:15:00.0004 CEST queda fuera de 17:00–17:15.
      row({ tmUtc: "2025-09-01T15:15:00.000400Z", price: 1000, rowHash: "r5", observationKey: "trade-D" }),
    ],
  };
  const workerPath = new URL("../../operations/audit/BT-01/calculate-campaign-daily-proxies.mjs", import.meta.url);
  const result = spawnSync("node", [workerPath.pathname], { input: `${JSON.stringify(input)}\n`, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  const daily = JSON.parse(result.stdout);
  assert.deepEqual(daily.strictCounts, { trades: 3, midpoints: 0 });
  assert.equal(daily.dailyReference, 50);
});

test("BT-01 v1 se conserva reproducible y v2 lo referencia por hash", () => {
  const v1Bytes = readFileSync(new URL(`../../${VERSIONS.v1.artifact}`, import.meta.url));
  const v2 = JSON.parse(readFileSync(new URL(`../../${VERSIONS.v2.artifact}`, import.meta.url)));
  assert.deepEqual(v2.supersedes.path, VERSIONS.v1.artifact);
  assert.equal(v2.supersedes.sha256, sha256(v1Bytes));
  assert.equal(v2.methodologyVersion, 2);
  for (const campaign of v2.campaigns) assert.equal(campaign.benchmarkVersion.versionTag, "BT-01-IMP-05-campaign-proxy-2");
  const v2Manifest = JSON.parse(readFileSync(new URL(`../../${VERSIONS.v2.manifest}`, import.meta.url)));
  assert.equal(v2Manifest.artifact.path, VERSIONS.v2.artifact);
  assert.deepEqual(v2Manifest.supersedes, v2.supersedes);
});

test("BT-01 v2 artifact y manifest reales son reproducibles desde su extracción v2", () => {
  const release = VERSIONS.v2;
  const rowsBytes = readFileSync(new URL(`../../${release.rowsArtifact}`, import.meta.url));
  const rowsArtifact = JSON.parse(rowsBytes);
  assert.equal(rowsArtifact.methodologyVersion, 2);
  assert.equal(rowsArtifact.campaignPopulation.path, "operations/exploratory/v2/backtest-results.json");
  const calendarBytes = readFileSync(new URL("../../operations/audit/IMP-09/eex-exchange-calendar.json", import.meta.url));
  const artifact = buildCampaignBenchmarkArtifact({
    rowsArtifact,
    rowsArtifactSha256: sha256(rowsBytes),
    exchangeDays: JSON.parse(calendarBytes).exchangeDays,
    calendarSha256: sha256(calendarBytes),
    release,
    supersededSha256: sha256(readFileSync(new URL(`../../${release.supersedes}`, import.meta.url))),
  });
  const artifactBytes = Buffer.from(`${JSON.stringify(artifact, null, 2)}\n`);
  assert.deepEqual(artifactBytes, readFileSync(new URL(`../../${release.artifact}`, import.meta.url)));
  const manifest = buildCampaignBenchmarkManifest({ artifact, artifactSha256: sha256(artifactBytes), rowsArtifact, rowsArtifactSha256: sha256(rowsBytes), release });
  assert.deepEqual(Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`), readFileSync(new URL(`../../${release.manifest}`, import.meta.url)));
});
