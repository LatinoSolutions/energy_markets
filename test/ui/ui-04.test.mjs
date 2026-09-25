// Tests UI-04 (owner 24-sep-2026): la UI carga el estado canónico real del repo
// (receipt IMP-03 aceptado) sin fabricar valores, y /health dice qué cargó.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  BACKEND_GAP,
  TEMPORAL_MANIFEST_PATH,
  TEMPORAL_MANIFEST_RECEIPT,
  loadCanonicalUiInputs,
} from "../../src/ui/canonical-inputs.mjs";
import { buildUiViewModels, createUiServer } from "../../src/ui/server.mjs";
import { SURFACES_LIST } from "../../src/ui/view-models.mjs";

test("UI-04: el loader acredita el manifest temporal con el sha del receipt aceptado", () => {
  const { backend } = loadCanonicalUiInputs();
  assert.equal(backend.manifestLoaded, true, JSON.stringify(backend.errors));
  const receipt = JSON.parse(readFileSync(new URL(`../../${TEMPORAL_MANIFEST_RECEIPT}`, import.meta.url), "utf8"));
  const registered = receipt.evidenceTestHashes.find((entry) => entry.path === TEMPORAL_MANIFEST_PATH);
  assert.deepEqual(backend.sources.map((source) => source.sha256), [registered.sha256]);
  assert.ok(backend.recordCount > 0);
});

test("UI-04: sin atestaciones de valor ninguna identidad es enlazable y el hueco se declara", () => {
  const { backend } = loadCanonicalUiInputs();
  assert.equal(backend.bindableIdentities, 0);
  const codes = backend.gaps.map((gap) => gap.code);
  assert.ok(codes.includes(BACKEND_GAP.NO_VALUE_ATTESTATIONS));
  assert.ok(codes.includes(BACKEND_GAP.NO_CANONICAL_DECISION_BOUNDARY));
});

test("UI-04: con el estado canónico real ninguna superficie muestra un valor enlazado", () => {
  const { inputs } = loadCanonicalUiInputs();
  const viewModels = buildUiViewModels(inputs);
  for (const surface of SURFACES_LIST) {
    assert.notEqual(viewModels[surface].hasAnyBoundData, true, surface);
  }
  // Sin decision boundary canónico no se inventa timeline: Replay sigue fail-closed.
  assert.equal(viewModels.replay.ok, false);
});

test("UI-04: /health expone el bloque backend cargado", async () => {
  const canonical = loadCanonicalUiInputs();
  const { server, ready } = createUiServer({ inputs: canonical.inputs, backend: canonical.backend, port: 0 });
  try {
    const served = await ready;
    const health = await (await fetch(`${served.url.slice(0, -1)}/health`)).json();
    assert.equal(health.backend.manifestLoaded, true);
    assert.equal(health.backend.bindableIdentities, 0);
    for (const surface of SURFACES_LIST) {
      assert.equal(health.surfaces[surface].canonicalData, false, surface);
    }
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("UI-04: sin loader /health declara que no hay manifest", async () => {
  const { server, ready } = createUiServer({ port: 0 });
  try {
    const served = await ready;
    const health = await (await fetch(`${served.url.slice(0, -1)}/health`)).json();
    assert.equal(health.backend.manifestLoaded, false);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("UI-04: Backtests muestra el backtest exploratorio verificado por hash y etiquetado EXPLORATORY", async () => {
  const { renderSurfacePage } = await import("../../src/ui/render.mjs");
  const canonical = loadCanonicalUiInputs();
  assert.equal(canonical.backend.exploratory.loaded, true, JSON.stringify(canonical.backend.exploratory));
  const html = renderSurfacePage("backtests", buildUiViewModels(canonical.inputs).backtests);
  assert.match(html, /data-exploratory="true"/);
  assert.match(html, /EXPLORATORY/);
  // Los paneles del mockup se llenan con la comparación: brazos, efecto emparejado, distribuciones.
  const exploratoryHtml = html.slice(0, html.indexOf('data-kind="backend-measurements"'));
  assert.equal((exploratoryHtml.match(/data-arm="(BASELINE|ARM_A|ARM_B)"/g) ?? []).length, 3 * Object.keys(canonical.inputs.exploratoryBacktest.results.comparison).length);
  assert.doesNotMatch(html, /not produced by a canonical producer · not zero/);
  assert.equal((html.match(/data-status="EXPLORATORY" data-product=/g) ?? []).length, canonical.inputs.exploratoryBacktest.results.results.length);
});

test("UI-04: un resultado exploratorio sin el hash del manifest no se muestra", async () => {
  const { loadExploratoryBacktestAt, EXPLORATORY_MANIFEST_PATH } = await import("../../src/ui/canonical-inputs.mjs");
  const { mkdtempSync, mkdirSync, writeFileSync, cpSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const path = await import("node:path");
  const root = mkdtempSync(path.join(tmpdir(), "ui04-"));
  const manifest = JSON.parse(readFileSync(new URL("../../" + EXPLORATORY_MANIFEST_PATH, import.meta.url), "utf8"));
  for (const file of [EXPLORATORY_MANIFEST_PATH, manifest.slots.path, ...manifest.generators.map((entry) => entry.path)]) {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    cpSync(new URL("../../" + file, import.meta.url), path.join(root, file));
  }
  writeFileSync(path.join(root, manifest.results.path), JSON.stringify({ status: "EXPLORATORY", results: [] }));
  const loaded = loadExploratoryBacktestAt(root);
  assert.equal(loaded.ok, false);
  assert.equal(loaded.code, "EXPLORATORY_HASH_MISMATCH");
});

test("UI-04: Campaigns y Replay muestran el backtest exploratorio con el layout del mockup", async () => {
  const { renderSurfacePage } = await import("../../src/ui/render.mjs");
  const canonical = loadCanonicalUiInputs();
  const vms = buildUiViewModels(canonical.inputs);
  const results = canonical.inputs.exploratoryBacktest.results;
  const campaigns = renderSurfacePage("campaigns", vms.campaigns);
  assert.equal((campaigns.match(/data-campaign="/g) ?? []).length, results.campaigns.length);
  assert.match(campaigns, /What we don't know/);
  const replay = renderSurfacePage("replay", vms.replay);
  const purchases = results.replay.reduce((sum, episode) => sum + episode.inspector.length, 0);
  assert.equal((replay.match(/data-decision="/g) ?? []).length, purchases);
  assert.match(replay, /KNOWN AT T₀/);
  assert.match(replay, /Sealed: after T₀/);
});

test("UI-04: sin backtest exploratorio, Replay sigue fail-closed", async () => {
  const { renderSurfacePage } = await import("../../src/ui/render.mjs");
  const replay = renderSurfacePage("replay", buildUiViewModels({}).replay);
  assert.match(replay, /data-state="ERROR"/);
  assert.doesNotMatch(replay, /data-exploratory="true"/);
});

test("UI-04: Research muestra candidatos con criterios medidos y sin autoridad concedida", async () => {
  const { renderSurfacePage } = await import("../../src/ui/render.mjs");
  const canonical = loadCanonicalUiInputs();
  const html = renderSurfacePage("research", buildUiViewModels(canonical.inputs).research);
  assert.equal((html.match(/data-candidate="/g) ?? []).length, canonical.inputs.exploratoryBacktest.results.research.candidates.length);
  assert.match(html, /No adoption decision exists/);
});
