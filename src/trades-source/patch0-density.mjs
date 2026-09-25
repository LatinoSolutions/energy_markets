// Reproducción de las mediciones preliminares del patch 03 §0 (densidad, días sin
// trades). Fuente: docs/canonical/v1_1_1/OWNER_PATCH_TRADES_MODE_2026-09-25.md §0
// ("Gas Quarterly front sin ningún trade el 58 % de los días en 2021 ... Power DE
// con <= 3,3 % de días sin trades en Q y M hasta 3 meses de distancia") y
// TRADES_MODE_PLAN.md TR-01 ("Reproducir como artefacto las mediciones
// preliminares del patch 03 §0 (densidad, días sin trades, duplicación)").
//
// Este módulo sólo materializa la medición; no decide la regla de elegibilidad
// (eligibility.mjs). El % de días sin trades se cuenta contra el calendario de
// negociación del mercado (gas THE o power DE, por separado), nunca contra la
// presencia de trades, y desglosado por año.

import { DEFAULT_BROKEN_SPREAD_POLICY, isEligibleTrade } from "./eligibility.mjs";
import { coverageByInstrumentDay } from "./coverage.mjs";

export const MISSION = Object.freeze({
  GAS_QUARTERLY: "GAS_QUARTERLY",
  GAS_MONTHLY: "GAS_MONTHLY",
  POWER_QUARTERLY: "POWER_QUARTERLY",
  POWER_MONTHLY: "POWER_MONTHLY",
});

// Productos base declarados: TRADES_MODE_PLAN.md TR-05 (G0BQ/G0BM) y patch 03 §6
// (Power base DEBQ/DEBM salvo decisión de Bru). El sufijo Q/M fija el tenor.
const MARKETS = Object.freeze({
  GAS_THE: { cmdty: "NATGAS", area: "THE", productPrefix: "G0B" },
  POWER_DE: { cmdty: "POWER", area: "DE", productPrefix: "DEB" },
});

export function marketOf(row) {
  for (const [market, definition] of Object.entries(MARKETS)) {
    if (row?.Cmdty === definition.cmdty && row?.Area === definition.area) return market;
  }
  return null;
}

export function classifyMission(row) {
  const market = marketOf(row);
  if (market === null) return null;
  const shortCode = String(row?.ShortCode ?? "");
  if (!shortCode.startsWith(MARKETS[market].productPrefix)) return null;
  const tenor = shortCode.slice(-1);
  if (tenor !== "Q" && tenor !== "M") return null;
  return {
    market,
    tenor,
    mission:
      market === "GAS_THE"
        ? tenor === "Q"
          ? MISSION.GAS_QUARTERLY
          : MISSION.GAS_MONTHLY
        : tenor === "Q"
          ? MISSION.POWER_QUARTERLY
          : MISSION.POWER_MONTHLY,
  };
}

// Igual que classifyMission pero sobre un registro ya agregado por
// coverageByInstrumentDay (claves cmdty/area/shortCode en minúscula).
function classifyCoverageRecord(record) {
  return classifyMission({
    Cmdty: record?.cmdty,
    Area: record?.area,
    ShortCode: record?.shortCode,
    Maturity: record?.maturity,
  });
}

// Meses entre la fecha de trade (YYYY-MM-DD) y el mes de entrega (Maturity
// YYYYMM). Negativo = contrato ya entregado; null = sin dato. Es la "distancia a
// entrega" del patch 03 §4.
export function monthsToDelivery(trdDate, maturity) {
  const [trdYear, trdMonth] = String(trdDate).split("-").map(Number);
  const month = String(maturity ?? "");
  if (!Number.isInteger(trdYear) || month.length !== 6) return null;
  const maturityYear = Number(month.slice(0, 4));
  const maturityMonth = Number(month.slice(4, 6));
  if (!Number.isInteger(maturityYear) || !Number.isInteger(maturityMonth)) return null;
  return (maturityYear - trdYear) * 12 + (maturityMonth - trdMonth);
}

// Contrato front de `day`: el de menor distancia a entrega no negativa, y dentro
// de `maxDistanceMonths` si se fija (patch 03 §0: Power "<= 3 meses de
// distancia"). Devuelve null si no hay contrato elegible ese día.
export function frontContract(day, catalog, { maxDistanceMonths = Infinity } = {}) {
  let best = null;
  for (const [instrument, maturity] of catalog) {
    const distance = monthsToDelivery(day, maturity);
    if (distance === null || distance < 0 || distance > maxDistanceMonths) continue;
    if (best === null || distance < best.distance || (distance === best.distance && maturity < best.maturity)) {
      best = { instrument, maturity, distanceMonths: distance };
    }
  }
  return best;
}

// Índices de una misión: catálogo instrumento->entrega y, por día, el conjunto de
// instrumentos con trade elegible. Se construyen desde los registros de
// cobertura (ya vienen por instrumento y día) o desde filas crudas.
function indexesForMission(records, mission) {
  const catalog = new Map();
  const instrumentsByDay = new Map();
  for (const record of records) {
    if (classifyCoverageRecord(record)?.mission !== mission) continue;
    catalog.set(record.instrument, record.maturity);
    if (!instrumentsByDay.has(record.trdDate)) instrumentsByDay.set(record.trdDate, new Set());
    instrumentsByDay.get(record.trdDate).add(record.instrument);
  }
  return { catalog, instrumentsByDay };
}

export function densityFromIndexes({ mission, catalog, instrumentsByDay, calendarDays, maxDistanceMonths = Infinity }) {
  const byYear = new Map();
  for (const day of calendarDays) {
    const year = day.slice(0, 4);
    if (!byYear.has(year)) {
      byYear.set(year, { year, exchangeDays: 0, daysWithFrontTrade: 0, daysWithoutTrades: 0 });
    }
    const entry = byYear.get(year);
    entry.exchangeDays += 1;
    const front = frontContract(day, catalog, { maxDistanceMonths });
    const hasFrontTrade = front !== null && (instrumentsByDay.get(day)?.has(front.instrument) ?? false);
    if (hasFrontTrade) entry.daysWithFrontTrade += 1;
    else entry.daysWithoutTrades += 1;
  }
  return {
    mission,
    maxDistanceMonths: Number.isFinite(maxDistanceMonths) ? maxDistanceMonths : null,
    contractCount: catalog.size,
    years: [...byYear.values()].map((entry) => ({
      ...entry,
      rateOfDaysWithoutTrades: entry.exchangeDays === 0 ? null : entry.daysWithoutTrades / entry.exchangeDays,
    })),
  };
}

// Densidad §0 a partir de los registros de cobertura del agregador (day-local,
// sin volver a tener las filas crudas en memoria).
export function measurePatch0FromCoverage({ coverageRecords, calendars, maxDistanceMonths = Infinity }) {
  const results = [];
  for (const [mission, calendarDays] of Object.entries(calendars ?? {})) {
    if (!calendarDays || calendarDays.length === 0) continue;
    const { catalog, instrumentsByDay } = indexesForMission(coverageRecords, mission);
    results.push(densityFromIndexes({ mission, catalog, instrumentsByDay, calendarDays, maxDistanceMonths }));
  }
  return results.sort((a, b) => (a.mission < b.mission ? -1 : 1));
}

// API de prueba: densidad de una misión directamente desde filas crudas.
export function measurePatch0Density({
  rows,
  mission,
  calendarDays,
  maxDistanceMonths = Infinity,
  brokenSpreadPolicy = DEFAULT_BROKEN_SPREAD_POLICY,
}) {
  const eligible = rows.filter(
    (row) => classifyMission(row)?.mission === mission && isEligibleTrade(row, { brokenSpreadPolicy }),
  );
  const coverageRecords = coverageByInstrumentDay(eligible);
  const { catalog, instrumentsByDay } = indexesForMission(coverageRecords, mission);
  return densityFromIndexes({ mission, catalog, instrumentsByDay, calendarDays, maxDistanceMonths });
}
