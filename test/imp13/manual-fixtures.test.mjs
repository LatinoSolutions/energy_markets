// Suite IMP-13 — fixtures manuales P6 (§14.8) + fixtures documentales de
// benchmark/scoring (§19.3.1). Fuente: SPEC v1.1.1 §25.1 fila IMP-13
// ("Expected independiente antes de automation; todos los invariantes pasan
// incluyendo overlapping obligations y revision"), §14.8 (diez fixtures
// canónicos), §14.5, §14.7, §4.3, §5.3, §5.6 y §19.3.1.
//
// Los expected results fueron calculados/inspeccionados a mano ANTES de
// codificar cada test: operations/audit/IMP-13/fixture-oracle/
// independent-calculations.md. Todos los inputs son sintéticos explícitos:
// no son datos reales del cliente, no prueban edge y no cierran DEP-13 ni P6
// (§14.8 "esta suite verifica accounting y causality; no certifica market
// edge"; §25.2 fila IMP-13 "Ningún fixture sintético es evidencia de edge").

import test from "node:test";
import assert from "node:assert/strict";

import { runP6Replay, buildReplayBundle } from "../../src/p6-evaluator/index.mjs";
import { createA0Baseline } from "../../src/sizing-controller/a0-baseline.mjs";
import { createSizingController } from "../../src/sizing-controller/sizing-controller.mjs";
import { createGasQuarterlyExecutionContract, executionParameterOf } from "../../src/execution-contract/execution-contract.mjs";
import { createGasQuarterlyCostLedger } from "../../src/execution-contract/cost-ledger.mjs";
import { mapCoverageOwnership } from "../../src/procurement-contract/index.mjs";
import {
  benchmarkB,
  computeAllInH,
  computeV,
  isWithinFallbackWindow,
  isWithinWindow,
  proxyReference,
  quarterlyResearchVerdict,
  scoreQuarterly,
  selectDailyReference,
} from "../../src/economic-calculation/index.mjs";
import { canonicalValueSha256 } from "../../src/pit-views/pit-record.mjs";
import { buildPitManifestAt, buildRevision, readDecisionView, readEvaluationView } from "../../src/pit-views/views.mjs";
import { ATTESTATION_PATH, FIXTURE_SCOPE, VALUE_ATTESTATION_PATH, fixtureRepo } from "../pit-views/fixture-repo.mjs";

const PROVENANCE = {
  authority: "test-fixture (sintético, IMP-13)",
  locator: "test/imp13/manual-fixtures.test.mjs",
};

const CONSUMABLE_EVIDENCE = {
  source: "fixture://ingest-log",
  locator: "IMP-13 fixture @ 2026-01-04T10:30Z",
  sha256: "a".repeat(64),
};

// Manifest PIT sintético verificado (patrón de test/pit-views): las
// atestaciones de consumo y de procedencia se leen de artifacts verificados
// contra un IMP_RECEIPT sintético, no se aceptan en memoria (§25.2). No es
// cobertura de datos real.
function buildManifest({ manifestId, records, revisions = [] }) {
  const consumptionAttestations = records
    .filter((record) => typeof record.consumableAtUtc === "string"
      && record.value !== undefined && record.value !== null
      && typeof record.revisionId === "string")
    .map((record) => ({
      ...CONSUMABLE_EVIDENCE,
      key: record.key,
      revisionId: record.revisionId,
      valueSha256: canonicalValueSha256(record.value).sha256,
      consumableAtUtc: record.consumableAtUtc,
    }));
  const valueAttestations = records
    .filter((record) => record.value !== undefined && record.value !== null && typeof record.revisionId === "string")
    .map((record) => {
      const receipt = revisions.find((revision) => revision.key === record.key && revision.revisionId === record.revisionId);
      return {
        source: "fixture://value-log",
        locator: `${record.key}@${record.revisionId}`,
        sha256: "b".repeat(64),
        key: record.key,
        revisionId: record.revisionId,
        revisionOf: record.revisionOf ?? null,
        valueSha256: canonicalValueSha256(record.value).sha256,
        publishedAtUtc: record.publishedAtUtc,
        revisionEffectiveAtUtc: receipt ? receipt.effectiveAtUtc : null,
      };
    });
  const consumptionContent = JSON.stringify({ artifactKind: "PIT_CONSUMPTION_ATTESTATIONS", auditId: "AUDIT-FIXTURE", scope: FIXTURE_SCOPE, attestations: consumptionAttestations });
  const valueContent = JSON.stringify({ artifactKind: "PIT_VALUE_ATTESTATIONS", auditId: "AUDIT-FIXTURE", scope: FIXTURE_SCOPE, attestations: valueAttestations });
  const { repoRoot, refs } = fixtureRepo({
    artifacts: [
      { path: ATTESTATION_PATH, content: consumptionContent },
      { path: VALUE_ATTESTATION_PATH, content: valueContent },
    ],
  });
  const outcome = buildPitManifestAt(repoRoot, {
    manifestId,
    manifestVersion: "v1",
    records,
    revisions,
    consumptionAttestationRefs: [refs[0]],
    valueAttestationRefs: [refs[1]],
  });
  return outcome;
}

const DECISION_RECORD = {
  key: "G0BQ.FIXTURE.reference",
  viewScope: "decision",
  occurredAtUtc: "2026-01-04T09:55:00Z",
  publishedAtUtc: "2026-01-04T10:00:00Z",
  consumableAtUtc: "2026-01-04T10:30:00Z",
  consumableEvidence: CONSUMABLE_EVIDENCE,
  revisionId: "v1",
  value: 24.35,
};

const BENCHMARK_RECORD = {
  key: "B.G0BQ.FIXTURE.closed",
  viewScope: "evaluation",
  occurredAtUtc: "2026-01-04T09:55:00Z",
  publishedAtUtc: "2026-01-05T10:00:00Z",
  consumableAtUtc: "2026-01-05T10:30:00Z",
  consumableEvidence: CONSUMABLE_EVIDENCE,
  revisionId: "bench-v1",
  value: 25.7,
};

const STANDARD_MANIFEST = { value: null };

function standardManifest() {
  if (STANDARD_MANIFEST.value !== null) {
    return STANDARD_MANIFEST.value;
  }
  const outcome = buildManifest({
    manifestId: "PIT-MANIFEST-IMP13",
    records: [DECISION_RECORD, BENCHMARK_RECORD],
  });
  assert.equal(outcome.ok, true, "el manifest PIT sintético debe construirse verificado");
  STANDARD_MANIFEST.value = outcome.manifest;
  return outcome.manifest;
}

function calendarWithDecisionTimes(dates) {
  return {
    calendarId: "CAL-IMP13",
    campaignId: "GAS-Q-IMP13",
    opportunities: dates.map((date) => ({ date, scheduled: true, decisionTimeUtc: `${date}T10:00:00Z` })),
    scheduledOpportunitiesCount: dates.length,
  };
}

function controllerFor({ lotSizeMw = 1, dailyCapMw = 12 } = {}) {
  const outcome = createSizingController({
    lotSizeMw,
    dailyCapMw,
    provenance: { authority: PROVENANCE.authority, locator: PROVENANCE.locator },
  });
  assert.equal(outcome.ok, true);
  return outcome.controller;
}

function a0Arm(calendar, controller) {
  const { arm } = createA0Baseline({ controller, calendar });
  arm.armVersion = `hash:${controller.contentHash}`;
  return arm;
}

function contractWithCap(capMw) {
  const contract = createGasQuarterlyExecutionContract();
  const parameter = executionParameterOf(contract, "dailyQuantityCap");
  parameter.value = capMw;
  parameter.reason = "fixture sintético IMP-13: cap diario para probar lot/rounding (no es valor del cliente)";
  contract.contentHash = `${contract.contentHash}-fixture-cap${capMw}`;
  return contract;
}

// Input completo del bundle (§14.2) con manifest PIT sintético verificado.
function makeInput({
  dates = ["2026-01-05", "2026-01-06", "2026-01-07"],
  openingObligation = 6,
  observations = [],
  arm = null,
  controller = null,
  executionContract = null,
  terminalRuleStatus = "UNVERIFIED",
  amendments = [],
  residualAmendment = null,
  benchmarkStatus = "UNRECONCILED",
  manifest = null,
} = {}) {
  const activeController = controller ?? controllerFor();
  const calendar = calendarWithDecisionTimes(dates);
  const activeContract = executionContract ?? createGasQuarterlyExecutionContract();
  return {
    experiment: { experimentId: "EXP-IMP13", experimentVersion: "v1.0" },
    campaign: { campaignId: "GAS-Q-IMP13", product: "Gas", mission: "Quarterly" },
    openingContract: {
      obligationId: "OBL-IMP13",
      openingObligation,
      deadline: `${dates[dates.length - 1]}T10:00:00Z`,
      unit: "MW",
      terminalRuleStatus,
      amendments,
      residualAmendment,
    },
    decisionCalendar: calendar,
    arm: arm ?? a0Arm(calendar, activeController),
    sizingConfiguration: activeController,
    execution: { executionContractVersion: "v1.0", costLedgerVersion: "v1.0" },
    executionContract: activeContract,
    costLedger: createGasQuarterlyCostLedger(),
    data: { manifest: manifest ?? standardManifest() },
    priceObservations: observations,
    benchmark: { sourceVersion: "eex-reference-price/in-memory-fixture", status: benchmarkStatus },
    evaluator: { evaluatorVersion: "v1.0" },
    stochasticity: null,
  };
}

function makeBundle(options = {}) {
  const outcome = buildReplayBundle(makeInput(options));
  assert.equal(outcome.ok, true, `el bundle debe construirse: ${JSON.stringify(outcome.errors ?? [])}`);
  return outcome.bundle;
}

function runBundle(options = {}) {
  const outcome = runP6Replay(makeBundle(options), { runTimestampUtc: "2026-09-23T00:00:00Z" });
  assert.equal(outcome.ok, true);
  return outcome.replay;
}

function flatObservations(dates, bestAsk) {
  return dates.map((date) => ({ timestamp: `${date}T09:55:00Z`, bestAsk }));
}

function grossNotional(executionRows) {
  return executionRows.reduce((sum, row) => sum + row.filledQuantity * row.executionPrice, 0);
}

// Aritmética decimal exacta: los expected de 2 decimales se comparan con
// tolerancia 1e-9 para no confundir redondeo IEEE-754 con un fallo contable.
function assertClose(actual, expected, label) {
  assert.ok(Math.abs(actual - expected) <= 1e-9, `${label}: ${actual} != ${expected}`);
}

// --- §14.8 fixture 1: Constant price -----------------------------------------

test("F1 constant price: igual cantidad bajo costes idénticos da igual gross-price result (§14.8)", () => {
  const threeDayDates = ["2026-01-05", "2026-01-06", "2026-01-07"];
  const twoDayDates = ["2026-01-05", "2026-01-07"];

  const runThree = runBundle({ dates: threeDayDates, openingObligation: 6, observations: flatObservations(threeDayDates, 40.5) });
  const runTwo = runBundle({ dates: twoDayDates, openingObligation: 6, observations: flatObservations(twoDayDates, 40.5) });

  // Oracle: 6 MW cubiertos a 40.65 EUR/MWh en ambos runs → 243.9.
  assert.equal(runThree.terminalCoverage.executedVolume, 6);
  assert.equal(runTwo.terminalCoverage.executedVolume, 6);
  assert.equal(runThree.terminalCoverage.coverageStatus, "COVERED");
  assert.equal(runTwo.terminalCoverage.coverageStatus, "COVERED");

  const grossThree = grossNotional(runThree.ledgers.execution);
  const grossTwo = grossNotional(runTwo.ledgers.execution);
  assertClose(grossThree, 243.9, "gross notional run de 3 días");
  assertClose(grossTwo, 243.9, "gross notional run de 2 días");
  assertClose(grossThree / 6, 40.65, "gross-price unitario run de 3 días");
  assertClose(grossTwo / 6, 40.65, "gross-price unitario run de 2 días");

  // Toda diferencia se explica por costes aprobados: el único coste KNOWN es
  // el slippage (0.15 EUR/MWh), contado una vez por fill; los fees restantes
  // quedan UNKNOWN/excluidos, nunca cero (§13.6 regla 4).
  const knownCostIds = new Set();
  for (const row of [...runThree.ledgers.execution, ...runTwo.ledgers.execution]) {
    for (const cost of row.executionCosts) {
      knownCostIds.add(cost.costId);
      assert.equal(cost.countedOnce, true);
    }
  }
  assert.deepEqual([...knownCostIds], ["cost.slippage.virtual"]);
  assert.ok(runThree.receipt.warnings.some((warning) => warning.includes("costs excluded")));
});

// --- §14.8 fixture 2: Ascending price ----------------------------------------

test("F2 ascending price: comprar antes/después se refleja sin future knowledge (§14.8)", () => {
  const dates = ["2026-01-05", "2026-01-06", "2026-01-07"];
  const observations = [
    { timestamp: "2026-01-05T09:55:00Z", bestAsk: 10 },
    { timestamp: "2026-01-06T09:55:00Z", bestAsk: 20 },
    { timestamp: "2026-01-07T09:55:00Z", bestAsk: 30 },
  ];
  const replay = runBundle({ dates, openingObligation: 6, observations });
  const prices = replay.ledgers.execution.map((row) => row.executionPrice);
  // Oracle: 10.15, 20.15, 30.15; 2 MW por frontier.
  assert.deepEqual(prices, [10.15, 20.15, 30.15]);
  assert.deepEqual(replay.ledgers.execution.map((row) => row.filledQuantity), [2, 2, 2]);
  assertClose(grossNotional(replay.ledgers.execution), 120.9, "gross notional ascendente");
  // La frontera d1 usa 10.15, no el mínimo global ni un precio posterior.
  assert.ok(replay.ledgers.execution.every((row) => row.eligibleExecutionTimestamp <= row.decisionTimestamp));
});

// --- §14.8 fixture 3: Descending price ---------------------------------------

test("F3 descending price: WAIT/comprar antes se refleja sin hindsight (§14.8)", () => {
  const dates = ["2026-01-05", "2026-01-06", "2026-01-07"];
  const observations = [
    { timestamp: "2026-01-05T09:55:00Z", bestAsk: 30 },
    { timestamp: "2026-01-06T09:55:00Z", bestAsk: 20 },
    { timestamp: "2026-01-07T09:55:00Z", bestAsk: 10 },
  ];
  const controller = controllerFor();
  const waitThenBuy = {
    armId: "WAIT-THEN-BUY-IMP13",
    armVersion: "frozen:wait-then-buy-imp13",
    decideAtOpportunity({ currentDate }) {
      return currentDate === "2026-01-05"
        ? { ok: true, action: "WAIT", requestedQuantityMw: 0, feasibility: "OK" }
        : { ok: true, action: "BUY", requestedQuantityMw: 0, feasibility: "OK" };
    },
  };
  const replay = runBundle({ dates, openingObligation: 4, observations, controller, arm: waitThenBuy });

  assert.equal(replay.ledgers.decision[0].action, "WAIT");
  assert.equal(replay.ledgers.decision[0].requestedQuantity, 0);
  assert.equal(replay.ledgers.coverage[0].remainingVolume, 4);
  // Oracle: d2 y d3 compran a 20.15 y 10.15; no se elige el precio más alto
  // de d1 con hindsight.
  assert.deepEqual(replay.ledgers.execution.map((row) => row.executionPrice), [20.15, 10.15]);
  assert.deepEqual(replay.ledgers.execution.map((row) => row.filledQuantity), [2, 2]);
  assertClose(grossNotional(replay.ledgers.execution), 60.6, "gross notional descendente");
  assert.equal(replay.terminalCoverage.executedVolume, 4);
});

// --- §14.8 fixture 4: WAIT every decision ------------------------------------

function waitEveryArm() {
  return {
    armId: "WAIT-EVERY-IMP13",
    armVersion: "frozen:wait-every-imp13",
    decideAtOpportunity() {
      return { ok: true, action: "WAIT", requestedQuantityMw: 0, feasibility: "OK" };
    },
  };
}

test("F4a WAIT every decision: remaining persiste y sin terminal act → COVERAGE_INCOMPLETE (§14.8)", () => {
  const dates = ["2026-01-05", "2026-01-06", "2026-01-07"];
  const replay = runBundle({ dates, openingObligation: 4, arm: waitEveryArm(), observations: [] });
  assert.equal(replay.ledgers.decision.length, 3);
  assert.ok(replay.ledgers.decision.every((row) => row.action === "WAIT" && row.requestedQuantity === 0));
  assert.equal(replay.ledgers.execution.length, 0);
  assert.ok(replay.ledgers.coverage.every((row) => row.remainingVolume === 4));
  assert.equal(replay.terminalCoverage.executedVolume, 0);
  assert.equal(replay.terminalCoverage.remainingVolume, 4);
  assert.equal(replay.terminalCoverage.coverageStatus, "COVERAGE_INCOMPLETE");
});

test("F4b WAIT every decision con enmienda documentada: RESIDUAL_CANCELLED sin fill fabricado (§14.8)", () => {
  const dates = ["2026-01-05", "2026-01-06", "2026-01-07"];
  const amendment = {
    amendmentId: "AMEND-IMP13-1",
    obligationId: "OBL-IMP13",
    cancelledVolume: 4,
    unit: "MW",
    authority: "test-fixture (sintético, IMP-13)",
    locator: "operations/audit/IMP-13/fixture-oracle/independent-calculations.md",
  };
  const replay = runBundle({
    dates,
    openingObligation: 4,
    arm: waitEveryArm(),
    observations: [],
    amendments: [amendment],
    residualAmendment: amendment,
  });
  assert.equal(replay.terminalCoverage.executedVolume, 0);
  assert.equal(replay.terminalCoverage.remainingVolume, 4);
  assert.equal(replay.terminalCoverage.coverageStatus, "RESIDUAL_CANCELLED");
  assert.equal(replay.ledgers.execution.length, 0, "la enmienda no es cobertura ejecutada: no se fabrica fill");
});

// --- §14.8 fixture 5: Overlapping obligations --------------------------------

const OVERLAP_RELATION = {
  availability: "AVAILABLE_NOW",
  relationType: "OVERLAPPING",
  value: "fixture sintético IMP-13: obligaciones solapadas de prueba",
  authority: "test-fixture (sintético, IMP-13)",
  locator: "test/imp13/manual-fixtures.test.mjs",
};

test("F5 overlapping obligations: un fill compartido no se cuenta dos veces (§4.3/§14.8)", () => {
  const fills = [
    { fillId: "F1", quantity: 3, unit: "MW" },
    { fillId: "F2", quantity: 2, unit: "MW" },
  ];

  const disjoint = mapCoverageOwnership({
    relationMonthlyQuarterly: OVERLAP_RELATION,
    obligations: [
      { obligationId: "OBL-A", fills: ["F1"] },
      { obligationId: "OBL-B", fills: ["F2"] },
    ],
    fills,
  });
  assert.equal(disjoint.ok, true);
  assert.equal(disjoint.assignments.length, 2);

  const shared = mapCoverageOwnership({
    relationMonthlyQuarterly: OVERLAP_RELATION,
    obligations: [
      { obligationId: "OBL-A", fills: ["F1", "F2"] },
      { obligationId: "OBL-B", fills: ["F1"] },
    ],
    fills,
  });
  assert.equal(shared.ok, false);
  assert.ok(shared.errors.some((error) => error.code === "DUPLICATE_OWNERSHIP"));
});

// --- §14.8 fixture 6: Missing input / missing price --------------------------

test("F6a missing price: no se inventa precio ejecutable ni feature (§14.7/§14.8)", () => {
  const dates = ["2026-01-05", "2026-01-06", "2026-01-07"];
  const replay = runBundle({ dates, openingObligation: 6, observations: [] });
  assert.equal(replay.ledgers.execution.length, 3);
  assert.ok(replay.ledgers.execution.every((row) => row.noFill === true && row.executionPrice === null && row.filledQuantity === 0));
  assert.equal(replay.terminalCoverage.executedVolume, 0);
  assert.equal(replay.terminalCoverage.remainingVolume, 6);
  assert.equal(replay.terminalCoverage.coverageStatus, "COVERAGE_INCOMPLETE");
  assert.ok(replay.receipt.missingDataEvents.length >= 1);
});

test("F6b missing critical input sin fallback frozen: DATA_BLOCKED sin fill inventado (§14.7/§14.8)", () => {
  const dates = ["2026-01-05", "2026-01-06", "2026-01-07"];
  const blockedArm = {
    armId: "DATA-BLOCKED-IMP13",
    armVersion: "frozen:data-blocked-imp13",
    decideAtOpportunity() {
      return { ok: false, code: "DATA_BLOCKED", reason: "fixture sintético IMP-13: input crítico unavailable sin fallback frozen" };
    },
  };
  const replay = runBundle({ dates, openingObligation: 6, observations: [], arm: blockedArm });
  assert.equal(replay.status.availability, "DATA_BLOCKED");
  assert.equal(replay.ledgers.execution.length, 0);
  assert.equal(replay.terminalCoverage.executedVolume, 0);
  assert.equal(replay.terminalCoverage.remainingVolume, 6);
});

// --- §14.8 fixture 7: Revised data -------------------------------------------

const REVISION_KEY = "G0BQ.REV.reference";
const REVISION_V1 = {
  key: REVISION_KEY,
  viewScope: "decision",
  occurredAtUtc: "2026-01-04T09:55:00Z",
  publishedAtUtc: "2026-01-04T10:00:00Z",
  consumableAtUtc: "2026-01-04T10:30:00Z",
  consumableEvidence: CONSUMABLE_EVIDENCE,
  revisionId: "v1",
  revisionOf: null,
  value: 24.35,
};
const REVISION_V2 = {
  key: REVISION_KEY,
  viewScope: "decision",
  occurredAtUtc: "2026-01-05T09:55:00Z",
  publishedAtUtc: "2026-01-06T10:00:00Z",
  consumableAtUtc: "2026-01-06T10:30:00Z",
  consumableEvidence: CONSUMABLE_EVIDENCE,
  revisionId: "v2",
  revisionOf: "v1",
  value: 25.1,
};
const REVISION_RECEIPT = buildRevision({
  key: REVISION_KEY,
  revisionId: "v2",
  revisesRevisionId: "v1",
  effectiveAtUtc: "2026-01-06T11:00:00Z",
  reason: "fixture sintético IMP-13: corrección posterior",
});
assert.equal(REVISION_RECEIPT.ok, true);

function revisionManifest() {
  const outcome = buildManifest({
    manifestId: "PIT-MANIFEST-IMP13-REVISION",
    records: [REVISION_V1, REVISION_V2, BENCHMARK_RECORD],
    revisions: [REVISION_RECEIPT.revision],
  });
  assert.equal(outcome.ok, true, `el manifest con revisión debe construirse: ${JSON.stringify(outcome.errors ?? [])}`);
  return outcome.manifest;
}

test("F7 revised data: el decision state sigue histórico y la evaluación se versiona aparte (§14.6/§14.7/§14.8)", () => {
  const dates = ["2026-01-05", "2026-01-06", "2026-01-07"];
  const manifest = revisionManifest();
  const replay = runBundle({ dates, openingObligation: 6, observations: flatObservations(dates, 40.5), manifest });

  const revisionByFrontier = Object.fromEntries(replay.ledgers.decision.map((row) => [row.frontier, row.pitReferences[0]?.revisionId]));
  // v2 sólo es consumible a las 10:30 del 01-06: la frontera de las 10:00 del
  // 01-06 todavía observa v1. El State histórico no se reescribe.
  assert.equal(revisionByFrontier["2026-01-05"], "v1");
  assert.equal(revisionByFrontier["2026-01-06"], "v1");
  assert.equal(revisionByFrontier["2026-01-07"], "v2");
  // El State histórico del 01-05 no se reescribe: la decision view de ese
  // boundary sigue mostrando v1 = 24.35 (§6.1/§14.7).
  const historical = readDecisionView(manifest, "2026-01-05T10:00:00Z");
  assert.equal(historical.visible[0].revisionId, "v1");
  assert.equal(historical.visible[0].value, 24.35);

  // La revisión de evaluación se versiona por separado: antes del sello del
  // receipt v1 sigue vigente y v2 pendiente; después v2 vigente y v1 superseded.
  const beforeReceipt = readEvaluationView(manifest, "2026-01-06T10:45:00Z");
  assert.equal(beforeReceipt.current.find((row) => row.key === REVISION_KEY).revisionId, "v1");
  assert.ok(beforeReceipt.pendingRevisions.some((revision) => revision.revisionId === "v2"));

  const afterReceipt = readEvaluationView(manifest, "2026-01-07T00:00:00Z");
  assert.equal(afterReceipt.current.find((row) => row.key === REVISION_KEY).revisionId, "v2");
  const superseded = afterReceipt.superseded.find((row) => row.key === REVISION_KEY && row.revisionId === "v1");
  assert.ok(superseded, "v1 debe quedar superseded por v2, no borrado");
  assert.equal(superseded.supersededBy, "v2");
  assert.ok(afterReceipt.appliedRevisions.some((revision) => revision.revisionId === "v2"));

  // El execution ledger no se reescribe por la revisión: precios de las
  // observaciones, no del key revisado.
  assert.ok(replay.ledgers.execution.every((row) => row.executionPrice === 40.65));
});

// --- §14.8 fixture 8: Lot / rounding / costs ---------------------------------

test("F8 lot/rounding/costs: volumen y cada coste reconcilian exactamente una vez (§14.4/§14.5/§14.8)", () => {
  const dates = ["2026-01-05", "2026-01-06", "2026-01-07"];
  const controller = controllerFor({ lotSizeMw: 1, dailyCapMw: 2 });
  const executionContract = contractWithCap(2);
  const replay = runBundle({
    dates,
    openingObligation: 5,
    observations: flatObservations(dates, 40.5),
    controller,
    executionContract,
  });

  // Oracle: 1 + 2 + 2 = 5 MW cubiertos; lot 1 MW.
  assert.deepEqual(replay.ledgers.execution.map((row) => row.filledQuantity), [1, 2, 2]);
  assert.equal(replay.terminalCoverage.executedVolume, 5);
  assert.equal(replay.terminalCoverage.remainingVolume, 0);
  assert.equal(replay.terminalCoverage.coverageStatus, "COVERED");

  // Conservación por fila y total: opening = executed + remaining.
  for (const row of replay.ledgers.coverage) {
    assert.equal(row.executedVolume + row.remainingVolume, 5);
  }
  const sumFilled = replay.ledgers.execution.reduce((sum, row) => sum + row.filledQuantity, 0);
  assert.equal(sumFilled, replay.terminalCoverage.executedVolume);

  // Cada requested es múltiplo del lote y cada coste entra exactamente una vez
  // por fill (countedOnce), sin doble contabilidad.
  assert.ok(replay.ledgers.execution.every((row) => row.requestedQuantity % 1 === 0));
  for (const row of replay.ledgers.execution) {
    const slippage = row.executionCosts.filter((cost) => cost.costId === "cost.slippage.virtual");
    assert.equal(slippage.length, 1);
    assert.equal(slippage[0].countedOnce, true);
  }
});

// --- §14.8 fixture 9: Official-over-proxy benchmark substitution -------------

test("F9 sustitución oficial-sobre-proxy: B se recalcula/versiona; execution ledger/H no se reescriben (§14.6/§14.8)", () => {
  const dates = ["2026-01-05", "2026-01-06", "2026-01-07"];
  const replayBefore = runBundle({ dates, openingObligation: 6, observations: flatObservations(dates, 40.5) });
  const executionBefore = JSON.stringify(replayBefore.ledgers.execution);

  const proxy = proxyReference({ tradesMean: 100 });
  const official = selectDailyReference({ officialRows: [{ value: 102, providerTimestamp: "2026-01-06T18:00:00Z" }], proxy });
  assert.equal(official.value, 102);
  assert.equal(official.source, "official");

  const priorB = benchmarkB({ references: [{ selected: 100 }, { selected: 110 }] });
  const revisedB = benchmarkB({ references: [{ selected: official.value }, { selected: 110 }] });
  assert.equal(priorB.B, 105);
  assert.equal(revisedB.B, 106);
  assert.equal(priorB.B, 105, "el B previo se preserva como versión separada");

  // H all-in desde el ledger de ejecución (base 40.5 + slippage 0.15) no
  // depende de B; el execution ledger no se reescribe por la sustitución.
  const H = computeAllInH({ base: 40.5, unit: "EUR/MWh", costs: [{ status: "known", value: 0.15 }], costsComplete: true });
  assert.equal(H.H, 40.65);
  assert.equal(computeV({ B: priorB.B, BUnit: "EUR/MWh", H: H.H, HUnit: "EUR/MWh" }).V, 64.35);
  assert.equal(computeV({ B: revisedB.B, BUnit: "EUR/MWh", H: H.H, HUnit: "EUR/MWh" }).V, 65.35);

  const replayAfter = runBundle({ dates, openingObligation: 6, observations: flatObservations(dates, 40.5) });
  assert.equal(JSON.stringify(replayAfter.ledgers.execution), executionBefore, "la sustitución de benchmark no reescribe execution/H");
});

// --- §14.8 fixture 10: Neutral / undefined scoring cases ---------------------

test("F10 neutral/undefined: V=0, sin downside, n<2 y ratios indefinidos sin epsilon ni PASS (§5.5/§5.6/§5.7/§14.8)", () => {
  // V = 0 es neutral, no éxito.
  const neutral = computeV({ B: 105, BUnit: "EUR/MWh", H: 105, HUnit: "EUR/MWh" });
  assert.equal(neutral.V, 0);
  assert.equal(neutral.sign, "neutral");

  // Sin downside: A/R/C indefinidos, sigma=0, Sortino indefinido (sin epsilon).
  const noDownside = scoreQuarterly([4, 3]);
  assert.equal(noDownside.A, null);
  assert.equal(noDownside.R, null);
  assert.equal(noDownside.C, null);
  assert.equal(noDownside.sigmaDown, 0);
  assert.equal(noDownside.sortino, null);
  assert.equal(noDownside.defined, false);
  assert.equal(noDownside.screenPass, false);

  // n<2: n-1=0, sigma y Sortino indefinidos.
  const nLessThanTwo = scoreQuarterly([4]);
  assert.equal(nLessThanTwo.n, 1);
  assert.equal(nLessThanTwo.sigmaDown, null);
  assert.equal(nLessThanTwo.sortino, null);
  assert.equal(nLessThanTwo.defined, false);

  // Población exactamente cero: n_nonzero=0, todo indefinido, neutral aparte.
  const exactZero = scoreQuarterly([0, 0]);
  assert.equal(exactZero.n, 0);
  assert.equal(exactZero.nNeutral, 2);
  assert.equal(exactZero.mu, null);
  assert.equal(exactZero.sortino, null);

  // Un caso indefinido nunca se convierte en PASS artificial.
  const verdict = quarterlyResearchVerdict({
    scoring: scoreQuarterly([4, 3]),
    evidence: { minimumEvidenceMet: true },
  });
  assert.equal(verdict.verdict, "HOLD");
});

// --- §19.3.1 documentary benchmark/scoring fixtures --------------------------

test("§19.3.1 benchmark: proxy 0.75*100+0.25*104=101, sin VWAP", () => {
  const outcome = proxyReference({ tradesMean: 100, midpointsMean: 104 });
  assert.equal(outcome.value, 101);
  assert.equal(outcome.sourceLabel, "proxy");
});

test("§19.3.1 benchmark: trades-only 100, midpoints-only 104, sin fuente missing", () => {
  assert.equal(proxyReference({ tradesMean: 100 }).value, 100);
  assert.equal(proxyReference({ midpointsMean: 104 }).value, 104);
  const missing = proxyReference({});
  assert.equal(missing.value, null);
  assert.equal(missing.sourceLabel, "missing");
});

test("§19.3.1 benchmark: B=105 con peso diario igual", () => {
  const outcome = benchmarkB({ references: [{ date: "2026-01-05", selected: 100 }, { date: "2026-01-06", selected: 110 }] });
  assert.equal(outcome.B, 105);
  assert.equal(outcome.count, 2);
});

test("§19.3.1 benchmark: oficial 102 sustituye proxy 100 -> B=106 y B previo 105 preservado", () => {
  const selected = selectDailyReference({ officialRows: [{ value: 102, providerTimestamp: "2026-01-06T18:00:00Z" }], proxy: proxyReference({ tradesMean: 100 }) });
  assert.equal(selected.value, 102);
  assert.equal(benchmarkB({ references: [{ selected: selected.value }, { selected: 110 }] }).B, 106);
  assert.equal(benchmarkB({ references: [{ selected: 100 }, { selected: 110 }] }).B, 105);
});

test("§19.3.1 benchmark: corrección oficial 102->103 gana el timestamp más reciente -> B=106.5", () => {
  const selected = selectDailyReference({
    officialRows: [
      { value: 102, providerTimestamp: "2026-01-06T18:00:00Z" },
      { value: 103, providerTimestamp: "2026-01-07T09:30:00Z" },
    ],
  });
  assert.equal(selected.value, 103);
  assert.equal(benchmarkB({ references: [{ selected: selected.value }, { selected: 110 }] }).B, 106.5);
});

test("§19.3.1 benchmark: fecha missing luego oficial recalcula conjunto/denominador/cobertura", () => {
  const version1 = benchmarkB({ references: [{ selected: 100 }, { selected: null }], expectedDates: 2 });
  assert.equal(version1.B, 100);
  assert.equal(version1.coverage, "1/2");
  const version2 = benchmarkB({ references: [{ selected: 100 }, { selected: 110 }], expectedDates: 2 });
  assert.equal(version2.B, 105);
  assert.equal(version2.coverage, "2/2");
});

test("§19.3.1 benchmark: ventanas 1-0-1 / 3-1-3 inicio incluido, final excluido", () => {
  assert.equal(isWithinWindow("2026-02-28T23:59:59+01:00", "2026-03-01T00:00:00+01:00", "2026-04-01T00:00:00+02:00"), false);
  assert.equal(isWithinWindow("2026-03-01T00:00:00+01:00", "2026-03-01T00:00:00+01:00", "2026-04-01T00:00:00+02:00"), true);
  assert.equal(isWithinWindow("2026-03-31T23:59:59+02:00", "2026-03-01T00:00:00+01:00", "2026-04-01T00:00:00+02:00"), true);
  assert.equal(isWithinWindow("2026-04-01T00:00:00+02:00", "2026-03-01T00:00:00+01:00", "2026-04-01T00:00:00+02:00"), false);
});

test("§19.3.1 benchmark: fallback ±60 min, extremos incluidos", () => {
  assert.equal(isWithinFallbackWindow("16:14:59"), false);
  assert.equal(isWithinFallbackWindow("16:15:00"), true);
  assert.equal(isWithinFallbackWindow("17:15:00"), true);
  assert.equal(isWithinFallbackWindow("18:15:00"), true);
  assert.equal(isWithinFallbackWindow("18:15:01"), false);
});

test("§19.3.1 scoring: V=+4,-1 -> n=2,p=.5,mu=1.5,R=C=4,sigma=1,Sortino=1.5", () => {
  const scoring = scoreQuarterly([4, -1]);
  assert.equal(scoring.n, 2);
  assert.equal(scoring.p, 0.5);
  assert.equal(scoring.mu, 1.5);
  assert.equal(scoring.R, 4);
  assert.equal(scoring.C, 4);
  assert.equal(scoring.sigmaDown, 1);
  assert.equal(scoring.sortino, 1.5);
});

test("§19.3.1 scoring: V=+3,-1 -> Sortino=1 no supera >1 estricto", () => {
  const scoring = scoreQuarterly([3, -1]);
  assert.equal(scoring.mu, 1);
  assert.equal(scoring.R, 3);
  assert.equal(scoring.C, 3);
  assert.equal(scoring.sortino, 1);
  assert.equal(scoring.screenPass, false);
});

test("§19.3.1 scoring: V=+2,-2 -> mu=0,R=C=1,sigma=2,Sortino=0", () => {
  const scoring = scoreQuarterly([2, -2]);
  assert.equal(scoring.mu, 0);
  assert.equal(scoring.R, 1);
  assert.equal(scoring.C, 1);
  assert.equal(scoring.sigmaDown, 2);
  assert.equal(scoring.sortino, 0);
});

test("§19.3.1 scoring: sólo positivos / exact-zero / n<2 / grupo vacío quedan explícitos", () => {
  const onlyPositives = scoreQuarterly([4, 3]);
  assert.equal(onlyPositives.defined, false);
  assert.ok(onlyPositives.undefinedReason.length > 0);
  const exactZero = scoreQuarterly([0, 0]);
  assert.equal(exactZero.n, 0);
  const nLessThanTwo = scoreQuarterly([4]);
  assert.equal(nLessThanTwo.sortino, null);
  const emptyWinner = scoreQuarterly([-1, -2]);
  assert.equal(emptyWinner.G, null);
  assert.equal(emptyWinner.R, null);
  assert.equal(emptyWinner.defined, false);
});
