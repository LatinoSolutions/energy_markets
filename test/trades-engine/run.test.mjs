import { test } from "node:test";
import assert from "node:assert/strict";

import { missionObservationConfig, resolveFrozenConfig, runTradesMission } from "../../src/trades-engine/run.mjs";
import { computeTradesRunIdentity } from "../../src/trades-engine/identity.mjs";
import { frozenTradesResult, missionTradeAt } from "./fixtures.mjs";

// Contrato FROZEN REAL: pasa por `evaluateTradesFreeze` (TR-04) con la aprobación
// de Bru ligada al configHash (revisión TR05-FREEZE-SHAPE-02).
const FROZEN = frozenTradesResult();

const MISSION_CASES = [
  { missionKey: "GAS_QUARTERLY", market: "GAS_THE", product: "Gas", mission: "Quarterly", shortCode: "G0BQ", maturity: "2023Q4", legacy: "202310", targetMw: 60, cmdty: "NATGAS", area: "THE" },
  { missionKey: "GAS_MONTHLY", market: "GAS_THE", product: "Gas", mission: "Monthly", shortCode: "G0BM", maturity: "2023-10", legacy: "202310", targetMw: 10, cmdty: "NATGAS", area: "THE" },
  { missionKey: "POWER_QUARTERLY", market: "POWER_DE", product: "Power", mission: "Quarterly", shortCode: "DEBQ", maturity: "2023Q4", legacy: "202310", targetMw: 10, cmdty: "POWER", area: "DE" },
  { missionKey: "POWER_MONTHLY", market: "POWER_DE", product: "Power", mission: "Monthly", shortCode: "DEBM", maturity: "2023-10", legacy: "202310", targetMw: 10, cmdty: "POWER", area: "DE" },
];

const DAYS = ["2023-09-01", "2023-09-04", "2023-09-05", "2023-09-06", "2023-09-07", "2023-09-08"];
const SECOND_DAYS = ["2023-10-02", "2023-10-03", "2023-10-04", "2023-10-05", "2023-10-06"];

function rowsFor(def, days, price = 100) {
  return days.map((day) => missionTradeAt({
    cmdty: def.cmdty,
    area: def.area,
    shortCode: def.shortCode,
    maturity: def.legacy,
    day,
    slot: "11:00",
    price,
  }));
}

function campaignFor(def, { campaignId = `${def.missionKey}-DEV`, days = DAYS } = {}) {
  return {
    campaignId,
    product: def.product,
    mission: def.mission,
    market: def.market,
    shortCode: def.shortCode,
    maturity: def.maturity,
    zone: "DEVELOPMENT",
    windowStart: days[0],
    windowEnd: days[days.length - 1],
    deadline: days[days.length - 1],
  };
}

function runFor(def, overrides = {}) {
  return runTradesMission({
    missionKey: def.missionKey,
    zone: "DEVELOPMENT",
    observationRule: "LAST_TRADE",
    campaigns: [campaignFor(def)],
    rows: rowsFor(def, DAYS),
    exchangeDays: DAYS,
    frozenContract: FROZEN,
    ...overrides,
  });
}

test("resolveFrozenConfig sólo acepta el resultado FROZEN real; HOLD y result.contract quedan bloqueados", () => {
  assert.equal(FROZEN.decision, "FROZEN");
  const ok = resolveFrozenConfig(FROZEN);
  assert.equal(ok.ok, true);
  assert.equal(ok.configHash, FROZEN.contract.configHash);

  const loose = resolveFrozenConfig(FROZEN.contract);
  assert.equal(loose.ok, false);
  assert.equal(loose.code, "TRADES_CONTRACT_NOT_FROZEN");

  assert.equal(resolveFrozenConfig({ decision: "HOLD", contract: null }).code, "TRADES_CONTRACT_NOT_FROZEN");
  assert.equal(resolveFrozenConfig(null).code, "TRADES_CONTRACT_NOT_FROZEN");

  // La aprobación va ligada al config y a la decisión: alterarla bloquea el run.
  const badApproval = { ...FROZEN, contract: { ...FROZEN.contract, approval: { ...FROZEN.contract.approval, decision: "HOLD" } } };
  assert.equal(resolveFrozenConfig(badApproval).code, "FREEZE_APPROVAL_INVALID");

  // Un configHash que no corresponde al contenido = contrato alterado.
  const badHash = { ...FROZEN, contract: { ...FROZEN.contract, configHash: "0".repeat(64) } };
  assert.equal(resolveFrozenConfig(badHash).code, "INVALID_FROZEN_CONTRACT");
});

test("missionObservationConfig lee frescura y penalización medidas del contrato congelado", () => {
  const config = missionObservationConfig(FROZEN, "POWER_MONTHLY", "LAST_TRADE");
  assert.deepEqual(config, {
    ok: true,
    code: null,
    freshnessLimitSeconds: 900,
    freshnessStatus: "SELECTED_DEVELOPMENT",
    penaltyEurMwh: 0.5,
    penaltyStatus: "MEASURED",
  });
  // El contrato suelto no es un freeze: no se lee ninguna observación.
  assert.equal(missionObservationConfig(FROZEN.contract, "POWER_MONTHLY", "LAST_TRADE").freshnessLimitSeconds, null);
});

test("runTradesMission corre las 4 misiones, con su target, mercado y configHash", () => {
  for (const def of MISSION_CASES) {
    const result = runFor(def);
    assert.equal(result.ok, true, `${def.missionKey}: ${result.code}`);
    assert.equal(result.missionKey, def.missionKey);
    assert.equal(result.targetMw, def.targetMw);
    assert.equal(result.market, def.market);
    assert.equal(result.sourceMode, "TRADES");
    assert.equal(result.observationRule, "LAST_TRADE");
    assert.equal(result.zone, "DEVELOPMENT");
    assert.equal(result.configHash, FROZEN.contract.configHash);
    assert.equal(result.episodes.length, 1);
    assert.equal(result.episodes[0].arms.BASELINE.summary.status, "COMPLETE");
    assert.equal(result.episodes[0].arms.BASELINE.summary.targetMw, def.targetMw);
    assert.equal(result.comparison.product, def.shortCode);
  }
});

test("sin freeze FROZEN, runTradesMission no corre (fail-closed)", () => {
  for (const frozenContract of [null, { decision: "HOLD", contract: null }, FROZEN.contract]) {
    const result = runFor(MISSION_CASES[0], { frozenContract });
    assert.equal(result.ok, false);
    assert.equal(result.code, "TRADES_CONTRACT_NOT_FROZEN");
  }
});

test("runTradesMission filtra por zona: las filas de otro tramo no entran al episodio", () => {
  const def = MISSION_CASES[0];
  const rows = rowsFor(def, DAYS);
  const outOfZone = missionTradeAt({ cmdty: def.cmdty, area: def.area, shortCode: def.shortCode, maturity: def.legacy, day: "2025-09-01", slot: "11:00", price: 1 });
  const result = runFor(def, { rows: [...rows, outOfZone] });
  assert.equal(result.ok, true);
  assert.equal(result.zoneFilter.zone, "DEVELOPMENT");
  assert.equal(result.zoneFilter.rowsInZone, rows.length);
  assert.equal(result.zoneFilter.rowsOutOfZone, 1);
  assert.equal(result.episodes[0].arms.BASELINE.ledger.every((entry) => entry.price !== 1), true);
});

test("runTradesMission salta las campaigns de otra zona", () => {
  const def = MISSION_CASES[0];
  const other = { ...campaignFor(def), campaignId: "GAS-Q-PUENTE", zone: "PUENTE" };
  const result = runFor(def, { campaigns: [campaignFor(def), other] });
  assert.equal(result.ok, true);
  assert.deepEqual(result.skipped, ["GAS-Q-PUENTE"]);
});

test("SLOT_VWAP corre como un run propio de una sola regla", () => {
  const def = MISSION_CASES[3];
  const result = runFor(def, { observationRule: "SLOT_VWAP" });
  assert.equal(result.ok, true);
  assert.equal(result.observationRule, "SLOT_VWAP");
  assert.equal(result.episodes[0].arms.BASELINE.summary.observationRule, "SLOT_VWAP");
  assert.equal(result.episodes[0].arms.BASELINE.summary.complete, true);
});

test("sin historia de Development el brazo HOUR no se corre (NOT_RUN_NO_HISTORY)", () => {
  const def = MISSION_CASES[3];
  const result = runFor(def);
  assert.equal(result.episodes[0].hour.chosenSlot, null);
  assert.equal(result.episodes[0].arms.HOUR.summary.status, "NOT_RUN_NO_HISTORY");
});

test("con historia de Development el brazo HOUR walk-forward elige hora solo con esa zona", () => {
  const def = MISSION_CASES[3];
  const first = campaignFor(def);
  const second = campaignFor(def, { campaignId: "POWER_MONTHLY-DEV-2", days: SECOND_DAYS });
  second.windowStart = "2023-10-01";
  const rows = [...rowsFor(def, DAYS), ...rowsFor(def, SECOND_DAYS)];
  const result = runFor(def, {
    campaigns: [first, second],
    rows,
    exchangeDays: [...DAYS, ...SECOND_DAYS],
  });
  assert.equal(result.ok, true);
  const firstEpisode = result.episodes.find((episode) => episode.campaign.campaignId === first.campaignId);
  const laterEpisode = result.episodes.find((episode) => episode.campaign.campaignId === second.campaignId);
  assert.equal(firstEpisode.arms.HOUR.summary.status, "NOT_RUN_NO_HISTORY");
  assert.equal(firstEpisode.hour.chosenSlot, null);
  assert.equal(laterEpisode.hour.chosenSlot, "11:00");
  assert.equal(laterEpisode.hour.historyOnlyDevelopment, true);
  assert.equal(laterEpisode.arms.HOUR.summary.status, "COMPLETE");
});

test("un run de OOS_HISTORICO recibe la historia de Development para elegir la hora y no deja que esas filas entren al episodio", () => {
  const def = MISSION_CASES[3];
  const OOS_DAYS = ["2024-09-02", "2024-09-03", "2024-09-04", "2024-09-05", "2024-09-06"];
  const devCampaign = campaignFor(def, { campaignId: "POWER_MONTHLY-DEV-HISTORY" });
  const oosCampaign = {
    ...campaignFor(def, { campaignId: "POWER_MONTHLY-OOS", days: OOS_DAYS }),
    zone: "OOS_HISTORICO",
  };
  // La historia de Development usa un precio distinto: si sus filas se colaran al
  // episodio del OOS, el ledger del Baseline lo delataría.
  const devRows = rowsFor(def, DAYS, 120);
  const oosRows = rowsFor(def, OOS_DAYS, 100);

  const result = runTradesMission({
    missionKey: def.missionKey,
    zone: "OOS_HISTORICO",
    observationRule: "LAST_TRADE",
    campaigns: [oosCampaign],
    rows: oosRows,
    exchangeDays: [...DAYS, ...OOS_DAYS],
    historyCampaigns: [devCampaign],
    historyRows: devRows,
    frozenContract: FROZEN,
  });

  assert.equal(result.ok, true, result.code);
  assert.equal(result.episodes.length, 1);
  const episode = result.episodes[0];
  assert.equal(episode.campaign.campaignId, oosCampaign.campaignId);
  // La hora se elige walk-forward con la historia de Development anterior.
  assert.equal(episode.hour.chosenSlot, "11:00");
  assert.equal(episode.hour.historySize, 1);
  assert.equal(episode.hour.historyOnlyDevelopment, true);
  assert.equal(episode.arms.HOUR.summary.status, "COMPLETE");
  // Las filas de Development nunca llegan al episodio del OOS.
  assert.equal(episode.arms.BASELINE.ledger.every((entry) => entry.price === 100), true);
  const hourRow = result.comparison.table.find((row) => row.armId === "HOUR");
  assert.notEqual(hourRow.status, "NOT_COMPARABLE");
  assert.equal(hourRow.status, "COMPLETE");
});

test("la historia del brazo HOUR sólo admite Development: una campaign de otra zona no entra", () => {
  const def = MISSION_CASES[3];
  const OOS_DAYS = ["2024-09-02", "2024-09-03", "2024-09-04", "2024-09-05", "2024-09-06"];
  const devCampaign = campaignFor(def, { campaignId: "POWER_MONTHLY-DEV-HISTORY" });
  const puenteCampaign = { ...campaignFor(def, { campaignId: "POWER_MONTHLY-PUENTE-HISTORY" }), zone: "PUENTE" };
  const oosCampaign = {
    ...campaignFor(def, { campaignId: "POWER_MONTHLY-OOS", days: OOS_DAYS }),
    zone: "OOS_HISTORICO",
  };

  const result = runTradesMission({
    missionKey: def.missionKey,
    zone: "OOS_HISTORICO",
    observationRule: "LAST_TRADE",
    campaigns: [oosCampaign],
    rows: rowsFor(def, OOS_DAYS),
    exchangeDays: [...DAYS, ...OOS_DAYS],
    historyCampaigns: [devCampaign, puenteCampaign],
    historyRows: rowsFor(def, DAYS),
    frozenContract: FROZEN,
  });

  assert.equal(result.ok, true, result.code);
  assert.equal(result.episodes[0].hour.historySize, 1);
  assert.equal(result.episodes[0].hour.historyOnlyDevelopment, true);
});

test("la identidad del run lleva el configHash y el alcance del resultado", () => {
  const def = MISSION_CASES[0];
  const result = runFor(def);
  const identity = computeTradesRunIdentity({
    codeCommit: "deadbeef",
    dataManifest: { files: [] },
    parameters: { jobKind: "TRADES_BACKTEST" },
    market: result.market,
    mission: result.mission,
    sourceMode: result.sourceMode,
    observationRule: result.observationRule,
    zone: result.zone,
    configHash: result.configHash,
  });
  assert.equal(identity.ok, true);
  assert.equal(identity.identity.configHash, FROZEN.contract.configHash);
  assert.equal(identity.identity.observationRule, "LAST_TRADE");
});