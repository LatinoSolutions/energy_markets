import { test } from "node:test";
import assert from "node:assert/strict";

import { validateUnknownEntry, validateUnknownsRegistry } from "../../src/imp20-experiments/unknowns.mjs";
import { EXPERIMENT_DESIGNS } from "../../src/imp20-experiments/designs.mjs";

test("todo diseño predeclarado tiene desconocidos visibles con razón preservada (§25.1/§6.2)", () => {
  for (const design of EXPERIMENT_DESIGNS) {
    const result = validateUnknownsRegistry(design.unknowns);
    assert.equal(result.ok, true, design.identity.experimentId);
    assert.ok(design.unknowns.some((unknown) => unknown.kind === "AUDIT_MISSING"), `${design.identity.experimentId} sin desconocido de audit visible`);
  }
});

test("un diseño sin desconocidos se rechaza: oculta el estado real del mapping", () => {
  const design = structuredClone(EXPERIMENT_DESIGNS[0]);
  design.unknowns = [];
  const result = validateUnknownsRegistry(design.unknowns);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.code === "UNKNOWN_NOT_VISIBLE"));
});

test("un desconocido sin razón es un faltante disimulado y se rechaza", () => {
  const result = validateUnknownEntry({ unknownId: "UNK-X", subject: "algo", kind: "AUDIT_MISSING", reason: "  " });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.code === "MISSING_REASON"));
});

test("un desconocido técnico declara qué acto queda bloqueado; un HUMAN_DECISION conserva su categoría propia", () => {
  const technical = { unknownId: "UNK-T", subject: "serie", kind: "AUDIT_MISSING", reason: "por audit", blockedAct: "run económico" };
  assert.equal(validateUnknownEntry(technical).ok, true);

  const human = { unknownId: "UNK-H", subject: "decisión", kind: "HUMAN_DECISION", reason: "sólo Bru la puede dar" };
  const humanResult = validateUnknownEntry(human);
  assert.equal(humanResult.ok, true, "HUMAN_DECISION no exige blockedAct, conserva su eje separado");
});
