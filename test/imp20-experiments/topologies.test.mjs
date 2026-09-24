import { test } from "node:test";
import assert from "node:assert/strict";

import { TOPOLOGIES, TOPOLOGY_IDS, isTopologyId } from "../../src/imp20-experiments/topologies.mjs";
import { EXPERIMENT_DESIGNS } from "../../src/imp20-experiments/designs.mjs";
import { validateExperimentDesign } from "../../src/imp20-experiments/experiment-design.mjs";

test("declara las cuatro topologías candidatas de §8.6 con sus límites de autoridad", () => {
  assert.deepEqual([...TOPOLOGY_IDS].sort(), ["HYBRID_GLOBAL_META_POLICY", "INDEPENDENT_ABLATION", "PARALLEL_EVIDENCE_PRODUCERS", "SELECTED_SERIAL_COMPOSITIONS"]);
  for (const topology of Object.values(TOPOLOGIES)) {
    assert.match(topology.specCitation, /§8\.6|§9\.2|§10\.2/);
    assert.match(topology.authoritySemantics, /autoridad|authority|Candidate Policy global|AUTOMATIZACI/i);
  }
});

test("los diseños predeclarados usan sólo topologías registradas de §8.6", () => {
  for (const design of EXPERIMENT_DESIGNS) {
    assert.ok(isTopologyId(design.topology), design.identity.experimentId);
    assert.equal(validateExperimentDesign(design).ok, true, design.identity.experimentId);
  }
});

test("una topología desconocida se rechaza fail-closed", () => {
  const design = structuredClone(EXPERIMENT_DESIGNS[0]);
  design.topology = "AUTO_ML_PIPELINE";
  assert.equal(validateExperimentDesign(design).code, "INVALID_TOPOLOGY");
});
