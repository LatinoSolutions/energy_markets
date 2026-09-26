// Cobertura por período de cada fuente candidata de trades/TOB (DATA-02). Fuente:
// PLAN_STATUS.md DATA-02 (Bru, 2026-09-26: PARCHE VERIFICADO) y
// OWNER_PATCH_TRADES_MODE_2026-09-25.md §3.4 (la ventana sale del calendario,
// nunca de la presencia de data) y §4 (zonas y fuentes por zona).
//
// Cada fuente se mide por separado; la selección diaria se calcula después
// con una regla predeclarada, sin consultar resultados de estrategia.

import { contractKey } from "./coverage.mjs";
import { legacyMaturityFor } from "../oos-reservation/trades-windows.mjs";

export const PERIOD_COVERAGE_VERSION = "DATA-02-period-coverage-3";

// Umbrales de ingeniería predeclarados. La mediana de tres o más días vecinos
// amortigua un pull cortado aislado. El mínimo absoluto evita aprobar una sola
// fila cuando la muestra normal del contrato es muy tenue.
export const PATCH_COMPLETENESS_RULE = Object.freeze({
  version: "DATA-02-patch-completeness-1",
  peerDistanceCalendarDays: 14,
  minPositivePeerDays: 3,
  minDailyEligibleTrades: 2,
  minFractionOfPeerMedian: 0.5,
  peerScope: "same ShortCode|Maturity, within calendar-day distance to delivery",
  statistic: "median of positive eligible-trade counts; candidate >= max(2, ceil(0.5 * median))",
});

export const PARTITION_TABLES = Object.freeze({
  TRADES: "eex_derivative_trade",
  TOB: "eex_derivative_top_of_book",
});

// Áreas exactas de las 4 misiones (patch 03 §6: G0B* en THE, DEB* en DE). Las
// áreas de spread (THE___TTF, DE___FR, ...) no alimentan ninguna misión.
export const MARKET_AREAS = Object.freeze({
  GAS_THE: { cmdty: "NATGAS", area: "THE" },
  POWER_DE: { cmdty: "POWER", area: "DE" },
});

// Patch 03 §4, columna "Fuentes": TOB sólo se exige en el puente. En post-puente
// "TR-01 dice si trae TOB": se mide pero no se exige.
const ZONES_REQUIRING_TOB = Object.freeze(["PUENTE"]);

export const DAY_STATUS = Object.freeze({
  SEALED: "SEALED",
  PRESENT_WITH_EXCLUDED_PULLS: "PRESENT_WITH_EXCLUDED_PULLS",
  EXCLUDED_BY_CLIENT: "EXCLUDED_BY_CLIENT",
  ABSENT: "ABSENT",
  OUT_OF_SOURCE_RANGE: "OUT_OF_SOURCE_RANGE",
});

export const CAMPAIGN_STATUS = Object.freeze({
  FULL: "FULL",
  FULL_WITH_EXCLUDED_PULLS: "FULL_WITH_EXCLUDED_PULLS",
  PARTIAL: "PARTIAL",
  NONE: "NONE",
  NOT_MEASURED: "NOT_MEASURED",
});

export function partitionKey(table, cmdty, area) {
  return `${table}|${cmdty}|${area}`;
}

const HIVE_PATTERN = /table=([^/]+)\/cmdty=([^/]+)\/area=([^/]+)\/trd_date=(\d{4}-\d{2}-\d{2})\//;

const WANTED_KEYS = new Set(
  Object.values(PARTITION_TABLES).flatMap((table) =>
    Object.values(MARKET_AREAS).map(({ cmdty, area }) => partitionKey(table, cmdty, area))),
);

function emptyPartitionIndex() {
  const index = {};
  for (const key of WANTED_KEYS) index[key] = { included: {}, excluded: {} };
  return index;
}

// Índice de particiones del archivo sellado desde su propia selección
// (`files.jsonl`) y sus exclusiones (`exclusions.jsonl`, README del archivo:
// "active lake files intentionally excluded because their raw pull lineage is
// not sealed"). Cuenta pulls por día; no lee parquet.
export function indexArchivePartitions({ fileEntries = [], exclusionEntries = [] } = {}) {
  const index = emptyPartitionIndex();
  for (const entry of fileEntries) {
    const match = HIVE_PATTERN.exec(entry?.archive_path ?? "");
    if (match === null) continue;
    const key = partitionKey(match[1], match[2], match[3]);
    if (!WANTED_KEYS.has(key)) continue;
    const day = match[4];
    index[key].included[day] = (index[key].included[day] ?? 0) + 1;
  }
  for (const entry of exclusionEntries) {
    const match = HIVE_PATTERN.exec(entry?.source_path ?? "");
    if (match === null) continue;
    const key = partitionKey(match[1], match[2], match[3]);
    if (!WANTED_KEYS.has(key)) continue;
    const day = match[4];
    const reason = entry?.reason ?? "UNSPECIFIED";
    const slot = index[key].excluded[day] ?? { pulls: 0, reasons: [] };
    slot.pulls += 1;
    if (!slot.reasons.includes(reason)) slot.reasons.push(reason);
    index[key].excluded[day] = slot;
  }
  return index;
}

// Índice del lago desde el listado de directorios `trd_date=` que tienen al
// menos un pull. El lago no tiene exclusiones declaradas.
export function indexLakePartitions(listing = {}) {
  const index = emptyPartitionIndex();
  for (const key of WANTED_KEYS) {
    for (const [day, pulls] of Object.entries(listing[key] ?? {})) {
      if (Number(pulls) > 0) index[key].included[day] = Number(pulls);
    }
  }
  return index;
}

export function classifyDay({ day, partitions, range }) {
  if (day < range.from || day > range.to) return DAY_STATUS.OUT_OF_SOURCE_RANGE;
  const included = partitions.included[day] ?? 0;
  const excluded = partitions.excluded[day]?.pulls ?? 0;
  if (included > 0 && excluded === 0) return DAY_STATUS.SEALED;
  if (included > 0) return DAY_STATUS.PRESENT_WITH_EXCLUDED_PULLS;
  if (excluded > 0) return DAY_STATUS.EXCLUDED_BY_CLIENT;
  return DAY_STATUS.ABSENT;
}

// FULL exige todos los días SEALED. Un día con pulls excluidos puede estar
// incompleto y el listado no lo puede probar: si todos los días tienen data pero
// alguno con pulls excluidos, la campaign queda FULL_WITH_EXCLUDED_PULLS.
function partitionCoverage({ windowDays, partitions, range }) {
  const counts = Object.fromEntries(Object.values(DAY_STATUS).map((status) => [status, 0]));
  const notSealedDays = [];
  for (const day of windowDays) {
    const status = classifyDay({ day, partitions, range });
    counts[status] += 1;
    if (status !== DAY_STATUS.SEALED) notSealedDays.push({ day, status });
  }
  const daysWithData = counts.SEALED + counts.PRESENT_WITH_EXCLUDED_PULLS;
  let status = CAMPAIGN_STATUS.PARTIAL;
  if (windowDays.length > 0 && daysWithData === windowDays.length) {
    status = counts.SEALED === windowDays.length ? CAMPAIGN_STATUS.FULL : CAMPAIGN_STATUS.FULL_WITH_EXCLUDED_PULLS;
  }
  if (daysWithData === 0) status = CAMPAIGN_STATUS.NONE;
  return { status, windowDays: windowDays.length, daysWithData, dayCounts: counts, notSealedDays };
}

// Índice por contrato `ShortCode|Maturity` → día → trades elegibles, desde el
// campo `coverage` de un TRADES_MEASUREMENT de TR-01. Sólo lee identidad, día
// y conteo.
export function indexEligibleCoverage(coverageRecords) {
  const byContract = new Map();
  for (const record of coverageRecords) {
    const key = contractKey({ ShortCode: record?.shortCode, Maturity: record?.maturity });
    const day = record?.trdDate;
    if (key === "" || typeof day !== "string") continue;
    if (!byContract.has(key)) byContract.set(key, new Map());
    const byDay = byContract.get(key);
    const count = Number(record?.eligibleCount);
    byDay.set(day, (byDay.get(day) ?? 0) + (Number.isFinite(count) ? count : 0));
  }
  return byContract;
}

function eligibleCoverage({ campaign, windowDays, eligibleIndex, pendingReason }) {
  if (eligibleIndex === null) {
    return { status: CAMPAIGN_STATUS.NOT_MEASURED, reason: pendingReason };
  }
  const legacy = legacyMaturityFor(campaign.mission, campaign.maturity);
  const contract = `${campaign.shortCode}|${legacy ?? ""}`;
  const byDay = eligibleIndex.get(contract) ?? new Map();
  const daysWithTrades = windowDays.filter((day) => (byDay.get(day) ?? 0) > 0);
  const eligibleTrades = daysWithTrades.reduce((sum, day) => sum + byDay.get(day), 0);
  let status = CAMPAIGN_STATUS.PARTIAL;
  if (daysWithTrades.length === windowDays.length && windowDays.length > 0) status = CAMPAIGN_STATUS.FULL;
  if (daysWithTrades.length === 0) status = CAMPAIGN_STATUS.NONE;
  return {
    status,
    contract,
    windowDays: windowDays.length,
    daysWithTrades: daysWithTrades.length,
    eligibleTrades,
    firstDate: daysWithTrades[0] ?? null,
    lastDate: daysWithTrades.at(-1) ?? null,
  };
}

// Campaigns del zone plan de TR-02, con su zona. Las purgadas sólo traen
// windowStart y deadline; se miden sobre esa ventana y quedan en zona PURGE.
export function campaignsFromZonePlan(zonePlan) {
  const campaigns = [];
  for (const [missionKey, mission] of Object.entries(zonePlan?.missions ?? {})) {
    for (const [zone, list] of Object.entries(mission.zones ?? {})) {
      for (const campaign of list) {
        campaigns.push({ missionKey, market: mission.market, zone, ...pickCampaign(campaign, mission) });
      }
    }
  }
  for (const purged of zonePlan?.purge ?? []) {
    const missionKey = Object.keys(zonePlan.missions).find((key) =>
      zonePlan.missions[key].product === purged.product && zonePlan.missions[key].mission === purged.mission);
    if (missionKey === undefined) continue;
    const mission = zonePlan.missions[missionKey];
    campaigns.push({
      missionKey,
      market: mission.market,
      zone: "PURGE",
      ...pickCampaign({ ...purged, windowEnd: purged.deadline, shortCode: mission.shortCode }, mission),
    });
  }
  return campaigns;
}

function pickCampaign(campaign, mission) {
  return {
    campaignId: campaign.campaignId,
    mission: campaign.mission ?? mission.mission,
    maturity: campaign.maturity,
    shortCode: campaign.shortCode ?? mission.shortCode,
    windowStart: campaign.windowStart,
    windowEnd: campaign.windowEnd,
  };
}

function emptyZoneSummary() {
  return {
    campaigns: 0,
    tradePartitions: { FULL: 0, FULL_WITH_EXCLUDED_PULLS: 0, PARTIAL: 0, NONE: 0 },
    eligibleTrades: { FULL: 0, PARTIAL: 0, NONE: 0, NOT_MEASURED: 0 },
    tobPartitions: { FULL: 0, FULL_WITH_EXCLUDED_PULLS: 0, PARTIAL: 0, NONE: 0 },
    campaignsWithoutTrades: [],
    campaignsRequiredTobNotSealed: [],
  };
}

function marketCalendarDays(exchangeDays, campaign) {
  return exchangeDays.filter((day) => day >= campaign.windowStart && day <= campaign.windowEnd);
}

const utcDay = (day) => Date.parse(`${day}T00:00:00Z`);

// Un día con cualquier pull excluido no está completo en el archivo, incluso
// si otros pulls del mismo día sí están sellados. Se evalúa el día entero del
// lago con la misma regla predeclarada; nunca se suman ambas fuentes.
export function resolveVerifiedPatchDays({ campaign, windowDays, archivePartitions, archiveRange, lakePartitions, lakeRange, lakeCoverage, lakeEligibleIndex }) {
  const contract = `${campaign.shortCode}|${legacyMaturityFor(campaign.mission, campaign.maturity) ?? ""}`;
  const byDay = lakeEligibleIndex === null || (lakeEligibleIndex === undefined && lakeCoverage === null)
    ? null : ((lakeEligibleIndex ?? indexEligibleCoverage(lakeCoverage)).get(contract) ?? new Map());
  const delivery = utcDay(`${String(legacyMaturityFor(campaign.mission, campaign.maturity)).slice(0, 4)}-${String(legacyMaturityFor(campaign.mission, campaign.maturity)).slice(4, 6)}-01`);
  if (!Number.isFinite(delivery)) throw new Error(`Maturity inválida para ${campaign.campaignId}`);
  return windowDays.map((day) => {
    const archiveStatus = classifyDay({ day, partitions: archivePartitions, range: archiveRange });
    if (archiveStatus === DAY_STATUS.SEALED) return { day, source: "CLIENT_SEALED_ARCHIVE" };
    if (byDay === null) return { day, source: "DATA_INCOMPLETE", reason: "LAKE_NOT_MEASURED" };
    if (classifyDay({ day, partitions: lakePartitions, range: lakeRange }) !== DAY_STATUS.SEALED) {
      return { day, source: "DATA_INCOMPLETE", reason: "LAKE_PARTITION_ABSENT" };
    }
    const count = byDay.get(day) ?? 0;
    const distance = Math.abs(delivery - utcDay(day));
    const peers = [...byDay].filter(([peerDay, peerCount]) =>
      peerDay !== day && peerCount > 0 && Number.isFinite(utcDay(peerDay))
      && Math.abs(Math.abs(delivery - utcDay(peerDay)) - distance) <= PATCH_COMPLETENESS_RULE.peerDistanceCalendarDays * 86400000
      && classifyDay({ day: peerDay, partitions: lakePartitions, range: lakeRange }) === DAY_STATUS.SEALED)
      .map(([, peerCount]) => peerCount).sort((a, b) => a - b);
    if (peers.length < PATCH_COMPLETENESS_RULE.minPositivePeerDays) {
      return { day, source: "DATA_INCOMPLETE", reason: "INSUFFICIENT_PEER_DAYS", eligibleTrades: count, peerDays: peers.length };
    }
    const median = peers.length % 2 ? peers[(peers.length - 1) / 2] : (peers[peers.length / 2 - 1] + peers[peers.length / 2]) / 2;
    const threshold = Math.max(PATCH_COMPLETENESS_RULE.minDailyEligibleTrades, Math.ceil(PATCH_COMPLETENESS_RULE.minFractionOfPeerMedian * median));
    return count >= threshold
      ? { day, source: "EEX_LAKE_PATCH", eligibleTrades: count, peerDays: peers.length, peerMedian: median, threshold }
      : { day, source: "DATA_INCOMPLETE", reason: "BELOW_COMPLETENESS_THRESHOLD", eligibleTrades: count, peerDays: peers.length, peerMedian: median, threshold };
  });
}

// sources: { [sourceId]: { range: {from,to}, partitions, eligibleCoverage:
// { GAS_THE: records|null, POWER_DE: records|null }, eligiblePendingReason:
// { GAS_THE: string, POWER_DE: string } } (motivo de NOT_MEASURED por mercado)
export function measureSourcePeriodCoverage({ zonePlan, exchangeDays, sources }) {
  const campaigns = campaignsFromZonePlan(zonePlan);
  const sourceIds = Object.keys(sources);
  const eligibleIndexes = {};
  for (const sourceId of sourceIds) {
    eligibleIndexes[sourceId] = {};
    for (const market of Object.keys(MARKET_AREAS)) {
      const records = sources[sourceId].eligibleCoverage?.[market] ?? null;
      eligibleIndexes[sourceId][market] = records === null ? null : indexEligibleCoverage(records);
    }
  }

  const summary = {};
  const measured = [];
  for (const campaign of campaigns) {
    const calendar = exchangeDays[campaign.market];
    if (!Array.isArray(calendar)) throw new TypeError(`Falta el calendario de ${campaign.market}.`);
    const windowDays = marketCalendarDays(calendar, campaign);
    const { cmdty, area } = MARKET_AREAS[campaign.market];
    const tobRequired = ZONES_REQUIRING_TOB.includes(campaign.zone);
    const bySource = {};
    for (const sourceId of sourceIds) {
      const source = sources[sourceId];
      const trades = partitionCoverage({ windowDays, partitions: source.partitions[partitionKey(PARTITION_TABLES.TRADES, cmdty, area)], range: source.range });
      const tob = partitionCoverage({ windowDays, partitions: source.partitions[partitionKey(PARTITION_TABLES.TOB, cmdty, area)], range: source.range });
      const eligible = eligibleCoverage({
        campaign,
        windowDays,
        eligibleIndex: eligibleIndexes[sourceId][campaign.market],
        pendingReason: source.eligiblePendingReason?.[campaign.market] ?? null,
      });
      bySource[sourceId] = { tradePartitions: trades, eligibleTrades: eligible, tobPartitions: { required: tobRequired, ...tob } };

      summary[campaign.missionKey] ??= {};
      summary[campaign.missionKey][campaign.zone] ??= {};
      const zoneSummary = summary[campaign.missionKey][campaign.zone][sourceId] ??= emptyZoneSummary();
      zoneSummary.campaigns += 1;
      zoneSummary.tradePartitions[trades.status] += 1;
      zoneSummary.eligibleTrades[eligible.status] += 1;
      zoneSummary.tobPartitions[tob.status] += 1;
      if (trades.status === CAMPAIGN_STATUS.NONE || eligible.status === CAMPAIGN_STATUS.NONE) {
        zoneSummary.campaignsWithoutTrades.push(campaign.campaignId);
      }
      if (tobRequired && tob.status !== CAMPAIGN_STATUS.FULL) {
        zoneSummary.campaignsRequiredTobNotSealed.push(campaign.campaignId);
      }
    }
    const patchDays = sources.CLIENT_SEALED_ARCHIVE && sources.EEX_LAKE
      ? resolveVerifiedPatchDays({
        campaign, windowDays,
        archivePartitions: sources.CLIENT_SEALED_ARCHIVE.partitions[partitionKey(PARTITION_TABLES.TRADES, cmdty, area)],
        archiveRange: sources.CLIENT_SEALED_ARCHIVE.range,
        lakePartitions: sources.EEX_LAKE.partitions[partitionKey(PARTITION_TABLES.TRADES, cmdty, area)],
        lakeRange: sources.EEX_LAKE.range,
        lakeCoverage: sources.EEX_LAKE.eligibleCoverage?.[campaign.market] ?? null,
        lakeEligibleIndex: eligibleIndexes.EEX_LAKE[campaign.market],
      }) : null;
    measured.push({ ...campaign, windowExchangeDays: windowDays.length, bySource,
      patch: patchDays === null ? null : {
        days: patchDays,
        sources: [...new Set(patchDays.map((item) => item.source))],
        status: patchDays.some((item) => item.source === "DATA_INCOMPLETE") ? "DATA_INCOMPLETE" : "COMPLETE",
      },
    });
  }
  return { campaigns: measured, summary, differences: sourceDifferences(measured, sourceIds) };
}

// Campaigns en las que las fuentes no dicen lo mismo. Es la insuficiencia que
// la comparación de TR-01 (sólo dateMax y tabla reference) no ve.
function sourceDifferences(campaigns, sourceIds) {
  if (sourceIds.length < 2) return [];
  const differences = [];
  for (const campaign of campaigns) {
    const fields = [];
    for (const field of ["tradePartitions", "eligibleTrades", "tobPartitions"]) {
      const statuses = sourceIds.map((id) => campaign.bySource[id][field].status);
      if (statuses.includes(CAMPAIGN_STATUS.NOT_MEASURED)) continue;
      const daysWithData = sourceIds.map((id) => campaign.bySource[id][field].daysWithData ?? campaign.bySource[id][field].daysWithTrades);
      if (new Set(statuses).size > 1 || new Set(daysWithData).size > 1) {
        fields.push({ field, ...Object.fromEntries(sourceIds.map((id, i) => [id, { status: statuses[i], days: daysWithData[i] }])) });
      }
    }
    if (fields.length > 0) differences.push({ missionKey: campaign.missionKey, zone: campaign.zone, campaignId: campaign.campaignId, fields });
  }
  return differences;
}
