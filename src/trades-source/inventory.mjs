// Inventario de una fuente de trades. Fuente: TRADES_MODE_PLAN.md TR-01
// ("Inventario del archivo: tablas, commodities, áreas, instrumentos, fechas").
// Es agnóstico de la fuente: recibe filas normalizadas del lago o del archivo y
// resume su contenido. No aplica la regla de elegibilidad; para eso está
// eligibility.mjs.

export function buildTradesInventory(rows, { sourceLabel = null } = {}) {
  const tables = new Set();
  const commodities = new Set();
  const areas = new Set();
  const instruments = new Set();
  const dates = new Set();
  const byCommodityArea = new Map();

  for (const row of rows) {
    const table = row?._source ?? row?.source ?? null;
    if (table) tables.add(table);
    const cmdty = row?.Cmdty ?? "";
    const area = row?.Area ?? "";
    if (cmdty) commodities.add(cmdty);
    if (area) areas.add(area);
    const instrument = row?.InstrumentISIN ?? [row?.ShortCode ?? "", row?.Maturity ?? ""].filter(Boolean).join("|");
    if (instrument) instruments.add(instrument);
    if (row?.TrdDate) dates.add(row.TrdDate);
    const key = `${cmdty}|${area}`;
    byCommodityArea.set(key, (byCommodityArea.get(key) ?? 0) + 1);
  }

  const sortedDates = [...dates].sort();
  return {
    sourceLabel,
    rowCount: rows.length,
    tables: [...tables].sort(),
    commodities: [...commodities].sort(),
    areas: [...areas].sort(),
    instrumentCount: instruments.size,
    instruments: [...instruments].sort(),
    dateMin: sortedDates[0] ?? null,
    dateMax: sortedDates[sortedDates.length - 1] ?? null,
    dateCount: sortedDates.length,
    byCommodityArea: Object.fromEntries([...byCommodityArea.entries()].sort()),
  };
}
