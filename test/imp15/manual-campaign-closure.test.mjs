// Suite IMP-15 — cerrar instrumento P6 y campaña manual end-to-end (§14.10,
// §25.1, §25.2.2). Fuente: SPEC v1.1.1 §25.1 fila IMP-15 ("Closure receipt P6,
// comparativa manual/evaluator"; acuerdos: "volumen/costes cuadran, vistas
// separadas, paridad, cero convenience fills; B/H/V/coverage manual
// coinciden"), §25.2 ("Closure receipt P6 y coincidencia manual/evaluator en
// B/H/V/coverage para la campaña; evidencia de validez del instrumento, no
// research PASS"; "no requiere S1 OOS ni DEP-13"), §14.10 (closure gate) y
// §14.6 (H desde execution ledger; V=B−H; coverage separada).
//
// Los expected de la campaña manual se calcularon a mano ANTES de codificar
// este test: operations/audit/IMP-15/manual-campaign-oracle.md. Todos los
// inputs son sintéticos explícitos (patrón IMP-13): no son datos reales del
// cliente, no prueban market edge y no cierran DEP-01–09 para una campaña
// manual real (§14.8 "no certifica market edge"; §25.2 "evidencia de validez
// del instrumento, no research PASS").
//
// GATE-01 consume el artefacto de ejecución REAL del suite IMP-13
// (operations/audit/IMP-15/imp13-fixture-suite-run.json, materializado por
// run-imp13-fixture-suite.mjs): la evidencia no se auto-atestúa en este
// archivo (IMP15-H4).

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildReplayBundle,
  buildOutputBundle,
  createRunReceiptRegistry,
  compareReproducibility,
  evaluateP6ClosureGate,
  materializeP6ClosureReceipt,
  evaluateCampaignManually,
  evaluateCampaignFromRun,
  compareManualVsEvaluator,
  runP6Replay,
  MANUAL_FIXTURE_IDS,
  FIXTURE_SUITE_RUN_EVIDENCE_KIND,
  imp13FixtureSuiteDigest,
  validateFixtureSuiteRunEvidence,
} from "../../src/p6-evaluator/index.mjs";
import { createA0Baseline } from "../../src/sizing-controller/a0-baseline.mjs";
import { createSizingController } from "../../src/sizing-controller/sizing-controller.mjs";
import { createGasQuarterlyExecutionContract, contentHashOf } from "../../src/execution-contract/execution-contract.mjs";
import { createGasQuarterlyCostLedger } from "../../src/execution-contract/cost-ledger.mjs";
import { canonicalValueSha256 } from "../../src/pit-views/pit-record.mjs";
import { buildPitManifestAt } from "../../src/pit-views/views.mjs";
import { ATTESTATION_PATH, FIXTURE_SCOPE, VALUE_ATTESTATION_PATH, fixtureRepo } from "../pit-views/fixture-repo.mjs";

const PROVENANCE = {
  authority: "test-fixture (sintético, IMP-15)",
  locator: "test/imp15/manual-campaign-closure.test.mjs",
};

const CONSUMABLE_EVIDENCE = {
  source: "fixture://ingest-log",
  locator: "IMP-15 fixture @ 2026-05-30T10:30Z",
  sha256: "c".repeat(64),
};

// Perfil confirmado de la campaña Gas Quarterly vigente (IMP-02 aceptado;
// SPEC v1.1.1 §4.1 y OFICINA.md): 60 MW objetivo, posición inicial 0 MW,
// incrementos de 1 MW, cap provisional 12 MW/day. Las decisiones y precios
// observados son sintéticos.
const OPENING_OBLIGATION_MW = 60;
const CAMPAIGN_DATES = [
  "2026-06-01", "2026-06-02", "2026-06-03", "2026-06-04", "2026-06-05",
  "2026-06-08", "2026-06-09", "2026-06-10", "2026-06-11", "2026-06-12",
];

const DAY_ASKS = {
  "2026-06-01": 41.2,
  "2026-06-02": 40.9,
  "2026-06-03": 40.85,
  "2026-06-04": 41.6,
  "2026-06-05": 41.3,
  "2026-06-08": 40.75,
  "2026-06-09": 41.1,
  "2026-06-10": 40.95,
  "2026-06-11": 41.45,
  "2026-06-12": 41.05,
};

// Closes de benchmark seleccionados en la ventana de campaña (vista de
// evaluación, keys disjuntas de la decision view, §14.3/§14.7).
const BENCHMARK_ROWS = [
  { key: "B.G0BQ.FX15.closed", date: "2026-06-01", selected: 45.2, product: "Gas" },
  { key: "B.G0BQ.FX15.closed", date: "2026-06-05", selected: 44.7, product: "Gas" },
  { key: "B.G0BQ.FX15.closed", date: "2026-06-12", selected: 45.31, product: "Gas" },
];
const BENCHMARK_EVALUATION_KEYS = ["B.G0BQ.FX15.closed"];

const DECISION_RECORD = {
  key: "G0BQ.FX15.reference",
  viewScope: "decision",
  occurredAtUtc: "2026-05-29T09:55:00Z",
  publishedAtUtc: "2026-05-29T10:00:00Z",
  consumableAtUtc: "2026-05-30T10:00:00Z",
  consumableEvidence: CONSUMABLE_EVIDENCE,
  revisionId: "v1",
  value: 41.0,
};

const BENCHMARK_RECORD = {
  key: "B.G0BQ.FX15.closed",
  viewScope: "evaluation",
  occurredAtUtc: "2026-06-13T09:55:00Z",
  publishedAtUtc: "2026-06-13T10:00:00Z",
  consumableAtUtc: "2026-06-13T10:30:00Z",
  consumableEvidence: CONSUMABLE_EVIDENCE,
  revisionId: "bench-v1",
  value: 45.0,
};

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
    .map((record) => ({
      source: "fixture://value-log",
      locator: `${record.key}@${record.revisionId}`,
      sha256: "d".repeat(64),
      key: record.key,
      revisionId: record.revisionId,
      revisionOf: record.revisionOf ?? null,
      valueSha256: canonicalValueSha256(record.value).sha256,
      publishedAtUtc: record.publishedAtUtc,
      revisionEffectiveAtUtc: null,
    }));
  const consumptionContent = JSON.stringify({ artifactKind: "PIT_CONSUMPTION_ATTESTATIONS", auditId: "AUDIT-IMP15", scope: FIXTURE_SCOPE, attestations: consumptionAttestations });
  const valueContent = JSON.stringify({ artifactKind: "PIT_VALUE_ATTESTATIONS", auditId: "AUDIT-IMP15", scope: FIXTURE_SCOPE, attestations: valueAttestations });
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
  assert.equal(outcome.ok, true, "el manifest PIT sintético debe construirse verificado");
  return outcome.manifest;
}

// Cost-ledger fixture con un coste KNOWN que NO va embebido en
// executionPrice (IMP15-H1): un exchange fee fixture, additive a cada fill.
function createCostLedgerWithKnownNonEmbeddedFee() {
  const baseLedger = createGasQuarterlyCostLedger();
  const ledger = {
    ...baseLedger,
    ledgerId: "COST-GAS-Q-P5.6-IMP15-H1FIXTURE",
    ledgerVersion: "v1.1",
    contractVersion: "v1.0",
    entries: [
      ...baseLedger.entries.map((entry) => ({ ...entry })),
      {
        costId: "cost.exchange.fee.fixture",
        kind: "EXCHANGE_FEE",
        status: "KNOWN",
        amount: 0.25,
        unit: "EUR/MWh",
        appliedTo: "all-fills",
        source: {
          authority: "test-fixture (sintético, IMP-15)",
          locator: "test/imp15/manual-campaign-closure.test.mjs",
        },
      },
    ],
  };
  ledger.contentHash = contentHashOf(ledger.entries);
  return ledger;
}

// Frozen bundle §14.2 de la campaña de cierre (una sola instancia: el run y
// su réplica de reproducibilidad usan el MISMO bundle congelado, §14.9).
function frozenCampaignBundle({ costLedger = null } = {}) {
  const resolvedLedger = costLedger ?? createGasQuarterlyCostLedger();
  const controllerOutcome = createSizingController({
    lotSizeMw: 1,
    dailyCapMw: 12,
    provenance: PROVENANCE,
  });
  assert.equal(controllerOutcome.ok, true);
  const controller = controllerOutcome.controller;
  const calendar = {
    calendarId: "CAL-IMP15",
    campaignId: "GAS-Q-IMP15",
    opportunities: CAMPAIGN_DATES.map((date) => ({ date, scheduled: true, decisionTimeUtc: `${date}T10:00:00Z` })),
    scheduledOpportunitiesCount: CAMPAIGN_DATES.length,
  };
  const { arm } = createA0Baseline({ controller, calendar });
  arm.armVersion = `hash:${controller.contentHash}`;
  const manifest = buildManifest({
    manifestId: "PIT-MANIFEST-IMP15",
    records: [DECISION_RECORD, BENCHMARK_RECORD],
  });
  const priceObservations = CAMPAIGN_DATES.map((date) => ({
    timestamp: `${date}T09:55:00Z`,
    bestAsk: DAY_ASKS[date],
  }));
  const input = {
    experiment: { experimentId: "EXP-IMP15-CLOSURE", experimentVersion: "v1.0" },
    campaign: { campaignId: "GAS-Q-IMP15", product: "Gas", mission: "Quarterly" },
    openingContract: {
      obligationId: "OBL-IMP15",
      openingObligation: OPENING_OBLIGATION_MW,
      deadline: `${CAMPAIGN_DATES[CAMPAIGN_DATES.length - 1]}T10:00:00Z`,
      unit: "MW",
      terminalRuleStatus: "UNVERIFIED",
      amendments: [],
      residualAmendment: null,
    },
    decisionCalendar: calendar,
    arm,
    sizingConfiguration: controller,
    execution: { executionContractVersion: "v1.0", costLedgerVersion: resolvedLedger.ledgerVersion },
    executionContract: createGasQuarterlyExecutionContract(),
    costLedger: resolvedLedger,
    data: { manifest },
    priceObservations,
    benchmark: { sourceVersion: "eex-reference-price/in-memory-fixture", status: "UNRECONCILED" },
    evaluator: { evaluatorVersion: "v1.0" },
    stochasticity: null,
  };
  const outcome = buildReplayBundle(input);
  assert.equal(outcome.ok, true, `el bundle debe congelarse: ${JSON.stringify(outcome.errors ?? [])}`);
  return outcome.bundle;
}

// Vía manual independiente + evaluación derivada del run + comparativa
// (§25.2 IMP-15). extraUnitCosts replica en la captura manual los costes
// KNOWN no embebidos que el run contabiliza (IMP15-H1).
function manualAndRunEvaluations(runOutcome, { extraUnitCosts = [] } = {}) {
  const manualFills = CAMPAIGN_DATES.map((date) => ({
    decisionDate: date,
    price: DAY_ASKS[date],
    filledQuantity: 6,
    knownUnitCosts: [
      { costId: "cost.slippage.virtual", amount: 0.15, unit: "EUR/MWh" },
      ...extraUnitCosts,
    ],
  }));
  const manualEvaluation = evaluateCampaignManually({
    manualFills,
    benchmarkCloses: BENCHMARK_ROWS,
    openingObligation: OPENING_OBLIGATION_MW,
    unit: "MW",
  });
  const campaignEvaluation = evaluateCampaignFromRun({
    replayOutcome: runOutcome,
    benchmarkRows: BENCHMARK_ROWS,
    product: "Gas",
    windowStart: CAMPAIGN_DATES[0],
    windowEnd: "2026-06-13",
  });
  const comparison = compareManualVsEvaluator({ manualEvaluation, campaignEvaluation });
  return { manualEvaluation, campaignEvaluation, comparison };
}

const IMP13_SUITE_RUN_ARTIFACT_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../operations/audit/IMP-15/imp13-fixture-suite-run.json",
);

function loadImp13SuiteRunEvidence() {
  const artifact = JSON.parse(readFileSync(IMP13_SUITE_RUN_ARTIFACT_PATH, "utf8"));
  assert.equal(artifact.artifactKind, FIXTURE_SUITE_RUN_EVIDENCE_KIND);
  assert.equal(validateFixtureSuiteRunEvidence(artifact, MANUAL_FIXTURE_IDS).ok, true);
  return artifact;
}

test("IMP-15: la campaña manual end-to-end cierra con paridad manual/evaluator en B/H/V/coverage", () => {
  const bundle = frozenCampaignBundle();

  // Run 1: replay del frozen bundle (§14.3).
  const runOutcome = runP6Replay(bundle, { runTimestampUtc: "2026-09-23T00:00:00Z" });
  assert.equal(runOutcome.ok, true);

  // La campaña (oráculo manual) queda: 60 MW, 10 fills de 6 MW, COVERED.
  assert.equal(runOutcome.replay.terminalCoverage.executedVolume, 60);
  assert.equal(runOutcome.replay.terminalCoverage.remainingVolume, 0);
  assert.equal(runOutcome.replay.terminalCoverage.coverageStatus, "COVERED");
  assert.equal(runOutcome.replay.status.validity, "VALID_RUN");

  // Precio de fill: latest ask at-or-before la frontera + 0.15 EUR/MWh
  // (slippage virtual frozen, §13.6 / OFICINA.md execution assumption).
  assert.equal(runOutcome.replay.ledgers.execution[0].executionPrice, 41.2 + 0.15);
  assert.equal(runOutcome.replay.ledgers.execution[9].executionPrice, 41.05 + 0.15);

  // --- Vía manual independiente y evaluación del run (vía ledgers) ----------
  const { manualEvaluation, campaignEvaluation, comparison } = manualAndRunEvaluations(runOutcome);
  assert.equal(manualEvaluation.ok, true, `captura manual válida: ${manualEvaluation.errors.join(" | ")}`);
  assert.equal(campaignEvaluation.ok, true);
  assert.equal(campaignEvaluation.benchmarkCount, 3);

  // El slippage del cost ledger va embebido en executionPrice: se registra
  // como embedded y NO se re-suma a H (exactamente una vez, §13.6/§5.5).
  assert.ok(Math.abs(campaignEvaluation.embeddedCostsByKindEur["cost.slippage.virtual"] - 0.15 * 60) <= 1e-9);
  assert.equal(campaignEvaluation.costsByKindEur["cost.slippage.virtual"], undefined);

  // --- Coincidencia manual/evaluator (§25.2 IMP-15) -------------------------
  assert.equal(comparison.code, "MANUAL_EVALUATOR_AGREEMENT");
  assert.equal(comparison.ok, true, JSON.stringify(comparison.components.filter((c) => !c.agree)));

  const H = comparison.components.find((component) => component.component === "H");
  const B = comparison.components.find((component) => component.component === "B");
  const V = comparison.components.find((component) => component.component === "V");
  assert.ok(Math.abs(H.manual - 41.265) <= 1e-9, `H manual ${H.manual} == 41.265 (oráculo)`);
  assert.ok(Math.abs(B.manual - 45.07) <= 1e-9, `B manual ${B.manual} == 45.07 (oráculo)`);
  assert.ok(Math.abs(V.manual - 3.805) <= 1e-9, `V manual ${V.manual} == 3.805 (oráculo)`);

  // --- Runs y output bundles (IMP-14) --------------------------------------
  const first = buildOutputBundle({ bundle, replayOutcome: runOutcome });
  assert.equal(first.ok, true);
  const rerunRecord = runP6Replay(bundle, { runTimestampUtc: "2026-09-23T01:00:00Z" });
  const rerun = buildOutputBundle({ bundle, replayOutcome: rerunRecord });
  assert.equal(rerun.ok, true);

  const registry = createRunReceiptRegistry();
  assert.equal(registry.register({ outputBundle: first.outputBundle }).ok, true);
  assert.equal(registry.register({ outputBundle: rerun.outputBundle }).ok, true);

  const imp13SuiteRunEvidence = loadImp13SuiteRunEvidence();
  const gate = evaluateP6ClosureGate({
    runOutcome,
    firstOutputBundle: first.outputBundle,
    rerunOutputBundle: rerun.outputBundle,
    a1OutputBundle: null,
    fixtureSuiteEvidence: imp13SuiteRunEvidence,
    benchmarkEvaluationKeys: BENCHMARK_EVALUATION_KEYS,
    manualEvaluation,
    campaignEvaluation,
    manualComparison: comparison,
    bundle,
    singleArmDeclaration: {
      singleArm: true,
      reasoning: "El run de cierre del instrumento es del brazo A0 (Calendar-only): el brazo A1/S1 no existe todavía (IMP-11 pendiente) y §25.2 IMP-15 no exige S1 OOS. La paridad de treatment A0/A1 queda NOT_EVALUATED hasta que existan dos brazos distintos; no se declara verificada.",
    },
  });
  assert.equal(gate.failedIds.length, 0, `gate fallido: ${JSON.stringify(gate.failedIds)} ${JSON.stringify(gate.items.filter((i) => !i.ok).map((i) => ({ id: i.id, code: i.code, problems: i.problems })))}`);
  assert.equal(gate.ok, true);
  // El ítem A0/A1 NO se da por verificado con un solo brazo (IMP15-H2):
  // queda NOT_EVALUATED y el gate declara el §14.10 incompleto.
  assert.equal(gate.pendingIds.includes("IMP15-GATE-04"), true);
  assert.equal(gate.gateComplete, false);
  assert.equal(gate.singleArmScope, true);
  const armParity = gate.items.find((gateItem) => gateItem.id === "IMP15-GATE-04");
  assert.equal(armParity.code, "A0_A1_NOT_EVALUATED");
  assert.equal(armParity.status, "NOT_EVALUATED");

  const closure = materializeP6ClosureReceipt({
    gate,
    manualComparison: comparison,
    outputBundle: first.outputBundle,
    rerunOutputBundle: rerun.outputBundle,
    bundle,
    closureTimestampUtc: "2026-09-23T02:00:00Z",
    fixtureSuiteEvidence: imp13SuiteRunEvidence,
    closureScopeNote: "Campaña sintética con el perfil confirmado de la campaña Gas Quarterly vigente (IMP-02): 60 MW, lotes 1 MW, cap 12 MW/day. El cierre prueba el instrumento P6, no el mercado.",
  });
  assert.equal(closure.ok, true, JSON.stringify(closure.message ?? ""));
  assert.equal(closure.receipt.receiptKind, "P6_CLOSURE_RECEIPT");
  assert.equal(typeof closure.closureId, "string");
  assert.equal(closure.receipt.gateResult.ok, true);
  // El receipt NO declara el closure gate §14.10 completo (IMP15-H2).
  assert.equal(closure.receipt.gateResult.complete, false);
  assert.deepEqual(closure.receipt.gateResult.pendingIds, ["IMP15-GATE-04"]);
  assert.equal(closure.receipt.instrumentDeclaration.gateComplete, false);
  assert.deepEqual(closure.receipt.instrumentDeclaration.pendingGateItemIds, ["IMP15-GATE-04"]);
  assert.match(closure.receipt.scopeDeclaration.means, /NO se declara implementation-ready por gate superado/);
  assert.equal(closure.receipt.singleArmScope.declared, true);
  assert.match(closure.receipt.scopeDeclaration.doesNotMean, /research PASS/);
  assert.match(closure.receipt.scopeDeclaration.doesNotMean, /paridad A0\/A1 no verificada/);
  assert.ok(Math.abs(closure.receipt.manualEvaluatorComparison.components.find((c) => c.component === "V").manual - 3.805) <= 1e-9);
  assert.equal(closure.receipt.fixtureSuiteRunEvidence.suiteDigest, imp13SuiteRunEvidence.suiteDigest);

  // El receipt entra como entrada nueva al registro; nada se sobrescribe.
  const identityBefore = registry.snapshot().length;
  assert.equal(registry.has(closure.closureId), false);
  assert.equal(identityBefore, 2);
});

test("IMP-15: defectos del gate — fixtures no aprobados, comparativa divergente/forjada, sin reproducibilidad y evidencia alterada no cierran (fail-closed)", () => {
  const imp13SuiteRunEvidence = loadImp13SuiteRunEvidence();
  const bundle = frozenCampaignBundle();

  const runOutcome = runP6Replay(bundle, {});
  const first = buildOutputBundle({ bundle, replayOutcome: runOutcome });
  assert.equal(first.ok, true);

  // Comparativa real de la campaña: base para graduar los fallos.
  const { manualEvaluation, campaignEvaluation, comparison } = manualAndRunEvaluations(runOutcome);
  assert.equal(manualEvaluation.ok, true);
  assert.equal(campaignEvaluation.ok, true);
  assert.equal(comparison.ok, true);
  const declaredScope = { singleArm: true, reasoning: "scope de brazo único declarado para el escenario de fallo" };

  // Sin artefacto de ejecución real del suite §14.8: GATE-01 no pasa.
  const noFixtureGate = evaluateP6ClosureGate({
    runOutcome,
    firstOutputBundle: first.outputBundle,
    rerunOutputBundle: first.outputBundle,
    fixtureSuiteEvidence: null,
    benchmarkEvaluationKeys: BENCHMARK_EVALUATION_KEYS,
    manualEvaluation,
    campaignEvaluation,
    manualComparison: comparison,
    bundle,
    singleArmDeclaration: declaredScope,
  });
  assert.equal(noFixtureGate.failedIds.includes("IMP15-GATE-01"), true);

  // Evidencia del suite alterada (fixture declarado sin ok y digest que ya
  // no recomputa): GATE-01 no la acepta (IMP15-H4).
  const tamperedEvidence = JSON.parse(JSON.stringify(imp13SuiteRunEvidence));
  tamperedEvidence.fixtures[0].ok = false;
  const tamperedGate = evaluateP6ClosureGate({
    runOutcome,
    firstOutputBundle: first.outputBundle,
    rerunOutputBundle: first.outputBundle,
    fixtureSuiteEvidence: tamperedEvidence,
    benchmarkEvaluationKeys: BENCHMARK_EVALUATION_KEYS,
    manualEvaluation,
    campaignEvaluation,
    manualComparison: comparison,
    bundle,
    singleArmDeclaration: declaredScope,
  });
  assert.equal(tamperedGate.failedIds.includes("IMP15-GATE-01"), true);
  assert.equal(tamperedGate.items.find((gateItem) => gateItem.id === "IMP15-GATE-01").code, "FIXTURE_NOT_APPROVED");

  // Evidencia del suite con suiteStatus FAIL (fixture no aprobado): GATE-01 falla.
  const failedSuiteEvidence = JSON.parse(JSON.stringify(imp13SuiteRunEvidence));
  failedSuiteEvidence.suiteStatus = "FAIL";
  const failedSuiteGate = evaluateP6ClosureGate({
    runOutcome,
    firstOutputBundle: first.outputBundle,
    rerunOutputBundle: first.outputBundle,
    fixtureSuiteEvidence: failedSuiteEvidence,
    benchmarkEvaluationKeys: BENCHMARK_EVALUATION_KEYS,
    manualEvaluation,
    campaignEvaluation,
    manualComparison: comparison,
    bundle,
    singleArmDeclaration: declaredScope,
  });
  assert.equal(failedSuiteGate.failedIds.includes("IMP15-GATE-01"), true);

  // Comparativa forjada (ok sin componentes reales): GATE-09 no la acepta
  // (IMP15-H3).
  const forgedComparison = { ok: true, code: "MANUAL_EVALUATOR_AGREEMENT", components: [], declared: {} };
  const forgedGate = evaluateP6ClosureGate({
    runOutcome,
    firstOutputBundle: first.outputBundle,
    rerunOutputBundle: first.outputBundle,
    fixtureSuiteEvidence: imp13SuiteRunEvidence,
    benchmarkEvaluationKeys: BENCHMARK_EVALUATION_KEYS,
    manualEvaluation,
    campaignEvaluation,
    manualComparison: forgedComparison,
    bundle,
    singleArmDeclaration: declaredScope,
  });
  assert.equal(forgedGate.failedIds.includes("IMP15-GATE-09"), true);
  const forgedItem = forgedGate.items.find((gateItem) => gateItem.id === "IMP15-GATE-09");
  assert.equal(forgedItem.code, "MANUAL_EVALUATOR_AGREEMENT_NOT_REPRODUCIBLE");
  assert.ok(forgedItem.problems.some((problem) => problem.includes("componente")));
  assert.ok(forgedItem.problems.some((problem) => problem.includes("digest")));

  // Comparativa en desacuerdo (evaluaciones reales, valores divergentes):
  // GATE-09 no pasa.
  const { campaignEvaluation: mismatchRunEvaluation } = manualAndRunEvaluations(runOutcome);
  const mismatchManualEvaluation = {
    ok: true, source: "MANUAL_CAPTURE", H: null, B: null, V: null,
    coverage: { executedVolume: 0, remainingVolume: 60, status: "COVERAGE_INCOMPLETE" },
  };
  const mismatchComparison = compareManualVsEvaluator({
    manualEvaluation: mismatchManualEvaluation,
    campaignEvaluation: mismatchRunEvaluation,
  });
  assert.equal(mismatchComparison.ok, false);
  const mismatchGate = evaluateP6ClosureGate({
    runOutcome,
    firstOutputBundle: first.outputBundle,
    rerunOutputBundle: first.outputBundle,
    fixtureSuiteEvidence: imp13SuiteRunEvidence,
    benchmarkEvaluationKeys: BENCHMARK_EVALUATION_KEYS,
    manualEvaluation: mismatchManualEvaluation,
    campaignEvaluation: mismatchRunEvaluation,
    manualComparison: mismatchComparison,
    bundle,
    singleArmDeclaration: declaredScope,
  });
  assert.equal(mismatchGate.failedIds.includes("IMP15-GATE-09"), true);

  // Reproducibilidad rota: GATE-06 no pasa (un run distinto → otros digests).
  // Las filas del ledger son inmutables (§14.4), así que la réplica alterada
  // se construye con una fila sustituida, no mutando el original.
  const alteredOutcome = runP6Replay(bundle, {});
  const alteredRows = alteredOutcome.replay.ledgers.execution.map((row, index) => index === 0
    ? { ...row, executionPrice: row.executionPrice + 1 }
    : row);
  alteredOutcome.replay.ledgers.execution = alteredRows;
  const mutated = buildOutputBundle({ bundle, replayOutcome: alteredOutcome });
  const divergentGate = evaluateP6ClosureGate({
    runOutcome,
    firstOutputBundle: first.outputBundle,
    rerunOutputBundle: mutated.outputBundle,
    fixtureSuiteEvidence: imp13SuiteRunEvidence,
    benchmarkEvaluationKeys: BENCHMARK_EVALUATION_KEYS,
    manualEvaluation,
    campaignEvaluation,
    manualComparison: comparison,
    bundle,
    singleArmDeclaration: declaredScope,
  });
  assert.equal(divergentGate.failedIds.includes("IMP15-GATE-06"), true);

  // Receipt bloqueado con el gate en fallo: no se materializa closure.
  const declined = materializeP6ClosureReceipt({
    gate: { ...divergentGate, ok: false, failedIds: ["IMP15-GATE-02"] },
    manualComparison: comparison,
    outputBundle: first.outputBundle,
    bundle,
  });
  assert.equal(declined.ok, false);
  assert.ok(declined.failedIds.includes("IMP15-GATE-02"));

  const reproComparison = compareReproducibility({ outputBundle: first.outputBundle }, { outputBundle: first.outputBundle });
  assert.equal(reproComparison.ok, true);
  assert.ok(reproComparison.receiptIds[0] === reproComparison.receiptIds[1]);
});

test("IMP-15: coste KNOWN no embebido en executionPrice mueve H y el evaluator lo cuenta exactamente una vez (IMP15-H1)", () => {
  const costLedger = createCostLedgerWithKnownNonEmbeddedFee();
  const bundle = frozenCampaignBundle({ costLedger });
  const runOutcome = runP6Replay(bundle, { runTimestampUtc: "2026-09-23T00:00:00Z" });
  assert.equal(runOutcome.ok, true);
  assert.equal(runOutcome.replay.status.validity, "VALID_RUN");

  const campaignEvaluation = evaluateCampaignFromRun({
    replayOutcome: runOutcome,
    benchmarkRows: BENCHMARK_ROWS,
    product: "Gas",
    windowStart: CAMPAIGN_DATES[0],
    windowEnd: "2026-06-13",
  });
  assert.equal(campaignEvaluation.ok, true);
  // El coste no embebido entra al H del run y NO se re-cuenta el slippage
  // embebido: H = oráculo 41.265 + 0.25 exacto (IMP15-H1; hoy, sin el fix,
  // el H del run ignoraba todo coste del ledger).
  assert.ok(Math.abs(campaignEvaluation.H - (41.265 + 0.25)) <= 1e-9, `H del run ${campaignEvaluation.H} debe moverse 0.25 sobre el oráculo`);
  assert.ok(Math.abs(campaignEvaluation.costsByKindEur["cost.exchange.fee.fixture"] - 0.25 * 60) <= 1e-9);
  assert.ok(Math.abs(campaignEvaluation.embeddedCostsByKindEur["cost.slippage.virtual"] - 0.15 * 60) <= 1e-9);
  assert.equal(campaignEvaluation.costsByKindEur["cost.slippage.virtual"], undefined);

  // La comparativa manual/evaluator cierra CON el mismo coste en la captura.
  const agreeCase = manualAndRunEvaluations(runOutcome, {
    extraUnitCosts: [{ costId: "cost.exchange.fee.fixture", amount: 0.25, unit: "EUR/MWh" }],
  });
  assert.equal(agreeCase.manualEvaluation.ok, true);
  assert.equal(agreeCase.campaignEvaluation.ok, true);
  assert.ok(Math.abs(agreeCase.manualEvaluation.H - (41.265 + 0.25)) <= 1e-9, `H manual ${agreeCase.manualEvaluation.H} == 41.515`);
  assert.equal(agreeCase.comparison.ok, true, JSON.stringify(agreeCase.comparison.components.filter((c) => !c.agree)));

  // Y si la captura OMITE ese coste, la comparativa FALLA: la paridad B/H/V
  // no se fabrica por coincidencia (reproducción del defecto IMP15-H1).
  const omitCase = manualAndRunEvaluations(runOutcome, { extraUnitCosts: [] });
  assert.equal(omitCase.comparison.ok, false);
  assert.equal(omitCase.comparison.code, "MANUAL_EVALUATOR_MISMATCH");
});

test("IMP-15: cierre de brazo único sin declaración no pasa el gate y no materializa receipt (IMP15-H2)", () => {
  const imp13SuiteRunEvidence = loadImp13SuiteRunEvidence();
  const bundle = frozenCampaignBundle();
  const runOutcome = runP6Replay(bundle, {});
  const first = buildOutputBundle({ bundle, replayOutcome: runOutcome });
  const rerun = buildOutputBundle({ bundle, replayOutcome: runP6Replay(bundle, {}) });
  const { manualEvaluation, campaignEvaluation, comparison } = manualAndRunEvaluations(runOutcome);

  // Un solo brazo SIN declaración de scope: fallo duro, no paridad fabricada.
  const undeclaredGate = evaluateP6ClosureGate({
    runOutcome,
    firstOutputBundle: first.outputBundle,
    rerunOutputBundle: first.outputBundle,
    a1OutputBundle: null,
    fixtureSuiteEvidence: imp13SuiteRunEvidence,
    benchmarkEvaluationKeys: BENCHMARK_EVALUATION_KEYS,
    manualEvaluation,
    campaignEvaluation,
    manualComparison: comparison,
    bundle,
    singleArmDeclaration: null,
  });
  assert.equal(undeclaredGate.failedIds.includes("IMP15-GATE-04"), true);
  assert.equal(undeclaredGate.ok, false);
  const undeclaredItem = undeclaredGate.items.find((gateItem) => gateItem.id === "IMP15-GATE-04");
  assert.equal(undeclaredItem.code, "SINGLE_ARM_PARITY_UNDECLARED");

  // Con el gate en fallo duro, el receipt no se materializa: nada acepta
  // un A0 comparado contra A0 como si fuera paridad A0/A1.
  const declined = materializeP6ClosureReceipt({
    gate: undeclaredGate,
    manualComparison: comparison,
    outputBundle: first.outputBundle,
    rerunOutputBundle: rerun.outputBundle,
    bundle,
    fixtureSuiteEvidence: imp13SuiteRunEvidence,
  });
  assert.equal(declined.ok, false);
  assert.ok(declined.failedIds.includes("IMP15-GATE-04"));
});
