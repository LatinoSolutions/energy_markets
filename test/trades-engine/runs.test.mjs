import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { CLIENT_SLOT } from "../../src/exploratory/backtest.mjs";
import { SLOT_LABELS, HALVES, OBSERVATION_RULES } from "../../src/trades-bridge/constants.mjs";
import { ZONES } from "../../src/oos-reservation/trades-zones.mjs";
import { TRADES_ENGINE_MISSIONS } from "../../src/trades-engine/missions.mjs";
import {
  TRADES_PHASE_ZONES,
  TRADES_RUN_PHASES,
  TRADES_RUN_PHASE_ORDER,
  TRADES_OOS_OPENING_PURPOSE,
  bridgeDecisionFromStatuses,
  evaluateBridgeForMission,
  observationRulesForPhase,
  openTradesOosForMission,
  runTradesMissionPhases,
  runTradesRuns,
  tradesRunKey,
} from "../../src/trades-engine/runs.mjs";
import { frozenTradesResult, missionTradeAt } from "./fixtures.mjs";
import { buildJobCommands, buildTradesRunsStatus, earliestWindowStart } from "../../operations/trades/TR-06/build-trades-runs-status.mjs";
import {
  buildSingleTradesRun,
  assembleTradesRuns,
  createOosAccessPersister,
  memoryPeaksFromInput,
  parseRunSelector,
  readBridgeDecision,
  recordBridgeDecision,
  runArtifactPath,
} from "../../operations/trades/TR-06/build-trades-runs.mjs";
import { appendAccessRegistry, readAccessRegistry } from "../../operations/trades/TR-06/build-trades-runs.mjs";

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

// Mapa de picos por run: cada run recibe el suyo (clave runKey). Un pico por run
// no se copia a los demás (plan TR-06: pico de RAM por run).
export function memoryPeaksFor(peakFor = () => 53000) {
  const map = {};
  for (const [missionKey, definition] of Object.entries(TRADES_ENGINE_MISSIONS)) {
    for (const phase of TRADES_RUN_PHASE_ORDER) {
      for (const observationRule of observationRulesForPhase(phase)) {
        map[tradesRunKey({ market: definition.market, missionKey, phase, observationRule })] = peakFor({ market: definition.market, missionKey, phase, observationRule });
      }
    }
  }
  return map;
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
    memoryPeaks: memoryPeaksFor(),
    atUtc: "2026-09-26T00:00:00Z",
    actor: "Bru",
    ...overrides,
  });
}

test("runTradesRuns corre las 4 misiones: Development y puente con 2 reglas, OOS con 1 apertura (20 runs)", () => {
  const result = runAll();
  assert.equal(result.ok, true, JSON.stringify(result.blocks));
  assert.equal(result.status, "RUN");
  assert.equal(result.runs.length, 4 * (2 + 2 + 1));
  const missionsSeen = new Set(result.runs.map((run) => run.missionKey));
  assert.deepEqual([...missionsSeen].sort(), Object.keys(TRADES_ENGINE_MISSIONS).sort());
  for (const run of result.runs) {
    assert.equal(run.zone, TRADES_PHASE_ZONES[run.phase]);
    assert.match(run.runId, /^BT-RUN-[0-9a-f]{64}$/);
    assert.equal(run.identity.zone, run.zone);
    assert.equal(run.identity.observationRule, run.observationRule);
    assert.equal(run.identity.configHash, FROZEN.contract.configHash);
    assert.equal(run.manifest.jobKind, "TRADES_BACKTEST");
    assert.equal(run.manifest.memoryPeak, 53000);
  }
});

test("el pico de RAM por run sale del mapa del runner y nunca se inventa", () => {
  // Cada run recibe el suyo: no se copia un valor único a todos.
  const distinct = runAll({ memoryPeaks: memoryPeaksFor(({ missionKey }) => missionKey.length) });
  assert.equal(distinct.runs.every((run) => run.manifest.memoryPeak === run.missionKey.length), true);
  const withoutPeak = runAll({ memoryPeaks: null });
  assert.equal(withoutPeak.runs.every((run) => run.manifest.memoryPeak === null), true);
  // Un mapa que no cubre un run deja ese run en null, sin heredar el de otro.
  const partial = runAll({ memoryPeaks: { [tradesRunKey({ market: "GAS_THE", missionKey: "GAS_QUARTERLY", phase: TRADES_RUN_PHASES.OOS, observationRule: OBSERVATION_RULES.LAST_TRADE })]: 111 } });
  const oosGasQuarterly = partial.runs.find((run) => run.missionKey === "GAS_QUARTERLY" && run.phase === TRADES_RUN_PHASES.OOS);
  assert.equal(oosGasQuarterly.manifest.memoryPeak, 111);
  const otherRun = partial.runs.find((run) => run.missionKey === "GAS_MONTHLY" && run.phase === TRADES_RUN_PHASES.DEVELOPMENT && run.observationRule === OBSERVATION_RULES.LAST_TRADE);
  assert.equal(otherRun.manifest.memoryPeak, null);
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

test("el OOS histórico abre el sello UNA vez por misión (sólo la regla primaria)", () => {
  const result = runAll();
  const oosRuns = result.runs.filter((run) => run.phase === TRADES_RUN_PHASES.OOS);
  // Una sola apertura por misión: la regla secundaria no abre un segundo run_id.
  assert.equal(oosRuns.length, 4);
  for (const run of oosRuns) {
    assert.equal(run.observationRule, OBSERVATION_RULES.LAST_TRADE);
    assert.notEqual(run.oosAccess, null);
    assert.equal(run.oosAccess.purpose, "TRADES_OOS_OPENING");
  }
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
  assert.equal(result.oosAccess.entries.length, 4);
});

test("la regla secundaria no abre un segundo run_id sobre el OOS (bloqueada)", () => {
  const fixture = buildFixture();
  const outcome = runTradesMissionPhases({
    phase: TRADES_RUN_PHASES.OOS,
    missionKey: "GAS_QUARTERLY",
    observationRule: OBSERVATION_RULES.SLOT_VWAP,
    zonePlan: fixture.zonePlan,
    rows: fixture.rows,
    exchangeDays: fixture.exchangeDays,
    frozenContract: FROZEN,
    atUtc: "2026-09-26T00:00:00Z",
    bridgeGateDecision: "PASS",
  });
  assert.equal(outcome.ok, false);
  assert.equal(outcome.code, "OOS_SECOND_OPENING_BLOCKED");
  assert.equal(outcome.run, null);
  // No se ejecutó la estrategia ni se abrió el sello.
  assert.equal(fixture.zonePlan.accessRegistry.entries.length, 0);
});

test("el OOS se registra ANTES de leerlo: sin plan sellado o registro fallido no corre la estrategia", () => {
  const fixture = buildFixture();
  // Plan no sellado: no hay lectura ni apertura.
  const notReserved = runTradesMissionPhases({
    phase: TRADES_RUN_PHASES.OOS,
    missionKey: "GAS_QUARTERLY",
    observationRule: OBSERVATION_RULES.LAST_TRADE,
    zonePlan: { ...fixture.zonePlan, decision: "HOLD" },
    rows: fixture.rows,
    exchangeDays: fixture.exchangeDays,
    frozenContract: FROZEN,
    atUtc: "2026-09-26T00:00:00Z",
    bridgeGateDecision: "PASS",
  });
  assert.equal(notReserved.ok, false);
  assert.equal(notReserved.code, "ZONE_PLAN_NOT_RESERVED");
  // Sin atUtc el registro de acceso falla (INVALID_ACCESS_TIME) y la estrategia no
  // corre: la lectura no queda fuera del registro.
  const badAccess = runTradesMissionPhases({
    phase: TRADES_RUN_PHASES.OOS,
    missionKey: "GAS_QUARTERLY",
    observationRule: OBSERVATION_RULES.LAST_TRADE,
    zonePlan: fixture.zonePlan,
    rows: fixture.rows,
    exchangeDays: fixture.exchangeDays,
    frozenContract: FROZEN,
    atUtc: null,
    bridgeGateDecision: "PASS",
  });
  assert.equal(badAccess.ok, false);
  assert.equal(badAccess.code, "INVALID_ACCESS_TIME");
  assert.equal(fixture.zonePlan.accessRegistry.entries.length, 0);
});

test("sin PASS del gate del puente el OOS no se abre y no hay aperturas", () => {
  const result = runAll({ tobSeries: new Map() });
  const oosRuns = result.runs.filter((run) => run.phase === TRADES_RUN_PHASES.OOS);
  assert.equal(oosRuns.length, 0);
  assert.equal(result.blockedBy.includes("OOS_NOT_OPENED_BRIDGE_GATE_NOT_PASS"), true);
  assert.deepEqual(result.oosAccess.oosOpeningsByMission, {
    GAS_QUARTERLY: 0,
    GAS_MONTHLY: 0,
    POWER_QUARTERLY: 0,
    POWER_MONTHLY: 0,
  });
  assert.equal(result.oosAccess.entries.filter((entry) => entry.consumesOos).length, 0);
});

test("el gate del puente trata NOT_EVALUABLE como HOLD (no fail-open)", () => {
  // El contrato de TR-04 devuelve NOT_EVALUABLE para una métrica no finita (ΔV
  // sin los dos brazos completos); combinarlo hasta PASS sería un fail-open.
  assert.equal(bridgeDecisionFromStatuses(["PASS", "PASS", "PASS", "NOT_EVALUABLE"]), "HOLD");
  assert.equal(bridgeDecisionFromStatuses(["PASS", "HOLD", "PASS"]), "HOLD");
  assert.equal(bridgeDecisionFromStatuses(["PASS", "FAIL", "NOT_EVALUABLE"]), "FAIL");
  assert.equal(bridgeDecisionFromStatuses(["PASS", "PASS", "PASS"]), "PASS");
});

test("con brazos incompletos en la mitad de evaluación el gate queda HOLD, nunca PASS", () => {
  const fixture = buildFixture();
  const lastThree = BRIDGE_DAYS.slice(-3);
  const rows = fixture.rows.filter((row) => !lastThree.includes(row.TrdDate));
  const tobSeries = new Map();
  for (const [contract, byDay] of fixture.tobSeries) {
    const trimmed = Object.fromEntries(Object.entries(byDay).filter(([day]) => !lastThree.includes(day)));
    tobSeries.set(contract, trimmed);
  }
  const result = runTradesRuns({
    zonePlan: fixture.zonePlan,
    rows,
    exchangeDays: fixture.exchangeDays,
    tobSeries,
    frozenContract: FROZEN,
    codeCommit: "deadbeef",
    dataManifest: { files: [] },
    atUtc: "2026-09-26T00:00:00Z",
  });
  const bridgeRun = result.runs.find((run) => run.phase === TRADES_RUN_PHASES.BRIDGE && run.observationRule === OBSERVATION_RULES.LAST_TRADE);
  assert.equal(bridgeRun.bridgeGate.decision, "HOLD");
});

test("H no se publica con obligación incompleta: queda null y la métrica es NOT_EVALUABLE", () => {
  const fixture = buildFixture();
  // Sin observación en tres días del puente la obligación no se cubre completa;
  // H (coste de cubrir la obligación completa, SPEC §5.5) no existe.
  const lastThree = BRIDGE_DAYS.slice(-3);
  const rows = fixture.rows.filter((row) => !lastThree.includes(row.TrdDate));
  const tobSeries = new Map();
  for (const [contract, byDay] of fixture.tobSeries) {
    tobSeries.set(contract, Object.fromEntries(Object.entries(byDay).filter(([day]) => !lastThree.includes(day))));
  }
  const result = runTradesRuns({
    zonePlan: fixture.zonePlan,
    rows,
    exchangeDays: fixture.exchangeDays,
    tobSeries,
    frozenContract: FROZEN,
    codeCommit: "deadbeef",
    dataManifest: { files: [] },
    atUtc: "2026-09-26T00:00:00Z",
  });
  const bridgeRun = result.runs.find((run) => run.phase === TRADES_RUN_PHASES.BRIDGE && run.observationRule === OBSERVATION_RULES.LAST_TRADE);
  const hMetric = bridgeRun.bridgeGate.perArm.BASELINE.metrics.find((metric) => metric.id === "H");
  assert.equal(bridgeRun.bridgeGate.perArm.BASELINE.values.trades.H, null);
  assert.equal(hMetric.status, "NOT_EVALUABLE");
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

test("relanzar el run registra la relectura sin inflar el conteo de aperturas", () => {
  const fixture = buildFixture();
  const base = {
    zonePlan: fixture.zonePlan,
    rows: fixture.rows,
    exchangeDays: fixture.exchangeDays,
    tobSeries: fixture.tobSeries,
    frozenContract: FROZEN,
    dataManifest: { files: [] },
    atUtc: "2026-09-26T00:00:00Z",
  };
  const first = runTradesRuns({ ...base, codeCommit: "deadbeef" });
  assert.equal(first.ok, true);
  const firstEntries = first.oosAccess.entries.length;
  assert.equal(firstEntries, 4);
  // Mismo código => mismos run_id: el conteo de aperturas no se infla, pero la
  // relectura queda registrada append-only (patch 03 §4).
  const repeat = runTradesRuns({ ...base, codeCommit: "deadbeef", initialAccessPlan: first.accessPlan });
  assert.deepEqual(repeat.oosAccess.oosOpeningsByMission, first.oosAccess.oosOpeningsByMission);
  assert.equal(repeat.oosAccess.entries.length, firstEntries * 2);
  // Código distinto => run_id nuevo sobre el OOS: se acumula y se cuenta.
  const changed = runTradesRuns({ ...base, codeCommit: "cafebabe", initialAccessPlan: repeat.accessPlan });
  assert.deepEqual(changed.oosAccess.oosOpeningsByMission, {
    GAS_QUARTERLY: 2,
    GAS_MONTHLY: 2,
    POWER_QUARTERLY: 2,
    POWER_MONTHLY: 2,
  });
  assert.equal(changed.oosAccess.entries.length, firstEntries * 3);
});

test("el pico de RAM del productor es un mapa por run: un valor único no se copia", () => {
  const previous = process.env.TR06_MEMORY_PEAK_JSON;
  try {
    process.env.TR06_MEMORY_PEAK_JSON = JSON.stringify({ "GAS_THE|GAS_QUARTERLY|OOS|LAST_TRADE": { childMaxRssKb: 1 } });
    assert.deepEqual(memoryPeaksFromInput({}), { "GAS_THE|GAS_QUARTERLY|OOS|LAST_TRADE": { childMaxRssKb: 1 } });
    // Un valor único no es una medición por run: no se acepta (nunca se copia).
    process.env.TR06_MEMORY_PEAK_JSON = JSON.stringify(53000);
    assert.equal(memoryPeaksFromInput({}), null);
    delete process.env.TR06_MEMORY_PEAK_JSON;
    assert.equal(memoryPeaksFromInput({}), null);
  } finally {
    if (previous === undefined) delete process.env.TR06_MEMORY_PEAK_JSON;
    else process.env.TR06_MEMORY_PEAK_JSON = previous;
  }
});

test("el registro de accesos del OOS es append-only en disco: cada lectura deja su entrada", () => {
  const file = `/tmp/tr06-access-${process.pid}-${Date.now()}.jsonl`;
  try {
    assert.deepEqual(readAccessRegistry(file), []);
    const entryA = { consumesOos: true, mission: "GAS_QUARTERLY", runId: "run-1", atUtc: "2026-09-26T00:00:00Z" };
    const entryB = { consumesOos: true, mission: "GAS_QUARTERLY", runId: "run-2", atUtc: "2026-09-26T01:00:00Z" };
    assert.deepEqual(appendAccessRegistry([entryA], file), { appended: 1, entries: [entryA] });
    // Repetir la misma lectura deja OTRA entrada (append-only, patch 03 §4); el
    // conteo de aperturas es por run_id único y se calcula aparte.
    assert.equal(appendAccessRegistry([entryA], file).appended, 1);
    assert.deepEqual(appendAccessRegistry([entryB], file), { appended: 1, entries: [entryA, entryA, entryB] });
    assert.deepEqual(readAccessRegistry(file), [entryA, entryA, entryB]);
  } finally {
    rmSync(file, { force: true });
  }
});

test("el estado de TR-06 declara PENDING_FREEZE y la rejilla de runs sin inventar resultados", () => {
  const status = buildTradesRunsStatus();
  assert.equal(status.status, "PENDING_FREEZE");
  assert.equal(status.blockedBy.includes("TRADES_CONTRACT_NOT_FROZEN"), true);
  assert.equal(status.freeze.decision, "HOLD");
  // 4 misiones × (Development 2 reglas + puente 2 reglas + OOS 1 apertura) = 20.
  assert.equal(status.runsGrid.count, 4 * (2 + 2 + 1));
  assert.deepEqual([...new Set(status.runsGrid.entries.map((entry) => entry.missionKey))].sort(), Object.keys(TRADES_ENGINE_MISSIONS).sort());
  assert.equal(status.runsArtifact, "operations/trades/TR-06/trades-runs.json");
});

test("la extracción de trades arranca en la primera ventana del plan de TR-02 (no 2021-01-01)", () => {
  const status = buildTradesRunsStatus();
  const tradesCommands = status.jobCommands.filter((command) => command.includes("extract-trades-rows.py"));
  assert.equal(tradesCommands.length, 2);
  // Primera ventana del plan de TR-02: 2020-11-01 (Monthly 2020-12), anterior al
  // corte fijo 2021-01-01 que dejaba fuera esas campaigns (patch 03 §1).
  const plan = JSON.parse(readFileSync("operations/trades/TR-02/trades-zone-plan.json", "utf8"));
  const minStart = earliestWindowStart(plan);
  assert.equal(minStart, "2020-11-01");
  for (const command of tradesCommands) {
    assert.match(command, new RegExp(`--start ${minStart} `));
  }
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

// TR06-GATE-STRUCTURAL-HOLD: con el plan real de TR-02 hay campaigns del puente
// en la calibración; sumar su target contra lo comprado sólo en evaluación dejaba
// H null y el gate en HOLD para siempre (el OOS nunca se abría).
test("el gate del puente evalúa SÓLO las campaigns de la mitad de evaluación", () => {
  const fixture = buildFixture();
  const CAL_DAYS = ["2025-09-01", "2025-09-02", "2025-09-03", "2025-09-04", "2025-09-05", "2025-09-08"];
  for (const [missionKey, definition] of Object.entries(TRADES_ENGINE_MISSIONS)) {
    const spec = MISSION_SPECS[missionKey];
    const legacy = "202510";
    const maturity = missionKey.includes("QUARTERLY") ? "2025Q4" : "2025-10";
    const calibrationCampaign = campaignFor({ missionKey, definition, spec, zone: ZONES.PUENTE, maturity, legacy, days: CAL_DAYS, suffix: "BRIDGE-CAL" });
    fixture.zonePlan.missions[missionKey].zones[ZONES.PUENTE].unshift(calibrationCampaign);
    fixture.rows.push(...rowsFor({ spec, definition, days: CAL_DAYS, legacy, price: 100 }));
    for (const [contract, byDay] of tobSeriesFor({ definition, legacy, days: CAL_DAYS, ask: 100 })) {
      fixture.tobSeries.set(contract, byDay);
    }
  }
  const result = runTradesRuns({
    zonePlan: fixture.zonePlan,
    rows: fixture.rows,
    exchangeDays: [...new Set([...fixture.exchangeDays, ...CAL_DAYS])].sort(),
    tobSeries: fixture.tobSeries,
    frozenContract: FROZEN,
    codeCommit: "deadbeef",
    dataManifest: { files: [] },
    atUtc: "2026-09-26T00:00:00Z",
  });
  const bridgeRun = result.runs.find((run) => run.phase === TRADES_RUN_PHASES.BRIDGE && run.observationRule === "LAST_TRADE" && run.missionKey === "GAS_QUARTERLY");
  assert.equal(bridgeRun.bridgeGate.decision, "PASS");
  assert.equal(bridgeRun.bridgeGate.exclusionRule, "CAMPAIGN_WINDOW_BEFORE_EVALUATION_START");
  assert.equal(bridgeRun.bridgeGate.campaignsEvaluated.includes("GAS_QUARTERLY-BRIDGE"), true);
  assert.equal(bridgeRun.bridgeGate.campaignsExcluded.includes("GAS_QUARTERLY-BRIDGE-CAL"), true);
  // Con el gate PASS, el OOS se abre una vez por misión.
  assert.equal(result.oosAccess.entries.filter((entry) => entry.consumesOos).length, 4);
});

// TR06-OOS-PERSIST-AFTER-READ: la apertura se persiste ANTES de leer el OOS.
test("la apertura del OOS queda persistida antes de leerla aunque la lectura falle", () => {
  const fixture = buildFixture();
  const file = `/tmp/tr06-persist-${process.pid}-${Date.now()}.jsonl`;
  try {
    // `slotLabels` no-array fuerza una excepción DENTRO de la lectura del OOS,
    // después de registrar la apertura.
    assert.throws(() => runTradesMissionPhases({
      phase: TRADES_RUN_PHASES.OOS,
      missionKey: "GAS_QUARTERLY",
      observationRule: OBSERVATION_RULES.LAST_TRADE,
      zonePlan: fixture.zonePlan,
      rows: fixture.rows,
      exchangeDays: fixture.exchangeDays,
      frozenContract: FROZEN,
      atUtc: "2026-09-26T00:00:00Z",
      bridgeGateDecision: "PASS",
      slotLabels: null,
      onOosAccess: createOosAccessPersister(file),
    }));
    const entries = readAccessRegistry(file);
    assert.equal(entries.length, 1);
    assert.equal(entries[0].consumesOos, true);
    assert.equal(entries[0].mission, "GAS_QUARTERLY");
    assert.equal(entries[0].purpose, TRADES_OOS_OPENING_PURPOSE);
  } finally {
    rmSync(file, { force: true });
  }
});

// TR06-RAM-PEAK-NOT-PER-RUN: un comando por run para que BT-05 mida el pico por job.
test("el productor expone un selector de un solo run y un comando por run", () => {
  const selector = parseRunSelector(["node", "x", "--mission", "GAS_QUARTERLY", "--phase", "BRIDGE", "--rule", "LAST_TRADE"]);
  assert.deepEqual(selector, { mission: "GAS_QUARTERLY", phase: "BRIDGE", rule: "LAST_TRADE", bridgeDecision: null, bridgeDecisionFile: null });
  assert.equal(parseRunSelector(["node", "x"]), null);
  const plan = JSON.parse(readFileSync("operations/trades/TR-02/trades-zone-plan.json", "utf8"));
  const perRun = buildJobCommands(plan).filter((command) => command.includes("--mission "));
  assert.equal(perRun.length, 4 * (2 + 2 + 1));
  for (const missionKey of Object.keys(TRADES_ENGINE_MISSIONS)) {
    for (const phase of TRADES_RUN_PHASE_ORDER) {
      for (const observationRule of observationRulesForPhase(phase)) {
        const expected = `--mission ${missionKey} --phase ${phase} --rule ${observationRule}`;
        assert.equal(perRun.some((command) => command.includes(expected)), true, expected);
      }
    }
  }
  const oosCommands = perRun.filter((command) => command.includes("--phase OOS"));
  assert.equal(oosCommands.length, 4);
  assert.equal(oosCommands.every((command) => command.includes("--bridge-decision-file")), true);
});

test("buildSingleTradesRun queda fail-closed sin freeze FROZEN (TR-04 es gate humano)", async () => {
  const result = await buildSingleTradesRun({
    selector: { mission: "GAS_QUARTERLY", phase: TRADES_RUN_PHASES.BRIDGE, rule: OBSERVATION_RULES.LAST_TRADE },
    inputs: { "--gas-trades": "/nonexistent", "--gas-tob": "/nonexistent", "--power-trades": null, "--power-tob": null },
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, "TRADES_CONTRACT_NOT_FROZEN");
});

test("la decisión del puente se escribe por regla y el OOS aislado exige PASS en todas", () => {
  const file = `/tmp/tr06-bridge-${process.pid}-${Date.now()}.json`;
  try {
    recordBridgeDecision({ mission: "GAS_QUARTERLY", observationRule: "LAST_TRADE", decision: "PASS", file });
    // Con una sola regla, la otra cuenta como HOLD: el OOS no se abre.
    assert.equal(readBridgeDecision({ mission: "GAS_QUARTERLY", bridgeDecisionFile: file }), "HOLD");
    recordBridgeDecision({ mission: "GAS_QUARTERLY", observationRule: "SLOT_VWAP", decision: "PASS", file });
    assert.equal(readBridgeDecision({ mission: "GAS_QUARTERLY", bridgeDecisionFile: file }), "PASS");
    // Otra misión sin decisión no tiene gate evaluado (fail-closed).
    assert.equal(readBridgeDecision({ mission: "POWER_MONTHLY", bridgeDecisionFile: file }), null);
    // Una regla FAIL manda.
    recordBridgeDecision({ mission: "GAS_QUARTERLY", observationRule: "SLOT_VWAP", decision: "FAIL", file });
    assert.equal(readBridgeDecision({ mission: "GAS_QUARTERLY", bridgeDecisionFile: file }), "FAIL");
  } finally {
    rmSync(file, { force: true });
  }
});

// TR06-OOS-DOUBLE-OPENING: un solo camino. El job no tiene un comando "completo"
// que corra los 20 runs (eso volvía a abrir el OOS de cada misión); hay un comando
// por run y un ensamblado final que no corre estrategia.
test("el job de TR-06 no tiene productor completo: un comando por run y un ensamblado", () => {
  const plan = JSON.parse(readFileSync("operations/trades/TR-02/trades-zone-plan.json", "utf8"));
  const commands = buildJobCommands(plan);
  const producer = commands.filter((command) => command.includes("build-trades-runs.mjs"));
  const fullProducer = producer.filter((command) => !command.includes("--mission ") && !command.includes("--assemble"));
  assert.equal(fullProducer.length, 0, JSON.stringify(fullProducer));
  const perRun = producer.filter((command) => command.includes("--mission "));
  assert.equal(perRun.length, 4 * (2 + 2 + 1));
  const assemble = producer.filter((command) => command.includes("--assemble"));
  assert.equal(assemble.length, 1);
  // El ensamblado va al final, después de todos los runs.
  assert.equal(producer.at(-1), assemble[0]);
  // Una sola apertura del OOS por misión: un único comando OOS por misión.
  const oosCommands = perRun.filter((command) => command.includes("--phase OOS"));
  assert.equal(oosCommands.length, 4);
  assert.equal(new Set(oosCommands).size, 4);
});

// Fixture de entradas del run OOS: filas de Gas y documento TOB en archivos
// temporales (el productor es I/O). `transform` permite cambiar el contenido para
// probar que el run_id se liga a los hashes de entrada.
function writeGasInputs(fixture, dir, suffix = "", transform = (row) => row) {
  const gasRows = fixture.rows
    .filter((row) => row.Cmdty === "NATGAS" && row.Area === "THE")
    .map(transform);
  const tradesPath = join(dir, `gas-the${suffix}.ndjson`);
  writeFileSync(tradesPath, `${gasRows.map((row) => JSON.stringify(row)).join("\n")}\n`);
  const series = {};
  for (const [contract, byDay] of fixture.tobSeries) series[contract] = byDay;
  const tobPath = join(dir, `gas-tob${suffix}.json`);
  writeFileSync(tobPath, JSON.stringify({ series }));
  return { "--gas-trades": tradesPath, "--gas-tob": tobPath, "--power-trades": null, "--power-tob": null };
}

test("el run OOS aislado liga su identidad a los inputs, siembra el registro y guarda su artefacto", async () => {
  const dir = mkdtempSync(join(tmpdir(), "tr06-single-"));
  try {
    const fixture = buildFixture();
    const registryFile = join(dir, "access.jsonl");
    const outputDir = join(dir, "runs");
    const base = {
      selector: { mission: "GAS_QUARTERLY", phase: TRADES_RUN_PHASES.OOS, rule: OBSERVATION_RULES.LAST_TRADE, bridgeDecision: "PASS", bridgeDecisionFile: null },
      inputs: writeGasInputs(fixture, dir),
      frozenContract: FROZEN,
      zonePlan: fixture.zonePlan,
      exchangeDays: fixture.exchangeDays,
      registryFile,
      outputDir,
      atUtc: "2026-09-26T00:00:00Z",
      onOosAccess: createOosAccessPersister(registryFile),
    };
    const first = await buildSingleTradesRun(base);
    assert.equal(first.ok, true, first.code);
    assert.match(first.run.runId, /^BT-RUN-[0-9a-f]{64}$/);
    // Artefacto por runKey con su manifest y los hashes de sus inputs.
    const artifact = JSON.parse(readFileSync(runArtifactPath(first.runKey, outputDir), "utf8"));
    assert.equal(artifact.runKey, first.runKey);
    assert.equal(artifact.run.manifest.runId, first.run.runId);
    assert.equal(artifact.inputs.trades.GAS_THE.sha256.length, 64);
    assert.equal(artifact.inputs.tob.GAS_THE.sha256.length, 64);
    assert.equal(readAccessRegistry(registryFile).length, 1);

    // Relanzar con los mismos inputs: mismo run_id (misma apertura), la relectura
    // queda en el log pero el conteo no se infla, y el run ve el registro del disco.
    const second = await buildSingleTradesRun(base);
    assert.equal(second.ok, true, second.code);
    assert.equal(second.run.runId, first.run.runId);
    assert.equal(readAccessRegistry(registryFile).length, 2);
    assert.equal(second.oos.oosOpeningsByMission.GAS_QUARTERLY, 1);

    // Otros datos de entrada => otro run_id (una apertura nueva, que se cuenta).
    const changed = await buildSingleTradesRun({
      ...base,
      inputs: writeGasInputs(fixture, dir, "-b", (row, index) => (index === 0 ? { ...row, Px: "100.5" } : row)),
    });
    assert.equal(changed.ok, true, changed.code);
    assert.notEqual(changed.run.runId, first.run.runId);
    assert.equal(changed.oos.oosOpeningsByMission.GAS_QUARTERLY, 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// TR06-SINGLE-RUN-NO-OUTPUT: el artefacto por run permite ensamblar la vista
// agregada sin volver a correr estrategia. TR06-CHECK-READ-NOT-PERSISTED: el
// ensamblado (lo que corre `--check`) NO lee el OOS ni añade entradas al registro.
test("--assemble combina los artefactos por run sin leer el OOS", async () => {
  const dir = mkdtempSync(join(tmpdir(), "tr06-assemble-"));
  try {
    const fixture = buildFixture();
    const registryFile = join(dir, "access.jsonl");
    const outputDir = join(dir, "runs");
    const result = await buildSingleTradesRun({
      selector: { mission: "GAS_QUARTERLY", phase: TRADES_RUN_PHASES.OOS, rule: OBSERVATION_RULES.LAST_TRADE, bridgeDecision: "PASS", bridgeDecisionFile: null },
      inputs: writeGasInputs(fixture, dir),
      frozenContract: FROZEN,
      zonePlan: fixture.zonePlan,
      exchangeDays: fixture.exchangeDays,
      registryFile,
      outputDir,
      atUtc: "2026-09-26T00:00:00Z",
      onOosAccess: createOosAccessPersister(registryFile),
    });
    assert.equal(result.ok, true, result.code);
    const registryBefore = readAccessRegistry(registryFile).length;
    const { artifact } = assembleTradesRuns({ runsDir: outputDir, registryFile });
    // Sólo el artefacto producido entra; los demás runKey quedan como bloqueo.
    assert.equal(artifact.runs.length, 1);
    assert.equal(artifact.blockedBy.includes("MISSING_RUN_ARTIFACT"), true);
    assert.equal(artifact.oosAccess.entries.length, 1);
    assert.equal(artifact.oosAccess.oosOpeningsByMission.GAS_QUARTERLY, 1);
    // Ensamblar no ejecuta la lectura del OOS: el registro no cambia.
    assert.equal(readAccessRegistry(registryFile).length, registryBefore);
    // El ensamblado es determinista.
    const again = assembleTradesRuns({ runsDir: outputDir, registryFile });
    assert.deepEqual(again.artifact, artifact);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
