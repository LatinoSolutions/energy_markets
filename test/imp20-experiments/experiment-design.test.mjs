import { test } from "node:test";
import assert from "node:assert/strict";

import { validateExperimentDesign, EXPERIMENT_DESIGN_FIELDS } from "../../src/imp20-experiments/experiment-design.mjs";
import { EXPERIMENT_DESIGNS } from "../../src/imp20-experiments/designs.mjs";

test("los seis diseños predeclarados validan íntegros (§25.1: experimentos independientes, paralelos o seriales predeclarados)", () => {
  assert.equal(EXPERIMENT_DESIGNS.length, 6);
  for (const design of EXPERIMENT_DESIGNS) {
    const result = validateExperimentDesign(design);
    assert.equal(result.ok, true, `${design.identity.experimentId}: ${JSON.stringify(result.errors, null, 2)}`);
    assert.equal(design.predeclared, true);
    assert.equal(design.freezingOrder, "SEMANTICS_AND_REFUTATION_FIRST");
  }
});

test("el conjunto cubre las tres formas: independiente/ablation, paralela y serial (§8.6)", () => {
  const topologies = new Set(EXPERIMENT_DESIGNS.map((design) => design.topology));
  assert.ok(topologies.has("INDEPENDENT_ABLATION"));
  assert.ok(topologies.has("PARALLEL_EVIDENCE_PRODUCERS"));
  assert.ok(topologies.has("SELECTED_SERIAL_COMPOSITIONS"));
  assert.ok(!topologies.has("HYBRID_GLOBAL_META_POLICY"), "la meta-policy híbrida no se activa; queda declarada como candidata en el catálogo");
});

test("un diseño vale por su contenido semántico completo; un campo nuclear ausente se rechaza fail-closed", () => {
  const cases = [
    ["identity", "MISSING_REQUIRED"],
    ["objective", "MISSING_REQUIRED"],
    ["comparator", "MISSING_REQUIRED"],
    ["marginalValueMethod", "MISSING_REQUIRED"],
    ["redundancyMethod", "MISSING_REQUIRED"],
  ];
  for (const [field, expectedCode] of cases) {
    const design = structuredClone(EXPERIMENT_DESIGNS[0]);
    delete design[field];
    const result = validateExperimentDesign(design);
    assert.equal(result.ok, false, field);
    assert.ok(result.errors.some((error) => error.code === expectedCode), `${field}: ${JSON.stringify(result.errors)}`);
  }
});

test("el diseño serial S5 declara premisa con provenance e invalidación (§8.5); no presuntos outcomes", () => {
  const design = EXPERIMENT_DESIGNS.find((candidate) => candidate.identity.experimentId === "IMP20-EX-S05-01");
  assert.equal(design.topology, "SELECTED_SERIAL_COMPOSITIONS");
  const layer = design.layers[0];
  assert.match(layer.premiseProvenance, /S1|premisa/i);
});

test("los criteria de refutation están predeclarados por capas y sin rescate", () => {
  for (const design of EXPERIMENT_DESIGNS) {
    assert.match(design.refutationCriteria, /refut/i, design.identity.experimentId);
  }
  const design = structuredClone(EXPERIMENT_DESIGNS[0]);
  design.refutationCriteria = "   ";
  assert.equal(validateExperimentDesign(design).ok, false);
});

test("el checklist de gates cubre los seis bloques de §19.1", () => {
  const required = ["Data / PIT", "Evaluator", "Execution parity", "Hypothesis", "Research acceptance", "Forward / governance"];
  for (const design of EXPERIMENT_DESIGNS) {
    const blocks = design.gatesChecklist.map((gate) => gate.block);
    for (const block of required) {
      assert.ok(blocks.includes(block), `${design.identity.experimentId} sin ${block}`);
    }
  }
  const design = structuredClone(EXPERIMENT_DESIGNS[0]);
  design.gatesChecklist = design.gatesChecklist.filter((gate) => gate.block !== "Execution parity");
  const result = validateExperimentDesign(design);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.code === "MISSING_VALIDATION_BLOCK"));
});

test("los audit scopes de cada diseño se registran como REQUIRES_AUDIT, no como RESOLVES_AUDIT propio", () => {
  for (const design of EXPERIMENT_DESIGNS) {
    assert.ok(design.requiredAuditScopes.length > 0, design.identity.experimentId);
    for (const scope of design.requiredAuditScopes) {
      assert.equal(scope.resolvesAudit, false, design.identity.experimentId);
      assert.match(scope.depId, /^DEP-/);
    }
  }
});

test("admissionPath: evaluación/admisión posterior vía §8.7, nunca automática (UNLOCKS, no admisión)", () => {
  for (const design of EXPERIMENT_DESIGNS) {
    assert.equal(design.admissionPath.viaContract, "§8.7");
    assert.equal(design.admissionPath.automatic, false);
    assert.equal(design.admissionPath.noAutomaticP5AuthorityChange, true);
  }
});

test("el mapping de datos declara no-invented-data y cada audit scope entregable queda visible", () => {
  for (const design of EXPERIMENT_DESIGNS) {
    assert.equal(design.dataMapping.noInventedData, true, design.identity.experimentId);
    assert.ok(design.dataMapping.policySummary.length > 0);
  }
});
