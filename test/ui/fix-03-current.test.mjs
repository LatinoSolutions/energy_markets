import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { assessBenchmarkFreshness } from "../../src/ui/benchmark-freshness.mjs";
import { BT02_CURRENT_RELEASE, BT02_RELEASES } from "../../src/exploratory/reconciliation.mjs";
import { BT02_MANIFEST_PATH, loadCanonicalUiInputs } from "../../src/ui/canonical-inputs.mjs";

const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const P = {
  decision: "operations/trades/TR-01/DATA_SOURCE_DECISION.json",
  decisionManifest: "operations/trades/TR-01/DATA_SOURCE_DECISION.MANIFEST.json",
  coverage: "operations/trades/DATA-02/SOURCE_PERIOD_COVERAGE.json",
  coverageManifest: "operations/trades/DATA-02/SOURCE_PERIOD_COVERAGE.MANIFEST.json",
  rows: "operations/audit/BT-01/v3/campaign-proxy-rows-BT-01.json",
  bt01: "operations/audit/BT-01/v3/campaign-provisional-benchmarks-BT-01.json",
  bt01Manifest: "operations/audit/BT-01/v3/campaign-provisional-benchmarks-BT-01.MANIFEST.json",
  impRows: "operations/audit/IMP-05/source-proxy-rows-IMP-05-v3.json",
  impReceipt: "operations/audit/IMP-05/source-benchmark-receipt-IMP-05-v3.json",
  bt02: "operations/exploratory/v3/reconciled-results-BT-02.json",
  bt02Manifest: "operations/exploratory/v3/reconciled-results-BT-02.MANIFEST.json",
};

function fixture(root, selectedSource = "CLIENT_SEALED_ARCHIVE") {
  const put = (relative, value) => {
    const bytes = Buffer.from(JSON.stringify(value));
    const target = path.join(root, relative);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, bytes);
    return sha(bytes);
  };
  const decisionSha = put(P.decision, { status: "DECIDED", staleArtifacts: [
    { id: "BT-01-CAMPAIGN-BENCHMARKS", paths: ["old-lake-b.json"] },
    { id: "IMP-05-LAKE-PROXY-ROWS", paths: ["old-lake-rows.json"] },
  ] });
  put(P.decisionManifest, { artifact: { path: P.decision, sha256: decisionSha } });
  const coverageSha = put(P.coverage, { ownerDecision: { status: "PARCHE_VERIFICADO", verificationStatus: "RULE_APPLIED" },
    campaigns: [{ market: "GAS_THE", shortCode: "G0BQ", windowStart: "2025-01-01", windowEnd: "2025-01-31",
      patch: { days: [{ day: "2025-01-02", source: "CLIENT_SEALED_ARCHIVE" }] } }] });
  const coverageManifestSha = put(P.coverageManifest, { artifact: { path: P.coverage, sha256: coverageSha },
    inputs: { tr01Decision: { path: P.decision, sha256: decisionSha } } });
  const sourceCoverage = { path: P.coverage, sha256: coverageSha, manifestSha256: coverageManifestSha };
  const day = { trdDate: "2025-01-02", selectedSource, defined: false, dailyReference: null,
    sourceFiles: [{ path: `${selectedSource}/data/lake/v1/table=eex_derivative_trade/cmdty=NATGAS/area=THE/trd_date=2025-01-02/pull_id=fixture/part.parquet`, sha256: "f".repeat(64) }] };
  const rowsSha = put(P.rows, { artifactKind: "BT-01_CAMPAIGN_PROXY_ROWS", sourceCoverage, sourceFileHashes: { [day.sourceFiles[0].path]: day.sourceFiles[0].sha256 },
    campaigns: [{ campaignKey: "G0BQ-202502", product: "G0BQ", windowStart: "2025-01-01", windowEnd: "2025-02-01", perDate: [day] }] });
  const bt01Sha = put(P.bt01, { artifactKind: "BT-01_CAMPAIGN_PROVISIONAL_BENCHMARKS", sourceCoverage, sourceArtifact: { path: P.rows, sha256: rowsSha },
    campaigns: [{ campaignKey: "G0BQ-202502", product: "G0BQ", benchmarkWindow: { startInclusive: "2025-01-01", endExclusive: "2025-02-01" }, perDate: [day] }] });
  const bt01ManifestSha = put(P.bt01Manifest, { artifact: { path: P.bt01, sha256: bt01Sha }, inputs: { rowsArtifact: { path: P.rows, sha256: rowsSha } } });
  const impRowsSha = put(P.impRows, { artifactKind: "IMP-05_SOURCE_PROXY_ROWS", sourceCoverage, perDate: [day] });
  put(P.impReceipt, { artifactKind: "IMP-05_SOURCE_PROXY_BENCHMARK_RECEIPT", sourceCoverage, rowsArtifact: { path: P.impRows, sha256: impRowsSha }, perDate: [day] });
  const bt02Sha = put(P.bt02, { artifactKind: "BT-02_EXPLORATORY_BENCHMARK_RECONCILIATION" });
  const bt02Manifest = { artifact: { path: P.bt02, sha256: bt02Sha },
    inputs: { bt01Benchmark: { path: P.bt01, sha256: bt01Sha }, bt01Manifest: { path: P.bt01Manifest, sha256: bt01ManifestSha } } };
  put(P.bt02Manifest, bt02Manifest);
  return bt02Manifest;
}

test("FIX-03: CURRENT requires hash-bound BT-01, BT-02, IMP-05 and DATA-02 day selection", () => {
  const root = mkdtempSync(path.join(tmpdir(), "fix03-current-"));
  try {
    const manifest = fixture(root);
    assert.equal(assessBenchmarkFreshness(root, manifest).status, "CURRENT");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("FIX-03: matching release hashes cannot bless a day selected from the wrong source", () => {
  const root = mkdtempSync(path.join(tmpdir(), "fix03-current-"));
  try {
    const manifest = fixture(root, "EEX_LAKE_PATCH");
    assert.equal(assessBenchmarkFreshness(root, manifest).status, "UNAVAILABLE");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("FIX-03: the published v3 release is current in the UI and backend", () => {
  assert.equal(BT02_CURRENT_RELEASE, "v3");
  assert.equal(BT02_MANIFEST_PATH, BT02_RELEASES.v3.manifest);
  const canonical = loadCanonicalUiInputs();
  assert.equal(canonical.backend.backtestReadiness.loaded, true);
  assert.equal(canonical.backend.exploratory.sourceStatus, "CURRENT");
  assert.equal(canonical.inputs.backtestReadiness.sourceFreshness.status, "CURRENT");
});
