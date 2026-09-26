// TR-07 (TRADES_MODE_PLAN.md TR-07; patch 03 §3–§4): view model y render de los
// paneles TRADES de Backtests. Estos tests fijan que cada panel sale de un
// artifact atado por SHA-256, que lo ausente queda UNAVAILABLE (nunca un valor) y
// que la composición productiva de render.mjs calca el prototipo aprobado
// (P-010 opción B): contraste condicional, expandir calibración, filtro por
// misión, barra de zonas por periodo y tabla de brazos en TRADES.

import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import { createTempDir } from "../helpers/tmpdir.mjs";
import path from "node:path";

import { DEFAULT_REPO_ROOT } from "../../src/pit-views/index.mjs";
import {
  TRADES_MODES,
  TRADES_PANEL_ARTIFACTS,
  loadTradesPanelsAt,
  projectTradesPanels,
} from "../../src/ui/trades-panels.mjs";
import { loadCanonicalUiInputs } from "../../src/ui/canonical-inputs.mjs";
import { buildUiViewModels, createUiServer, selectionFromSearchParams } from "../../src/ui/server.mjs";
import { renderSurfacePage } from "../../src/ui/render.mjs";
import { buildBacktestsViewModel } from "../../src/ui/view-models.mjs";

const loaded = loadTradesPanelsAt(DEFAULT_REPO_ROOT);
const panels = projectTradesPanels(loaded);

function readJson(relativePath) {
  return JSON.parse(readFileSync(path.join(DEFAULT_REPO_ROOT, relativePath), "utf8"));
}

const zonePlan = readJson(TRADES_PANEL_ARTIFACTS.zonePlan.artifact);
const bridgeStatus = readJson(TRADES_PANEL_ARTIFACTS.bridgeStatus.artifact);
const sourceDecision = readJson(TRADES_PANEL_ARTIFACTS.sourceDecision.artifact);

test("TR-07: los artifacts de panel se cargan y atan por hash a su manifest", () => {
  // UI-07: la medición del puente (TR-03) y el freeze de TR-04 existen tras DATA-01.
  for (const name of ["sourceDecision", "zonePlan", "bridgeStatus", "bridgeMeasurement", "tradesFreeze"]) {
    assert.equal(loaded[name].ok, true, `${name}: ${loaded[name].code ?? ""}`);
    assert.equal(typeof loaded[name].provenance.sha256, "string", name);
    assert.match(loaded[name].provenance.sha256, /^[0-9a-f]{64}$/, name);
  }
});

test("TR-07: el selector ofrece las 4 misiones y los modos TOB/TRADES", () => {
  assert.deepEqual([...panels.selector.modes], ["TOB", "TRADES"]);
  assert.deepEqual([...TRADES_MODES], ["TOB", "TRADES"]);
  const missions = panels.selector.marketMissions.map((entry) => entry.missionId).sort();
  assert.deepEqual(missions, ["GAS_MONTHLY", "GAS_QUARTERLY", "POWER_MONTHLY", "POWER_QUARTERLY"]);
  // Mercado y misión como los declara el plan de zonas, sin traducir ni inventar.
  const quarterlyGas = panels.selector.marketMissions.find((entry) => entry.missionId === "GAS_QUARTERLY");
  assert.equal(quarterlyGas.market, "GAS_THE");
  assert.equal(quarterlyGas.shortCode, "G0BQ");
  const quarterlyPower = panels.selector.marketMissions.find((entry) => entry.missionId === "POWER_QUARTERLY");
  assert.equal(quarterlyPower.market, "POWER_DE");
  assert.equal(quarterlyPower.shortCode, "DEBQ");
});

test("TR-07 cobertura: cada fila sale del artifact y conserva su zona", () => {
  assert.equal(panels.coverage.status, zonePlan.coverageStatus.status);
  assert.equal(panels.coverage.reason, zonePlan.coverageStatus.reason);
  assert.equal(panels.coverage.status, "MEASURED");
  assert.equal(panels.coverage.sourceDecisionStatus, sourceDecision.status);
  assert.equal(panels.coverage.missions.length, Object.keys(zonePlan.missions).length);
  for (const mission of panels.coverage.missions) {
    assert.equal(mission.market, zonePlan.missions[mission.missionId].market);
    for (const zone of mission.zones) {
      assert.ok(zone.zone in zonePlan.missions[mission.missionId].zones);
      for (const campaign of zone.campaigns) {
        assert.equal(campaign.zone, zone.zone);
        const source = zonePlan.missions[mission.missionId].zones[zone.zone].find((entry) => entry.campaignId === campaign.campaignId);
        assert.equal(campaign.maturity, source.maturity);
        assert.equal(campaign.windowStart, source.windowStart);
        assert.equal(campaign.coverage.artifactStatus, source.coverage.status);
      }
    }
  }
});

test("TR-07 cobertura: con PENDING_SCAN_JOB las cifras salen pendientes, no en cero", () => {
  const pendingPlan = { ...zonePlan, coverageStatus: { source: "TR-01_COVERAGE", status: "PENDING_SCAN_JOB", reason: "sin escaneo" } };
  const pending = projectTradesPanels({ ...loaded, zonePlan: { ...loaded.zonePlan, json: pendingPlan } });
  const quarterly = pending.coverage.missions.find((mission) => mission.missionId === "GAS_QUARTERLY");
  const development = quarterly.zones.find((zone) => zone.zone === "DEVELOPMENT");
  assert.ok(development.campaigns.length > 0);
  for (const campaign of development.campaigns) {
    assert.equal(campaign.coverage.status, "PENDING_SCAN_JOB");
    assert.equal(campaign.coverage.measurementPending, true);
    assert.equal(campaign.coverage.daysWithTrades, null);
    assert.equal(campaign.coverage.totalEligibleTrades, null);
    assert.equal(campaign.coverage.volumeSum, null);
    // La ventana es estructural (calendario/regla), no una medición: se conserva.
    assert.equal(typeof campaign.coverage.windowDays, "number");
  }
});

test("TR-07 zonas: OOS histórico sellado, cero aperturas, purge y forward pendiente", () => {
  assert.equal(panels.zones.status, zonePlan.decision);
  assert.equal(panels.zones.reservationId, zonePlan.reservationId);
  assert.equal(panels.zones.accessRegistry.oosStatus, "SEALED");
  for (const [missionId, status] of Object.entries(zonePlan.accessRegistry.oosStatusByMission)) {
    assert.equal(panels.zones.accessRegistry.oosStatusByMission[missionId], status);
    assert.equal(panels.zones.accessRegistry.oosOpeningsByMission[missionId], 0);
  }
  assert.deepEqual(panels.zones.purge.map((entry) => entry.campaignId), zonePlan.purge.map((entry) => entry.campaignId));
  assert.equal(panels.zones.bridge.seenCampaignIds.length, zonePlan.bridge.seenCampaignIds.length);
  assert.equal(panels.zones.tobSeen.materializedCampaignIds.length, zonePlan.tobSeen.materializedCampaignIds.length);
  assert.equal(panels.zones.forward.status, "OPEN_PENDING_FREEZE");
  assert.equal(panels.zones.forward.fromIso, null);
});

test("TR-07 calibración: estado, ventana, límites y reglas salen del artifact de TR-03", () => {
  assert.equal(panels.calibration.status, bridgeStatus.status);
  assert.equal(panels.calibration.status, "MEASURED");
  assert.equal(panels.calibration.measurement.status, "MEASURED");
  assert.deepEqual(panels.calibration.freshnessLimitsSeconds, bridgeStatus.freshnessLimitsSeconds);
  assert.deepEqual(panels.calibration.observationRules, bridgeStatus.observationRules);
  assert.equal(panels.calibration.bridgeCampaigns.count, bridgeStatus.bridgeCampaigns.count);
  assert.equal(panels.calibration.window.zone, "PUENTE");
  // El contenido crudo de la medición no viaja entero a la UI: sólo lo proyectado.
  assert.equal(panels.calibration.measurement.content, undefined);
});

test("TR-07 contrato y resultados: candidato HOLD de TR-04 y ningún run fabricado", () => {
  assert.equal(panels.frozenContract.status, "PENDING_MEASUREMENT");
  assert.match(panels.frozenContract.reason, /TR-03 debe medir la grilla/);
  assert.deepEqual(panels.frozenContract.candidate.freshnessSelection.gridSeconds, [900, 1800, 3600, 14400, 86400]);
  assert.equal(panels.results.status, "UNAVAILABLE");
  assert.match(panels.results.reason, /TR-06/);
});

test("TR-09 UI muestra grilla, elección y contraste verificado por misión y brazo", () => {
  const reported = projectTradesPanels({ ...loaded, tradesRuns: {
    ok: true,
    json: { inputs: { freeze: { sha256: loaded.tradesFreeze.provenance.sha256 } }, blockedBy: [], runs: [{
      phase: "BRIDGE", missionKey: "GAS_QUARTERLY", observationRule: "LAST_TRADE",
      bridgeGate: { gateId: "TRADES_BRIDGE_CONTRAST_V2", decision: "REPORTED", perArm: { BASELINE: { metrics: [{ id: "FILL_PRICE", status: "REPORTED", tob: 100, trades: 101, delta: 1 }] } } },
    }] },
  } });
  assert.equal(reported.results.status, "REPORTED");
  const withWinner = { ...reported, frozenContract: { ...reported.frozenContract, candidate: { ...reported.frozenContract.candidate, freshnessSelection: { ...reported.frozenContract.candidate.freshnessSelection, results: { GAS_QUARTERLY: { missionKey: "GAS_QUARTERLY", selectedSeconds: 1800 } } } } } };
  const html = renderSurfacePage("backtests", { ...canonicalVms.backtests, tradesPanels: withWinner }, { mode: "TRADES", missionId: "GAS_QUARTERLY", period: "PUENTE" });
  assert.match(html, /900 \/ 1800 \/ 3600 \/ 14400 \/ 86400/);
  assert.match(html, /GAS_QUARTERLY 1800/);
  assert.match(html, /data-tr09-contrast="GAS_QUARTERLY\|LAST_TRADE\|BASELINE\|FILL_PRICE"/);
  assert.match(html, /TOB 100.*TRADES 101/);
});

test("TR-07 fail-closed: un artifact que no coincide con el hash del manifest no se carga", () => {
  const root = createTempDir("tr07-");
  const tr02 = path.join(root, "operations/trades/TR-02");
  mkdirSync(tr02, { recursive: true });
  const manifest = readJson(TRADES_PANEL_ARTIFACTS.zonePlan.manifest);
  writeFileSync(path.join(root, TRADES_PANEL_ARTIFACTS.zonePlan.manifest), JSON.stringify(manifest));
  // El artifact en disco no es el que acredita el manifest.
  writeFileSync(path.join(root, TRADES_PANEL_ARTIFACTS.zonePlan.artifact), JSON.stringify({ ...zonePlan, decision: "TAMPERED" }));
  const tampered = loadTradesPanelsAt(root);
  assert.equal(tampered.zonePlan.ok, false);
  assert.equal(tampered.zonePlan.code, "TRADES_PANEL_HASH_MISMATCH");
  const vm = projectTradesPanels(tampered);
  assert.equal(vm.coverage.status, "ERROR");
  assert.equal(vm.zones.status, "ERROR");
  assert.equal(vm.coverage.missions, undefined);
  rmSync(root, { recursive: true, force: true });
});

test("TR-07 fail-closed: sin plan verificado la cobertura y las zonas son ERROR, no valor", () => {
  const empty = projectTradesPanels({ sourceDecision: { ok: false, code: "MISSING" }, zonePlan: { ok: false, code: "MISSING" }, bridgeStatus: { ok: false, code: "MISSING" }, bridgeMeasurement: { ok: false } });
  assert.equal(empty.ok, false);
  assert.equal(empty.selector.status, "ERROR");
  assert.deepEqual(empty.selector.marketMissions, []);
  assert.equal(empty.coverage.status, "ERROR");
  assert.equal(empty.zones.status, "ERROR");
  assert.equal(empty.calibration.status, "ERROR");
  assert.equal(empty.frozenContract.status, "UNAVAILABLE");
  assert.equal(empty.results.status, "UNAVAILABLE");
});

// UI-07: la penalización trade->ask y la distribución (observación − ask) son
// diferencias medidas en €/MWh, no precios; ningún precio de trade ni ask viaja.
test("TR-07: el soporte backend no abre ninguna columna de precio", () => {
  const serialized = JSON.stringify(panels);
  for (const priceField of ["Px", "AskPx", "BidPx", "tradePrice", "askPrice", "\"price\""]) {
    assert.equal(serialized.includes(priceField), false, `no debe exponer ${priceField}`);
  }
});

test("TR-07: la procedencia identifica el artifact y su manifest", () => {
  assert.equal(panels.provenance.zonePlan.path, TRADES_PANEL_ARTIFACTS.zonePlan.artifact);
  assert.equal(panels.provenance.zonePlan.manifestPath, TRADES_PANEL_ARTIFACTS.zonePlan.manifest);
  assert.equal(panels.provenance.bridgeStatus.path, TRADES_PANEL_ARTIFACTS.bridgeStatus.artifact);
  assert.equal(panels.provenance.bridgeMeasurement.path, TRADES_PANEL_ARTIFACTS.bridgeMeasurement.artifact);
  assert.equal(panels.provenance.tradesFreeze.path, TRADES_PANEL_ARTIFACTS.tradesFreeze.artifact);
});

test("TR-07 gate: el prototipo no pinta ceros no medidos y muestra el estado de la fuente TR-01", () => {
  const html = readFileSync(path.join(DEFAULT_REPO_ROOT, "operations/trades/TR-07/prototipo-tr07.html"), "utf8");
  assert.equal(/0 \/ \d+ d/.test(html), false, "no debe mostrar '0 / N d' como si la cobertura se hubiera medido");
  assert.ok(html.includes("PENDING_ARCHIVE_VERIFICATION"), "el prototipo debe mostrar el estado real del artifact TR-01");
});

// ---------- UI productiva (gate cerrado P-010, opción B) ----------

const canonicalVms = buildUiViewModels(loadCanonicalUiInputs().inputs);

function renderBacktests(selection) {
  return renderSurfacePage("backtests", canonicalVms.backtests, selection);
}

test("TR-07 UI: la pantalla de Backtests dibuja selector y paneles con los estados reales", () => {
  const html = renderBacktests({ mode: "TRADES", missionId: "GAS_QUARTERLY", period: "PUENTE" });
  // Selector de mercado/misión y modo TOB · TRADES (TRADES_MODE_PLAN.md TR-07:73).
  assert.match(html, /data-tr07="selector"/);
  assert.match(html, /data-tr07-mode="TOB"/);
  assert.match(html, /data-tr07-mode="TRADES"/);
  for (const missionId of ["GAS_QUARTERLY", "GAS_MONTHLY", "POWER_QUARTERLY", "POWER_MONTHLY"]) {
    assert.ok(html.includes(`data-tr07-mission="${missionId}"`), missionId);
  }
  // Los cinco paneles del plan (cobertura, zonas, calibración, contrato, resultados).
  for (const panel of ["coverage", "zones", "calibration", "frozenContract", "results"]) {
    assert.ok(html.includes(`data-tr07="${panel}"`), panel);
  }
  // Estados reales mostrados como tales; una ventana anterior a la fuente no es cero.
  assert.ok(html.includes(sourceDecision.status));
  assert.ok(html.includes("MEASURED"));
  assert.ok(html.includes("PENDING_MEASUREMENT"));
  assert.ok(html.includes("BEFORE_SOURCE_START"));
  assert.ok(html.includes("— / 62 d"), "la ventana estructural se conserva y lo que la fuente no trae sale —");
});

test("TR-07 UI: el modo parametriza el texto de observación (best ask vs last trade/VWAP)", () => {
  const tob = renderBacktests({ mode: "TOB" });
  assert.ok(tob.includes("real EEX best ask"));
  assert.equal(tob.includes("last trade · slot VWAP"), false);
  assert.equal(tob.includes('data-tr07="trades-observation"'), false);
  const trades = renderBacktests({ mode: "TRADES" });
  assert.ok(trades.includes("last trade · slot VWAP"));
  assert.equal(trades.includes("real EEX best ask"), false);
  assert.ok(trades.includes('data-tr07="trades-observation"'));
  // La fuente TRADES no se inventa: motor/runs pendientes, fail-closed.
  assert.ok(trades.includes("TR-05"));
  assert.ok(trades.includes("TR-06"));
});

test("TR-07 UI: cada resultado de cobertura lleva su zona y su estado de artifact", () => {
  const html = renderBacktests({ mode: "TRADES", missionId: "POWER_MONTHLY" });
  assert.match(html, /data-tr07="coverage" data-mission="POWER_MONTHLY"/);
  assert.ok(html.includes('data-tr07-campaign="POW-M-2020-12"'));
  assert.ok(html.includes(">DEVELOPMENT<"));
  assert.ok(html.includes("OBSERVED"));
});

test("TR-07 UI: sin view model de paneles la sección TR-07 queda fuera (fail-closed)", () => {
  const bare = buildBacktestsViewModel({ backendIndex: null, rows: [] });
  const html = renderSurfacePage("backtests", bare, { mode: "TRADES" });
  assert.equal(html.includes('data-tr07="selector"'), false);
  assert.equal(html.includes('data-tr07="coverage"'), false);
  assert.equal(html.includes('data-tr07="trades-observation"'), false);
});

test("TR-07 UI: el servidor acepta el modo por query y lo refleja, sin romper rutas", async () => {
  const canonical = loadCanonicalUiInputs();
  const started = createUiServer({ inputs: canonical.inputs, backend: canonical.backend, port: 0 });
  const served = await started.ready;
  try {
    const base = served.url.slice(0, -1);
    const ok = await fetch(`${base}/backtests?mode=TRADES&mission=GAS_MONTHLY&period=DEVELOPMENT`);
    assert.equal(ok.status, 200);
    const html = await ok.text();
    assert.match(html, /data-tr07-mode="TRADES"/);
    assert.match(html, /data-tr07="selector"/);
    assert.match(html, /data-tr07="coverage" data-mission="GAS_MONTHLY"/);
    assert.ok(html.includes("last trade · slot VWAP"));
    // Un modo desconocido cae al default TOB, nunca se inventa un modo.
    const fallback = await fetch(`${base}/backtests?mode=NOPE`);
    assert.equal(fallback.status, 200);
    const fallbackHtml = await fallback.text();
    assert.ok(fallbackHtml.includes("real EEX best ask"));
    assert.equal(fallbackHtml.includes("last trade · slot VWAP"), false);
    // La ruta no canónica sigue siendo 404.
    const missing = await fetch(`${base}/backtests-extra`);
    assert.equal(missing.status, 404);
  } finally {
    await new Promise((resolve) => started.server.close(resolve));
  }
});

test("TR-07 UI: la misión elegida filtra la vista TOB (plan :73; prototipo tobView)", () => {
  // Tras DATA-01 existe el release v3 de Power (BT-06): Power muestra su producto,
  // nunca los de Gas.
  const power = renderBacktests({ mode: "TOB", missionId: "POWER_MONTHLY" });
  assert.equal(power.includes('data-product="G0BQ"'), false, "Power no debe mostrar la comparación de Gas Q");
  assert.equal(power.includes('data-product="G0BM"'), false, "Power no debe mostrar la comparación de Gas M");
  assert.ok(power.includes('data-product="DEBM"'));

  const gasMonthly = renderBacktests({ mode: "TOB", missionId: "GAS_MONTHLY" });
  assert.equal(gasMonthly.includes('data-product="G0BQ"'), false);
  assert.ok(gasMonthly.includes('data-product="G0BM"'));

  const gasQuarterly = renderBacktests({ mode: "TOB", missionId: "GAS_QUARTERLY" });
  assert.ok(gasQuarterly.includes('data-product="G0BQ"'));
  assert.equal(gasQuarterly.includes('data-product="G0BM"'), false);
});

test("TR-07 UI: los botones de misión usan las etiquetas del prototipo (plan :73)", () => {
  const html = renderBacktests({ mode: "TOB" });
  for (const label of ["Gas Quarterly", "Gas Monthly", "Power Quarterly", "Power Monthly"]) {
    assert.ok(html.includes(`>${label}</a>`), label);
  }
  assert.equal(html.includes("GAS_THE · GAS_QUARTERLY"), false, "no debe mostrar el código crudo como etiqueta");
});

test("TR-07 UI: la barra de zonas sigue al periodo elegido (plan :75)", () => {
  const highlighted = (html) => [...html.matchAll(/class="([^"]*)" data-tr07-zone="([^"]+)"/g)]
    .filter(([, classes]) => classes.includes("hl")).map(([, , zone]) => zone);

  assert.deepEqual(highlighted(renderBacktests({ mode: "TRADES", period: "DEVELOPMENT" })), ["DEVELOPMENT"]);
  assert.deepEqual(highlighted(renderBacktests({ mode: "TRADES", period: "OOS_HISTORICO" })), ["OOS_HISTORICO"]);
  assert.deepEqual(highlighted(renderBacktests({ mode: "TRADES" })), ["DEVELOPMENT", "OOS_HISTORICO", "PUENTE"]);
  assert.deepEqual(highlighted(renderBacktests({ mode: "TOB" })), ["PUENTE"]);
});

test("TR-07 UI: el contraste sólo aparece con el puente en la vista (plan :76)", () => {
  const bridge = renderBacktests({ mode: "TRADES", period: "PUENTE" });
  assert.match(bridge, /data-tr07="contrast-column"[\s\S]*data-tr07="contrast"/);
  assert.equal(bridge.includes("Contrast only exists for the bridge"), false);

  const tob = renderBacktests({ mode: "TOB" });
  assert.match(tob, /data-tr07="contrast"/);

  const development = renderBacktests({ mode: "TRADES", period: "DEVELOPMENT" });
  assert.equal(development.includes('data-tr07="contrast"'), false, "sin el puente no hay panel de contraste");
  assert.match(development, /data-tr07="contrast-note"/);
  assert.ok(development.includes("Contrast only exists for the bridge, 2025-08-12 to 2026-07-28"));
});

test("TR-07 UI: el botón de expandir abre los caminos sin runs y la calibración medida (plan :77)", () => {
  const html = renderBacktests({ mode: "TRADES", period: "PUENTE" });
  assert.match(html, /data-tr07="expand"/);
  assert.ok(html.includes("Expand calibration charts"));
  assert.match(html, /data-tr07="expanded-charts"/);
  assert.match(html, /data-tr07="expanded-paths"/);
  assert.match(html, /data-tr07="expanded-calibration"/);
  assert.ok(html.includes("Not run yet"));
  // UI-07: la distribución (observación − ask) ya está medida en TR-03.
  assert.equal(html.includes("Not measured yet"), false);
  assert.match(html, /data-tr07-gap="GAS_QUARTERLY\|LAST_TRADE\|bridge"/);

  const start = html.indexOf('data-tr07="expanded-paths"');
  const end = html.indexOf('data-tr07="expanded-calibration"', start);
  const paths = html.slice(start, end);
  assert.equal(/€\/MWh|k€/.test(paths), false, "sin runs no se inventan caminos");

  const development = renderBacktests({ mode: "TRADES", period: "DEVELOPMENT" });
  assert.equal(development.includes('data-tr07="expanded-charts"'), false, "fuera del puente no hay nada que expandir");
});

test("TR-07 UI: en TRADES salen la tabla de brazos NOT RUN YET y el efecto pareado (plan :78,81)", () => {
  const html = renderBacktests({ mode: "TRADES", period: "PUENTE" });
  assert.match(html, /data-tr07="arms"/);
  for (const arm of ["Baseline · A0 11:00", "Arm A · DIP10", "Arm B · hour"]) {
    assert.ok(html.includes(arm), arm);
  }
  assert.match(html, /data-tr07="trades-paired"/);
  assert.ok(html.includes("NOT RUN YET"));

  const start = html.indexOf('data-tr07="trades-paired"');
  const end = html.indexOf('data-kind="backend-measurements"', start);
  const paired = html.slice(start, end === -1 ? undefined : end);
  assert.equal(/€\/MWh|k€/.test(paired), false, "el recuadro pareado no lleva valores inventados");
});

test("TR-07 UI: sin misión en la URL la vista es la que marca el selector (plan :72-73)", () => {
  const html = renderBacktests({ mode: "TOB" });
  // El botón por defecto marca Gas Quarterly…
  assert.match(html, /data-tr07-mission="GAS_QUARTERLY"[^>]*aria-current="true"/);
  // …y la vista TOB muestra sólo el producto de esa misión, no los dos Gas.
  assert.ok(html.includes('data-product="G0BQ"'));
  assert.equal(html.includes('data-product="G0BM"'), false);
});

test("TR-07 UI: el contraste va arriba, a ancho completo, antes de la vista del modo (Bru 2026-09-26)", () => {
  const order = (html) => {
    const contrastAt = html.indexOf('data-tr07="contrast-column"');
    const viewAt = html.indexOf('data-tr07="mode-view"');
    return { contrastAt, viewAt, above: html.slice(contrastAt, viewAt), below: html.slice(viewAt) };
  };

  // TOB: contraste + Expand arriba; la comparación (data-product) debajo, a ancho completo.
  const tob = order(renderBacktests({ mode: "TOB" }));
  assert.ok(tob.contrastAt > 0 && tob.contrastAt < tob.viewAt);
  assert.ok(tob.above.includes('data-tr07="contrast"'));
  assert.ok(tob.above.includes('data-tr07="expand"'));
  assert.ok(tob.below.includes('data-product="G0BQ"'));
  assert.ok(renderBacktests({ mode: "TOB" }).includes('<div class="tr07grid single">'));

  // TRADES + puente: contraste + Expand arriba; la observación debajo.
  const bridge = order(renderBacktests({ mode: "TRADES", period: "PUENTE" }));
  assert.ok(bridge.above.includes('data-tr07="contrast"'));
  assert.ok(bridge.below.includes('data-tr07="trades-observation"'));

  // Mientras TRADES no se haya corrido, el contraste es 1 línea plegada.
  assert.match(renderBacktests({ mode: "TOB" }), /<details class="card tr07side"[^>]*data-tr07="contrast">/);

  // Fuera del puente la línea de contraste abre la vista, antes de la observación.
  const development = renderBacktests({ mode: "TRADES", period: "DEVELOPMENT" });
  const noteAt = development.indexOf('data-tr07="contrast-note"');
  const observationAt = development.indexOf('data-tr07="trades-observation"');
  assert.ok(noteAt > 0 && noteAt < observationAt);
  assert.equal(development.includes('data-tr07="contrast"'), false);
});

test("TR-07 UI: valores desconocidos en la URL caen al default fail-closed (plan :73)", () => {
  const unknown = selectionFromSearchParams(new URLSearchParams("mode=TRADES&period=FOO&mission=XYZ"));
  assert.equal(unknown.mode, "TRADES");
  assert.equal("period" in unknown, false);
  assert.equal("missionId" in unknown, false);

  const known = selectionFromSearchParams(new URLSearchParams("mode=TRADES&period=DEVELOPMENT&mission=GAS_MONTHLY"));
  assert.equal(known.mode, "TRADES");
  assert.equal(known.period, "DEVELOPMENT");
  assert.equal(known.missionId, "GAS_MONTHLY");

  // Un modo desconocido tampoco pasa.
  const badMode = selectionFromSearchParams(new URLSearchParams("mode=NOPE"));
  assert.equal("mode" in badMode, false);
});
