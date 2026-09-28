// SEM-2 · one shared non-UI backend projection of the canonical semantics
// (intake D-20260928T181604-148d, operative revision 20260928-english-v2). This is
// the single source the four surfaces consume; no renderer, no display-string
// parsing. It reuses the accepted SEM-1 / FIX-07 contract and the legacy
// compatibility adapter, and it never mints economics.
//
// Source of truth for identity: src/backtesting-semantics/contract.mjs.
// Source of truth for the historical mapping: ./legacy-compat.mjs.
import {
  IDENTITY,
  MISSIONS,
  SEMANTIC_VERSION,
  H_S1_01,
  H_RD_01,
  MISSION_LABELS,
  clientFor,
  benchmarkFor,
} from "./contract.mjs";
import { adaptLegacyExploratoryArtifact } from "./legacy-compat.mjs";

// Canonical English product vocabulary. The owner (2026-09-28) requires every
// canonical domain name, enum and status in English and produced by the backend;
// the UI must not translate or invent its own registry.
export const CANONICAL_LABELS = Object.freeze({
  identities: Object.freeze({ CLIENT: "Client", BENCHMARK: "Benchmark", HYPOTHESES: "Hypotheses", CONTROL: "Control" }),
  tabs: Object.freeze({ campaigns: "Campaigns & Runs", replay: "Replay", backtests: "Backtests", research: "Research" }),
  hypotheses: Object.freeze({ strategy: "Strategy", researchDiscovery: "Research Discovery" }),
  statuses: Object.freeze({
    UNTESTED: "Tested? No — no comparable evidence",
    PROVENANCE_ONLY: "Historical provenance only",
  }),
});

// Product code -> canonical mission. Kept here as the backend projection's own
// mapping so a standalone consumer does not import the exploratory mission file.
const MISSION_BY_PRODUCT = Object.freeze({
  G0BQ: "GAS_QUARTERLY",
  G0BM: "GAS_MONTHLY",
  DEBQ: "POWER_QUARTERLY",
  DEBM: "POWER_MONTHLY",
});

const PRODUCT_BY_MISSION = Object.freeze(Object.fromEntries(
  Object.entries(MISSION_BY_PRODUCT).map(([product, missionId]) => [missionId, product]),
));

function canonicalHypothesisView(hypothesis, { evidenceStatus = "UNTESTED" } = {}) {
  return Object.freeze({
    kind: IDENTITY.HYPOTHESIS,
    hypothesisId: hypothesis.hypothesisId,
    name: hypothesis.name,
    question: hypothesis.question,
    version: hypothesis.version,
    originType: hypothesis.originType,
    strategyRefs: [...hypothesis.strategyRefs],
    missions: [...hypothesis.missions],
    role: CANONICAL_LABELS.hypotheses.strategy,
    evidenceStatus,
    tested: false,
    runnable: false,
    result: null,
  });
}

// One BENCHMARK identity. A BT-02 provisional B is exposed as BENCHMARK_PROVISIONAL;
// without a bound provisional value the identity stays UNAVAILABLE. A historical
// proxy never becomes RECONCILED_OFFICIAL here.
function benchmarkForMission(missionId, campaigns) {
  const product = PRODUCT_BY_MISSION[missionId];
  const bound = (campaigns ?? []).find((campaign) => campaign?.product === product
    && campaign?.benchmark?.status === "BENCHMARK_PROVISIONAL"
    && Number.isFinite(campaign?.benchmark?.B)
    && typeof campaign?.benchmark?.versionId === "string");
  if (bound === undefined) {
    return benchmarkFor(missionId);
  }
  const value = bound.benchmark.B;
  const referenceVersion = bound.benchmark.versionId;
  return benchmarkFor(missionId, {
    campaignId: bound.campaignKey,
    obligationId: bound.campaignKey,
    status: "BENCHMARK_PROVISIONAL",
    value,
    referenceVersion,
    provenance: "operations/exploratory/v3/reconciled-results-BT-02.json",
  });
}

function missionCampaigns(missionId, campaigns) {
  const product = PRODUCT_BY_MISSION[missionId];
  return (campaigns ?? []).filter((campaign) => campaign?.product === product).map((campaign) => Object.freeze({
    campaignKey: campaign.campaignKey,
    product: campaign.product,
    maturity: campaign.maturity,
    status: campaign.status ?? null,
    campaignReadiness: campaign.campaignReadiness ?? null,
    benchmark: campaign.benchmark ? Object.freeze({ ...campaign.benchmark }) : null,
    fees: campaign.fees ? Object.freeze({ ...campaign.fees }) : null,
  }));
}

// CONTROL is experiment metadata, never CLIENT nor BENCHMARK. The historical
// calendar comparator is exposed only through the source-bound legacy adapter, and
// its equivalence to the active protocol is explicitly false.
function controlView(legacy) {
  const historical = legacy?.ok === true ? legacy.roles?.BASELINE ?? null : null;
  return Object.freeze({
    kind: IDENTITY.CONTROL,
    role: CANONICAL_LABELS.identities.CONTROL,
    activeProtocolEquivalent: false,
    productionFallbackAuthorized: false,
    historicalComparator: historical === null ? null : Object.freeze({
      legacyId: historical.legacyId,
      resolved: historical.resolved,
      alias: historical.alias ?? null,
      hypothesisId: historical.hypothesisId ?? null,
      runId: historical.runId ?? null,
      role: IDENTITY.CONTROL,
      // A calendar comparator is not an active CONTROL just by being A0/BASELINE.
      activeProtocolEquivalent: false,
    }),
  });
}

// Canonical replacement labels for the historical research candidates. The old
// artifact names A0 "Client practice" and grants it "Current client practice"
// authority; neither is a primary product claim (SEM-1, audit CS-01/CS-03). The
// canonical name and the authority status come from the source-bound mapping.
const LEGACY_CANDIDATE_LABELS = Object.freeze({
  A0: Object.freeze({ canonicalName: "Historical calendar comparator (A0)", authorityLabel: "Legacy provenance only — no current client authority" }),
  DIP10: Object.freeze({ canonicalName: "H-S1-01 · Session-Anchored Rolling Reference", authorityLabel: "Provenance only — not a tested result" }),
  HOUR: Object.freeze({ canonicalName: "H-RD-01 · Execution Hour", authorityLabel: "Research Discovery provenance only" }),
});

function legacyCandidateViews(legacy) {
  if (legacy?.ok !== true) {
    return Object.freeze({});
  }
  return Object.freeze(Object.fromEntries(Object.entries(LEGACY_CANDIDATE_LABELS).map(([candidateId, label]) => {
    const role = legacy.candidates?.[candidateId] ?? null;
    return [candidateId, Object.freeze({
      candidateId,
      role: role?.role ?? null,
      hypothesisId: role?.hypothesisId ?? null,
      resolved: role?.resolved === true,
      canonicalName: label.canonicalName,
      authorityLabel: label.authorityLabel,
      authorityClaim: false,
      tested: false,
    })];
  })));
}

function projectionSource(exploratory) {
  const provenance = exploratory?.provenance ?? null;
  if (provenance?.resultsSha256 === undefined || provenance?.resultsPath === undefined) {
    return Object.freeze({ status: "UNAVAILABLE", kind: null, artifactPath: null, artifactSha256: null });
  }
  return Object.freeze({
    status: "VERIFIED",
    kind: "EXPLORATORY",
    artifactPath: provenance.resultsPath,
    artifactSha256: provenance.resultsSha256,
  });
}

// Public entry point. `exploratory` is the verified exploratory projection (with
// provenance); `backtestReadiness` is the verified BT-02 record. The output uses
// stable English canonical identities and typed roles for all four surfaces.
export function buildCanonicalSemanticsProjection({ exploratory = null, backtestReadiness = null, clientEvidenceByMission = {} } = {}) {
  const campaigns = backtestReadiness?.results?.campaigns ?? [];
  const legacy = adaptLegacyExploratoryArtifact({ provenance: exploratory?.provenance ?? null });
  const missions = MISSIONS.map((mission) => {
    const evidence = clientEvidenceByMission?.[mission.id] ?? undefined;
    return Object.freeze({
      missionId: mission.id,
      label: MISSION_LABELS[mission.id],
      product: PRODUCT_BY_MISSION[mission.id],
      cadence: mission.cadence,
      client: clientFor(mission.id, evidence ?? {}),
      benchmark: benchmarkForMission(mission.id, campaigns),
      hypotheses: Object.freeze([
        canonicalHypothesisView(H_S1_01),
        canonicalHypothesisView(H_RD_01, { evidenceStatus: "PROVENANCE_ONLY" }),
      ]),
      control: controlView(legacy),
      campaigns: Object.freeze(missionCampaigns(mission.id, campaigns)),
    });
  });
  return Object.freeze({
    ok: true,
    semanticVersion: SEMANTIC_VERSION,
    source: projectionSource(exploratory),
    legacyAdapter: legacy,
    legacyCandidates: legacyCandidateViews(legacy),
    labels: CANONICAL_LABELS,
    missions: Object.freeze(missions),
  });
}
