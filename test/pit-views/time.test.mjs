import { test } from "node:test";
import assert from "node:assert/strict";

import { isUtcAnchored, presentInMarketZone, toUtcTimestamp } from "../../src/pit-views/index.mjs";

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

// --- Review 6: fechas imposibles no se normalizan a otro instante (§6.1) ---

test("review 6: 2026-02-30 se rechaza en vez de convertirse en 2026-03-02", () => {
  const outcome = toUtcTimestamp("2026-02-30T12:00:00Z");
  assert.equal(outcome.ok, false);
  assert.equal(outcome.code, "INVALID_CALENDAR_DATE");
  assert.equal(outcome.utc, undefined);
  assert.equal(isUtcAnchored("2026-02-30T12:00:00Z"), false);
});

test("calendario: días y meses fuera de rango se rechazan; los bisiestos se respetan", () => {
  for (const value of [
    "2026-02-29T00:00:00Z",
    "2100-02-29T00:00:00Z",
    "2026-04-31T00:00:00Z",
    "2026-13-01T00:00:00Z",
    "2026-00-10T00:00:00Z",
    "2026-01-00T00:00:00Z",
  ]) {
    assert.equal(toUtcTimestamp(value).code, "INVALID_CALENDAR_DATE", value);
  }
  assert.equal(toUtcTimestamp("2028-02-29T00:00:00Z").utc, "2028-02-29T00:00:00.000Z");
  assert.equal(toUtcTimestamp("2000-02-29T00:00:00Z").utc, "2000-02-29T00:00:00.000Z");
});

test("reloj y offset fuera de rango se rechazan en vez de desplazar el instante", () => {
  assert.equal(toUtcTimestamp("2026-04-01T24:00:00Z").code, "INVALID_CLOCK_TIME");
  assert.equal(toUtcTimestamp("2026-04-01T06:60:00Z").code, "INVALID_CLOCK_TIME");
  assert.equal(toUtcTimestamp("2026-04-01T23:59:60Z").code, "INVALID_CLOCK_TIME");
  assert.equal(toUtcTimestamp("2026-04-01T06:00:00+24:00").code, "INVALID_UTC_OFFSET");
  assert.equal(toUtcTimestamp("2026-04-01T06:00:00+02:60").code, "INVALID_UTC_OFFSET");
});

test("la fecha se valida en su zona declarada; el cruce de día por offset es legítimo", () => {
  // 1 de marzo 00:30 en +01:00 es 28 de febrero en UTC: fecha local válida.
  assert.equal(toUtcTimestamp("2026-03-01T00:30:00+01:00").utc, "2026-02-28T23:30:00.000Z");
  // 29 de febrero local en año no bisiesto sigue siendo imposible con offset.
  assert.equal(toUtcTimestamp("2026-02-29T23:30:00-01:00").code, "INVALID_CALENDAR_DATE");
});

test("sub-milisegundos significativos se rechazan; ceros finales se aceptan", () => {
  assert.equal(toUtcTimestamp("2026-04-01T06:00:00.1234Z").code, "SUB_MILLISECOND_PRECISION");
  assert.equal(toUtcTimestamp("2026-04-01T06:00:00.123000Z").utc, "2026-04-01T06:00:00.123Z");
  assert.equal(toUtcTimestamp("2026-04-01T06:00:00.5Z").utc, "2026-04-01T06:00:00.500Z");
});

test("formas que Date.parse toleraría pero no son ISO-8601 con zona se rechazan", () => {
  for (const value of [
    "Wed, 01 Apr 2026 06:00:00 GMT",
    "2026-04-01 06:00:00Z",
    "2026-04-01T06:00:00z",
    "+002026-04-01T06:00:00Z",
    "2026-4-1T06:00:00Z",
  ]) {
    assert.equal(isUtcAnchored(value), false, value);
  }
});

test("presentInMarketZone rechaza un instante con fecha imposible", () => {
  assert.equal(presentInMarketZone("2026-02-30T12:00:00Z", "Europe/Berlin").code, "INVALID_TIMESTAMP");
  assert.equal(presentInMarketZone("2026-03-30T12:00:00Z", "Europe/Berlin").presented, "2026-03-30 14:00:00");
});
