// Observación TOB (best ask por slot) para el puente. Fuente: regla del release
// exploratorio v2 `operations/exploratory/v2/build_tob_slots.py` (owner patch
// EM-SPEC-OWNER-PATCH-2026-09-24-02 §2-§4 y hallazgo BT04-H1-TOB-TIE), que se
// transcribe aquí una sola vez para poder probarla sin pyarrow. v2 no se
// reescribe ni se re-corre; TR-03 construye su propia observación TOB con la
// misma regla.
//
// Criterios anti-ilusión (docs/product/UI-04_DATA_REQUIREMENTS_AND_TODO.md §3):
//   - sólo `InstrumentType == Simple Instrument` y la maturity exacta (fuera spreads);
//   - ask > 0; si hay bid, bid < ask (libro no cruzado);
//   - el valor de un slot es el último quote con Tm <= slot y Tm > slot - MAX_AGE;
//   - si varias filas comparten el último Tm, gana el menor ask; a igual ask, el
//     menor AskSz conocido;
//   - se guarda AskSz para poder limitar el fill a la profundidad visible.
//
// Este módulo es puro: recibe filas TOB normalizadas y devuelve slots.

import { SLOT_LABELS, TOB_SLOT_RULE } from "./constants.mjs";
import { slotEpochsForDay } from "./time.mjs";
import { tradeEpochMs } from "../trades-source/delete-point-in-time.mjs";

function isNonEmpty(value) {
  return value !== undefined && value !== null && String(value).trim() !== "";
}

function numeric(value) {
  if (!isNonEmpty(value)) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

// Identidad de contrato del TOB: producto (4 primeras unidades del ShortCode,
// como v2) + maturity. Es la misma clave `ShortCode|Maturity` con la que TR-01
// cruza trades y reference.
export function tobContractKey(row) {
  const shortCode = String(row?.ShortCode ?? "");
  const maturity = String(row?.Maturity ?? "");
  if (shortCode.length < 4 || maturity === "") return "";
  return `${shortCode.slice(0, 4)}|${maturity}`;
}

function isUsableTobRow(row, productCodes) {
  if (row?.InstrumentType !== TOB_SLOT_RULE.instrumentType) return false;
  const shortCode = String(row?.ShortCode ?? "");
  if (shortCode.length < 4 || !productCodes.has(shortCode.slice(0, 4))) return false;
  if (String(row?.Maturity ?? "") === "") return false;
  const ask = numeric(row?.AskPx);
  if (ask === null || ask <= 0) return false;
  const bid = numeric(row?.BidPx);
  if (bid !== null && bid >= ask) return false;
  return tradeEpochMs(row?.Tm) !== null;
}

// Slots de UN día para los contratos de `productCodes`. Devuelve un Map
// contrato -> array de 20 entradas (o null), en el orden de SLOT_LABELS.
export function tobSlotsForDay(rows, dayIso, { productCodes, slotLabels = SLOT_LABELS } = {}) {
  const products = productCodes instanceof Set ? productCodes : new Set(productCodes ?? []);
  const groups = new Map();
  for (const row of rows) {
    if (!isUsableTobRow(row, products)) continue;
    const key = tobContractKey(row);
    if (key === "") continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  const dayEpochs = slotEpochsForDay(dayIso);
  const epochs = slotLabels.map((label) => dayEpochs[SLOT_LABELS.indexOf(label)]);
  const result = new Map();
  for (const [key, contractRows] of groups) {
    const parsed = contractRows
      .map((row) => ({
        epoch: tradeEpochMs(row.Tm),
        ask: numeric(row.AskPx),
        askSz: numeric(row.AskSz),
        bid: numeric(row.BidPx),
        rawTm: row.Tm,
      }))
      .sort((left, right) => left.epoch - right.epoch);
    const times = parsed.map((entry) => entry.epoch);
    const slots = [];
    for (const slotEpoch of epochs) {
      let index = upperBound(times, slotEpoch) - 1;
      if (index < 0 || slotEpoch - times[index] > TOB_SLOT_RULE.maxQuoteAgeSeconds * 1000) {
        slots.push(null);
        continue;
      }
      let first = index;
      while (first > 0 && times[first - 1] === times[index]) first -= 1;
      let best = parsed[first];
      for (let i = first + 1; i <= index; i += 1) {
        const candidate = parsed[i];
        const bestSize = best.askSz ?? 0;
        const candidateSize = candidate.askSz ?? 0;
        if (candidate.ask < best.ask || (candidate.ask === best.ask && candidateSize < bestSize)) {
          best = candidate;
        }
      }
      slots.push({ ask: best.ask, askSz: best.askSz, bid: best.bid, quoteTm: best.rawTm });
    }
    result.set(key, slots);
  }
  return result;
}

function upperBound(sorted, target) {
  let low = 0;
  let high = sorted.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (sorted[mid] <= target) low = mid + 1;
    else high = mid;
  }
  return low;
}

// Lee el documento de slots del job TOB (TR-03_TOB_SLOTS) y lo convierte al Map
// contrato -> día -> slots que consume el motor. No recalcula la regla: el job
// ya la aplicó; aquí sólo se valida la forma y se ordena de forma determinista.
export function tobSlotsDocumentToSeries(document) {
  const series = new Map();
  for (const [contract, days] of Object.entries(document?.series ?? {})) {
    const byDay = new Map();
    for (const [day, slots] of Object.entries(days)) {
      byDay.set(day, slots);
    }
    series.set(contract, byDay);
  }
  return series;
}

// Serie completa contrato -> día -> slots, a partir de filas de varios días.
// Determinista: días y contratos ordenados.
export function buildTobSlotSeries(rows, { productCodes, slotLabels = SLOT_LABELS } = {}) {
  const byDay = new Map();
  for (const row of rows) {
    const day = String(row?.TrdDate ?? "");
    if (day === "") continue;
    if (!byDay.has(day)) byDay.set(day, []);
    byDay.get(day).push(row);
  }
  const series = new Map();
  for (const day of [...byDay.keys()].sort()) {
    const daySlots = tobSlotsForDay(byDay.get(day), day, { productCodes, slotLabels });
    for (const [contract, slots] of daySlots) {
      if (!series.has(contract)) series.set(contract, new Map());
      series.get(contract).set(day, slots);
    }
  }
  return series;
}
