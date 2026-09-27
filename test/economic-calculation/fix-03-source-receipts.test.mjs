import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { buildLakeBenchmarkReceipt } from "../../operations/audit/IMP-05/build-lake-benchmark.mjs";
import { buildCampaignBenchmarkArtifact, VERSIONS } from "../../operations/audit/BT-01/build-campaign-benchmarks.mjs";

const sourceCoverage = { path: "operations/trades/DATA-02/SOURCE_PERIOD_COVERAGE.json",
  sha256: "a".repeat(64), manifestSha256: "b".repeat(64) };

test("FIX-03: IMP-05 v3 preserves a DATA_INCOMPLETE date in coverage and reconciliation", () => {
  const old = JSON.parse(readFileSync("operations/audit/IMP-05/lake-proxy-rows-IMP-05-v2.json", "utf8"));
  const [first, second] = old.perDate;
  const rows = { ...old, artifactKind: "IMP-05_SOURCE_PROXY_ROWS", sourceCoverage,
    sourceSelection: "DATA-02 complete-day patch.days; DATA_INCOMPLETE has no rows",
    perDate: [{ ...first, selectedSource: "CLIENT_SEALED_ARCHIVE", sourceFiles: [] },
      { ...second, selectedSource: "DATA_INCOMPLETE", sourceFiles: [], contract: null, rows: [], reason: "No verified source" }] };
  const receipt = buildLakeBenchmarkReceipt({ rowsArtifact: rows, rowsArtifactSha256: "c".repeat(64),
    release: "v3", supersededSha256: "d".repeat(64) });
  assert.equal(receipt.benchmark.expectedDatesCount, 2);
  assert.deepEqual(receipt.calendarMissingDates, [second.trdDate]);
  assert.equal(receipt.perDate[1].selectedSource, "DATA_INCOMPLETE");
  assert.equal(receipt.perDate[1].dailyReference, null);
  assert.equal(receipt.sourceCoverage.sha256, sourceCoverage.sha256);
  assert.equal(receipt.reconciliation.equivalent, false);
});

test("FIX-03: BT-01 v3 cannot turn an incomplete day into a B input", () => {
  const old = JSON.parse(readFileSync("operations/audit/BT-01/v2/campaign-proxy-rows-BT-01.json", "utf8"));
  const calendarBytes = readFileSync("operations/audit/IMP-09/eex-exchange-calendar.json");
  const calendarSha256 = createHash("sha256").update(calendarBytes).digest("hex");
  const campaign = structuredClone(old.campaigns[0]);
  const definedIndex = campaign.perDate.findIndex((day) => day.defined === true);
  assert.ok(definedIndex >= 0);
  campaign.perDate = campaign.perDate.map((day, index) => ({ ...day,
    selectedSource: index === definedIndex ? "DATA_INCOMPLETE" : "CLIENT_SEALED_ARCHIVE" }));
  const rows = { ...old, sourceCoverage,
    sourceSelection: "DATA-02 complete-day patch.days; DATA_INCOMPLETE has no rows", campaigns: [campaign] };
  const artifact = buildCampaignBenchmarkArtifact({ rowsArtifact: rows, rowsArtifactSha256: "c".repeat(64),
    exchangeDays: JSON.parse(calendarBytes).exchangeDays, calendarSha256,
    release: VERSIONS.v3, supersededSha256: "d".repeat(64) });
  assert.equal(artifact.campaigns[0].perDate[definedIndex].selectedSource, "DATA_INCOMPLETE");
  assert.equal(artifact.campaigns[0].perDate[definedIndex].defined, false);
  assert.equal(artifact.campaigns[0].perDate[definedIndex].dailyReference, null);
  assert.equal(artifact.sourceCoverage.sha256, sourceCoverage.sha256);
});
