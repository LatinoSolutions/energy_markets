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

// Patrones y flecha compartidos del mockup (DEFS de design-proposal/index.html).
const SVG_DEFS = `<svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs>
  <pattern id="emHatchH" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(135)"><rect width="7" height="7" fill="#f6ecdc"/><rect width="1" height="7" fill="#e3c9a0"/></pattern>
  <pattern id="emHatchU" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="6" height="6" fill="#f3ecf5"/><rect width="1" height="6" fill="#d4c0dc"/></pattern>
  <marker id="emArr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0 L10 5 L0 10z" fill="var(--ink-3)"/></marker>
</defs></svg>`;

function renderDocument({ active = null, title, body, clock = null, context = [] }) {
  const contextParts = context.length > 0 ? context : ['<span class="muted">no canonical context exposed</span>'];
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(title)}</title><style data-ui-visual-language="${esc(VISUAL_LANGUAGE_ID)}">${UI_STYLESHEET}</style></head><body class="em-app" data-visual-language="${esc(VISUAL_LANGUAGE_ID)}">
${SVG_DEFS}
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

// ---------- Backtest exploratorio (owner patch EM-SPEC-OWNER-PATCH-2026-09-24-02 §4) ----------
// Se dibuja aparte de las medidas canónicas y siempre con la etiqueta EXPLORATORY.

function eur(value) {
  return typeof value === "number" && Number.isFinite(value) ? value.toFixed(2) : "—";
}

function signedEur(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return '<span class="muted small">—</span>';
  }
  const color = value < 0 ? "var(--pass)" : value > 0 ? "var(--fail)" : "var(--ink-3)";
  return `<span style="color:${color}">${value > 0 ? "+" : ""}${value.toFixed(2)}</span>`;
}

function armResultHtml(arm) {
  if (!arm) {
    return '<span class="muted small">—</span>';
  }
  const status = arm.complete ? "" : ` <span class="st warn"><span class="g">!</span>${arm.boughtMw}/${arm.targetMw} MW</span>`;
  return `${eur(arm.avgPriceEurMwh)}${status}`;
}

function hourProfileSvg(profile) {
  const width = 380;
  const height = 150;
  const values = profile.slots.map((slot) => slot.meanDiffEurMwh).filter((value) => typeof value === "number");
  const span = Math.max(0.05, ...values.map((value) => Math.abs(value)));
  const mid = height / 2;
  const barWidth = width / profile.slots.length;
  const bars = profile.slots.map((slot, index) => {
    const x = index * barWidth + 2;
    if (typeof slot.meanDiffEurMwh !== "number") {
      return `<rect x="${x}" y="${mid - 3}" width="${barWidth - 4}" height="6" fill="var(--hatch-hind)" opacity="0.6"><title>${esc(slot.slot)}: no complete episode</title></rect>`;
    }
    const h = (Math.abs(slot.meanDiffEurMwh) / span) * (mid - 14);
    const y = slot.meanDiffEurMwh < 0 ? mid : mid - h;
    const fill = slot.meanDiffEurMwh < 0 ? "var(--pass)" : "var(--fail)";
    return `<rect x="${x}" y="${y}" width="${barWidth - 4}" height="${Math.max(1, h)}" fill="${fill}"><title>${esc(slot.slot)} Berlin: ${slot.meanDiffEurMwh.toFixed(3)} EUR/MWh vs 11:00 (n=${slot.episodes})</title></rect>`;
  });
  const labels = profile.slots
    .map((slot, index) => (index % 4 === 0 ? `<text x="${index * barWidth + 2}" y="${height - 2}" font-size="9" fill="var(--ink-3)">${esc(slot.slot)}</text>` : ""))
    .join("");
  return `<svg viewBox="0 0 ${width} ${height}" width="100%" role="img" aria-label="Mean price difference by hour vs 11:00, ${esc(profile.product)}"><line x1="0" y1="${mid}" x2="${width}" y2="${mid}" stroke="var(--rule)"/>${bars.join("")}${labels}</svg>`;
}

// Paneles del mockup DES-01 (Backtests) poblados con la comparación exploratoria que
// calcula src/exploratory/comparison.mjs. La UI no calcula: dibuja lo que llega.
const EXP_ARM_SWATCH = { BASELINE: "var(--arm-base)", ARM_A: "var(--arm-a)", ARM_B: "var(--arm-b)" };
const EXP_ARM_SHORT = { BASELINE: "Baseline", ARM_A: "Arm A", ARM_B: "Arm B" };
const PRODUCT_TITLE = { G0BQ: "Gas Quarterly (THE)", G0BM: "Gas Monthly (THE)" };
const CHECK_CHIP = {
  PASS: ["pass", "✓", "Pass"],
  SIMULATED: ["warn", "!", "Simulated"],
  PROXY: ["warn", "!", "Proxy"],
  PARTIAL: ["open", "○", "Partial"],
  DEGRADED: ["warn", "!", "Degraded"],
  FAIL: ["fail", "✕", "Fail"],
};

function expArmTag(armId) {
  return `<span class="arm"><span class="sw" style="background:${EXP_ARM_SWATCH[armId]}"></span>${esc(EXP_ARM_SHORT[armId])}</span>`;
}

function kEur(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  return `${value > 0 ? "+" : ""}${value.toFixed(1)}`;
}

function comparisonTableHtml(block) {
  const rows = block.table.map((row) => {
    const statusChip = row.status === "COMPLETE" ? chip("pass", "✓", "Complete") : row.status === "PARTIAL" ? chip("open", "○", "Partial") : chip("fail", "✕", "Not comparable");
    const delta = row.armId === "BASELINE" ? "reference" : kEur(row.deltaVKeur);
    const range = row.deltaRangeKeur ? `episodes [${kEur(row.deltaRangeKeur[0])}, ${kEur(row.deltaRangeKeur[1])}]` : "—";
    return `<tr data-status="EXPLORATORY" data-arm="${esc(row.armId)}"><td>${expArmTag(row.armId)}<div class="small muted">${esc(row.label)}</div></td><td class="mono">${row.closed} / ${row.total}${row.notRun > 0 ? ` <span class="st unk">${row.notRun} NOT RUN</span>` : ""}</td><td class="mono num right">${eur(row.bEurMwh)}</td><td class="mono num right">${eur(row.hEurMwh)}</td><td class="mono num right">${kEur(row.vKeur)}</td><td class="mono num right">${delta}</td><td class="mono small">${range}</td><td>${statusChip}</td></tr>`;
  });
  return `<table class="t"><thead><tr><th>Arm</th><th>n (closed / total)</th><th class="right">B* · €/MWh</th><th class="right">H · €/MWh</th><th class="right">V · k€</th><th class="right">ΔV vs baseline · k€</th><th>Range (paired)</th><th>Status</th></tr></thead><tbody>${rows.join("")}</tbody></table>`;
}

// Sin chip "Official": el registro BT-02 es EXPLORATORY_PROVISIONAL y el loader
// rechaza cualquier OFFICIAL dentro de él (plan BT-03, official sigue unavailable).
function measurementStatusChip(status) {
  if (status === "PROVISIONAL" || status === "BENCHMARK_PROVISIONAL" || status === "EXPLORATORY_PROVISIONAL") return chip("warn", "~", "Provisional");
  if (status === "PARTIAL") return chip("open", "○", "Partial");
  if (status === "NOT_APPLICABLE") return chip("na", "—", "N/A");
  return chip("unk", "?", "Unavailable");
}

const SHOWN_MEASUREMENT_STATUSES = ["PROVISIONAL", "BENCHMARK_PROVISIONAL", "PARTIAL"];

// El backend puede declarar PARTIAL sin valor (§5.5: la cobertura incompleta no se
// pliega dentro de V); se muestra como Partial, no como Unavailable.
function measurementCell(value, status, unit, readiness, { signed = false } = {}) {
  const hasValue = typeof value === "number" && Number.isFinite(value);
  if (!hasValue) {
    if (status === "NOT_APPLICABLE") return measurementStatusChip(status);
    if (status === "PARTIAL") return `<span class="withheld" data-status="PARTIAL">NO VALUE</span> ${measurementStatusChip(status)}`;
    return `<span class="withheld" data-status="UNAVAILABLE">UNAVAILABLE</span> ${measurementStatusChip("UNAVAILABLE")}`;
  }
  if (!SHOWN_MEASUREMENT_STATUSES.includes(status)) {
    return `<span class="withheld" data-status="UNAVAILABLE">UNAVAILABLE</span> ${measurementStatusChip("UNAVAILABLE")}`;
  }
  const sign = signed && value > 0 ? "+" : "";
  const formatted = `${sign}${value.toFixed(3)}${unit}`;
  const provenance = readiness.provenance;
  return `<span class="value mono" data-status="${esc(status)}" data-value="${esc(value)}" data-artifact-sha="${esc(provenance.artifactSha256)}">${esc(formatted)}</span> ${measurementStatusChip(status)}<div class="tiny muted">artifact ${esc(provenance.artifactPath)} · sha256 ${esc(provenance.artifactSha256.slice(0, 12))}…</div>`;
}

// §5.5: "Cobertura incompleta se informa por separado y no se oculta dentro de V".
function coverageCell(arm) {
  if (arm == null) return `<span class="withheld" data-status="UNAVAILABLE">UNAVAILABLE</span>`;
  const bought = Number.isFinite(arm.boughtMw) ? arm.boughtMw : "?";
  const target = Number.isFinite(arm.targetMw) ? arm.targetMw : "?";
  const completeness = arm.coverageCompleteness ?? "UNAVAILABLE";
  const coverageChip = completeness === "FULL"
    ? chip("na", "■", "Full")
    : completeness === "PARTIAL" ? chip("open", "○", "Partial coverage") : chip("unk", "?", "Unavailable");
  return `<span class="mono" data-coverage="${esc(completeness)}">${esc(bought)} / ${esc(target)} MW</span> ${coverageChip}`;
}

function backtestMeasurementHtml(readiness) {
  if (readiness == null) {
    return `<section class="card" style="margin-top:14px" data-kind="backend-measurements" data-status="UNAVAILABLE"><div class="hd"><h3>Backend measurement readiness</h3>${chip("unk", "?", "Unavailable")}</div><div class="bd">${unknownValue()} <span class="small muted">Verified BT-02 measurement artifact is unavailable; no values are inferred.</span></div></section>`;
  }
  const provenance = readiness.provenance;
  const rows = readiness.campaigns.flatMap((campaign) => {
    const arms = campaign.arms.length > 0 ? campaign.arms : [null];
    return arms.map((arm) => {
      const benchmark = campaign.benchmark;
      const blockers = [
        campaign.fees?.status === "UNKNOWN" ? "Fees UNKNOWN; excluded." : null,
        arm?.hCostReason,
        arm?.vReason,
        arm?.deltaVReason,
        benchmark?.status === "BENCHMARK_PROVISIONAL" ? `B coverage ${benchmark.coverage ?? "UNAVAILABLE"}.` : null,
      ].filter(Boolean);
      const bValue = benchmark?.B;
      const bStatus = benchmark?.status ?? "UNAVAILABLE";
      return `<tr data-campaign="${esc(campaign.campaignKey)}" data-status="${esc(campaign.status)}" data-arm="${esc(arm?.armId ?? "UNAVAILABLE")}" data-artifact-sha="${esc(provenance.artifactSha256)}">
        <td><span class="mono">${esc(campaign.campaignKey)}</span><div class="tiny muted">${esc(campaign.product ?? "product unavailable")} · ${esc(campaign.maturity ?? "maturity unavailable")}</div></td>
        <td>${esc(arm?.armId ?? "UNAVAILABLE")}<div class="tiny muted">${esc(arm ? `run ${arm.runStatus ?? "UNAVAILABLE"}` : campaign.campaignReadiness ?? campaign.status)}</div></td>
        <td>${coverageCell(arm)}</td>
        <td class="right">${measurementCell(bValue, bStatus, " €/MWh", readiness)}<div class="tiny muted" data-artifact-sha="${esc(provenance.artifactSha256)}">coverage ${esc(benchmark?.coverage ?? "UNAVAILABLE")}</div></td>
        <td class="right">${measurementCell(arm?.hEurMwh, arm?.hCostCompleteness, " €/MWh", readiness)}${arm?.coverageCompleteness === "PARTIAL" ? `<div class="tiny muted" data-coverage="PARTIAL">over ${esc(arm.boughtMw ?? "?")} / ${esc(arm.targetMw ?? "?")} MW only</div>` : ""}${arm?.hCostReason ? `<div class="tiny muted">${esc(arm.hCostReason)}</div>` : ""}</td>
        <td class="right">${measurementCell(arm?.vEurMwh, arm?.vStatus, " €/MWh", readiness, { signed: true })}${arm?.vReason ? `<div class="tiny muted">${esc(arm.vReason)}</div>` : ""}</td>
        <td class="right">${measurementCell(arm?.deltaVEurMwh, arm?.deltaVStatus, " €/MWh", readiness, { signed: true })}${arm?.deltaVReason ? `<div class="tiny muted">${esc(arm.deltaVReason)}</div>` : ""}</td>
        <td>${blockers.length > 0 ? blockers.map((reason) => `<div class="tiny muted">${esc(reason)}</div>`).join("") : measurementStatusChip(campaign.status)}</td>
      </tr>`;
    });
  });
  const official = readiness.official;
  return `<section class="card" style="margin-top:14px" data-kind="backend-measurements" data-status="${esc(readiness.status)}">
    <div class="hd"><h3>Campaign measurements · backend readiness</h3>${measurementStatusChip(readiness.status)}<span class="grow"></span><span class="tiny muted">BT-02 · verified artifact</span></div>
    <div class="bd"><p class="tiny muted">Values and statuses are projected from ${esc(provenance.artifactPath)}; no economic calculation is performed in the UI. Provisional and partial measurements retain their backend blockers.</p>
      <div style="overflow:auto"><table class="t"><thead><tr><th>Campaign</th><th>Arm</th><th>Coverage (bought / target)</th><th class="right">B · €/MWh</th><th class="right">H · €/MWh</th><th class="right">V · €/MWh</th><th class="right">ΔV · €/MWh</th><th>Readiness / blockers</th></tr></thead><tbody>${rows.join("")}</tbody></table></div>
      <div class="chk" data-status="${esc(official.status)}"><span><b>Official / canonical</b></span>${measurementStatusChip(official.status)}<span class="d">${esc(official.reason)}</span><span class="tiny muted">manifest sha256 ${esc(provenance.manifestSha256)}</span></div>
    </div>
  </section>`;
}

function pairedEffectSvg(block, pointDetails = null) {
  const width = 800;
  const height = 330;
  const pad = { left: 50, right: 20, top: 20, bottom: 40 };
  const series = Object.entries(block.paired).filter(([, value]) => value.points.length > 0);
  const all = series.flatMap(([, value]) => value.points).concat([0]);
  const maxAbs = Math.max(1, ...all.map((value) => Math.abs(value)));
  const count = Math.max(...series.map(([, value]) => value.points.length), 1);
  const x = (index) => pad.left + (index / Math.max(1, count - 1)) * (width - pad.left - pad.right);
  const y = (value) => pad.top + ((maxAbs - value) / (2 * maxAbs)) * (height - pad.top - pad.bottom);
  const grid = `<g class="axis">${[-maxAbs, -maxAbs / 2, 0, maxAbs / 2, maxAbs].map((value) => `<line x1="${pad.left}" x2="${width - pad.right}" y1="${y(value)}" y2="${y(value)}" ${value === 0 ? 'stroke="var(--ink-3)"' : 'stroke-dasharray="2 3"'}/><text x="${pad.left - 6}" y="${y(value) + 3.5}" text-anchor="end">${value === 0 ? "0" : kEur(value)}</text>`).join("")}</g>`;
  const boundaries = (series[0]?.[1].boundaries ?? []).map((boundary) => `<line x1="${x(boundary.index)}" x2="${x(boundary.index)}" y1="${pad.top}" y2="${height - pad.bottom}" stroke="var(--rule)" stroke-dasharray="3 3"/><text x="${x(boundary.index) + 3}" y="${height - pad.bottom + 14}" font-size="9" fill="var(--ink-3)">${esc(boundary.maturity)}</text>`).join("");
  const lines = series.map(([armId, value]) => {
    const path = value.points.map((point, index) => `${index === 0 ? "M" : "L"}${x(index).toFixed(1)},${y(point).toFixed(1)}`).join(" ");
    const last = value.points.length - 1;
    return `<path d="${path}" fill="none" stroke="${EXP_ARM_SWATCH[armId]}" stroke-width="2"/><circle cx="${x(last)}" cy="${y(value.points[last])}" r="4" fill="${EXP_ARM_SWATCH[armId]}" stroke="var(--surface)" stroke-width="2"/><text x="${x(last) - 8}" y="${y(value.points[last]) - 8}" font-size="11" text-anchor="end" fill="var(--ink)" font-weight="600" paint-order="stroke" stroke="var(--surface)" stroke-width="4">${esc(EXP_ARM_SHORT[armId])} ${kEur(value.finalKeur)}</text>`;
  }).join("");
  const hover = pairedHoverLayerSvg({ series, pointDetails, count, x, y, top: pad.top, bottom: height - pad.bottom, step: (width - pad.left - pad.right) / Math.max(1, count - 1) });
  return `<svg viewBox="0 0 ${width} ${height}" width="100%" role="img" aria-label="Cumulative ΔV vs baseline by decision, k€">${grid}${boundaries}${lines}<text x="${pad.left}" y="12" font-size="10" fill="var(--ink-3)">k€</text>${hover}</svg>`;
}

// UI-06 (owner request 25-sep-2026, PLAN_STATUS UI-06; prototipo aprobado
// UI-05-prototipo-2026-09-25/prototipo-ui05.html sha256 a79c8652…, pestaña Backtests):
// una franja transparente por decisión. Las posiciones del cursor y de los marcadores
// se fijan aquí; el script del navegador solo las copia, no calcula.
function pairedHoverLayerSvg({ series, pointDetails, count, x, y, top, bottom, step }) {
  if (!Array.isArray(pointDetails) || pointDetails.length !== count) return "";
  const hits = pointDetails.map((detail, index) => {
    const markers = series.map(([armId, value]) => (typeof value.points[index] === "number" ? `${armId}:${y(value.points[index]).toFixed(1)}` : "")).filter(Boolean).join(" ");
    return `<rect class="pphit" data-pp="${index}" data-cx="${x(index).toFixed(1)}" data-marks="${esc(markers)}" x="${(x(index) - step / 2).toFixed(1)}" y="${top}" width="${step.toFixed(2)}" height="${bottom - top}" fill="transparent"/>`;
  }).join("");
  const markers = series.map(([armId]) => `<circle class="ppmark" data-mark-arm="${esc(armId)}" r="4" cx="-10" cy="-10" fill="${EXP_ARM_SWATCH[armId]}" stroke="var(--surface)" stroke-width="2" pointer-events="none"/>`).join("");
  return `<line class="ppcursor" x1="-10" x2="-10" y1="${top}" y2="${bottom}" stroke="var(--ink-3)" stroke-dasharray="2 2" pointer-events="none"/>${markers}<g class="pphits">${hits}</g>`;
}

const UNAVAILABLE_TEXT = "UNAVAILABLE";

function mwText(value) {
  return typeof value === "number" && Number.isFinite(value) ? `${value} MW` : UNAVAILABLE_TEXT;
}

// Tres decimales: los asks del artifact tienen milésimas (28.125) y dos decimales las redondearían.
function eur3(value) {
  return typeof value === "number" && Number.isFinite(value) ? value.toFixed(3) : UNAVAILABLE_TEXT;
}

function kEurDecision(valueEur) {
  if (typeof valueEur !== "number" || !Number.isFinite(valueEur)) return null;
  const keur = valueEur / 1000;
  return `${keur > 0 ? "+" : ""}${keur.toFixed(2)} k€`;
}

function pairedTipArmRow(armId, arm, detail) {
  const label = EXP_ARM_SHORT[armId];
  if (armId === "ARM_B") {
    return { arm: armId, label, unavailable: `per-day ledger ${UNAVAILABLE_TEXT} (slot ${detail.armBSlot ?? UNAVAILABLE_TEXT}; not emitted by the backtest)` };
  }
  if (!arm) {
    return { arm: armId, label, unavailable: `daily ledger ${UNAVAILABLE_TEXT} for this campaign in the artifact` };
  }
  const soFar = typeof arm.boughtSoFarMw === "number" && typeof detail.targetMw === "number" ? `${arm.boughtSoFarMw} of ${detail.targetMw} MW` : UNAVAILABLE_TEXT;
  return {
    arm: armId,
    label,
    cells: [arm.status ?? UNAVAILABLE_TEXT, mwText(arm.filledMw), arm.fillPriceEurMwh === null ? "— (no fill)" : `${eur3(arm.fillPriceEurMwh)} €/MWh`, soFar],
  };
}

// Textos del tooltip formateados en el servidor desde la proyección del view-model
// (projectPairedPoints). Campo ausente = UNAVAILABLE, nunca un valor supuesto.
function pairedTipModel(detail, product, provenance) {
  const deltaA = kEurDecision(detail.decisionDeltaVEur.ARM_A);
  const cumulative = (armId) => (typeof detail.cumulativeKeur[armId] === "number" ? `${kEur(detail.cumulativeKeur[armId])} k€` : UNAVAILABLE_TEXT);
  const slot = detail.bestAsk?.slot ?? "11:00";
  return {
    head: `${detail.day ?? UNAVAILABLE_TEXT} · decision ${detail.decisionNumber} of ${detail.decisionsInCampaign}`,
    sub: `${detail.campaignId ?? UNAVAILABLE_TEXT} · ${PRODUCT_TITLE[product] ?? product} · delivery ${detail.deliveryLabel} · target ${mwText(detail.targetMw)}`,
    rows: detail.ledgerAvailable
      ? ["BASELINE", "ARM_A", "ARM_B"].map((armId) => pairedTipArmRow(armId, detail.arms[armId], detail))
      : [{ arm: "ALL", label: "All arms", unavailable: `daily ledger ${UNAVAILABLE_TEXT}: the artifact does not align this campaign's decisions with the chart` }],
    facts: [
      [`best ask ${slot} Berlin`, detail.bestAsk ? `${eur3(detail.bestAsk.eurMwh)} €/MWh${detail.bestAsk.quoteTm ? ` · quote ${detail.bestAsk.quoteTm}` : ""}` : UNAVAILABLE_TEXT],
      ["ΔV this decision", `A ${deltaA ?? `${UNAVAILABLE_TEXT} (emitted only on Arm A buy days)`} · B ${UNAVAILABLE_TEXT}`],
      ["ΔV cumulative", `A ${cumulative("ARM_A")} · B ${cumulative("ARM_B")}`],
    ],
    foot: `EXPLORATORY · B* proxy · fees UNKNOWN (excluded, not zero) · ${provenance?.resultsPath ?? "artifact"} sha256 ${(provenance?.resultsSha256 ?? UNAVAILABLE_TEXT).slice(0, 12)}…`,
  };
}

function pairedTipDataScript(pointDetails, product, provenance) {
  if (!Array.isArray(pointDetails) || pointDetails.length === 0) return "";
  const models = pointDetails.map((detail) => pairedTipModel(detail, product, provenance));
  // "<" escapado: el JSON no puede cerrar el <script> que lo contiene.
  const json = JSON.stringify(models).replaceAll("<", "\\u003c");
  return `<script type="application/json" class="ppdata">${json}</script>`;
}

function distributionSvg(dist, armId) {
  const width = 380;
  const height = 150;
  const pad = { left: 30, right: 18, top: 18, bottom: 24 };
  const peak = Math.max(1, ...dist.counts);
  const yOf = (count) => pad.top + (1 - count / peak) * (height - pad.top - pad.bottom);
  const yAxis = `<g class="axis">${[0, Math.round(peak / 2), peak].map((count) => `<line x1="${pad.left}" x2="${width - pad.right}" y1="${yOf(count)}" y2="${yOf(count)}" ${count ? 'stroke-dasharray="2 3"' : ""}/><text x="${pad.left - 5}" y="${yOf(count) + 3.5}" text-anchor="end">${count}</text>`).join("")}</g>`;
  const barWidth = (width - pad.left - pad.right) / dist.bins;
  const bars = dist.counts.map((count, index) => {
    const h = (count / peak) * (height - pad.top - pad.bottom);
    return `<rect x="${pad.left + index * barWidth + 1}" y="${height - pad.bottom - h}" width="${barWidth - 2}" height="${h}" rx="2" fill="${EXP_ARM_SWATCH[armId]}"><title>${(dist.min + index * ((dist.max - dist.min) / dist.bins)).toFixed(1)}: ${count}</title></rect>`;
  }).join("");
  const xOf = (value) => pad.left + ((value - dist.min) / (dist.max - dist.min)) * (width - pad.left - pad.right);
  const zero = `<line x1="${xOf(0)}" x2="${xOf(0)}" y1="${pad.top}" y2="${height - pad.bottom}" stroke="var(--ink-3)" stroke-dasharray="2 2"/>`;
  const mean = typeof dist.mean === "number" ? `<line x1="${xOf(dist.mean)}" x2="${xOf(dist.mean)}" y1="${pad.top - 4}" y2="${height - pad.bottom}" stroke="var(--ink)" stroke-width="1.5"/><text x="${xOf(dist.mean) + 4}" y="${pad.top + 4}" font-size="10.5" fill="var(--ink)" paint-order="stroke" stroke="var(--surface)" stroke-width="3">mean ${dist.mean > 0 ? "+" : ""}${dist.mean.toFixed(2)}</text>` : "";
  const ticks = [dist.min, dist.min / 2, 0, dist.max / 2, dist.max].map((value) => `<text x="${xOf(value)}" y="${height - 6}" font-size="9" text-anchor="middle" fill="var(--ink-3)">${value > 0 ? "+" : ""}${value}</text>`).join("");
  return `<svg viewBox="0 0 ${width} ${height}" width="100%" role="img" aria-label="H minus B* per decision">${yAxis}${bars}${zero}${mean}${ticks}</svg><div class="tiny muted">n = ${dist.n} decisions with a fill${dist.outside > 0 ? ` · ${dist.outside} outside ±${dist.max}` : ""} · P95 ${eur(dist.p95)}</div>`;
}

// Forest plot del mockup (forestSvg): una fila por episodio, un rombo por brazo.
// Todos los episodios exploratorios están cerrados, así que los rombos van llenos;
// no hay intervalo por episodio en el artifact y no se dibuja ninguno.
function acrossCampaignsHtml(block) {
  const values = block.acrossCampaigns.flatMap((entry) => Object.values(entry.arms)).filter((value) => typeof value === "number");
  const maxAbs = Math.max(1, ...values.map((value) => Math.abs(value)));
  const width = 380;
  const rowH = 20;
  const top = 8;
  const left = 70;
  const right = 16;
  const height = top + block.acrossCampaigns.length * rowH + 24;
  const x = (value) => left + ((value + maxAbs) / (2 * maxAbs)) * (width - left - right);
  let svg = `<svg viewBox="0 0 ${width} ${height}" width="100%" role="img" aria-label="ΔV per episode vs Baseline, k€">`;
  svg += `<g class="axis"><line x1="${x(0)}" x2="${x(0)}" y1="${top}" y2="${height - 20}" stroke="var(--ink-3)"/>`;
  for (const value of [-maxAbs, 0, maxAbs]) {
    svg += `<text x="${x(value)}" y="${height - 6}" text-anchor="${value < 0 ? "start" : value > 0 ? "end" : "middle"}">${value === 0 ? "0" : kEur(Math.round(value))}</text>`;
  }
  svg += "</g>";
  block.acrossCampaigns.forEach((entry, index) => {
    const cy = top + index * rowH + rowH / 2;
    svg += `<text x="0" y="${cy + 4}" font-size="11" fill="var(--ink)" font-family="var(--mono)">${esc(entry.maturity)}</text>`;
    const armValues = Object.entries(entry.arms);
    if (armValues.every(([, value]) => value === null)) {
      svg += `<rect x="${left}" y="${cy - 8}" width="${width - left - right}" height="16" fill="url(#emHatchU)" rx="2"/><text x="${(left + width - right) / 2}" y="${cy + 4}" text-anchor="middle" font-size="10.5" fill="var(--unk)" font-weight="700">NO ESTIMATE</text>`;
      return;
    }
    for (const [armId, value] of armValues) {
      if (typeof value !== "number") continue;
      svg += `<rect x="${x(value) - 5}" y="${cy - 5}" width="10" height="10" fill="${EXP_ARM_SWATCH[armId]}" stroke="${EXP_ARM_SWATCH[armId]}" stroke-width="2" transform="rotate(45 ${x(value)} ${cy})" data-tip="${esc(`${entry.maturity} · ${EXP_ARM_SHORT[armId]} ΔV ${kEur(value)} k€`)}"/>`;
    }
  });
  svg += "</svg>";
  return `${svg}<div class="tiny muted">◆ closed episode · ${Object.keys(block.paired).map((armId) => expArmTag(armId)).join(" ")} · hatched = no estimate (not zero)</div>`;
}

// Tabla desplegable del mockup bajo el efecto emparejado ("Show data table"), por
// episodio: B*, H y V tal como los publica el artifact (comparison.perEpisode).
function pairedDataTableHtml(block) {
  const armIds = ["BASELINE", "ARM_A", "ARM_B"].filter((armId) => block.perEpisode.some((episode) => episode.arms?.[armId]));
  const vKeur = (arm) => (typeof arm?.vEur === "number" ? kEur(arm.vEur / 1000) : "—");
  const rows = block.perEpisode.map((episode) => `<tr><td class="mono">${esc(episode.maturity)}</td><td class="mono right">${eur(episode.benchmark)}</td>${armIds.map((armId) => `<td class="mono right">${eur(episode.arms[armId]?.h)}</td>`).join("")}${armIds.map((armId) => `<td class="mono right">${vKeur(episode.arms[armId])}</td>`).join("")}</tr>`).join("");
  const head = `<th>Delivery</th><th class="right">B*</th>${armIds.map((armId) => `<th class="right">H ${esc(EXP_ARM_SHORT[armId])}</th>`).join("")}${armIds.map((armId) => `<th class="right">V ${esc(EXP_ARM_SHORT[armId])} k€</th>`).join("")}`;
  return `<details class="tbl"><summary>Show data table (${block.perEpisode.length} episodes, every arm)</summary><table class="t small"><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table></details>`;
}

function pairedChartHtml(block, product, pointDetails, provenance) {
  const svg = pairedEffectSvg(block, pointDetails);
  const interactive = Array.isArray(pointDetails) && pointDetails.length > 0;
  if (!interactive) {
    return `${svg}<div class="tiny muted" data-paired-detail="UNAVAILABLE">Per-decision detail ${UNAVAILABLE_TEXT}: the verified artifact does not carry it.</div>`;
  }
  return `<div class="ppwrap" data-paired-product="${esc(product)}">${svg}<div class="pptip" role="status" aria-live="polite"></div>${pairedTipDataScript(pointDetails, product, provenance)}</div><div class="tiny muted">Hover a point to read the decision. Click or tap to pin the tooltip; click again to release.</div>`;
}

function comparisonBlockHtml(block, product, pointDetails = null, provenance = null) {
  const checks = block.checks.map((check) => {
    const [kind, glyph, label] = CHECK_CHIP[check.status] ?? ["unk", "?", check.status];
    return `<div class="chk"><span><b>${esc(check.label)}</b></span>${chip(kind, glyph, label)}<span class="d">${esc(check.detail)}</span></div>`;
  }).join("");
  return `
  <div class="exp-product" data-product="${esc(product)}" style="margin-top:22px">
    <div class="mono muted small">${esc(product)} · exploratory paired comparison · real EEX best ask</div>
    <h2 class="sec">${esc(PRODUCT_TITLE[product] ?? product)}</h2>
    <div class="card" style="margin-top:10px">
      <div class="hd"><h3>Economic measures</h3><span class="small muted">B* proxy benchmark · H achieved price · V = (B* − H) × MWh · ΔV = V<sub>arm</sub> − V<sub>baseline</sub></span><span class="grow"></span>${chip("warn", "!", "EXPLORATORY · B* is a proxy")}</div>
      ${comparisonTableHtml(block)}
    </div>
    <div class="grid" style="grid-template-columns: minmax(0,1.7fr) minmax(0,1fr); margin-top:14px">
      <div class="card"><div class="hd"><h3>Paired effect over the campaigns</h3><span class="small muted">cumulative ΔV vs Baseline, k€, by decision</span></div><div class="bd" data-kind="paired">${pairedChartHtml(block, product, pointDetails, provenance)}${pairedDataTableHtml(block)}</div></div>
      <div class="card"><div class="hd"><h3>Method &amp; integrity</h3><span class="small muted">from backend</span></div><div class="bd">${checks}<div class="sp"></div><div class="note-ev"><span class="ev">EVIDENCE</span> Exploratory, in-sample, ${block.table[0].total} episodes. It does not approve a strategy.</div></div></div>
    </div>
    <div class="grid" style="grid-template-columns: minmax(0,1fr) minmax(0,1fr) minmax(0,1fr); margin-top:14px">
      <div class="card"><div class="hd"><h3>${expArmTag("BASELINE")}</h3><span class="small muted">H − B* per decision, €/MWh (lower is better)</span></div><div class="bd" data-kind="distribution">${distributionSvg(block.distributions.BASELINE, "BASELINE")}</div></div>
      <div class="card"><div class="hd"><h3>${expArmTag("ARM_A")}</h3><span class="small muted">H − B* per decision, €/MWh (lower is better)</span></div><div class="bd" data-kind="distribution">${distributionSvg(block.distributions.ARM_A, "ARM_A")}</div></div>
      <div class="card"><div class="hd"><h3>Across campaigns</h3><span class="small muted">ΔV vs Baseline, k€</span></div><div class="bd" data-kind="campaign-effects">${acrossCampaignsHtml(block)}</div></div>
    </div>
  </div>`;
}

function exploratoryComparisonHtml(exploratory) {
  if (!exploratory?.comparison) {
    return "";
  }
  const blocks = Object.entries(exploratory.comparison).map(([product, block]) => comparisonBlockHtml(block, product, exploratory.pairedPoints?.[product] ?? null, exploratory.provenance)).join("");
  return `${PAIRED_TIP_CSS}${blocks}${PAIRED_TIP_SCRIPT}`;
}

const PAIRED_TIP_CSS = `<style>
.ppwrap { position: relative; }
.ppwrap .pphit { cursor: crosshair; }
.pptip { position: absolute; top: 8px; display: none; z-index: 5; min-width: 320px; max-width: 460px; background: var(--surface); border: 1px solid var(--rule); border-radius: 6px; box-shadow: 0 6px 20px rgba(0,0,0,.12); padding: 9px 11px; font-size: 12px; line-height: 1.5; pointer-events: none; }
.pptip.on { display: block; }
.pptip.pinned { pointer-events: auto; border-color: var(--ink); }
.pptip .t-head { font: 700 13px var(--serif); }
.pptip .t-sub { font: 11px var(--mono); color: var(--ink-3); margin-bottom: 6px; }
.pptip table { border-collapse: collapse; width: 100%; font: 11px var(--mono); }
.pptip th { text-align: left; color: var(--ink-3); font-weight: 400; padding: 2px 6px 2px 0; }
.pptip td { padding: 2px 6px 2px 0; }
.pptip td:first-child, .pptip th { white-space: nowrap; }
.pptip .sw { display: inline-block; width: 8px; height: 8px; border-radius: 2px; margin-right: 4px; }
.pptip .unav { color: var(--unk); }
.pptip .foot { margin-top: 6px; font: 10px var(--mono); color: var(--ink-3); }
</style>`;

// Solo presentación: lee los textos ya formateados del JSON y las posiciones de data-*.
const PAIRED_TIP_SCRIPT = `<script>
(function () {
  "use strict";
  var SWATCH = { BASELINE: "var(--arm-base)", ARM_A: "var(--arm-a)", ARM_B: "var(--arm-b)" };
  function el(tag, cls, text) { var node = document.createElement(tag); if (cls) { node.className = cls; } if (text !== undefined) { node.textContent = text; } return node; }
  function fill(tip, model) {
    tip.textContent = "";
    tip.appendChild(el("div", "t-head", model.head));
    tip.appendChild(el("div", "t-sub", model.sub));
    var table = el("table");
    var head = el("tr");
    ["", "action", "bought today", "fill price", "bought so far"].forEach(function (label) { head.appendChild(el("th", "", label)); });
    table.appendChild(head);
    model.rows.forEach(function (row) {
      var tr = el("tr"); tr.setAttribute("data-tip-arm", row.arm);
      var name = el("td"); var sw = el("span", "sw"); sw.style.background = SWATCH[row.arm] || "var(--ink-3)"; name.appendChild(sw); name.appendChild(document.createTextNode(row.label)); tr.appendChild(name);
      if (row.unavailable) { var cell = el("td", "unav", row.unavailable); cell.colSpan = 4; tr.appendChild(cell); }
      else { row.cells.forEach(function (text) { tr.appendChild(el("td", "", text)); }); }
      table.appendChild(tr);
    });
    tip.appendChild(table);
    var facts = el("table"); facts.style.marginTop = "6px";
    model.facts.forEach(function (fact) { var tr = el("tr"); tr.appendChild(el("th", "", fact[0])); tr.appendChild(el("td", "", fact[1])); facts.appendChild(tr); });
    tip.appendChild(facts);
    tip.appendChild(el("div", "foot", model.foot));
  }
  document.querySelectorAll(".ppwrap").forEach(function (wrap) {
    var data = wrap.querySelector("script.ppdata"); var tip = wrap.querySelector(".pptip"); var svg = wrap.querySelector("svg");
    if (!data || !tip || !svg) { return; }
    var models = JSON.parse(data.textContent);
    var cursor = svg.querySelector(".ppcursor");
    var marks = svg.querySelectorAll(".ppmark");
    var pinned = null;
    function show(hit) {
      var index = Number(hit.getAttribute("data-pp")); var model = models[index]; if (!model) { return; }
      var cx = hit.getAttribute("data-cx");
      cursor.setAttribute("x1", cx); cursor.setAttribute("x2", cx);
      var ys = {}; (hit.getAttribute("data-marks") || "").split(" ").forEach(function (pair) { var parts = pair.split(":"); if (parts.length === 2) { ys[parts[0]] = parts[1]; } });
      marks.forEach(function (mark) { var arm = mark.getAttribute("data-mark-arm"); mark.setAttribute("cx", ys[arm] ? cx : "-10"); mark.setAttribute("cy", ys[arm] || "-10"); });
      fill(tip, model); tip.setAttribute("data-pp", String(index)); tip.classList.add("on");
      var box = wrap.getBoundingClientRect(); var hitBox = hit.getBoundingClientRect(); var px = hitBox.left + hitBox.width / 2 - box.left;
      tip.style.left = (px > box.width * 0.6 ? px - tip.offsetWidth - 14 : px + 14) + "px";
    }
    function hide() { tip.classList.remove("on"); cursor.setAttribute("x1", "-10"); cursor.setAttribute("x2", "-10"); marks.forEach(function (mark) { mark.setAttribute("cx", "-10"); }); }
    svg.addEventListener("mouseover", function (event) { var hit = event.target.closest(".pphit"); if (hit && pinned === null) { show(hit); } });
    svg.addEventListener("mouseleave", function () { if (pinned === null) { hide(); } });
    svg.addEventListener("click", function (event) {
      var hit = event.target.closest(".pphit"); if (!hit) { return; }
      var index = hit.getAttribute("data-pp");
      if (pinned === index) { pinned = null; tip.classList.remove("pinned"); return; }
      pinned = index; tip.classList.add("pinned"); show(hit);
    });
  });
})();
</script>`;

// ---------- Campaigns & Runs, Replay y Research exploratorios (owner patch 02 §4) ----------
// UI-05 (owner request 25-sep-2026, PLAN_STATUS UI-05): misma anatomía que el mockup
// DES-01 (design-proposal/index.html, rama des-01-blind: viewCampaigns, viewReplay,
// viewResearch). Cada campaign/decisión/candidato es una sección y la navegación es
// por ancla (#id) sin JavaScript. Los datos llegan calculados del artifact exploratorio
// verificado por hash; donde el artifact no trae el dato, la ranura dice UNKNOWN.

const GATE_CHIP = {
  PASS: ["pass", "✓", "Pass"],
  FAIL: ["fail", "✕", "Fail"],
  DEGRADED: ["warn", "!", "Degraded"],
};
const RUN_CHIP = {
  COMPLETE: ["pass", "✓", "Complete"],
  INCOMPLETE: ["fail", "✕", "Incomplete"],
  NOT_RUN: ["unk", "?", "Not run"],
};
const MISSION_TITLE = { G0BQ: "Gas Quarterly", G0BM: "Gas Monthly" };
const OWNER_PATCH_02 = "EM-SPEC-OWNER-PATCH-2026-09-24-02";
const RAIL_ON = "background:#ece9e1;box-shadow:inset 3px 0 0 var(--ink)";

const TARGET_SWITCH_CSS = `<style>
.xsel { display: none; }
.xsel:target { display: block; }
.xwrap:not(:has(.xsel:target)) .xsel.xdefault { display: block; }
.xlist a { text-decoration: none; color: inherit; }
</style>`;

// El rail del mockup marca el ítem abierto (.it.on); sin JavaScript eso sale de :target.
function railSelectionCss(ids, defaultId) {
  const rules = ids.map((id) => `.xwrap:has(#${id}:target) .it[href="#${id}"] { ${RAIL_ON}; }`);
  rules.push(`.xwrap:not(:has(.xsel:target)) .it[href="#${defaultId}"] { ${RAIL_ON}; }`);
  return `<style>${rules.join("\n")}</style>`;
}

function deliveryLabel(maturity) {
  return `${maturity.slice(0, 4)}-${maturity.slice(4, 6)}`;
}

function decisionNumber(index) {
  return `#${String(index + 1).padStart(3, "0")}`;
}

// Los mismos artifacts respaldan cada run y cada candidato con runs: se listan una vez
// y el recuento de receipts sale de esta lista. Los manifests no traen fecha de
// registro, así que "Recorded" queda explícito como no registrado.
function exploratoryReceipts(provenance) {
  return [
    { id: provenance.resultsSha256.slice(0, 12), kind: "BACKTEST RESULT", what: `${provenance.resultsPath} · sha256 ${provenance.resultsSha256.slice(0, 16)}…`, href: "/backtests" },
    { id: provenance.slotsSha256.slice(0, 12), kind: "DATA SNAPSHOT", what: `EEX THE best-ask slots · sha256 ${provenance.slotsSha256.slice(0, 16)}…`, href: "/campaigns" },
    { id: "MANIFEST", kind: "MANIFEST", what: provenance.manifestPath, href: "/campaigns" },
    { id: OWNER_PATCH_02, kind: "OWNER DECISION", what: "exploratory phase authorised (owner patch 02)", href: null },
  ];
}

const NOT_RECORDED = '<span class="mono small muted" style="white-space:nowrap" title="the manifests carry no recording timestamp">not recorded</span>';

// ---------- Campaigns & Runs ----------

function campaignReadinessChip(campaign, { detail = false } = {}) {
  if (campaign.readiness === "EXPLORATORY_COMPLETE") {
    return detail ? chip("warn", "◇", "Exploratory · not final evidence") : chip("warn", "◇", "Exploratory · complete");
  }
  return chip("unk", "?", "Insufficient data");
}

// Rail por misión (Bru 2026-09-25, P-008; prototipo UI-05-prototipo-2026-09-25 pestaña
// Campaigns). Grupos, recuentos, entrega y ventana llegan del view model; aquí solo se pintan.
function campaignGroupSummary(group) {
  if (group.total === 0) {
    return "no data yet";
  }
  return `${group.total} campaigns · ${group.complete} complete · ${group.insufficient} insufficient`;
}

function campaignRailRowHtml(row) {
  const dot = row.readiness === "EXPLORATORY_COMPLETE" ? "ok" : "insuf";
  const window = row.window
    ? `${esc(row.window.firstDay)} → ${esc(row.window.lastDay)}`
    : '<span class="unkv">UNAVAILABLE</span>';
  return `<a class="it crow" href="#cmp-${esc(row.id)}" data-campaign-row="${esc(row.id)}" title="${esc(row.id)} · ${esc(row.readinessLabel)}">
        <span class="cdot ${dot}" aria-label="${esc(row.readinessLabel)}"></span>
        <span class="cdel">${esc(row.deliveryLabel)}</span>
        <span class="cwin">${window}</span>
      </a>`;
}

function campaignGroupsHtml(groups, selectedId) {
  return groups.map((group) => {
    const isOpen = group.campaigns.some((row) => row.id === selectedId);
    const body = group.total === 0
      ? '<div class="cempty">no campaign in the verified artifact</div>'
      : group.campaigns.map(campaignRailRowHtml).join("");
    return `<details class="cgrp" data-mission="${esc(group.mission)}"${isOpen ? " open" : ""}>
      <summary><span><span class="cname">${esc(group.mission)}</span><span class="csum">${esc(campaignGroupSummary(group))}</span></span><span class="caret"></span></summary>
      <div class="cbody">${body}</div>
    </details>`;
  }).join("");
}

// Al navegar a una campaign (#cmp-…) solo queda abierto el grupo que la contiene.
const CAMPAIGN_GROUP_SCRIPT = `<script>
(function () {
  function syncGroups() {
    var row = document.querySelector('.crail a[href="' + location.hash + '"]');
    if (!row) { return; }
    document.querySelectorAll(".crail details.cgrp").forEach(function (group) { group.open = group.contains(row); });
  }
  window.addEventListener("hashchange", syncGroups);
  syncGroups();
})();
</script>`;

// Barra del mockup: cerradas / abiertas / no corridas. Una decisión cuenta como cerrada
// sólo si el backend declara PASS en "Evaluation window closed"; el total de decisiones
// no corridas no viene en el artifact, así que sólo se afirma 0 cuando decisiones = días.
function decisionsBarHtml(run, campaign) {
  const closedGate = campaign.gates.find((gate) => gate.label === "Evaluation window closed");
  const closed = closedGate?.status === "PASS";
  const allRun = run.decisions === campaign.tradingDays;
  const segment = closed ? '<span class="closed" style="width:100%"></span>' : '<span class="open" style="width:100%"></span>';
  const counts = closed ? `${run.decisions} closed · 0 open` : `0 closed · ${run.decisions} open`;
  const notRun = allRun ? "0 not run" : '<span class="unkv" style="font-size:10.5px;line-height:15px">NOT RUN count UNKNOWN</span>';
  return `<div class="bar" title="closed / open / not run">${segment}</div>
        <div class="small num" style="margin-top:4px">${counts} · ${notRun}</div>
        <div class="tiny muted mono">${run.boughtMw}/${campaign.targetMw} MW · H ${eur(run.hEurMwh)} €/MWh</div>`;
}

function candidateByArm(research, armId) {
  return research?.candidates?.find((candidate) => candidate.armId === armId) ?? null;
}

function campaignDetailHtml(campaign, pages, isDefault) {
  const { campaignUnknowns: unknowns, provenance, research } = pages;
  const receipts = exploratoryReceipts(provenance);
  const gates = campaign.gates.map((gate) => {
    const [kind, glyph, label] = GATE_CHIP[gate.status] ?? ["unk", "?", gate.status];
    return `<div class="chk"><span>${esc(gate.label)}</span>${chip(kind, glyph, label)}<span class="d">${esc(gate.detail)}</span></div>`;
  }).join("");
  const unknownItems = unknowns.map((unknown) => `
      <div class="unk-item">
        <div class="row"><span class="mono small">${esc(unknown.id)}</span>${unknown.blocking ? chip("fail", "✕", "Blocks final economics") : chip("warn", "!", "Non-blocking")}</div>
        <div class="q">${esc(unknown.title)}</div>
        <div class="small ink2">${esc(unknown.detail)}</div>
        <div class="small"><span class="muted">Blocks:</span> ${esc(unknown.blocks)}</div>
      </div>`).join("");
  const replayEpisode = pages.replay.find((episode) => episode.product === campaign.product && episode.maturity === campaign.maturity);
  const runs = campaign.runs.map((run) => {
    const [kind, glyph, label] = RUN_CHIP[run.status] ?? ["unk", "?", run.status];
    const candidate = candidateByArm(research, run.armId);
    const drills = [
      run.armId === "ARM_A" && replayEpisode?.inspector?.length > 0 ? `<a href="/replay#rep-${esc(campaign.product)}-${esc(campaign.maturity)}">Replay</a>` : "",
      '<a href="/backtests">Backtest</a>',
      candidate ? `<a href="/research#res-${esc(candidate.id)}">Research</a>` : "",
    ].join("");
    return `<tr data-status="EXPLORATORY" data-run="${esc(campaign.id)}-${esc(run.armId)}">
        <td><div class="mono">EXP-${esc(campaign.id)}-${esc(run.armId)}</div><div class="small muted">slot ${esc(run.slot ?? "—")} Berlin</div></td>
        <td>${expArmTag(run.armId)}<div class="small muted">${esc(candidate?.name ?? "")}</div></td>
        <td>${chip(kind, glyph, label)}</td>
        <td style="min-width:190px">${decisionsBarHtml(run, campaign)}</td>
        <td title="the artifact carries no per-run determinism; the only check is global (Research · Replay determinism)">${chip("unk", "?", "UNKNOWN")}</td>
        <td class="num" title="shared receipts that bind this run">${receipts.length}</td>
        <td><span class="drill">${drills}</span></td>
      </tr>`;
  }).join("");
  const runsTable = campaign.runs.length === 0
    ? `<div class="bd"><span class="withheld">NO RUNS</span> <span class="small muted">the procurement window is not fully inside the data period; nothing is imputed</span></div>`
    : `<table class="t"><thead><tr><th>Run</th><th>Arm</th><th>Status</th><th>Decisions · evaluation</th><th>Determinism</th><th>Receipts</th><th>Drill down</th></tr></thead><tbody>${runs}</tbody></table>`;
  const legend = (cls, text) => `<span><span class="bar" style="display:inline-flex;min-width:24px;width:24px;vertical-align:-1px"><span class="${cls}" style="width:100%"></span></span> ${text}</span>`;
  // Receipts bind runs; a campaign without runs has nothing they could back (review UI05-RCP-01, same rule as Research NO RECEIPTS).
  const ledger = campaign.runs.length === 0
    ? '<span class="withheld">NO RECEIPTS</span> <span class="small muted">no run exists for this campaign</span>'
    : receipts.map((receipt) => `<div class="receipt">${NOT_RECORDED}<span><span class="ev">${esc(receipt.kind)}</span> ${esc(receipt.what)}</span><span class="mono small">${esc(receipt.id)}</span></div>`).join("");
  return `<section class="xsel${isDefault ? " xdefault" : ""}" id="cmp-${esc(campaign.id)}" data-campaign="${esc(campaign.id)}">
    <div class="row" style="align-items:flex-end">
      <div class="grow">
        <div class="mono muted small">${esc(campaign.id)} · THE ${esc(campaign.product)} · target ${campaign.targetMw} MW</div>
        <h1 class="page">${esc(MISSION_TITLE[campaign.product])} · delivery ${esc(deliveryLabel(campaign.maturity))}</h1>
        <p class="lede">${campaign.firstDay
          ? `Procure ${campaign.targetMw} MW between ${esc(campaign.firstDay)} and ${esc(campaign.lastDay)} (${campaign.tradingDays} EEX exchange days, client calendar rule), paying the real best ask. Which arm buys cheaper than the client's 11:00 practice?`
          : `Procure ${campaign.targetMw} MW on the client calendar. No quoted day of this window is inside the data period.`}</p>
      </div>
      <div style="text-align:right"><div class="caps muted">Campaign readiness</div><div style="margin-top:4px">${campaignReadinessChip(campaign, { detail: true })}</div></div>
    </div>
    <div class="grid g2" style="margin-top:16px">
      <div class="card"><div class="hd"><h3>Readiness gates</h3><span class="muted small">from backend · exploratory manifest</span></div><div class="bd">${gates}</div></div>
      <div class="card"><div class="hd"><h3>What we don't know</h3><span class="muted small">${unknowns.length} explicit unknowns · fail-closed</span></div><div class="bd">${unknownItems}</div></div>
    </div>
    <h2 class="sec">Runs</h2>
    <div class="card">${runsTable}</div>
    <div class="row small muted" style="margin-top:6px;gap:16px">${legend("closed", "evaluation closed")}${legend("open", "evaluation not closed")}${legend("notrun", "decision not run (unknown, not zero)")}</div>
    <h2 class="sec">Receipts</h2>
    <div class="card"><div class="bd">${ledger}</div></div>
  </section>`;
}

export function exploratoryCampaignsBody(exploratory) {
  const campaigns = exploratory.campaigns;
  const complete = campaigns.filter((campaign) => campaign.readiness === "EXPLORATORY_COMPLETE");
  const firstComplete = complete.find((campaign) => campaign.product === "G0BQ") ?? complete[0] ?? campaigns[0];
  const details = campaigns.map((campaign) => campaignDetailHtml(campaign, exploratory, campaign === firstComplete)).join("");
  return `${TARGET_SWITCH_CSS}${railSelectionCss(campaigns.map((campaign) => `cmp-${campaign.id}`), `cmp-${firstComplete.id}`)}
<section class="surface campaigns" data-surface="campaigns" data-exploratory="true">
  <div class="split xwrap">
    <div class="xlist">
      <div class="card crail">
        <div class="crail-title">CAMPAIGNS · ${campaigns.length}</div>
        ${campaignGroupsHtml(exploratory.campaignGroups, firstComplete.id)}
        <div class="clegend"><span><span class="cdot ok"></span>complete</span><span><span class="cdot insuf"></span>insufficient data</span></div>
      </div>
      <div class="small muted" style="margin-top:8px">Readiness shown here is reported by the backend. The UI does not compute or upgrade it.</div>
    </div>
    <div>${details}</div>
  </div>
</section>
${CAMPAIGN_GROUP_SCRIPT}`;
}

// ---------- Replay / Decision Inspector ----------

function replaySectionId(episode, item) {
  const idBase = `rep-${episode.product}-${episode.maturity}`;
  return episode.inspector[0]?.index === item.index ? idBase : `${idBase}-${item.index}`;
}

// B* es la media de los asks de 11:00 de toda la ventana (benchmarkNote del artifact),
// así que la evaluación de cada decisión cierra el último día de la ventana.
function evaluationCloses(episode) {
  return episode.ask11.at(-1)?.day ?? null;
}

// Tira de decisiones del mockup (timelineSvg): una marca por día hábil del brazo A,
// llena si compró; la seleccionada más alta; el punto negro marca las que tienen detalle.
function runTimelineSvg(episode, item) {
  const width = 1200;
  const height = 74;
  const left = 20;
  const right = 20;
  const days = episode.decisions?.ARM_A ?? [];
  const count = days.length;
  const x = (index) => left + (index / Math.max(1, count - 1)) * (width - left - right);
  const inspected = new Map(episode.inspector.map((entry) => [entry.index, entry]));
  let svg = `<svg viewBox="0 0 ${width} ${height}" width="100%" height="${height}" preserveAspectRatio="none" role="img" aria-label="Arm A decisions over the campaign window">`;
  svg += `<line x1="${left}" x2="${width - right}" y1="34" y2="34" stroke="var(--rule)"/>`;
  const closes = evaluationCloses(episode);
  if (count > 0) {
    const cx = x(item.index);
    svg += `<rect x="${cx}" y="42" width="${Math.max(2, x(count - 1) - cx)}" height="8" fill="var(--hind)" stroke="var(--hind)" stroke-width="1" opacity=".75"/>`;
    const labelRight = cx > width / 2;
    svg += `<text x="${labelRight ? cx - 6 : cx + 6}" y="61" text-anchor="${labelRight ? "end" : "start"}" font-size="10" fill="var(--hind)" font-weight="600">evaluation closed ${esc(closes)}</text>`;
  }
  days.forEach((day, index) => {
    const cx = x(index);
    const selected = index === item.index;
    const bought = day.status === "FILLED";
    const tip = `${decisionNumber(index)} · ${day.day} · ${bought ? `BUY ${day.filledMw} MW` : "WAIT"}`;
    let mark = `<rect x="${cx - 6}" y="20" width="12" height="28" fill="transparent"/>`;
    mark += `<rect x="${cx - 3.5}" y="${selected ? 23 : 27}" width="7" height="${selected ? 14 : 7}" rx="1" fill="${bought ? "var(--asof)" : "var(--surface)"}" stroke="var(--asof)" stroke-width="${selected ? 2 : 1.2}"/>`;
    if (inspected.has(index)) {
      mark += `<circle cx="${cx}" cy="17" r="2.2" fill="var(--ink)"/>`;
      svg += `<a href="#${esc(replaySectionId(episode, inspected.get(index)))}" data-tip="${esc(tip)}">${mark}</a>`;
      return;
    }
    svg += `<g data-tip="${esc(tip)}">${mark}</g>`;
  });
  days.forEach((day, index) => {
    if (index > 0 && days[index - 1].day.slice(0, 7) === day.day.slice(0, 7)) return;
    svg += `<text x="${x(index)}" y="72" font-size="10" fill="var(--ink-3)" text-anchor="${index === 0 ? "start" : "middle"}">${esc(day.day.slice(0, 7))}</text>`;
  });
  return `${svg}</svg>`;
}

// Gráfico "known at T₀" del mockup (priceSvg). Serie: ask de 11:00 de cada día de la
// ventana (artifact replay[].ask11). A la derecha de T₀ queda sellado; el overlay de
// hindsight dibuja allí, y sólo allí, lo que se conoció después.
function knownAtT0Svg(episode, item) {
  const width = 760;
  const height = 250;
  const L = 44;
  const R = 26;
  const T = 16;
  const B = 26;
  const points = episode.ask11;
  const values = points.map((point) => point.ask).filter((value) => typeof value === "number");
  const lo = Math.floor(Math.min(...values) - 0.5);
  const hi = Math.ceil(Math.max(...values) + 0.5);
  const count = points.length;
  const x = (index) => L + (index / Math.max(1, count - 1)) * (width - L - R);
  const y = (value) => T + ((hi - value) / (hi - lo)) * (height - T - B);
  const pathOf = (from, to) => {
    let d = "";
    let pen = "M";
    for (let index = from; index <= to; index += 1) {
      const ask = points[index]?.ask;
      if (typeof ask !== "number") {
        pen = "M";
        continue;
      }
      d += `${pen}${x(index).toFixed(1)} ${y(ask).toFixed(1)} `;
      pen = "L";
    }
    return d.trim();
  };
  const cut = x(item.index);
  const midLater = (cut + x(count - 1)) / 2;
  let svg = `<svg viewBox="0 0 ${width} ${height}" width="100%" role="img" aria-label="11:00 best ask as known at decision time">`;
  svg += `<g class="sealed-layer"><rect x="${cut}" y="${T}" width="${x(count - 1) - cut}" height="${height - T - B}" fill="var(--surface-2)"/>`;
  svg += `<text x="${midLater}" y="${height / 2 - 8}" text-anchor="middle" font-size="12.5" fill="var(--hind)" font-weight="600">Sealed: after T₀</text>`;
  svg += `<text x="${midLater}" y="${height / 2 + 10}" text-anchor="middle" font-size="11" fill="var(--ink-3)">Not known at decision time.</text>`;
  svg += `<text x="${midLater}" y="${height / 2 + 25}" text-anchor="middle" font-size="11" fill="var(--ink-3)">“Hindsight overlay” draws it here only.</text></g>`;
  svg += `<g class="hind-layer"><rect x="${cut}" y="${T}" width="${x(count - 1) - cut}" height="${height - T - B}" fill="url(#emHatchH)"/></g>`;
  svg += '<g class="axis">';
  const step = Math.max(1, Math.round((hi - lo) / 5));
  for (let value = lo; value <= hi; value += step) {
    svg += `<line x1="${L}" x2="${width - R}" y1="${y(value)}" y2="${y(value)}" stroke-dasharray="2 3"/><text x="${L - 6}" y="${y(value) + 3.5}" text-anchor="end">${value}</text>`;
  }
  svg += `<text x="${L}" y="${height - 8}" text-anchor="start">${esc(points[0].day)}</text>`;
  svg += `<text x="${cut}" y="${height - 8}" text-anchor="middle">T₀</text>`;
  svg += `<text x="${width - R}" y="${height - 8}" text-anchor="end">${esc(points.at(-1).day)}</text></g>`;
  svg += `<path d="${pathOf(0, item.index)}" fill="none" stroke="var(--asof)" stroke-width="2"/>`;
  svg += `<g class="hind-layer"><path d="${pathOf(item.index, count - 1)}" fill="none" stroke="var(--hind)" stroke-width="2" stroke-dasharray="5 3"/>`;
  svg += `<text x="${x(count - 1) - 4}" y="${height - B - 8}" text-anchor="end" font-size="10.5" fill="var(--hind)" font-weight="600">realised later</text></g>`;
  svg += `<line x1="${cut}" x2="${cut}" y1="${T - 6}" y2="${height - B}" stroke="var(--hind)" stroke-width="2" stroke-dasharray="4 3"/>`;
  svg += `<text x="${cut - 5}" y="${T + 4}" text-anchor="end" font-size="10.5" fill="var(--asof)" font-weight="700">KNOWN AT T₀</text>`;
  svg += `<text x="${cut + 5}" y="${T + 4}" font-size="10.5" fill="var(--hind)" font-weight="700">LATER</text>`;
  const selectedAsk = points[item.index]?.ask;
  if (typeof selectedAsk === "number") {
    svg += `<circle cx="${cut}" cy="${y(selectedAsk)}" r="4.5" fill="var(--asof)" stroke="var(--surface)" stroke-width="2" data-tip="${esc(`11:00 best ask ${eur(selectedAsk)} €/MWh · known at T₀`)}"/>`;
  }
  return `${svg}</svg>`;
}

function decisionSectionHtml(episode, item, isDefault) {
  const product = episode.product;
  const campaignId = `GAS-${product === "G0BQ" ? "Q" : "M"}-${episode.maturity}`;
  const others = episode.inspector.map((other) => {
    const active = other.index === item.index;
    return `<a class="btn${active ? " on" : ""}" href="#${esc(replaySectionId(episode, other))}">${decisionNumber(other.index)} · BUY ${other.filledMw} MW</a>`;
  }).join("");
  const closes = evaluationCloses(episode);
  const contract = `THE ${esc(product)} ${esc(deliveryLabel(episode.maturity))}`;
  const quoteClock = `${esc(item.quoteTm.slice(11, 19))}Z`;

  const rec = objCard("asof", "◆", "Recommendation", "T₀ 11:00", `
    <div class="big">BUY ${item.requestedMw} MW <span class="muted" style="font-size:13px">${contract}</span></div>
    <dl class="kv"><dt>Produced by</dt><dd class="mono">DIP10 v1-exp</dd>
      <dt>11:00 best ask</dt><dd class="mono">${eur(item.ask)} €/MWh</dd>
      <dt>Trigger mean</dt><dd>${unknownValue()} <span class="tiny muted">mean of previous ${item.pastAsksUsed} asks not emitted</span></dd></dl>
    <div class="tiny muted" style="margin-top:6px">Rule: buy the day's cap when the ask is below the mean of the previous 11:00 asks, otherwise the feasibility floor Lₜ. Rule-based output. Not an instruction, not an order.</div>`);
  const ord = objCard("exec", "▲", "Requested action", "T₀", `
    <div class="big">BUY ${item.requestedMw} MW</div>
    <dl class="kv"><dt>Time in force</dt><dd>${unknownValue()}</dd><dt>Requested by</dt><dd>simulated desk (validator)</dd><dt>Remaining after</dt><dd class="mono">${item.remainingMwAfter} MW</dd></dl>
    <div class="tiny muted" style="margin-top:6px">The validator requests what is recommended: one quantity field, same side.</div>`);
  const depthNote = typeof item.askSz === "number" && item.filledMw > item.askSz
    ? `<div class="gapnote"><b>Depth:</b> ${item.filledMw} MW filled against ${item.askSz} MW visible at the ask. Client rule assumes full fill; the depth-capped variant is in Backtests.</div>`
    : "";
  const fill = objCard("exec", "■", "Execution · fill", `quote ${quoteClock}`, `
    <div class="row" style="margin-bottom:4px"><span class="st warn"><span class="g">⚙</span>SIMULATED · ask + 0.15</span></div>
    <div class="big">${item.filledMw} of ${item.requestedMw} MW <span class="muted" style="font-size:13px">avg ${eur(item.priceEurMwh)}</span></div>
    <table class="t small"><tbody><tr><td class="mono">${quoteClock}</td><td class="num">${item.filledMw} MW</td><td class="num right mono">${eur(item.priceEurMwh)}</td></tr></tbody></table>
    ${depthNote}`);
  const out = objCard("hind", "●", "Outcome · evaluation", "window end", `
    <div class="row" style="margin-bottom:4px">${chip("pass", "✓", `Evaluation closed ${esc(closes)}`)}</div>
    <div class="big">ΔV ${kEur(item.deltaVEur / 1000)} k€ <span class="muted" style="font-size:13px">vs Baseline</span></div>
    <dl class="kv"><dt>B* benchmark</dt><dd class="mono">${eur(episode.benchmark)}</dd><dt>H this fill</dt><dd class="mono">${eur(item.priceEurMwh)}</dd><dt>Baseline same day</dt><dd class="mono">${item.baseline.filledMw} MW${item.baseline.priceEurMwh === null ? "" : ` at ${eur(item.baseline.priceEurMwh)}`}</dd></dl>
    <div class="tiny muted" style="margin-top:6px">Computed after the window closed. B* is a proxy (U-EM-2).</div>`);

  const inputRow = (label, value, observed, age, state) => `<tr><td>${label}</td><td class="mono num">${value}</td><td class="mono small">${observed}</td><td class="small">${age}</td><td>${state}</td></tr>`;
  // Frescura: el loader descarta quotes con más de 15 min (build_tob_slots.py:25 MAX_AGE_S).
  const fresh = chip("pass", "✓", "Fresh");
  const inputs = [
    inputRow("Best ask", `${eur(item.ask)} €/MWh`, esc(item.quoteTm), "≤ 15 min", fresh),
    inputRow("Ask size (visible)", `${esc(item.askSz ?? "—")} MW`, esc(item.quoteTm), "≤ 15 min", fresh),
    inputRow("Best bid", typeof item.bid === "number" ? `${eur(item.bid)} €/MWh` : unknownValue(), esc(item.quoteTm), "≤ 15 min", typeof item.bid === "number" ? fresh : chip("unk", "?", "One-sided book")),
    inputRow("Previous 11:00 asks used", String(item.pastAsksUsed), "prior days only", "past", chip("pass", "✓", "Past only")),
    inputRow("Trigger mean (previous asks)", unknownValue(), "—", "—", chip("unk", "?", "Not emitted")),
    inputRow("Execution fees", unknownValue(), "—", "—", chip("unk", "?", "Unknown")),
  ].join("");

  return `<section class="xsel${isDefault ? " xdefault" : ""}" id="${esc(replaySectionId(episode, item))}" data-decision="${esc(product)}-${esc(episode.maturity)}-${item.index}">
  <div class="dechead">
    <div class="grow">
      <div class="mono muted small">${esc(campaignId)} · run EXP-${esc(campaignId)}-ARM_A · ${expArmTag("ARM_A")} DIP10 · 11:00 Europe/Berlin</div>
      <h1 class="page">Decision ${decisionNumber(item.index)} — BUY at ${esc(item.day)} 11:00 Berlin</h1>
      <p class="lede">Read left to right: what was known, what was recommended, what was asked for, what was filled, and — separately, later — how it turned out.</p>
    </div>
    <div class="row">${others}</div>
  </div>

  <div class="card" style="margin-top:14px;padding:4px 14px 0">
    <div class="row small" style="padding-top:6px"><span class="caps muted">Run timeline · ${(episode.decisions?.ARM_A ?? []).length} decisions</span><span class="grow"></span>
      <span class="muted">■ BUY (Arm A) &nbsp; □ WAIT &nbsp; • opens in this inspector &nbsp; <span style="color:var(--hind)">▬ evaluation window</span></span></div>
    <div class="tl">${runTimelineSvg(episode, item)}</div>
  </div>

  <div class="chain">
    ${rec}<div class="link">→</div>${ord}<div class="link">→</div>${fill}
    <div class="horizon"><span>EVALUATION · LATER</span></div>
    ${out}
  </div>
  <div class="row tiny muted" style="margin-top:6px">
    <span class="zt asof">T₀ · decision-time</span><span class="zt exec">Execution</span><span class="zt hind">Later · evaluation</span>
    <span>Four separate objects with their own times. The arrow is sequence, not identity.</span>
  </div>

  <div class="zones">
    <section class="zone asof" data-view-scope="decision">
      <div class="zhd"><span class="zt asof">Known at T₀</span><b>${esc(item.day)} 11:00 Berlin</b><span class="grow"></span>
        <button type="button" class="btn" data-hind-toggle title="Draws post-T₀ asks on the right of the horizon only">Hindsight overlay: off</button></div>
      <div class="zbd">
        <div class="row small"><b>${contract} · 11:00 best ask</b><span class="muted">€/MWh · every exchange day of the campaign window</span></div>
        <div class="chartwrap">${knownAtT0Svg(episode, item)}</div>
        <table class="t" style="margin-top:6px">
          <thead><tr><th>Inputs in decision snapshot</th><th>Value at T₀</th><th>Observed at</th><th>Age at T₀</th><th>State</th></tr></thead>
          <tbody>${inputs}</tbody>
        </table>
      </div>
    </section>
    <div class="horizon"><span>KNOWLEDGE HORIZON</span></div>
    <section class="zone hind" data-view-scope="evaluation">
      <div class="zhd"><span class="zt hind">Later · evaluation</span><b>not visible to the decision</b></div>
      <div class="zbd">
        <div class="metric">
          <span class="lbl">Evaluation window</span><span class="mono">${esc(episode.ask11[0].day)} → ${esc(closes)}</span>
          <span class="lbl">Benchmark B* (window mean 11:00 ask)</span><span class="val">${eur(episode.benchmark)}</span>
          <span class="lbl">Hedge price H · ${expArmTag("ARM_A")}</span><span class="val">${eur(episode.hArmA)}</span>
          <span class="lbl">Hedge price H · ${expArmTag("BASELINE")}</span><span class="val">${eur(episode.hBaseline)}</span>
          <span class="lbl"><b>ΔV this decision</b></span><span class="val">${kEur(item.deltaVEur / 1000)} k€</span>
        </div>
        <div class="sp"></div>
        <div class="note-ev"><span class="ev">EVIDENCE</span> One decision is one observation. It does not validate the strategy — see <a href="/backtests">Backtests</a> for the paired campaign effect.</div>
      </div>
    </section>
  </div>
</section>`;
}

export function exploratoryReplayBody(exploratory) {
  const episodes = exploratory.replay.filter((episode) => episode.inspector.length > 0);
  const firstQuarterly = episodes.find((episode) => episode.product === "G0BQ") ?? episodes[0];
  const picker = episodes.map((episode) => `<a class="btn" href="#rep-${esc(episode.product)}-${esc(episode.maturity)}">${esc(MISSION_TITLE[episode.product])} ${esc(deliveryLabel(episode.maturity))} · ${episode.inspector.length} ${episode.inspector.length === 1 ? "buy" : "buys"}</a>`).join(" ");
  const sections = episodes.flatMap((episode) => episode.inspector.map((item, position) => decisionSectionHtml(episode, item, position === 0 && episode === firstQuarterly))).join("");
  return `${TARGET_SWITCH_CSS}
<section class="surface replay" data-surface="replay" data-exploratory="true">
  <div class="row small" style="gap:6px;flex-wrap:wrap;margin-bottom:10px"><span class="caps muted">Campaigns with Arm A purchases</span>${picker}</div>
  <div class="xwrap">${sections}</div>
</section>`;
}

// ---------- Research / Strategy Lab ----------
const READINESS_CHIP = {
  READY: ["pass", "✓", "Ready (reference)"],
  NOT_READY: ["fail", "✕", "Not ready"],
  NO_RUNS: ["open", "○", "No runs yet"],
};
const CRITERION_CHIP = {
  MET: ["pass", "✓", "Met"],
  NOT_MET: ["fail", "✕", "Not met"],
  UNKNOWN: ["unk", "?", "Unknown"],
};
const INTEGRITY_CHIP = {
  PASS: ["pass", "✓", "Pass"],
  NOT_CLOSED: ["open", "○", "Not closed"],
  UNKNOWN: ["unk", "?", "Unknown"],
};

function chipFrom(map, key) {
  const [kind, glyph, label] = map[key] ?? ["unk", "?", key];
  return chip(kind, glyph, label);
}

// Sólo un candidato con brazo corrido tiene receipts; los "hypothesis only" no tienen ninguno.
function candidateReceipts(candidate, provenance) {
  return candidate.armId ? exploratoryReceipts(provenance) : [];
}

function authorityChip(candidate) {
  return candidate.armId === "BASELINE" ? chip("pass", "✓", esc(candidate.authority)) : chip("na", "—", esc(candidate.authority));
}

function candidateListHtml(candidates, provenance) {
  return candidates.map((candidate) => `<a class="it" href="#res-${esc(candidate.id)}">
      <div class="row"><span class="stage">${esc(candidate.stage)}</span><span class="grow"></span><span class="mono tiny muted">${esc(candidate.version)}</span></div>
      <div style="font-weight:600;margin:3px 0 5px">${esc(candidate.name)}</div>
      <div class="row small" style="gap:6px"><span class="muted">Readiness</span>${chipFrom(READINESS_CHIP, candidate.readiness)}</div>
      <div class="row small" style="gap:6px;margin-top:4px;flex-wrap:wrap"><span class="ev">EVIDENCE ${candidateReceipts(candidate, provenance).length}</span><span class="muted">Authority</span>${authorityChip(candidate)}</div>
    </a>`).join("");
}

// Linaje del mockup (lineageSvg) con lo que el artifact declara: una sola versión por
// candidato y, para los brazos exploratorios, la referencia A0 contra la que se emparejan.
// No hay versiones previas registradas, así que no se dibuja ninguna.
function candidateLineageSvg(candidate) {
  const node = (cx, cy, label, current) => `<rect x="${cx - 80}" y="${cy - 17}" width="160" height="34" rx="4" fill="${current ? "var(--ink)" : "var(--surface)"}" stroke="var(--ink-2)"/><text x="${cx}" y="${cy + 4}" text-anchor="middle" font-size="12" font-weight="700" fill="${current ? "#fff" : "var(--ink)"}" font-family="var(--mono)">${esc(label)}</text>`;
  const caption = (cx, cy, text) => `<text x="${cx}" y="${cy}" text-anchor="middle" font-size="10.5" fill="var(--ink-3)">${esc(text)}</text>`;
  let svg = '<svg viewBox="0 0 900 150" width="100%" role="img" aria-label="Version lineage">';
  if (!candidate.armId) {
    svg += '<rect x="0" y="10" width="900" height="130" rx="4" fill="url(#emHatchU)" stroke="#cdb8d6"/>';
    svg += '<text x="450" y="72" text-anchor="middle" font-size="12" fill="var(--unk)" font-weight="700">NO VERSION RUN · hypothesis only</text>';
    svg += '<text x="450" y="90" text-anchor="middle" font-size="10.5" fill="var(--unk)">no experiment is recorded for this candidate; nothing is drawn</text>';
    return `${svg}</svg>`;
  }
  if (candidate.armId === "BASELINE") {
    svg += node(450, 70, `${candidate.id} ${candidate.version}`, true) + caption(450, 102, "current client practice · reference");
    return `${svg}</svg>`;
  }
  const products = candidate.criteria.map((group) => group.product).join(" · ");
  svg += `<text x="600" y="30" text-anchor="middle" font-size="10" fill="var(--ink-2)" font-family="var(--mono)">⧉ exploratory backtest · ${esc(products)}</text>`;
  svg += node(600, 70, `${candidate.id} ${candidate.version}`, true) + caption(600, 102, "exploratory · owner patch 02");
  svg += node(220, 70, "A0 v1", false) + caption(220, 102, "client 11:00 · reference");
  svg += '<path d="M518 70 L302 70" fill="none" stroke="var(--ink-3)" stroke-width="1.5" stroke-dasharray="4 3" marker-end="url(#emArr)"/>';
  svg += '<text x="410" y="62" text-anchor="middle" font-size="10.5" fill="var(--ink-3)">paired against</text>';
  return `${svg}</svg>`;
}

function candidateDetailHtml(candidate, research, provenance, isDefault) {
  const criteria = candidate.criteria.length === 0
    ? '<div class="small muted">No success criteria measured: no run for this candidate.</div>'
    : candidate.criteria.map((group) => `<div class="mono tiny muted" style="margin-top:8px">${esc(group.product)}</div>${group.items.map((item) => {
      const [, glyph] = CRITERION_CHIP[item.status] ?? ["unk", "?"];
      return `<div class="crit"><span class="mono">${glyph}</span><div><div style="font-weight:600">${esc(item.label)}</div><div class="small ink2">${esc(item.detail)}</div></div>${chipFrom(CRITERION_CHIP, item.status)}</div>`;
    }).join("")}`).join("");
  const integrity = research.integrity.map((item) => `<div class="chk"><span>${esc(item.label)}</span>${chipFrom(INTEGRITY_CHIP, item.status)}<span class="d">${esc(item.detail)}</span></div>`).join("");
  const receipts = candidateReceipts(candidate, provenance);
  const receiptRows = receipts.length === 0
    ? '<tr><td colspan="5"><span class="withheld">NO RECEIPTS</span> <span class="small muted">no run exists for this candidate</span></td></tr>'
    : receipts.map((receipt) => `<tr><td class="mono small">${esc(receipt.id)}</td><td><span class="ev">${esc(receipt.kind)}</span></td><td>${esc(receipt.what)}</td><td>${NOT_RECORDED}</td><td>${receipt.href ? `<span class="drill"><a href="${esc(receipt.href)}">open</a></span>` : '<span class="muted small">record</span>'}</td></tr>`).join("");
  return `<section class="xsel${isDefault ? " xdefault" : ""}" id="res-${esc(candidate.id)}" data-candidate="${esc(candidate.id)}">
  <div class="row" style="align-items:flex-end">
    <div class="grow"><div class="mono muted small">${esc(candidate.id)} ${esc(candidate.version)} · owner Bru</div>
      <h1 class="page">${esc(candidate.name)} <span class="muted">${esc(candidate.version)}</span></h1></div>
    <div style="text-align:right"><div class="caps muted">Readiness (backend)</div><div style="margin-top:4px">${chipFrom(READINESS_CHIP, candidate.readiness)}</div></div>
  </div>
  <div class="grid" style="grid-template-columns: minmax(0,1.6fr) minmax(0,1fr); margin-top:14px">
    <div class="card"><div class="hd"><h3>Hypothesis</h3><span class="small muted">registered ${NOT_RECORDED} · exploratory phase (${OWNER_PATCH_02})</span></div>
      <div class="bd"><p class="hyp">${esc(candidate.hypothesis)}</p><div class="caps muted">Success criteria</div>${criteria}</div></div>
    <div>
      <div class="auth-box">
        <div class="row"><span class="seal">AUTHORITY</span><span class="grow"></span>${authorityChip(candidate)}</div>
        <div style="font:600 16px var(--serif);margin:8px 0 4px">No adoption decision exists</div>
        <div class="small ink2">Authority to adopt: <b>Bru</b>. Evidence does not change this state; only a recorded owner decision can.</div>
      </div>
      <div class="card" style="margin-top:14px"><div class="hd"><h3>Readiness &amp; integrity</h3></div><div class="bd">${integrity}</div></div>
    </div>
  </div>
  <div class="card" style="margin-top:14px"><div class="hd"><h3>Version lineage</h3><span class="small muted">versions → experiments · dashed = paired comparison</span></div><div class="bd">${candidateLineageSvg(candidate)}</div></div>
  <div class="card" style="margin-top:14px"><div class="hd"><h3>Evidence &amp; receipts</h3><span class="small muted">${receipts.length} items · evidence informs, it does not authorise</span></div>
    <table class="t"><thead><tr><th>Receipt</th><th>Kind</th><th>What</th><th>Recorded</th><th></th></tr></thead><tbody>${receiptRows}</tbody></table></div>
</section>`;
}

export function exploratoryResearchBody(exploratory) {
  const research = exploratory.research;
  const firstEvidence = research.candidates.find((candidate) => candidate.stage === "EVIDENCE GATHERING") ?? research.candidates[0];
  const details = research.candidates.map((candidate) => candidateDetailHtml(candidate, research, exploratory.provenance, candidate === firstEvidence)).join("");
  return `${TARGET_SWITCH_CSS}${railSelectionCss(research.candidates.map((candidate) => `res-${candidate.id}`), `res-${firstEvidence.id}`)}
<section class="surface research" data-surface="research" data-exploratory="true">
  <div class="split xwrap">
    <div class="xlist">
      <div class="caps muted" style="margin:4px 0 8px">Candidate stack</div>
      <div class="card stack">${candidateListHtml(research.candidates, exploratory.provenance)}</div>
      <div class="small muted" style="margin-top:8px">Evidence count and authority are separate columns on purpose: more evidence never turns into approval by itself.</div>
    </div>
    <div>${details}</div>
  </div>
</section>`;
}

function exploratoryBacktestHtml(exploratory) {
  if (!exploratory) {
    return "";
  }
  const rows = exploratory.episodes.map((episode) => {
    const dipDiff = episode.a0?.complete && episode.dip?.complete ? episode.dip.avgPriceEurMwh - episode.a0.avgPriceEurMwh : null;
    const loo = episode.leaveOneOut;
    return `<tr data-status="EXPLORATORY" data-product="${esc(episode.product)}" data-maturity="${esc(episode.maturity)}"><td class="mono">${esc(episode.product)}</td><td class="mono">${esc(episode.maturity)}</td><td class="mono small">${esc(episode.firstDay)} → ${esc(episode.lastDay)} · ${episode.tradingDays} d</td><td class="mono num right">${armResultHtml(episode.a0)}</td><td class="mono num right">${armResultHtml(episode.dip)}</td><td class="mono num right">${signedEur(dipDiff)}</td><td class="mono num right">${armResultHtml(episode.dipDepth)}</td><td class="mono">${esc(loo?.slotChosenOnOtherEpisodes ?? "—")}</td><td class="mono num right">${signedEur(loo?.diffOnThisEpisodeEurMwh)}</td></tr>`;
  });
  const summaries = Object.entries(exploratory.summary).map(([product, summary]) => `<div class="chk"><span><b>${esc(product)}</b> · ${summary.episodes} episodes</span><span class="d">DIP10 vs A0: ${signedEur(summary.dipVsA0.meanDiffEurMwh)} EUR/MWh mean, cheaper in ${summary.dipVsA0.episodesCheaper}/${summary.dipVsA0.pairedEpisodes} · hour chosen out-of-episode vs 11:00: ${signedEur(summary.leaveOneOutHour.meanDiffEurMwh)} EUR/MWh over ${summary.leaveOneOutHour.evaluatedEpisodes}</span></div>`);
  const profiles = exploratory.hourProfiles.map((profile) => `<div class="card"><div class="hd"><h3>Hour profile · ${esc(profile.product)}</h3><span class="small muted">A0 at each hour minus A0 at 11:00 · green = cheaper</span></div><div class="bd" data-kind="hour-profile">${hourProfileSvg(profile)}</div></div>`);
  const rules = exploratory.rules;
  return `
  <div class="card" style="margin-top:14px" data-exploratory="true">
    <div class="hd"><h3>Exploratory backtest · real EEX best ask</h3><span class="small muted">data ${esc(exploratory.dataPeriod.firstDataDay)} → ${esc(exploratory.dataPeriod.lastDataDay)} · target ${esc(JSON.stringify(rules.targetsMw))} MW · ask + ${rules.slippageEurMwh} EUR/MWh · cap ${rules.dailyCapMw} MW/day · fees ${esc(rules.feesEurMwh)}</span><span class="grow"></span>${chip("warn", "◇", "EXPLORATORY")}</div>
    <table class="t">
      <thead><tr><th>Product</th><th>Delivery</th><th>Window</th><th class="right">A0 · 11:00 (client)</th><th class="right">DIP10 · 11:00</th><th class="right">DIP − A0</th><th class="right">DIP10 · depth-capped</th><th>Hour (out-of-episode)</th><th class="right">Δ vs 11:00</th></tr></thead>
      <tbody>${rows.join("")}</tbody>
    </table>
    <div class="bd">${summaries.join("")}
      <div class="tiny muted" style="margin-top:6px">Prices in EUR/MWh paid (ask + slippage), volume-weighted. ! = target not completed (no fresh quote or depth). Not evidence of edge: ${exploratory.episodes.length} episodes, in-sample; skipped as incomplete: ${esc(exploratory.skipped.join(", "))}. Source ${esc(exploratory.provenance.resultsPath)} sha256 ${esc(exploratory.provenance.resultsSha256.slice(0, 12))}…</div>
    </div>
  </div>
  <div class="grid" style="grid-template-columns: repeat(${profiles.length}, minmax(0,1fr)); margin-top:14px">${profiles.join("")}</div>`;
}

// Leyenda de brazos del mockup: los canónicos atados, o los brazos de la comparación exploratoria.
function armHeadHtml(canonicalArms, comparison) {
  if (canonicalArms.length > 0) {
    return canonicalArms.map(armTag).join("");
  }
  const exploratoryArms = comparison ? [...new Set(Object.values(comparison).flatMap((block) => block.table.map((row) => row.armId)))] : [];
  if (exploratoryArms.length > 0) {
    return exploratoryArms.map(expArmTag).join("");
  }
  return `<span class="small muted">arms</span> ${unknownValue()}`;
}

function backtestsBody(vm, { errors = null } = {}) {
  const validated = errors === null;
  // Con comparación exploratoria, sus paneles ocupan los espacios del mockup; los paneles
  // canónicos vacíos no se duplican debajo (una sola verdad por panel).
  const hasExploratory = validated && vm.exploratory?.comparison != null;
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
    <div class="grow">${hasExploratory ? `
      <div class="mono muted small">economic comparison · exploratory · real EEX best ask</div>
      <h1 class="page">Does another hour or a dip rule buy cheaper than the client's 11:00?</h1>
      <p class="lede">Paired comparison of two exploratory arms against the Baseline, on the same days and the same best-ask data. Figures are <b>exploratory</b>: B* is a proxy and fees are UNKNOWN (excluded, never zero).</p>` : `
      <div class="mono muted small">economic comparison · canonical producers only</div>
      <h1 class="page">Economic comparison of experimental arms</h1>
      <p class="lede">Measures are shown only as published by canonical producers and bound to the verified backend manifest. Without a producer, the slot stays explicit: no comparison is fabricated.</p>`}
    </div>
    <div class="armhead">${armHeadHtml(arms, hasExploratory ? vm.exploratory.comparison : null)}</div>
  </div>

  ${validated ? exploratoryComparisonHtml(vm.exploratory) : ""}
  ${validated ? exploratoryBacktestHtml(vm.exploratory) : ""}
  ${validated ? backtestMeasurementHtml(vm.measurementReadiness) : ""}

  ${hasExploratory ? "" : `
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
`}
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
    : exploratoryClock(vm.exploratory);
  const context = surface === SURFACES.REPLAY ? replayContext(vm) : [`<span>${esc(SURFACE_TITLES[surface])}</span>`];
  return renderDocument({ active: surface, title: `Energy Markets — ${SURFACE_TITLES[surface]}`, body, clock, context });
}

// Replay y Campaigns: si hay backtest exploratorio verificado, esas superficies lo
// muestran con el layout del mockup; si no, se mantiene el estado canónico fail-closed.
const EXPLORATORY_BODIES = {
  [SURFACES.REPLAY]: exploratoryReplayBody,
  [SURFACES.CAMPAIGNS]: exploratoryCampaignsBody,
  [SURFACES.RESEARCH]: exploratoryResearchBody,
};

// Reloj del mockup: último día de datos del snapshot EEX que usó el backtest
// (artifact inputs.dataPeriod.lastDataDay), no un reloj del boundary canónico.
function exploratoryClock(exploratory) {
  const lastDataDay = exploratory?.dataPeriod?.lastDataDay;
  if (typeof lastDataDay !== "string") {
    return null;
  }
  return { asOfLabel: "data as-of", asOf: lastDataDay, sub: `EEX best-ask snapshot · sha ${exploratory.provenance.slotsSha256.slice(0, 12)}` };
}

function renderExploratory(surface, vm) {
  const body = EXPLORATORY_BODIES[surface](vm.exploratory);
  return renderDocument({ active: surface, title: `Energy Markets — ${SURFACE_TITLES[surface]}`, body, clock: exploratoryClock(vm.exploratory), context: [`<span>${esc(SURFACE_TITLES[surface])}</span>`, '<span class="st warn"><span class="g">◇</span>EXPLORATORY · real EEX best ask</span>'] });
}

function renderPageFor(surface) {
  return (vm) => {
    if (EXPLORATORY_BODIES[surface] !== undefined && vm?.exploratory != null) {
      return renderExploratory(surface, vm);
    }
    return vm?.ok !== true ? renderErrorState(surface, vm) : renderValidated(surface, vm);
  };
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
