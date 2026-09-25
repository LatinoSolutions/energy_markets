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

import { contractKey, instrumentIdentity } from "./coverage.mjs";

// Las ventanas se indexan por `ShortCode|Maturity` (contractKey), la misma clave
// con la que la cobertura cruza los trades. El reference no siempre trae
// `InstrumentISIN`; cruzar por ISIN dejaría cada instrumento sin ventana
// (TR01-REFERENCE-IDENTITY-MISMATCH). Un contrato sin ShortCode/Maturity no
// inventa ventana.
export function contractWindowsFromReference(referenceRows, { exchangeDaysBetween }) {
  if (typeof exchangeDaysBetween !== "function") {
    throw new TypeError("contractWindowsFromReference requiere exchangeDaysBetween(start, end).");
  }
  const ranges = new Map();
  for (const row of referenceRows) {
    const contract = contractKey(row);
    const startDate = row?.StartDate;
    const endDate = row?.EndDate;
    if (!contract || !startDate || !endDate) continue;
    const current = ranges.get(contract);
    if (current === undefined) {
      ranges.set(contract, { startDate, endDate });
      continue;
    }
    if (startDate < current.startDate) current.startDate = startDate;
    if (endDate > current.endDate) current.endDate = endDate;
  }
  const windows = new Map();
  for (const [contract, { startDate, endDate }] of ranges) {
    windows.set(contract, exchangeDaysBetween(startDate, endDate));
  }
  return windows;
}

// Relación `EndDate` ↔ `ExpiryDate` que pide el plan TR-01 ("contenido de
// eex_derivative_reference ... relación con ExpiryDate"). `EndDate` es el último
// día de negociación; `ExpiryDate` el vencimiento del contrato. Cuenta CONTRATOS
// (una entrada por instrumento), no filas: si la referencia trae más de una fila
// por contrato se colapsan. Sólo compara fechas completas YYYY-MM-DD; una fecha
// ausente o inválida no se inventa y se declara.
function normalizeCalendarDay(value) {
  const text = String(value ?? "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}

function laterDay(current, candidate) {
  if (candidate === null) return current;
  if (current === null || candidate > current) return candidate;
  return current;
}

export function measureReferenceExpiryRelation(referenceRows) {
  const byContract = new Map();
  let anonymous = 0;
  for (const row of referenceRows ?? []) {
    const instrument = instrumentIdentity(row);
    // Una fila sin identidad no se atribuye a un contrato ajeno: cuenta sola.
    const key = instrument || `__anonymous__${anonymous++}`;
    const current = byContract.get(key) ?? { endDate: null, expiryDate: null };
    current.endDate = laterDay(current.endDate, normalizeCalendarDay(row?.EndDate));
    current.expiryDate = laterDay(current.expiryDate, normalizeCalendarDay(row?.ExpiryDate));
    byContract.set(key, current);
  }
  const summary = {
    contractCount: 0,
    withEndDate: 0,
    withExpiryDate: 0,
    comparable: 0,
    endDateBeforeExpiry: 0,
    endDateEqualsExpiry: 0,
    endDateAfterExpiry: 0,
  };
  for (const { endDate, expiryDate } of byContract.values()) {
    summary.contractCount += 1;
    if (endDate !== null) summary.withEndDate += 1;
    if (expiryDate !== null) summary.withExpiryDate += 1;
    if (endDate === null || expiryDate === null) continue;
    summary.comparable += 1;
    if (endDate < expiryDate) summary.endDateBeforeExpiry += 1;
    else if (endDate > expiryDate) summary.endDateAfterExpiry += 1;
    else summary.endDateEqualsExpiry += 1;
  }
  return summary;
}
