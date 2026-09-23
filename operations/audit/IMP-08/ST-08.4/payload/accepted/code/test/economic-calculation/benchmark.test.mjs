import { test } from "node:test";
import assert from "node:assert/strict";

import {
  benchmarkB,
  classifyOfficialValidity,
  isDecisionConsumable,
  isWithinFallbackWindow,
  isWithinWindow,
  proxyReference,
  selectDailyReference,
} from "../../src/economic-calculation/index.mjs";

// Cada test nombra el fixtureId del oráculo congelado ST-08.1 y afirma valores
// literales transcritos de operations/audit/IMP-08/fixture-oracle/independent-
// calculations.md. Los adaptadores de test mapean las entradas congeladas a la
// API pública; la implementación no importa el oráculo ni despacha por fixture.

test("FX-C01-PROXY-MIXED: proxy 0.75*100+0.25*104=101, sin VWAP", () => {
  const outcome = proxyReference({ tradesMean: 100, midpointsMean: 104 });
  assert.equal(outcome.value, 101);
  assert.equal(outcome.sourceLabel, "proxy");
  assert.equal(outcome.defined, true);
});

test("FX-C02-TRADES-ONLY: sólo trades -> T=100", () => {
  const outcome = proxyReference({ tradesMean: 100 });
  assert.equal(outcome.value, 100);
  assert.equal(outcome.sourceLabel, "trades-only");
});

test("FX-C02-MIDPOINTS-ONLY: sólo midpoints -> M=104", () => {
  const outcome = proxyReference({ midpointsMean: 104 });
  assert.equal(outcome.value, 104);
  assert.equal(outcome.sourceLabel, "midpoints-only");
});

test("FX-C02-NO-SOURCE: sin fuente -> missing, nunca cero", () => {
  const outcome = proxyReference({});
  assert.equal(outcome.value, null);
  assert.equal(outcome.sourceLabel, "missing");
  assert.equal(outcome.defined, false);
  assert.ok(outcome.reason.length > 0);
});

test("FX-C03-EQUAL-WEIGHT: B=105 con peso diario igual pese a densidad de ticks", () => {
  const outcome = benchmarkB({
    references: [
      { date: "2026-01-05", selected: 100, tickDensity: 500 },
      { date: "2026-01-06", selected: 110, tickDensity: 3 },
    ],
  });
  assert.equal(outcome.B, 105);
  assert.equal(outcome.count, 2);
  assert.equal(outcome.sum, 210);
});

test("FX-C04-OFFICIAL-REPLACEMENT: oficial 102 sustituye proxy 100 -> B=106 y B previo 105 preservado", () => {
  const proxy = proxyReference({ tradesMean: 100 });
  const selected = selectDailyReference({ officialRows: [{ value: 102, providerTimestamp: "2026-01-06T18:00:00Z" }], proxy });
  assert.equal(selected.value, 102);
  assert.equal(selected.source, "official");
  const outcome = benchmarkB({ references: [{ selected: selected.value }, { selected: 110 }] });
  assert.equal(outcome.B, 106);
  assert.equal(outcome.sum, 212);
  const prior = benchmarkB({ references: [{ selected: 100 }, { selected: 110 }] });
  assert.equal(prior.B, 105);
});

test("FX-C05-OFFICIAL-CORRECTION: gana el timestamp de proveedor más reciente -> B=106.5", () => {
  const selected = selectDailyReference({
    officialRows: [
      { value: 102, providerTimestamp: "2026-01-06T18:00:00Z" },
      { value: 103, providerTimestamp: "2026-01-07T09:30:00Z" },
    ],
  });
  assert.equal(selected.value, 103);
  assert.equal(selected.source, "official");
  const outcome = benchmarkB({ references: [{ selected: selected.value }, { selected: 110 }] });
  assert.equal(outcome.B, 106.5);
  assert.equal(outcome.sum, 213);
});

test("FX-C06-MISSING-THEN-OFFICIAL: recálculo de conjunto, denominador y cobertura", () => {
  const version1 = benchmarkB({ references: [{ selected: 100 }, { selected: null }], expectedDates: 2 });
  assert.equal(version1.B, 100);
  assert.equal(version1.count, 1);
  assert.equal(version1.coverage, "1/2");
  const version2 = benchmarkB({ references: [{ selected: 100 }, { selected: 110 }], expectedDates: 2 });
  assert.equal(version2.B, 105);
  assert.equal(version2.count, 2);
  assert.equal(version2.coverage, "2/2");
});

test("FX-C07-MONTHLY-1-0-1: inicio incluido, fin excluido", () => {
  const start = "2026-03-01T00:00:00+01:00";
  const end = "2026-04-01T00:00:00+02:00";
  assert.equal(isWithinWindow("2026-02-28T23:59:59+01:00", start, end), false);
  assert.equal(isWithinWindow("2026-03-01T00:00:00+01:00", start, end), true);
  assert.equal(isWithinWindow("2026-03-31T23:59:59+02:00", start, end), true);
  assert.equal(isWithinWindow("2026-04-01T00:00:00+02:00", start, end), false);
});

test("FX-C07-QUARTERLY-3-1-3: inicio incluido, fin excluido", () => {
  const start = "2025-12-01T00:00:00+01:00";
  const end = "2026-03-01T00:00:00+01:00";
  assert.equal(isWithinWindow("2025-11-30T23:59:59+01:00", start, end), false);
  assert.equal(isWithinWindow("2025-12-01T00:00:00+01:00", start, end), true);
  assert.equal(isWithinWindow("2026-02-28T23:59:59+01:00", start, end), true);
  assert.equal(isWithinWindow("2026-03-01T00:00:00+01:00", start, end), false);
});

test("FX-C07-FALLBACK-PM60: |t-17:15|<=60 min, extremos incluidos", () => {
  assert.equal(isWithinFallbackWindow("16:14:59"), false);
  assert.equal(isWithinFallbackWindow("16:15:00"), true);
  assert.equal(isWithinFallbackWindow("17:15:00"), true);
  assert.equal(isWithinFallbackWindow("18:15:00"), true);
  assert.equal(isWithinFallbackWindow("18:15:01"), false);
});

test("FX-C07-POST-1715-CONSUMABILITY: publicado ≠ consumible por la policy", () => {
  const outcome = isDecisionConsumable({ evaluationViewAvailable: true, effectiveAvailabilityDemonstrated: false });
  assert.equal(outcome.evaluationViewAvailable, true);
  assert.equal(outcome.decisionConsumable, false);
});

test("FX-C08-OFFICIAL-001-VALID: 0.01 declarado válido; guard reportado, sin regla canónica", () => {
  const outcome = classifyOfficialValidity({ declaredValidity: "valid-under-explicit-fixture-assumption" });
  assert.equal(outcome.fixtureTreatment, "included");
  assert.equal(outcome.canonicalRejectionRule, "none");
  assert.equal(outcome.reportedGuardBehavior, "reject-as-placeholder");
  assert.equal(outcome.marketValidityAsserted, false);
});

test("FX-C08-OFFICIAL-001-UNKNOWN: validez desconocida -> excluido, nunca puesto a cero", () => {
  const outcome = classifyOfficialValidity({ declaredValidity: "unknown-under-explicit-fixture-assumption" });
  assert.equal(outcome.fixtureTreatment, "flag-and-exclude-until-validity-declared");
  assert.equal(outcome.silentlyZeroed, false);
  assert.equal(outcome.canonicalRejectionRule, "none");
});

test("negativo: B con D_t vacío no se rellena con cero", () => {
  const outcome = benchmarkB({ references: [{ selected: null }, { selected: undefined }], expectedDates: 2 });
  assert.equal(outcome.B, null);
  assert.equal(outcome.count, 0);
  assert.equal(outcome.coverage, "0/2");
  assert.equal(outcome.defined, false);
});

test("negativo: una fecha missing no entra en el denominador de B", () => {
  const withMissing = benchmarkB({ references: [{ selected: 100 }, { selected: null }, { selected: 200 }] });
  const withoutMissing = benchmarkB({ references: [{ selected: 100 }, { selected: 200 }] });
  assert.equal(withMissing.B, withoutMissing.B);
  assert.equal(withMissing.count, 2);
});

test("negativo: la densidad de ticks no cambia el peso diario de B", () => {
  const light = benchmarkB({ references: [{ selected: 100, tickDensity: 1 }, { selected: 110, tickDensity: 1 }] });
  const heavy = benchmarkB({ references: [{ selected: 100, tickDensity: 10_000 }, { selected: 110, tickDensity: 10_000 }] });
  assert.equal(light.B, heavy.B);
});
