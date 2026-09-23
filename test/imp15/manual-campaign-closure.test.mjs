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

import test from "node:test";
import assert from "node:assert/strict";

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
} from "../../src/p6-evaluator/index.mjs";
import { createA0Baseline } from "../../src/sizing-controller/a0-baseline.mjs";
import { createSizingController } from "../../src/sizing-controller/sizing-controller.mjs";
import { createGasQuarterlyExecutionContract } from "../../src/execution-contract/execution-contract.mjs";
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

// Frozen bundle §14.2 de la campaña de cierre (una sola instancia: el run y
// su réplica de reproducibilidad usan el MISMO bundle congelado, §14.9).
function frozenCampaignBundle() {
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
    execution: { executionContractVersion: "v1.0", costLedgerVersion: "v1.0" },
    executionContract: createGasQuarterlyExecutionContract(),
    costLedger: createGasQuarterlyCostLedger(),
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

const EVIDENCE_SOURCE = "test/imp13/manual-fixtures.test.mjs (ejecutado en este commit)";

const FIXTURE_SUITE_EVIDENCE = MANUAL_FIXTURE_IDS.map((fixtureId) => ({ fixtureId, ok: true, evidence: EVIDENCE_SOURCE }));

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

  // --- Vía manual independiente (captura a mano; ver oráculo) ---------------
  const manualFills = CAMPAIGN_DATES.map((date) => ({
    decisionDate: date,
    price: DAY_ASKS[date],
    filledQuantity: 6,
    knownUnitCosts: [{ costId: "cost.slippage.virtual", amount: 0.15, unit: "EUR/MWh" }],
  }));
  const manualEvaluation = evaluateCampaignManually({
    manualFills,
    benchmarkCloses: BENCHMARK_ROWS,
    openingObligation: OPENING_OBLIGATION_MW,
    unit: "MW",
  });
  assert.equal(manualEvaluation.ok, true, `captura manual válida: ${manualEvaluation.errors.join(" | ")}`);

  // --- Evaluación derivada del run (ledgers reales) -------------------------
  const campaignEvaluation = evaluateCampaignFromRun({
    replayOutcome: runOutcome,
    benchmarkRows: BENCHMARK_ROWS,
    product: "Gas",
    windowStart: CAMPAIGN_DATES[0],
    windowEnd: "2026-06-13",
  });
  assert.equal(campaignEvaluation.ok, true);
  assert.equal(campaignEvaluation.benchmarkCount, 3);

  // --- Coincidencia manual/evaluator (§25.2 IMP-15) -------------------------
  const comparison = compareManualVsEvaluator({ manualEvaluation, campaignEvaluation });
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

  const gate = evaluateP6ClosureGate({
    runOutcome,
    firstOutputBundle: first.outputBundle,
    rerunOutputBundle: rerun.outputBundle,
    fixtureSuiteEvidence: FIXTURE_SUITE_EVIDENCE,
    benchmarkEvaluationKeys: BENCHMARK_EVALUATION_KEYS,
    manualComparison: comparison,
    bundle,
    singleArmDeclaration: {
      singleArm: true,
      reasoning: "El run de cierre del instrumento es del brazo A0 (Calendar-only): el brazo A1/S1 no existe todavía (IMP-11 pendiente) y §25.2 IMP-15 no exige S1 OOS. La paridad de treatment A0/A1 se declara como scope de brazo único, no como verificación de dos brazos.",
    },
  });
  assert.equal(gate.failedIds.length, 0, `gate fallido: ${JSON.stringify(gate.failedIds)} ${JSON.stringify(gate.items.filter((i) => !i.ok).map((i) => ({ id: i.id, code: i.code, problems: i.problems })))}`);
  assert.equal(gate.ok, true);
  assert.equal(gate.singleArmScope, true);

  const closure = materializeP6ClosureReceipt({
    gate,
    manualComparison: comparison,
    outputBundle: first.outputBundle,
    rerunOutputBundle: rerun.outputBundle,
    bundle,
    closureTimestampUtc: "2026-09-23T02:00:00Z",
    fixtureSuiteEvidence: FIXTURE_SUITE_EVIDENCE,
    closureScopeNote: "Campaña sintética con el perfil confirmado de la campaña Gas Quarterly vigente (IMP-02): 60 MW, lotes 1 MW, cap 12 MW/day. El cierre prueba el instrumento P6, no el mercado.",
  });
  assert.equal(closure.ok, true, JSON.stringify(closure.message ?? ""));
  assert.equal(closure.receipt.receiptKind, "P6_CLOSURE_RECEIPT");
  assert.equal(typeof closure.closureId, "string");
  assert.equal(closure.receipt.gateResult.ok, true);
  assert.equal(closure.receipt.singleArmScope.declared, true);
  assert.match(closure.receipt.scopeDeclaration.doesNotMean, /research PASS/);
  assert.ok(Math.abs(closure.receipt.manualEvaluatorComparison.components.find((c) => c.component === "V").manual - 3.805) <= 1e-9);

  // El receipt entra como entrada nueva al registro; nada se sobrescribe.
  const identityBefore = registry.snapshot().length;
  assert.equal(registry.has(closure.closureId), false);
  assert.equal(identityBefore, 2);
});

test("IMP-15: sin fixtures aprobados, con comparativa divergente o sin reproducibilidad el gate no cierra (fail-closed)", () => {
  const bundle = frozenCampaignBundle();

  const runOutcome = runP6Replay(bundle, {});
  const first = buildOutputBundle({ bundle, replayOutcome: runOutcome });
  assert.equal(first.ok, true);

  // Comparativa válida de estructura (los componentes se prueban en el test 1).
  const validComparison = {
    ok: true,
    code: "MANUAL_EVALUATOR_AGREEMENT",
    components: [],
    declared: { manualSource: "MANUAL_CAPTURE", evaluatorSource: "P6_RUN_LEDGERS" },
  };

  // Sin evidencia del suite §14.8: GATE-01 no pasa.
  const noFixtureGate = evaluateP6ClosureGate({
    runOutcome,
    firstOutputBundle: first.outputBundle,
    rerunOutputBundle: first.outputBundle,
    fixtureSuiteEvidence: null,
    benchmarkEvaluationKeys: BENCHMARK_EVALUATION_KEYS,
    manualComparison: validComparison,
    bundle,
    singleArmDeclaration: null,
  });
  assert.equal(noFixtureGate.failedIds.includes("IMP15-GATE-01"), true);

  // Caso base satisface el gate (misma versión comparada consigo misma) para
  // graduar los demás escenarios.
  const baselineGate = evaluateP6ClosureGate({
    runOutcome,
    firstOutputBundle: first.outputBundle,
    rerunOutputBundle: first.outputBundle,
    fixtureSuiteEvidence: FIXTURE_SUITE_EVIDENCE,
    benchmarkEvaluationKeys: BENCHMARK_EVALUATION_KEYS,
    manualComparison: validComparison,
    bundle,
    singleArmDeclaration: null,
  });
  assert.equal(baselineGate.failedIds.includes("IMP15-GATE-09"), false);

  // Comparativa en desacuerdo: GATE-09 no pasa.
  const mismatchComparison = {
    ...compareManualVsEvaluator({
      manualEvaluation: {
        ok: true, source: "MANUAL_CAPTURE", H: null, B: null, V: null,
        coverage: { executedVolume: 0, remainingVolume: 60, status: "COVERAGE_INCOMPLETE" },
      },
      campaignEvaluation: evaluateCampaignFromRun({
        replayOutcome: runOutcome,
        benchmarkRows: BENCHMARK_ROWS,
        product: "Gas",
      }),
    }),
  };
  assert.equal(mismatchComparison.ok, false);
  const mismatchGate = evaluateP6ClosureGate({
    runOutcome,
    firstOutputBundle: first.outputBundle,
    rerunOutputBundle: first.outputBundle,
    fixtureSuiteEvidence: FIXTURE_SUITE_EVIDENCE,
    benchmarkEvaluationKeys: BENCHMARK_EVALUATION_KEYS,
    manualComparison: mismatchComparison,
    bundle,
    singleArmDeclaration: null,
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
    fixtureSuiteEvidence: FIXTURE_SUITE_EVIDENCE,
    benchmarkEvaluationKeys: BENCHMARK_EVALUATION_KEYS,
    manualComparison: validComparison,
    bundle,
    singleArmDeclaration: null,
  });
  assert.equal(divergentGate.failedIds.includes("IMP15-GATE-06"), true);

  // Receipt bloqueado con el gate en fallo: no se materializa closure.
  const declined = materializeP6ClosureReceipt({
    gate: { ...baselineGate, ok: false, failedIds: ["IMP15-GATE-02"] },
    manualComparison: validComparison,
    outputBundle: first.outputBundle,
    bundle,
  });
  assert.equal(declined.ok, false);
  assert.ok(declined.failedIds.includes("IMP15-GATE-02"));

  const reproComparison = compareReproducibility({ outputBundle: first.outputBundle }, { outputBundle: first.outputBundle });
  assert.equal(reproComparison.ok, true);
  assert.ok(reproComparison.receiptIds[0] === reproComparison.receiptIds[1]);
});
