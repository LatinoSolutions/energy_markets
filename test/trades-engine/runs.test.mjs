import { test } from "node:test";
import assert from "node:assert/strict";

import { CLIENT_SLOT } from "../../src/exploratory/backtest.mjs";
import { SLOT_LABELS, HALVES } from "../../src/trades-bridge/constants.mjs";
import { ZONES } from "../../src/oos-reservation/trades-zones.mjs";
import { TRADES_ENGINE_MISSIONS } from "../../src/trades-engine/missions.mjs";
import {
  TRADES_OOS_INSPECTION_PURPOSE,
  TRADES_OOS_OPENING_PURPOSE,
  TRADES_PHASE_ZONES,
  TRADES_RUN_PHASES,
  evaluateBridgeForMission,
  openTradesOosForMission,
  runTradesRuns,
} from "../../src/trades-engine/runs.mjs";
import { frozenTradesResult, missionTradeAt } from "./fixtures.mjs";
import { buildTradesRunsStatus } from "../../operations/trades/TR-06/build-trades-runs-status.mjs";

const FROZEN = frozenTradesResult();

// Días sintéticos por zona. El puente empieza su mitad de evaluación el
// 2026-02-03 (bridgeHalves: 351 días, 175 de calibración), así que la campaign
// del puente se coloca entera en la evaluación.
const DEV_DAYS = ["2023-09-01", "2023-09-04", "2023-09-05", "2023-09-06", "2023-09-07", "2023-09-08"];
const DEV2_DAYS = ["2023-10-02", "2023-10-03", "2023-10-04", "2023-10-05", "2023-10-06", "2023-10-09"];
const OOS_DAYS = ["2024-09-02", "2024-09-03", "2024-09-04", "2024-09-05", "2024-09-06", "2024-09-09"];
const BRIDGE_DAYS = ["2026-02-03", "2026-02-04", "2026-02-05", "2026-02-06", "2026-02-09", "2026-02-10"];

// Identidad por misión: producto base, mercado, cmdty/area del lago y
// maturity/legacy de cada zona.
const MISSION_SPECS = Object.freeze({
  GAS_QUARTERLY: { cmdty: "NATGAS", area: "THE", dev: { maturity: "2023Q4", legacy: "202310" }, dev2: { maturity: "2023Q4", legacy: "202310" }, oos: { maturity: "2024Q4", legacy: "202410" }, bridge: { maturity: "2026Q1", legacy: "202601" } },
  GAS_MONTHLY: { cmdty: "NATGAS", area: "THE", dev: { maturity: "2023-10", legacy: "202310" }, dev2: { maturity: "2023-10", legacy: "202310" }, oos: { maturity: "2024-09", legacy: "202409" }, bridge: { maturity: "2026-02", legacy: "202602" } },
  POWER_QUARTERLY: { cmdty: "POWER", area: "DE", dev: { maturity: "2023Q4", legacy: "202310" }, dev2: { maturity: "2023Q4", legacy: "202310" }, oos: { maturity: "2024Q4", legacy: "202410" }, bridge: { maturity: "2026Q1", legacy: "202601" } },
  POWER_MONTHLY: { cmdty: "POWER", area: "DE", dev: { maturity: "2023-10", legacy: "202310" }, dev2: { maturity: "2023-10", legacy: "202310" }, oos: { maturity: "2024-09", legacy: "202409" }, bridge: { maturity: "2026-02", legacy: "202602" } },
});

function campaignFor({ missionKey, definition, spec, zone, maturity, legacy, days, suffix }) {
  return {
    campaignId: `${missionKey}-${suffix}`,
    product: definition.product,
    mission: definition.mission,
    market: definition.market,
    shortCode: definition.shortCode,
    maturity,
    legacyMaturity: legacy,
    zone,
    windowStart: days[0],
    windowEnd: days[days.length - 1],
    deadline: days[days.length - 1],
  };
}

function rowsFor({ spec, definition, days, legacy, price }) {
  return days.map((day) => missionTradeAt({
    cmdty: spec.cmdty,
    area: spec.area,
    shortCode: definition.shortCode,
    maturity: legacy,
    day,
    slot: CLIENT_SLOT,
    price,
  }));
}

function tobSeriesFor({ definition, legacy, days, ask }) {
  const slots = SLOT_LABELS.map((label) => (label === CLIENT_SLOT ? { ask, askSz: 10, bid: ask - 1, quoteTm: null } : null));
  const byDay = Object.fromEntries(days.map((day) => [day, slots]));
  return new Map([[`${definition.shortCode}|${legacy}`, byDay]]);
}

// Zona plan RESERVED con las 4 misiones × 3 zonas, más filas y serie TOB. Los
// precios son sintéticos; sólo prueban la orquestación.
export function buildFixture() {
  const rows = [];
  const tobSeries = new Map();
  const exchangeDays = new Set([...DEV_DAYS, ...DEV2_DAYS, ...OOS_DAYS, ...BRIDGE_DAYS]);
  const missions = {};
  const accessRegistry = {
    oosStatus: "SEALED",
    oosStatusByMission: Object.fromEntries(Object.keys(TRADES_ENGINE_MISSIONS).map((key) => [key, "SEALED"])),
    oosOpeningsByMission: Object.fromEntries(Object.keys(TRADES_ENGINE_MISSIONS).map((key) => [key, 0])),
    entries: [],
  };

  for (const [missionKey, definition] of Object.entries(TRADES_ENGINE_MISSIONS)) {
    const spec = MISSION_SPECS[missionKey];
    const devCampaign = campaignFor({ missionKey, definition, spec, zone: ZONES.DEVELOPMENT, maturity: spec.dev.maturity, legacy: spec.dev.legacy, days: DEV_DAYS, suffix: "DEV-1" });
    const dev2Campaign = campaignFor({ missionKey, definition, spec, zone: ZONES.DEVELOPMENT, maturity: spec.dev2.maturity, legacy: spec.dev2.legacy, days: DEV2_DAYS, suffix: "DEV-2" });
    const oosCampaign = campaignFor({ missionKey, definition, spec, zone: ZONES.OOS_HISTORICO, maturity: spec.oos.maturity, legacy: spec.oos.legacy, days: OOS_DAYS, suffix: "OOS" });
    const bridgeCampaign = campaignFor({ missionKey, definition, spec, zone: ZONES.PUENTE, maturity: spec.bridge.maturity, legacy: spec.bridge.legacy, days: BRIDGE_DAYS, suffix: "BRIDGE" });
    missions[missionKey] = {
      product: definition.product,
      mission: definition.mission,
      market: definition.market,
      shortCode: definition.shortCode,
      zones: {
        [ZONES.DEVELOPMENT]: [devCampaign, dev2Campaign],
        [ZONES.OOS_HISTORICO]: [oosCampaign],
        [ZONES.PUENTE]: [bridgeCampaign],
        [ZONES.EMBARGO]: [],
        [ZONES.POST_PUENTE]: [],
        [ZONES.FORWARD]: [],
      },
    };
    rows.push(...rowsFor({ spec, definition, days: DEV_DAYS, legacy: spec.dev.legacy, price: 100 }));
    rows.push(...rowsFor({ spec, definition, days: DEV2_DAYS, legacy: spec.dev2.legacy, price: 100 }));
    rows.push(...rowsFor({ spec, definition, days: OOS_DAYS, legacy: spec.oos.legacy, price: 100 }));
    rows.push(...rowsFor({ spec, definition, days: BRIDGE_DAYS, legacy: spec.bridge.legacy, price: 100 }));
    for (const [contract, byDay] of tobSeriesFor({ definition, legacy: spec.bridge.legacy, days: BRIDGE_DAYS, ask: 100 })) {
      tobSeries.set(contract, byDay);
    }
  }

  const zonePlan = {
    artifactKind: "TR-02_TRADES_ZONE_PLAN",
    schemaVersion: "TRADES_ZONES_V1",
    decision: "RESERVED",
    missions,
    purge: [],
    bridge: { seenCampaignIds: [], notSeenCampaignIds: [] },
    accessRegistry,
  };
  return { zonePlan, rows, exchangeDays: [...exchangeDays].sort(), tobSeries };
}

function runAll(overrides = {}) {
  const fixture = buildFixture();
  return runTradesRuns({
    zonePlan: fixture.zonePlan,
    rows: fixture.rows,
    exchangeDays: fixture.exchangeDays,
    tobSeries: fixture.tobSeries,
    frozenContract: FROZEN,
    codeCommit: "deadbeef",
    dataManifest: { files: [] },
    parameters: { phase: "TR-06" },
    memoryPeak: { childMaxRssKb: 53000, cgroupMemoryPeakBytesAfter: 1000000 },
    atUtc: "2026-09-26T00:00:00Z",
    actor: "Bru",
    ...overrides,
  });
}

test("runTradesRuns corre las 4 misiones en las 3 fases y las 2 reglas (24 runs)", () => {
  const result = runAll();
  assert.equal(result.ok, true, JSON.stringify(result.blocks));
  assert.equal(result.status, "RUN");
  assert.equal(result.runs.length, 4 * 3 * 2);
  const missionsSeen = new Set(result.runs.map((run) => run.missionKey));
  assert.deepEqual([...missionsSeen].sort(), Object.keys(TRADES_ENGINE_MISSIONS).sort());
  for (const run of result.runs) {
    assert.equal(run.zone, TRADES_PHASE_ZONES[run.phase]);
    assert.match(run.runId, /^BT-RUN-[0-9a-f]{64}$/);
    assert.equal(run.identity.zone, run.zone);
    assert.equal(run.identity.observationRule, run.observationRule);
    assert.equal(run.identity.configHash, FROZEN.contract.configHash);
    assert.equal(run.manifest.jobKind, "TRADES_BACKTEST");
    assert.equal(run.manifest.memoryPeak.childMaxRssKb, 53000);
  }
});

test("el pico de RAM por run sale del runner y nunca se inventa", () => {
  const withPeak = runAll();
  assert.equal(withPeak.runs.every((run) => run.manifest.memoryPeak.childMaxRssKb === 53000), true);
  const withoutPeak = runAll({ memoryPeak: null });
  assert.equal(withoutPeak.runs.every((run) => run.manifest.memoryPeak === null), true);
});

test("Development es walk-forward: el primer episodio no corre HOUR y el siguiente sí", () => {
  const result = runAll();
  const devRuns = result.runs.filter((run) => run.phase === TRADES_RUN_PHASES.DEVELOPMENT && run.observationRule === "LAST_TRADE");
  assert.equal(devRuns.length, 4);
  for (const run of devRuns) {
    const first = run.scoring.find((campaign) => campaign.campaignId.endsWith("DEV-1"));
    const second = run.scoring.find((campaign) => campaign.campaignId.endsWith("DEV-2"));
    assert.equal(first.hour, null);
    assert.equal(first.arms.HOUR.status, "NOT_RUN_NO_HISTORY");
    assert.equal(second.hour, CLIENT_SLOT);
    assert.equal(second.arms.HOUR.status, "COMPLETE");
  }
});

test("el puente evalúa el gate de TR-04 en la mitad de evaluación, por brazo", () => {
  const result = runAll();
  const bridgeRuns = result.runs.filter((run) => run.phase === TRADES_RUN_PHASES.BRIDGE);
  assert.equal(bridgeRuns.length, 4 * 2);
  for (const run of bridgeRuns) {
    assert.equal(run.bridgeGate.half, HALVES.EVALUATION);
    assert.equal(run.bridgeGate.gateId, "TRADES_BRIDGE_GATE_V1");
    assert.deepEqual(Object.keys(run.bridgeGate.perArm).sort(), ["BASELINE", "DIP10", "HOUR"]);
    assert.equal(run.bridgeGate.perArm.BASELINE.decision, "PASS");
    assert.equal(run.bridgeGate.perArm.BASELINE.decisionDaysCompared, BRIDGE_DAYS.length);
    assert.equal(run.bridgeGate.decision, "PASS");
  }
});

test("sin serie TOB el gate del puente nunca queda PASS (no se inventa un PASS parcial)", () => {
  const result = runAll({ tobSeries: new Map() });
  const bridgeRun = result.runs.find((run) => run.phase === TRADES_RUN_PHASES.BRIDGE && run.observationRule === "LAST_TRADE");
  assert.notEqual(bridgeRun.bridgeGate.perArm.BASELINE.decision, "PASS");
  assert.notEqual(bridgeRun.bridgeGate.decision, "PASS");
});

test("evaluateBridgeForMission ignora las decisiones fuera de la mitad de evaluación", () => {
  const fixture = buildFixture();
  // La campaign del puente se mueve a la calibración: el gate no tiene días que
  // comparar y queda HOLD, nunca PASS con datos de la mitad de calibración.
  for (const mission of Object.values(fixture.zonePlan.missions)) {
    for (const campaign of mission.zones[ZONES.PUENTE]) {
      campaign.windowStart = "2025-09-01";
      campaign.windowEnd = "2025-09-08";
      campaign.deadline = "2025-09-08";
    }
  }
  const calibrationDays = ["2025-09-01", "2025-09-02", "2025-09-03", "2025-09-04", "2025-09-05", "2025-09-08"];
  const rows = fixture.rows.filter((row) => !calibrationDays.includes(row.TrdDate));
  const result = runTradesRuns({
    zonePlan: fixture.zonePlan,
    rows,
    exchangeDays: [...new Set([...fixture.exchangeDays, ...calibrationDays])].sort(),
    tobSeries: fixture.tobSeries,
    frozenContract: FROZEN,
    codeCommit: "deadbeef",
    dataManifest: { files: [] },
    atUtc: "2026-09-26T00:00:00Z",
  });
  const bridgeRun = result.runs.find((run) => run.phase === TRADES_RUN_PHASES.BRIDGE && run.observationRule === "LAST_TRADE");
  assert.equal(bridgeRun.bridgeGate.perArm.BASELINE.decisionDaysCompared, 0);
  assert.equal(bridgeRun.bridgeGate.perArm.BASELINE.decision, "HOLD");
  assert.equal(bridgeRun.bridgeGate.decision, "HOLD");
});

test("el OOS histórico abre el sello UNA vez por misión y registra cada lectura", () => {
  const result = runAll();
  const oosRuns = result.runs.filter((run) => run.phase === TRADES_RUN_PHASES.OOS);
  assert.equal(oosRuns.length, 4 * 2);
  for (const run of oosRuns) {
    assert.notEqual(run.oosAccess, null);
    if (run.observationRule === "LAST_TRADE") {
      assert.equal(run.oosAccess.purpose, TRADES_OOS_OPENING_PURPOSE);
    } else {
      assert.equal(run.oosAccess.purpose, TRADES_OOS_INSPECTION_PURPOSE);
    }
  }
  // Una apertura que consume por misión; la regla secundaria inspecciona la
  // misma apertura y queda registrada sin consumir el sello una segunda vez.
  assert.deepEqual(result.oosAccess.oosOpeningsByMission, {
    GAS_QUARTERLY: 1,
    GAS_MONTHLY: 1,
    POWER_QUARTERLY: 1,
    POWER_MONTHLY: 1,
  });
  assert.deepEqual(result.oosAccess.oosStatusByMission, {
    GAS_QUARTERLY: "CONSUMED",
    GAS_MONTHLY: "CONSUMED",
    POWER_QUARTERLY: "CONSUMED",
    POWER_MONTHLY: "CONSUMED",
  });
  assert.equal(result.oosAccess.entries.filter((entry) => entry.consumesOos).length, 4);
  assert.equal(result.oosAccess.entries.length, 8);
});

test("un run_id nuevo sobre el OOS es una nueva apertura y se cuenta", () => {
  const fixture = buildFixture();
  const first = openTradesOosForMission({ plan: fixture.zonePlan, missionKey: "GAS_QUARTERLY", runId: `BT-RUN-${"a".repeat(64)}`, atUtc: "2026-09-26T00:00:00Z" });
  assert.equal(first.ok, true);
  assert.equal(first.oosOpeningsByMission.GAS_QUARTERLY, 1);
  const second = openTradesOosForMission({ plan: first.accessPlan, missionKey: "GAS_QUARTERLY", runId: `BT-RUN-${"b".repeat(64)}`, atUtc: "2026-09-26T01:00:00Z" });
  assert.equal(second.ok, true);
  assert.equal(second.oosOpeningsByMission.GAS_QUARTERLY, 2);
  assert.equal(second.oosStatusByMission.GAS_QUARTERLY, "CONSUMED");
  // Abrir Gas Quarterly no consume Power Monthly (patch 03 §4).
  assert.equal(second.oosOpeningsByMission.POWER_MONTHLY, 0);
});

test("openTradesOosForMission exige misión y run_id y un plan RESERVED", () => {
  const fixture = buildFixture();
  assert.equal(openTradesOosForMission({ plan: fixture.zonePlan, missionKey: "NOPE", runId: "x", atUtc: "2026-09-26T00:00:00Z" }).code, "MISSING_TRADES_MISSION");
  assert.equal(openTradesOosForMission({ plan: fixture.zonePlan, missionKey: "GAS_QUARTERLY", runId: null, atUtc: "2026-09-26T00:00:00Z" }).code, "MISSING_RUN_ID");
  assert.equal(openTradesOosForMission({ plan: { decision: "HOLD" }, missionKey: "GAS_QUARTERLY", runId: "x", atUtc: "2026-09-26T00:00:00Z" }).code, "ZONE_PLAN_NOT_RESERVED");
});

test("scoring por campaign y diagnóstico por día-decisión en cada run", () => {
  const result = runAll();
  const bridgeRun = result.runs.find((run) => run.phase === TRADES_RUN_PHASES.BRIDGE && run.observationRule === "LAST_TRADE" && run.missionKey === "GAS_QUARTERLY");
  assert.equal(bridgeRun.scoring.length, 1);
  const campaignScore = bridgeRun.scoring[0];
  assert.equal(campaignScore.campaignId, "GAS_QUARTERLY-BRIDGE");
  assert.deepEqual(Object.keys(campaignScore.arms).sort(), ["BASELINE", "DIP10", "HOUR"]);
  assert.equal(campaignScore.arms.BASELINE.complete, true);
  assert.equal(campaignScore.arms.BASELINE.boughtMw, 60);
  assert.equal(typeof campaignScore.deltaVKeur.HOUR, "number");
  const days = bridgeRun.diagnostics.filter((row) => row.armId === "BASELINE");
  assert.equal(days.length, BRIDGE_DAYS.length);
  assert.equal(days.every((row) => row.decision === "BUY" || row.decision === "WAIT"), true);
});

test("sin freeze FROZEN no corre ningún run (fail-closed)", () => {
  for (const frozenContract of [null, { decision: "HOLD", contract: null }, FROZEN.contract]) {
    const result = runAll({ frozenContract });
    assert.equal(result.ok, false);
    assert.equal(result.status, "BLOCKED");
    assert.equal(result.blockedBy.includes("TRADES_CONTRACT_NOT_FROZEN"), true);
    assert.equal(result.runs.length, 0);
  }
});

test("sin zona plan RESERVED no se abre el OOS y el resultado queda BLOCKED", () => {
  const fixture = buildFixture();
  const result = runAll({ zonePlan: { ...fixture.zonePlan, decision: "HOLD" } });
  assert.equal(result.ok, false);
  assert.equal(result.blockedBy.includes("ZONE_PLAN_NOT_RESERVED"), true);
  assert.equal(result.oosAccess, null);
});

test("una misión sin campaigns en alguna zona se declara como bloqueo de data", () => {
  const fixture = buildFixture();
  delete fixture.zonePlan.missions.POWER_MONTHLY.zones[ZONES.PUENTE];
  const result = runAll({ zonePlan: fixture.zonePlan });
  assert.equal(result.ok, false);
  assert.equal(result.blockedBy.includes("MISSION_WITHOUT_CAMPAIGNS"), true);
  const block = result.blocks.find((item) => item.code === "MISSION_WITHOUT_CAMPAIGNS");
  assert.equal(block.missionKey, "POWER_MONTHLY");
});

test("la identidad del run distingue fase, regla, zona y commit", () => {
  const result = runAll();
  const ids = new Set(result.runs.map((run) => run.runId));
  assert.equal(ids.size, result.runs.length);
  const other = runAll({ codeCommit: "cafebabe" });
  const firstRunId = result.runs[0].runId;
  assert.equal(other.runs.some((run) => run.runId === firstRunId), false);
});

test("el plan de accesos se encadena entre mercados (initialAccessPlan)", () => {
  const fixture = buildFixture();
  const base = {
    zonePlan: fixture.zonePlan,
    rows: fixture.rows,
    exchangeDays: fixture.exchangeDays,
    tobSeries: fixture.tobSeries,
    frozenContract: FROZEN,
    codeCommit: "deadbeef",
    dataManifest: { files: [] },
    atUtc: "2026-09-26T00:00:00Z",
  };
  const gas = runTradesRuns({ ...base, missions: ["GAS_QUARTERLY", "GAS_MONTHLY"] });
  assert.equal(gas.ok, true);
  assert.deepEqual(gas.oosAccess.oosOpeningsByMission.POWER_QUARTERLY, 0);
  const power = runTradesRuns({ ...base, missions: ["POWER_QUARTERLY", "POWER_MONTHLY"], initialAccessPlan: gas.accessPlan });
  assert.equal(power.ok, true);
  assert.deepEqual(power.oosAccess.oosOpeningsByMission, {
    GAS_QUARTERLY: 1,
    GAS_MONTHLY: 1,
    POWER_QUARTERLY: 1,
    POWER_MONTHLY: 1,
  });
});

test("el estado de TR-06 declara PENDING_FREEZE y la rejilla de 24 runs sin inventar resultados", () => {
  const status = buildTradesRunsStatus();
  assert.equal(status.status, "PENDING_FREEZE");
  assert.equal(status.blockedBy.includes("TRADES_CONTRACT_NOT_FROZEN"), true);
  assert.equal(status.freeze.decision, "HOLD");
  assert.equal(status.runsGrid.count, 4 * 3 * 2);
  assert.deepEqual([...new Set(status.runsGrid.entries.map((entry) => entry.missionKey))].sort(), Object.keys(TRADES_ENGINE_MISSIONS).sort());
  assert.equal(status.runsArtifact, "operations/trades/TR-06/trades-runs.json");
});

test("evaluateBridgeForMission es determinista y no muta sus entradas", () => {
  const fixture = buildFixture();
  const first = evaluateBridgeForMission({
    missionKey: "GAS_QUARTERLY",
    tradesResult: { targetMw: 60, episodes: [] },
    campaigns: fixture.zonePlan.missions.GAS_QUARTERLY.zones[ZONES.PUENTE],
    exchangeDays: fixture.exchangeDays,
    tobSeries: fixture.tobSeries,
  });
  assert.equal(first.decision, "HOLD");
});
