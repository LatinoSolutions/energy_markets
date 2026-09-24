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
