import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
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

function copyBt02Fixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), "bt03-loader-"));
  const manifest = JSON.parse(readFileSync(BT02_MANIFEST_PATH, "utf8"));
  for (const ref of [manifest.artifact, ...Object.values(manifest.inputs)]) {
    const target = path.join(root, ref.path);
    mkdirSync(path.dirname(target), { recursive: true });
    cpSync(ref.path, target);
  }
  const manifestTarget = path.join(root, BT02_MANIFEST_PATH);
  mkdirSync(path.dirname(manifestTarget), { recursive: true });
  cpSync(BT02_MANIFEST_PATH, manifestTarget);
  return { root, manifest };
}

// Reescribe el output y re-sella su hash en el manifiesto, para que el rechazo
// venga de la regla bajo prueba y no del hash.
function rewriteOutputAndReseal({ root, manifest }, mutate) {
  const outputPath = path.join(root, manifest.artifact.path);
  const results = JSON.parse(readFileSync(outputPath, "utf8"));
  mutate(results);
  const bytes = JSON.stringify(results, null, 2);
  writeFileSync(outputPath, bytes);
  manifest.artifact.sha256 = createHash("sha256").update(bytes).digest("hex");
  writeFileSync(path.join(root, BT02_MANIFEST_PATH), JSON.stringify(manifest, null, 2));
}

function rowHtml(html, campaignKey, armId) {
  const match = html.match(new RegExp(`<tr data-campaign="${campaignKey}"[^>]*data-arm="${armId}"[\\s\\S]*?</tr>`));
  assert.ok(match, `row ${campaignKey} ${armId} not rendered`);
  return match[0];
}

function cells(row) {
  return [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => m[1]);
}

test("BT-03: tampered BT-02 output is rejected by its manifest hash", () => {
  const fixture = copyBt02Fixture();
  const outputPath = path.join(fixture.root, fixture.manifest.artifact.path);
  writeFileSync(outputPath, `${readFileSync(outputPath, "utf8")}\n`);

  const loaded = loadBacktestReadinessAt(fixture.root);
  assert.equal(loaded.ok, false);
  assert.equal(loaded.code, "BT02_HASH_MISMATCH");
  assert.equal(loaded.path, fixture.manifest.artifact.path);
});

test("BT-03: output declaring different input hashes than the manifest is rejected", () => {
  const fixture = copyBt02Fixture();
  rewriteOutputAndReseal(fixture, (results) => {
    results.inputs.bt01Benchmark.sha256 = "0".repeat(64);
  });
  const loaded = loadBacktestReadinessAt(fixture.root);
  assert.equal(loaded.ok, false);
  assert.equal(loaded.code, "BT02_INPUT_BINDING_MISMATCH");
  assert.equal(loaded.path, fixture.manifest.inputs.bt01Benchmark.path);
});

test("BT-03: an OFFICIAL status inside the exploratory artifact fails closed", () => {
  const fixture = copyBt02Fixture();
  rewriteOutputAndReseal(fixture, (results) => {
    const campaign = results.campaigns.find((c) => c.campaignKey === "G0BM-202602");
    campaign.arms.ARM_A.vStatus = "OFFICIAL";
  });
  const loaded = loadBacktestReadinessAt(fixture.root);
  assert.equal(loaded.ok, false);
  assert.equal(loaded.code, "BT02_OFFICIAL_WITHOUT_EVIDENCE");

  // Defensa en la proyección: un registro ya cargado con OFFICIAL tampoco se muestra.
  const readiness = loadBacktestReadinessAt(process.cwd());
  const forged = structuredClone(readiness);
  forged.results.campaigns.find((c) => c.campaignKey === "G0BM-202602").arms.ARM_A.vStatus = "OFFICIAL";
  const vm = buildBacktestsViewModel({ backtestReadiness: forged });
  assert.equal(vm.measurementReadiness, null);
  const html = renderBacktestsPage(vm);
  assert.match(html, /data-kind="backend-measurements" data-status="UNAVAILABLE"/);
  assert.doesNotMatch(html, /✓<\/span>Official/);
});

test("BT-03: PARTIAL without value renders as Partial and partial coverage is reported separately (§5.5)", () => {
  const readiness = loadBacktestReadinessAt(process.cwd());
  const html = renderBacktestsPage(buildBacktestsViewModel({ backtestReadiness: readiness }));
  const [, arm, coverage, , h, v, deltaV] = cells(rowHtml(html, "G0BM-202602", "ARM_A@DEPTH"));

  assert.match(v, /data-status="PARTIAL">NO VALUE/);
  assert.match(v, /○<\/span>Partial/);
  assert.doesNotMatch(v, /data-status="UNAVAILABLE"/);
  assert.match(v, /Coverage is incomplete/);

  assert.match(coverage, /data-coverage="PARTIAL">2 \/ 10 MW/);
  assert.match(coverage, /Partial coverage/);
  assert.match(h, /data-value="35\.7125"/);
  assert.match(h, /data-coverage="PARTIAL">over 2 \/ 10 MW only/);
  assert.match(arm, /run INCOMPLETE/);
  assert.doesNotMatch(arm, /EXPLORATORY_COMPLETE/);
  assert.match(deltaV, /data-status="UNAVAILABLE"/);

  const fullRow = cells(rowHtml(html, "G0BM-202602", "ARM_A"));
  assert.match(fullRow[2], /data-coverage="FULL">10 \/ 10 MW/);
  assert.doesNotMatch(fullRow[4], /over .* MW only/);
});

test("BT-03: PARTIAL with value shows the value with the Partial chip; prices are unsigned, V/ΔV signed", () => {
  const readiness = loadBacktestReadinessAt(process.cwd());
  const html = renderBacktestsPage(buildBacktestsViewModel({ backtestReadiness: readiness }));
  const [, , , b, h, v, deltaV] = cells(rowHtml(html, "G0BM-202602", "ARM_A"));

  assert.match(h, /data-status="PARTIAL" data-value="29\.975"[^>]*>29\.975 €\/MWh/);
  assert.match(h, /○<\/span>Partial/);
  assert.match(b, /data-status="BENCHMARK_PROVISIONAL"[^>]*>35\.787 €\/MWh/);
  assert.match(b, /~<\/span>Provisional/);
  assert.match(v, /data-status="PROVISIONAL"[^>]*>\+5\.812 €\/MWh/);
  assert.match(deltaV, />\+9\.892 €\/MWh/);
  assert.doesNotMatch(html, /✓<\/span>Official/);
});

test("BT-03: without a verified record the UI shows no backend measurement values", () => {
  const html = renderBacktestsPage(buildBacktestsViewModel({}));
  assert.match(html, /data-kind="backend-measurements" data-status="UNAVAILABLE"/);
  assert.doesNotMatch(html, /data-value="\+?33\./);
});
