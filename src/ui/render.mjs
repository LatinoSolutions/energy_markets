// UI-03 — render HTML de las cuatro superficies sobre el Operator Interface
// Boundary aceptado de IMP-29 (SPEC v1.1.1 §26.2–§26.5), con la dirección
// visual Claude Blind seleccionada por el owner (PLAN_STATUS UI-03 / DES-02).
//
// Este módulo no calcula nada: dibuja los view models ya validados y los
// estados explícitos. La gramática visual la aporta ./visual-language.mjs; los
// datos y su atado canónico siguen siendo los del boundary (view-models.mjs /
// binding.mjs). No se importa ningún dato demo del prototipo, ni sus supuestos
// inventados de B/H/V/ΔV, ventana de evaluación, intervalo o comité.
//
// Invariables de render (las que la UI-01 ya fijó, preservadas aquí):
//   - Decision-time (data-view-scope="decision") y Evaluation
//     (data-view-scope="evaluation") son mutuamente distintos, ahora con zonas
//     visuales separadas;
//   - recommendation / execution (SIMULATED|HYPOTHETICAL|REAL) /
//     intervention son objetos distintos con clases propias;
//   - los estados desconocidos BOUND vs UNAVAILABLE se rinden distintos y la
//     razón es legible, nunca sustituida por un valor;
//   - procedencia (recordKey, revisionId, valueSha256) y relojes visibles.

import { SURFACES, SURFACES_LIST } from "./view-models.mjs";
import {
  PROVENANCE_INTERACTION_SCRIPT,
  UI_STYLESHEET,
  VISUAL_LANGUAGE_ID,
  renderProvenanceDrawerHtml,
  renderSemanticsKeyHtml,
} from "./visual-language.mjs";

const SURFACE_TITLES = {
  [SURFACES.REPLAY]: "Replay / Decision Inspector",
  [SURFACES.BACKTESTS]: "Backtests / Economic Comparison",
  [SURFACES.RESEARCH]: "Research / Strategy Lab",
  [SURFACES.CAMPAIGNS]: "Campaigns & Runs",
};

const ZONE_TAG = {
  decision: '<span class="zt asof">T\u2080 \u00b7 decision-time</span>',
  evaluation: '<span class="zt hind">Later \u00b7 evaluation</span>',
  execution: '<span class="zt exec">Execution</span>',
};

// Condición value-less del boundary → chip epistémico. La etiqueta del chip es
// gramática visual; la condición canónica cruda se conserva en data-condition.
const EPISTEMIC_CHIP = {
  MISSING: ["unk", "?", "UNKNOWN"],
  UNAVAILABLE: ["unk", "?", "UNKNOWN"],
  NOT_ADMITTED: ["unk", "?", "UNKNOWN"],
  NOT_YET_CLOSED: ["open", "\u25cc", "NOT CLOSED"],
  PENDING_AUTHORITY: ["open", "\u25cc", "PENDING AUTHORITY"],
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

function renderHeader(active) {
  return `<header class="em-top" role="banner">
  <div class="em-brand"><span class="em-name">Energy Markets</span><span class="em-sub">PROCUREMENT RESEARCH</span></div>
  ${navHtml(active)}
  <div class="em-tools">
    <button type="button" class="btn" data-key-toggle aria-expanded="false" aria-controls="semantics-key">Semantics key</button>
    <div class="clock">Operator Interface<br><span class="muted">s\u00f3lo datos can\u00f3nicos \u00b7 fail-closed</span></div>
  </div>
</header>
<div class="ctx" data-context-strip>Operator Interface Boundary (IMP-29) \u00b7 lo desconocido permanece UNAVAILABLE/ERROR, nunca como valor</div>`;
}

function renderDocument({ active = null, title, body }) {
  return `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(title)}</title><style data-ui-visual-language="${esc(VISUAL_LANGUAGE_ID)}">${UI_STYLESHEET}</style></head><body class="em-app" data-visual-language="${esc(VISUAL_LANGUAGE_ID)}">${renderHeader(active)}<main id="main" class="em-main">${body}</main>${renderSemanticsKeyHtml()}${renderProvenanceDrawerHtml()}${PROVENANCE_INTERACTION_SCRIPT}</body></html>`;
}

// Procedencia inspeccionable: subrayado punteado + un clic abre el drawer con
// registro, revisión y sha. Nunca sustituye al valor ni lo vuelve autoritativo.
function provenanceHtml(provenance, label = "") {
  if (provenance === undefined || provenance === null) {
    return "";
  }
  return `<button type="button" class="pv provenance" data-record-key="${esc(provenance.recordKey)}" data-revision-id="${esc(provenance.revisionId)}" data-value-sha="${esc(provenance.valueSha256 ?? "")}" data-prov-label="${esc(label)}" aria-label="Procedencia de ${esc(label)}">${esc(provenance.recordKey)}@${esc(provenance.revisionId)} \u00b7 sha ${esc((provenance.valueSha256 ?? "").slice(0, 12))}</button>`;
}

function unavailableHtml(item) {
  return `<li class="data-item data-unavailable" data-status="UNAVAILABLE"><span class="unkv">UNKNOWN</span> <span class="item-label">${esc(item.label ?? "")}</span> <span class="condition condition-unavailable">UNAVAILABLE</span> <span class="reason">${esc(item.reason ?? "")}</span></li>`;
}

function boundHtml(item) {
  const value = typeof item.value === "object" ? JSON.stringify(item.value) : String(item.value);
  const valueLabel = typeof item.value === "object" ? (item.measure ?? item.kind ?? "valor") : (item.measure ?? item.label);
  return `<li class="data-item data-bound" data-status="BOUND">${item.measure !== undefined && item.measure !== null ? `<span class="measure" data-measure="${esc(item.measure)}">${esc(item.measure)}</span> ` : ""}${item.arm !== undefined && item.arm !== null ? `<span class="arm" data-arm="${esc(item.arm)}">${esc(item.arm)}</span> ` : ""}<span class="st run">canonical</span> <span class="item-label">${esc(item.label)}</span> <span class="value" data-value="${esc(value)}">${esc(value)}</span> ${provenanceHtml(item.provenance, valueLabel)}${drilldownHtml(item.drilldowns)}</li>`;
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
  const label = esc(field.specLabel);
  if (field.condition === "AVAILABLE") {
    const value = typeof field.value === "object" ? JSON.stringify(field.value) : String(field.value);
    return `<li class="exposure-field exposure-known" data-condition="${esc(field.condition)}"><span class="item-label">${label}</span> <span class="value" data-value="${esc(value)}">${esc(value)}</span> <span class="st run">known at T\u2080</span> ${provenanceHtml(field.provenance, field.specLabel)}</li>`;
  }
  if (field.condition === "PROXY" || field.condition === "UNCERTAIN" || field.condition === "STALE") {
    // UI01-08 (review de cambio 2026-09-23): una condición value-less con
    // procedencia declara la ausencia del valor; "undefined" no es un dato.
    const hasValue = field.value !== undefined && field.value !== null;
    const value = typeof field.value === "object" ? JSON.stringify(field.value) : String(field.value);
    return `<li class="exposure-field exposure-flagged" data-condition="${esc(field.condition)}"><span class="item-label">${label}</span> <span class="st warn"><span class="g">!</span>${esc(field.condition)}</span>${hasValue ? ` <span class="value" data-value="${esc(value)}">${esc(value)}</span>` : ""} <span class="reason">${esc(field.reason)}</span> ${provenanceHtml(field.provenance, field.specLabel)}</li>`;
  }
  const chip = EPISTEMIC_CHIP[field.condition] ?? ["unk", "?", "UNKNOWN"];
  return `<li class="exposure-field exposure-unknown" data-condition="${esc(field.condition)}"><span class="item-label">${label}</span> <span class="st ${chip[0]}"><span class="g">${chip[1]}</span>${chip[2]}</span> <span class="condition condition-unknown">${esc(field.condition)}</span> <span class="reason">${esc(field.reason)}</span></li>`;
}

function timelinePointHtml(point) {
  const value = typeof point.value === "object" ? JSON.stringify(point.value) : String(point.value ?? "");
  return `<li class="ts-point lane-${esc(point.lane)}" data-key="${esc(point.key)}" data-clock="${esc(point.clock ?? "")}" data-clock-kind="${esc(point.clockKind ?? "")}" data-revision="${esc(point.revisionId ?? "")}"><button type="button" class="pv point-key" data-record-key="${esc(point.key)}" data-revision-id="${esc(point.revisionId ?? "")}" data-clock="${esc(point.clock ?? "")}" data-clock-kind="${esc(point.clockKind ?? "")}" data-prov-label="${esc(point.key)}">${esc(point.key)}</button> <span class="value" data-value="${esc(value)}">${esc(value)}</span> <span class="clock" title="${esc(point.clockKind ?? "")}">${esc(point.clock ?? "")}</span></li>`;
}

function laneSectionHtml(title, scope, points, emptyMessage) {
  const tag = ZONE_TAG[scope] ?? "";
  if (points.length === 0) {
    return `<section class="lane lane-scope-${esc(scope)} zone-${esc(scope)}" data-view-scope="${esc(scope)}" data-zone="${esc(scope)}"><h3>${tag}${esc(title)}</h3>${emptyStateHtml(emptyMessage)}</section>`;
  }
  return `<section class="lane lane-scope-${esc(scope)} zone-${esc(scope)}" data-view-scope="${esc(scope)}" data-zone="${esc(scope)}"><h3>${tag}${esc(title)}</h3><ul class="data-list ts-points">${points.map(timelinePointHtml).join("")}</ul></section>`;
}

function eventClassHtml(event) {
  const cls = event.lane === "intervention" ? "HUMAN_INTERVENTION" : event.class;
  const realAttrs = event.isReal === true
    ? ` data-real="true" data-authority="${esc(event.authorization?.authorityRef ?? "")}" data-receipt-ref="${esc(event.authorization?.receipt?.receiptRef ?? "")}" data-receipt-sha="${esc(event.authorization?.receipt?.receiptSha256 ?? "")}"`
    : "";
  const hypAttr = event.isHypothetical === true ? ' data-hypothetical="true"' : "";
  const attribution = event.lane === "intervention" ? ` <span class="attribution" data-attribution="${esc(event.attribution ?? "")}">atribuci\u00f3n: ${esc(event.attribution ?? "")}</span>` : "";
  return `<li class="event event-class-${esc(cls)}" data-event-id="${esc(event.eventId)}" data-event-class="${esc(cls)}" data-recommendation-ref="${esc(event.relatedRecommendationRef ?? "")}"${hypAttr}${realAttrs}><span class="event-id">${esc(event.eventId)}</span> <span class="event-class">${esc(cls)}</span> <span class="event-clock">${esc(event.clock)}</span> <span class="event-ref">${esc(event.relatedRecommendationRef ?? "")}</span>${attribution}</li>`;
}

function replayHtml(vm) {
  const decision = laneSectionHtml("Decision-time (sem\u00e1ntica de decisi\u00f3n)", "decision", vm.decision.points, "sin puntos de decisi\u00f3n en este boundary");
  const evaluation = laneSectionHtml("Evaluation (sem\u00e1ntica de evaluaci\u00f3n posterior)", "evaluation", vm.evaluation.points, "sin puntos de evaluaci\u00f3n en este boundary");
  const executionEvents = vm.executions.length > 0
    ? `<ul class="data-list events-list">${vm.executions.map(eventClassHtml).join("")}</ul>`
    : emptyStateHtml("sin actuaciones de ejecuci\u00f3n en este boundary");
  const interventionEvents = vm.interventions.length > 0
    ? `<ul class="data-list events-list">${vm.interventions.map(eventClassHtml).join("")}</ul>`
    : emptyStateHtml("sin intervenci\u00f3n humana en este boundary");
  return `
<section class="surface replay" data-surface="replay">
  <h2>${esc(SURFACE_TITLES[SURFACES.REPLAY])}</h2>
  <p class="mode-line">modo de trabajo: <span class="working-mode" data-working-mode="${esc(vm.workingMode)}">${esc(vm.workingMode)}</span></p>
  ${decision}
  ${evaluation}
  <section class="events execution-events" data-view-scope="execution" data-zone="execution" data-events-kind="execution"><h3>${ZONE_TAG.execution}Ejecuci\u00f3n</h3>${executionEvents}</section>
  <section class="events intervention-events" data-view-scope="intervention" data-zone="intervention" data-events-kind="intervention"><h3>Intervenci\u00f3n humana</h3>${interventionEvents}</section>
  <section class="exposure-table zone-decision" data-kind="exposure" data-zone="exposure"><h3>Exposici\u00f3n \u00a726.2</h3><ul class="data-list exposure-list">${vm.exposure.fields.map(exposureFieldHtml).join("")}</ul></section>
</section>`;
}

function backtestsHtml(vm) {
  const pending = vm.pendingComparisons ?? [];
  return `
<section class="surface backtests" data-surface="backtests">
  <h2>${esc(SURFACE_TITLES[SURFACES.BACKTESTS])}</h2>
  <p class="surface-note">Medidas comparadas sobre datos canónicos; sin productor canónico no se fabrica una comparación.</p>
  ${dataItemList(vm.rows)}
  <section class="pending-comparisons" data-kind="pending"><h3>Comparaciones pendientes de productores can\u00f3nicos</h3><ul class="data-list">${pending.map(unavailableHtml).join("")}</ul></section>
</section>`;
}

function researchHtml(vm) {
  const items = vm.strategies.map((strategy) => (strategy.status === "BOUND"
    ? `<li class="data-item data-bound" data-status="BOUND" data-strategy="${esc(strategy.strategyId)}"><span class="st run">canonical</span> <span class="item-label">${esc(strategy.strategyId)}</span> <span class="value" data-value="${esc(JSON.stringify(strategy.readiness))}">${esc(JSON.stringify(strategy.readiness))}</span> ${provenanceHtml(strategy.provenance, strategy.strategyId)}</li>`
    : `<li class="data-item data-unavailable" data-status="UNAVAILABLE" data-strategy="${esc(strategy.strategyId)}"><span class="unkv">UNKNOWN</span> <span class="item-label">${esc(strategy.strategyId)}</span> <span class="condition condition-unavailable">UNAVAILABLE</span> <span class="reason">${esc(strategy.reason)}</span></li>`));
  const pending = vm.pendingSections ?? [];
  return `
<section class="surface research" data-surface="research">
  <h2>${esc(SURFACE_TITLES[SURFACES.RESEARCH])}</h2>
  <ul class="data-list strategies">${items.join("")}</ul>
  ${vm.unexpectedStrategyIds.length > 0 ? `<p class="surface-note">fuera de la pila esperada: ${esc(vm.unexpectedStrategyIds.join(", "))}</p>` : ""}
  <div class="note-ev"><span class="ev">EVIDENCE</span> La evidencia informa; no autoriza. La autoridad de adopci\u00f3n no la expone este boundary.</div>
  <section class="pending-sections" data-kind="pending"><h3>Secciones pendientes de productores can\u00f3nicos</h3><ul class="data-list">${pending.map(unavailableHtml).join("")}</ul></section>
</section>`;
}

function renderErrorState(surface, vm) {
  const errors = vm?.errors ?? [];
  const body = `<div class="surface state-error" data-state="ERROR"><p>La superficie no puede renderizarse con datos no validados (fail-closed, \u00a726.5).</p><ul class="error-list">${errors.map((error) => `<li data-code="${esc(error.code)}"><span class="error-code">${esc(error.code)}</span> ${esc(error.message)}</li>`).join("")}</ul></div>`;
  return renderDocument({ active: surface, title: "Energy Markets \u2014 error", body });
}

function renderPageStub(surface, bodyFromVm) {
  return (vm) => {
    if (vm?.ok !== true) {
      return renderErrorState(surface, vm);
    }
    const body = bodyFromVm(vm);
    return renderDocument({ active: surface, title: `Energy Markets \u2014 ${SURFACE_TITLES[surface]}`, body });
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
  <p class="surface-note">Campa\u00f1as y runs can\u00f3nicas del backend; los drilldowns son handoff de navegaci\u00f3n a superficies que aplican sus propios fail-closed (\u00a726.5).</p>
  ${vm.campaigns.length > 0 ? dataItemList(vm.campaigns) : emptyStateHtml("sin campa\u00f1as can\u00f3nicas expuestas por el backend en este scope; no se fabrican")}
  <section class="runs" data-kind="runs"><h3>Runs</h3>${vm.runs.length > 0 ? dataItemList(vm.runs) : emptyStateHtml("sin runs can\u00f3nicas expuestas por el backend en este scope; no se fabrican")}</section>
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
  return renderDocument({ active: surface, title: `Energy Markets \u2014 ${SURFACE_TITLES[surface]}`, body });
};

export function renderNavigationPage() {
  const links = SURFACES_LIST.map((id) => `<a href="#${esc(id)}" class="nav-card" data-nav="${esc(id)}" data-surface-link="${esc(id)}"><h3>${esc(SURFACE_TITLES[id])}</h3><p>Surface sobre el Operator Interface Boundary (IMP-29); sin datos no se inventan (\u00a726.5)</p></a>`);
  const body = `<h1 class="page-title">Energy Markets \u2014 Operator Interface</h1><p class="lede">Cuatro superficies sobre el Operator Interface Boundary (IMP-29). S\u00f3lo se dibuja lo que el backend expone; lo desconocido queda UNAVAILABLE/ERROR fail-closed.</p><div class="surface-index">${links.join("")}</div>`;
  return renderDocument({ active: null, title: "Energy Markets \u2014 Operator Interface", body });
}
