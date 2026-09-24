// Backtest exploratorio (owner patch EM-SPEC-OWNER-PATCH-2026-09-24-02): calendario del
// cliente, fill conservador y cero precios inventados.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  FILL_MODELS,
  POLICIES,
  SLIPPAGE_EUR_MWH,
  episodeTradingDays,
  minimumRequired,
  runEpisode,
} from "../../src/exploratory/backtest.mjs";

const DAYS = ["2025-09-01", "2025-09-02", "2025-09-03"];

function seriesWith(asks, askSz = 5) {
  return Object.fromEntries(DAYS.map((day, index) => [day, [asks[index] === null ? null : { ask: asks[index], askSz, bid: null, quoteTm: day + "T09:00:00Z" }]]));
}

test("Quarterly 3-1-3: la entrega de enero se compra en septiembre, octubre y noviembre", () => {
  const exchangeDays = ["2025-08-29", "2025-09-01", "2025-10-15", "2025-11-28", "2025-12-01"];
  assert.deepEqual(episodeTradingDays({ product: "G0BQ", maturity: "202601", exchangeDays }), ["2025-09-01", "2025-10-15", "2025-11-28"]);
});

test("Monthly 1-0-1: el día previo a la entrega no es elegible", () => {
  const exchangeDays = ["2025-09-29", "2025-09-30", "2025-10-01"];
  assert.deepEqual(episodeTradingDays({ product: "G0BM", maturity: "202510", exchangeDays }), ["2025-09-29"]);
});

test("L_t: mínimo obligatorio con cap 12 MW/día", () => {
  assert.equal(minimumRequired(60, 5), 12);
  assert.equal(minimumRequired(60, 6), 0);
});

test("el precio pagado es el ask real más la slippage, nunca otro", () => {
  const result = runEpisode({ series: seriesWith([30, 31, 32]), tradingDays: DAYS, slotIndex: 0, targetMw: 3, policy: POLICIES.A0, fillModel: FILL_MODELS.CLIENT });
  assert.equal(result.boughtMw, 3);
  const expected = (30 + 31 + 32) / 3 + SLIPPAGE_EUR_MWH;
  assert.ok(Math.abs(result.avgPriceEurMwh - expected) < 1e-9);
});

test("sin quote fresco no hay fill: el día queda NO_QUOTE y el target puede quedar incompleto", () => {
  const result = runEpisode({ series: seriesWith([30, 31, null]), tradingDays: DAYS, slotIndex: 0, targetMw: 3, policy: POLICIES.A0, fillModel: FILL_MODELS.CLIENT });
  assert.equal(result.noQuoteDays, 1);
  assert.equal(result.complete, false);
  assert.equal(result.admissible, false);
  assert.equal(result.ledger[2].status, "NO_QUOTE");
});

test("DEPTH nunca llena más que el AskSz visible del quote", () => {
  const result = runEpisode({ series: seriesWith([30, 31, 32], 1), tradingDays: DAYS, slotIndex: 0, targetMw: 10, policy: () => 10, fillModel: FILL_MODELS.DEPTH });
  assert.ok(result.ledger.every((entry) => entry.filledMw <= 1));
  assert.equal(result.boughtMw, 3);
});

test("DIP10 solo usa asks pasados del mismo slot (sin look-ahead)", () => {
  const seen = [];
  const policy = (context) => {
    seen.push([...context.pastAsks]);
    return POLICIES.DIP10(context);
  };
  runEpisode({ series: seriesWith([30, 31, 32]), tradingDays: DAYS, slotIndex: 0, targetMw: 3, policy, fillModel: FILL_MODELS.CLIENT });
  assert.deepEqual(seen, [[], [30], [30, 31]]);
});
