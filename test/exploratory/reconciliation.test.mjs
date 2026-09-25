import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { buildBt02Manifest, buildBt02Reconciliation, sha256Hex } from "../../src/exploratory/reconciliation.mjs";

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

test("BT-02 retiene H base, fees UNKNOWN/excluded y calcula V/DeltaV contra B provisional", () => {
  const { results, benchmarkArtifact } = fixture();
  const artifact = buildBt02Reconciliation({ results, benchmarkArtifact, resultsSha256: "r".repeat(64), resultsManifestSha256: "m".repeat(64), benchmarkSha256: "b".repeat(64), benchmarkManifestSha256: "n".repeat(64) });
  const campaign = artifact.campaigns[0];
  assert.equal(campaign.benchmark.B, 12);
  assert.deepEqual(campaign.fees, { status: "UNKNOWN", included: false });
  assert.equal(campaign.arms.ARM_A.hEurMwh, 11);
  assert.equal(campaign.arms.ARM_A.hCostCompleteness, "PARTIAL");
  assert.equal(campaign.arms.ARM_A.vEur, 40);
  assert.equal(campaign.arms.ARM_A.vStatus, "PROVISIONAL");
  assert.equal(campaign.arms.ARM_A.deltaVEur, -40);
  assert.equal(campaign.arms.ARM_A.deltaVStatus, "PROVISIONAL");
  assert.match(campaign.arms.ARM_A.hCostReason, /UNKNOWN/);
});

test("BT-02 conserva V parcial por fills DEPTH incompletos y omite DeltaV si el volumen no está emparejado", () => {
  const { results, benchmarkArtifact } = fixture({ armFilledMw: 2 });
  results.campaigns[0].runs[1].hEurMwh = 11;
  const artifact = buildBt02Reconciliation({ results, benchmarkArtifact, resultsSha256: "r".repeat(64), resultsManifestSha256: "m".repeat(64), benchmarkSha256: "b".repeat(64), benchmarkManifestSha256: "n".repeat(64) });
  const arm = artifact.campaigns[0].arms.ARM_A;
  assert.equal(arm.complete, false);
  assert.equal(arm.vEur, 20);
  assert.equal(arm.vStatus, "PARTIAL");
  assert.equal(arm.deltaVEur, null);
  assert.equal(arm.deltaVStatus, "UNAVAILABLE");
  assert.match(arm.deltaVReason, /equal filled MW/);
});

test("BT-02 fails closed when exact campaign B is undefined", () => {
  const { results, benchmarkArtifact } = fixture({ benchmarkB: null, benchmarkStatus: "B_NOT_DEFINED" });
  const artifact = buildBt02Reconciliation({ results, benchmarkArtifact, resultsSha256: "r".repeat(64), resultsManifestSha256: "m".repeat(64), benchmarkSha256: "b".repeat(64), benchmarkManifestSha256: "n".repeat(64) });
  const arm = artifact.campaigns[0].arms.ARM_A;
  assert.equal(artifact.campaigns[0].benchmark.B, null);
  assert.equal(arm.vEur, null);
  assert.equal(arm.vStatus, "UNAVAILABLE");
});

test("BT-02 real artifact is reproducible and manifest binds its output", () => {
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
  assert.equal(manifest.artifact.sha256, sha256Hex(outputBytes));
  assert.deepEqual(artifact.inputs.exploratoryResults, {
    path: "operations/exploratory/backtest-results.json", sha256: sha256Hex(resultBytes),
  });
  assert.equal(artifact.inputs.exploratoryManifest.sha256, sha256Hex(resultsManifestBytes));
  assert.equal(artifact.inputs.bt01Manifest.sha256, sha256Hex(benchmarkManifestBytes));
  assert.equal(artifact.campaigns.find((campaign) => campaign.campaignKey === "G0BM-202510").arms.ARM_B.decisionLedgerCheck, "NOT_AVAILABLE_IN_REPLAY");
  assert.equal(artifact.campaigns.length, results.campaigns.length);
  assert.ok(artifact.campaigns.every((campaign) => Object.values(campaign.arms).every((arm) => arm.hCostCompleteness === "PARTIAL")));
  const generated = spawnSync("node", [new URL("../../operations/exploratory/reconcile-bt02.mjs", import.meta.url).pathname], { encoding: "utf8" });
  assert.equal(generated.status, 0, generated.stderr);
});
