// BT-06 (PLAN_STATUS, owner request 2026-09-26): integración UI del backtest
// exploratorio TOB de Power. Fija que el release v3 se verifica por sha256, que se
// une al release gas v2 sin mezclar procedencias, y que los botones Power Quarterly
// y Power Monthly muestran su propia comparación (o la declaran ausente fail-closed).

import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { DEFAULT_REPO_ROOT } from "../../src/pit-views/index.mjs";
import { POWER_EXPLORATORY_RELEASE } from "../../src/exploratory/missions.mjs";
import { mergeExploratoryResults } from "../../src/exploratory/exploratory-merge.mjs";
import { EXPLORATORY_MANIFEST_PATH, loadCanonicalUiInputs, loadExploratoryBacktestAt, loadPowerExploratoryBacktestAt } from "../../src/ui/canonical-inputs.mjs";
import { buildUiViewModels } from "../../src/ui/server.mjs";
import { renderSurfacePage } from "../../src/ui/render.mjs";
import { powerDeExchangeDaysBetween } from "../../src/trades-source/power-calendar.mjs";

const repoRoot = fileURLToPath(new URL("../../", import.meta.url));
const runner = path.join(repoRoot, "operations/exploratory/v3/run-exploratory-backtest.mjs");
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

const SLOTS_BERLIN = [];
for (let hour = 8; hour < 18; hour += 1) for (const minute of [0, 30]) SLOTS_BERLIN.push(`${String(hour).padStart(2, "0")}:${minute === 0 ? "00" : "30"}`);

function slotsSeries(days) {
  const out = {};
  for (const day of days) {
    out[day] = SLOTS_BERLIN.map((_, index) => ({ ask: 30 + index * 0.1, askSz: 5, bid: null, quoteTm: `${day}T09:00:00Z` }));
  }
  return out;
}

function powerSlots() {
  const quarterlyDays = powerDeExchangeDaysBetween("2025-08-13", "2025-12-31");
  const monthlyDays = powerDeExchangeDaysBetween("2025-12-01", "2026-02-27");
  return { slotsBerlin: SLOTS_BERLIN, series: { "DEBQ|202601": slotsSeries(quarterlyDays), "DEBM|202602": slotsSeries(monthlyDays) } };
}

// Resultados Power reales del runner v3, para probar la unión y el render sin
// depender de la extracción real (que lanza DATA-01).
function powerResultsFromRunner() {
  const workspace = mkdtempSync(path.join(os.tmpdir(), "bt06-ui-run-"));
  const slots = path.join(workspace, "slots.json");
  writeFileSync(slots, JSON.stringify(powerSlots()));
  const out = path.join(workspace, "results.json");
  const run = spawnSync(process.execPath, [runner, "--repo-root", repoRoot, "--slots", slots, "--out", out], { encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr);
  const results = JSON.parse(readFileSync(out, "utf8"));
  rmSync(workspace, { recursive: true, force: true });
  return results;
}

test("BT-06 UI: sin release v3 el loader Power falla cerrado y el release gas sigue solo", () => {
  const workspace = mkdtempSync(path.join(os.tmpdir(), "bt06-ui-empty-"));
  try {
    const power = loadPowerExploratoryBacktestAt(workspace);
    assert.equal(power.ok, false);
    assert.equal(power.code, "EXPLORATORY_MANIFEST_MISSING");

    // Build a gas-only fixture from the verified v2 manifest. The production
    // repo now also has v3 Power, so it is not a valid missing-Power fixture.
    const gasManifest = JSON.parse(readFileSync(path.join(repoRoot, EXPLORATORY_MANIFEST_PATH), "utf8"));
    for (const relative of [EXPLORATORY_MANIFEST_PATH, gasManifest.results.path, gasManifest.slots.path, ...(gasManifest.generators ?? []).map((entry) => entry.path)]) {
      const target = path.join(workspace, relative);
      mkdirSync(path.dirname(target), { recursive: true });
      writeFileSync(target, readFileSync(path.join(repoRoot, relative)));
    }
    const gas = loadExploratoryBacktestAt(workspace);
    assert.equal(gas.ok, true);
    assert.equal(gas.power.loaded, false);
    assert.equal(gas.provenance.releases.length, 1);
    assert.equal(gas.provenance.byProduct.G0BQ.release, "v2");
    assert.equal(gas.provenance.byProduct.DEBQ, undefined);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("BT-06 UI: el release v3 se verifica por sha256 y su procedencia no se atribuye al gas", () => {
  const workspace = mkdtempSync(path.join(os.tmpdir(), "bt06-ui-release-"));
  try {
    const resultsPath = POWER_EXPLORATORY_RELEASE.results;
    const slotsPath = POWER_EXPLORATORY_RELEASE.slots;
    const generatorPath = POWER_EXPLORATORY_RELEASE.generator;
    mkdirSync(path.join(workspace, "operations/exploratory/v3"), { recursive: true });
    const slotsBytes = Buffer.from(JSON.stringify({ slotsBerlin: SLOTS_BERLIN, series: {} }));
    writeFileSync(path.join(workspace, slotsPath), slotsBytes);
    const resultsBytes = Buffer.from(JSON.stringify({ artifactKind: "EXPLORATORY_BACKTEST_RESULTS", status: "EXPLORATORY", market: ["POWER_DE"], inputs: { slots: { path: slotsPath, sha256: sha256(slotsBytes) } } }));
    writeFileSync(path.join(workspace, resultsPath), resultsBytes);
    writeFileSync(path.join(workspace, generatorPath), readFileSync(path.join(repoRoot, generatorPath)));
    const manifest = {
      artifactKind: "EXPLORATORY_BACKTEST_MANIFEST",
      status: "EXPLORATORY",
      market: "POWER_DE",
      results: { path: resultsPath, sha256: sha256(resultsBytes) },
      slots: { path: slotsPath, sha256: sha256(slotsBytes) },
      generators: [{ path: generatorPath, sha256: sha256(readFileSync(path.join(workspace, generatorPath))) }],
    };
    writeFileSync(path.join(workspace, POWER_EXPLORATORY_RELEASE.manifest), JSON.stringify(manifest));

    const loaded = loadPowerExploratoryBacktestAt(workspace);
    assert.equal(loaded.ok, true);
    assert.equal(loaded.provenance.release, "v3");
    assert.equal(loaded.provenance.market, "POWER_DE");
    assert.equal(loaded.provenance.resultsSha256, sha256(resultsBytes));

    // Un artifact manipulado no pasa el hash del manifest.
    writeFileSync(path.join(workspace, resultsPath), Buffer.from("{}"));
    const tampered = loadPowerExploratoryBacktestAt(workspace);
    assert.equal(tampered.ok, false);
    assert.equal(tampered.code, "EXPLORATORY_HASH_MISMATCH");
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("BT-06 UI: la unión gas+Power conserva ambas comparaciones y una regla en conflicto falla cerrada", () => {
  const gas = loadExploratoryBacktestAt(DEFAULT_REPO_ROOT);
  const power = powerResultsFromRunner();
  const merged = mergeExploratoryResults(gas.results, power);
  assert.equal(merged.ok, true);
  for (const product of ["G0BQ", "G0BM", "DEBQ", "DEBM"]) {
    assert.ok(merged.results.comparison[product], product);
  }
  assert.deepEqual(merged.results.rules.targetsMw, { G0BQ: 60, G0BM: 10, DEBQ: 10, DEBM: 10 });
  assert.ok(merged.results.campaigns.some((campaign) => campaign.id.startsWith("POW-Q-")));
  // La integridad conserva la procedencia de cada release, no sólo la del gas.
  const codePinned = merged.results.research.integrity.filter((check) => check.label === "Code pinned").map((check) => check.detail);
  assert.ok(codePinned.some((detail) => detail.includes("v2")), "falta el pin del release gas");
  assert.ok(codePinned.some((detail) => detail.includes("v3")), "falta el pin del release Power");

  const conflicting = mergeExploratoryResults(gas.results, { ...gas.results, rules: { ...gas.results.rules, slippageEurMwh: 0.2 } });
  assert.equal(conflicting.ok, false);
  assert.equal(conflicting.code, "EXPLORATORY_RULE_CONFLICT_slippageEurMwh");
});

test("BT-06 UI: el botón Power Quarterly muestra la comparación Power con su fuente, no la de gas", () => {
  const gas = loadExploratoryBacktestAt(DEFAULT_REPO_ROOT);
  const power = powerResultsFromRunner();
  const merged = mergeExploratoryResults(gas.results, power);
  const powerProvenance = { release: "v3", market: "POWER_DE", manifestPath: POWER_EXPLORATORY_RELEASE.manifest, resultsPath: POWER_EXPLORATORY_RELEASE.results, resultsSha256: "a".repeat(64), slotsPath: POWER_EXPLORATORY_RELEASE.slots, slotsSha256: "b".repeat(64) };
  const provenance = {
    ...gas.provenance,
    releases: [gas.provenance.releases[0], powerProvenance],
    byProduct: { ...gas.provenance.byProduct, DEBQ: powerProvenance, DEBM: powerProvenance },
  };
  const inputs = loadCanonicalUiInputs().inputs;
  const vms = buildUiViewModels({ ...inputs, exploratoryBacktest: { results: merged.results, provenance } });

  const powerHtml = renderSurfacePage("backtests", vms.backtests, { mode: "TOB", missionId: "POWER_QUARTERLY" });
  assert.ok(powerHtml.includes('data-product="DEBQ"'));
  assert.equal(powerHtml.includes('data-product="G0BQ"'), false, "Power no debe mostrar la comparación de Gas");
  assert.equal(powerHtml.includes("No TOB data for Power yet"), false);
  assert.ok(powerHtml.includes(POWER_EXPLORATORY_RELEASE.results), "la fuente mostrada es la del release Power");

  const monthlyHtml = renderSurfacePage("backtests", vms.backtests, { mode: "TOB", missionId: "POWER_MONTHLY" });
  assert.ok(monthlyHtml.includes('data-product="DEBM"'));

  const gasHtml = renderSurfacePage("backtests", vms.backtests, { mode: "TOB", missionId: "GAS_QUARTERLY" });
  assert.ok(gasHtml.includes('data-product="G0BQ"'));
  assert.equal(gasHtml.includes('data-product="DEBQ"'), false);
  assert.ok(gasHtml.includes(gas.provenance.resultsPath));
});
