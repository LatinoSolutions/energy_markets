// Trazabilidad normativa de los diseños IMP-20: el registro queda ligado a
// la SPEC canónica vigente por content hash, y al núcleo aceptado IMP-16.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import { EXPERIMENT_DESIGNS, SPEC_SHA256, DESIGN_IDS, getDesign } from "../../src/imp20-experiments/designs.mjs";
import { createExperimentDesignRegistry } from "../../src/imp20-experiments/registry.mjs";

test("el hash de SPEC fijado en los diseños coincide con el doc canónico v1.1.1 (binding de contenido)", async () => {
  const doc = await readFile(new URL("../../docs/canonical/v1_1_1/PROCUREMENT_RESEARCH_CANONICAL_ENGINEERING_SPEC_v1_1_1.md", import.meta.url));
  const actual = createHash("sha256").update(doc).digest("hex");
  assert.equal(actual, SPEC_SHA256, "los diseños están predeclarados bajo la SPEC v1.1.1 exacta");
  for (const design of EXPERIMENT_DESIGNS) {
    assert.equal(design.identity.specSha256, SPEC_SHA256);
  }
});

test("el registro acepta los seis diseños y los conserva con identidad estable", () => {
  const registry = createExperimentDesignRegistry();
  for (const design of EXPERIMENT_DESIGNS) {
    const result = registry.register(design);
    assert.equal(result.ok, true, `${design.identity.experimentId}: ${JSON.stringify(result.errors)}`);
  }
  assert.equal(registry.list().length, 6);
  assert.deepEqual([...DESIGN_IDS].sort(), [
    "IMP20-EX-D01-01",
    "IMP20-EX-S02-01",
    "IMP20-EX-S03-01",
    "IMP20-EX-S04-01",
    "IMP20-EX-S05-01",
    "IMP20-EX-Z01-01",
  ]);
  assert.equal(getDesign("IMP20-EX-S02-01").identity.parentImp, "IMP-20");
});

test("el registro rechaza un diseño inválido y no lo conserva (fail-closed)", () => {
  const registry = createExperimentDesignRegistry();
  const bad = structuredClone(EXPERIMENT_DESIGNS[0]);
  delete bad.accountingIdentity.rewardIdentity;
  const result = registry.register(bad);
  assert.equal(result.ok, false);
  assert.equal(registry.list().length, 0);

  const duplicate = createExperimentDesignRegistry();
  duplicate.register(structuredClone(EXPERIMENT_DESIGNS[0]));
  const second = duplicate.register(structuredClone(EXPERIMENT_DESIGNS[0]));
  assert.equal(second.ok, false);
  assert.equal(second.code, "IDENTITY_COLLISION");
  assert.equal(duplicate.list().length, 1, "un receipt aceptado nunca se resetea ni se borra; la identidad no se reutiliza");
});
