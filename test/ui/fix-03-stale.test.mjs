import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { assessBenchmarkFreshness } from "../../src/ui/benchmark-freshness.mjs";
import { BT02_MANIFEST_PATH, loadCanonicalUiInputs } from "../../src/ui/canonical-inputs.mjs";
import { buildUiViewModels } from "../../src/ui/server.mjs";
import { renderBacktestsPage } from "../../src/ui/render.mjs";

test("FIX-03: old lake BT-01 and IMP-05 releases are source-stale even when hashes verify", () => {
  const manifest = JSON.parse(readFileSync(BT02_MANIFEST_PATH, "utf8"));
  const status = assessBenchmarkFreshness(process.cwd(), manifest);
  assert.equal(status.status, "STALE");
  assert.deepEqual(status.staleArtifacts, ["BT-01-CAMPAIGN-BENCHMARKS", "IMP-05-LAKE-PROXY-ROWS"]);
  const canonical = loadCanonicalUiInputs();
  assert.equal(canonical.backend.backtestReadiness.loaded, false);
  assert.equal(canonical.backend.backtestReadiness.code, "STALE");
  const html = renderBacktestsPage(buildUiViewModels(canonical.inputs).backtests);
  assert.match(html, /data-source-status="STALE"/);
  assert.match(html, /data-kind="backend-measurements" data-status="STALE"/);
  assert.match(html, /Historical exploratory figures below are stale/);
  assert.doesNotMatch(html, /data-kind="backend-measurements"[\s\S]*data-status="BENCHMARK_PROVISIONAL"/);
});

test("FIX-03: a different benchmark path alone cannot mark old data current", () => {
  const manifest = JSON.parse(readFileSync(BT02_MANIFEST_PATH, "utf8"));
  manifest.inputs.bt01Benchmark.path = "operations/audit/BT-01/v3/unverified.json";
  const status = assessBenchmarkFreshness(process.cwd(), manifest);
  assert.equal(status.status, "UNAVAILABLE");
  assert.match(status.reason, /lake measurement is pending/);
});
