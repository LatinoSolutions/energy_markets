// Cobertura de trades elegibles por instrumento y día. Fuente:
// OWNER_PATCH_TRADES_MODE_2026-09-25.md §3.4 (la ventana sale del calendario,
// nunca de la presencia de trades; día sin trade elegible = sin observación) y
// TRADES_MODE_PLAN.md TR-01 ("cobertura por instrumento y día", "días sin
// trades", "densidad"). Este módulo agrega filas ya elegibles; no decide la
// regla de elegibilidad (eligibility.mjs) ni el PIT (delete-point-in-time.mjs).

export function instrumentIdentity(row) {
  if (row?.InstrumentISIN) return row.InstrumentISIN;
  const shortCode = row?.ShortCode ?? "";
  const maturity = row?.Maturity ?? "";
  return shortCode && maturity ? `${shortCode}|${maturity}` : shortCode || maturity || "";
}

function dayKey(row) {
  return row?.TrdDate ?? "";
}

// Agrupa por (cmdty, area, instrumento, día). Devuelve filas ordenadas de forma
// determinista para que el artefacto sea reproducible.
export function coverageByInstrumentDay(rows) {
  const groups = new Map();
  for (const row of rows) {
    const key = [row?.Cmdty ?? "", row?.Area ?? "", instrumentIdentity(row), dayKey(row)].join("\u0001");
    if (!groups.has(key)) {
      groups.set(key, {
        cmdty: row?.Cmdty ?? "",
        area: row?.Area ?? "",
        instrument: instrumentIdentity(row),
        shortCode: row?.ShortCode ?? "",
        maturity: row?.Maturity ?? "",
        trdDate: dayKey(row),
        eligibleCount: 0,
        volumeSum: 0,
        firstTm: null,
        lastTm: null,
      });
    }
    const group = groups.get(key);
    group.eligibleCount += 1;
    const volume = Number(row?.Sz);
    if (Number.isFinite(volume)) group.volumeSum += volume;
    const tm = row?.Tm ?? null;
    if (tm !== null && (group.firstTm === null || tm < group.firstTm)) group.firstTm = tm;
    if (tm !== null && (group.lastTm === null || tm > group.lastTm)) group.lastTm = tm;
  }
  return [...groups.values()].sort((a, b) =>
    `${a.cmdty}|${a.area}|${a.instrument}|${a.trdDate}` < `${b.cmdty}|${b.area}|${b.instrument}|${b.trdDate}` ? -1 : 1,
  );
}

export function daysWithoutTrades({ observedDays, expectedDays }) {
  const observed = new Set(observedDays);
  return [...expectedDays].filter((day) => !observed.has(day)).sort();
}

const SHARED_WINDOW = "__shared__";

// `expected` admite:
//   - un array de días = calendario del contrato compartido por los instrumentos
//     de `records` (sólo válido cuando el lote es de un instrumento);
//   - un Map o un objeto `{ instrumento: [días] }` = ventana de cada contrato.
// Nunca se deriva de la presencia de trades.
function normalizeExpectedWindows(expected) {
  if (expected == null) return { windows: new Map(), shared: null };
  if (expected instanceof Map) return { windows: expected, shared: null };
  if (Array.isArray(expected)) return { windows: new Map(), shared: expected };
  return { windows: new Map(Object.entries(expected)), shared: null };
}

// Resumen por instrumento contra el calendario esperado del contrato (`expected`).
// La ventana sale del calendario, NUNCA del primer/último trade: los días sin
// trades al principio o al final de la vida del contrato cuentan como faltantes.
// Sin ventana de contrato disponible, `daysWithoutTrades` y `density` quedan en
// null (fail-closed) en vez de recortarse a lo observado.
export function summarizeInstrumentCoverage(records, expected) {
  const { windows, shared } = normalizeExpectedWindows(expected);
  const byInstrument = new Map();
  for (const record of records) {
    if (!byInstrument.has(record.instrument)) {
      byInstrument.set(record.instrument, {
        cmdty: record.cmdty,
        area: record.area,
        instrument: record.instrument,
        shortCode: record.shortCode,
        maturity: record.maturity,
        daysWithTrades: 0,
        totalEligibleTrades: 0,
        volumeSum: 0,
        firstDate: record.trdDate,
        lastDate: record.trdDate,
        observedDays: [],
      });
    }
    const summary = byInstrument.get(record.instrument);
    summary.daysWithTrades += 1;
    summary.totalEligibleTrades += record.eligibleCount;
    summary.volumeSum += record.volumeSum;
    summary.observedDays.push(record.trdDate);
    if (record.trdDate < summary.firstDate) summary.firstDate = record.trdDate;
    if (record.trdDate > summary.lastDate) summary.lastDate = record.trdDate;
  }
  return [...byInstrument.values()]
    .sort((a, b) => (a.instrument < b.instrument ? -1 : 1))
    .map((summary) => {
      const window = windows.get(summary.instrument) ?? shared;
      const observedSet = new Set(summary.observedDays);
      if (window == null) {
        return {
          ...summary,
          observedDays: undefined,
          windowDays: null,
          daysWithTradesInWindow: null,
          daysWithTradesOutsideWindow: null,
          daysWithoutTrades: null,
          density: null,
          windowStatus: "CONTRACT_CALENDAR_ABSENT",
        };
      }
      const windowSet = new Set(window);
      const observedInWindow = summary.observedDays.filter((day) => windowSet.has(day));
      const missingDays = window.filter((day) => !observedSet.has(day));
      return {
        ...summary,
        observedDays: undefined,
        windowDays: window.length,
        daysWithTradesInWindow: observedInWindow.length,
        daysWithTradesOutsideWindow: summary.daysWithTrades - observedInWindow.length,
        daysWithoutTrades: missingDays.length,
        density: window.length === 0 ? null : observedInWindow.length / window.length,
        windowStatus: "CONTRACT_CALENDAR",
      };
    });
}

export { SHARED_WINDOW as SHARED_CONTRACT_WINDOW };
