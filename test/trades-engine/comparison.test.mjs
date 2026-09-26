import { test } from "node:test";
import assert from "node:assert/strict";

import { deliveryHoursForMission } from "../../src/trades-engine/hours.mjs";
import {
  ABSOLUTE_V_ACROSS_MODES,
  buildTradesComparison,
  pairwiseDeltaV,
  tradesBenchmarkProxy,
} from "../../src/trades-engine/comparison.mjs";

const hours = deliveryHoursForMission({ mission: "Quarterly", maturity: "2026Q1" });

test("el benchmark proxy TRADES lee `price` explícitamente, no `ask`", () => {
  const ledger = [{ price: 10, ask: 999 }, { price: 20, ask: 999 }];
  assert.equal(tradesBenchmarkProxy(ledger), 15);
  assert.equal(tradesBenchmarkProxy([{ ask: 999 }]), null);
});

test("ΔV entre brazos sólo con ambos completos; el benchmark se cancela", () => {
  const baseline = { summary: { complete: true, targetMw: 10, avgPriceEurMwh: 100 } };
  const arm = { summary: { complete: true, targetMw: 10, avgPriceEurMwh: 95 } };
  assert.equal(pairwiseDeltaV({ baseline, arm, hours }), 5 * 10 * hours);
  const incomplete = { summary: { complete: false, targetMw: 10, avgPriceEurMwh: 95 } };
  assert.equal(pairwiseDeltaV({ baseline, arm: incomplete, hours }), null);
  assert.equal(pairwiseDeltaV({ baseline: incomplete, arm, hours }), null);
  assert.equal(pairwiseDeltaV({ baseline, arm: { summary: { complete: true, targetMw: 5, avgPriceEurMwh: 95 } }, hours }), null);
});

test("la comparación declara que el V absoluto entre modos no es comparable", () => {
  const comparison = buildTradesComparison({
    product: "G0BQ",
    armLabels: { BASELINE: "Baseline", ARM_A: "Arm A" },
    episodes: [{
      maturity: "2026Q1",
      mission: "Quarterly",
      arms: {
        BASELINE: { summary: { complete: true, targetMw: 10, avgPriceEurMwh: 100 }, ledger: [{ price: 100 }] },
        ARM_A: { summary: { complete: true, targetMw: 10, avgPriceEurMwh: 95 }, ledger: [{ price: 95 }] },
      },
    }],
  });
  assert.equal(comparison.absoluteVAcrossModes, ABSOLUTE_V_ACROSS_MODES);
  const row = comparison.table.find((entry) => entry.armId === "ARM_A");
  assert.equal(row.status, "COMPLETE");
  assert.equal(row.deltaVKeur, (5 * 10 * hours) / 1000);
});
