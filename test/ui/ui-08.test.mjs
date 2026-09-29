// Tests UI-08 — Backtesting workspace: Scope → Hypotheses → Results, without a
// hardcoded hypothesis or Arm A/B. Source: docs/product task revision
// 20260928-english-v4, SEM-1, FIX-07, BT-08, SEM-2. Fixtures are small; no real
// backtest, no OOS/OES opening, no live action.

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loadCanonicalUiInputs } from "../../src/ui/canonical-inputs.mjs";
import { buildUiViewModels, createUiServer, hypothesisResultsFromRunner } from "../../src/ui/server.mjs";
import { buildBacktestsViewModel, backtestHypothesisCollectionEntry } from "../../src/ui/view-models.mjs";
import { renderSurfacePage } from "../../src/ui/render.mjs";
import { BACKTEST_JOBS_PATH } from "../../src/backtest-jobs/http.mjs";
import { renderBacktestJobControl } from "../../src/ui/backtest-job-panel.mjs";
import { TRADES_ACCESS_REGISTRY_PATH } from "../../src/backtest-jobs/trades-runner.mjs";
import {
  HYPOTHESIS_DEVELOPMENT_DATA_ROOT,
  HYPOTHESIS_LAUNCH_REQUEST_FILE,
  createHypothesisJobRunner,
  hypothesisLaunch,
  hypothesisReadinessForMission,
} from "../../src/backtest-jobs/hypothesis-runner.mjs";
import { H_S1_01 } from "../../src/s1-strategy/h-s1-01.mjs";
import { makeHypothesisFixtureRepo, hypothesisJobRequest } from "../backtest-jobs/hypothesis-fixture-repo.mjs";

const sha256 = (value) => value.repeat(64 / value.length);

async function withServer(options, run) {
  const { server, ready } = createUiServer({ port: 0, ...options });
  const served = await ready;
  const base = served.url.slice(0, -1);
  try {
    await run(base);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

function canonicalPage(selection = {}) {
  const { inputs } = loadCanonicalUiInputs();
  const vms = buildUiViewModels(inputs);
  return renderSurfacePage("backtests", vms.backtests, selection);
}

test("UI08-10: four surface navigation labels come from the shared backend projection", () => {
  const { inputs } = loadCanonicalUiInputs();
  const vms = buildUiViewModels(inputs);
  const projected = {
    ...vms.backtests.canonicalSemantics,
    labels: {
      ...vms.backtests.canonicalSemantics.labels,
      tabs: { ...vms.backtests.canonicalSemantics.labels.tabs, research: "Research Workspace" },
    },
  };
  for (const surface of ["campaigns", "replay", "backtests", "research"]) {
    const html = renderSurfacePage(surface, { ...vms[surface], canonicalSemantics: projected });
    assert.match(html, /data-nav="research"[^>]*><span class="k">[^<]*<\/span><span class="t">Research Workspace<\/span>/, surface);
  }
});

// ---------- UI08-01 · stable Backtesting title and vertical layout ----------

test("UI08-01: Backtesting has a stable title and vertical Scope → Hypotheses → Results layout", () => {
  const html = canonicalPage();
  assert.match(html, /<h1 class="page">Backtesting<\/h1>/);
  const scope = html.indexOf('data-section="scope"');
  const hypotheses = html.indexOf('data-section="hypotheses"');
  const results = html.indexOf('data-section="results"');
  assert.ok(scope > -1 && hypotheses > scope && results > hypotheses, "vertical order Scope → Hypotheses → Results");
});

test("UI08-01: no global DIP/HOUR/11:00 question is hardcoded on the page", () => {
  const html = canonicalPage();
  assert.doesNotMatch(html, /Does another hour or a dip rule buy cheaper/);
  assert.doesNotMatch(html, /DIP10\/HOUR question/i);
  // The canonical question comes from the backend hypothesis card, not a global literal.
  assert.match(html, new RegExp(H_S1_01.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});

// ---------- UI08-02 · Scope keeps all four missions, first class ----------

test("UI08-02: Scope keeps the four missions first-class and never hides a missing one", () => {
  const html = canonicalPage();
  for (const missionId of ["GAS_QUARTERLY", "GAS_MONTHLY", "POWER_QUARTERLY", "POWER_MONTHLY"]) {
    assert.match(html, new RegExp(`data-scope-mission="${missionId}"`), missionId);
  }
  // A missing source is an explicit UNAVAILABLE state, never a zero.
  assert.match(html, /data-status="UNAVAILABLE"/);
  assert.doesNotMatch(html, /0 MW\)/);
  // TOB/TRADES observation is declared for each mission.
  assert.match(html, /TOB \/ TRADES/);
});

test("UI08-02: unknown mission readiness does not become zero and carries its reason", () => {
  const vm = buildBacktestsViewModel({ hypothesisLaunch: null });
  for (const entry of vm.scope) {
    assert.equal(entry.readiness.status, "UNAVAILABLE", entry.missionId);
    assert.notEqual(entry.obligation.status, "BOUND");
    assert.ok(typeof entry.obligation.reason === "string" && entry.obligation.reason.length > 0);
  }
});

// ---------- UI08-03 · dynamic canonical hypotheses collection ----------

test("UI08-03: a third hypothesis renders without a renderer ARM_C branch", () => {
  const { inputs } = loadCanonicalUiInputs();
  const base = buildUiViewModels(inputs).backtests;
  const third = {
    kind: "HYPOTHESIS",
    hypothesisId: "H-S2-01",
    name: "Test Hypothesis",
    question: "A dynamically declared research question from the backend.",
    version: "H-S2-01/phase-A/v1",
    originType: "STRATEGY_DERIVED",
    role: "Strategy",
    strategyRefs: ["S2"],
    applicabilityStatus: "DECLARED",
    missions: [{ missionId: "GAS_MONTHLY", status: "UNAVAILABLE", blockers: [], running: false, configuration: null }],
    state: { registered: true, runnable: false, running: false, completed: false, scientificallyEvaluated: false },
    results: [],
  };
  const vm = { ...base, hypotheses: [...base.hypotheses, third] };
  const html = renderSurfacePage("backtests", vm, {});
  assert.match(html, /data-hypothesis-id="H-S2-01"/);
  assert.match(html, /A dynamically declared research question from the backend\./);
  const hypothesesSection = html.slice(html.indexOf('data-section="hypotheses"'), html.indexOf('data-section="results"'));
  assert.equal((hypothesesSection.match(/data-hypothesis-id="/g) ?? []).length, base.hypotheses.length + 1);
});

test("UI08-12: hypothesis role label comes from the shared backend projection", () => {
  const { inputs } = loadCanonicalUiInputs();
  const base = buildUiViewModels(inputs).backtests;
  const original = base.hypotheses.find((entry) => entry.hypothesisId === "H-S1-01");
  const injected = { ...original, role: "Source-bound Strategy" };
  const html = renderSurfacePage("backtests", { ...base, hypotheses: [injected] }, {});
  const card = html.match(/<div class="card" data-hypothesis-id="H-S1-01"[\s\S]*?<\/div>\s*<\/div>/)?.[0] ?? "";
  assert.match(card, /Source-bound Strategy/);
  assert.doesNotMatch(card, /<span class="small muted">Strategy ·/);
  const unavailable = renderSurfacePage("backtests", { ...base, hypotheses: [{ ...injected, role: null }] }, {});
  assert.match(unavailable, /<span class="small muted">UNAVAILABLE · H-S1-01/);
});

test("UI08-03: an unrun H-S1-01 never appears tested with legacy DIP10 data", () => {
  const html = canonicalPage();
  assert.match(html, new RegExp(`data-hypothesis-id="H-S1-01"`));
  assert.match(html, /scientifically evaluated: <b>no<\/b>/);
  // No fabricated TESTED state on the canonical hypothesis card.
  const card = html.slice(html.indexOf('data-hypothesis-id="H-S1-01"'));
  assert.doesNotMatch(card.slice(0, 1500), /TESTED/);
});

// ---------- UI08-04 · CLIENT / one BENCHMARK / hypotheses ----------

test("UI08-04: comparison is CLIENT / one BENCHMARK / hypotheses with honest metadata", () => {
  const html = canonicalPage();
  assert.match(html, /data-identity="CLIENT"/);
  assert.match(html, /data-identity="BENCHMARK"/);
  assert.match(html, /data-identity="HYPOTHESIS"/);
  assert.equal((html.match(/data-identity="BENCHMARK"/g) ?? []).length, 4);
  assert.match(html, /purchase timing UNKNOWN for this mission|purchase timing/);
});

test("UI08-04: absent runs and unknown client economics are unavailable, not zero", () => {
  const { inputs } = loadCanonicalUiInputs();
  const vm = buildUiViewModels(inputs).backtests;
  for (const comparison of vm.semanticComparison) {
    assert.equal(comparison.hypothesisResults.length, 0);
    assert.equal(comparison.client.economics, null);
  }
  const html = renderSurfacePage("backtests", vm, {});
  assert.match(html, /no comparable run published/);
});

// ---------- UI08-05 · CONTROL as the ablation comparison ----------

test("UI08-05: ablation renders the paired effect and parity when a valid run exists", () => {
  const result = {
    hypothesisId: H_S1_01.hypothesisId,
    hypothesisVersion: H_S1_01.version,
    missionId: "GAS_MONTHLY",
    runId: `HYP-RUN-${sha256("a")}`,
    status: "SUCCEEDED",
    validComparison: true,
    retention: { state: "CURRENT" },
    resultPath: "operations/hypothesis/runs/result.json",
    resultSha256: sha256("b"),
    ablation: { paired: true, ok: true, verdict: "HOLD", deltaV: 1.234, equivalentCostDifference: 1.234, absolutePass: false },
  };
  const vm = buildBacktestsViewModel({ hypothesisResults: [result] });
  const row = vm.ablation.find((entry) => entry.mission.id === "GAS_MONTHLY");
  assert.equal(row.status, "EFFECT");
  const html = renderSurfacePage("backtests", vm, {});
  assert.match(html, /ΔV 1\.234 EUR\/MWh/);
  assert.match(html, /same sizing\/execution parity/);
  // Ablation is labelled as the experimental counterpart, never CLIENT/benchmark,
  // and names the hypothesis its result belongs to (R05: no fixed renderer ID).
  assert.match(html, /Ablation · CONTROL ↔ active hypothesis/);
  assert.match(html, new RegExp(`CONTROL ↔ ${H_S1_01.hypothesisId}`));
});

test("UI08-05: without a comparable run the ablation states the exact reason", () => {
  const vm = buildBacktestsViewModel({});
  for (const entry of vm.ablation) {
    assert.equal(entry.status, "UNAVAILABLE");
    assert.match(entry.reason, /no comparable Development run/);
  }
});

// ---------- UI08-07 · readiness gates the run control ----------

test("UI08-07: a blocked mission keeps the run control disabled with its exact blocker", async () => {
  const repo = makeHypothesisFixtureRepo({ missions: ["GAS_MONTHLY"], deliveryOptions: { GAS_MONTHLY: { requiresFreeze: true } } });
  const runner = createHypothesisJobRunner({ repoRoot: repo.root });
  await withServer({ hypothesisJobRunner: runner }, async (base) => {
    const html = await (await fetch(`${base}/backtests?mode=HYPOTHESIS&mission=GAS_MONTHLY`)).text();
    assert.match(html, /data-backtest-job data-endpoint="\/api\/backtest-jobs" data-mode="HYPOTHESIS"/);
    assert.match(html, /data-locked="true"/);
    assert.match(html, /data-job-blockers/);
    assert.doesNotMatch(html, /data-hypothesis-request>/);
    assert.match(html, /Run H-S1-01 Development/);
  });
});

test("UI08-07: readiness reports RUNNABLE only for a fully bound fixture and gates launch", () => {
  const repo = makeHypothesisFixtureRepo({ missions: ["GAS_MONTHLY"] });
  const readiness = hypothesisReadinessForMission(repo.root, "GAS_MONTHLY");
  assert.equal(readiness.status, "RUNNABLE", JSON.stringify(readiness.blockers));
  // No committed launch request yet: the run stays disabled with the exact code.
  const launch = hypothesisLaunch(repo.root).find((entry) => entry.missionId === "GAS_MONTHLY");
  assert.equal(launch.status, "BLOCKED");
  assert.equal(launch.request, null);
  assert.equal(launch.blockers[0].code, "LAUNCH_REQUEST_MISSING");
});

// ---------- UI08-06 / UI08-08 · single run control wired to BT-08 Development ----------

test("UI08-06: the single control posts the backend-validated Development request and renders the matching result", async () => {
  const repo = makeHypothesisFixtureRepo({
    missions: ["GAS_MONTHLY"],
    benchmarkOptions: { GAS_MONTHLY: { status: "RECONCILED_OFFICIAL", version: "B-OFFICIAL-v1" } },
    observationOptions: { GAS_MONTHLY: { prices: { "2025-03-07": 25 } } },
  });
  const request = hypothesisJobRequest(repo, { missionId: "GAS_MONTHLY", benchmark: { status: "RECONCILED_OFFICIAL", version: "B-OFFICIAL-v1" } });
  repo.write(`${HYPOTHESIS_DEVELOPMENT_DATA_ROOT}/GAS_MONTHLY/${HYPOTHESIS_LAUNCH_REQUEST_FILE}`, `${JSON.stringify(request, null, 1)}\n`);
  repo.commitAll("launch request");
  const runner = createHypothesisJobRunner({ repoRoot: repo.root });
  await withServer({ hypothesisJobRunner: runner }, async (base) => {
    const page = await (await fetch(`${base}/backtests?mode=HYPOTHESIS&mission=GAS_MONTHLY`)).text();
    const match = page.match(/<script type="application\/json" data-hypothesis-request>([\s\S]*?)<\/script>/);
    assert.ok(match, "the backend-validated request is embedded in the control");
    const embedded = JSON.parse(match[1]);
    assert.equal(embedded.phase, "DEVELOPMENT");
    assert.equal(embedded.missionId, "GAS_MONTHLY");
    assert.equal(embedded.hypothesisId, H_S1_01.hypothesisId);
    // UI08-08: Development only — the request binds no OOS/bridge phase.
    assert.equal(embedded.search, false);

    const started = await fetch(`${base}${BACKTEST_JOBS_PATH}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ requestedBy: "ui", mode: "HYPOTHESIS", job: embedded }),
    });
    const startedBody = await started.json();
    assert.equal(started.status, 202, JSON.stringify(startedBody));
    assert.equal(startedBody.mode, "HYPOTHESIS");
    await runner.waitForIdle();

    const after = await (await fetch(`${base}/backtests?mode=HYPOTHESIS&mission=GAS_MONTHLY`)).text();
    assert.match(after, /data-hypothesis-run="HYP-RUN-/, "the published run result is rendered");
  });
});

test("UI08-08: the hypothesis control never dispatches the legacy TOB/TRADES chain", async () => {
  const repo = makeHypothesisFixtureRepo({ missions: ["GAS_MONTHLY"] });
  const request = hypothesisJobRequest(repo, { missionId: "GAS_MONTHLY" });
  repo.write(`${HYPOTHESIS_DEVELOPMENT_DATA_ROOT}/GAS_MONTHLY/${HYPOTHESIS_LAUNCH_REQUEST_FILE}`, `${JSON.stringify(request)}\n`);
  const runner = createHypothesisJobRunner({ repoRoot: repo.root });
  await withServer({ hypothesisJobRunner: runner }, async (base) => {
    const page = await (await fetch(`${base}/backtests?mode=HYPOTHESIS&mission=GAS_MONTHLY`)).text();
    assert.match(page, /mode: "HYPOTHESIS", job: request/);
    assert.match(page, /data-mode="HYPOTHESIS"/);
    // A hypothesis payload without mode HYPOTHESIS is rejected, never run as legacy.
    const rejected = await fetch(`${base}${BACKTEST_JOBS_PATH}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ requestedBy: "ui", job: request }),
    });
    assert.equal(rejected.status, 400);
    assert.equal((await rejected.json()).code, "INVALID_MODE");
  });
});

// ---------- UI08-09 · scoped result identity/history ----------

test("UI08-09: results stay scoped per hypothesis/version/mission and Gas/Power never overwrite", () => {
  const resultFor = (missionId, letter) => ({
    hypothesisId: H_S1_01.hypothesisId,
    hypothesisVersion: H_S1_01.version,
    missionId,
    runId: `HYP-RUN-${sha256(letter)}`,
    status: "SUCCEEDED",
    validComparison: true,
    retention: { state: "CURRENT" },
    resultPath: `operations/hypothesis/runs/${missionId}.json`,
    resultSha256: sha256(letter === "a" ? "b" : "c"),
    ablation: { paired: true, ok: true, verdict: "HOLD", deltaV: 1, equivalentCostDifference: 1 },
  });
  const vm = buildBacktestsViewModel({ hypothesisResults: [resultFor("GAS_MONTHLY", "a"), resultFor("POWER_MONTHLY", "d")] });
  const gas = vm.canonicalSemantics.missions.find((mission) => mission.missionId === "GAS_MONTHLY");
  const power = vm.canonicalSemantics.missions.find((mission) => mission.missionId === "POWER_MONTHLY");
  assert.equal(gas.hypothesisResults.length, 1);
  assert.equal(power.hypothesisResults.length, 1);
  assert.notEqual(gas.hypothesisResults[0].runId, power.hypothesisResults[0].runId);
  // A version mismatch is not attributed as evidence.
  const mismatched = buildBacktestsViewModel({ hypothesisResults: [{ ...resultFor("GAS_MONTHLY", "a"), hypothesisVersion: "H-S1-01/phase-A/v0" }] });
  const gasMismatch = mismatched.canonicalSemantics.missions.find((mission) => mission.missionId === "GAS_MONTHLY");
  assert.equal(gasMismatch.hypothesisResults.length, 0);
});

// ---------- UI08-10 / UI08-11 · served build + approved visual language ----------

test("UI08-10: /health and the four routes serve the integrated English interface", async () => {
  const { inputs, backend } = loadCanonicalUiInputs();
  await withServer({ inputs, backend }, async (base) => {
    const health = await (await fetch(`${base}/health`)).json();
    assert.equal(health.ok, true);
    assert.equal(health.semanticSnapshot.semanticVersion, "SEM-1/2026-09-28/v1");
    assert.ok(typeof health.build === "object");
    for (const route of ["/campaigns", "/replay", "/backtests", "/research"]) {
      const response = await fetch(`${base}${route}`);
      assert.equal(response.status, 200, route);
      const html = await response.text();
      assert.match(html, /data-visual-language="claude-blind"/, route);
      assert.match(html, /data-nav="research"/, route);
      assert.doesNotMatch(html, /dark-dashboard|theme: dark/i, route);
    }
  });
});

test("UI08-11: the approved light/editorial structure is preserved on Backtesting", () => {
  const html = canonicalPage();
  assert.match(html, /data-ui-visual-language="claude-blind"/);
  assert.match(html, /<nav class="ws ui-nav"/);
  for (const nav of ["campaigns", "replay", "backtests", "research"]) {
    assert.match(html, new RegExp(`data-nav="${nav}"`));
  }
  // No invented mockup metrics/thresholds.
  assert.doesNotMatch(html, /win rate|sigma threshold|N10 default/i);
});

// ---------- UI08-12 · shared SEM-2 projection across surfaces ----------

test("UI08-12: Backtesting consumes the same canonical projection as the other surfaces", () => {
  const html = canonicalPage();
  assert.match(html, /data-semantic="SEM-1\/2026-09-28\/v1"/);
  assert.match(html, new RegExp(`data-hypothesis-id="${H_S1_01.hypothesisId}"`));
  // The English canonical names come from the backend projection, not a UI dictionary.
  assert.match(html, new RegExp(H_S1_01.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});

// ---------- review round 2 (2026-09-29) · findings UI08-R01 … UI08-R13 ----------

const flush = async (rounds = 6) => {
  for (let round = 0; round < rounds; round += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
};

// The single run control is a client script; the E2E drives it with a minimal
// DOM stub (root, button, line, message, request holder) and a scripted fetch,
// so the same code the browser runs performs the POST.
function jobControlScriptOf(html) {
  return html.match(/<script>\n(\(function \(\) \{[\s\S]*?\}\)\(\);)\n<\/script>/)?.[1] ?? null;
}

function controlHarness(html, { requestJson = null, runningAttr = null, fetchQueue = [] } = {}) {
  const script = jobControlScriptOf(html);
  assert.ok(script, "the job control script is embedded in the served page");
  const button = { disabled: false, handlers: {}, addEventListener(type, handler) { this.handlers[type] = handler; } };
  const line = { textContent: "" };
  const message = { textContent: "" };
  const requestHolder = requestJson === null ? null : { textContent: requestJson };
  const root = {
    attrs: {
      "data-endpoint": html.match(/data-endpoint="([^"]*)"/)?.[1] ?? null,
      "data-mode": html.match(/data-mode="([^"]*)"/)?.[1] ?? null,
      "data-running": runningAttr ?? html.match(/data-running="([^"]*)"/)?.[1] ?? "false",
    },
    setAttribute(name, value) { this.attrs[name] = String(value); },
    getAttribute(name) { return this.attrs[name] ?? null; },
    querySelector(selector) {
      if (selector === "[data-job-start]") return button;
      if (selector === "[data-job-line]") return line;
      if (selector === "[data-job-message]") return message;
      if (selector === "[data-hypothesis-request]") return requestHolder;
      return null;
    },
  };
  const calls = [];
  const fetchImpl = (url, options = {}) => {
    calls.push({ url, options });
    const next = fetchQueue.shift();
    assert.ok(next !== undefined, `unexpected fetch call: ${url}`);
    return typeof next === "function" ? next(url, options) : Promise.resolve({ json: async () => next });
  };
  new Function("document", "fetch", "setTimeout", script)(
    { querySelector: (selector) => (selector === "[data-backtest-job]" ? root : null) },
    fetchImpl,
    (fn) => fn(),
  );
  return { button, line, message, calls, root, click: () => button.handlers.click?.() };
}

function comparableResultFixture(letter, overrides = {}) {
  return {
    hypothesisId: H_S1_01.hypothesisId,
    hypothesisVersion: H_S1_01.version,
    missionId: "GAS_MONTHLY",
    runId: `HYP-RUN-${sha256(letter)}`,
    status: "SUCCEEDED",
    validComparison: true,
    retention: { state: "CURRENT" },
    resultPath: `operations/hypothesis/runs/${letter}.json`,
    resultSha256: sha256(letter.repeat(2)),
    phase: "DEVELOPMENT",
    dataMode: "TOB",
    ablation: { paired: true, ok: true, verdict: "HOLD", deltaV: 1.234, equivalentCostDifference: 1.234, absolutePass: false },
    ...overrides,
  };
}

// UI08-R01 · Scope shows every campaign window tied to its source
test("UI08-R01: Scope shows the calendar window of each campaign of the mission, tied to its source", () => {
  const backtestReadiness = {
    ok: true,
    provenance: { artifactPath: "operations/exploratory/bt02.json", artifactSha256: sha256("p") },
    results: {
      artifactKind: "BT-02_EXPLORATORY_BENCHMARK_RECONCILIATION",
      status: "EXPLORATORY_PROVISIONAL",
      campaigns: [
        { campaignKey: "G0BM-202509", product: "G0BM", maturity: "202509", status: "UNAVAILABLE", campaignReadiness: "INSUFFICIENT_DATA", benchmark: null, fees: { status: "UNKNOWN", included: false } },
        { campaignKey: "G0BM-202601", product: "G0BM", maturity: "202601", status: "UNAVAILABLE", campaignReadiness: "INSUFFICIENT_DATA", benchmark: null, fees: { status: "UNKNOWN", included: false } },
      ],
    },
  };
  const exploratory = {
    provenance: { byProduct: {}, resultsSha256: sha256("e"), slotsSha256: sha256("s") },
    results: {
      status: "EXPLORATORY",
      inputs: { dataPeriod: { firstDataDay: "2025-01-02", lastDataDay: "2025-03-07" } },
      rules: { targetsMw: {}, slippageEurMwh: 0.15, dailyCapMw: 12, feesEurMwh: 0 },
      episodesSkippedIncomplete: [],
      results: [],
      summary: {},
      campaigns: [
        { id: "GAS-M-202509", product: "G0BM", maturity: "202509", firstDay: "2025-08-01", lastDay: "2025-08-28" },
        { id: "GAS-M-202601", product: "G0BM", maturity: "202601", firstDay: "2025-11-03", lastDay: "2025-12-30" },
      ],
    },
  };
  const vm = buildBacktestsViewModel({ exploratory, backtestReadiness });
  const entry = vm.scope.find((scope) => scope.missionId === "GAS_MONTHLY");
  assert.equal(entry.campaignWindows.length, 2, "both campaigns of the mission stay visible");
  assert.deepEqual(
    entry.campaignWindows.filter((window) => window.status === "BOUND").map((window) => [window.campaignId, window.firstDay, window.lastDay]),
    [["G0BM-202509", "2025-08-01", "2025-08-28"], ["G0BM-202601", "2025-11-03", "2025-12-30"]],
  );
  const html = renderSurfacePage("backtests", vm, {});
  assert.match(html, /data-campaign-window="G0BM-202509">G0BM-202509 · 202509 · 2025-08-01 → 2025-08-28/);
  assert.match(html, /data-campaign-window="G0BM-202601">G0BM-202601 · 202601 · 2025-11-03 → 2025-12-30/);
});

// UI08-R02 · a hypothesis's card reproduces its own canonical states
test("UI08-R02: the hypothesis collection entry carries each hypothesis's own states, not fixed values", () => {
  const third = {
    kind: "HYPOTHESIS",
    hypothesisId: "H-S2-01",
    name: "Test Hypothesis",
    question: "A dynamically declared research question from the backend.",
    version: "H-S2-01/phase-A/v1",
    originType: "STRATEGY_DERIVED",
    role: "Strategy",
    strategyRefs: ["S2"],
    applicabilityStatus: "DECLARED",
    missions: ["GAS_MONTHLY"],
    state: { registered: true, runnable: true, running: true, completed: true, scientificallyEvaluated: true },
  };
  const declared = backtestHypothesisCollectionEntry(third, { results: [] });
  assert.deepEqual(declared.state, { registered: true, runnable: false, running: false, completed: true, scientificallyEvaluated: true });
  // Without a declared state, the derivation follows the hypothesis's own data:
  // a result with researchPass flips scientific evaluation, a CURRENT result
  // completes it — regardless of H-S1-01's launch.
  const derived = backtestHypothesisCollectionEntry(
    { ...third, state: undefined },
    { results: [{ runId: "R", state: "CURRENT", researchPass: true }] },
  );
  assert.equal(derived.state.scientificallyEvaluated, true);
  assert.equal(derived.state.completed, true);
  assert.equal(derived.state.runnable, false, "no READY launch for this hypothesis, so not runnable");
  // H-S1-01 default: Development results keep researchPass false, never a PASS.
  const { inputs } = loadCanonicalUiInputs();
  const h1 = buildUiViewModels(inputs).backtests.hypotheses.find((hypothesis) => hypothesis.hypothesisId === H_S1_01.hypothesisId);
  assert.equal(h1.state.scientificallyEvaluated, false);
});

test("UI08-R14: another hypothesis sharing a mission cannot inherit H-S1-01 launch, configuration or running state", () => {
  const canonicalH1 = buildBacktestsViewModel().canonicalSemantics.hypotheses.find((hypothesis) => hypothesis.hypothesisId === H_S1_01.hypothesisId);
  const request = {
    hypothesisId: H_S1_01.hypothesisId,
    hypothesisVersion: H_S1_01.version,
    missionId: "GAS_MONTHLY",
    candidate: { contentHash: sha256("a"), tau: { localTime: "10:30" }, N: 8 },
    searchSpace: { contentHash: sha256("b") },
    configuration: { configurationHash: sha256("c") },
  };
  const hypothesisLaunch = {
    metadata: { hypothesisId: H_S1_01.hypothesisId, version: H_S1_01.version },
    missions: [{ missionId: "GAS_MONTHLY", status: "READY", request, blockers: [] }],
    runningJob: { hypothesisId: H_S1_01.hypothesisId, hypothesisVersion: H_S1_01.version, missionId: "GAS_MONTHLY" },
  };
  const h1 = backtestHypothesisCollectionEntry(canonicalH1, { hypothesisLaunch });
  assert.equal(h1.missions.find((entry) => entry.missionId === "GAS_MONTHLY").status, "READY");
  assert.equal(h1.state.runnable, true);
  assert.equal(h1.state.running, true);

  const h2 = {
    ...canonicalH1,
    hypothesisId: "H-S2-01",
    version: "H-S2-01/phase-A/v1",
    name: "Second Strategy Hypothesis",
    missions: ["GAS_MONTHLY"],
    state: { runnable: true, running: true },
  };
  const isolated = backtestHypothesisCollectionEntry(h2, { hypothesisLaunch });
  assert.equal(isolated.missions[0].status, "UNAVAILABLE");
  assert.equal(isolated.missions[0].configuration, null);
  assert.equal(isolated.missions[0].running, false);
  assert.equal(isolated.state.runnable, false);
  assert.equal(isolated.state.running, false);
  const html = renderSurfacePage("backtests", {
    ...buildBacktestsViewModel({ hypothesisLaunch }),
    hypotheses: [h1, isolated],
  }, {});
  const h2Card = html.slice(html.indexOf('data-hypothesis-id="H-S2-01"'), html.indexOf('class="tr07bar"'));
  assert.match(h2Card, /GAS_MONTHLY[\s\S]*?UNAVAILABLE/);
  assert.doesNotMatch(h2Card, new RegExp(sha256("a").slice(0, 12)));

  const wrongVersion = backtestHypothesisCollectionEntry({ ...canonicalH1, version: "H-S1-01/phase-A/v3" }, { hypothesisLaunch });
  assert.equal(wrongVersion.missions.find((entry) => entry.missionId === "GAS_MONTHLY").status, "UNAVAILABLE");
  const wrongRequest = backtestHypothesisCollectionEntry(canonicalH1, {
    hypothesisLaunch: { ...hypothesisLaunch, missions: [{ missionId: "GAS_MONTHLY", status: "READY", request: { ...request, hypothesisId: "H-S2-01" } }] },
  });
  assert.equal(wrongRequest.missions.find((entry) => entry.missionId === "GAS_MONTHLY").status, "UNAVAILABLE");
});

// UI08-R03 · benchmark source and version metadata stay visible
test("UI08-R03: BENCHMARK keeps source and version visible, and the official BT-08 reference is presented", () => {
  const backtestReadiness = {
    ok: true,
    provenance: { artifactPath: "operations/exploratory/bt02-prov.json", artifactSha256: sha256("p") },
    results: {
      artifactKind: "BT-02_EXPLORATORY_BENCHMARK_RECONCILIATION",
      status: "EXPLORATORY_PROVISIONAL",
      campaigns: [
        { campaignKey: "G0BM-202509", product: "G0BM", maturity: "202509", status: "UNAVAILABLE", campaignReadiness: "INSUFFICIENT_DATA", benchmark: { status: "BENCHMARK_PROVISIONAL", B: 34, versionId: "B-PROV-v1" }, fees: { status: "UNKNOWN", included: false } },
        { campaignKey: "G0BM-202601", product: "G0BM", maturity: "202601", status: "UNAVAILABLE", campaignReadiness: "INSUFFICIENT_DATA", benchmark: { status: "BENCHMARK_PROVISIONAL", B: 36, versionId: "B-PROV-v2" }, fees: { status: "UNKNOWN", included: false } },
      ],
    },
  };
  const html = renderSurfacePage("backtests", buildBacktestsViewModel({ backtestReadiness }), {});
  assert.match(html, /data-benchmark-reference="G0BM-202509">G0BM-202509 · BENCHMARK_PROVISIONAL · version B-PROV-v1 · source operations\/exploratory\/bt02-prov\.json/);
  assert.match(html, /version B-PROV-v2/);
  // The BT-08 result's own (official) evaluation reference is presented with the run.
  const official = comparableResultFixture("o", {
    comparison: {
      control: { benchmarkVersion: "B-PROV-v1", benchmarkStatus: "BENCHMARK_PROVISIONAL" },
      active: { benchmarkVersion: "B-OFFICIAL-v2", benchmarkStatus: "RECONCILED_OFFICIAL" },
    },
  });
  const officialHtml = renderSurfacePage("backtests", buildBacktestsViewModel({ hypothesisResults: [official] }), {});
  assert.match(officialHtml, /benchmark B-OFFICIAL-v2 \(RECONCILED_OFFICIAL\)/);
});

// UI08-R04 · runs without comparable evidence stay out of the main comparison
test("UI08-R04: a FAILED run without valid comparison is technical history, never a hypothesis result", () => {
  const current = comparableResultFixture("c");
  const failed = {
    ...comparableResultFixture("f"),
    status: "FAILED",
    validComparison: false,
    ablation: null,
  };
  const vm = buildBacktestsViewModel({ hypothesisResults: [current, failed] });
  const html = renderSurfacePage("backtests", vm, {});
  assert.match(html, new RegExp(`data-hypothesis-run="${current.runId}"`), "the comparable run is the main result");
  assert.match(html, new RegExp(`data-technical-run="${failed.runId}"`), "the failed run stays as technical history");
  assert.doesNotMatch(html, new RegExp(`data-hypothesis-run="${failed.runId}"`), "the failed run is not a hypothesis result");
  assert.match(html, /Technical run history \(not comparable evidence\)/);
});

test("UI08-R04: a superseded run with valid comparison is history too, not a second main result", () => {
  const current = comparableResultFixture("c");
  const superseded = {
    ...comparableResultFixture("s"),
    retention: { state: "SUPERSEDED", supersededBy: current.runId },
  };
  const html = renderSurfacePage("backtests", buildBacktestsViewModel({ hypothesisResults: [current, superseded] }), {});
  assert.doesNotMatch(html, new RegExp(`data-hypothesis-run="${superseded.runId}"`));
  assert.match(html, new RegExp(`data-technical-run="${superseded.runId}"`));
});

// UI08-R05 · the ablation identifies the active hypothesis
test("UI08-R05: the ablation names the hypothesis its result belongs to, without a renderer edit", () => {
  const base = buildBacktestsViewModel({});
  const future = {
    mission: { id: "GAS_MONTHLY", label: "Gas Monthly" },
    status: "EFFECT",
    hypothesisId: "H-S2-01",
    reason: null,
    ablation: { paired: true, ok: true, verdict: "HOLD", deltaV: 2.5, equivalentCostDifference: 2.5, absolutePass: false },
    result: { hypothesisId: "H-S2-01" },
  };
  const html = renderSurfacePage("backtests", { ...base, ablation: [future] }, {});
  assert.match(html, /CONTROL ↔ H-S2-01/);
  assert.match(html, /ΔV 2\.500 EUR\/MWh/);
  assert.doesNotMatch(html, /Ablation · CONTROL ↔ H-S1-01/, "the renderer fixes no hypothesis ID");
  // The view model derives the ID from the result, never from a constant.
  const vm = buildBacktestsViewModel({ hypothesisResults: [comparableResultFixture("c")] });
  assert.equal(vm.ablation.find((entry) => entry.mission.id === "GAS_MONTHLY").hypothesisId, H_S1_01.hypothesisId);
});

// UI08-R06 · the Development control stays reachable and blocked with reasons
test("UI08-R06: without READY missions every mission keeps its Development link and its exact blocker", async () => {
  const html = canonicalPage();
  const links = [...html.matchAll(/data-hypothesis-run-mission="([A-Z_]+)" data-hypothesis-run-status="([A-Z_]+)"/g)];
  assert.equal(links.length, 4, "the four missions keep their link to the Development control");
  assert.ok(links.every(([, , status]) => status !== "READY"), "no mission is READY in the canonical repo");
  assert.match(html, /data-hypothesis-run-blocked="true"/);
  // Navigating to a chosen mission shows the disabled control with that mission's reason.
  const repo = makeHypothesisFixtureRepo({ missions: ["GAS_MONTHLY"], deliveryOptions: { GAS_MONTHLY: { requiresFreeze: true } } });
  const runner = createHypothesisJobRunner({ repoRoot: repo.root });
  await withServer({ hypothesisJobRunner: runner }, async (base) => {
    const control = await (await fetch(`${base}/backtests?mode=HYPOTHESIS&mission=GAS_MONTHLY`)).text();
    assert.match(control, /data-locked="true"/);
    assert.doesNotMatch(control, /data-hypothesis-request>/);
    assert.match(control, /FREEZE_PENDING/);
  });
});

// UI08-R07 · the client refresh never re-enables a blocked control
test("UI08-R07: a missing or misbound selected mission never borrows another Development request", () => {
  const status = { running: false, hypothesis: { configured: true, statusReadable: true, running: false } };
  const launch = { missions: [{ missionId: "GAS_MONTHLY", status: "READY", request: { missionId: "GAS_MONTHLY", phase: "DEVELOPMENT" } }] };
  for (const [selectedMission, missions] of [
    ["POWER_MONTHLY", launch.missions],
    ["GAS_MONTHLY", [{ ...launch.missions[0], request: { missionId: "POWER_MONTHLY", phase: "DEVELOPMENT" } }]],
    ["GAS_MONTHLY", [{ ...launch.missions[0], request: { missionId: "GAS_MONTHLY", phase: "OOS" } }]],
  ]) {
    const page = renderBacktestJobControl(status, { mode: "HYPOTHESIS", missionId: selectedMission, launch: { missions } });
    assert.match(page, /data-locked="true"/);
    assert.match(page, /data-job-start disabled/);
    assert.doesNotMatch(page, /data-hypothesis-request>/);
    assert.match(page, /no backend-validated Development request is available for this mission/);
  }
});

test("UI08-R07: a validated Development request stays locked while its own runner is active or unreadable", async () => {
  const launch = { missions: [{ missionId: "GAS_MONTHLY", status: "READY", request: { missionId: "GAS_MONTHLY", phase: "DEVELOPMENT" } }] };
  const status = { running: false, hypothesis: { configured: true, statusReadable: true, running: true, display: { line: "running" } } };
  const page = renderBacktestJobControl(status, { mode: "HYPOTHESIS", missionId: "GAS_MONTHLY", launch });
  assert.match(page, /data-running="true" data-locked="true"/);
  assert.match(page, /data-job-start disabled/);

  const harness = controlHarness(page, {
    runningAttr: "true",
    requestJson: JSON.stringify(launch.missions[0].request),
    fetchQueue: [
      { ...status, hypothesis: { ...status.hypothesis, statusReadable: false, running: null } },
    ],
  });
  await flush();
  assert.equal(harness.button.disabled, true, "an unreadable hypothesis status cannot enable Development");
  assert.equal(harness.root.attrs["data-running"], "false");
});

test("UI08-R07: a reused result never enables Development without a readable idle hypothesis runner", async () => {
  const request = { missionId: "GAS_MONTHLY", phase: "DEVELOPMENT" };
  const launch = { missions: [{ missionId: "GAS_MONTHLY", status: "READY", request }] };
  const page = renderBacktestJobControl({ running: false, hypothesis: { configured: true, statusReadable: true, running: false } },
    { mode: "HYPOTHESIS", missionId: "GAS_MONTHLY", launch });
  const harness = controlHarness(page, {
    requestJson: JSON.stringify(request),
    fetchQueue: [
      { ok: true, reused: true, display: { line: "Result reused" } },
      { running: false, hypothesis: { configured: true, statusReadable: false, running: null } },
    ],
  });
  harness.click();
  await flush();
  assert.equal(harness.calls.length, 2, "the reused POST must be followed by a fresh status read");
  assert.equal(harness.button.disabled, true);
});

test("UI08-R07: a finished job does not re-enable the Development button without a validated request", async () => {
  const repo = makeHypothesisFixtureRepo({ missions: ["GAS_MONTHLY"], deliveryOptions: { GAS_MONTHLY: { requiresFreeze: true } } });
  const runner = createHypothesisJobRunner({ repoRoot: repo.root });
  await withServer({ hypothesisJobRunner: runner }, async (base) => {
    const page = await (await fetch(`${base}/backtests?mode=HYPOTHESIS&mission=GAS_MONTHLY`)).text();
    assert.doesNotMatch(page, /data-hypothesis-request>/);
    // The page is served while a job runs (data-running="true"); when the job
    // ends, the refresh chain must keep the button disabled (no request).
    const harness = controlHarness(page, {
      runningAttr: "true",
      fetchQueue: [
        { running: true, hypothesis: { configured: true, statusReadable: true, running: true, display: { line: "running" } } },
        { running: false, hypothesis: { configured: true, statusReadable: true, running: false, display: { line: "idle" } } },
      ],
    });
    await flush();
    assert.equal(harness.root.attrs["data-running"], "false", "the job ended");
    assert.equal(harness.button.disabled, true, "the button stays disabled without a backend-validated request");
  });
});

test("UI08-R07: a POST failure with a blocked mission keeps the button disabled", async () => {
  const repo = makeHypothesisFixtureRepo({ missions: ["GAS_MONTHLY"] });
  const request = hypothesisJobRequest(repo, { missionId: "GAS_MONTHLY" });
  repo.write(`${HYPOTHESIS_DEVELOPMENT_DATA_ROOT}/GAS_MONTHLY/${HYPOTHESIS_LAUNCH_REQUEST_FILE}`, `${JSON.stringify(request, null, 1)}\n`);
  repo.commitAll("launch request");
  // Make the source drift so the mission blocks again after the request exists.
  const observationsPath = `${HYPOTHESIS_DEVELOPMENT_DATA_ROOT}/GAS_MONTHLY/observations.json`;
  const observations = JSON.parse(readFileSync(`${repo.root}/${observationsPath}`, "utf8"));
  observations.observations[0].price += 1;
  repo.write(observationsPath, `${JSON.stringify(observations, null, 1)}\n`);
  const runner = createHypothesisJobRunner({ repoRoot: repo.root });
  await withServer({ hypothesisJobRunner: runner }, async (base) => {
    // Serve the page with a request holder that no longer matches the backend
    // truth (the drift above); the launch POST fails and the button stays off.
    const page = await (await fetch(`${base}/backtests?mode=HYPOTHESIS&mission=GAS_MONTHLY`)).text();
    assert.match(page, /data-locked="true"/);
    const holderText = '{"hypothesisId":"H-S1-01","stale":true}';
    const harness = controlHarness(page, {
      requestJson: holderText,
      runningAttr: "false",
      fetchQueue: [
        async () => { throw new Error("launch endpoint unreachable"); },
      ],
    });
    harness.click();
    await flush();
    assert.equal(harness.button.disabled, true, "the button stays disabled after the POST error");
    assert.match(harness.message.textContent, /Not started/);
  });
});

// UI08-R08 · the launch readiness cotes the request hashes against the files
test("UI08-R08: a source altered after the request keeps the mission blocked with INPUT_HASH_MISMATCH", async () => {
  const { rmSync } = await import("node:fs");
  const repo = makeHypothesisFixtureRepo({ missions: ["GAS_MONTHLY"] });
  const request = hypothesisJobRequest(repo, { missionId: "GAS_MONTHLY" });
  repo.write(`${HYPOTHESIS_DEVELOPMENT_DATA_ROOT}/GAS_MONTHLY/${HYPOTHESIS_LAUNCH_REQUEST_FILE}`, `${JSON.stringify(request, null, 1)}\n`);
  repo.commitAll("launch request");
  const observationsPath = `${HYPOTHESIS_DEVELOPMENT_DATA_ROOT}/GAS_MONTHLY/observations.json`;
  const observations = JSON.parse(readFileSync(`${repo.root}/${observationsPath}`, "utf8"));
  observations.observations[0].price += 1;
  repo.write(observationsPath, `${JSON.stringify(observations, null, 1)}\n`);
  const launch = hypothesisLaunch(repo.root).find((entry) => entry.missionId === "GAS_MONTHLY");
  assert.equal(launch.status, "BLOCKED");
  assert.equal(launch.blockers[0].code, "INPUT_HASH_MISMATCH");
  assert.equal(launch.request, null);
  const runner = createHypothesisJobRunner({ repoRoot: repo.root });
  await withServer({ hypothesisJobRunner: runner }, async (base) => {
    const control = await (await fetch(`${base}/backtests?mode=HYPOTHESIS&mission=GAS_MONTHLY`)).text();
    assert.match(control, /data-locked="true"/);
    assert.doesNotMatch(control, /data-hypothesis-request>/);
    assert.match(control, /INPUT_HASH_MISMATCH/);
  });
  // A missing bound source is blocked too: the readiness gate reports the
  // exact file before the hash check can even run.
  rmSync(`${repo.root}/${observationsPath}`);
  const missing = hypothesisLaunch(repo.root).find((entry) => entry.missionId === "GAS_MONTHLY");
  assert.equal(missing.blockers[0].code, "SOURCE_MISSING");
  assert.match(missing.blockers[0].message, /observations\.json/);
});

// UI08-R09 · phase and data mode travel with the published result identity
test("UI08-R09: results of one hypothesis and mission with different modes stay separated and identified", () => {
  const runIdA = `HYP-RUN-${sha256("p")}`;
  const runIdB = `HYP-RUN-${sha256("q")}`;
  // The family key carries phase/mode; today BT-08 only launches
  // DEVELOPMENT|TOB, so the second family exercises the generic transport that
  // keeps future modes from collapsing into one indistinguishable result.
  const runner = {
    status: () => ({ running: false, current: null, latest: null, families: [
      { family: "H-S1-01|GAS_MONTHLY|DEVELOPMENT|TOB", currentRunId: runIdA, tested: true, retention: { state: "CURRENT", supersededBy: null } },
      { family: "H-S1-01|GAS_MONTHLY|DEVELOPMENT|TRADES", currentRunId: runIdB, tested: true, retention: { state: "CURRENT", supersededBy: null } },
    ] }),
    get: (runId) => ({ job: { runId, hypothesisVersion: H_S1_01.version, status: "SUCCEEDED", result: { results: { path: "operations/backtest-runs/x/output/r.json", sha256: sha256("x") } } } }),
  };
  const entries = hypothesisResultsFromRunner(runner);
  assert.equal(entries.length, 2);
  assert.deepEqual(entries.map((entry) => `${entry.phase}|${entry.dataMode}`).sort(), ["DEVELOPMENT|TOB", "DEVELOPMENT|TRADES"]);
  const vm = buildBacktestsViewModel({ hypothesisResults: entries });
  const monthly = vm.canonicalSemantics.missions.find((mission) => mission.missionId === "GAS_MONTHLY");
  assert.equal(monthly.hypothesisResults.length, 2, "both results stay separated in the mission");
  assert.notEqual(monthly.hypothesisResults[0].runId, monthly.hypothesisResults[1].runId);
  const html = renderSurfacePage("backtests", vm, {});
  assert.match(html, new RegExp(`data-hypothesis-run="${runIdA}"[\\s\\S]*?DEVELOPMENT · TOB · comparison valid`));
  assert.match(html, new RegExp(`data-hypothesis-run="${runIdB}"[\\s\\S]*?DEVELOPMENT · TRADES · comparison valid`));
});

// UI08-R10 · E2E through the real button, payload, handler, ledger and result
test("UI08-R10: the E2E clicks the button, inspects payload and handler, preserves the OOS ledger and validates the published result", async () => {
  const repo = makeHypothesisFixtureRepo({
    missions: ["GAS_MONTHLY"],
    benchmarkOptions: { GAS_MONTHLY: { status: "RECONCILED_OFFICIAL", version: "B-OFFICIAL-v1" } },
    observationOptions: { GAS_MONTHLY: { prices: { "2025-03-07": 25 } } },
  });
  const request = hypothesisJobRequest(repo, { missionId: "GAS_MONTHLY", benchmark: { status: "RECONCILED_OFFICIAL", version: "B-OFFICIAL-v1" } });
  repo.write(`${HYPOTHESIS_DEVELOPMENT_DATA_ROOT}/GAS_MONTHLY/${HYPOTHESIS_LAUNCH_REQUEST_FILE}`, `${JSON.stringify(request, null, 1)}\n`);
  repo.commitAll("launch request");
  const runner = createHypothesisJobRunner({ repoRoot: repo.root });
  const ledgerPath = `${repo.root}/${TRADES_ACCESS_REGISTRY_PATH}`;
  const ledgerBefore = existsSync(ledgerPath) ? readFileSync(ledgerPath, "utf8") : null;
  await withServer({ hypothesisJobRunner: runner }, async (base) => {
    const page = await (await fetch(`${base}/backtests?mode=HYPOTHESIS&mission=GAS_MONTHLY`)).text();
    const holder = page.match(/<script type="application\/json" data-hypothesis-request>([\s\S]*?)<\/script>/)[1];
    const embedded = JSON.parse(holder);
    // Full request binding inspection (what the button will send).
    assert.equal(embedded.hypothesisId, H_S1_01.hypothesisId);
    assert.equal(embedded.hypothesisVersion, H_S1_01.version);
    assert.equal(embedded.missionId, "GAS_MONTHLY");
    assert.equal(embedded.phase, "DEVELOPMENT");
    assert.equal(embedded.dataMode, "TOB");
    assert.equal(embedded.search, false);
    const harness = controlHarness(page, {
      requestJson: holder,
      fetchQueue: [
        async (url, options) => {
          const response = await fetch(`${base}${url}`, options);
          const body = await response.json();
          return { json: async () => ({ ...body, status: response.status }) };
        },
        { running: false, hypothesis: { display: { line: "idle" } } },
      ],
    });
    harness.click();
    await flush(20);
    const post = harness.calls.find((call) => call.options?.method === "POST");
    assert.ok(post, "the button click performed the POST");
    assert.equal(post.url, BACKTEST_JOBS_PATH);
    assert.equal(post.options.headers["Content-Type"], "application/json");
    assert.deepEqual(JSON.parse(post.options.body), { requestedBy: "ui", mode: "HYPOTHESIS", job: embedded });
    await runner.waitForIdle();
    // The OOS access ledger is untouched: the Development click never opens OOS.
    const ledgerAfter = existsSync(ledgerPath) ? readFileSync(ledgerPath, "utf8") : null;
    assert.equal(ledgerAfter, ledgerBefore);
    // The published result carries the full identity and configuration binding.
    const after = await (await fetch(`${base}/backtests?mode=HYPOTHESIS&mission=GAS_MONTHLY`)).text();
    const runId = after.match(/data-hypothesis-run="(HYP-RUN-[0-9a-f]+)"/)?.[1];
    assert.ok(runId, "the published run is rendered");
    const published = await (await fetch(`${base}${BACKTEST_JOBS_PATH}/${runId}`)).json();
    const parameters = published.job.identity.parameters;
    assert.equal(parameters.hypothesisId, embedded.hypothesisId);
    assert.equal(parameters.missionId, embedded.missionId);
    assert.equal(parameters.phase, "DEVELOPMENT");
    assert.equal(parameters.dataMode, "TOB");
    assert.equal(parameters.candidateHash, embedded.candidate.contentHash);
    assert.equal(parameters.searchSpaceHash, embedded.searchSpace.contentHash);
    // The fixture request commits no separate mission configuration artifact.
    assert.equal(parameters.configurationHash, embedded.configuration?.configurationHash ?? null);
    assert.match(after, /DEVELOPMENT · TOB · comparison valid/);
  });
});

// UI08-R12 · approved composition at desktop and iPad reference widths
test("UI08-R12: the approved composition holds at both reference widths in available and blocked states", () => {
  const { inputs } = loadCanonicalUiInputs();
  const blocked = buildUiViewModels(inputs).backtests;
  const available = buildBacktestsViewModel({ hypothesisResults: [comparableResultFixture("c")] });
  for (const [label, vm] of [["available", available], ["blocked", blocked]]) {
    // The DOM carries the fluid invariants that make 1440 px and 820 px render
    // from the same composition (screenshots of both widths are committed with
    // docs/product/ui-08/ for the visual comparison against the approved
    // light/editorial references).
    const html = renderSurfacePage("backtests", vm, {});
    assert.match(html, /<meta name="viewport" content="width=device-width, initial-scale=1">/, label);
    for (const svg of html.match(/<svg viewBox="[^"]*" width="[^"]*"/g) ?? []) {
      assert.match(svg, /width="100%"/, `${label}: fluid chart`);
    }
    assert.match(html, /data-ui-visual-language="claude-blind"/, label);
    assert.match(html, /<nav class="ws ui-nav"/, label);
    for (const nav of ["campaigns", "replay", "backtests", "research"]) {
      assert.match(html, new RegExp(`data-nav="${nav}"`), `${label}: ${nav}`);
    }
    assert.doesNotMatch(html, /dark-dashboard|theme: dark|win rate|sigma threshold/i, label);
    assert.match(html, /data-semantic="SEM-1\/2026-09-28\/v1"[\s\S]*?data-overflow-container/, `${label}: comparison table scrolls`);
    assert.match(html, /data-section="results"[\s\S]*?data-overflow-container/, `${label}: ablation table scrolls`);
  }
  // Available state: comparable evidence and ablation effect; blocked state:
  // explicit UNAVAILABLE and the locked Development control markers.
  const availableHtml = renderSurfacePage("backtests", available, {});
  assert.match(availableHtml, /data-hypothesis-run="HYP-RUN-/);
  assert.match(availableHtml, /ΔV 1\.234 EUR\/MWh/);
  const blockedHtml = renderSurfacePage("backtests", blocked, {});
  assert.match(blockedHtml, /no comparable run published/);
  assert.match(blockedHtml, /data-status="UNAVAILABLE"/);
});

// UI08-R13 · one published result, four surfaces, no restart
test("UI08-R13: after publishing a BT-08 result the four surfaces share revision, English names and result identity", async () => {
  const repo = makeHypothesisFixtureRepo({
    missions: ["GAS_MONTHLY"],
    benchmarkOptions: { GAS_MONTHLY: { status: "RECONCILED_OFFICIAL", version: "B-OFFICIAL-v1" } },
    observationOptions: { GAS_MONTHLY: { prices: { "2025-03-07": 25 } } },
  });
  const request = hypothesisJobRequest(repo, { missionId: "GAS_MONTHLY", benchmark: { status: "RECONCILED_OFFICIAL", version: "B-OFFICIAL-v1" } });
  repo.write(`${HYPOTHESIS_DEVELOPMENT_DATA_ROOT}/GAS_MONTHLY/${HYPOTHESIS_LAUNCH_REQUEST_FILE}`, `${JSON.stringify(request, null, 1)}\n`);
  repo.commitAll("launch request");
  const runner = createHypothesisJobRunner({ repoRoot: repo.root });
  const { inputs } = loadCanonicalUiInputs();
  await withServer({ inputs, hypothesisJobRunner: runner }, async (base) => {
    const page = await (await fetch(`${base}/backtests?mode=HYPOTHESIS&mission=GAS_MONTHLY`)).text();
    const embedded = JSON.parse(page.match(/<script type="application\/json" data-hypothesis-request>([\s\S]*?)<\/script>/)[1]);
    const started = await fetch(`${base}${BACKTEST_JOBS_PATH}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ requestedBy: "ui", mode: "HYPOTHESIS", job: embedded }),
    });
    assert.equal(started.status, 202);
    await runner.waitForIdle();
    // The promotion republishes the snapshot atomically; poll for it instead of
    // restarting anything.
    let pages = null;
    let revision = null;
    for (let round = 0; round < 50; round += 1) {
      pages = {};
      for (const route of ["/campaigns", "/replay", "/backtests", "/research"]) {
        pages[route] = await (await fetch(`${base}${route}`)).text();
      }
      revision = pages["/backtests"].match(/data-snapshot-revision="([0-9a-f]+)"/)?.[1] ?? null;
      if (revision !== null && pages["/backtests"].includes("data-hypothesis-run=")) break;
      await flush(2);
    }
    assert.ok(revision, "the snapshot was republished with the result");
    const health = await (await fetch(`${base}/health`)).json();
    assert.equal(health.semanticSnapshot.revision, revision, "/health declares the same revision");
    for (const [route, html] of Object.entries(pages)) {
      assert.equal(html.match(/data-snapshot-revision="([0-9a-f]+)"/)?.[1], revision, `${route}: shared revision`);
      // English canonical identity from the shared projection on every surface.
      assert.match(html, /data-hypothesis-id="H-S1-01"/, route);
      assert.match(html, new RegExp(H_S1_01.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), route);
      assert.match(html, new RegExp(H_S1_01.version.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), route);
      assert.match(html, /Gas Monthly/, route);
    }
    // Backtesting carries the run identity, phase and mode of the published result.
    const runId = pages["/backtests"].match(/data-hypothesis-run="(HYP-RUN-[0-9a-f]+)"/)?.[1];
    assert.ok(runId, "the published run is on Backtests");
    assert.match(pages["/backtests"], /DEVELOPMENT · TOB · comparison valid/);
  });
});
