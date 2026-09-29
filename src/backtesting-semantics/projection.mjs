// SEM-2 · one shared non-UI backend projection of the canonical semantics
// (intake D-20260928T181604-148d, operative revision 20260928-english-v2). This is
// the single source the four surfaces consume; no renderer, no display-string
// parsing. It reuses the accepted SEM-1 / FIX-07 contract and the legacy
// compatibility adapter, and it never mints economics.
//
// Source of truth for identity: src/backtesting-semantics/contract.mjs.
// Source of truth for the historical mapping: ./legacy-compat.mjs.
//
// Artifact scoping (SEM-2 T03): every legacy mapping and provenance reference is
// scoped to the exact verified artifact of ITS product via provenance.byProduct
// (loader: src/ui/canonical-inputs.mjs — Gas v2, Power v3). A Gas hash never
// classifies a Power mission, and vice versa.
import { createHash } from "node:crypto";

import {
  IDENTITY,
  MISSIONS,
  SEMANTIC_VERSION,
  H_S1_01,
  H_RD_01,
  MISSION_LABELS,
  HYPOTHESIS_BY_ID,
  clientFor,
  benchmarkFor,
} from "./contract.mjs";
import { adaptLegacyExploratoryArtifact, LEGACY_RUN_NAMES } from "./legacy-compat.mjs";

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
  // UI-10 (PLAN_UI §1 row "All 4"): benchmark reference statuses as words, never
  // the raw enum; an unbound campaign reference reads "campaign not bound".
  benchmarkStatuses: Object.freeze({
    BENCHMARK_PROVISIONAL: "Provisional",
    RECONCILED_OFFICIAL: "Official",
    UNAVAILABLE: "Unavailable",
    CAMPAIGN_NOT_BOUND: "campaign not bound",
  }),
  // UI-10 (PLAN_UI §1 row "Raw codes SOURCE_MISSING", BT08-10): user-facing
  // titles of the Development readiness codes. The code and the backend message
  // stay attached; an unlisted code falls back to the generic title.
  blockers: Object.freeze({
    SOURCE_MISSING: "Development source missing",
    SOURCE_ARTIFACT_INVALID: "Development source invalid",
    PROVENANCE_INVALID: "Source provenance invalid",
    FREEZE_PENDING: "Required freeze not bound",
    LAUNCH_REQUEST_MISSING: "Development request missing",
    MISSION_REQUEST_MISMATCH: "Development request targets another mission",
    UNKNOWN_MISSION: "Unknown mission",
    DEFAULT: "Development blocker",
  }),
  // UI-10 (PLAN_UI §3 direction): historical data is shown in a card labelled
  // "Historical · provenance only"; the comparator of legacy runs is the
  // calendar comparator (A0). CONTROL is named only inside the ablation
  // (decisión de Bru 29-sep-2026, PLAN_STATUS.md fila UI-10).
  historical: Object.freeze({
    badge: "Historical · provenance only",
    notEvidence: "Not current hypothesis evidence",
    comparator: LEGACY_RUN_NAMES.BASELINE,
    deltaVsComparator: "ΔV vs comparator (A0)",
    technicalAlias: "technical alias",
    lineageOf: "legacy lineage of",
  }),
});

// UI-10 (PLAN_UI §1 raw codes row, §4.A.3; BT08-10): a Development blocker reads
// as its English title plus the backend message; the machine code stays with
// the blocker for data attributes. Scope and the Development control share it.
export function blockerDisplayText(blocker) {
  const titles = CANONICAL_LABELS.blockers;
  return `${titles[blocker?.code] ?? titles.DEFAULT}: ${blocker?.message ?? ""}`;
}

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

// The visible role is the accepted origin family, never a single hardcoded one:
// Strategy-derived hypotheses are "Strategy"; Research Discovery hypotheses are
// "Research Discovery" (SEM-2 T05, FIX-07 origin families).
function visibleRoleFor(hypothesis) {
  return hypothesis.originType === "RESEARCH_DISCOVERY"
    ? CANONICAL_LABELS.hypotheses.researchDiscovery
    : CANONICAL_LABELS.hypotheses.strategy;
}

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
    applicabilityStatus: hypothesis.applicabilityStatus,
    role: visibleRoleFor(hypothesis),
    evidenceStatus,
    tested: false,
    runnable: false,
    result: null,
  });
}

// One BENCHMARK identity, scoped to ONE campaign. There is no mission-level B:
// each campaign keeps its own reference (value, version and provenance path),
// so two campaigns of the same mission with different B/versions keep separate
// references and a cross-campaign delta is rejected (SEM-2 T04, SEM2-08).
function benchmarkForCampaign(missionId, campaign, benchmarkProvenancePath) {
  const bound = campaign?.benchmark?.status === "BENCHMARK_PROVISIONAL"
    && Number.isFinite(campaign?.benchmark?.B)
    && typeof campaign?.benchmark?.versionId === "string";
  if (!bound) {
    return benchmarkFor(missionId);
  }
  const value = campaign.benchmark.B;
  const referenceVersion = campaign.benchmark.versionId;
  const provenance = typeof benchmarkProvenancePath === "string" && benchmarkProvenancePath.trim() !== ""
    ? benchmarkProvenancePath
    : null;
  if (provenance === null) {
    // A B without a source path stays unbound: the value alone is not provenance.
    return benchmarkFor(missionId);
  }
  return benchmarkFor(missionId, {
    campaignId: campaign.campaignKey,
    obligationId: campaign.campaignKey,
    status: "BENCHMARK_PROVISIONAL",
    value,
    referenceVersion,
    provenance,
  });
}

// Paired deltas only exist inside one campaign scope with one reference version.
// Cross-campaign or cross-version deltas are rejected fail-closed, and a
// provisional B never produces a valid paired effect (SEM2-08).
export function pairedBenchmarkDelta(benchmarkA, benchmarkB) {
  const invalid = (code) => ({ ok: false, verdict: "HOLD", code });
  if (benchmarkA?.kind !== IDENTITY.BENCHMARK || benchmarkB?.kind !== IDENTITY.BENCHMARK) {
    return invalid("BENCHMARK_IDENTITY_MISSING");
  }
  if (benchmarkA.scopeStatus !== "BOUND" || benchmarkB.scopeStatus !== "BOUND") {
    return invalid("BENCHMARK_NOT_BOUND");
  }
  if (benchmarkA.campaignId !== benchmarkB.campaignId || benchmarkA.obligationId !== benchmarkB.obligationId) {
    return invalid("CROSS_CAMPAIGN_BENCHMARK_DELTA");
  }
  if (benchmarkA.referenceVersion !== benchmarkB.referenceVersion) {
    return invalid("BENCHMARK_VERSION_MISMATCH");
  }
  if (benchmarkA.status !== "RECONCILED_OFFICIAL" || benchmarkB.status !== "RECONCILED_OFFICIAL") {
    return invalid("BENCHMARK_NOT_OFFICIAL");
  }
  return { ok: true, campaignId: benchmarkA.campaignId, referenceVersion: benchmarkA.referenceVersion };
}

// UI-08 (review R01): the campaign calendar window travels with each campaign,
// matched by product+maturity from the same verified exploratory artifact that
// carries firstDay/lastDay (the BT-02 readiness record does not). A campaign
// without a window in the verified artifacts stays explicit (null), never
// borrowed from another campaign.
function exploratoryWindowIndex(exploratory) {
  const index = new Map();
  for (const campaign of exploratory?.results?.campaigns ?? []) {
    if (typeof campaign?.product !== "string" || typeof campaign?.maturity !== "string") continue;
    if (typeof campaign.firstDay !== "string" || typeof campaign.lastDay !== "string") continue;
    index.set(`${campaign.product}|${campaign.maturity}`, Object.freeze({ firstDay: campaign.firstDay, lastDay: campaign.lastDay }));
  }
  return index;
}

function missionCampaigns(missionId, campaigns, windowsByProductMaturity) {
  const product = PRODUCT_BY_MISSION[missionId];
  return (campaigns ?? []).filter((campaign) => campaign?.product === product).map((campaign) => Object.freeze({
    campaignKey: campaign.campaignKey,
    product: campaign.product,
    maturity: campaign.maturity,
    status: campaign.status ?? null,
    campaignReadiness: campaign.campaignReadiness ?? null,
    window: windowsByProductMaturity.get(`${campaign.product}|${campaign.maturity}`) ?? null,
    benchmark: campaign.benchmark ? Object.freeze({ ...campaign.benchmark }) : null,
    fees: campaign.fees ? Object.freeze({ ...campaign.fees }) : null,
  }));
}

// CONTROL is experiment metadata, never CLIENT nor BENCHMARK. The historical
// calendar comparator is exposed only through the source-bound legacy adapter of
// THIS product's verified artifact, and its equivalence to the active protocol
// is explicitly false.
function controlView(legacyAdapter) {
  const historical = legacyAdapter?.ok === true ? legacyAdapter.roles?.BASELINE ?? null : null;
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
      artifactSha256: legacyAdapter.artifactSha256,
      release: legacyAdapter.release,
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

// UI-10 (PLAN_UI §4.A.1): one visible identity per historical exploratory run.
// The lineage hypothesis comes only from the source-bound adapter of the same
// artifact; without a verified mapping the lineage stays null (fail-closed) and
// the run keeps its historical name. None of these is a tested result.
function historicalRunViews(legacyAdapter) {
  return Object.freeze(Object.fromEntries(Object.entries(LEGACY_RUN_NAMES).map(([technicalAlias, displayName]) => {
    const role = legacyAdapter?.ok === true ? legacyAdapter.roles?.[technicalAlias] ?? null : null;
    const comparator = technicalAlias === "BASELINE";
    const lineageOf = !comparator && role?.resolved === true ? role.hypothesisId ?? null : null;
    const caption = comparator
      ? `${CANONICAL_LABELS.historical.technicalAlias} ${technicalAlias} · historical calendar comparator`
      : `${CANONICAL_LABELS.historical.technicalAlias} ${technicalAlias} · ${lineageOf === null ? "lineage unavailable — no verified source-bound mapping" : `${CANONICAL_LABELS.historical.lineageOf} ${lineageOf}`}`;
    return [technicalAlias, Object.freeze({
      technicalAlias,
      displayName,
      label: comparator || lineageOf === null ? displayName : `${displayName} · ${CANONICAL_LABELS.historical.lineageOf} ${lineageOf}`,
      caption,
      comparator,
      lineageOf,
      resolved: role?.resolved === true,
      tested: false,
    })];
  })));
}

// UI-10 (PLAN_UI §1 row "All 4", §4.A.1): the Client summary is produced here
// from the contract's confirmed/unknown fields, not written in the view.
function clientSummaryOf(client) {
  const confirmed = client?.confirmed ?? {};
  const unknownTail = "sizing, fills and full cost unknown";
  if (confirmed.scope === "CURRENT_MANDATE_UNSCOPED") {
    return `${confirmed.purchaseTime} ${confirmed.timezone} known · current mandate, campaign not identified · ${unknownTail}`;
  }
  if (confirmed.scope === "CAMPAIGN_EVIDENCE") {
    return `${confirmed.purchaseTime} ${confirmed.timezone} · campaign ${client.campaignId} · ${unknownTail}`;
  }
  return `purchase timing unknown for this mission · ${unknownTail}`;
}

// Candidate views exist regardless of adapter state, so the UI never falls back
// to the artifact's own Spanish/client-practice labels when the mapping is
// unavailable: an unverified mapping still gets its canonical label with
// resolved:false.
function legacyCandidateViews(primaryAdapter) {
  return Object.freeze(Object.fromEntries(Object.entries(LEGACY_CANDIDATE_LABELS).map(([candidateId, label]) => {
    const role = primaryAdapter?.ok === true ? primaryAdapter.candidates?.[candidateId] ?? null : null;
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

// Per-artifact source identity. Without provenance.byProduct there is no
// per-product scope and the projection stays UNAVAILABLE instead of attributing
// one release's hash to every product (SEM-2 T03).
function projectionSource(exploratory) {
  const byProduct = exploratory?.provenance?.byProduct ?? null;
  if (byProduct === null || typeof byProduct !== "object") {
    return Object.freeze({ status: "UNAVAILABLE", kind: null, artifactPath: null, artifactSha256: null, products: Object.freeze({}) });
  }
  const products = Object.freeze(Object.fromEntries(Object.entries(byProduct).map(([product, provenance]) => {
    const verified = provenance && typeof provenance === "object"
      && typeof provenance.resultsPath === "string" && typeof provenance.resultsSha256 === "string";
    return [product, Object.freeze({
      status: verified ? "VERIFIED" : "UNAVAILABLE",
      release: verified ? provenance.release ?? null : null,
      artifactPath: verified ? provenance.resultsPath : null,
      artifactSha256: verified ? provenance.resultsSha256 : null,
    })];
  })));
  const primary = Object.values(products).find((entry) => entry.status === "VERIFIED") ?? null;
  return Object.freeze({
    status: primary === null ? "UNAVAILABLE" : "VERIFIED",
    kind: primary === null ? null : "EXPLORATORY",
    artifactPath: primary?.artifactPath ?? null,
    artifactSha256: primary?.artifactSha256 ?? null,
    products,
  });
}

// BT-08 results (SEM-2 T01): the shared projection carries the actual
// hypothesis/version/mission/run bindings of completed BT-08 jobs. Entries that
// do not bind the published hypothesis identity fail closed as UNAVAILABLE; a
// Development result never flips the hypothesis to TESTED (researchPass stays
// false in the BT-08 contract itself).
const MAX_RESULT_STRING = 256;

function hypothesisResultView(entry) {
  const published = HYPOTHESIS_BY_ID[entry?.hypothesisId];
  // The failed view keeps the declared hypothesisId (when any) so consumers can
  // see exactly which identity failed to bind and why.
  const invalid = (code) => Object.freeze({
    state: "UNAVAILABLE",
    code,
    hypothesisId: typeof entry?.hypothesisId === "string" ? entry.hypothesisId : null,
    hypothesisVersion: typeof entry?.hypothesisVersion === "string" ? entry.hypothesisVersion : null,
    missionId: typeof entry?.missionId === "string" ? entry.missionId : null,
    runId: null,
    status: null,
    validComparison: false,
    tested: false,
    researchPass: false,
    retention: null,
    resultPointer: null,
    ablation: null,
    comparison: null,
    // UI-08 (review R09): phase and data mode are part of the result identity
    // (family = hypothesis|mission|phase|mode); without them two results of the
    // same hypothesis and mission are indistinguishable downstream.
    phase: typeof entry?.phase === "string" ? entry.phase : null,
    dataMode: typeof entry?.dataMode === "string" ? entry.dataMode : null,
  });
  if (!published || typeof entry !== "object") return invalid("HYPOTHESIS_RESULT_INVALID");
  if (entry.hypothesisVersion !== published.version) return invalid("HYPOTHESIS_VERSION_MISMATCH");
  if (typeof entry.runId !== "string" || entry.runId.trim() === "" || entry.runId.length > MAX_RESULT_STRING) {
    return invalid("HYPOTHESIS_RUN_ID_INVALID");
  }
  const missionKnown = MISSIONS.some((mission) => mission.id === entry.missionId);
  if (!missionKnown || !published.missions.includes(entry.missionId)) return invalid("HYPOTHESIS_MISSION_NOT_APPLICABLE");
  if (typeof entry.status !== "string" || entry.status.trim() === "") return invalid("HYPOTHESIS_RESULT_STATUS_INVALID");
  const validComparison = entry.validComparison === true;
  const retentionState = entry.retention?.state ?? null;
  const current = entry.status === "SUCCEEDED" && validComparison && retentionState === "CURRENT";
  const resultPointer = typeof entry.resultPath === "string" && entry.resultPath.startsWith("operations/")
    && typeof entry.resultSha256 === "string" && /^[a-f0-9]{64}$/.test(entry.resultSha256)
    ? Object.freeze({ path: entry.resultPath, sha256: entry.resultSha256 })
    : null;
  return Object.freeze({
    state: current ? "CURRENT" : "NOT_CURRENT",
    code: null,
    hypothesisId: published.hypothesisId,
    hypothesisName: published.name,
    hypothesisVersion: published.version,
    missionId: entry.missionId,
    runId: entry.runId,
    status: entry.status,
    // A Development result is evidence, never a scientific validation: the
    // BT-08 contract itself keeps scientificConclusion null / researchPass false.
    validComparison,
    tested: false,
    researchPass: false,
    retention: retentionState,
    resultPointer,
    phase: typeof entry.phase === "string" ? entry.phase : null,
    dataMode: typeof entry.dataMode === "string" ? entry.dataMode : null,
    // UI-08: the backend-produced ablation (CONTROL ↔ active hypothesis) and the
    // CLIENT/BENCHMARK/HYPOTHESIS comparison travel with the result so the final
    // workspace reads the same economics the run produced, with no UI arithmetic.
    ablation: entry.ablation ?? null,
    comparison: entry.comparison ?? null,
  });
}

// Public entry point. `exploratory` is the verified exploratory projection (with
// provenance.byProduct and legacyArtifacts bytes per product); `backtestReadiness`
// is the verified BT-02 record; `hypothesisResults` are completed BT-08 job
// results. The output uses stable English canonical identities and typed roles
// for all four surfaces.
export function buildCanonicalSemanticsProjection({
  exploratory = null,
  backtestReadiness = null,
  clientEvidenceByMission = {},
  hypothesisResults = [],
} = {}) {
  const campaigns = backtestReadiness?.results?.campaigns ?? [];
  const byProduct = exploratory?.provenance?.byProduct ?? null;
  const legacyArtifacts = exploratory?.legacyArtifacts ?? null;
  const adapterForProduct = (product) => {
    const provenance = byProduct?.[product] ?? null;
    const artifact = legacyArtifacts?.[product] ?? null;
    return adaptLegacyExploratoryArtifact({ provenance, artifact });
  };
  const bt02ProvenancePath = backtestReadiness?.provenance?.artifactPath ?? null;
  const exploratoryWindows = exploratoryWindowIndex(exploratory);
  const resultsByHypothesis = Object.freeze(Object.fromEntries(
    Object.keys(HYPOTHESIS_BY_ID).map((hypothesisId) => [hypothesisId, Object.freeze([])]),
  ));
  const seenResults = [];
  for (const entry of Array.isArray(hypothesisResults) ? hypothesisResults : []) {
    seenResults.push(hypothesisResultView(entry));
  }
  const missions = MISSIONS.map((mission) => {
    const product = PRODUCT_BY_MISSION[mission.id];
    const legacyAdapter = adapterForProduct(product);
    const evidence = clientEvidenceByMission?.[mission.id] ?? undefined;
    const benchmarkByCampaign = Object.freeze(Object.fromEntries(
      missionCampaigns(mission.id, campaigns, exploratoryWindows).map((campaign) => [campaign.campaignKey, benchmarkForCampaign(mission.id, campaign, bt02ProvenancePath)]),
    ));
    const client = clientFor(mission.id, evidence ?? {});
    return Object.freeze({
      missionId: mission.id,
      label: MISSION_LABELS[mission.id],
      product,
      cadence: mission.cadence,
      client,
      clientSummary: clientSummaryOf(client),
      benchmark: benchmarkFor(mission.id),
      benchmarkByCampaign,
      hypotheses: Object.freeze([canonicalHypothesisView(H_S1_01)]),
      control: controlView(legacyAdapter),
      legacyAdapter,
      historicalRuns: historicalRunViews(legacyAdapter),
      campaigns: Object.freeze(missionCampaigns(mission.id, campaigns, exploratoryWindows)),
      // UI-08 (review R05): mission results are not pinned to H-S1-01 — every
      // published canonical hypothesis that declares this mission carries its
      // own results here (Research Discovery stays in HYPOTHESES/Research, SEM-1).
      hypothesisResults: Object.freeze(seenResults.filter((result) => result.state !== "UNAVAILABLE"
        && result.missionId === mission.id
        && HYPOTHESIS_BY_ID[result.hypothesisId]?.originType !== "RESEARCH_DISCOVERY")),
    });
  });
  return Object.freeze({
    ok: true,
    semanticVersion: SEMANTIC_VERSION,
    source: projectionSource(exploratory),
    legacyAdapter: adapterForProduct(PRODUCT_BY_MISSION.GAS_QUARTERLY),
    legacyCandidates: legacyCandidateViews(adapterForProduct(PRODUCT_BY_MISSION.GAS_QUARTERLY)),
    historicalRuns: historicalRunViews(adapterForProduct(PRODUCT_BY_MISSION.GAS_QUARTERLY)),
    labels: CANONICAL_LABELS,
    // HYPOTHESES collection: every canonical hypothesis with its accepted scope.
    // H-RD-01 (Research Discovery) declares missions: [] — it belongs to the
    // hypothesis collection, never to an undeclared mission row (SEM-2 T05).
    hypotheses: Object.freeze([canonicalHypothesisView(H_S1_01), canonicalHypothesisView(H_RD_01, { evidenceStatus: "PROVENANCE_ONLY" })]),
    results: Object.freeze(Object.fromEntries(
      Object.keys(HYPOTHESIS_BY_ID).map((hypothesisId) => [
        hypothesisId,
        Object.freeze(seenResults.filter((result) => result.hypothesisId === hypothesisId)),
      ]),
    )),
    missions: Object.freeze(missions),
  });
}

// Convenience for the health contract: a stable content hash of the snapshot.
export function snapshotRevisionOf(projection) {
  return createHash("sha256").update(JSON.stringify(projection)).digest("hex");
}
