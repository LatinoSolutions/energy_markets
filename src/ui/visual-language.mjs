// UI-03 — dirección visual Claude Blind integrada en la UI productiva.
// Fuente visual: proyecto aislado `energy-markets-claude-blind-ui`, commit
// c35510b (selección del owner 24-sep-2026, PLAN_STATUS UI-03 / DES-02).
//
// Este módulo aporta SÓLO gramática visual/layout/interacción: paleta, zonas
// temporales, estados epistémicos, evidencia vs autoridad, tipografía y el
// panel de semántica. No contiene datos: ni los ids de demo sintéticos del
// prototipo, ni sus supuestos inventados (definiciones B/H/V/ΔV, evaluación
// T₀+84, CI90%, comité de procurement del mockup). Los valores los siguen
// aportando los view models, ya atados al Operator Interface Boundary de
// IMP-29 (§26.5).
//
// La semántica de negocio no vive aquí; la UI sólo dibuja lo que el boundary
// expone y mantiene UNAVAILABLE/ERROR explícito fail-closed.

export const VISUAL_LANGUAGE_ID = "claude-blind";

// Paleta y gramática temporal del prototipo Claude Blind: el color y la
// textura codifican CUÁNDO se supo algo y CUÁN seguro es, no decoración.
export const UI_STYLESHEET = `
:root {
  --paper: #f3f1eb;
  --surface: #fbfaf7;
  --surface-2: #f7f5f0;
  --ink: #1a1d21;
  --ink-2: #474a50;
  --ink-3: #75777c;
  --rule: #d9d5cb;
  --rule-2: #e7e3da;

  /* Zonas temporales: nunca se mezclan. */
  --asof: #23476b;
  --asof-bg: #e8edf3;
  --exec: #3d4148;
  --exec-bg: #eeede9;
  --hind: #8a4b0f;
  --hind-bg: #f6ecdc;
  --hatch-hind: repeating-linear-gradient(135deg, #f6ecdc 0 6px, #efdfc4 6px 7px);

  /* Estados epistémicos: la ausencia siempre es explícita. */
  --unk: #6b3d7b;
  --unk-bg: repeating-linear-gradient(45deg, #f3ecf5 0 5px, #e6d8eb 5px 6px);
  --pass: #2f6b3a;
  --pass-bg: #e6efe5;
  --fail: #a3312a;
  --fail-bg: #f6e3e0;
  --warn: #8a6100;
  --warn-bg: #f6edd6;

  --auth: #2b2a4a;

  --serif: "Iowan Old Style", "Palatino Linotype", Palatino, "Book Antiqua", Georgia, "DejaVu Serif", serif;
  --sans: Inter, "Segoe UI", system-ui, -apple-system, Roboto, "Helvetica Neue", Arial, sans-serif;
  --mono: "JetBrains Mono", "SFMono-Regular", Menlo, Consolas, "DejaVu Sans Mono", monospace;
}
* { box-sizing: border-box; }
html, body { margin: 0; }
body.em-app {
  background: var(--paper);
  color: var(--ink);
  font: 13.5px/1.45 var(--sans);
  -webkit-font-smoothing: antialiased;
}
a { color: inherit; }
.mono { font-family: var(--mono); font-size: 12px; }
.muted { color: var(--ink-3); }
.ink2 { color: var(--ink-2); }
.small { font-size: 12px; }
.tiny { font-size: 11px; }
.caps { text-transform: uppercase; letter-spacing: .08em; font-size: 10.5px; font-weight: 600; }
.num { font-variant-numeric: tabular-nums; }
.right { text-align: right; }
.row { display: flex; gap: 12px; align-items: center; }
.row.wrap { flex-wrap: wrap; }
.grow { flex: 1; }
.sp { height: 16px; }

/* Cabecera / navegación */
header.em-top {
  background: var(--surface);
  border-bottom: 1px solid var(--rule);
  display: flex; align-items: stretch; gap: 24px;
  padding: 0 20px;
  position: sticky; top: 0; z-index: 20;
}
.em-brand { display: flex; flex-direction: column; justify-content: center; padding: 10px 0; min-width: 190px; }
.em-brand .em-name { font: 600 18px/1.1 var(--serif); letter-spacing: -.01em; }
.em-brand .em-sub { font-size: 11px; color: var(--ink-3); letter-spacing: .04em; }
nav.ui-nav { display: flex; gap: 2px; }
nav.ui-nav a.nav-link {
  display: flex; flex-direction: column; justify-content: center;
  padding: 0 16px; text-decoration: none; color: var(--ink-2);
  border-bottom: 3px solid transparent; min-width: 150px; white-space: nowrap;
}
nav.ui-nav a.nav-link:hover { background: var(--surface-2); }
nav.ui-nav a.nav-link.nav-active { color: var(--ink); border-bottom-color: var(--ink); background: var(--paper); }
.em-tools { margin-left: auto; display: flex; align-items: center; gap: 10px; }
.clock { font: 11.5px var(--mono); color: var(--ink-2); text-align: right; line-height: 1.3; white-space: nowrap; }
.btn {
  white-space: nowrap; border: 1px solid var(--rule); background: var(--surface);
  border-radius: 4px; padding: 5px 10px; cursor: pointer; font-size: 12.5px;
}
.btn:hover { border-color: var(--ink-3); }
.btn:focus-visible, nav.ui-nav a:focus-visible, .pv:focus-visible { outline: 2px solid var(--asof); outline-offset: 2px; }

/* Franja de contexto */
.ctx {
  display: flex; gap: 8px; align-items: center; flex-wrap: wrap;
  padding: 8px 20px; border-bottom: 1px solid var(--rule);
  background: var(--surface-2); font-size: 12.5px; color: var(--ink-2);
}
main.em-main { padding: 18px 20px 60px; max-width: 1600px; margin: 0 auto; }

/* Superficies y tarjetas */
.surface { display: block; }
.surface > h2 { font: 600 24px/1.15 var(--serif); margin: 0 0 6px; letter-spacing: -.01em; }
.surface-note, .mode-line { color: var(--ink-2); margin: 0 0 10px; }
.card { background: var(--surface); border: 1px solid var(--rule); border-radius: 6px; padding: 12px 14px; }
h3 { font: 600 14px/1.3 var(--sans); margin: 14px 0 8px; }
h3:first-child { margin-top: 0; }

/* Zonas temporales: decision vs evaluation nunca se confunden */
.zone-decision { border: 1px solid var(--rule); border-radius: 6px; background: var(--surface); box-shadow: inset 0 4px 0 var(--asof); padding: 10px 14px; }
.zone-decision > h3 { color: var(--asof); }
.zone-evaluation { border: 1px solid var(--rule); border-radius: 6px; background: var(--hatch-hind); box-shadow: inset 0 4px 0 var(--hind); padding: 10px 14px; }
.zone-evaluation > h3 { color: var(--hind); background: var(--surface); display: inline-block; padding: 1px 6px; border-radius: 3px; }
.zone-execution { border: 1px solid var(--rule); border-radius: 6px; background: var(--surface); box-shadow: inset 0 4px 0 var(--exec); padding: 10px 14px; }
.zt { display: inline-flex; gap: 6px; align-items: center; font: 600 10.5px/1 var(--mono); letter-spacing: .05em; padding: 4px 7px; border-radius: 3px; text-transform: uppercase; margin-right: 8px; }
.zt.asof { background: var(--asof); color: #fff; }
.zt.exec { background: var(--exec); color: #fff; }
.zt.hind { background: var(--hind); color: #fff; }
.knowledge-horizon { border: 0; border-top: 2px dashed var(--hind); margin: 16px 0; position: relative; }
.knowledge-horizon > span { position: relative; top: -0.8em; background: var(--paper); color: var(--hind); font: 700 10px/1 var(--mono); letter-spacing: .1em; padding: 0 6px; }

/* Listas de datos */
ul.data-list { list-style: none; margin: 0; padding: 0; }
.data-item { padding: 8px 0; border-bottom: 1px solid var(--rule-2); display: flex; gap: 8px; align-items: baseline; flex-wrap: wrap; }
.data-item:last-child { border-bottom: 0; }
.item-label { font-weight: 600; }
.value { font-family: var(--mono); font-size: 12px; }
.reason { color: var(--ink-3); font-size: 12px; }
.empty-state { color: var(--ink-3); background: var(--surface-2); border: 1px dashed var(--rule); border-radius: 4px; padding: 10px 12px; }

/* Chips epistémicos */
.st { display: inline-flex; align-items: center; gap: 5px; border-radius: 3px; padding: 1px 7px 1px 5px; font-size: 11.5px; font-weight: 600; white-space: nowrap; border: 1px solid transparent; line-height: 18px; }
.st .g { font-family: var(--mono); font-weight: 700; }
.st.pass { color: var(--pass); background: var(--pass-bg); }
.st.fail { color: var(--fail); background: var(--fail-bg); }
.st.warn { color: var(--warn); background: var(--warn-bg); }
.st.unk  { color: var(--unk); background: var(--unk-bg); border-color: #cdb8d6; }
.st.open { color: var(--ink-2); background: var(--surface); border: 1px dashed var(--ink-3); }
.st.na   { color: var(--ink-3); background: transparent; border: 1px solid var(--rule); font-weight: 500; }
.st.run  { color: var(--asof); background: var(--asof-bg); }
.unkv { display: inline-block; background: var(--unk-bg); color: var(--unk); border: 1px solid #cdb8d6; border-radius: 3px; padding: 0 6px; font: 600 11.5px/18px var(--mono); }
.openv { display: inline-block; border: 1px dashed var(--ink-3); color: var(--ink-2); border-radius: 3px; padding: 0 6px; font: 600 11.5px/18px var(--mono); }

/* Evidencia vs autoridad: la evidencia informa, no aprueba */
.ev { white-space: nowrap; display: inline-flex; gap: 5px; align-items: center; font: 600 10.5px/1 var(--mono); letter-spacing: .05em; padding: 3px 6px; border: 1px solid var(--ink-3); color: var(--ink-2); border-radius: 3px; background: var(--surface); }
.auth-box { border: 3px double var(--auth); border-radius: 4px; padding: 12px 14px; background: #f4f3f8; }
.auth-box .seal { font: 700 10.5px/1 var(--mono); letter-spacing: .1em; color: var(--auth); }
.note-ev { font-size: 12px; border: 1px solid var(--rule); border-left: 3px solid var(--ink-3); padding: 8px 10px; background: var(--surface-2); border-radius: 0 4px 4px 0; }

/* Procedencia: subrayado punteado, un clic */
.pv { background: none; border: 0; padding: 0; cursor: pointer; border-bottom: 1px dotted var(--ink-3); font: inherit; color: inherit; text-align: left; }
.pv:hover { background: #ebe7dc; border-bottom-color: var(--ink); }
.provenance { font-family: var(--mono); font-size: 11px; color: var(--ink-3); }

/* Actuaciones e intervenciones */
section.events { margin-top: 14px; }
.execution-events, .intervention-events { border: 1px solid var(--rule); border-radius: 6px; background: var(--surface); box-shadow: inset 0 4px 0 var(--exec); padding: 10px 14px; }
.intervention-events { box-shadow: inset 0 4px 0 var(--unk); }
ul.events-list { list-style: none; margin: 0; padding: 0; display: flex; flex-wrap: wrap; gap: 8px; }
.event { border: 1px solid var(--rule); border-radius: 5px; background: var(--surface); padding: 7px 10px; display: flex; gap: 8px; align-items: baseline; flex-wrap: wrap; border-top: 4px solid var(--exec); }
.event-class-REAL { border-left: 3px double var(--auth); }
.event-class-HUMAN_INTERVENTION { border-top-color: var(--unk); }
.event-id { font-family: var(--mono); font-weight: 700; font-size: 12px; }
.event-class { font: 600 10.5px/1 var(--mono); letter-spacing: .05em; text-transform: uppercase; color: var(--ink-2); }
.event-clock, .clock { font-family: var(--mono); font-size: 11.5px; color: var(--ink-2); }
.attribution { color: var(--unk); font-size: 11.5px; }

/* Puntos del timeline */
ul.ts-points { display: flex; flex-wrap: wrap; gap: 8px; }
.ts-point { border: 1px solid var(--rule); border-radius: 5px; background: var(--surface); padding: 6px 9px; display: flex; gap: 8px; align-items: baseline; flex-wrap: wrap; }
.ts-point.lane-decision { border-top: 4px solid var(--asof); }
.ts-point.lane-evaluation { border-top: 4px solid var(--hind); background: var(--hind-bg); }
.point-key { font-family: var(--mono); font-weight: 600; }

/* Panel de semántica (gramática visual, sin semántica de negocio) */
.semantics-key { position: fixed; top: 84px; right: 20px; width: 470px; max-width: calc(100vw - 40px); background: var(--surface); border: 1px solid var(--ink-3); border-radius: 6px; box-shadow: 0 12px 30px rgba(0,0,0,.14); z-index: 45; display: none; }
.semantics-key.on { display: block; }
.semantics-key .key-hd { padding: 10px 14px; border-bottom: 1px solid var(--rule-2); display: flex; gap: 10px; align-items: baseline; }
.semantics-key .key-row { display: grid; grid-template-columns: 170px 1fr; gap: 10px; padding: 7px 14px; border-bottom: 1px solid var(--rule-2); align-items: center; font-size: 12px; }
.semantics-key .key-row:last-child { border-bottom: 0; }

/* Drawer de procedencia */
.prov-scrim { position: fixed; inset: 0; background: rgba(26,29,33,.18); opacity: 0; pointer-events: none; transition: opacity .15s; z-index: 40; }
.prov-scrim.on { opacity: 1; pointer-events: auto; }
.prov-drawer { position: fixed; top: 0; right: 0; bottom: 0; width: 420px; max-width: 100vw; background: var(--surface); border-left: 1px solid var(--rule); box-shadow: -12px 0 30px rgba(0,0,0,.08); transform: translateX(100%); transition: transform .18s ease-out; z-index: 50; display: flex; flex-direction: column; }
.prov-drawer.on { transform: none; }
.prov-hd { padding: 14px 16px; border-bottom: 1px solid var(--rule); display: flex; gap: 10px; align-items: flex-start; }
.prov-title { font: 600 17px/1.2 var(--serif); margin-top: 2px; }
.prov-bd { padding: 14px 16px; overflow: auto; }
.prov-bd dl { display: grid; grid-template-columns: 130px 1fr; gap: 8px 12px; margin: 0 0 12px; font-size: 12.5px; }
.prov-bd dt { color: var(--ink-3); }
.prov-bd dd { margin: 0; word-break: break-word; }

/* Escenarios de comparación / research */
.withheld { font: 600 12px var(--mono); color: var(--unk); }
.drilldowns { display: inline-flex; gap: 4px; }
.drilldown { font-size: 11.5px; padding: 2px 7px; border: 1px solid var(--rule); border-radius: 3px; text-decoration: none; background: var(--surface); white-space: nowrap; }
.drilldown:hover { border-color: var(--ink); }
table.t { width: 100%; border-collapse: collapse; }
table.t th { text-align: left; font-weight: 600; color: var(--ink-3); font-size: 10.5px; text-transform: uppercase; letter-spacing: .07em; padding: 7px 10px; border-bottom: 1px solid var(--rule); }
table.t td { padding: 8px 10px; border-bottom: 1px solid var(--rule-2); vertical-align: top; }

/* Índice y error */
.page-title { font: 600 24px/1.15 var(--serif); margin: 0 0 6px; letter-spacing: -.01em; }
.lede { color: var(--ink-2); max-width: 880px; margin: 0 0 14px; }
.surface-index { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 14px; }
.nav-card { display: block; text-decoration: none; background: var(--surface); border: 1px solid var(--rule); border-radius: 6px; padding: 14px; }
.nav-card:hover { border-color: var(--ink-3); }
.state-error { border: 1px solid var(--fail); border-left: 3px solid var(--fail); background: var(--fail-bg); border-radius: 4px; padding: 14px; }
.error-list { list-style: none; margin: 8px 0 0; padding: 0; }
.error-code { font: 600 11.5px var(--mono); color: var(--fail); }
`;

// Panel de semántica: la gramática visual en una tarjeta. No define
// definiciones económicas ni reglas de evaluación (esas pertenecen al backend).
export function renderSemanticsKeyHtml() {
  const rows = [
    [`<span class="zt asof">T\u2080 \u00b7 decision-time</span>`, "Lo que el sistema conoc\u00eda al decidir. Slate, superficie s\u00f3lida."],
    [`<span class="zt exec">Execution</span>`, "Despu\u00e9s de T\u2080 y antes de la evaluaci\u00f3n: actuaci\u00f3n solicitada y fills. Tinta neutra."],
    [`<span class="zt hind">Later \u00b7 evaluation</span>`, "Hindsight. Ocre sobre papel rayado; nunca dentro de un panel de decisi\u00f3n."],
    [`<span class="unkv">UNKNOWN</span>`, "Valor ausente. Nunca se dibuja como blanco, cero ni conjetura."],
    [`<span class="openv">NOT CLOSED</span>`, "Existe pero no es final (p. ej. ventana de evaluaci\u00f3n abierta). L\u00ednea discontinua."],
    [`<span class="st warn"><span class="g">!</span>Flagged</span>`, "PROXY / UNCERTAIN / STALE: el valor viene con su raz\u00f3n visible."],
    [`<span class="ev">EVIDENCE</span>`, "Recibos, resultados y checks. Informan; no aprueban."],
    [`<span class="auth-box" style="padding:3px 8px;display:inline-block"><span class="seal">AUTHORITY</span></span>`, "Acto de un due\u00f1o de decisi\u00f3n. Doble filete. La evidencia no lo sustituye."],
    [`<span class="mono">\u25c6 \u25b2 \u25a0 \u25cf</span>`, "Recomendaci\u00f3n \u00b7 actuaci\u00f3n solicitada \u00b7 ejecuci\u00f3n/fill \u00b7 outcome: objetos separados, nunca fusionados."],
    [`<span class="pv">valor</span>`, "Subrayado punteado: un clic abre su procedencia (registro, revisi\u00f3n, sha y reloj)."],
  ];
  return `<aside class="semantics-key" id="semantics-key" role="dialog" aria-label="Semantics key" aria-hidden="true">
    <div class="key-hd"><h3 style="margin:0">Semantics key</h3><span class="muted small">una gram\u00e1tica visual para las cuatro superficies</span><span class="grow"></span><button type="button" class="btn" data-key-close>Cerrar</button></div>
    ${rows.map(([swatch, text]) => `<div class="key-row"><span>${swatch}</span><span>${text}</span></div>`).join("")}
  </aside>`;
}

export function renderProvenanceDrawerHtml() {
  return `<aside class="prov-drawer" id="prov-drawer" role="dialog" aria-label="Procedencia" aria-hidden="true">
    <div class="prov-hd"><div class="grow"><div class="caps muted">Procedencia</div><div class="prov-title" data-field="label"></div></div><button type="button" class="btn" data-drawer-close>Cerrar</button></div>
    <div class="prov-bd">
      <dl>
        <dt>Registro</dt><dd class="mono" data-field="record"></dd>
        <dt>sha256</dt><dd class="mono" data-field="sha"></dd>
        <dt>Reloj</dt><dd class="mono" data-field="clock"></dd>
        <dt>Tipo de reloj</dt><dd class="mono" data-field="clock-kind"></dd>
      </dl>
      <div class="note-ev"><span class="ev">EVIDENCE</span> La procedencia muestra de d\u00f3nde viene un valor; no lo vuelve autoritativo.</div>
    </div>
  </aside>
  <div class="prov-scrim" id="prov-scrim"></div>`;
}

// Interacción puramente presentacional: alterna el panel de semántica, abre el
// drawer con atributos ya renderizados y navega entre superficies. No calcula
// ni transforma datos del boundary.
export const PROVENANCE_INTERACTION_SCRIPT = `<script>
(function () {
  "use strict";
  function key() { return document.getElementById("semantics-key"); }
  function drawer() { return document.getElementById("prov-drawer"); }
  function toggleKey(force) {
    var el = key(); if (!el) { return; }
    var on = force === undefined ? !el.classList.contains("on") : force;
    el.classList.toggle("on", on); el.setAttribute("aria-hidden", String(!on));
    var btn = document.querySelector("[data-key-toggle]");
    if (btn) { btn.setAttribute("aria-expanded", String(on)); }
  }
  function openDrawer(el) {
    var d = drawer(); if (!d) { return; }
    var attr = function (name) { return el.getAttribute("data-" + name) || "\u2014"; };
    var set = function (id, value) { var node = d.querySelector('[data-field="' + id + '"]'); if (node) { node.textContent = value; } };
    set("record", attr("record-key") + "@" + attr("revision-id"));
    set("sha", attr("value-sha"));
    set("clock", attr("clock"));
    set("clock-kind", attr("clock-kind"));
    set("label", el.getAttribute("data-prov-label") || "");
    d.classList.add("on"); d.setAttribute("aria-hidden", "false");
    var scrim = document.getElementById("prov-scrim"); if (scrim) { scrim.classList.add("on"); }
  }
  function closeDrawer() {
    var d = drawer(); if (d) { d.classList.remove("on"); d.setAttribute("aria-hidden", "true"); }
    var scrim = document.getElementById("prov-scrim"); if (scrim) { scrim.classList.remove("on"); }
  }
  document.addEventListener("click", function (event) {
    if (event.target.closest("[data-key-toggle]")) { toggleKey(); return; }
    if (event.target.closest("[data-key-close]")) { toggleKey(false); return; }
    var pv = event.target.closest(".pv");
    if (pv) { openDrawer(pv); return; }
    if (event.target.closest("[data-drawer-close]") || event.target.id === "prov-scrim") { closeDrawer(); }
  });
  document.addEventListener("keydown", function (event) {
    if (event.target && event.target.matches && event.target.matches("input, textarea")) { return; }
    var map = { "1": "replay", "2": "backtests", "3": "research", "4": "campaigns" };
    if (map[event.key]) { location.hash = "#" + map[event.key]; }
    if (event.key === "?") { toggleKey(); }
    if (event.key === "Escape") { toggleKey(false); closeDrawer(); }
  });
})();
</script>`;
