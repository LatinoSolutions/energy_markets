// Tests IMP-14 (run receipts y reproducibilidad P6.9/P6.10). Fuente: SPEC
// v1.1.1 §25.1 fila IMP-14 ("Receipts preservados, output bundle completo;
// mismos inputs/config/seed producen mismos ledgers y valores; corrección crea
// receipt nuevo") y §25.2 fila IMP-14 (preservación de versiones y
// reproducibilidad; "No borrar runs previos; no seed hunting"). Fixtures
// sintéticos explícitos: no son datos reales del cliente.

import test from "node:test";
import assert from "node:assert/strict";

import {
  runP6Replay,
  buildReplayBundle,
  buildOutputBundle,
  createRunReceiptRegistry,
  compareReproducibility,
  receiptIdentityOf,
} from "../../src/p6-evaluator/index.mjs";
import { createA0Baseline } from "../../src/sizing-controller/a0-baseline.mjs";
import { createSizingController } from "../../src/sizing-controller/sizing-controller.mjs";
import { createGasQuarterlyExecutionContract } from "../../src/execution-contract/execution-contract.mjs";
import { createGasQuarterlyCostLedger } from "../../src/execution-contract/cost-ledger.mjs";
import { canonicalValueSha256 } from "../../src/pit-views/pit-record.mjs";
import { buildPitManifestAt } from "../../src/pit-views/views.mjs";
import { ATTESTATION_PATH, FIXTURE_SCOPE, VALUE_ATTESTATION_PATH, fixtureRepo } from "../pit-views/fixture-repo.mjs";

const PROVENANCE = {
  authority: "test-fixture (sintético, IMP-08 precedente)",
  locator: "test/p6-evaluator/run-receipts.test.mjs",
};

// Manifest PIT sintético, mismo patrón del fixture de replay.test.mjs (IMP-12).
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

const PIT_FIXTURE = { manifest: null };

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

function calendarWithDecisionTimes(dates) {
  return {
    calendarId: "CAL-FIXTURE",
    campaignId: "GAS-Q-FIXTURE",
    opportunities: dates.map((date) => ({
      date,
      scheduled: true,
      decisionTimeUtc: `${date}T10:00:00Z`,
    })),
    scheduledOpportunitiesCount: dates.length,
  };
}

function noopController() {
  return createSizingController({
    lotSizeMw: 1,
    dailyCapMw: 12,
    provenance: { authority: PROVENANCE.authority, locator: PROVENANCE.locator },
  });
}

function syntheticArm(calendar, controller) {
  const { arm } = createA0Baseline({ controller, calendar });
  arm.armVersion = `hash:${controller.contentHash}`;
  return arm;
}

// Fixture completo del §14.9: decline distintas variantes del bundle
// (evaluator, benchmark) para los tests de corrección/nueva versión.
function fixtureInput({ dates = ["2026-01-05", "2026-01-06", "2026-01-07"], evaluatorVersion = "v1.0", seed = null } = {}) {
  const controllerOutcome = noopController();
  assert.equal(controllerOutcome.ok, true);
  const calendar = calendarWithDecisionTimes(dates);
  return {
    experiment: { experimentId: "EXP-FIXTURE-GAS-Q", experimentVersion: "v1.0" },
    campaign: { campaignId: "GAS-Q-FIXTURE", product: "Gas", mission: "Quarterly" },
    openingContract: {
      obligationId: "OBL-FIXTURE",
      openingObligation: 6,
      deadline: "2026-01-07T10:00:00Z",
      unit: "MW",
      terminalRuleStatus: "UNVERIFIED",
      amendments: [],
      residualAmendment: null,
    },
    decisionCalendar: calendar,
    arm: syntheticArm(calendar, controllerOutcome.controller),
    sizingConfiguration: controllerOutcome.controller,
    execution: { executionContractVersion: "v1.0", costLedgerVersion: "v1.0" },
    executionContract: createGasQuarterlyExecutionContract(),
    costLedger: createGasQuarterlyCostLedger(),
    data: { manifest: pitManifestForTest() },
    priceObservations: dates.map((date) => ({ timestamp: `${date}T09:55:00Z`, bestAsk: 40.5 })),
    benchmark: { sourceVersion: "eex-reference-price/in-memory-fixture", status: "UNRECONCILED" },
    evaluator: { evaluatorVersion },
    stochasticity: seed === null ? null : { approved: true, seed },
  };
}

function frozenBundle(options = {}) {
  return buildReplayBundle(fixtureInput(options));
}

function outputBundleFor({ bundle, runTimestampUtc = null }) {
  const replay = runP6Replay(bundle, { runTimestampUtc });
  assert.equal(replay.ok, true);
  const built = buildOutputBundle({ bundle, replayOutcome: replay });
  assert.equal(built.ok, true);
  return built;
}

const RECEIPT_FIELDS_SECCION_14_9 = [
  "experimentId", "experimentVersion", "campaignId", "armVersion",
  "sizingControllerVersion", "executionContractVersion", "costLedgerVersion",
  "datasetManifestId", "datasetManifestVersion", "benchmarkSourceVersion",
  "evaluatorVersion", "stochasticSeed", "runTimestampUtc", "runStatus",
  "warnings", "missingDataEvents", "invalidityReasons",
];

test("§14.9: el materialized receipt contiene IDs/versiones/manifest/hashes/frontiers/seed completos", () => {
  const bundle = frozenBundle({ seed: "SEED-FIXTURE-001" });
  const built = outputBundleFor({ bundle: bundle.bundle, runTimestampUtc: "2026-09-23T00:00:00Z" });
  const receipt = built.outputBundle.receipt;

  for (const field of RECEIPT_FIELDS_SECCION_14_9) {
    assert.ok(Object.hasOwn(receipt, field), `receipt §14.9 sin ${field}`);
  }
  // Hashes de content del manifest de datos congelado (§14.9 "content hashes
  // donde estén disponibles") y metadata PIT de fronteras recorridas.
  assert.match(receipt.datasetManifestContentHash, /^[0-9a-f]{64}$/);
  assert.deepEqual(receipt.pitFrontierMetadata.frontiers.map((frontier) => frontier.boundaryUtc), [
    "2026-01-05T10:00:00Z", "2026-01-06T10:00:00Z", "2026-01-07T10:00:00Z",
  ]);
  // Identidad content-addressed y digests económicos declarados.
  assert.match(receipt.receiptId, /^[0-9a-f]{64}$/);
  assert.match(receipt.outputDigests.coverageLedger, /^[0-9a-f]{64}$/);
  // Seed declarada cuando el bundle la tiene (§14.9 "random seed cuando aplique").
  assert.equal(receipt.stochasticSeed, "SEED-FIXTURE-001");
});

test("§14.9/§25.1: mismos inputs/config/seed → mismos ledgers, valores y receipt (idéntico sin mirar el reloj)", () => {
  // Mismo frozen bundle, dos ejecuciones con timestamps distintos: el contenido
  // (ledgers/cobertura/status/digests/receiptId) debe ser idéntico; el reloj
  // es metadata del run, no del resultado (§14.9).
  const bundle = frozenBundle();
  const a = outputBundleFor({ bundle: bundle.bundle, runTimestampUtc: "2026-09-23T00:00:00Z" });
  const b = outputBundleFor({ bundle: bundle.bundle, runTimestampUtc: "2026-09-23T12:00:00Z" });

  const comparison = compareReproducibility({ outputBundle: a.outputBundle }, { outputBundle: b.outputBundle });
  assert.deepEqual(comparison.differences, [], "mismos inputs deben reproducir ledgers/valores");
  assert.equal(comparison.receiptIds[0], comparison.receiptIds[1]);
  // Digests declarados en el receipt coinciden con los del bundle.
  assert.deepEqual(a.outputBundle.digests, a.outputBundle.receipt.outputDigests);
  // El timestamp quedó preservado como metadata de cada run.
  assert.equal(a.outputBundle.receipt.runTimestampUtc, "2026-09-23T00:00:00Z");
  assert.equal(b.outputBundle.receipt.runTimestampUtc, "2026-09-23T12:00:00Z");
});

test("§14.9/§25.2: cambian datos/evaluator/config → receipt nuevo (otro receiptId) y el anterior se preserva", () => {
  const registry = createRunReceiptRegistry();
  const original = outputBundleFor({ bundle: frozenBundle().bundle, runTimestampUtc: "2026-09-23T00:00:00Z" });
  const corrected = outputBundleFor({ bundle: frozenBundle({ evaluatorVersion: "v1.1" }).bundle, runTimestampUtc: "2026-09-24T00:00:00Z" });

  assert.notEqual(original.receiptId, corrected.receiptId, "la corrección crea receipt nuevo");
  assert.equal(original.outputBundle.receipt.evaluatorVersion, "v1.0");
  assert.equal(corrected.outputBundle.receipt.evaluatorVersion, "v1.1");

  const first = registry.register({ outputBundle: original.outputBundle });
  const second = registry.register({ outputBundle: corrected.outputBundle });
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.equal(registry.snapshot().length, 2, "ambas versiones del receipt quedan preservadas");
  assert.equal(registry.has(original.receiptId), true, "el receipt previo sigue accesible");
  assert.equal(registry.receiptOf(original.receiptId).receipt.evaluatorVersion, "v1.0");

  // Re-run idéntico también se preserva (append-only), no sobrescribe.
  const rerun = outputBundleFor({ bundle: frozenBundle({ evaluatorVersion: "v1.1" }).bundle, runTimestampUtc: "2026-09-25T00:00:00Z" });
  assert.equal(compareReproducibility({ outputBundle: rerun.outputBundle }, { outputBundle: corrected.outputBundle }).ok, true);
  assert.equal(registry.register({ outputBundle: rerun.outputBundle }).entryCount, 3);
  assert.equal(registry.snapshot().length, 3);

  // No existe API de borrado/reescritura (§25.2 "No borrar runs previos").
  assert.ok(Object.keys(registry).every((key) => !/delete|remove|rewrite|overwrite|replace|clear/i.test(key)));
});

test("§14.10: el output bundle es completo, con null explícito en lo no producido por este run", () => {
  const bundle = frozenBundle();
  const built = outputBundleFor({ bundle: bundle.bundle, runTimestampUtc: "2026-09-23T00:00:00Z" });
  const output = built.outputBundle;

  assert.equal(output.bundleKind, "P6_OUTPUT_BUNDLE");
  // Partes §14.10 que el replay produce.
  for (const ledger of ["decision", "execution", "coverage"]) {
    assert.ok(Array.isArray(output.ledgers[ledger]));
  }
  assert.ok(output.terminalCoverage && typeof output.terminalCoverage === "object");
  assert.ok(output.status && Object.hasOwn(output.status, "validity"));
  // Partes de evaluación downstream (§14.6/§14.10 B/H/V, paired Delta V, source
  // status): no produjo nada → null explícito visible, nunca omitido (§14.7).
  assert.equal(output.bhvByCampaign, null);
  assert.equal(output.pairedDeltaV, null);
  assert.equal(output.sourceProxyRevisionStatus, null);
  // Digest del output bundle y receipt congelado dentro del bundle.
  assert.match(output.digests.decisionLedger, /^[0-9a-f]{64}$/);
  assert.ok(Object.isFrozen(output));
});

test("§14.9: la identidad del receipt captura cambios de datos/config ejecución (mismo run no enmascara cambio)", () => {
  // Cambiar priceObservations produce otro frozen bundle (otro contentHash) y
  // su receipt es nuevo: no hay "mismo receipt" para datos distintos (§14.9
  // corrección → receipt nuevo). B se congela con buildReplayBundle; no se
  // muta un bundle ya congelado.
  const dates = ["2026-01-05"];
  const a = outputBundleFor({ bundle: frozenBundle({ dates }).bundle, runTimestampUtc: "2026-09-23T00:00:00Z" });
  const inputB = fixtureInput({ dates });
  inputB.priceObservations = [{ timestamp: "2026-01-05T09:55:00Z", bestAsk: 41.5 }];
  const bundleB = buildReplayBundle(inputB);
  assert.equal(bundleB.ok, true);
  const corrected = outputBundleFor({ bundle: bundleB.bundle, runTimestampUtc: "2026-09-23T00:00:00Z" });
  assert.notEqual(a.receiptId, corrected.receiptId);
  // Y los resultados económicos divergen (precio distinto, fill distinto).
  assert.equal(
    compareReproducibility({ outputBundle: a.outputBundle }, { outputBundle: corrected.outputBundle }).ok,
    false,
  );
});

test("§14.9: un bundle mutado tras el freeze no materializa receipt (FROZEN_BUNDLE_HASH_MISMATCH)", () => {
  // Repro del defecto IMP14-BIND-02: mutar priceObservations después de
  // congelarse conserva la etiqueta contentHash vieja; el hash recalculado del
  // contenido ya no coincide y la materialización debe rechazarse.
  const dates = ["2026-01-05"];
  const frozen = frozenBundle({ dates });
  assert.equal(frozen.ok, true);
  const tampered = frozen.bundle;
  tampered.priceObservations = [{ timestamp: "2026-01-05T09:55:00Z", bestAsk: 41.5 }];

  const replay = runP6Replay(tampered, { runTimestampUtc: "2026-09-23T00:00:00Z" });
  assert.equal(replay.ok, true);
  const built = buildOutputBundle({ bundle: tampered, replayOutcome: replay });
  assert.equal(built.ok, false, "un bundle mutado tras el freeze no debe materializar receipt");
  assert.equal(built.code, "FROZEN_BUNDLE_HASH_MISMATCH");
});

test("§14.9/§25.2: register rechaza un output bundle con ledgers mutados (OUTPUT_DIGEST_MISMATCH)", () => {
  // Repro del defecto IMP14-REG-01: el freeze es superficial; un ledger mutado
  // por dentro ya no coincide con receipt.outputDigests y no debe registrarse.
  const built = outputBundleFor({ bundle: frozenBundle().bundle, runTimestampUtc: "2026-09-23T00:00:00Z" });
  assert.equal(built.outputBundle.ledgers.decision.length > 0, true);
  built.outputBundle.ledgers.decision[0] = { ...built.outputBundle.ledgers.decision[0], statusCodes: ["TAMPERED"] };

  const registry = createRunReceiptRegistry();
  const result = registry.register({ outputBundle: built.outputBundle });
  assert.equal(result.ok, false);
  assert.equal(result.code, "OUTPUT_DIGEST_MISMATCH");
  assert.equal(registry.snapshot().length, 0, "un bundle mutado no entra al registro");
});


test("§14.9/§14.1: la materialización no recalcula ni repara: requiere replay y bundle reales", () => {
  const builtWithoutReplay = buildOutputBundle({ bundle: null, replayOutcome: null });
  assert.equal(builtWithoutReplay.ok, false);
  assert.ok(builtWithoutReplay.ok === false);

  // Y el receipt materializado conserva las razones de invalidity reales del
  // replay (no se reescriben): run con arm roto INVALID_RUN mantiene las causas.
  const dates = ["2026-01-05", "2026-01-06"];
  const controllerOutcome = noopController();
  const calendar = calendarWithDecisionTimes(dates);
  const brokenArm = {
    armId: "BROKEN-Fixture",
    armVersion: "frozen:broken-fixture",
    decideAtOpportunity() {
      return { ok: false, code: "BROKEN_ARM", reason: "fixture: decisión no interpretable" };
    },
  };
  const brokenInput = { ...fixtureInput({ dates }), arm: brokenArm };
  const brokenBundle = buildReplayBundle(brokenInput);
  assert.equal(brokenBundle.ok, true);
  const brokenReplay = runP6Replay(brokenBundle.bundle, { runTimestampUtc: "2026-09-23T00:00:00Z" });
  const brokenOutcome = buildOutputBundle({ bundle: brokenBundle.bundle, replayOutcome: brokenReplay });
  assert.equal(brokenOutcome.ok, true);
  assert.equal(brokenOutcome.outputBundle.receipt.runStatus.validity, "INVALID_RUN");
  assert.ok(brokenOutcome.outputBundle.receipt.invalidityReasons.length > 0);
  assert.equal(receiptIdentityOf(brokenOutcome.outputBundle.receipt), brokenOutcome.receiptId);
});

test("§14.9: la materialización rechaza un outcome que no corresponde al frozen bundle (binding bundle↔replay)", () => {
  // Repro del defecto IMP14-BIND-01: aceptar el outcome de otro bundle dejaría
  // un receipt con hashes de inputs que no produjeron sus ledgers.
  const dates = ["2026-01-05"];
  const bundleA = frozenBundle({ dates });
  // B se congela con otro precio (otro input → otro contentHash), no mutando
  // un bundle ya congelado: el hash de identidad se fija al construir.
  const inputB = fixtureInput({ dates });
  inputB.priceObservations = [{ timestamp: "2026-01-05T09:55:00Z", bestAsk: 41.5 }];
  const bundleB = buildReplayBundle(inputB);
  assert.equal(bundleB.ok, true);
  assert.notEqual(bundleA.bundle.contentHash, bundleB.bundle.contentHash);

  const replayB = runP6Replay(bundleB.bundle, { runTimestampUtc: "2026-09-23T00:00:00Z" });
  assert.equal(replayB.ok, true);

  const crossed = buildOutputBundle({ bundle: bundleA.bundle, replayOutcome: replayB });
  assert.equal(crossed.ok, false, "un outcome de otro bundle no debe materializar un receipt");
  assert.equal(crossed.code, "BUNDLE_OUTCOME_MISMATCH");

  // El outcome del propio bundle sí materializa (el binding no es un bloqueo ciego).
  const replayA = runP6Replay(bundleA.bundle, { runTimestampUtc: "2026-09-23T00:00:00Z" });
  assert.equal(buildOutputBundle({ bundle: bundleA.bundle, replayOutcome: replayA }).ok, true);
});

test("§14.9: la materialización rechaza un outcome malformado (fail-closed, sin fabricar receipt)", () => {
  const bundle = frozenBundle();
  const malformed = buildOutputBundle({ bundle: bundle.bundle, replayOutcome: { ok: true, replay: { receipt: {} } } });
  assert.equal(malformed.ok, false);
  assert.equal(malformed.code, "MALFORMED_REPLAY_OUTCOME");

  // Outcome con forma mínima pero sin el hash del bundle: no se puede atar al
  // bundle materializado, así que también se rechaza.
  const unbound = buildOutputBundle({
    bundle: bundle.bundle,
    replayOutcome: {
      ok: true,
      replay: { receipt: {}, ledgers: { decision: [], execution: [], coverage: [] }, terminalCoverage: {}, status: {} },
    },
  });
  assert.equal(unbound.ok, false);
  assert.equal(unbound.code, "BUNDLE_OUTCOME_MISMATCH");
});
