import { test } from "node:test";
import assert from "node:assert/strict";

import { loadCanonicalUiInputs } from "../../src/ui/canonical-inputs.mjs";
import { createUiServer } from "../../src/ui/server.mjs";
import { verifyServedBuild } from "../../docs/product/ui-08/verify-served-build.mjs";

const COMMIT = "a".repeat(40);

function idleRunner() {
  return {
    now: () => new Date(),
    status: () => ({ running: false, current: null, latest: null, currentResult: null, registry: { ok: true } }),
    readiness: () => ({ readable: false, reason: "fixture has no market inputs" }),
    launch: () => null,
  };
}

async function withServer(run) {
  const { inputs, backend } = loadCanonicalUiInputs();
  const { server, ready } = createUiServer({ port: 0, inputs, backend,
    jobRunner: idleRunner(), tradesJobRunner: idleRunner(), hypothesisJobRunner: idleRunner(),
    build: { service: "energy-markets-operator-ui", commit: COMMIT, dirty: false, capturedAt: new Date().toISOString() } });
  const { url } = await ready;
  try {
    await run(url);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test("UI08-R11: a server without the canonical job runners cannot attest release idleness", async () => {
  const { inputs, backend } = loadCanonicalUiInputs();
  const { server, ready } = createUiServer({ port: 0, inputs, backend,
    build: { service: "energy-markets-operator-ui", commit: COMMIT, dirty: false, capturedAt: new Date().toISOString() } });
  try {
    const report = await verifyServedBuild({ baseUrl: (await ready).url, expectedCommit: COMMIT });
    assert.equal(report.ok, false);
    assert.match(report.errors.join("\n"), /runner is missing/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("UI08-R11: served-build smoke checks the actual HTTP build and four shared snapshots", async () => {
  await withServer(async (url) => {
    const report = await verifyServedBuild({ baseUrl: url, expectedCommit: COMMIT });
    assert.deepEqual(report.errors, []);
    assert.equal(report.ok, true);
    assert.equal(report.loadedCommit, COMMIT);
    assert.deepEqual(Object.keys(report.routes).sort(), ["/api/backtest-jobs", "/backtests", "/campaigns", "/health", "/replay", "/research"].sort());
  });
});

test("UI08-R11: an old loaded process fails even when the checkout has the expected commit", async () => {
  await withServer(async (url) => {
    const report = await verifyServedBuild({ baseUrl: url, expectedCommit: "b".repeat(40) });
    assert.equal(report.ok, false);
    assert.match(report.errors.join("\n"), /loaded clean build does not match expected commit/);
  });
});

test("UI08-R11: a route with a different snapshot fails the smoke", async () => {
  await withServer(async (url) => {
    const changedFetch = async (target, options) => {
      const response = await fetch(target, options);
      if (new URL(target).pathname !== "/replay") return response;
      const html = (await response.text()).replace(/data-snapshot-revision="[0-9a-f]+"/, `data-snapshot-revision="${"0".repeat(64)}"`);
      return new Response(html, { status: response.status, headers: response.headers });
    };
    const report = await verifyServedBuild({ baseUrl: url, expectedCommit: COMMIT, fetchImpl: changedFetch });
    assert.equal(report.ok, false);
    assert.match(report.errors.join("\n"), /\/replay: served snapshot\/semantic version differs from backend/);
  });
});

test("UI08-R11: each HTTP route must report the loaded build and published revision", async () => {
  await withServer(async (url) => {
    const changedFetch = async (target, options) => {
      const response = await fetch(target, options);
      if (new URL(target).pathname !== "/research") return response;
      const headers = new Headers(response.headers);
      headers.set("x-em-build-commit", "b".repeat(40));
      return new Response(await response.text(), { status: response.status, headers });
    };
    const report = await verifyServedBuild({ baseUrl: url, expectedCommit: COMMIT, fetchImpl: changedFetch });
    assert.equal(report.ok, false);
    assert.match(report.errors.join("\n"), /surface \/research: HTTP response build\/snapshot\/semantic identity differs from \/health/);
  });
});

test("UI08-R11: English metadata elsewhere cannot hide a stale primary navigation label", async () => {
  await withServer(async (url) => {
    const changedFetch = async (target, options) => {
      const response = await fetch(target, options);
      if (new URL(target).pathname !== "/campaigns") return response;
      const html = (await response.text()).replace('<span class="t">Backtests</span>', '<span class="t">Pruebas</span>');
      return new Response(html, { status: response.status, headers: response.headers });
    };
    const report = await verifyServedBuild({ baseUrl: url, expectedCommit: COMMIT, fetchImpl: changedFetch });
    assert.equal(report.ok, false);
    assert.match(report.errors.join("\n"), /\/campaigns: navigation differs from backend tab backtests/);
  });
});

test("UI08-R11: a served backend with missing or translated navigation metadata fails closed", async () => {
  await withServer(async (url) => {
    for (const tabs of [{}, { campaigns: "Campañas y ejecuciones", replay: "Replay", backtests: "Backtests", research: "Research" }]) {
      const changedFetch = async (target, options) => {
        const response = await fetch(target, options);
        if (new URL(target).pathname !== "/api/backtest-jobs") return response;
        const jobs = await response.json();
        jobs.canonicalSemantics.labels.tabs = tabs;
        return new Response(JSON.stringify(jobs), { status: response.status, headers: response.headers });
      };
      const report = await verifyServedBuild({ baseUrl: url, expectedCommit: COMMIT, fetchImpl: changedFetch });
      assert.equal(report.ok, false);
      assert.match(report.errors.join("\n"), /backend canonical navigation missing or non-English: campaigns/);
    }
  });
});

test("UI08-R11: English HTML cannot conceal translated canonical names and status metadata", async () => {
  await withServer(async (url) => {
    const changedFetch = async (target, options) => {
      const response = await fetch(target, options);
      if (new URL(target).pathname !== "/api/backtest-jobs") return response;
      const jobs = await response.json();
      jobs.canonicalSemantics.labels.identities.CLIENT = "Cliente";
      jobs.canonicalSemantics.labels.hypotheses.strategy = "Estrategia";
      jobs.canonicalSemantics.labels.statuses.UNTESTED = "Sin probar";
      jobs.canonicalSemantics.missions.find(({ missionId }) => missionId === "GAS_MONTHLY").label = "Gas Mensual";
      jobs.canonicalSemantics.hypotheses.find(({ hypothesisId }) => hypothesisId === "H-S1-01").name = "Referencia móvil";
      return new Response(JSON.stringify(jobs), { status: response.status, headers: response.headers });
    };
    const report = await verifyServedBuild({ baseUrl: url, expectedCommit: COMMIT, fetchImpl: changedFetch });
    assert.equal(report.ok, false);
    assert.match(report.errors.join("\n"), /backend canonical identity missing or non-English: CLIENT/);
    assert.match(report.errors.join("\n"), /backend canonical role missing or non-English: strategy/);
    assert.match(report.errors.join("\n"), /backend canonical status missing or non-English: UNTESTED/);
    assert.match(report.errors.join("\n"), /backend canonical mission missing or non-English: GAS_MONTHLY/);
    assert.match(report.errors.join("\n"), /backend canonical hypothesis missing or non-English: H-S1-01/);
  });
});

test("UI08-R11: primary mission and identity labels must match the backend projection", async () => {
  await withServer(async (url) => {
    const changedFetch = async (target, options) => {
      const response = await fetch(target, options);
      if (new URL(target).pathname !== "/replay") return response;
      const html = (await response.text())
        .replace('<tr data-mission="GAS_MONTHLY">\n      <td>Gas Monthly</td>', '<tr data-mission="GAS_MONTHLY">\n      <td>Gas Mensual</td>')
        .replace('<td data-identity="CLIENT">Client', '<td data-identity="CLIENT">Cliente');
      return new Response(html, { status: response.status, headers: response.headers });
    };
    const report = await verifyServedBuild({ baseUrl: url, expectedCommit: COMMIT, fetchImpl: changedFetch });
    assert.equal(report.ok, false);
    assert.match(report.errors.join("\n"), /\/replay: primary mission label differs from backend: GAS_MONTHLY/);
    assert.match(report.errors.join("\n"), /\/replay: primary CLIENT label differs from backend: GAS_QUARTERLY/);
  });
});

test("UI08-R11: a translated primary hypothesis role fails the served smoke", async () => {
  await withServer(async (url) => {
    const changedFetch = async (target, options) => {
      const response = await fetch(target, options);
      if (new URL(target).pathname !== "/backtests") return response;
      const html = (await response.text()).replace(
        '<span class="small muted">Strategy · H-S1-01/phase-A/v2</span>',
        '<span class="small muted">Estrategia · H-S1-01/phase-A/v2</span>',
      );
      return new Response(html, { status: response.status, headers: response.headers });
    };
    const report = await verifyServedBuild({ baseUrl: url, expectedCommit: COMMIT, fetchImpl: changedFetch });
    assert.equal(report.ok, false);
    assert.match(report.errors.join("\n"), /\/backtests: primary hypothesis role differs from backend: H-S1-01/);
  });
});

test("UI08-R11: health cannot claim a different snapshot for one served surface", async () => {
  await withServer(async (url) => {
    const changedFetch = async (target, options) => {
      const response = await fetch(target, options);
      if (new URL(target).pathname !== "/health") return response;
      const health = await response.json();
      health.surfaces.replay.snapshotRevision = "0".repeat(64);
      return new Response(JSON.stringify(health), { status: response.status, headers: response.headers });
    };
    const report = await verifyServedBuild({ baseUrl: url, expectedCommit: COMMIT, fetchImpl: changedFetch });
    assert.equal(report.ok, false);
    assert.match(report.errors.join("\n"), /\/health: \/replay snapshot revision differs from published revision/);
  });
});

test("UI08-R11: a rejected canonical snapshot refresh cannot pass the served smoke", async () => {
  await withServer(async (url) => {
    const changedFetch = async (target, options) => {
      const response = await fetch(target, options);
      if (new URL(target).pathname !== "/health") return response;
      const health = await response.json();
      health.semanticSnapshot.lastPublicationRejected = { reason: "BT-08 result promoted", error: "INVALID_RESULT" };
      return new Response(JSON.stringify(health), { status: response.status, headers: response.headers });
    };
    const report = await verifyServedBuild({ baseUrl: url, expectedCommit: COMMIT, fetchImpl: changedFetch });
    assert.equal(report.ok, false);
    assert.match(report.errors.join("\n"), /canonical snapshot publication is missing or its latest refresh was rejected/);
  });
});

test("UI08-R11: a job starting during the smoke fails final idle verification", async () => {
  await withServer(async (url) => {
    let reads = 0;
    const changedFetch = async (target, options) => {
      const response = await fetch(target, options);
      if (new URL(target).pathname !== "/api/backtest-jobs" || ++reads !== 2) return response;
      const status = await response.json();
      status.hypothesis = { ...status.hypothesis, running: true };
      return new Response(JSON.stringify(status), { status: response.status, headers: response.headers });
    };
    const report = await verifyServedBuild({ baseUrl: url, expectedCommit: COMMIT, fetchImpl: changedFetch });
    assert.equal(report.ok, false);
    assert.match(report.errors.join("\n"), /job started during the smoke/);
  });
});

test("UI08-R11: an unreadable final job status fails closed", async () => {
  await withServer(async (url) => {
    let reads = 0;
    const changedFetch = async (target, options) => {
      const response = await fetch(target, options);
      if (new URL(target).pathname !== "/health" || ++reads !== 2) return response;
      const status = await response.json();
      status.backtestJobs = { configured: true, statusReadable: false, running: null };
      return new Response(JSON.stringify(status), { status: response.status, headers: response.headers });
    };
    const report = await verifyServedBuild({ baseUrl: url, expectedCommit: COMMIT, fetchImpl: changedFetch });
    assert.equal(report.ok, false);
    assert.match(report.errors.join("\n"), /final idle state is unreadable/);
  });
});

test("UI08-R11: a semantic version changing during the smoke fails closed", async () => {
  await withServer(async (url) => {
    let reads = 0;
    const changedFetch = async (target, options) => {
      const response = await fetch(target, options);
      if (new URL(target).pathname !== "/api/backtest-jobs" || ++reads !== 2) return response;
      const status = await response.json();
      status.canonicalSemantics = { ...status.canonicalSemantics, semanticVersion: "SEM-1/stale" };
      return new Response(JSON.stringify(status), { status: response.status, headers: response.headers });
    };
    const report = await verifyServedBuild({ baseUrl: url, expectedCommit: COMMIT, fetchImpl: changedFetch });
    assert.equal(report.ok, false);
    assert.match(report.errors.join("\n"), /semantic version changed during the smoke/);
  });
});

test("UI08-R11: backend projection changing without a version change fails the served smoke", async () => {
  await withServer(async (url) => {
    let reads = 0;
    const changedFetch = async (target, options) => {
      const response = await fetch(target, options);
      if (new URL(target).pathname !== "/api/backtest-jobs" || ++reads !== 2) return response;
      const status = await response.json();
      status.canonicalSemantics.missions[0].label = "Gas Mensual";
      return new Response(JSON.stringify(status), { status: response.status, headers: response.headers });
    };
    const report = await verifyServedBuild({ baseUrl: url, expectedCommit: COMMIT, fetchImpl: changedFetch });
    assert.equal(report.ok, false);
    assert.match(report.errors.join("\n"), /served build, snapshot or semantic version changed during the smoke/);
  });
});
