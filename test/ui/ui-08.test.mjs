// Tests UI-08 — Backtesting workspace: Scope → Hypotheses → Results, without a
// hardcoded hypothesis or Arm A/B. Source: docs/product task revision
// 20260928-english-v4, SEM-1, FIX-07, BT-08, SEM-2. Fixtures are small; no real
// backtest, no OOS/OES opening, no live action.

import { test } from "node:test";
import assert from "node:assert/strict";

import { loadCanonicalUiInputs } from "../../src/ui/canonical-inputs.mjs";
import { buildUiViewModels, createUiServer } from "../../src/ui/server.mjs";
import { buildBacktestsViewModel } from "../../src/ui/view-models.mjs";
import { renderSurfacePage } from "../../src/ui/render.mjs";
import { BACKTEST_JOBS_PATH } from "../../src/backtest-jobs/http.mjs";
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
  // Ablation is labelled as the experimental counterpart, never CLIENT/benchmark.
  assert.match(html, /Ablation · CONTROL ↔ H-S1-01/);
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
