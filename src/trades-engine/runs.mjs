// Orquestación de los runs TRADES de las 4 misiones (TR-06). Fuente:
// docs/canonical/v1_1_1/OWNER_PATCH_TRADES_MODE_2026-09-25.md
// (EM-SPEC-OWNER-PATCH-2026-09-25-03) §2 (identidad de cada run: market, mission,
// source_mode, observation_rule, zone), §4 (zonas: Development, OOS histórico,
// puente; "una sola apertura con la versión congelada"; "un run_id nuevo sobre el
// OOS es una nueva apertura y se cuenta") y §6 (las 4 misiones entran completas)
// y TRADES_MODE_PLAN.md TR-06 ("Development (walk-forward para la hora) -> puente
// (mitad de evaluación contra el gate de TR-04) -> OOS histórico (una apertura
// registrada). Scoring por campaign; métricas por día-decisión como diagnóstico.
// Pico de RAM por run.").
//
// Este módulo es PURO: recibe la zona plan de TR-02, las filas de trades, el
// calendario, la serie TOB y el RESULTADO FROZEN del contrato TRADES-v1 (TR-04),
// y devuelve los runs de las 4 misiones con su scoring y diagnóstico. NO abre el
// lago, NO corre escaneos y NO inventa parámetros: delega cada episodio en el
// motor TR-05 (`runTradesMission`) y el gate del puente en el contrato de TR-04
// (`evaluateTradesBridgeGate`).
//
// El pico de RAM lo mide la ruta de jobs de BT-05, no este módulo: `memoryPeak`
// entra como dato del run y se copia al manifest; si falta, queda null (nunca un
// número inventado).
//
// Fail-closed en cada eslabón: sin FROZEN no corre ninguna estrategia; sin zona
// plan RESERVED no se abre el OOS; sin historia de Development el brazo HOUR no
// se corre (estado propio del motor TR-05); un parámetro sin medir bloquea el run
// en vez de sustituirse por cero.

import { CLIENT_SLOT } from "../exploratory/backtest.mjs";
import { HALVES, OBSERVATION_RULES, OBSERVATION_RULE_LIST, SLOT_LABELS } from "../trades-bridge/constants.mjs";
import { bridgeHalves, halfOfDate } from "../trades-bridge/time.mjs";
import { ZONE_BOUNDARIES, ZONES, recordTradesOosAccess } from "../oos-reservation/trades-zones.mjs";
import {
  TRADES_BRIDGE_GATE,
  evaluateBridgeGateMetric,
  evaluateTradesBridgeGate,
} from "../execution-contract/trades-contract.mjs";
import { buildTradesComparison } from "./comparison.mjs";
import { TRADES_POLICIES, runTobEpisode } from "./episode.mjs";
import { TRADES_JOB_KIND, buildTradesRunManifest, computeTradesRunIdentity } from "./identity.mjs";
import { filterDaysByZone, tobSlotsForCampaign, tradingDaysForCampaign } from "./loaders.mjs";
import { TRADES_ENGINE_MISSIONS, missionDefinition } from "./missions.mjs";
import { TRADES_ARM_LABELS, TRADES_ARMS, runTradesMission } from "./run.mjs";

export const TRADES_RUNS_VERSION = "TR-06_TRADES_RUNS_V1";

// Las tres fases del plan TR-06, en orden. Cada fase corresponde a UNA zona
// (patch 03 §4): Development, puente y OOS histórico.
export const TRADES_RUN_PHASES = Object.freeze({
  DEVELOPMENT: "DEVELOPMENT",
  BRIDGE: "BRIDGE",
  OOS: "OOS",
});

export const TRADES_PHASE_ZONES = Object.freeze({
  [TRADES_RUN_PHASES.DEVELOPMENT]: ZONES.DEVELOPMENT,
  [TRADES_RUN_PHASES.BRIDGE]: ZONES.PUENTE,
  [TRADES_RUN_PHASES.OOS]: ZONES.OOS_HISTORICO,
});

export const TRADES_RUN_PHASE_ORDER = Object.freeze([
  TRADES_RUN_PHASES.DEVELOPMENT,
  TRADES_RUN_PHASES.BRIDGE,
  TRADES_RUN_PHASES.OOS,
]);

// Propósito de acceso del OOS (TR-02). La apertura es la lectura que consume el
// sello; la inspección de la regla secundaria no abre una segunda vez.
export const TRADES_OOS_OPENING_PURPOSE = "TRADES_OOS_OPENING";
export const TRADES_OOS_INSPECTION_PURPOSE = "TRADES_OOS_INSPECTION";

export const TRADES_RUNS_ACCEPTANCE_TEST = "Runs de las 4 misiones por fase (Development walk-forward, puente contra el gate de TR-04 en la mitad de evaluación y OOS histórico con una sola apertura registrada por misión), con scoring por campaign, métricas por día-decisión como diagnóstico y pico de RAM por run medido por la ruta de BT-05.";

const ARM_IDS = Object.freeze(Object.values(TRADES_ARMS));
const BRIDGE_HALVES = bridgeHalves({ startIso: ZONE_BOUNDARIES.BRIDGE_START, endIso: ZONE_BOUNDARIES.BRIDGE_END });

function pushBlock(blocks, code, context = {}) {
  blocks.push({ code, ...context });
}

// ---------------------------------------------------------------------------
// Scoring por campaign y diagnóstico por día-decisión (plan TR-06)
// ---------------------------------------------------------------------------

function armSummary(arm) {
  const summary = arm?.summary ?? null;
  if (summary === null) return null;
  return {
    status: summary.status ?? null,
    complete: summary.complete === true,
    boughtMw: summary.boughtMw ?? null,
    avgPriceEurMwh: summary.avgPriceEurMwh ?? null,
    observationRule: summary.observationRule ?? null,
    slotLabel: summary.slotLabel ?? null,
  };
}

// Scoring por campaign: los tres brazos de la campaign con su resultado, y el ΔV
// por brazo que el motor TR-05 ya calcula (el benchmark se cancela entre brazos
// completos). No se recalcula economía aquí.
export function scoreCampaigns({ result, comparison }) {
  const deltaByArm = new Map((comparison?.table ?? []).map((row) => [row.armId, row.deltaVKeur]));
  return (result?.episodes ?? []).map((episode) => ({
    campaignId: episode.campaign?.campaignId ?? null,
    maturity: episode.campaign?.maturity ?? null,
    targetMw: result?.targetMw ?? null,
    hour: episode.hour?.chosenSlot ?? null,
    arms: Object.fromEntries(ARM_IDS.map((armId) => [armId, armSummary(episode.arms?.[armId])])),
    deltaVKeur: Object.fromEntries(ARM_IDS.map((armId) => [armId, deltaByArm.get(armId) ?? null])),
    armErrors: episode.armErrors ?? {},
  }));
}

// Métricas por día-decisión como DIAGNÓSTICO (plan TR-06): lo que cada brazo hizo
// cada día, tal como quedó en el ledger del motor. No es scoring: la unidad de
// scoring sigue siendo la campaign (patch 03 §4).
export function decisionDayDiagnostics({ result }) {
  const rows = [];
  for (const episode of result?.episodes ?? []) {
    for (const armId of ARM_IDS) {
      const ledger = episode.arms?.[armId]?.ledger;
      if (!Array.isArray(ledger)) continue;
      for (const entry of ledger) {
        rows.push({
          campaignId: episode.campaign?.campaignId ?? null,
          armId,
          day: entry.day ?? null,
          decision: (entry.filledMw ?? 0) > 0 ? "BUY" : "WAIT",
          status: entry.status ?? null,
          filledMw: entry.filledMw ?? 0,
          priceEurMwh: entry.priceEurMwh ?? null,
          observationRule: entry.observationRule ?? null,
          observationAgeSeconds: entry.observationAgeSeconds ?? null,
          remainingMw: entry.remainingMw ?? null,
        });
      }
    }
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Identidad y manifest del run (compatibles con BT-05)
// ---------------------------------------------------------------------------

function buildRunRecord({ phase, missionKey, observationRule, result, codeCommit, dataManifest, parameters, memoryPeak }) {
  const identityResult = computeTradesRunIdentity({
    codeCommit,
    dataManifest,
    parameters: { jobKind: TRADES_JOB_KIND, phase, ...parameters },
    market: result.market,
    mission: result.missionKey,
    sourceMode: result.sourceMode,
    observationRule,
    zone: result.zone,
    configHash: result.configHash,
  });
  const manifest = identityResult.ok
    ? buildTradesRunManifest({
      runId: identityResult.runId,
      identity: identityResult.identity,
      inputs: { zone: result.zone, observationRule, mission: result.missionKey },
      status: "SUCCEEDED",
      memoryPeak: memoryPeak ?? null,
    })
    : null;
  return {
    ok: identityResult.ok,
    code: identityResult.code ?? null,
    runId: identityResult.runId,
    identity: identityResult.identity,
    manifest,
  };
}

// ---------------------------------------------------------------------------
// Fase Development (walk-forward de la hora)
// ---------------------------------------------------------------------------

function runDevelopmentForMission({ missionKey, observationRule, campaigns, rows, exchangeDays, frozenContract, slotLabels }) {
  return runTradesMission({
    missionKey,
    zone: ZONES.DEVELOPMENT,
    observationRule,
    campaigns,
    rows,
    exchangeDays,
    frozenContract,
    slotLabels,
  });
}

// ---------------------------------------------------------------------------
// Fase OOS histórico (una sola apertura registrada por misión)
// ---------------------------------------------------------------------------

// Registra UNA apertura del OOS por misión. El propósito que consume el sello es
// TRADES_OOS_OPENING (patch 03 §4: "una sola apertura con la versión congelada").
// La regla secundaria se registra como TRADES_OOS_INSPECTION (no consume): es una
// inspección de la misma apertura, no una segunda. Un run_id nuevo es una nueva
// apertura y se cuenta; el conteo se publica, nunca se oculta.
export function openTradesOosForMission({ plan, missionKey, runId, atUtc, actor = null, purpose = TRADES_OOS_OPENING_PURPOSE }) {
  if (!plan || plan.decision !== "RESERVED") {
    return { ok: false, code: "ZONE_PLAN_NOT_RESERVED", plan: plan ?? null, opening: null, accessPlan: plan ?? null };
  }
  const outcome = recordTradesOosAccess(plan, { purpose, mission: missionKey, runId, atUtc, actor });
  if (!outcome.ok) {
    return { ok: false, code: outcome.code, plan, opening: null, accessPlan: plan };
  }
  return {
    ok: true,
    code: null,
    plan,
    opening: { purpose, mission: missionKey, runId, atUtc },
    accessPlan: outcome.reservation,
    oosOpenings: outcome.oosOpenings,
    oosStatusByMission: outcome.oosStatusByMission,
    oosOpeningsByMission: outcome.oosOpeningsByMission,
  };
}

function runOosForMission({ missionKey, observationRule, campaigns, rows, exchangeDays, historyCampaigns, historyRows, frozenContract, slotLabels }) {
  return runTradesMission({
    missionKey,
    zone: ZONES.OOS_HISTORICO,
    observationRule,
    campaigns,
    rows,
    exchangeDays,
    historyCampaigns,
    historyRows,
    frozenContract,
    slotLabels,
  });
}

// ---------------------------------------------------------------------------
// Fase puente (mitad de evaluación contra el gate de TR-04)
// ---------------------------------------------------------------------------

function tobArm({ campaign, tradingDays, series, slotLabel, slotLabels, targetMw, policyId }) {
  const slotIndex = slotLabels.indexOf(slotLabel);
  if (slotIndex < 0) return { ok: false, code: "UNKNOWN_SLOT" };
  return runTobEpisode({
    campaign,
    tradingDays,
    series,
    slotIndex,
    slotLabel,
    targetMw,
    policy: TRADES_POLICIES[policyId],
  });
}

// Brazos TOB de control del puente, para la misma campaign y los mismos días que
// el episodio TRADES. La hora del brazo HOUR es la elegida walk-forward por TR-05
// (nunca se elige aquí).
function tobArmsForCampaign({ episode, exchangeDays, tobSeries, targetMw, slotLabels }) {
  const campaign = episode.campaign;
  const { tradingDays } = tradingDaysForCampaign({ campaign, exchangeDays });
  const zoneDays = filterDaysByZone({ days: tradingDays, zone: ZONES.PUENTE });
  const series = tobSlotsForCampaign({ series: tobSeries, campaign });
  const chosenSlot = episode.hour?.chosenSlot ?? null;
  return {
    BASELINE: tobArm({ campaign, tradingDays: zoneDays, series, slotLabel: CLIENT_SLOT, slotLabels, targetMw, policyId: "A0" }),
    DIP10: tobArm({ campaign, tradingDays: zoneDays, series, slotLabel: CLIENT_SLOT, slotLabels, targetMw, policyId: "DIP10" }),
    HOUR: chosenSlot === null
      ? null
      : tobArm({ campaign, tradingDays: zoneDays, series, slotLabel: chosenSlot, slotLabels, targetMw, policyId: "A0" }),
  };
}

// Resumen de un brazo restringido a la mitad de evaluación: recomputa bought/coste
// sólo con los días de esa mitad (patch 03 §4 + plan TR-06).
function evaluationHalfSummary({ arm, half }) {
  const summary = arm?.summary ?? null;
  if (summary === null) return null;
  const ledger = (arm.ledger ?? []).filter((entry) => halfOfDate(entry.day, BRIDGE_HALVES) === half);
  const targetMw = summary.targetMw ?? null;
  const boughtMw = ledger.reduce((total, entry) => total + (entry.filledMw ?? 0), 0);
  const cost = ledger.reduce((total, entry) => total + (entry.filledMw ?? 0) * (entry.priceEurMwh ?? 0), 0);
  return {
    ...summary,
    boughtMw,
    remainingMw: targetMw === null ? null : targetMw - boughtMw,
    avgPriceEurMwh: boughtMw > 0 ? cost / boughtMw : null,
    complete: targetMw !== null && boughtMw >= targetMw,
  };
}

function evaluationDecisions({ episodes, armId, half }) {
  const map = new Map();
  for (const episode of episodes) {
    const ledger = episode.arms?.[armId]?.ledger;
    if (!Array.isArray(ledger)) continue;
    for (const entry of ledger) {
      if (halfOfDate(entry.day, BRIDGE_HALVES) !== half) continue;
      map.set(`${episode.campaign.campaignId}|${entry.day}`, (entry.filledMw ?? 0) > 0 ? "BUY" : "WAIT");
    }
  }
  return map;
}

// Agrega un brazo sobre la mitad de evaluación: completion (BOUGHT_MW), fill
// medio (FILL_PRICE) y coste all-in unitario (H). Este motor de ejecución sólo
// tiene el precio de fill como coste, así que H y FILL_PRICE salen del mismo
// ledger (declarado); no se inventa un coste separado.
function evaluationArmMetrics({ tradesEpisodes, tobEpisodes, armId }) {
  const aggregate = (episodes, mode) => {
    let target = 0;
    let bought = 0;
    let cost = 0;
    for (const episode of episodes) {
      const summary = evaluationHalfSummary({ arm: episode.arms?.[armId], half: HALVES.EVALUATION });
      if (summary === null) continue;
      target += summary.targetMw ?? 0;
      bought += summary.boughtMw ?? 0;
      cost += (summary.boughtMw ?? 0) * (summary.avgPriceEurMwh ?? 0);
    }
    return {
      mode,
      completion: target > 0 ? bought / target : null,
      fillEurMwh: bought > 0 ? cost / bought : null,
    };
  };
  const trades = aggregate(tradesEpisodes, "TRADES");
  const tob = aggregate(tobEpisodes, "TOB");
  const tobDecisions = evaluationDecisions({ episodes: tobEpisodes, armId, half: HALVES.EVALUATION });
  const tradesDecisions = evaluationDecisions({ episodes: tradesEpisodes, armId, half: HALVES.EVALUATION });
  const keys = [...tobDecisions.keys()].filter((key) => tradesDecisions.has(key)).sort();
  return {
    tob: {
      BUY_WAIT_AGREEMENT: keys.map((key) => tobDecisions.get(key)),
      BOUGHT_MW: tob.completion,
      FILL_PRICE: tob.fillEurMwh,
      H: tob.fillEurMwh,
    },
    trades: {
      BUY_WAIT_AGREEMENT: keys.map((key) => tradesDecisions.get(key)),
      BOUGHT_MW: trades.completion,
      FILL_PRICE: trades.fillEurMwh,
      H: trades.fillEurMwh,
    },
    keys,
  };
}

// ΔV por brazo sobre la mitad de evaluación. BASELINE es 0 por definición (ΔV
// contra sí mismo); los otros brazos sólo tienen ΔV si ambos están completos.
function evaluationDeltaV({ missionKey, tradesEpisodes, tobEpisodes }) {
  const build = (episodes) => {
    const filtered = episodes.map((episode) => {
      const arms = {};
      for (const [armId, arm] of Object.entries(episode.arms ?? {})) {
        if (!arm) {
          arms[armId] = null;
          continue;
        }
        const summary = evaluationHalfSummary({ arm, half: HALVES.EVALUATION });
        const ledger = (arm.ledger ?? []).filter((entry) => halfOfDate(entry.day, BRIDGE_HALVES) === HALVES.EVALUATION);
        arms[armId] = summary === null ? null : { summary, ledger };
      }
      return { mission: episode.campaign.mission, maturity: episode.campaign.maturity, arms };
    });
    const comparison = buildTradesComparison({
      product: missionDefinition(missionKey).definition.shortCode,
      episodes: filtered,
      armLabels: TRADES_ARM_LABELS,
    });
    return Object.fromEntries((comparison.table ?? []).map((row) => [row.armId, row.deltaVKeur]));
  };
  const withBaselineZero = (table) => Object.fromEntries(ARM_IDS.map((armId) => [armId, armId === "BASELINE" ? 0 : table[armId] ?? null]));
  return { tob: withBaselineZero(build(tobEpisodes)), trades: withBaselineZero(build(tradesEpisodes)) };
}

const PER_ARM_GATE_METRICS = Object.freeze(TRADES_BRIDGE_GATE.metrics.filter((metric) => metric.id !== "DELTA_V"));
const DELTA_V_GATE_METRIC = Object.freeze(TRADES_BRIDGE_GATE.metrics.find((metric) => metric.id === "DELTA_V"));

// Evalúa el gate del puente de TR-04 sobre la MITAD DE EVALUACIÓN (plan TR-06):
// BUY_WAIT / BOUGHT_MW / FILL_PRICE / H por brazo y el signo/orden de ΔV a nivel
// de misión. FAIL si alguna métrica falla; HOLD si ninguna falla pero alguna no
// es evaluable (no se inventa un PASS parcial); PASS sólo si todas pasan.
export function evaluateBridgeForMission({ missionKey, tradesResult, campaigns, exchangeDays, tobSeries = new Map(), slotLabels = SLOT_LABELS }) {
  const tradesEpisodes = (tradesResult?.episodes ?? []).map((episode) => ({ campaign: episode.campaign, arms: episode.arms }));
  const tobEpisodes = (tradesResult?.episodes ?? []).map((episode) => ({
    campaign: episode.campaign,
    arms: tobArmsForCampaign({ episode, exchangeDays, tobSeries, targetMw: tradesResult.targetMw, slotLabels }),
  }));

  const perArm = {};
  for (const armId of ARM_IDS) {
    const { tob, trades, keys } = evaluationArmMetrics({ tradesEpisodes, tobEpisodes, armId });
    const gate = evaluateTradesBridgeGate({ metrics: PER_ARM_GATE_METRICS, tob, trades });
    perArm[armId] = { decision: gate.decision, metrics: gate.metrics, decisionDaysCompared: keys.length, values: { tob, trades } };
  }

  const deltaV = evaluationDeltaV({ missionKey, tradesEpisodes, tobEpisodes });
  const deltaGate = evaluateBridgeGateMetric(DELTA_V_GATE_METRIC, { tobValue: deltaV.tob, tradesValue: deltaV.trades });

  const decisions = [...Object.values(perArm).map((entry) => entry.decision), deltaGate.status];
  const decision = decisions.includes("FAIL") ? "FAIL" : decisions.includes("HOLD") ? "HOLD" : "PASS";
  return {
    gateId: TRADES_BRIDGE_GATE.id,
    half: HALVES.EVALUATION,
    decision,
    perArm,
    deltaV: { decision: deltaGate.status, metric: deltaGate, tob: deltaV.tob, trades: deltaV.trades },
  };
}

// ---------------------------------------------------------------------------
// Orquestación de las 4 misiones
// ---------------------------------------------------------------------------

function campaignsInZone({ zonePlan, missionKey, zone }) {
  return zonePlan?.missions?.[missionKey]?.zones?.[zone] ?? [];
}

function buildRun({ phase, missionKey, observationRule, result, codeCommit, dataManifest, parameters, memoryPeak, extra = {} }) {
  const record = buildRunRecord({ phase, missionKey, observationRule, result, codeCommit, dataManifest, parameters, memoryPeak });
  return {
    phase,
    zone: TRADES_PHASE_ZONES[phase],
    missionKey,
    market: result.market,
    observationRule,
    targetMw: result.targetMw,
    configHash: result.configHash,
    runId: record.runId,
    identity: record.identity,
    manifest: record.manifest,
    scoring: scoreCampaigns({ result, comparison: result.comparison }),
    diagnostics: decisionDayDiagnostics({ result }),
    skipped: result.skipped ?? [],
    ...extra,
  };
}

// Corre las tres fases de UNA misión bajo UNA regla de observación. El OOS
// histórico abre el sello UNA vez por misión (regla primaria); la regla
// secundaria inspecciona la misma apertura sin consumirla otra vez.
export function runTradesMissionPhases({
  phase,
  missionKey,
  observationRule,
  zonePlan,
  rows = [],
  exchangeDays = [],
  tobSeries = new Map(),
  frozenContract,
  codeCommit = null,
  dataManifest = null,
  parameters = {},
  memoryPeak = null,
  slotLabels = SLOT_LABELS,
  atUtc = null,
  actor = null,
  oosPlan = null,
} = {}) {
  if (!Object.values(TRADES_RUN_PHASES).includes(phase)) {
    return { ok: false, code: "UNKNOWN_PHASE", phase: phase ?? null, run: null, oos: null };
  }
  const definition = missionDefinition(missionKey);
  if (!definition.ok) return { ok: false, code: definition.code, run: null, oos: null };

  const zone = TRADES_PHASE_ZONES[phase];
  const campaigns = campaignsInZone({ zonePlan, missionKey, zone });
  const developmentCampaigns = campaignsInZone({ zonePlan, missionKey, zone: ZONES.DEVELOPMENT });

  if (phase === TRADES_RUN_PHASES.DEVELOPMENT) {
    const result = runDevelopmentForMission({ missionKey, observationRule, campaigns, rows, exchangeDays, frozenContract, slotLabels });
    if (!result.ok) return { ok: false, code: result.code, run: null, oos: null };
    return { ok: true, code: null, run: buildRun({ phase, missionKey, observationRule, result, codeCommit, dataManifest, parameters, memoryPeak }), oos: null };
  }

  if (phase === TRADES_RUN_PHASES.BRIDGE) {
    const result = runTradesMission({
      missionKey,
      zone: ZONES.PUENTE,
      observationRule,
      campaigns,
      rows,
      exchangeDays,
      historyCampaigns: developmentCampaigns,
      historyRows: rows,
      frozenContract,
      slotLabels,
    });
    if (!result.ok) return { ok: false, code: result.code, run: null, oos: null };
    const gate = evaluateBridgeForMission({ missionKey, tradesResult: result, campaigns, exchangeDays, tobSeries, slotLabels });
    return { ok: true, code: null, run: buildRun({ phase, missionKey, observationRule, result, codeCommit, dataManifest, parameters, memoryPeak, extra: { bridgeGate: gate } }), oos: null };
  }

  // OOS histórico
  const result = runOosForMission({
    missionKey,
    observationRule,
    campaigns,
    rows,
    exchangeDays,
    historyCampaigns: developmentCampaigns,
    historyRows: rows,
    frozenContract,
    slotLabels,
  });
  if (!result.ok) return { ok: false, code: result.code, run: null, oos: null };

  const record = buildRunRecord({ phase, missionKey, observationRule, result, codeCommit, dataManifest, parameters, memoryPeak });
  // La apertura es UNA por misión: sólo la regla primaria la registra; la
  // secundaria inspecciona la misma apertura sin abrir otra.
  const isOpening = observationRule === OBSERVATION_RULES.LAST_TRADE;
  const purpose = isOpening ? TRADES_OOS_OPENING_PURPOSE : TRADES_OOS_INSPECTION_PURPOSE;
  const plan = oosPlan ?? zonePlan;
  // Sin un plan sellado no hay examen del OOS: ni apertura ni inspección.
  if (!plan || plan.decision !== "RESERVED") {
    return { ok: false, code: "ZONE_PLAN_NOT_RESERVED", run: null, oos: { ok: false, code: "ZONE_PLAN_NOT_RESERVED", accessPlan: null, opening: null } };
  }
  const opening = record.ok
    ? openTradesOosForMission({ plan, missionKey, runId: record.runId, atUtc, actor, purpose })
    : { ok: false, code: "RUN_IDENTITY_FAILED", accessPlan: plan, opening: null };
  if (!opening.ok) {
    return { ok: false, code: opening.code, run: null, oos: opening };
  }
  const run = buildRun({
    phase,
    missionKey,
    observationRule,
    result,
    codeCommit,
    dataManifest,
    parameters,
    memoryPeak,
    extra: { oosAccess: opening.opening },
  });
  return { ok: true, code: null, run, oos: opening };
}

// Corre las 4 misiones en las tres fases y ambas reglas de observación. El OOS se
// abre una vez por misión (la regla primaria); el plan de accesos se encadena
// entre misiones para que el conteo de aperturas sea el real, no el de un run
// aislado. Sin FROZEN, sin zona plan RESERVED o con una misión sin campaign, el
// resultado queda BLOCKED con la causa, nunca con resultados parciales fingidos.
export function runTradesRuns({
  zonePlan,
  rows = [],
  exchangeDays = [],
  tobSeries = new Map(),
  frozenContract,
  codeCommit = null,
  dataManifest = null,
  parameters = {},
  memoryPeak = null,
  slotLabels = SLOT_LABELS,
  atUtc = null,
  actor = null,
  missions = null,
  initialAccessPlan = null,
} = {}) {
  const blocks = [];
  if (!zonePlan || zonePlan.decision !== "RESERVED") {
    pushBlock(blocks, "ZONE_PLAN_NOT_RESERVED");
  }
  const missionKeys = Array.isArray(missions) && missions.length > 0 ? missions : Object.keys(TRADES_ENGINE_MISSIONS);
  const runs = [];
  // El plan de accesos puede venir encadenado de una llamada anterior (el
  // productor corre un mercado por vez): así el conteo de aperturas del OOS es el
  // real y no el de un run aislado.
  let accessPlan = initialAccessPlan ?? (zonePlan?.decision === "RESERVED" ? zonePlan : null);

  for (const missionKey of missionKeys) {
    if (!missionDefinition(missionKey).ok) {
      pushBlock(blocks, "UNKNOWN_MISSION", { missionKey });
      continue;
    }
    const developmentCampaigns = campaignsInZone({ zonePlan, missionKey, zone: ZONES.DEVELOPMENT });
    const oosCampaigns = campaignsInZone({ zonePlan, missionKey, zone: ZONES.OOS_HISTORICO });
    const bridgeCampaigns = campaignsInZone({ zonePlan, missionKey, zone: ZONES.PUENTE });
    if (developmentCampaigns.length === 0 || oosCampaigns.length === 0 || bridgeCampaigns.length === 0) {
      // La misión no se corre a medias: se declara el bloqueo de data y no se
      // emiten runs vacíos que aparenten cobertura.
      pushBlock(blocks, "MISSION_WITHOUT_CAMPAIGNS", {
        missionKey,
        development: developmentCampaigns.length,
        oos: oosCampaigns.length,
        bridge: bridgeCampaigns.length,
      });
      continue;
    }
    for (const phase of TRADES_RUN_PHASE_ORDER) {
      for (const observationRule of OBSERVATION_RULE_LIST) {
        const outcome = runTradesMissionPhases({
          phase,
          missionKey,
          observationRule,
          zonePlan,
          rows,
          exchangeDays,
          tobSeries,
          frozenContract,
          codeCommit,
          dataManifest,
          parameters,
          memoryPeak,
          slotLabels,
          atUtc,
          actor,
          oosPlan: accessPlan,
        });
        if (!outcome.ok) {
          pushBlock(blocks, outcome.code, { missionKey, phase, observationRule });
          continue;
        }
        if (outcome.oos?.accessPlan) accessPlan = outcome.oos.accessPlan;
        runs.push(outcome.run);
      }
    }
  }

  return {
    ok: blocks.length === 0,
    code: blocks.length === 0 ? null : blocks[0].code,
    artifactKind: "TR-06_TRADES_RUNS",
    schemaVersion: TRADES_RUNS_VERSION,
    status: blocks.length === 0 ? "RUN" : "BLOCKED",
    phases: TRADES_RUN_PHASE_ORDER,
    observationRules: OBSERVATION_RULE_LIST,
    missionKeys,
    runs,
    oosAccess: accessPlan === null ? null : accessPlan.accessRegistry ?? null,
    // Plan de accesos final (zona plan con las aperturas del OOS registradas):
    // el productor lo encadena entre mercados. No es un artefacto: es el estado.
    accessPlan,
    blockedBy: [...new Set(blocks.map((block) => block.code))],
    blocks,
  };
}
