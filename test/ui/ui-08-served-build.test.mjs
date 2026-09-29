import { test } from "node:test";
import assert from "node:assert/strict";

import { loadCanonicalUiInputs } from "../../src/ui/canonical-inputs.mjs";
import { createUiServer } from "../../src/ui/server.mjs";
import { backtestJobStatusPayload, tradesJobStatusPayload, hypothesisJobStatusPayload } from "../../src/backtest-jobs/http.mjs";
import { hypothesisMetadata } from "../../src/backtest-jobs/hypothesis-runner.mjs";
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

test("UI08-R11: an explicit unreadable runner state is never promoted to readable", () => {
  const runner = { ...idleRunner(), status: () => ({ ...idleRunner().status(), statusReadable: null }) };
  for (const project of [backtestJobStatusPayload, tradesJobStatusPayload, hypothesisJobStatusPayload]) {
    assert.equal(project(runner).statusReadable, false);
  }
});

async function withServer(run, { hypothesisRunner = idleRunner() } = {}) {
  const { inputs, backend } = loadCanonicalUiInputs();
  const { server, ready } = createUiServer({ port: 0, inputs, backend,
    jobRunner: idleRunner(), tradesJobRunner: idleRunner(), hypothesisJobRunner: hypothesisRunner,
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

test("UI08-R11: a missing health readability attestation cannot pass the served smoke", async () => {
  await withServer(async (url) => {
    const changedFetch = async (target, options) => {
      const response = await fetch(target, options);
      if (new URL(target).pathname !== "/health") return response;
      const health = await response.json();
      delete health.backtestJobs.statusReadable;
      return new Response(JSON.stringify(health), { status: response.status, headers: response.headers });
    };
    const report = await verifyServedBuild({ baseUrl: url, expectedCommit: COMMIT, fetchImpl: changedFetch });
    assert.equal(report.ok, false);
    assert.match(report.errors.join("\n"), /idle state is unreadable/);
  });
});

test("UI08-R11: every configured runner must attest a readable idle state", async () => {
  await withServer(async (url) => {
    for (const runner of ["legacy", "trades", "hypothesis"]) {
      const changedFetch = async (target, options) => {
        const response = await fetch(target, options);
        if (new URL(target).pathname !== "/api/backtest-jobs") return response;
        const jobs = await response.json();
        const status = runner === "legacy" ? jobs : jobs[runner];
        assert.equal(status.statusReadable, true);
        delete status.statusReadable;
        return new Response(JSON.stringify(jobs), { status: response.status, headers: response.headers });
      };
      const report = await verifyServedBuild({ baseUrl: url, expectedCommit: COMMIT, fetchImpl: changedFetch });
      assert.equal(report.ok, false, `${runner} omitted its readability attestation`);
      assert.match(report.errors.join("\n"), /idle state is unreadable/);
    }
  });
});

test("UI08-R11: an unsuccessful job status payload cannot attest idleness", async () => {
  await withServer(async (url) => {
    const changedFetch = async (target, options) => {
      const response = await fetch(target, options);
      if (new URL(target).pathname !== "/api/backtest-jobs") return response;
      const jobs = await response.json();
      jobs.ok = false;
      return new Response(JSON.stringify(jobs), { status: response.status, headers: response.headers });
    };
    const report = await verifyServedBuild({ baseUrl: url, expectedCommit: COMMIT, fetchImpl: changedFetch });
    assert.equal(report.ok, false);
    assert.match(report.errors.join("\n"), /idle state is unreadable/);
  });
});

test("UI08-R11: an active attempt cannot be disguised by running false", async () => {
  await withServer(async (url) => {
    for (const runner of ["legacy", "trades", "hypothesis"]) {
      const changedFetch = async (target, options) => {
        const response = await fetch(target, options);
        if (new URL(target).pathname !== "/api/backtest-jobs") return response;
        const jobs = await response.json();
        const status = runner === "legacy" ? jobs : jobs[runner];
        assert.equal(status.running, false);
        assert.equal(status.current, null);
        status.current = { runId: "active-attempt" };
        return new Response(JSON.stringify(jobs), { status: response.status, headers: response.headers });
      };
      const report = await verifyServedBuild({ baseUrl: url, expectedCommit: COMMIT, fetchImpl: changedFetch });
      assert.equal(report.ok, false, `${runner} published a contradictory current attempt`);
      assert.match(report.errors.join("\n"), /idle state is unreadable/);
    }
  });
});

test("UI08-R11: served-build smoke checks the actual HTTP build and four shared snapshots", async () => {
  await withServer(async (url) => {
    const report = await verifyServedBuild({ baseUrl: url, expectedCommit: COMMIT, expectedPid: process.pid });
    assert.deepEqual(report.errors, []);
    assert.equal(report.ok, true);
    assert.equal(report.loadedCommit, COMMIT);
    assert.equal(report.loadedPid, process.pid);
    assert.deepEqual(Object.keys(report.routes).sort(), [
      "/api/backtest-jobs", "/backtests", "/campaigns", "/health", "/replay", "/research",
      ...["GAS_MONTHLY", "GAS_QUARTERLY", "POWER_MONTHLY", "POWER_QUARTERLY"]
        .map((mission) => `/backtests?mode=HYPOTHESIS&mission=${mission}`),
    ].sort());
    assert.equal(report.responses.length, 12);
    assert.deepEqual(report.responses.map(({ path }) => path), [
      "/health", "/api/backtest-jobs", "/campaigns", "/replay", "/backtests", "/research",
      "/backtests?mode=HYPOTHESIS&mission=GAS_MONTHLY",
      "/backtests?mode=HYPOTHESIS&mission=GAS_QUARTERLY",
      "/backtests?mode=HYPOTHESIS&mission=POWER_MONTHLY",
      "/backtests?mode=HYPOTHESIS&mission=POWER_QUARTERLY",
      "/health", "/api/backtest-jobs",
    ]);
    for (const response of report.responses) {
      assert.equal(response.status, 200);
      assert.equal(response.commit, COMMIT);
      assert.equal(response.revision, report.snapshotRevision);
      assert.equal(response.version, report.semanticVersion);
    }
  });
});

test("UI08-R11: each blocked mission's served Development control stays disabled with a visible reason", async () => {
  await withServer(async (url) => {
    const missionPath = "/backtests?mode=HYPOTHESIS&mission=GAS_MONTHLY";
    for (const corrupt of [
      (html) => html.replace("data-job-start disabled", "data-job-start"),
      (html) => html.replace("no backend-validated Development request is available for this mission", ""),
    ]) {
      const changedFetch = async (target, options) => {
        const response = await fetch(target, options);
        if (`${new URL(target).pathname}${new URL(target).search}` !== missionPath) return response;
        return new Response(corrupt(await response.text()), { status: response.status, headers: response.headers });
      };
      const report = await verifyServedBuild({ baseUrl: url, expectedCommit: COMMIT, fetchImpl: changedFetch });
      assert.equal(report.ok, false);
      assert.match(report.errors.join("\n"), /blocked Development control is enabled or omits its backend reason/);
    }
  });
});

test("UI08-R11: a READY drilldown carries the selected mission's Development request", async () => {
  const request = {
    hypothesisId: "H-S1-01", hypothesisVersion: hypothesisMetadata().version,
    missionId: "GAS_MONTHLY", phase: "DEVELOPMENT", dataMode: "TOB",
  };
  const hypothesisRunner = {
    ...idleRunner(),
    launch: () => ({ metadata: hypothesisMetadata(), missions: [
      { missionId: "GAS_MONTHLY", status: "READY", blockers: [], request },
      ...["GAS_QUARTERLY", "POWER_MONTHLY", "POWER_QUARTERLY"].map((missionId) => ({
        missionId, status: "UNAVAILABLE", blockers: [{ code: "SOURCE_MISSING", message: "no validated Development source" }], request: null,
      })),
    ] }),
  };
  await withServer(async (url) => {
    const valid = await verifyServedBuild({ baseUrl: url, expectedCommit: COMMIT });
    assert.equal(valid.ok, true, valid.errors.join("\n"));
    const changedFetch = async (target, options) => {
      const response = await fetch(target, options);
      if (`${new URL(target).pathname}${new URL(target).search}` !== "/backtests?mode=HYPOTHESIS&mission=GAS_MONTHLY") return response;
      const html = (await response.text()).replace('"missionId":"GAS_MONTHLY"', '"missionId":"POWER_MONTHLY"');
      return new Response(html, { status: response.status, headers: response.headers });
    };
    const stale = await verifyServedBuild({ baseUrl: url, expectedCommit: COMMIT, fetchImpl: changedFetch });
    assert.equal(stale.ok, false);
    assert.match(stale.errors.join("\n"), /READY control lacks a validated mission-bound Development request/);
  }, { hypothesisRunner });
});

test("UI08-R11: a stale mission drilldown cannot borrow the top-level build identity", async () => {
  await withServer(async (url) => {
    const changedFetch = async (target, options) => {
      const response = await fetch(target, options);
      if (`${new URL(target).pathname}${new URL(target).search}` !== "/backtests?mode=HYPOTHESIS&mission=POWER_QUARTERLY") return response;
      const headers = new Headers(response.headers);
      headers.set("x-em-snapshot-revision", "0".repeat(64));
      return new Response(await response.text(), { status: response.status, headers });
    };
    const report = await verifyServedBuild({ baseUrl: url, expectedCommit: COMMIT, fetchImpl: changedFetch });
    assert.equal(report.ok, false);
    assert.match(report.errors.join("\n"), /Development drilldown \/backtests\?mode=HYPOTHESIS&mission=POWER_QUARTERLY: HTTP response build\/snapshot\/semantic identity differs/);
  });
});

test("UI08-R11: a Development drilldown cannot serve translated navigation or shell", async () => {
  await withServer(async (url) => {
    const path = "/backtests?mode=HYPOTHESIS&mission=POWER_QUARTERLY";
    for (const [from, to, expectedError] of [
      ['<span class="t">Campaigns &amp; Runs</span>', '<span class="t">Campañas</span>', /navigation differs from backend tab campaigns/],
      ['<html lang="en">', '<html lang="es">', /approved light\/editorial English shell missing/],
    ]) {
      const changedFetch = async (target, options) => {
        const response = await fetch(target, options);
        if (`${new URL(target).pathname}${new URL(target).search}` !== path) return response;
        const html = await response.text();
        assert.ok(html.includes(from), `fixture must contain ${from}`);
        return new Response(html.replace(from, to), { status: response.status, headers: response.headers });
      };
      const report = await verifyServedBuild({ baseUrl: url, expectedCommit: COMMIT, fetchImpl: changedFetch });
      assert.equal(report.ok, false);
      assert.match(report.errors.join("\n"), expectedError);
    }
  });
});

test("UI08-R11: an otherwise valid fixture cannot impersonate the configured service process", async () => {
  await withServer(async (url) => {
    const report = await verifyServedBuild({ baseUrl: url, expectedCommit: COMMIT, expectedPid: process.pid + 1 });
    assert.equal(report.ok, false);
    assert.match(report.errors.join("\n"), /responding process differs from the configured service MainPID/);
  });
});

test("UI08-R11: the responding process must remain the configured service process throughout the smoke", async () => {
  await withServer(async (url) => {
    let healthReads = 0;
    const changedFetch = async (target, options) => {
      const response = await fetch(target, options);
      if (new URL(target).pathname !== "/health" || ++healthReads !== 2) return response;
      const health = await response.json();
      health.processId += 1;
      return new Response(JSON.stringify(health), { status: response.status, headers: response.headers });
    };
    const report = await verifyServedBuild({ baseUrl: url, expectedCommit: COMMIT, expectedPid: process.pid, fetchImpl: changedFetch });
    assert.equal(report.ok, false);
    assert.match(report.errors.join("\n"), /served build, snapshot or semantic version changed during the smoke/);
  });
});

test("UI08-R11: the loaded process and published snapshot must keep their instance identities throughout the smoke", async () => {
  await withServer(async (url) => {
    for (const change of [
      (health) => { health.build.capturedAt = "2020-01-01T00:00:00.000Z"; },
      (health) => { health.semanticSnapshot.publishedAt = "2020-01-01T00:00:00.000Z"; },
    ]) {
      let healthReads = 0;
      const changedFetch = async (target, options) => {
        const response = await fetch(target, options);
        if (new URL(target).pathname !== "/health" || ++healthReads !== 2) return response;
        const health = await response.json();
        change(health);
        return new Response(JSON.stringify(health), { status: response.status, headers: response.headers });
      };
      const report = await verifyServedBuild({ baseUrl: url, expectedCommit: COMMIT, fetchImpl: changedFetch });
      assert.equal(report.ok, false);
      assert.match(report.errors.join("\n"), /served build, snapshot or semantic version changed during the smoke/);
    }
  });
});

test("UI08-R11: a build without a readable process start identity cannot pass", async () => {
  await withServer(async (url) => {
    const changedFetch = async (target, options) => {
      const response = await fetch(target, options);
      if (new URL(target).pathname !== "/health") return response;
      const health = await response.json();
      delete health.build.capturedAt;
      return new Response(JSON.stringify(health), { status: response.status, headers: response.headers });
    };
    const report = await verifyServedBuild({ baseUrl: url, expectedCommit: COMMIT, fetchImpl: changedFetch });
    assert.equal(report.ok, false);
    assert.match(report.errors.join("\n"), /loaded process start identity is unavailable/);
  });
});

test("UI08-R11: a matching commit from another service cannot pass the served smoke", async () => {
  await withServer(async (url) => {
    for (const field of ["service", "build.service"]) {
      const changedFetch = async (target, options) => {
        const response = await fetch(target, options);
        if (new URL(target).pathname !== "/health") return response;
        const health = await response.json();
        if (field === "service") health.service = "another-service";
        else health.build.service = "another-service";
        return new Response(JSON.stringify(health), { status: response.status, headers: response.headers });
      };
      const report = await verifyServedBuild({ baseUrl: url, expectedCommit: COMMIT, fetchImpl: changedFetch });
      assert.equal(report.ok, false, `${field} must identify the configured service`);
      assert.match(report.errors.join("\n"), /loaded build does not identify the Energy Markets service/);
    }
  });
});

test("UI08-R11: service identity cannot change during the served smoke", async () => {
  await withServer(async (url) => {
    let healthReads = 0;
    const changedFetch = async (target, options) => {
      const response = await fetch(target, options);
      if (new URL(target).pathname !== "/health" || ++healthReads !== 2) return response;
      const health = await response.json();
      health.build.service = "another-service";
      return new Response(JSON.stringify(health), { status: response.status, headers: response.headers });
    };
    const report = await verifyServedBuild({ baseUrl: url, expectedCommit: COMMIT, fetchImpl: changedFetch });
    assert.equal(report.ok, false);
    assert.match(report.errors.join("\n"), /served build, snapshot or semantic version changed during the smoke/);
  });
});

test("UI08-R11: the configured unit must still own the responding PID after the last HTTP read", async () => {
  await withServer(async (url) => {
    const current = await verifyServedBuild({
      baseUrl: url, expectedCommit: COMMIT, expectedPid: process.pid,
      readConfiguredPid: () => process.pid,
    });
    assert.equal(current.ok, true, current.errors.join("\n"));

    const replaced = await verifyServedBuild({
      baseUrl: url, expectedCommit: COMMIT, expectedPid: process.pid,
      readConfiguredPid: () => process.pid + 1,
    });
    assert.equal(replaced.ok, false);
    assert.match(replaced.errors.join("\n"), /configured service MainPID changed during or immediately after the smoke/);

    const unreadable = await verifyServedBuild({
      baseUrl: url, expectedCommit: COMMIT, expectedPid: process.pid,
      readConfiguredPid: () => { throw new Error("unit unavailable"); },
    });
    assert.equal(unreadable.ok, false);
    assert.match(unreadable.errors.join("\n"), /configured service MainPID is unreadable after the smoke/);
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

test("UI08-R11: snapshot identity must be on the served body, not unrelated markup", async () => {
  await withServer(async (url) => {
    const changedFetch = async (target, options) => {
      const response = await fetch(target, options);
      if (new URL(target).pathname !== "/replay") return response;
      const html = (await response.text())
        .replace(/(<body\b[^>]*?) data-snapshot-revision="[0-9a-f]+"/, "$1")
        .replace('<main id="main"', `<main data-snapshot-revision="${response.headers.get("x-em-snapshot-revision")}" id="main"`);
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

test("UI08-R11: a job completing between two idle reads invalidates the release smoke", async () => {
  await withServer(async (url) => {
    for (const runner of ["legacy", "trades", "hypothesis"]) {
      let reads = 0;
      const changedFetch = async (target, options) => {
        const response = await fetch(target, options);
        if (new URL(target).pathname !== "/api/backtest-jobs" || ++reads !== 2) return response;
        const status = await response.json();
        const selected = runner === "legacy" ? status : status[runner];
        selected.latest = { runId: `completed-between-reads-${runner}`, status: "COMPLETED" };
        return new Response(JSON.stringify(status), { status: response.status, headers: response.headers });
      };
      const report = await verifyServedBuild({ baseUrl: url, expectedCommit: COMMIT, fetchImpl: changedFetch });
      assert.equal(report.ok, false, `${runner} completed a job inside the smoke window`);
      assert.match(report.errors.join("\n"), new RegExp(`${runner}: completed job history changed during the smoke`));
    }
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
