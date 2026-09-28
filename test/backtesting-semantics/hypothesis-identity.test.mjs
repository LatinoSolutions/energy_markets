import test from "node:test";
import assert from "node:assert/strict";
import {
  IDENTITY, MISSIONS, H_S1_01, H_RD_01, HYPOTHESIS_BY_ID, ORIGIN_TYPE, MISSION_LABELS,
  canonicalHypothesisId, canonicalStrategyRefs, verifyCanonicalHypothesisId,
  isCanonicalHypothesisRecord, createHypothesisIdentity, createMissionConfiguration,
  evaluateHypothesisStatus, classifyHypothesisChange, resolveLegacyAlias,
  resolveLegacyHypothesisAlias, createExperimentBinding, controlFor,
} from "../../src/backtesting-semantics/contract.mjs";
import { H_S1_01 as HYP1_H_S1_01, H_S1_01_MISSIONS, predeclareHS1SearchSpace, createHS1Candidate } from "../../src/s1-strategy/h-s1-01.mjs";
import { buildBacktestsViewModel } from "../../src/ui/view-models.mjs";
import { renderBacktestsPage, renderSurfacePage } from "../../src/ui/render.mjs";
import { loadCanonicalUiInputs } from "../../src/ui/canonical-inputs.mjs";
import { buildUiViewModels } from "../../src/ui/server.mjs";
import { contentHashOf } from "../../src/sizing-controller/versioning.mjs";

const sha = (char) => char.repeat(64);
const FIXTURE_HASH = "a".repeat(64);
const FIXTURE_ZONE_HASH = "b".repeat(64);
const fixtureDays = Array.from({ length: 21 }, (_, index) => `2025-01-${String(index + 1).padStart(2, "0")}`);

function availabilityFor(mission, count = 11) {
  return fixtureDays.slice(0, count).map((day) => ({
    mission, atUtc: `${day}T10:00:00Z`, sessionDate: day, anchor: "10:00",
    available: true, pitAvailableAtUtc: `${day}T10:00:00Z`, sourceHash: FIXTURE_HASH,
  }));
}
function searchSpaceFixture(missionId) {
  const mission = MISSION_LABELS[missionId];
  return predeclareHS1SearchSpace({
    mission, developmentEndUtc: "2025-02-01T00:00:00Z",
    session: { mission, zone: "UTC", anchors: ["10:00"], sourceHash: FIXTURE_ZONE_HASH },
    availability: availabilityFor(mission),
    provenance: { authority: "SYNTHETIC_FIXTURE", locator: "test/backtesting-semantics/hypothesis-identity.test.mjs", sourceHash: FIXTURE_HASH },
  }).searchSpace;
}
function candidateFixture(missionId) {
  return createHS1Candidate({
    searchSpace: searchSpaceFixture(missionId), tau: { zone: "UTC", localTime: "10:00" }, N: 3,
  }).candidate;
}

function identityFixture({ strategyRefs = ["S2"], sequence = 1, name = "Second Strategy Hypothesis", question = "Does the second Strategy improve timing?", version = "H-S2-01/phase-A/v1", missions = ["GAS_QUARTERLY"] } = {}) {
  return createHypothesisIdentity({
    originType: ORIGIN_TYPE.STRATEGY_DERIVED, strategyRefs, sequence, name, question, version,
    missions, provenance: { authority: "test-owner", locator: "test/fixture" },
  }).identity;
}

function quoteConfig(hypothesis = H_S1_01, missionId = "GAS_QUARTERLY", configuration = { dataMode: "DEVELOPMENT", tau: "10:00", N: 3 }) {
  return createMissionConfiguration({
    hypothesis, missionId, configuration,
    searchSpace: searchSpaceFixture(missionId), candidate: candidateFixture(missionId),
  }).configuration;
}

function experimentFixture(configuration, { runId = "run-1", campaignId = "camp-1", experimentId = "exp-1" } = {}) {
  const artifactSha256 = sha("c");
  const control = controlFor({ hypothesisId: "H-S1-01", runId, populationId: "pop-1", campaignId, obligationId: "obl-1", calendarVersion: "cal-1", sizingVersion: "sz-1", executionVersion: "ex-1", benchmarkVersion: "bm-1", artifactSha256 });
  return createExperimentBinding({ hypothesis: H_S1_01, configuration, experimentId, campaignId, runId, technicalArmId: "arm-1", control });
}

function evidenceFixture(configuration, { runId = "run-1", experimentId = "exp-1", artifactSha256 = sha("d"), ...overrides } = {}) {
  return {
    hypothesisId: "H-S1-01", hypothesisVersion: H_S1_01.version, missionId: configuration.missionId,
    configurationHash: configuration.configurationHash, experimentId, runId, artifactSha256,
    comparabilityStatus: "COMPARABLE",
    provenance: { authority: "receipt", locator: `${runId}/receipt.json`, artifactSha256 },
    ...overrides,
  };
}

test("ID01: identity schema rejects missing/conflicting bindings and consumes the accepted HYP-1 source", () => {
  const base = { originType: ORIGIN_TYPE.STRATEGY_DERIVED, strategyRefs: ["S1"], sequence: 1, question: "q", version: "v", missions: ["GAS_QUARTERLY"], provenance: { authority: "a", locator: "l" } };
  assert.equal(createHypothesisIdentity({ ...base, name: "" }).ok, false);
  assert.ok(createHypothesisIdentity({ ...base, name: "" }).errors.some((error) => error.field === "name"));
  assert.equal(createHypothesisIdentity({ ...base, name: "n", question: "" }).ok, false);
  assert.equal(createHypothesisIdentity({ ...base, name: "n", missions: ["NOT_A_MISSION"] }).ok, false);
  assert.equal(createHypothesisIdentity({ ...base, name: "n", provenance: null }).ok, false);
  assert.equal(createHypothesisIdentity({ ...base, name: "n", hypothesisId: "H-S9-99" }).ok, false);

  // A published ID is not recycled: H-S1-01 cannot become DIP10 with a
  // different question (FIX07-ID-COLLISION)…
  const collision = createHypothesisIdentity({
    originType: ORIGIN_TYPE.STRATEGY_DERIVED, strategyRefs: ["S1"], sequence: 1, version: "H-S1-01/phase-A/v2",
    name: "DIP10", question: "¿Otra pregunta distinta?", missions: ["GAS_QUARTERLY"],
    provenance: { authority: "x", locator: "y" },
  });
  assert.equal(collision.ok, false);
  assert.ok(collision.errors.some((error) => error.code === "PUBLISHED_IDENTITY_COLLISION"));
  // A recalibration cannot silently narrow the accepted four-mission scope
  // (FIX07-PUBLISHED-SCOPE).
  const narrowedScope = createHypothesisIdentity({
    originType: ORIGIN_TYPE.STRATEGY_DERIVED, strategyRefs: ["S1"], sequence: 1, version: "H-S1-01/phase-A/v2",
    name: H_S1_01.name, question: H_S1_01.question, missions: ["GAS_QUARTERLY"],
    provenance: { authority: "x", locator: "y" },
  });
  assert.equal(narrowedScope.ok, false);
  assert.ok(narrowedScope.errors.some((error) => error.code === "PUBLISHED_SCOPE_COLLISION"));
  // …but a recalibration that keeps the accepted question and the full
  // accepted mission scope may advance version.
  const recalibration = createHypothesisIdentity({
    originType: ORIGIN_TYPE.STRATEGY_DERIVED, strategyRefs: ["S1"], sequence: 1, version: "H-S1-01/phase-A/v2",
    name: H_S1_01.name, question: H_S1_01.question, missions: [...H_S1_01.missions],
    provenance: { authority: "x", locator: "y" },
  });
  assert.equal(recalibration.ok, true);

  // The active identity consumes the accepted HYP-1 name/question/version.
  assert.equal(H_S1_01.name, HYP1_H_S1_01.name);
  assert.equal(H_S1_01.question, HYP1_H_S1_01.question);
  assert.equal(H_S1_01.version, HYP1_H_S1_01.version);
  assert.equal(H_S1_01.hypothesisHash, HYP1_H_S1_01.contentHash);
  assert.equal(H_S1_01.provenance.locator, HYP1_H_S1_01.provenance.locator);
  assert.deepEqual(H_S1_01.strategyRefs, ["S1"]);
  assert.equal(H_S1_01.legacy.status, "EXPLORATORY_PROVENANCE_ONLY");
  assert.equal(isCanonicalHypothesisRecord(H_S1_01).ok, true);
  assert.equal(isCanonicalHypothesisRecord(H_RD_01).ok, true);
  assert.deepEqual(Object.keys(HYPOTHESIS_BY_ID).sort(), ["H-RD-01", "H-S1-01"]);

  // A directly supplied record must pass the same published-identity guard as
  // the constructor; a valid ID alone cannot rename the accepted HYP-1.
  const redefined = { ...H_S1_01, name: "DIP10", question: "Otra pregunta", version: "H-S1-01/phase-A/v2" };
  assert.equal(isCanonicalHypothesisRecord(redefined).code, "PUBLISHED_IDENTITY_COLLISION");
  assert.equal(createMissionConfiguration({
    hypothesis: redefined, missionId: "GAS_QUARTERLY",
    configuration: { dataMode: "DEVELOPMENT", tau: "10:00", N: 3 },
    searchSpace: searchSpaceFixture("GAS_QUARTERLY"), candidate: candidateFixture("GAS_QUARTERLY"),
  }).code, "NOT_CANONICAL_HYPOTHESIS");
  assert.equal(isCanonicalHypothesisRecord({ ...H_S1_01, missions: ["GAS_QUARTERLY"] }).code, "PUBLISHED_SCOPE_COLLISION");
  assert.equal(isCanonicalHypothesisRecord({ ...H_S1_01, hypothesisHash: sha("e") }).code, "PUBLISHED_DEFINITION_MISMATCH");
  const mismatchedId = { ...H_S1_01, id: "H-RD-01" };
  assert.equal(verifyCanonicalHypothesisId(mismatchedId).code, "HYPOTHESIS_ID_MISMATCH");
  assert.equal(isCanonicalHypothesisRecord(mismatchedId).code, "HYPOTHESIS_ID_MISMATCH");
  assert.equal(createMissionConfiguration({
    hypothesis: mismatchedId, missionId: "GAS_QUARTERLY",
    configuration: { dataMode: "DEVELOPMENT", tau: "10:00", N: 3 },
    searchSpace: searchSpaceFixture("GAS_QUARTERLY"), candidate: candidateFixture("GAS_QUARTERLY"),
  }).code, "NOT_CANONICAL_HYPOTHESIS");
  assert.equal(isCanonicalHypothesisRecord({ ...H_S1_01, id: undefined }).code, "HYPOTHESIS_ID_MISMATCH");
  const forgedProvenance = { authority: "forged", locator: "forged" };
  const forgedRecord = { ...H_S1_01, provenance: forgedProvenance };
  assert.equal(isCanonicalHypothesisRecord(forgedRecord).code, "PUBLISHED_PROVENANCE_MISMATCH");
  assert.equal(createMissionConfiguration({
    hypothesis: forgedRecord, missionId: "GAS_QUARTERLY",
    configuration: { dataMode: "DEVELOPMENT", tau: "10:00", N: 3 },
    searchSpace: searchSpaceFixture("GAS_QUARTERLY"), candidate: candidateFixture("GAS_QUARTERLY"),
  }).code, "NOT_CANONICAL_HYPOTHESIS");
  const forgedPublished = createHypothesisIdentity({
    originType: ORIGIN_TYPE.STRATEGY_DERIVED, strategyRefs: ["S1"], sequence: 1,
    name: H_S1_01.name, question: H_S1_01.question, version: H_S1_01.version,
    missions: [...H_S1_01.missions], provenance: forgedProvenance,
  });
  assert.equal(forgedPublished.ok, false);
  assert.ok(forgedPublished.errors.some((error) => error.code === "PUBLISHED_PROVENANCE_MISMATCH"));
  assert.equal(isCanonicalHypothesisRecord({ ...H_S1_01, provenance: { ...H_S1_01.provenance, locator: "forged" } }).code, "PUBLISHED_PROVENANCE_MISMATCH");
  assert.equal(isCanonicalHypothesisRecord({ ...H_S1_01, provenance: { ...H_S1_01.provenance, extra: "forged" } }).code, "PUBLISHED_PROVENANCE_MISMATCH");
  const rebuiltPublished = createHypothesisIdentity({
    originType: ORIGIN_TYPE.STRATEGY_DERIVED, strategyRefs: ["S1"], sequence: 1,
    name: H_S1_01.name, question: H_S1_01.question, version: H_S1_01.version,
    missions: [...H_S1_01.missions], provenance: H_S1_01.provenance,
  });
  assert.equal(rebuiltPublished.ok, true);
  assert.equal(rebuiltPublished.identity.hypothesisHash, HYP1_H_S1_01.contentHash);
  assert.equal(isCanonicalHypothesisRecord(rebuiltPublished.identity).ok, true);
});

test("ID02: H-S1-01 is Session-Anchored Rolling Reference from Strategy S1 across all four missions", () => {
  assert.deepEqual(H_S1_01.missions, MISSIONS.map(({ id }) => id));
  assert.deepEqual([...HYP1_H_S1_01.missions].sort(), [...H_S1_01_MISSIONS].sort());
  assert.equal(H_S1_01.name, "Session-Anchored Rolling Reference");
  assert.equal(H_S1_01.strategy, "S1");
  assert.equal(H_S1_01.parameters.tau, "CONFIGURABLE");
  assert.equal(H_S1_01.parameters.N, "CONFIGURABLE");
  assert.equal(H_S1_01.result, null);

  const vm = buildBacktestsViewModel();
  assert.equal(vm.semanticComparison.length, 4);
  for (const entry of vm.semanticComparison) {
    assert.equal(entry.hypotheses.length, 1);
    assert.equal(entry.hypotheses[0].hypothesisId, "H-S1-01");
    assert.equal(entry.hypotheses[0].name, "Session-Anchored Rolling Reference");
  }
  const html = renderBacktestsPage(vm);
  for (const mission of MISSIONS) {
    assert.match(html, new RegExp(`data-mission="${mission.id}"`));
  }
  assert.match(html, /H-S1-01 · Session-Anchored Rolling Reference/);
});

test("ID03: naming is deterministic and a new Strategy/RD hypothesis needs no ARM_C renderer branch", () => {
  assert.deepEqual(canonicalStrategyRefs(["S3", "S1"]), { ok: true, refs: ["S1", "S3"] });
  assert.equal(canonicalHypothesisId({ originType: ORIGIN_TYPE.MULTI_STRATEGY, strategyRefs: ["S3", "S1"], sequence: 1 }).id, "H-S1S3-01");
  assert.equal(canonicalHypothesisId({ originType: ORIGIN_TYPE.MULTI_STRATEGY, strategyRefs: ["S1", "S3"], sequence: 1 }).id, "H-S1S3-01");
  assert.equal(canonicalHypothesisId({ originType: ORIGIN_TYPE.STRATEGY_DERIVED, strategyRefs: ["S2"], sequence: 1 }).id, "H-S2-01");
  assert.equal(canonicalHypothesisId({ originType: ORIGIN_TYPE.RESEARCH_DISCOVERY, strategyRefs: [], sequence: 1 }).id, "H-RD-01");
  assert.equal(canonicalHypothesisId({ originType: ORIGIN_TYPE.MULTI_STRATEGY, strategyRefs: ["S1"], sequence: 1 }).code, "MULTI_STRATEGY_NEEDS_MULTIPLE_REFS");
  assert.equal(canonicalHypothesisId({ originType: ORIGIN_TYPE.STRATEGY_DERIVED, strategyRefs: ["S1", "S3"], sequence: 1 }).code, "STRATEGY_DERIVED_NEEDS_ONE_REF");
  assert.equal(verifyCanonicalHypothesisId(H_S1_01).id, "H-S1-01");

  const thirdStrategy = identityFixture();
  assert.equal(thirdStrategy.hypothesisId, "H-S2-01");

  const vm = buildBacktestsViewModel();
  vm.semanticComparison = vm.semanticComparison.map((entry, index) => index === 0
    ? { ...entry, hypotheses: [thirdStrategy, H_RD_01] }
    : { ...entry, hypotheses: [] });
  const html = renderBacktestsPage(vm);
  assert.match(html, /H-S2-01 · Second Strategy Hypothesis/);
  assert.match(html, /H-RD-01 · Execution Hour/);
  assert.doesNotMatch(html, /ARM_C|ARM_A|ARM_B/);
});

test("ID04: one H-S1-01 ID with four independent mission configurations/evidence states", () => {
  const byMission = Object.fromEntries(MISSIONS.map(({ id }) => [id, quoteConfig(H_S1_01, id)]));
  for (const mission of MISSIONS) {
    assert.equal(byMission[mission.id].hypothesisId, "H-S1-01");
    assert.equal(byMission[mission.id].hypothesisVersion, H_S1_01.version);
    assert.equal(byMission[mission.id].missionId, mission.id);
    assert.equal(byMission[mission.id].candidateMission, MISSION_LABELS[mission.id]);
    assert.equal(byMission[mission.id].searchSpaceMission, MISSION_LABELS[mission.id]);
    assert.match(byMission[mission.id].configurationHash, /^[a-f0-9]{64}$/);
    assert.match(byMission[mission.id].candidateHash, /^[a-f0-9]{64}$/);
    assert.match(byMission[mission.id].searchSpaceHash, /^[a-f0-9]{64}$/);
  }
  const quarter = quoteConfig(H_S1_01, "GAS_QUARTERLY", { dataMode: "DEVELOPMENT", tau: "10:00", N: 3 });
  const month = quoteConfig(H_S1_01, "GAS_MONTHLY", { dataMode: "DEVELOPMENT", tau: "10:00", N: 3 });
  assert.notEqual(quarter.configurationHash, month.configurationHash);

  // Cross-mission substitution is rejected at configuration time: a Power
  // configuration cannot bind a Gas candidate/search space.
  const crossConfig = createMissionConfiguration({
    hypothesis: H_S1_01, missionId: "POWER_MONTHLY", configuration: { dataMode: "DEVELOPMENT" },
    searchSpace: searchSpaceFixture("GAS_QUARTERLY"), candidate: candidateFixture("GAS_QUARTERLY"),
  });
  assert.equal(crossConfig.ok, false);
  assert.equal(crossConfig.code, "CROSS_MISSION_CONFIGURATION");
  const declaredSubstitution = createMissionConfiguration({
    hypothesis: H_S1_01, missionId: "POWER_MONTHLY",
    configuration: { dataMode: "DEVELOPMENT", candidateMission: "Gas Quarterly", searchSpaceMission: "Gas Quarterly" },
    searchSpace: searchSpaceFixture("POWER_MONTHLY"), candidate: candidateFixture("POWER_MONTHLY"),
  });
  assert.equal(declaredSubstitution.ok, false);
  assert.equal(declaredSubstitution.code, "CROSS_MISSION_CONFIGURATION");

  // A configuration cannot declare tau/N other than the bound candidate's
  // (FIX07-PARAMETER-CANDIDATE).
  const parameterSubstitution = createMissionConfiguration({
    hypothesis: H_S1_01, missionId: "GAS_QUARTERLY",
    configuration: { dataMode: "DEVELOPMENT", tau: "11:00", N: 20 },
    searchSpace: searchSpaceFixture("GAS_QUARTERLY"), candidate: candidateFixture("GAS_QUARTERLY"),
  });
  assert.equal(parameterSubstitution.ok, false);
  assert.equal(parameterSubstitution.code, "PARAMETER_CANDIDATE_MISMATCH");

  // A candidate whose N was altered while keeping its original content hash is
  // not a source of truth: the configuration must reject it instead of
  // restating the tampered N (FIX07-PARAMETER-CANDIDATE).
  const validCandidate = candidateFixture("GAS_QUARTERLY");
  const tamperedCandidate = { ...validCandidate, N: 10 };
  const tamperedParameter = createMissionConfiguration({
    hypothesis: H_S1_01, missionId: "GAS_QUARTERLY",
    configuration: { dataMode: "DEVELOPMENT", N: 10 },
    searchSpace: searchSpaceFixture("GAS_QUARTERLY"), candidate: tamperedCandidate,
  });
  assert.equal(tamperedParameter.ok, false);
  assert.equal(tamperedParameter.code, "CANDIDATE_INTEGRITY");

  // A candidate created from the valid HYP-1 search space cannot authorize a
  // later mutation of that space under the same content hash.
  const validSearchSpace = searchSpaceFixture("GAS_QUARTERLY");
  const linkedCandidate = createHS1Candidate({
    searchSpace: validSearchSpace, tau: { zone: "UTC", localTime: "10:00" }, N: 3,
  });
  assert.equal(linkedCandidate.ok, true);
  const tamperedSearchSpace = { ...validSearchSpace, nGrid: [999] };
  const tamperedSpaceConfiguration = createMissionConfiguration({
    hypothesis: H_S1_01, missionId: "GAS_QUARTERLY",
    configuration: { dataMode: "DEVELOPMENT", tau: "10:00", N: 3 },
    searchSpace: tamperedSearchSpace, candidate: linkedCandidate.candidate,
  });
  assert.equal(tamperedSpaceConfiguration.ok, false);
  assert.equal(tamperedSpaceConfiguration.code, "SEARCH_SPACE_INTEGRITY");

  // Rehashing both artifacts after replacing the search space's source hash
  // preserves their internal integrity, but no longer links them to HYP-1.
  const { contentHash: _spaceHash, ...spaceCore } = validSearchSpace;
  const wrongSpaceCore = { ...spaceCore, hypothesisHash: sha("e") };
  const wrongSpace = { ...wrongSpaceCore, contentHash: contentHashOf(wrongSpaceCore) };
  const { contentHash: _candidateHash, ...candidateCore } = linkedCandidate.candidate;
  const relinkedCandidateCore = { ...candidateCore, searchSpaceHash: wrongSpace.contentHash };
  const relinkedCandidate = { ...relinkedCandidateCore, contentHash: contentHashOf(relinkedCandidateCore) };
  const wrongSourceConfiguration = createMissionConfiguration({
    hypothesis: H_S1_01, missionId: "GAS_QUARTERLY",
    configuration: { dataMode: "DEVELOPMENT", tau: "10:00", N: 3 },
    searchSpace: wrongSpace, candidate: relinkedCandidate,
  });
  assert.equal(wrongSourceConfiguration.code, "HYPOTHESIS_DEFINITION_MISMATCH");
  assert.equal(wrongSourceConfiguration.field, "searchSpace");

  // The candidate must independently claim the same accepted definition.
  const wrongCandidateCore = { ...candidateCore, hypothesisHash: sha("e") };
  const wrongCandidate = { ...wrongCandidateCore, contentHash: contentHashOf(wrongCandidateCore) };
  const wrongCandidateConfiguration = createMissionConfiguration({
    hypothesis: H_S1_01, missionId: "GAS_QUARTERLY",
    configuration: { dataMode: "DEVELOPMENT", tau: "10:00", N: 3 },
    searchSpace: validSearchSpace, candidate: wrongCandidate,
  });
  assert.equal(wrongCandidateConfiguration.code, "HYPOTHESIS_DEFINITION_MISMATCH");
  assert.equal(wrongCandidateConfiguration.field, "candidate");

  assert.equal(evaluateHypothesisStatus({ hypothesis: H_S1_01, configuration: quarter }).state, "UNTESTED");
  assert.equal(evaluateHypothesisStatus({ hypothesis: H_S1_01, configuration: quarter, evidence: null }).reason, "NO_EVIDENCE");

  const experiment = experimentFixture(quarter);
  assert.equal(evaluateHypothesisStatus({ hypothesis: H_S1_01, configuration: quarter, evidence: evidenceFixture(quarter), experiment }).state, "TESTED");

  // CONTROL must belong to the same campaign as the binding, otherwise the run
  // is not evidence for this campaign (FIX07-CONTROL-CAMPAIGN).
  const otherCampaignControl = controlFor({ hypothesisId: "H-S1-01", runId: "run-1", populationId: "pop-1", campaignId: "other-campaign", obligationId: "obl-1", calendarVersion: "cal-1", sizingVersion: "sz-1", executionVersion: "ex-1", benchmarkVersion: "bm-1", artifactSha256: sha("c") });
  assert.equal(createExperimentBinding({ hypothesis: H_S1_01, configuration: quarter, experimentId: "exp-1", campaignId: "target-campaign", runId: "run-1", technicalArmId: "arm-1", control: otherCampaignControl }).code, "INVALID_CONTROL_BINDING");

  // A hypothesis experiment is always paired with its CONTROL: a binding
  // without CONTROL is rejected, and even a forged binding without CONTROL
  // cannot prove TESTED (FIX07-MISSING-CONTROL).
  const missingControl = createExperimentBinding({ hypothesis: H_S1_01, configuration: quarter, experimentId: "exp-1", campaignId: "camp-1", runId: "run-1", technicalArmId: "arm-1" });
  assert.equal(missingControl.ok, false);
  assert.equal(missingControl.code, "MISSING_CONTROL_BINDING");
  const forgedBinding = {
    ok: true,
    binding: { experimentId: "exp-1", runId: "run-1", hypothesisId: "H-S1-01", missionId: "GAS_QUARTERLY", configurationHash: quarter.configurationHash, campaignId: "camp-1", control: null },
  };
  const noControl = evaluateHypothesisStatus({ hypothesis: H_S1_01, configuration: quarter, evidence: evidenceFixture(quarter), experiment: forgedBinding });
  assert.equal(noControl.state, "HOLD");
  assert.ok(noControl.mismatched.includes("control"));

  // An unbound run with a shape-valid SHA is not tested evidence (FIX07-EVIDENCE-RUN).
  const unbound = evaluateHypothesisStatus({
    hypothesis: H_S1_01, configuration: quarter,
    evidence: { hypothesisId: "H-S1-01", hypothesisVersion: H_S1_01.version, missionId: "GAS_QUARTERLY", configurationHash: quarter.configurationHash, runId: "unbound-run", artifactSha256: sha("d"), comparabilityStatus: "COMPARABLE" },
  });
  assert.equal(unbound.state, "HOLD");
  assert.ok(unbound.mismatched.includes("experimentId"));
  assert.ok(unbound.mismatched.includes("provenance"));
  // Evidence whose experiment binding does not match the run stays HOLD.
  const wrongExperiment = evaluateHypothesisStatus({ hypothesis: H_S1_01, configuration: quarter, evidence: evidenceFixture(quarter, { runId: "other-run" }), experiment });
  assert.equal(wrongExperiment.state, "HOLD");
  assert.ok(wrongExperiment.mismatched.includes("experiment"));

  // Cross-mission evidence is rejected: Gas evidence cannot test Power.
  const crossMission = evaluateHypothesisStatus({ hypothesis: H_S1_01, configuration: quoteConfig(H_S1_01, "POWER_QUARTERLY"), evidence: evidenceFixture(quarter), experiment });
  assert.equal(crossMission.state, "HOLD");
  assert.ok(crossMission.mismatched.includes("configurationHash"));
  assert.ok(crossMission.mismatched.includes("missionId"));
  // Mission is not encoded in the ID, so different missions never mint new IDs.
  assert.equal(quarter.hypothesisId, byMission.POWER_MONTHLY.hypothesisId);
  // H-RD-01 has no declared applicable mission yet.
  assert.equal(createMissionConfiguration({ hypothesis: H_RD_01, missionId: "GAS_QUARTERLY", configuration: { dataMode: "DEVELOPMENT" } }).code, "MISSION_NOT_APPLICABLE");
});

test("ID05: legacy aliases are provenance-bound and cannot fabricate new-version evidence", () => {
  const artifactSha256 = sha("e");
  const mapping = { alias: "DIP10", artifactSha256, protocolVersion: "P5-v1", hypothesisId: "H-S1-01", runId: "legacy-run", provenance: "receipt" };
  assert.equal(resolveLegacyHypothesisAlias({ alias: "DIP10", artifactSha256, protocolVersion: "P5-v1" }).code, "UNBOUND_LEGACY_ALIAS");
  assert.equal(resolveLegacyHypothesisAlias({ alias: "DIP10", artifactSha256: sha("f"), protocolVersion: "P5-v1", mapping }).code, "UNBOUND_LEGACY_ALIAS");
  assert.equal(resolveLegacyHypothesisAlias({ alias: "DIP10", artifactSha256, protocolVersion: "P6", mapping }).code, "UNBOUND_LEGACY_ALIAS");
  assert.equal(resolveLegacyHypothesisAlias({ alias: "DIP10", artifactSha256, protocolVersion: "P5-v1", mapping: { ...mapping, hypothesisId: "H-RD-01" } }).code, "UNBOUND_LEGACY_ALIAS");
  // A bare alias with a hash and no run-scoped provenance is not provenance.
  assert.equal(resolveLegacyHypothesisAlias({ alias: "DIP10", artifactSha256, protocolVersion: "P5-v1", mapping: { alias: "DIP10", artifactSha256, protocolVersion: "P5-v1", hypothesisId: "H-S1-01" } }).code, "UNBOUND_LEGACY_ALIAS");
  assert.equal(resolveLegacyHypothesisAlias({ alias: "DIP10", artifactSha256, protocolVersion: "P5-v1", mapping: { alias: "DIP10", artifactSha256, protocolVersion: "P5-v1", hypothesisId: "H-S1-01", runId: "legacy-run" } }).code, "UNBOUND_LEGACY_ALIAS");
  assert.equal(resolveLegacyHypothesisAlias({ alias: "HOUR", artifactSha256, protocolVersion: "P5-v1", mapping: { ...mapping, alias: "HOUR", hypothesisId: "H-RD-01" } }).hypothesisId, "H-RD-01");

  // A0 must never map to the active hypothesis or CLIENT; it stays a replay arm.
  assert.equal(resolveLegacyAlias({ alias: "A0", artifactSha256, protocolVersion: "P5-v1", mapping: { ...mapping, alias: "A0", kind: "HYPOTHESIS" } }).ok, false);
  assert.equal(resolveLegacyAlias({ alias: "A0", artifactSha256, protocolVersion: "P5-v1", mapping: { ...mapping, alias: "A0", kind: "CLIENT" } }).ok, false);
  assert.equal(resolveLegacyHypothesisAlias({ alias: "DIP10", artifactSha256, protocolVersion: "P5-v1", mapping: { ...mapping, kind: IDENTITY.CLIENT } }).code, "LEGACY_ALIAS_CANNOT_BE_CLIENT");
  assert.equal(resolveLegacyHypothesisAlias({ alias: "DIP10", artifactSha256, protocolVersion: "P5-v1", mapping: { ...mapping, evidenceStatus: "TESTED" } }).code, "LEGACY_ALIAS_CANNOT_FABRICATE_EVIDENCE");

  const resolved = resolveLegacyHypothesisAlias({ alias: "DIP10", artifactSha256, protocolVersion: "P5-v1", mapping });
  assert.equal(resolved.evidenceStatus, "PROVENANCE_ONLY");
  assert.equal(resolved.tested, false);
  assert.equal(resolved.runnable, false);
  assert.equal(resolved.sizingParityClaim, false);
  assert.equal(resolved.runId, "legacy-run");
  // The mapping is read-only provenance: no mutation of the source.
  assert.deepEqual(mapping, { alias: "DIP10", artifactSha256, protocolVersion: "P5-v1", hypothesisId: "H-S1-01", runId: "legacy-run", provenance: "receipt" });

  // Legacy DIP10 evidence with different sizing cannot test the new version.
  const quarter = quoteConfig();
  const legacyEvidence = { hypothesisId: "H-S1-01", hypothesisVersion: "DIP10", missionId: "GAS_QUARTERLY", runId: "legacy-run", artifactSha256, comparabilityStatus: "COMPARABLE", sizingMw: 12 };
  const status = evaluateHypothesisStatus({ hypothesis: H_S1_01, configuration: quarter, evidence: legacyEvidence, experiment: experimentFixture(quarter) });
  assert.equal(status.state, "HOLD");
  assert.ok(status.mismatched.includes("hypothesisVersion"));
  assert.ok(status.mismatched.includes("configurationHash"));
});

test("ID06: CLIENT/BENCHMARK/hypotheses boundaries hold and legacy names are not primary", () => {
  const vm = buildBacktestsViewModel();
  const html = renderBacktestsPage(vm);
  const start = html.indexOf('data-semantic="SEM-1/2026-09-28/v1"');
  const end = html.indexOf('data-kind="current-backtest-panels"');
  const primary = html.slice(start, end);
  assert.doesNotMatch(primary, /Arm A|Arm B|ARM_A|ARM_B|ARM_C|BASELINE|B\*/);
  assert.doesNotMatch(primary, /DIP10(?! ·)|HOUR/);
  assert.match(primary, /data-identity="CLIENT"/);
  assert.match(primary, /data-identity="BENCHMARK"/);
  assert.match(primary, /data-identity="HYPOTHESIS"/);
  assert.match(html, /<details data-semantic="legacy-provenance"/);

  // The current TRADES panels themselves must carry canonical identity, not
  // legacy arm names (FIX07-PRIMARY-LABELS).
  const canonicalVms = buildUiViewModels(loadCanonicalUiInputs().inputs);
  const trades = renderSurfacePage("backtests", canonicalVms.backtests, { mode: "TRADES", missionId: "GAS_QUARTERLY", period: "PUENTE" });
  const panelsStart = trades.indexOf('data-kind="current-backtest-panels"');
  const legacyStart = trades.indexOf('<details data-semantic="legacy-provenance"', panelsStart);
  const currentPanels = trades.slice(panelsStart, legacyStart);
  assert.ok(currentPanels.includes('data-tr07="arms"'), "arms table remains a current panel");
  assert.doesNotMatch(currentPanels, /Arm A|Arm B|DIP10|· hour/);
  assert.match(currentPanels, /CONTROL · 11:00/);
  assert.match(currentPanels, /H-S1-01 · Session-Anchored Rolling Reference/);
  assert.match(currentPanels, /H-RD-01 · Execution Hour/);

  const rd = resolveLegacyHypothesisAlias({ alias: "ARM_B", artifactSha256: sha("a"), protocolVersion: "P5-v1", mapping: { alias: "ARM_B", artifactSha256: sha("a"), protocolVersion: "P5-v1", hypothesisId: "H-RD-01", runId: "r", provenance: "receipt" } });
  assert.equal(rd.kind, "LEGACY_HYPOTHESIS_PROVENANCE");
  assert.equal(rd.hypothesisId, "H-RD-01");
});

test("ID07: versioning separates recalibration from a materially different proposition", () => {
  const v1 = identityFixture({ version: "H-S2-01/phase-A/v1" });
  const recalculated = identityFixture({ version: "H-S2-01/phase-A/v2" });
  const recalibration = classifyHypothesisChange({ prior: v1, next: recalculated });
  assert.equal(recalibration.kind, "RECALIBRATION");
  assert.equal(recalibration.hypothesisId, "H-S2-01");
  assert.equal(recalibration.supersedes.version, "H-S2-01/phase-A/v1");

  // A transition with no version advance is not a recalibration (FIX07-VERSION-ADVANCE).
  assert.equal(classifyHypothesisChange({ prior: v1, next: v1 }).code, "NO_VERSION_ADVANCE");
  // A version rollback is not a recalibration either (FIX07-BACKWARD-VERSION).
  assert.equal(classifyHypothesisChange({ prior: recalculated, next: v1 }).code, "VERSION_ROLLBACK");
  // Two spellings with the same ordinal do not advance the version
  // (FIX07-EQUAL-VERSION-ORDINAL).
  const sameOrdinal = identityFixture({ version: "H-S2-01/phase-A/v02" });
  assert.equal(classifyHypothesisChange({ prior: recalculated, next: sameOrdinal }).code, "NO_VERSION_ADVANCE");
  assert.notEqual(classifyHypothesisChange({ prior: recalculated, next: sameOrdinal }).kind, "RECALIBRATION");

  const sameIdDifferentQuestion = identityFixture({ version: "H-S2-01/phase-A/v2", question: "A materially different question?" });
  assert.equal(classifyHypothesisChange({ prior: v1, next: sameIdDifferentQuestion }).code, "MATERIAL_CHANGE_NEEDS_NEW_ID");
  assert.equal(classifyHypothesisChange({ prior: v1, next: recalculated }).ok, true);

  // A proposed H-S1-01 recalibration may keep its identity, but the current
  // HYP-1 source cannot authorize a new version's mission/run binding.
  const proposedH1 = createHypothesisIdentity({
    originType: ORIGIN_TYPE.STRATEGY_DERIVED, strategyRefs: ["S1"], sequence: 1,
    name: H_S1_01.name, question: H_S1_01.question, version: "H-S1-01/phase-A/v2",
    missions: [...H_S1_01.missions], provenance: H_S1_01.provenance,
  }).identity;
  assert.equal(isCanonicalHypothesisRecord(proposedH1).ok, true);
  assert.equal(createMissionConfiguration({
    hypothesis: proposedH1, missionId: "GAS_QUARTERLY",
    configuration: { dataMode: "DEVELOPMENT", tau: "10:00", N: 3 },
    searchSpace: searchSpaceFixture("GAS_QUARTERLY"), candidate: candidateFixture("GAS_QUARTERLY"),
  }).code, "UNBOUND_HYPOTHESIS_DEFINITION");

  const otherQuestion = identityFixture({ strategyRefs: ["S3"], version: "H-S3-01/phase-A/v1", question: "A different question from S3?" });
  const newProposition = classifyHypothesisChange({ prior: v1, next: otherQuestion });
  assert.equal(newProposition.kind, "NEW_PROPOSITION");
  assert.equal(newProposition.supersedes.hypothesisId, "H-S2-01");
  assert.equal(newProposition.canonical.hypothesisId, "H-S3-01");
  const sameQuestionNewId = identityFixture({ strategyRefs: ["S3"], version: "H-S3-01/phase-A/v1", question: v1.question });
  assert.equal(classifyHypothesisChange({ prior: v1, next: sameQuestionNewId }).code, "RECALIBRATION_MUST_KEEP_ID");

  const quarter = quoteConfig();
  const { configurationHash: _oldConfigurationHash, ...quarterCore } = quarter;
  const unsupportedVersionCore = { ...quarterCore, hypothesisVersion: proposedH1.version };
  const unsupportedVersionConfig = {
    ...unsupportedVersionCore, configurationHash: contentHashOf(unsupportedVersionCore),
  };
  assert.equal(evaluateHypothesisStatus({ hypothesis: proposedH1, configuration: unsupportedVersionConfig }).code, "UNBOUND_HYPOTHESIS_DEFINITION");
  assert.equal(createExperimentBinding({
    hypothesis: proposedH1, configuration: unsupportedVersionConfig,
    experimentId: "exp-1", campaignId: "camp-1", runId: "run-1", technicalArmId: "arm-1",
  }).code, "UNBOUND_HYPOTHESIS_DEFINITION");
  const mismatchedVersion = evaluateHypothesisStatus({ hypothesis: H_S1_01, configuration: quarter, evidence: { hypothesisId: "H-S1-01", hypothesisVersion: "H-S1-01/phase-A/v0", missionId: "GAS_QUARTERLY", runId: "r", artifactSha256: sha("d"), comparabilityStatus: "COMPARABLE" } });
  assert.equal(mismatchedVersion.state, "HOLD");
  assert.ok(mismatchedVersion.mismatched.includes("hypothesisVersion"));

  const tampered = { ...quarter, configurationHash: sha("0") };
  assert.equal(evaluateHypothesisStatus({ hypothesis: H_S1_01, configuration: tampered }).code, "CONFIGURATION_INTEGRITY");
  assert.equal(createExperimentBinding({ hypothesis: H_S1_01, configuration: tampered, experimentId: "exp-1", campaignId: "camp-1", runId: "run-1", technicalArmId: "arm-1" }).code, "CONFIGURATION_INTEGRITY");
});

test("ID08: single experiment binding keeps every entity distinct for BT-08/UI-08", () => {
  const configuration = quoteConfig(H_S1_01, "GAS_QUARTERLY");
  const runId = "run-1";
  const control = controlFor({ hypothesisId: "H-S1-01", runId, populationId: "pop-1", campaignId: "camp-1", obligationId: "obl-1", calendarVersion: "cal-1", sizingVersion: "sz-1", executionVersion: "ex-1", benchmarkVersion: "bm-1", artifactSha256: sha("c") });
  const bound = createExperimentBinding({ hypothesis: H_S1_01, configuration, experimentId: "exp-1", campaignId: "camp-1", control, technicalArmId: "arm-1", runId });
  assert.equal(bound.ok, true);
  for (const field of ["hypothesisId", "hypothesisVersion", "strategyRefs", "originType", "missionId", "campaignId", "configurationHash", "candidateMission", "searchSpaceMission", "candidateHash", "searchSpaceHash", "experimentId", "runId", "technicalArmId", "control"]) {
    assert.ok(Object.hasOwn(bound.binding, field), `missing ${field}`);
  }
  assert.equal(bound.binding.hypothesisId, "H-S1-01");
  assert.equal(bound.binding.campaignId, "camp-1");
  assert.equal(bound.binding.control.kind, IDENTITY.CONTROL);

  // A shape-valid but wrong configuration hash is rejected, and campaign and
  // candidate references are required (FIX07-EXPERIMENT-BINDING).
  assert.equal(createExperimentBinding({ hypothesis: H_S1_01, configuration: { ...configuration, configurationHash: sha("9") }, experimentId: "exp-1", campaignId: "camp-1", runId, technicalArmId: "arm-1" }).code, "CONFIGURATION_INTEGRITY");
  assert.equal(createExperimentBinding({ hypothesis: H_S1_01, configuration, experimentId: "exp-1", runId, technicalArmId: "arm-1" }).code, "MISSING_CAMPAIGN_ID");
  const { configurationHash: _unused, ...configCore } = configuration;
  const noCandidateCore = { ...configCore };
  delete noCandidateCore.candidateHash;
  const noCandidate = { ...noCandidateCore, configurationHash: contentHashOf(noCandidateCore) };
  assert.equal(createExperimentBinding({ hypothesis: H_S1_01, configuration: noCandidate, experimentId: "exp-1", campaignId: "camp-1", runId, technicalArmId: "arm-1" }).code, "MISSING_CANDIDATE_BINDING");

  assert.equal(createExperimentBinding({ hypothesis: H_S1_01, configuration, experimentId: "exp-1", campaignId: "camp-1", runId, technicalArmId: "H-S1-01" }).code, "IDENTITY_COLLISION");
  assert.equal(createExperimentBinding({ hypothesis: H_S1_01, configuration, experimentId: "exp-1", campaignId: "camp-1", runId, technicalArmId: "arm-1", control: { ok: true, kind: IDENTITY.CONTROL, hypothesisId: "H-RD-01", runId, artifactSha256: sha("c") } }).code, "INVALID_CONTROL_BINDING");
  const orphanConfiguration = { artifactKind: "HYPOTHESIS_MISSION_CONFIGURATION", hypothesisId: H_RD_01.hypothesisId, hypothesisVersion: H_RD_01.version, missionId: "GAS_QUARTERLY", configurationHash: sha("1") };
  assert.equal(createExperimentBinding({ hypothesis: H_RD_01, configuration: orphanConfiguration, experimentId: "exp-1", campaignId: "camp-1", runId, technicalArmId: "arm-1" }).code, "INVALID_CONFIGURATION_BINDING");
  assert.equal(createExperimentBinding({ hypothesis: H_S1_01, configuration, experimentId: "exp-1", campaignId: "camp-1", runId: "", technicalArmId: "arm-1" }).code, "MISSING_RUN_ID");
});
