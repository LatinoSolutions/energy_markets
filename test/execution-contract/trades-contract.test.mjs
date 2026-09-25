// Tests de TR-04: contrato TRADES-v1 y freeze. Fixtures sintéticas construidas
// con el productor REAL de TR-03 (NO son la medición real del puente ni una
// aprobación real de Bru). Sólo prueban la regla y el fail-closed.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  createGasQuarterlyExecutionContract,
} from "../../src/execution-contract/execution-contract.mjs";
import {
  BRIDGE_GATE_THRESHOLDS,
  FRESHNESS_COVERAGE_TARGET,
  MIN_PENALTY_OBSERVATIONS,
  TRADES_BRIDGE_GATE,
  TRADES_CONTRACT_ID,
  TRADES_CONTROL_SOURCE_MODE,
  TRADES_FROZEN_RULES,
  TRADES_MISSING_DATA_RULES,
  TRADES_PENALTY_AGGRESSION_RULE,
  TRADES_SENSITIVITY_GRID,
  buildTradesFreezeCandidate,
  deriveFreshnessForMission,
  derivePenaltyForMission,
  deriveTradesFillPrice,
  evaluateTradesFreeze,
  tradesConfigHash,
  validateTradesContract,
} from "../../src/execution-contract/index.mjs";
import { FRESHNESS_LIMIT_CANDIDATES_SECONDS, HALVES, OBSERVATION_RULE_LIST } from "../../src/trades-bridge/constants.mjs";
import { approvalFor, frozenInput, measurementFixture, sourceDecisionFixture } from "./trades-fixtures.mjs";

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
  assert.ok(ids.includes("PENALTY_SIGN_UNRESTRICTED"));
  assert.ok(ids.includes("PENALTY_BY_DECLARED_AGGRESSOR_GROUP"));
  assert.ok(ids.includes("NO_AGGRESSOR_OWN_GROUP"));
  assert.ok(ids.includes("BROKEN_SPREAD_POLICY_FROM_MEASUREMENT"));
  assert.ok(ids.includes("DATA_INCOMPLETE_DISTINCT"));
});

test("sin medición del puente el freeze queda HOLD (PENDING_MEASUREMENT)", () => {
  const outcome = evaluateTradesFreeze({});
  assert.equal(outcome.decision, "HOLD");
  assert.equal(outcome.status, "PENDING_MEASUREMENT");
  assert.equal(outcome.contract, null);
  assert.ok(outcome.blockedBy.includes("MISSING_BRIDGE_MEASUREMENT"));
});

test("sin la política de broken spread ligada a la medición también queda HOLD", () => {
  const measurement = measurementFixture();
  delete measurement.brokenSpreadPolicy;
  const outcome = evaluateTradesFreeze({ measurement });
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

// --- Defecto 1: ruta real del artefacto de TR-03 -------------------------

test("lee la medición real de TR-03 (summary) y deriva MEASURED con >=30 BELOW_MEAN", () => {
  const measurement = measurementFixture();
  // La medición del productor real sólo publica los cortes dentro de summary.
  assert.ok(measurement.markets.GAS_THE.missions.GAS_QUARTERLY.summary.gaps.LAST_TRADE.byHalfByDip10StateByAggressor.length >= 1);
  assert.equal(measurement.markets.GAS_THE.missions.GAS_QUARTERLY.gaps, undefined, "TR-03 no publica gaps en la raíz de la misión");
  const penalty = derivePenaltyForMission({ measurement, market: "GAS_THE", mission: "GAS_QUARTERLY" });
  assert.equal(penalty.status, "MEASURED");
  assert.ok(penalty.observations >= MIN_PENALTY_OBSERVATIONS);
  assert.notEqual(penalty.value, null);
});

// --- Defecto 2: calibración por mitad, no por el puente completo ---------

test("la mitad de EVALUATION no contamina la penalización ni la frescura", () => {
  const clean = measurementFixture();
  const contaminated = measurementFixture({ contaminationPenalty: 50, evaluationDays: 12 });
  for (const [market, mission] of [["GAS_THE", "GAS_QUARTERLY"], ["POWER_DE", "POWER_MONTHLY"]]) {
    const cleanPenalty = derivePenaltyForMission({ measurement: clean, market, mission });
    const contaminatedPenalty = derivePenaltyForMission({ measurement: contaminated, market, mission });
    assert.equal(contaminatedPenalty.value, cleanPenalty.value, `EVALUATION no debe cambiar la penalización de ${mission}`);
    const cleanFreshness = deriveFreshnessForMission({ measurement: clean, market, mission });
    const contaminatedFreshness = deriveFreshnessForMission({ measurement: contaminated, market, mission });
    assert.equal(contaminatedFreshness.value, cleanFreshness.value, `EVALUATION no debe cambiar la frescura de ${mission}`);
  }
  const candidate = buildTradesFreezeCandidate(frozenInput());
  assert.equal(candidate.halves.calibration, "CALIBRATION");
  assert.deepEqual(candidate.halves.calibrationUsedFor, ["penaltyEurMwh", "freshnessLimitSeconds"]);
  assert.deepEqual(candidate.halves.evaluationUsedFor, ["bridgeGate"]);
});

// --- Defecto 3: ambas reglas de observación congeladas -------------------

test("el candidato congela LAST_TRADE y SLOT_VWAP por misión", () => {
  const candidate = buildTradesFreezeCandidate(frozenInput());
  for (const [market, missions] of Object.entries(candidate.markets)) {
    for (const [missionKey, entry] of Object.entries(missions.missions)) {
      for (const rule of OBSERVATION_RULE_LIST) {
        assert.ok(entry.observations[rule], `falta ${rule} en ${market}/${missionKey}`);
        assert.equal(entry.observations[rule].penalty.status, "MEASURED", `penalización no congelada en ${market}/${missionKey}/${rule}`);
        assert.ok(["MEASURED", "LOW_COVERAGE"].includes(entry.observations[rule].freshness.status), `frescura no congelada en ${market}/${missionKey}/${rule}`);
      }
    }
  }
});

// --- Defecto 4: grupo sin agresor con regla explícita --------------------

test("la penalización conserva cada grupo agresor con su regla explícita", () => {
  const measurement = measurementFixture();
  const gasMonthly = derivePenaltyForMission({ measurement, market: "GAS_THE", mission: "GAS_MONTHLY" });
  assert.equal(gasMonthly.value, 2.5);
  assert.deepEqual(gasMonthly.byAggressor.map((entry) => entry.aggressor), ["UNKNOWN"]);
  assert.equal(gasMonthly.aggregationRuleId, TRADES_PENALTY_AGGRESSION_RULE.id);
  const candidate = buildTradesFreezeCandidate(frozenInput());
  assert.equal(candidate.tradeEligibility.penaltyAggressionRule.id, TRADES_PENALTY_AGGRESSION_RULE.id);
  assert.ok(candidate.tradeEligibility.penaltyAggressionRule.groups.some((group) => group.aggressor === "UNKNOWN" && group.reassignedToSide === false));
  // El modelo de fill también declara de dónde sale la penalización.
  assert.equal(candidate.fillModel.penaltyAggressionRuleId, TRADES_PENALTY_AGGRESSION_RULE.id);
  assert.equal(candidate.fillModel.penaltySignRuleId, "PENALTY_SIGN_UNRESTRICTED");
});

// --- Defecto 5: penalización negativa medida es válida -------------------

test("una penalización negativa medida no bloquea el freeze", () => {
  const measurement = measurementFixture({ penalties: { GAS_QUARTERLY: -0.75 } });
  const penalty = derivePenaltyForMission({ measurement, market: "GAS_THE", mission: "GAS_QUARTERLY" });
  assert.equal(penalty.status, "MEASURED");
  assert.equal(penalty.value, -0.75);
  const input = frozenInput({ measurement });
  const candidate = buildTradesFreezeCandidate(input);
  assert.equal(validateTradesContract(candidate).ok, true, JSON.stringify(validateTradesContract(candidate).errors));
  const outcome = evaluateTradesFreeze({ ...input, ownerApproval: approvalFor(candidate.configHash) });
  assert.equal(outcome.status, "FROZEN");
});

test("el fill admite penalización negativa sin imponer signo", () => {
  const fill = deriveTradesFillPrice({ tradePrice: 100, penaltyEurMwh: -1, slippageEurMwh: 0.15 });
  assert.equal(fill.ok, true);
  assert.equal(fill.price, 99.15);
});

// --- Defecto 6: gate predeclarado con umbrales ---------------------------

test("cada métrica del gate declara definición y umbral, y el validador los exige", () => {
  const metricIds = TRADES_BRIDGE_GATE.metrics.map((metric) => metric.id);
  assert.deepEqual(metricIds, ["BUY_WAIT_AGREEMENT", "BOUGHT_MW", "FILL_PRICE", "H", "DELTA_V"]);
  for (const metric of TRADES_BRIDGE_GATE.metrics) {
    assert.ok(metric.definition && metric.definition.length > 0, `definición ausente en ${metric.id}`);
    assert.ok(metric.threshold && metric.threshold.kind, `umbral ausente en ${metric.id}`);
  }
  assert.equal(TRADES_BRIDGE_GATE.metrics.find((metric) => metric.id === "H").threshold.kind, "cost_state_declared");
  assert.equal(TRADES_BRIDGE_GATE.metrics.find((metric) => metric.id === "BUY_WAIT_AGREEMENT").threshold.value, BRIDGE_GATE_THRESHOLDS.BUY_WAIT_AGREEMENT_MIN);

  const candidate = buildTradesFreezeCandidate(frozenInput());
  candidate.bridgeGate = {
    ...candidate.bridgeGate,
    metrics: candidate.bridgeGate.metrics.map((metric) => (metric.id === "H" ? { ...metric, threshold: null } : metric)),
  };
  const outcome = validateTradesContract(candidate);
  assert.equal(outcome.ok, false);
  assert.ok(outcome.errors.some((error) => error.code === "MISSING_GATE_THRESHOLD"));
});

// --- Defecto 7: política de broken spread ligada a la medición -----------

test("el freeze toma la política de broken spread de la medición", () => {
  const candidate = buildTradesFreezeCandidate(frozenInput());
  assert.equal(candidate.tradeEligibility.brokenSpreadPolicy, "INCLUDE");
});

test("una política de TR-01 distinta a la de la medición deja el freeze en HOLD", () => {
  const outcome = evaluateTradesFreeze(frozenInput({
    sourceDecision: sourceDecisionFixture({ brokenSpreadPolicy: "EXCLUDE" }),
  }));
  assert.equal(outcome.decision, "HOLD");
  assert.equal(outcome.status, "INCONSISTENT_BROKEN_SPREAD_POLICY");
  assert.ok(outcome.blockedBy.includes("BROKEN_SPREAD_POLICY_MISMATCH"));
});

test("una política PENDING de TR-01 no bloquea: la medición es la fuente", () => {
  const measurement = measurementFixture();
  measurement.brokenSpreadPolicy = "INCLUDE";
  const outcome = evaluateTradesFreeze(frozenInput({
    measurement,
    sourceDecision: { brokenSpreadPolicy: "PENDING_MEASUREMENT; se congela en TR-04", measurements: {} },
  }));
  assert.equal(outcome.status, "PENDING_OWNER_APPROVAL");
});

// --- Reglas de frescura, dato ausente y muestras insuficientes -----------

test("la penalización es UNKNOWN con muestra insuficiente y no se sustituye por cero", () => {
  const measurement = measurementFixture({ days: 3 });
  const penalty = derivePenaltyForMission({ measurement, market: "GAS_THE", mission: "GAS_QUARTERLY" });
  assert.equal(penalty.status, "UNKNOWN");
  assert.equal(penalty.value, null);
  const outcome = evaluateTradesFreeze(frozenInput({ measurement }));
  assert.equal(outcome.status, "PENDING_MEASUREMENT");
  assert.ok(outcome.blockedBy.includes("UNMEASURED_CONTRACT_PARAMETERS"));
});

test("el límite de frescura sale de la cobertura de la mitad de calibración", () => {
  const measurement = measurementFixture();
  const freshness = deriveFreshnessForMission({ measurement, market: "GAS_THE", mission: "GAS_QUARTERLY" });
  assert.equal(freshness.status, "MEASURED");
  assert.ok(FRESHNESS_LIMIT_CANDIDATES_SECONDS.includes(freshness.value));
  assert.ok(freshness.coverage >= FRESHNESS_COVERAGE_TARGET);
  assert.ok(measurement.markets.GAS_THE.missions.GAS_QUARTERLY.summary.coverage.LAST_TRADE.byHalf[HALVES.CALIBRATION]);
});

test("las reglas de dato ausente están declaradas y distinguen DATA_INCOMPLETE del hard-reject", () => {
  assert.equal(TRADES_MISSING_DATA_RULES.WINDOW_SOURCE, "WINDOW_FROM_MISSION_AND_MARKET_CALENDAR_NOT_FROM_TRADE_PRESENCE");
  assert.equal(TRADES_MISSING_DATA_RULES.CARRY, "NO_CARRY_OF_A_PRICE_BEYOND_THE_FRESHNESS_LIMIT");
  assert.equal(TRADES_MISSING_DATA_RULES.INCOMPLETE_VS_FORCING, "DATA_INCOMPLETE_IS_DISTINCT_FROM_CLIENT_FORCING_HARD_REJECT");
});

test("el configHash cambia si cambia el contenido del contrato", () => {
  const base = buildTradesFreezeCandidate(frozenInput());
  const changed = buildTradesFreezeCandidate(frozenInput({
    measurement: measurementFixture({ penalties: { GAS_QUARTERLY: 2.5 } }),
  }));
  assert.notEqual(base.configHash, changed.configHash);
  assert.equal(base.configHash, tradesConfigHash(base));
});

test("la grilla de sensibilidad y el gate del puente quedan predeclarados", () => {
  assert.ok(TRADES_SENSITIVITY_GRID.penaltyMultipliers.includes(0));
  assert.ok(TRADES_SENSITIVITY_GRID.penaltyMultipliers.includes(1));
  assert.deepEqual(TRADES_SENSITIVITY_GRID.freshnessLimitSeconds, FRESHNESS_LIMIT_CANDIDATES_SECONDS);
  assert.equal(TRADES_BRIDGE_GATE.toBridgeResultsAlreadyKnown, true);
  assert.equal(TRADES_BRIDGE_GATE.independence, "NOT_INDEPENDENT_VALIDATION");
  assert.deepEqual(TRADES_BRIDGE_GATE.arms, ["BASELINE", "DIP10", "HOUR"]);
  assert.deepEqual(TRADES_BRIDGE_GATE.armOrderRule.arms, ["BASELINE", "DIP10", "HOUR"]);
});

test("un penalty UNKNOWN con valor se rechaza (nunca cero)", () => {
  const candidate = buildTradesFreezeCandidate(frozenInput());
  candidate.markets.GAS_THE.missions.GAS_QUARTERLY.observations.LAST_TRADE.penalty = { status: "UNKNOWN", value: 0 };
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
  // Precio negativo de power admitido; el slippage no.
  assert.equal(deriveTradesFillPrice({ tradePrice: -10, penaltyEurMwh: 1, slippageEurMwh: 0.15 }).price, -8.85);
  assert.equal(deriveTradesFillPrice({ tradePrice: 100, penaltyEurMwh: 1, slippageEurMwh: -0.15 }).ok, false);
  assert.equal(deriveTradesFillPrice({ tradePrice: 100, penaltyEurMwh: null }).ok, false);
});