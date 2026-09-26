// Horas de entrega por misión (TR-05). Fuente: paquete del cliente 2026-09-23
// ("Use contract delivery hours when total MWh/notional is needed"),
// OWNER_PATCH_TRADES_MODE_2026-09-25.md §4 (Quarterly 3-1-3, Monthly 1-0-1) y
// TRADES_MODE_PLAN.md TR-05 ("Productos y volúmenes por misión: Power no puede
// caer en la rama Monthly por defecto").
//
// El backtest exploratorio calcula las horas con `deliveryHours(product,
// maturity)`, que asume 3 meses sólo para el producto `G0BQ`: Power Quarterly
// (DEBQ) caería en 1 mes. Como `comparison.mjs` no se edita, el motor TRADES
// calcula las horas por MISIÓN (tenor declarado), con la misma convención de
// gas day 06:00-06:00 Berlin ajustada por cambio de hora.

function lastSunday(year, monthIndex) {
  const date = new Date(Date.UTC(year, monthIndex + 1, 0));
  date.setUTCDate(date.getUTCDate() - date.getUTCDay());
  return date.toISOString().slice(0, 10);
}

function deliveryStartOf(mission, maturity) {
  if (mission === "Quarterly") {
    const match = /^(\d{4})Q([1-4])$/.exec(String(maturity));
    if (match === null) return null;
    return { year: Number(match[1]), month: (Number(match[2]) - 1) * 3, months: 3 };
  }
  if (mission === "Monthly") {
    const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(String(maturity));
    if (match === null) return null;
    return { year: Number(match[1]), month: Number(match[2]) - 1, months: 1 };
  }
  return null;
}

// Horas del contrato de entrega. `null` si la misión o la maturity no tienen
// forma canónica: fail-closed, no se asume un tenor.
export function deliveryHoursForMission({ mission, maturity } = {}) {
  const start = deliveryStartOf(mission, maturity);
  if (start === null) return null;
  const startMs = Date.UTC(start.year, start.month, 1);
  const endMs = Date.UTC(start.year, start.month + start.months, 1);
  let hours = (endMs - startMs) / 3600000;
  for (let year = start.year; year <= start.year + 1; year += 1) {
    const spring = Date.parse(`${lastSunday(year, 2)}T00:00:00Z`) - 86400000;
    const autumn = Date.parse(`${lastSunday(year, 9)}T00:00:00Z`) - 86400000;
    if (spring >= startMs && spring < endMs) hours -= 1;
    if (autumn >= startMs && autumn < endMs) hours += 1;
  }
  return hours;
}
