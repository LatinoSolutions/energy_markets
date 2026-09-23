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

import { bindRecord } from "./binding.mjs";
import {
  EXPOSURE_CONDITION,
} from "../operator-interface/exposure.mjs";
import {
  EXECUTION_CLASS,
  HUMAN_INTERVENTION_CLASS,
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
export function buildBacktestsViewModel({ backendIndex = null, rows = [] } = {}) {
  if (!Array.isArray(rows)) {
    return unexpectedTimeline([{ field: "rows", code: "INVALID_ROWS", message: "rows debe ser una lista." }]);
  }
  const items = rows.map((row) => {
    if (typeof row?.label !== "string" || row.label.trim().length === 0) {
      return unavailableItem("(fila sin etiqueta)", "fila de comparación sin etiqueta; no se rinde valor anónimo");
    }
    const bound = bindRecord(backendIndex, row);
    if (!bound.ok) {
      return unavailableItem(row.label, bound.reason);
    }
    return boundItem(row.label, bound.bound, { arm: row.arm ?? null, measure: row.measure ?? null });
  });
  return {
    ok: true,
    surface: SURFACES.BACKTESTS,
    rows: items,
    hasAnyBoundData: items.some((item) => item.status === "BOUND"),
    // Los comparadores canónicos del brief que este boundary aún no expose:
    // honestamente declarados, no simulados.
    pendingComparisons: [
      { label: "B / H / V / ΔV", status: "UNAVAILABLE", reason: "sin runs P5/P6 aceptados en el backend; IMP-05/IMP-07/IMP-12/IMP-16 pendientes" },
      { label: "Efectos emparejados por campaña", status: "UNAVAILABLE", reason: "sin pares A0/A1 registrados en el backend" },
      { label: "Distribuciones", status: "UNAVAILABLE", reason: "sin distribución de resultados canónica; no se fabrica (§26.5)" },
      { label: "Contexto de integridad/método", status: "UNAVAILABLE", reason: "receipts de run e integridad OOS aún no producidos (IMP-14/IMP-16)" },
    ],
  };
}

// Research / Strategy Lab. `strategies` son candidatos { strategyId,
// recordKey, revisionId, value } con value={ phase, ... } del registry de
// admission. Lo esperado por la pila S1–S5/Z que no entra se declara.
export function buildResearchViewModel({ backendIndex = null, records = [] } = {}) {
  if (!Array.isArray(records)) {
    return unexpectedTimeline([{ field: "records", code: "INVALID_RECORDS", message: "records debe ser una lista." }]);
  }
  const byId = new Map();
  for (const record of records) {
    if (typeof record?.strategyId !== "string" || record.strategyId.trim().length === 0) {
      continue;
    }
    if (byId.has(record.strategyId)) {
      return unexpectedTimeline([{ field: "records", code: "DUPLICATE_STRATEGY_ID", message: `"${record.strategyId}" declarado dos veces; dos verdades sobre lo mismo (§26.5).` }]);
    }
    byId.set(record.strategyId, record);
  }
  const strategies = EXPECTED_STRATEGY_STACK.map((strategyId) => {
    const candidate = byId.get(strategyId);
    if (candidate === undefined) {
      return {
        strategyId,
        status: "UNAVAILABLE",
        reason: "sin registro canónico del backend en este scope; no se presume hipótesis ni readiness",
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
      { label: "Experiment / version lineage", status: "UNAVAILABLE", reason: "sin lineage canónico proveniente del backend" },
      { label: "Evidence / receipts", status: "UNAVAILABLE", reason: "sin run receipts aceptados (IMP-14 pendiente)" },
    ],
  };
}

// Campaigns & Runs. `campaigns` son candidatos { campaignId, recordKey,
// revisionId, value } (ficha de campaña canónica) y `runs` candidatos
// { runId, record: {recordKey, revisionId, value} } con drilldowns declarados
// { replay: "<recordKey>@<revisionId>", backtests: ..., research: ... }.
export function buildCampaignsViewModel({ backendIndex = null, campaigns = [], runs = [] } = {}) {
  if (!Array.isArray(campaigns) || !Array.isArray(runs)) {
    return unexpectedTimeline([{ field: "campaigns", code: "INVALID_INPUT", message: "campaigns y runs deben ser listas." }]);
  }
  const seenCampaigns = new Set();
  for (const campaign of campaigns) {
    if (campaign?.campaignId === undefined || seenCampaigns.has(campaign.campaignId)) {
      return unexpectedTimeline([{ field: "campaigns", code: "DUPLICATE_CAMPAIGN_ID", message: "cada campaña se declara una vez (§26.5)." }]);
    }
    seenCampaigns.add(campaign.campaignId);
  }
  const seenRuns = new Set();
  for (const run of runs) {
    if (run?.runId === undefined || seenRuns.has(run.runId)) {
      return unexpectedTimeline([{ field: "runs", code: "DUPLICATE_RUN_ID", message: "cada run se declara una vez (§26.5)." }]);
    }
    seenRuns.add(run.runId);
  }
  const campaignItems = campaigns
    .map((campaign) => {
      if (typeof campaign?.campaignId !== "string" || campaign.campaignId.trim().length === 0) {
        return unavailableItem("(campaña sin id)", "campaña sin identidad; no se rinde");
      }
      const bound = bindRecord(backendIndex, campaign);
      if (!bound.ok) {
        return unavailableItem(campaign.campaignId, bound.reason);
      }
      return boundItem(campaign.campaignId, bound.bound, { kind: "CAMPAIGN" });
    });
  const runItems = runs
    .map((run) => {
      if (typeof run?.runId !== "string" || run.runId.trim().length === 0) {
        return unavailableItem("(run sin id)", "run sin identidad; no se rinde");
      }
      const record = run.record ?? run;
      const bound = bindRecord(backendIndex, record);
      if (!bound.ok) {
        return unavailableItem(run.runId, bound.reason);
      }
      return boundItem(run.runId, bound.bound, { kind: "RUN" });
    });
  return {
    ok: true,
    surface: SURFACES.CAMPAIGNS,
    campaigns: campaignItems,
    runs: runItems,
    hasAnyBoundData: [...campaignItems, ...runItems].some((item) => item.status === "BOUND"),
    // Drilldowns: sólo referencias declaradas por el llamador, nunca enlaces
    // fabricados a superficies con datos que el backend no expone.
    drilldownTargets: Object.freeze(["replay", "backtests", "research"]),
  };
}

// Replay / Decision Inspector. Sólo acepta salidas ya validadas del boundary:
// `timeline` (buildOperatorTimeline ok:true) y `exposure` (buildExposure
// ok:true). Si el llamador trae un output ok:false, el modelo es error
// fail-closed: no se habrá renderizado nada inventado.
export function buildReplayViewModel({ timeline = null, exposure = null } = {}) {
  if (timeline === null || timeline?.ok !== true || timeline?.timeline === undefined) {
    return unexpectedTimeline([{ field: "timeline", code: "TIMELINE_NOT_VALIDATED", message: "Replay exige el timeline validado de buildOperatorTimeline; sin él no se renderiza (§26.3)." }]);
  }
  if (exposure === null || exposure?.ok !== true || exposure?.exposure === undefined) {
    return unexpectedTimeline([{ field: "exposure", code: "EXPOSURE_NOT_VALIDATED", message: "Replay exige la exposición validada de buildExposure; sin ella no se renderiza (§26.2)." }]);
  }
  const t = timeline.timeline;
  const laneClass = (event) => {
    if (event.lane === "intervention") {
      return HUMAN_INTERVENTION_CLASS;
    }
    return event.class;
  };
  const imaginary = (event) => event.class === EXECUTION_CLASS.HYPOTHETICAL;
  const realityCheck = (event) => event.class === EXECUTION_CLASS.REAL;
  return {
    ok: true,
    surface: SURFACES.REPLAY,
    workingMode: t.workingMode,
    decision: { boundary: t.decision.boundary, points: t.decision.points, suppressed: t.decision.suppressed, unavailable: t.decision.unavailable },
    evaluation: { asOf: t.evaluation.asOf, points: t.evaluation.points, pendingRevisions: t.evaluation.pendingRevisions, unavailable: t.evaluation.unavailable },
    executions: t.executions.map((event) => ({ ...event, isHypothetical: imaginary(event), isReal: realityCheck(event) })),
    interventions: t.interventions,
    exposure: exposure.exposure,
  };
}
