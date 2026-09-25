// TR-07 (TRADES_MODE_PLAN.md TR-07; patch 03 §3–§4): soporte backend de los
// paneles TRADES de Backtests. Estos tests fijan que cada panel sale de un
// artifact atado por SHA-256 y que lo ausente queda UNAVAILABLE, nunca un valor.
// La composición visual (render.mjs) queda fuera por el gate de Bru.

import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { DEFAULT_REPO_ROOT } from "../../src/pit-views/index.mjs";
import {
  TRADES_MODES,
  TRADES_PANEL_ARTIFACTS,
  loadTradesPanelsAt,
  projectTradesPanels,
} from "../../src/ui/trades-panels.mjs";

const loaded = loadTradesPanelsAt(DEFAULT_REPO_ROOT);
const panels = projectTradesPanels(loaded);

function readJson(relativePath) {
  return JSON.parse(readFileSync(path.join(DEFAULT_REPO_ROOT, relativePath), "utf8"));
}

const zonePlan = readJson(TRADES_PANEL_ARTIFACTS.zonePlan.artifact);
const bridgeStatus = readJson(TRADES_PANEL_ARTIFACTS.bridgeStatus.artifact);
const sourceDecision = readJson(TRADES_PANEL_ARTIFACTS.sourceDecision.artifact);

test("TR-07: los tres artifacts de panel se cargan y atan por hash a su manifest", () => {
  for (const name of ["sourceDecision", "zonePlan", "bridgeStatus"]) {
    assert.equal(loaded[name].ok, true, `${name}: ${loaded[name].code ?? ""}`);
    assert.equal(typeof loaded[name].provenance.sha256, "string", name);
    assert.match(loaded[name].provenance.sha256, /^[0-9a-f]{64}$/, name);
  }
  // La medición del puente aún no existe: es un estado, no un error de carga.
  assert.equal(loaded.bridgeMeasurement.ok, false);
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
  assert.equal(panels.coverage.status, "PENDING_SCAN_JOB");
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
        assert.equal(campaign.coverage.status, source.coverage.status);
        assert.equal(campaign.coverage.daysWithTrades, source.coverage.daysWithTrades);
        assert.equal(campaign.coverage.totalEligibleTrades, source.coverage.totalEligibleTrades);
      }
    }
  }
});

test("TR-07 cobertura: sin escaneo el estado es NO_COVERAGE con días y trades en cero declarados", () => {
  const quarterly = panels.coverage.missions.find((mission) => mission.missionId === "GAS_QUARTERLY");
  const development = quarterly.zones.find((zone) => zone.zone === "DEVELOPMENT");
  assert.ok(development.campaigns.length > 0);
  for (const campaign of development.campaigns) {
    assert.equal(campaign.coverage.status, "NO_COVERAGE");
    assert.equal(campaign.coverage.daysWithTrades, 0);
    assert.equal(campaign.coverage.totalEligibleTrades, 0);
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

test("TR-07 calibración: PENDING_SCAN_JOB con su ventana, límites y reglas del artifact", () => {
  assert.equal(panels.calibration.status, bridgeStatus.status);
  assert.equal(panels.calibration.status, "PENDING_SCAN_JOB");
  assert.equal(panels.calibration.measurement.status, "PENDING_SCAN_JOB");
  assert.deepEqual(panels.calibration.freshnessLimitsSeconds, bridgeStatus.freshnessLimitsSeconds);
  assert.deepEqual(panels.calibration.observationRules, bridgeStatus.observationRules);
  assert.equal(panels.calibration.bridgeCampaigns.count, bridgeStatus.bridgeCampaigns.count);
  assert.equal(panels.calibration.window.zone, "PUENTE");
  // Ninguna medición se inventa mientras el job no corra.
  assert.equal(panels.calibration.measurement.content, undefined);
});

test("TR-07 contrato congelado y resultados: UNAVAILABLE, sin versión ni run fabricados", () => {
  assert.equal(panels.frozenContract.status, "UNAVAILABLE");
  assert.equal(panels.frozenContract.brokenSpreadPolicy, sourceDecision.brokenSpreadPolicy);
  assert.match(panels.frozenContract.reason, /TR-04/);
  assert.equal(panels.results.status, "UNAVAILABLE");
  assert.match(panels.results.reason, /TR-06/);
});

test("TR-07 fail-closed: un artifact que no coincide con el hash del manifest no se carga", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "tr07-"));
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

test("TR-07: el soporte backend no abre ninguna columna de precio", () => {
  const serialized = JSON.stringify(panels);
  for (const priceField of ["Px", "AskPx", "BidPx", "EurMwh", "eurMwh"]) {
    assert.equal(serialized.includes(priceField), false, `no debe exponer ${priceField}`);
  }
});

test("TR-07: la procedencia identifica el artifact y su manifest", () => {
  assert.equal(panels.provenance.zonePlan.path, TRADES_PANEL_ARTIFACTS.zonePlan.artifact);
  assert.equal(panels.provenance.zonePlan.manifestPath, TRADES_PANEL_ARTIFACTS.zonePlan.manifest);
  assert.equal(panels.provenance.bridgeStatus.path, TRADES_PANEL_ARTIFACTS.bridgeStatus.artifact);
  assert.equal(panels.provenance.bridgeMeasurement, null);
});
