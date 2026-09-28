import test from "node:test";
import assert from "node:assert/strict";

import {
  adaptLegacyExploratoryArtifact,
  legacyRoleOf,
  LEGACY_EXPLORATORY_PROTOCOL,
} from "../../src/backtesting-semantics/legacy-compat.mjs";
import {
  buildCanonicalSemanticsProjection,
  CANONICAL_LABELS,
} from "../../src/backtesting-semantics/projection.mjs";
import { IDENTITY, SEMANTIC_VERSION } from "../../src/backtesting-semantics/contract.mjs";

const HASH = "a1".repeat(32);

function verifiedProvenance(overrides = {}) {
  return {
    release: "v3",
    market: "GAS_THE",
    manifestPath: "operations/exploratory/v2/MANIFEST.json",
    resultsPath: "operations/exploratory/v2/backtest-results.json",
    resultsSha256: HASH,
    slotsPath: "operations/exploratory/slots.json",
    slotsSha256: "b2".repeat(32),
    ...overrides,
  };
}

function bt02Campaign(product, campaignKey, B) {
  return {
    campaignKey,
    product,
    maturity: campaignKey.slice(-6),
    targetMw: 10,
    campaignReadiness: "EXPLORATORY_COMPLETE",
    status: "PROVISIONAL",
    benchmark: { status: "BENCHMARK_PROVISIONAL", B, versionId: "v-".repeat(21) + "v", window: { rule: "1-0-1" } },
    fees: { status: "UNKNOWN", included: false },
  };
}

test("legacy adapter is source/version scoped and never invents a role without provenance", () => {
  const missing = adaptLegacyExploratoryArtifact({ provenance: null });
  assert.equal(missing.ok, false);
  assert.equal(missing.code, "LEGACY_PROVENANCE_MISSING");
  assert.deepEqual(missing.roles, {});

  const badHash = adaptLegacyExploratoryArtifact({ provenance: verifiedProvenance({ resultsSha256: "not-a-hash" }) });
  assert.equal(badHash.ok, false);
  assert.equal(badHash.code, "LEGACY_ARTIFACT_HASH_INVALID");

  const badLocator = adaptLegacyExploratoryArtifact({ provenance: verifiedProvenance({ resultsPath: "" }) });
  assert.equal(badLocator.code, "LEGACY_ARTIFACT_LOCATOR_MISSING");
});

test("BASELINE/A0 is a historical CONTROL comparator, never CLIENT and never equivalent to the active protocol", () => {
  const adapter = adaptLegacyExploratoryArtifact({ provenance: verifiedProvenance() });
  assert.equal(adapter.ok, true);
  assert.equal(adapter.protocolVersion, LEGACY_EXPLORATORY_PROTOCOL);
  assert.equal(adapter.artifactSha256, HASH);
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
  const adapter = adaptLegacyExploratoryArtifact({ provenance: verifiedProvenance() });
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
  const exploratory = { provenance: verifiedProvenance() };
  const backtestReadiness = { results: { campaigns: [bt02Campaign("G0BQ", "G0BQ-202601", 42.5)] } };
  const projection = buildCanonicalSemanticsProjection({ exploratory, backtestReadiness });
  assert.equal(projection.ok, true);
  assert.equal(projection.semanticVersion, SEMANTIC_VERSION);
  assert.equal(projection.source.status, "VERIFIED");
  assert.equal(projection.source.artifactSha256, HASH);
  assert.equal(projection.missions.length, 4);
  assert.deepEqual(projection.missions.map((mission) => mission.missionId), ["GAS_QUARTERLY", "GAS_MONTHLY", "POWER_QUARTERLY", "POWER_MONTHLY"]);
  assert.equal(CANONICAL_LABELS.identities.HYPOTHESES, "Hypotheses");
  for (const mission of projection.missions) {
    assert.equal(mission.client.kind, IDENTITY.CLIENT);
    assert.equal(mission.benchmark.kind, IDENTITY.BENCHMARK);
    assert.equal(mission.control.kind, IDENTITY.CONTROL);
    assert.equal(mission.control.activeProtocolEquivalent, false);
    assert.deepEqual(mission.hypotheses.map((hypothesis) => hypothesis.hypothesisId), ["H-S1-01", "H-RD-01"]);
    assert.equal(mission.hypotheses[1].originType, "RESEARCH_DISCOVERY");
    assert.equal(mission.hypotheses[1].tested, false);
    // English primary labels only.
    assert.match(mission.label, /^[A-Za-z ]+$/);
  }
});

test("projection exposes a provisional BENCHMARK truthfully and never promotes it to official", () => {
  const projection = buildCanonicalSemanticsProjection({
    exploratory: { provenance: verifiedProvenance() },
    backtestReadiness: { results: { campaigns: [bt02Campaign("G0BQ", "G0BQ-202601", 42.5), bt02Campaign("DEBQ", "DEBQ-202601", 51.25)] } },
  });
  const gas = projection.missions.find((mission) => mission.missionId === "GAS_QUARTERLY");
  assert.equal(gas.benchmark.status, "BENCHMARK_PROVISIONAL");
  assert.equal(gas.benchmark.value, 42.5);
  assert.equal(gas.benchmark.id, "BENCHMARK");
  assert.notEqual(gas.benchmark.status, "RECONCILED_OFFICIAL");
  const powerMonthly = projection.missions.find((mission) => mission.missionId === "POWER_MONTHLY");
  assert.equal(powerMonthly.benchmark.status, "UNAVAILABLE");
  assert.equal(powerMonthly.benchmark.value, null);
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
