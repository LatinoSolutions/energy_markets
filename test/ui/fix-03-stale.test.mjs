import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { assessBenchmarkFreshness } from "../../src/ui/benchmark-freshness.mjs";
import { buildUiViewModels } from "../../src/ui/server.mjs";
import { projectBacktestReadiness } from "../../src/ui/view-models.mjs";
import { renderBacktestsPage } from "../../src/ui/render.mjs";

const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const decisionPath = "operations/trades/TR-01/DATA_SOURCE_DECISION.json";
const coveragePath = "operations/trades/DATA-02/SOURCE_PERIOD_COVERAGE.json";

function staleFixture(root) {
  function put(relative, value) {
    const bytes = Buffer.from(JSON.stringify(value));
    const target = path.join(root, relative);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, bytes);
    return sha(bytes);
  }
  const decisionSha = put(decisionPath, { status: "DECIDED", staleArtifacts: [
    { id: "BT-01-CAMPAIGN-BENCHMARKS", paths: ["old-lake-b.json"] },
    { id: "IMP-05-LAKE-PROXY-ROWS", paths: ["old-lake-rows.json"] },
  ] });
  put(`${decisionPath.replace(/\.json$/, "")}.MANIFEST.json`, { artifact: { path: decisionPath, sha256: decisionSha } });
  const coverageSha = put(coveragePath, { ownerDecision: { status: "PARCHE_VERIFICADO", verificationStatus: "PENDING_LAKE_MEASUREMENT" } });
  put(`${coveragePath.replace(/\.json$/, "")}.MANIFEST.json`, { artifact: { path: coveragePath, sha256: coverageSha },
    inputs: { tr01Decision: { path: decisionPath, sha256: decisionSha } } });
  return { inputs: { bt01Benchmark: { path: "old-lake-b.json" } } };
}

test("FIX-03: old lake releases stay stale after DATA-02 changes source", () => {
  const root = mkdtempSync(path.join(tmpdir(), "fix03-stale-"));
  try {
    const status = assessBenchmarkFreshness(root, staleFixture(root));
    assert.equal(status.status, "STALE");
    assert.deepEqual(status.staleArtifacts, ["BT-01-CAMPAIGN-BENCHMARKS", "IMP-05-LAKE-PROXY-ROWS"]);
    const vm = buildUiViewModels({}).backtests;
    vm.sourceFreshness = status;
    vm.measurementReadiness = projectBacktestReadiness({ sourceFreshness: status });
    const html = renderBacktestsPage(vm);
    assert.match(html, /data-source-status="STALE"/);
    assert.match(html, /data-kind="backend-measurements" data-status="STALE"/);
    assert.match(html, /Historical exploratory figures below are stale/);
    assert.doesNotMatch(html, /data-kind="backend-measurements"[\s\S]*data-status="BENCHMARK_PROVISIONAL"/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("FIX-03: a different benchmark path alone cannot mark old data current", () => {
  const root = mkdtempSync(path.join(tmpdir(), "fix03-stale-"));
  try {
    const manifest = staleFixture(root);
    manifest.inputs.bt01Benchmark.path = "operations/audit/BT-01/v3/unverified.json";
    const status = assessBenchmarkFreshness(root, manifest);
    assert.equal(status.status, "UNAVAILABLE");
    assert.match(status.reason, /lake measurement is pending/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
