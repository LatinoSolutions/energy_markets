// Calendario de negociación de Natural Gas (THE). Fuente: EEX "Holiday Calendar
// — Derivatives & Emissions Spot" (PDF oficial, 19/06/2025, columna "Natural
// Gas"), copia ligada en operations/audit/IMP-09/sources/
// EEX_Trading_Calendar_Emissions_Spot__Derivatives.pdf, la misma que documenta
// power-calendar.mjs. La diferencia verificada entre columnas está en
// `power-calendar.mjs` POWER_DE_CALENDAR_SOURCE.gasDifference: para gas 24-12 y
// 31-12 son Exchange Days de horario acortado (no festivos); para Power figuran
// cerrados. Por eso el calendario de gas es el de Power menos esos dos días.
//
// TRADES_MODE_PLAN.md TR-01 pide el calendario de Power DE; el patch 03 §3.4
// exige que gas y power tengan calendario propio por separado, y el patch 03 §0
// mide días sin trades de Gas Q, que sin calendario de gas no se puede
// reproducir.

import { easterSunday } from "./power-calendar.mjs";

const toUtcDate = (isoDate) => {
  const [year, month, day] = String(isoDate).split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day, 12));
};

export const GAS_THE_CALENDAR_SOURCE = Object.freeze({
  path: "operations/audit/IMP-09/sources/EEX_Trading_Calendar_Emissions_Spot__Derivatives.pdf",
  title: "EEX Holiday Calendar (Derivatives + Emissions Spot)",
  column: "Natural Gas",
  rule: "Exchange days = business days Mon-Fri minus gas holidays; continuous until further notice",
  gasHolidays: ["01-01", "Good Friday", "Easter Monday", "05-01", "12-25", "12-26"],
  shortenedTradingDays: ["12-24", "12-31"],
});

const iso = (date) => date.toISOString().slice(0, 10);

export function gasTheHolidays(year) {
  const easter = easterSunday(year);
  const goodFriday = new Date(easter.getTime() - 2 * 86400000);
  const easterMonday = new Date(easter.getTime() + 86400000);
  return [
    { date: `${year}-01-01`, name: "New Year" },
    { date: iso(goodFriday), name: "Good Friday" },
    { date: iso(easterMonday), name: "Easter Monday" },
    { date: `${year}-05-01`, name: "Labour Day" },
    { date: `${year}-12-25`, name: "Christmas Day" },
    { date: `${year}-12-26`, name: "Boxing Day" },
  ];
}

export function isGasTheExchangeDay(isoDate) {
  const date = toUtcDate(isoDate);
  const day = date.getUTCDay();
  if (day === 0 || day === 6) return false;
  return !gasTheHolidays(date.getUTCFullYear()).some((holiday) => holiday.date === isoDate);
}

export function gasTheExchangeDays(year) {
  const days = [];
  const cursor = new Date(Date.UTC(year, 0, 1));
  while (cursor.getUTCFullYear() === year) {
    const day = iso(cursor);
    if (isGasTheExchangeDay(day)) days.push(day);
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return days;
}

export function gasTheExchangeDaysBetween(startIso, endIso) {
  const days = [];
  const cursor = toUtcDate(startIso);
  const end = toUtcDate(endIso);
  while (cursor.getTime() <= end.getTime()) {
    const day = iso(cursor);
    if (isGasTheExchangeDay(day)) days.push(day);
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return days;
}
