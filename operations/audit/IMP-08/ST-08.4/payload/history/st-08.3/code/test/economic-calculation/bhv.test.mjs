import { test } from "node:test";
import assert from "node:assert/strict";

import {
  cDiagnostic,
  classifyCoverage,
  computeAllInH,
  computeTotalEur,
  computeV,
  quarterlyResearchVerdict,
  scoreQuarterly,
} from "../../src/economic-calculation/index.mjs";

// Fixtures FX-BHV-* del oráculo ST-08.1, con valores literales. La
// implementación no contiene fórmulas de H de ledger real ni resultados
// hardcodeados; H es un valor all-in suministrado.

test("FX-BHV-POSITIVE: V=B-H=105-100=+5 EUR/MWh", () => {
  const outcome = computeV({ B: 105, BUnit: "EUR/MWh", H: 100, HUnit: "EUR/MWh" });
  assert.equal(outcome.V, 5);
  assert.equal(outcome.sign, "positive");
  assert.equal(outcome.defined, true);
});

test("FX-BHV-NEGATIVE: V=100-105=-5 EUR/MWh", () => {
  const outcome = computeV({ B: 100, BUnit: "EUR/MWh", H: 105, HUnit: "EUR/MWh" });
  assert.equal(outcome.V, -5);
  assert.equal(outcome.sign, "negative");
});

test("FX-BHV-ZERO: V=105-105=0 neutral", () => {
  const outcome = computeV({ B: 105, BUnit: "EUR/MWh", H: 105, HUnit: "EUR/MWh" });
  assert.equal(outcome.V, 0);
  assert.equal(outcome.sign, "neutral");
});

test("FX-BHV-UNITS-INCOMPATIBLE: B EUR/MWh y H EUR -> V indefinido, sin conversión", () => {
  const outcome = computeV({ B: 105, BUnit: "EUR/MWh", H: 100, HUnit: "EUR" });
  assert.equal(outcome.V, null);
  assert.equal(outcome.defined, false);
  assert.ok(outcome.reason.length > 0);
});

test("FX-BHV-TOTAL-EUR-NO-MWH: volumen MW -> total EUR indefinido, sin MW->MWh", () => {
  const outcome = computeTotalEur({ V: 5, VUnit: "EUR/MWh", volume: 10, volumeUnit: "MW" });
  assert.equal(outcome.totalEur, null);
  assert.equal(outcome.defined, false);
});

test("FX-BHV-MISSING-FEE: fee unknown -> H indefinido, nunca cero", () => {
  const outcome = computeAllInH({ base: 100, unit: "EUR/MWh", costs: [{ value: null, status: "unknown" }], costsComplete: true });
  assert.equal(outcome.H, null);
  assert.equal(outcome.defined, false);
  assert.ok(outcome.reason.length > 0);
});

test("FX-BHV-INCOMPLETE-COVERAGE: V=5 aritmético pero no evidencia de research válida", () => {
  const value = computeV({ B: 105, BUnit: "EUR/MWh", H: 100, HUnit: "EUR/MWh" });
  assert.equal(value.V, 5);
  assert.equal(value.defined, true);
  const coverage = classifyCoverage({ coverage: "incomplete" });
  assert.equal(coverage.validResearchValue, false);
});

test("FX-BHV-C-DIAGNOSTIC: C=4 diagnóstico, no gate duro", () => {
  const outcome = cDiagnostic({ C: 4 });
  assert.equal(outcome.CReported, true);
  assert.equal(outcome.hardResearchGate, false);
  assert.equal(outcome.researchPassFromCAlone, false);
});

test("FX-BHV-UNDEFINED-RATIO-NO-PASS: sólo positivos -> Sortino indefinido -> HOLD, nunca PASS", () => {
  const scoring = scoreQuarterly([4, 3]);
  assert.equal(scoring.sortino, null);
  const verdict = quarterlyResearchVerdict({
    scoring,
    evidence: { minimumEvidenceMet: false },
  });
  assert.equal(verdict.verdict, "HOLD");
});

test("positivo: un coste conocido entra exactamente una vez en H", () => {
  const outcome = computeAllInH({
    base: 100,
    unit: "EUR/MWh",
    costs: [{ value: 2, status: "known" }, { value: 3, status: "known" }],
    costsComplete: true,
  });
  assert.equal(outcome.H, 105);
  assert.equal(outcome.defined, true);
});

test("positivo: total EUR con volumen MWh sí se computa", () => {
  const outcome = computeTotalEur({ V: 5, VUnit: "EUR/MWh", volume: 10, volumeUnit: "MWh" });
  assert.equal(outcome.totalEur, 50);
  assert.equal(outcome.defined, true);
});

test("negativo: B o H no finitos no se coercionan a cero", () => {
  assert.equal(computeV({ B: null, BUnit: "EUR/MWh", H: 100, HUnit: "EUR/MWh" }).defined, false);
  assert.equal(computeV({ B: 105, BUnit: "EUR/MWh", H: undefined, HUnit: "EUR/MWh" }).defined, false);
});

test("negativo: cobertura full sí es evidencia de research válida", () => {
  assert.equal(classifyCoverage({ coverage: "full" }).validResearchValue, true);
});
