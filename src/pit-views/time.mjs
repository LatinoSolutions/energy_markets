// Semánticas temporales PIT. Fuente: SPEC v1.1.1 §6.1 (cuatro semánticas),
// §6.5 y §19.2 (machine timestamps UTC). Un timestamp de máquina puede llegar
// con offset explícito de zona: se normaliza a UTC sin pérdida de información.
// Un timestamp sin zona no se presume UTC: se rechaza, porque presumirlo
// ocultaría la zona de origen (el audit verifica DST/calendarios, no presume).
//
// Parser estricto propio en vez de `Date.parse` suelto: `Date.parse` acepta
// fechas imposibles (2026-02-30 → 2026-03-02) y trunca sub-milisegundos, y
// cualquiera de las dos cosas cambiaría en silencio el instante PIT (§6.1).

const ISO_INSTANT_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?(Z|([+-])(\d{2}):?(\d{2}))$/;

function isLeapYear(year) {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function daysInMonth(year, month) {
  const lengths = [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return lengths[month - 1];
}

// Devuelve el instante en ms UTC o un código de rechazo. Un valor fuera de
// calendario/reloj se rechaza en vez de normalizarse a otro instante.
function parseInstant(value) {
  if (typeof value !== "string" || value.length === 0) {
    return { ok: false, code: "NOT_UTC_ANCHORED" };
  }
  const match = ISO_INSTANT_PATTERN.exec(value);
  if (match === null) {
    return { ok: false, code: "NOT_UTC_ANCHORED" };
  }
  const [, yearText, monthText, dayText, hourText, minuteText, secondText = "00", fraction = "", zone, sign, offsetHourText, offsetMinuteText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);

  const calendarValid = month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth(year, month);
  if (!calendarValid) {
    return { ok: false, code: "INVALID_CALENDAR_DATE" };
  }
  // Sin segundo intercalar: 23:59:60 no es representable sin desplazar el instante.
  const clockValid = hour <= 23 && minute <= 59 && second <= 59;
  if (!clockValid) {
    return { ok: false, code: "INVALID_CLOCK_TIME" };
  }
  let offsetMinutes = 0;
  if (zone !== "Z") {
    const offsetHour = Number(offsetHourText);
    const offsetMinute = Number(offsetMinuteText);
    if (offsetHour > 23 || offsetMinute > 59) {
      return { ok: false, code: "INVALID_UTC_OFFSET" };
    }
    offsetMinutes = (sign === "+" ? 1 : -1) * (offsetHour * 60 + offsetMinute);
  }
  // El instante se guarda con precisión de milisegundo: dígitos significativos
  // más allá se perderían, así que se rechazan en vez de truncarse.
  const significantFraction = fraction.replace(/0+$/, "");
  if (significantFraction.length > 3) {
    return { ok: false, code: "SUB_MILLISECOND_PRECISION" };
  }
  const milliseconds = Number(significantFraction.padEnd(3, "0"));
  // Date.UTC trata los años 0-99 como 1900-1999; se fija el año después.
  const local = new Date(Date.UTC(2000, month - 1, day, hour, minute, second, milliseconds));
  local.setUTCFullYear(year);
  return { ok: true, ms: local.getTime() - offsetMinutes * 60_000 };
}

// Anclado a zona explícita y válido en calendario y reloj.
export function isUtcAnchored(value) {
  return parseInstant(value).ok;
}

// Normaliza un timestamp de máquina con zona explícita a ISO-8601 UTC (Z).
// Rechaza timestamps sin zona (convertirlos sería presumir su origen) y
// fechas/horas imposibles (normalizarlas movería el instante).
export function toUtcTimestamp(value) {
  const parsed = parseInstant(value);
  if (!parsed.ok) {
    return { ok: false, code: parsed.code, value };
  }
  return { ok: true, utc: new Date(parsed.ms).toISOString() };
}

// Convierte un instante UTC a la zona de mercado para presentación. La
// conversión es de presentación only: nunca demuestra publicación ni
// consumo (§6.1: la auditoría no sustituye disponibilidad por conversión).
export function presentInMarketZone(utcValue, timeZone) {
  const parsed = parseInstant(utcValue);
  if (!parsed.ok) {
    return { ok: false, code: "INVALID_TIMESTAMP" };
  }
  if (typeof timeZone !== "string" || timeZone.length === 0) {
    return { ok: false, code: "MISSING_TIME_ZONE" };
  }
  let formatter;
  try {
    formatter = new Intl.DateTimeFormat("en-GB", {
      timeZone,
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
      hour12: false,
    });
  } catch {
    return { ok: false, code: "UNKNOWN_TIME_ZONE", timeZone };
  }
  const parts = Object.fromEntries(formatter.formatToParts(new Date(parsed.ms)).map((p) => [p.type, p.value]));
  return {
    ok: true,
    presented: `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`,
    timeZone,
    utc: new Date(parsed.ms).toISOString(),
  };
}
