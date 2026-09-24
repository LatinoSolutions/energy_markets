// UI-03 / UI-FIDELITY — render HTML de las cuatro superficies sobre el
// Operator Interface Boundary aceptado de IMP-29 (SPEC v1.1.1 §26.2–§26.5).
//
// Contrato visual: la composición del mockup Claude Blind seleccionado por el
// owner (commit c35510b, design-proposal/index.html; corrección de fidelidad
// 1:1 a 1440 px pedida por Bru el 24-sep-2026). Cada superficie reproduce las
// mismas ranuras (rail, cabecera, cadena de cuatro objetos, zonas temporales,
// tablas, gráficos, cajas de método/autoridad). Donde el boundary no expone el
// dato, la ranura se conserva y dibuja su estado explícito (UNKNOWN /
// UNAVAILABLE / NOT CLOSED / NO ESTIMATE / WITHHELD), nunca un valor.
//
// Este módulo no calcula nada económico: dibuja los view models ya validados.
// La única aritmética es de maquetación (posición x de un reloj canónico en un
// eje). No se importa ningún dato demo del prototipo ni sus supuestos
// inventados.
//
// Invariables que fijaron UI-01/UI-03 y se preservan aquí:
//   - Decision-time (data-view-scope="decision") y Evaluation
//     (data-view-scope="evaluation") en zonas distintas;
//   - recommendation / requested action / execution (SIMULATED|HYPOTHETICAL|
//     REAL) / outcome / intervención humana son objetos distintos;
//   - BOUND vs UNAVAILABLE distintos, con la razón legible;
//   - procedencia (recordKey, revisionId, valueSha256) y relojes visibles.

import { SURFACES } from "./view-models.mjs";
import { EXPOSURE_FIELDS } from "../operator-interface/exposure.mjs";
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

// Orden, atajo y subtítulo de las pestañas del mockup (1 Campaigns … 4 Research).
const NAV_TABS = [
  [SURFACES.CAMPAIGNS, "1 · navigate", "Campaigns &amp; Runs"],
  [SURFACES.REPLAY, "2 · decision inspector", "Replay"],
  [SURFACES.BACKTESTS, "3 · economic comparison", "Backtests"],
  [SURFACES.RESEARCH, "4 · strategy lab", "Research"],
];

// Condición value-less del boundary → chip epistémico. La etiqueta del chip es
// gramática visual; la condición canónica cruda se conserva en data-condition.
const EPISTEMIC_CHIP = {
  MISSING: ["unk", "?", "UNKNOWN"],
  UNAVAILABLE: ["unk", "?", "UNKNOWN"],
  NOT_ADMITTED: ["unk", "?", "UNKNOWN"],
  NOT_YET_CLOSED: ["open", "◌", "NOT CLOSED"],
  PENDING_AUTHORITY: ["open", "◌", "PENDING AUTHORITY"],
};

const ARM_SWATCH = { A0: "var(--arm-base)", A1: "var(--arm-a)" };

function esc(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function chip(kind, glyph, label) {
  return `<span class="st ${kind}"><span class="g">${glyph}</span>${label}</span>`;
}

function unknownValue(label = "UNKNOWN") {
  return `<span class="unkv">${esc(label)}</span>`;
}

function valueText(value) {
  return typeof value === "object" && value !== null ? JSON.stringify(value) : String(value);
}

// Un valor canónico tal cual; un objeto se lee por claves (sin reinterpretar).
function valueHtml(value) {
  if (value === null || typeof value !== "object") {
    return esc(String(value));
  }
  return Object.entries(value)
    .map(([key, entry]) => `<span class="kvline"><span class="k">${esc(key)}</span>${esc(valueText(entry))}</span>`)
    .join(" · ");
}

// ---------- shell (banner, cabecera, franja de contexto) ----------

function navHtml(active) {
  const links = NAV_TABS.map(([id, key, title]) => `<a href="#${esc(id)}" class="nav-link${id === active ? " on nav-active" : ""}" data-nav="${esc(id)}"><span class="k">${key}</span><span class="t">${title}</span></a>`);
  return `<nav class="ws ui-nav" aria-label="Energy Markets">${links.join("")}</nav>`;
}

function clockHtml(clock) {
  if (clock?.asOf) {
    return `<div class="clock">${esc(clock.asOfLabel)} <b>${esc(clock.asOf)}</b><br><span class="muted">${esc(clock.sub)}</span></div>`;
  }
  return `<div class="clock">data as-of ${unknownValue("UNAVAILABLE")}<br><span class="muted">no backend clock exposed here</span></div>`;
}

function renderShellTop(active, clock) {
  return `<div class="regime">OPERATOR INTERFACE · read-only · only canonical backend data is drawn · unknown stays <b>UNAVAILABLE</b> / <b>NOT CLOSED</b>, never a value · no real execution from this UI</div>
<header class="top em-top" role="banner">
  <div class="brand"><div class="name">Energy Markets</div><div class="sub">PROCUREMENT RESEARCH</div></div>
  ${navHtml(active)}
  <div class="tools">
    <button type="button" class="btn" data-key-toggle aria-expanded="false" aria-controls="semantics-key" title="Visual grammar (?)">Semantics key</button>
    ${clockHtml(clock)}
  </div>
</header>`;
}

function contextHtml(parts) {
  return `<div class="ctx" data-context-strip><span class="caps muted">Context</span> ${parts.join(' <span class="sep">›</span> ')}<span class="grow"></span><span class="muted small">Operator Interface Boundary · IMP-29 · §26.5</span></div>`;
}

function renderDocument({ active = null, title, body, clock = null, context = [] }) {
  const contextParts = context.length > 0 ? context : ['<span class="muted">no canonical context exposed</span>'];
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(title)}</title><style data-ui-visual-language="${esc(VISUAL_LANGUAGE_ID)}">${UI_STYLESHEET}</style></head><body class="em-app" data-visual-language="${esc(VISUAL_LANGUAGE_ID)}">
${renderShellTop(active, clock)}
${contextHtml(contextParts)}
<main id="main" class="em-main">${body}<div class="foot">Energy Markets · Operator Interface · read-only view of the backend boundary. Every dotted value opens its provenance. Keys: 1–4 workspaces · ? semantics key · Esc close.</div></main>
${renderSemanticsKeyHtml()}
${renderProvenanceDrawerHtml()}
${PROVENANCE_INTERACTION_SCRIPT}
</body></html>`;
}

// ---------- piezas compartidas ----------

// Procedencia inspeccionable: subrayado punteado + un clic abre el drawer con
// registro, revisión y sha. Nunca sustituye al valor ni lo vuelve autoritativo.
function provenanceHtml(provenance, label = "", value = undefined) {
  if (provenance === undefined || provenance === null) {
    return "";
  }
  const valueAttr = value === undefined ? "" : ` data-prov-value="${esc(valueText(value))}"`;
  return `<button type="button" class="pv provenance" data-record-key="${esc(provenance.recordKey)}" data-revision-id="${esc(provenance.revisionId)}" data-value-sha="${esc(provenance.valueSha256 ?? "")}" data-prov-label="${esc(label)}"${valueAttr} aria-label="Provenance of ${esc(label)}">${esc(provenance.recordKey)}@${esc(provenance.revisionId)} · sha ${esc((provenance.valueSha256 ?? "").slice(0, 12))}</button>`;
}

// Handoff de navegación declarado en el view model: sólo apunta a superficies
// del boundary que aplican sus propios fail-closed; nunca copia datos.
function drilldownHtml(drilldowns) {
  if (!Array.isArray(drilldowns) || drilldowns.length === 0) {
    return "";
  }
  return `<span class="drill drilldowns">${drilldowns.map((drilldown) => `<a class="drilldown" data-drilldown="${esc(drilldown.href.slice(1))}" href="${esc(drilldown.href)}">${esc(drilldown.href.slice(1).replace(/^./, (c) => c.toUpperCase()))}</a>`).join("")}</span>`;
}

function unavailableReasonHtml(item) {
  return `<span class="item-label">${esc(item.label ?? "")}</span> <span class="condition condition-unavailable">UNAVAILABLE</span> <span class="reason">${esc(item.reason ?? "")}</span>`;
}

function findPending(list, prefix) {
  return (list ?? []).find((item) => typeof item?.label === "string" && item.label.startsWith(prefix)) ?? null;
}

function pendingOr(item, fallbackLabel, fallbackReason) {
  return item ?? { status: "UNAVAILABLE", label: fallbackLabel, reason: fallbackReason };
}

// Marco de gráfico sin serie canónica: mismos ejes/medidas del mockup, la
// ausencia se dibuja como banda rayada NO ESTIMATE con su razón.
function noEstimateFrameSvg({ width, height, label, reason }) {
  const left = 44;
  const right = 18;
  const top = 14;
  const bottom = 26;
  const plotW = width - left - right;
  const plotH = height - top - bottom;
  let svg = `<svg viewBox="0 0 ${width} ${height}" width="100%" role="img" aria-label="${esc(label)}: no estimate">`;
  svg += `<defs><pattern id="hatchU-${width}-${height}" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="6" height="6" fill="#f3ecf5"/><rect width="1" height="6" fill="#d4c0dc"/></pattern></defs>`;
  svg += '<g class="axis">';
  for (let step = 0; step <= 4; step += 1) {
    const y = top + (plotH / 4) * step;
    svg += `<line x1="${left}" x2="${width - right}" y1="${y}" y2="${y}" stroke-dasharray="2 3"/>`;
  }
  svg += `<line x1="${left}" x2="${left}" y1="${top}" y2="${top + plotH}"/></g>`;
  svg += `<rect x="${left}" y="${top}" width="${plotW}" height="${plotH}" fill="url(#hatchU-${width}-${height})" rx="2"/>`;
  svg += `<text x="${left + plotW / 2}" y="${top + plotH / 2 - 4}" text-anchor="middle" font-size="12" fill="var(--unk)" font-weight="700">NO ESTIMATE</text>`;
  svg += `<text x="${left + plotW / 2}" y="${top + plotH / 2 + 13}" text-anchor="middle" font-size="10.5" fill="var(--unk)">not produced by a canonical producer · not zero</text>`;
  svg += "</svg>";
  return `${svg}<div class="small muted" style="margin-top:4px" data-status="UNAVAILABLE">${esc(reason)}</div>`;
}

// ---------- Replay / Decision Inspector ----------

function exposureFieldHtml(field) {
  const label = esc(field.specLabel);
  if (field.condition === "AVAILABLE") {
    const value = valueText(field.value);
    return `<li class="exposure-field exposure-known" data-condition="${esc(field.condition)}"><span class="item-label">${label}</span> <span class="value" data-value="${esc(value)}">${valueHtml(field.value)}</span> ${chip("pass", "✓", "Known at T₀")} ${provenanceHtml(field.provenance, field.specLabel, field.value)}</li>`;
  }
  if (field.condition === "PROXY" || field.condition === "UNCERTAIN" || field.condition === "STALE") {
    // UI01-08: una condición value-less con procedencia declara la ausencia
    // del valor; "undefined" no es un dato.
    const hasValue = field.value !== undefined && field.value !== null;
    const value = hasValue ? valueText(field.value) : "";
    return `<li class="exposure-field exposure-flagged" data-condition="${esc(field.condition)}"><span class="item-label">${label}</span> ${chip("warn", "!", esc(field.condition))} <span class="reason">${hasValue ? `<span class="value" data-value="${esc(value)}">${valueHtml(field.value)}</span> ` : ""}${esc(field.reason)}</span> ${provenanceHtml(field.provenance, field.specLabel)}</li>`;
  }
  const [kind, glyph, text] = EPISTEMIC_CHIP[field.condition] ?? ["unk", "?", "UNKNOWN"];
  return `<li class="exposure-field exposure-unknown" data-condition="${esc(field.condition)}"><span class="item-label">${label}</span> <span class="st ${kind}"><span class="g">${glyph}</span>${text}</span> <span class="condition condition-unknown">${esc(field.condition)}</span> <span class="reason">${esc(field.reason)}</span></li>`;
}

// Ranura de la tabla de inputs cuando el Replay no pudo validarse: las 13
// secciones canónicas de §26.2, todas sin valor.
function exposureSlotHtml(definition, reason) {
  return `<li class="exposure-slot" data-slot="${esc(definition.key)}"><span class="item-label">${esc(definition.specLabel)}</span> ${chip("unk", "?", "UNKNOWN")} <span class="condition">NOT VALIDATED</span> <span class="reason">${esc(reason)}</span></li>`;
}

function timelinePointHtml(point) {
  const value = point.value === undefined ? "" : valueText(point.value);
  return `<li class="ts-point lane-${esc(point.lane)}" data-key="${esc(point.key)}" data-clock="${esc(point.clock ?? "")}" data-clock-kind="${esc(point.clockKind ?? "")}" data-revision="${esc(point.revisionId ?? "")}"><button type="button" class="pv point-key" data-record-key="${esc(point.key)}" data-revision-id="${esc(point.revisionId ?? "")}" data-clock="${esc(point.clock ?? "")}" data-clock-kind="${esc(point.clockKind ?? "")}" data-prov-label="${esc(point.key)}" data-prov-value="${esc(value)}">${esc(point.key)}</button> <span class="value" data-value="${esc(value)}">${point.value === undefined ? "" : valueHtml(point.value)}</span> <span class="clock" title="${esc(point.clockKind ?? "")}">${esc(point.clock ?? "")}</span></li>`;
}

function eventClassHtml(event) {
  const cls = event.lane === "intervention" ? "HUMAN_INTERVENTION" : event.class;
  const realAttrs = event.isReal === true
    ? ` data-real="true" data-authority="${esc(event.authorization?.authorityRef ?? "")}" data-receipt-ref="${esc(event.authorization?.receipt?.receiptRef ?? "")}" data-receipt-sha="${esc(event.authorization?.receipt?.receiptSha256 ?? "")}"`
    : "";
  const hypAttr = event.isHypothetical === true ? ' data-hypothetical="true"' : "";
  const attribution = event.lane === "intervention" ? ` <span class="attribution" data-attribution="${esc(event.attribution ?? "")}">attribution: ${esc(event.attribution ?? "")}</span>` : "";
  return `<li class="event event-class-${esc(cls)}" data-event-id="${esc(event.eventId)}" data-event-class="${esc(cls)}" data-recommendation-ref="${esc(event.relatedRecommendationRef ?? "")}"${hypAttr}${realAttrs}><span class="event-class">${esc(cls)}</span> <span class="event-id">${esc(event.eventId)}</span> <span class="event-clock">${esc(event.clock)}</span> <span class="event-ref">← ${esc(event.relatedRecommendationRef ?? "")}</span>${attribution}</li>`;
}

function objCard(zone, glyph, type, time, body, { none = false, extraClass = "" } = {}) {
  const glyphStyle = zone === "hind" ? ' style="background:var(--hind)"' : zone === "asof" ? ' style="background:var(--asof)"' : "";
  return `<div class="obj z-${zone}${none ? " none" : ""}${extraClass ? ` ${extraClass}` : ""}">
    <div class="ohd"><span class="glyph"${glyphStyle}>${glyph}</span><span class="otype">${type}</span><span class="grow"></span><span class="mono tiny muted">${time}</span></div>
    <div class="obd">${body}</div></div>`;
}

function toMs(clock) {
  const ms = Date.parse(clock ?? "");
  return Number.isNaN(ms) ? null : ms;
}

// Eje de la franja de timeline: sólo posiciones de relojes canónicos.
function timelineSvg(vm) {
  const width = 1200;
  const height = 74;
  const left = 20;
  const right = 20;
  const t0 = toMs(vm.decision.boundary);
  const asOf = toMs(vm.evaluation.asOf);
  const marks = [
    ...vm.decision.points.map((point) => ({ kind: "decision", clock: point.clock, label: point.key })),
    ...vm.evaluation.points.map((point) => ({ kind: "evaluation", clock: point.clock, label: point.key })),
    ...vm.executions.map((event) => ({ kind: "execution", clock: event.clock, label: `${event.eventId} · ${event.class}` })),
    ...vm.interventions.map((event) => ({ kind: "intervention", clock: event.clock, label: `${event.eventId} · HUMAN_INTERVENTION` })),
  ].filter((mark) => toMs(mark.clock) !== null);
  const times = [t0, asOf, ...marks.map((mark) => toMs(mark.clock))].filter((ms) => ms !== null);
  let svg = `<svg viewBox="0 0 ${width} ${height}" width="100%" height="${height}" preserveAspectRatio="none" role="img" aria-label="Operator timeline">`;
  svg += '<defs><pattern id="tlHatchU" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="6" height="6" fill="#f3ecf5"/><rect width="1" height="6" fill="#d4c0dc"/></pattern><pattern id="tlHatchH" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(135)"><rect width="7" height="7" fill="#f6ecdc"/><rect width="1" height="7" fill="#e3c9a0"/></pattern></defs>';
  svg += `<line x1="${left}" x2="${width - right}" y1="34" y2="34" stroke="var(--rule)"/>`;
  if (times.length === 0) {
    svg += `<rect x="${left}" y="10" width="${width - left - right}" height="48" fill="url(#tlHatchU)"/>`;
    svg += `<text x="${width / 2}" y="38" text-anchor="middle" font-size="11" fill="var(--unk)" font-weight="700">TIMELINE UNAVAILABLE · nothing is drawn</text>`;
    return `${svg}</svg>`;
  }
  const minMs = Math.min(...times);
  const maxMs = Math.max(...times);
  const pad = Math.max((maxMs - minMs) * 0.06, 86_400_000);
  const from = minMs - pad;
  const to = maxMs + pad;
  const x = (ms) => left + ((ms - from) / (to - from)) * (width - left - right);
  if (t0 !== null && asOf !== null && asOf > t0) {
    svg += `<rect x="${x(t0)}" y="42" width="${x(asOf) - x(t0)}" height="8" fill="url(#tlHatchH)" stroke="var(--hind)" stroke-width="1"/>`;
    svg += `<text x="${x(t0) + 4}" y="61" font-size="10" fill="var(--hind)" font-weight="600">T₀ → evaluation as-of ${esc(vm.evaluation.asOf)}</text>`;
  }
  if (asOf !== null) {
    svg += `<rect x="${x(asOf)}" y="8" width="${width - right - x(asOf)}" height="52" fill="url(#tlHatchU)" opacity=".7"/>`;
    svg += `<line x1="${x(asOf)}" x2="${x(asOf)}" y1="4" y2="64" stroke="var(--ink)" stroke-width="1.5"/>`;
    const nearRightEdge = x(asOf) > width - right - 150;
    const labelX = nearRightEdge ? x(asOf) - 5 : x(asOf) + 5;
    const anchor = nearRightEdge ? "end" : "start";
    svg += `<text x="${labelX}" y="14" text-anchor="${anchor}" font-size="10.5" fill="var(--ink)" font-weight="600">evaluation as-of</text>`;
    svg += `<text x="${labelX}" y="26" text-anchor="${anchor}" font-size="10" fill="var(--ink-3)">beyond · nothing known</text>`;
  }
  if (t0 !== null) {
    svg += `<line x1="${x(t0)}" x2="${x(t0)}" y1="4" y2="64" stroke="var(--asof)" stroke-width="2"/>`;
    svg += `<text x="${x(t0) - 5}" y="14" text-anchor="end" font-size="10.5" fill="var(--asof)" font-weight="700">T₀</text>`;
  }
  const shapes = {
    decision: (cx) => `<rect x="${cx - 3.5}" y="27" width="7" height="7" rx="1" fill="var(--asof)" stroke="var(--asof)"/>`,
    evaluation: (cx) => `<circle cx="${cx}" cy="31" r="4" fill="var(--hind)"/>`,
    execution: (cx) => `<path d="M${cx - 4.5} 36 L${cx} 27 L${cx + 4.5} 36z" fill="var(--exec)"/>`,
    intervention: (cx) => `<rect x="${cx - 4}" y="27" width="8" height="8" transform="rotate(45 ${cx} 31)" fill="var(--unk)"/>`,
  };
  for (const mark of marks) {
    const cx = x(toMs(mark.clock));
    svg += `<g data-tip="${esc(mark.label)} · ${esc(mark.clock)}"><rect x="${cx - 6}" y="20" width="12" height="28" fill="transparent"/>${shapes[mark.kind](cx)}</g>`;
  }
  svg += `<text x="${left}" y="72" font-size="10" fill="var(--ink-3)">${esc(new Date(from).toISOString().slice(0, 10))}</text>`;
  svg += `<text x="${width - right}" y="72" font-size="10" fill="var(--ink-3)" text-anchor="end">${esc(new Date(to).toISOString().slice(0, 10))}</text>`;
  return `${svg}</svg>`;
}

// Marco del gráfico "known at T₀" del mockup. El boundary no expone una serie
// de precios: la mitad izquierda lo declara (sin línea inventada) y marca los
// puntos de decisión en su reloj; la derecha queda sellada y el overlay de
// hindsight sólo muestra puntos de evaluación posteriores a T₀.
function decisionChartSvg(vm) {
  const width = 760;
  const height = 250;
  const left = 44;
  const right = 26;
  const top = 16;
  const bottom = 26;
  const t0 = toMs(vm.decision.boundary);
  const decisionMarks = vm.decision.points.map((point) => ({ point, ms: toMs(point.clock) })).filter((mark) => mark.ms !== null);
  const laterMarks = vm.evaluation.points.map((point) => ({ point, ms: toMs(point.clock) })).filter((mark) => mark.ms !== null && t0 !== null && mark.ms > t0);
  const spans = [...decisionMarks, ...laterMarks].map((mark) => Math.abs(mark.ms - (t0 ?? mark.ms)));
  const span = Math.max(86_400_000, ...spans) * 1.1;
  const x0 = left + (width - left - right) / 2;
  const x = (ms) => (t0 === null ? x0 : x0 + ((ms - t0) / span) * ((width - left - right) / 2));
  const plotBottom = height - bottom;
  const days = Math.round(span / 86_400_000);
  let svg = `<svg viewBox="0 0 ${width} ${height}" width="100%" role="img" aria-label="Decision-time chart frame">`;
  svg += '<defs><pattern id="chHatchU" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="6" height="6" fill="#f3ecf5"/><rect width="1" height="6" fill="#d4c0dc"/></pattern><pattern id="chHatchH" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(135)"><rect width="7" height="7" fill="#f6ecdc"/><rect width="1" height="7" fill="#e3c9a0"/></pattern></defs>';
  svg += `<rect class="sealed-layer" x="${x0}" y="${top}" width="${width - right - x0}" height="${plotBottom - top}" fill="var(--surface-2)"/>`;
  svg += `<rect class="hind-layer" x="${x0}" y="${top}" width="${width - right - x0}" height="${plotBottom - top}" fill="url(#chHatchH)"/>`;
  svg += '<g class="axis">';
  for (let step = 0; step <= 4; step += 1) {
    const y = top + ((plotBottom - top) / 4) * step;
    svg += `<line x1="${left}" x2="${width - right}" y1="${y}" y2="${y}" stroke-dasharray="2 3"/>`;
  }
  svg += `<text x="${left}" y="${height - 8}" text-anchor="middle">−${days}d</text><text x="${x0}" y="${height - 8}" text-anchor="middle">T₀</text><text x="${width - right}" y="${height - 8}" text-anchor="middle">+${days}d</text>`;
  svg += "</g>";
  svg += `<rect x="${left}" y="${top + 34}" width="${x0 - left - 8}" height="${plotBottom - top - 78}" fill="url(#chHatchU)" rx="2"/>`;
  svg += `<text x="${(left + x0) / 2}" y="${top + 34 + (plotBottom - top - 78) / 2 - 4}" text-anchor="middle" font-size="11.5" fill="var(--unk)" font-weight="700">NO CANONICAL SERIES</text>`;
  svg += `<text x="${(left + x0) / 2}" y="${top + 34 + (plotBottom - top - 78) / 2 + 12}" text-anchor="middle" font-size="10.5" fill="var(--unk)">the boundary exposes no price series · no line is drawn</text>`;
  svg += `<g class="sealed-layer"><text x="${(x0 + width - right) / 2}" y="${height / 2 - 8}" text-anchor="middle" font-size="12.5" fill="var(--hind)" font-weight="600">Sealed: after T₀</text>`;
  svg += `<text x="${(x0 + width - right) / 2}" y="${height / 2 + 10}" text-anchor="middle" font-size="11" fill="var(--ink-3)">Not known at decision time.</text>`;
  svg += `<text x="${(x0 + width - right) / 2}" y="${height / 2 + 25}" text-anchor="middle" font-size="11" fill="var(--ink-3)">“Hindsight overlay” draws it here only.</text></g>`;
  svg += `<line x1="${x0}" x2="${x0}" y1="${top - 6}" y2="${plotBottom}" stroke="var(--hind)" stroke-width="2" stroke-dasharray="4 3"/>`;
  svg += `<text x="${x0 - 5}" y="${top + 4}" text-anchor="end" font-size="10.5" fill="var(--asof)" font-weight="700">KNOWN AT T₀</text>`;
  svg += `<text x="${x0 + 5}" y="${top + 4}" font-size="10.5" fill="var(--hind)" font-weight="700">LATER</text>`;
  const markY = plotBottom - 16;
  // Etiquetas escalonadas cuando dos relojes caen casi en la misma x.
  let previousX = null;
  let stagger = 0;
  const labelY = (cx) => {
    stagger = previousX !== null && Math.abs(cx - previousX) < 90 ? stagger + 1 : 0;
    previousX = cx;
    return markY - 10 - stagger * 12;
  };
  for (const mark of decisionMarks) {
    const cx = x(mark.ms);
    svg += `<g data-tip="${esc(mark.point.key)} · ${esc(mark.point.clock)} · known at T₀"><rect x="${cx - 5}" y="${markY - 5}" width="10" height="10" rx="1" fill="var(--asof)" stroke="var(--surface)" stroke-width="2"/><text x="${cx - 8}" y="${labelY(cx)}" text-anchor="end" font-size="10" fill="var(--asof)" font-family="var(--mono)">${esc(mark.point.key)}</text></g>`;
  }
  previousX = null;
  stagger = 0;
  svg += '<g class="hind-layer">';
  if (laterMarks.length === 0) {
    svg += `<text x="${(x0 + width - right) / 2}" y="${height / 2}" text-anchor="middle" font-size="11" fill="var(--hind)" font-weight="600">no evaluation point after T₀ exposed</text>`;
  }
  for (const mark of laterMarks) {
    const cx = x(mark.ms);
    svg += `<g data-tip="${esc(mark.point.key)} · ${esc(mark.point.clock)} · realised later"><circle cx="${cx}" cy="${markY}" r="5" fill="var(--hind)" stroke="var(--surface)" stroke-width="2"/><text x="${cx}" y="${labelY(cx)}" text-anchor="middle" font-size="10" fill="var(--hind)" font-family="var(--mono)">${esc(mark.point.key)}</text></g>`;
  }
  svg += "</g></svg>";
  return svg;
}

function recommendationCardHtml(field) {
  if (field === undefined) {
    return objCard("asof", "◆", "Recommendation", "T₀", `<div class="big" style="color:var(--ink-3)">Not available at T₀</div>${chip("unk", "?", "UNKNOWN")} <span class="small muted">replay not validated; nothing is presented as known</span>`, { none: true });
  }
  if (field.condition === "AVAILABLE") {
    return objCard("asof", "◆", "Recommendation", "T₀", `
      <div class="big">${valueHtml(field.value)}</div>
      <dl class="kv"><dt>Section</dt><dd>${esc(field.specLabel)} · ${esc(field.section)}</dd><dt>Known at T₀</dt><dd>${chip("pass", "✓", "canonical")}</dd><dt>Provenance</dt><dd>${provenanceHtml(field.provenance, field.specLabel, field.value)}</dd></dl>
      <div class="tiny muted" style="margin-top:6px">As exposed by the boundary at T₀. Not an instruction, not an order.</div>`);
  }
  const [kind, glyph, text] = EPISTEMIC_CHIP[field.condition] ?? ["warn", "!", field.condition];
  return objCard("asof", "◆", "Recommendation", "T₀", `<div class="big" style="color:var(--ink-3)">No recommendation value at T₀</div><div>${chip(kind, glyph, esc(text))}</div><div class="small ink2" style="margin-top:6px">${esc(field.reason ?? "")}</div>`, { none: true });
}

function requestedActionCardHtml() {
  return objCard("exec", "▲", "Requested action", "—", `<div class="big" style="color:var(--ink-3)">Not exposed</div><div>${unknownValue()}</div><div class="small ink2" style="margin-top:6px">The Operator Interface exposes the recommendation (§26.2) and actuations (§26.3); it exposes no separate requested-order object. Nothing is inferred.</div>`, { none: true });
}

function executionCardHtml(vm, validated) {
  const events = validated && vm.executions.length > 0
    ? `<ul class="data-list events-list">${vm.executions.map(eventClassHtml).join("")}</ul>`
    : `<div class="big" style="color:var(--ink-3)">No execution</div><div>${chip("na", "—", validated ? "None exposed" : "Not validated")} <span class="small muted">${validated ? "no actuation in this boundary" : "replay not validated"}</span></div>`;
  const section = validated
    ? `<section class="events execution-events" data-view-scope="execution" data-zone="execution" data-events-kind="execution">${events}</section>`
    : events;
  const first = validated && vm.executions.length > 0 ? esc(vm.executions[0].clock) : "—";
  return objCard("exec", "■", "Execution · fill", first, section, { none: !(validated && vm.executions.length > 0) });
}

function outcomeCardHtml(field, vm, validated) {
  let body;
  if (field === undefined) {
    body = `<div class="row" style="margin-bottom:6px"><span class="openv">NOT VALIDATED</span></div><div class="big">No outcome</div><div class="small">Nothing about the later evaluation is shown until the replay validates.</div>`;
  } else if (field.condition === "AVAILABLE") {
    body = `<div class="big">${valueHtml(field.value)}</div><div>${provenanceHtml(field.provenance, field.specLabel, field.value)}</div>`;
  } else {
    const [kind, glyph, text] = EPISTEMIC_CHIP[field.condition] ?? ["unk", "?", "UNKNOWN"];
    body = `<div class="row" style="margin-bottom:6px">${kind === "open" ? `<span class="openv">${esc(text)}</span>` : chip(kind, glyph, esc(text))}</div><div class="big">No outcome at T₀</div><div class="small">${esc(field.reason ?? "")}</div>`;
  }
  if (validated) {
    body += `<div class="tiny muted" style="margin-top:8px">Evaluation lane: ${vm.evaluation.points.length} point(s) as-of ${esc(vm.evaluation.asOf ?? "—")} → see <b>Later · evaluation</b>.</div>`;
  }
  return objCard("hind", "●", "Outcome · evaluation", "later", body);
}

function unknownRowsHtml(entries, chipHtml) {
  return (entries ?? []).map((entry) => `<div class="unk-row" data-unavailable-key="${esc(entry?.key ?? "")}">${chipHtml}<span><span class="mono small">${esc(entry?.key ?? "")}@${esc(entry?.revisionId ?? "")}</span> <span class="reason">${esc(entry?.reason ?? "")}</span></span></div>`).join("");
}

function replayBody(vm, { errors = null } = {}) {
  const validated = errors === null;
  const fields = validated ? vm.exposure.fields : [];
  const fieldByKey = (key) => fields.find((field) => field.field === key);
  const boundary = validated ? vm.decision.boundary : null;
  const errBar = validated ? "" : errorBarHtml(errors);
  const skeletonReason = "not validated · no value presented";

  const head = `
  <div class="dechead">
    <div class="grow">
      <div class="mono muted small">decision boundary · working mode <span class="working-mode" data-working-mode="${esc(validated ? vm.workingMode : "")}">${validated ? esc(vm.workingMode) : "UNAVAILABLE"}</span></div>
      <h1 class="page">Decision at ${boundary ? `<span class="mono" style="font-family:var(--serif)">${esc(boundary)}</span>` : unknownValue("UNAVAILABLE")}</h1>
      <p class="lede">Read left to right: what was known, what was recommended, what was asked for, what was filled, and — separately, later — how it turned out.</p>
    </div>
    <div class="row">${boundary ? `<span class="btn on">T₀ · ${esc(boundary)}</span>` : `<span class="btn">T₀ · unavailable</span>`}</div>
  </div>`;

  const timelineCount = validated ? vm.decision.points.length + vm.evaluation.points.length + vm.executions.length + vm.interventions.length : 0;
  const timelineCard = `
  <div class="card" style="margin-top:14px;padding:4px 14px 0">
    <div class="row small" style="padding-top:6px"><span class="caps muted">Operator timeline · ${timelineCount} canonical marks</span><span class="grow"></span>
      <span class="muted"><span style="color:var(--asof)">■</span> decision point &nbsp; <span style="color:var(--hind)">●</span> evaluation point &nbsp; ▲ actuation &nbsp; <span style="color:var(--unk)">◆</span> human intervention &nbsp; <span style="color:var(--hind)">▬</span> T₀ → as-of</span></div>
    <div class="tl">${timelineSvg(validated ? vm : { decision: { boundary: null, points: [] }, evaluation: { asOf: null, points: [] }, executions: [], interventions: [] })}</div>
  </div>`;

  const chain = `
  <div class="chain">
    ${recommendationCardHtml(validated ? fieldByKey("recommendation") : undefined)}<div class="link">→</div>${requestedActionCardHtml()}<div class="link">→</div>${executionCardHtml(vm, validated)}
    <div class="horizon"><span>EVALUATION · LATER</span></div>
    ${outcomeCardHtml(validated ? fieldByKey("outcomes") : undefined, vm, validated)}
  </div>
  <div class="row tiny muted" style="margin-top:6px">
    <span class="zt asof">T₀ · decision-time</span><span class="zt exec">Execution</span><span class="zt hind">Later · evaluation</span>
    <span>Four separate objects with their own ids, clocks and provenance. The arrow is sequence, not identity.</span>
  </div>`;

  const interventions = validated
    ? `<div class="interv"><div class="ohd"><span class="glyph" style="background:var(--unk);color:#fff;width:22px;height:22px;display:grid;place-items:center;border-radius:3px;font:700 13px var(--mono)">◆</span><b style="font-size:12.5px">Human intervention</b><span class="muted small">never listed as a fill; attribution kept</span></div><section class="events intervention-events" data-view-scope="intervention" data-zone="intervention" data-events-kind="intervention">${vm.interventions.length > 0 ? `<ul class="data-list events-list">${vm.interventions.map(eventClassHtml).join("")}</ul>` : `<p class="small muted" style="margin:6px 0 0">${chip("na", "—", "None exposed")} no human intervention in this boundary</p>`}</section></div>`
    : "";

  const exposureRows = validated
    ? fields.map(exposureFieldHtml).join("")
    : EXPOSURE_FIELDS.map((definition) => exposureSlotHtml(definition, skeletonReason)).join("");
  const exposureTable = `<div class="exp-head"><span>Input in decision snapshot (§26.2)</span><span>Value at T₀ / reason</span><span>Provenance</span><span>State</span></div><ul class="data-list exposure-list">${exposureRows}</ul>`;
  const exposureSection = validated
    ? `<section class="exposure-table zone-decision" data-kind="exposure" data-zone="exposure">${exposureTable}</section>`
    : `<div class="exposure-table">${exposureTable}</div>`;

  const decisionPoints = validated && vm.decision.points.length > 0
    ? `<ul class="data-list ts-points">${vm.decision.points.map(timelinePointHtml).join("")}</ul>`
    : `<p class="lane-note muted">${validated ? "no decision point in this boundary" : "not validated"}</p>`;
  const suppressed = validated ? unknownRowsHtml(vm.decision.suppressed, chip("warn", "!", "SUPPRESSED")) + unknownRowsHtml(vm.decision.unavailable, chip("unk", "?", "UNKNOWN")) : "";

  const decisionInner = `
      <div class="zhd"><span class="zt asof">Known at T₀</span><b>${boundary ? esc(boundary) : unknownValue("UNAVAILABLE")}</b><span class="grow"></span>
        <button type="button" class="btn" data-hind-toggle title="Draws evaluation points after T₀ on the right of the horizon only">Hindsight overlay: off</button></div>
      <div class="zbd">
        <div class="row small"><b>Decision-time view</b><span class="muted">points consumable at T₀ · policy-consumable clock</span></div>
        <div class="chartwrap">${decisionChartSvg(validated ? vm : { decision: { boundary: null, points: [] }, evaluation: { points: [] } })}</div>
        ${decisionPoints}${suppressed}
        ${exposureSection}
      </div>`;
  const decisionZone = validated
    ? `<section class="lane lane-scope-decision zone-decision" data-view-scope="decision" data-zone="decision">${decisionInner}</section>`
    : `<div class="lane zone-decision">${decisionInner}</div>`;

  let evaluationInner;
  if (validated) {
    const points = vm.evaluation.points.length > 0
      ? `<ul class="data-list ts-points">${vm.evaluation.points.map(timelinePointHtml).join("")}</ul>`
      : `<div class="sealed"><div class="caps">No evaluation point</div><div class="big">None exposed as-of ${esc(vm.evaluation.asOf ?? "—")}</div><div class="small ink2">No provisional outcome is displayed.</div></div>`;
    const pending = unknownRowsHtml(vm.evaluation.pendingRevisions, '<span class="openv">NOT CLOSED</span>') + unknownRowsHtml(vm.evaluation.unavailable, chip("unk", "?", "UNKNOWN"));
    evaluationInner = `
      <div class="zhd"><span class="zt hind">Later · evaluation</span><b>not visible to the decision</b></div>
      <div class="zbd">
        <div class="metric"><span class="lbl"><b>Evaluation view</b> · as-of</span><span class="val" style="font-size:13px">${esc(vm.evaluation.asOf ?? "—")}</span><span class="lbl">Clock</span><span class="mono small">evaluation-effective</span></div>
        <div class="sp"></div>
        ${points}${pending}
        <div class="sp"></div>
        <div class="note-ev"><span class="ev">EVIDENCE</span> One decision is one observation. It does not validate a strategy — see <a href="#backtests">Backtests</a> for the paired comparison.</div>
      </div>`;
  } else {
    evaluationInner = `
      <div class="zhd"><span class="zt hind">Later · evaluation</span><b>not visible to the decision</b></div>
      <div class="zbd"><div class="sealed"><div class="caps">Evaluation unavailable</div><div class="big">Replay not validated</div><div class="small ink2">No provisional outcome is displayed.</div></div></div>`;
  }
  const evaluationZone = validated
    ? `<section class="lane lane-scope-evaluation zone-evaluation" data-view-scope="evaluation" data-zone="evaluation">${evaluationInner}</section>`
    : `<div class="lane zone-evaluation">${evaluationInner}</div>`;

  return `
<section class="surface replay${validated ? "" : " state-error"}" data-surface="replay"${validated ? "" : ' data-state="ERROR"'}>
  ${errBar}${head}${timelineCard}${chain}${interventions}
  <div class="zones">
    ${decisionZone}
    <div class="horizon"><span>KNOWLEDGE HORIZON</span></div>
    ${evaluationZone}
  </div>
</section>`;
}

function replayContext(vm) {
  return [
    `<span>Replay · working mode <span class="mono">${esc(vm.workingMode)}</span></span>`,
    `<span class="mono">T₀ ${esc(vm.decision.boundary)}</span>`,
    `<span class="mono">evaluation as-of ${esc(vm.evaluation.asOf ?? "—")}</span>`,
  ];
}

// ---------- Backtests / Economic Comparison ----------

function armTag(arm) {
  const color = ARM_SWATCH[arm] ?? "var(--arm-b)";
  return `<span class="arm"><span class="sw" style="background:${color}"></span>${esc(arm)}</span>`;
}

function backtestsBody(vm, { errors = null } = {}) {
  const validated = errors === null;
  const rows = validated ? vm.rows : [];
  const pending = validated ? vm.pendingComparisons ?? [] : [];
  const reasonNotValidated = "view model not validated (fail-closed, §26.5)";
  const bhv = pendingOr(findPending(pending, "B / H / V"), "B / H / V / ΔV", reasonNotValidated);
  const paired = pendingOr(findPending(pending, "Efectos"), "Paired effects", reasonNotValidated);
  const distributions = pendingOr(findPending(pending, "Distrib"), "Distributions", reasonNotValidated);
  const integrity = pendingOr(findPending(pending, "Contexto"), "Method / integrity context", reasonNotValidated);

  const boundRows = rows.filter((row) => row.status === "BOUND");
  const arms = [...new Set(boundRows.map((row) => row.arm).filter((arm) => typeof arm === "string"))];
  const measureColumns = ["B", "H", "V", "ΔV"];

  // Filas de la tabla: una por fila canónica atada (su medida en su columna);
  // las no atadas quedan UNAVAILABLE con razón; sin nada, la fila pendiente.
  const cellFor = (row, measure) => (row.measure === measure
    ? `<span class="value" data-value="${esc(valueText(row.value))}">${valueHtml(row.value)}</span><div>${provenanceHtml(row.provenance, row.label, row.value)}</div>`
    : '<span class="muted small">—</span>');
  const tableRows = rows.map((row) => {
    if (row.status === "BOUND") {
      const armCell = row.arm ? `${armTag(row.arm)}` : '<span class="muted small">arm not declared</span>';
      return `<tr class="data-item data-bound" data-status="BOUND"${row.arm !== undefined && row.arm !== null ? ` data-arm="${esc(row.arm)}"` : ""}${row.measure !== undefined && row.measure !== null ? ` data-measure="${esc(row.measure)}"` : ""}><td>${armCell}<div class="small muted">${esc(row.label)}</div></td><td>${unknownValue()}</td>${measureColumns.map((measure) => `<td class="mono num right">${cellFor(row, measure)}</td>`).join("")}<td>${unknownValue()}</td><td>${chip("run", "✓", "canonical")}</td></tr>`;
    }
    return `<tr class="data-item data-unavailable" data-status="UNAVAILABLE"><td>${unavailableReasonHtml(row)}</td><td>${unknownValue()}</td>${measureColumns.map(() => '<td class="right"><span class="withheld" data-status="UNAVAILABLE">UNAVAILABLE</span></td>').join("")}<td>${unknownValue()}</td><td>${chip("unk", "?", "Unavailable")}</td></tr>`;
  });
  const bhvRow = `<tr class="data-item data-unavailable pending-comparison" data-status="UNAVAILABLE"><td><span class="item-label">${esc(bhv.label)}</span> <span class="withheld" data-status="UNAVAILABLE">UNAVAILABLE</span><div class="reason small muted">${esc(bhv.reason)}</div></td><td>${unknownValue()}</td>${measureColumns.map(() => '<td class="right"><span class="withheld">NO ESTIMATE</span></td>').join("")}<td>${unknownValue()}</td><td>${chip("unk", "?", "Not produced")}</td></tr>`;

  const table = `<table class="t">
      <thead><tr><th>Arm</th><th>n (closed / total)</th><th class="right">B</th><th class="right">H</th><th class="right">V</th><th class="right">ΔV vs baseline</th><th>Interval (paired)</th><th>Status</th></tr></thead>
      <tbody>${tableRows.join("")}${bhvRow}</tbody>
    </table>`;

  const checks = `<div class="chk" data-status="UNAVAILABLE"><span><b>${esc(integrity.label)}</b></span>${chip("unk", "?", "Unknown")}<span class="d">${esc(integrity.reason)}</span></div>
    <div class="chk"><span><b>Pairing · look-ahead · execution · closure</b></span>${chip("unk", "?", "Not exposed")}<span class="d">no method or integrity receipt is exposed by the boundary; no check is presumed to pass</span></div>`;

  return `
<section class="surface backtests${validated ? "" : " state-error"}" data-surface="backtests"${validated ? "" : ' data-state="ERROR"'}>
  ${validated ? "" : errorBarHtml(errors)}
  <div class="row" style="align-items:flex-end">
    <div class="grow">
      <div class="mono muted small">economic comparison · canonical producers only</div>
      <h1 class="page">Economic comparison of experimental arms</h1>
      <p class="lede">Measures are shown only as published by canonical producers and bound to the verified backend manifest. Without a producer, the slot stays explicit: no comparison is fabricated.</p>
    </div>
    <div class="armhead">${arms.length > 0 ? arms.map(armTag).join("") : `<span class="small muted">arms</span> ${unknownValue()}`}</div>
  </div>

  <div class="card" style="margin-top:14px">
    <div class="hd"><h3>Economic measures</h3><span class="small muted">B · H · V · ΔV as published by the canonical producer; definitions belong to the backend method</span><span class="grow"></span>${boundRows.length > 0 ? chip("run", "✓", `${boundRows.length} canonical row(s)`) : chip("unk", "?", "No canonical producer")}</div>
    ${table}
  </div>

  <div class="grid" style="grid-template-columns: minmax(0,1.7fr) minmax(0,1fr); margin-top:14px">
    <div class="card">
      <div class="hd"><h3>Paired effect over the campaign</h3><span class="small muted">cumulative ΔV by decision</span></div>
      <div class="bd" data-kind="paired">${noEstimateFrameSvg({ width: 800, height: 330, label: paired.label, reason: `${paired.label}: ${paired.reason}` })}</div>
    </div>
    <div class="card">
      <div class="hd"><h3>Method &amp; integrity</h3><span class="small muted">from backend</span></div>
      <div class="bd">
        ${checks}
        <div class="sp"></div>
        <div class="note-ev"><span class="ev">EVIDENCE</span> A comparison is evidence. It does not approve a strategy. Adoption authority lives in <a href="#research">Research › Authority</a>.</div>
      </div>
    </div>
  </div>

  <div class="grid" style="grid-template-columns: minmax(0,1fr) minmax(0,1fr) minmax(0,1fr); margin-top:14px">
    <div class="card"><div class="hd"><h3>${armTag("A0")}</h3><span class="small muted">distribution per decision</span></div><div class="bd" data-kind="distribution">${noEstimateFrameSvg({ width: 380, height: 150, label: distributions.label, reason: `${distributions.label}: ${distributions.reason}` })}</div></div>
    <div class="card"><div class="hd"><h3>${armTag("A1")}</h3><span class="small muted">distribution per decision</span></div><div class="bd" data-kind="distribution">${noEstimateFrameSvg({ width: 380, height: 150, label: distributions.label, reason: `${distributions.label}: ${distributions.reason}` })}</div></div>
    <div class="card"><div class="hd"><h3>Across campaigns</h3><span class="small muted">paired ΔV by campaign</span></div><div class="bd" data-kind="campaign-effects">${noEstimateFrameSvg({ width: 380, height: 150, label: paired.label, reason: `${paired.label}: ${paired.reason}` })}
      <div class="tiny muted" style="margin-top:4px">◆ closed · ◇ interim · hatched = no estimate (not zero)</div></div></div>
  </div>
</section>`;
}

// ---------- Research / Strategy Lab ----------

// Marco del grafo de linaje del mockup sin nodos: el boundary no expone
// versiones ni experimentos, así que no se dibuja ninguno.
function lineageFrameSvg() {
  let svg = '<svg viewBox="0 0 900 150" width="100%" role="img" aria-label="Version lineage: unavailable">';
  svg += '<defs><pattern id="lnHatchU" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="6" height="6" fill="#f3ecf5"/><rect width="1" height="6" fill="#d4c0dc"/></pattern></defs>';
  svg += '<rect x="0" y="10" width="900" height="130" rx="4" fill="url(#lnHatchU)" stroke="#cdb8d6"/>';
  svg += '<text x="450" y="72" text-anchor="middle" font-size="12" fill="var(--unk)" font-weight="700">LINEAGE UNAVAILABLE</text>';
  svg += '<text x="450" y="90" text-anchor="middle" font-size="10.5" fill="var(--unk)">no version or experiment is exposed by the boundary · no node is drawn</text>';
  return `${svg}</svg>`;
}

function researchBody(vm, { errors = null } = {}) {
  const validated = errors === null;
  const strategies = validated ? vm.strategies : [];
  const pending = validated ? vm.pendingSections ?? [] : [];
  const reasonNotValidated = "view model not validated (fail-closed, §26.5)";
  const lineage = pendingOr(findPending(pending, "Experiment"), "Experiment / version lineage", reasonNotValidated);
  const evidence = pendingOr(findPending(pending, "Evidence"), "Evidence / receipts", reasonNotValidated);
  const selected = strategies.find((strategy) => strategy.status === "BOUND") ?? strategies[0] ?? null;

  const stackItem = (strategy) => (strategy.status === "BOUND"
    ? `<div class="it data-item data-bound${strategy === selected ? " on" : ""}" data-status="BOUND" data-strategy="${esc(strategy.strategyId)}"><div class="row"><span class="stage">CANONICAL RECORD</span><span class="grow"></span><span class="mono tiny muted">${esc(strategy.strategyId)}</span></div><div style="font-weight:600;margin:3px 0 5px">${esc(strategy.strategyId)}</div><div class="row small" style="gap:6px"><span class="muted">Readiness</span>${chip("run", "✓", "canonical")} <span class="value" data-value="${esc(valueText(strategy.readiness))}">${valueHtml(strategy.readiness)}</span></div><div class="row small" style="gap:6px;margin-top:4px"><span class="ev">EVIDENCE —</span><span class="muted">Authority</span>${chip("na", "—", "Not exposed")}</div><div>${provenanceHtml(strategy.provenance, strategy.strategyId, strategy.readiness)}</div></div>`
    : `<div class="it data-item data-unavailable${strategy === selected ? " on" : ""}" data-status="UNAVAILABLE" data-strategy="${esc(strategy.strategyId)}"><div class="row"><span class="stage">NO CANONICAL RECORD</span><span class="grow"></span><span class="mono tiny muted">${esc(strategy.strategyId)}</span></div><div style="font-weight:600;margin:3px 0 5px">${esc(strategy.strategyId)}</div><div class="row small" style="gap:6px"><span class="muted">Readiness</span><span class="unkv">UNKNOWN</span> <span class="condition condition-unavailable">UNAVAILABLE</span></div><div class="row small" style="gap:6px;margin-top:4px"><span class="ev">EVIDENCE —</span><span class="muted">Authority</span>${chip("na", "—", "Not exposed")}</div><div class="reason small muted" style="margin-top:4px">${esc(strategy.reason)}</div></div>`);
  const stack = strategies.length > 0
    ? strategies.map(stackItem).join("\n")
    : `<div class="it on"><div class="stage">STRATEGY STACK</div><div style="font-weight:600;margin:3px 0 5px">Not validated</div>${unknownValue("UNAVAILABLE")}</div>`;

  const selectedId = selected?.strategyId ?? null;
  const readinessChip = selected?.status === "BOUND" ? chip("run", "✓", "canonical record") : chip("unk", "?", "Unknown");
  const readinessBody = selected?.status === "BOUND"
    ? `<div class="chk"><span>Readiness record</span>${chip("run", "✓", "canonical")}<span class="d"><span class="value" data-value="${esc(valueText(selected.readiness))}">${valueHtml(selected.readiness)}</span> ${provenanceHtml(selected.provenance, selected.strategyId, selected.readiness)}</span></div>`
    : `<div class="chk"><span>Readiness record</span>${chip("unk", "?", "Unknown")}<span class="d">${esc(selected?.reason ?? reasonNotValidated)}</span></div>`;

  return `
<section class="surface research${validated ? "" : " state-error"}" data-surface="research"${validated ? "" : ' data-state="ERROR"'}>
  ${validated ? "" : errorBarHtml(errors)}
  <div class="split">
    <div>
      <div class="caps muted" style="margin:4px 0 8px">Candidate stack</div>
      <div class="card stack data-list strategies">${stack}</div>
      ${validated && vm.unexpectedStrategyIds.length > 0 ? `<p class="small muted">outside the expected stack: ${esc(vm.unexpectedStrategyIds.join(", "))}</p>` : ""}
      <div class="small muted" style="margin-top:8px">Evidence count and authority are separate columns on purpose: more evidence never turns into approval by itself.</div>
    </div>
    <div>
      <div class="row" style="align-items:flex-end">
        <div class="grow"><div class="mono muted small">strategy stack · ${esc(selectedId ?? "—")}</div>
          <h1 class="page">${esc(selectedId ?? "Strategy")} <span class="muted">version ${unknownValue()}</span></h1></div>
        <div style="text-align:right"><div class="caps muted">Readiness (backend)</div><div style="margin-top:4px">${readinessChip}</div></div>
      </div>

      <div class="grid" style="grid-template-columns: minmax(0,1.6fr) minmax(0,1fr); margin-top:14px">
        <div class="card">
          <div class="hd"><h3>Hypothesis</h3><span class="small muted">pre-registration ${unknownValue()}</span></div>
          <div class="bd">
            <p class="hyp" style="color:var(--ink-3)">No canonical hypothesis is exposed for ${esc(selectedId ?? "this candidate")}. Nothing is presumed.</p>
            <div class="caps muted">Success criteria</div>
            <div class="crit"><span class="mono">?</span><div><div style="font-weight:600">Criteria not exposed</div><div class="small ink2">the boundary exposes no success criteria or their state for this candidate</div></div>${chip("unk", "?", "Unknown")}</div>
          </div>
        </div>
        <div>
          <div class="auth-box">
            <div class="row"><span class="seal">AUTHORITY</span><span class="grow"></span>${chip("na", "—", "Not exposed")}</div>
            <div style="font:600 16px var(--serif);margin:8px 0 4px">No adoption decision is exposed</div>
            <div class="small ink2">The Operator Interface Boundary exposes no authority record for this candidate. Evidence does not change this state; only a recorded act of its decision owner can.</div>
          </div>
          <div class="card" style="margin-top:14px">
            <div class="hd"><h3>Readiness &amp; integrity</h3></div>
            <div class="bd">${readinessBody}</div>
          </div>
        </div>
      </div>

      <div class="card" style="margin-top:14px">
        <div class="hd"><h3>Version lineage</h3><span class="small muted">versions → experiments</span></div>
        <div class="bd" data-kind="lineage">${lineageFrameSvg()}<div class="small muted" style="margin-top:4px" data-status="UNAVAILABLE">${unavailableReasonHtml(lineage)}</div></div>
      </div>

      <div class="card" style="margin-top:14px">
        <div class="hd"><h3>Evidence &amp; receipts</h3><span class="small muted">evidence informs, it does not authorise</span></div>
        <table class="t"><thead><tr><th>Receipt</th><th>Kind</th><th>What</th><th>Recorded</th><th></th></tr></thead>
          <tbody><tr class="data-item data-unavailable pending-section" data-status="UNAVAILABLE"><td>${unknownValue("UNAVAILABLE")}</td><td><span class="ev">EVIDENCE</span></td><td>${unavailableReasonHtml(evidence)}</td><td class="mono small muted">—</td><td></td></tr></tbody></table>
      </div>
      <div class="note-ev" style="margin-top:14px"><span class="ev">EVIDENCE</span> Evidence informs; it does not authorise. Adoption authority is not exposed by this boundary.</div>
    </div>
  </div>
</section>`;
}

// ---------- Campaigns & Runs ----------

function campaignsBody(vm, { errors = null } = {}) {
  const validated = errors === null;
  const campaigns = validated ? vm.campaigns : [];
  const runs = validated ? vm.runs : [];
  const pendingReceipts = validated ? vm.pendingRunReceipts ?? [] : [];
  const selected = campaigns.find((campaign) => campaign.status === "BOUND") ?? null;

  const railItem = (campaign, index) => (campaign.status === "BOUND"
    ? `<div class="it data-item data-bound${campaign === selected ? " on" : ""}" data-status="BOUND"><div class="mono muted small">${esc(campaign.label)}</div><div class="ttl"><span class="value" data-value="${esc(valueText(campaign.value))}">${valueHtml(campaign.value)}</span></div><div style="margin-bottom:4px">${chip("run", "✓", "canonical")} ${provenanceHtml(campaign.provenance, campaign.label, campaign.value)}</div></div>`
    : `<div class="it data-item data-unavailable${index === 0 && selected === null ? " on" : ""}" data-status="UNAVAILABLE"><div class="mono muted small">${esc(campaign.label)}</div><div class="ttl">${unavailableReasonHtml(campaign)}</div><div style="margin-bottom:4px"><span class="unkv">UNKNOWN</span></div></div>`);
  const rail = campaigns.length > 0
    ? campaigns.map(railItem).join("")
    : `<div class="it on empty-state" data-empty="true"><div class="mono muted small">campaign</div><div class="ttl">No canonical campaign exposed</div><div style="margin-bottom:4px"><span class="unkv">UNKNOWN</span></div><div class="small muted">sin campañas canónicas expuestas por el backend en este scope; no se fabrican</div></div>`;

  const unknownItems = [];
  if (campaigns.length === 0) {
    unknownItems.push({ q: "No canonical campaign is exposed", why: "sin campañas canónicas expuestas por el backend en este scope; no se fabrican", blocks: "campaign identity, readiness and window" });
  }
  for (const campaign of campaigns.filter((item) => item.status !== "BOUND")) {
    unknownItems.push({ q: `${campaign.label}: not bound`, why: campaign.reason, blocks: "this campaign's facts" });
  }
  if (runs.length === 0) {
    unknownItems.push({ q: "No canonical run is exposed", why: "sin runs canónicas expuestas por el backend en este scope; no se fabrican", blocks: "run navigation and drill-downs" });
  }
  for (const run of runs.filter((item) => item.status !== "BOUND")) {
    unknownItems.push({ q: `${run.label}: not bound`, why: run.reason, blocks: "this run's facts and drill-downs" });
  }
  for (const receipt of pendingReceipts) {
    unknownItems.push({ q: `${receipt.label}: unavailable`, why: receipt.reason, blocks: "receipts ledger" });
  }
  if (!validated) {
    unknownItems.push({ q: "Campaigns view model not validated", why: "fail-closed (§26.5)", blocks: "everything on this surface" });
  }
  const unknownHtml = unknownItems.map((item) => `
      <div class="unk-item">
        <div class="row">${chip("unk", "?", "Unavailable")}<span class="grow"></span><span class="small muted">explicit · fail-closed</span></div>
        <div class="q">${esc(item.q)}</div>
        <div class="small ink2">${esc(item.why)}</div>
        <div class="small"><span class="muted">Blocks:</span> ${esc(item.blocks)}</div>
      </div>`).join("");

  const runRow = (run) => (run.status === "BOUND"
    ? `<tr class="data-item data-bound" data-status="BOUND"><td><div class="mono">${provenanceHtml(run.provenance, run.label, run.value)}</div><div class="small muted item-label">${esc(run.label)}</div></td><td>${unknownValue()}</td><td>${chip("run", "✓", "canonical")}</td><td style="min-width:190px"><div class="bar"><span class="notrun" style="width:100%"></span></div><div class="small" style="margin-top:4px"><span class="value" data-value="${esc(valueText(run.value))}">${valueHtml(run.value)}</span></div></td><td>${unknownValue()}</td><td>${unknownValue()}</td><td>${drilldownHtml(run.drilldowns)}</td></tr>`
    : `<tr class="data-item data-unavailable" data-status="UNAVAILABLE"><td>${unavailableReasonHtml(run)}</td><td>${unknownValue()}</td><td>${chip("unk", "?", "Unavailable")}</td><td style="min-width:190px"><div class="bar"><span class="notrun" style="width:100%"></span></div><div class="small" style="margin-top:4px"><span class="unkv" style="font-size:10.5px;line-height:15px">NOT EXPOSED</span></div></td><td>${unknownValue()}</td><td>${unknownValue()}</td><td><span class="muted small">no handoff on unbound data</span></td></tr>`);
  const runRows = runs.length > 0
    ? runs.map(runRow).join("")
    : `<tr class="empty-state" data-empty="true"><td colspan="7"><div class="row">${unknownValue("UNAVAILABLE")}<span class="small muted">sin runs canónicas expuestas por el backend en este scope; no se fabrican</span></div><div class="bar" style="margin-top:8px"><span class="notrun" style="width:100%"></span></div></td></tr>`;

  const receipts = (pendingReceipts.length > 0 ? pendingReceipts : [{ label: "Receipts", reason: "view model not validated (fail-closed, §26.5)" }])
    .map((receipt) => `<div class="receipt data-item data-unavailable" data-status="UNAVAILABLE"><span class="mono small muted">—</span><span>${unavailableReasonHtml(receipt)}</span><span class="unkv">UNAVAILABLE</span></div>`).join("");

  const title = selected ? `<span class="value" data-value="${esc(valueText(selected.value))}">${valueHtml(selected.value)}</span>` : "No canonical campaign in this scope";

  return `
<section class="surface campaigns${validated ? "" : " state-error"}" data-surface="campaigns"${validated ? "" : ' data-state="ERROR"'}>
  ${validated ? "" : errorBarHtml(errors)}
  <div class="split">
    <div>
      <div class="caps muted" style="margin:4px 0 8px">Campaigns</div>
      <div class="card clist">${rail}</div>
      <div class="small muted" style="margin-top:8px">Readiness shown here is reported by the backend. The UI does not compute or upgrade it.</div>
    </div>
    <div>
      <div class="row" style="align-items:flex-end">
        <div class="grow">
          <div class="mono muted small">${selected ? esc(selected.label) : "campaign · product"}</div>
          <h1 class="page">${title}</h1>
          <p class="lede">Campaigns and runs as exposed by the backend. Drill-downs are navigation handoffs to surfaces that apply their own fail-closed rules (§26.5).</p>
        </div>
        <div style="text-align:right">
          <div class="caps muted">Campaign readiness</div>
          <div style="margin-top:4px">${chip("unk", "?", "Not exposed by backend")}</div>
        </div>
      </div>

      <div class="grid g2" style="margin-top:16px">
        <div class="card">
          <div class="hd"><h3>Readiness gates</h3><span class="muted small">from backend</span></div>
          <div class="bd"><div class="chk"><span>Readiness gates</span>${chip("unk", "?", "Unknown")}<span class="d">the Operator Interface Boundary exposes no readiness gate for campaigns; no gate is presumed to pass</span></div></div>
        </div>
        <div class="card">
          <div class="hd"><h3>What we don't know</h3><span class="muted small">${unknownItems.length} explicit unknowns · fail-closed</span></div>
          <div class="bd">${unknownHtml}</div>
        </div>
      </div>

      <h2 class="sec">Runs</h2>
      <section class="runs" data-kind="runs">
      <div class="card">
        <table class="t">
          <thead><tr><th>Run</th><th>Arm</th><th>Status</th><th>Decisions · evaluation</th><th>Determinism</th><th>Receipts</th><th>Drill down</th></tr></thead>
          <tbody>${runRows}</tbody>
        </table>
      </div>
      </section>
      <div class="row small muted" style="margin-top:6px;gap:16px">
        <span><span class="bar" style="display:inline-flex;min-width:24px;width:24px;vertical-align:-1px"><span class="closed" style="width:100%"></span></span> evaluation closed</span>
        <span><span class="bar" style="display:inline-flex;min-width:24px;width:24px;vertical-align:-1px"><span class="open" style="width:100%"></span></span> evaluation not closed</span>
        <span><span class="bar" style="display:inline-flex;min-width:24px;width:24px;vertical-align:-1px"><span class="notrun" style="width:100%"></span></span> not exposed / not run (unknown, not zero)</span>
      </div>

      <h2 class="sec">Receipts</h2>
      <section class="pending-receipts" data-kind="pending"><div class="card"><div class="bd">${receipts}</div></div></section>
    </div>
  </div>
</section>`;
}

// ---------- errores fail-closed dentro de la misma composición ----------

function errorBarHtml(errors) {
  return `<div class="errbar" data-state="ERROR"><b>fail-closed</b> · the surface cannot be drawn with unvalidated data (§26.5). Every slot below stays empty and explicit.<ul class="error-list">${(errors ?? []).map((error) => `<li data-code="${esc(error.code)}"><span class="error-code">${esc(error.code)}</span>${esc(error.message)}</li>`).join("")}</ul></div>`;
}

const SURFACE_BODIES = {
  [SURFACES.REPLAY]: replayBody,
  [SURFACES.BACKTESTS]: backtestsBody,
  [SURFACES.RESEARCH]: researchBody,
  [SURFACES.CAMPAIGNS]: campaignsBody,
};

function renderErrorState(surface, vm) {
  const errors = Array.isArray(vm?.errors) ? vm.errors : [];
  const body = SURFACE_BODIES[surface](null, { errors });
  return renderDocument({ active: surface, title: "Energy Markets — error", body, context: [`<span>${esc(SURFACE_TITLES[surface])}</span>`, '<span class="st fail"><span class="g">✕</span>ERROR · fail-closed</span>'] });
}

function renderValidated(surface, vm) {
  const body = SURFACE_BODIES[surface](vm);
  const clock = surface === SURFACES.REPLAY
    ? { asOfLabel: "evaluation as-of", asOf: vm.evaluation.asOf ?? null, sub: `T₀ ${vm.decision.boundary}` }
    : null;
  const context = surface === SURFACES.REPLAY ? replayContext(vm) : [`<span>${esc(SURFACE_TITLES[surface])}</span>`];
  return renderDocument({ active: surface, title: `Energy Markets — ${SURFACE_TITLES[surface]}`, body, clock, context });
}

function renderPageFor(surface) {
  return (vm) => (vm?.ok !== true ? renderErrorState(surface, vm) : renderValidated(surface, vm));
}

export const renderReplayPage = renderPageFor(SURFACES.REPLAY);
export const renderBacktestsPage = renderPageFor(SURFACES.BACKTESTS);
export const renderResearchPage = renderPageFor(SURFACES.RESEARCH);
export const renderCampaignsPage = renderPageFor(SURFACES.CAMPAIGNS);

export const renderSurfacePage = (surface, vm) => {
  if (SURFACE_BODIES[surface] === undefined) {
    throw new TypeError(`"${surface}" no es una superficie de UI-01.`);
  }
  return renderPageFor(surface)(vm);
};

const WORKSPACE_BLURB = {
  [SURFACES.CAMPAIGNS]: "Campaign and run navigation, readiness, explicit unknowns, receipts and drill-downs.",
  [SURFACES.REPLAY]: "What was known at decision time, the recommendation, actuations and — separately — the later evaluation.",
  [SURFACES.BACKTESTS]: "Economic comparison of arms as published by canonical producers, with method and integrity context.",
  [SURFACES.RESEARCH]: "Strategy candidate stack, hypotheses, readiness, lineage, evidence — and authority kept apart.",
};

export function renderNavigationPage() {
  const cards = NAV_TABS.map(([id, key, title]) => `<a href="#${esc(id)}" class="card nav-card" data-nav="${esc(id)}" data-surface-link="${esc(id)}"><div class="bd"><div class="mono tiny muted">${key}</div><div class="t">${title}</div><div class="small ink2">${WORKSPACE_BLURB[id]}</div></div></a>`);
  const body = `<div class="mono muted small">operator interface · four workspaces</div><h1 class="page">Energy Markets — Operator Interface</h1><p class="lede">Four workspaces over the Operator Interface Boundary (IMP-29). Only what the backend exposes is drawn; unknown stays UNAVAILABLE / ERROR, fail-closed.</p><div class="surface-index">${cards.join("")}</div>`;
  return renderDocument({ active: null, title: "Energy Markets — Operator Interface", body });
}

