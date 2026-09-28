// SEM-1 · Owner decision 2026-09-28. Product identities are separate from
// historical replay arm IDs. The latter require a run-scoped provenance mapping.
export const SEMANTIC_VERSION = "SEM-1/2026-09-28/v1";
export const IDENTITY = Object.freeze({ CLIENT: "CLIENT", BENCHMARK: "BENCHMARK", HYPOTHESIS: "HYPOTHESIS", CONTROL: "CONTROL" });
export const MISSIONS = Object.freeze([
  Object.freeze({ id: "GAS_QUARTERLY", product: "GAS", cadence: "QUARTERLY", benchmarkWindow: "3-1-3" }),
  Object.freeze({ id: "GAS_MONTHLY", product: "GAS", cadence: "MONTHLY", benchmarkWindow: "1-0-1" }),
  Object.freeze({ id: "POWER_QUARTERLY", product: "POWER", cadence: "QUARTERLY", benchmarkWindow: "3-1-3" }),
  Object.freeze({ id: "POWER_MONTHLY", product: "POWER", cadence: "MONTHLY", benchmarkWindow: "1-0-1" }),
]);
export const H_S1_01 = Object.freeze({
  kind: IDENTITY.HYPOTHESIS,
  id: "H-S1-01",
  strategy: "S1",
  name: "Session-Anchored Rolling Reference",
  question: "Does a causal relative-price-location signal against a rolling session-anchored reference improve procurement versus CONTROL with identical sizing and execution?",
  parameters: Object.freeze({ tau: "CONFIGURABLE", N: "CONFIGURABLE", referenceMethod: "VERSIONED", favorabilityRule: "VERSIONED" }),
  status: "HOLD",
  result: null,
  version: SEMANTIC_VERSION,
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
  if (!/^H-(?:S\d+(?:S\d+)*|RD)-\d{2}$/.test(hypothesisId)) return { ok: false, code: "INVALID_HYPOTHESIS_ID" };
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
    || (mapping.kind === IDENTITY.HYPOTHESIS && !/^H-(?:S\d+(?:S\d+)*|RD)-\d{2}$/.test(mapping.hypothesisId ?? ""))
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
