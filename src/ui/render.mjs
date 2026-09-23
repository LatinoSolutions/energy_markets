// UI-01 — primera visual: render HTML de las cuatro superficies. Fuente:
// docs/product/UI-01_VISUAL_REFERENCE_BRIEF.md sobre el boundary de IMP-29
// (SPEC v1.1.1 §26.2–§26.5). PLACEHOLDER de presentación (no canónico): la
// SPEC §26.6 no fija tecnología de frontend; este módulo no calcula nada, sólo
// dibuja view models ya validados y estados explícitos.
//
// Invariables visuales del brief:
//   - Decision-time (data-view-scope="decision") y Evaluation
//     (data-view-scope="evaluation") son mutuamente distintos;
//   - recommendation / execution (SIMULATED|HYPOTHETICAL|REAL) /
//     intervention son objetos distintos con clases propias;
//   - los estados desconocidos BOUND vs UNAVAILABLE se rinden distintos y la
//     razón es legible, nunca sustituida por un valor;
//   - procedencia (recordKey, revisionId, valueSha256) y relojes visibles.

import { SURFACES, SURFACES_LIST } from "./view-models.mjs";

const SURFACE_TITLES = {
  [SURFACES.REPLAY]: "Replay / Decision Inspector",
  [SURFACES.BACKTESTS]: "Backtests / Economic Comparison",
  [SURFACES.RESEARCH]: "Research / Strategy Lab",
  [SURFACES.CAMPAIGNS]: "Campaigns & Runs",
};

const CONDITION_SHORT = {
  AVAILABLE: "disponible",
  PROXY: "proxy identificado",
  UNCERTAIN: "incierto",
  STALE: "desactualizado",
  MISSING: "sin dato",
  UNAVAILABLE: "no disponible",
  NOT_ADMITTED: "no admitido",
  NOT_YET_CLOSED: "no cerrado todavía",
  PENDING_AUTHORITY: "pendiente de autoridad",
};

function esc(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function navHtml(active) {
  const links = SURFACES_LIST.map((id) => `<a href="#${esc(id)}" class="nav-link${id === active ? " nav-active" : ""}" data-nav="${esc(id)}">${esc(SURFACE_TITLES[id])}</a>`);
  return `<nav class="ui-nav" aria-label="Energy Markets">${links.join("")}</nav>`;
}

function provenanceHtml(provenance) {
  if (provenance === undefined || provenance === null) {
    return "";
  }
  return `<span class="provenance" data-record-key="${esc(provenance.recordKey)}" data-revision-id="${esc(provenance.revisionId)}" data-value-sha="${esc(provenance.valueSha256 ?? "")}">${esc(provenance.recordKey)}@${esc(provenance.revisionId)} · sha ${esc((provenance.valueSha256 ?? "").slice(0, 12))}</span>`;
}

function unavailableHtml(item) {
  return `<li class="data-item data-unavailable" data-status="UNAVAILABLE"><span class="item-label">${esc(item.label ?? "")}</span> <span class="condition condition-unavailable">UNAVAILABLE</span> <span class="reason">${esc(item.reason ?? "")}</span></li>`;
}

function boundHtml(item) {
  const value = typeof item.value === "object" ? JSON.stringify(item.value) : String(item.value);
  return `<li class="data-item data-bound" data-status="BOUND">${item.measure !== undefined && item.measure !== null ? `<span class="measure" data-measure="${esc(item.measure)}">${esc(item.measure)}</span> ` : ""}${item.arm !== undefined && item.arm !== null ? `<span class="arm" data-arm="${esc(item.arm)}">${esc(item.arm)}</span> ` : ""}<span class="item-label">${esc(item.label)}</span> <span class="value" data-value="${esc(value)}">${esc(value)}</span> ${provenanceHtml(item.provenance)}${drilldownHtml(item.drilldowns)}</li>`;
}

// Handoff de navegación declarado en el view model: sólo apunta a superficies
// del boundary que aplican sus propios fail-closed; nunca copia datos.
function drilldownHtml(drilldowns) {
  if (!Array.isArray(drilldowns) || drilldowns.length === 0) {
    return "";
  }
  return `<span class="drilldowns">${drilldowns.map((drilldown) => `<a class="drilldown" data-drilldown="${esc(drilldown.href.slice(1))}" href="${esc(drilldown.href)}">${esc(drilldown.href.slice(1))}</a>`).join(" ")}</span>`;
}

function dataItemList(items) {
  return `<ul class="data-list">${items.map((item) => (item.status === "BOUND" ? boundHtml(item) : unavailableHtml(item))).join("")}</ul>`;
}

function emptyStateHtml(message) {
  return `<p class="empty-state" data-empty="true">${esc(message)}</p>`;
}

function exposureFieldHtml(field) {
  const known = field.condition === "AVAILABLE";
  const short = CONDITION_SHORT[field.condition] ?? field.condition;
  if (known) {
    const value = typeof field.value === "object" ? JSON.stringify(field.value) : String(field.value);
    return `<li class="exposure-field exposure-known" data-condition="${esc(field.condition)}"><span class="item-label">${esc(field.specLabel)}</span> <span class="value" data-value="${esc(value)}">${esc(value)}</span> ${provenanceHtml(field.provenance)}</li>`;
  }
  if (field.condition === "PROXY" || field.condition === "UNCERTAIN" || field.condition === "STALE") {
    // UI01-08 (review de cambio 2026-09-23): una condición value-less con
    // procedencia declara la ausencia del valor; "undefined" no es un dato
    // y no se imprime.
    const hasValue = field.value !== undefined && field.value !== null;
    const value = typeof field.value === "object" ? JSON.stringify(field.value) : String(field.value);
    return `<li class="exposure-field exposure-flagged" data-condition="${esc(field.condition)}"><span class="item-label">${esc(field.specLabel)}</span> <span class="condition">${esc(field.condition)}</span>${hasValue ? ` <span class="value" data-value="${esc(value)}">${esc(value)}</span>` : ""} <span class="reason">${esc(field.reason)}</span> ${provenanceHtml(field.provenance)}</li>`;
  }
  return `<li class="exposure-field exposure-unknown" data-condition="${esc(field.condition)}"><span class="item-label">${esc(field.specLabel)}</span> <span class="condition condition-unknown">${esc(field.condition)}</span> <span class="reason">${esc(field.reason)}</span></li>`;
}

function timelinePointHtml(point) {
  return `<li class="ts-point lane-${esc(point.lane)}" data-key="${esc(point.key)}" data-clock="${esc(point.clock ?? "")}" data-clock-kind="${esc(point.clockKind ?? "")}" data-revision="${esc(point.revisionId ?? "")}"><span class="point-key">${esc(point.key)}</span> <span class="value" data-value="${esc(typeof point.value === "object" ? JSON.stringify(point.value) : String(point.value ?? ""))}">${esc(typeof point.value === "object" ? JSON.stringify(point.value) : String(point.value ?? ""))}</span> <span class="clock" title="${esc(point.clockKind ?? "")}">${esc(point.clock ?? "")}</span></li>`;
}

function laneSectionHtml(title, scope, points, emptyMessage) {
  if (points.length === 0) {
    return `<section class="lane lane-scope-${esc(scope)}" data-view-scope="${esc(scope)}"><h3>${esc(title)}</h3>${emptyStateHtml(emptyMessage)}</section>`;
  }
  return `<section class="lane lane-scope-${esc(scope)}" data-view-scope="${esc(scope)}"><h3>${esc(title)}</h3><ul class="data-list ts-points">${points.map(timelinePointHtml).join("")}</ul></section>`;
}

function eventClassHtml(event) {
  const cls = event.lane === "intervention" ? "HUMAN_INTERVENTION" : event.class;
  const realAttrs = event.isReal === true
    ? ` data-real="true" data-authority="${esc(event.authorization?.authorityRef ?? "")}" data-receipt-ref="${esc(event.authorization?.receipt?.receiptRef ?? "")}" data-receipt-sha="${esc(event.authorization?.receipt?.receiptSha256 ?? "")}"`
    : "";
  const hypAttr = event.isHypothetical === true ? ' data-hypothetical="true"' : "";
  const attribution = event.lane === "intervention" ? ` <span class="attribution" data-attribution="${esc(event.attribution ?? "")}">atribución: ${esc(event.attribution ?? "")}</span>` : "";
  return `<li class="event event-class-${esc(cls)}" data-event-id="${esc(event.eventId)}" data-event-class="${esc(cls)}" data-recommendation-ref="${esc(event.relatedRecommendationRef ?? "")}"${hypAttr}${realAttrs}><span class="event-id">${esc(event.eventId)}</span> <span class="event-class">${esc(cls)}</span> <span class="event-clock">${esc(event.clock)}</span> <span class="event-ref">${esc(event.relatedRecommendationRef ?? "")}</span>${attribution}</li>`;
}

function replayHtml(vm) {
  const decision = laneSectionHtml("Decision-time (semántica de decisión)", "decision", vm.decision.points, "sin puntos de decisión en este boundary");
  const evaluation = laneSectionHtml("Evaluation (semántica de evaluación posterior)", "evaluation", vm.evaluation.points, "sin puntos de evaluación en este boundary");
  const executionEvents = vm.executions.length > 0
    ? `<ul class="data-list events">${vm.executions.map(eventClassHtml).join("")}</ul>`
    : emptyStateHtml("sin actuaciones de ejecución en este boundary");
  const interventionEvents = vm.interventions.length > 0
    ? `<ul class="data-list events">${vm.interventions.map(eventClassHtml).join("")}</ul>`
    : emptyStateHtml("sin intervención humana en este boundary");
  return `
<section class="surface replay" data-surface="replay">
  <h2>${esc(SURFACE_TITLES[SURFACES.REPLAY])}</h2>
  <p class="mode-line">modo de trabajo: <span class="working-mode" data-working-mode="${esc(vm.workingMode)}">${esc(vm.workingMode)}</span></p>
  ${decision}
  ${evaluation}
  <section class="events execution-events" data-events-kind="execution"><h3>Ejecución</h3>${executionEvents}</section>
  <section class="events intervention-events" data-events-kind="intervention"><h3>Intervención humana</h3>${interventionEvents}</section>
  <section class="exposure-table" data-kind="exposure"><h3>Exposición §26.2</h3><ul class="data-list exposure-list">${vm.exposure.fields.map(exposureFieldHtml).join("")}</ul></section>
</section>`;
}

function backtestsHtml(vm) {
  const pending = vm.pendingComparisons ?? [];
  return `
<section class="surface backtests" data-surface="backtests">
  <h2>${esc(SURFACE_TITLES[SURFACES.BACKTESTS])}</h2>
  ${dataItemList(vm.rows)}
  <section class="pending-comparisons" data-kind="pending"><h3>Comparaciones pendientes de productores canónicos</h3><ul class="data-list">${pending.map(unavailableHtml).join("")}</ul></section>
</section>`;
}

function researchHtml(vm) {
  const items = vm.strategies.map((strategy) => (strategy.status === "BOUND"
    ? `<li class="data-item data-bound" data-status="BOUND" data-strategy="${esc(strategy.strategyId)}"><span class="item-label">${esc(strategy.strategyId)}</span> <span class="value" data-value="${esc(JSON.stringify(strategy.readiness))}">${esc(JSON.stringify(strategy.readiness))}</span> ${provenanceHtml(strategy.provenance)}</li>`
    : `<li class="data-item data-unavailable" data-status="UNAVAILABLE" data-strategy="${esc(strategy.strategyId)}"><span class="item-label">${esc(strategy.strategyId)}</span> <span class="condition condition-unavailable">UNAVAILABLE</span> <span class="reason">${esc(strategy.reason)}</span></li>`));
  const pending = vm.pendingSections ?? [];
  return `
<section class="surface research" data-surface="research">
  <h2>${esc(SURFACE_TITLES[SURFACES.RESEARCH])}</h2>
  <ul class="data-list strategies">${items.join("")}</ul>
  ${vm.unexpectedStrategyIds.length > 0 ? `<p class="surface-note">fuera de la pila esperada: ${esc(vm.unexpectedStrategyIds.join(", "))}</p>` : ""}
  <section class="pending-sections" data-kind="pending"><h3>Secciones pendientes de productores canónicos</h3><ul class="data-list">${pending.map(unavailableHtml).join("")}</ul></section>
</section>`;
}

function renderErrorState(surface, vm) {
  const errors = vm?.errors ?? [];
  return `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8"><title>Energy Markets — error</title><link rel="stylesheet" href="/ui.css"></head><body>${navHtml(surface)}<div class="surface state-error" data-state="ERROR"><p>La superficie no puede renderizarse con datos no validados (fail-closed, §26.5).</p><ul class="error-list">${errors.map((error) => `<li data-code="${esc(error.code)}"><span class="error-code">${esc(error.code)}</span> ${esc(error.message)}</li>`).join("")}</ul></div></body></html>`;
}

function renderPageStub(surface, bodyFromVm) {
  return (vm) => {
    if (vm?.ok !== true) {
      return renderErrorState(surface, vm);
    }
    const body = bodyFromVm(vm);
    return `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8"><title>Energy Markets — ${esc(SURFACE_TITLES[surface])}</title><link rel="stylesheet" href="/ui.css"></head><body>${navHtml(surface)}${body}</body></html>`;
  };
}

const SURFACE_RENDERERS = {
  [SURFACES.REPLAY]: replayHtml,
  [SURFACES.BACKTESTS]: backtestsHtml,
  [SURFACES.RESEARCH]: researchHtml,
  [SURFACES.CAMPAIGNS]: campaignsHtml,
};

function campaignsHtml(vm) {
  const pendingReceipts = vm.pendingRunReceipts ?? [];
  return `
<section class="surface campaigns" data-surface="campaigns">
  <h2>${esc(SURFACE_TITLES[SURFACES.CAMPAIGNS])}</h2>
  <p class="surface-note">Campañas y runs canónicas del backend; los drilldowns son handoff de navegación a superficies que aplican sus propios fail-closed (§26.5).</p>
  ${vm.campaigns.length > 0 ? dataItemList(vm.campaigns) : emptyStateHtml("sin campañas canónicas expuestas por el backend en este scope; no se fabrican")}
  <section class="runs" data-kind="runs"><h3>Runs</h3>${vm.runs.length > 0 ? dataItemList(vm.runs) : emptyStateHtml("sin runs canónicas expuestas por el backend en este scope; no se fabrican")}</section>
  <section class="pending-receipts" data-kind="pending"><h3>Receipts</h3><ul class="data-list">${pendingReceipts.map(unavailableHtml).join("")}</ul></section>
</section>`;
}

export const renderReplayPage = renderPageStub(SURFACES.REPLAY, replayHtml);
export const renderBacktestsPage = renderPageStub(SURFACES.BACKTESTS, backtestsHtml);
export const renderResearchPage = renderPageStub(SURFACES.RESEARCH, researchHtml);
export const renderCampaignsPage = renderPageStub(SURFACES.CAMPAIGNS, SURFACE_RENDERERS[SURFACES.CAMPAIGNS]);

export const renderSurfacePage = (surface, vm) => {
  const renderer = SURFACE_RENDERERS[surface];
  if (renderer === undefined) {
    throw new TypeError(`"${surface}" no es una superficie de UI-01.`);
  }
  if (vm?.ok !== true) {
    return renderErrorState(surface, vm);
  }
  const body = renderer(vm);
  return `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8"><title>Energy Markets — ${esc(SURFACE_TITLES[surface])}</title><link rel="stylesheet" href="/ui.css"></head><body>${navHtml(surface)}${body}</body></html>`;
};

export function renderNavigationPage() {
  const links = SURFACES_LIST.map((id) => `<a href="#${esc(id)}" class="nav-card" data-nav="${esc(id)}" data-surface-link="${esc(id)}"><h3>${esc(SURFACE_TITLES[id])}</h3><p>Surface sobre el Operator Interface Boundary (IMP-29); sin datos no se inventan (§26.5)</p></a>`);
  return `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8"><title>Energy Markets — Operator Interface</title><link rel="stylesheet" href="/ui.css"></head><body><header class="ui-header"><h1>Energy Markets — Operator Interface</h1></header>${navHtml(null)}<main class="surface-index">${links.join("")}</main></body></html>`;
}
