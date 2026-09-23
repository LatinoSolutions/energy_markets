import { test } from "node:test";
import assert from "node:assert/strict";

import {
  benchmarkB,
  benchmarkCalendarMissingDates,
  benchmarkProvisionalStatus,
  benchmarkVersion,
  berlinLocalTimeSecondsFromUtc,
  deriveBenchmarkWindow,
  intradayProxyReference,
  officialRowValidity,
  reconcileOfficialProxy,
  selectOfficialReferencesByDate,
  strictProxyWindowBounds,
} from "../../src/economic-calculation/index.mjs";

// IMP-05: reproducción del benchmark y auditoría de reconciliación
// official/proxy. Cada test nombra su fuente (SPEC v1.1.1 §§5.3–5.4 o fixture
// documental §19.3.1) con valores sintéticos de aritmética conocida; ninguna
// fila es un resultado de mercado y la equivalencia official/proxy permanece
// fail-closed (P-007: no hay feed Fundamental adicional; benchmark existente).

// --- referencia diaria sintética (§19.3.1) ---

function syntheticRow(over = {}) {
  return {
    product: "NATGAS/THE Q-2026",
    instrument: "NATGAS/THE Q-2026",
    trdDate: "2025-12-01",
    tmUtc: "2025-12-01T16:10:00Z",
    instrumentType: "Future",
    accessible: true,
    price: null,
    bid: null,
    ask: null,
    ...over,
  };
}

// --- benchmark.window.derive (§5.3; MUST NOT CHANGE 1-0-1/3-1-3) ---

test("IMP-05 window.derive: Monthly 1-0-1 es [S-1 mes, S)", () => {
  const outcome = deriveBenchmarkWindow({ mission: "monthly", startDate: "2026-04-01" });
  assert.equal(outcome.windowStart, "2026-03-01");
  assert.equal(outcome.windowEnd, "2026-04-01");
  assert.equal(outcome.defined, true);
  const inside = benchmarkB({
    references: [{ date: "2026-03-01", selected: 100 }],
    windowStart: outcome.windowStart,
    windowEnd: outcome.windowEnd,
  });
  assert.equal(inside.count, 1);
  const previousDay = benchmarkB({
    references: [{ date: "2026-02-28", selected: 100 }],
    windowStart: outcome.windowStart,
    windowEnd: outcome.windowEnd,
  });
  assert.equal(previousDay.count, 0);
  const excludedStart = benchmarkB({
    references: [{ date: "2026-04-01", selected: 100 }],
    windowStart: outcome.windowStart,
    windowEnd: outcome.windowEnd,
  });
  assert.equal(excludedStart.count, 0);
});

test("IMP-05 window.derive: Quarterly 3-1-3 es [Q-4 meses, Q-1 mes); el mes excluido no entra", () => {
  const outcome = deriveBenchmarkWindow({ mission: "quarterly", startDate: "2026-04-01" });
  assert.equal(outcome.windowStart, "2025-12-01");
  assert.equal(outcome.windowEnd, "2026-03-01");
  const lastWindowDay = benchmarkB({
    references: [{ date: "2026-02-28", selected: 50 }],
    windowStart: outcome.windowStart,
    windowEnd: outcome.windowEnd,
  });
  assert.equal(lastWindowDay.count, 1);
  const excludedMonth = benchmarkB({
    references: [{ date: "2026-03-15", selected: 50 }],
    windowStart: outcome.windowStart,
    windowEnd: outcome.windowEnd,
  });
  assert.equal(excludedMonth.count, 0);
});

test("IMP-05 window.derive: día que desborda el mes destino se recorta al último día de ese mes", () => {
  const outcome = deriveBenchmarkWindow({ mission: "monthly", startDate: "2026-03-31" });
  assert.equal(outcome.windowStart, "2026-02-28");
  assert.equal(outcome.windowEnd, "2026-03-31");
});

test("IMP-05 window.derive: entradas inválidas quedan sin definición", () => {
  assert.equal(deriveBenchmarkWindow({ mission: "weekly", startDate: "2026-04-01" }).defined, false);
  assert.equal(deriveBenchmarkWindow({ mission: "monthly", startDate: "2026-4-1" }).defined, false);
});

// --- benchmark.calendar.missing_dates (§5.3 calendario separado) ---

test("IMP-05 calendar.missing_dates: fechas esperadas sin referencia quedan trazadas, no rellenas con cero", () => {
  const missing = benchmarkCalendarMissingDates({
    expectedDates: ["2026-01-05", "2026-01-06", "2026-01-07", "2026-01-08"],
    references: [
      { date: "2026-01-05", selected: 100 },
      { date: "2026-01-06", selected: null },
    ],
  });
  assert.deepEqual(missing, ["2026-01-06", "2026-01-07", "2026-01-08"]);
  const benchmark = benchmarkB({ references: [{ date: "2026-01-05", selected: 100 }], expectedDates: 4 });
  assert.equal(benchmark.coverage, "1/4", "cobertura separada del denominador");
  assert.equal(benchmark.B, 100, "el denominador son las fechas con referencia, no las esperadas");
});

// --- benchmark.status.provisional (§5.4) ---

test("IMP-05 status.provisional: referencia no-exclusivamente-oficial mantiene BENCHMARK_PROVISIONAL", () => {
  const status = benchmarkProvisionalStatus({
    references: [
      { date: "2026-01-05", selected: 100, source: "proxy" },
      { date: "2026-01-06", selected: 103, source: "official" },
    ],
  });
  assert.equal(status.status, "BENCHMARK_PROVISIONAL");
  assert.equal(status.BENCHMARK_PROVISIONAL, true);
  assert.equal(status.officialDates, 1);
  assert.equal(status.nonOfficialDates, 1);
  const allOfficial = benchmarkProvisionalStatus({
    references: [{ date: "2026-01-06", selected: 103, source: "official" }],
  });
  assert.equal(allOfficial.status, "BENCHMARK_OFFICIAL");
  const empty = benchmarkProvisionalStatus({ references: [] });
  assert.equal(empty.status, "B_NOT_DEFINED");
});

// --- benchmark.version (§5.4; §19.3.1 «receipt previo preservado») ---

test("IMP-05 benchmark.version: mismas entradas reproducen la versión; corrección produce versión nueva preservando la previa", () => {
  const computation = benchmarkB({ references: [{ selected: 100 }, { selected: 110 }] });
  const first = benchmarkVersion({ computation, versionTag: "eval-1" });
  const repeat = benchmarkVersion({ computation, versionTag: "eval-1" });
  assert.equal(first.versionId, repeat.versionId);
  assert.match(first.algorithm, /sha256/);
  assert.notEqual(first.versionId, null);

  const afterCorrection = benchmarkB({ references: [{ selected: 103 }, { selected: 110 }] });
  const second = benchmarkVersion({ computation: afterCorrection, versionTag: "eval-2" });
  assert.notEqual(second.versionId, first.versionId);

  const prior = benchmarkVersion({ computation, versionTag: "eval-1" });
  assert.equal(prior.versionId, first.versionId, "la versión previa no cambia ni desaparece");
});

test("IMP-05 benchmark.version: sin cómputo no se fabrica versión", () => {
  const outcome = benchmarkVersion({ computation: null });
  assert.equal(outcome.defined, false);
  assert.equal(outcome.versionId, null);
});

// --- reconcileOfficialProxy (§5.4; fixture §19.3.1) ---

test("IMP-05 §19.3.1: oficial 102 sustituye proxy 100, segunda fecha 110 → B nuevo 106 y proxy preservado", () => {
  const reconciliation = reconcileOfficialProxy({
    officialReferences: [{ date: "2026-01-05", value: 102 }, { date: "2026-01-06", value: 110 }],
    proxyReferences: [{ date: "2026-01-05", value: 100 }, { date: "2026-01-06", value: 110 }],
  });
  assert.equal(reconciliation.N, 2);
  assert.deepEqual(reconciliation.dates[0], {
    date: "2026-01-05", official: 102, proxy: 100, delta: -2, status: "both-present",
  });
  assert.equal(reconciliation.proxyPreserved, true);
  assert.equal(reconciliation.setEqual, true);
  assert.equal(reconciliation.equalityComparable, true);
  assert.equal(reconciliation.officialMean, 106);
  assert.equal(reconciliation.proxyMean, 105);
  assert.equal(reconciliation.officialMinusProxy, 1);
  // Identidad §5.4: B_official − B_proxy = −(1/N)Σδ_d con N sin cambios.
  assert.equal(reconciliation.officialMinusProxy, -(reconciliation.meanDelta));
  const after = benchmarkB({ references: [{ selected: 102 }, { selected: 110 }] });
  assert.equal(after.B, 106);
  // La sustitución no acredita equivalencia proxy≈settlement (§5.4).
  assert.equal(reconciliation.equivalent, false);
});

test("IMP-05 §19.3.1: oficial completa una fecha missing → conjunto, numerador y denominador se recalculan", () => {
  const before = benchmarkB({ references: [{ date: "2026-01-05", selected: 100 }], expectedDates: 2 });
  assert.deepEqual(before.coverage, "1/2");
  assert.equal(before.B, 100);

  const after = benchmarkB({ references: [{ date: "2026-01-05", selected: 100 }, { date: "2026-01-06", selected: 110 }], expectedDates: 2 });
  assert.equal(after.B, 105);
  assert.deepEqual(after.coverage, "2/2");

  const reconciliation = reconcileOfficialProxy({
    officialReferences: [{ date: "2026-01-05", value: 100 }, { date: "2026-01-06", value: 110 }],
    proxyReferences: [{ date: "2026-01-05", value: 100 }],
  });
  assert.deepEqual(reconciliation.officialOnlyDates, ["2026-01-06"]);
  assert.equal(reconciliation.setEqual, false);
  assert.equal(reconciliation.N, 1);
  assert.equal(reconciliation.officialMinusProxy, 5, "las medias corren sobre los valores presentes de cada vista: 105−100");
  assert.equal(reconciliation.equivalent, false);
});

test("IMP-05 reconcileOfficialProxy: entradas inválidas no reconcilian (fail-closed)", () => {
  assert.equal(reconcileOfficialProxy({ proxyReferences: [{ date: "2026-01-05" }] }).defined, false);
  assert.equal(reconcileOfficialProxy({ proxyReferences: "no-lista" }).defined, false);
  assert.equal(reconcileOfficialProxy({ proxyReferences: [{ date: null }] }).defined, false);
  assert.equal(reconcileOfficialProxy({ proxyReferences: [], officialReferences: [] }).dates.length, 0);
});

// --- official.value_0_01.treatment + validity_guard (§5.3; §19.3.1 «Oficial 0.01») ---

test("IMP-05 caso 0.01: el guard actúa por validez declarada, y 0.01 válido queda seleccionado", () => {
  assert.equal(officialRowValidity({ declaredValidity: "valid-under-explicit-fixture-assumption" }).valid, true);
  const outcome = selectOfficialReferencesByDate({
    officialRows: [{
      date: "2026-01-05", instrument: "NATGAS/THE Q-2026", value: 0.01,
      providerTimestamp: "2026-01-05T18:00:00Z", declaredValidity: "valid-under-explicit-fixture-assumption",
    }],
    proxiesByDate: [{ date: "2026-01-05", instrument: "NATGAS/THE Q-2026", value: 100, defined: true, sourceLabel: "proxy" }],
  });
  assert.equal(outcome.selections[0].source, "official");
  assert.equal(outcome.selections[0].value, 0.01);
});

test("IMP-05 caso 0.01: validez unknown no es fila oficial válida y cae al proxy", () => {
  const outcome = selectOfficialReferencesByDate({
    officialRows: [{
      date: "2026-01-05", instrument: "NATGAS/THE Q-2026", value: 0.01,
      providerTimestamp: "2026-01-05T18:00:00Z", declaredValidity: "unknown",
    }],
    proxiesByDate: [{ date: "2026-01-05", instrument: "NATGAS/THE Q-2026", value: 100, defined: true, sourceLabel: "trades-only" }],
  });
  assert.equal(outcome.selections[0].source, "trades-only");
  assert.equal(outcome.selections[0].value, 100);
});

test("IMP-05 validity_guard: fila oficial sin declaración de validez no se promueve (revisión 11, §5.3)", () => {
  assert.match(officialRowValidity({}).reason, /no declarada/);
  const withoutProxy = selectOfficialReferencesByDate({
    officialRows: [{
      date: "2026-01-05", instrument: "NATGAS/THE Q-2026", value: 0.01,
      providerTimestamp: "2026-01-05T18:00:00Z",
    }],
  });
  assert.equal(withoutProxy.selections[0].source, "missing");
  assert.equal(withoutProxy.selections[0].defined, false);
  assert.ok(withoutProxy.excludedOfficialRows.some((row) => row.reason.includes("no declarada")));

  const withProxy = selectOfficialReferencesByDate({
    officialRows: [{
      date: "2026-01-05", instrument: "NATGAS/THE Q-2026", value: 0.01,
      providerTimestamp: "2026-01-05T18:00:00Z",
    }],
    proxiesByDate: [{ date: "2026-01-05", instrument: "NATGAS/THE Q-2026", value: 100, defined: true, sourceLabel: "proxy" }],
  });
  assert.equal(withProxy.selections[0].source, "proxy");
  assert.equal(withProxy.selections[0].value, 100);
});

// --- reference.select.group_by_date_instrument (§5.3; revisión 10) ---

test("IMP-05 group_by_date_instrument: la corrección gana dentro del grupo de fecha e instrumento exactos", () => {
  const outcome = selectOfficialReferencesByDate({
    officialRows: [
      { date: "2026-01-05", instrument: "NATGAS/THE Q-2026", value: 102, providerTimestamp: "2026-01-05T18:00:00Z", declaredValidity: "valid" },
      { date: "2026-01-05", instrument: "POWER/DE Q1-2026", value: 999, providerTimestamp: "2026-01-06T09:00:00Z", declaredValidity: "valid" },
      { date: "2026-01-06", instrument: "NATGAS/THE Q-2026", value: 123, providerTimestamp: "2026-01-07T09:00:00Z", declaredValidity: "valid" },
    ],
  });
  const gasGroup = outcome.selections.find((row) => row.date === "2026-01-05" && row.instrument === "NATGAS/THE Q-2026");
  assert.equal(gasGroup.value, 102);
  const powerGroup = outcome.selections.find((row) => row.instrument === "POWER/DE Q1-2026");
  assert.equal(powerGroup.value, 999);
});

test("IMP-05 group_by_date_instrument: entre correcciones dentro del grupo prevalece el timestamp de proveedor más reciente", () => {
  const outcome = selectOfficialReferencesByDate({
    officialRows: [
      { date: "2026-01-05", instrument: "X", value: 102, providerTimestamp: "2026-01-05T18:00:00Z", declaredValidity: "valid" },
      { date: "2026-01-05", instrument: "X", value: 103, providerTimestamp: "2026-01-07T09:30:00Z", declaredValidity: "valid" },
      { date: "2026-01-05", instrument: "X", value: 101, providerTimestamp: "2026-01-06T09:00:00Z", declaredValidity: "valid" },
    ],
    proxiesByDate: [{ date: "2026-01-06", instrument: "X", value: 100, defined: true, sourceLabel: "proxy" }],
  });
  const gas = outcome.selections[0];
  assert.equal(gas.value, 103);
  assert.equal(gas.providerTimestamp, "2026-01-07T09:30:00Z");
  const followingDay = outcome.selections[1];
  assert.equal(followingDay.source, "proxy");
  assert.equal(followingDay.value, 100);
  assert.equal(outcome.excludedOfficialRows.length, 0, "filas válidas no generan exclusiones; el resto del grupo queda pareado");
  assert.equal(outcome.selections.every((row) => row.defined === true), true);
});

test("IMP-05 group_by_date_instrument: filas oficiales sin fecha, instrumento, valor o timestamp válidos quedan excluidas trazadas", () => {
  const outcome = selectOfficialReferencesByDate({
    officialRows: [
      { instrument: "X", value: 102, providerTimestamp: "2026-01-05T18:00:00Z", declaredValidity: "valid" },
      { date: "2026-01-05", value: 102, providerTimestamp: "2026-01-05T18:00:00Z", declaredValidity: "valid" },
      { date: "2026-01-05", instrument: "X", providerTimestamp: "2026-01-05T18:00:00Z", declaredValidity: "valid" },
      { date: "2026-01-05", instrument: "X", value: 102, declaredValidity: "valid" },
    ],
  });
  assert.equal(outcome.selections.length, 1, "el grupo fecha+instrumento existe aunque ninguna fila resulte utilizable: placeholder missing");
  assert.equal(outcome.selections[0].source, "missing");
  assert.deepEqual(outcome.excludedOfficialRows.map((row) => row.reason).map((reason) => reason.slice(0, 10)), [
    "Fecha de n", "Fecha de n", "Valor de s", "providerTi",
  ]);
});

// --- intradayProxyReference (§5.2) ---

test("IMP-05 proxy desde filas: trades medios 100 y midpoints medios 104 → proxy 101 (fixture §19.3.1)", () => {
  const outcome = intradayProxyReference({
    product: "NATGAS/THE Q-2026", trdDate: "2025-12-01", productClass: "gas",
    rows: [
      syntheticRow({ tmUtc: "2025-12-01T16:02:00Z", price: 100 }),
      syntheticRow({ tmUtc: "2025-12-01T16:03:00Z", price: 100 }),
      syntheticRow({ tmUtc: "2025-12-01T16:05:00Z", bid: 100, ask: 108 }),
      syntheticRow({ tmUtc: "2025-12-01T16:06:00Z", bid: 100, ask: 108 }),
    ],
  });
  // T̂=100; m_j=(100+108)/2=104; M̂=104 → 0.75*100+0.25*104 = 101.
  assert.equal(outcome.value, 101);
  assert.equal(outcome.sourceLabel, "proxy");
  assert.equal(outcome.windowUsed, "strict");
  assert.equal(outcome.label, "eex-derived-reference");
});

test("IMP-05 only trades / only midpoints / ninguna fuente tras el fallback permitido", () => {
  const onlyTrades = intradayProxyReference({
    product: "NATGAS/THE Q-2026", trdDate: "2025-12-01", productClass: "gas",
    rows: [syntheticRow({ tmUtc: "2025-12-01T16:10:00Z", price: 100 })],
  });
  assert.equal(onlyTrades.sourceLabel, "trades-only");
  assert.equal(onlyTrades.value, 100);

  const onlyMidpoints = intradayProxyReference({
    product: "NATGAS/THE Q-2026", trdDate: "2025-12-01", productClass: "gas",
    rows: [syntheticRow({ tmUtc: "2025-12-01T16:10:00Z", bid: 100, ask: 108 })],
  });
  assert.equal(onlyMidpoints.sourceLabel, "midpoints-only");
  assert.equal(onlyMidpoints.value, 104);

  const none = intradayProxyReference({
    product: "NATGAS/THE Q-2026", trdDate: "2025-12-01", productClass: "gas",
    rows: [],
  });
  assert.equal(none.sourceLabel, "missing");
  assert.equal(none.defined, false);
  assert.equal(none.value, null);
});

test("IMP-05 window.strict: Gas 17:00–17:15 CE(S)T; Power 17:05–17:15 CE(S)T; conversión DST de Tm UTC", () => {
  const gas = intradayProxyReference({
    product: "NATGAS/THE Q-2026", trdDate: "2025-12-01", productClass: "gas",
    rows: [
      syntheticRow({ tmUtc: "2025-12-01T16:10:00Z", price: 100 }), // 17:10 CET
      syntheticRow({ tmUtc: "2025-12-01T16:15:00Z", price: 110 }), // 17:15 CET, cota superior incluida
      syntheticRow({ tmUtc: "2025-12-01T16:16:00Z", price: 50 }),  // 17:16 CET, fuera de la estricta
      syntheticRow({ tmUtc: "2025-12-01T14:59:00Z", price: 60 }),  // 15:59 CET, antes de 17:00
    ],
  });
  assert.equal(gas.windowUsed, "strict");
  assert.equal(gas.strictCounts.trades, 2);
  assert.equal(gas.value, 105);

  const powerSameRows = intradayProxyReference({
    product: "POWER/DE Q1-2026", trdDate: "2025-12-01", productClass: "power",
    rows: [
      syntheticRow({ product: "POWER/DE Q1-2026", instrument: "POWER/DE Q1-2026", tmUtc: "2025-12-01T16:02:00Z", price: 90 }), // 17:02, fuera de Power (17:05)
      syntheticRow({ product: "POWER/DE Q1-2026", instrument: "POWER/DE Q1-2026", tmUtc: "2025-12-01T16:10:00Z", price: 100 }),
    ],
  });
  assert.equal(powerSameRows.windowUsed, "strict");
  assert.equal(powerSameRows.strictCounts.trades, 1);
  assert.equal(powerSameRows.value, 100);
});

test("IMP-05 window.fallback: ventana estricta vacía activa [17:15 ± 60 min] con etiqueta nearby-60m / eex-derived-reference", () => {
  const fallback = intradayProxyReference({
    product: "NATGAS/THE Q-2026", trdDate: "2025-12-01", productClass: "gas",
    rows: [
      syntheticRow({ tmUtc: "2025-12-01T15:15:00Z", price: 100 }), // 16:15 CET, en fallback
      syntheticRow({ tmUtc: "2025-12-01T16:30:00Z", price: 80 }),  // 17:30 CET, en fallback
      syntheticRow({ tmUtc: "2025-12-01T17:40:00Z", price: 99 }),  // 18:40 CET, fuera del fallback
    ],
  });
  assert.equal(fallback.windowUsed, "nearby-60m");
  assert.equal(fallback.label, "eex-derived-reference");
  assert.equal(fallback.fallbackCounts.trades, 2);
  assert.equal(fallback.value, 90);

  // Las observaciones posteriores al fallback permanecen excluidas trazadas.
  assert.ok(fallback.exclusions.some((row) => row.reason.includes("Fuera de la ventana")));
});

test("IMP-05 window.fallback: sin observaciones utilizables la referencia permanece missing (no se elige ventana por rendimiento)", () => {
  const outcome = intradayProxyReference({
    product: "NATGAS/THE Q-2026", trdDate: "2025-12-01", productClass: "gas",
    rows: [syntheticRow({ tmUtc: "2025-12-01T17:40:00Z", price: 99 })],
  });
  assert.equal(outcome.sourceLabel, "missing");
  assert.equal(outcome.defined, false);
  assert.equal(outcome.value, null);
});

test("IMP-05 proxy.rows.exact_product_date: filas de otro producto o fecha y no accesibles quedan excluidas trazadas", () => {
  const outcome = intradayProxyReference({
    product: "NATGAS/THE Q-2026", trdDate: "2025-12-01", productClass: "gas",
    rows: [
      syntheticRow({ tmUtc: "2025-12-01T16:10:00Z", price: 100 }),
      syntheticRow({ tmUtc: "2025-12-01T16:10:00Z", price: 42, trdDate: "2025-12-02" }),
      syntheticRow({ tmUtc: "2025-12-01T16:10:00Z", price: 42, product: "POWER/DE Q1-2026", instrument: "POWER/DE Q1-2026" }),
      syntheticRow({ tmUtc: "2025-12-01T16:10:00Z", instrumentType: "Futures Spread", bid: 1, ask: 2 }),
      syntheticRow({ tmUtc: "2025-12-01T16:10:00Z", price: 42, accessible: false }),
    ],
  });
  assert.equal(outcome.value, 100);
  const reasons = outcome.exclusions.map((row) => row.reason).join(" | ");
  assert.ok(reasons.includes("Fecha de negociación"), reasons);
  assert.ok(reasons.includes("Producto fuera"), reasons);
  assert.ok(reasons.includes("spread"), reasons);
  assert.ok(reasons.includes("accesibilidad"), reasons);
});

test("IMP-05 proxy.rows.deduplicate: observaciones idénticas colapsan a una; no se doble-pesan ni la media ni m_j", () => {
  const outcome = intradayProxyReference({
    product: "NATGAS/THE Q-2026", trdDate: "2025-12-01", productClass: "gas",
    rows: [
      syntheticRow({ tmUtc: "2025-12-01T16:10:00Z", price: 100, bid: 100, ask: 108 }),
      syntheticRow({ tmUtc: "2025-12-01T16:10:00Z", price: 100, bid: 100, ask: 108 }),
    ],
  });
  assert.equal(outcome.strictCounts.trades, 1);
  assert.equal(outcome.strictCounts.midpoints, 1);
  assert.equal(outcome.value, 101, "la fila con precio y bid/ask entra una sola vez en T̂ y una en M̂");
});

test("IMP-05 conversión UTC/DST: invierno CET=+1 y verano CEST=+2 (§6)", () => {
  const winter = berlinLocalTimeSecondsFromUtc({ utcTimestamp: "2025-12-01T16:10:00Z" });
  assert.deepEqual([winter.hours, winter.minutes], [17, 10]);
  const summer = berlinLocalTimeSecondsFromUtc({ utcTimestamp: "2025-08-12T16:10:00Z" });
  assert.deepEqual([summer.hours, summer.minutes], [18, 10]);
});

test("IMP-05 strictProxyWindowBounds: las dos reglas documentales y solo esas", () => {
  assert.deepEqual(strictProxyWindowBounds({ productClass: "power" }), {
    startSeconds: 17 * 3600 + 5 * 60, endSeconds: 17 * 3600 + 15 * 60, label: "17:05-17:15 CE(S)T",
  });
  assert.deepEqual(strictProxyWindowBounds({ productClass: "gas" }), {
    startSeconds: 17 * 3600, endSeconds: 17 * 3600 + 15 * 60, label: "17:00-17:15 CE(S)T",
  });
  assert.equal(strictProxyWindowBounds({ productClass: "electricity" }), null);
});

// --- integración de cierre: ventana derivada + peso diario + status + reconciliación ---

test("IMP-05 integración: ventana derivada, peso diario igual, cobertura y status coherentes en un ciclo completo", () => {
  const window = deriveBenchmarkWindow({ mission: "quarterly", startDate: "2026-04-01" });
  const references = [
    { date: "2026-01-05", selected: 100, source: "proxy" },
    { date: "2026-01-06", selected: 110, source: "proxy" },
    { date: "2026-02-27", selected: 110, source: "official" },
    { date: "2026-03-15", selected: 50, source: "proxy" }, // mes excluido documental 3-1-3
  ];
  const windowReferences = references.filter((reference) => reference.date >= window.windowStart && reference.date < window.windowEnd);
  const computation = benchmarkB({
    references: windowReferences,
    windowStart: window.windowStart,
    windowEnd: window.windowEnd,
  });
  assert.equal(computation.count, 3);
  assert.equal(computation.sum, 320);
  const expectedB = (100 + 110 + 110) / 3;
  assert.ok(Math.abs(computation.B - expectedB) === 0);

  const status = benchmarkProvisionalStatus({ references: windowReferences });
  assert.equal(status.status, "BENCHMARK_PROVISIONAL");
  assert.equal(status.officialDates, 1);
  assert.equal(status.nonOfficialDates, 2);

  const missing = benchmarkCalendarMissingDates({
    expectedDates: ["2026-01-05", "2026-01-06", "2026-01-07", "2026-02-27"],
    references: windowReferences,
  });
  assert.deepEqual(missing, ["2026-01-07"]);

  const version = benchmarkVersion({ computation, versionTag: "IMP-05-eval-1" });
  assert.equal(version.defined, true);
  const reconciliation = reconcileOfficialProxy({
    officialReferences: [{ date: "2026-02-27", value: 110 }],
    proxyReferences: [{ date: "2026-01-05", value: 100 }, { date: "2026-01-06", value: 110 }, { date: "2026-02-27", value: 110 }],
  });
  assert.equal(reconciliation.proxyPreserved, true);
  assert.equal(reconciliation.setEqual, false, "el proxy pierde una fecha ante el oficial: setEqual exige el mismo conjunto");
});
