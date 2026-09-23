// Semánticas temporales PIT. Fuente: SPEC v1.1.1 §6.1 (cuatro semánticas),
// §6.5 y §19.2 (machine timestamps UTC). Un timestamp de máquina puede llegar
// con offset explícito de zona: se normaliza a UTC sin pérdida de información.
// Un timestamp sin zona no se presuntamente UTC: se rechaza, porque presumirlo
// ocultaría la zona de origen (el audit verifica DST/calendarios, no presume).

// Coincide con un offset explícito ±HH:MM o ±HHMM.
const OFFSET_SUFFIX_PATTERN = /[+-]\d{2}:?\d{2}$/;

// Anclado a zona explícita: termina en Z (UTC) o en un offset declarado.
export function isUtcAnchored(value) {
  if (typeof value !== "string" || value.length === 0) {
    return false;
  }
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    return false;
  }
  return value.endsWith("Z") || OFFSET_SUFFIX_PATTERN.test(value);
}

// Normaliza un timestamp de máquina con zona explícita a ISO-8601 UTC (Z).
// Rechaza timestamps sin zona: convertirlos sería presumir su origen.
// Rechaza offset +00:00 escrito de otra forma? No: cualquier offset explícito
//equivale a una zona declarada y por tanto es convertible sin presumir.
export function toUtcTimestamp(value) {
  if (!isUtcAnchored(value)) {
    return { ok: false, code: "NOT_UTC_ANCHORED", value };
  }
  return { ok: true, utc: new Date(Date.parse(value)).toISOString() };
}

// Convierte un instante UTC a la zona de mercado para presentación. La
// conversión es de presentación only: nunca demuestra publicación ni
// consumo (§6.1: la auditoría no sustituye disponibilidad por conversión).
export function presentInMarketZone(utcValue, timeZone) {
  const parsed = Date.parse(utcValue);
  if (!Number.isFinite(parsed)) {
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
  const parts = Object.fromEntries(formatter.formatToParts(new Date(parsed)).map((p) => [p.type, p.value]));
  return {
    ok: true,
    presented: `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`,
    timeZone,
    utc: new Date(parsed).toISOString(),
  };
}
