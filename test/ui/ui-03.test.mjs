// Tests UI-03: criterio de aceptación — integrar en la UI productiva la
// dirección visual Claude Blind seleccionada por el owner (PLAN_STATUS UI-03 /
// DES-02), preservando exactamente los contratos/semántica del Operator
// Interface Boundary (IMP-29, SPEC v1.1.1 §26) y sin importar los datos demo ni
// los supuestos inventados del prototipo (B/H/V/ΔV, T₀+84, CI90%, comité).

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
import {
  buildBacktestsViewModel,
  buildCampaignsViewModel,
  buildReplayViewModel,
  buildResearchViewModel,
  PROVENANCE_INTERACTION_SCRIPT,
  renderBacktestsPage,
  renderCampaignsPage,
  renderNavigationPage,
  renderProvenanceDrawerHtml,
  renderReplayPage,
  renderResearchPage,
  renderSemanticsKeyHtml,
  renderSurfacePage,
  UI_STYLESHEET,
  VISUAL_LANGUAGE_ID,
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
import { EXECUTION_CLASS } from "../../src/operator-interface/timeline.mjs";

// Pila de comparación hash-bound con etiquetas de brazo/medida respaldadas por
// el propio registro canónico (para la regresión de atributos data-arm/measure).
const BASETEST_COMPARISON = {
  key: "BT.G0BQ.202604.comparison",
  viewScope: "evaluation",
  occurredAtUtc: "2026-06-30T17:20:00Z",
  publishedAtUtc: "2026-07-01T06:05:00Z",
  consumableAtUtc: "2026-07-01T06:35:00Z",
  consumableEvidence: { source: "fixture://ingest-log", locator: "row @ fixture", sha256: "a".repeat(64) },
  revisionId: "bt-v1",
  value: { arm: "A0", measure: "B", economicValue: 25.1 },
};

const RECOMMENDATION_REF = backendRefOf(RECOMMENDATION_BASE);

function baseScenario({ extraRecords = [], executions = [], interventions = [] } = {}) {
  const built = buildManifest({ records: [DECISION_BASE, RECOMMENDATION_BASE, EVALUATION_BENCHMARK, AUTHORITY_BASE, RECEIPT_BASE, ...extraRecords] });
  assert.equal(built.ok, true, JSON.stringify(built.errors ?? "?"));
  const manifest = built.manifest;
  const backendIndex = backendIndexFromManifest(manifest);

  const timeline = buildOperatorTimeline({
    manifest,
    decisionBoundaryUtc: "2026-04-01T07:00:00Z",
    evaluationAsOfUtc: "2026-07-01T07:00:00Z",
    workingMode: WORKING_MODE.REPLAY,
    executions,
    interventions,
  });
  assert.equal(timeline.ok, true, JSON.stringify(timeline.errors ?? "?"));

  const exposure = buildExposure({
    boundaryUtc: "2026-04-01T07:00:00Z",
    observations: [{
      field: "recommendation",
      condition: EXPOSURE_CONDITION.AVAILABLE,
      value: RECOMMENDATION_BASE.value,
      provenance: {
        sourceKind: EXPOSURE_SOURCE_KIND.RECOMMENDATION,
        recordKey: RECOMMENDATION_BASE.key,
        revisionId: RECOMMENDATION_BASE.revisionId,
        valueSha256: canonicalValueSha256(RECOMMENDATION_BASE.value).sha256,
      },
    }],
    backendManifest: manifest,
  });
  assert.equal(exposure.ok, true, JSON.stringify(exposure.errors ?? "?"));
  return { manifest, backendIndex, timeline, exposure };
}

function actsScenario() {
  const executions = [
    { eventId: "SIM-1", class: EXECUTION_CLASS.SIMULATED, relatedRecommendationRef: RECOMMENDATION_REF, occurredAtUtc: "2026-04-02T08:01:00Z" },
    {
      eventId: "REAL-1",
      class: EXECUTION_CLASS.REAL,
      relatedRecommendationRef: RECOMMENDATION_REF,
      occurredAtUtc: "2026-04-02T08:03:00Z",
      authorization: {
        authorityRef: backendRefOf(AUTHORITY_BASE),
        receipt: { receiptRef: backendRefOf(RECEIPT_BASE), receiptSha256: canonicalValueSha256(RECEIPT_BASE.value).sha256 },
      },
    },
  ];
  const interventions = [
    { eventId: "HUM-1", relatedRecommendationRef: RECOMMENDATION_REF, occurredAtUtc: "2026-04-02T08:04:00Z", attribution: "HUMAN" },
  ];
  return baseScenario({ executions, interventions });
}

function emptyVms() {
  return {
    replay: buildReplayViewModel(baseScenario()),
    backtests: buildBacktestsViewModel({ backendIndex: null, rows: [] }),
    research: buildResearchViewModel({ backendIndex: null, records: [] }),
    campaigns: buildCampaignsViewModel({ backendIndex: null, campaigns: [], runs: [] }),
  };
}

const ALL_PAGES = [];
{
  const vms = emptyVms();
  ALL_PAGES.push(
    ["replay", renderReplayPage(vms.replay)],
    ["backtests", renderBacktestsPage(vms.backtests)],
    ["research", renderResearchPage(vms.research)],
    ["campaigns", renderCampaignsPage(vms.campaigns)],
    ["navigation", renderNavigationPage()],
  );
}

// ---------- integración de la dirección visual ----------

test("UI-03: la dirección visual Claude Blind se integra en las cuatro superficies", () => {
  assert.equal(VISUAL_LANGUAGE_ID, "claude-blind");
  for (const [surface, html] of ALL_PAGES) {
    assert.ok(html.includes(`<style data-ui-visual-language="${VISUAL_LANGUAGE_ID}">`), `${surface}: stylesheet inline`);
    assert.ok(html.includes(`data-visual-language="${VISUAL_LANGUAGE_ID}"`), `${surface}: marcador de dirección visual`);
    assert.ok(html.includes('id="semantics-key"'), `${surface}: panel de semántica presente`);
    assert.ok(html.includes('id="prov-drawer"'), `${surface}: drawer de procedencia presente`);
    assert.ok(html.includes("data-key-toggle"), `${surface}: trigger de la key presente`);
    for (const id of ["replay", "backtests", "research", "campaigns"]) {
      assert.ok(html.includes(`data-nav="${id}"`), `${surface}: nav ${id}`);
    }
    assert.ok(html.includes("<script>"), `${surface}: interacción inline`);
  }
});

test("UI-03: el stylesheet codifica la gramática temporal, epistémica y de evidencia", () => {
  // zonas temporales con su color, nunca decorativas
  assert.ok(UI_STYLESHEET.includes("--asof: #23476b"));
  assert.ok(UI_STYLESHEET.includes("--exec: #3d4148"));
  assert.ok(UI_STYLESHEET.includes("--hind: #8a4b0f"));
  assert.ok(UI_STYLESHEET.includes("--hatch-hind"));
  assert.ok(UI_STYLESHEET.includes("repeating-linear-gradient"));
  // estados epistémicos explícitos
  assert.ok(UI_STYLESHEET.includes(".unkv"));
  assert.ok(UI_STYLESHEET.includes(".openv"));
  assert.ok(UI_STYLESHEET.includes(".st.pass"));
  assert.ok(UI_STYLESHEET.includes(".st.fail"));
  assert.ok(UI_STYLESHEET.includes(".st.warn"));
  // evidencia vs autoridad
  assert.ok(UI_STYLESHEET.includes(".ev "));
  assert.ok(UI_STYLESHEET.includes(".auth-box"));
  assert.ok(UI_STYLESHEET.includes("double"));
  // procedencia a un clic
  assert.ok(UI_STYLESHEET.includes(".pv"));
  assert.ok(UI_STYLESHEET.includes("dotted"));
  // tipografía serif/sans/mono
  assert.ok(UI_STYLESHEET.includes("--serif"));
  assert.ok(UI_STYLESHEET.includes("--sans"));
  assert.ok(UI_STYLESHEET.includes("--mono"));
  // la zona decision se ata al color de decisión y la evaluación al de hindsight
  assert.match(UI_STYLESHEET, /\.zone-decision\b[^}]*--asof/s);
  assert.match(UI_STYLESHEET, /\.zone-evaluation\b[^}]*--hind/s);
});

test("UI-03: decision-time y evaluation se separan por zona visual preservando el scope canónico", () => {
  const vm = buildReplayViewModel(baseScenario());
  assert.equal(vm.ok, true, JSON.stringify(vm.errors ?? "?"));
  const html = renderReplayPage(vm);
  assert.match(html, /<section class="lane lane-scope-decision zone-decision" data-view-scope="decision" data-zone="decision">/);
  assert.match(html, /<section class="lane lane-scope-evaluation zone-evaluation" data-view-scope="evaluation" data-zone="evaluation">/);
  // ejecución y exposición tienen su propia zona
  assert.match(html, /<section class="events execution-events" data-view-scope="execution" data-zone="execution"/);
  assert.match(html, /<section class="exposure-table zone-decision" data-kind="exposure" data-zone="exposure">/);
  // las etiquetas de zona temporal son visibles
  assert.ok(html.includes("decision-time"));
  assert.ok(html.includes("Later"));
  // y el scope canónico del boundary sigue presente
  assert.ok(html.includes('data-view-scope="decision"'));
  assert.ok(html.includes('data-view-scope="evaluation"'));
});

// ---------- fail-closed ----------

test("UI-03: la ausencia se rinde como chip epistémico, nunca como valor", () => {
  const replayHtml = renderReplayPage(buildReplayViewModel(baseScenario()));
  // las secciones no observadas se declaran MISSING con chip UNKNOWN y razón
  assert.ok(replayHtml.includes('data-condition="MISSING"'));
  assert.ok(replayHtml.includes('<span class="unkv">UNKNOWN</span>'));
  assert.ok(replayHtml.includes("no provista por el backend en este scope"));
  assert.ok(!replayHtml.includes('data-value="0"'));
  assert.ok(!replayHtml.includes(">undefined<"));
  assert.ok(!replayHtml.includes('data-value="undefined"'));

  const backtestsHtml = renderBacktestsPage(buildBacktestsViewModel({ backendIndex: null, rows: [] }));
  assert.ok(backtestsHtml.includes('<span class="unkv">UNKNOWN</span>'));
  assert.ok(backtestsHtml.includes("B / H / V / \u0394V"));
  // sin productor canónico, las comparaciones quedan UNAVAILABLE: sin valores
  assert.ok(backtestsHtml.includes('data-status="UNAVAILABLE"'));
  assert.ok(!backtestsHtml.includes('data-value="25.7"'));
});

test("UI-03: NOT CLOSED se dibuja como chip abierto y no adelanta el valor futuro", () => {
  const { manifest, backendIndex, timeline } = baseScenario();
  const exposure = buildExposure({
    boundaryUtc: "2026-04-01T07:00:00Z",
    observations: [{
      field: "outcomes",
      condition: EXPOSURE_CONDITION.AVAILABLE,
      value: EVALUATION_BENCHMARK.value,
      provenance: {
        sourceKind: EXPOSURE_SOURCE_KIND.OUTCOME,
        recordKey: EVALUATION_BENCHMARK.key,
        revisionId: EVALUATION_BENCHMARK.revisionId,
        valueSha256: canonicalValueSha256(EVALUATION_BENCHMARK.value).sha256,
      },
    }],
    backendManifest: manifest,
  });
  assert.equal(exposure.ok, true, JSON.stringify(exposure.errors ?? "?"));
  const outcome = exposure.exposure.fields.find((field) => field.field === "outcomes");
  // el boundary degrada a NOT_YET_CLOSED: el outcome no era conocido al decidir
  assert.equal(outcome.condition, EXPOSURE_CONDITION.NOT_YET_CLOSED);
  const vm = buildReplayViewModel({ timeline, exposure, backendIndex });
  assert.equal(vm.ok, true, JSON.stringify(vm.errors ?? "?"));
  const html = renderReplayPage(vm);
  assert.match(html, /data-condition="NOT_YET_CLOSED"[^>]*><span class="item-label">Outcomes<\/span> <span class="st open">/);
  assert.ok(html.includes("NOT CLOSED"));
  // el valor futuro (25.7) no se presenta como conocido al decidir: sólo puede
  // aparecer, si acaso, en la lane de evaluación, nunca en la exposición T₀
  const exposureSection = html.match(/<section class="exposure-table[^>]*>([\s\S]*?)<\/section>/)[1];
  assert.ok(!exposureSection.includes('data-value="25.7"'));
});

test("UI-03: los valores canónicos atados exponen procedencia inspeccionable", () => {
  const { backendIndex } = baseScenario({ extraRecords: [BASETEST_COMPARISON] });
  const vm = buildBacktestsViewModel({
    backendIndex,
    rows: [{
      label: "B G0BQ 202604",
      arm: BASETEST_COMPARISON.value.arm,
      measure: BASETEST_COMPARISON.value.measure,
      recordKey: BASETEST_COMPARISON.key,
      revisionId: BASETEST_COMPARISON.revisionId,
      value: BASETEST_COMPARISON.value,
    }],
  });
  assert.equal(vm.ok, true, JSON.stringify(vm.errors ?? "?"));
  assert.equal(vm.rows[0].status, "BOUND");
  const html = renderBacktestsPage(vm);
  assert.match(html, /class="pv provenance"/);
  assert.ok(html.includes(`data-record-key="${BASETEST_COMPARISON.key}"`));
  assert.ok(html.includes(`data-revision-id="${BASETEST_COMPARISON.revisionId}"`));
  assert.ok(html.includes(`data-value-sha="${canonicalValueSha256(BASETEST_COMPARISON.value).sha256}"`));
  // el drawer sabe leer registro, sha, reloj y tipo de reloj
  assert.ok(html.includes('data-field="record"'));
  assert.ok(html.includes('data-field="sha"'));
  assert.ok(html.includes('data-field="clock"'));
  // la regresión de etiquetas arm/measure del boundary se conserva
  assert.ok(html.includes('data-arm="A0"'));
  assert.ok(html.includes('data-measure="B"'));
});

// ---------- no invención / no publicación ----------

test("UI-03: no se importan datos demo ni supuestos inventados del prototipo", () => {
  for (const [surface, html] of ALL_PAGES) {
    assert.ok(!html.includes("SYN-"), `${surface}: sin ids demo sintéticos`);
  }
  const visualStrings = [UI_STYLESHEET, renderSemanticsKeyHtml(), renderProvenanceDrawerHtml(), PROVENANCE_INTERACTION_SCRIPT].join("\n");
  for (const forbidden of ["SYN-", "Procurement committee", "committee", "90%", "CI 90", "CI90", "T\u2080 + 84", "T0 + 84", "+84"]) {
    assert.ok(!visualStrings.includes(forbidden), `la dirección visual no inventa "${forbidden}"`);
  }
  // el label B/H/V/ΔV sólo existe como comparación pendiente UNAVAILABLE, nunca como valor
  const backtestsHtml = renderBacktestsPage(buildBacktestsViewModel({ backendIndex: null, rows: [] }));
  assert.ok(backtestsHtml.includes("B / H / V / \u0394V"));
  const pendingIndex = backtestsHtml.indexOf("B / H / V / \u0394V");
  const chunk = backtestsHtml.slice(pendingIndex, pendingIndex + 400);
  assert.ok(chunk.includes('data-status="UNAVAILABLE"'), "B/H/V/ΔV se declara UNAVAILABLE, no se fabrica");
});

test("UI-03: sin publicación ni activación de ejecución real", () => {
  for (const [surface, html] of ALL_PAGES) {
    for (const forbidden of ["<form", 'method="post"', 'method="POST"', "action=", "fetch(", "XMLHttpRequest", '<script src=', 'src="http']) {
      assert.ok(!html.includes(forbidden), `${surface}: sin ${forbidden}`);
    }
  }
  // la única interacción es inline, presentacional y no llama a la red
  assert.ok(PROVENANCE_INTERACTION_SCRIPT.includes("location.hash"));
  assert.ok(!PROVENANCE_INTERACTION_SCRIPT.includes("fetch("));
  assert.ok(!PROVENANCE_INTERACTION_SCRIPT.includes("XMLHttpRequest"));
});

test("UI-03: fail-closed en ERROR conserva la dirección visual sin lanzar", () => {
  const invalid = { ok: false, errors: [{ field: "(vm)", code: "NOT_VALIDATED", message: "view model no validado" }] };
  for (const surface of ["replay", "backtests", "research", "campaigns"]) {
    const html = renderSurfacePage(surface, invalid);
    assert.match(html, /data-state="ERROR"/);
    assert.match(html, /fail-closed/);
    assert.ok(html.includes(`data-visual-language="${VISUAL_LANGUAGE_ID}"`));
    assert.ok(html.includes('id="semantics-key"'));
    assert.ok(html.includes('id="prov-drawer"'));
  }
  for (const renderPage of [renderReplayPage, renderBacktestsPage, renderResearchPage, renderCampaignsPage]) {
    assert.doesNotThrow(() => renderPage({ ok: false }));
  }
});

// ---------- regresión de contratos del boundary ----------

test("UI-03: la capa visual preserva los contratos del Operator Interface Boundary", () => {
  const acts = actsScenario();
  const vm = buildReplayViewModel(acts);
  assert.equal(vm.ok, true, JSON.stringify(vm.errors ?? "?"));
  const html = renderReplayPage(vm);
  // clases de actuación y separación execution/intervention
  assert.match(html, /data-event-class="SIMULATED"/);
  assert.match(html, /data-event-class="REAL"[^>]*data-real="true"/);
  assert.match(html, /data-event-class="HUMAN_INTERVENTION"/);
  assert.match(html, /data-attribution="HUMAN"/);
  // relojes y tipos de reloj inspeccionables
  assert.ok(html.includes('data-clock-kind="policy-consumable"'));
  assert.ok(html.includes('data-clock-kind="evaluation-effective"'));
  // el binding canónico sigue siendo BOUND/UNAVAILABLE (no cambia por la capa visual)
  const campaigns = buildCampaignsViewModel({
    backendIndex: acts.backendIndex,
    campaigns: [],
    runs: [{ runId: "RUN.G0BQ.202604", recordKey: DECISION_BASE.key, revisionId: DECISION_BASE.revisionId, value: DECISION_BASE.value }],
  });
  const campaignsHtml = renderCampaignsPage(campaigns);
  assert.ok(campaignsHtml.includes('data-status="BOUND"'));
  for (const target of ["replay", "backtests", "research"]) {
    assert.ok(campaignsHtml.includes(`data-drilldown="${target}"`), target);
  }
  const research = buildResearchViewModel({ backendIndex: null, records: [] });
  const researchHtml = renderResearchPage(research);
  for (const strategyId of ["S1", "S2", "S3", "S4", "S5", "Z"]) {
    assert.match(researchHtml, new RegExp(`data-strategy="${strategyId}"[^>]*>.*UNAVAILABLE`), strategyId);
  }
});
