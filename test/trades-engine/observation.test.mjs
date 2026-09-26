import { test } from "node:test";
import assert from "node:assert/strict";

import { OBSERVATION_RULES } from "../../src/trades-bridge/constants.mjs";
import { observationAtDecision } from "../../src/trades-engine/observation.mjs";
import { deleteRow, gasQuarterlyTradeAt } from "./fixtures.mjs";

const DAY = "2025-09-01";
const identity = { TrdDate: DAY, Cmdty: "NATGAS", Area: "THE", TrdID: "1000", ShortCode: "G0BQ", Maturity: "202601", InstrumentType: "Simple Instrument" };

test("LAST_TRADE expone price/observationTm/observationRule y respeta Tm <= decisión", () => {
  const rows = [
    gasQuarterlyTradeAt({ day: DAY, slot: "10:00", price: 100 }),
    gasQuarterlyTradeAt({ day: DAY, slot: "11:30", price: 999 }), // posterior: no debe verse
  ];
  const result = observationAtDecision({ rows, rule: OBSERVATION_RULES.LAST_TRADE, dayIso: DAY, slotLabel: "11:00", freshnessLimitSeconds: 7200 });
  assert.equal(result.ok, true);
  assert.equal(result.observation.price, 100);
  assert.equal(result.observation.observationRule, "LAST_TRADE");
  assert.equal(typeof result.observation.observationTm, "string");
  assert.equal(result.observation.ageSeconds, 3600);
});

test("sin trade previo a la decisión no hay observación (no se inventa precio)", () => {
  const rows = [gasQuarterlyTradeAt({ day: DAY, slot: "11:30", price: 999 })];
  const result = observationAtDecision({ rows, rule: OBSERVATION_RULES.LAST_TRADE, dayIso: DAY, slotLabel: "11:00", freshnessLimitSeconds: 7200 });
  assert.equal(result.ok, false);
  assert.equal(result.code, "NO_OBSERVATION");
});

test("frescura: fuera del límite no hay observación; límite desconocido es fail-closed", () => {
  const rows = [gasQuarterlyTradeAt({ day: DAY, slot: "09:00", price: 100 })];
  const stale = observationAtDecision({ rows, rule: OBSERVATION_RULES.LAST_TRADE, dayIso: DAY, slotLabel: "11:00", freshnessLimitSeconds: 900 });
  assert.equal(stale.ok, false);
  assert.equal(stale.code, "STALE_OBSERVATION");
  assert.equal(stale.ageSeconds, 7200);
  const within = observationAtDecision({ rows, rule: OBSERVATION_RULES.LAST_TRADE, dayIso: DAY, slotLabel: "11:00", freshnessLimitSeconds: 7200 });
  assert.equal(within.ok, true);
  const unknown = observationAtDecision({ rows, rule: OBSERVATION_RULES.LAST_TRADE, dayIso: DAY, slotLabel: "11:00", freshnessLimitSeconds: null });
  assert.equal(unknown.ok, false);
  assert.equal(unknown.code, "FRESHNESS_LIMIT_UNKNOWN");
});

test("Delete point-in-time: retira el trade sólo desde el Delete", () => {
  const newRow = gasQuarterlyTradeAt({ day: DAY, slot: "10:00", price: 100 });
  const deleteAt1030 = deleteRow({ ...identity, Tm: "2025-09-01T08:30:00.000Z" });
  const rowsDeleted = [newRow, deleteAt1030];
  const deleted = observationAtDecision({ rows: rowsDeleted, rule: OBSERVATION_RULES.LAST_TRADE, dayIso: DAY, slotLabel: "11:00", freshnessLimitSeconds: 7200 });
  assert.equal(deleted.ok, false);
  assert.equal(deleted.code, "NO_OBSERVATION");

  const deleteAt1130 = deleteRow({ ...identity, Tm: "2025-09-01T09:30:00.000Z" });
  const rowsFutureDelete = [newRow, deleteAt1130];
  const stillVisible = observationAtDecision({ rows: rowsFutureDelete, rule: OBSERVATION_RULES.LAST_TRADE, dayIso: DAY, slotLabel: "11:00", freshnessLimitSeconds: 7200 });
  assert.equal(stillVisible.ok, true);
  assert.equal(stillVisible.observation.price, 100);
});

test("SLOT_VWAP usa el VWAP de los trades del slot que termina en la decisión", () => {
  const rows = [
    gasQuarterlyTradeAt({ day: DAY, slot: "10:45", price: 90, size: "1" }),
    gasQuarterlyTradeAt({ day: DAY, slot: "10:55", price: 100, size: "3" }),
    gasQuarterlyTradeAt({ day: DAY, slot: "11:30", price: 999, size: "1" }), // posterior
  ];
  const result = observationAtDecision({ rows, rule: OBSERVATION_RULES.SLOT_VWAP, dayIso: DAY, slotLabel: "11:00", freshnessLimitSeconds: 7200 });
  assert.equal(result.ok, true);
  assert.equal(result.observation.price, (90 * 1 + 100 * 3) / 4);
  assert.equal(result.observation.observationRule, "SLOT_VWAP");
});

test("una regla de observación desconocida no se evalúa", () => {
  const result = observationAtDecision({ rows: [], rule: "MID", dayIso: DAY, slotLabel: "11:00", freshnessLimitSeconds: 900 });
  assert.equal(result.ok, false);
  assert.equal(result.code, "UNKNOWN_RULE");
});
