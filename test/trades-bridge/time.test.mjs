import { test } from "node:test";
import assert from "node:assert/strict";

import { BRIDGE_WINDOW, SLOT_LABELS } from "../../src/trades-bridge/constants.mjs";
import {
  berlinOffsetMinutes,
  berlinWallClockToEpochMs,
  bridgeHalves,
  halfOfDate,
  slotEpochsForDay,
} from "../../src/trades-bridge/time.mjs";

test("la grilla de slots es 08:00-17:30 Berlin cada 30 min (20 slots)", () => {
  assert.equal(SLOT_LABELS.length, 20);
  assert.equal(SLOT_LABELS[0], "08:00");
  assert.equal(SLOT_LABELS[1], "08:30");
  assert.equal(SLOT_LABELS.at(-1), "17:30");
});

test("la hora de pared Berlin se convierte a UTC con su desfase estacional", () => {
  // Verano (CEST, UTC+2): 11:00 Berlin = 09:00Z.
  assert.equal(new Date(berlinWallClockToEpochMs("2025-09-01", "11:00")).toISOString(), "2025-09-01T09:00:00.000Z");
  // Invierno (CET, UTC+1): 11:00 Berlin = 10:00Z.
  assert.equal(new Date(berlinWallClockToEpochMs("2026-01-15", "11:00")).toISOString(), "2026-01-15T10:00:00.000Z");
  assert.equal(berlinOffsetMinutes(Date.parse("2025-09-01T09:00:00Z")), 120);
  assert.equal(berlinOffsetMinutes(Date.parse("2026-01-15T10:00:00Z")), 60);
});

test("los 20 slots del día son estrictamente crecientes y separados 30 min", () => {
  const epochs = slotEpochsForDay("2025-09-01");
  assert.equal(epochs.length, 20);
  for (let index = 1; index < epochs.length; index += 1) {
    assert.equal(epochs[index] - epochs[index - 1], 30 * 60 * 1000);
  }
});

test("la mitad cronológica del puente es la del patch 03 §4 y es determinista", () => {
  const halves = bridgeHalves(BRIDGE_WINDOW);
  assert.equal(halves.calibrationEndIso, "2026-02-02");
  assert.equal(halves.evaluationStartIso, "2026-02-03");
  assert.equal(halves.calibrationDays + halves.evaluationDays, halves.totalDays);
  assert.equal(halfOfDate("2026-02-02", halves), "CALIBRATION");
  assert.equal(halfOfDate("2026-02-03", halves), "EVALUATION");
  assert.equal(halfOfDate("2025-08-12", halves), "CALIBRATION");
  assert.equal(halfOfDate("2026-07-28", halves), "EVALUATION");
});
