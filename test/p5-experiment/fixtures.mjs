// Fixtures SINTÉTICOS del experimento P5 (IMP-16). No son datos reales del
// cliente ni evidencia de mercado: existen para ejercitar la ingeniería
// completa (reserva, freeze, run A0/A1, ΔV, P3 verdict). Se declara el carácter
// sintético de todo (precedente IMP-08/13/15, §25.2).
//
// Mecánica del fixture (4 fronteras, obligación 12 MW, lote 1, cap 12):
//   A0 compra 3 MW en cada frontera: H_A0 = 40.15 + (a+b)/4.
//   A1 espera el spike de FEATURES en D2 (decisión 60.5 sobre ref 36) y
//   redistribuye 3+4+5: H_A1 = 40.15 + b/3.
//   → Delta V = H_A0 - H_A1 = a/4 - b/12, verificada numéricamente en los
//   tests (no por aserto).

import { reserveSealedOos } from "../../src/oos-reservation/reservation.mjs";
import { createGasQuarterlyExecutionContract } from "../../src/execution-contract/execution-contract.mjs";
import { createGasQuarterlyCostLedger } from "../../src/execution-contract/cost-ledger.mjs";
import { createSizingController } from "../../src/sizing-controller/sizing-controller.mjs";
import { defineSearchSpace } from "../../src/s1-strategy/search-space.mjs";
import { createS1Configuration } from "../../src/s1-strategy/configuration.mjs";
import { canonicalValueSha256 } from "../../src/pit-views/pit-record.mjs";
import { buildPitManifestAt } from "../../src/pit-views/views.mjs";
import { ATTESTATION_PATH, FIXTURE_SCOPE, VALUE_ATTESTATION_PATH, fixtureRepo } from "../pit-views/fixture-repo.mjs";
import { validReservationInput } from "../oos-reservation/fixtures.mjs";

export const FIXTURE_PROVENANCE = {
  authority: "SYNTHETIC fixture — no es evidencia de mercado",
  locator: "test/p5-experiment/fixtures.mjs",
};

// --- Reserva OOS sellada sintética (8 quarters sellados: 2021Q3..2023Q2) -----

export function sealedReservationFixture() {
  const derivationInput = validReservationInput();
  const manifest = reserveSealedOos(derivationInput);
  return { derivationInput, manifest };
}

// --- Controller común frozen (IMP-10) ----------------------------------------

export function frozenControllerFixture() {
  return createSizingController({
    lotSizeMw: 1,
    dailyCapMw: 12,
    provenance: FIXTURE_PROVENANCE,
  }).controller;
}

// --- Configuración S1 frozen (IMP-11) ----------------------------------------
// Referencia causal: SMA de 2 puntos (familia B). Con ventana de dos
// observaciones, signedDistanceToReference vale exactamente ±1; el umbral
// -0.5 separa FAVORABLE (≤ -0.5, decisión bajo la referencia) de UNFAVORABLE
// de forma exacta y legible.

export function frozenConfigurationFixture({ frozenAtUtc = "2021-02-01T00:00:00Z" } = {}) {
  const searchSpace = defineSearchSpace({
    spaceId: "S1-P5-FIXTURE-SPACE",
    referenceFamilies: ["B"],
    lengths: [2],
    timeframes: ["daily"],
    horizons: [{ horizonId: "P5-PROCUREMENT-3M", kind: "PROCUREMENT_WINDOW_3M" }],
    movingAverageKinds: ["SMA"],
    favorableFeatures: ["signedDistanceToReference"],
    thresholdValues: [-0.5],
    provenance: FIXTURE_PROVENANCE,
  });
  return createS1Configuration({
    reference: {
      family: "B",
      length: 2,
      movingAverageKind: "SMA",
      timeframe: "daily",
      horizon: { horizonId: "P5-PROCUREMENT-3M", kind: "PROCUREMENT_WINDOW_3M" },
    },
    thresholds: {
      feature: "signedDistanceToReference",
      favorableWhen: "LTE",
      value: -0.5,
    },
    searchSpace: searchSpace.searchSpace,
    calibrationBasis: "PREDECLARED_INTERPRETABLE_BASELINE",
    provenance: FIXTURE_PROVENANCE,
    frozenAtUtc,
  }).configuration;
}

// --- Experimento por campaña (4 fronteras) -----------------------------------

export const FIXTURE_DATE_LIST = ["2021-06-22", "2021-06-23", "2021-06-24", "2021-06-25"];

// Features PIT declaradas: precio de decisión e historial causal por frontera.
// D2 lleva el spike de decisión (UNFAVORABLE para A1); las demás favorable.
const FIXTURE_DECISION_VALUES = {
  "2021-06-22": 40.0,
  "2021-06-23": 60.5,
  "2021-06-24": 39.9,
  "2021-06-25": 39.95,
};
const FIXTURE_HISTORY_VALUES = {
  "2021-06-22": 40.5,
  "2021-06-23": 36.0,
  "2021-06-24": 40.5,
  "2021-06-25": 40.5,
};

// a = best ask extra del día 2 (spike ejecutable); b = best ask extra del
// día 3 (penetración posterior). Delta V esperado: a/4 - b/12 (verificada).
export function buildExperimentFixture({
  campaignId = "GAS-Q-2021Q3",
  day2Premium = 12,
  day3Premium = 0,
  configurationFrozenAtUtc = "2021-02-01T00:00:00Z",
} = {}) {
  const dates = FIXTURE_DATE_LIST;
  const reservationFixture = sealedReservationFixture();
  const controller = frozenControllerFixture();
  const configuration = frozenConfigurationFixture({ frozenAtUtc: configurationFrozenAtUtc });
  const executionContract = createGasQuarterlyExecutionContract();
  const costLedger = createGasQuarterlyCostLedger();

  // NOTA: consumableEvidence debe emparejar EXACTO con su atestación
  // (source/locator/hash/consumableAtUtc, §6.4); sin ese vínculo, auditLinked
  // queda false y la vista no Lee el valor (§6.1).
  const atEvidence = (key, revisionId) => ({
    source: "fixture://ingest",
    locator: `${key}@${revisionId}`,
    sha256: "c".repeat(64),
  });
  const records = dates.map((date) => ([
    {
      key: `S1.P5.history.${date}`,
      viewScope: "decision",
      occurredAtUtc: `${date}T07:50:00Z`,
      publishedAtUtc: `${date}T07:55:00Z`,
      consumableAtUtc: `${date}T08:00:00Z`,
      consumableEvidence: atEvidence(`S1.P5.history.${date}`, `h-${date}`),
      revisionId: `h-${date}`,
      value: FIXTURE_HISTORY_VALUES[date],
    },
    {
      key: `S1.P5.decision.${date}`,
      viewScope: "decision",
      occurredAtUtc: `${date}T09:50:00Z`,
      publishedAtUtc: `${date}T09:52:00Z`,
      consumableAtUtc: `${date}T09:55:00Z`,
      consumableEvidence: atEvidence(`S1.P5.decision.${date}`, `d-${date}`),
      revisionId: `d-${date}`,
      value: FIXTURE_DECISION_VALUES[date],
    },
  ])).flat();

  const attestations = records.map((record) => ({
    ...record.consumableEvidence,
    key: record.key,
    revisionId: record.revisionId,
    valueSha256: canonicalValueSha256(record.value).sha256,
    consumableAtUtc: record.consumableAtUtc,
  }));
  const valueAttestations = records.map((record) => ({
    source: "fixture://value-log",
    locator: `${record.key}@${record.revisionId}`,
    sha256: "d".repeat(64),
    key: record.key,
    revisionId: record.revisionId,
    revisionOf: null,
    valueSha256: canonicalValueSha256(record.value).sha256,
    publishedAtUtc: record.publishedAtUtc,
    revisionEffectiveAtUtc: null,
  }));

  const evidenceContent = JSON.stringify({ artifactKind: "PIT_CONSUMPTION_ATTESTATIONS", auditId: "AUDIT-P5-FIXTURE", scope: FIXTURE_SCOPE, attestations });
  const valueContent = JSON.stringify({ artifactKind: "PIT_VALUE_ATTESTATIONS", auditId: "AUDIT-P5-FIXTURE", scope: FIXTURE_SCOPE, attestations: valueAttestations });
  const { repoRoot, refs } = fixtureRepo({
    artifacts: [
      { path: ATTESTATION_PATH, content: evidenceContent },
      { path: VALUE_ATTESTATION_PATH, content: valueContent },
    ],
  });
  const manifestOutcome = buildPitManifestAt(repoRoot, {
    manifestId: `PIT-MANIFEST-${campaignId}`,
    manifestVersion: "v1",
    records,
    consumptionAttestationRefs: [refs[0]],
    valueAttestationRefs: [refs[1]],
  });
  if (!manifestOutcome.ok) {
    throw new Error(`el manifest PIT del fixture no se construye: ${JSON.stringify(manifestOutcome.errors ?? manifestOutcome.reason ?? manifestOutcome)}`);
  }
  const dataManifest = manifestOutcome.manifest;

  const bestAsks = {
    "2021-06-22": 40,
    "2021-06-23": 40 + day2Premium,
    "2021-06-24": 40 + day3Premium,
    "2021-06-25": 40,
  };
  const priceObservations = dates.map((date) => ({ timestamp: `${date}T09:55:00Z`, bestAsk: bestAsks[date] }));

  const s1FeatureInputDeclarations = dates.map((date) => ({
    frontierDate: date,
    decisionPricePitKey: `S1.P5.decision.${date}`,
    history: [{ atUtc: `${date}T08:00:00Z`, pitKey: `S1.P5.history.${date}` }],
  }));

  return {
    frozenReservation: reservationFixture.manifest,
    reservationDerivationInput: reservationFixture.derivationInput,
    freezeInput: {
      experiment: { experimentId: `EXP-P5-A0-VS-A1-${campaignId}`, experimentVersion: "v1.0" },
      scope: "SYNTHETIC_FIXTURE",
      frozenAtUtc: "2021-02-01T00:00:00Z",
      provenance: FIXTURE_PROVENANCE,
      oosReservation: reservationFixture.manifest,
      oosReservationDerivation: reservationFixture.derivationInput,
      s1Configuration: configuration,
      controller,
      campaign: { campaignId, product: "Gas", mission: "Quarterly" },
      openingContract: {
        obligationId: `OBL-${campaignId}`,
        openingObligation: 12,
        deadline: "2021-12-31T10:00:00Z",
        unit: "MW",
        terminalRuleStatus: "UNVERIFIED",
        amendments: [],
        residualAmendment: null,
      },
      decisionCalendar: {
        calendarId: `CAL-${campaignId}`,
        campaignId,
        opportunities: dates.map((date) => ({ date, scheduled: true, decisionTimeUtc: `${date}T10:00:00Z` })),
        scheduledOpportunitiesCount: dates.length,
      },
      execution: { executionContractVersion: "v1.0", costLedgerVersion: "v1.0" },
      executionContract,
      costLedger,
      dataManifest,
      priceObservations,
      benchmark: { sourceVersion: "fixture://benchmark-B", status: "UNRECONCILED" },
      evaluator: { evaluatorVersion: "v1.0" },
      stochasticity: null,
      s1FeatureInputDeclarations,
    },
  };
}
