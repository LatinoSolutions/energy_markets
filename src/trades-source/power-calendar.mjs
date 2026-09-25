// Calendario de negociación de Power DE. Fuente: EEX "Holiday Calendar —
// Derivatives & Emissions Spot" (PDF oficial, 19/06/2025, columna "Power"),
// copia ligada en operations/audit/IMP-09/sources/
// EEX_Trading_Calendar_Emissions_Spot__Derivatives.pdf. Regla del PDF:
// "Exchange days are all business days Monday to Friday which are not one of
// the below mentioned [holidays]" y "applicable continuously for all years
// until further notice".
//
// Columna Power (X = mercado cerrado todo el día): New Year 01-01, Good Friday,
// Easter Monday, Labour Day 01-05, Christmas Day 24-12, Christmas Eve 25-12,
// Boxing Day 26-12 y New Year's Eve 31-12. Diferencia verificada con la columna
// Natural Gas: para gas, 24-12 y 31-12 son Exchange Days de horario acortado
// (Orderbook 08:00-13:00) y NO festivos; para Power figuran con X. Es el
// calendario propio de Power que pide TRADES_MODE_PLAN.md TR-01.
//
// El paquete del cliente (01_campaigns/01_shared_campaign_rules.md §2) confirma
// que no hay calendario alemán de festivos aparte: manda el Exchange Day /
// tradability calendar de EEX. Pascua por el algoritmo Gregoriano anónimo
// (mismo usado por IMP-09 build-eex-exchange-calendar.py).

// Parser local de fecha ISO a un Date en UTC (mediodía UTC evita bordes DST).
const toUtcDate = (isoDate) => {
  const [year, month, day] = String(isoDate).split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day, 12));
};

export const POWER_DE_CALENDAR_SOURCE = Object.freeze({
  path: "operations/audit/IMP-09/sources/EEX_Trading_Calendar_Emissions_Spot__Derivatives.pdf",
  title: "EEX Holiday Calendar (Derivatives + Emissions Spot)",
  column: "Power",
  rule: "Exchange days = business days Mon-Fri minus Power holidays; continuous until further notice",
  powerHolidays: ["01-01", "Good Friday", "Easter Monday", "05-01", "12-24", "12-25", "12-26", "12-31"],
  gasDifference: "Natural Gas trades shortened orderbook on 12-24 and 12-31; Power is closed full day (X)",
});

export function easterSunday(year) {
  const a = year % 19;
  const [b, c] = [Math.floor(year / 100), year % 100];
  const [d, e] = [Math.floor(b / 4), b % 4];
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const [i, k] = [Math.floor(c / 4), c % 4];
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(year, month - 1, day));
}

const iso = (date) => date.toISOString().slice(0, 10);

export function powerDeHolidays(year) {
  const easter = easterSunday(year);
  const goodFriday = new Date(easter.getTime() - 2 * 86400000);
  const easterMonday = new Date(easter.getTime() + 86400000);
  return [
    { date: `${year}-01-01`, name: "New Year" },
    { date: iso(goodFriday), name: "Good Friday" },
    { date: iso(easterMonday), name: "Easter Monday" },
    { date: `${year}-05-01`, name: "Labour Day" },
    { date: `${year}-12-24`, name: "Christmas Day (24th December)" },
    { date: `${year}-12-25`, name: "Christmas Eve (25th December)" },
    { date: `${year}-12-26`, name: "Boxing Day" },
    { date: `${year}-12-31`, name: "New Year's Eve" },
  ];
}

export function isPowerDeExchangeDay(isoDate) {
  const date = toUtcDate(isoDate);
  const day = date.getUTCDay();
  if (day === 0 || day === 6) return false;
  return !powerDeHolidays(date.getUTCFullYear()).some((holiday) => holiday.date === isoDate);
}

export function powerDeExchangeDays(year) {
  const days = [];
  const cursor = new Date(Date.UTC(year, 0, 1));
  while (cursor.getUTCFullYear() === year) {
    const day = iso(cursor);
    if (isPowerDeExchangeDay(day)) days.push(day);
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return days;
}

export function powerDeExchangeDaysBetween(startIso, endIso) {
  const days = [];
  const cursor = toUtcDate(startIso);
  const end = toUtcDate(endIso);
  while (cursor.getTime() <= end.getTime()) {
    const day = iso(cursor);
    if (isPowerDeExchangeDay(day)) days.push(day);
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return days;
}
