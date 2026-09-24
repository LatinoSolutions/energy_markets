// UI-03 / UI-FIDELITY — gramática visual Claude Blind de la UI productiva.
// Fuente visual (contrato de fidelidad 1:1 a 1440 px, owner 24-sep-2026):
// proyecto aislado `energy-markets-claude-blind-ui`, commit c35510b,
// design-proposal/index.html. GOLDEN_CSS es el <style> de ese commit copiado
// literal (sólo cambia el nombre del banner: su texto en producto describe el
// régimen de datos, no "synthetic demo"). PRODUCT_CSS sólo añade lo que el
// producto necesita para dibujar los objetos del boundary dentro de las mismas
// ranuras visuales.
//
// Este módulo no contiene datos: ni los ids demo del prototipo ni sus
// supuestos inventados (definiciones económicas, regla de ventana de
// evaluación, intervalos, órgano de adopción). Los valores los aportan los
// view models atados al Operator Interface Boundary de IMP-29 (§26.5).

export const VISUAL_LANGUAGE_ID = "claude-blind";

const GOLDEN_CSS = `
:root {
  --paper: #f3f1eb;
  --surface: #fbfaf7;
  --surface-2: #f7f5f0;
  --ink: #1a1d21;
  --ink-2: #474a50;
  --ink-3: #75777c;
  --rule: #d9d5cb;
  --rule-2: #e7e3da;

  /* Temporal grammar: colour and texture encode WHEN something was known */
  --asof: #23476b;          /* decision-time: what was known at T0 */
  --asof-bg: #e8edf3;
  --exec: #3d4148;          /* execution window: after T0, before evaluation */
  --exec-bg: #eeede9;
  --hind: #8a4b0f;          /* evaluation / hindsight: known only later */
  --hind-bg: #f6ecdc;
  --hatch-hind: repeating-linear-gradient(135deg, #f6ecdc 0 6px, #efdfc4 6px 7px);

  /* Epistemic states */
  --unk: #6b3d7b;
  --unk-bg: repeating-linear-gradient(45deg, #f3ecf5 0 5px, #e6d8eb 5px 6px);
  --pass: #2f6b3a;
  --pass-bg: #e6efe5;
  --fail: #a3312a;
  --fail-bg: #f6e3e0;
  --warn: #8a6100;
  --warn-bg: #f6edd6;

  /* Arms — validated categorical slots 1–3 (all-pairs PASS, light surface) */
  --arm-base: #2a78d6;
  --arm-a: #eb6834;
  --arm-b: #1baf7a;

  --auth: #2b2a4a;

  --serif: "Iowan Old Style", "Palatino Linotype", Palatino, "Book Antiqua", Georgia, "DejaVu Serif", serif;
  --sans: Inter, "Segoe UI", system-ui, -apple-system, Roboto, "Helvetica Neue", Arial, sans-serif;
  --mono: "JetBrains Mono", "SFMono-Regular", Menlo, Consolas, "DejaVu Sans Mono", monospace;
}
* { box-sizing: border-box; }
html, body { margin: 0; }
body {
  background: var(--paper);
  color: var(--ink);
  font: 13.5px/1.45 var(--sans);
  -webkit-font-smoothing: antialiased;
}
button { font: inherit; color: inherit; }
a { color: inherit; }
.mono { font-family: var(--mono); font-size: 12px; letter-spacing: -0.01em; }
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

/* ---------- Data-regime banner (same slot as the DES-01 banner) ---------- */
.regime {
  background: repeating-linear-gradient(135deg, #1a1d21 0 14px, #2b2f35 14px 28px);
  color: #f3f1eb;
  font: 600 11px/1 var(--mono);
  letter-spacing: .06em;
  text-align: center;
  padding: 6px 12px;
}
.regime b { color: #ffd98a; }

/* ---------- Header ---------- */
header.top {
  background: var(--surface);
  border-bottom: 1px solid var(--rule);
  display: flex; align-items: stretch; gap: 24px;
  padding: 0 20px;
  position: sticky; top: 0; z-index: 20;
}
.brand { display: flex; flex-direction: column; justify-content: center; padding: 10px 0; min-width: 190px; }
.brand .name { font: 600 18px/1.1 var(--serif); letter-spacing: -.01em; }
.brand .sub { font-size: 11px; color: var(--ink-3); letter-spacing: .04em; }
nav.ws { display: flex; gap: 2px; }
nav.ws a {
  display: flex; flex-direction: column; justify-content: center;
  padding: 0 16px; text-decoration: none; color: var(--ink-2);
  border-bottom: 3px solid transparent; min-width: 150px; white-space: nowrap;
}
nav.ws a .k { font: 11px var(--mono); color: var(--ink-3); }
nav.ws a .t { font-weight: 600; }
nav.ws a:hover { background: var(--surface-2); }
nav.ws a.on { color: var(--ink); border-bottom-color: var(--ink); background: var(--paper); }
.top .tools { margin-left: auto; display: flex; align-items: center; gap: 10px; }
.btn {
  white-space: nowrap;
  border: 1px solid var(--rule); background: var(--surface); border-radius: 4px;
  padding: 5px 10px; cursor: pointer; font-size: 12.5px;
}
.btn:hover { border-color: var(--ink-3); }
.btn.on { background: var(--ink); color: var(--surface); border-color: var(--ink); }
.btn.link { border-color: transparent; background: none; text-decoration: underline; text-underline-offset: 3px; padding: 2px 4px; }
.clock { font: 11.5px var(--mono); color: var(--ink-2); text-align: right; line-height: 1.3; white-space: nowrap; }

/* ---------- Context strip ---------- */
.ctx {
  display: flex; gap: 8px; align-items: center; flex-wrap: wrap;
  padding: 8px 20px; border-bottom: 1px solid var(--rule);
  background: var(--surface-2); font-size: 12.5px;
}
.ctx .sep { color: var(--ink-3); }
.ctx a { text-decoration: none; border-bottom: 1px dotted var(--ink-3); }

main { padding: 18px 20px 60px; max-width: 1600px; margin: 0 auto; }

/* ---------- Surfaces ---------- */
.card { background: var(--surface); border: 1px solid var(--rule); border-radius: 6px; }
.card > .hd { padding: 10px 14px; border-bottom: 1px solid var(--rule-2); display: flex; align-items: baseline; gap: 10px; }
.card > .hd h3 { margin: 0; font: 600 14px/1.2 var(--sans); }
.card > .bd { padding: 12px 14px; }
h1.page { font: 600 24px/1.15 var(--serif); margin: 0 0 2px; letter-spacing: -.01em; }
h2.sec { font: 600 16px/1.2 var(--serif); margin: 22px 0 10px; }
.lede { color: var(--ink-2); max-width: 880px; margin: 0; }
.grid { display: grid; gap: 14px; }
.g2 { grid-template-columns: 1fr 1fr; }
.g3 { grid-template-columns: repeat(3, 1fr); }
.split { display: grid; grid-template-columns: 300px 1fr; gap: 18px; align-items: start; }

table.t { width: 100%; border-collapse: collapse; }
table.t th { text-align: left; font-weight: 600; color: var(--ink-3); font-size: 10.5px; text-transform: uppercase; letter-spacing: .07em; padding: 7px 10px; border-bottom: 1px solid var(--rule); white-space: nowrap; }
table.t td { padding: 8px 10px; border-bottom: 1px solid var(--rule-2); vertical-align: top; }
table.t tr:last-child td { border-bottom: 0; }
table.t tr.sel td { background: #efece4; }
table.t tr.click { cursor: pointer; }
table.t tr.click:hover td { background: var(--surface-2); }

/* ---------- Epistemic chips ---------- */
.st { display: inline-flex; align-items: center; gap: 5px; border-radius: 3px; padding: 1px 7px 1px 5px; font-size: 11.5px; font-weight: 600; white-space: nowrap; border: 1px solid transparent; line-height: 18px; }
.st .g { font-family: var(--mono); font-weight: 700; }
.st.pass { color: var(--pass); background: var(--pass-bg); }
.st.fail { color: var(--fail); background: var(--fail-bg); }
.st.warn { color: var(--warn); background: var(--warn-bg); }
.st.unk  { color: var(--unk); background: var(--unk-bg); border-color: #cdb8d6; }
.st.open { color: var(--ink-2); background: var(--surface); border: 1px dashed var(--ink-3); }
.st.na   { color: var(--ink-3); background: transparent; border: 1px solid var(--rule); font-weight: 500; }
.st.run  { color: var(--asof); background: var(--asof-bg); }

/* Explicit unknown value — never blank, never zero */
.unkv { display: inline-block; background: var(--unk-bg); color: var(--unk); border: 1px solid #cdb8d6; border-radius: 3px; padding: 0 6px; font: 600 11.5px/18px var(--mono); }
.openv { display: inline-block; border: 1px dashed var(--ink-3); color: var(--ink-2); border-radius: 3px; padding: 0 6px; font: 600 11.5px/18px var(--mono); }

/* Temporal zone tags */
.zt { display: inline-flex; gap: 6px; align-items: center; font: 600 10.5px/1 var(--mono); letter-spacing: .05em; padding: 4px 7px; border-radius: 3px; text-transform: uppercase; }
.zt.asof { background: var(--asof); color: #fff; }
.zt.exec { background: var(--exec); color: #fff; }
.zt.hind { background: var(--hind); color: #fff; }

/* Evidence vs authority */
.ev { white-space: nowrap; display: inline-flex; gap: 5px; align-items: center; font: 600 10.5px/1 var(--mono); letter-spacing: .05em; padding: 3px 6px; border: 1px solid var(--ink-3); color: var(--ink-2); border-radius: 3px; background: var(--surface); }
.auth-box { border: 3px double var(--auth); border-radius: 4px; padding: 12px 14px; background: #f4f3f8; }
.auth-box .seal { font: 700 10.5px/1 var(--mono); letter-spacing: .1em; color: var(--auth); }

/* Provenance-bearing values: dotted underline, click to inspect */
.pv { background: none; border: 0; padding: 0; cursor: pointer; border-bottom: 1px dotted var(--ink-3); font: inherit; color: inherit; text-align: left; }
.pv:hover { background: #ebe7dc; border-bottom-color: var(--ink); }
.pv:focus-visible, .btn:focus-visible, nav.ws a:focus-visible { outline: 2px solid var(--asof); outline-offset: 2px; }

/* Arm swatches */
.sw { display: inline-block; width: 10px; height: 10px; border-radius: 2px; vertical-align: -1px; margin-right: 6px; }
.arm { display: inline-flex; align-items: center; font-weight: 600; white-space: nowrap; }

/* ---------- Campaigns ---------- */
.clist .it { display: block; padding: 11px 14px; border-bottom: 1px solid var(--rule-2); text-decoration: none; cursor: pointer; }
.clist .it:last-child { border-bottom: 0; }
.clist .it:hover { background: var(--surface-2); }
.clist .it.on { background: #ece9e1; box-shadow: inset 3px 0 0 var(--ink); }
.clist .it .ttl { font-weight: 600; margin: 2px 0 4px; }
.bar { display: flex; height: 8px; border-radius: 2px; overflow: hidden; gap: 2px; background: transparent; min-width: 140px; }
.bar > span { display: block; height: 100%; }
.bar .closed { background: var(--ink-2); }
.bar .open { background: repeating-linear-gradient(135deg, #fff 0 3px, #9b9da1 3px 4px); border: 1px solid #9b9da1; }
.bar .notrun { background: var(--unk-bg); border: 1px solid #cdb8d6; }
.unk-item { border-left: 3px solid var(--unk); padding: 8px 12px; background: #faf7fb; margin-bottom: 8px; border-radius: 0 4px 4px 0; }
.unk-item .q { font-weight: 600; }
.drill { display: inline-flex; gap: 4px; }
.drill a { font-size: 11.5px; padding: 2px 7px; border: 1px solid var(--rule); border-radius: 3px; text-decoration: none; background: var(--surface); white-space: nowrap; }
.drill a:hover { border-color: var(--ink); }
.receipt { display: grid; grid-template-columns: 140px 1fr auto; gap: 10px; padding: 7px 0; border-bottom: 1px solid var(--rule-2); align-items: baseline; }
.receipt:last-child { border-bottom: 0; }

/* ---------- Replay ---------- */
.dechead { display: flex; align-items: flex-end; gap: 18px; flex-wrap: wrap; }
.tl { position: relative; height: 74px; margin: 6px 0 2px; }
.chain { display: grid; grid-template-columns: 1fr 22px 1fr 22px 1fr 34px 1fr; align-items: stretch; margin-top: 12px; }
.obj { background: var(--surface); border: 1px solid var(--rule); border-radius: 6px; display: flex; flex-direction: column; min-width: 0; }
.obj .ohd { display: flex; align-items: center; gap: 8px; padding: 8px 12px; border-bottom: 1px solid var(--rule-2); }
.obj .glyph { font: 700 14px/1 var(--mono); width: 22px; height: 22px; border-radius: 3px; display: grid; place-items: center; background: var(--ink); color: #fff; }
.obj .otype { font-weight: 700; font-size: 12.5px; }
.obj .obd { padding: 10px 12px; flex: 1; }
.obj .big { font: 600 17px/1.25 var(--serif); margin: 2px 0 6px; }
.obj .kv { display: grid; grid-template-columns: auto 1fr; gap: 3px 10px; font-size: 12px; }
.obj .kv dt { color: var(--ink-3); }
.obj .kv dd { margin: 0; }
.obj.z-asof { border-top: 4px solid var(--asof); }
.obj.z-exec { border-top: 4px solid var(--exec); }
.obj.z-hind { border-top: 4px solid var(--hind); background: var(--hatch-hind); }
.obj.z-hind .obd, .obj.z-hind .ohd { background: rgba(251,250,247,.86); }
.obj.none .obd { color: var(--ink-3); }
.link { display: grid; place-items: center; color: var(--ink-3); font: 16px var(--mono); }
.horizon { position: relative; display: grid; place-items: center; }
.horizon::before { content: ""; position: absolute; top: -8px; bottom: -8px; left: 50%; border-left: 2px dashed var(--hind); }
.horizon span { position: relative; writing-mode: vertical-rl; transform: rotate(180deg); background: var(--paper); color: var(--hind); font: 700 10px/1 var(--mono); letter-spacing: .1em; padding: 6px 0; }
.gapnote { margin-top: 8px; font-size: 11.5px; border-left: 2px solid var(--warn); padding: 3px 8px; background: var(--warn-bg); color: #5d4300; border-radius: 0 3px 3px 0; }
.zones { display: grid; grid-template-columns: minmax(0, 1.45fr) 34px minmax(0, 1fr); margin-top: 18px; align-items: start; }
.zone { border-radius: 6px; border: 1px solid var(--rule); background: var(--surface); }
.zone > .zhd { padding: 10px 14px; display: flex; align-items: center; gap: 10px; border-bottom: 1px solid var(--rule-2); }
.zone > .zbd { padding: 12px 14px; }
.zone.asof { box-shadow: inset 0 4px 0 var(--asof); }
.zone.asof > .zhd { background: var(--asof-bg); }
.zone.hind { box-shadow: inset 0 4px 0 var(--hind); background: var(--hatch-hind); }
.zone.hind > .zhd, .zone.hind > .zbd { background: rgba(251,250,247,.9); }
.sealed { border: 1px dashed var(--hind); border-radius: 4px; padding: 14px; text-align: center; color: var(--hind); background: rgba(251,250,247,.9); }
.sealed .big { font: 600 16px var(--serif); color: var(--ink); }
.metric { display: grid; grid-template-columns: 1fr auto; gap: 4px 12px; align-items: baseline; }
.metric .lbl { color: var(--ink-2); }
.metric .val { font: 600 15px var(--mono); text-align: right; }

/* ---------- Backtests ---------- */
.armhead { display: flex; gap: 16px; flex-wrap: wrap; align-items: center; }
.ci { font: 11.5px var(--mono); color: var(--ink-3); }
.withheld { font: 600 12px var(--mono); color: var(--unk); }
details.tbl summary { cursor: pointer; font-size: 12px; color: var(--ink-2); margin-top: 6px; }
.chk { display: grid; grid-template-columns: 1fr auto; gap: 2px 10px; padding: 7px 0; border-bottom: 1px solid var(--rule-2); align-items: start; }
.chk:last-child { border-bottom: 0; }
.chk .d { grid-column: 1 / -1; font-size: 11.5px; color: var(--ink-3); }
.note-ev { font-size: 12px; border: 1px solid var(--rule); border-left: 3px solid var(--ink-3); padding: 8px 10px; background: var(--surface-2); border-radius: 0 4px 4px 0; }

/* ---------- Research ---------- */
.stack .it { padding: 11px 14px; border-bottom: 1px solid var(--rule-2); cursor: pointer; display: block; text-decoration: none; }
.stack .it:hover { background: var(--surface-2); }
.stack .it.on { background: #ece9e1; box-shadow: inset 3px 0 0 var(--ink); }
.stack .it:last-child { border-bottom: 0; }
.stage { font: 600 10.5px/1 var(--mono); letter-spacing: .04em; color: var(--ink-2); }
.hyp { font: 400 17px/1.45 var(--serif); margin: 4px 0 10px; }
.crit { display: grid; grid-template-columns: 22px 1fr auto; gap: 8px; padding: 8px 0; border-top: 1px solid var(--rule-2); align-items: start; }

/* ---------- Drawer (provenance) ---------- */
.scrim { position: fixed; inset: 0; background: rgba(26,29,33,.18); opacity: 0; pointer-events: none; transition: opacity .15s; z-index: 40; }
.scrim.on { opacity: 1; pointer-events: auto; }
aside.drawer {
  position: fixed; top: 0; right: 0; bottom: 0; width: 420px; background: var(--surface);
  border-left: 1px solid var(--rule); box-shadow: -12px 0 30px rgba(0,0,0,.08);
  transform: translateX(100%); transition: transform .18s ease-out; z-index: 50; display: flex; flex-direction: column;
}
aside.drawer.on { transform: none; }
.drawer .dh { padding: 14px 16px; border-bottom: 1px solid var(--rule); display: flex; gap: 10px; align-items: flex-start; }
.drawer .db { padding: 14px 16px; overflow: auto; }
.drawer dl { display: grid; grid-template-columns: 130px 1fr; gap: 8px 12px; margin: 0; font-size: 12.5px; }
.drawer dt { color: var(--ink-3); }
.drawer dd { margin: 0; word-break: break-word; }
.bitemp { margin: 14px 0; border: 1px solid var(--rule); border-radius: 4px; padding: 10px; }

/* ---------- Key (legend of the visual grammar) ---------- */
.key { position: fixed; top: 96px; right: 20px; width: 460px; background: var(--surface); border: 1px solid var(--ink-3); border-radius: 6px; box-shadow: 0 12px 30px rgba(0,0,0,.14); z-index: 45; display: none; }
.key.on { display: block; }
.key .hd h3 { white-space: nowrap; }
.key .kr { display: grid; grid-template-columns: 150px 1fr; gap: 10px; padding: 7px 14px; border-bottom: 1px solid var(--rule-2); align-items: center; font-size: 12px; }

/* ---------- Tooltip ---------- */
#tip { position: fixed; pointer-events: none; background: var(--ink); color: #fff; font: 12px/1.35 var(--sans); padding: 6px 9px; border-radius: 4px; z-index: 60; max-width: 280px; display: none; }
#tip .m { font-family: var(--mono); }

svg text { font-family: var(--sans); }
svg .axis text { font-size: 10.5px; fill: var(--ink-3); }
svg .axis line, svg .axis path { stroke: var(--rule); }
.foot { margin-top: 30px; font-size: 11.5px; color: var(--ink-3); border-top: 1px solid var(--rule); padding-top: 10px; }
`;

// Añadidos de producto. Mismas medidas/colores del mockup; sólo nombran las
// clases con las que el render conserva los contratos del boundary
// (lane/zone/exposure/events) que fijan UI-01/UI-03.
const PRODUCT_CSS = `
body.em-app { min-width: 1280px; }

/* Zonas temporales del boundary con el tratamiento de .zone.asof / .zone.hind */
.lane.zone-decision { border-radius: 6px; border: 1px solid var(--rule); background: var(--surface); box-shadow: inset 0 4px 0 var(--asof); }
.lane.zone-decision > .zhd { background: var(--asof-bg); padding: 10px 14px; display: flex; align-items: center; gap: 10px; border-bottom: 1px solid var(--rule-2); border-radius: 6px 6px 0 0; }
.lane.zone-evaluation { border-radius: 6px; border: 1px solid var(--rule); box-shadow: inset 0 4px 0 var(--hind); background: var(--hatch-hind); }
.lane.zone-evaluation > .zhd, .lane.zone-evaluation > .zbd { background: rgba(251,250,247,.9); }
.lane.zone-evaluation > .zhd { padding: 10px 14px; display: flex; align-items: center; gap: 10px; border-bottom: 1px solid var(--rule-2); }
.lane > .zbd { padding: 12px 14px; }
.lane .exposure-table { margin-top: 6px; }

/* Tabla de inputs de T0 (exposición §26.2): mismas columnas que la tabla del mockup */
ul.data-list { list-style: none; margin: 0; padding: 0; }
.exp-head, ul.exposure-list > li { display: grid; grid-template-columns: minmax(0, 1.25fr) minmax(0, 1.2fr) minmax(0, 1fr) 118px; gap: 0 12px; align-items: start; padding: 8px 10px; border-bottom: 1px solid var(--rule-2); }
.exp-head { font-weight: 600; color: var(--ink-3); font-size: 10.5px; text-transform: uppercase; letter-spacing: .07em; padding: 7px 10px; border-bottom: 1px solid var(--rule); }
ul.exposure-list > li:last-child { border-bottom: 0; }
ul.exposure-list > li > .item-label { order: 1; }
ul.exposure-list > li > .value, ul.exposure-list > li > .reason { order: 2; }
ul.exposure-list > li > .provenance, ul.exposure-list > li > .condition { order: 3; }
ul.exposure-list > li > .st { order: 4; justify-self: start; }
ul.exposure-list .reason { font-size: 11.5px; color: var(--ink-3); }
ul.exposure-list .condition { font: 11px var(--mono); color: var(--ink-3); margin: 0; }
ul.exposure-list .value { font: 12px var(--mono); border-bottom: 1px dotted var(--ink-3); justify-self: start; }
.exposure-list .provenance { justify-self: start; }

/* Puntos de timeline dentro de las zonas */
ul.ts-points > li { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 2px 12px; padding: 7px 0; border-bottom: 1px solid var(--rule-2); align-items: start; font-size: 12.5px; }
ul.ts-points > li > .point-key { grid-column: 1; grid-row: 1; justify-self: start; }
ul.ts-points > li > .value { grid-column: 2; grid-row: 1 / span 2; text-align: right; }
ul.ts-points > li:last-child { border-bottom: 0; }
ul.ts-points .point-key { font: 600 12px var(--mono); }
ul.ts-points .value { font: 600 13px var(--mono); }
ul.ts-points .clock { grid-column: 1; grid-row: 2; font: 11px var(--mono); color: var(--ink-3); text-align: left; }
.lane-note { font-size: 12px; margin: 10px 0 0; }
.unk-row { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 8px; padding: 6px 0; border-top: 1px solid var(--rule-2); font-size: 12px; align-items: baseline; }

/* Actuaciones dentro del objeto Execution · fill */
section.events { display: block; }
ul.events-list { list-style: none; margin: 0; padding: 0; }
ul.events-list > li.event { display: grid; grid-template-columns: auto 1fr; gap: 2px 8px; padding: 6px 0; border-bottom: 1px solid var(--rule-2); align-items: baseline; font-size: 12px; }
ul.events-list > li.event:last-child { border-bottom: 0; }
.event .event-class { font: 600 10.5px/18px var(--mono); letter-spacing: .04em; padding: 0 6px; border-radius: 3px; color: var(--warn); background: var(--warn-bg); white-space: nowrap; }
.event.event-class-HYPOTHETICAL .event-class { color: var(--ink-2); background: var(--surface); border: 1px dashed var(--ink-3); }
.event.event-class-REAL .event-class { color: var(--auth); background: #f4f3f8; border: 3px double var(--auth); }
.event.event-class-HUMAN_INTERVENTION .event-class { color: var(--unk); background: #faf7fb; border: 1px solid #cdb8d6; }
.event .event-id { font: 700 12px var(--mono); }
.event .event-clock, .event .event-ref { grid-column: 2; font: 11px var(--mono); color: var(--ink-3); }
.event .attribution { grid-column: 2; font-size: 11.5px; color: var(--unk); }
.interv { margin-top: 12px; background: var(--surface); border: 1px solid var(--rule); border-top: 4px solid var(--unk); border-radius: 6px; padding: 8px 12px; }
.interv .ohd { display: flex; gap: 8px; align-items: center; }

/* Gráficos sin serie canónica: el marco se conserva, la ausencia se dibuja */
.chartwrap .hind-layer { display: none; }
.chartwrap.hind-on .hind-layer { display: inline; }
.chartwrap.hind-on .sealed-layer { display: none; }
.nodata { border: 1px solid #cdb8d6; background: var(--unk-bg); color: var(--unk); border-radius: 4px; padding: 10px 12px; font-size: 12px; }
.nodata b { font: 700 11px var(--mono); letter-spacing: .05em; }

/* Condición canónica y razón del boundary junto a cada ausencia */
.withheld { white-space: nowrap; }
.item-label { font-weight: 600; }
.condition { font: 600 10.5px/18px var(--mono); color: var(--unk); letter-spacing: .04em; margin: 0 4px; }
.reason { color: var(--ink-3); font-size: 12px; }

/* Procedencia (registro@revisión · sha) */
.pv.provenance { font: 11px var(--mono); color: var(--ink-3); }
.value[data-value] { font-family: var(--mono); }
.kvline { display: inline; }
.kvline .k { color: var(--ink-3); font-size: .85em; margin-right: 3px; }

/* Barra de error fail-closed dentro de la misma composición */
.errbar { border: 1px solid var(--fail); border-left: 4px solid var(--fail); background: var(--fail-bg); border-radius: 0 4px 4px 0; padding: 10px 14px; margin-bottom: 16px; font-size: 12.5px; }
.errbar ul { list-style: none; margin: 6px 0 0; padding: 0; }
.error-code { font: 600 11.5px var(--mono); color: var(--fail); margin-right: 6px; }

/* Portada de navegación */
.surface-index { display: grid; grid-template-columns: repeat(4, 1fr); gap: 14px; margin-top: 16px; }
.nav-card { display: block; text-decoration: none; }
.nav-card:hover { border-color: var(--ink-3); }
.nav-card .t { font: 600 18px/1.2 var(--serif); margin: 4px 0 6px; }
`;

export const UI_STYLESHEET = `${GOLDEN_CSS}${PRODUCT_CSS}`;

// Semantics key: misma tarjeta y filas que el mockup (#key). Sólo gramática
// visual; ninguna definición económica ni regla de evaluación.
export function renderSemanticsKeyHtml() {
  const rows = [
    ['<span class="zt asof">T₀ · decision-time</span>', "What the system knew at the decision instant. Slate blue, solid."],
    ['<span class="zt exec">Execution</span>', "After T₀, before evaluation: actuations and fills. Neutral ink."],
    ['<span class="zt hind">Later · evaluation</span>', "Hindsight. Ochre on hatched paper; never drawn inside a T₀ panel."],
    ['<span><span class="unkv">UNKNOWN</span></span>', "Value absent. Never shown as blank, zero or a guess. Plum hatch."],
    ['<span><span class="openv">NOT CLOSED</span></span>', "Exists but not final yet (e.g. evaluation still open). Dashed."],
    ['<span><span class="ev">EVIDENCE</span></span>', "Receipts, results, checks. Informs; never approves."],
    ['<span><span class="auth-box" style="padding:3px 8px;display:inline-block"><span class="seal">AUTHORITY</span></span></span>', "A decision owner's recorded act. Double rule. Only place “approved” can appear."],
    ['<span class="mono">◆ ▲ ■ ●</span>', "Recommendation · Requested action · Execution/fill · Outcome — four separate objects, never merged."],
    ['<span><span class="pv">record@revision</span></span>', "Dotted underline = click for provenance (record, revision, sha, clock)."],
  ];
  return `<div class="key semantics-key" id="semantics-key" role="dialog" aria-label="Semantics key" aria-hidden="true">
  <div class="card" style="border:0">
    <div class="hd"><h3>Semantics key</h3><span class="muted small">one visual grammar, all four workspaces</span><span class="grow"></span><button type="button" class="btn link" data-key-close>close</button></div>
  </div>
  ${rows.map(([swatch, text], index) => `<div class="kr"${index === rows.length - 1 ? ' style="border:0"' : ""}><span>${swatch}</span><span>${text}</span></div>`).join("\n  ")}
</div>`;
}

// Drawer de procedencia: misma composición que el mockup. Lo rellena el script
// con atributos ya renderizados (registro, revisión, sha, reloj); no calcula.
export function renderProvenanceDrawerHtml() {
  return `<div class="scrim prov-scrim" id="prov-scrim"></div>
<aside class="drawer prov-drawer" id="prov-drawer" role="dialog" aria-label="Provenance" aria-hidden="true">
  <div class="dh"><div class="grow"><div class="caps muted">Provenance</div><div style="font:600 17px var(--serif);margin-top:2px" data-field="label"></div></div><button type="button" class="btn" data-drawer-close>Close</button></div>
  <div class="db">
    <div class="mono" style="font-size:20px;margin-bottom:10px;word-break:break-all" data-field="value"></div>
    <dl>
      <dt>Record</dt><dd class="mono small" data-field="record"></dd>
      <dt>Revision</dt><dd class="mono small" data-field="revision"></dd>
      <dt>sha256</dt><dd class="mono small" data-field="sha"></dd>
    </dl>
    <div class="bitemp">
      <div class="caps muted" style="margin-bottom:8px">Clock · as bound by the boundary</div>
      <dl>
        <dt>Clock</dt><dd class="mono small" data-field="clock"></dd>
        <dt>Clock kind</dt><dd class="mono small" data-field="clock-kind"></dd>
      </dl>
    </div>
    <div class="note-ev"><span class="ev">EVIDENCE</span> Provenance shows where a value came from. It does not make the value authoritative.</div>
  </div>
</aside>
<div id="tip"></div>`;
}

// Interacción puramente presentacional (como el mockup): key, drawer, tooltip,
// overlay de hindsight y atajos 1–4. Sin red, sin escritura, sin cálculo.
export const PROVENANCE_INTERACTION_SCRIPT = `<script>
(function () {
  "use strict";
  var NAV_KEYS = { "1": "campaigns", "2": "replay", "3": "backtests", "4": "research" };
  function byId(id) { return document.getElementById(id); }
  function toggleKey(force) {
    var el = byId("semantics-key"); if (!el) { return; }
    var on = force === undefined ? !el.classList.contains("on") : force;
    el.classList.toggle("on", on); el.setAttribute("aria-hidden", String(!on));
    var btn = document.querySelector("[data-key-toggle]");
    if (btn) { btn.setAttribute("aria-expanded", String(on)); }
  }
  function openDrawer(el) {
    var d = byId("prov-drawer"); if (!d) { return; }
    var attr = function (name) { return el.getAttribute("data-" + name) || "\\u2014"; };
    var set = function (id, value) { var node = d.querySelector('[data-field="' + id + '"]'); if (node) { node.textContent = value; } };
    set("label", el.getAttribute("data-prov-label") || "");
    set("value", el.getAttribute("data-prov-value") || attr("record-key"));
    set("record", attr("record-key"));
    set("revision", attr("revision-id"));
    set("sha", attr("value-sha"));
    set("clock", attr("clock"));
    set("clock-kind", attr("clock-kind"));
    d.classList.add("on"); d.setAttribute("aria-hidden", "false");
    var scrim = byId("prov-scrim"); if (scrim) { scrim.classList.add("on"); }
    var close = d.querySelector("[data-drawer-close]"); if (close) { close.focus(); }
  }
  function closeDrawer() {
    var d = byId("prov-drawer"); if (d) { d.classList.remove("on"); d.setAttribute("aria-hidden", "true"); }
    var scrim = byId("prov-scrim"); if (scrim) { scrim.classList.remove("on"); }
  }
  function goTo(surface) {
    var link = document.querySelector('nav [data-nav="' + surface + '"]');
    if (link && link.getAttribute("href").charAt(0) !== "#") { location.href = link.getAttribute("href"); return; }
    location.hash = "#" + surface;
  }
  document.addEventListener("click", function (event) {
    if (event.target.closest("[data-key-toggle]")) { toggleKey(); return; }
    if (event.target.closest("[data-key-close]")) { toggleKey(false); return; }
    var hind = event.target.closest("[data-hind-toggle]");
    if (hind) {
      var wrap = document.querySelector(".chartwrap"); if (!wrap) { return; }
      var on = !wrap.classList.contains("hind-on");
      wrap.classList.toggle("hind-on", on); hind.classList.toggle("on", on);
      hind.textContent = "Hindsight overlay: " + (on ? "ON" : "off");
      return;
    }
    var pv = event.target.closest(".pv[data-record-key]");
    if (pv) { openDrawer(pv); return; }
    if (event.target.closest("[data-drawer-close]") || event.target.id === "prov-scrim") { closeDrawer(); }
  });
  document.addEventListener("keydown", function (event) {
    if (event.target && event.target.matches && event.target.matches("input, textarea")) { return; }
    if (NAV_KEYS[event.key]) { goTo(NAV_KEYS[event.key]); }
    if (event.key === "?") { toggleKey(); }
    if (event.key === "Escape") { toggleKey(false); closeDrawer(); }
  });
  var tip = byId("tip");
  document.addEventListener("mousemove", function (event) {
    if (!tip) { return; }
    var el = event.target.closest && event.target.closest("[data-tip]");
    if (!el) { tip.style.display = "none"; return; }
    tip.textContent = el.getAttribute("data-tip");
    tip.style.display = "block";
    tip.style.left = Math.min(event.clientX + 14, innerWidth - 300) + "px";
    tip.style.top = (event.clientY + 14) + "px";
  });
  var params = new URLSearchParams(location.search);
  if (params.get("key") === "1") { toggleKey(true); }
  if (params.get("hind") === "1") { var hindButton = document.querySelector("[data-hind-toggle]"); if (hindButton) { hindButton.click(); } }
  if (params.has("prov")) {
    var target = document.querySelectorAll(".pv[data-record-key]")[Number(params.get("prov"))];
    if (target) { openDrawer(target); }
  }
})();
</script>`;
