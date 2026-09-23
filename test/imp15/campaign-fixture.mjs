// Fixtures compartidas de los suites IMP-15: campaña Gas Quarterly sintética
// y vía manual/evaluator. Extraídas de manual-campaign-closure.test.mjs para
// que los tests de los items del closure gate reutilicen exactamente las
// mismas fixtures sin duplicación. Fuente: SPEC v1.1.1 §14.2/§14.3/§14.6/
// §14.8; oracle IMP-15 (operations/audit/IMP-15/manual-campaign-oracle.md).

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildReplayBundle,
  evaluateCampaignManually,
  evaluateCampaignFromRun,
  compareManualVsEvaluator,
  runP6Replay,
  MANUAL_FIXTURE_IDS,
  FIXTURE_SUITE_RUN_EVIDENCE_KIND,
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
  locator: "test/imp15/campaign-fixture.mjs",
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
          locator: "test/imp15/campaign-fixture.mjs",
        },
      },
    ],
  };
  ledger.contentHash = contentHashOf(ledger.entries);
  return ledger;
}

// Frozen bundle §14.2 de la campaña de cierre (una sola instancia: el run y
// su réplica de reproducibilidad usan el MISMO bundle congelado, §14.9).
function frozenCampaignBundle({ costLedger = null, dailyCapMw = 12 } = {}) {
  const resolvedLedger = costLedger ?? createGasQuarterlyCostLedger();
  const controllerOutcome = createSizingController({
    lotSizeMw: 1,
    dailyCapMw,
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

// Reutilizados por los demás suites IMP-15.
export {
  frozenCampaignBundle,
  createCostLedgerWithKnownNonEmbeddedFee,
  manualAndRunEvaluations,
  loadImp13SuiteRunEvidence,
  PROVENANCE,
  CONSUMABLE_EVIDENCE,
  OPENING_OBLIGATION_MW,
  CAMPAIGN_DATES,
  DAY_ASKS,
  BENCHMARK_ROWS,
  BENCHMARK_EVALUATION_KEYS,
  DECISION_RECORD,
  BENCHMARK_RECORD,
  buildManifest,
};
