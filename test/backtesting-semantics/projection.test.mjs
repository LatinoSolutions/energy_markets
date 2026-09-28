import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

import {
  adaptLegacyExploratoryArtifact,
  legacyRoleOf,
  LEGACY_EXPLORATORY_PROTOCOL,
} from "../../src/backtesting-semantics/legacy-compat.mjs";
import {
  buildCanonicalSemanticsProjection,
  pairedBenchmarkDelta,
  CANONICAL_LABELS,
} from "../../src/backtesting-semantics/projection.mjs";
import { IDENTITY, SEMANTIC_VERSION } from "../../src/backtesting-semantics/contract.mjs";

const sha256Of = (value) => createHash("sha256").update(value).digest("hex");

// Two REAL legacy exploratory releases: Gas v2 and Power v3 (the only ones the
// loader accepts; canonical-inputs.mjs). Each has its own artifact bytes/hash.
const GAS_BYTES = JSON.stringify({ artifactKind: "EXPLORATORY_RESULTS", release: "v2" });
const POWER_BYTES = JSON.stringify({ artifactKind: "EXPLORATORY_RESULTS", release: "v3" });
const GAS_HASH = sha256Of(GAS_BYTES);
const POWER_HASH = sha256Of(POWER_BYTES);

function releaseProvenance({ release, resultsSha256, resultsPath }) {
  return {
    release,
    market: release === "v2" ? "GAS_THE" : "POWER_DE",
    manifestPath: `operations/exploratory/${release}/MANIFEST.json`,
    resultsPath,
    resultsSha256,
    slotsPath: "operations/exploratory/slots.json",
    slotsSha256: "c3".repeat(32),
  };
}

// Verified exploratory input with per-product artifact scope (Gas v2 for G0BQ/
// G0BM, Power v3 for DEBQ/DEBM), exactly as the loader emits it. The provenance
// hashes are pinned to the canonical bytes of each release; `gasBytes`/
// `powerBytes` control only the bytes the adapter actually receives.
function verifiedExploratory({ gasBytes = GAS_BYTES, powerBytes = POWER_BYTES } = {}) {
  const gasProvenance = releaseProvenance({ release: "v2", resultsSha256: GAS_HASH, resultsPath: "operations/exploratory/v2/backtest-results.json" });
  const powerProvenance = releaseProvenance({ release: "v3", resultsSha256: POWER_HASH, resultsPath: "operations/exploratory/v3/backtest-results.json" });
  return {
    provenance: {
      ...gasProvenance,
      releases: [gasProvenance, powerProvenance],
      byProduct: { G0BQ: gasProvenance, G0BM: gasProvenance, DEBQ: powerProvenance, DEBM: powerProvenance },
    },
    legacyArtifacts: { G0BQ: gasBytes, G0BM: gasBytes, DEBQ: powerBytes, DEBM: powerBytes },
  };
}

function bt02Campaign(product, campaignKey, B, versionId = "v-".repeat(21) + "v") {
  return {
    campaignKey,
    product,
    maturity: campaignKey.slice(-6),
    targetMw: 10,
    campaignReadiness: "EXPLORATORY_COMPLETE",
    status: "PROVISIONAL",
    benchmark: { status: "BENCHMARK_PROVISIONAL", B, versionId, window: { rule: "1-0-1" } },
    fees: { status: "UNKNOWN", included: false },
  };
}

const BT02_PROVENANCE = { artifactPath: "operations/backtests/bt02-artifact.json" };

test("legacy adapter is source/version scoped and never invents a role without verified bytes", () => {
  const missing = adaptLegacyExploratoryArtifact({ provenance: null });
  assert.equal(missing.ok, false);
  assert.equal(missing.code, "LEGACY_PROVENANCE_MISSING");
  assert.deepEqual(missing.roles, {});

  const badHash = adaptLegacyExploratoryArtifact({ provenance: releaseProvenance({ release: "v2", resultsSha256: "not-a-hash", resultsPath: "x" }) });
  assert.equal(badHash.ok, false);
  assert.equal(badHash.code, "LEGACY_ARTIFACT_HASH_INVALID");

  const badLocator = adaptLegacyExploratoryArtifact({ provenance: releaseProvenance({ release: "v2", resultsSha256: GAS_HASH, resultsPath: "" }) });
  assert.equal(badLocator.code, "LEGACY_ARTIFACT_LOCATOR_MISSING");

  // SEM2-T02: a syntactically valid sha256 that does not match the artifact
  // bytes resolves nothing (the mapping is bound to the verified source).
  const wrongBytes = adaptLegacyExploratoryArtifact({
    provenance: releaseProvenance({ release: "v2", resultsSha256: GAS_HASH, resultsPath: "operations/exploratory/v2/backtest-results.json" }),
    artifact: POWER_BYTES,
  });
  assert.equal(wrongBytes.ok, false);
  assert.equal(wrongBytes.code, "LEGACY_ARTIFACT_HASH_MISMATCH");
  assert.deepEqual(wrongBytes.roles, {});

  // Without the artifact bytes nothing resolves either: a declared hash is a
  // claim, not verification.
  const noBytes = adaptLegacyExploratoryArtifact({
    provenance: releaseProvenance({ release: "v2", resultsSha256: GAS_HASH, resultsPath: "operations/exploratory/v2/backtest-results.json" }),
  });
  assert.equal(noBytes.ok, false);
  assert.equal(noBytes.code, "LEGACY_ARTIFACT_BYTES_MISSING");

  // An unknown release does not resolve roles by having a format.
  const unknownRelease = adaptLegacyExploratoryArtifact({
    provenance: releaseProvenance({ release: "v9", resultsSha256: GAS_HASH, resultsPath: "operations/exploratory/v9/backtest-results.json" }),
    artifact: GAS_BYTES,
  });
  assert.equal(unknownRelease.ok, false);
  assert.equal(unknownRelease.code, "LEGACY_RELEASE_UNKNOWN");
});

test("BASELINE/A0 is a historical CONTROL comparator, never CLIENT and never equivalent to the active protocol", () => {
  const adapter = adaptLegacyExploratoryArtifact({
    provenance: releaseProvenance({ release: "v2", resultsSha256: GAS_HASH, resultsPath: "operations/exploratory/v2/backtest-results.json" }),
    artifact: GAS_BYTES,
  });
  assert.equal(adapter.ok, true);
  assert.equal(adapter.protocolVersion, LEGACY_EXPLORATORY_PROTOCOL);
  assert.equal(adapter.artifactSha256, GAS_HASH);
  const baseline = legacyRoleOf(adapter, "BASELINE");
  assert.equal(baseline.role, IDENTITY.CONTROL);
  assert.equal(baseline.identity, IDENTITY.CONTROL);
  assert.equal(baseline.activeProtocolEquivalent, false);
  assert.equal(baseline.productionFallbackAuthorized, false);
  assert.equal(baseline.tested, false);
  // No legacy id may ever resolve to CLIENT.
  for (const role of Object.values(adapter.roles)) {
    assert.notEqual(role.identity, IDENTITY.CLIENT);
    assert.equal(role.alias === "A0" ? role.role : null, role.alias === "A0" ? IDENTITY.CONTROL : null);
  }
});

test("DIP10/ARM_A resolves to H-S1-01 and HOUR/ARM_B to H-RD-01 as provenance only", () => {
  const adapter = adaptLegacyExploratoryArtifact({
    provenance: releaseProvenance({ release: "v2", resultsSha256: GAS_HASH, resultsPath: "operations/exploratory/v2/backtest-results.json" }),
    artifact: GAS_BYTES,
  });
  const dip = legacyRoleOf(adapter, "ARM_A");
  assert.equal(dip.hypothesisId, "H-S1-01");
  assert.equal(dip.evidenceStatus, "PROVENANCE_ONLY");
  assert.equal(dip.tested, false);
  assert.equal(dip.runnable, false);
  assert.equal(dip.sizingParityClaim, false);
  const hour = legacyRoleOf(adapter, "ARM_B");
  assert.equal(hour.hypothesisId, "H-RD-01");
  assert.equal(hour.tested, false);
  assert.equal(adapter.candidates.DIP10, dip);
  assert.equal(adapter.candidates.HOUR, hour);

  const unknown = legacyRoleOf(adapter, "ARM_Z");
  assert.equal(unknown.resolved, false);
  assert.equal(unknown.code, "UNKNOWN_LEGACY_ARM");
});

test("one shared projection carries English canonical identities and typed roles for four missions", () => {
  const backtestReadiness = {
    provenance: BT02_PROVENANCE,
    results: { campaigns: [bt02Campaign("G0BQ", "G0BQ-202601", 42.5)] },
  };
  const projection = buildCanonicalSemanticsProjection({ exploratory: verifiedExploratory(), backtestReadiness });
  assert.equal(projection.ok, true);
  assert.equal(projection.semanticVersion, SEMANTIC_VERSION);
  assert.equal(projection.source.status, "VERIFIED");
  assert.equal(CANONICAL_LABELS.identities.HYPOTHESES, "Hypotheses");
  assert.equal(projection.missions.length, 4);
  assert.deepEqual(projection.missions.map((mission) => mission.missionId), ["GAS_QUARTERLY", "GAS_MONTHLY", "POWER_QUARTERLY", "POWER_MONTHLY"]);
  for (const mission of projection.missions) {
    assert.equal(mission.client.kind, IDENTITY.CLIENT);
    assert.equal(mission.benchmark.kind, IDENTITY.BENCHMARK);
    assert.equal(mission.control.kind, IDENTITY.CONTROL);
    assert.equal(mission.control.activeProtocolEquivalent, false);
    // Only hypotheses that declare the mission appear on its row (SEM2-T05):
    // H-RD-01 declares no missions, so it never claims mission applicability.
    assert.deepEqual(mission.hypotheses.map((hypothesis) => hypothesis.hypothesisId), ["H-S1-01"]);
    assert.equal(mission.hypotheses[0].role, "Strategy");
    assert.equal(mission.hypotheses[0].tested, false);
    // English primary labels only.
    assert.match(mission.label, /^[A-Za-z ]+$/);
  }
  // HYPOTHESES collection holds every canonical hypothesis with its accepted
  // scope; H-RD-01 stays Research Discovery with no declared mission.
  const rd = projection.hypotheses.find((hypothesis) => hypothesis.hypothesisId === "H-RD-01");
  assert.equal(rd.role, "Research Discovery");
  assert.deepEqual(rd.missions, []);
  assert.equal(rd.applicabilityStatus, "UNDECLARED");
  const s1 = projection.hypotheses.find((hypothesis) => hypothesis.hypothesisId === "H-S1-01");
  assert.equal(s1.role, "Strategy");
  assert.equal(s1.missions.length, 4);
});

test("SEM2-T03: each mission's legacy mapping is scoped to its own verified artifact release", () => {
  const projection = buildCanonicalSemanticsProjection({ exploratory: verifiedExploratory() });
  const gas = projection.missions.find((mission) => mission.missionId === "GAS_QUARTERLY");
  const gasMonthly = projection.missions.find((mission) => mission.missionId === "GAS_MONTHLY");
  const power = projection.missions.find((mission) => mission.missionId === "POWER_QUARTERLY");
  const powerMonthly = projection.missions.find((mission) => mission.missionId === "POWER_MONTHLY");
  // DEBQ and DEBM are bound to the Power v3 hash, never to the Gas v2 hash.
  assert.equal(gas.control.historicalComparator.artifactSha256, GAS_HASH);
  assert.equal(gasMonthly.control.historicalComparator.artifactSha256, GAS_HASH);
  assert.equal(power.control.historicalComparator.artifactSha256, POWER_HASH);
  assert.equal(powerMonthly.control.historicalComparator.artifactSha256, POWER_HASH);
  assert.equal(power.control.historicalComparator.release, "v3");

  // Mixing bytes across releases fails closed: DEBQ with the Gas bytes stays
  // unresolved instead of borrowing another artifact's mapping.
  const mixed = buildCanonicalSemanticsProjection({
    exploratory: verifiedExploratory({ powerBytes: GAS_BYTES }),
  });
  const mixedPower = mixed.missions.find((mission) => mission.missionId === "POWER_QUARTERLY");
  assert.equal(mixedPower.control.historicalComparator, null);
  // Gas keeps its own verified mapping.
  assert.equal(mixed.missions.find((mission) => mission.missionId === "GAS_QUARTERLY").control.historicalComparator !== null, true);

  // Source identity reports the per-product releases truthfully.
  assert.equal(projection.source.products.G0BQ.release, "v2");
  assert.equal(projection.source.products.DEBQ.release, "v3");
});

test("SEM2-T04: benchmarks are per-campaign references; cross-campaign deltas are rejected", () => {
  const v1 = "v-".repeat(21) + "a";
  const v2 = "v-".repeat(21) + "b";
  const backtestReadiness = {
    provenance: BT02_PROVENANCE,
    results: {
      campaigns: [
        bt02Campaign("G0BQ", "G0BQ-202601", 42.5, v1),
        bt02Campaign("G0BQ", "G0BQ-202602", 51.25, v2),
        bt02Campaign("DEBQ", "DEBQ-202601", 60, v1),
      ],
    },
  };
  const projection = buildCanonicalSemanticsProjection({ exploratory: verifiedExploratory(), backtestReadiness });
  const gas = projection.missions.find((mission) => mission.missionId === "GAS_QUARTERLY");
  // Two campaigns of the same mission keep separate references (value, version,
  // campaign scope); neither is attributed to the other campaign.
  const first = gas.benchmarkByCampaign["G0BQ-202601"];
  const second = gas.benchmarkByCampaign["G0BQ-202602"];
  assert.equal(first.campaignId, "G0BQ-202601");
  assert.equal(second.campaignId, "G0BQ-202602");
  assert.equal(first.value, 42.5);
  assert.equal(second.value, 51.25);
  assert.equal(first.referenceVersion, v1);
  assert.equal(second.referenceVersion, v2);
  assert.equal(first.provenance, BT02_PROVENANCE.artifactPath);
  // The mission-level identity stays unscoped: there is no single mission B.
  assert.equal(gas.benchmark.scopeStatus, "UNAVAILABLE");

  // Cross-campaign deltas cannot be produced.
  assert.equal(pairedBenchmarkDelta(first, second).code, "CROSS_CAMPAIGN_BENCHMARK_DELTA");
  // Same campaign, same version, but provisional B: still no valid delta.
  const sameCampaignOther = { ...first };
  assert.equal(pairedBenchmarkDelta(first, sameCampaignOther).code, "BENCHMARK_NOT_OFFICIAL");
  // Another benchmark version cannot produce a valid delta either.
  const otherVersion = { ...first, referenceVersion: v2 };
  assert.equal(pairedBenchmarkDelta(first, otherVersion).code, "BENCHMARK_VERSION_MISMATCH");
  // Power campaign keeps its own reference; it is not comparable with Gas.
  const power = projection.missions.find((mission) => mission.missionId === "POWER_QUARTERLY");
  assert.equal(pairedBenchmarkDelta(power.benchmarkByCampaign["DEBQ-202601"], first).code, "CROSS_CAMPAIGN_BENCHMARK_DELTA");
});

test("a campaign B without a source path stays unbound instead of guessing provenance", () => {
  const backtestReadiness = {
    results: { campaigns: [bt02Campaign("G0BQ", "G0BQ-202601", 42.5)] },
  };
  const projection = buildCanonicalSemanticsProjection({ exploratory: verifiedExploratory(), backtestReadiness });
  const gas = projection.missions.find((mission) => mission.missionId === "GAS_QUARTERLY");
  assert.equal(gas.benchmarkByCampaign["G0BQ-202601"].status, "UNAVAILABLE");
});

test("projection exposes a provisional BENCHMARK truthfully and never promotes it to official", () => {
  const projection = buildCanonicalSemanticsProjection({
    exploratory: verifiedExploratory(),
    backtestReadiness: {
      provenance: BT02_PROVENANCE,
      results: { campaigns: [bt02Campaign("G0BQ", "G0BQ-202601", 42.5), bt02Campaign("DEBQ", "DEBQ-202601", 51.25)] },
    },
  });
  const gas = projection.missions.find((mission) => mission.missionId === "GAS_QUARTERLY");
  const bound = gas.benchmarkByCampaign["G0BQ-202601"];
  assert.equal(bound.status, "BENCHMARK_PROVISIONAL");
  assert.equal(bound.value, 42.5);
  assert.equal(bound.id, "BENCHMARK");
  assert.notEqual(bound.status, "RECONCILED_OFFICIAL");
  const powerMonthly = projection.missions.find((mission) => mission.missionId === "POWER_MONTHLY");
  assert.deepEqual(powerMonthly.benchmarkByCampaign, {});
});

test("SEM2-T01: completed BT-08 results bind the published hypothesis identity and never flip it to TESTED", () => {
  const valid = {
    hypothesisId: "H-S1-01",
    hypothesisVersion: "H-S1-01/phase-A/v2",
    missionId: "GAS_QUARTERLY",
    runId: "HYP-RUN-" + "a1".repeat(32),
    status: "SUCCEEDED",
    validComparison: true,
    retention: { state: "CURRENT" },
    resultPath: "operations/backtest-runs/x/output/results.json",
    resultSha256: "d4".repeat(32),
  };
  const projection = buildCanonicalSemanticsProjection({
    exploratory: verifiedExploratory(),
    hypothesisResults: [
      valid,
      { ...valid, hypothesisVersion: "H-S1-01/phase-A/v1" },
      { ...valid, missionId: "GAS_MONTHLY" },
      { ...valid, runId: "" },
      { ...valid, hypothesisId: "H-RD-01" },
    ],
  });
  assert.equal(projection.results["H-S1-01"].length, 4);
  const gasResults = projection.missions.find((mission) => mission.missionId === "GAS_QUARTERLY").hypothesisResults;
  assert.equal(gasResults.length, 1);
  assert.equal(gasResults[0].state, "CURRENT");
  assert.equal(gasResults[0].hypothesisId, "H-S1-01");
  assert.equal(gasResults[0].runId, valid.runId);
  // A Development result is never a scientific validation.
  assert.equal(gasResults[0].tested, false);
  assert.equal(gasResults[0].researchPass, false);
  // The hypothesis view stays UNTESTED without matching new-version evidence.
  const s1 = projection.missions.find((mission) => mission.missionId === "GAS_QUARTERLY").hypotheses[0];
  assert.equal(s1.evidenceStatus, "UNTESTED");
  assert.equal(s1.tested, false);
  // Invalid bindings fail closed as explicit UNAVAILABLE entries.
  const states = projection.results["H-S1-01"].map((result) => result.state);
  assert.deepEqual(states[1], "UNAVAILABLE");
  assert.equal(projection.results["H-S1-01"][1].code, "HYPOTHESIS_VERSION_MISMATCH");
  assert.equal(projection.results["H-S1-01"][3].code, "HYPOTHESIS_RUN_ID_INVALID");
  // H-RD-01 has no runnable path: a result entry for it fails closed.
  assert.equal(projection.results["H-RD-01"][0].state, "UNAVAILABLE");
  // Mission scoping: the GAS_MONTHLY entry lands on its own mission only.
  const gasMonthlyResults = projection.missions.find((mission) => mission.missionId === "GAS_MONTHLY").hypothesisResults;
  assert.equal(gasMonthlyResults.length, 1);
  assert.equal(gasMonthlyResults[0].missionId, "GAS_MONTHLY");
});

test("projection without a verified exploratory artifact keeps CLIENT scoped and CONTROL unbound", () => {
  const projection = buildCanonicalSemanticsProjection({});
  assert.equal(projection.source.status, "UNAVAILABLE");
  assert.equal(projection.legacyAdapter.ok, false);
  for (const mission of projection.missions) {
    assert.equal(mission.control.historicalComparator, null);
    assert.equal(mission.client.scopeStatus, "UNAVAILABLE");
    // CLIENT purchase time is only confirmed for the current Gas Quarterly mandate.
    if (mission.missionId !== "GAS_QUARTERLY") {
      assert.equal(mission.client.confirmed.purchaseTime, undefined);
    }
  }
});
