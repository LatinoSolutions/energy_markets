// Tests UI-FIDELITY: protegen la composición del mockup Claude Blind que Bru
// seleccionó (commit c35510b, design-proposal/index.html) y cuya fidelidad 1:1
// a 1440 px pidió el 24-sep-2026. Son estructurales (ranuras, orden, reglas
// CSS clave), no de píxeles; la evidencia visual vive en
// docs/product/ui-fidelity/. También fijan que la fidelidad no importa ningún
// hecho demo del mockup y que las ranuras sin dato quedan fail-closed.

import { test } from "node:test";
import assert from "node:assert/strict";

import { canonicalValueSha256 } from "../../src/pit-views/pit-record.mjs";
import {
  backendIndexFromManifest,
  buildExposure,
  buildOperatorTimeline,
  EXPOSURE_CONDITION,
  EXPOSURE_SOURCE_KIND,
  WORKING_MODE,
} from "../../src/operator-interface/index.mjs";
import { EXPOSURE_FIELDS } from "../../src/operator-interface/exposure.mjs";
import { EXECUTION_CLASS } from "../../src/operator-interface/timeline.mjs";
import {
  buildBacktestsViewModel,
  buildCampaignsViewModel,
  buildReplayViewModel,
  buildResearchViewModel,
  PROVENANCE_INTERACTION_SCRIPT,
  renderNavigationPage,
  renderProvenanceDrawerHtml,
  renderSemanticsKeyHtml,
  renderSurfacePage,
  UI_STYLESHEET,
} from "../../src/ui/index.mjs";
import {
  AUTHORITY_BASE,
  DECISION_BASE,
  EVALUATION_BENCHMARK,
  RECEIPT_BASE,
  RECOMMENDATION_BASE,
  backendRefOf,
  buildManifest,
} from "../operator-interface/fixtures.mjs";

function boundReplayVm() {
  const built = buildManifest({ records: [DECISION_BASE, RECOMMENDATION_BASE, EVALUATION_BENCHMARK, AUTHORITY_BASE, RECEIPT_BASE] });
  assert.equal(built.ok, true, JSON.stringify(built.errors ?? "?"));
  const manifest = built.manifest;
  const backendIndex = backendIndexFromManifest(manifest);
  const recommendationRef = backendRefOf(RECOMMENDATION_BASE);
  const timeline = buildOperatorTimeline({
    manifest,
    decisionBoundaryUtc: "2026-04-01T07:00:00Z",
    evaluationAsOfUtc: "2026-07-01T07:00:00Z",
    workingMode: WORKING_MODE.REPLAY,
    executions: [{ eventId: "SIM-1", class: EXECUTION_CLASS.SIMULATED, relatedRecommendationRef: recommendationRef, occurredAtUtc: "2026-04-02T08:01:00Z" }],
    interventions: [{ eventId: "HUM-1", relatedRecommendationRef: recommendationRef, occurredAtUtc: "2026-04-02T08:04:00Z", attribution: "HUMAN" }],
  });
  assert.equal(timeline.ok, true, JSON.stringify(timeline.errors ?? "?"));
  const exposure = buildExposure({
    boundaryUtc: "2026-04-01T07:00:00Z",
    observations: [{
      field: "recommendation",
      condition: EXPOSURE_CONDITION.AVAILABLE,
      value: RECOMMENDATION_BASE.value,
      provenance: { sourceKind: EXPOSURE_SOURCE_KIND.RECOMMENDATION, recordKey: RECOMMENDATION_BASE.key, revisionId: RECOMMENDATION_BASE.revisionId, valueSha256: canonicalValueSha256(RECOMMENDATION_BASE.value).sha256 },
    }],
    backendManifest: manifest,
  });
  assert.equal(exposure.ok, true, JSON.stringify(exposure.errors ?? "?"));
  const vm = buildReplayViewModel({ timeline, exposure, backendIndex });
  assert.equal(vm.ok, true, JSON.stringify(vm.errors ?? "?"));
  return vm;
}

// Estado que hoy sirve el servicio persistente: sin manifest backend inyectado.
function servedDefaultPages() {
  return {
    replay: renderSurfacePage("replay", buildReplayViewModel({})),
    backtests: renderSurfacePage("backtests", buildBacktestsViewModel({ backendIndex: null, rows: [] })),
    research: renderSurfacePage("research", buildResearchViewModel({ backendIndex: null, records: [] })),
    campaigns: renderSurfacePage("campaigns", buildCampaignsViewModel({ backendIndex: null, campaigns: [], runs: [] })),
  };
}

function inOrder(html, needles) {
  let cursor = -1;
  for (const needle of needles) {
    const at = html.indexOf(needle, cursor + 1);
    assert.ok(at > cursor, `"${needle}" debe aparecer después de lo anterior`);
    cursor = at;
  }
}

// ---------- CSS: el stylesheet del mockup es la base literal ----------

test("UI-FIDELITY: el stylesheet conserva las reglas de composición del mockup", () => {
  for (const rule of [
    "--paper: #f3f1eb;",
    "font: 13.5px/1.45 var(--sans);",
    "header.top {",
    "nav.ws a {",
    ".brand .name { font: 600 18px/1.1 var(--serif);",
    "h1.page { font: 600 24px/1.15 var(--serif);",
    "h2.sec { font: 600 16px/1.2 var(--serif);",
    ".split { display: grid; grid-template-columns: 300px 1fr;",
    ".chain { display: grid; grid-template-columns: 1fr 22px 1fr 22px 1fr 34px 1fr;",
    ".zones { display: grid; grid-template-columns: minmax(0, 1.45fr) 34px minmax(0, 1fr);",
    ".horizon::before",
    ".obj.z-hind { border-top: 4px solid var(--hind); background: var(--hatch-hind); }",
    ".auth-box { border: 3px double var(--auth);",
    ".hyp { font: 400 17px/1.45 var(--serif);",
    ".clist .it.on",
    ".stack .it.on",
    ".unk-item {",
    ".key .kr {",
    "aside.drawer {",
    ".bitemp {",
    ".regime {",
  ]) {
    assert.ok(UI_STYLESHEET.includes(rule), `falta la regla del mockup: ${rule}`);
  }
});

// ---------- shell compartido ----------

test("UI-FIDELITY: las cuatro superficies y la portada comparten el shell del mockup", () => {
  const pages = { ...servedDefaultPages(), navigation: renderNavigationPage() };
  for (const [name, html] of Object.entries(pages)) {
    inOrder(html, ['<div class="regime">', '<header class="top', '<div class="brand">', '<nav class="ws', "data-key-toggle", '<div class="clock">', '<div class="ctx"', '<main id="main"', '<div class="foot">']);
    // pestañas en el orden y con los subtítulos del mockup
    inOrder(html, ['data-nav="campaigns"><span class="k">1', 'data-nav="replay"><span class="k">2', 'data-nav="backtests"><span class="k">3', 'data-nav="research"><span class="k">4']);
    assert.ok(html.includes('id="semantics-key"'), `${name}: key`);
    assert.ok(html.includes('id="prov-drawer"'), `${name}: drawer`);
  }
});

// ---------- Replay ----------

test("UI-FIDELITY: Replay reproduce cabecera, timeline, cadena de cuatro objetos y zonas", () => {
  const html = renderSurfacePage("replay", boundReplayVm());
  inOrder(html, [
    '<div class="dechead">',
    "Operator timeline",
    '<div class="chain">',
    "Recommendation", "Requested action", "Execution · fill",
    "EVALUATION · LATER",
    "Outcome · evaluation",
    '<div class="zones">',
    'data-view-scope="decision"',
    "Hindsight overlay",
    "Sealed: after T₀",
    '<div class="exp-head">',
    "KNOWLEDGE HORIZON",
    'data-view-scope="evaluation"',
  ]);
  // cuatro objetos con su zona temporal y su glifo
  assert.match(html, /<div class="obj z-asof[^"]*">[\s\S]*?◆/);
  assert.match(html, /<div class="obj z-exec[^"]*">[\s\S]*?▲/);
  assert.match(html, /<div class="obj z-exec[^"]*">[\s\S]*?■/);
  assert.match(html, /<div class="obj z-hind[^"]*">[\s\S]*?●/);
  // la actuación vive dentro del objeto Execution · fill; el humano, aparte
  const fillCard = html.slice(html.indexOf("Execution · fill"), html.indexOf("EVALUATION · LATER"));
  assert.ok(fillCard.includes('data-event-id="SIM-1"'));
  assert.ok(!fillCard.includes('data-event-id="HUM-1"'));
  // sin serie canónica no se dibuja una línea de precios
  assert.ok(html.includes("NO CANONICAL SERIES"));
  for (const path of html.match(/<path d="[^"]*"/g) ?? []) {
    assert.ok((path.match(/L/g) ?? []).length < 4, `sin polilínea de serie inventada: ${path}`);
  }
});

test("UI-FIDELITY: Replay sin datos validados conserva la composición completa, fail-closed", () => {
  const html = servedDefaultPages().replay;
  assert.match(html, /data-state="ERROR"/);
  assert.ok(html.includes("TIMELINE_NOT_VALIDATED"));
  inOrder(html, ['<div class="dechead">', '<div class="chain">', "EVALUATION · LATER", '<div class="zones">', "KNOWLEDGE HORIZON"]);
  // las 13 secciones canónicas de §26.2 aparecen como ranuras UNKNOWN, sin valor
  for (const definition of EXPOSURE_FIELDS) {
    assert.ok(html.includes(`data-slot="${definition.key}"`), definition.key);
  }
  assert.ok(!html.includes('<li class="exposure-field'));
  assert.ok(!html.includes("data-value="));
  assert.ok(!html.includes('data-view-scope="decision"'), "sin validar no se declara una lane de decisión");
});

// ---------- Backtests ----------

test("UI-FIDELITY: Backtests reproduce tabla de medidas, efecto emparejado, método y tres paneles", () => {
  const html = servedDefaultPages().backtests;
  inOrder(html, [
    '<h1 class="page">',
    "Economic measures",
    "<th class=\"right\">B</th>", "<th class=\"right\">H</th>", "<th class=\"right\">V</th>", "ΔV vs baseline",
    "Paired effect over the campaign",
    "Method &amp; integrity",
    'data-kind="distribution"', 'data-kind="distribution"',
    "Across campaigns",
  ]);
  // sin productor canónico: marcos NO ESTIMATE, nunca números
  assert.ok((html.match(/NO ESTIMATE/g) ?? []).length >= 4);
  assert.ok(html.includes('<span class="ev">EVIDENCE</span>'));
  assert.ok(!html.includes('data-status="BOUND"'));
});

// ---------- Research ----------

test("UI-FIDELITY: Research reproduce stack, hipótesis serif, autoridad doble filete, linaje y evidencia", () => {
  const html = servedDefaultPages().research;
  inOrder(html, [
    '<div class="split">',
    "Candidate stack",
    '<div class="card stack',
    '<h1 class="page">',
    "Hypothesis", '<p class="hyp"',
    '<div class="auth-box">', '<span class="seal">AUTHORITY</span>',
    "Readiness &amp; integrity",
    "Version lineage", "LINEAGE UNAVAILABLE",
    "Evidence &amp; receipts",
  ]);
  for (const strategyId of ["S1", "S2", "S3", "S4", "S5", "Z"]) {
    assert.ok(html.includes(`data-strategy="${strategyId}"`), strategyId);
  }
  // la autoridad no se inventa: sin registro del boundary queda "Not exposed"
  const authBox = html.slice(html.indexOf('<div class="auth-box">'), html.indexOf("Readiness &amp; integrity"));
  assert.ok(authBox.includes("Not exposed"));
  assert.ok(!/approved/i.test(authBox));
});

// ---------- Campaigns & Runs ----------

test("UI-FIDELITY: Campaigns reproduce rail, readiness/unknowns, tabla de runs y receipts", () => {
  const html = servedDefaultPages().campaigns;
  inOrder(html, [
    '<div class="split">',
    '<div class="card clist">',
    '<h1 class="page">',
    "Campaign readiness",
    "Readiness gates", "What we don't know",
    '<h2 class="sec">Runs</h2>',
    "<th>Run</th><th>Arm</th><th>Status</th><th>Decisions · evaluation</th><th>Determinism</th><th>Receipts</th><th>Drill down</th>",
    '<h2 class="sec">Receipts</h2>',
  ]);
  assert.ok(html.includes('<div class="unk-item">'));
});

// ---------- key, drawer e interacción ----------

test("UI-FIDELITY: semantics key y drawer usan la gramática del mockup", () => {
  const key = renderSemanticsKeyHtml();
  assert.ok(key.includes('class="key semantics-key"'));
  assert.equal((key.match(/<div class="kr"/g) ?? []).length, 9);
  for (const needle of ["T₀ · decision-time", "Execution", "Later · evaluation", "UNKNOWN", "NOT CLOSED", "EVIDENCE", "AUTHORITY", "◆ ▲ ■ ●"]) {
    assert.ok(key.includes(needle), needle);
  }
  const drawer = renderProvenanceDrawerHtml();
  assert.ok(drawer.includes('<aside class="drawer prov-drawer"'));
  assert.ok(drawer.includes('class="bitemp"'));
  for (const field of ["label", "value", "record", "revision", "sha", "clock", "clock-kind"]) {
    assert.ok(drawer.includes(`data-field="${field}"`), field);
  }
  // atajos 1–4 en el orden del mockup; sin red
  assert.ok(PROVENANCE_INTERACTION_SCRIPT.includes('{ "1": "campaigns", "2": "replay", "3": "backtests", "4": "research" }'));
  assert.ok(!PROVENANCE_INTERACTION_SCRIPT.includes("fetch("));
  assert.ok(!PROVENANCE_INTERACTION_SCRIPT.includes("XMLHttpRequest"));
});

// ---------- ningún hecho demo del mockup en producto ----------

test("UI-FIDELITY: la fidelidad visual no importa datos ni supuestos demo del mockup", () => {
  const pages = [...Object.values(servedDefaultPages()), renderNavigationPage(), renderSurfacePage("replay", boundReplayVm())];
  const forbidden = [
    "SYN-", "SYNTHETIC", "Procurement committee", "committee", "Tranche-trigger", "Layered calendar",
    "Cal-27", "T₀ + 84", "T0 + 84", "84 days", "90 %", "90%", "CI90", "89.10", "88.50", "Procurement desk",
    "H-014", "U-014", "Research desk",
  ];
  for (const html of pages) {
    for (const needle of forbidden) {
      assert.ok(!html.includes(needle), `no debe aparecer "${needle}"`);
    }
  }
});
