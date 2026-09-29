// Tests SEM-2: una sola proyección backend comparte las identidades canónicas
// (CLIENT / BENCHMARK / HYPOTHESES / CONTROL) con las cuatro superficies, la
// identidad del build servido se captura al arrancar, y los aliases históricos
// no se promueven a identidad primaria (intake D-20260928T181604-148d).
import { test } from "node:test";
import assert from "node:assert/strict";

import { loadCanonicalUiInputs } from "../../src/ui/canonical-inputs.mjs";
import { buildUiViewModels, createUiServer } from "../../src/ui/server.mjs";
import { renderSurfacePage } from "../../src/ui/render.mjs";
import { captureBuildIdentity } from "../../src/ui/build-identity.mjs";
import { DEFAULT_REPO_ROOT } from "../../src/pit-views/index.mjs";

test("SEM-2: one backend projection feeds English canonical identities to all four surfaces", () => {
  const vms = buildUiViewModels(loadCanonicalUiInputs().inputs);
  for (const surface of ["replay", "backtests", "research", "campaigns"]) {
    const semantics = vms[surface].canonicalSemantics;
    assert.equal(semantics?.ok, true, `${surface}: projection present`);
    assert.equal(semantics.missions.length, 4, `${surface}: four missions`);
    for (const mission of semantics.missions) {
      assert.equal(mission.client.kind, "CLIENT");
      assert.equal(mission.benchmark.kind, "BENCHMARK");
      assert.equal(mission.control, undefined);
      assert.equal(semantics.current.experiments[mission.missionId]["H-S1-01"].status, "UNBOUND");
      // SEM2-T05: only hypotheses that declare the mission sit on its row.
      assert.ok(mission.hypotheses.some((hypothesis) => hypothesis.hypothesisId === "H-S1-01"));
      assert.ok(mission.hypotheses.every((hypothesis) => hypothesis.hypothesisId !== "H-RD-01"));
    }
    // H-RD-01 stays in the HYPOTHESES collection with no declared mission scope.
    const rd = semantics.hypotheses.find((hypothesis) => hypothesis.hypothesisId === "H-RD-01");
    assert.equal(rd.role, "Research Discovery");
    assert.deepEqual(rd.missions, []);
  }
});

test("SEM-2: Replay, Campaigns and Research render the shared canonical identities and drop the client-practice claim", () => {
  const vms = buildUiViewModels(loadCanonicalUiInputs().inputs);
  for (const surface of ["replay", "campaigns", "research"]) {
    const html = renderSurfacePage(surface, vms[surface]);
    assert.match(html, /data-semantic="SEM-2\/canonical-projection"/, `${surface}: canonical strip`);
    assert.match(html, /data-semantic-version="SEM-1\/2026-09-28\/v1"/, `${surface}: semantic version`);
    assert.match(html, />Client</, `${surface}: English Client label`);
    assert.match(html, />Benchmark</, `${surface}: English Benchmark label`);
    assert.match(html, />Hypotheses</, `${surface}: English Hypotheses label`);
    // The legacy "Current client practice" / "Client practice" claim must not be a
    // primary product label anywhere (SEM-1; audit CS-01/CS-03).
    assert.doesNotMatch(html, /Current client practice|Client practice/, `${surface}: no client-practice claim`);
  }
});

test("SEM-2: legacy ARM_A/DIP10/ARM_B/HOUR stay provenance, never a tested result", () => {
  const vms = buildUiViewModels(loadCanonicalUiInputs().inputs);
  for (const surface of ["replay", "backtests", "research", "campaigns"]) {
    const adapter = vms[surface].canonicalSemantics.legacyAdapter;
    if (adapter.ok !== true) {
      continue;
    }
    assert.equal(adapter.roles.ARM_A.hypothesisId, "H-S1-01");
    assert.equal(adapter.roles.ARM_B.hypothesisId, "H-RD-01");
    assert.equal(adapter.roles.BASELINE.role, "CONTROL");
    for (const role of Object.values(adapter.roles)) {
      assert.notEqual(role.identity, "CLIENT");
      assert.equal(role.tested, false);
    }
  }
});

test("SEM-2: the served build identity is captured once and reports the loaded build", async () => {
  const captured = captureBuildIdentity(DEFAULT_REPO_ROOT);
  assert.equal(Object.isFrozen(captured), true);
  assert.equal(captured.service, "energy-markets-operator-ui");
  assert.ok(captured.commit === null || /^[0-9a-f]{40}$/.test(captured.commit));

  const injected = { service: "energy-markets-operator-ui", commit: "1".repeat(40), dirty: false, capturedAt: "2026-09-28T00:00:00.000Z" };
  const server = createUiServer({ port: 0, build: injected });
  const served = await server.ready;
  try {
    const first = await (await fetch(`${served.url.slice(0, -1)}/health`)).json();
    assert.equal(first.build.commit, injected.commit);
    assert.equal(first.build.capturedAt, injected.capturedAt);
    assert.equal(first.semanticSnapshot.semanticVersion, "SEM-1/2026-09-28/v1");
    // A second read serves the SAME captured identity; the process never re-reads a
    // checkout HEAD per request (SEM2-10).
    const second = await (await fetch(`${served.url.slice(0, -1)}/health`)).json();
    assert.deepEqual(second.build, first.build);
  } finally {
    await new Promise((resolve) => server.server.close(resolve));
  }
});

test("SEM-2: health never claims canonical data without a bound backend record", async () => {
  const server = createUiServer({ port: 0 });
  const served = await server.ready;
  try {
    const health = await (await fetch(`${served.url.slice(0, -1)}/health`)).json();
    for (const surface of Object.values(health.surfaces)) {
      assert.equal(surface.canonicalData, false);
    }
    assert.equal(health.build.commit, null);
    assert.equal(health.semanticSnapshot.source.status, "UNAVAILABLE");
  } finally {
    await new Promise((resolve) => server.server.close(resolve));
  }
});

