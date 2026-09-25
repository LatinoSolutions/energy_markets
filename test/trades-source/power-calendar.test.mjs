import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  POWER_DE_CALENDAR_SOURCE,
  easterSunday,
  isPowerDeExchangeDay,
  powerDeExchangeDays,
  powerDeExchangeDaysBetween,
  powerDeHolidays,
} from "../../src/trades-source/index.mjs";
import { buildCalendarArtifact } from "../../operations/trades/TR-01/build-power-de-calendar.mjs";

const iso = (date) => date.toISOString().slice(0, 10);

test("Pascua por el algoritmo Gregoriano anónimo", () => {
  assert.equal(iso(easterSunday(2024)), "2024-03-31");
  assert.equal(iso(easterSunday(2025)), "2025-04-20");
  assert.equal(iso(easterSunday(2026)), "2026-04-05");
});

test("Power DE cierra 24 y 31 de diciembre (diferencia con Natural Gas)", () => {
  const holidays = powerDeHolidays(2025).map((holiday) => holiday.date);
  assert.ok(holidays.includes("2025-12-24"));
  assert.ok(holidays.includes("2025-12-31"));
  assert.equal(isPowerDeExchangeDay("2025-12-24"), false);
  assert.equal(isPowerDeExchangeDay("2025-12-31"), false);
  assert.equal(POWER_DE_CALENDAR_SOURCE.gasDifference.includes("12-24"), true);
});

test("Power DE no negocia fines de semana ni los festivos de la columna Power", () => {
  assert.equal(isPowerDeExchangeDay("2025-11-22"), false); // sábado
  assert.equal(isPowerDeExchangeDay("2025-11-23"), false); // domingo
  assert.equal(isPowerDeExchangeDay("2025-01-01"), false);
  assert.equal(isPowerDeExchangeDay("2025-04-18"), false); // Good Friday
  assert.equal(isPowerDeExchangeDay("2025-04-21"), false); // Easter Monday
  assert.equal(isPowerDeExchangeDay("2025-05-01"), false);
  assert.equal(isPowerDeExchangeDay("2025-12-25"), false);
  assert.equal(isPowerDeExchangeDay("2025-12-26"), false);
  assert.equal(isPowerDeExchangeDay("2025-11-20"), true);
});

test("powerDeExchangeDays 2025 = 261 días hábiles - 8 festivos en día hábil", () => {
  assert.equal(powerDeExchangeDays(2025).length, 253);
});

test("powerDeExchangeDaysBetween respeta el rango y los festivos", () => {
  const days = powerDeExchangeDaysBetween("2025-12-22", "2025-12-31");
  assert.deepEqual(days, ["2025-12-22", "2025-12-23", "2025-12-29", "2025-12-30"]);
});

test("el calendario Power DE committeado es reproducible", () => {
  const artifact = buildCalendarArtifact();
  const artifactBytes = Buffer.from(`${JSON.stringify(artifact, null, 2)}\n`);
  const committed = readFileSync(new URL("../../operations/trades/TR-01/power-de-exchange-calendar.json", import.meta.url));
  assert.equal(artifactBytes.equals(committed), true);
  assert.equal(artifact.exchangeDayCount, 1784);
  assert.equal(artifact.source.column, "Power");
});
