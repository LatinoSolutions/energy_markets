import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import {
  buildCampaignBenchmarkArtifact,
  buildCampaignBenchmarkManifest,
  rowsArtifactPath,
  artifactPath,
  manifestPath,
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

test("BT-01 produce B con ventana 3-1-3, peso diario igual y missing sin rellenar", () => {
  const rowsArtifact = fixture();
  const artifact = buildCampaignBenchmarkArtifact({ rowsArtifact, rowsArtifactSha256: "x".repeat(64) });
  const [campaign] = artifact.campaigns;

  assert.deepEqual(campaign.benchmarkWindow, { rule: "3-1-3", startInclusive: "2025-09-01", endExclusive: "2025-12-01" });
  assert.equal(campaign.benchmark.B, 55); // Daily references are 50 and 60; missing day is not a zero.
  assert.equal(campaign.benchmark.coverage, "2/3");
  assert.deepEqual(campaign.benchmark.missingDates, ["2025-09-03"]);
  assert.equal(campaign.perDate[2].dailyReference, null);
});

test("BT-01 mantiene proxy provisional separado de official y rechaza identidad ambigua", () => {
  const artifact = buildCampaignBenchmarkArtifact({ rowsArtifact: fixture({ instruments: ["ISIN-1", "ISIN-2"] }), rowsArtifactSha256: "x".repeat(64) });
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
  const artifact = buildCampaignBenchmarkArtifact({ rowsArtifact: fixture({ includeUnknownInstrument: true }), rowsArtifactSha256: "x".repeat(64) });
  const [campaign] = artifact.campaigns;

  assert.equal(campaign.perDate[0].dailyReference, 50);
  assert.equal(campaign.perDate[0].excludedRowsUnsupportedInstrument, 1);
});

test("BT-01 artifact y manifest reales son reproducibles y bound a hashes de inputs", () => {
  const rowsBytes = readFileSync(rowsArtifactPath);
  const rowsArtifact = JSON.parse(rowsBytes);
  const rowsArtifactSha256 = sha256(rowsBytes);
  const artifact = buildCampaignBenchmarkArtifact({ rowsArtifact, rowsArtifactSha256 });
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

  const calendar = JSON.parse(readFileSync(new URL("../../operations/audit/IMP-09/eex-exchange-calendar.json", import.meta.url)));
  const expectedCalendarDays = new Set(calendar.exchangeDays);
  for (const campaign of artifact.campaigns) {
    assert.ok(campaign.expectedDates.every((date) => expectedCalendarDays.has(date)));
    assert.equal(campaign.benchmark.expectedDatesCount, campaign.expectedDates.length);
    assert.deepEqual(campaign.benchmark.missingDates, campaign.expectedDates.filter((date) => !campaign.perDate.some((record) => record.trdDate === date && record.defined)));
    assert.equal(campaign.status.status, "BENCHMARK_PROVISIONAL");
    assert.equal(campaign.status.officialDates, 0);
    assert.equal(campaign.reconciliation.equivalent, false);
  }
});
