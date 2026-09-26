// UI-07 (PLAN_STATUS.md UI-07, 2026-09-26): los paneles TRADES de Backtests leen las
// mediciones reales de TR-01 (cobertura), TR-03 (calibración del puente) y el
// candidato de TR-04, cada una atada por SHA-256; nada se calcula en la UI.

import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import { createTempDir } from "../helpers/tmpdir.mjs";
import path from "node:path";

import { DEFAULT_REPO_ROOT } from "../../src/pit-views/index.mjs";
import {
  LEGACY_TR01_MANIFEST_ARTIFACT_PATH,
  TRADES_MEASUREMENT_ARTIFACTS,
  verifyTradesMeasurement,
} from "../../src/trades-source/measurement-artifacts.mjs";
import { TRADES_PANEL_ARTIFACTS, loadTradesPanelsAt, projectTradesPanels } from "../../src/ui/trades-panels.mjs";
import { verifyBridgeMeasurement } from "../../operations/trades/TR-03/build-bridge-status.mjs";
import { buildManifest, repoRelativeArtifactPath } from "../../operations/trades/TR-01/aggregate-trades-rows.mjs";
import { loadCanonicalUiInputs } from "../../src/ui/canonical-inputs.mjs";
import { buildUiViewModels } from "../../src/ui/server.mjs";
import { renderSurfacePage } from "../../src/ui/render.mjs";

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const repoPath = (relative) => path.join(DEFAULT_REPO_ROOT, relative);
const readJson = (relative) => JSON.parse(readFileSync(repoPath(relative), "utf8"));

const loaded = loadTradesPanelsAt(DEFAULT_REPO_ROOT);
const panels = projectTradesPanels(loaded);
const zonePlan = readJson(TRADES_PANEL_ARTIFACTS.zonePlan.artifact);
const zonePlanManifest = readJson(TRADES_PANEL_ARTIFACTS.zonePlan.manifest);
const freeze = readJson(TRADES_PANEL_ARTIFACTS.tradesFreeze.artifact);
const gasCalendar = readJson("operations/audit/IMP-09/eex-exchange-calendar.json");

function campaignOf(missionId, campaignId) {
  const mission = panels.coverage.missions.find((entry) => entry.missionId === missionId);
  return mission.zones.flatMap((zone) => zone.campaigns).find((campaign) => campaign.campaignId === campaignId);
}

// ---------- (1) cobertura por campaign desde TR-01 ----------

test("UI-07 (1): el plan de zonas ata las dos mediciones de TR-01 por SHA-256", () => {
  assert.equal(zonePlan.coverageStatus.status, "MEASURED");
  for (const spec of Object.values(TRADES_MEASUREMENT_ARTIFACTS)) {
    const source = zonePlanManifest.sources[`tradesMeasurement_${spec.market}`];
    assert.equal(source.path, spec.path);
    assert.equal(source.sha256, sha256(readFileSync(repoPath(spec.path))), `${spec.path} stale`);
    const summary = zonePlan.coverageStatus.measurements.find((entry) => entry.market === spec.market);
    assert.equal(summary.sha256, source.sha256);
  }
  assert.equal(zonePlan.reservationBinding.sourceHashes.tradesMeasurement_GAS_THE, zonePlanManifest.sources.tradesMeasurement_GAS_THE.sha256);
});

test("UI-07 (1): días con trade y trades elegibles de una campaign = recuento independiente de TR-01", () => {
  const measurement = readJson(TRADES_MEASUREMENT_ARTIFACTS.GAS_THE.path);
  const campaign = campaignOf("GAS_QUARTERLY", "GAS-Q-2026Q1");
  const { windowStart, windowEnd } = campaign;
  const windowDays = new Set(gasCalendar.exchangeDays.filter((day) => day >= windowStart && day <= windowEnd));
  const records = measurement.coverage.filter((record) => record.shortCode === "G0BQ" && record.maturity === "202601" && windowDays.has(record.trdDate));
  const days = new Set(records.map((record) => record.trdDate));
  const trades = records.reduce((sum, record) => sum + record.eligibleCount, 0);
  assert.equal(campaign.coverage.status, "OBSERVED");
  assert.equal(campaign.coverage.windowDays, windowDays.size);
  assert.equal(campaign.coverage.daysWithTrades, days.size);
  assert.equal(campaign.coverage.totalEligibleTrades, trades);
  assert.ok(trades > 0);
});

test("UI-07 (1): una ventana anterior al primer día de la fuente no se presenta como cero medido", () => {
  const flagged = zonePlan.coverageStatus.campaignsBeforeSourceStart.find((entry) => entry.campaignId === "GAS-Q-2021Q2");
  assert.equal(flagged.extent, "WINDOW_BEFORE_SOURCE_START");
  const before = campaignOf("GAS_QUARTERLY", "GAS-Q-2021Q2");
  assert.equal(before.coverage.status, "BEFORE_SOURCE_START");
  assert.equal(before.coverage.daysWithTrades, null);
  assert.equal(before.coverage.totalEligibleTrades, null);
  const partial = campaignOf("GAS_QUARTERLY", "GAS-Q-2021Q3");
  assert.equal(partial.coverage.status, "PARTIAL_SOURCE_RANGE");
  // Power trae datos desde el primer Exchange Day: ninguna campaign Power queda marcada.
  assert.equal(zonePlan.coverageStatus.campaignsBeforeSourceStart.some((entry) => entry.market === "POWER_DE"), false);
});

test("UI-07 (1): la medición de TR-01 verifica por hash; el path fijo viejo sólo con su hash", () => {
  const spec = TRADES_MEASUREMENT_ARTIFACTS.GAS_THE;
  const artifactBytes = Buffer.from(JSON.stringify({ artifactKind: "TR-01_TRADES_MEASUREMENT", coverage: [] }));
  const manifestFor = (declaredPath, sha = sha256(artifactBytes)) => Buffer.from(JSON.stringify({ artifactKind: "TR-01_TRADES_MEASUREMENT_MANIFEST", artifact: { path: declaredPath, sha256: sha } }));
  assert.equal(verifyTradesMeasurement({ spec, artifactBytes, manifestBytes: manifestFor(spec.path) }).ok, true);
  assert.equal(verifyTradesMeasurement({ spec, artifactBytes, manifestBytes: manifestFor(LEGACY_TR01_MANIFEST_ARTIFACT_PATH) }).ok, true);
  assert.equal(verifyTradesMeasurement({ spec, artifactBytes, manifestBytes: manifestFor(TRADES_MEASUREMENT_ARTIFACTS.POWER_DE.path) }).code, "TR01_MANIFEST_REF_INVALID");
  assert.equal(verifyTradesMeasurement({ spec, artifactBytes, manifestBytes: manifestFor(spec.path, "0".repeat(64)) }).code, "TR01_HASH_MISMATCH");
  assert.equal(verifyTradesMeasurement({ spec, artifactBytes: null, manifestBytes: null }).code, "TR01_MEASUREMENT_MISSING");
  assert.equal(verifyTradesMeasurement({ spec, artifactBytes, manifestBytes: null }).code, "TR01_MEASUREMENT_INCOMPLETE");
});

test("UI-07 (1): el productor de TR-01 declara en el manifest el path real del artefacto", () => {
  const outputPath = path.join(DEFAULT_REPO_ROOT, "operations/trades/TR-01/TRADES_MEASUREMENT-power-de.json");
  const artifactPath = repoRelativeArtifactPath(outputPath, DEFAULT_REPO_ROOT);
  assert.equal(artifactPath, "operations/trades/TR-01/TRADES_MEASUREMENT-power-de.json");
  const manifest = buildManifest({
    measurement: { dedup: { inputCount: 1, uniqueCount: 1, duplicates: 0 }, eligibility: { eligible: 1 } },
    artifactPath,
    artifactSha256: "a".repeat(64),
    inputPath: "/tmp/in.ndjson",
    inputSha256: "b".repeat(64),
  });
  assert.equal(manifest.artifact.path, artifactPath);
});

test("UI-07 (1): si una medición de TR-01 cambia tras construir el plan, la cobertura es ERROR", () => {
  const root = createTempDir("ui07-");
  try {
    for (const relative of [TRADES_PANEL_ARTIFACTS.zonePlan.artifact, TRADES_PANEL_ARTIFACTS.zonePlan.manifest]) {
      mkdirSync(path.dirname(path.join(root, relative)), { recursive: true });
      copyFileSync(repoPath(relative), path.join(root, relative));
    }
    for (const spec of Object.values(TRADES_MEASUREMENT_ARTIFACTS)) {
      mkdirSync(path.dirname(path.join(root, spec.path)), { recursive: true });
      writeFileSync(path.join(root, spec.path), "{}");
    }
    const tampered = loadTradesPanelsAt(root);
    assert.equal(tampered.zonePlan.code, "TRADES_PANEL_TR01_MEASUREMENT_STALE");
    assert.equal(projectTradesPanels(tampered).coverage.status, "ERROR");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ---------- (2) estado del puente ----------

test("UI-07 (2): el estado del puente es MEASURED y ata la medición por hash", () => {
  const status = readJson(TRADES_PANEL_ARTIFACTS.bridgeStatus.artifact);
  const statusManifest = readJson(TRADES_PANEL_ARTIFACTS.bridgeStatus.manifest);
  const measurementSha = sha256(readFileSync(repoPath(TRADES_PANEL_ARTIFACTS.bridgeMeasurement.artifact)));
  assert.equal(status.status, "MEASURED");
  assert.equal(status.measurement.sha256, measurementSha);
  assert.equal(status.measurement.bridgePopulationMatches, true);
  assert.equal(statusManifest.sources.measurement.sha256, measurementSha);
});

test("UI-07 (2): sin medición PENDING, con hash roto UNVERIFIED, con otra población STALE", () => {
  const bytes = Buffer.from(JSON.stringify({ status: "MEASURED", markets: { GAS_THE: { missions: { GAS_QUARTERLY: { campaigns: [{ mission: "GAS_QUARTERLY", campaignId: "GAS-Q-2026Q1" }] } } } } }));
  const manifest = { artifact: { path: "operations/trades/TR-03/bridge-measurement.json", sha256: sha256(bytes) } };
  const bridge = { GAS_QUARTERLY: ["GAS-Q-2026Q1"] };
  assert.equal(verifyBridgeMeasurement({ bytes: null, manifest: null, zonePlanSha256: "z", bridgeByMission: bridge }).status, "PENDING_SCAN_JOB");
  assert.equal(verifyBridgeMeasurement({ bytes, manifest, zonePlanSha256: "z", bridgeByMission: bridge }).status, "MEASURED");
  assert.equal(verifyBridgeMeasurement({ bytes, manifest: { artifact: { ...manifest.artifact, sha256: "0".repeat(64) } }, zonePlanSha256: "z", bridgeByMission: bridge }).status, "MEASUREMENT_UNVERIFIED");
  assert.equal(verifyBridgeMeasurement({ bytes, manifest: null, zonePlanSha256: "z", bridgeByMission: bridge }).status, "MEASUREMENT_UNVERIFIED");
  assert.equal(verifyBridgeMeasurement({ bytes, manifest, zonePlanSha256: "z", bridgeByMission: { GAS_QUARTERLY: ["GAS-Q-2026Q2"] } }).status, "MEASUREMENT_STALE");
});

test("UI-07 (2): la calibración no se muestra si la medición cargada no es la que verificó TR-03", () => {
  const other = { ...loaded.bridgeMeasurement, provenance: { ...loaded.bridgeMeasurement.provenance, sha256: "f".repeat(64) } };
  const vm = projectTradesPanels({ ...loaded, bridgeMeasurement: other });
  assert.equal(vm.calibration.status, "ERROR");
  assert.equal(vm.calibration.parameters, undefined);
});

// ---------- (3) calibración por misión y regla + gate ----------

test("UI-07 (3): frescura, cobertura y penalización por misión y regla son las del candidato TR-04", () => {
  assert.equal(panels.calibration.parameters.status, "MEASURED");
  const missions = panels.calibration.parameters.missions;
  assert.deepEqual(missions.map((entry) => entry.missionId).sort(), ["GAS_MONTHLY", "GAS_QUARTERLY", "POWER_MONTHLY", "POWER_QUARTERLY"]);
  for (const mission of missions) {
    assert.deepEqual(mission.rules.map((entry) => entry.rule), ["LAST_TRADE", "SLOT_VWAP"]);
    for (const entry of mission.rules) {
      const source = freeze.candidate.markets[mission.market].missions[mission.missionId].observations[entry.rule];
      assert.equal(entry.freshness.status, source.freshness.status);
      assert.equal(entry.freshness.limitSeconds, source.freshness.selectedSeconds);
      assert.deepEqual(entry.freshness.gridSeconds, source.freshness.candidatesSeconds);
      assert.equal(entry.freshness.coverage, null);
      assert.equal(entry.penalty.valueEurMwh, source.penalty.value);
      assert.equal(entry.penalty.observations, source.penalty.observations ?? null);
      assert.deepEqual(entry.penalty.byAggressor.map((group) => group.aggressor), (source.penalty.byAggressor ?? []).map((group) => group.aggressor));
    }
  }
  // El candidato vale para la calibración porque se derivó de ESTA medición de TR-03.
  assert.equal(freeze.candidate.generatedFrom.bridgeMeasurementSha256, loaded.bridgeMeasurement.provenance.sha256);
});

test("UI-07 (3): el gate del puente predeclarado sale del candidato, métrica por métrica", () => {
  const gate = panels.calibration.gate;
  assert.equal(gate.id, freeze.candidate.bridgeGate.id);
  assert.equal(gate.thresholdStatus, "NO_AUTOMATIC_THRESHOLD");
  assert.deepEqual(gate.metrics.map((metric) => metric.id), freeze.candidate.bridgeGate.metrics.map((metric) => metric.id));
  assert.deepEqual(gate.metrics.map((metric) => metric.description), freeze.candidate.bridgeGate.metrics.map((metric) => metric.description));
});

test("UI-07 (3): un candidato derivado de otra medición no alimenta la calibración", () => {
  const foreign = { ...freeze, candidate: { ...freeze.candidate, generatedFrom: { ...freeze.candidate.generatedFrom, bridgeMeasurementSha256: "e".repeat(64) } } };
  const vm = projectTradesPanels({ ...loaded, tradesFreeze: { ...loaded.tradesFreeze, json: foreign } });
  assert.equal(vm.calibration.parameters.status, "UNAVAILABLE");
  assert.equal(vm.calibration.parameters.code, "TR04_CANDIDATE_NOT_FROM_VERIFIED_MEASUREMENT");
  assert.deepEqual(vm.calibration.parameters.missions, []);
  assert.equal(vm.calibration.gate, null);
});

// ---------- (4) contrato candidato / FROZEN ----------

const configHash = freeze.candidate.configHash;
const approval = {
  approvalRef: "fixture-approval",
  approvedBy: { authority: "Bru", role: "OWNER" },
  decision: "APPROVED",
  scope: "TRADES_V1_FREEZE",
  approvedAtUtc: "2026-09-26T00:00:00Z",
  configHash,
};
const approvalSha = sha256(Buffer.from(JSON.stringify(approval)));

function frozenLoaded({ ownerApproval, boundSha = approvalSha }) {
  const json = { ...freeze, decision: "FROZEN", status: "FROZEN", humanGate: { ...freeze.humanGate, approvalRef: approval.approvalRef } };
  const manifest = { ...loaded.tradesFreeze.manifest, sources: { ...loaded.tradesFreeze.manifest.sources, ownerApproval: { path: "operations/trades/TR-04/OWNER_FREEZE_APPROVAL.json", sha256: boundSha } } };
  return { ...loaded, tradesFreeze: { ...loaded.tradesFreeze, json, manifest }, ownerApproval };
}

test("UI-07 (4): el candidato real sale con su configHash y pendiente de aprobación de Bru", () => {
  assert.equal(freeze.decision, "HOLD");
  assert.equal(panels.frozenContract.status, "PENDING_MEASUREMENT");
  assert.equal(panels.frozenContract.candidate.configHash, freeze.humanGate.configHash);
  assert.match(panels.frozenContract.candidate.configHash, /^[0-9a-f]{64}$/);
  assert.match(panels.frozenContract.reason, /TR-03 debe medir la grilla/);
  assert.deepEqual(panels.frozenContract.blockedBy, ["BRIDGE_MEASUREMENT_GRID_STALE"]);
  // Sin OWNER_FREEZE_APPROVAL.json en el repo.
  assert.equal(loaded.ownerApproval.present, false);
});

test("UI-07 (4): FROZEN sólo con OWNER_FREEZE_APPROVAL.json válido y atado al manifest", () => {
  const valid = projectTradesPanels(frozenLoaded({ ownerApproval: { present: true, json: approval, sha256: approvalSha } }));
  assert.equal(valid.frozenContract.status, "FROZEN");
  assert.equal(valid.frozenContract.approvalRef, "fixture-approval");

  const missing = projectTradesPanels(frozenLoaded({ ownerApproval: { present: false } }));
  assert.equal(missing.frozenContract.status, "ERROR");
  assert.equal(missing.frozenContract.code, "OWNER_APPROVAL_MISSING");

  const unbound = projectTradesPanels(frozenLoaded({ ownerApproval: { present: true, json: approval, sha256: approvalSha }, boundSha: "0".repeat(64) }));
  assert.equal(unbound.frozenContract.code, "OWNER_APPROVAL_NOT_BOUND");

  const otherConfig = { ...approval, configHash: "1".repeat(64) };
  const otherSha = sha256(Buffer.from(JSON.stringify(otherConfig)));
  const wrongHash = projectTradesPanels(frozenLoaded({ ownerApproval: { present: true, json: otherConfig, sha256: otherSha }, boundSha: otherSha }));
  assert.equal(wrongHash.frozenContract.code, "APPROVAL_HASH_MISMATCH");

  const policy = { ...approval, approvedBy: { authority: "policy", role: "POLICY" } };
  const policySha = sha256(Buffer.from(JSON.stringify(policy)));
  const byPolicy = projectTradesPanels(frozenLoaded({ ownerApproval: { present: true, json: policy, sha256: policySha }, boundSha: policySha }));
  assert.equal(byPolicy.frozenContract.code, "APPROVAL_AUTHORITY_INVALID");
});

test("UI-07 (4): sin freeze verificado el contrato queda UNAVAILABLE, sin versión inventada", () => {
  const vm = projectTradesPanels({ ...loaded, tradesFreeze: { ok: false, code: "TRADES_PANEL_HASH_MISMATCH" } });
  assert.equal(vm.frozenContract.status, "UNAVAILABLE");
  assert.equal(vm.frozenContract.candidate, undefined);
});

// ---------- (5) render: mismo diseño TR-07, cero cálculo ----------

const canonicalVms = buildUiViewModels(loadCanonicalUiInputs().inputs);
const render = (selection) => renderSurfacePage("backtests", canonicalVms.backtests, selection);

test("UI-07 (5): la UI dibuja las cifras medidas tal cual las trae el view model", () => {
  const html = render({ mode: "TRADES", missionId: "GAS_QUARTERLY", period: "PUENTE" });
  const campaign = campaignOf("GAS_QUARTERLY", "GAS-Q-2026Q1");
  assert.ok(html.includes(`${campaign.coverage.daysWithTrades} / ${campaign.coverage.windowDays} d`));
  assert.ok(html.includes(`data-tr07-eligible-trades="${campaign.coverage.totalEligibleTrades}"`));
  const lastTrade = panels.calibration.parameters.missions.find((entry) => entry.missionId === "GAS_QUARTERLY").rules[0];
  assert.match(html, /data-tr07-calibration="GAS_QUARTERLY\|LAST_TRADE"/);
  assert.equal(lastTrade.penalty.valueEurMwh, null);
  assert.ok(html.includes("PENDING DEVELOPMENT"));
  for (const metric of panels.calibration.gate.metrics) {
    assert.ok(html.includes(`data-tr07-gate-metric="${metric.id}"`), metric.id);
    assert.ok(html.includes(`data-tr07-contrast-metric="${metric.id}"`), metric.id);
  }
  assert.ok(html.includes(`data-tr07-config-hash="${configHash}"`));
  assert.ok(html.includes("TR-03 debe medir la grilla"));
  assert.ok(html.includes(`data-tr07-measurement-sha="${loaded.bridgeMeasurement.provenance.sha256}"`));
});

test("UI-07 (5): sin paneles nuevos; el conjunto de tarjetas TR-07 es el del diseño aprobado", () => {
  const html = render({ mode: "TRADES", missionId: "GAS_QUARTERLY", period: "PUENTE" });
  const cards = [...new Set([...html.matchAll(/data-tr07="([^"]+)"/g)].map((match) => match[1]))].sort();
  assert.deepEqual(cards, [
    "arms", "bridge-gate", "calibration", "contrast", "contrast-column", "coverage", "expand", "expanded-calibration",
    "expanded-charts", "expanded-paths", "frozenContract", "mode-view", "results", "selector", "trades-observation",
    "trades-paired", "zones",
  ]);
  // "bridge-gate" es un bloque dentro de la tarjeta de calibración, no una tarjeta.
  const calibrationStart = html.indexOf('data-tr07="calibration"');
  const gateAt = html.indexOf('data-tr07="bridge-gate"');
  const nextCard = html.indexOf('data-tr07="frozenContract"');
  assert.ok(calibrationStart < gateAt && gateAt < nextCard);
});

test("UI-07 (5): render.mjs no deriva cifras de los paneles TRADES (sin aritmética sobre medidas)", () => {
  const source = readFileSync(repoPath("src/ui/render.mjs"), "utf8");
  const start = source.indexOf("// ---------- TR-07: paneles TRADES");
  const end = source.indexOf("function tr07ScopeHtml");
  const tr07 = source.slice(start, end);
  for (const forbidden of [/penalty\w*\s*[*/+-]\s*\d/, /coverage\s*\*\s*100/, /\.reduce\(/, /Math\.(round|floor|ceil)\(/]) {
    assert.equal(forbidden.test(tr07), false, String(forbidden));
  }
});
