// UI08-10: read-only smoke of the process actually answering the delivery URL.
// A checkout or a local fixture server cannot substitute for this check.
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const ROUTES = ["/campaigns", "/replay", "/backtests", "/research"];
const SHA256 = /^[0-9a-f]{64}$/;
const COMMIT = /^[0-9a-f]{40}$/;
const MISSION_IDS = ["GAS_MONTHLY", "GAS_QUARTERLY", "POWER_MONTHLY", "POWER_QUARTERLY"];

function htmlText(value) {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

function attribute(html, name) {
  return html.match(new RegExp(`\\b${name}="([^"]*)"`))?.[1] ?? null;
}

export async function verifyServedBuild({ baseUrl, expectedCommit, fetchImpl = fetch }) {
  if (!COMMIT.test(expectedCommit ?? "")) throw new Error("expectedCommit must be a full Git commit SHA");
  const base = new URL(baseUrl);
  if (!/^https?:$/.test(base.protocol) || base.pathname !== "/" || base.search || base.hash) {
    throw new Error("baseUrl must be an HTTP(S) origin with a trailing slash");
  }
  const errors = [];
  const routes = {};
  const read = async (path, json = false) => {
    try {
      const response = await fetchImpl(new URL(path.slice(1), base), { method: "GET", signal: AbortSignal.timeout(8000) });
      routes[path] = response.status;
      if (!response.ok) {
        errors.push(`${path}: HTTP ${response.status}`);
        return null;
      }
      return json ? await response.json() : await response.text();
    } catch (error) {
      errors.push(`${path}: ${String(error?.message ?? error)}`);
      return null;
    }
  };

  const health = await read("/health", true);
  const jobs = await read("/api/backtest-jobs", true);
  const semantics = jobs?.canonicalSemantics;
  const revision = health?.semanticSnapshot?.revision;
  const version = health?.semanticSnapshot?.semanticVersion;
  if (health?.ok !== true || health?.build?.commit !== expectedCommit || health?.build?.dirty !== false) {
    errors.push("/health: loaded clean build does not match expected commit");
  }
  if (!SHA256.test(revision ?? "") || !version || semantics?.ok !== true || semantics.semanticVersion !== version) {
    errors.push("/health and /api/backtest-jobs: semantic version or published revision unavailable/mismatched");
  }
  const idle = (status) => status?.statusReadable !== false && (
    status?.configured === false ? status?.running !== true : status?.running === false
  );
  if (!idle(health?.backtestJobs) || !idle(jobs) || !idle(jobs?.trades) || !idle(jobs?.hypothesis)) {
    errors.push("a backtest job is running or its idle state is unreadable");
  }
  const missionIds = new Set(semantics?.missions?.map((mission) => mission.missionId) ?? []);
  for (const id of MISSION_IDS) {
    if (!missionIds.has(id)) errors.push(`backend canonical projection omits mission ${id}`);
  }
  const pages = {};
  for (const path of ROUTES) {
    const html = await read(path);
    if (html === null) continue;
    pages[path] = html;
    const versionRendered = html.includes(`data-semantic-version="${version}"`) || html.includes(`data-semantic="${version}"`);
    if (attribute(html, "data-snapshot-revision") !== revision || !versionRendered) {
      errors.push(`${path}: served snapshot/semantic version differs from backend`);
    }
    if (!html.includes('data-visual-language="claude-blind"') || !html.includes('<html lang="en"')) {
      errors.push(`${path}: approved light/editorial English shell missing`);
    }
    for (const [route, label] of Object.entries(semantics?.labels?.tabs ?? {})) {
      if (!html.includes(`data-nav="${route}"`) || !html.includes(htmlText(label))) {
        errors.push(`${path}: navigation differs from backend tab ${route}`);
      }
    }
    for (const mission of semantics?.missions ?? []) {
      if (!html.includes(htmlText(mission.label))) errors.push(`${path}: backend mission label missing: ${mission.missionId}`);
      for (const hypothesis of mission.hypotheses ?? []) {
        if (!html.includes(`data-hypothesis-id="${hypothesis.hypothesisId}"`) || !html.includes(htmlText(hypothesis.name)) || !html.includes(htmlText(hypothesis.version))) {
          errors.push(`${path}: backend hypothesis identity/name/version missing: ${hypothesis.hypothesisId}`);
        }
      }
    }
  }
  const backtests = pages["/backtests"] ?? "";
  if (!backtests.includes('<h1 class="page">Backtesting</h1>') || backtests.includes("Does another hour or a dip rule buy cheaper")) {
    errors.push("/backtests: stable UI-08 title missing or legacy global question still served");
  }
  const sections = ["scope", "hypotheses", "results"].map((section) => backtests.indexOf(`data-section="${section}"`));
  if (!(sections[0] >= 0 && sections[0] < sections[1] && sections[1] < sections[2])) {
    errors.push("/backtests: Scope → Hypotheses → Results order missing");
  }
  for (const id of MISSION_IDS) {
    if (!backtests.includes(`data-scope-mission="${id}"`)) errors.push(`/backtests: Scope omits ${id}`);
  }
  const lastHealth = await read("/health", true);
  const lastJobs = await read("/api/backtest-jobs", true);
  if (health?.build?.commit === expectedCommit && SHA256.test(revision ?? "")
    && (lastHealth?.build?.commit !== expectedCommit || lastHealth?.semanticSnapshot?.revision !== revision)) {
    errors.push("served build or snapshot changed during the smoke; repeat after the process is stable");
  }
  if (!idle(lastHealth?.backtestJobs) || !idle(lastJobs) || !idle(lastJobs?.trades) || !idle(lastJobs?.hypothesis)) {
    errors.push("a backtest job started during the smoke or its final idle state is unreadable");
  }
  return { ok: errors.length === 0, baseUrl: base.href, expectedCommit, loadedCommit: health?.build?.commit ?? null,
    semanticVersion: version ?? null, snapshotRevision: revision ?? null, routes, errors };
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const [, , baseUrl, expectedCommit] = process.argv;
  if (!baseUrl || !expectedCommit) {
    console.error("usage: node docs/product/ui-08/verify-served-build.mjs <base-url/> <expected-full-commit>");
    process.exitCode = 2;
  } else {
    try {
      const report = await verifyServedBuild({ baseUrl, expectedCommit });
      console.log(JSON.stringify(report, null, 2));
      if (!report.ok) process.exitCode = 1;
    } catch (error) {
      console.error(String(error?.message ?? error));
      process.exitCode = 2;
    }
  }
}
