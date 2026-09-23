// Tests IMP-12 (replay y ledgers P6). Fuente: SPEC v1.1.1 §25.1 fila IMP-12
// ("Decision, execution y coverage ledgers | Pasos cronológicos; WAIT conserva
// residual; partial/no-fill no cubre cantidad solicitada") y §14
// (P6.1–P6.10). Fixtures sintéticos explícito: no son datos reales del cliente
// (§25.2 fila IMP-12: "fixtures conservan naturaleza sintética explícita").

import test from "node:test";
import assert from "node:assert/strict";

import { runP6Replay, buildReplayBundle, createImmutableLedger, DECISION_LEDGER_FIELDS } from "../../src/p6-evaluator/index.mjs";
import { createA0Baseline, validateA0TimingState } from "../../src/sizing-controller/a0-baseline.mjs";
import { createSizingController, RECONCILED_RULE_PREDECLARATION } from "../../src/sizing-controller/sizing-controller.mjs";
import { createGasQuarterlyExecutionContract, executionParameterOf } from "../../src/execution-contract/execution-contract.mjs";
import { createGasQuarterlyCostLedger } from "../../src/execution-contract/cost-ledger.mjs";
import { canonicalValueSha256 } from "../../src/pit-views/pit-record.mjs";
import { buildPitManifestAt } from "../../src/pit-views/views.mjs";
import { ATTESTATION_PATH, FIXTURE_SCOPE, VALUE_ATTESTATION_PATH, fixtureRepo } from "../pit-views/fixture-repo.mjs";

const PROVENANCE = {
  authority: "test-fixture (sintético, IMP-08 precedente)",
  locator: "test/p6-evaluator/replay.test.mjs",
};

// Manifest PIT sintético (fixture del contrato PIT de IMP-06, repo temporal
// con receipt sintético). Timing deliberately anterior a las fronteras del
// calendar fixture: la versión entra en la decision view de todas ellas (§14.3
// paso 2). No es cobertura de datos real (§25.2 IMP-06).
const PIT_CONSUMABLE_EVIDENCE = {
  source: "fixture://ingest-log",
  locator: "row G0BQ.FIXTURE @ 2026-01-04T10:30Z",
  sha256: "a".repeat(64),
};

const PIT_DECISION_RECORD = {
  key: "G0BQ.FIXTURE.reference",
  viewScope: "decision",
  occurredAtUtc: "2026-01-04T09:55:00Z",
  publishedAtUtc: "2026-01-04T10:00:00Z",
  consumableAtUtc: "2026-01-04T10:30:00Z",
  consumableEvidence: PIT_CONSUMABLE_EVIDENCE,
  revisionId: "v1",
  value: 24.35,
};

const PIT_BENCHMARK_RECORD = {
  key: "B.G0BQ.FIXTURE.closed",
  viewScope: "evaluation",
  occurredAtUtc: "2026-01-04T09:55:00Z",
  publishedAtUtc: "2026-01-05T10:00:00Z",
  consumableAtUtc: "2026-01-05T10:30:00Z",
  consumableEvidence: PIT_CONSUMABLE_EVIDENCE,
  revisionId: "bench-v1",
  value: 25.7,
};

const PIT_FIXTURE = { manifest: null };

// Atestaciones sintéticas (patrón del test PIT de IMP-06): una por versión
// con valor, con su evidencia de consumo y su procedencia de valor.
const PIT_ATTESTATIONS = [PIT_DECISION_RECORD, PIT_BENCHMARK_RECORD].map((record) => ({
  ...PIT_CONSUMABLE_EVIDENCE,
  key: record.key,
  revisionId: record.revisionId,
  valueSha256: canonicalValueSha256(record.value).sha256,
  consumableAtUtc: record.consumableAtUtc,
}));

const PIT_VALUE_ATTESTATIONS = [PIT_DECISION_RECORD, PIT_BENCHMARK_RECORD].map((record) => ({
  source: "fixture://value-log",
  locator: `${record.key}@${record.revisionId}`,
  sha256: "b".repeat(64),
  key: record.key,
  revisionId: record.revisionId,
  revisionOf: null,
  valueSha256: canonicalValueSha256(record.value).sha256,
  publishedAtUtc: record.publishedAtUtc,
  revisionEffectiveAtUtc: null,
}));

function pitManifestForTest() {
  if (PIT_FIXTURE.manifest !== null) {
    return PIT_FIXTURE.manifest;
  }
  const content = JSON.stringify({ artifactKind: "PIT_CONSUMPTION_ATTESTATIONS", auditId: "AUDIT-FIXTURE", scope: FIXTURE_SCOPE, attestations: PIT_ATTESTATIONS });
  const valueContent = JSON.stringify({ artifactKind: "PIT_VALUE_ATTESTATIONS", auditId: "AUDIT-FIXTURE", scope: FIXTURE_SCOPE, attestations: PIT_VALUE_ATTESTATIONS });
  const { repoRoot, refs } = fixtureRepo({
    artifacts: [
      { path: ATTESTATION_PATH, content },
      { path: VALUE_ATTESTATION_PATH, content: valueContent },
    ],
  });
  const outcome = buildPitManifestAt(repoRoot, {
    manifestId: "PIT-DATA-MANIFEST-FIXTURE",
    manifestVersion: "v1",
    records: [PIT_DECISION_RECORD, PIT_BENCHMARK_RECORD],
    consumptionAttestationRefs: [refs[0]],
    valueAttestationRefs: [refs[1]],
  });
  assert.equal(outcome.ok, true, "el manifest PIT de fixture debe construirse verificado");
  PIT_FIXTURE.manifest = outcome.manifest;
  return PIT_FIXTURE.manifest;
}

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
  evaluatorVersion = "v1.0",
  benchmarkStatus = "UNRECONCILED",
  omitData = false,
} = {}) {
  const controllerOutcome = noopController();
  assert.equal(controllerOutcome.ok, true);
  const executionContract = createGasQuarterlyExecutionContract();
  const costLedger = createGasQuarterlyCostLedger();
  const calendar = calendarWithDecisionTimes(dates, Object.fromEntries(dates.map((date) => [date, `${date}T10:00:00Z`])));
  const observations = priceObservations === "none"
    ? []
    : priceObservations.map((observation) => ({ ...observation }));

  return buildReplayBundle(fixtureInput({
    dates, openingObligation, priceObservations, arm, terminalRuleStatus,
    evaluatorVersion, benchmarkStatus, omitData,
  }));
}

// Input completo del fixture (por defecto con el manifest PIT de fixture).
function fixtureInput({
  dates = ["2026-01-05", "2026-01-06", "2026-01-07"],
  openingObligation = 6,
  priceObservations = "eligible",
  arm = null,
  terminalRuleStatus = "UNVERIFIED",
  evaluatorVersion = "v1.0",
  benchmarkStatus = "UNRECONCILED",
  omitData = false,
} = {}) {
  const controllerOutcome = noopController();
  assert.equal(controllerOutcome.ok, true);
  const executionContract = createGasQuarterlyExecutionContract();
  const costLedger = createGasQuarterlyCostLedger();
  const calendar = calendarWithDecisionTimes(dates, Object.fromEntries(dates.map((date) => [date, `${date}T10:00:00Z`])));
  const observations = priceObservations === "none"
    ? []
    : priceObservations.map((observation) => ({ ...observation }));

  return {
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
    ...(omitData ? {} : { data: { manifest: pitManifestForTest() } }),
    priceObservations: observations,
    benchmark: { sourceVersion: "eex-reference-price/in-memory-fixture", status: benchmarkStatus },
    evaluator: { evaluatorVersion },
    stochasticity: null,
  };
}

// La ejecución simulada sigue la regla frozen del cliente para el backtest:
// referencia latest best ask at-or-before 11:00 y slippage 0.15 (OFICINA.md).
function flatPricesFor(dates) {
  return dates.map((date) => ({ timestamp: `${date}T09:55:00Z`, bestAsk: 40.5 }));
}

test("§14.2: el input Data (manifest PIT de P4) es requerido fail-closed", () => {
  // Sin manifest: el required input no se reemplaza por default (§14.2).
  const withoutManifest = buildReplayBundle(fixtureInput({ priceObservations: "none", omitData: true }));
  assert.equal(withoutManifest.ok, false);
  assert.ok(withoutManifest.errors.some((error) => error.code === "MISSING_PIT_DATA_MANIFEST"));

  // Un objeto armado a mano no sustituye un manifest materializado por
  // IMP-06: no tendría records con consumo demostrado (§6.1/§25.2).
  const forged = buildReplayBundle({
    ...fixtureInput({ priceObservations: "none", omitData: true }),
    data: { manifest: { manifestId: "FORGED", manifestVersion: "v1", records: [] } },
  });
  assert.equal(forged.ok, false);
  assert.ok(forged.errors.some((error) => error.code === "MISSING_PIT_DATA_MANIFEST"));
});

test("§14.2: un required input ausente no se reemplaza por default (fail-closed)", () => {
  const incomplete = buildReplayBundle({});
  assert.equal(incomplete.ok, false);
  const codes = incomplete.errors.map((error) => error.code);
  for (const code of [
    "MISSING_EXPERIMENT_IDENTITY", "MISSING_CAMPAIGN_IDENTITY", "MISSING_OPENING_CONTRACT",
    "INVALID_DECISION_CALENDAR", "MISSING_FROZEN_ARM", "MISSING_SIZING_CONFIG",
    "MISSING_EXECUTION_VERSIONS", "MISSING_EXECUTION_CONTRACT", "MISSING_COST_LEDGER",
    "MISSING_PIT_DATA_MANIFEST",
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
  // §14.4: cada fila de decisión referencia versiones PIT reales leídas del
  // manifest de IMP-06 en la frontera exacta (consumible antes de ella).
  for (const row of ledgers.decision) {
    assert.equal(row.pitReferences.length, 1);
    assert.equal(row.pitReferences[0].key, "G0BQ.FIXTURE.reference");
    assert.equal(row.pitReferences[0].revisionId, "v1");
    assert.equal(row.pitReferences[0].consumableFromUtc, "2026-01-04T10:30:00.000Z");
    assert.ok(row.pitReferences[0].consumableFromUtc <= row.decisionTimestamp);
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

test("§14.3/§14.7: partial fill aplica el cap diario; el no cubierto no suma cobertura", () => {
  // §14.3 paso 4: la requested quantity proviene del controller común
  // congelado (lot 1, cap 12 → pide 5 sobre remaining 5), y P5.6 aplica el
  // cap diario del execution contract del fixture (=2, sintético: no es el
  // valor provisional 12 del paquete del cliente). El no cubierto queda
  // visible en coverage (§14.5), sin ocultarse en V.
  const dates = ["2026-01-05"];
  const calendar = calendarWithDecisionTimes(dates, { "2026-01-05": "2026-01-05T10:00:00Z" });
  const greedyArm = {
    armId: "GREEDY-Fixture",
    armVersion: "frozen:greedy-fixture",
    decideAtOpportunity() {
      return { ok: true, action: "BUY", requestedQuantityMw: 5, feasibility: "OK" };
    },
  };
  // Fixture explícito: contrato del caso con cap diario = 2 (sintético).
  const capTwoContract = createGasQuarterlyExecutionContract();
  const capParameter = executionParameterOf(capTwoContract, "dailyQuantityCap");
  capParameter.value = 2;
  capParameter.reason = "fixture sintético: cap=2 para probar la restricción diaria (no es valor del cliente)";
  capTwoContract.contentHash = `${capTwoContract.contentHash}-fixture-cap2`;
  const openController = noopController();

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
    sizingConfiguration: openController.controller,
    execution: { executionContractVersion: "v1.0", costLedgerVersion: "v1.0" },
    executionContract: capTwoContract,
    costLedger: createGasQuarterlyCostLedger(),
    data: { manifest: pitManifestForTest() },
    priceObservations: [{ timestamp: "2026-01-05T09:55:00Z", bestAsk: 40.5 }],
    benchmark: { sourceVersion: "eex-reference-price/in-memory-fixture", status: "UNRECONCILED" },
    evaluator: { evaluatorVersion: "v1.0" },
    stochasticity: null,
  });
  assert.equal(bundleOutcome.ok, true);
  const outcome = runP6Replay(bundleOutcome.bundle, { runTimestampUtc: "2026-09-23T00:00:00Z" });
  const { ledgers, terminalCoverage, receipt } = outcome.replay;

  const [decisionRow] = ledgers.decision;
  // §14.3 paso 4: la cantidad registrada proviene del controller común.
  assert.equal(decisionRow.requestedQuantity, 5);
  assert.equal(decisionRow.pitReferences.length, 1);
  const [executionRow] = ledgers.execution;
  assert.equal(executionRow.requestedQuantity, 5);
  assert.equal(executionRow.filledQuantity, 2);
  assert.equal(executionRow.partialQuantity, 3);
  assert.equal(terminalCoverage.executedVolume, 2, "coverage cambia por filled, no por requested");
  assert.equal(terminalCoverage.remainingVolume, 3);
  assert.equal(terminalCoverage.coverageStatus, "COVERAGE_INCOMPLETE");
  assert.ok(receipt.warnings.some((warning) => warning.includes("partial fill")));
});

test("§14.3 paso 4: una cantidad divergente del arm no reemplaza la del controller común", () => {
  // Arm frozen sintético que pide 99 mientras el controller común congelado
  // deriva 5: el ledger registra la del controller común y la divergencia
  // queda como warning (§14.3 paso 4); nada se corrige en silencio.
  const dates = ["2026-01-05"];
  const calendar = calendarWithDecisionTimes(dates, { "2026-01-05": "2026-01-05T10:00:00Z" });
  const divergentArm = {
    armId: "DIVERGENT-Fixture",
    armVersion: "frozen:divergent-fixture",
    decideAtOpportunity() {
      return { ok: true, action: "BUY", requestedQuantityMw: 99, feasibility: "OK" };
    },
  };
  const bundle = fixtureBundle({ dates, openingObligation: 5, arm: divergentArm, priceObservations: "none" });
  assert.equal(bundle.ok, true);
  const outcome = runP6Replay(bundle.bundle, { runTimestampUtc: "2026-09-23T00:00:00Z" });
  const { ledgers, receipt } = outcome.replay;
  assert.equal(ledgers.decision[0].requestedQuantity, 5);
  assert.equal(ledgers.execution[0].requestedQuantity, 5);
  assert.ok(receipt.warnings.some((warning) => warning.includes("requested quantity divergence")));
});

test("§14.4: ledgers append-only: append acumula y no existe borrado/reescritura", () => {
  // El invariante se ejercita sobre el ledger vivo (§14.4): appendRow
  // acumula, no hay operación de borrado/reescritura/reorden, y el snapshot
  // entrega copias congeladas independientes del acumulador interno.
  const ledger = createImmutableLedger("DECISION", DECISION_LEDGER_FIELDS);
  assert.equal(ledger.rowCount(), 0);
  assert.equal(ledger.appendRow({ sequence: 1, action: "BUY" }).ok, true);
  assert.equal(ledger.appendRow({ sequence: 2, action: "WAIT" }).ok, true);
  assert.equal(ledger.appendRow(null).ok, false);
  assert.equal(ledger.appendRow("row").ok, false);
  assert.equal(ledger.appendRow([1]).ok, false);
  assert.equal(ledger.rowCount(), 2, "filas inválidas no entra al ledger");

  const firstSnapshot = ledger.snapshot();
  // La fila del snapshot es congelada: tocarla no muta el historial del
  // ledger ni la fila (rechazo del entorno o inclusión de una copia).
  firstSnapshot.push({ sequence: 99 });
  try {
    firstSnapshot[0].sequence = 999;
  } catch {
    // las filas del snapshot están congeladas: la asignación no existe
  }
  const secondSnapshot = ledger.snapshot();
  assert.equal(secondSnapshot.length, 2);
  assert.equal(secondSnapshot[0].sequence, 1);
  assert.ok(Object.isFrozen(secondSnapshot[0]));
  // Sirve para probar el acumulador interno del ledger, no la vista.
  void firstSnapshot;

  assert.equal(ledger.appendRow({ sequence: 3, action: "WAIT" }).ok, true);
  assert.equal(ledger.rowCount(), 3, "appendRow acumula");
  assert.equal(secondSnapshot.length, 2, "el snapshot no es un puntero al acumulador");
  assert.ok(
    Object.keys(ledger).every((key) => !/delete|remove|rewrite|overwrite|replace|clear/i.test(key)),
    "no existe operación de borrado/reescritura/reorden (sólo rowCount/appendRow/snapshot)",
  );

  // Y el replay compone los tres ledgers append-only con la conservación
  // declarada por fila (§14.5).
  const bundle = fixtureBundle({ priceObservations: flatPricesFor(["2026-01-05", "2026-01-06", "2026-01-07"]) });
  const outcome = runP6Replay(bundle.bundle);
  const { ledgers } = outcome.replay;
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
  // §14.3 paso 2/§14.4: las referencias PIT del ledger provienen de la
  // decision view; el benchmark (viewScope evaluation) nunca aparece.
  for (const row of outcome.replay.ledgers.decision) {
    assert.equal(row.action, "BUY");
    assert.equal(row.pitReferences.length, 1);
    assert.equal(row.pitReferences[0].key, "G0BQ.FIXTURE.reference");
  }
  assert.ok(outcome.replay.ledgers.decision.every((row) => row.pitReferences.every((ref) => ref.key !== "B.G0BQ.FIXTURE.closed")), "sin referencia PIT a benchmark/outcome en el decision ledger");
  assert.equal(outcome.replay.status.benchmark, "BENCHMARK_PROVISIONAL");
});

test("§14.9: el receipt firma la evaluator version congelada del bundle", () => {
  const bundle = fixtureBundle({ priceObservations: "none", evaluatorVersion: "v9.9" });
  assert.equal(bundle.ok, true);
  const outcome = runP6Replay(bundle.bundle, { runTimestampUtc: "2026-09-23T00:00:00Z" });
  assert.equal(outcome.ok, true);
  assert.equal(outcome.replay.receipt.evaluatorVersion, "v9.9");
  // El manifest de datos congelado queda identificado en el receipt (§14.9).
  assert.equal(outcome.replay.receipt.datasetManifestId, "PIT-DATA-MANIFEST-FIXTURE");
  assert.equal(outcome.replay.receipt.datasetManifestVersion, "v1");
});

test("§14.10: un benchmark reconciliado oficial no introduce un estado no canonizado", () => {
  const dates = ["2026-01-05", "2026-01-06", "2026-01-07"];
  const bundle = fixtureBundle({ dates, priceObservations: flatPricesFor(dates), benchmarkStatus: "RECONCILED_OFFICIAL" });
  assert.equal(bundle.ok, true);
  const outcome = runP6Replay(bundle.bundle, { runTimestampUtc: "2026-09-23T00:00:00Z" });
  // El vocabulario canónico (§14.10) no contiene BENCHMARK_* más allá de
  // BENCHMARK_PROVISIONAL: sin condición provisional la dimensión queda
  // null y el estado frozen de la config se declara en el receipt.
  assert.equal(outcome.replay.status.benchmark, null);
  assert.equal(outcome.replay.receipt.benchmarkStatusDeclaredByConfig, "RECONCILED_OFFICIAL");
});
