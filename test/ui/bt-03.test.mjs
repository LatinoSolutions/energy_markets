import { test } from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { BT02_MANIFEST_PATH, loadBacktestReadinessAt } from "../../src/ui/canonical-inputs.mjs";
import { buildBacktestsViewModel } from "../../src/ui/view-models.mjs";
import { renderBacktestsPage } from "../../src/ui/render.mjs";

test("BT-03: readiness table projects verified BT-02 measurements and keeps official unavailable", () => {
  const readiness = loadBacktestReadinessAt(process.cwd());
  assert.equal(readiness.ok, true, JSON.stringify(readiness));
  assert.equal(readiness.results.campaigns.length > 0, true);
  const vm = buildBacktestsViewModel({ backtestReadiness: readiness });
  assert.equal(vm.measurementReadiness.campaigns.length, readiness.results.campaigns.length);

  const html = renderBacktestsPage(vm);
  assert.match(html, /data-kind="backend-measurements"/);
  assert.match(html, /G0BM-202510/);
  assert.match(html, /BENCHMARK_PROVISIONAL|Provisional/);
  assert.match(html, /Fees UNKNOWN; excluded\./);
  assert.match(html, /Official \/ canonical/);
  assert.match(html, /No official settlement reconciliation is present/);
  assert.match(html, new RegExp(`data-artifact-sha="${readiness.provenance.artifactSha256}"`));
  assert.doesNotMatch(html, /Canonical B \/ H \/ V \(IMP-05\)/);
});

test("BT-03: tampered BT-02 output is rejected by its manifest hash", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "bt03-loader-"));
  const manifest = JSON.parse(readFileSync(BT02_MANIFEST_PATH, "utf8"));
  const refs = [manifest.artifact, ...Object.values(manifest.inputs)];
  for (const ref of refs) {
    const target = path.join(root, ref.path);
    mkdirSync(path.dirname(target), { recursive: true });
    cpSync(ref.path, target);
  }
  const manifestTarget = path.join(root, BT02_MANIFEST_PATH);
  mkdirSync(path.dirname(manifestTarget), { recursive: true });
  cpSync(BT02_MANIFEST_PATH, manifestTarget);
  writeFileSync(path.join(root, manifest.artifact.path), `${readFileSync(path.join(root, manifest.artifact.path), "utf8")}\n`);

  const loaded = loadBacktestReadinessAt(root);
  assert.equal(loaded.ok, false);
  assert.equal(loaded.code, "BT02_HASH_MISMATCH");
  assert.equal(loaded.path, manifest.artifact.path);
});

test("BT-03: without a verified record the UI shows no backend measurement values", () => {
  const html = renderBacktestsPage(buildBacktestsViewModel({}));
  assert.match(html, /data-kind="backend-measurements" data-status="UNAVAILABLE"/);
  assert.doesNotMatch(html, /data-value="\+?33\./);
});
