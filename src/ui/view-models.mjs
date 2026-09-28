// UI-01 — view models de las cuatro superficies visuales. Fuente:
// docs/product/UI-01_VISUAL_REFERENCE_BRIEF.md (Replay / Backtests / Research /
// Campaigns & Runs) sobre el Operator Interface Boundary aceptado de IMP-29
// (SPEC v1.1.1 §26.2–§26.5).
//
// Reglas del brief no negociables, materializadas aquí:
//   - no se manufacturan resultados: un dato sólo entra si bindRecord (§26.5)
//     lo ata a una versión canónica del manifest backend verificado;
//   - Recommendation, requested order, execution/fill y outcome económico son
//     objetos distintos (el timeline de IMP-29 ya los separa por lane/class);
//   - Decision-time y Evaluation son semánticamente distintos (lanes separadas
//     con sus relojes; §26.3);
//   - unknown/missing/not-yet-closed queda explícito y fail-closed.

import { canonicalValueSha256 } from "../pit-views/pit-record.mjs";
import { toUtcTimestamp } from "../pit-views/time.mjs";
import { bindRecord } from "./binding.mjs";
import { parseBackendRef, resolveBackendRecord } from "../operator-interface/backend-records.mjs";
import { containsOfficialStatus } from "./canonical-inputs.mjs";
import { buildCanonicalSemanticsProjection } from "../backtesting-semantics/projection.mjs";
import {
  EXPOSURE_CONDITION,
  EXPOSURE_FIELD_KEYS,
  EXPOSURE_FIELDS,
  availabilityClockOf,
  buildExposureField,
} from "../operator-interface/exposure.mjs";
import {
  EXECUTION_CLASS,
  EXECUTION_CLASSES,
  HUMAN_INTERVENTION_CLASS,
  reconcileOperatorTimeline,
} from "../operator-interface/timeline.mjs";

export const SURFACES = Object.freeze({
  REPLAY: "replay",
  BACKTESTS: "backtests",
  RESEARCH: "research",
  CAMPAIGNS: "campaigns",
});

export const SURFACES_LIST = Object.freeze(Object.values(SURFACES));

// Pila de estrategias esperada por el Research / Strategy Lab del brief.
// Es la dirección de producto del owner (no de la SPEC): se usa sólo para
// declarar "esperado pero aún no disponible" y nunca como dato.
export const EXPECTED_STRATEGY_STACK = Object.freeze(["S1", "S2", "S3", "S4", "S5", "Z"]);

function unavailableItem(label, reason) {
  return { status: "UNAVAILABLE", label, reason };
}

function boundItem(label, bound, extra = {}) {
  return { status: "BOUND", label, value: bound.value, provenance: { recordKey: bound.recordKey, revisionId: bound.revisionId, valueSha256: bound.valueSha256 }, ...extra };
}

function unexpectedTimeline(errors) {
  return { ok: false, errors };
}

// Backtests / Economic Comparison. `rows` son candidatos de datos del backend:
// { label, arm ("A0"|"A1"|null), measure ("B"|"H"|"V"|"ΔV"|null), recordKey,
// revisionId, value }. Cada uno se somete a binding contra el manifest
// verificado; los que fallan quedan explícitos como UNAVAILABLE con razón.
// Proyección del backtest exploratorio (owner patch 02 §4) para la UI: solo lee el
// artifact ya verificado por hash en ./canonical-inputs.mjs; no recalcula precios.
const CLIENT_ARM = "A0@11:00/CLIENT";
const DIP_ARM = "DIP10@11:00/CLIENT";
const DIP_DEPTH_ARM = "DIP10@11:00/DEPTH";

function hourProfileFor(results, product) {
  const episodes = results.filter((entry) => entry.product === product);
  const slots = episodes[0]?.hourProfile.map((item) => item.slot) ?? [];
  return slots.map((slot) => {
    const diffs = [];
    for (const entry of episodes) {
      const client = entry.hourProfile.find((item) => item.slot === "11:00");
      const other = entry.hourProfile.find((item) => item.slot === slot);
      if (client?.complete && other?.complete) {
        diffs.push(other.avgPriceEurMwh - client.avgPriceEurMwh);
      }
    }
    const meanDiff = diffs.length === 0 ? null : diffs.reduce((sum, value) => sum + value, 0) / diffs.length;
    return { slot, meanDiffEurMwh: meanDiff, episodes: diffs.length };
  });
}

// UI-06 (owner request 25-sep-2026, PLAN_STATUS UI-06; prototipo aprobado
// UI-05-prototipo-2026-09-25/prototipo-ui05.html sha256 a79c8652…, pestaña Backtests):
// detalle por punto del efecto emparejado. Solo une por índice lo que el artifact ya
// emite: el punto acumulado (`comparison[p].paired`) con el ledger diario del mismo
// episodio (`replay[].decisions`), que run-exploratory-backtest.mjs produce con los
// mismos `run(...)` que la comparación. ΔV por decisión solo existe en
// `replay[].inspector[].deltaVEur` (días con compra de Arm A); el resto queda null.
// Arm B no tiene ledger diario en el artifact: null hasta que el backtest lo emita.
const PAIRED_LEDGER_ARMS = ["BASELINE", "ARM_A"];

function ledgerRow(decision, targetMw) {
  const filled = decision.filledMw > 0;
  // "36 of 60 MW" del prototipo aprobado: target − remainingMw del ledger (Bru 2026-09-25).
  const boughtSoFarMw = Number.isFinite(targetMw) && Number.isFinite(decision.remainingMw) ? targetMw - decision.remainingMw : null;
  return {
    status: decision.status,
    filledMw: decision.filledMw,
    fillPriceEurMwh: filled ? decision.priceEurMwh : null,
    boughtSoFarMw,
  };
}

// Devuelve los días del episodio alineados con el tramo del punto, o null si el
// artifact no permite unirlos sin suponer nada (fail-closed).
function episodeLedgers(replayEntry, span) {
  if (!replayEntry?.decisions) return null;
  const ledgers = PAIRED_LEDGER_ARMS.map((armId) => replayEntry.decisions[armId]);
  if (ledgers.some((ledger) => !Array.isArray(ledger) || ledger.length !== span)) return null;
  const [baseline, armA] = ledgers;
  if (baseline.some((decision, index) => decision.day !== armA[index].day)) return null;
  return { BASELINE: baseline, ARM_A: armA };
}

function pairedSeriesAgree(reference, other) {
  if (!other || other.points.length !== reference.points.length) return false;
  return JSON.stringify(other.boundaries) === JSON.stringify(reference.boundaries);
}

function projectPairedPointsFor(product, block, results) {
  const series = Object.entries(block.paired ?? {}).filter(([, value]) => value.points.length > 0);
  if (series.length === 0) return [];
  const [, reference] = series[0];
  const agreeing = series.filter(([, value]) => pairedSeriesAgree(reference, value)).map(([armId]) => armId);
  const campaigns = results.campaigns ?? [];
  const armBSlotOf = (maturity) => block.perEpisode?.find((episode) => episode.maturity === maturity)?.arms?.ARM_B?.slot ?? null;
  const details = [];
  reference.boundaries.forEach((boundary, position) => {
    const end = reference.boundaries[position + 1]?.index ?? reference.points.length;
    const span = end - boundary.index;
    const replayEntry = results.replay?.find((entry) => entry.product === product && entry.maturity === boundary.maturity);
    const campaign = campaigns.find((entry) => entry.product === product && entry.maturity === boundary.maturity);
    const targetMw = campaign?.targetMw ?? null;
    const ledgers = episodeLedgers(replayEntry, span);
    const inspectorByIndex = new Map((replayEntry?.inspector ?? []).map((item) => [item.index, item]));
    for (let offset = 0; offset < span; offset += 1) {
      const pointIndex = boundary.index + offset;
      const cumulativeKeur = Object.fromEntries(agreeing.map((armId) => [armId, block.paired[armId].points[pointIndex]]));
      const base = {
        index: pointIndex,
        product,
        maturity: boundary.maturity,
        campaignId: campaign?.id ?? null,
        deliveryLabel: deliveryLabelFor(boundary.maturity, CAMPAIGN_MISSIONS.find((entry) => entry.product === product)?.cadence ?? null),
        targetMw,
        decisionNumber: offset + 1,
        decisionsInCampaign: span,
        armBSlot: armBSlotOf(boundary.maturity),
        cumulativeKeur,
      };
      if (ledgers === null) {
        details.push({ ...base, day: null, ledgerAvailable: false, arms: null, bestAsk: null, decisionDeltaVEur: { ARM_A: null, ARM_B: null } });
        continue;
      }
      const armA = ledgers.ARM_A[offset];
      const inspected = inspectorByIndex.get(offset);
      details.push({
        ...base,
        day: armA.day,
        ledgerAvailable: true,
        arms: {
          BASELINE: ledgerRow(ledgers.BASELINE[offset], targetMw),
          ARM_A: ledgerRow(armA, targetMw),
          ARM_B: null,
        },
        bestAsk: typeof armA.ask === "number" ? { eurMwh: armA.ask, quoteTm: armA.quoteTm ?? null, slot: results.rules?.clientSlotBerlin ?? null } : null,
        decisionDeltaVEur: {
          ARM_A: inspected?.day === armA.day && typeof inspected.deltaVEur === "number" ? inspected.deltaVEur : null,
          ARM_B: null,
        },
      });
    }
  });
  return details;
}

export function projectPairedPoints(results) {
  if (!results?.comparison) return null;
  return Object.fromEntries(Object.entries(results.comparison).map(([product, block]) => [product, projectPairedPointsFor(product, block, results)]));
}

export function projectExploratoryBacktest(exploratory) {
  const results = exploratory?.results;
  if (results?.status !== "EXPLORATORY" || !Array.isArray(results.results)) {
    return null;
  }
  const episodes = results.results.map((entry) => ({
    product: entry.product,
    maturity: entry.maturity,
    tradingDays: entry.tradingDays,
    firstDay: entry.firstDay,
    lastDay: entry.lastDay,
    a0: entry.arms[CLIENT_ARM],
    dip: entry.arms[DIP_ARM],
    dipDepth: entry.arms[DIP_DEPTH_ARM],
    leaveOneOut: entry.leaveOneOutHour,
  }));
  return {
    status: "EXPLORATORY",
    provenance: exploratory.provenance,
    rules: results.rules,
    dataPeriod: results.inputs.dataPeriod,
    skipped: results.episodesSkippedIncomplete,
    summary: results.summary,
    comparison: results.comparison ?? null,
    pairedPoints: projectPairedPoints(results),
    episodes,
    hourProfiles: Object.keys(results.summary).map((product) => ({ product, slots: hourProfileFor(results.results, product) })),
  };
}

// El loader BT-03 verifica el manifest y los SHA-256 de todas las entradas y
// salida antes de permitir esta proyección. Aquí sólo se seleccionan campos;
// no se reconstruyen B, H, V, DeltaV ni cobertura.
export function projectBacktestReadiness(readiness) {
  if (readiness?.sourceFreshness?.status === "STALE") {
    return { status: "STALE", reason: readiness.sourceFreshness.reason, staleArtifacts: readiness.sourceFreshness.staleArtifacts, campaigns: [] };
  }
  const results = readiness?.results;
  if (readiness?.ok !== true
    || results?.artifactKind !== "BT-02_EXPLORATORY_BENCHMARK_RECONCILIATION"
    || results.status !== "EXPLORATORY_PROVISIONAL"
    || !Array.isArray(results.campaigns)
    || containsOfficialStatus(results)) {
    return null;
  }
  return {
    status: results.status,
    provenance: readiness.provenance,
    official: { status: "UNAVAILABLE", reason: "No official settlement reconciliation is present in the BT-02 artifact." },
    campaigns: results.campaigns.map((campaign) => ({
      campaignKey: campaign.campaignKey,
      product: campaign.product,
      maturity: campaign.maturity,
      status: campaign.status,
      campaignReadiness: campaign.campaignReadiness,
      benchmark: campaign.benchmark,
      fees: campaign.fees,
      arms: Object.entries(campaign.arms ?? {}).map(([armId, arm]) => ({ armId, ...arm })),
    })),
  };
}

// Rail de Campaigns por misión: decisión de Bru 2026-09-25 (P-008, prototipo
// UI-05-prototipo-2026-09-25/prototipo-ui05.html sha256 a79c8652…, pestaña Campaigns).
// BT-06 (2026-09-26): Power ya tiene código de producto (DEBQ/DEBM) en el release
// exploratorio v3; si el artifact no está, el grupo queda vacío, "no data yet".
const CAMPAIGN_MISSIONS = [
  { mission: "Gas Quarterly", product: "G0BQ", cadence: "QUARTERLY" },
  { mission: "Gas Monthly", product: "G0BM", cadence: "MONTHLY" },
  { mission: "Power Quarterly", product: "DEBQ", cadence: "QUARTERLY" },
  { mission: "Power Monthly", product: "DEBM", cadence: "MONTHLY" },
];
const READINESS_LABEL = { EXPLORATORY_COMPLETE: "complete", INSUFFICIENT_DATA: "insufficient data" };
const MONTH_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// maturity = YYYYMM del mes de entrega (GAS-Q-202601 compra sep–nov 2025 para Q1-2026).
// Formato pedido por Bru 2026-09-25 (P-008): "Q1-2026" y "Oct 2025".
function deliveryLabelFor(maturity, cadence) {
  if (typeof maturity !== "string" || !/^\d{6}$/.test(maturity)) {
    return "UNAVAILABLE";
  }
  const year = maturity.slice(0, 4);
  const month = Number(maturity.slice(4, 6));
  if (month < 1 || month > 12) {
    return "UNAVAILABLE";
  }
  if (cadence === "QUARTERLY") {
    const quarter = Math.ceil(month / 3);
    return `Q${quarter}-${year}`;
  }
  return `${MONTH_ABBR[month - 1]} ${year}`;
}

function campaignRailRow(campaign, cadence) {
  const hasWindow = typeof campaign.firstDay === "string" && typeof campaign.lastDay === "string";
  return {
    id: campaign.id,
    readiness: campaign.readiness,
    readinessLabel: READINESS_LABEL[campaign.readiness] ?? campaign.readiness,
    deliveryLabel: deliveryLabelFor(campaign.maturity, cadence),
    window: hasWindow ? { firstDay: campaign.firstDay, lastDay: campaign.lastDay } : null,
  };
}

function campaignGroup(mission, product, cadence, members) {
  return {
    mission,
    product,
    total: members.length,
    complete: members.filter((campaign) => campaign.readiness === "EXPLORATORY_COMPLETE").length,
    insufficient: members.filter((campaign) => campaign.readiness === "INSUFFICIENT_DATA").length,
    campaigns: members.map((campaign) => campaignRailRow(campaign, cadence)),
  };
}

function projectCampaignGroups(campaigns) {
  const groups = CAMPAIGN_MISSIONS.map(({ mission, product, cadence }) => {
    const members = campaigns.filter((campaign) => product !== null && campaign.product === product);
    return campaignGroup(mission, product, cadence, members);
  });
  // Un producto sin misión conocida no desaparece del rail: queda en su propio grupo.
  const knownProducts = new Set(CAMPAIGN_MISSIONS.map((entry) => entry.product));
  const unmapped = campaigns.filter((campaign) => !knownProducts.has(campaign.product));
  for (const product of new Set(unmapped.map((campaign) => campaign.product))) {
    const members = unmapped.filter((campaign) => campaign.product === product);
    groups.push(campaignGroup(`Unmapped product ${product}`, product, null, members));
  }
  return groups;
}

// Replay y Campaigns exploratorios: proyección directa del artifact verificado.
export function projectExploratoryPages(exploratory) {
  const results = exploratory?.results;
  if (results?.status !== "EXPLORATORY" || !Array.isArray(results.replay) || !Array.isArray(results.campaigns)) {
    return null;
  }
  return {
    status: "EXPLORATORY",
    provenance: exploratory.provenance,
    dataPeriod: results.inputs?.dataPeriod ?? null,
    replay: results.replay,
    campaigns: results.campaigns,
    campaignGroups: projectCampaignGroups(results.campaigns),
    campaignUnknowns: results.campaignUnknowns ?? [],
    research: results.research ?? null,
  };
}

export function buildBacktestsViewModel({ backendIndex = null, rows = [], exploratory = null, backtestReadiness = null, hypothesisResults = [] } = {}) {
  if (!Array.isArray(rows)) {
    return unexpectedTimeline([{ field: "rows", code: "INVALID_ROWS", message: "rows must be a list." }]);
  }
  const items = rows.map((row) => {
    if (typeof row?.label !== "string" || row.label.trim().length === 0) {
      return unavailableItem("(row without label)", "comparison row without a label; an anonymous value is not rendered");
    }
    const bound = bindRecord(backendIndex, row);
    if (!bound.ok) {
      return unavailableItem(row.label, bound.reason);
    }
    // UI01-05c (review de cambio 2026-09-23): las etiquetas arm/measure que el
    // render exhibe como factuales (data-arm/data-measure) sólo se presentan
    // si el registro canónico para el que se ató el hash las declara a su vez;
    // el boundary no expone un catálogo de brazos/comparadores aparte, así que
    // una Etiqueta sin respaldo en el registro resuelto no es factual (§26.5).
    const resolved = resolveBackendRecord(backendIndex, row.recordKey, row.revisionId);
    const recordValue = resolved?.value;
    const recordArm = recordValue !== null && typeof recordValue === "object" ? recordValue.arm ?? null : null;
    const recordMeasure = recordValue !== null && typeof recordValue === "object" ? recordValue.measure ?? null : null;
    const declaredArm = row.arm ?? null;
    const declaredMeasure = row.measure ?? null;
    if (declaredArm !== null || declaredMeasure !== null) {
      const armBacked = typeof declaredArm === "string" && declaredArm === recordArm;
      const measureBacked = typeof declaredMeasure === "string" && declaredMeasure === recordMeasure;
      if (!armBacked || !measureBacked) {
        return unavailableItem(row.label, `the declared arm/measure ("${declaredArm ?? "missing"}"/"${declaredMeasure ?? "missing"}") does not match the one exposed by the verified manifest canonical record; a label without boundary backing is not rendered as factual (§26.5)`);
      }
    }
    return boundItem(row.label, bound.bound, { arm: declaredArm, measure: declaredMeasure });
  });
  // SEM-2: una sola proyección backend comparte las identidades canónicas con
  // las cuatro superficies. H-S1-01 aplica por separado a las cuatro misiones
  // (mismo ID y pregunta, evidencia/configuración independiente; FIX-07 ID02/ID04).
  // SEM2-T01: los resultados BT-08 publicados viajan dentro de la MISMA
  // proyección, con su binding real hipótesis/versión/misión/run (fail-closed).
  const canonicalSemantics = buildCanonicalSemanticsProjection({ exploratory, backtestReadiness, hypothesisResults });
  return {
    ok: true,
    surface: SURFACES.BACKTESTS,
    rows: items,
    hasAnyBoundData: items.some((item) => item.status === "BOUND"),
    exploratory: projectExploratoryBacktest(exploratory),
    sourceFreshness: exploratory?.sourceFreshness ?? backtestReadiness?.sourceFreshness ?? null,
    measurementReadiness: projectBacktestReadiness(backtestReadiness),
    canonicalSemantics,
    // La tabla primaria de Backtests compara la hipótesis Strategy-derived (H-S1-01)
    // con CLIENT/BENCHMARK; Research Discovery (H-RD-01) viaja en canonicalSemantics
    // y en la superficie Research, no como segundo resultado en Results (SEM-1).
    semanticComparison: canonicalSemantics.missions.map((mission) => ({
      mission: { id: mission.missionId, cadence: mission.cadence },
      client: mission.client,
      benchmark: mission.benchmark,
      benchmarkByCampaign: mission.benchmarkByCampaign,
      hypotheses: mission.hypotheses.filter((hypothesis) => hypothesis.originType !== "RESEARCH_DISCOVERY"),
      hypothesisResults: mission.hypothesisResults,
    })),
    // Los comparadores canónicos del brief que este boundary aún no expose:
    // honestamente declarados, no simulados.
    pendingComparisons: [
      { label: "B / H / V / ΔV · official/canonical", status: "UNAVAILABLE", reason: "no official settlement reconciliation and no canonical measurements of a real P5/P6 run; BT-02 provisional/partial measurements are exposed per campaign in the backend table when their verified artifact is available" },
      { label: "Paired effects per campaign", status: "UNAVAILABLE", reason: "no A0/A1 pairs registered in the backend" },
      { label: "Distributions", status: "UNAVAILABLE", reason: "no canonical result distribution; it is not fabricated (§26.5)" },
      { label: "Method / integrity context", status: "UNAVAILABLE", reason: "no IMP-14 run receipt and no sealed OOS reserve on disk (IMP-09: HOLD, 0 sealed)" },
    ],
  };
}

// Research / Strategy Lab. `strategies` son candidatos { strategyId,
// recordKey, revisionId, value } con value={ phase, ... } del registry de
// admission. Lo esperado por la pila S1–S5/Z que no entra se declara.
export function buildResearchViewModel({ backendIndex = null, records = [] } = {}) {
  if (!Array.isArray(records)) {
    return unexpectedTimeline([{ field: "records", code: "INVALID_RECORDS", message: "records must be a list." }]);
  }
  const byId = new Map();
  for (const record of records) {
    if (typeof record?.strategyId !== "string" || record.strategyId.trim().length === 0) {
      continue;
    }
    if (byId.has(record.strategyId)) {
      return unexpectedTimeline([{ field: "records", code: "DUPLICATE_STRATEGY_ID", message: `"${record.strategyId}" declared twice; two truths about the same thing (§26.5).` }]);
    }
    byId.set(record.strategyId, record);
  }
  const strategies = EXPECTED_STRATEGY_STACK.map((strategyId) => {
    const candidate = byId.get(strategyId);
    if (candidate === undefined) {
      return {
        strategyId,
        status: "UNAVAILABLE",
        reason: "no canonical backend record in this scope; neither hypothesis nor readiness is presumed",
      };
    }
    const bound = bindRecord(backendIndex, candidate);
    if (!bound.ok) {
      return { strategyId, status: "UNAVAILABLE", reason: bound.reason };
    }
    return {
      strategyId,
      status: "BOUND",
      readiness: bound.bound.value,
      provenance: { recordKey: bound.bound.recordKey, revisionId: bound.bound.revisionId, valueSha256: bound.bound.valueSha256 },
    };
  });
  const unexpectedIds = [...byId.keys()].filter((id) => !EXPECTED_STRATEGY_STACK.includes(id));
  return {
    ok: true,
    surface: SURFACES.RESEARCH,
    strategies,
    unexpectedStrategyIds: unexpectedIds,
    hasAnyBoundData: strategies.some((item) => item.status === "BOUND"),
    pendingSections: [
      { label: "Experiment / version lineage", status: "UNAVAILABLE", reason: "no canonical lineage from the backend" },
      { label: "Evidence / receipts", status: "UNAVAILABLE", reason: "no IMP-14 run receipt persisted on disk; the producer exists as code" },
    ],
  };
}

// Campaigns & Runs. `campaigns` son candidatos { campaignId, recordKey,
// revisionId, value } (ficha de campaña canónica) y `runs` candidatos
// { runId, record: {recordKey, revisionId, value} } con drilldowns declarados
// { replay: "<recordKey>@<revisionId>", backtests: ..., research: ... }.
export function buildCampaignsViewModel({ backendIndex = null, campaigns = [], runs = [] } = {}) {
  if (!Array.isArray(campaigns) || !Array.isArray(runs)) {
    return unexpectedTimeline([{ field: "campaigns", code: "INVALID_INPUT", message: "campaigns and runs must be lists." }]);
  }
  const seenCampaigns = new Set();
  for (const campaign of campaigns) {
    if (campaign?.campaignId === undefined || seenCampaigns.has(campaign.campaignId)) {
      return unexpectedTimeline([{ field: "campaigns", code: "DUPLICATE_CAMPAIGN_ID", message: "each campaign is declared once (§26.5)." }]);
    }
    seenCampaigns.add(campaign.campaignId);
  }
  const seenRuns = new Set();
  for (const run of runs) {
    if (run?.runId === undefined || seenRuns.has(run.runId)) {
      return unexpectedTimeline([{ field: "runs", code: "DUPLICATE_RUN_ID", message: "each run is declared once (§26.5)." }]);
    }
    seenRuns.add(run.runId);
  }
  const campaignItems = campaigns
    .map((campaign) => {
      if (typeof campaign?.campaignId !== "string" || campaign.campaignId.trim().length === 0) {
        return unavailableItem("(campaign without id)", "campaign without identity; not rendered");
      }
      const bound = bindRecord(backendIndex, campaign);
      if (!bound.ok) {
        return unavailableItem(campaign.campaignId, bound.reason);
      }
      return boundItem(campaign.campaignId, bound.bound, { kind: "CAMPAIGN" });
    });
  // SEM2-T12: every cross-tab link preserves the scope it was bound to (run,
  // campaign, mission, hypothesis/version). A drilldown without scope cannot
  // guarantee continuity, so it is withheld fail-closed instead of navigating
  // to a destination that would silently default to another run/mission.
  const scopeFromValue = (value) => {
    if (value === null || typeof value !== "object") return {};
    const scope = {};
    if (typeof value.campaignId === "string" && value.campaignId.trim() !== "") scope.campaign = value.campaignId;
    if (typeof value.missionId === "string" && value.missionId.trim() !== "") scope.mission = value.missionId;
    if (typeof value.hypothesisVersion === "string" && value.hypothesisVersion.trim() !== "") scope.version = value.hypothesisVersion;
    return scope;
  };
  const scopedDrilldowns = (runId, scope) => {
    const params = new URLSearchParams({ run: runId });
    for (const [key, value] of Object.entries(scope)) params.set(key, value);
    const query = params.toString();
    return [
      { href: `/replay?${query}` },
      { href: `/backtests?${query}` },
      { href: `/research?${query}` },
    ];
  };
  const runItems = runs
    .map((run) => {
      if (typeof run?.runId !== "string" || run.runId.trim().length === 0) {
        return unavailableItem("(run without id)", "run without identity; not rendered");
      }
      const record = run.record ?? run;
      const bound = bindRecord(backendIndex, record);
      if (!bound.ok) {
        return unavailableItem(run.runId, bound.reason);
      }
      const scope = scopeFromValue(bound.bound.value);
      if (Object.keys(scope).length === 0) {
        return boundItem(run.runId, bound.bound, {
          kind: "RUN",
          drilldowns: [],
          drilldownWithheld: "the canonical record declares no campaign/mission/version scope; the cross-tab handoff is withheld (fail-closed, SEM2-08)",
        });
      }
      return boundItem(run.runId, bound.bound, { kind: "RUN", drilldowns: scopedDrilldowns(run.runId, scope), scope });
    });
  return {
    ok: true,
    surface: SURFACES.CAMPAIGNS,
    campaigns: campaignItems,
    runs: runItems,
    hasAnyBoundData: [...campaignItems, ...runItems].some((item) => item.status === "BOUND"),
    // Drilldowns: navegación declarativa a superficies sí expuestas por este
    // boundary; el destino aplica sus propios fail-closed, no se copian datos.
    // Exigen que el run esté BOUND: no se ofrece el handoff sobre datos que el
    // backend no respalda.
    drilldownTargets: Object.freeze(["replay", "backtests", "research"]),
    pendingRunReceipts: [
      { label: "Run receipts", status: "UNAVAILABLE", reason: "no IMP-14/IMP-16 run receipt persisted on disk; none is fabricated" },
    ],
  };
}

// Replay / Decision Inspector. Sólo acepta salidas ya validadas del boundary:
// `timeline` (buildOperatorTimeline ok:true) y `exposure` (buildExposure
// ok:true) — y las verifica: la forma `{ok:true}` por sí sola no acredita
// nada (OI79-UI01-01, review 2026-09-23). El llamador aporta `backendIndex`
// (backendIndexFromManifest del manifest backend verificado) y cada pieza
// factual se ata a él con los mecanismos del propio boundary:
//   - reconcileOperatorTimeline re-ejecutado tal cual contra el timeline;
//   - cada punto de decisión/evaluación se concilia por key/revisionId y
//     hash canónico del valor registrado (bindRecord, §26.5);
//   - la procedencia declarada por cada campo de exposición resuelve al
//     registro y hash del mismo manifest;
//   - el vínculo a recomendación de cada actuación/intervención resuelve a
//     una versión del decision view verificada.
// Un timeline o exposición armados a mano quedan entonces explícitos como
// error: valor no coincide con el manifest = dato no factual (§26.5).
export function buildReplayViewModel({ timeline = null, exposure = null, backendIndex = null } = {}) {
  if (timeline === null || timeline?.ok !== true || timeline?.timeline === undefined) {
    return unexpectedTimeline([{ field: "timeline", code: "TIMELINE_NOT_VALIDATED", message: "Replay requires the buildOperatorTimeline-validated timeline; without it nothing renders (§26.3)." }]);
  }
  // UI01-10 (review de cambio 2026-09-23): un `exposure.exposure === null`
  // no salta el guard anterior (null !== undefined) y revientaba más abajo;
  // se degrada a ERROR sin excepción (§26.5 / estados de error fail-closed).
  if (exposure === null || exposure?.ok !== true || exposure?.exposure === undefined || exposure?.exposure === null) {
    return unexpectedTimeline([{ field: "exposure", code: "EXPOSURE_NOT_VALIDATED", message: "Replay requires the buildExposure-validated exposure; without it nothing renders (§26.2)." }]);
  }
  // UI01-04a (review 2026-09-23): una exposición sin fields no es una
  // exposición renderizable; se degrada a ERROR, nunca a una excepción.
  if (!Array.isArray(exposure.exposure.fields)) {
    return unexpectedTimeline([{ field: "exposure.fields", code: "EXPOSURE_MALFORMED", message: "The declared exposure lacks the boundary field list (§26.2)." }]);
  }
  if (backendIndex === null || backendIndex.byIdentity === undefined) {
    return unexpectedTimeline([{ field: "backendIndex", code: "BACKEND_NOT_VERIFIED", message: "Replay only shows verified backend manifest data; without it the timeline cannot be bound to factual data (§26.5)." }]);
  }
  const reconciliation = reconcileOperatorTimeline(timeline.timeline);
  if (!reconciliation.ok) {
    return unexpectedTimeline([...reconciliation.errors]);
  }
  const t = timeline.timeline;
  if (!Array.isArray(t?.decision?.points) || !Array.isArray(t?.evaluation?.points)
    || !Array.isArray(t?.executions) || !Array.isArray(t?.interventions)) {
    return unexpectedTimeline([{ field: "(timeline)", code: "TIMELINE_SHAPE_UNRECOGNIZED", message: "El timeline no declara las lanes del boundary (§26.3)." }]);
  }
  const errors = [];
  // UI01-05a (review de cambio 2026-09-23): la exposición sólo puede renderizar
  // facts "conocidos al decidir" si su boundary es exactamente el decision
  // boundary del timeline; una exposición proyectada a un boundary posterior
  // convierte un outcome no cerrado en AVAILABLE y la página de Replay rinde
  // un valor futuro como factual (§26.3/§25.1 IMP-29).
  const exposureBoundaryUtc = toUtcTimestamp(exposure.exposure.boundaryUtc);
  const decisionBoundaryUtc = toUtcTimestamp(t.decision.boundary);
  if (!exposureBoundaryUtc.ok || !decisionBoundaryUtc.ok || exposureBoundaryUtc.utc !== decisionBoundaryUtc.utc) {
    errors.push({ field: "exposure.exposure.boundaryUtc", code: "EXPOSURE_BOUNDARY_NOT_ALIGNED", message: "the declared exposure does not use the timeline decision boundary; the Replay page cannot present as known-at-decision what closed later (§26.3/§25.1)" });
  }
  const decisionBoundaryMs = decisionBoundaryUtc.ok ? Date.parse(decisionBoundaryUtc.utc) : Number.NaN;
  const bindPoint = (point, landmark, expectedLane, expectedViewScope, expectedClockOf, expectedClockKind) => {
    // UI01-05b (review de cambio 2026-09-23): la lane exhibida por el render
    // (lane-<lane>) se deriva de la lane conciliada; una etiqueta distinta del
    // llamador no renombra la semántica temporal (§26.3).
    if (point?.lane !== expectedLane) {
      errors.push({ field: `${landmark}.${point?.key ?? "(no key)"}`, code: "POINT_LANE_MISMATCH", message: `the point declares lane "${point?.lane ?? "missing"}" and reconciles in lane ${expectedLane}; the boundary fixes the temporal semantics (§26.3)` });
      return;
    }
    const bound = bindRecord(backendIndex, { recordKey: point.key, revisionId: point.revisionId, value: point.value });
    if (!bound.ok) {
      errors.push({ field: `${landmark}.${point.key}`, code: "POINT_NOT_IN_BACKEND", message: `el punto no se concilia con el manifest backend verificado: ${bound.reason} (§26.5); un valor no registrado no es factual` });
      return;
    }
    // UI01-01c (review 2026-09-23): la lane decision sólo puede contener keys
    // de la decision view del manifest (§6.1/§14.3); un key de evaluation
    // presentado como punto de decisión es información futura al decidir. La
    // lane evaluation es exploratoria y puede llevar keys de ambos scopes.
    const record = resolveBackendRecord(backendIndex, point.key, point.revisionId);
    if (expectedViewScope !== null && record?.viewScope !== expectedViewScope) {
      errors.push({ field: `${landmark}.${point.key}`, code: "POINT_SCOPE_MISMATCH", message: `the point "${point.key}" comes from view "${record?.viewScope ?? "no scope"}" and does not fit replay lane ${expectedViewScope} (§6.1/§26.3)` });
      return;
    }
    if (record !== null) {
      // UI01-01c-r (review 2026-09-23): el reloj mostrado no es del llamador;
      // se deriva del registro verificado (decision: consumo demostrado,
      // evaluation: reloj de contenido; §6.1/§26.3).
      const canonicalClock = expectedClockOf(record);
      if (typeof canonicalClock !== "string" || point.clock !== canonicalClock) {
        errors.push({ field: `${landmark}.${point.key}`, code: "POINT_CLOCK_NOT_FROM_RECORD", message: `the clock of point "${point.key}" must derive from the verified manifest record; a declared clock does not inform the boundary (§26.3/§26.5)` });
      }
      // UI01-05b: el tipo de reloj exhibido (data-clock-kind) también se deriva
      // de la lane canónica; decision consume (policy-consumable), evaluation
      // recibe contenido por su reloj efectivo (evaluation-effective). Un
      // clockKind declarado que contradiga la lane no se muestra (§26.3).
      if (point.clockKind !== expectedClockKind) {
        errors.push({ field: `${landmark}.${point.key}`, code: "POINT_CLOCK_KIND_NOT_DERIVED", message: `the clock kind of point "${point.key}" must derive from the canonical lane (${expectedClockKind}); a caller-declared clockKind does not inform the boundary (§26.3/§26.5)` });
      }
    }
  };
  const decisionPoints = t.decision.points.map((point) => bindPoint(point, "decision.points", "decision", "decision", (record) => record.consumableFromUtc, "policy-consumable"));
  const evaluationPoints = t.evaluation.points.map((point) => bindPoint(point, "evaluation.points", "evaluation", null, (record) => record.effectiveAtUtc, "evaluation-effective"));
  const bindProvenance = (field, landmark) => {
    const provenance = field?.provenance;
    if (provenance === undefined || provenance === null) {
      // UI01-01b (review 2026-09-23): un campo con valor y sin procedencia
      // declarada no es mostrable; el valor no remite a ninguna versión.
      if (field?.value !== undefined) {
        errors.push({ field: landmark, code: "EXPOSURE_VALUE_WITHOUT_PROVENANCE", message: `the field "${field?.specLabel ?? landmark}" offers a value without provenance; without a canonical record it is not factual (§26.5)` });
      }
      return;
    }
    const resolved = resolveBackendRecord(backendIndex, provenance.recordKey, provenance.revisionId);
    if (resolved === null) {
      errors.push({ field: landmark, code: "EXPOSURE_PROVENANCE_NOT_IN_BACKEND", message: `the provenance "${provenance.recordKey}"/"${provenance.revisionId}" does not exist in the same backend verified manifest (§26.5)` });
      return;
    }
    // UI01-08 (review de cambio 2026-09-23): las condiciones value-less con
    // procedencia (PROXY/UNCERTAIN/STALE/MISSING) son una salida legítima del
    // boundary (validateProvenanceWithoutValue, exposure.mjs) y llegan con
    // valueSha256:null: la procedencia identifica la versión observada sin
    // atar un valor. Comparar hashes sólo aplica cuando la procedencia
    // declara uno; cuando hay valor, el bloque siguiente re-hashea el valor
    // expuesto contra el propio registro (§26.5).
    if (provenance.valueSha256 !== null && resolved.valueSha256 !== provenance.valueSha256) {
      errors.push({ field: landmark, code: "EXPOSURE_PROVENANCE_MISMATCH", message: `the provenance hash does not match the content recorded by "${provenance.recordKey}"/"${provenance.revisionId}" (§26.5)` });
      return;
    }
    // UI01-01b: el valueSha256 declarado puede coincidir por accidente; el
    // valor expuesto se hashea de nuevo y debe ser el del propio registro.
    if (field.value !== undefined && field.value !== null) {
      const valueHash = canonicalValueSha256(field.value);
      if (!valueHash.ok) {
        errors.push({ field: landmark, code: "EXPOSURE_VALUE_NOT_CANONICAL", message: `the value of field "${field?.specLabel ?? landmark}" is not canonical serializable data (§26.5)` });
      } else if (valueHash.sha256 !== resolved.valueSha256) {
        errors.push({ field: landmark, code: "EXPOSURE_VALUE_HASH_MISMATCH", message: `the value exposed by "${field?.specLabel ?? landmark}" is not the one recorded by "${provenance.recordKey}"/"${provenance.revisionId}"; no second economic truth is computed (§26.5)` });
      }
    }
  };
  for (const field of exposure.exposure.fields ?? []) {
    const landmark = `exposure.fields.${field?.field ?? field?.specLabel}`;
    bindProvenance(field, landmark);
    // UI01-01d (review 2026-09-23): una reputación de sección/sourceKind/
    // scope declarada por el llamador no se presenta; las comprobaciones del
    // propio boundary (buildExposureField) se re-ejecutan contra el manifest
    // verificado (§26.2/§26.3/§26.5).
    const rebuilt = buildExposureField(field, { backendIndex });
    if (!rebuilt.ok) {
      for (const rebuiltError of rebuilt.errors) {
        errors.push({ field: `${landmark}.${rebuiltError.field}`, code: rebuiltError.code, message: rebuiltError.message });
      }
      continue;
    }
    const definition = EXPOSURE_FIELDS.find((canonical) => canonical.key === field.field);
    if (definition !== undefined && (field.specLabel !== definition.specLabel || field.section !== definition.section)) {
      errors.push({ field: landmark, code: "EXPOSURE_SECTION_MISMATCH", message: `section "${field.field}" is not its canonical §26.2 definition; the caller label is not presented as factual` });
    }
    // UI01-06a (review de cambio 2026-09-23): buildExposureField no conoce el
    // boundary, así que un AVAILABLE forjado (o proyectado a un boundary
    // posterior y re-declarado al decision boundary) pasaba. La proyección del
    // boundary se re-aplica con el mismo reloj de disponibilidad del boundary
    // (availabilityClockOf, exposure.mjs): una versión canónica posterior al
    // boundary — o sin disponibilidad demostrada — no se rinde con valor como
    // factual al decidir (§26.3/§25.1 IMP-29).
    if (field.value !== undefined && field.value !== null
      && field.provenance !== undefined && field.provenance !== null) {
      const projectedRecord = resolveBackendRecord(backendIndex, field.provenance.recordKey, field.provenance.revisionId);
      const availabilityUtc = availabilityClockOf(projectedRecord);
      if (availabilityUtc === null || Number.isNaN(decisionBoundaryMs) || Date.parse(availabilityUtc) > decisionBoundaryMs) {
        errors.push({ field: landmark, code: "EXPOSURE_NOT_PROJECTED_TO_BOUNDARY", message: `the referred canonical version (available ${availabilityUtc ?? "undemonstrated"}) is later than or not demonstrated at the decision boundary; buildExposure would have degraded this section to NOT_YET_CLOSED and it is not rendered with a value as factual (§26.3/§25.1)` });
      }
    }
  }
  // UI01-04b (review de cambio 2026-09-23): la completitud estructural del
  // boundary (§26.2: las 13 secciones presentes, la ausencia declarada)
  // no se toma del flag declarado por el llamador; se constata contra el
  // conjunto canónico EXPOSURE_FIELD_KEYS. Una parcial omite 12 secciones
  // sin declararlas y no se rinde como completa.
  const declaredKeys = [];
  for (const field of exposure.exposure.fields) {
    if (typeof field?.field === "string") {
      declaredKeys.push(field.field);
    }
  }
  const missingSections = EXPOSURE_FIELD_KEYS.filter((canonicalKey) => !declaredKeys.includes(canonicalKey));
  if (missingSections.length > 0) {
    errors.push({ field: "exposure.fields", code: "EXPOSURE_NOT_STRUCTURALLY_COMPLETE", message: `the declared exposure omits the canonical §26.2 sections (${missingSections.join(", ")}); a partial one omits without declaring the absence and is not rendered as complete (§26.2)` });
  }
  const duplicateSections = declaredKeys.filter((key, index) => declaredKeys.indexOf(key) !== index);
  if (duplicateSections.length > 0) {
    errors.push({ field: "exposure.fields", code: "EXPOSURE_SECTION_DUPLICATE", message: `the exposure declares "${[...new Set(duplicateSections)].join(", ")}" more than once; two truths about the same thing (§26.5)` });
  }
  // UI01-01a (review 2026-09-23): una actuación REAL no se rinde con una
  // autorización "declarada"; su origen (authority + receipt) se re-ata al
  // manifest verificado, igual que el resto de los datos factuales (§26.5/§16–18).
  const bindAuthorizationOrigin = (lane, event) => {
    if (event?.class !== EXECUTION_CLASS.REAL) {
      return;
    }
    const authorization = event?.authorization;
    const origin = authorization?.origin;
    if (origin === undefined || origin === null) {
      errors.push({ field: `${lane}.${event?.eventId ?? "(no id)"}.authorization.origin`, code: "REAL_AUTHORITY_ORIGIN_MISSING", message: "the REAL act declares authorization without a resolved origin; authority and receipt must re-bind to the verified backend manifest (§26.5/§16–18)" });
      return;
    }
    const originAuthority = resolveBackendRecord(backendIndex, origin.authority?.recordKey, origin.authority?.revisionId);
    if (originAuthority === null) {
      errors.push({ field: `${lane}.${event?.eventId ?? "(no id)"}.authorization.origin.authority`, code: "REAL_AUTHORITY_NOT_IN_BACKEND", message: "the REAL act authority does not resolve to a verified backend manifest version; a REAL act requires a resolved applicable authority (§26.5/§16–18)" });
    } else {
      // UI01-01a-r (review 2026-09-23): además del origen, los refs exhibidos
      // por el render (authorityRef / receiptRef / receiptSha256) se re-atan al
      // mismo registro resuelto; un ref declarado distinto del resuelto no es
      // factual (§26.5).
      const authorityParsed = parseBackendRef(authorization.authorityRef);
      const authorityResolved = authorityParsed === null
        ? null
        : resolveBackendRecord(backendIndex, authorityParsed.recordKey, authorityParsed.revisionId);
      if (authorityResolved === null || authorityResolved !== originAuthority) {
        errors.push({ field: `${lane}.${event?.eventId ?? "(no id)"}.authorization.authorityRef`, code: "REAL_AUTHORITY_REF_NOT_BOUND", message: "the displayed authorityRef does not point at the authority resolved in the verified backend manifest; it is not drawn as factual (§26.5)" });
      }
    }
    const receipt = authorization.receipt;
    const originReceipt = resolveBackendRecord(backendIndex, origin.receipt?.recordKey, origin.receipt?.revisionId);
    if (originReceipt === null) {
      errors.push({ field: `${lane}.${event?.eventId ?? "(no id)"}.authorization.origin.receipt`, code: "REAL_RECEIPT_NOT_IN_BACKEND", message: "the REAL act receipt does not resolve to a verified backend manifest version; no receipt is declared that the backend does not back (§26.5/§25.2)" });
    } else {
      const receiptParsed = parseBackendRef(receipt?.receiptRef);
      const receiptResolved = receiptParsed === null
        ? null
        : resolveBackendRecord(backendIndex, receiptParsed.recordKey, receiptParsed.revisionId);
      if (receiptResolved === null) {
        errors.push({ field: `${lane}.${event?.eventId ?? "(no id)"}.authorization.origin.receipt`, code: "REAL_RECEIPT_NOT_IN_BACKEND", message: "the REAL act receipt does not resolve to a verified backend manifest version; no receipt is declared that the backend does not back (§26.5/§25.2)" });
      } else if (receiptResolved !== originReceipt) {
        errors.push({ field: `${lane}.${event?.eventId ?? "(no id)"}.authorization.receipt.receiptRef`, code: "REAL_RECEIPT_REF_NOT_BOUND", message: "the displayed receiptRef does not point at the receipt resolved in the verified backend manifest; it is not drawn as factual (§26.5)" });
      } else if (typeof receipt?.receiptSha256 !== "string" || receiptResolved.valueSha256 !== receipt.receiptSha256.toLowerCase()) {
        errors.push({ field: `${lane}.${event?.eventId ?? "(no id)"}.authorization.receipt.receiptSha256`, code: "REAL_RECEIPT_MISMATCH", message: "the displayed receipt hash is not the content recorded by its canonical version; no receipt is declared that the backend does not back (§26.5/§25.2)" });
      }
    }
  };
  for (const [lane, events] of [["executions", t.executions], ["interventions", t.interventions]]) {
    // UI01-09 (review de cambio 2026-09-23): el render deriva data-event-class
    // de event.lane; la lane del evento se coteja con la lane canónica del
    // contenedor (execution/intervention, timeline.mjs §26.3) y la clase del
    // contenedor de intervención con HUMAN_INTERVENTION: una actuación Real no
    // se rotula como intervención humana ni una intervención humana se rinde
    // como ejecución SIMULATED/BOGUS (§26.3/§26.5).
    const expectedEventLane = lane === "executions" ? "execution" : "intervention";
    for (const event of events) {
      // UI01-01e (review de cambio 2026-09-23): reconcileOperatorTimeline no
      // re-valida la identidad ni la clase de las actuaciones; aquí se hace
      // equivalente a validateExecution del boundary (§26.3): un class fuera
      // de las clases canónicas o un eventId vacío no se rinde como evento.
      if (typeof event?.eventId !== "string" || event.eventId.trim().length === 0) {
        errors.push({ field: `${lane}.(sin id).eventId`, code: "MISSING_EVENT_ID", message: "the act does not declare its identity; an event without an id is not shown (§26.3/§26.5)" });
      }
      if (event?.lane !== expectedEventLane) {
        errors.push({ field: `${lane}.${event?.eventId ?? "(no id)"}.lane`, code: "EVENT_LANE_MISMATCH", message: `the event declares lane "${event?.lane ?? "missing"}" in the ${lane} container; the boundary canonical lane "execution"/"intervention" separates execution from human intervention (§26.3)` });
      }
      if (lane === "interventions" && event?.class !== HUMAN_INTERVENTION_CLASS) {
        errors.push({ field: `${lane}.${event?.eventId ?? "(no id)"}.class`, code: "INVALID_INTERVENTION_CLASS", message: `a human intervention is ${HUMAN_INTERVENTION_CLASS} and not an execution class; a human-touched result is not rendered as a simulated fill nor silently attributed (§26.3)` });
      }
      if (lane === "executions" && !EXECUTION_CLASSES.includes(event?.class)) {
        errors.push({ field: `${lane}.${event?.eventId ?? "(no id)"}.class`, code: "UNKNOWN_EXECUTION_CLASS", message: `class must be ${EXECUTION_CLASSES.join(", ")}: a hypothetical fill is not shown as Real and an unknown class is not shown as factual (§26.3)` });
      }
      // UI01-07 (review de cambio 2026-09-23): el reloj exhibido del evento
      // (render.mjs .event-clock) se re-valida como timestamp UTC canónico del
      // boundary (§6.1): sin zona o no canónico no se muestra como factual.
      // reconcileOperatorTimeline sólo compara cuando Date.parse no da NaN y
      // silencia el caso inválido, así que aquí se constata la forma canónica.
      const eventClock = toUtcTimestamp(event?.clock);
      if (!eventClock.ok || eventClock.utc !== event.clock) {
        errors.push({ field: `${lane}.${event?.eventId ?? "(no id)"}.clock`, code: "EVENT_CLOCK_NOT_CANONICAL", message: "the event clock must be a canonical UTC timestamp with explicit zone and normalized form; a non-canonical clock is not shown (§6.1/§26.3)" });
      }
      // UI01-01a-r2 (review de cambio 2026-09-23): el ref exhibido por el
      // render (relatedRecommendationRef) se ata al vínculo canónico
      // resuelto (relatedCanonicalRef); un ref mostrado que no es el que el
      // boundary resolvió no es factual (§26.5/§26.3).
      const canonical = event?.relatedCanonicalRef;
      const displayedRef = event?.relatedRecommendationRef;
      const displayedParsed = parseBackendRef(displayedRef);
      if (displayedParsed === null
        || displayedParsed.recordKey !== canonical?.recordKey
        || displayedParsed.revisionId !== canonical?.revisionId) {
        errors.push({ field: `${lane}.${event?.eventId ?? "(no id)"}.relatedRecommendationRef`, code: "RECOMMENDATION_REF_NOT_BOUND", message: "the displayed recommendation ref is not the one resolved by the verified canonical boundary link; it is not drawn as factual (§26.5/§26.3)" });
      }
      const ref = event?.relatedCanonicalRef;
      const refIsUsable = ref !== undefined && ref !== null;
      const resolved = refIsUsable
        ? resolveBackendRecord(backendIndex, ref.recordKey, ref.revisionId)
        : null;
      if (resolved === null) {
        errors.push({ field: `${lane}.${event?.eventId ?? "(no id)"}.relatedCanonicalRef`, code: "RECOMMENDATION_LINK_NOT_IN_BACKEND", message: "the recommendation link does not resolve to a decision view version of the verified manifest (§26.3/§26.5)" });
      } else if (refIsUsable && resolved.viewScope !== "decision") {
        errors.push({ field: `${lane}.${event?.eventId ?? "(no id)"}.relatedCanonicalRef`, code: "RECOMMENDATION_LINK_NOT_DECISION_SCOPE", message: "the act links to the recommendation known at decision time; the referee is not a decision view version (§26.3)" });
      }
      bindAuthorizationOrigin(lane, event);
      // UI01-11 (review de cambio 2026-09-23): una intervención humana nunca
      // es un acto REAL (bindAuthorizationOrigin sólo corre en class REAL,
      // §26.3), así que una authorization ahí declarada jamás fue validada
      // por el boundary; pasada cruda al render exponía refs
      // data-authority/data-receipt-* factuales sin respaldo (§26.5).
      if (lane === "interventions" && event?.authorization !== undefined && event.authorization !== null) {
        errors.push({ field: `${lane}.${event?.eventId ?? "(no id)"}.authorization`, code: "INTERVENTION_AUTHORIZATION_NOT_BOUND", message: "a human intervention is not a REAL act; its authorization was not validated by the boundary and is not displayed as factual (§26.3/§26.5)" });
      }
    }
  }
  if (errors.length > 0) {
    return unexpectedTimeline(errors);
  }
  const laneClass = (event) => {
    if (event.lane === "intervention") {
      return HUMAN_INTERVENTION_CLASS;
    }
    return event.class;
  };
  const imaginary = (event) => event.class === EXECUTION_CLASS.HYPOTHETICAL;
  const realityCheck = (event) => event.class === EXECUTION_CLASS.REAL;
  // UI02-H1 (review de cambio 24-sep-2026): /health reporta el estado real por
  // superficie; la página de Replay exhibe datos canónicos cuando cualquiera
  // de sus canales del boundary ya validado lleva contenido respaldado por el
  // manifest verificado (§26.5): puntos del timeline, actuaciones, o una
  // sección de exposición con valor canónico atado a su procedencia.
  const hasCanonicalTimelineContent = t.decision.points.length > 0
    || t.evaluation.points.length > 0
    || t.executions.length > 0
    || t.interventions.length > 0;
  const hasCanonicalExposureValue = exposure.exposure.fields.some((field) => field.condition === EXPOSURE_CONDITION.AVAILABLE);
  return {
    hasAnyBoundData: hasCanonicalTimelineContent || hasCanonicalExposureValue,
    ok: true,
    surface: SURFACES.REPLAY,
    workingMode: t.workingMode,
    decision: { boundary: t.decision.boundary, points: t.decision.points, suppressed: t.decision.suppressed, unavailable: t.decision.unavailable },
    evaluation: { asOf: t.evaluation.asOf, points: t.evaluation.points, pendingRevisions: t.evaluation.pendingRevisions, unavailable: t.evaluation.unavailable },
    executions: t.executions.map((event) => ({ ...event, isHypothetical: imaginary(event), isReal: realityCheck(event) })),
    // UI01-11 (review de cambio 2026-09-23): los flags que el render muestra
    // (data-real/data-hypothetical) se derivan de la clase canónica, no del
    // flag declarado por el llamador; HUMAN_INTERVENTION nunca es real ni
    // hipotético (§26.3).
    interventions: t.interventions.map((event) => ({ ...event, isHypothetical: false, isReal: false })),
    exposure: exposure.exposure,
  };
}
