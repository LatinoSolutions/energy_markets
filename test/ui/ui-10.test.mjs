// UI-10 · visual redesign of the four routes without visible legacy
// (intake D-20260929T103404-2ec5; PLAN_UI.md §1-§4; decisión de Bru
// 29-sep-2026, PLAN_STATUS.md fila UI-10: in the ablation the comparator is
// labelled CONTROL, never Baseline nor Arm). Checks UI10-01..UI10-07.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { loadCanonicalUiInputs } from "../../src/ui/canonical-inputs.mjs";
import { buildUiViewModels, createUiServer } from "../../src/ui/server.mjs";
import { buildBacktestsViewModel } from "../../src/ui/view-models.mjs";
import { renderSurfacePage } from "../../src/ui/render.mjs";
import { renderBacktestJobControl } from "../../src/ui/backtest-job-panel.mjs";
import { UI_STYLESHEET } from "../../src/ui/visual-language.mjs";
import { legacyTextFindings, visibleSegments } from "../../src/ui/primary-text.mjs";
import { buildCanonicalSemanticsProjection, blockerUserMessage, CANONICAL_LABELS } from "../../src/backtesting-semantics/projection.mjs";
import { canonicalHistoricalText, legacyRunIdentity } from "../../src/backtesting-semantics/legacy-compat.mjs";

const canonical = loadCanonicalUiInputs();
const vms = buildUiViewModels(canonical.inputs);
const MISSIONS = ["GAS_QUARTERLY", "GAS_MONTHLY", "POWER_QUARTERLY", "POWER_MONTHLY"];

// Text of every element marked data-provenance="<kind>" (balanced by tag name).
function provenanceText(html, kind) {
  return visibleSegments(html).filter((segment) => segment.kind === kind).map((segment) => segment.text).join("\n");
}

// ---------- A. backend: legacy compatibility adapter ----------

test("UI-10 adapter: the four PLAN_UI legacy cases map to canonical text and keep the verbatim quote", () => {
  const cases = [
    ["All arms complete", "All historical runs complete"],
    ["REFERENCE BASELINE", "HISTORICAL COMPARATOR"],
    ["ΔV vs Baseline > 0 over all campaigns", "ΔV vs comparator (A0) > 0 over all campaigns"],
    ["HYPOTHESIS ONLY", "STRATEGY · NO HYPOTHESIS DEFINED"],
    ["BASELINE 60/60 MW · ARM_A 60/60 MW · ARM_B 60/60 MW", "Calendar comparator (A0) 60/60 MW · DIP10 11:00 60/60 MW · Out-of-episode hour 60/60 MW"],
    ["Every arm reached the target in every episode.", "Every run reached the target in every episode."],
    ["Delta V = H_BASELINE − H_arm in EUR/MWh; UNKNOWN fees remain excluded.", "Delta V = H_comparator − H_run in EUR/MWh; UNKNOWN fees remain excluded."],
    ["UNKNOWN (no incluidos; pedidos al cliente)", "UNKNOWN (excluded, not zero; requested from the client)"],
  ];
  for (const [legacy, expected] of cases) {
    assert.deepEqual({ ...canonicalHistoricalText(legacy) }, { text: expected, historicalQuote: legacy }, legacy);
  }
  // Text without legacy vocabulary is untouched and carries no quote.
  assert.deepEqual({ ...canonicalHistoricalText("Look-ahead guard") }, { text: "Look-ahead guard", historicalQuote: null });
  assert.deepEqual({ ...canonicalHistoricalText(null) }, { text: null, historicalQuote: null });
});

test("UI-10 adapter: BT-02 run ids keep their id and get a name; an unknown id stays unnamed (fail-closed)", () => {
  assert.equal(legacyRunIdentity("ARM_A").displayName, "DIP10 11:00");
  assert.equal(legacyRunIdentity("BASELINE@DEPTH").displayName, "Calendar comparator (A0) · depth-capped");
  assert.equal(legacyRunIdentity("BASELINE@DEPTH").technicalAlias, "BASELINE");
  assert.equal(legacyRunIdentity("ARM_C").displayName, null);
  assert.equal(legacyRunIdentity("ARM_A@OTHER").displayName, null);
});

test("UI-10 adapter: the immutable v2/v3 exploratory artifacts still match their verified hashes", () => {
  const byProduct = canonical.inputs.exploratoryBacktest.provenance.byProduct;
  for (const [product, provenance] of Object.entries(byProduct)) {
    const bytes = readFileSync(provenance.resultsPath);
    assert.equal(createHash("sha256").update(bytes).digest("hex"), provenance.resultsSha256, product);
  }
  for (const mission of vms.backtests.canonicalSemantics.missions) {
    assert.equal(mission.legacyAdapter.ok, true, mission.missionId);
  }
});

// ---------- A. backend: shared projection ----------

test("UI-10 projection: historical runs are named by the backend with a source-bound lineage", () => {
  const semantics = vms.backtests.canonicalSemantics;
  for (const mission of semantics.missions) {
    const runs = mission.historicalRuns;
    assert.equal(runs.BASELINE.displayName, "Calendar comparator (A0)");
    assert.equal(runs.BASELINE.lineageOf, null);
    assert.equal(runs.ARM_A.label, "DIP10 11:00 · legacy lineage of H-S1-01");
    assert.equal(runs.ARM_B.label, "Out-of-episode hour · legacy lineage of H-RD-01");
    for (const run of Object.values(runs)) {
      assert.equal(run.tested, false);
      assert.doesNotMatch(`${run.displayName} ${run.label}`, /Baseline|Arm [AB]|client practice/i);
    }
  }
  // Without verified artifact bytes the lineage stays unavailable.
  const unverified = buildCanonicalSemanticsProjection({ exploratory: { provenance: canonical.inputs.exploratoryBacktest.provenance } });
  const runs = unverified.missions[0].historicalRuns;
  assert.equal(runs.ARM_A.lineageOf, null);
  assert.equal(runs.ARM_A.label, "DIP10 11:00");
  assert.match(runs.ARM_A.caption, /lineage unavailable/);
});

test("UI-10 projection: Client summary, benchmark statuses and blockers come from the backend in English", () => {
  const semantics = vms.backtests.canonicalSemantics;
  const gasQuarterly = semantics.missions.find((mission) => mission.missionId === "GAS_QUARTERLY");
  assert.equal(gasQuarterly.clientSummary, "11:00 Europe/Berlin known · current mandate, campaign not identified · sizing, fills and full cost unknown");
  for (const mission of semantics.missions.filter((entry) => entry.missionId !== "GAS_QUARTERLY")) {
    assert.equal(mission.clientSummary, "purchase timing unknown for this mission · sizing, fills and full cost unknown");
  }
  assert.equal(semantics.labels.benchmarkStatuses.BENCHMARK_PROVISIONAL, "Provisional");
  assert.equal(semantics.labels.benchmarkStatuses.CAMPAIGN_NOT_BOUND, "campaign not bound");
  assert.equal(blockerUserMessage({ code: "SOURCE_MISSING", source: "deliveryHours", message: "no deliveryHours source is committed under x/y.json" }), "Development source missing: delivery hours");
  assert.equal(blockerUserMessage({ code: "NEW_CODE", message: "m" }), "Development blocker");
  assert.equal(CANONICAL_LABELS.identities.CONTROL, "Control");
});

// ---------- B. served routes: primary text (UI10-02..06) ----------

async function withServer(run) {
  const { inputs, backend } = loadCanonicalUiInputs();
  const { server, ready } = createUiServer({ port: 0, inputs, backend });
  const { url } = await ready;
  try {
    await run(url);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

const SERVED_PATHS = [
  "/campaigns", "/replay", "/backtests", "/research",
  "/backtests?mode=TRADES&period=PUENTE",
  ...MISSIONS.map((missionId) => `/backtests?mission=${missionId}`),
  ...MISSIONS.map((missionId) => `/backtests?mode=HYPOTHESIS&mission=${missionId}`),
];

test("UI10-02..06: the served routes carry no legacy identity, raw enum or CONTROL outside the ablation", async () => {
  await withServer(async (url) => {
    for (const path of SERVED_PATHS) {
      const response = await fetch(new URL(path.slice(1), url));
      assert.equal(response.status, 200, path);
      const html = await response.text();
      assert.deepEqual(legacyTextFindings(html), [], path);
    }
  });
});

test("UI10-03: the mission context has no CONTROL identity; CONTROL is named in the ablation", () => {
  for (const surface of ["campaigns", "replay", "research"]) {
    const html = renderSurfacePage(surface, vms[surface]);
    const start = html.indexOf('data-semantic="SEM-2/canonical-projection"');
    const grid = html.slice(start, html.indexOf("</dl>", start));
    assert.doesNotMatch(grid, /data-identity="CONTROL"|>Control</, surface);
  }
  const backtests = renderSurfacePage("backtests", vms.backtests);
  const ablation = backtests.slice(backtests.indexOf('data-context="ablation"'));
  assert.match(ablation, /Ablation · CONTROL ↔ active hypothesis/);
});

test("UI10-04/05: historical runs appear only as backend names inside historical provenance", () => {
  const html = renderSurfacePage("backtests", vms.backtests);
  const historical = provenanceText(html, "historical");
  assert.match(historical, /Calendar comparator \(A0\)/);
  assert.match(historical, /DIP10 11:00/);
  assert.match(historical, /Out-of-episode hour/);
  // The technical aliases stay available, only as secondary alias lines.
  assert.match(provenanceText(html, "alias"), /technical alias ARM_A · legacy lineage of H-S1-01/);
  // Replay decisions are the historical run named by its lineage.
  const replay = renderSurfacePage("replay", vms.replay);
  assert.match(replay, /<div class="xwrap" data-provenance="historical">/);
  assert.match(replay, /■ BUY \(DIP10 11:00\)/);
  assert.match(replay, /vs Calendar comparator \(A0\)/);
  // Research heads the legacy DIP10 candidate with the canonical hypothesis.
  const research = renderSurfacePage("research", vms.research);
  const dip = research.slice(research.indexOf('id="res-DIP10"'));
  assert.match(dip, /<div class="mono muted small">H-S1-01\/phase-A\/v2 · owner Bru <span class="alias small muted" data-provenance="alias">legacy DIP10 v1-exp · provenance<\/span>/);
});

// ---------- C. historical quotes keep their provenance (UI10-07) ----------

test("UI10-07: verbatim historical labels stay available as quotes, never as primary text", () => {
  const backtests = renderSurfacePage("backtests", vms.backtests);
  assert.match(provenanceText(backtests, "quote"), /“Baseline · A0 11:00 \(client practice\)”/);
  const campaigns = renderSurfacePage("campaigns", vms.campaigns);
  assert.match(provenanceText(campaigns, "quote"), /“All arms complete — BASELINE 60\/60 MW · ARM_A 60\/60 MW · ARM_B 60\/60 MW”/);
  const research = renderSurfacePage("research", vms.research);
  assert.match(provenanceText(research, "quote"), /“ΔV vs Baseline > 0 over all campaigns”/);
  assert.match(provenanceText(research, "quote"), /Buying the day's full cap when the 11:00 best ask is below the mean/);
  // Stable run ids are preserved as technical alias lines.
  assert.match(provenanceText(campaigns, "alias"), /EXP-GAS-Q-202601-BASELINE/);
});

// ---------- D. layout: one current action, historical card after Results ----------

test("UI-10 Backtests: the legacy TOB control lives in the historical card after Results; the head has none", () => {
  const html = renderSurfacePage("backtests", vms.backtests, { mode: "TOB" });
  const results = html.indexOf('data-section="results"');
  const historical = html.indexOf('<details data-semantic="legacy-provenance" data-provenance="historical"');
  const slot = html.indexOf("<div data-job-control-slot></div>");
  assert.ok(results > 0 && historical > results, "historical card follows Results");
  assert.ok(slot > historical, "legacy TOB control sits inside the historical card");
  assert.equal(html.split("<div data-job-control-slot></div>").length, 2, "one control slot");
  assert.match(renderBacktestJobControl({}, { mode: "TOB" }), /data-job-start>Run legacy TOB backtest<\/button>/);
  const development = renderSurfacePage("backtests", vms.backtests, { mode: "HYPOTHESIS", missionId: "GAS_QUARTERLY" });
  assert.ok(development.indexOf("<div data-job-control-slot></div>") < development.indexOf('data-section="scope"'), "Development control in the page head");
});

test("UI-10 Backtests: blockers read as English titles with a count; paths stay in a collapsed detail", () => {
  const base = "operations/hypothesis/development/GAS_QUARTERLY";
  const hypothesisLaunch = {
    missions: [{
      missionId: "GAS_QUARTERLY",
      status: "BLOCKED",
      blockers: ["availability", "observations", "benchmark", "deliveryHours"].map((field) => ({ code: "SOURCE_MISSING", source: field, path: `${base}/${field}.json`, message: `no ${field} source is committed under ${base}/${field}.json` })),
    }],
  };
  const vm = buildBacktestsViewModel({ exploratory: canonical.inputs.exploratoryBacktest, backtestReadiness: canonical.inputs.backtestReadiness, hypothesisLaunch });
  const html = renderSurfacePage("backtests", vm);
  const scope = html.slice(html.indexOf('data-scope-mission="GAS_QUARTERLY"'), html.indexOf('data-scope-mission="GAS_MONTHLY"'));
  assert.match(scope, /Development source missing · 4<\/span>/);
  assert.match(scope, /<details class="blockers"><summary>Show 4 blocker details and source paths<\/summary>/);
  assert.match(scope, /data-scope-blocker="SOURCE_MISSING">Development source missing: availability<div class="mono">operations\/hypothesis\/development\/GAS_QUARTERLY\/availability.json<\/div>/);
  assert.match(scope, /data-scope-blocker="SOURCE_MISSING">Development source missing: delivery hours</);
  assert.doesNotMatch(scope.replace(/data-scope-blocker="SOURCE_MISSING"/g, ""), /SOURCE_MISSING/);
  // Paths only inside the collapsed detail.
  assert.doesNotMatch(scope.replace(/<details class="blockers">[\s\S]*?<\/details>/g, ""), /operations\//);
  assert.match(scope, /<dl class="kvgrid"><dt>Observed via<\/dt><dd>TOB \/ TRADES<\/dd>/);
});

test("UI-10 Research: historical criteria are one criterion × product matrix and integrity is headed per release", () => {
  const html = renderSurfacePage("research", vms.research);
  const dip = html.slice(html.indexOf('id="res-DIP10"'), html.indexOf('id="res-HOUR"'));
  assert.match(dip, /<table class="t crit-matrix"><thead><tr><th>Criterion<\/th><th>G0BQ<\/th><th>G0BM<\/th>/);
  assert.match(dip, /<div class="caps muted" style="margin-top:8px">Release v2<\/div>/);
  assert.match(dip, /<div class="caps muted" style="margin-top:8px">Release v3<\/div>/);
});

// ---------- E. visual direction (UI10-01) ----------

test("UI10-01: the UI-10 layer sets readable type and contrast on the approved light base", () => {
  const layer = UI_STYLESHEET.slice(UI_STYLESHEET.lastIndexOf(":root {"));
  assert.match(layer, /--ink: #111; --ink-2: #4a4a4a; --ink-3: #4a4a4a;/);
  assert.match(layer, /body \{ font: 16px\/1\.6 var\(--sans\); \}/);
  assert.match(layer, /h1\.page \{ font-size: 34px;/);
  assert.match(layer, /nav\.ws a \{ border-bottom-width: 4px; \}/);
  assert.match(layer, /\.hist \{ border: 2px dashed/);
  // No font size under 14 px anywhere in the layer (PLAN_UI §3, §4.D.20).
  for (const [, size] of layer.matchAll(/font(?:-size)?:[^;}]*?(\d+(?:\.\d+)?)px/g)) {
    assert.ok(Number(size) >= 14, `font-size ${size}px`);
  }
  // The approved light/editorial shell stays (no dark theme).
  assert.match(UI_STYLESHEET, /--paper: #f3f1eb;/);
});

// ---------- F. the checker itself ----------

test("UI-10 checker: primary legacy text is caught; alias/quote lines and the ablation are allowed", () => {
  const page = (body) => `<html><body>${body}</body></html>`;
  assert.deepEqual(legacyTextFindings(page('<div data-provenance="historical">DIP10 11:00<div data-provenance="alias">technical alias ARM_A</div><details data-provenance="quote">“Baseline · A0 11:00 (client practice)”</details></div>')), []);
  assert.deepEqual(legacyTextFindings(page('<div data-context="ablation">CONTROL ↔ H-S1-01</div>')), []);
  const checks = (body) => legacyTextFindings(page(body)).map((finding) => finding.check);
  assert.deepEqual(checks("<p>Arm A</p>"), ["UI10-04"]);
  assert.deepEqual(checks("<p>vs Baseline</p>"), ["UI10-02"]);
  assert.deepEqual(checks("<p>DIP10 v1-exp</p>"), ["UI10-05"]);
  assert.deepEqual(checks('<p title="BENCHMARK_PROVISIONAL">x</p>'), ["UI10-06"]);
  assert.deepEqual(checks("<td>Control</td>"), ["UI10-03"]);
  assert.deepEqual(checks('<div data-provenance="historical">Arm B</div>'), ["UI10-04"]);
});
