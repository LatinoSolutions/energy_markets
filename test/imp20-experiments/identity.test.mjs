import { test } from "node:test";
import assert from "node:assert/strict";

import { isValidExperimentId, validateExperimentIdentity } from "../../src/imp20-experiments/identity.mjs";
import { EXPERIMENT_DESIGNS } from "../../src/imp20-experiments/designs.mjs";

test("toda identidad de experimento lleva SPEC ID/version/hash, parent IMP-20, scope y versiones de objeto/protocolo (§25.2.1)", () => {
  for (const design of EXPERIMENT_DESIGNS) {
    const result = validateExperimentIdentity(design.identity);
    assert.equal(result.ok, true, design.identity.experimentId);
    assert.equal(design.identity.parentImp, "IMP-20");
    assert.match(design.identity.scope, /S2|S3|S4|S5|Z_t|Drivers|Drivers/i);
    assert.ok(isValidExperimentId(design.identity.experimentId));
  }
});

test("rechaza identidad sin hash o con parent incorrecto", () => {
  const broken = validateExperimentIdentity({ ...EXPERIMENT_DESIGNS[0].identity, specSha256: "no-es-hex", parentImp: "IMP-99" });
  assert.equal(broken.ok, false);
  assert.ok(broken.errors.some((error) => error.code === "MISSING_HASH"));
  assert.ok(broken.errors.some((error) => error.code === "INVALID_PARENT"));
});
