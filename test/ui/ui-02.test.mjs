// Tests UI-02: criterio de aceptación — servir la implementación aceptada de
// UI-03 desde rutas web estables con health check, reutilizando la infra-
// estructura existente, sin cambiar la semántica del Operator Interface
// Boundary, sin datos inventados (UNAVAILABLE/ERROR fail-closed) y sin abrir
// exposición pública nueva ni tocar ejecución real.

import { test } from "node:test";
import assert from "node:assert/strict";

import { canonicalValueSha256 } from "../../src/pit-views/pit-record.mjs";
import {
  backendIndexFromManifest,
  buildExposure,
  buildOperatorTimeline,
  EXPOSURE_CONDITION,
  EXPOSURE_SOURCE_KIND,
  WORKING_MODE,
} from "../../src/operator-interface/index.mjs";
import {
  DEFAULT_UI_HOST,
  DEFAULT_UI_PORT,
  UI_ROUTES,
} from "../../src/ui/server.mjs";
import { createUiServer } from "../../src/ui/index.mjs";
import {
  AUTHORITY_BASE,
  DECISION_BASE,
  EVALUATION_BENCHMARK,
  RECEIPT_BASE,
  RECOMMENDATION_BASE,
  backendRefOf,
  buildManifest,
} from "../operator-interface/fixtures.mjs";

// ---------- escenario canónico (fixtures sintéticos de IMP-29) ----------

const COMPARISON = {
  key: "BT.G0BQ.202604.comparison",
  viewScope: "evaluation",
  occurredAtUtc: "2026-06-30T17:20:00Z",
  publishedAtUtc: "2026-07-01T06:05:00Z",
  consumableAtUtc: "2026-07-01T06:35:00Z",
  consumableEvidence: { source: "fixture://ingest-log", locator: "row @ fixture", sha256: "a".repeat(64) },
  revisionId: "bt-v1",
  value: { arm: "A0", measure: "B", economicValue: 25.1 },
};

function boundScenario() {
  const built = buildManifest({ records: [DECISION_BASE, RECOMMENDATION_BASE, EVALUATION_BENCHMARK, AUTHORITY_BASE, RECEIPT_BASE, COMPARISON] });
  assert.equal(built.ok, true, JSON.stringify(built.errors ?? "?"));
  const manifest = built.manifest;
  const timeline = buildOperatorTimeline({
    manifest,
    decisionBoundaryUtc: "2026-04-01T07:00:00Z",
    evaluationAsOfUtc: "2026-07-01T07:00:00Z",
    workingMode: WORKING_MODE.REPLAY,
    executions: [],
    interventions: [],
  });
  assert.equal(timeline.ok, true, JSON.stringify(timeline.errors ?? "?"));
  const exposure = buildExposure({
    boundaryUtc: "2026-04-01T07:00:00Z",
    observations: [{
      field: "recommendation",
      condition: EXPOSURE_CONDITION.AVAILABLE,
      value: RECOMMENDATION_BASE.value,
      provenance: {
        sourceKind: EXPOSURE_SOURCE_KIND.RECOMMENDATION,
        recordKey: RECOMMENDATION_BASE.key,
        revisionId: RECOMMENDATION_BASE.revisionId,
        valueSha256: canonicalValueSha256(RECOMMENDATION_BASE.value).sha256,
      },
    }],
    backendManifest: manifest,
  });
  assert.equal(exposure.ok, true, JSON.stringify(exposure.errors ?? "?"));
  return { manifest, timeline, exposure };
}

async function withServer(options, fn) {
  const stopped = createUiServer(options);
  const served = await stopped.ready;
  try {
    return await fn(served);
  } finally {
    await new Promise((resolve) => stopped.server.close(resolve));
  }
}

const SURFACE_PATHS = ["/replay", "/backtests", "/research", "/campaigns"];

// ---------- rutas estables de las cuatro superficies ----------

test("UI-02: las cuatro superficies quedan expuestas en rutas estables", async () => {
  const scenario = boundScenario();
  await withServer({
    port: 0,
    inputs: {
      backendIndex: backendIndexFromManifest(scenario.manifest),
      timeline: scenario.timeline,
      exposure: scenario.exposure,
    },
  }, async (served) => {
    for (const path of SURFACE_PATHS) {
      const response = await fetch(`${served.url.slice(0, -1)}${path}`);
      assert.equal(response.status, 200, path);
      const html = await response.text();
      const surfaceId = path.slice(1);
      assert.match(html, new RegExp(`<section class="surface ${surfaceId}" data-surface="${surfaceId}">`), `${path}: superficie propia`);
      assert.match(html, /data-ui-visual-language="claude-blind"/, `${path}: dirección visual UI-03`);
      for (const id of ["replay", "backtests", "research", "campaigns"]) {
        assert.ok(html.includes(`data-nav="${id}"`), `${path}: nav ${id}`);
      }
    }
  });
});

test("UI-02: la ruta estable es independiente del estado de los datos y de los datos reales", async () => {
  // sin estado inyectado (fail-closed by default) las mismas rutas responden
  await withServer({ port: 0 }, async (served) => {
    for (const path of ["/", ...SURFACE_PATHS]) {
      const response = await fetch(`${served.url.slice(0, -1)}${path}`);
      assert.equal(response.status, 200, path);
    }
  });
  // con estado canónico inyectado, mismas rutas y mismas superficies
  const scenario = boundScenario();
  await withServer({
    port: 0,
    inputs: {
      backendIndex: { manifest: scenario.manifest, byIdentity: new Map(scenario.manifest.records.map((record) => [`${record.key}::${record.revisionId}`, record])) },
      timeline: scenario.timeline,
      exposure: scenario.exposure,
    },
  }, async (served) => {
    for (const path of ["/", ...SURFACE_PATHS, "/health"]) {
      const response = await fetch(`${served.url.slice(0, -1)}${path}`);
      assert.equal(response.status, 200, path);
    }
  });
});

// ---------- health check ----------

test("UI-02: health check estable retorna el estado real por superficie, sin inventar datos", async () => {
  await withServer({ port: 0 }, async (served) => {
    const response = await fetch(`${served.url.slice(0, -1)}/health`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type") ?? "", /application\/json/);
    const health = await response.json();
    assert.equal(health.ok, true);
    assert.equal(health.service, "energy-markets-operator-ui");
    assert.equal(health.visualLanguage, "claude-blind");
    for (const surface of SURFACE_PATHS.map((path) => path.slice(1))) {
      assert.ok(surface in health.surfaces, surface);
    }
    // sin manifest backend verificado: playas de datos vacías nunca alegan datos
    assert.equal(health.surfaces.replay.state, "ERROR");
    assert.equal(health.surfaces.replay.canonicalData, false);
    for (const surface of ["backtests", "research", "campaigns"]) {
      assert.equal(health.surfaces[surface].state, "READY");
      assert.equal(health.surfaces[surface].canonicalData, false);
    }
  });
});

// UI02-H1 (review de cambio 24-sep-2026): con el boundary validado inyectado,
// el health debe reflejar la verdad de la página; la repro del review pinó un
// replay READY con datos BOUND reportando canonicalData:false.
test("UI-02: health refleja el estado real de Replay cuando la página muestra datos canónicos enlazados", async () => {
  const scenario = boundScenario();
  await withServer({
    port: 0,
    inputs: {
      backendIndex: backendIndexFromManifest(scenario.manifest),
      timeline: scenario.timeline,
      exposure: scenario.exposure,
    },
  }, async (served) => {
    const health = await (await fetch(`${served.url.slice(0, -1)}/health`)).json();
    assert.equal(health.surfaces.replay.state, "READY");
    assert.equal(health.surfaces.replay.canonicalData, true);
    // sin candidatos inyectados, las demás superficies siguen sin alegar datos
    for (const surface of ["backtests", "research", "campaigns"]) {
      assert.equal(health.surfaces[surface].canonicalData, false);
    }
  });
});

// ---------- fail-closed sin datos + datos canónicos cuando se inyectan ----------

test("UI-02: sin manifest backend verificado ninguna superficie muestra datos inventados", async () => {
  await withServer({ port: 0 }, async (served) => {
    for (const path of SURFACE_PATHS) {
      const html = await (await fetch(`${served.url.slice(0, -1)}${path}`)).text();
      if (path === "/replay") {
        // replay exige el timeline y la exposición validados: sin ellos el
        // error fail-closed es la salida correcta (§26.5)
        assert.match(html, /data-state="ERROR"/, `la superficie ${path} no puede renderizarse sin datos validados`);
        assert.ok(html.includes("fail-closed"));
        continue;
      }
      assert.ok(html.includes('data-status="UNAVAILABLE"'), path);
      assert.ok(!html.includes('data-value="25.1"'), `${path}: no se fabrican datos`);
      assert.ok(!html.includes(">undefined<"), path);
    }
  });
});

test("UI-02: con el manifest backend verificado inyectado, el backend manda y la UI muestra lo canónico", async () => {
  const scenario = boundScenario();
  const backendIndex = backendIndexFromManifest(scenario.manifest);
  await withServer({
    port: 0,
    inputs: {
      backendIndex: backendIndexFromManifest(scenario.manifest),
      timeline: scenario.timeline,
      exposure: scenario.exposure,
      backtestsRows: [{
        label: "B G0BQ 202604",
        arm: COMPARISON.value.arm,
        measure: COMPARISON.value.measure,
        recordKey: COMPARISON.key,
        revisionId: COMPARISON.revisionId,
        value: COMPARISON.value,
      }],
    },
  }, async (served) => {
    const backtests = await (await fetch(`${served.url.slice(0, -1)}/backtests`)).text();
    assert.ok(backtests.includes('data-status="BOUND"'));
    assert.ok(backtests.includes(`data-record-key="${COMPARISON.key}"`));
    assert.ok(backtests.includes(`data-value-sha="${canonicalValueSha256(COMPARISON.value).sha256}"`));

    const replay = await (await fetch(`${served.url.slice(0, -1)}/replay`)).text();
    assert.match(replay, /data-surface="replay"/);
    assert.ok(replay.includes(`data-record-key="${RECOMMENDATION_BASE.key}"`));
    assert.ok(replay.includes(`data-value-sha="${canonicalValueSha256(RECOMMENDATION_BASE.value).sha256}"`));
  });
});

// ---------- navegación ----------

test("UI-02: la URL raíz es navegable y enlaza las cuatro superficies por ruta", async () => {
  await withServer({ port: 0 }, async (served) => {
    const homeHtml = await (await fetch(served.url)).text();
    assert.match(homeHtml, /Energy Markets/);
    for (const path of SURFACE_PATHS) {
      const surface = path.slice(1);
      assert.match(homeHtml, new RegExp(`href="${path}"`), `${surface}: enlaces de navegación por ruta estable`);
    }
    // a través de las tarjetas de navegación (data-surface-link)
    for (const surface of SURFACE_PATHS.map((path) => path.slice(1))) {
      assert.match(homeHtml, new RegExp(`data-surface-link="${surface}"`), surface);
    }
    // navegación entre superficies: cada página enlaza a las rutas de las otras
    const backtests = await (await fetch(`${served.url.slice(0, -1)}/backtests`)).text();
    for (const other of SURFACE_PATHS) {
      assert.ok(backtests.includes(`href="${other}"`), other);
    }
  });
});

// ---------- fail-closed de serving ----------

test("UI-02: las rutas no canónicas, los métodos de escritura y los errores quedan fail-closed", async () => {
  await withServer({ port: 0 }, async (served) => {
    const notFound = await fetch(`${served.url.slice(0, -1)}/no-existe`);
    assert.equal(notFound.status, 404);
    assert.match(await notFound.text(), /data-state="ERROR"/);

    const post = await fetch(`${served.url.slice(0, -1)}/replay`, { method: "POST" });
    assert.equal(post.status, 405);
    assert.equal(post.headers.get("allow"), "GET, HEAD");

    const put = await fetch(`${served.url.slice(0, -1)}/campaigns`, { method: "PUT" });
    assert.equal(put.status, 405);
  });
});

// ---------- sin exposición pública nueva ----------

test("UI-02: por defecto el servidor se enlaza a localhost, no se abre exposición pública", async () => {
  assert.equal(DEFAULT_UI_HOST, "127.0.0.1");
  await withServer({ port: 0 }, async (served) => {
    assert.equal(new URL(served.url).hostname, "127.0.0.1");
  });
});

// ---------- contrato del scheduler de server ----------

test("UI-02: el roster de rutas del servidor es el canónico declarado", () => {
  assert.deepEqual(Object.keys(UI_ROUTES).sort(), ["/", "/backtests", "/campaigns", "/health", "/replay", "/research"].sort());
});
