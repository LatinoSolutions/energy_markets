import { test } from "node:test";
import assert from "node:assert/strict";

import {
  RECONCILED_RULE_PREDECLARATION,
  IS_NOT_FINAL_SIZING_POLICY,
  assertPriceBlindness,
  assertSharedController,
  buildDecisionCalendar,
  createA0Baseline,
  createSizingController,
  exactControlQuantity,
  remainingOpportunities,
  reconcileControlQuantity,
  validateA0TimingState,
} from "../../src/sizing-controller/index.mjs";

const CONTROLLER_PROVENANCE = {
  authority: "SPEC v1.1.1 §13.2 P5.2 + paquete del cliente ENERGY_MARKETS_CLIENT_INPUTS_2026-09-23",
  locator: "§13.2; trade_increment=1 MW (AUDITED); normal_max_mw_per_day=12 MW/day (PROVISIONAL)",
};

// §13.2: cada eligible trading day es una decision opportunity predeclarada.
function calendarWith(dates) {
  const built = buildDecisionCalendar({ tradingDates: dates, campaignId: "GAS-Q-2026Q1" });
  assert.equal(built.ok, true, JSON.stringify(built.errors));
  return built.calendar;
}

test("el calendario predeclara cada trading date como opportunity ordenada", () => {
  const calendar = calendarWith(["2026-01-05", "2026-01-02", "2026-01-08"]);
  assert.equal(calendar.calendarId, "CAL-GAS-Q-2026Q1");
  assert.equal(calendar.scheduledOpportunitiesCount, 3);
  assert.deepEqual(calendar.opportunities.map((o) => o.date), ["2026-01-02", "2026-01-05", "2026-01-08"]);
});

test("el calendario rechaza fechas inválidas y duplicadas (sin opportunities inventadas)", () => {
  assert.equal(buildDecisionCalendar({ tradingDates: ["2026-1-5"], campaignId: "GAS-Q-2026Q1" }).ok, false);
  assert.equal(buildDecisionCalendar({ tradingDates: ["2026-01-05", "2026-01-05"], campaignId: "GAS-Q-2026Q1" }).ok, false);
  assert.equal(buildDecisionCalendar({ tradingDates: ["2026-01-05"], campaignId: "" }).ok, false);
});

test("remainingOpportunities cuenta opportunities restantes incluyendo la fecha actual", () => {
  const built = buildDecisionCalendar({ tradingDates: ["2026-01-02", "2026-01-05", "2026-01-08"], campaignId: "C" });
  assert.equal(remainingOpportunities(built.calendar, "2026-01-05").count, 2);
  assert.equal(remainingOpportunities(built.calendar, "2026-01-01").count, 3);
  assert.equal(remainingOpportunities(built.calendar, "2026-01-09").count, 0);
});

// §13.2: q_t(control) = RemainingVolume / RemainingScheduledOpportunities.
test("la cantidad de control es remaining / remaining scheduled opportunities (exacta, con fracción)", () => {
  const exact = exactControlQuantity({ remainingVolumeMw: 50, remainingOpportunitiesCount: 3 });
  assert.equal(exact.ok, true);
  assert.ok(Math.abs(exact.exactQuantityMw - 50 / 3) < 1e-12);
});

test("sin opportunities restantes y volumen pendiente no hay sizing posible (fail-closed, no default)", () => {
  const blocked = exactControlQuantity({ remainingVolumeMw: 7, remainingOpportunitiesCount: 0 });
  assert.equal(blocked.ok, false);
  assert.equal(blocked.code, "INFEASIBLE_NO_OPPORTUNITIES");
  const completed = exactControlQuantity({ remainingVolumeMw: 0, remainingOpportunitiesCount: 0 });
  assert.equal(completed.ok, true);
  assert.equal(completed.exactQuantityMw, 0);
});

// §13.2: versión reconciliada ex-ante con lotes/cap, restada una vez servida.
test("la regla reconciliada redondea a lotes y re-distribuye el residual en el siguiente paso", () => {
  const controller = createSizingController({ lotSizeMw: 1, dailyCapMw: 20, provenance: CONTROLLER_PROVENANCE });
  const calendar = calendarWith(["2026-01-05", "2026-01-06", "2026-01-07"]);
  const decisions = [];
  let remaining = 50;
  calendar.opportunities.forEach((opportunity, index) => {
    const isLast = index === calendar.opportunities.length - 1;
    const reconciled = reconcileControlQuantity({
      remainingVolumeMw: remaining,
      remainingOpportunitiesCount: calendar.opportunities.length - index,
      isLastScheduledOpportunity: isLast,
      controller: controller.controller,
    });
    assert.equal(reconciled.ok, true);
    decisions.push(reconciled);
    remaining -= reconciled.requestedQuantityMw;
  });
  // 50/3=16.67 →lot 16; luego 34/2=17; últim: 17 → total 50.
  assert.deepEqual(decisions.map((d) => d.requestedQuantityMw), [16, 17, 17]);
  assert.equal(remaining, 0);
});

test("el cap diario provisional restringe la cantidad y la última oportunidad insuficiente marca FEASIBILITY_HOLD, no excepción inventada", () => {
  const controller = createSizingController({ lotSizeMw: 1, dailyCapMw: 7, provenance: CONTROLLER_PROVENANCE });
  const calendar = calendarWith(["2026-01-05", "2026-01-06", "2026-01-07", "2026-01-08", "2026-01-09", "2026-01-12"]);
  let remaining = 60;
  const totals = [];
  calendar.opportunities.forEach((_, index) => {
    const isLast = index === calendar.opportunities.length - 1;
    const reconciled = reconcileControlQuantity({
      remainingVolumeMw: remaining,
      remainingOpportunitiesCount: calendar.opportunities.length - index,
      isLastScheduledOpportunity: isLast,
      controller: controller.controller,
    });
    totals.push(reconciled.requestedQuantityMw);
    if (isLast) {
      // 25 MW restantes con cap 7: la regla no inventa excepción.
      assert.equal(reconciled.feasibility, "HOLD");
      assert.ok(reconciled.requestedQuantityMw < remaining);
    } else {
      assert.equal(reconciled.requestedQuantityMw, Math.min(60 / (6 - index), 7));
    }
    remaining -= reconciled.requestedQuantityMw;
  });
  assert.equal(remaining, 18);
});

// §13.2: regla congelada antes del experimento mediante content-hash.
test("la configuración del controller queda congelada por content-hash y es determinista", () => {
  const a = createSizingController({ lotSizeMw: 1, dailyCapMw: 12, provenance: CONTROLLER_PROVENANCE });
  const b = createSizingController({ lotSizeMw: 1, dailyCapMw: 20, provenance: CONTROLLER_PROVENANCE });
  const sameAsA = createSizingController({ lotSizeMw: 1, dailyCapMw: 12, provenance: CONTROLLER_PROVENANCE });
  assert.equal(a.ok, true);
  assert.notEqual(a.controller.contentHash, b.controller.contentHash);
  assert.equal(a.controller.contentHash, sameAsA.controller.contentHash);
  // Distinto cap ⇒ distinta versión.
  assert.notEqual(a.controller.contentHash, b.controller.contentHash);
  assert.equal(a.controller.status, "FROZEN_PRE_EXPERIMENT");
  assert.equal(a.controller.ruleId, RECONCILED_RULE_PREDECLARATION.ruleId);
  assert.equal(createSizingController({ lotSizeMw: 0.5, dailyCapMw: 12, provenance: CONTROLLER_PROVENANCE }).ok, false);
});

// §13.9 parity: A1 = A0 + S1 comparte el MISMO controller.
test("A0 y A1 comparten una sola versión del controller; divergir rompe la ablation", () => {
  const controller = createSizingController({ lotSizeMw: 1, dailyCapMw: 12, provenance: CONTROLLER_PROVENANCE });
  assert.equal(assertSharedController({ a0Controller: controller.controller, a1Controller: controller.controller }).ok, true);
  const other = createSizingController({ lotSizeMw: 2, dailyCapMw: 12, provenance: CONTROLLER_PROVENANCE });
  const mismatch = assertSharedController({ a0Controller: controller.controller, a1Controller: other.controller });
  assert.equal(mismatch.ok, false);
  assert.equal(mismatch.code, "CONTROLLER_VERSION_MISMATCH");
});

test("createSizingController exige provenance; sin ella no se congela nada", () => {
  assert.equal(createSizingController({ lotSizeMw: 1, dailyCapMw: 12, provenance: null }).ok, false);
});

// §13.5: A0 emite BUY en todo el calendario y WAIT cuando la obligación está cumplida.
test("A0 emite BUY predeclarado en cada opportunity y distribuye hasta cerrar la obligación", () => {
  const controller = createSizingController({ lotSizeMw: 1, dailyCapMw: 12, provenance: CONTROLLER_PROVENANCE });
  const calendar = calendarWith(["2026-01-05", "2026-01-06", "2026-01-07"]);
  const baseline = createA0Baseline({ controller: controller.controller, calendar });
  let remaining = 30;
  const emitted = [];
  for (let i = 0; i < calendar.opportunities.length; i += 1) {
    const decision = baseline.arm.decideAtOpportunity({ currentDate: calendar.opportunities[i].date, remainingVolumeMw: remaining });
    assert.equal(decision.ok, true);
    emitted.push(decision);
    remaining -= decision.requestedQuantityMw;
  }
  assert.deepEqual(emitted.map((d) => d.action), ["BUY", "BUY", "BUY"]);
  // 30/3=10 → day2 20/2=10 → last 10.
  assert.deepEqual(emitted.map((d) => d.requestedQuantityMw), [10, 10, 10]);
  assert.equal(remaining, 0);
  // Tras cerrar, la obligación no vuelve a emitir cantidad.
  const closed = baseline.arm.decideAtOpportunity({ currentDate: "2026-01-08", remainingVolumeMw: 0 });
  assert.equal(closed.ok, true);
  assert.equal(closed.action, "NO_OPPORTUNITY");
});

test("una fecha fuera del calendario no es opportunity, incluso con remaining", () => {
  const controller = createSizingController({ lotSizeMw: 1, dailyCapMw: 12, provenance: CONTROLLER_PROVENANCE });
  const calendar = calendarWith(["2026-01-05", "2026-01-06"]);
  const baseline = createA0Baseline({ controller: controller.controller, calendar });
  const decision = baseline.arm.decideAtOpportunity({ currentDate: "2026-01-12", remainingVolumeMw: 10 });
  assert.equal(decision.ok, true);
  assert.equal(decision.action, "NO_OPPORTUNITY");
  assert.equal(decision.requestedQuantityMw, 0);
});

// §13.4 WAIT: no hay compra; remaining y deadline originales vigentes.
test("remaining cero produce WAIT sin cantidad, no un BUY forzado", () => {
  const controller = createSizingController({ lotSizeMw: 1, dailyCapMw: 12, provenance: CONTROLLER_PROVENANCE });
  const calendar = calendarWith(["2026-01-05", "2026-01-06"]);
  const baseline = createA0Baseline({ controller: controller.controller, calendar });
  const decision = baseline.arm.decideAtOpportunity({ currentDate: "2026-01-06", remainingVolumeMw: 0 });
  assert.equal(decision.action, "WAIT");
  assert.equal(decision.requestedQuantityMw, 0);
});

// §13.2/§13.5: el timing de A0 no consume precios ni señales S1–S5/Z/fundamentals.
test("el estado de decisión con precios o señales es rechazado fail-closed", () => {
  for (const key of ["bestAsk", "priceFeatures", "s1", "sentiment", "fundamentalDrivers", "extraordinaryState", "benchmarkB"]) {
    const gate = createA0Baseline({ controller: null, calendar: null }).arm.assertDecisionInvariant({ [key]: 42 });
    assert.equal(gate.ok, false, key);
    assert.equal(gate.code, "PRICE_INPUT_REJECTED");
  }
  const clean = createA0Baseline({ controller: null, calendar: null }).arm.assertDecisionInvariant({ currentDate: "2026-01-05", remainingVolumeMw: 10 });
  assert.equal(clean.ok, true);
});

test("assertPriceBlindness: estados que exponen precios violan la invariante A0 aunque la acción esperada sea la misma", () => {
  const decision = { action: "BUY" };
  const violates = assertPriceBlindness({
    decision,
    priceVariants: [{ state: { bestAsk: 30.5 }, expectedAction: "BUY" }],
  });
  assert.equal(violates.ok, false);
  assert.equal(violates.code, "PRICE_INPUT_REJECTED");
  const holds = assertPriceBlindness({
    decision,
    priceVariants: [{ state: { currentDate: "2026-01-05", procurementState: "open" }, expectedAction: "BUY" }],
  });
  assert.equal(holds.ok, true);
  assert.equal(holds.code, "PRICE_BLIND_INVARIANT_HOLD");
});

// §13.5: los mismos q en cada frontera, independientes de cualquier precio.
test("la decisión A0 es idéntica con el calendario y remaining iguales, sin input de precio disponible", () => {
  const controller = createSizingController({ lotSizeMw: 1, dailyCapMw: 12, provenance: CONTROLLER_PROVENANCE });
  const calendar = calendarWith(["2026-01-05", "2026-01-06", "2026-01-07"]);
  const baseline = createA0Baseline({ controller: controller.controller, calendar });
  const first = baseline.arm.decideAtOpportunity({ currentDate: "2026-01-05", remainingVolumeMw: 30 });
  const second = baseline.arm.decideAtOpportunity({ currentDate: "2026-01-05", remainingVolumeMw: 30 });
  assert.deepEqual({ ...first }, { ...second });
  // Con remaining distinto cambia la cantidad, no por precio sino por remaining.
  const shifted = baseline.arm.decideAtOpportunity({ currentDate: "2026-01-05", remainingVolumeMw: 60 });
  // 60/3=20, cap provisional 12 MW/day limita; el binding es por cap, no por precio.
  assert.equal(shifted.requestedQuantityMw, 12);
});

// Guard §25.1: el controlador es experimental, no la Sizing Policy final.
test("la superficie declarada marca el controller como experimental y el baseline como no-B", () => {
  assert.match(JSON.stringify(RECONCILED_RULE_PREDECLARATION.declaration), /A0 y A1/);
  assert.match(JSON.stringify(IS_NOT_FINAL_SIZING_POLICY), /Sizing Policy futura/);
});
