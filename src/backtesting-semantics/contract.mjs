// SEM-1 · Owner decision 2026-09-28. Product identities are separate from
// historical replay arm IDs. The latter require a run-scoped provenance mapping.
// FIX-07 · operative revision 2026-09-28 (intake D-20260928T135440-85ac):
// canonical Hypothesis identity/naming (H-Sx-nn / H-S1S3-nn / H-RD-nn) that
// consumes the accepted HYP-1 definition instead of redefining it. One contract,
// no second registry.
import { H_S1_01 as HYP1_H_S1_01 } from "../s1-strategy/h-s1-01.mjs";
import { contentHashOf } from "../sizing-controller/versioning.mjs";

export const SEMANTIC_VERSION = "SEM-1/2026-09-28/v1";
export const IDENTITY = Object.freeze({ CLIENT: "CLIENT", BENCHMARK: "BENCHMARK", HYPOTHESIS: "HYPOTHESIS", CONTROL: "CONTROL" });
export const MISSIONS = Object.freeze([
  Object.freeze({ id: "GAS_QUARTERLY", product: "GAS", cadence: "QUARTERLY", benchmarkWindow: "3-1-3" }),
  Object.freeze({ id: "GAS_MONTHLY", product: "GAS", cadence: "MONTHLY", benchmarkWindow: "1-0-1" }),
  Object.freeze({ id: "POWER_QUARTERLY", product: "POWER", cadence: "QUARTERLY", benchmarkWindow: "3-1-3" }),
  Object.freeze({ id: "POWER_MONTHLY", product: "POWER", cadence: "MONTHLY", benchmarkWindow: "1-0-1" }),
]);
// Canonical hypothesis origin families (FIX-07, naming convention preserved
// from intake D-20260928T135440-85ac).
export const ORIGIN_TYPE = Object.freeze({
  STRATEGY_DERIVED: "STRATEGY_DERIVED",
  MULTI_STRATEGY: "MULTI_STRATEGY",
  RESEARCH_DISCOVERY: "RESEARCH_DISCOVERY",
});

// H-Sx-nn (single Strategy), H-S1S3-nn (deterministically ordered multi-
// Strategy) and H-RD-nn (Research Discovery without an evidenced Strategy
// parent). The ID never encodes performance, phase, campaign, mission or version.
export const HYPOTHESIS_ID_PATTERN = /^H-(?:S\d+(?:S\d+)*|RD)-\d{2}$/;

// Display labels mirror the accepted HYP-1 mission scope. Backend scope keeps
// the MISSIONS ids; this mapping is only for provenance checks/presentation.
export const MISSION_LABELS = Object.freeze({
  GAS_QUARTERLY: "Gas Quarterly",
  GAS_MONTHLY: "Gas Monthly",
  POWER_QUARTERLY: "Power Quarterly",
  POWER_MONTHLY: "Power Monthly",
});

function deepFreeze(value) {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function isSha256(value) {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

// Canonical hypothesis record. `strategy`/`parameters`/`status`/`result` are
// retained for the SEM-1 consumers; the identity fields are the canonical ones.
function hypothesisRecord({
  hypothesisId, originType, strategyRefs, name, question, version, missions,
  provenance, aliases = [], legacy = null, strategy = null, parameters = null,
  status = "HOLD", result = null, hypothesisHash = null,
}) {
  return deepFreeze({
    kind: IDENTITY.HYPOTHESIS,
    id: hypothesisId,
    hypothesisId,
    originType,
    strategyRefs: [...strategyRefs],
    strategy,
    name,
    question,
    version,
    missions: [...missions],
    applicabilityStatus: missions.length ? "DECLARED" : "UNDECLARED",
    provenance: { ...provenance },
    aliases: [...aliases],
    legacy,
    parameters,
    status,
    result,
    hypothesisHash,
    semanticContract: SEMANTIC_VERSION,
  });
}

// H-S1-01 consumes the accepted HYP-1 name/question/version; it is NOT a
// redefinition of legacy DIP10, which stays provenance only.
export const H_S1_01 = hypothesisRecord({
  hypothesisId: HYP1_H_S1_01.hypothesisId,
  originType: ORIGIN_TYPE.STRATEGY_DERIVED,
  strategyRefs: ["S1"],
  strategy: "S1",
  name: HYP1_H_S1_01.name,
  question: HYP1_H_S1_01.question,
  version: HYP1_H_S1_01.version,
  missions: MISSIONS.map(({ id }) => id),
  provenance: {
    authority: HYP1_H_S1_01.provenance.authority,
    locator: HYP1_H_S1_01.provenance.locator,
    semantics: HYP1_H_S1_01.provenance.semantics,
  },
  aliases: ["DIP10", "ARM_A"],
  legacy: HYP1_H_S1_01.legacy,
  parameters: { tau: "CONFIGURABLE", N: "CONFIGURABLE", referenceMethod: "VERSIONED", favorabilityRule: "VERSIONED" },
  hypothesisHash: HYP1_H_S1_01.contentHash,
});

// H-RD-01 · Execution Hour: legacy HOUR research identity kept as Research
// Discovery, without inventing Strategy affiliation. Applicability is left
// undeclared because no source-bound mission scope exists for it.
export const H_RD_01 = hypothesisRecord({
  hypothesisId: "H-RD-01",
  originType: ORIGIN_TYPE.RESEARCH_DISCOVERY,
  strategyRefs: [],
  strategy: null,
  name: "Execution Hour",
  question: "Does the procurement execution hour improve the economic outcome versus CONTROL, as a research question not yet assignable to a canonical Strategy parent?",
  version: "H-RD-01/phase-A/v1",
  missions: [],
  provenance: {
    authority: "D-20260928T135440-85ac/task.md (owner naming convention, 2026-09-28)",
    locator: "/srv/hot-data/oficina-data/intake/energy-markets/D-20260928T135440-85ac/task.md",
    semantics: "docs/product/SEM-1_BACKTESTING_SEMANTICS.md",
  },
  aliases: ["HOUR", "ARM_B"],
});

export const HYPOTHESIS_BY_ID = Object.freeze({
  [H_S1_01.hypothesisId]: H_S1_01,
  [H_RD_01.hypothesisId]: H_RD_01,
});

// Legacy research names -> canonical hypothesis. A0/A1 remain SEM-1 replay-arm
// aliases (resolveLegacyAlias); ARM_A/ARM_B/DIP10/HOUR are bound here only as
// provenance to the canonical hypothesis, never as primary identity.
export const LEGACY_HYPOTHESIS_ALIASES = Object.freeze({
  DIP10: H_S1_01.hypothesisId,
  ARM_A: H_S1_01.hypothesisId,
  HOUR: H_RD_01.hypothesisId,
  ARM_B: H_RD_01.hypothesisId,
});

export const LEGACY_ALIAS_IDS = Object.freeze(["A0", "A1", "BASELINE", "ARM_A", "ARM_B", "ARM_C", "DIP10", "HOUR"]);

const source = Object.freeze({
  owner: "D-20260928T144645-8c72/task.md",
  spec: "docs/canonical/v1_1_1/PROCUREMENT_RESEARCH_CANONICAL_ENGINEERING_SPEC_v1_1_1.md",
});

export function missionById(id) {
  return MISSIONS.find((mission) => mission.id === id) ?? null;
}

export function clientFor(missionId, { campaignId = null, obligationId = null, behaviorEvidence = null } = {}) {
  const mission = missionById(missionId);
  if (!mission) return { ok: false, code: "UNKNOWN_MISSION" };
  if ((campaignId === null) !== (obligationId === null)) return { ok: false, code: "INCOMPLETE_CLIENT_SCOPE" };
  // The owner confirmed a current Gas Quarterly timing fact, not historical
  // executions or an identified current campaign. A scoped claim needs its own
  // matching evidence; campaign rules about strategy invocation do not suffice.
  const currentMandate = missionId === "GAS_QUARTERLY" && campaignId === null;
  const scopedEvidence = campaignId !== null && behaviorEvidence?.kind === "CLIENT_PURCHASE_TIME"
    && behaviorEvidence.missionId === missionId && behaviorEvidence.campaignId === campaignId
    && behaviorEvidence.obligationId === obligationId && /^([01]\d|2[0-3]):[0-5]\d$/.test(behaviorEvidence.purchaseTime ?? "")
    && behaviorEvidence.timezone === "Europe/Berlin"
    && typeof behaviorEvidence.provenance === "string" && behaviorEvidence.provenance.trim() !== "";
  const confirmed = currentMandate
    ? { purchaseTime: "11:00", timezone: "Europe/Berlin", provenance: source.owner, scope: "CURRENT_MANDATE_UNSCOPED" }
    : scopedEvidence
      ? { purchaseTime: behaviorEvidence.purchaseTime, timezone: "Europe/Berlin", provenance: behaviorEvidence.provenance, scope: "CAMPAIGN_EVIDENCE" }
      : {};
  return {
    ok: true,
    kind: IDENTITY.CLIENT,
    missionId,
    campaignId,
    obligationId,
    scopeStatus: campaignId === null ? "UNAVAILABLE" : "BOUND",
    confirmed,
    unknown: { ...(confirmed.purchaseTime ? {} : { purchaseTime: "UNKNOWN" }), sizing: "UNKNOWN", fillLogic: "UNKNOWN", executionModel: "UNKNOWN", fullCost: "UNKNOWN", policy: "UNKNOWN" },
    economics: null,
    version: SEMANTIC_VERSION,
  };
}

export function benchmarkFor(missionId, { campaignId = null, obligationId = null, status = "UNAVAILABLE", value = null, referenceVersion = null, provenance = null } = {}) {
  const mission = missionById(missionId);
  if (!mission) return { ok: false, code: "UNKNOWN_MISSION" };
  if ((campaignId === null) !== (obligationId === null)) return { ok: false, code: "INCOMPLETE_BENCHMARK_SCOPE" };
  if (!["UNAVAILABLE", "BENCHMARK_PROVISIONAL", "RECONCILED_OFFICIAL"].includes(status)) return { ok: false, code: "INVALID_REFERENCE_STATUS" };
  if (status !== "UNAVAILABLE" && (!campaignId || !obligationId || !referenceVersion || !provenance)) {
    return { ok: false, code: "UNBOUND_BENCHMARK_VALUE" };
  }
  if ((status === "UNAVAILABLE" && value !== null) || (status !== "UNAVAILABLE" && !Number.isFinite(value))) {
    return { ok: false, code: "UNBOUND_BENCHMARK_VALUE" };
  }
  return {
    ok: true,
    kind: IDENTITY.BENCHMARK,
    id: "BENCHMARK",
    missionId,
    campaignId,
    obligationId,
    scopeStatus: campaignId === null ? "UNAVAILABLE" : "BOUND",
    economicReference: "B",
    window: mission.benchmarkWindow,
    status,
    value,
    referenceVersion,
    provenance,
    decisionAuthority: "NONE",
    version: SEMANTIC_VERSION,
  };
}

export function controlFor({ hypothesisId, runId, populationId, campaignId, obligationId, calendarVersion, sizingVersion, executionVersion, benchmarkVersion, artifactSha256 } = {}) {
  const fields = { hypothesisId, runId, populationId, campaignId, obligationId, calendarVersion, sizingVersion, executionVersion, benchmarkVersion, artifactSha256 };
  if (Object.values(fields).some((value) => typeof value !== "string" || value.trim() === "")) return { ok: false, code: "CONTROL_BINDING_INCOMPLETE" };
  if (!/^[a-f0-9]{64}$/.test(artifactSha256)) return { ok: false, code: "CONTROL_BINDING_INCOMPLETE" };
  if (!HYPOTHESIS_ID_PATTERN.test(hypothesisId)) return { ok: false, code: "INVALID_HYPOTHESIS_ID" };
  return {
    ok: true, kind: IDENTITY.CONTROL, ...fields,
    timing: "CALENDAR_ONLY_PRICE_BLIND",
    calendar: "DETERMINISTIC_ELIGIBLE_OPPORTUNITIES",
    requestedQuantity: "remainingVolume / remainingScheduledOpportunities",
    productionFallbackAuthorized: false,
    version: SEMANTIC_VERSION,
  };
}

// Aliases are meaningful only for the exact old artifact and protocol. In
// particular A0@11:00/CLIENT does not prove the client's sizing or fills.
export function resolveLegacyAlias({ alias, artifactSha256, protocolVersion, mapping } = {}) {
  if (!LEGACY_ALIAS_IDS.includes(alias) || !/^[a-f0-9]{64}$/.test(artifactSha256 ?? "") || !protocolVersion || !mapping) {
    return { ok: false, code: "UNBOUND_LEGACY_ALIAS" };
  }
  if (mapping.alias !== alias || mapping.artifactSha256 !== artifactSha256 || mapping.protocolVersion !== protocolVersion
    || ![IDENTITY.CONTROL, IDENTITY.HYPOTHESIS].includes(mapping.kind)
    || (alias === "A0" && mapping.kind !== IDENTITY.CONTROL)
    || (alias === "A1" && mapping.kind !== IDENTITY.HYPOTHESIS)
    || (mapping.kind === IDENTITY.HYPOTHESIS && !HYPOTHESIS_ID_PATTERN.test(mapping.hypothesisId ?? ""))
    || (mapping.kind === IDENTITY.CONTROL && !mapping.hypothesisId)
    || !mapping.runId || !mapping.provenance) {
    return { ok: false, code: "UNBOUND_LEGACY_ALIAS" };
  }
  return { ok: true, kind: mapping.kind, hypothesisId: mapping.hypothesisId, runId: mapping.runId, alias, artifactSha256, protocolVersion, provenance: mapping.provenance };
}

export function compareAblation({ control, active, controlEconomics, activeEconomics } = {}) {
  if (control?.ok !== true || control.kind !== IDENTITY.CONTROL || active?.kind !== IDENTITY.HYPOTHESIS
    || active.id !== control.hypothesisId || !active.runId || active.runId !== control.runId) {
    return { ok: false, verdict: "HOLD", code: "PAIR_NOT_BOUND" };
  }
  const parity = ["populationId", "campaignId", "obligationId", "calendarVersion", "sizingVersion", "executionVersion", "benchmarkVersion"];
  if (parity.some((field) => !active[field] || active[field] !== control[field])) return { ok: false, verdict: "HOLD", code: "PAIR_NOT_COMPARABLE" };
  if (!/^[a-f0-9]{64}$/.test(control.artifactSha256) || !/^[a-f0-9]{64}$/.test(active.artifactSha256)) {
    return { ok: false, verdict: "HOLD", code: "PAIR_NOT_COMPARABLE" };
  }
  const c = controlEconomics;
  const a = activeEconomics;
  const boundEconomics = (e, arm) => e?.campaignId === arm.campaignId && e?.obligationId === arm.obligationId
    && e?.runId === arm.runId && e?.artifactSha256 === arm.artifactSha256
    && e?.benchmarkVersion === arm.benchmarkVersion && e?.unit === "EUR/MWh"
    && /^[a-f0-9]{64}$/.test(e?.benchmarkArtifactSha256 ?? "");
  if (!c || !a || c.status !== "VALID_RUN" || a.status !== "VALID_RUN" || c.benchmarkStatus !== "RECONCILED_OFFICIAL"
    || a.benchmarkStatus !== "RECONCILED_OFFICIAL" || c.costCompleteness !== "FULL" || a.costCompleteness !== "FULL"
    || !boundEconomics(c, control) || !boundEconomics(a, active)
    || c.benchmarkArtifactSha256 !== a.benchmarkArtifactSha256
    || !Number.isFinite(c.B) || !Number.isFinite(a.B) || c.B !== a.B
    || !Number.isFinite(c.H) || !Number.isFinite(a.H) || !Number.isFinite(c.V) || !Number.isFinite(a.V)
    || Math.abs((c.B - c.H) - c.V) > 1e-9 || Math.abs((a.B - a.H) - a.V) > 1e-9) {
    return { ok: false, verdict: "HOLD", code: "ECONOMIC_EVIDENCE_INSUFFICIENT" };
  }
  const deltaV = a.V - c.V;
  if (Math.abs(deltaV - (c.H - a.H)) > 1e-9) return { ok: false, verdict: "INVALID", code: "DELTA_V_INCONSISTENT" };
  return { ok: true, deltaV, equivalentCostDifference: c.H - a.H, verdict: "HOLD", reason: "ABSOLUTE_CRITERIA_NOT_EVALUATED", absolutePass: false };
}

// ---------------------------------------------------------------------------
// FIX-07 · canonical Hypothesis identity. Source: intake D-20260928T135440-85ac
// (owner naming convention) + operative revision 2026-09-28-pipeline-v2 + SEM-1.
// ---------------------------------------------------------------------------

// Deterministic, canonical ordering of Strategy refs (S1S3, never S3S1).
export function canonicalStrategyRefs(refs) {
  if (!Array.isArray(refs) || refs.length === 0) return { ok: false, code: "MISSING_STRATEGY_REFS" };
  if (refs.some((ref) => typeof ref !== "string" || !/^S[1-9]\d*$/.test(ref))) return { ok: false, code: "INVALID_STRATEGY_REF" };
  if (new Set(refs).size !== refs.length) return { ok: false, code: "DUPLICATE_STRATEGY_REF" };
  const ordered = [...refs].sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)) || a.localeCompare(b));
  return { ok: true, refs: ordered };
}

// The ID is a pure function of origin family, canonical Strategy refs and the
// sequential suffix. It never encodes mission, phase, campaign or performance.
export function canonicalHypothesisId({ originType, strategyRefs = [], sequence } = {}) {
  if (!Number.isInteger(sequence) || sequence < 1 || sequence > 99) return { ok: false, code: "INVALID_SEQUENCE" };
  const nn = String(sequence).padStart(2, "0");
  if (originType === ORIGIN_TYPE.RESEARCH_DISCOVERY) {
    if (strategyRefs.length !== 0) return { ok: false, code: "RD_WITH_STRATEGY_PARENT" };
    return { ok: true, id: `H-RD-${nn}` };
  }
  if (![ORIGIN_TYPE.STRATEGY_DERIVED, ORIGIN_TYPE.MULTI_STRATEGY].includes(originType)) {
    return { ok: false, code: "INVALID_ORIGIN_TYPE" };
  }
  const refsOutcome = canonicalStrategyRefs(strategyRefs);
  if (!refsOutcome.ok) return refsOutcome;
  if (originType === ORIGIN_TYPE.STRATEGY_DERIVED && refsOutcome.refs.length !== 1) {
    return { ok: false, code: "STRATEGY_DERIVED_NEEDS_ONE_REF" };
  }
  if (originType === ORIGIN_TYPE.MULTI_STRATEGY && refsOutcome.refs.length < 2) {
    return { ok: false, code: "MULTI_STRATEGY_NEEDS_MULTIPLE_REFS" };
  }
  return { ok: true, id: `H-${refsOutcome.refs.join("")}-${nn}` };
}

export function verifyCanonicalHypothesisId(hypothesis) {
  const id = hypothesis?.hypothesisId;
  if (typeof id !== "string" || !HYPOTHESIS_ID_PATTERN.test(id)) return { ok: false, code: "INVALID_HYPOTHESIS_ID" };
  const refsOutcome = hypothesis.originType === ORIGIN_TYPE.RESEARCH_DISCOVERY
    ? { ok: true, refs: [] }
    : canonicalStrategyRefs(hypothesis.strategyRefs);
  if (!refsOutcome.ok) return refsOutcome;
  const expected = canonicalHypothesisId({ originType: hypothesis.originType, strategyRefs: refsOutcome.refs, sequence: Number(id.slice(-2)) });
  if (!expected.ok) return expected;
  if (expected.id !== id) return { ok: false, code: "NON_CANONICAL_HYPOTHESIS_ID", expected: expected.id };
  return { ok: true, id };
}

export function isCanonicalHypothesisRecord(hypothesis) {
  if (hypothesis?.kind !== IDENTITY.HYPOTHESIS) return { ok: false, code: "NOT_CANONICAL_HYPOTHESIS" };
  if (!isNonEmptyString(hypothesis.name) || !isNonEmptyString(hypothesis.question)) return { ok: false, code: "MISSING_HYPOTHESIS_QUESTION" };
  if (!Object.values(ORIGIN_TYPE).includes(hypothesis.originType)) return { ok: false, code: "INVALID_ORIGIN_TYPE" };
  if (!Array.isArray(hypothesis.strategyRefs)) return { ok: false, code: "INVALID_STRATEGY_REFS" };
  if (hypothesis.originType === ORIGIN_TYPE.RESEARCH_DISCOVERY && hypothesis.strategyRefs.length > 0) return { ok: false, code: "FAKE_STRATEGY_PARENT" };
  if (hypothesis.originType !== ORIGIN_TYPE.RESEARCH_DISCOVERY && canonicalStrategyRefs(hypothesis.strategyRefs).ok === false) return { ok: false, code: "INVALID_STRATEGY_REFS" };
  if (!Array.isArray(hypothesis.missions) || hypothesis.missions.some((mission) => !missionById(mission))) return { ok: false, code: "INVALID_MISSION_SCOPE" };
  if (!isNonEmptyString(hypothesis.provenance?.authority) || !isNonEmptyString(hypothesis.provenance?.locator)) return { ok: false, code: "MISSING_HYPOTHESIS_PROVENANCE" };
  return verifyCanonicalHypothesisId(hypothesis);
}

// Build/validate a canonical hypothesis identity. Missing, conflicting or non-
// deterministic fields are rejected fail-closed; no partial identity is minted.
export function createHypothesisIdentity({
  hypothesisId = undefined, originType, strategyRefs = [], sequence, name, question, version, missions, provenance, aliases = [],
} = {}) {
  const errors = [];
  const refsOutcome = originType === ORIGIN_TYPE.RESEARCH_DISCOVERY
    ? (strategyRefs.length === 0 ? { ok: true, refs: [] } : { ok: false, code: "RD_WITH_STRATEGY_PARENT" })
    : canonicalStrategyRefs(strategyRefs);
  if (!refsOutcome.ok) errors.push({ field: "strategyRefs", code: refsOutcome.code, message: "strategyRefs no es válido para el tipo de origen." });
  const idOutcome = refsOutcome.ok
    ? canonicalHypothesisId({ originType, strategyRefs: refsOutcome.refs, sequence })
    : { ok: false, code: "UNRESOLVED_HYPOTHESIS_ID" };
  if (!idOutcome.ok) {
    errors.push({ field: "hypothesisId", code: idOutcome.code, message: "No puede derivarse un hypothesisId determinista." });
  } else if (hypothesisId !== undefined && hypothesisId !== idOutcome.id) {
    errors.push({ field: "hypothesisId", code: "NON_CANONICAL_HYPOTHESIS_ID", message: `hypothesisId "${hypothesisId}" no coincide con el canónico "${idOutcome.id}".` });
  } else {
    // A published ID is not recycled: the accepted HYP-1 identity (name and
    // falsifiable question) cannot be redefined under the same ID. A version
    // advance that keeps the question is still allowed (recalibration).
    const published = HYPOTHESIS_BY_ID[idOutcome.id];
    if (published && (published.name !== name || published.question !== question)) {
      errors.push({ field: "hypothesisId", code: "PUBLISHED_IDENTITY_COLLISION", message: `El ID publicado "${idOutcome.id}" no puede redefinirse con otro nombre o pregunta.` });
    }
    // The accepted HYP-1 applicability is part of the published identity: a
    // recalibration advances the version, it cannot silently narrow the four
    // accepted missions to a subset (FIX07-PUBLISHED-SCOPE).
    if (published && Array.isArray(missions)) {
      const publishedScope = [...published.missions].sort().join(",");
      const declaredScope = [...new Set(missions)].sort().join(",");
      if (publishedScope !== declaredScope) {
        errors.push({ field: "missions", code: "PUBLISHED_SCOPE_COLLISION", message: `El ID publicado "${idOutcome.id}" conserva su alcance aceptado de misiones.` });
      }
    }
  }
  if (!isNonEmptyString(name)) errors.push({ field: "name", code: "MISSING_REQUIRED", message: "Falta el nombre canónico de la hipótesis." });
  if (!isNonEmptyString(question)) errors.push({ field: "question", code: "MISSING_REQUIRED", message: "Falta la pregunta falsable de la hipótesis." });
  if (!isNonEmptyString(version)) errors.push({ field: "version", code: "MISSING_VERSION", message: "Falta la versión de la proposición/configuración." });
  if (!Array.isArray(missions) || missions.some((mission) => !missionById(mission)) || new Set(missions).size !== missions.length) {
    errors.push({ field: "missions", code: "INVALID_MISSION_SCOPE", message: "missions debe ser un subconjunto sin duplicados de las misiones canónicas." });
  }
  if (!provenance || typeof provenance !== "object" || !isNonEmptyString(provenance.authority) || !isNonEmptyString(provenance.locator)) {
    errors.push({ field: "provenance", code: "MISSING_REQUIRED", message: "Falta provenance con authority/locator." });
  }
  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    identity: hypothesisRecord({
      hypothesisId: idOutcome.id, originType, strategyRefs: refsOutcome.refs, name, question, version,
      missions, provenance, aliases,
    }),
  };
}

// Mission-specific configuration. The same H-S1-01 ID supports four independent
// configurations: mission is bound here, never encoded in the ID. The candidate
// and search-space references are mission-scoped, so a Power configuration can
// never borrow a Gas candidate (FIX07-MISSION-CONFIG).
export function createMissionConfiguration({ hypothesis, missionId, configuration, searchSpace = null, candidate = null } = {}) {
  if (!isCanonicalHypothesisRecord(hypothesis).ok) return { ok: false, code: "NOT_CANONICAL_HYPOTHESIS" };
  if (typeof missionId !== "string" || !hypothesis.missions.includes(missionId)) return { ok: false, code: "MISSION_NOT_APPLICABLE" };
  if (!configuration || typeof configuration !== "object" || Array.isArray(configuration) || Object.keys(configuration).length === 0) {
    return { ok: false, code: "MISSING_CONFIGURATION" };
  }
  if (!isNonEmptyString(configuration.dataMode)) return { ok: false, code: "MISSING_DATA_MODE" };
  const missionLabel = MISSION_LABELS[missionId];
  for (const [field, value] of [["candidateMission", configuration.candidateMission], ["searchSpaceMission", configuration.searchSpaceMission]]) {
    if (value !== undefined && value !== missionLabel) return { ok: false, code: "CROSS_MISSION_CONFIGURATION", field };
  }
  if (!searchSpace || searchSpace.artifactKind !== "HYPOTHESIS_SEARCH_SPACE" || searchSpace.mission !== missionLabel
    || searchSpace.hypothesisId !== hypothesis.hypothesisId || !isSha256(searchSpace.contentHash)) {
    return { ok: false, code: "CROSS_MISSION_CONFIGURATION", field: "searchSpace" };
  }
  if (!candidate || candidate.artifactKind !== "HYPOTHESIS_CANDIDATE" || candidate.mission !== missionLabel
    || candidate.hypothesisId !== hypothesis.hypothesisId || candidate.searchSpaceHash !== searchSpace.contentHash
    || !isSha256(candidate.contentHash)) {
    return { ok: false, code: "CROSS_MISSION_CONFIGURATION", field: "candidate" };
  }
  // The configuration declares tau/N, but the candidate is the source of truth:
  // a configuration may not restate parameters other than the bound candidate's
  // (FIX07-PARAMETER-CANDIDATE).
  for (const [field, declared, bound] of [["tau", configuration.tau, candidate.tau?.localTime], ["N", configuration.N, candidate.N]]) {
    if (declared !== undefined && declared !== bound) {
      return { ok: false, code: "PARAMETER_CANDIDATE_MISMATCH", field };
    }
  }
  const core = {
    ...configuration,
    artifactKind: "HYPOTHESIS_MISSION_CONFIGURATION",
    hypothesisId: hypothesis.hypothesisId,
    hypothesisVersion: hypothesis.version,
    missionId,
    candidateMission: missionLabel,
    searchSpaceMission: missionLabel,
    candidateHash: candidate.contentHash,
    searchSpaceHash: searchSpace.contentHash,
    candidateTau: candidate.tau?.localTime ?? null,
    candidateN: candidate.N ?? null,
  };
  return { ok: true, configuration: deepFreeze({ ...core, configurationHash: contentHashOf(core) }) };
}

function evidenceProvenanceBound(evidence) {
  const provenance = evidence?.provenance;
  return Boolean(provenance) && typeof provenance === "object"
    && isNonEmptyString(provenance.authority) && isNonEmptyString(provenance.locator)
    && provenance.artifactSha256 === evidence.artifactSha256;
}

// Status is untested without evidence. Version/config/run/mission mismatches
// cannot yield tested or runnable status; they stay HOLD. Evidence cannot prove
// itself: the referenced run needs a verified experiment binding and traceable
// provenance (FIX07-EVIDENCE-RUN).
export function evaluateHypothesisStatus({ hypothesis, configuration, evidence, experiment = null } = {}) {
  if (!isCanonicalHypothesisRecord(hypothesis).ok) return { ok: false, code: "NOT_CANONICAL_HYPOTHESIS" };
  if (!configuration || configuration.artifactKind !== "HYPOTHESIS_MISSION_CONFIGURATION"
    || configuration.hypothesisId !== hypothesis.hypothesisId || configuration.hypothesisVersion !== hypothesis.version
    || !hypothesis.missions.includes(configuration.missionId)) return { ok: false, code: "INVALID_CONFIGURATION_BINDING" };
  const { configurationHash, ...core } = configuration;
  if (!isSha256(configurationHash) || contentHashOf(core) !== configurationHash) return { ok: false, code: "CONFIGURATION_INTEGRITY" };
  if (evidence === null || evidence === undefined) return { ok: true, state: "UNTESTED", reason: "NO_EVIDENCE" };
  const mismatched = [];
  if (evidence.hypothesisId !== hypothesis.hypothesisId) mismatched.push("hypothesisId");
  if (evidence.hypothesisVersion !== hypothesis.version) mismatched.push("hypothesisVersion");
  if (evidence.missionId !== configuration.missionId) mismatched.push("missionId");
  if (evidence.configurationHash !== configuration.configurationHash) mismatched.push("configurationHash");
  if (!isNonEmptyString(evidence.runId)) mismatched.push("runId");
  if (!isSha256(evidence.artifactSha256)) mismatched.push("artifactSha256");
  if (!isNonEmptyString(evidence.experimentId)) mismatched.push("experimentId");
  if (!evidenceProvenanceBound(evidence)) mismatched.push("provenance");
  const binding = experiment?.ok === true ? experiment.binding : null;
  if (!binding || binding.experimentId !== evidence.experimentId || binding.runId !== evidence.runId
    || binding.hypothesisId !== hypothesis.hypothesisId || binding.missionId !== configuration.missionId
    || binding.configurationHash !== configuration.configurationHash) {
    mismatched.push("experiment");
  }
  // The paired CONTROL must belong to the same campaign as the experiment
  // binding; a run proven against another campaign's CONTROL is not evidence
  // for this one (FIX07-CONTROL-CAMPAIGN).
  if (binding?.control && binding.control.campaignId !== undefined && binding.control.campaignId !== binding.campaignId) {
    mismatched.push("control");
  }
  if (mismatched.length) return { ok: true, state: "HOLD", reason: "EVIDENCE_BINDING_MISMATCH", mismatched };
  if (evidence.comparabilityStatus !== "COMPARABLE") return { ok: true, state: "HOLD", reason: "EVIDENCE_NOT_COMPARABLE" };
  return { ok: true, state: "TESTED", runId: evidence.runId, artifactSha256: evidence.artifactSha256 };
}

// Recalibration keeps the ID and advances the version; a materially different
// question/strategy reaches a new ID. Neither mutates lineage silently.
function versionOrdinal(version) {
  const match = /\/v(\d+)$/i.exec(typeof version === "string" ? version : "");
  return match ? Number(match[1]) : null;
}

export function classifyHypothesisChange({ prior, next } = {}) {
  if (!isCanonicalHypothesisRecord(prior).ok || !isCanonicalHypothesisRecord(next).ok) return { ok: false, code: "NOT_CANONICAL_HYPOTHESIS" };
  const sameQuestion = prior.question === next.question;
  const sameRefs = prior.strategyRefs.join(",") === next.strategyRefs.join(",");
  const sameOrigin = prior.originType === next.originType;
  if (prior.hypothesisId === next.hypothesisId) {
    if (!sameQuestion || !sameRefs || !sameOrigin) return { ok: false, code: "MATERIAL_CHANGE_NEEDS_NEW_ID" };
    // A recalibration must advance the version; an unchanged or earlier
    // proposition is not a new version (FIX07-VERSION-ADVANCE/BACKWARD-VERSION).
    const priorOrdinal = versionOrdinal(prior.version);
    const nextOrdinal = versionOrdinal(next.version);
    if (prior.version === next.version || priorOrdinal === null || nextOrdinal === null) {
      return { ok: false, code: "NO_VERSION_ADVANCE" };
    }
    if (nextOrdinal < priorOrdinal) return { ok: false, code: "VERSION_ROLLBACK" };
    return {
      ok: true, kind: "RECALIBRATION", hypothesisId: prior.hypothesisId,
      supersedes: { hypothesisId: prior.hypothesisId, version: prior.version },
      canonical: { hypothesisId: next.hypothesisId, version: next.version },
    };
  }
  if (sameQuestion) return { ok: false, code: "RECALIBRATION_MUST_KEEP_ID" };
  return {
    ok: true, kind: "NEW_PROPOSITION",
    supersedes: { hypothesisId: prior.hypothesisId, version: prior.version },
    canonical: { hypothesisId: next.hypothesisId, version: next.version },
  };
}

// DIP10/HOUR/ARM_A/ARM_B resolve to a canonical hypothesis only as provenance.
// Wrong artifact/version, a CLIENT claim or a fabricated evidence status is
// rejected; the result can never be tested/runnable and never transfers sizing.
export function resolveLegacyHypothesisAlias({ alias, artifactSha256, protocolVersion, mapping } = {}) {
  const targetId = LEGACY_HYPOTHESIS_ALIASES[alias];
  if (targetId === undefined) return { ok: false, code: "UNKNOWN_LEGACY_ALIAS" };
  if (!isSha256(artifactSha256) || !isNonEmptyString(protocolVersion) || !mapping || typeof mapping !== "object") {
    return { ok: false, code: "UNBOUND_LEGACY_ALIAS" };
  }
  const hypothesis = HYPOTHESIS_BY_ID[targetId];
  // SEM-1 requires a run-scoped provenance mapping: a bare alias with a hash is
  // not provenance and cannot resolve (FIX07-LEGACY-PROVENANCE).
  if (mapping.alias !== alias || mapping.artifactSha256 !== artifactSha256
    || mapping.protocolVersion !== protocolVersion || mapping.hypothesisId !== targetId
    || !isNonEmptyString(mapping.runId) || mapping.provenance === undefined || mapping.provenance === null) {
    return { ok: false, code: "UNBOUND_LEGACY_ALIAS" };
  }
  if (mapping.kind === IDENTITY.CLIENT || mapping.identity === IDENTITY.CLIENT) return { ok: false, code: "LEGACY_ALIAS_CANNOT_BE_CLIENT" };
  if (mapping.evidenceStatus !== undefined && mapping.evidenceStatus !== "PROVENANCE_ONLY") {
    return { ok: false, code: "LEGACY_ALIAS_CANNOT_FABRICATE_EVIDENCE" };
  }
  return {
    ok: true, kind: "LEGACY_HYPOTHESIS_PROVENANCE", alias, artifactSha256, protocolVersion,
    hypothesisId: targetId, hypothesisName: hypothesis.name, hypothesisVersion: hypothesis.version,
    evidenceStatus: "PROVENANCE_ONLY", tested: false, runnable: false, sizingParityClaim: false,
    runId: mapping.runId, provenance: mapping.provenance,
  };
}

// Single backend binding for BT-08/UI-08: keeps Strategy, Hypothesis, CONTROL,
// technical arm, configuration, experiment, mission/campaign and Run as distinct
// entities. Campaign, candidate and search-space references are bound, and an
// altered configurationHash is rejected (FIX07-EXPERIMENT-BINDING).
export function createExperimentBinding({ hypothesis, configuration, experimentId, control, technicalArmId, runId, campaignId } = {}) {
  if (!isCanonicalHypothesisRecord(hypothesis).ok) return { ok: false, code: "NOT_CANONICAL_HYPOTHESIS" };
  if (!configuration || configuration.artifactKind !== "HYPOTHESIS_MISSION_CONFIGURATION"
    || configuration.hypothesisId !== hypothesis.hypothesisId || configuration.hypothesisVersion !== hypothesis.version
    || !hypothesis.missions.includes(configuration.missionId)) {
    return { ok: false, code: "INVALID_CONFIGURATION_BINDING" };
  }
  const { configurationHash, ...configurationCore } = configuration;
  if (!isSha256(configurationHash) || contentHashOf(configurationCore) !== configurationHash) {
    return { ok: false, code: "CONFIGURATION_INTEGRITY" };
  }
  if (!isNonEmptyString(campaignId)) return { ok: false, code: "MISSING_CAMPAIGN_ID" };
  const missionLabel = MISSION_LABELS[configuration.missionId];
  if (!isSha256(configuration.candidateHash) || !isSha256(configuration.searchSpaceHash)
    || configuration.candidateMission !== missionLabel || configuration.searchSpaceMission !== missionLabel) {
    return { ok: false, code: "MISSING_CANDIDATE_BINDING" };
  }
  // Declared tau/N must stay consistent with the bound candidate values
  // captured by the configuration (FIX07-PARAMETER-CANDIDATE).
  if ((configuration.tau !== undefined && configuration.tau !== configuration.candidateTau)
    || (configuration.N !== undefined && configuration.N !== configuration.candidateN)) {
    return { ok: false, code: "PARAMETER_CANDIDATE_MISMATCH" };
  }
  if (!isNonEmptyString(experimentId)) return { ok: false, code: "MISSING_EXPERIMENT_ID" };
  if (!isNonEmptyString(runId)) return { ok: false, code: "MISSING_RUN_ID" };
  if (!isNonEmptyString(technicalArmId)) return { ok: false, code: "MISSING_TECHNICAL_ARM_ID" };
  if ([hypothesis.hypothesisId, experimentId, runId].includes(technicalArmId)) return { ok: false, code: "IDENTITY_COLLISION" };
  if (hypothesis.hypothesisId === runId || experimentId === runId) return { ok: false, code: "IDENTITY_COLLISION" };
  if (control !== undefined && control !== null) {
    const missionMismatch = control.missionId !== undefined && control.missionId !== configuration.missionId;
    const campaignMismatch = control.campaignId !== undefined && control.campaignId !== campaignId;
    if (control.ok !== true || control.kind !== IDENTITY.CONTROL || control.hypothesisId !== hypothesis.hypothesisId
      || !isSha256(control.artifactSha256) || control.runId !== runId || missionMismatch || campaignMismatch) {
      return { ok: false, code: "INVALID_CONTROL_BINDING" };
    }
  }
  return {
    ok: true,
    binding: deepFreeze({
      artifactKind: "HYPOTHESIS_EXPERIMENT_BINDING",
      hypothesisId: hypothesis.hypothesisId, hypothesisName: hypothesis.name, hypothesisVersion: hypothesis.version,
      originType: hypothesis.originType, strategyRefs: [...hypothesis.strategyRefs],
      missionId: configuration.missionId, campaignId, configurationHash: configuration.configurationHash,
      candidateMission: configuration.candidateMission, searchSpaceMission: configuration.searchSpaceMission,
      candidateHash: configuration.candidateHash, searchSpaceHash: configuration.searchSpaceHash,
      experimentId, runId, technicalArmId, control: control ?? null, semanticContract: SEMANTIC_VERSION,
    }),
  };
}
