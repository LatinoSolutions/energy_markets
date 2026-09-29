// UI08-10: read-only smoke of the process actually answering the delivery URL.
// A checkout or a local fixture server cannot substitute for this check.
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const ROUTES = ["/campaigns", "/replay", "/backtests", "/research"];
const SHA256 = /^[0-9a-f]{64}$/;
const COMMIT = /^[0-9a-f]{40}$/;
const MISSION_IDS = ["GAS_MONTHLY", "GAS_QUARTERLY", "POWER_MONTHLY", "POWER_QUARTERLY"];
const ENGLISH_TABS = Object.freeze({ campaigns: "Campaigns & Runs", replay: "Replay", backtests: "Backtests", research: "Research" });
// Owner-approved identities are release assertions, not UI rendering data.
// The pages must still consume their labels from canonicalSemantics.
const ENGLISH_MISSIONS = Object.freeze({ GAS_MONTHLY: "Gas Monthly", GAS_QUARTERLY: "Gas Quarterly", POWER_MONTHLY: "Power Monthly", POWER_QUARTERLY: "Power Quarterly" });
const ENGLISH_HYPOTHESES = Object.freeze({ "H-S1-01": "Session-Anchored Rolling Reference", "H-RD-01": "Execution Hour" });
const ENGLISH_IDENTITIES = Object.freeze({ CLIENT: "Client", BENCHMARK: "Benchmark", HYPOTHESES: "Hypotheses", CONTROL: "Control" });
const ENGLISH_ROLES = Object.freeze({ strategy: "Strategy", researchDiscovery: "Research Discovery" });
const ENGLISH_STATUSES = Object.freeze({ UNTESTED: "Tested? No — no comparable evidence", PROVENANCE_ONLY: "Historical provenance only" });

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
  const responseIdentities = {};
  const responses = [];
  const read = async (path, json = false) => {
    try {
      const response = await fetchImpl(new URL(path.slice(1), base), { method: "GET", signal: AbortSignal.timeout(8000) });
      routes[path] = response.status;
      const identity = {
        commit: response.headers.get("x-em-build-commit"),
        revision: response.headers.get("x-em-snapshot-revision"),
        version: response.headers.get("x-em-semantic-version"),
      };
      responseIdentities[path] = identity;
      // Keep both reads of the mutable endpoints. A report containing only
      // their final values cannot independently substantiate the smoke window.
      responses.push({ path, status: response.status, ...identity });
      if (!response.ok) {
        errors.push(`${path}: HTTP ${response.status}`);
        return null;
      }
      return json ? await response.json() : await response.text();
    } catch (error) {
      responses.push({ path, status: null, commit: null, revision: null, version: null, error: String(error?.message ?? error) });
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
  const checkResponseIdentity = (path, stage) => {
    const identity = responseIdentities[path];
    if (identity?.commit !== expectedCommit || identity?.revision !== revision || identity?.version !== version) {
      errors.push(`${stage} ${path}: HTTP response build/snapshot/semantic identity differs from /health`);
    }
  };
  for (const path of ["/health", "/api/backtest-jobs"]) checkResponseIdentity(path, "initial");
  // A server without a launcher cannot attest that its job store is idle.
  // /health proves the legacy runner is configured and readable; the GET
  // payload additionally covers the TRADES and hypothesis runners.
  const idle = (status) => status?.statusReadable !== false && status?.running === false;
  if (health?.backtestJobs?.configured !== true || !idle(health.backtestJobs)
    || !idle(jobs) || jobs?.trades?.configured !== true || !idle(jobs.trades)
    || jobs?.hypothesis?.configured !== true || !idle(jobs.hypothesis)) {
    errors.push("a backtest job is running, a runner is missing, or its idle state is unreadable");
  }
  const missionIds = new Set(semantics?.missions?.map((mission) => mission.missionId) ?? []);
  // The served backend is the vocabulary source for every page. Check that its
  // own primary navigation metadata is complete and uses the owner-approved
  // English names before comparing each rendered navigation link against it.
  for (const [route, label] of Object.entries(ENGLISH_TABS)) {
    if (semantics?.labels?.tabs?.[route] !== label) {
      errors.push(`backend canonical navigation missing or non-English: ${route}`);
    }
  }
  for (const [kind, label] of Object.entries(ENGLISH_IDENTITIES)) {
    if (semantics?.labels?.identities?.[kind] !== label) errors.push(`backend canonical identity missing or non-English: ${kind}`);
  }
  for (const [kind, label] of Object.entries(ENGLISH_ROLES)) {
    if (semantics?.labels?.hypotheses?.[kind] !== label) errors.push(`backend canonical role missing or non-English: ${kind}`);
  }
  for (const [kind, label] of Object.entries(ENGLISH_STATUSES)) {
    if (semantics?.labels?.statuses?.[kind] !== label) errors.push(`backend canonical status missing or non-English: ${kind}`);
  }
  for (const id of MISSION_IDS) {
    if (!missionIds.has(id)) errors.push(`backend canonical projection omits mission ${id}`);
    if (semantics?.missions?.find((mission) => mission.missionId === id)?.label !== ENGLISH_MISSIONS[id]) {
      errors.push(`backend canonical mission missing or non-English: ${id}`);
    }
  }
  for (const [id, name] of Object.entries(ENGLISH_HYPOTHESES)) {
    if (semantics?.hypotheses?.find((hypothesis) => hypothesis.hypothesisId === id)?.name !== name) {
      errors.push(`backend canonical hypothesis missing or non-English: ${id}`);
    }
  }
  const checkSurfaceRevisions = (payload, stage) => {
    for (const path of ROUTES) {
      if (payload?.surfaces?.[path.slice(1)]?.snapshotRevision !== revision) {
        errors.push(`${stage} /health: ${path} snapshot revision differs from published revision`);
      }
    }
  };
  const checkPublication = (payload, stage) => {
    const publication = payload?.semanticSnapshot;
    if (typeof publication?.publishedAt !== "string"
      || !Number.isFinite(Date.parse(publication.publishedAt))
      || publication.lastPublicationRejected !== null) {
      errors.push(`${stage} /health: canonical snapshot publication is missing or its latest refresh was rejected`);
    }
  };
  checkSurfaceRevisions(health, "initial");
  checkPublication(health, "initial");
  const pages = {};
  for (const path of ROUTES) {
    const html = await read(path);
    checkResponseIdentity(path, "surface");
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
      // Compare the label inside the actual navigation link. A canonical strip
      // elsewhere on the page must not mask a stale or translated tab label.
      const nav = html.match(new RegExp(`<a\\b[^>]*\\bdata-nav="${route}"[^>]*>[\\s\\S]*?<span class="t">([^<]*)<\\/span>`));
      if (nav?.[1] !== htmlText(label)) errors.push(`${path}: navigation differs from backend tab ${route}`);
    }
    const stripStart = html.indexOf('data-semantic="SEM-2/canonical-projection"');
    const strip = stripStart >= 0 ? html.slice(stripStart) : "";
    if (path !== "/backtests" && stripStart < 0) {
      errors.push(`${path}: shared canonical projection missing`);
    }
    for (const mission of semantics?.missions ?? []) {
      if (path === "/backtests") {
        const scope = html.match(new RegExp(`<div class="card" data-scope-mission="${mission.missionId}">[\\s\\S]*?<h3>([^<]*)<\\/h3>`));
        if (scope?.[1] !== htmlText(mission.label)) {
          errors.push(`${path}: primary mission label differs from backend: ${mission.missionId}`);
        }
        for (const hypothesis of mission.hypotheses ?? []) {
          if (!html.includes(`data-hypothesis-id="${hypothesis.hypothesisId}"`) || !html.includes(htmlText(hypothesis.name))
            || !html.includes(htmlText(hypothesis.version))) {
            errors.push(`${path}: backend hypothesis identity/name/version missing: ${hypothesis.hypothesisId}`);
          }
          const cardStart = html.indexOf(`<div class="card" data-hypothesis-id="${htmlText(hypothesis.hypothesisId)}"`);
          const cardHeader = cardStart < 0 ? "" : html.slice(cardStart, html.indexOf("</div>", cardStart));
          if (!hypothesis.role || !cardHeader.includes(`<span class="small muted">${htmlText(hypothesis.role)} · ${htmlText(hypothesis.version)}</span>`)) {
            errors.push(`${path}: primary hypothesis role differs from backend: ${hypothesis.hypothesisId}`);
          }
        }
        continue;
      }
      const row = strip.match(new RegExp(`<tr data-mission="${mission.missionId}">([\\s\\S]*?)<\\/tr>`))?.[1] ?? "";
      if (row.match(/<td>([^<]*)<\/td>/)?.[1] !== htmlText(mission.label)) {
        errors.push(`${path}: primary mission label differs from backend: ${mission.missionId}`);
      }
      for (const identity of ["CLIENT", "BENCHMARK", "CONTROL"]) {
        const visible = row.match(new RegExp(`<td data-identity="${identity}">([^<]*)`))?.[1];
        if (visible !== htmlText(semantics.labels.identities[identity])) {
          errors.push(`${path}: primary ${identity} label differs from backend: ${mission.missionId}`);
        }
      }
      for (const hypothesis of mission.hypotheses ?? []) {
        const statusLabel = hypothesis.evidenceStatus === "PROVENANCE_ONLY"
          ? semantics.labels.statuses.PROVENANCE_ONLY : semantics.labels.statuses.UNTESTED;
        if (!row.includes(`data-hypothesis-id="${hypothesis.hypothesisId}"`) || !row.includes(htmlText(hypothesis.name))
          || !row.includes(htmlText(hypothesis.version)) || !row.includes(htmlText(statusLabel))) {
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
  checkResponseIdentity("/health", "final");
  const lastJobs = await read("/api/backtest-jobs", true);
  checkResponseIdentity("/api/backtest-jobs", "final");
  checkSurfaceRevisions(lastHealth, "final");
  checkPublication(lastHealth, "final");
  if (health?.build?.commit === expectedCommit && SHA256.test(revision ?? "") && version
    && (lastHealth?.build?.commit !== expectedCommit
      || lastHealth?.build?.dirty !== false
      || lastHealth?.semanticSnapshot?.revision !== revision
      || lastHealth?.semanticSnapshot?.semanticVersion !== version
      || lastJobs?.canonicalSemantics?.ok !== true
      || lastJobs?.canonicalSemantics?.semanticVersion !== version
      || JSON.stringify(lastJobs?.canonicalSemantics) !== JSON.stringify(semantics))) {
    errors.push("served build, snapshot or semantic version changed during the smoke; repeat after the process is stable");
  }
  if (lastHealth?.backtestJobs?.configured !== true || !idle(lastHealth.backtestJobs)
    || !idle(lastJobs) || lastJobs?.trades?.configured !== true || !idle(lastJobs.trades)
    || lastJobs?.hypothesis?.configured !== true || !idle(lastJobs.hypothesis)) {
    errors.push("a backtest job started during the smoke, a runner is missing, or its final idle state is unreadable");
  }
  return { ok: errors.length === 0, baseUrl: base.href, expectedCommit, loadedCommit: health?.build?.commit ?? null,
    semanticVersion: version ?? null, snapshotRevision: revision ?? null, routes, responses, errors };
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
