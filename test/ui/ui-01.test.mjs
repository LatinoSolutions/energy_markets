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
  buildManifest,
} from "../operator-interface/fixtures.mjs";

// ---------- helpers ----------

function scenarios() {
  const built = buildManifest({ records: [DECISION_BASE, RECOMMENDATION_BASE, EVALUATION_BENCHMARK] });
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
  const { timeline, exposure } = scenarios();
  const vm = buildReplayViewModel({ timeline, exposure });
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

test("replay: recomendación, ejecución hipotética y outcome no se confunden", () => {
  const { timeline, exposure } = scenarios();
  const vm = buildReplayViewModel({ timeline, exposure });
  assert.equal(vm.ok, true);
  const html = renderReplayPage(vm);
  // la sección de exposición distingue la recomendación (decision view)
  assert.ok(html.includes('data-kind="exposure"'));
  // los puntos de evaluation llevan su clase de lane, no la de ejecución
  const decisionPoints = vm.decision.points;
  const evaluationPoints = vm.evaluation.points;
  assert.ok(decisionPoints.every((point) => point.lane === "decision"));
  assert.ok(evaluationPoints.every((point) => point.lane === "evaluation"));
});

test("replay: los puntos conservan reloj y tipo de reloj inspeccionables", () => {
  const { timeline, exposure } = scenarios();
  const vm = buildReplayViewModel({ timeline, exposure });
  const html = renderReplayPage(vm);
  assert.ok(html.includes('data-clock="2026-04-01T06:00:00.000Z"'));
  assert.ok(html.includes('data-clock-kind="policy-consumable"'));
  assert.ok(html.includes('data-clock-kind="evaluation-effective"'));
});

test("replay: la exposición marca unavailable SIN inventar valor", () => {
  const { timeline, exposure } = scenarios();
  const vm = buildReplayViewModel({ timeline, exposure });
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

// ---------- Backtests / Economic Comparison ----------

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
  const good = buildBacktestsViewModel({
    backendIndex,
    rows: [{
      label: "B G0BQ 202604",
      arm: "A0",
      measure: "B",
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
      arm: "A0",
      measure: "B",
      recordKey: EVALUATION_BENCHMARK.key,
      revisionId: EVALUATION_BENCHMARK.revisionId,
      value: 999.99,
    }],
  });
  assert.equal(forged.ok, true);
  assert.equal(forged.rows[0].status, "UNAVAILABLE");
  assert.match(forged.rows[0].reason, /no coincide con el contenido registrado/);
  const renderHtml = renderBacktestsPage(good);
  assert.match(renderHtml, /data-arm="A0"/);
  assert.match(renderHtml, /data-measure="B"/);
  assert.match(renderHtml, /provenance/);
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
