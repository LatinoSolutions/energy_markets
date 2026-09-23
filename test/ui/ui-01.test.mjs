// Tests UI-01: criterio de aceptación — primera visual de Replay, Backtests,
// Research y Campaigns & Runs sobre el Operator Interface Boundary aceptado
// (IMP-29), sin manufacturar datos (§26.5; docs/product/UI-01_VISUAL_REFERENCE_BRIEF.md).

import { test } from "node:test";
import assert from "node:assert/strict";

import { canonicalValueSha256 } from "../../src/pit-views/pit-record.mjs";
import {
  backendIndexFromManifest,
  buildExposure,
  buildOperatorTimeline,
  EXPOSURE_CONDITION,
  EXPOSURE_SOURCE_KIND,
  reconcileOperatorTimeline,
  WORKING_MODE,
} from "../../src/operator-interface/index.mjs";
import {
  buildBacktestsViewModel,
  buildCampaignsViewModel,
  buildReplayViewModel,
  buildResearchViewModel,
  renderBacktestsPage,
  renderCampaignsPage,
  renderNavigationPage,
  renderReplayPage,
  renderResearchPage,
  renderSurfacePage,
} from "../../src/ui/index.mjs";
import {
  DECISION_BASE,
  EVALUATION_BENCHMARK,
  RECOMMENDATION_BASE,
  AUTHORITY_BASE,
  RECEIPT_BASE,
  backendRefOf,
  buildManifest,
} from "../operator-interface/fixtures.mjs";
import { EXECUTION_CLASS } from "../../src/operator-interface/timeline.mjs";

// ---------- helpers ----------

function scenarios({ extraRecords = [] } = {}) {
  const built = buildManifest({ records: [DECISION_BASE, RECOMMENDATION_BASE, EVALUATION_BENCHMARK, ...extraRecords] });
  assert.equal(built.ok, true, JSON.stringify(built.errors ?? "?"));
  const manifest = built.manifest;
  const backendIndex = backendIndexFromManifest(manifest);

  const timeline = buildOperatorTimeline({
    manifest,
    decisionBoundaryUtc: "2026-04-01T07:00:00Z",
    evaluationAsOfUtc: "2026-07-01T07:00:00Z",
    workingMode: WORKING_MODE.REPLAY,
  });
  assert.equal(timeline.ok, true, JSON.stringify(timeline.errors ?? "?"));

  const provenance = {
    sourceKind: EXPOSURE_SOURCE_KIND.RECOMMENDATION,
    recordKey: RECOMMENDATION_BASE.key,
    revisionId: RECOMMENDATION_BASE.revisionId,
    valueSha256: canonicalValueSha256(RECOMMENDATION_BASE.value).sha256,
  };
  const exposure = buildExposure({
    boundaryUtc: "2026-04-01T07:00:00Z",
    observations: [{
      field: "recommendation",
      condition: EXPOSURE_CONDITION.AVAILABLE,
      value: RECOMMENDATION_BASE.value,
      provenance,
    }],
    backendManifest: manifest,
  });
  assert.equal(exposure.ok, true, JSON.stringify(exposure.errors ?? "?"));

  return { manifest, backendIndex, timeline, exposure };
}

// Referencia de recomendación resoluble por el backend (§26.3): las
// actuaciones/intervenciones se vinculan a ella en el manifest verificado.
const RECOMMENDATION_REF = backendRefOf(RECOMMENDATION_BASE);

// Escenario con actuaciones concretas: ejercita la invariante del brief de
// recommendation / fills HYPOTHETICAL|REAL / intervención humana distintos
// (§26.3). La autoridad REAL exige sus registros resolvedos en el manifest.
function scenariosWithActs() {
  const base = scenarios({ extraRecords: [AUTHORITY_BASE, RECEIPT_BASE] });
  const executions = [
    { eventId: "SIM-1", class: EXECUTION_CLASS.SIMULATED, relatedRecommendationRef: RECOMMENDATION_REF, occurredAtUtc: "2026-04-02T08:01:00Z" },
    { eventId: "HYPO-1", class: EXECUTION_CLASS.HYPOTHETICAL, relatedRecommendationRef: RECOMMENDATION_REF, occurredAtUtc: "2026-04-02T08:02:00Z" },
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
  const timeline = buildOperatorTimeline({
    manifest: base.manifest,
    decisionBoundaryUtc: "2026-04-01T07:00:00Z",
    evaluationAsOfUtc: "2026-07-01T07:00:00Z",
    workingMode: WORKING_MODE.REPLAY,
    executions,
    interventions,
  });
  assert.equal(timeline.ok, true, JSON.stringify(timeline.errors ?? "?"));
  return {
    ...base,
    timeline,
    executions,
    interventions,
  };
}

// ---------- navegación ----------

// Brief: cuatro superficies navegables una desde la otra, sobre el boundary.
test("la página de navegación lista las cuatro superficies", () => {
  const html = renderNavigationPage();
  const surfaces = ["replay", "backtests", "research", "campaigns"];
  for (const surface of surfaces) {
    assert.ok(html.includes(`data-surface-link="${surface}"`), surface);
  }
});

// ---------- Replay / Decision Inspector ----------

test("replay: Decision-time y Evaluation son semántica y visualmente distintos", () => {
  const { timeline, exposure, backendIndex } = scenarios();
  const vm = buildReplayViewModel({ timeline, exposure, backendIndex });
  assert.equal(vm.ok, true, JSON.stringify(vm.errors ?? "?"));
  const html = renderReplayPage(vm);
  // distinción semántica: scopo canónico en atributo y sección
  assert.ok(html.includes('data-view-scope="decision"'));
  assert.ok(html.includes('data-view-scope="evaluation"'));
  assert.match(html, /Decision-time /);
  assert.match(html, /Evaluation /);
  // contenido separado por lane
  assert.ok(html.includes(`data-revision="${DECISION_BASE.revisionId}"`));
  assert.ok(html.includes(EVALUATION_BENCHMARK.key));
  // reconciliación del boundary reutilizada tal cual (sin recálculo propio)
  assert.equal(reconcileOperatorTimeline(timeline.timeline).ok, true);
});

test("replay: recomendación, fills SIMULATED/HYPOTHETICAL/REAL e intervención humana no se confunden", () => {
  const { timeline, exposure, backendIndex, executions, interventions } = scenariosWithActs();
  const vm = buildReplayViewModel({ timeline, exposure, backendIndex });
  assert.equal(vm.ok, true, JSON.stringify(vm.errors ?? "?"));
  assert.equal(vm.executions.length, executions.length);
  assert.equal(vm.interventions.length, interventions.length);
  const html = renderReplayPage(vm);
  // fill SIMULATED: clase propia, ni hipotético ni real
  assert.match(html, /data-event-class="SIMULATED"/);
  // fill HYPOTHETICAL: marcado como tal, separado de lo Real
  assert.match(html, /data-event-class="HYPOTHETICAL"[^>]*data-hypothetical="true"/);
  // fill REAL: exige autoridad y receipt del manifest verificado
  assert.match(html, /data-event-class="REAL"[^>]*data-real="true"/);
  assert.match(html, new RegExp(`data-authority="${backendRefOf(AUTHORITY_BASE)}"`));
  assert.match(html, new RegExp(`data-receipt-ref="${backendRefOf(RECEIPT_BASE)}"`));
  // intervención humana: clase HUMAN_INTERVENTION con atribución HUMAN
  assert.match(html, /data-event-class="HUMAN_INTERVENTION"/);
  assert.match(html, /data-attribution="HUMAN"/);
  // secciones de events separadas: actuación va en ejecución, el humano en
  // su propia sección (la intervención nunca se lista como fill)
  const executionSection = html.match(/<section class="events execution-events"[^>]*>([\s\S]*?)<\/section>/)[1];
  const interventionSection = html.match(/<section class="events intervention-events"[^>]*>([\s\S]*?)<\/section>/)[1];
  assert.ok(executionSection.includes("REAL-1") && executionSection.includes("SIM-1"));
  assert.ok(!executionSection.includes("HUM-1"));
  assert.ok(interventionSection.includes("HUM-1"));
  assert.ok(!interventionSection.includes("REAL-1"));
});

test("replay: los puntos conservan reloj y tipo de reloj inspeccionables", () => {
  const { timeline, exposure, backendIndex } = scenarios();
  const vm = buildReplayViewModel({ timeline, exposure, backendIndex });
  const html = renderReplayPage(vm);
  assert.ok(html.includes('data-clock="2026-04-01T06:00:00.000Z"'));
  assert.ok(html.includes('data-clock-kind="policy-consumable"'));
  assert.ok(html.includes('data-clock-kind="evaluation-effective"'));
});

test("replay: la exposición marca unavailable SIN inventar valor", () => {
  const { timeline, exposure, backendIndex } = scenarios();
  const vm = buildReplayViewModel({ timeline, exposure, backendIndex });
  const html = renderReplayPage(vm);
  // la exposición es estructuralmente completa: las secciones no observadas
  // se declaran MISSING con razón visible, nunca con un valor limpio
  const unknowns = vm.exposure.fields.filter((field) => field.condition !== EXPOSURE_CONDITION.AVAILABLE);
  assert.ok(unknowns.length > 0);
  for (const unknown of unknowns) {
    const reasonVisible = html.includes(unknown.reason);
    assert.ok(reasonVisible, unknown.field);
  }
  assert.ok(!vm.exposure.fields.some((field) => field.condition === EXPOSURE_CONDITION.MISSING && field.value !== undefined));
});

test("replay: con timeline/exposure no validados el render es fail-closed", () => {
  const withNull = buildReplayViewModel({ timeline: null, exposure: null });
  assert.equal(withNull.ok, false);
  const html = renderSurfacePage("replay", withNull);
  assert.match(html, /data-state="ERROR"/);
  assert.match(html, /fail-closed/);
});

// OI79-UI01-01 (review 2026-09-23): la forma `{ok:true}` por sí sola no
// acredita datos; sin binding contra el manifest backend verificado el
// render es fail-closed y el valor forjado nunca aparece como factual.
test("replay: un timeline forjado con forma válida no se rinde como factual", () => {
  const { exposure } = scenarios();
  const forged = {
    ok: true,
    timeline: {
      workingMode: "REPLAY",
      separation: { evaluationScopeKeys: [], decisionScopeKeys: [] },
      decision: { boundary: "2026-04-01T07:00:00.000Z", points: [{ lane: "decision", key: "FORJADO.en-pantalla", value: 12345.67, revisionId: "v1", clock: "2026-04-01T06:00:00.000Z" }], suppressed: [], unavailable: [] },
      evaluation: { asOf: "2026-07-01T07:00:00.000Z", points: [], superseded: [], outranked: [], unavailable: [], appliedRevisions: [], pendingRevisions: [] },
      executions: [],
      interventions: [],
    },
  };
  const vm = buildReplayViewModel({ timeline: forged, exposure });
  assert.equal(vm.ok, false);
  assert.equal(vm.errors[0].code, "BACKEND_NOT_VERIFIED");
  const html = renderReplayPage(vm);
  assert.match(html, /data-state="ERROR"/);
  assert.ok(!html.includes("12345.67"));
});

// Sin index verificado no hay dato factual: mismo destino fail-closed aun
// con la reconciliación estructural en orden (un timeline armado sobre el
// propio resultado válido con backendIndex ausente no se renderiza).
test("replay: el timeline validado exige el manifest verificado del mismo backend", () => {
  const { timeline, exposure, backendIndex } = scenarios();
  const vm = buildReplayViewModel({ timeline, exposure, backendIndex: null });
  assert.equal(vm.ok, false);
  assert.equal(vm.errors[0].code, "BACKEND_NOT_VERIFIED");
});

test("replay: un valor de punto que el manifest no registró queda fail-closed", () => {
  const { timeline, exposure, backendIndex } = scenarios();
  const forged = JSON.parse(JSON.stringify(timeline));
  forged.timeline.decision.points[0].value = 12345.67;
  const vm = buildReplayViewModel({ timeline: forged, exposure, backendIndex });
  assert.equal(vm.ok, false);
  assert.equal(vm.errors[0].code, "POINT_NOT_IN_BACKEND");
  assert.match(vm.errors[0].message, /no es factual/);
});

test("replay: una exposición con procedencia de otro hash queda fail-closed", () => {
  const { timeline, backendIndex } = scenarios();
  const provenance = {
    sourceKind: EXPOSURE_SOURCE_KIND.RECOMMENDATION,
    recordKey: RECOMMENDATION_BASE.key,
    revisionId: RECOMMENDATION_BASE.revisionId,
    valueSha256: "c".repeat(64),
  };
  const forgedExposure = {
    ok: true,
    exposure: {
      boundaryUtc: "2026-04-01T07:00:00.000Z",
      fields: [{ field: "recommendation", specLabel: "Recomendación", section: "§26.2", condition: "AVAILABLE", value: RECOMMENDATION_BASE.value, provenance }],
      unavailable: [],
      structurallyComplete: true,
      hasUnavailableContent: false,
    },
  };
  const vm = buildReplayViewModel({ timeline, exposure: forgedExposure, backendIndex });
  assert.equal(vm.ok, false);
  assert.equal(vm.errors[0].code, "EXPOSURE_PROVENANCE_MISMATCH");
});

// UI01-01a (review 2026-09-23): la autorización REAL se re-ata al manifest
// verificado; una ejecución REAL con authority/receipt que el backend no
// registra queda fail-closed y sus refs nunca aparecen como factuales.
test("replay: una ejecución REAL con autorización no resuelta en el backend queda fail-closed", () => {
  const { timeline, exposure, backendIndex } = scenariosWithActs();
  const forged = JSON.parse(JSON.stringify(timeline));
  const realEvent = forged.timeline.executions.find((event) => event.class === EXECUTION_CLASS.REAL);
  realEvent.authorization.origin.authority = { recordKey: "FAKE.authority", revisionId: "v1" };
  realEvent.authorization.origin.receipt = { recordKey: "FAKE.receipt", revisionId: "v1" };
  const vm = buildReplayViewModel({ timeline: forged, exposure, backendIndex });
  assert.equal(vm.ok, false);
  assert.ok(vm.errors.some((error) => error.code === "REAL_AUTHORITY_NOT_IN_BACKEND"));
  assert.ok(vm.errors.some((error) => error.code === "REAL_RECEIPT_NOT_IN_BACKEND"));
  const html = renderReplayPage(vm);
  assert.match(html, /data-state="ERROR"/);
  assert.ok(!html.includes("data-real=\"true\""));
  assert.ok(!html.includes("FAKE.authority"));
});

// UI01-01b (review 2026-09-23): el valor expuesto se hashea contra el registro
// verificado; un valor forjado con el valueSha256 de otro registro no se rinde.
test("replay: un valor de exposición que el registro no contiene queda fail-closed", () => {
  const { timeline, backendIndex } = scenarios();
  const realHash = canonicalValueSha256(RECOMMENDATION_BASE.value).sha256;
  const provenance = {
    sourceKind: EXPOSURE_SOURCE_KIND.RECOMMENDATION,
    recordKey: RECOMMENDATION_BASE.key,
    revisionId: RECOMMENDATION_BASE.revisionId,
    valueSha256: realHash,
  };
  const forgedExposure = {
    ok: true,
    exposure: {
      boundaryUtc: "2026-04-01T07:00:00.000Z",
      fields: [{ field: "recommendation", specLabel: "Recomendación", section: "§26.2", condition: "AVAILABLE", value: 987654.32, provenance }],
      unavailable: [],
      structurallyComplete: true,
      hasUnavailableContent: false,
    },
  };
  const vm = buildReplayViewModel({ timeline, exposure: forgedExposure, backendIndex });
  assert.equal(vm.ok, false);
  assert.equal(vm.errors[0].code, "EXPOSURE_VALUE_HASH_MISMATCH");
  const html = renderReplayPage(vm);
  assert.match(html, /data-state="ERROR"/);
  assert.ok(!html.includes("987654.32"));
  // valor sin procedencia declarada: tampoco se rinde
  const orphan = buildReplayViewModel({
    timeline,
    backendIndex,
    exposure: {
      ok: true,
      exposure: { boundaryUtc: "2026-04-01T07:00:00.000Z", fields: [{ field: "recommendation", specLabel: "Recomendación", condition: "AVAILABLE", value: 42 }], unavailable: [], structurallyComplete: true, hasUnavailableContent: false },
    },
  });
  assert.equal(orphan.ok, false);
  assert.equal(orphan.errors[0].code, "EXPOSURE_VALUE_WITHOUT_PROVENANCE");
});

// UI01-01c (review 2026-09-23): la lane de un punto la fija la vista canónica
// del manifest, no la metadata del timeline aportado; un key de evaluation
// con viewScope "evaluation" presentado en la lane decision es ERROR.
test("replay: un benchmark de evaluation-scope en la lane decision queda fail-closed", () => {
  const { timeline, exposure, backendIndex, manifest } = scenarios();
  const benchmarkHash = canonicalValueSha256(EVALUATION_BENCHMARK.value).sha256;
  const forged = JSON.parse(JSON.stringify(timeline));
  forged.timeline.decision.points.push({
    lane: "decision",
    key: EVALUATION_BENCHMARK.key,
    value: EVALUATION_BENCHMARK.value,
    revisionId: EVALUATION_BENCHMARK.revisionId,
    clock: "2026-03-01T06:00:00.000Z",
  });
  forged.timeline.separation = { evaluationScopeKeys: [], decisionScopeKeys: [] };
  const vm = buildReplayViewModel({ timeline: forged, exposure, backendIndex });
  assert.equal(vm.ok, false);
  assert.equal(vm.errors[0].code, "POINT_SCOPE_MISMATCH");
  const html = renderReplayPage(vm);
  assert.match(html, /data-state="ERROR"/);
  // el benchmark existe en el manifest: el rechazo es por lane, no por hash
  assert.ok(exposure.ok === true, "escenario base válido antes de forjar la lane");
});

// UI01-04a (review 2026-09-23): una exposición sin fields se degrada a ERROR,
// sin excepción en el render (mismo invariante que el test de renderers).
test("replay: una exposición sin lista de fields rinde ERROR sin lanzar", () => {
  const { timeline, backendIndex } = scenarios();
  const vm = buildReplayViewModel({ timeline, backendIndex, exposure: { ok: true, exposure: {} } });
  assert.equal(vm.ok, false);
  assert.equal(vm.errors[0].code, "EXPOSURE_MALFORMED");
  let html;
  assert.doesNotThrow(() => {
    html = renderReplayPage(vm);
  });
  assert.match(html, /data-state="ERROR"/);
  assert.match(html, /fail-closed/);
});

// UI01-01a-r (review de cambio 2026-09-23): los refs exhibidos por el render
// (authorityRef / receiptRef) también se atan al origin resuelto del backend;
// un acto REAL con origin genuino y refs falsificados no se rinde como factual.
test("replay: refs de autorización exhibidos no atados al origin resuelto quedan fail-closed", () => {
  const { timeline, exposure, backendIndex } = scenariosWithActs();
  const forged = JSON.parse(JSON.stringify(timeline));
  const realEvent = forged.timeline.executions.find((event) => event.class === EXECUTION_CLASS.REAL);
  realEvent.authorization.authorityRef = "FAKE.authority@v1";
  realEvent.authorization.receipt.receiptRef = "FAKE.receipt@v1";
  const vm = buildReplayViewModel({ timeline: forged, exposure, backendIndex });
  assert.equal(vm.ok, false);
  assert.ok(vm.errors.some((error) => error.code === "REAL_AUTHORITY_REF_NOT_BOUND"));
  assert.ok(vm.errors.some((error) => error.code === "REAL_RECEIPT_NOT_IN_BACKEND"));
  const html = renderReplayPage(vm);
  assert.match(html, /data-state="ERROR"/);
  assert.ok(!html.includes("FAKE.authority"));
  assert.ok(!html.includes("FAKE.receipt"));
  assert.ok(!html.includes('data-real="true"'));
  // receiptSha del act también se contrasta con el contenido registrado
  const shaForged = JSON.parse(JSON.stringify(timeline));
  const realShaEvent = shaForged.timeline.executions.find((event) => event.class === EXECUTION_CLASS.REAL);
  realShaEvent.authorization.receipt.receiptSha256 = "d".repeat(64);
  const shaVm = buildReplayViewModel({ timeline: shaForged, exposure, backendIndex });
  assert.equal(shaVm.ok, false);
  assert.ok(shaVm.errors.some((error) => error.code === "REAL_RECEIPT_MISMATCH"));
});

// UI01-01c-r (review de cambio 2026-09-23): el reloj mostrado del punto se
// deriva del registro verificado, no del llamador; un clock forjado no se
// renderiza como si hubiera informado la decisión (§26.3).
test("replay: un clock de punto no derivado del registro queda fail-closed", () => {
  const { timeline, exposure, backendIndex } = scenarios();
  const forged = JSON.parse(JSON.stringify(timeline));
  forged.timeline.decision.points[0].clock = "2026-03-29T00:00:00.000Z";
  const vm = buildReplayViewModel({ timeline: forged, exposure, backendIndex });
  assert.equal(vm.ok, false);
  assert.equal(vm.errors[0].code, "POINT_CLOCK_NOT_FROM_RECORD");
  const html = renderReplayPage(vm);
  assert.match(html, /data-state="ERROR"/);
  assert.ok(!html.includes("2026-03-29T00:00:00.000Z"));
  // idem en la lane evaluation: el clock forjado no se muestra
  const forgedEvaluation = JSON.parse(JSON.stringify(timeline));
  forgedEvaluation.timeline.evaluation.points[0].clock = "2026-01-01T00:00:00.000Z";
  const evaluationVm = buildReplayViewModel({ timeline: forgedEvaluation, exposure, backendIndex });
  assert.equal(evaluationVm.ok, false);
  assert.ok(evaluationVm.errors.some((error) => error.code === "POINT_CLOCK_NOT_FROM_RECORD"));
  assert.ok(!renderReplayPage(evaluationVm).includes("2026-01-01T00:00:00.000Z"));
});

// UI01-01d (review de cambio 2026-09-23): la semántica de sección/sourceKind/
// scope de la exposición se re-ejecuta tal cual el boundary; un benchmark
// evaluation-roto presentado como «Recomendación» es ERROR (§26.2/§26.3).
test("replay: un registro de evaluation behind la sección Recomendación queda fail-closed", () => {
  const { timeline, backendIndex } = scenarios();
  const benchmarkProvenance = {
    sourceKind: EXPOSURE_SOURCE_KIND.RECOMMENDATION,
    recordKey: EVALUATION_BENCHMARK.key,
    revisionId: EVALUATION_BENCHMARK.revisionId,
    valueSha256: canonicalValueSha256(EVALUATION_BENCHMARK.value).sha256,
  };
  const forgedExposure = {
    ok: true,
    exposure: {
      boundaryUtc: "2026-04-01T07:00:00.000Z",
      fields: [{ field: "recommendation", specLabel: "Recomendación", section: "§26.2", condition: "AVAILABLE", value: EVALUATION_BENCHMARK.value, provenance: benchmarkProvenance }],
      unavailable: [],
      structurallyComplete: true,
      hasUnavailableContent: false,
    },
  };
  const vm = buildReplayViewModel({ timeline, exposure: forgedExposure, backendIndex });
  assert.equal(vm.ok, false);
  assert.equal(vm.errors[0].code, "SOURCE_KIND_VIEW_SCOPE_MISMATCH");
  const html = renderReplayPage(vm);
  assert.match(html, /data-state="ERROR"/);
  assert.ok(!html.includes("25.7") && !html.includes("<li class=\"exposure-field"));
  // y la etiqueta/section canónica no se sustituye por la del llamador
  const forgedLabel = JSON.parse(JSON.stringify(forgedExposure));
  forgedLabel.exposure.fields[0].provenance = {
    sourceKind: EXPOSURE_SOURCE_KIND.RECOMMENDATION,
    recordKey: RECOMMENDATION_BASE.key,
    revisionId: RECOMMENDATION_BASE.revisionId,
    valueSha256: canonicalValueSha256(RECOMMENDATION_BASE.value).sha256,
  };
  forgedLabel.exposure.fields[0].value = RECOMMENDATION_BASE.value;
  forgedLabel.exposure.fields[0].specLabel = "Benchmark (forjado)";
  forgedLabel.exposure.fields[0].section = "§26.3";
  const labelVm = buildReplayViewModel({ timeline, exposure: forgedLabel, backendIndex });
  assert.equal(labelVm.ok, false);
  assert.ok(labelVm.errors.some((error) => error.code === "EXPOSURE_SECTION_MISMATCH"));
  assert.ok(renderReplayPage(labelVm).includes('data-state="ERROR"'));
});


test("backtests: sin runs canónicos, todo se declara pendiente, nada fabricado", () => {
  const vm = buildBacktestsViewModel({ backendIndex: null, rows: [] });
  assert.equal(vm.ok, true);
  assert.equal(vm.hasAnyBoundData, false);
  const html = renderBacktestsPage(vm);
  assert.ok(html.includes("B / H / V / ΔV"));
  assert.ok(vm.pendingComparisons.every((item) => item.status === "UNAVAILABLE"));
  // ninguna comparación pendiente lleva valor simulado
  assert.ok(vm.pendingComparisons.every((item) => item.value === undefined));
});

test("backtests: un dato entra sólo si el manifest verificado respalda su hash", () => {
  const { backendIndex } = scenarios();
  // sin etiquetas arm/measure declaradas: el valor hash-bound entra sin
  // metadata de comparador (el boundary no expone un catálogo de brazos)
  const good = buildBacktestsViewModel({
    backendIndex,
    rows: [{
      label: "B G0BQ 202604",
      arm: null,
      measure: null,
      recordKey: EVALUATION_BENCHMARK.key,
      revisionId: EVALUATION_BENCHMARK.revisionId,
      value: EVALUATION_BENCHMARK.value,
    }],
  });
  assert.equal(good.ok, true);
  assert.equal(good.rows[0].status, "BOUND");
  const forged = buildBacktestsViewModel({
    backendIndex,
    rows: [{
      label: "B G0BQ 202604 (forjado)",
      arm: null,
      measure: null,
      recordKey: EVALUATION_BENCHMARK.key,
      revisionId: EVALUATION_BENCHMARK.revisionId,
      value: 999.99,
    }],
  });
  assert.equal(forged.ok, true);
  assert.equal(forged.rows[0].status, "UNAVAILABLE");
  assert.match(forged.rows[0].reason, /no coincide con el contenido registrado/);
  const renderHtml = renderBacktestsPage(good);
  assert.match(renderHtml, /provenance/);
  // sin etiquetas declaradas no se imprimen atributos de brazo ni comparador
  assert.ok(!renderHtml.includes("data-arm="));
  assert.ok(!renderHtml.includes("data-measure="));
});

// ---------- Research / Strategy Lab ----------

test("research: la pila S1–S5/Z se declara esperada pero explícitamente sin datos", () => {
  const vm = buildResearchViewModel({ backendIndex: null, records: [] });
  assert.equal(vm.ok, true);
  assert.equal(vm.hasAnyBoundData, false);
  const html = renderResearchPage(vm);
  for (const strategyId of ["S1", "S2", "S3", "S4", "S5", "Z"]) {
    assert.match(html, new RegExp(`data-strategy="${strategyId}"[^>]*>.*UNAVAILABLE`), strategyId);
  }
  assert.match(html, /Evidence \/ receipts/);
});

test("research: un strategyId duplicado se rechaza (dos verdades sobre lo mismo)", () => {
  const record = {
    strategyId: "S1",
    recordKey: RECOMMENDATION_BASE.key,
    revisionId: RECOMMENDATION_BASE.revisionId,
    value: RECOMMENDATION_BASE.value,
  };
  const vm = buildResearchViewModel({ backendIndex: null, records: [record, record] });
  assert.equal(vm.ok, false);
  assert.equal(vm.errors[0].code, "DUPLICATE_STRATEGY_ID");
});

test("research: un dato entra sólo vinculado al manifest verificado", () => {
  const { backendIndex } = scenarios();
  const vm = buildResearchViewModel({
    backendIndex,
    records: [{
      strategyId: "S1",
      recordKey: DECISION_BASE.key,
      revisionId: DECISION_BASE.revisionId,
      value: DECISION_BASE.value,
    }],
  });
  assert.equal(vm.ok, true);
  const s1 = vm.strategies.find((entry) => entry.strategyId === "S1");
  assert.equal(s1?.status, "BOUND");
  const forged = buildResearchViewModel({
    backendIndex,
    records: [{
      strategyId: "S1",
      recordKey: DECISION_BASE.key,
      revisionId: DECISION_BASE.revisionId,
      value: 999.99,
    }],
  });
  const forgedS1 = forged.strategies.find((entry) => entry.strategyId === "S1");
  assert.equal(forgedS1.status, "UNAVAILABLE");
});

// ---------- Campaigns & Runs ----------

test("campaigns: sin ficha canónica, se declara pendiente, nada inventado", () => {
  const vm = buildCampaignsViewModel({ backendIndex: null, campaigns: [], runs: [] });
  assert.equal(vm.ok, true);
  assert.equal(vm.hasAnyBoundData, false);
  const html = renderCampaignsPage(vm);
  assert.match(html, /empty-state|data-status="UNAVAILABLE"/);
  assert.ok(vm.drilldownTargets.includes("replay"));
  // el drilldown es destino nominal; el contenido (datos) no se fabrica
  assert.ok(!vm.campaigns.some((item) => item.value !== undefined));
});

test("campaigns: ids duplicados se rechazan y binding fail-closed", () => {
  const campaign = {
    campaignId: "G0BQ.202604",
    recordKey: DECISION_BASE.key,
    revisionId: DECISION_BASE.revisionId,
    value: DECISION_BASE.value,
  };
  const dup = buildCampaignsViewModel({ backendIndex: null, campaigns: [campaign, campaign], runs: [] });
  assert.equal(dup.ok, false);
  assert.equal(dup.errors[0].code, "DUPLICATE_CAMPAIGN_ID");
  const { backendIndex } = scenarios();
  const bound = buildCampaignsViewModel({ backendIndex, campaigns: [campaign], runs: [] });
  assert.equal(bound.ok, true);
  assert.equal(bound.campaigns[0].status, "BOUND");
  const forged = buildCampaignsViewModel({
    backendIndex,
    campaigns: [{ ...campaign, value: { campaignId: "otra" } }],
    runs: [],
  });
  assert.equal(forged.ok, true);
  assert.equal(forged.campaigns.filter((item) => item.status === "BOUND").length, 0);
});

// OI79-UI01-03 (review 2026-09-23): el brief §34 pide drill-downs a
// Replay/Backtests/Research y receipts por run; declararlos no basta: deben
// renderizarse como handoff visible sobre un run BOUND.
test("campaigns: un run canónico ofrece drill-downs visibles y sección de receipts", () => {
  const { backendIndex } = scenarios();
  const run = {
    runId: "RUN.G0BQ.202604",
    recordKey: DECISION_BASE.key,
    revisionId: DECISION_BASE.revisionId,
    value: DECISION_BASE.value,
  };
  const vm = buildCampaignsViewModel({ backendIndex, campaigns: [], runs: [run] });
  assert.equal(vm.ok, true);
  const runItem = vm.runs[0];
  assert.equal(runItem.status, "BOUND");
  assert.deepEqual(runItem.drilldowns.map((drilldown) => drilldown.href), ["#replay", "#backtests", "#research"]);
  const html = renderCampaignsPage(vm);
  assert.match(html, /data-kind="runs"/);
  for (const target of vm.drilldownTargets) {
    assert.match(html, new RegExp(`data-drilldown="${target}"`), target);
  }
  // los receipts del run sin productor aceptado quedan declarados, no impresos como valor
  assert.match(html, /data-kind="pending"/);
  assert.match(html, /sin receipts de run aceptados/);
});

// OI79-UI01-04 (review 2026-09-23): todos los renderers de página exportados
// deben ser fail-closed con un view model ok:false, sin excepción.
test("los renderers de página rinden estado ERROR en vez de lanzar con vm inválido", () => {
  const invalid = { ok: false, errors: [{ field: "(vm)", code: "NOT_VALIDATED", message: "view model no validado" }] };
  for (const renderPage of [renderReplayPage, renderBacktestsPage, renderResearchPage, renderCampaignsPage]) {
    const html = renderPage(invalid);
    assert.match(html, /data-state="ERROR"/);
    assert.match(html, /fail-closed/);
    assert.match(html, /NOT_VALIDATED/);
  }
  const minimal = { ok: false };
  for (const renderPage of [renderReplayPage, renderBacktestsPage, renderResearchPage, renderCampaignsPage]) {
    assert.doesNotThrow(() => renderPage(minimal));
  }
});

// UI01-01a-r2 (review de cambio 2026-09-23): el ref de recomendación que el
// render exhibe (relatedRecommendationRef) se ata al vínculo canónico
// resuelto (relatedCanonicalRef); un ref forjado que no es el resuelto no
// se muestra como factual (§26.5/§26.3), ni en fills ni en intervención.
test("replay: un ref de recomendación exhibido distinto del vínculo resuelto queda fail-closed", () => {
  const { timeline, exposure, backendIndex } = scenariosWithActs();
  const forged = JSON.parse(JSON.stringify(timeline));
  forged.timeline.executions[0].relatedRecommendationRef = "FAKE.recommendation@v9";
  forged.timeline.interventions[0].relatedRecommendationRef = "FAKE.recommendation@v9";
  const vm = buildReplayViewModel({ timeline: forged, exposure, backendIndex });
  assert.equal(vm.ok, false);
  assert.equal(vm.errors.filter((error) => error.code === "RECOMMENDATION_REF_NOT_BOUND").length, 2);
  const html = renderReplayPage(vm);
  assert.match(html, /data-state="ERROR"/);
  assert.ok(!html.includes("FAKE.recommendation"));
});

// UI01-01e (review de cambio 2026-09-23): la clase y la identidad de las
// actuaciones se re-validan equivalente a validateExecution del boundary (§26.3):
// un class desconocido o un eventId vacío no se rinde como evento.
test("replay: una actuación con class desconocido o sin eventId queda fail-closed", () => {
  const { timeline, exposure, backendIndex } = scenariosWithActs();
  const forgedClass = JSON.parse(JSON.stringify(timeline));
  forgedClass.timeline.executions[0].class = "BOGUS_CLASS";
  const classVm = buildReplayViewModel({ timeline: forgedClass, exposure, backendIndex });
  assert.equal(classVm.ok, false);
  assert.ok(classVm.errors.some((error) => error.code === "UNKNOWN_EXECUTION_CLASS"));
  const classHtml = renderReplayPage(classVm);
  assert.match(classHtml, /data-state="ERROR"/);
  assert.ok(!classHtml.includes('data-event-class="BOGUS_CLASS"'));
  // la intervención también exige identidad, igual que en el boundary
  const forgedId = JSON.parse(JSON.stringify(timeline));
  forgedId.timeline.interventions[0].eventId = "";
  const idVm = buildReplayViewModel({ timeline: forgedId, exposure, backendIndex });
  assert.equal(idVm.ok, false);
  assert.ok(idVm.errors.some((error) => error.code === "MISSING_EVENT_ID"));
  assert.match(renderReplayPage(idVm), /data-state="ERROR"/);
});

// UI01-04b (review de cambio 2026-09-23): las 13 secciones de §26.2 deben
// permanecer visibles; una exposición parcial (subconjunto de secciones) no
// se rinde como completa: las secciones ausentes quedan sin declarar.
test("replay: una exposición parcial (subconjunto de secciones §26.2) queda fail-closed", () => {
  const { timeline, backendIndex } = scenarios();
  const partial = {
    ok: true,
    exposure: {
      boundaryUtc: "2026-04-01T07:00:00.000Z",
      fields: [{
        field: "recommendation",
        specLabel: "Recomendación",
        section: "§26.2",
        condition: EXPOSURE_CONDITION.AVAILABLE,
        value: RECOMMENDATION_BASE.value,
        provenance: {
          sourceKind: EXPOSURE_SOURCE_KIND.RECOMMENDATION,
          recordKey: RECOMMENDATION_BASE.key,
          revisionId: RECOMMENDATION_BASE.revisionId,
          valueSha256: canonicalValueSha256(RECOMMENDATION_BASE.value).sha256,
        },
      }],
      unavailable: [],
      structurallyComplete: true,
      hasUnavailableContent: false,
    },
  };
  assert.equal(partial.exposure.fields.length, 1);
  const vm = buildReplayViewModel({ timeline, exposure: partial, backendIndex });
  assert.equal(vm.ok, false);
  assert.ok(vm.errors.some((error) => error.code === "EXPOSURE_NOT_STRUCTURALLY_COMPLETE"));
  const html = renderReplayPage(vm);
  assert.match(html, /data-state="ERROR"/);
  assert.match(html, /omite las secciones canónicas/);
  assert.ok(!html.includes("<li class=\"exposure-field"));
});

// UI01-05a (review de cambio 2026-09-23): la exposición sólo es renderizable
// sobre el decision boundary del timeline; una exposición proyectada a un
// boundary posterior convierte un outcome no cerrado en AVAILABLE y la página
// rinde el valor futuro como factual al decidir (§26.3/§25.1 IMP-29).
test("replay: una exposición con boundary distinto del decision boundary queda fail-closed", () => {
  const { manifest, timeline, backendIndex } = scenarios();
  const laterExposure = buildExposure({
    boundaryUtc: "2026-12-31T00:00:00Z",
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
  assert.equal(laterExposure.ok, true, JSON.stringify(laterExposure.errors ?? "?"));
  // en el boundary posterior el outcome SÍ queda AVAILABLE: por eso la página
  // no puede renderizarla sobre un timeline decidido antes del cierre
  const outcome = laterExposure.exposure.fields.find((field) => field.field === "outcomes");
  assert.equal(outcome.condition, EXPOSURE_CONDITION.AVAILABLE);
  const vm = buildReplayViewModel({ timeline, exposure: laterExposure, backendIndex });
  assert.equal(vm.ok, false);
  assert.equal(vm.errors[0].code, "EXPOSURE_BOUNDARY_NOT_ALIGNED");
  const html = renderReplayPage(vm);
  assert.match(html, /data-state="ERROR"/);
  assert.ok(!html.includes("25.7"));
  assert.ok(!html.includes("<li class=\"exposure-field"));
});

// UI01-06a (review de cambio 2026-09-23): re-declarar el `boundaryUtc` de una
// exposición proyectada a un boundary posterior alinea la cadena declarada,
// pero el outcome INFO_CERRADO sigue AVAILABLE con su valor futuro; la
// proyección de disponibilidad del boundary se re-aplica en la UI y ese campo
// queda fail-closed (§26.3/§25.1 IMP-29).
test("replay: una exposición re-declarada al decision boundary con fields posteriores queda fail-closed", () => {
  const { manifest, timeline, backendIndex } = scenarios();
  const laterExposure = buildExposure({
    boundaryUtc: "2026-12-31T00:00:00Z",
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
  assert.equal(laterExposure.ok, true, JSON.stringify(laterExposure.errors ?? "?"));
  const outcome = laterExposure.exposure.fields.find((field) => field.field === "outcomes");
  assert.equal(outcome.condition, EXPOSURE_CONDITION.AVAILABLE);
  // misma cadena declarada que el decision boundary: la variante que el test
  // UI01-05a no cubría
  const redeclared = {
    ok: true,
    exposure: { ...laterExposure.exposure, boundaryUtc: timeline.timeline.decision.boundary },
  };
  const vm = buildReplayViewModel({ timeline, exposure: redeclared, backendIndex });
  assert.equal(vm.ok, false);
  assert.ok(vm.errors.some((error) => error.code === "EXPOSURE_NOT_PROJECTED_TO_BOUNDARY" && error.field === "exposure.fields.outcomes"));
  const html = renderReplayPage(vm);
  assert.match(html, /data-state="ERROR"/);
  assert.ok(!html.includes("25.7"));
  assert.ok(!html.includes("<li class=\"exposure-field"));
});

// UI01-05b (review de cambio 2026-09-23): el tipo de reloj exhibido y la lane
// del punto se derivan de la lane canónica (decision → policy-consumable,
// evaluation → evaluation-effective); un clockKind o lane declarado por el
// llamador que contradiga la lane no se rinde (§26.3).
test("replay: un clockKind/lane de punto no derivado de la lane canónica queda fail-closed", () => {
  const { timeline, exposure, backendIndex } = scenarios();
  // un punto de decisión etiquetado con el reloj de evaluación
  const forged = JSON.parse(JSON.stringify(timeline));
  forged.timeline.decision.points[0].clockKind = "evaluation-effective";
  const vm = buildReplayViewModel({ timeline: forged, exposure, backendIndex });
  assert.equal(vm.ok, false);
  assert.ok(vm.errors.some((error) => error.code === "POINT_CLOCK_KIND_NOT_DERIVED"));
  const html = renderReplayPage(vm);
  assert.match(html, /data-state="ERROR"/);
  assert.ok(!html.includes('data-clock-kind="evaluation-effective"'));
  // idem en la lane evaluation con el reloj de consumo
  const forgedEvaluation = JSON.parse(JSON.stringify(timeline));
  forgedEvaluation.timeline.evaluation.points[0].clockKind = "policy-consumable";
  const evaluationVm = buildReplayViewModel({ timeline: forgedEvaluation, exposure, backendIndex });
  assert.equal(evaluationVm.ok, false);
  assert.ok(evaluationVm.errors.some((error) => error.code === "POINT_CLOCK_KIND_NOT_DERIVED"));
  // la lane exhibida tampoco se renombra: un point.lane forjado no se rinde
  const forgedLane = JSON.parse(JSON.stringify(timeline));
  forgedLane.timeline.decision.points[0].lane = "banana";
  const laneVm = buildReplayViewModel({ timeline: forgedLane, exposure, backendIndex });
  assert.equal(laneVm.ok, false);
  assert.ok(laneVm.errors.some((error) => error.code === "POINT_LANE_MISMATCH"));
  assert.ok(!renderReplayPage(laneVm).includes("lane-banana"));
});

// UI01-05c (review de cambio 2026-09-23): las etiquetas arm/measure de la
// fila de Backtests se exhiben como factuales (data-arm/data-measure) sólo si
// el registro canónico que respalda el hash las declara; sin respaldo del
// boundary, la fila no se rinde como dato de comparador (§26.5).
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

test("backtests: las etiquetas arm/measure sólo se rinden si el registro canónico las respalda", () => {
  const { backendIndex } = scenarios({ extraRecords: [BASETEST_COMPARISON] });
  const backed = buildBacktestsViewModel({
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
  assert.equal(backed.ok, true, JSON.stringify(backed.errors ?? "?"));
  assert.equal(backed.rows[0].status, "BOUND");
  const backedHtml = renderBacktestsPage(backed);
  assert.match(backedHtml, /data-arm="A0"/);
  assert.match(backedHtml, /data-measure="B"/);
  // etiquetas forjadas sobre un registro hash-bound: la fila no se rinde
  const forgedLabels = buildBacktestsViewModel({
    backendIndex,
    rows: [{
      label: "B G0BQ 202604 (forjado)",
      arm: "A9-FAKE",
      measure: "ZZZ",
      recordKey: EVALUATION_BENCHMARK.key,
      revisionId: EVALUATION_BENCHMARK.revisionId,
      value: EVALUATION_BENCHMARK.value,
    }],
  });
  assert.equal(forgedLabels.ok, true);
  assert.equal(forgedLabels.rows[0].status, "UNAVAILABLE");
  assert.match(forgedLabels.rows[0].reason, /no coincide con el que expone el registro canónico/);
  const forgedHtml = renderBacktestsPage(forgedLabels);
  // la etiqueta forjada sólo aparece citada dentro de la razón visible (state
  // UNAVAILABLE), nunca como atributo factual de brazo/comparador
  assert.ok(!forgedHtml.includes('data-arm='));
  assert.ok(!forgedHtml.includes('data-measure='));
  // y un registro cuyo valor no declara arm/measure tampoco respalda etiqueta alguna
  const unbacked = buildBacktestsViewModel({
    backendIndex,
    rows: [{
      label: "B G0BQ 202604 (sin respaldo)",
      arm: "A0",
      measure: "B",
      recordKey: EVALUATION_BENCHMARK.key,
      revisionId: EVALUATION_BENCHMARK.revisionId,
      value: EVALUATION_BENCHMARK.value,
    }],
  });
  assert.equal(unbacked.rows[0].status, "UNAVAILABLE");
});
