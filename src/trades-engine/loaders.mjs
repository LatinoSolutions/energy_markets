// Loaders del motor TRADES (TR-05), parametrizados por mercado y misión, en
// ruta versionada nueva. Fuente:
// docs/canonical/v1_1_1/OWNER_PATCH_TRADES_MODE_2026-09-25.md
// (EM-SPEC-OWNER-PATCH-2026-09-25-03) §3.4 ("la ventana de cada campaign sale
// del calendario de la misión y del calendario de negociación del mercado, nunca
// de la presencia de trades") y TRADES_MODE_PLAN.md TR-05 ("Loaders
// parametrizados por mercado y misión, en ruta nueva; el loader TOB también se
// generaliza en ruta nueva ... para que el contraste del puente exista en las 4
// misiones").
//
// El loader TOB NO reescribe ni re-corre el release v2: transcribe la misma
// regla ya implementada en `src/trades-bridge/tob-slots.mjs` y la aplica a
// cualquier producto base (G0B*/DEB*), de modo que el puente de Power tenga su
// propia serie. Los loaders filtran por ventana de campaign y por zona; ningún
// loader inventa días a partir de la observación.

import { buildTobSlotSeries, tobSlotsDocumentToSeries } from "../trades-bridge/tob-slots.mjs";
import { ZONE_BOUNDARIES, ZONES } from "../oos-reservation/trades-zones.mjs";
import { legacyMaturityFor } from "../oos-reservation/trades-windows.mjs";
import { compareIsoDates, parseIsoDate } from "../oos-reservation/campaign-register.mjs";
import { contractKey } from "../trades-source/coverage.mjs";
import { missionDefinition } from "./missions.mjs";

// Zonas donde el motor puede correr una campaign. EMBARGO, PURGE y FORWARD no
// se corren (patch 03 §4): una campaign que cruza el embargo está purgada y el
// forward no se materializa hasta el freeze.
export const RUNNABLE_ZONES = Object.freeze([
  ZONES.DEVELOPMENT,
  ZONES.OOS_HISTORICO,
  ZONES.PUENTE,
  ZONES.POST_PUENTE,
]);

export function isRunnableZone(zone) {
  return RUNNABLE_ZONES.includes(zone);
}

// Ventana de la campaign: [windowStart, deadline]. La ventana sale del
// calendario de la misión (TR-02) y se resuelve contra los Exchange Days del
// mercado; nunca de los días con trade.
export function tradingDaysForCampaign({ campaign, exchangeDays } = {}) {
  if (!campaign || !Array.isArray(exchangeDays) || exchangeDays.length === 0) {
    return { ok: false, code: "MISSING_CALENDAR", tradingDays: [] };
  }
  if (!parseIsoDate(campaign.windowStart).ok || !parseIsoDate(campaign.deadline).ok) {
    return { ok: false, code: "INVALID_CAMPAIGN_WINDOW", tradingDays: [] };
  }
  const tradingDays = exchangeDays
    .filter((day) => compareIsoDates(day, campaign.windowStart) >= 0 && compareIsoDates(day, campaign.deadline) <= 0)
    .sort(compareIsoDates);
  return { ok: true, code: null, tradingDays };
}

// Índice `ShortCode|Maturity` -> filas. Es la misma clave de cruce de TR-01.
export function indexTradesByContract(rows) {
  const index = new Map();
  for (const row of rows ?? []) {
    const key = contractKey(row);
    if (key === "") continue;
    if (!index.has(key)) index.set(key, []);
    index.get(key).push(row);
  }
  return index;
}

// Filas del contrato de una campaign, por su maturity legada `YYYYMM` (la que
// usa la tabla del lago). Sin contrato no hay filas: fail-closed.
export function contractRowsForCampaign({ index, campaign } = {}) {
  if (!(index instanceof Map) || !campaign) return [];
  const legacy = legacyMaturityFor(campaign.mission, campaign.maturity);
  if (legacy === null) return [];
  return index.get(`${campaign.shortCode}|${legacy}`) ?? [];
}

// Filtro por zona sobre días ISO. La campaña se corre por su ventana; este
// filtro se expone aparte para verificar que ningún loader cruza de zona.
export function filterDaysByZone({ days, zone } = {}) {
  const bounds = zoneBounds(zone);
  if (bounds === null) return [];
  return (days ?? []).filter((day) => compareIsoDates(day, bounds.startIso) >= 0 && compareIsoDates(day, bounds.endIso) <= 0);
}

export function filterTradesByZone({ rows, zone } = {}) {
  const bounds = zoneBounds(zone);
  if (bounds === null) return [];
  return (rows ?? []).filter((row) => {
    const day = row?.TrdDate ?? "";
    return compareIsoDates(day, bounds.startIso) >= 0 && compareIsoDates(day, bounds.endIso) <= 0;
  });
}

function zoneBounds(zone) {
  switch (zone) {
    case ZONES.DEVELOPMENT:
      return { startIso: "0000-01-01", endIso: ZONE_BOUNDARIES.DEVELOPMENT_END };
    case ZONES.OOS_HISTORICO:
      return { startIso: ZONE_BOUNDARIES.OOS_START, endIso: ZONE_BOUNDARIES.OOS_END };
    case ZONES.EMBARGO:
      return { startIso: ZONE_BOUNDARIES.EMBARGO_START, endIso: ZONE_BOUNDARIES.EMBARGO_END };
    case ZONES.PUENTE:
      return { startIso: ZONE_BOUNDARIES.BRIDGE_START, endIso: ZONE_BOUNDARIES.BRIDGE_END };
    case ZONES.POST_PUENTE:
      return { startIso: ZONE_BOUNDARIES.POST_BRIDGE_START, endIso: "9999-12-31" };
    default:
      return null;
  }
}

// Serie TOB (Map contrato -> Map día -> slots) desde un documento de slots del
// job. No recalcula la regla: la aplicó el job; aquí sólo se valida la forma.
export function loadTobSeries({ slotsDocument } = {}) {
  return tobSlotsDocumentToSeries(slotsDocument ?? {});
}

// Serie TOB construida desde filas crudas de top-of-book, generalizada por
// misión: `buildTobSlotSeries` (misma regla del release v2, transcrita en
// trades-bridge) acepta cualquier producto base, así que Power DE tiene su
// propia serie con DEBQ/DEBM sin tocar el release v2 de Gas.
export function buildTobSlotsForMission({ rows, missionKey } = {}) {
  const definition = missionDefinition(missionKey);
  if (!definition.ok) return { ok: false, code: definition.code, series: null };
  const series = buildTobSlotSeries(rows ?? [], { productCodes: [definition.definition.shortCode] });
  return { ok: true, code: null, series };
}

// Slots TOB del contrato de una campaign. Misma clave `ShortCode|Maturity` que
// los trades; el producto base fija mercado/misión, así que Power no toma la
// serie de Gas.
export function tobSlotsForCampaign({ series, campaign } = {}) {
  if (!(series instanceof Map) || !campaign) return null;
  const legacy = legacyMaturityFor(campaign.mission, campaign.maturity);
  if (legacy === null) return null;
  return series.get(`${campaign.shortCode}|${legacy}`) ?? null;
}
