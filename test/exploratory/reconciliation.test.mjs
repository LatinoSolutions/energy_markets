import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { BT02_RELEASES, buildBt02Manifest, buildBt02Reconciliation, sha256Hex } from "../../src/exploratory/reconciliation.mjs";

function fixture({ armFilledMw = 4, benchmarkB = 12, benchmarkStatus = "BENCHMARK_PROVISIONAL" } = {}) {
  const baseline = [
    { day: "2025-09-01", filledMw: 2, priceEurMwh: 10 },
    { day: "2025-09-02", filledMw: 2, priceEurMwh: 10 },
  ];
  const arm = [
    { day: "2025-09-01", filledMw: 1, priceEurMwh: 11 },
    { day: "2025-09-02", filledMw: armFilledMw - 1, priceEurMwh: 11 },
  ];
  return {
    results: {
      artifactKind: "EXPLORATORY_BACKTEST_RESULTS",
      rules: { slippageEurMwh: 0.15, feesEurMwh: "UNKNOWN (no incluidos)", fillModels: { CLIENT: "full quantity", DEPTH: "visible AskSz" } },
      campaigns: [{
        id: "GAS-M-202510", product: "G0BM", maturity: "202510", targetMw: 4, readiness: "EXPLORATORY_COMPLETE",
        runs: [
          { armId: "BASELINE", status: "COMPLETE", boughtMw: 4, hEurMwh: 10 },
          { armId: "ARM_A", status: armFilledMw === 4 ? "COMPLETE" : "INCOMPLETE", boughtMw: armFilledMw, hEurMwh: 11 },
        ],
      }],
      replay: [{ product: "G0BM", maturity: "202510", hours: 10, decisions: { BASELINE: baseline, ARM_A: arm } }],
    },
    benchmarkArtifact: {
      artifactKind: "BT-01_CAMPAIGN_PROVISIONAL_BENCHMARKS",
      campaigns: [{ campaignKey: "G0BM-202510", benchmark: { B: benchmarkB, coverage: "2/3" }, benchmarkVersion: { versionId: "version-1" },
        benchmarkWindow: { rule: "1-0-1" }, status: { status: benchmarkStatus } }],
    },
  };
}

test("BT-02 retiene H base, fees UNKNOWN/excluded y calcula V/DeltaV unitarios contra B provisional", () => {
  const { results, benchmarkArtifact } = fixture();
  const artifact = buildBt02Reconciliation({ results, benchmarkArtifact, resultsSha256: "r".repeat(64), resultsManifestSha256: "m".repeat(64), benchmarkSha256: "b".repeat(64), benchmarkManifestSha256: "n".repeat(64) });
  const campaign = artifact.campaigns[0];
  assert.equal(campaign.benchmark.B, 12);
  assert.deepEqual(campaign.fees, { status: "UNKNOWN", included: false });
  assert.equal(campaign.arms.ARM_A.hEurMwh, 11);
  assert.equal(campaign.arms.ARM_A.hCostCompleteness, "PARTIAL");
  assert.equal(campaign.arms.ARM_A.vEurMwh, 1);
  assert.equal(campaign.arms.ARM_A.vStatus, "PROVISIONAL");
  assert.equal(campaign.arms.ARM_A.deltaVEurMwh, -1);
  assert.equal(campaign.arms.ARM_A.deltaVStatus, "PROVISIONAL");
  assert.equal(campaign.arms.ARM_A.fillModel, "CLIENT");
  assert.equal("vEur" in campaign.arms.ARM_A, false);
  assert.match(campaign.arms.ARM_A.hCostReason, /UNKNOWN/);
});

test("BT-02 reports incomplete coverage separately from V and omits DeltaV for unmatched volume", () => {
  const { results, benchmarkArtifact } = fixture({ armFilledMw: 2 });
  results.campaigns[0].runs[1].hEurMwh = 11;
  const artifact = buildBt02Reconciliation({ results, benchmarkArtifact, resultsSha256: "r".repeat(64), resultsManifestSha256: "m".repeat(64), benchmarkSha256: "b".repeat(64), benchmarkManifestSha256: "n".repeat(64) });
  const arm = artifact.campaigns[0].arms.ARM_A;
  assert.equal(arm.complete, false);
  assert.equal(arm.vEurMwh, null);
  assert.equal(arm.vStatus, "PARTIAL");
  assert.equal(arm.deltaVEurMwh, null);
  assert.equal(arm.deltaVStatus, "UNAVAILABLE");
  assert.match(arm.deltaVReason, /equal filled MW/);
});

test("BT-02 fails closed when exact campaign B is undefined", () => {
  const { results, benchmarkArtifact } = fixture({ benchmarkB: null, benchmarkStatus: "B_NOT_DEFINED" });
  const artifact = buildBt02Reconciliation({ results, benchmarkArtifact, resultsSha256: "r".repeat(64), resultsManifestSha256: "m".repeat(64), benchmarkSha256: "b".repeat(64), benchmarkManifestSha256: "n".repeat(64) });
  const arm = artifact.campaigns[0].arms.ARM_A;
  assert.equal(artifact.campaigns[0].benchmark.B, null);
  assert.equal(arm.vEurMwh, null);
  assert.equal(arm.vStatus, "UNAVAILABLE");
});

test("BT-02 labels real CLIENT/DEPTH fill modes and preserves incomplete DEPTH outcomes", () => {
  const resultBytes = readFileSync(new URL("../../operations/exploratory/backtest-results.json", import.meta.url));
  const resultsManifestBytes = readFileSync(new URL("../../operations/exploratory/MANIFEST.json", import.meta.url));
  const benchmarkBytes = readFileSync(new URL("../../operations/audit/BT-01/campaign-provisional-benchmarks-BT-01.json", import.meta.url));
  const benchmarkManifestBytes = readFileSync(new URL("../../operations/audit/BT-01/campaign-provisional-benchmarks-BT-01.MANIFEST.json", import.meta.url));
  const artifact = buildBt02Reconciliation({
    results: JSON.parse(resultBytes), benchmarkArtifact: JSON.parse(benchmarkBytes),
    resultsSha256: sha256Hex(resultBytes), resultsManifestSha256: sha256Hex(resultsManifestBytes),
    benchmarkSha256: sha256Hex(benchmarkBytes), benchmarkManifestSha256: sha256Hex(benchmarkManifestBytes),
  });
  const byKey = new Map(artifact.campaigns.map((campaign) => [campaign.campaignKey, campaign]));
  for (const [campaignKey, boughtMw] of [["G0BM-202602", 2], ["G0BM-202606", 5]]) {
    const arm = byKey.get(campaignKey).arms["ARM_A@DEPTH"];
    assert.equal(arm.fillModel, "DEPTH");
    assert.equal(arm.sourceArmId, "DIP10@11:00/DEPTH");
    assert.equal(arm.boughtMw, boughtMw);
    assert.equal(arm.targetMw, 10);
    assert.equal(arm.vStatus, "PARTIAL");
    assert.equal(arm.vEurMwh, null);
    assert.equal(arm.coverageCompleteness, "PARTIAL");
  }
  assert.ok(artifact.campaigns.every((campaign) => Object.values(campaign.arms).every((arm) => ["CLIENT", "DEPTH"].includes(arm.fillModel))));
  assert.ok(artifact.campaigns.some((campaign) => campaign.arms.ARM_A?.fillModel === "CLIENT"));
});

test("BT-02 real artifact and both output manifests reproduce byte-for-byte without writing files", () => {
  const resultBytes = readFileSync(new URL("../../operations/exploratory/backtest-results.json", import.meta.url));
  const resultsManifestBytes = readFileSync(new URL("../../operations/exploratory/MANIFEST.json", import.meta.url));
  const benchmarkBytes = readFileSync(new URL("../../operations/audit/BT-01/campaign-provisional-benchmarks-BT-01.json", import.meta.url));
  const benchmarkManifestBytes = readFileSync(new URL("../../operations/audit/BT-01/campaign-provisional-benchmarks-BT-01.MANIFEST.json", import.meta.url));
  const results = JSON.parse(resultBytes);
  const benchmarkArtifact = JSON.parse(benchmarkBytes);
  const artifact = buildBt02Reconciliation({
    results, benchmarkArtifact, resultsSha256: sha256Hex(resultBytes), resultsManifestSha256: sha256Hex(resultsManifestBytes),
    benchmarkSha256: sha256Hex(benchmarkBytes), benchmarkManifestSha256: sha256Hex(benchmarkManifestBytes),
  });
  const artifactBytes = Buffer.from(`${JSON.stringify(artifact, null, 2)}\n`);
  const outputBytes = readFileSync(new URL("../../operations/exploratory/reconciled-results-BT-02.json", import.meta.url));
  assert.deepEqual(artifactBytes, outputBytes);
  const manifest = buildBt02Manifest({ artifact, artifactSha256: sha256Hex(artifactBytes) });
  const outputManifestBytes = readFileSync(new URL("../../operations/exploratory/reconciled-results-BT-02.MANIFEST.json", import.meta.url));
  assert.deepEqual(Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`), outputManifestBytes);
  assert.equal(manifest.artifact.sha256, sha256Hex(outputBytes));
  for (const campaign of artifact.campaigns) {
    for (const [armId, arm] of Object.entries(campaign.arms)) {
      if (arm.vEurMwh !== null) assert.equal(arm.vEurMwh, campaign.benchmark.B - arm.hEurMwh, `${campaign.campaignKey}/${armId} V unit formula`);
      if (arm.deltaVEurMwh !== null) {
        const baselineId = arm.fillModel === "DEPTH" ? "BASELINE@DEPTH" : "BASELINE";
        assert.equal(arm.deltaVEurMwh, campaign.arms[baselineId].hEurMwh - arm.hEurMwh, `${campaign.campaignKey}/${armId} Delta V unit formula`);
      }
      assert.equal("vEur" in arm, false, `${campaign.campaignKey}/${armId} must not report unreconciled total EUR`);
    }
  }
  assert.deepEqual(artifact.inputs.exploratoryResults, {
    path: "operations/exploratory/backtest-results.json", sha256: sha256Hex(resultBytes),
  });
  assert.equal(artifact.inputs.exploratoryManifest.sha256, sha256Hex(resultsManifestBytes));
  assert.equal(artifact.inputs.bt01Manifest.sha256, sha256Hex(benchmarkManifestBytes));
  assert.equal(artifact.campaigns.find((campaign) => campaign.campaignKey === "G0BM-202510").arms.ARM_B.decisionLedgerCheck, "NOT_AVAILABLE_IN_REPLAY");
  assert.equal(artifact.campaigns.length, results.campaigns.length);
  assert.ok(artifact.campaigns.every((campaign) => Object.values(campaign.arms).every((arm) => arm.hCostCompleteness === "PARTIAL")));
});

test("BT-02 v2 reproduces byte-for-byte from the v2 backtest and v2 BT-01, and keeps v1 untouched", () => {
  const release = BT02_RELEASES.v2;
  const read = (relativePath) => readFileSync(new URL(`../../${relativePath}`, import.meta.url));
  const resultBytes = read(release.exploratoryResults);
  const resultsManifestBytes = read(release.exploratoryManifest);
  const benchmarkBytes = read(release.bt01Benchmark);
  const benchmarkManifestBytes = read(release.bt01Manifest);
  const artifact = buildBt02Reconciliation({
    results: JSON.parse(resultBytes), benchmarkArtifact: JSON.parse(benchmarkBytes),
    resultsSha256: sha256Hex(resultBytes), resultsManifestSha256: sha256Hex(resultsManifestBytes),
    benchmarkSha256: sha256Hex(benchmarkBytes), benchmarkManifestSha256: sha256Hex(benchmarkManifestBytes),
    release, supersededSha256: sha256Hex(read(release.supersedes)),
  });
  const artifactBytes = Buffer.from(`${JSON.stringify(artifact, null, 2)}\n`);
  assert.deepEqual(artifactBytes, read(release.artifact));
  const manifest = buildBt02Manifest({ artifact, artifactSha256: sha256Hex(artifactBytes), release });
  assert.deepEqual(Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`), read(release.manifest));
  assert.deepEqual(artifact.supersedes, { path: BT02_RELEASES.v1.artifact, sha256: sha256Hex(read(BT02_RELEASES.v1.artifact)) });
  // v1 still verifies against its own manifest: nothing accepted was overwritten.
  const v1Manifest = JSON.parse(read(BT02_RELEASES.v1.manifest));
  assert.equal(v1Manifest.artifact.sha256, sha256Hex(read(BT02_RELEASES.v1.artifact)));
  for (const input of Object.values(v1Manifest.inputs)) assert.equal(input.sha256, sha256Hex(read(input.path)), input.path);
});
