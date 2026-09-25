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

// Resumen por instrumento contra un calendario esperado (Exchange Days de la
// misión). `expectedDays` es obligatorio: un "día sin trades" sólo tiene sentido
// contra el calendario, no contra la ausencia de filas.
export function summarizeInstrumentCoverage(records, expectedDays) {
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
      // Los días esperados fuera de [firstDate, lastDate] son anteriores al
      // inicio o posteriores al vencimiento del instrumento: no cuentan ni como
      // cobertura ni como ausencia.
      const expectedInRange = expectedDays.filter((day) => day >= summary.firstDate && day <= summary.lastDate);
      const missingDays = daysWithoutTrades({ observedDays: summary.observedDays, expectedDays: expectedInRange });
      return {
        ...summary,
        observedDays: undefined,
        daysWithoutTrades: missingDays.length,
        density: expectedInRange.length === 0 ? null : summary.daysWithTrades / expectedInRange.length,
      };
    });
}
