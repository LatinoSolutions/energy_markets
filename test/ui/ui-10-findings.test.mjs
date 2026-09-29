// UI-10 review round (oa1, 2026-09-29, verdict CAMBIOS): one block per finding.
// UI10-VIS-01 (type floor 14 px), UI10-VIS-02 (mission context), UI10-STATUS-01
// (no raw enums), UI10-BLOCK-01 (paths only in the collapsed detail),
// UI10-CONTRACT-01 (preflight userMessage + path), UI10-ACTION-01 (button names
// the mission). Sources: PLAN_UI.md §1, §3, §4.A.3, §4.B.8/11/12, §4.D.20
// (intake D-20260929T103404-2ec5); OFICINA.md "Energy Markets product language".
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { loadCanonicalUiInputs } from "../../src/ui/canonical-inputs.mjs";
import { buildUiViewModels, createUiServer } from "../../src/ui/server.mjs";
import { renderSurfacePage } from "../../src/ui/render.mjs";
import { renderBacktestJobControl } from "../../src/ui/backtest-job-panel.mjs";
import { UI_STYLESHEET } from "../../src/ui/visual-language.mjs";
import { legacyTextFindings, visibleSegments } from "../../src/ui/primary-text.mjs";
import { TRADES_PANEL_LABELS, tradesLabel, tradesZoneLabel, projectTradesPanels, loadTradesPanelsAt } from "../../src/ui/trades-panels.mjs";
import { DEFAULT_REPO_ROOT } from "../../src/pit-views/index.mjs";
import { MISSION_LABELS } from "../../src/backtesting-semantics/contract.mjs";
import { createHypothesisJobRunner, hypothesisMetadata } from "../../src/backtest-jobs/hypothesis-runner.mjs";
import { makeHypothesisFixtureRepo } from "../backtest-jobs/hypothesis-fixture-repo.mjs";

const canonical = loadCanonicalUiInputs();
const vms = buildUiViewModels(canonical.inputs);
const MISSIONS = Object.keys(MISSION_LABELS);

async function withServer(options, run) {
  const { server, ready } = createUiServer({ port: 0, inputs: canonical.inputs, backend: canonical.backend, ...options });
  const { url } = await ready;
  try {
    await run(url);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

// Every served route and Backtests mode the reviewer asked to inspect.
const SERVED_PATHS = [
  "/campaigns", "/replay", "/backtests", "/research",
  ...MISSIONS.map((missionId) => `/research?mission=${missionId}`),
  ...["TOB", "TRADES", "HYPOTHESIS"].flatMap((mode) => MISSIONS.flatMap((missionId) => ["", "DEVELOPMENT", "OOS_HISTORICO", "PUENTE"]
    .map((period) => `/backtests?mode=${mode}&mission=${missionId}${period ? `&period=${period}` : ""}`))),
];

async function servedPages(paths, options = {}) {
  const pages = {};
  await withServer(options, async (url) => {
    for (const route of paths) {
      const response = await fetch(new URL(route.slice(1), url));
      assert.equal(response.status, 200, route);
      pages[route] = await response.text();
    }
  });
  return pages;
}

// ---------- UI10-VIS-01 · 14 px floor ----------

function cssRules(css) {
  return [...css.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, selector, body]) => ({
    selectors: selector.split(",").map((entry) => entry.trim().replace(/\s+/g, " ")),
    body,
  }));
}

// A declared font size under the floor: px under 14 or any relative size.
function smallFontSize(body) {
  for (const [, value] of body.matchAll(/font(?:-size)?\s*:\s*([^;]+)/g)) {
    const bare = value.replace(/var\([^)]*\)/g, "").replace(/\/\s*[\d.]+(px)?/, "");
    const px = bare.match(/(\d+(?:\.\d+)?)px/);
    if (px && Number(px[1]) < 14) return value.trim();
    if (/\d*\.?\d+(em|rem|%)\b|\bsmaller\b|\bx-small\b|\bxx-small\b/.test(bare)) return value.trim();
  }
  return null;
}

test("UI10-VIS-01: every base rule under 14 px is restated at ≥ 14 px by the UI-10 layer", () => {
  const layerStart = UI_STYLESHEET.lastIndexOf(":root {");
  const base = cssRules(UI_STYLESHEET.slice(0, layerStart));
  const layer = cssRules(UI_STYLESHEET.slice(layerStart));
  for (const rule of layer) {
    assert.equal(smallFontSize(rule.body), null, `layer ${rule.selectors.join(", ")}`);
  }
  const floored = new Set(layer.filter((rule) => /font(?:-size)?\s*:/.test(rule.body)).flatMap((rule) => rule.selectors));
  const missing = base.filter((rule) => smallFontSize(rule.body) !== null)
    .flatMap((rule) => rule.selectors)
    .filter((selector) => !floored.has(selector));
  assert.deepEqual(missing, []);
  assert.match(UI_STYLESHEET.slice(layerStart), /svg text \{ font-size: 16px; \}/);
});

test("UI10-VIS-01: served pages carry no inline, embedded or SVG font size under 14 px", async () => {
  const pages = await servedPages(["/campaigns", "/replay", "/backtests", "/research", "/backtests?mode=TRADES&mission=GAS_QUARTERLY&period=PUENTE", "/backtests?mode=HYPOTHESIS&mission=GAS_QUARTERLY"]);
  for (const [route, html] of Object.entries(pages)) {
    const embedded = [...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/g)].slice(1).map((match) => match[1]).join("\n");
    for (const rule of cssRules(embedded)) {
      assert.equal(smallFontSize(rule.body), null, `${route}: <style> ${rule.selectors.join(", ")}`);
    }
    for (const [, style] of html.matchAll(/\bstyle="([^"]*)"/g)) {
      assert.equal(smallFontSize(style), null, `${route}: style="${style}"`);
    }
    for (const [, size] of html.matchAll(/\bfont-size="([\d.]+)"/g)) {
      assert.ok(Number(size) >= 14, `${route}: SVG font-size="${size}"`);
    }
  }
  // Negative case: the checker catches the 10.5 px inline style of the review.
  assert.equal(smallFontSize("font-size:10.5px;line-height:15px"), "10.5px");
  assert.equal(smallFontSize("font: 600 13px var(--mono)"), "600 13px var(--mono)");
  assert.equal(smallFontSize("font-size: .85em"), ".85em");
});

// Computed size in a real browser (PLAN_UI §4.D.20). Runs where a headless
// Chromium exists (CHROME_BIN or the Playwright cache on BruNode).
function headlessChromium() {
  if (process.env.CHROME_BIN && existsSync(process.env.CHROME_BIN)) return process.env.CHROME_BIN;
  const cache = path.join(os.homedir(), ".cache", "ms-playwright");
  if (!existsSync(cache)) return null;
  const shells = readdirSync(cache).filter((entry) => entry.startsWith("chromium_headless_shell-")).sort().reverse();
  for (const shell of shells) {
    const binary = path.join(cache, shell, "chrome-headless-shell-linux64", "chrome-headless-shell");
    if (existsSync(binary)) return binary;
  }
  return null;
}

// Reports every text-bearing element (and ::before/::after content, form
// controls and SVG text scaled by its viewBox) rendered under 14 px.
const COMPUTED_PROBE = `<script>window.addEventListener("load", function () { setTimeout(function () {
  document.querySelectorAll("details").forEach(function (d) { d.open = true; });
  var out = [];
  document.querySelectorAll("body *").forEach(function (el) {
    if (el.closest("script,style,template")) return;
    ["::before", "::after"].forEach(function (p) {
      var ps = getComputedStyle(el, p), c = ps.content;
      if (c && c !== "none" && c !== "normal" && c !== '""' && parseFloat(ps.fontSize) < 14) out.push(el.tagName + p + " " + ps.fontSize);
    });
    var text = Array.from(el.childNodes).some(function (n) { return n.nodeType === 3 && n.textContent.trim() !== ""; });
    if (!text && !/^(INPUT|SELECT|TEXTAREA|BUTTON)$/.test(el.tagName)) return;
    var size = parseFloat(getComputedStyle(el).fontSize);
    if (el instanceof SVGElement && el.getScreenCTM && el.getScreenCTM()) { var m = el.getScreenCTM(); size = size * Math.sqrt(m.a * m.a + m.b * m.b); }
    if (size < 13.95) out.push(el.tagName + "." + (el.getAttribute("class") || "") + " " + size.toFixed(1) + "px: " + el.textContent.trim().slice(0, 40));
  });
  var pre = document.createElement("pre"); pre.id = "ui10-type-report"; pre.textContent = JSON.stringify(out); document.body.appendChild(pre);
}, 50); });</script>`;

test("UI10-VIS-01: computed text size is ≥ 14 px on the four routes at 1440 and 1024 px (headless Chromium)", async (t) => {
  const chromium = headlessChromium();
  if (chromium === null) {
    t.skip("no headless Chromium on this machine (set CHROME_BIN); the static floor tests above still apply");
    return;
  }
  const pages = await servedPages(["/campaigns", "/replay", "/backtests", "/research", "/backtests?mode=TRADES&mission=GAS_QUARTERLY&period=PUENTE", "/backtests?mode=HYPOTHESIS&mission=POWER_MONTHLY"]);
  const dir = mkdtempSync(path.join(os.tmpdir(), "ui10-type-"));
  try {
    for (const width of [1440, 1024]) {
      for (const [route, html] of Object.entries(pages)) {
        const file = path.join(dir, `${route.replace(/[^a-z0-9]+/gi, "_")}.html`);
        writeFileSync(file, html.replace("</body>", `${COMPUTED_PROBE}</body>`));
        const dom = execFileSync(chromium, ["--headless", "--no-sandbox", "--disable-gpu", `--window-size=${width},2200`, "--virtual-time-budget=2000", "--dump-dom", `file://${file}`], { maxBuffer: 1 << 28, stdio: ["ignore", "pipe", "ignore"], timeout: 120_000 }).toString();
        const report = dom.match(/<pre id="ui10-type-report">([\s\S]*?)<\/pre>/)?.[1];
        assert.ok(report !== undefined, `${route} @${width}: probe did not run`);
        const decoded = report.replaceAll("&quot;", '"').replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&amp;", "&");
        assert.deepEqual(JSON.parse(decoded), [], `${route} @${width}`);
      }
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------- UI10-VIS-02 · contextual mission projection ----------

function contextsOf(html) {
  return [...html.matchAll(/data-mission-context="([A-Z_]+)"/g)].map((match) => match[1]);
}

test("UI10-VIS-02: Research shows the selected mission only, never a four-mission table", () => {
  for (const missionId of MISSIONS) {
    const html = renderSurfacePage("research", vms.research, { missionId });
    assert.deepEqual(contextsOf(html), [missionId], missionId);
    const start = html.indexOf(`data-mission-context="${missionId}"`);
    assert.match(html.slice(start, start + 400), new RegExp(`<h3>${MISSION_LABELS[missionId]}</h3>`));
    assert.doesNotMatch(html, /<tr data-mission="/, missionId);
    assert.match(html, new RegExp(`<b aria-current="true">${MISSION_LABELS[missionId]}</b>`));
  }
  // Without a selection the first backend mission is the context (fail-closed:
  // one mission, never all four).
  assert.deepEqual(contextsOf(renderSurfacePage("research", vms.research)), [vms.research.canonicalSemantics.missions[0].missionId]);
});

test("UI10-VIS-02: each campaign and each Replay decision carries only its own mission context", () => {
  const semantics = vms.campaigns.canonicalSemantics;
  const missionOf = (product) => semantics.missions.find((mission) => mission.product === product).missionId;
  const campaigns = renderSurfacePage("campaigns", vms.campaigns);
  assert.doesNotMatch(campaigns, /<tr data-mission="/);
  for (const section of campaigns.split('<section class="xsel').slice(1)) {
    const product = section.match(/data-campaign="[^"]*"[\s\S]*?· (?:THE|DE) (G0BQ|G0BM|DEBQ|DEBM) ·/)?.[1];
    assert.ok(product, "campaign product");
    assert.deepEqual(contextsOf(section.split("</section>")[0]), [missionOf(product)]);
  }
  const replay = renderSurfacePage("replay", vms.replay);
  assert.doesNotMatch(replay, /<tr data-mission="/);
  for (const section of replay.split('<section class="xsel').slice(1)) {
    const product = section.match(/data-decision="(G0BQ|G0BM|DEBQ|DEBM)-/)?.[1];
    assert.deepEqual(contextsOf(section.split("</section>")[0]), [missionOf(product)]);
  }
});

// ---------- UI10-STATUS-01 · readable English statuses ----------

test("UI10-STATUS-01: /backtests in every mode, mission and period shows no raw enum in text or tooltips", async () => {
  const pages = await servedPages(SERVED_PATHS);
  for (const [route, html] of Object.entries(pages)) {
    assert.deepEqual(legacyTextFindings(html), [], route);
  }
  const trades = pages["/backtests?mode=TRADES&mission=GAS_QUARTERLY&period=PUENTE"];
  const text = visibleSegments(trades).filter((segment) => segment.kind === "primary").map((segment) => segment.text).join("\n");
  for (const code of ["PENDING_MEASUREMENT", "OOS_HISTORICO", "BEFORE_SOURCE_START", "POST_PUENTE", "STALE_REMEASURE_REQUIRED", "NO_AUTOMATIC_THRESHOLD", "NOT_INDEPENDENT_VALIDATION", "OPEN_PENDING_FREEZE", "LAST_TRADE", "SLOT_VWAP", "GAS_QUARTERLY", "GAS_THE", "CLIENT_SEALED_ARCHIVE"]) {
    assert.doesNotMatch(text, new RegExp(`\\b${code}\\b`), code);
  }
  assert.match(text, /Pending measurement/);
  assert.match(text, /Historical OOS/);
  assert.match(text, /Last trade/);
  // The machine code survives only in data attributes.
  assert.match(trades, /data-state="PENDING_MEASUREMENT"/);
});

test("UI10-STATUS-01: every TR-07 status code reads as its backend word; an unknown code never leaks", () => {
  const panels = projectTradesPanels(loadTradesPanelsAt(DEFAULT_REPO_ROOT));
  for (const [code, label] of Object.entries(TRADES_PANEL_LABELS.statuses)) {
    const variant = { ...panels, frozenContract: { ...panels.frozenContract, status: code } };
    const html = renderSurfacePage("backtests", { ...vms.backtests, tradesPanels: variant }, { mode: "TRADES", missionId: "GAS_QUARTERLY", period: "PUENTE" });
    const card = html.slice(html.lastIndexOf("<div", html.indexOf('data-tr07="frozenContract"')), html.lastIndexOf("<div", html.indexOf('data-tr07="results"')));
    assert.match(card, new RegExp(`<span data-state="${code}"><span class="st [a-z]+"><span class="g">.</span>${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}</span></span>`), code);
    assert.deepEqual(legacyTextFindings(card), [], code);
  }
  assert.equal(tradesLabel("statuses", "SOME_NEW_CODE"), TRADES_PANEL_LABELS.UNLABELLED);
  assert.equal(tradesLabel("nope", "LAST_TRADE"), TRADES_PANEL_LABELS.UNLABELLED);
  assert.equal(tradesZoneLabel("OOS_HISTORICO"), "Historical OOS");
  assert.equal(tradesZoneLabel("PUENTE"), "Bridge");
  assert.equal(tradesZoneLabel("SOMEWHERE"), TRADES_PANEL_LABELS.UNLABELLED);
  // The checker itself rejects the raw codes of the review (negative cases).
  const page = (body) => `<html><body>${body}</body></html>`;
  for (const code of ["PENDING_MEASUREMENT", "OOS_HISTORICO", "BEFORE_SOURCE_START", "PUENTE"]) {
    assert.deepEqual(legacyTextFindings(page(`<td>${code}</td>`)).map((finding) => finding.check), ["UI10-06"], code);
    assert.deepEqual(legacyTextFindings(page(`<span title="${code}">x</span>`)).map((finding) => finding.check), ["UI10-06"], `${code} tooltip`);
  }
  assert.deepEqual(legacyTextFindings(page('<span class="alias" data-provenance="alias">technical id DELTA_V</span>')), []);
});

// ---------- UI10-BLOCK-01 / UI10-ACTION-01 · Development control ----------

const BLOCKED_PATH = "operations/hypothesis/H-S1-01/development/GAS_QUARTERLY/availability.json";

function launchFor(missionId, blockers) {
  return {
    metadata: hypothesisMetadata(),
    missions: MISSIONS.map((id) => ({ missionId: id, missionLabel: MISSION_LABELS[id], status: "BLOCKED", request: null, blockers: id === missionId ? blockers : [] })),
  };
}

const IDLE_HYPOTHESIS = { hypothesis: { configured: true, statusReadable: true, running: false, display: { line: "Hypothesis runner idle" } } };

test("UI10-BLOCK-01: a SOURCE_MISSING path appears only inside the collapsed blocker detail", () => {
  const blockers = [{ code: "SOURCE_MISSING", source: "availability", path: BLOCKED_PATH, userMessage: "Development source missing: availability", message: `no availability source is committed under ${BLOCKED_PATH}` }];
  const html = renderBacktestJobControl(IDLE_HYPOTHESIS, { mode: "HYPOTHESIS", launch: launchFor("GAS_QUARTERLY", blockers), missionId: "GAS_QUARTERLY" });
  const detail = html.match(/<details class="blockers">[\s\S]*?<\/details>/)?.[0] ?? "";
  assert.match(detail, /<summary>Show 1 blocker detail and source paths<\/summary>/);
  assert.ok(detail.includes(BLOCKED_PATH));
  const outside = html.replace(detail, "").replace(/<script\b[\s\S]*?<\/script>/g, "");
  assert.ok(!outside.includes("operations/"), "no path outside the detail");
  assert.match(outside, /<span class="st fail"><span class="g">×<\/span>Development source missing · 1<\/span>/);
  assert.match(detail, /data-job-blocker="SOURCE_MISSING">Development source missing: availability</);
});

test("UI10-ACTION-01: the Development button names the hypothesis and the selected mission", () => {
  for (const missionId of MISSIONS) {
    const html = renderBacktestJobControl(IDLE_HYPOTHESIS, { mode: "HYPOTHESIS", launch: launchFor(missionId, []), missionId });
    assert.match(html, new RegExp(`data-job-start disabled>Run Development · H-S1-01 · ${MISSION_LABELS[missionId]}</button>`), missionId);
  }
  // Without backend launch metadata the canonical contract still names both;
  // without a mission the control says so instead of borrowing one.
  assert.match(renderBacktestJobControl({}, { mode: "HYPOTHESIS", missionId: "POWER_MONTHLY" }), />Run Development · H-S1-01 · Power Monthly<\/button>/);
  assert.match(renderBacktestJobControl({}, { mode: "HYPOTHESIS" }), />Run Development · H-S1-01 · no mission selected<\/button>/);
});

// ---------- UI10-CONTRACT-01 · preflight payload ----------

test("UI10-CONTRACT-01: /api/backtest-jobs preflight gives code, English userMessage and path for a missing source", async () => {
  const repo = makeHypothesisFixtureRepo({ missions: ["GAS_MONTHLY"] });
  const runner = createHypothesisJobRunner({ repoRoot: repo.root });
  await withServer({ hypothesisJobRunner: runner }, async (url) => {
    const body = await (await fetch(new URL("api/backtest-jobs", url))).json();
    const mission = body.hypothesis.readiness.find((entry) => entry.missionId === "GAS_QUARTERLY");
    assert.equal(mission.status, "BLOCKED");
    const expected = { availability: "availability.json", observations: "observations.json", benchmark: "benchmark.json", "delivery hours": "delivery-hours.json" };
    assert.deepEqual(mission.blockers.map((blocker) => blocker.userMessage), Object.keys(expected).map((source) => `Development source missing: ${source}`));
    for (const [blocker, file] of mission.blockers.map((entry, index) => [entry, Object.values(expected)[index]])) {
      assert.equal(blocker.code, "SOURCE_MISSING");
      assert.equal(blocker.path, `operations/hypothesis/H-S1-01/development/GAS_QUARTERLY/${file}`);
      assert.ok(!blocker.userMessage.includes("/"), "no path in the user message");
      assert.ok(blocker.message.includes(blocker.path), "the technical message keeps the path");
    }
    // A committed mission without a launch request: same three fields.
    const launch = runner.launch().missions.find((entry) => entry.missionId === "GAS_MONTHLY");
    assert.deepEqual(Object.keys(launch.blockers[0]).filter((key) => ["code", "userMessage", "path"].includes(key)).sort(), ["code", "path", "userMessage"]);
    assert.equal(launch.blockers[0].userMessage, "Development request missing");
  });
});
