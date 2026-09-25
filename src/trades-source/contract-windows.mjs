// Ventanas de vida de cada contrato para la cobertura de TR-01. Fuente:
// TRADES_MODE_PLAN.md TR-01 ("contenido de eex_derivative_reference (último día
// de negociación por contract, relación con ExpiryDate)") y patch 03 §3.4 ("la
// ventana ... sale del calendario de la misión y del calendario de negociación
// del mercado ..., nunca de la presencia de trades").
//
// La tabla `eex_derivative_reference` del archivo sellado trae, por contrato,
// `StartDate` (primer día de negociación) y `EndDate` (último día de
// negociación), verificados el 2026-09-25 en el primer miembro del archivo
// (data/lake/v1/table=eex_derivative_reference/cmdty=NATGAS/area=CEGHVTP___NCG/...).
// La ventana se expande con el calendario de negociación del mercado, no con los
// trades observados.

import { instrumentIdentity } from "./coverage.mjs";

export function contractWindowsFromReference(referenceRows, { exchangeDaysBetween }) {
  if (typeof exchangeDaysBetween !== "function") {
    throw new TypeError("contractWindowsFromReference requiere exchangeDaysBetween(start, end).");
  }
  const ranges = new Map();
  for (const row of referenceRows) {
    const instrument = instrumentIdentity(row);
    const startDate = row?.StartDate;
    const endDate = row?.EndDate;
    if (!instrument || !startDate || !endDate) continue;
    const current = ranges.get(instrument);
    if (current === undefined) {
      ranges.set(instrument, { startDate, endDate });
      continue;
    }
    if (startDate < current.startDate) current.startDate = startDate;
    if (endDate > current.endDate) current.endDate = endDate;
  }
  const windows = new Map();
  for (const [instrument, { startDate, endDate }] of ranges) {
    windows.set(instrument, exchangeDaysBetween(startDate, endDate));
  }
  return windows;
}
