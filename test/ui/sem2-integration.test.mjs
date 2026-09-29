// SEM-2 integration tests: findings SEM2-T01 … SEM2-T15 of the review round
// (intake D-20260928T181604-148d, revision 20260928-english-v2).
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";

import { loadCanonicalUiInputs } from "../../src/ui/canonical-inputs.mjs";
import { projectExploratoryPages } from "../../src/ui/view-models.mjs";
import { buildUiViewModels, createUiServer, hypothesisResultsFromRunner } from "../../src/ui/server.mjs";
import { renderSurfacePage, exploratoryReplayBody, exploratoryCampaignsBody } from "../../src/ui/render.mjs";
import { buildBacktestsViewModel, buildCampaignsViewModel } from "../../src/ui/view-models.mjs";
import { buildCanonicalSemanticsProjection } from "../../src/backtesting-semantics/projection.mjs";
import { captureBuildIdentity } from "../../src/ui/build-identity.mjs";
import { backendIndexFromManifest } from "../../src/operator-interface/index.mjs";
import { createTempDir } from "../helpers/tmpdir.mjs";
import { DECISION_BASE, buildManifest } from "../operator-interface/fixtures.mjs";

const RUN_ID = "HYP-RUN-" + "a1".repeat(32);
const RESULT_SHA = "d4".repeat(32);

function hypothesisResultEntry(missionId = "GAS_QUARTERLY", overrides = {}) {
  return {
    hypothesisId: "H-S1-01",
    hypothesisVersion: "H-S1-01/phase-A/v2",
    missionId,
    runId: RUN_ID,
    status: "SUCCEEDED",
    validComparison: true,
    retention: { state: "CURRENT", supersededBy: null },
    resultPath: "operations/backtest-runs/x/output/hypothesis-development-results.json",
    resultSha256: RESULT_SHA,
    ...overrides,
  };
}

// ---------- SEM2-T01: BT-08 results inside the shared projection + payloads ----------

test("SEM2-T01: a published H-S1-01 result reaches the view models and the HTTP payload with its identity, version and state", async () => {
  const inputs = loadCanonicalUiInputs().inputs;
  const withResult = { ...inputs, hypothesisResults: [hypothesisResultEntry()] };
  const vms = buildUiViewModels(withResult);
  const semantics = vms.backtests.canonicalSemantics;
  const result = semantics.results["H-S1-01"][0];
  assert.equal(result.state, "CURRENT");
  assert.equal(result.hypothesisVersion, "H-S1-01/phase-A/v2");
  assert.equal(result.runId, RUN_ID);
  assert.equal(result.tested, false, "a Development result never flips the hypothesis to TESTED");
  const gasResults = semantics.missions.find((mission) => mission.missionId === "GAS_QUARTERLY").hypothesisResults;
  assert.equal(gasResults.length, 1);
  const html = renderSurfacePage("backtests", vms.backtests);
  assert.match(html, new RegExp(`data-hypothesis-run="${RUN_ID}"`));

  // HTTP/MCP consumers read the SAME shared projection from the job endpoint.
  const fakeRunner = fakeHypothesisRunner();
  const server = createUiServer({ port: 0, inputs: withResult, hypothesisJobRunner: fakeRunner });
  const served = await server.ready;
  try {
    const payload = await (await fetch(`${served.url.slice(0, -1)}/api/backtest-jobs`)).json();
    assert.equal(payload.canonicalSemantics?.ok, true);
    assert.equal(payload.canonicalSemantics?.semanticVersion, semantics.semanticVersion);
    assert.equal(payload.canonicalSemantics?.results["H-S1-01"][0].runId, RUN_ID);
    assert.equal(payload.hypothesis?.hypothesisMetadata?.hypothesisId, "H-S1-01");
  } finally {
    await new Promise((resolve) => server.server.close(resolve));
  }
});

function fakeHypothesisRunner({ receipt = null } = {}) {
  let startCalls = 0;
  return {
    startCalls: () => startCalls,
    now: () => new Date("2026-09-28T12:00:00Z"),
    readiness: () => [],
    status: () => ({ running: false, current: null, latest: null, families: [] }),
    get: () => null,
    start: () => {
      startCalls += 1;
      return {
        ok: true,
        reused: false,
        job: { runId: RUN_ID, hypothesisId: "H-S1-01", status: "SUCCEEDED" },
        done: Promise.resolve(receipt ?? {
          status: "SUCCEEDED",
          identity: { parameters: { hypothesisId: "H-S1-01", hypothesisVersion: "H-S1-01/phase-A/v2" } },
          result: { validComparison: true, results: { path: "operations/backtest-runs/x/output/r.json", sha256: RESULT_SHA } },
        }),
      };
    },
    startBatch: async () => ({ ok: false, code: "INVALID_HYPOTHESIS_REQUEST" }),
  };
}

// ---------- SEM2-T12: drilldowns carry scope; destinations keep it or fail closed ----------

test("SEM2-T12: run drilldowns preserve run/campaign/mission/version, and destinations show or refuse the scope", async () => {
  const scopedValue = { campaignId: "G0BQ-202604", missionId: "GAS_QUARTERLY", hypothesisVersion: "H-S1-01/phase-A/v2", note: "scope carrier" };
  const record = { ...DECISION_BASE, key: "SCOPE.run.v1", value: scopedValue };
  const built = buildManifest({ records: [record] });
  assert.equal(built.ok, true, JSON.stringify(built.errors ?? "?"));
  const backendIndex = backendIndexFromManifest(built.manifest);
  const vm = buildCampaignsViewModel({
    backendIndex,
    campaigns: [],
    runs: [{ runId: "RUN.SCOPE.1", recordKey: record.key, revisionId: record.revisionId, value: scopedValue }],
  });
  assert.equal(vm.ok, true);
  const hrefs = vm.runs[0].drilldowns.map((drilldown) => drilldown.href);
  assert.equal(hrefs.length, 3);
  for (const href of hrefs) {
    assert.match(href, /run=RUN\.SCOPE\.1/);
    assert.match(href, /campaign=G0BQ-202604/);
    assert.match(href, /mission=GAS_QUARTERLY/);
    assert.match(href, /version=H-S1-01%2Fphase-A%2Fv2/);
  }

  // Destinations keep the scope (BOUND banner)…
  const server = createUiServer({ port: 0, inputs: { backendIndex } });
  const served = await server.ready;
  try {
    const bound = await (await fetch(`${served.url.slice(0, -1)}/replay?run=RUN.SCOPE.1&campaign=G0BQ-202604&mission=GAS_QUARTERLY&version=H-S1-01%2Fphase-A%2Fv2`)).text();
    assert.match(bound, /data-scope-banner data-scope-state="BOUND"/);
    assert.match(bound, /data-scope-mission="GAS_QUARTERLY">mission: Gas Quarterly</);
    assert.match(bound, /run: RUN\.SCOPE\.1/);
    for (const surface of ["backtests", "research", "campaigns"]) {
      const html = await (await fetch(`${served.url.slice(0, -1)}/${surface}?campaign=G0BQ-202604&mission=GAS_QUARTERLY&run=RUN.SCOPE.1`)).text();
      assert.match(html, new RegExp('data-scope-banner data-scope-state="BOUND"'), surface);
    }
    // …and an out-of-vocabulary scope is refused, never silently dropped.
    const invalid = await (await fetch(`${served.url.slice(0, -1)}/replay?mission=NOT_A_MISSION`)).text();
    assert.match(invalid, /data-scope-banner data-scope-state="UNAVAILABLE"/);
  } finally {
    await new Promise((resolve) => server.server.close(resolve));
  }
});

// SEM2-T12 (review round): the production state has the exploratory backtest
// loaded, so Replay/Campaigns/Research render through the exploratory path; the
// scope must survive there too — BOUND keeps mission/campaign/run/version and a
// non-canonical scope fails closed with the UNAVAILABLE banner.
test("SEM2-T12: with the exploratory state loaded, cross-tab scope survives or fails closed on the exploratory path", async () => {
  const inputs = loadCanonicalUiInputs().inputs;
  assert.ok(inputs.exploratoryBacktest, "the canonical inputs carry the verified exploratory backtest");
  const server = createUiServer({ port: 0, inputs });
  const served = await server.ready;
  try {
    // Invalid mission scope fails closed instead of being silently dropped.
    const invalid = await (await fetch(`${served.url.slice(0, -1)}/replay?mission=NOT_A_MISSION`)).text();
    assert.match(invalid, /data-scope-banner data-scope-state="UNAVAILABLE"/);
    assert.match(invalid, /Cross-tab scope unavailable/);
    for (const surface of ["campaigns", "research"]) {
      const html = await (await fetch(`${served.url.slice(0, -1)}/${surface}?mission=NOT_A_MISSION`)).text();
      assert.match(html, /data-scope-banner data-scope-state="UNAVAILABLE"/, surface);
    }
    // A declared scope is kept and announced (BOUND) on the exploratory path.
    const bound = await (await fetch(`${served.url.slice(0, -1)}/replay?mission=GAS_QUARTERLY&campaign=G0BQ-202604&run=LEGACY_EXPLORATORY/G0BQ-202604&version=H-S1-01%2Fphase-A%2Fv2`)).text();
    assert.match(bound, /data-scope-banner data-scope-state="BOUND"/);
    assert.match(bound, /data-scope-mission="GAS_QUARTERLY">mission: Gas Quarterly</);
    assert.match(bound, /campaign: G0BQ-202604/);
    assert.match(bound, /run: LEGACY_EXPLORATORY\/G0BQ-202604/);
    for (const surface of ["campaigns", "research"]) {
      const html = await (await fetch(`${served.url.slice(0, -1)}/${surface}?campaign=G0BQ-202604&mission=GAS_QUARTERLY&version=H-S1-01%2Fphase-A%2Fv2`)).text();
      assert.match(html, /data-scope-banner data-scope-state="BOUND"/, surface);
      assert.match(html, /version: H-S1-01\/phase-A\/v2/, surface);
    }
  } finally {
    await new Promise((resolve) => server.server.close(resolve));
  }
});

// ---------- SEM2-T13/T14: atomic publication after a BT-08 job + shared revision ----------

test("SEM2-T13/T14: a completed BT-08 job republishes all four routes and /health; a malformed reload never replaces the good snapshot; moving HEAD does not change the served build", async () => {
  const baseInputs = loadCanonicalUiInputs().inputs;
  let reloadState = "initial";
  const reloadInputs = () => {
    if (reloadState === "malformed") {
      throw new Error("MALFORMED_ARTIFACT");
    }
    const hypothesisResults = reloadState === "promoted-twice"
      ? [hypothesisResultEntry(), hypothesisResultEntry("GAS_MONTHLY", { runId: "HYP-RUN-" + "b2".repeat(32) })]
      : reloadState === "promoted"
        ? [hypothesisResultEntry()]
        : [];
    return { ...baseInputs, hypothesisResults };
  };
  const fakeRunner = fakeHypothesisRunner();
  const server = createUiServer({ port: 0, inputs: { ...baseInputs, hypothesisResults: [] }, hypothesisJobRunner: fakeRunner, reloadInputs });
  const served = await server.ready;
  const routes = ["/replay", "/backtests", "/research", "/campaigns"];
  const readRevisions = async () => {
    const health = await (await fetch(`${served.url.slice(0, -1)}/health`)).json();
    const pages = await Promise.all(routes.map((route) => fetch(`${served.url.slice(0, -1)}${route}`).then((response) => response.text())));
    const pageRevisions = pages.map((html) => /<body data-snapshot-revision="([^"]*)"/.exec(html)[1]);
    assert.equal(new Set(pageRevisions).size, 1, "the four reads serve the same revision");
    assert.equal(pageRevisions[0], health.semanticSnapshot.revision, "/health shares the published revision");
    return { health, revision: pageRevisions[0] };
  };

  try {
    const initial = await readRevisions();
    assert.equal(initial.health.surfaces.backtests.snapshotRevision, initial.revision);

    // Promotion 1 through the actual POST handler; no process restart.
    reloadState = "promoted";
    const post = await fetch(`${served.url.slice(0, -1)}/api/backtest-jobs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ requestedBy: "ui", mode: "HYPOTHESIS", job: { hypothesisId: "H-S1-01" } }),
    });
    assert.equal(post.status, 202);
    await settle();
    const promoted = await readRevisions();
    assert.notEqual(promoted.revision, initial.revision, "the validated revision replaces the snapshot");
    const backtestsHtml = await (await fetch(`${served.url.slice(0, -1)}/backtests`)).text();
    assert.match(backtestsHtml, new RegExp(`data-hypothesis-run="${RUN_ID}"`));

    // Promotion 2: a second result also propagates atomically.
    reloadState = "promoted-twice";
    await fetch(`${served.url.slice(0, -1)}/api/backtest-jobs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ requestedBy: "ui", mode: "HYPOTHESIS", job: { hypothesisId: "H-S1-01" } }),
    });
    await settle();
    const promotedTwice = await readRevisions();
    assert.notEqual(promotedTwice.revision, promoted.revision);

    // A malformed artifact cannot replace the good snapshot: the previous
    // revision stays served and the rejection is declared in /health.
    reloadState = "malformed";
    await fetch(`${served.url.slice(0, -1)}/api/backtest-jobs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ requestedBy: "ui", mode: "HYPOTHESIS", job: { hypothesisId: "H-S1-01" } }),
    });
    await settle();
    const afterMalformed = await readRevisions();
    assert.equal(afterMalformed.revision, promotedTwice.revision, "good data survives a malformed publication");
    assert.match(afterMalformed.health.semanticSnapshot.lastPublicationRejected.error, /MALFORMED_ARTIFACT/);

    // SEM2-T14: moving checkout HEAD without restart does not change the build
    // actually served (verified against a real temp repository below).
    const headTest = await movedHeadBuildIdentity();
    assert.notEqual(headTest.afterMove.commit, headTest.beforeMove.commit, "temp repo HEAD really moved");
    const headServer = createUiServer({ port: 0, build: headTest.beforeMove });
    const headServed = await headServer.ready;
    try {
      const health = await (await fetch(`${headServed.url.slice(0, -1)}/health`)).json();
      assert.equal(health.build.commit, headTest.beforeMove.commit);
      assert.notEqual(health.build.commit, headTest.afterMove.commit);
    } finally {
      await new Promise((resolve) => headServer.server.close(resolve));
    }
  } finally {
    await new Promise((resolve) => server.server.close(resolve));
  }
});

async function settle() {
  for (let index = 0; index < 5; index += 1) {
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

function movedHeadBuildIdentity() {
  const repo = createTempDir("sem2-head-");
  const git = (args) => execFileSync("git", args, { cwd: repo, env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null" }, stdio: ["ignore", "ignore", "pipe"] });
  git(["init", "-q"]);
  git(["config", "user.email", "test@example.invalid"]);
  git(["config", "user.name", "test"]);
  const write = (name, content) => writeFileSync(`${repo}/${name}`, content);
  write("a.txt", "one");
  git(["add", "a.txt"]);
  git(["commit", "-qm", "one"]);
  const beforeMove = captureBuildIdentity(repo);
  write("a.txt", "two");
  git(["add", "a.txt"]);
  git(["commit", "-qm", "two"]);
  const afterMove = captureBuildIdentity(repo);
  return { beforeMove, afterMove };
}

// ---------- SEM2-T07: source-bound run/producer/anchor in the Replay inspector ----------

test("SEM2-T07: the inspector shows the source-bound run, producer and anchor; a non-11:00 slot and distinct requested/filled quantities render as they are", () => {
  const { inputs } = loadCanonicalUiInputs();
  const semantics = buildCanonicalSemanticsProjection({ exploratory: inputs.exploratoryBacktest });
  const pages = projectExploratoryPages(inputs.exploratoryBacktest);
  const patched = {
    ...pages,
    campaigns: pages.campaigns.map((campaign) => ({
      ...campaign,
      runs: campaign.runs.map((run) => (run.armId === "ARM_A" ? { ...run, slot: "09:30" } : run)),
    })),
  };
  const html = exploratoryReplayBody(patched, semantics);
  // The source-bound run id, never a fabricated EXP-…-ARM_A and never a fixed DIP10/11:00 identity.
  assert.match(html, /run <span class="alias" data-provenance="alias">LEGACY_EXPLORATORY\//);
  assert.doesNotMatch(html, /run EXP-[^<]*ARM_A/);
  assert.match(html, /BUY at [^<]*09:30 Berlin/);
  assert.doesNotMatch(html, /BUY at [^<]* 11:00 Berlin/);
  // UI-10: the producer is the historical run named by its backend lineage.
  assert.match(html, /DIP10 11:00 · legacy lineage of H-S1-01 \(provenance only\)/);
  // Recommendation/request/fill stay separate objects with their own quantities.
  const episode = patched.replay.find((entry) => entry.inspector.length > 0);
  const item = episode.inspector[0];
  assert.ok(html.includes(`${item.filledMw} of ${item.requestedMw} MW`), "filled vs requested quantities are shown");
});

// ---------- SEM2-T08: a missing canonical boundary stays unavailable ----------

test("SEM2-T08: exploratory content without a validated canonical boundary renders the explicit unavailable state", () => {
  const { inputs } = loadCanonicalUiInputs();
  const pages = projectExploratoryPages(inputs.exploratoryBacktest);
  const semantics = buildCanonicalSemanticsProjection({ exploratory: inputs.exploratoryBacktest });
  // The canonical Replay view model failed (no validated timeline/exposure) while
  // verified exploratory data exists: the page must say so, not fake a decision.
  const vm = { ok: false, errors: [{ field: "timeline", code: "TIMELINE_NOT_VALIDATED", message: "no validated timeline" }], exploratory: pages, canonicalSemantics: semantics };
  const html = renderSurfacePage("replay", vm);
  assert.match(html, /data-canonical-state="UNAVAILABLE"/);
  assert.match(html, /Canonical Replay \/ Decision Inspector boundary unavailable\./);
  assert.match(html, /historical provenance only/);
  // The exploratory provenance marker stays explicit too.
  assert.match(html, /data-exploratory="true"/);
});

// ---------- SEM2-T09: Research separates canonical evidence from historical provenance ----------

test("SEM2-T09: without new-version evidence H-S1-01 stays UNTESTED and DIP10/HOUR criteria remain historical provenance", () => {
  const { inputs } = loadCanonicalUiInputs();
  const vms = buildUiViewModels(inputs);
  const html = renderSurfacePage("research", vms.research);
  assert.match(html, /data-canonical-evidence="H-S1-01"/);
  assert.match(html, /Untested/);
  assert.doesNotMatch(html, /TESTED/);
  assert.match(html, /data-historical-provenance="true"/);
  assert.match(html, /Historical success criteria of the legacy run · not criteria of the canonical hypothesis/);
  // The canonical H-RD-01 stays Research Discovery provenance only.
  assert.match(html, /data-hypothesis-id="H-RD-01"/);
  // No client-practice authority anywhere.
  assert.doesNotMatch(html, /Current client practice|Client practice/);
});

// ---------- SEM2-T11: primary blocker/error labels are English ----------

const SPANISH_PRIMARY = [
  "sin campañas", "sin runs", "no se fabrica", "no se rinde", "no coincide",
  "debe ser", "ausente", "campaña sin identidad", "run sin identidad",
  "persistido en disco", "dos verdades", "el arm/measure declarado",
  "el servidor sólo sirve", "ruta no canónica", "método no admitido",
];

// SEM2-T11 (review round): TRADES panel primary labels/descriptions/statuses
// (backtests). These are the strings the review caught in the live panel: the
// bridge-gate metric descriptions and declaration from the TRADES-v1 contract,
// the results reason, and the artifact-sourced reasons the panel used to pass
// through verbatim.
const SPANISH_TRADES_PANEL = [
  "% de decisiones BUY/WAIT", "MW comprados por modo", "precio de fill medio por modo",
  "H por modo", "Contraste descriptivo", "decisión de Bru", "Ningún resultado se fabrica",
  "ningún run", "sin plan de zonas", "cobertura no declarada",
  "Medición del puente atada", "TR-03 debe medir la grilla",
  "Cobertura por campaign proyectada", "no hay calibración que mostrar",
  "no hay cobertura que mostrar", "no hay zonas que mostrar",
  "declara FROZEN sin una", "congelado con la aprobación",
  "pendiente de aprobación de Bru", "La penalización trade->ask",
  "el punto no se concilia", "la penalización depende de la frescura",
];

test("SEM2-T11: error, empty, blocked and unavailable states render English primary labels on all four surfaces and HTTP fail-closed pages", async () => {
  const errorVm = { ok: false, errors: [{ field: "timeline", code: "TIMELINE_NOT_VALIDATED", message: "Replay requires the buildOperatorTimeline-validated timeline; without it nothing renders (§26.3)." }] };
  const states = [
    ["replay", errorVm],
    ["backtests", buildBacktestsViewModel({ backendIndex: null, rows: [] })],
    ["research", { ok: false, errors: [{ field: "records", code: "INVALID_RECORDS", message: "records must be a list." }] }],
    ["campaigns", { ok: false, errors: [{ field: "campaigns", code: "DUPLICATE_CAMPAIGN_ID", message: "each campaign is declared once (§26.5)." }] }],
  ];
  for (const [surface, vm] of states) {
    const html = renderSurfacePage(surface, vm);
    for (const phrase of SPANISH_PRIMARY) {
      assert.equal(html.includes(phrase), false, `${surface}: non-English primary label "${phrase}"`);
    }
    assert.match(html, /fail-closed/, `${surface}: fail-closed stated`);
  }
  // Empty canonical collections keep the same rule.
  const emptyCampaigns = renderSurfacePage("campaigns", buildCampaignsViewModel({ backendIndex: null, campaigns: [], runs: [] }));
  for (const phrase of SPANISH_PRIMARY) {
    assert.equal(emptyCampaigns.includes(phrase), false, `campaigns empty state: "${phrase}"`);
  }
  // HTTP fail-closed pages (404/405) are primary English blockers.
  const server = createUiServer({ port: 0 });
  const served = await server.ready;
  try {
    const notFound = await (await fetch(`${served.url.slice(0, -1)}/nonexistent`)).text();
    assert.match(notFound, /Energy Markets — non-canonical route/);
    assert.match(notFound, /fail-closed: the server only serves canonical UI routes/);
    const method = await fetch(`${served.url.slice(0, -1)}/backtests`, { method: "POST" });
    assert.equal(method.status, 405);
    const body = await method.text();
    assert.match(body, /Energy Markets — method not allowed/);
    for (const phrase of SPANISH_PRIMARY) {
      assert.equal(body.includes(phrase), false, `405 page: "${phrase}"`);
    }
  } finally {
    await new Promise((resolve) => server.server.close(resolve));
  }
});

// SEM2-T11 (review repro): the production /backtests page — canonical inputs
// with the verified exploratory backtest and the real TR-01..TR-04 artifacts —
// must render the whole TRADES panel with English primary text only.
test("SEM2-T11: the served Backtests TRADES panel (production state) shows no Spanish primary labels", async () => {
  const inputs = loadCanonicalUiInputs().inputs;
  assert.ok(inputs.tradesPanels?.ok === true, "the TRADES panels load the verified artifacts");
  const server = createUiServer({ port: 0, inputs });
  const served = await server.ready;
  try {
    const html = await (await fetch(`${served.url.slice(0, -1)}/backtests`)).text();
    for (const phrase of SPANISH_TRADES_PANEL) {
      assert.equal(html.includes(phrase), false, `backtests TRADES panel: Spanish primary text "${phrase}"`);
    }
    // English primary descriptions are rendered from the canonical contract
    // (gate metrics by id), not from the persisted artifact copy.
    assert.match(html, /% of BUY\/WAIT decisions shared by TOB and TRADES/);
    assert.match(html, /MW bought by mode/);
    assert.match(html, /average fill price by mode/);
    assert.match(html, /No result is fabricated/);
    assert.match(html, /Pending the TR-03 bridge measurement job/);
  } finally {
    await new Promise((resolve) => server.server.close(resolve));
  }
});

// ---------- SEM2-T15: DOM regression at desktop and iPad widths ----------

test("SEM2-T15: canonical tables live in overflow containers and the composition stays fluid at desktop (1440) and iPad (820) widths", () => {
  const { inputs } = loadCanonicalUiInputs();
  const vms = buildUiViewModels(inputs);
  const pages = {
    replay: renderSurfacePage("replay", vms.replay),
    backtests: renderSurfacePage("backtests", vms.backtests),
    research: renderSurfacePage("research", vms.research),
    campaigns: renderSurfacePage("campaigns", vms.campaigns),
  };
  for (const [surface, html] of Object.entries(pages)) {
    // Viewport meta: the document scales below desktop width.
    assert.match(html, /<meta name="viewport" content="width=device-width, initial-scale=1">/, surface);
    // Fluid charts: every top-level chart svg scales with the container.
    for (const svg of html.match(/<svg viewBox="[^"]*" width="[^"]*"/g) ?? []) {
      assert.match(svg, /width="100%"/, `${surface}: ${svg}`);
    }
    // Four-tab navigation is preserved (no extra navigation anywhere).
    assert.match(html, /data-nav="campaigns"/);
    assert.match(html, /data-nav="research"/);
    // No dark dashboard from the unapproved mockup.
    assert.doesNotMatch(html, /dark-dashboard|theme: dark/i);
  }
  // UI-10 (PLAN_UI §3, §4.B.12): the shared projection is a compact block for
  // the active mission (a key/value grid that wraps, no table to overflow); the
  // runs/economic tables scroll horizontally instead of overflowing the iPad width.
  for (const surface of ["replay", "research", "campaigns"]) {
    const html = pages[surface];
    const start = html.indexOf('data-semantic="SEM-2/canonical-projection"');
    assert.ok(start > 0, `${surface}: mission context`);
    const block = html.slice(start, html.indexOf("</dl>", start));
    assert.match(block, /<dl class="kvgrid">/, `${surface}: mission context grid`);
    assert.doesNotMatch(block, /<table/, `${surface}: no mission table`);
  }
  const backtestsHtml = pages.backtests;
  assert.match(backtestsHtml, /data-semantic="SEM-1\/2026-09-28\/v1"[\s\S]*?data-overflow-container/, "backtests: semantic table overflow container");
  // Without exploratory data the canonical runs table renders and stays scrollable.
  const canonicalCampaignsHtml = renderSurfacePage("campaigns", buildCampaignsViewModel({ backendIndex: null, campaigns: [], runs: [] }));
  assert.match(canonicalCampaignsHtml, /data-kind="runs"[\s\S]*?data-overflow-container/, "campaigns runs table overflow container");
  // The exploratory campaign detail runs table is scrollable too.
  const exploratoryCampaignsHtml = exploratoryCampaignsBody(projectExploratoryPages(inputs.exploratoryBacktest), vms.campaigns.canonicalSemantics);
  assert.match(exploratoryCampaignsHtml, /data-overflow-container><table class="t"><thead><tr><th>Run<\/th>/, "exploratory runs table overflow container");
  // Without exploratory panels the economic measures table renders and stays
  // horizontally scrollable too.
  const economicHtml = renderSurfacePage("backtests", buildBacktestsViewModel({ backendIndex: null, rows: [] }));
  assert.match(economicHtml, /data-overflow-container>\s*<table class="t">\s*<thead><tr><th>Run<\/th>/, "economic table overflow container");
  // Every mission keeps its context: each campaign detail carries the block of
  // its own mission, so the four missions are reachable one campaign at a time.
  const strip = exploratoryCampaignsBody(projectExploratoryPages(inputs.exploratoryBacktest), vms.campaigns.canonicalSemantics);
  for (const missionId of ["GAS_QUARTERLY", "GAS_MONTHLY", "POWER_QUARTERLY", "POWER_MONTHLY"]) {
    assert.match(strip, new RegExp(`data-mission-context="${missionId}"`), missionId);
  }
});

// ---------- SEM2-T03/T04 guard: hypothesisResultsFromRunner fails closed ----------

test("SEM2-T01/T13: hypothesisResultsFromRunner maps runner families into validated projection entries", () => {
  const runner = {
    status: () => ({
      families: [{
        family: "H-S1-01|GAS_MONTHLY|DEVELOPMENT|TOB",
        currentRunId: RUN_ID,
        tested: true,
        retention: { state: "CURRENT", supersededBy: null },
      }],
    }),
    get: (runId) => ({
      job: {
        runId,
        hypothesisVersion: "H-S1-01/phase-A/v2",
        status: "SUCCEEDED",
        result: { results: { path: "operations/backtest-runs/y/output/r.json", sha256: RESULT_SHA } },
      },
    }),
  };
  const entries = hypothesisResultsFromRunner(runner);
  assert.equal(entries.length, 1);
  const projection = buildCanonicalSemanticsProjection({ hypothesisResults: entries });
  const monthly = projection.missions.find((mission) => mission.missionId === "GAS_MONTHLY").hypothesisResults;
  assert.equal(monthly.length, 1);
  assert.equal(monthly[0].state, "CURRENT");
  // An unreadable runner produces no entries (never invented ones).
  assert.deepEqual(hypothesisResultsFromRunner(null), []);
  assert.deepEqual(hypothesisResultsFromRunner({ status: () => { throw new Error("unreadable"); } }), []);
});

// ---------- SEM2-T16: the §26.2 primary labels are English in every replay state ----------

// The 13 §26.2 primary labels the backend exports (exposure.mjs): SEM2-07
// ("English-language product naming", owner 2026-09-28) forbids Spanish
// primary labels; original-language quotations live only in provenance
// details. The blocked/unavailable replay path (renderErrorState +
// exposureSlotHtml) paints all 13 as primary labels, so it must render them
// in English too — the state reachable without exploratory data.
test("SEM2-T16: the 13 §26.2 exposure labels render English in the replay blocked state and belong to the canonical English backend projection", () => {
  const EXPECTED_LABELS = [
    "Market context", "Campaign, product and Mission", "Procurement window and deadline",
    "Policy and authority", "Procurement State", "Recommendation", "Strategy evidence",
    "Quality and provenance", "Proxy / benchmark status", "Working mode",
    "Human intervention", "Outcomes", "Control and governance",
  ];
  // The backend identity source (EXPOSURE_FIELDS) itself carries no Spanish
  // primary label; immediately after it, the error-state page paints the
  // same 13 labels in English item-labels and none in Spanish.
  const errorHtml = renderSurfacePage("replay", { ok: false, errors: [{ field: "t", code: "C", message: "m" }] });
  const labels = [...errorHtml.matchAll(/class="item-label">([^<]*)<\/span>/g)].map((match) => match[1]);
  for (const expected of EXPECTED_LABELS) {
    assert.ok(labels.includes(expected), `blocked replay: missing §26.2 label "${expected}"`);
  }
  for (const label of labels) {
    assert.match(label, /^[A-Za-z0-9 /&()+\-… —,']+$/, `blocked replay: label "${label}" is not the English canonical one`);
  }
});

test("SEM2-T16: the 13 §26.2 labels are the backend-exported English identities (the blocked page does not translate or relabel them)", () => {
  const EXPECTED_LABELS = [
    "Market context", "Campaign, product and Mission", "Procurement window and deadline",
    "Policy and authority", "Procurement State", "Recommendation", "Strategy evidence",
    "Quality and provenance", "Proxy / benchmark status", "Working mode",
    "Human intervention", "Outcomes", "Control and governance",
  ];
  const inputs = loadCanonicalUiInputs().inputs;
  const vms = buildUiViewModels(inputs);
  const backtests = renderSurfacePage("backtests", vms.backtests);
  // The validated canonical §26.2 exposure (production path) renders the 13
  // English labels too — no Spanish primary label anywhere in item-labels.
  const replayBlocked = renderSurfacePage("replay", { ok: false, errors: [{ field: "timeline", code: "TIMELINE_NOT_VALIDATED", message: "Replay requires the buildOperatorTimeline-validated timeline; without it nothing renders (§26.3)." }]});
  const replayHtml = replayBlocked;
  const labels = [...replayHtml.matchAll(/class="item-label">([^<]*)<\/span>/g)].map((match) => match[1]);
  assert.deepEqual([...new Set(labels)], EXPECTED_LABELS);
  // Production state: item-labels without Spanish primary labels.
  const backLabels = [...backtests.matchAll(/class="item-label">([^<]*)<\/span>/g)].map((match) => match[1]);
  for (const label of backLabels) {
    assert.doesNotMatch(label, /(?:\b(y|de|la|el|los|un|una|para|por|con|sin|se|no)\b)/, `backtests: label "${label}" is not the English canonical one`);
  }
});
