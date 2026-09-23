import { test } from "node:test";
import assert from "node:assert/strict";

import { reconcileKeyOutputs } from "../../src/tooling-selection/reconciliation.mjs";
import { makeFixtures, makeOutputs } from "./fixtures.mjs";

test("salidas clave reconciliadas de forma independiente con fixtures permitidos", () => {
  const result = reconcileKeyOutputs({ componentId: "SYN-TOOL-A", outputs: makeOutputs(), fixtures: makeFixtures() });
  assert.equal(result.reconciled, true);
  assert.equal(result.rejected, false);
  assert.deepEqual(result.mismatches, []);
  assert.equal(result.edgeAttributed, false);
  assert.equal(result.productionAuthority, false);
});

test("una divergencia impide la reconciliación", () => {
  const result = reconcileKeyOutputs({
    componentId: "SYN-TOOL-A",
    outputs: makeOutputs({ value: 104 }),
    fixtures: makeFixtures({ expectedValue: 105 }),
  });
  assert.equal(result.reconciled, false);
  assert.ok(result.mismatches.some((mismatch) => mismatch.reason === "VALUE_MISMATCH"));
});

test("acepta tolerancia declarada sin inventar equivalencia exacta", () => {
  const result = reconcileKeyOutputs({
    componentId: "SYN-TOOL-A",
    outputs: makeOutputs({ value: 105.05 }),
    fixtures: makeFixtures({ expectedValue: 105, tolerance: 0.1 }),
  });
  assert.equal(result.reconciled, true);
});

test("una salida ausente no se inventa", () => {
  const result = reconcileKeyOutputs({
    componentId: "SYN-TOOL-A",
    outputs: [{ outputId: "SYN-other", value: 1 }],
    fixtures: makeFixtures(),
  });
  assert.equal(result.reconciled, false);
  assert.ok(result.mismatches.some((mismatch) => mismatch.reason === "MISSING_COMPONENT_OUTPUT"));
});

test("un fixture no permitido por derechos se rechaza", () => {
  const result = reconcileKeyOutputs({
    componentId: "SYN-TOOL-A",
    outputs: makeOutputs(),
    fixtures: makeFixtures({ permitted: false }),
  });
  assert.equal(result.reconciled, false);
  assert.equal(result.rejected, true);
  assert.equal(result.code, "FIXTURE_NOT_PERMITTED");
});

test("un fixture sin cómputo independiente previo se rechaza", () => {
  const result = reconcileKeyOutputs({
    componentId: "SYN-TOOL-A",
    outputs: makeOutputs(),
    fixtures: makeFixtures({ independentComputation: "" }),
  });
  assert.equal(result.code, "FIXTURE_NOT_INDEPENDENT");
});
