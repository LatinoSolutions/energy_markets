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

// Reproducción del audit 2026-09-23: observado 102, esperado 1000000 y
// tolerancia 1000000 producían reconciled:true. Una cota >= |esperado|
// aprueba una discrepancia total y se rechaza.
test("una tolerancia que iguala o supera la magnitud esperada se rechaza", () => {
  const result = reconcileKeyOutputs({
    componentId: "SYN-TOOL-A",
    outputs: makeOutputs({ value: 102 }),
    fixtures: makeFixtures({ expectedValue: 1000000, tolerance: 1000000 }),
  });
  assert.equal(result.reconciled, false);
  assert.equal(result.rejected, true);
  assert.equal(result.code, "INVALID_TOLERANCE");
  assert.equal(result.outputId, "SYN-output-B");
});

test("una tolerancia inmediatamente inferior a la magnitud esperada compara sin aprobar de más", () => {
  const result = reconcileKeyOutputs({
    componentId: "SYN-TOOL-A",
    outputs: makeOutputs({ value: 102 }),
    fixtures: makeFixtures({ expectedValue: 1000000, tolerance: 999000 }),
  });
  assert.equal(result.reconciled, false);
  assert.equal(result.rejected, false);
  assert.ok(result.mismatches.some((mismatch) => mismatch.reason === "VALUE_MISMATCH"));
});

test("una discrepancia dentro de una cota legítima sigue reconciliando", () => {
  const result = reconcileKeyOutputs({
    componentId: "SYN-TOOL-A",
    outputs: makeOutputs({ value: 1000010 }),
    fixtures: makeFixtures({ expectedValue: 1000000, tolerance: 15 }),
  });
  assert.equal(result.reconciled, true);
});

// Reproducción del review IMP-04 2026-09-23: esperado 0 con tolerancia 100
// reconciliaba un observado de 100 pese a que con esperado 0 la comparación
// debe ser exacta (no hay magnitud que acotar).
test("un esperado 0 no admite tolerancia positiva: la comparación es exacta", () => {
  const result = reconcileKeyOutputs({
    componentId: "SYN-TOOL-A",
    outputs: makeOutputs({ value: 100 }),
    fixtures: makeFixtures({ expectedValue: 0, tolerance: 100 }),
  });
  assert.equal(result.reconciled, false);
  assert.equal(result.rejected, true);
  assert.equal(result.code, "INVALID_TOLERANCE");
  assert.equal(result.outputId, "SYN-output-B");
});

test("un esperado 0 compara exacto sin tolerancia declarada", () => {
  const exact = reconcileKeyOutputs({
    componentId: "SYN-TOOL-A",
    outputs: makeOutputs({ value: 0 }),
    fixtures: makeFixtures({ expectedValue: 0 }),
  });
  assert.equal(exact.reconciled, true);

  const divergent = reconcileKeyOutputs({
    componentId: "SYN-TOOL-A",
    outputs: makeOutputs({ value: 0.5 }),
    fixtures: makeFixtures({ expectedValue: 0 }),
  });
  assert.equal(divergent.reconciled, false);
  assert.ok(divergent.mismatches.some((mismatch) => mismatch.reason === "VALUE_MISMATCH"));
});

// Reproducción del review IMP-04 2026-09-23: dos salidas con el mismo
// outputId (999 y 102) se reducían a la última y reconciliaban contra el
// fixture esperado 102.
test("salidas duplicadas y contradictorias con el mismo outputId no se reducen a la última", () => {
  const result = reconcileKeyOutputs({
    componentId: "SYN-TOOL-A",
    outputs: [
      { outputId: "SYN-output-B", value: 999 },
      { outputId: "SYN-output-B", value: 102 },
    ],
    fixtures: makeFixtures({ expectedValue: 102 }),
  });
  assert.equal(result.reconciled, false);
  assert.equal(result.rejected, true);
  assert.equal(result.code, "DUPLICATE_COMPONENT_OUTPUTS");
  assert.equal(result.outputId, "SYN-output-B");
});

test("salidas duplicadas aunque coincidentes se rechazan: la salida clave se produce una vez", () => {
  const result = reconcileKeyOutputs({
    componentId: "SYN-TOOL-A",
    outputs: [
      { outputId: "SYN-output-B", value: 105 },
      { outputId: "SYN-output-B", value: 105 },
    ],
    fixtures: makeFixtures(),
  });
  assert.equal(result.reconciled, false);
  assert.equal(result.rejected, true);
  assert.equal(result.code, "DUPLICATE_COMPONENT_OUTPUTS");
});

test("una tolerancia negativa se rechaza explícitamente", () => {
  const result = reconcileKeyOutputs({
    componentId: "SYN-TOOL-A",
    outputs: makeOutputs({ value: 105 }),
    fixtures: makeFixtures({ tolerance: -1 }),
  });
  assert.equal(result.rejected, true);
  assert.equal(result.code, "INVALID_TOLERANCE");
});

test("valores esperados de lista se comparan elemento a elemento", () => {
  const result = reconcileKeyOutputs({
    componentId: "SYN-TOOL-A",
    outputs: [{ outputId: "SYN-output-B", value: ["2026-01-05", "2026-01-06"] }],
    fixtures: [{ outputId: "SYN-output-B", expectedValue: ["2026-01-05", "2026-01-06"], permitted: true, independentComputation: "SYN-independent-listing" }],
  });
  assert.equal(result.reconciled, true);
  const divergent = reconcileKeyOutputs({
    componentId: "SYN-TOOL-A",
    outputs: [{ outputId: "SYN-output-B", value: ["2026-01-05", "2026-01-07"] }],
    fixtures: [{ outputId: "SYN-output-B", expectedValue: ["2026-01-05", "2026-01-06"], permitted: true, independentComputation: "SYN-independent-listing" }],
  });
  assert.equal(divergent.reconciled, false);
  assert.ok(divergent.mismatches.some((mismatch) => mismatch.reason === "VALUE_MISMATCH"));
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

test("los fixtures deben cubrir todas las salidas clave declaradas por la interfaz", () => {
  const result = reconcileKeyOutputs({
    componentId: "SYN-TOOL-A",
    outputs: makeOutputs(),
    fixtures: makeFixtures(),
    keyOutputs: ["SYN-output-B", "SYN-output-C"],
  });
  assert.equal(result.reconciled, false);
  assert.equal(result.rejected, true);
  assert.equal(result.code, "KEY_OUTPUTS_NOT_COVERED");
  assert.deepEqual(result.uncoveredKeyOutputs, ["SYN-output-C"]);
});

test("la cobertura completa de salidas clave reconcilia", () => {
  const result = reconcileKeyOutputs({
    componentId: "SYN-TOOL-A",
    outputs: makeOutputs(),
    fixtures: makeFixtures(),
    keyOutputs: ["SYN-output-B"],
  });
  assert.equal(result.reconciled, true);
});

test("keyOutputs inválida se rechaza explícitamente", () => {
  const result = reconcileKeyOutputs({
    componentId: "SYN-TOOL-A",
    outputs: makeOutputs(),
    fixtures: makeFixtures(),
    keyOutputs: [],
  });
  assert.equal(result.code, "INVALID_KEY_OUTPUTS");
});
