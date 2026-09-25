// Tests de TR-04: contrato TRADES-v1 y freeze. Fixtures sintéticas: NO son la
// medición real del puente (TR-03 es un job que lanza Bru) ni una aprobación
// real de Bru. Sólo prueban la regla y el fail-closed.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  createGasQuarterlyExecutionContract,
} from "../../src/execution-contract/execution-contract.mjs";
import {
  FRESHNESS_COVERAGE_TARGET,
  MIN_PENALTY_OBSERVATIONS,
  TRADES_BRIDGE_GATE,
  TRADES_CONTRACT_ID,
  TRADES_CONTROL_SOURCE_MODE,
  TRADES_FROZEN_RULES,
  TRADES_MISSING_DATA_RULES,
  TRADES_SENSITIVITY_GRID,
  buildTradesFreezeCandidate,
  deriveFreshnessForMission,
  derivePenaltyForMission,
  deriveTradesFillPrice,
  evaluateTradesFreeze,
  tradesConfigHash,
  validateTradesContract,
} from "../../src/execution-contract/index.mjs";
import { FRESHNESS_LIMIT_CANDIDATES_SECONDS } from "../../src/trades-bridge/constants.mjs";
import { approvalFor, frozenInput, measurementFixture } from "./trades-fixtures.mjs";

// Hash del contrato TOB congelado por IMP-07. TR-04 no puede cambiarlo.
const TOB_CONTRACT_HASH = "830de52dc6fd9976556989132a20ee1e536b3fe000b4566931377192fb646acd";

test("el contrato TRADES es una versión nueva y no toca el contrato TOB", () => {
  const tob = createGasQuarterlyExecutionContract();
  assert.equal(tob.contentHash, TOB_CONTRACT_HASH, "el contrato TOB debe quedar byte-idéntico");
  assert.notEqual(TRADES_CONTRACT_ID, tob.contractId);
  assert.equal(TRADES_CONTROL_SOURCE_MODE, "TOB");
  const candidate = buildTradesFreezeCandidate(frozenInput());
  assert.equal(candidate.contractId, TRADES_CONTRACT_ID);
  assert.equal(candidate.controlSourceMode, "TOB");
  assert.equal(candidate.versionLabel, "TRADES-v1");
});

test("el contrato declara las reglas frozen de P5.6 más las propias de TRADES", () => {
  const candidate = buildTradesFreezeCandidate(frozenInput());
  const ids = candidate.frozenRules;
  for (const rule of TRADES_FROZEN_RULES) {
    assert.ok(ids.includes(rule.id), `falta ${rule.id}`);
  }
  assert.ok(ids.includes("PENALTY_SEPARATE_FROM_SLIPPAGE"));
  assert.ok(ids.includes("NO_AGGRESSOR_OWN_GROUP"));
  assert.ok(ids.includes("DATA_INCOMPLETE_DISTINCT"));
});

test("sin medición del puente el freeze queda HOLD (PENDING_MEASUREMENT)", () => {
  const outcome = evaluateTradesFreeze({ brokenSpreadPolicy: "INCLUDE" });
  assert.equal(outcome.decision, "HOLD");
  assert.equal(outcome.status, "PENDING_MEASUREMENT");
  assert.equal(outcome.contract, null);
  assert.ok(outcome.blockedBy.includes("MISSING_BRIDGE_MEASUREMENT"));
});

test("sin la política de broken spread congelada por TR-01 también queda HOLD", () => {
  const outcome = evaluateTradesFreeze({ measurement: measurementFixture() });
  assert.equal(outcome.status, "PENDING_MEASUREMENT");
  assert.ok(outcome.blockedBy.includes("MISSING_BROKEN_SPREAD_POLICY"));
});

test("con medición pero sin aprobación de Bru queda PENDING_OWNER_APPROVAL", () => {
  const outcome = evaluateTradesFreeze(frozenInput());
  assert.equal(outcome.decision, "HOLD");
  assert.equal(outcome.status, "PENDING_OWNER_APPROVAL");
  assert.deepEqual(outcome.blockedBy, ["MISSING_OWNER_APPROVAL"]);
});

test("una aprobación ligada a otro configHash no congela (fail-closed)", () => {
  const candidate = buildTradesFreezeCandidate(frozenInput());
  const outcome = evaluateTradesFreeze(frozenInput({ ownerApproval: approvalFor("0".repeat(64)) }));
  assert.equal(outcome.status, "PENDING_OWNER_APPROVAL");
  assert.ok(outcome.blockedBy.includes("APPROVAL_HASH_MISMATCH"));
  assert.notEqual(candidate.configHash, "0".repeat(64));
});

test("una aprobación con scope distinto no congela", () => {
  const candidate = buildTradesFreezeCandidate(frozenInput());
  const approval = { ...approvalFor(candidate.configHash), scope: "OTRO_SCOPE" };
  const outcome = evaluateTradesFreeze(frozenInput({ ownerApproval: approval }));
  assert.equal(outcome.status, "PENDING_OWNER_APPROVAL");
  assert.ok(outcome.blockedBy.includes("APPROVAL_SCOPE_MISMATCH"));
});

test("con medición y aprobación de Bru el freeze es FROZEN y el config tiene hash", () => {
  const candidate = buildTradesFreezeCandidate(frozenInput());
  const outcome = evaluateTradesFreeze(frozenInput({ ownerApproval: approvalFor(candidate.configHash) }));
  assert.equal(outcome.decision, "FROZEN");
  assert.equal(outcome.status, "FROZEN");
  assert.equal(outcome.contract.status, "FROZEN");
  assert.match(outcome.contract.configHash, /^[0-9a-f]{64}$/);
  assert.equal(outcome.contract.configHash, candidate.configHash);
  assert.equal(validateTradesContract(outcome.contract).ok, true);
  assert.equal(outcome.contract.approval.approvedBy.authority, "Bru");
});

test("la penalización trade->ask se deriva por mercado y misión del cross-tab señal × agresor", () => {
  const measurement = measurementFixture({ gasQuarterly: 2, gasMonthly: 3, powerQuarterly: 0.75, powerMonthly: 0.25 });
  const gas = derivePenaltyForMission({ measurement, market: "GAS_THE", mission: "GAS_QUARTERLY" });
  const gasMonthly = derivePenaltyForMission({ measurement, market: "GAS_THE", mission: "GAS_MONTHLY" });
  const power = derivePenaltyForMission({ measurement, market: "POWER_DE", mission: "POWER_QUARTERLY" });
  assert.equal(gas.status, "MEASURED");
  assert.equal(gas.value, 2);
  assert.equal(gasMonthly.value, 3);
  assert.equal(power.value, 0.75, "la penalización de Gas no se hereda a Power");
  // El grupo sin agresor conserva su propia etiqueta en el desglose.
  assert.ok(gas.byAggressor.some((entry) => entry.aggressor === "UNKNOWN"));
  // Sólo cuenta las celdas BELOW_MEAN (la señal en que DIP10 compraría).
  assert.equal(gas.observations, 40);
});

test("la penalización es UNKNOWN con muestra insuficiente y no se sustituye por cero", () => {
  const measurement = measurementFixture({ observations: 10 });
  const penalty = derivePenaltyForMission({ measurement, market: "GAS_THE", mission: "GAS_QUARTERLY" });
  assert.equal(penalty.status, "UNKNOWN");
  assert.equal(penalty.value, null);
  const outcome = evaluateTradesFreeze(frozenInput({ measurement }));
  assert.equal(outcome.status, "PENDING_MEASUREMENT");
  assert.ok(outcome.blockedBy.includes("UNMEASURED_CONTRACT_PARAMETERS"));
});

test("el límite de frescura se deriva de la cobertura del puente", () => {
  const measurement = measurementFixture({ targetLimit: 3600 });
  const freshness = deriveFreshnessForMission({ measurement, market: "GAS_THE", mission: "GAS_QUARTERLY" });
  assert.equal(freshness.status, "MEASURED");
  assert.equal(freshness.value, 3600);
  assert.ok(freshness.coverage >= FRESHNESS_COVERAGE_TARGET);
});

test("sin candidato que alcance la cobertura objetivo se declara LOW_COVERAGE, no se inventa", () => {
  const measurement = measurementFixture({ targetLimit: 999999 });
  const freshness = deriveFreshnessForMission({ measurement, market: "GAS_THE", mission: "GAS_QUARTERLY" });
  assert.equal(freshness.status, "LOW_COVERAGE");
  assert.equal(freshness.value, Math.max(...FRESHNESS_LIMIT_CANDIDATES_SECONDS));
});

test("la grilla de sensibilidad y el gate del puente quedan predeclarados", () => {
  assert.ok(TRADES_SENSITIVITY_GRID.penaltyMultipliers.includes(0));
  assert.ok(TRADES_SENSITIVITY_GRID.penaltyMultipliers.includes(1));
  assert.deepEqual(TRADES_SENSITIVITY_GRID.freshnessLimitSeconds, FRESHNESS_LIMIT_CANDIDATES_SECONDS);

  assert.equal(TRADES_BRIDGE_GATE.toBridgeResultsAlreadyKnown, true);
  assert.equal(TRADES_BRIDGE_GATE.independence, "NOT_INDEPENDENT_VALIDATION");
  assert.deepEqual(TRADES_BRIDGE_GATE.arms, ["BASELINE", "DIP10", "HOUR"]);
  const metricIds = TRADES_BRIDGE_GATE.metrics.map((metric) => metric.id);
  assert.deepEqual(metricIds, ["BUY_WAIT_AGREEMENT", "BOUGHT_MW", "FILL_PRICE", "H", "DELTA_V"]);
  assert.deepEqual(TRADES_BRIDGE_GATE.armOrderRule.arms, ["BASELINE", "DIP10", "HOUR"]);
});

test("las reglas de dato ausente están declaradas y distinguen DATA_INCOMPLETE del hard-reject", () => {
  assert.equal(TRADES_MISSING_DATA_RULES.WINDOW_SOURCE, "WINDOW_FROM_MISSION_AND_MARKET_CALENDAR_NOT_FROM_TRADE_PRESENCE");
  assert.equal(TRADES_MISSING_DATA_RULES.CARRY, "NO_CARRY_OF_A_PRICE_BEYOND_THE_FRESHNESS_LIMIT");
  assert.equal(TRADES_MISSING_DATA_RULES.INCOMPLETE_VS_FORCING, "DATA_INCOMPLETE_IS_DISTINCT_FROM_CLIENT_FORCING_HARD_REJECT");
});

test("el configHash cambia si cambia el contenido del contrato", () => {
  const base = buildTradesFreezeCandidate(frozenInput());
  const changed = buildTradesFreezeCandidate(frozenInput({ measurement: measurementFixture({ gasQuarterly: 2.5 }) }));
  assert.notEqual(base.configHash, changed.configHash);
  assert.equal(base.configHash, tradesConfigHash(base));
});

test("un penalty UNKNOWN con valor se rechaza (nunca cero)", () => {
  const candidate = buildTradesFreezeCandidate(frozenInput());
  candidate.markets.GAS_THE.missions.GAS_QUARTERLY.penalty = { status: "UNKNOWN", value: 0 };
  const outcome = validateTradesContract(candidate);
  assert.equal(outcome.ok, false);
  assert.ok(outcome.errors.some((error) => error.code === "INVENTED_PENALTY"));
});

test("un contrato sin una de las 4 misiones se rechaza (patch 03 §6)", () => {
  const candidate = buildTradesFreezeCandidate(frozenInput());
  delete candidate.markets.POWER_DE.missions.POWER_MONTHLY;
  const outcome = validateTradesContract(candidate);
  assert.equal(outcome.ok, false);
  assert.ok(outcome.errors.some((error) => error.code === "MISSING_MISSION"));
});

test("un contrato que altera el contenido sin recomputar el hash se rechaza", () => {
  const candidate = buildTradesFreezeCandidate(frozenInput());
  candidate.sharedParameters.find((entry) => entry.key === "slippage").value = 0.3;
  const outcome = validateTradesContract(candidate);
  assert.equal(outcome.ok, false);
  assert.ok(outcome.errors.some((error) => error.code === "CONFIG_HASH_MISMATCH"));
});

test("el mínimo de observaciones para congelar la penalización es declarado y positivo", () => {
  assert.ok(MIN_PENALTY_OBSERVATIONS > 0);
  assert.ok(FRESHNESS_COVERAGE_TARGET > 0 && FRESHNESS_COVERAGE_TARGET <= 1);
});

test("el fill TRADES suma trade + penalización + 0,15 sin omitir ni duplicar", () => {
  const fill = deriveTradesFillPrice({ tradePrice: 100, penaltyEurMwh: 2, slippageEurMwh: 0.15 });
  assert.equal(fill.ok, true);
  assert.equal(fill.price, 102.15);
  // El 0,15 no se omite (no es 102) ni se cuenta dos veces (no es 102.30).
  assert.notEqual(fill.price, 102);
  assert.notEqual(fill.price, 102.3);
  // Precio negativo de power admitido; penalización/slippage no.
  assert.equal(deriveTradesFillPrice({ tradePrice: -10, penaltyEurMwh: 1, slippageEurMwh: 0.15 }).price, -8.85);
  assert.equal(deriveTradesFillPrice({ tradePrice: 100, penaltyEurMwh: -1 }).ok, false);
  assert.equal(deriveTradesFillPrice({ tradePrice: 100, penaltyEurMwh: 1, slippageEurMwh: -0.15 }).ok, false);
});
