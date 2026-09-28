// SEM-2 · source/version-scoped compatibility adapter for historical exploratory
// artifacts (intake D-20260928T181604-148d, operative revision 20260928-english-v2).
//
// The historical producers (operations/exploratory/v*/run-exploratory-backtest.mjs)
// are immutable: they keep emitting BASELINE / ARM_A / ARM_B / DIP10 / HOUR and the
// "client practice" wording. This adapter does NOT rewrite their bytes. It reads a
// verified artifact plus its provenance hash and returns the canonical role of each
// legacy identifier through the SEM-1 / FIX-07 contract.
//
// Rules enforced here (SEM-1, FIX-07, audit CS-01/CS-02):
//   - nothing is resolved without the artifact sha256 and a protocol version;
//   - BASELINE/A0 is a historical CONTROL comparator, never CLIENT and never the
//     active CONTROL protocol by equivalence;
//   - DIP10/ARM_A resolve to H-S1-01 and HOUR/ARM_B to H-RD-01 as PROVENANCE_ONLY,
//     never as a tested/runnable result and never carrying sizing parity;
//   - an unknown or ambiguous id stays explicitly unresolved (fail-closed).
import { createHash } from "node:crypto";

import {
  IDENTITY,
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
// not claim CLIENT: BASELINE is mapped to the replay CONTROL alias A0, and the two
// candidate arms map to their canonical hypothesis as provenance only.
const LEGACY_ARM_TABLE = Object.freeze([
  Object.freeze({ legacyId: "BASELINE", rule: "CONTROL_ALIAS", alias: "A0" }),
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
    role: null,
    identity: null,
    hypothesisId: null,
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
  return { ok: true, resultsSha256, resultsPath, release };
}

// Resolve one legacy arm id to its canonical role. Never infers CLIENT.
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
  if (entry.rule === "CONTROL_ALIAS") {
    const resolved = resolveLegacyAlias({
      alias: entry.alias,
      artifactSha256: scope.resultsSha256,
      protocolVersion: LEGACY_EXPLORATORY_PROTOCOL,
      mapping: { ...mapping, kind: IDENTITY.CONTROL, hypothesisId: "H-S1-01" },
    });
    if (!resolved.ok) {
      return unresolved(legacyId, resolved.code);
    }
    return Object.freeze({
      legacyId,
      resolved: true,
      code: null,
      role: IDENTITY.CONTROL,
      identity: IDENTITY.CONTROL,
      alias: entry.alias,
      hypothesisId: resolved.hypothesisId,
      runId: resolved.runId,
      // A historical calendar comparator is NOT the active CONTROL protocol: the
      // equivalence would need the source-bound mapping and is never claimed here.
      activeProtocolEquivalent: false,
      productionFallbackAuthorized: false,
      tested: false,
      runnable: false,
      sizingParityClaim: false,
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
    role: IDENTITY.HYPOTHESIS,
    identity: IDENTITY.HYPOTHESIS,
    alias: entry.alias,
    hypothesisId: resolved.hypothesisId,
    hypothesisName: resolved.hypothesisName,
    hypothesisVersion: resolved.hypothesisVersion,
    runId: resolved.runId,
    evidenceStatus: resolved.evidenceStatus,
    tested: resolved.tested,
    runnable: resolved.runnable,
    sizingParityClaim: resolved.sizingParityClaim,
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
  const roles = Object.freeze(Object.fromEntries(
    LEGACY_ARM_TABLE.map((entry) => [entry.legacyId, resolveArm(entry.legacyId, scope)]),
  ));
  const candidates = Object.freeze(Object.fromEntries(
    Object.entries(LEGACY_CANDIDATE_TABLE).map(([candidateId, armId]) => [candidateId, roles[armId]]),
  ));
  return Object.freeze({
    ok: true,
    code: null,
    protocolVersion: LEGACY_EXPLORATORY_PROTOCOL,
    artifactSha256: scope.resultsSha256,
    artifactPath: scope.resultsPath,
    release: scope.release,
    roles,
    candidates,
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
