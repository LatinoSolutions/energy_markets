// Materialización de las ventanas de campaign por misión (Gas/Power × Q/M)
// desde el calendario, SIN leer precios. Fuente:
// docs/canonical/v1_1_1/OWNER_PATCH_TRADES_MODE_2026-09-25.md §4 (zonas y
// reglas de ventana: Quarterly 3-1-3, Monthly 1-0-1, cutoff del día previo a
// la entrega), TRADES_MODE_PLAN.md TR-02 ("Materializar ventanas por misión
// (Quarterly 3-1-3, Monthly 1-0-1) para Gas y Power desde el calendario, SIN
// leer precios") y paquete del cliente verificado
// 01_campaigns/01_shared_campaign_rules.md §1-§2.
//
// Este módulo es PURO: recibe los días de Exchange del mercado (TR-01) y, si
// están disponibles, las filas de cobertura por instrumento/día de TR-01. No
// abre el lago ni el archivo del cliente, no toca `Px`/`AskPx`/`BidPx` y no
// calcula economía. La cobertura se ANEXA a cada campaign cuando TR-01 la
// aporta; NUNCA sustituye la lista de campaigns (una campaign sin cobertura
// sigue listada, con su estado honesto). No se usa `OUTCOME_LIKE_FIELDS` de
// campaign-register.mjs: eso filtra nombres de resultado, no campos de precio.

import { researchCampaignIdFor } from "../procurement-contract/campaign-contract.mjs";
import { contractKey } from "../trades-source/coverage.mjs";
import { compareIsoDates, parseIsoDate } from "./campaign-register.mjs";

// Patch 03 §4 y paquete del cliente §1. La ventana sale del calendario de la
// misión y del calendario de negociación del mercado, nunca de la presencia de
// trades (patch 03 §3.4).
export const TRADES_WINDOW_RULES = Object.freeze({
  Quarterly: "3-1-3: se negocia en los meses 4, 3 y 2 antes del inicio de entrega; el mes previo a la entrega es hueco",
  Monthly: "1-0-1: se negocia el mes anterior a la entrega; el día inmediatamente anterior al inicio de entrega queda excluido (cutoff Fundamental)",
});

// Las 4 misiones del patch 03 §6. `market` elige el calendario de negociación
// (gas THE o power DE, por separado) y `shortCode` es el producto base con el
// que la tabla de cobertura de TR-01 identifica el contrato.
export const TRADES_MISSIONS = Object.freeze({
  GAS_QUARTERLY: { product: "Gas", mission: "Quarterly", market: "GAS_THE", shortCode: "G0BQ" },
  GAS_MONTHLY: { product: "Gas", mission: "Monthly", market: "GAS_THE", shortCode: "G0BM" },
  POWER_QUARTERLY: { product: "Power", mission: "Quarterly", market: "POWER_DE", shortCode: "DEBQ" },
  POWER_MONTHLY: { product: "Power", mission: "Monthly", market: "POWER_DE", shortCode: "DEBM" },
});

// Patch 03 §1: Development empieza en la primera ventana COMPLETA dentro de la
// data. Gas Q y Power Q arrancan en 2021Q2 (2021Q1 abre 2020-09-01, antes del
// primer trade). Monthly no cambia: la entrega 2020-12 tiene ventana nov-2020,
// ya dentro de la data (primer trade 2020-11-02).
export const TRADES_DEV_START = Object.freeze({
  Quarterly: "2021Q2",
  Monthly: "2020-12",
});

const QUARTER_PATTERN = /^(\d{4})Q([1-4])$/;
const MONTH_PATTERN = /^(\d{4})-(0[1-9]|1[0-2])$/;
const LEGACY_MONTH_PATTERN = /^(\d{4})(0[1-9]|1[0-2])$/;

function pushError(errors, code, message, context = {}) {
  errors.push({ code, message, ...context });
}

function monthIndexOf(year, month) {
  return year * 12 + (month - 1);
}

function monthFromIndex(index) {
  return { year: Math.floor(index / 12), month: (index % 12) + 1 };
}

function isoDateOf(year, month, day) {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function lastDayOfMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function firstDayIso(year, month) {
  return isoDateOf(year, month, 1);
}

function lastDayIso(year, month) {
  return isoDateOf(year, month, lastDayOfMonth(year, month));
}

// Ventana 3-1-3 de un episodio Quarterly: [primer día del mes 4 antes de la
// entrega, último día del mes 2 antes de la entrega]. Es la misma convención
// que register-builder.mjs (fiscalWindow) y el paquete del cliente §1.
export function quarterlyWindow(maturity) {
  const match = QUARTER_PATTERN.exec(String(maturity));
  if (match === null) {
    return { ok: false, code: "INVALID_QUARTER_MATURITY", windowStart: null, windowEnd: null };
  }
  const year = Number(match[1]);
  const quarter = Number(match[2]);
  const deliveryStartMonth = (quarter - 1) * 3 + 1;
  const start = monthFromIndex(monthIndexOf(year, deliveryStartMonth) - 4);
  const end = monthFromIndex(monthIndexOf(year, deliveryStartMonth) - 2);
  return {
    ok: true,
    code: null,
    windowStart: firstDayIso(start.year, start.month),
    windowEnd: lastDayIso(end.year, end.month),
  };
}

// Ventana 1-0-1 de un episodio Monthly: el mes natural anterior a la entrega.
// El cutoff (paquete del cliente §2) excluye el día inmediatamente anterior al
// inicio de entrega, que es el último día natural de este mes; el deadline se
// resuelve contra el calendario con `excludeLastCalendarDay`.
export function monthlyWindow(maturity) {
  const match = MONTH_PATTERN.exec(String(maturity));
  if (match === null) {
    return { ok: false, code: "INVALID_MONTH_MATURITY", windowStart: null, windowEnd: null };
  }
  const delivery = monthFromIndex(monthIndexOf(Number(match[1]), Number(match[2])) - 1);
  return {
    ok: true,
    code: null,
    windowStart: firstDayIso(delivery.year, delivery.month),
    windowEnd: lastDayIso(delivery.year, delivery.month),
  };
}

// Último Exchange Day dentro de la ventana. Para Monthly el cutoff excluye el
// último día natural (el día antes de la entrega). Sin ningún Exchange Day en
// la ventana el deadline queda null: fail-closed, no se inventa.
export function deadlineFromExchangeDays({ windowStart, windowEnd, exchangeDays, excludeLastCalendarDay = false }) {
  const inWindow = exchangeDays.filter((day) =>
    compareIsoDates(day, windowStart) >= 0 && compareIsoDates(day, windowEnd) <= 0);
  const eligible = excludeLastCalendarDay
    ? inWindow.filter((day) => compareIsoDates(day, windowEnd) < 0)
    : inWindow;
  return eligible.length > 0 ? eligible[eligible.length - 1] : null;
}

// maturity canónica de Quarterly a partir del índice contable
// (year*4 + (quarter-1), misma convención que register-builder.mjs).
export function quarterlyMaturityOfIndex(index) {
  return `${Math.floor(index / 4)}Q${(index % 4) + 1}`;
}

// maturity canónica de Monthly a partir del índice contable de meses.
export function monthlyMaturityOfIndex(index) {
  const { year, month } = monthFromIndex(index);
  return `${year}-${String(month).padStart(2, "0")}`;
}

// Índice contable de una maturity canónica; null si no tiene la forma.
export function maturityIndex(mission, maturity) {
  if (mission === "Quarterly") {
    const match = QUARTER_PATTERN.exec(String(maturity));
    return match === null ? null : Number(match[1]) * 4 + (Number(match[2]) - 1);
  }
  if (mission === "Monthly") {
    const match = MONTH_PATTERN.exec(String(maturity));
    return match === null ? null : monthIndexOf(Number(match[1]), Number(match[2]));
  }
  return null;
}

// La tabla de trades/reference del lago nombra la entrega como `YYYYMM` (el
// primer mes de entrega en Quarterly, el mes de entrega en Monthly). TR-01
// agrega la cobertura con esa misma forma; se traduce a la maturity canónica
// (P-006 punto 6 / patch 03 §4 "IDs en formato canónico").
export function legacyMaturityFor(mission, maturity) {
  if (mission === "Quarterly") {
    const match = QUARTER_PATTERN.exec(String(maturity));
    if (match === null) return null;
    const firstMonth = (Number(match[2]) - 1) * 3 + 1;
    return `${match[1]}${String(firstMonth).padStart(2, "0")}`;
  }
  if (mission === "Monthly") {
    const match = MONTH_PATTERN.exec(String(maturity));
    return match === null ? null : `${match[1]}${match[2]}`;
  }
  return null;
}

// Inversa: identidad canónica desde el par (ShortCode, Maturity) de TR-01.
// G0B*/DEB* fija producto y tenor; el mes `YYYYMM` fija la maturity.
export function canonicalCampaignIdFromLegacy({ shortCode, maturity }) {
  const code = String(shortCode ?? "");
  const legacy = LEGACY_MONTH_PATTERN.exec(String(maturity ?? ""));
  if (legacy === null) return null;
  const product = code.startsWith("G0B") ? "Gas" : code.startsWith("DEB") ? "Power" : null;
  const tenor = code.slice(-1);
  const mission = tenor === "Q" ? "Quarterly" : tenor === "M" ? "Monthly" : null;
  if (product === null || mission === null) return null;
  const year = legacy[1];
  const month = Number(legacy[2]);
  if (mission === "Monthly") {
    return researchCampaignIdFor(product, mission, `${year}-${legacy[2]}`);
  }
  if (![1, 4, 7, 10].includes(month)) return null;
  return researchCampaignIdFor(product, mission, `${year}Q${(month - 1) / 3 + 1}`);
}

// Índice de cobertura por `ShortCode|Maturity` a partir de las filas agregadas
// de TR-01 (coverageByInstrumentDay). Sólo se leen identidad, día y conteos: los
// campos de precio no se tocan (el objeto NO se copia con spread, que
// dispararía cualquier getter). Se conserva el detalle por día para poder medir
// la cobertura DENTRO de la ventana de cada campaign (patch 03 §3.4: la ventana
// sale del calendario, no de la presencia de trades). Una fila sin `trdDate` no
// se puede atribuir a ninguna ventana y no se cuenta (fail-closed).
function indexCoverageRecords(coverageRecords) {
  const byContract = new Map();
  for (const record of coverageRecords) {
    const key = contractKey({ ShortCode: record?.shortCode, Maturity: record?.maturity });
    if (key === "") continue;
    if (!byContract.has(key)) {
      byContract.set(key, { byDay: new Map() });
    }
    const aggregate = byContract.get(key);
    const day = record?.trdDate ?? null;
    if (typeof day !== "string" || day.length === 0) continue;
    if (!aggregate.byDay.has(day)) {
      aggregate.byDay.set(day, { eligibleCount: 0, volumeSum: 0 });
    }
    const perDay = aggregate.byDay.get(day);
    const count = Number(record?.eligibleCount);
    if (Number.isFinite(count)) perDay.eligibleCount += count;
    const volume = Number(record?.volumeSum);
    if (Number.isFinite(volume)) perDay.volumeSum += volume;
  }
  return byContract;
}

// Cobertura TR-01 de una campaign, medida SÓLO sobre los Exchange Days de su
// ventana [windowStart, windowEnd] (patch 03 §3.4). Así `daysWithTrades` es un
// subconjunto de `windowDays` y `density` queda en [0, 1]; contar días de todo
// el contrato produce densidades falsas (>1) en el panel de TR-07. Sin filas
// para el contrato, la campaign sigue en la lista con `status: NO_COVERAGE`
// (nunca se cae por falta de data).
function coverageForCampaign({ campaign, coverageIndex, exchangeDays }) {
  const legacy = legacyMaturityFor(campaign.mission, campaign.maturity);
  const aggregate = legacy === null ? undefined : coverageIndex.get(`${campaign.shortCode}|${legacy}`);
  const windowExchangeDays = exchangeDays.filter((day) =>
    compareIsoDates(day, campaign.windowStart) >= 0 && compareIsoDates(day, campaign.windowEnd) <= 0);
  const windowDays = windowExchangeDays.length;
  const base = {
    source: "TR-01_COVERAGE",
    legacyMaturity: legacy,
    contract: `${campaign.shortCode}|${legacy ?? ""}`,
    windowDays,
  };
  if (aggregate === undefined) {
    return { ...base, status: "NO_COVERAGE", daysWithTrades: 0, totalEligibleTrades: 0, volumeSum: 0, firstDate: null, lastDate: null, density: null };
  }
  const observedDays = windowExchangeDays.filter((day) => aggregate.byDay.has(day));
  let totalEligibleTrades = 0;
  let volumeSum = 0;
  for (const day of observedDays) {
    const perDay = aggregate.byDay.get(day);
    totalEligibleTrades += perDay.eligibleCount;
    volumeSum += perDay.volumeSum;
  }
  return {
    ...base,
    status: "OBSERVED",
    daysWithTrades: observedDays.length,
    totalEligibleTrades,
    volumeSum,
    firstDate: observedDays[0] ?? null,
    lastDate: observedDays.at(-1) ?? null,
    density: windowDays === 0 ? null : observedDays.length / windowDays,
  };
}

// Materializa las campaigns de UNA misión desde el calendario. Enumeración
// determinista por maturity; se detiene en la primera campaign cuyo deadline
// cae más allá del horizonte de evidencia (las maturities crecen en orden).
export function materializeMissionCampaigns({
  missionKey,
  exchangeDays,
  coverageRecords = [],
  horizonEndIso,
  startMaturity = null,
} = {}) {
  const errors = [];
  const definition = TRADES_MISSIONS[missionKey];
  if (!definition) {
    pushError(errors, "UNKNOWN_MISSION", `La misión "${missionKey}" no es una de las 4 misiones TRADES.`);
    return { ok: false, missionKey, definition: null, campaigns: [], errors };
  }
  if (!Array.isArray(exchangeDays) || exchangeDays.length === 0) {
    pushError(errors, "MISSING_EXCHANGE_CALENDAR", `La misión "${missionKey}" no tiene calendario de Exchange Days; sin calendario no hay ventana (patch 03 §3.4).`);
    return { ok: false, missionKey, definition, campaigns: [], errors };
  }
  if (!parseIsoDate(horizonEndIso).ok) {
    pushError(errors, "MISSING_HORIZON_END", `La misión "${missionKey}" no declara horizonEndIso ISO-8601; sin horizonte no se acota la enumeración.`);
    return { ok: false, missionKey, definition, campaigns: [], errors };
  }

  const { product, mission, shortCode } = definition;
  const firstMaturity = startMaturity ?? TRADES_DEV_START[mission];
  const startIndex = maturityIndex(mission, firstMaturity);
  if (startIndex === null) {
    pushError(errors, "INVALID_START_MATURITY", `La maturity inicial "${firstMaturity}" no tiene forma canónica para ${mission}.`);
    return { ok: false, missionKey, definition, campaigns: [], errors };
  }

  const orderedDays = exchangeDays.slice().sort(compareIsoDates);
  const coverageIndex = indexCoverageRecords(coverageRecords);
  const campaigns = [];
  for (let index = startIndex; ; index += 1) {
    const maturity = mission === "Quarterly" ? quarterlyMaturityOfIndex(index) : monthlyMaturityOfIndex(index);
    const window = mission === "Quarterly" ? quarterlyWindow(maturity) : monthlyWindow(maturity);
    const deadline = deadlineFromExchangeDays({
      windowStart: window.windowStart,
      windowEnd: window.windowEnd,
      exchangeDays: orderedDays,
      excludeLastCalendarDay: mission === "Monthly",
    });
    if (deadline === null) {
      pushError(errors, "WINDOW_WITHOUT_EXCHANGE_DAY", `La campaign "${maturity}" no tiene ningún Exchange Day en su ventana; no se materializa una ventana vacía.`, { maturity });
      break;
    }
    if (compareIsoDates(deadline, horizonEndIso) > 0) break;

    const campaign = {
      campaignId: researchCampaignIdFor(product, mission, maturity),
      product,
      mission,
      maturity,
      shortCode,
      windowStart: window.windowStart,
      windowEnd: window.windowEnd,
      deadline,
      windowRule: TRADES_WINDOW_RULES[mission],
    };
    campaign.coverage = coverageForCampaign({ campaign, coverageIndex, exchangeDays: orderedDays });
    campaigns.push(campaign);
  }
  return { ok: errors.length === 0, missionKey, definition, campaigns, errors };
}

// Materializa las 4 misiones por separado (patch 03 §6: nunca se mezclan).
export function materializeTradesWindows({
  gasExchangeDays,
  powerExchangeDays,
  coverageRecords = [],
  horizonEndIso,
  startMaturities = {},
} = {}) {
  const errors = [];
  const missions = {};
  for (const missionKey of Object.keys(TRADES_MISSIONS)) {
    const market = TRADES_MISSIONS[missionKey].market;
    const exchangeDays = market === "GAS_THE" ? gasExchangeDays : powerExchangeDays;
    const result = materializeMissionCampaigns({
      missionKey,
      exchangeDays,
      coverageRecords,
      horizonEndIso,
      startMaturity: startMaturities[missionKey] ?? null,
    });
    errors.push(...result.errors);
    missions[missionKey] = result;
  }
  return { ok: errors.length === 0, missions, errors };
}
