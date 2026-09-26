import { test } from "node:test";
import assert from "node:assert/strict";

import { assignWalkForwardHours, chooseHourFromHistory } from "../../src/trades-engine/hour.mjs";

const slotLabels = ["11:00", "12:00", "13:00"];
const profile = (mid, late) => [
  { slot: "11:00", avgPriceEurMwh: 100, complete: true },
  { slot: "12:00", avgPriceEurMwh: mid, complete: true },
  { slot: "13:00", avgPriceEurMwh: late, complete: true },
];

test("sin historia previa no se elige hora: el brazo HOUR no se corre (NOT_RUN_NO_HISTORY)", () => {
  assert.equal(chooseHourFromHistory({ history: [], slotLabels }), null);
});

test("la hora se elige con el menor diferencial medio sobre la historia", () => {
  const choice = chooseHourFromHistory({ history: [{ profile: profile(95, 90) }], slotLabels });
  assert.equal(choice.slot, "13:00");
  assert.equal(choice.meanDiffEurMwh, -10);
});

test("walk-forward: cada episodio usa sólo Development anterior; OOS/puente no alimentan la historia", () => {
  const episodes = [
    { campaignId: "GAS-Q-2021Q2", windowStart: "2021-01-01", zone: "DEVELOPMENT" },
    { campaignId: "GAS-Q-2021Q3", windowStart: "2021-04-01", zone: "DEVELOPMENT" },
    { campaignId: "GAS-Q-2021Q4", windowStart: "2021-07-01", zone: "DEVELOPMENT" },
    { campaignId: "GAS-Q-2024Q4", windowStart: "2024-06-01", zone: "OOS_HISTORICO" },
    { campaignId: "GAS-Q-2026Q1", windowStart: "2025-09-01", zone: "PUENTE" },
  ];
  const assignments = assignWalkForwardHours({
    episodes,
    hourProfileOf: () => profile(95, 90),
    slotLabels,
  });
  assert.equal(assignments["GAS-Q-2021Q2"].chosenSlot, null);
  assert.equal(assignments["GAS-Q-2021Q2"].historySize, 0);
  assert.equal(assignments["GAS-Q-2021Q3"].chosenSlot, "13:00");
  assert.equal(assignments["GAS-Q-2021Q3"].historySize, 1);
  assert.equal(assignments["GAS-Q-2021Q4"].historySize, 2);
  assert.equal(assignments["GAS-Q-2024Q4"].historySize, 3);
  assert.equal(assignments["GAS-Q-2024Q4"].historyOnlyDevelopment, true);
  // El puente ve la misma historia de Development; ni el OOS ni el puente entran.
  assert.equal(assignments["GAS-Q-2026Q1"].historySize, 3);
  assert.equal(assignments["GAS-Q-2026Q1"].historyOnlyDevelopment, true);
});
