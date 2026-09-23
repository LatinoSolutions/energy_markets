// Tests IMP-12 (replay y ledgers P6). Fuente: SPEC v1.1.1 §25.1 fila IMP-12
// ("Decision, execution y coverage ledgers | Pasos cronológicos; WAIT conserva
// residual; partial/no-fill no cubre cantidad solicitada") y §14
// (P6.1–P6.10). Fixtures sintéticos explícito: no son datos reales del cliente
// (§25.2 fila IMP-12: "fixtures conservan naturaleza sintética explícita").

import test from "node:test";
import assert from "node:assert/strict";

import { runP6Replay, buildReplayBundle } from "../../src/p6-evaluator/index.mjs";
import { createA0Baseline, validateA0TimingState } from "../../src/sizing-controller/a0-baseline.mjs";
import { createSizingController, RECONCILED_RULE_PREDECLARATION } from "../../src/sizing-controller/sizing-controller.mjs";
import { createGasQuarterlyExecutionContract, executionParameterOf } from "../../src/execution-contract/execution-contract.mjs";
import { createGasQuarterlyCostLedger } from "../../src/execution-contract/cost-ledger.mjs";

const PROVENANCE = {
  authority: "test-fixture (sintético, IMP-08 precedente)",
  locator: "test/p6-evaluator/replay.test.mjs",
};

function calendarWithDecisionTimes(dates, decisionTimeUtcByDate) {
  return {
    calendarId: "CAL-FIXTURE",
    campaignId: "GAS-Q-FIXTURE",
    opportunities: dates.map((date) => ({
      date,
      scheduled: true,
      decisionTimeUtc: decisionTimeUtcByDate[date],
    })),
    scheduledOpportunitiesCount: dates.length,
  };
}

function syntheticArm(calendar, controller) {
  const { arm } = createA0Baseline({ controller, calendar });
  arm.armVersion = `hash:${controller.contentHash}`;
  return arm;
}

function noopController() {
  return createSizingController({
    lotSizeMw: 1,
    dailyCapMw: 12,
    provenance: { authority: PROVENANCE.authority, locator: PROVENANCE.locator },
  });
}

// Fixtures sintéticos: obligación/temporalidad de test, no del cliente.
function fixtureBundle({
  dates = ["2026-01-05", "2026-01-06", "2026-01-07"],
  openingObligation = 6,
  priceObservations = "eligible",
  arm = null,
  terminalRuleStatus = "UNVERIFIED",
} = {}) {
  const controllerOutcome = noopController();
  assert.equal(controllerOutcome.ok, true);
  const executionContract = createGasQuarterlyExecutionContract();
  const costLedger = createGasQuarterlyCostLedger();
  const calendar = calendarWithDecisionTimes(dates, Object.fromEntries(dates.map((date) => [date, `${date}T10:00:00Z`])));
  const observations = priceObservations === "none"
    ? []
    : priceObservations.map((observation) => ({ ...observation }));

  return buildReplayBundle({
    experiment: { experimentId: "EXP-FIXTURE-GAS-Q", experimentVersion: "v1.0" },
    campaign: { campaignId: "GAS-Q-FIXTURE", product: "Gas", mission: "Quarterly" },
    openingContract: {
      obligationId: "OBL-FIXTURE",
      openingObligation,
      deadline: "2026-01-07T10:00:00Z",
      unit: "MW",
      terminalRuleStatus,
      amendments: [],
      residualAmendment: null,
    },
    decisionCalendar: calendar,
    arm: arm ?? syntheticArm(calendar, controllerOutcome.controller),
    sizingConfiguration: controllerOutcome.controller,
    execution: { executionContractVersion: "v1.0", costLedgerVersion: "v1.0" },
    executionContract,
    costLedger,
    priceObservations: observations,
    benchmark: { sourceVersion: "eex-reference-price/in-memory-fixture", status: "UNRECONCILED" },
    evaluator: { evaluatorVersion: "v1.0" },
    stochasticity: null,
  });
}

// La ejecución simulada sigue la regla frozen del cliente para el backtest:
// referencia latest best ask at-or-before 11:00 y slippage 0.15 (OFICINA.md).
function flatPricesFor(dates) {
  return dates.map((date) => ({ timestamp: `${date}T09:55:00Z`, bestAsk: 40.5 }));
}

test("§14.2: un required input ausente no se reemplaza por default (fail-closed)", () => {
  const incomplete = buildReplayBundle({});
  assert.equal(incomplete.ok, false);
  const codes = incomplete.errors.map((error) => error.code);
  for (const code of [
    "MISSING_EXPERIMENT_IDENTITY", "MISSING_CAMPAIGN_IDENTITY", "MISSING_OPENING_CONTRACT",
    "INVALID_DECISION_CALENDAR", "MISSING_FROZEN_ARM", "MISSING_SIZING_CONFIG",
    "MISSING_EXECUTION_VERSIONS", "MISSING_EXECUTION_CONTRACT", "MISSING_COST_LEDGER",
    "INVALID_PRICE_OBSERVATIONS", "MISSING_BENCHMARK_CONFIG", "MISSING_EVALUATOR_VERSION",
  ]) {
    assert.ok(codes.includes(code), `falta ${code}`);
  }
});

test("§14.3: orden cronológico de pasos y ledgers por opportunity", () => {
  const bundle = fixtureBundle({ priceObservations: flatPricesFor(["2026-01-05", "2026-01-06", "2026-01-07"]) });
  assert.equal(bundle.ok, true);
  const outcome = runP6Replay(bundle.bundle, { runTimestampUtc: "2026-09-23T00:00:00Z" });
  assert.equal(outcome.ok, true);

  const { ledgers, terminalCoverage, status } = outcome.replay;
  const decisionDates = ledgers.decision.map((row) => row.frontier);
  assert.deepEqual(decisionDates, ["2026-01-05", "2026-01-06", "2026-01-07"]);
  assert.ok(ledgers.decision.every((row) => row.decisionTimestamp === `${row.frontier}T10:00:00Z`));
  assert.ok(ledgers.execution.every((row) => row.eligibleExecutionTimestamp === null || row.eligibleExecutionTimestamp <= row.decisionTimestamp));

  // Accounting: 3 x 2 MW cubren la obligación; la cobertura reconcilia.
  assert.equal(terminalCoverage.executedVolume, 6);
  assert.equal(terminalCoverage.remainingVolume, 0);
  assert.equal(terminalCoverage.coverageStatus, "COVERED");
  assert.equal(terminalCoverage.unit, "MW");
  assert.deepEqual(status, {
    validity: "VALID_RUN",
    availability: null,
    coverage: "COVERED",
    benchmark: "BENCHMARK_PROVISIONAL",
  });

  // Cada fill entra una vez al ledger con su coste contado una vez (§14.4):
  assert.equal(ledgers.execution.length, 3);
  for (const row of ledgers.execution) {
    assert.equal(row.filledQuantity, 2);
    assert.equal(row.partialQuantity, 0);
    assert.equal(row.noFill, false);
    const slippageCosts = row.executionCosts.filter((cost) => cost.costId === "cost.slippage.virtual");
    assert.equal(slippageCosts.length, 1);
    assert.equal(slippageCosts[0].countedOnce, true);
  }
  // El precio sigue la derivación frozen: best ask + slippage (§13.6).
  assert.ok(ledgers.execution.every((row) => row.executionPrice === 40.5 + 0.15));
  assert.ok(ledgers.execution.every((row) => row.lotRoundingTreatment === executionParameterOf(createGasQuarterlyExecutionContract(), "rounding").value));
});

test("§14.5: WAIT en cada decisión conserva el residual (fixture WAIT-everything)", () => {
  const dates = ["2026-01-05", "2026-01-06", "2026-01-07"];
  const controllerOutcome = noopController();
  const calendar = calendarWithDecisionTimes(dates, Object.fromEntries(dates.map((date) => [date, `${date}T10:00:00Z`])));
  const waitArm = {
    armId: "WAIT-Fixture",
    armVersion: "frozen:WAIT-everything-fixture",
    decideAtOpportunity() {
      return { ok: true, action: "WAIT", requestedQuantityMw: 0, feasibility: "OK" };
    },
  };
  const bundle = fixtureBundle({ dates, openingObligation: 4, arm: waitArm, priceObservations: [] });
  assert.equal(bundle.ok, true);
  const outcome = runP6Replay(bundle.bundle, { runTimestampUtc: "2026-09-23T00:00:00Z" });
  const { ledgers, terminalCoverage, status } = outcome.replay;
  assert.equal(ledgers.decision.length, 3);
  assert.ok(ledgers.decision.every((row) => row.action === "WAIT" && row.requestedQuantity === 0));
  assert.equal(ledgers.execution.length, 0, "WAIT no genera compra (§13.4)");
  assert.ok(ledgers.coverage.every((row) => row.remainingVolume === 4));
  assert.equal(terminalCoverage.executedVolume, 0);
  assert.equal(terminalCoverage.remainingVolume, 4);
  // §14.5: residual sin terminal rule válida válida → COVERAGE_INCOMPLETE.
  assert.equal(terminalCoverage.coverageStatus, "COVERAGE_INCOMPLETE");
  assert.equal(status.validity, "VALID_RUN");
  assert.equal(status.coverage, "COVERAGE_INCOMPLETE");
});

test("§14.5/§14.7: sin precio elegible hay no-fill; el requested no cubre cantidad", () => {
  const bundle = fixtureBundle({ priceObservations: "none" });
  assert.equal(bundle.ok, true);
  const outcome = runP6Replay(bundle.bundle, { runTimestampUtc: "2026-09-23T00:00:00Z" });
  const { ledgers, terminalCoverage, receipt } = outcome.replay;
  // El arm pidió BUY, pero la ejecución no requiere precio disponible: filas
  // no-fill, cero ejecutado, obligación intacta. No se fabrica fill.
  assert.equal(ledgers.execution.length, 3);
  assert.ok(ledgers.execution.every((row) => row.noFill === true && row.filledQuantity === 0));
  assert.ok(ledgers.coverage.every((row) => row.noFillQuantity === row.requestedQuantity));
  assert.equal(terminalCoverage.executedVolume, 0);
  assert.equal(terminalCoverage.remainingVolume, 6);
  assert.equal(terminalCoverage.coverageStatus, "COVERAGE_INCOMPLETE");
  assert.ok(receipt.missingDataEvents.length >= 1);
});

test("§14.3/§14.7: una observación posterior a la frontera no es elegible (sin hindsight)", () => {
  // Todas las observaciones son posteriores a la última frontera de decisión:
  // ninguna es elegible para ningún fill y no se inventa el precio que sí
  // existiría después (§13.6 regla 1: at-or-before la frontera correspondiente).
  const bundle = fixtureBundle({
    priceObservations: [
      { timestamp: "2026-01-07T11:30:00Z", bestAsk: 7.77 },
      { timestamp: "2026-01-07T11:40:00Z", bestAsk: 7.79 },
    ],
  });
  assert.equal(bundle.ok, true);
  const outcome = runP6Replay(bundle.bundle);
  const { ledgers, terminalCoverage } = outcome.replay;
  assert.ok(ledgers.execution.every((row) => row.noFill === true && row.executionPrice === null));
  assert.equal(terminalCoverage.executedVolume, 0);
});

test("§14.4/§13.6 regla 3: partial fill aplica el cap diario; el no cubierto no suma cobertura", () => {
  // Arm frozen sintético que pide 5 aunque el cap diario del contract del
  // fixture es 2: P5.6 aplica la restricción a la ejecución (requested queda
  // parcialmente sin cubrir) y el residual permanece visible en coverage
  // (§14.5), sin ocultarse en V.
  const dates = ["2026-01-05"];
  const calendar = calendarWithDecisionTimes(dates, { "2026-01-05": "2026-01-05T10:00:00Z" });
  const greedyArm = {
    armId: "GREEDY-Fixture",
    armVersion: "frozen:greedy-fixture",
    decideAtOpportunity() {
      return { ok: true, action: "BUY", requestedQuantityMw: 5, feasibility: "OK" };
    },
  };
  // Fixture explícito: contrato del caso con cap diario = 2 (sintético: no es
  // el valor provisional 12 del paquete del cliente).
  const capTwoContract = createGasQuarterlyExecutionContract();
  const capParameter = executionParameterOf(capTwoContract, "dailyQuantityCap");
  capParameter.value = 2;
  capParameter.reason = "fixture sintético: cap=2 para probar la restricción diaria (no es valor del cliente)";
  capTwoContract.contentHash = `${capTwoContract.contentHash}-fixture-cap2`;
  const capTwo = createSizingController({ lotSizeMw: 1, dailyCapMw: 2, provenance: { authority: `${PROVENANCE.authority} (config cap=2 fixture)`, locator: PROVENANCE.locator } });

  const bundleOutcome = buildReplayBundle({
    experiment: { experimentId: "EXP-FIXTURE-PARTIAL", experimentVersion: "v1.0" },
    campaign: { campaignId: "GAS-Q-FIXTURE", product: "Gas", mission: "Quarterly" },
    openingContract: {
      obligationId: "OBL-FIXTURE",
      openingObligation: 5,
      deadline: "2026-01-05T10:00:00Z",
      unit: "MW",
      terminalRuleStatus: "UNVERIFIED",
    },
    decisionCalendar: calendar,
    arm: greedyArm,
    sizingConfiguration: capTwo.controller,
    execution: { executionContractVersion: "v1.0", costLedgerVersion: "v1.0" },
    executionContract: capTwoContract,
    costLedger: createGasQuarterlyCostLedger(),
    priceObservations: [{ timestamp: "2026-01-05T09:55:00Z", bestAsk: 40.5 }],
    benchmark: { sourceVersion: "eex-reference-price/in-memory-fixture", status: "UNRECONCILED" },
    evaluator: { evaluatorVersion: "v1.0" },
    stochasticity: null,
  });
  assert.equal(bundleOutcome.ok, true);
  const outcome = runP6Replay(bundleOutcome.bundle, { runTimestampUtc: "2026-09-23T00:00:00Z" });
  const { ledgers, terminalCoverage, receipt } = outcome.replay;

  const [executionRow] = ledgers.execution;
  assert.equal(executionRow.requestedQuantity, 5);
  assert.equal(executionRow.filledQuantity, 2);
  assert.equal(executionRow.partialQuantity, 3);
  assert.equal(terminalCoverage.executedVolume, 2, "coverage cambia por filled, no por requested");
  assert.equal(terminalCoverage.remainingVolume, 3);
  assert.equal(terminalCoverage.coverageStatus, "COVERAGE_INCOMPLETE");
  assert.ok(receipt.warnings.some((warning) => warning.includes("partial fill")));
});

test("§14.4: ledgers append-only dentro del run", () => {
  const bundle = fixtureBundle({ priceObservations: flatPricesFor(["2026-01-05", "2026-01-06", "2026-01-07"]) });
  const outcome = runP6Replay(bundle.bundle);
  const { ledgers } = outcome.replay;
  for (const ledger of Object.values(ledgers)) {
    assert.ok(Array.isArray(ledger));
    Object.freeze(ledger);
  }
  // Congelar la salida y verificar identidad de conteo por fila.
  assert.equal(ledgers.decision.length, 3);
  assert.equal(ledgers.execution.length, 3);
  assert.equal(ledgers.coverage.length, 3);
  for (let sequence = 0; sequence < ledgers.coverage.length; sequence += 1) {
    const row = ledgers.coverage[sequence];
    assert.equal(row.conservation.declaration, "Opening = Executed + Remaining (§14.5)");
  }
});

test("§14.9: mismo frozen bundle + misma configuración → mismos ledgers/receipt", () => {
  const bundle = fixtureBundle({ priceObservations: flatPricesFor(["2026-01-05", "2026-01-06", "2026-01-07"]) });
  const first = runP6Replay(bundle.bundle, { runTimestampUtc: "2026-09-23T00:00:00Z" });
  const second = runP6Replay(bundle.bundle, { runTimestampUtc: "2026-09-23T00:00:00Z" });
  assert.equal(JSON.stringify(first.replay.ledgers), JSON.stringify(second.replay.ledgers));
  assert.equal(JSON.stringify(first.replay.receipt), JSON.stringify(second.replay.receipt));
});

test("§14.1: el evaluador no entrena, no optimiza ni repara el diseño frozen", () => {
  const bundle = fixtureBundle({ priceObservations: flatPricesFor(["2026-01-05", "2026-01-06", "2026-01-07"]) });
  const armVersionBefore = bundle.bundle.arm.armVersion;
  const controllerHashBefore = bundle.bundle.sizingConfiguration.contentHash;
  const contractHashBefore = bundle.bundle.executionContract.contentHash;
  runP6Replay(bundle.bundle, { runTimestampUtc: "2026-09-23T00:00:00Z" });
  assert.equal(bundle.bundle.arm.armVersion, armVersionBefore);
  assert.equal(bundle.bundle.sizingConfiguration.contentHash, controllerHashBefore);
  assert.equal(bundle.bundle.executionContract.contentHash, contractHashBefore);
  // La run receipt congela las versiones, no las reescribe.
  const second = runP6Replay(bundle.bundle, { runTimestampUtc: "2026-09-23T00:00:00Z" });
  assert.equal(second.replay.receipt.armVersion, armVersionBefore);
  assert.equal(second.replay.receipt.sizingRuleVersion, RECONCILED_RULE_PREDECLARATION.ruleId);
});

test("§14.10: un brazo que falla sin conducta frozen invalida el run sin repararse", () => {
  const dates = ["2026-01-05", "2026-01-06"];
  const controllerOutcome = noopController();
  const calendar = calendarWithDecisionTimes(dates, Object.fromEntries(dates.map((date) => [date, `${date}T10:00:00Z`])));
  const brokenArm = {
    armId: "BROKEN-Fixture",
    armVersion: "frozen:broken-fixture",
    decideAtOpportunity() {
      return { ok: false, code: "BROKEN_ARM", reason: "fixture: decisión no interpretable" };
    },
  };
  const bundle = fixtureBundle({ dates, arm: brokenArm, priceObservations: [] });
  assert.equal(bundle.ok, true);
  const outcome = runP6Replay(bundle.bundle, { runTimestampUtc: "2026-09-23T00:00:00Z" });
  assert.equal(outcome.replay.status.validity, "INVALID_RUN");
  assert.ok(outcome.replay.receipt.invalidityReasons.length > 0);
  assert.equal(outcome.replay.ledgers.execution.length, 0);
});

test("§14.3: la policy no consume benchmark en la decisión (separación de vistas)", () => {
  const dates = ["2026-01-05"];
  const controllerOutcome = noopController();
  const calendar = calendarWithDecisionTimes(dates, { "2026-01-05": "2026-01-05T10:00:00Z" });
  const timingState = { frontierDate: "2026-01-05", remainingVolume: 6, executedVolume: 0, unit: "MW", benchmarkB: 40.5 };
  const gate = validateA0TimingState(timingState);
  assert.equal(gate.ok, false, "un estado de decisión con benchmarkB es rechazado por A0");
  const arm = syntheticArm(calendar, controllerOutcome.controller);
  const bundle = fixtureBundle({ dates, priceObservations: flatPricesFor(dates) });
  assert.equal(bundle.ok, true);
  const outcome = runP6Replay(bundle.bundle, { runTimestampUtc: "2026-09-23T00:00:00Z" });
  // El replay decide por calendario independiente del benchmark del bundle:
  assert.equal(outcome.replay.ledgers.decision[0].action, "BUY");
  assert.equal(outcome.replay.ledgers.decision[0].pitReferences.length, 0, "sin referencia PIT a benchmark/outcome en el decision ledger");
  assert.equal(outcome.replay.status.benchmark, "BENCHMARK_PROVISIONAL");
});
