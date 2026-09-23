// Tests de la proyección Experience desde el output bundle P6 (IMP-17).
// Fuente: SPEC v1.1.1 §12.1 (Historical Replay / Simulation se etiqueta como
// simulated Experience; la ejecución y los outcomes los calcula el evaluador),
// §12.2 (piezas del registro desde el material realmente utilizado), §14.6
// (el replay no computa B/H/V: el outcome queda pending, no se calcula aquí),
// §14.9/§14.10 (receipt/output bundle de IMP-12/IMP-14) y §25.2 nota IMP-17
// ("Provenance/PIT y versiones del material realmente utilizado... Casos
// sintéticos no cierran DEP-22 ni generan Real Experience"). Fixtures del
// output bundle sintéticas, con la forma contractual de IMP-14.

import test from "node:test";
import assert from "node:assert/strict";

import {
  experienceFromReplayOutput,
  REPLAY_PROJECTION_SCOPE,
} from "../../src/experience/index.mjs";
import { attributeOutcome } from "../../src/experience/index.mjs";

const HASH64 = "0".repeat(64);

function receiptFixture() {
  return {
    receiptKind: "P6_RUN_RECEIPT",
    experimentId: "EXP-FIXTURE",
    experimentVersion: "v1",
    campaignId: "CAMP-FIXTURE",
    armVersion: "A0-fixture",
    evaluatorVersion: "v1",
    frozenBundleContentHash: HASH64,
    datasetManifestId: "MANIFEST-FIXTURE",
    datasetManifestVersion: "v1",
    datasetManifestContentHash: HASH64,
    receiptId: HASH64,
    runTimestampUtc: "2026-01-06T12:00:00Z",
  };
}

function outputBundleFixture() {
  const receipt = receiptFixture();
  const decisionRows = [
    {
      sequence: 1,
      decisionTimestamp: "2026-01-05T11:00:00Z",
      frontier: "2026-01-05",
      armVersion: "A0-fixture",
      policyVersion: "policy-v1",
      action: "BUY",
      requestedQuantity: 30,
      reason: null,
      statusCodes: ["BUY", "OK"],
      pitReferences: [],
    },
    {
      sequence: 2,
      decisionTimestamp: "2026-01-06T11:00:00Z",
      frontier: "2026-01-06",
      armVersion: "A0-fixture",
      policyVersion: "policy-v1",
      action: "WAIT",
      requestedQuantity: 0,
      reason: null,
      statusCodes: ["WAIT", "OK"],
      pitReferences: [],
    },
  ];
  const executionRows = [
    {
      sequence: 1,
      requestId: "request-1",
      decisionTimestamp: "2026-01-05T11:00:00Z",
      eligibleExecutionTimestamp: "2026-01-05T11:04:00Z",
      requestedQuantity: 30,
      filledQuantity: 30,
      partialQuantity: 0,
      noFill: false,
      executionPrice: 24.35,
      executionCosts: [],
      lotRoundingTreatment: "none",
      executionContractVersion: "v1",
    },
  ];
  const coverageRows = [
    { sequence: 1, asOfDate: "2026-01-05", requestedQuantity: 30, filledQuantity: 30, noFillQuantity: 0, executedVolume: 30, remainingVolume: 30, conservation: { declaration: "Opening = Executed + Remaining (§14.5)" }, unit: "MW" },
    { sequence: 2, asOfDate: "2026-01-06", requestedQuantity: 0, filledQuantity: 0, noFillQuantity: 0, executedVolume: 30, remainingVolume: 30, conservation: { declaration: "Opening = Executed + Remaining (§14.5)" }, unit: "MW" },
  ];
  return {
    bundleKind: "P6_OUTPUT_BUNDLE",
    receipt,
    ledgers: { decision: decisionRows, execution: executionRows, coverage: coverageRows },
    terminalCoverage: { executedVolume: 30, remainingVolume: 30, unit: "MW", coverageStatus: "COVERAGE_OPEN" },
    status: { validity: "VALID_RUN", availability: null, coverage: "COVERAGE_OPEN", benchmark: "BENCHMARK_PROVISIONAL" },
  };
}

test("IMP-17 · fail-closed sin output bundle P6 materializado", () => {
  const missing = experienceFromReplayOutput({});
  assert.equal(missing.ok, false);
  assert.equal(missing.code, "MISSING_OUTPUT_BUNDLE");
  const withoutReceipt = experienceFromReplayOutput({ outputBundle: { bundleKind: "P6_OUTPUT_BUNDLE", ledgers: { decision: [], execution: [], coverage: [] } } });
  assert.equal(withoutReceipt.ok, false);
  assert.equal(withoutReceipt.code, "MISSING_RUN_RECEIPT");
  // Sin recordedAtUtc no se fabrica el clock: el record es fail-closed
  // (§12.2 timestamps; la metadata del run no se inventa).
  const withoutClock = experienceFromReplayOutput({ outputBundle: outputBundleFixture() });
  assert.equal(withoutClock.ok, false);
  assert.equal(withoutClock.failures[0].errors[0].code, "MISSING_REQUIRED");
});

test("IMP-17 · cada fila del decision ledger produce un record Experience REPLAY trazable al receipt (§12.2)", () => {
  const outputBundle = outputBundleFixture();
  const projection = experienceFromReplayOutput({ outputBundle, recordedAtUtc: "2026-01-06T12:00:05Z", synthetic: true });
  assert.equal(projection.ok, true, JSON.stringify(projection.failures ?? projection.message ?? ""));
  assert.equal(projection.records.length, 2);
  const buy = projection.records[0];
  assert.equal(buy.sourceType, "REPLAY");
  assert.equal(buy.policyVersion, "policy-v1");
  assert.equal(buy.recommendedAction, "BUY");
  assert.equal(buy.stateSnapshot.dataReference.manifestId, "MANIFEST-FIXTURE");
  assert.deepEqual(buy.stateSnapshot.dataReference.contentHash, receiptFixture().datasetManifestContentHash);
  assert.equal(buy.provenance.kind, "P6_RUN_RECEIPT");
  assert.equal(buy.provenance.receiptId, outputBundle.receipt.receiptId);
  assert.equal(buy.recommendedAtUtc, "2026-01-05T11:00:00Z");
  // Un record sin fills no se fabrica el run timestamp: recordedAtUtc viene de
  // la metadata del run que el caller pasa; sin él, el record es fail-closed.
  assert.equal(buy.recordedAtUtc, "2026-01-06T12:00:05Z");
});

test("IMP-17 · los fills proyectados del replay son SIMULATED_FILL, no Real (§12.1)", () => {
  const projection = experienceFromReplayOutput({ outputBundle: outputBundleFixture(), recordedAtUtc: "2026-01-06T12:00:05Z" });
  assert.equal(projection.ok, true);
  const buy = projection.records[0];
  assert.equal(buy.execution.fills.length, 1);
  assert.equal(buy.execution.fills[0].evidenceKind, "SIMULATED_FILL");
  assert.equal(buy.execution.fills[0].price, 24.35);
  // El next Procurement State sale de la fila real del coverage ledger (§14.5).
  assert.equal(buy.nextState.source, "P6_COVERAGE_LEDGER");
  assert.equal(buy.nextState.executedVolume, 30);
  assert.equal(buy.nextState.remainingVolume, 30);
  const wait = projection.records[1];
  assert.equal(wait.recommendedAction, "WAIT");
  // §12.2: no se fabrican ejecuciones para completar el esquema. WAIT no genera
  // request y el replay P6 no le escribe fila de execution: execution es null.
  assert.equal(wait.execution, null);
  assert.equal(attributeOutcome(wait).attribution.attributionCode, "NO_EXECUTION");
  assert.equal(attributeOutcome(wait).attribution.attributedToPolicyVersion, null);
  // La proyección del replay no crea intervención humana: si existiera en la
  // ejecución realizada, no ha sido reproducida por el evaluador.
  assert.equal(buy.humanIntervention, null);
});

test("IMP-17 · outcome pending: el replay no computa B/H/V (§14.6) y la proyección no lo inventa", () => {
  const projection = experienceFromReplayOutput({ outputBundle: outputBundleFixture(), recordedAtUtc: "2026-01-06T12:00:05Z" });
  for (const record of projection.records) {
    assert.equal(record.recordState, "OPEN");
    assert.equal(record.outcome, null);
    const attributed = attributeOutcome(record);
    assert.equal(attributed.ok, true);
  }
  // BUY con fill simulado y coherencia recomendación==ejecución: atribuible a
  // la policy (§12.3), aunque el outcome económico siga pending.
  const buyAttribution = attributeOutcome(projection.records[0]);
  assert.equal(buyAttribution.attribution.attributionCode, "POLICY_ATTRIBUTED");
});

// Fixture P6 con un BUY que el evaluador no pudo servir: fila de execution
// constitutiva con noFill=true, sin precio ni fill (§14.3 paso 5: P5.6
// convierte el request en eligible fill(s) o no-fill).
function outputBundleFixtureWithNoFill() {
  const bundle = outputBundleFixture();
  bundle.ledgers.decision.push({
    sequence: 3,
    decisionTimestamp: "2026-01-07T11:00:00Z",
    frontier: "2026-01-07",
    armVersion: "A0-fixture",
    policyVersion: "policy-v1",
    action: "BUY",
    requestedQuantity: 30,
    reason: null,
    statusCodes: ["BUY", "OK"],
    pitReferences: [],
  });
  bundle.ledgers.execution.push({
    sequence: 3,
    requestId: "request-3",
    decisionTimestamp: "2026-01-07T11:00:00Z",
    eligibleExecutionTimestamp: "2026-01-07T11:04:00Z",
    requestedQuantity: 30,
    filledQuantity: 0,
    partialQuantity: 0,
    noFill: true,
    executionPrice: null,
    executionCosts: [],
    lotRoundingTreatment: "none",
    executionContractVersion: "v1",
  });
  bundle.ledgers.coverage.push(
    { sequence: 3, asOfDate: "2026-01-07", requestedQuantity: 30, filledQuantity: 0, noFillQuantity: 30, executedVolume: 30, remainingVolume: 30, conservation: { declaration: "Opening = Executed + Remaining (§14.5)" }, unit: "MW" },
  );
  return bundle;
}

test("IMP-17 · BUY con no-fill del replay: solicitud preservada, sin ejecución ni atribución a la policy (§12.2/§12.3)", () => {
  const projection = experienceFromReplayOutput({ outputBundle: outputBundleFixtureWithNoFill(), recordedAtUtc: "2026-01-07T12:00:05Z" });
  assert.equal(projection.ok, true, JSON.stringify(projection.failures ?? projection.message ?? ""));
  assert.equal(projection.records.length, 3);
  const noFillBuy = projection.records[2];
  assert.equal(noFillBuy.recommendedAction, "BUY");
  // La fila del execution ledger conserva la solicitud; lo ejecutado es null
  // (§12.2 separación recomendación/ejecución; §4.2 una solicitud no equivale
  // a cobertura). No se fabrica precio ejecutado ni fill.
  assert.equal(noFillBuy.execution.executedAction, null);
  assert.equal(noFillBuy.execution.noFill, true);
  assert.equal(noFillBuy.execution.requestedQuantity, 30);
  assert.deepEqual(noFillBuy.execution.fills, []);
  assert.equal(noFillBuy.nextState.source, "P6_COVERAGE_LEDGER");
  // §12.3: el record no acredita a la policy un acto sin actuación efectiva.
  const attributed = attributeOutcome(noFillBuy);
  assert.equal(attributed.ok, true);
  assert.equal(attributed.attribution.attributionCode, "NO_EXECUTION");
  assert.equal(attributed.attribution.attributedToPolicyVersion, null);
});

test("IMP-17 §25.2/nota · los records proyectados del replay no cierran DEP-22 ni generan Real Experience", () => {
  const projection = experienceFromReplayOutput({ outputBundle: outputBundleFixture(), recordedAtUtc: "2026-01-06T12:00:05Z" });
  assert.equal(projection.ok, true);
  assert.equal(REPLAY_PROJECTION_SCOPE.dep22ClosedByProjection, false);
  assert.equal(REPLAY_PROJECTION_SCOPE.generatesRealExperience, false);
  for (const record of projection.records) {
    assert.equal(record.sourceType, "REPLAY");
    assert.equal(record.provenance.scope.dep22ClosedByProjection, false);
    assert.equal(record.provenance.scope.generatesRealExperience, false);
  }
});
