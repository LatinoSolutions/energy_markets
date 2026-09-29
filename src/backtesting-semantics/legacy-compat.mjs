// SEM-2 · source/version-scoped compatibility adapter for historical exploratory
// artifacts (intake D-20260928T181604-148d, operative revision 20260928-english-v2).
//
// The historical producers (operations/exploratory/v*/run-exploratory-backtest.mjs)
// are immutable: they keep emitting BASELINE / ARM_A / ARM_B / DIP10 / HOUR and the
// "client practice" wording. This adapter does NOT rewrite their bytes. It reads a
// verified artifact plus its provenance hash and returns historical lineage only.
//
// Rules enforced here (SEM-1, FIX-07, audit CS-01/CS-02):
//   - nothing is resolved without the artifact sha256 and a protocol version;
//   - BASELINE/A0 is a historical calendar comparator, never CLIENT or CONTROL;
//   - DIP10/ARM_A and HOUR/ARM_B have source-bound lineage only,
//     never as a tested/runnable result and never carrying sizing parity;
//   - an unknown or ambiguous id stays explicitly unresolved (fail-closed).
import { createHash } from "node:crypto";

import {
  resolveLegacyAlias,
  resolveLegacyHypothesisAlias,
} from "./contract.mjs";

// The only protocol this adapter is allowed to classify. A different version string
// is rejected, so the mapping stays scoped to the exact artifact protocol.
export const LEGACY_EXPLORATORY_PROTOCOL = "EXPLORATORY_OWNER_PATCH_02/v1";

// The only legacy exploratory releases this adapter is allowed to classify.
// Source: src/ui/canonical-inputs.mjs loads exactly these verified releases
// (GAS_EXPLORATORY_RELEASE.release = "v2", POWER_EXPLORATORY_RELEASE.release
// = "v3"); any other release string is unverified history and stays unresolved
// (SEM-2 T02: a release is matched, never accepted by format).
export const LEGACY_EXPLORATORY_RELEASES = Object.freeze(["v2", "v3"]);

const sha256Pattern = /^[a-f0-9]{64}$/;

// Explicit classification of the legacy exploratory arm identifiers. This table does
// not claim CLIENT or active CONTROL. Candidate links are provenance only.
const LEGACY_ARM_TABLE = Object.freeze([
  Object.freeze({ legacyId: "BASELINE", rule: "CALENDAR_COMPARATOR", alias: "A0" }),
  Object.freeze({ legacyId: "ARM_A", rule: "HYPOTHESIS_ALIAS", alias: "ARM_A" }),
  Object.freeze({ legacyId: "ARM_B", rule: "HYPOTHESIS_ALIAS", alias: "ARM_B" }),
]);

// Research candidate ids in the historical artifact map to the same role table.
const LEGACY_CANDIDATE_TABLE = Object.freeze({
  A0: "BASELINE",
  DIP10: "ARM_A",
  HOUR: "ARM_B",
});

function unresolved(legacyId, code) {
  return Object.freeze({
    legacyId,
    resolved: false,
    code,
    historicalKind: null,
    lineageOf: null,
    tested: false,
    runnable: false,
    sizingParityClaim: false,
  });
}

function provenanceScope(provenance) {
  if (provenance === null || typeof provenance !== "object") {
    return { ok: false, code: "LEGACY_PROVENANCE_MISSING" };
  }
  const { resultsSha256, resultsPath, release } = provenance;
  if (!sha256Pattern.test(resultsSha256 ?? "")) {
    return { ok: false, code: "LEGACY_ARTIFACT_HASH_INVALID" };
  }
  if (typeof resultsPath !== "string" || resultsPath.trim() === "") {
    return { ok: false, code: "LEGACY_ARTIFACT_LOCATOR_MISSING" };
  }
  if (typeof release !== "string" || release.trim() === "") {
    return { ok: false, code: "LEGACY_RELEASE_MISSING" };
  }
  // SEM-2 T02: the release must be one of the verified legacy exploratory
  // releases. An unknown release does not resolve roles by having a format.
  if (!LEGACY_EXPLORATORY_RELEASES.includes(release)) {
    return { ok: false, code: "LEGACY_RELEASE_UNKNOWN" };
  }
  if (resultsPath !== `operations/exploratory/${release}/backtest-results.json`) {
    return { ok: false, code: "LEGACY_RELEASE_PATH_MISMATCH" };
  }
  return { ok: true, resultsSha256, resultsPath, release };
}

// Classify one verified historical arm. Never mint a canonical identity.
function resolveArm(legacyId, scope) {
  const entry = LEGACY_ARM_TABLE.find((candidate) => candidate.legacyId === legacyId);
  if (entry === undefined) {
    return unresolved(legacyId, "UNKNOWN_LEGACY_ARM");
  }
  // The run id and provenance are the artifact scope itself: the mapping is only
  // valid for this exact artifact content, not for the arm name in the abstract.
  const runId = `LEGACY_EXPLORATORY/${scope.release}/${scope.resultsSha256.slice(0, 12)}`;
  const mapping = {
    alias: entry.alias,
    artifactSha256: scope.resultsSha256,
    protocolVersion: LEGACY_EXPLORATORY_PROTOCOL,
    runId,
    provenance: scope.resultsPath,
  };
  if (entry.rule === "CALENDAR_COMPARATOR") {
    const resolved = resolveLegacyAlias({
      alias: entry.alias,
      artifactSha256: scope.resultsSha256,
      protocolVersion: LEGACY_EXPLORATORY_PROTOCOL,
      mapping,
    });
    if (!resolved.ok) {
      return unresolved(legacyId, resolved.code);
    }
    return Object.freeze({
      legacyId,
      resolved: true,
      code: null,
      historicalKind: "CALENDAR_COMPARATOR",
      lineageOf: null,
      alias: entry.alias,
      runId: resolved.runId,
      // A historical calendar comparator is NOT the active CONTROL protocol: the
      // equivalence would need the source-bound mapping and is never claimed here.
      activeProtocolEquivalent: false,
      productionFallbackAuthorized: false,
      tested: false,
      current: false,
      runnable: false,
      sizingParityClaim: false,
      clientEquivalent: false,
      provenance: scope.resultsPath,
    });
  }
  const resolved = resolveLegacyHypothesisAlias({
    alias: entry.alias,
    artifactSha256: scope.resultsSha256,
    protocolVersion: LEGACY_EXPLORATORY_PROTOCOL,
    mapping: { ...mapping, hypothesisId: entry.alias === "ARM_A" ? "H-S1-01" : "H-RD-01" },
  });
  if (!resolved.ok) {
    return unresolved(legacyId, resolved.code);
  }
  return Object.freeze({
    legacyId,
    resolved: true,
    code: null,
    historicalKind: "EXPLORATORY_CANDIDATE",
    alias: entry.alias,
    lineageOf: resolved.lineageOf,
    lineageName: resolved.lineageName,
    lineageVersion: resolved.lineageVersion,
    runId: resolved.runId,
    evidenceStatus: resolved.evidenceStatus,
    tested: resolved.tested,
    current: false,
    runnable: resolved.runnable,
    sizingParityClaim: resolved.sizingParityClaim,
    activeControlEquivalent: false,
    clientEquivalent: false,
    provenance: scope.resultsPath,
  });
}

// Public entry point: classify a verified exploratory artifact. The result is a
// frozen, source-scoped mapping. The `artifact` argument is the raw bytes of the
// results file the provenance refers to: the adapter re-hashes them and rejects
// any mismatch, so a syntactically valid sha256 that does not match the bytes
// resolves nothing (SEM-2 T02). Without valid provenance or unverified bytes
// every entry stays unresolved instead of guessing a semantic role.
export function adaptLegacyExploratoryArtifact({ provenance = null, artifact = null } = {}) {
  const scope = provenanceScope(provenance);
  if (!scope.ok) {
    return failureAdapter(scope.code);
  }
  // The declared hash is only a claim until it is checked against the artifact
  // bytes themselves (SEM-2 T02: compat is bound to the verified source).
  if (typeof artifact !== "string" && !Buffer.isBuffer(artifact)) {
    return failureAdapter("LEGACY_ARTIFACT_BYTES_MISSING");
  }
  const artifactSha256 = createHash("sha256").update(artifact).digest("hex");
  if (artifactSha256 !== scope.resultsSha256) {
    return failureAdapter("LEGACY_ARTIFACT_HASH_MISMATCH");
  }
  let parsed;
  try {
    parsed = JSON.parse(artifact.toString());
  } catch {
    return failureAdapter("LEGACY_ARTIFACT_SCHEMA_INVALID");
  }
  const candidates = parsed?.research?.candidates;
  const declared = [["A0", "BASELINE"], ["DIP10", "ARM_A"], ["HOUR", "ARM_B"]];
  if (parsed?.artifactKind !== "EXPLORATORY_BACKTEST_RESULTS" || parsed?.status !== "EXPLORATORY"
    || !Array.isArray(candidates) || declared.some(([id, armId]) => candidates.filter((candidate) => candidate?.id === id && candidate?.armId === armId).length !== 1)
    || !Array.isArray(parsed.results) || parsed.results.length === 0
    || parsed.results.some((result) => !result?.arms || typeof result.arms !== "object" || Array.isArray(result.arms))) {
    return failureAdapter("LEGACY_ARTIFACT_SCHEMA_INVALID");
  }
  // These are unmodified keys in verified historical bytes. In particular a
  // /CLIENT suffix remains a source key, never a canonical client assertion.
  const rawSourceKeys = Object.freeze([...new Set(parsed.results.flatMap((result) => Object.keys(result.arms)))].sort());
  const roles = Object.freeze(Object.fromEntries(
    LEGACY_ARM_TABLE.map((entry) => [entry.legacyId, resolveArm(entry.legacyId, scope)]),
  ));
  const candidateRoles = Object.freeze(Object.fromEntries(
    Object.entries(LEGACY_CANDIDATE_TABLE).map(([candidateId, armId]) => [candidateId, roles[armId]]),
  ));
  return Object.freeze({
    ok: true,
    code: null,
    protocolVersion: LEGACY_EXPLORATORY_PROTOCOL,
    artifactSha256: scope.resultsSha256,
    artifactPath: scope.resultsPath,
    release: scope.release,
    rawSourceKeys,
    roles,
    candidates: candidateRoles,
  });
}

function failureAdapter(code) {
  return Object.freeze({
    ok: false,
    code,
    protocolVersion: LEGACY_EXPLORATORY_PROTOCOL,
    artifactSha256: null,
    roles: Object.freeze({}),
    candidates: Object.freeze({}),
  });
}

export function legacyRoleOf(adapter, legacyId) {
  if (adapter?.ok !== true) {
    return unresolved(legacyId, adapter?.code ?? "LEGACY_ADAPTER_UNAVAILABLE");
  }
  return adapter.roles?.[legacyId] ?? unresolved(legacyId, "UNKNOWN_LEGACY_ARM");
}

// UI-10 (intake D-20260929T103404-2ec5, PLAN_UI §1 and §4.A.1-2): visible names
// of the historical exploratory runs. The immutable artifacts keep emitting
// BASELINE / ARM_A / ARM_B; these are the product names shown instead, with the
// technical alias kept as a secondary provenance line. BASELINE is the
// historical calendar comparator (A0), never "Baseline" nor CLIENT; the two
// candidate arms are legacy lineage of their canonical hypothesis, never its
// result (FIX-07 ID05/ID06, SEM-2 SEM2-04/SEM2-06).
export const LEGACY_RUN_NAMES = Object.freeze({
  BASELINE: "Calendar comparator (A0)",
  ARM_A: "DIP10 11:00",
  ARM_B: "Out-of-episode hour",
});

// Whole historical labels that are replaced as a unit (PLAN_UI §1: gate
// "All arms complete" -> "All runs complete", stage "REFERENCE BASELINE" ->
// "Historical comparator", strategy entries without H-Sx-nn -> Strategy).
const LEGACY_PHRASES = Object.freeze({
  "All arms complete": "All historical runs complete",
  // v2/v3 rules.feesEurMwh (run-exploratory-backtest.mjs:330 / :375), Spanish in the artifact.
  "UNKNOWN (no incluidos; pedidos al cliente)": "UNKNOWN (excluded, not zero; requested from the client)",
  // v2 campaignUnknowns U-EM-3 detail (run-exploratory-backtest.mjs), Spanish in the artifact.
  "Requested from the client (solicitud de informacion, 2026-09-24).": "Requested from the client (information request, 2026-09-24).",
  "Arm completeness": "Historical run completeness",
  "REFERENCE BASELINE": "HISTORICAL COMPARATOR",
  "HYPOTHESIS ONLY": "STRATEGY · NO HYPOTHESIS DEFINED",
});

// Legacy tokens inside historical sentences (criteria, gate details, checks).
// The comparator word "Baseline" becomes "comparator (A0)"; "arm" as a generic
// word becomes "run" so no legacy experiment vocabulary is primary.
const LEGACY_TOKENS = Object.freeze([
  [/\bBASELINE\b/g, LEGACY_RUN_NAMES.BASELINE],
  [/\bARM_A\b/g, LEGACY_RUN_NAMES.ARM_A],
  [/\bARM_B\b/g, LEGACY_RUN_NAMES.ARM_B],
  [/\bH_BASELINE\b/g, "H_comparator"],
  [/\bH_arm\b/g, "H_run"],
  [/\bBaseline\b/g, "comparator (A0)"],
  [/\b([Ee])very arm\b/g, "$1very run"],
  [/\bP95 arm\b/g, "P95 run"],
  [/\band arm\b/g, "and run"],
]);

// BT-02 measures the legacy runs also in a depth-capped execution variant, with
// ids "<ALIAS>@DEPTH" (operations/exploratory/reconcile-bt02.mjs). The variant
// keeps the run's name plus its execution variant.
const LEGACY_RUN_VARIANTS = Object.freeze({ DEPTH: "depth-capped" });

export function legacyRunIdentity(runId) {
  const [technicalAlias, variant = null] = String(runId ?? "").split("@");
  const displayName = LEGACY_RUN_NAMES[technicalAlias] ?? null;
  const variantLabel = variant === null ? null : LEGACY_RUN_VARIANTS[variant] ?? null;
  const known = displayName !== null && (variant === null || variantLabel !== null);
  return Object.freeze({
    runId: String(runId ?? ""),
    technicalAlias: known ? technicalAlias : null,
    variant,
    displayName: known ? (variantLabel === null ? displayName : `${displayName} · ${variantLabel}`) : null,
  });
}

// Canonical display text of one immutable historical string. The original is
// returned verbatim as `historicalQuote` whenever the text changed, so the
// surfaces keep the quote with its provenance instead of relabelling evidence
// (OFICINA.md, Semántica transversal; UI10-07). Non-strings stay null.
export function canonicalHistoricalText(text) {
  if (typeof text !== "string") {
    return Object.freeze({ text: null, historicalQuote: null });
  }
  let canonical = LEGACY_PHRASES[text] ?? text;
  for (const [pattern, replacement] of LEGACY_TOKENS) {
    canonical = canonical.replace(pattern, replacement);
  }
  return Object.freeze({ text: canonical, historicalQuote: canonical === text ? null : text });
}
