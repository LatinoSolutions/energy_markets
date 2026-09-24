import { test } from "node:test";
import assert from "node:assert/strict";

import { CANDIDATE_LAYERS, getLayer } from "../../src/imp20-experiments/layers.mjs";
import { EXPERIMENT_DESIGNS } from "../../src/imp20-experiments/designs.mjs";
import { isValidExperimentId } from "../../src/imp20-experiments/identity.mjs";

test("el catálogo cubre exactamente los candidatos de IMP-20: S2–S5, Z y drivers (§25.1/§24)", () => {
  assert.deepEqual(Object.keys(CANDIDATE_LAYERS).sort(), ["DRIVERS", "S2", "S3", "S4", "S5", "Z"]);
  assert.equal(getLayer("S1"), null, "S1 no es candidato de IMP-20: es el núcleo aceptado");
  assert.equal(getLayer("S6"), null, "no existe una S6 por defecto (§8.7/MUST NOT CHANGE)");
});

test("cada capa del catálogo registra su identidad frozen, DEP y perfil de refutación con cita", () => {
  for (const layer of Object.values(CANDIDATE_LAYERS)) {
    assert.match(layer.frozenSemantics, /CANONICAL \/ FROZEN|§/);
    assert.match(layer.depLane, /^DEP-1[56]$/);
    assert.match(layer.refutationProfile, /refut|poda/);
  }
});

test("los diseños cubren capas S2–S5, Z y drivers (no cierra todas, pero nadie desaparece del diseño)", () => {
  const covered = new Set();
  for (const design of EXPERIMENT_DESIGNS) {
    for (const layer of design.layers) covered.add(layer.layerId);
  }
  assert.deepEqual([...covered].sort(), ["DRIVERS", "S2", "S3", "S4", "S5", "Z"]);
});
