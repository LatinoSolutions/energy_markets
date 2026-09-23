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

// Exactitud: decisión de ingeniería derivada del contrato (la SPEC v1.1.1
// reconcilia "exactamente" en todo el pipeline económico — §14.8, §19.3.1,
// §19.3 — y la independencia de la reconciliación exige replicar el
// componente bit a bit). Casos de las revisiones IMP-04 2026-09-23: (102 vs
// 1000000, tol 1000000), (1 vs 1000000, tol 999999), (100 vs 0, tol 100)
// reconciliaban.
for (const [observed, expected, tolerance] of [
  [105.05, 105, 0.1],
  [102, 1000000, 1000000],
  [1, 1000000, 999999],
  [102, 1000000, 999000],
  [1000010, 1000000, 15],
  [100, 0, 100],
  [105, 105, -1],
  [105, 105, "0"],
]) {
  test(`una tolerancia ${JSON.stringify(tolerance)} se rechaza: la reconciliación es exacta (observado ${observed}, esperado ${expected})`, () => {
    const result = reconcileKeyOutputs({
      componentId: "SYN-TOOL-A",
      outputs: makeOutputs({ value: observed }),
      fixtures: makeFixtures({ expectedValue: expected, tolerance }),
    });
    assert.equal(result.reconciled, false);
    assert.equal(result.rejected, true);
    assert.equal(result.code, "INVALID_TOLERANCE");
    assert.equal(result.outputId, "SYN-output-B");
  });
}

test("tolerancia 0 explícita equivale a comparación exacta", () => {
  const exact = reconcileKeyOutputs({
    componentId: "SYN-TOOL-A",
    outputs: makeOutputs({ value: 105 }),
    fixtures: makeFixtures({ expectedValue: 105, tolerance: 0 }),
  });
  assert.equal(exact.reconciled, true);
});

test("sin tolerancia, cualquier desvío por pequeño que sea no reconcilia", () => {
  for (const [observed, expected] of [[1000010, 1000000], [1, 1000000], [105.05, 105], [0.5, 0], [100, 0]]) {
    const result = reconcileKeyOutputs({
      componentId: "SYN-TOOL-A",
      outputs: makeOutputs({ value: observed }),
      fixtures: makeFixtures({ expectedValue: expected }),
    });
    assert.equal(result.reconciled, false, `${observed} vs ${expected}`);
    assert.equal(result.rejected, false);
    assert.ok(result.mismatches.some((mismatch) => mismatch.reason === "VALUE_MISMATCH"));
  }
  const zero = reconcileKeyOutputs({ componentId: "SYN-TOOL-A", outputs: makeOutputs({ value: 0 }), fixtures: makeFixtures({ expectedValue: 0 }) });
  assert.equal(zero.reconciled, true);
});

// Review IMP-04 2026-09-23: con `===`, undefined/undefined, null/null e
// Infinity/Infinity reconciliaban. Un valor vacío no es evidencia.
for (const empty of [undefined, null, Infinity, -Infinity, NaN, "", "   ", [], [undefined], [null], [Infinity], {}]) {
  test(`un esperado vacío o no reconciliable (${String(JSON.stringify(empty) ?? empty)}) se rechaza aunque el observado sea igual`, () => {
    const result = reconcileKeyOutputs({
      componentId: "SYN-TOOL-A",
      outputs: makeOutputs({ value: empty }),
      fixtures: makeFixtures({ expectedValue: empty }),
    });
    assert.equal(result.reconciled, false);
    assert.equal(result.rejected, true);
    assert.equal(result.code, "INVALID_EXPECTED_VALUE");
  });
}

test("un observado vacío o no finito no reconcilia contra un esperado válido", () => {
  for (const empty of [undefined, null, Infinity, NaN, "", []]) {
    const result = reconcileKeyOutputs({
      componentId: "SYN-TOOL-A",
      outputs: makeOutputs({ value: empty }),
      fixtures: makeFixtures({ expectedValue: 105 }),
    });
    assert.equal(result.reconciled, false);
    assert.ok(result.mismatches.some((mismatch) => mismatch.reason === "INVALID_OBSERVED_VALUE"));
  }
  const withoutValue = reconcileKeyOutputs({
    componentId: "SYN-TOOL-A",
    outputs: [{ outputId: "SYN-output-B" }],
    fixtures: makeFixtures({ expectedValue: 105 }),
  });
  assert.equal(withoutValue.reconciled, false);
});

test("booleanos y textos se comparan exactamente", () => {
  const flag = reconcileKeyOutputs({
    componentId: "SYN-TOOL-A",
    outputs: makeOutputs({ value: false }),
    fixtures: makeFixtures({ expectedValue: false }),
  });
  assert.equal(flag.reconciled, true);
  const text = reconcileKeyOutputs({
    componentId: "SYN-TOOL-A",
    outputs: makeOutputs({ value: "official" }),
    fixtures: makeFixtures({ expectedValue: "proxy" }),
  });
  assert.equal(text.reconciled, false);
});

test("dos fixtures para la misma salida se rechazan: el esperado es único", () => {
  const result = reconcileKeyOutputs({
    componentId: "SYN-TOOL-A",
    outputs: makeOutputs({ value: 105 }),
    fixtures: [...makeFixtures({ expectedValue: 105 }), ...makeFixtures({ expectedValue: 999 })],
  });
  assert.equal(result.rejected, true);
  assert.equal(result.code, "DUPLICATE_FIXTURES");
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
