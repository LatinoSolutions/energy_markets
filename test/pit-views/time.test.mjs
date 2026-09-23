import { test } from "node:test";
import assert from "node:assert/strict";

import { isUtcAnchored, toUtcTimestamp } from "../../src/pit-views/index.mjs";

// §6.1/§19.2: los timestamps de máquina se almacenan en UTC. Un timestamp sin
// zona explícita no se presume UTC: se rechaza, porque presumir la zona
// ocultaría la de origen (y el audit verifica DST/calendarios, §6.1). Un
// offset declarado sí es convertible sin presumir nada.

test("timestamps con anclaje de zona explícito se aceptan", () => {
  for (const value of [
    "2026-04-01T06:00:00Z",
    "2026-04-01T06:00:00.000Z",
    "2026-04-01T06:00:00+00:00",
    "2026-04-01T06:00:00-03:00",
    "2026-04-01T08:00:00+02:00",
    "2026-04-01T06:00:00+23:59",
  ]) {
    assert.equal(isUtcAnchored(value), true, value);
  }
});

test("timestamps sin zona u datos incompletos se rechazan como no anclados", () => {
  for (const value of [
    "2026-04-01T06:00:00",
    "2026-04-01",
    "",
    "not-a-date",
    null,
    undefined,
    1234567890,
  ]) {
    assert.equal(isUtcAnchored(value), false, String(value));
  }
});

test("toUtcTimestamp normaliza a ISO Z preservando el instante absoluto", () => {
  const outcome = toUtcTimestamp("2026-04-01T08:00:00+02:00");
  assert.equal(outcome.ok, true);
  assert.equal(outcome.utc, "2026-04-01T06:00:00.000Z");
});

test("un timestamp ya en UTC queda en su mismo instante en formato Z", () => {
  const outcome = toUtcTimestamp("2026-04-01T06:00:00Z");
  assert.equal(outcome.ok, true);
  assert.equal(outcome.utc, "2026-04-01T06:00:00.000Z");
});

test("offsets distintos escritos distinto expresan el mismo instante absoluto", () => {
  const withOffset = toUtcTimestamp("2026-04-01T06:00:00+04:00");
  const inUtc = toUtcTimestamp("2026-04-01T02:00:00Z");
  assert.equal(withOffset.ok, true);
  assert.equal(withOffset.utc, inUtc.utc);
});

test("offset de media hora conserva minutos en la normalización a UTC", () => {
  const outcome = toUtcTimestamp("2026-04-01T06:00:00+05:30");
  assert.equal(outcome.ok, true);
  assert.equal(outcome.utc, "2026-04-01T00:30:00.000Z");
});

test("toUtcTimestamp de un timestamp sin zona devuelve error, no un instante inventado", () => {
  const outcome = toUtcTimestamp("2026-04-01T06:00:00");
  assert.equal(outcome.ok, false);
  assert.equal(outcome.code, "NOT_UTC_ANCHORED");
  assert.equal(outcome.utc, undefined);
});
