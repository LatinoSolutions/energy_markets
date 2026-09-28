import test from "node:test";
import assert from "node:assert/strict";
import {
  IDENTITY, MISSIONS, H_S1_01, H_RD_01, HYPOTHESIS_BY_ID, ORIGIN_TYPE,
  canonicalHypothesisId, canonicalStrategyRefs, verifyCanonicalHypothesisId,
  isCanonicalHypothesisRecord, createHypothesisIdentity, createMissionConfiguration,
  evaluateHypothesisStatus, classifyHypothesisChange, resolveLegacyAlias,
  resolveLegacyHypothesisAlias, createExperimentBinding, controlFor,
} from "../../src/backtesting-semantics/contract.mjs";
import { H_S1_01 as HYP1_H_S1_01, H_S1_01_MISSIONS } from "../../src/s1-strategy/h-s1-01.mjs";
import { buildBacktestsViewModel } from "../../src/ui/view-models.mjs";
import { renderBacktestsPage } from "../../src/ui/render.mjs";

const sha = (char) => char.repeat(64);

function identityFixture({ strategyRefs = ["S2"], sequence = 1, name = "Second Strategy Hypothesis", question = "Does the second Strategy improve timing?", version = "H-S2-01/phase-A/v1", missions = ["GAS_QUARTERLY"] } = {}) {
  return createHypothesisIdentity({
    originType: ORIGIN_TYPE.STRATEGY_DERIVED, strategyRefs, sequence, name, question, version,
    missions, provenance: { authority: "test-owner", locator: "test/fixture" },
  }).identity;
}

function quoteConfig(hypothesis = H_S1_01, missionId = "GAS_QUARTERLY", configuration = { dataMode: "DEVELOPMENT", tau: "11:00", N: 10 }) {
  return createMissionConfiguration({ hypothesis, missionId, configuration }).configuration;
}

test("ID01: identity schema rejects missing/conflicting bindings and consumes the accepted HYP-1 source", () => {
  const base = { originType: ORIGIN_TYPE.STRATEGY_DERIVED, strategyRefs: ["S1"], sequence: 1, question: "q", version: "v", missions: ["GAS_QUARTERLY"], provenance: { authority: "a", locator: "l" } };
  assert.equal(createHypothesisIdentity({ ...base, name: "" }).ok, false);
  assert.ok(createHypothesisIdentity({ ...base, name: "" }).errors.some((error) => error.field === "name"));
  assert.equal(createHypothesisIdentity({ ...base, name: "n", question: "" }).ok, false);
  assert.equal(createHypothesisIdentity({ ...base, name: "n", missions: ["NOT_A_MISSION"] }).ok, false);
  assert.equal(createHypothesisIdentity({ ...base, name: "n", provenance: null }).ok, false);
  assert.equal(createHypothesisIdentity({ ...base, name: "n", hypothesisId: "H-S9-99" }).ok, false);

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
    assert.match(byMission[mission.id].configurationHash, /^[a-f0-9]{64}$/);
  }
  const quarter = quoteConfig(H_S1_01, "GAS_QUARTERLY", { dataMode: "DEVELOPMENT", tau: "11:00", N: 10 });
  const month = quoteConfig(H_S1_01, "GAS_MONTHLY", { dataMode: "DEVELOPMENT", tau: "11:00", N: 10 });
  assert.notEqual(quarter.configurationHash, month.configurationHash);

  assert.equal(evaluateHypothesisStatus({ hypothesis: H_S1_01, configuration: quarter }).state, "UNTESTED");
  assert.equal(evaluateHypothesisStatus({ hypothesis: H_S1_01, configuration: quarter, evidence: null }).reason, "NO_EVIDENCE");

  const evidence = (overrides = {}) => ({ hypothesisId: "H-S1-01", hypothesisVersion: H_S1_01.version, missionId: "GAS_QUARTERLY", configurationHash: quarter.configurationHash, runId: "run-1", artifactSha256: sha("d"), comparabilityStatus: "COMPARABLE", ...overrides });
  assert.equal(evaluateHypothesisStatus({ hypothesis: H_S1_01, configuration: quarter, evidence: evidence() }).state, "TESTED");
  // Cross-mission substitution is rejected: Gas evidence cannot test Power.
  const crossMission = evaluateHypothesisStatus({ hypothesis: H_S1_01, configuration: quoteConfig(H_S1_01, "POWER_QUARTERLY"), evidence: evidence() });
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
  const mapping = { alias: "DIP10", artifactSha256, protocolVersion: "P5-v1", hypothesisId: "H-S1-01", provenance: "receipt" };
  assert.equal(resolveLegacyHypothesisAlias({ alias: "DIP10", artifactSha256, protocolVersion: "P5-v1" }).code, "UNBOUND_LEGACY_ALIAS");
  assert.equal(resolveLegacyHypothesisAlias({ alias: "DIP10", artifactSha256: sha("f"), protocolVersion: "P5-v1", mapping }).code, "UNBOUND_LEGACY_ALIAS");
  assert.equal(resolveLegacyHypothesisAlias({ alias: "DIP10", artifactSha256, protocolVersion: "P6", mapping }).code, "UNBOUND_LEGACY_ALIAS");
  assert.equal(resolveLegacyHypothesisAlias({ alias: "DIP10", artifactSha256, protocolVersion: "P5-v1", mapping: { ...mapping, hypothesisId: "H-RD-01" } }).code, "UNBOUND_LEGACY_ALIAS");
  assert.equal(resolveLegacyHypothesisAlias({ alias: "HOUR", artifactSha256, protocolVersion: "P5-v1", mapping: { ...mapping, alias: "HOUR", hypothesisId: "H-RD-01" } }).hypothesisId, "H-RD-01");

  // A0 must never map to the active hypothesis or CLIENT; it stays a replay arm.
  assert.equal(resolveLegacyAlias({ alias: "A0", artifactSha256, protocolVersion: "P5-v1", mapping: { ...mapping, alias: "A0", kind: "HYPOTHESIS", runId: "r1" } }).ok, false);
  assert.equal(resolveLegacyAlias({ alias: "A0", artifactSha256, protocolVersion: "P5-v1", mapping: { ...mapping, alias: "A0", kind: "CLIENT", runId: "r1" } }).ok, false);
  assert.equal(resolveLegacyHypothesisAlias({ alias: "DIP10", artifactSha256, protocolVersion: "P5-v1", mapping: { ...mapping, kind: IDENTITY.CLIENT } }).code, "LEGACY_ALIAS_CANNOT_BE_CLIENT");
  assert.equal(resolveLegacyHypothesisAlias({ alias: "DIP10", artifactSha256, protocolVersion: "P5-v1", mapping: { ...mapping, evidenceStatus: "TESTED" } }).code, "LEGACY_ALIAS_CANNOT_FABRICATE_EVIDENCE");

  const resolved = resolveLegacyHypothesisAlias({ alias: "DIP10", artifactSha256, protocolVersion: "P5-v1", mapping });
  assert.equal(resolved.evidenceStatus, "PROVENANCE_ONLY");
  assert.equal(resolved.tested, false);
  assert.equal(resolved.runnable, false);
  assert.equal(resolved.sizingParityClaim, false);
  // The mapping is read-only provenance: no mutation of the source.
  assert.deepEqual(mapping, { alias: "DIP10", artifactSha256, protocolVersion: "P5-v1", hypothesisId: "H-S1-01", provenance: "receipt" });

  // Legacy DIP10 evidence with different sizing cannot test the new version.
  const quarter = quoteConfig();
  const legacyEvidence = { hypothesisId: "H-S1-01", hypothesisVersion: "DIP10", missionId: "GAS_QUARTERLY", runId: "legacy-run", artifactSha256, comparabilityStatus: "COMPARABLE", sizingMw: 12 };
  const status = evaluateHypothesisStatus({ hypothesis: H_S1_01, configuration: quarter, evidence: legacyEvidence });
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

  const rd = resolveLegacyHypothesisAlias({ alias: "ARM_B", artifactSha256: sha("a"), protocolVersion: "P5-v1", mapping: { alias: "ARM_B", artifactSha256: sha("a"), protocolVersion: "P5-v1", hypothesisId: "H-RD-01" } });
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

  const sameIdDifferentQuestion = identityFixture({ version: "H-S2-01/phase-A/v2", question: "A materially different question?" });
  assert.equal(classifyHypothesisChange({ prior: v1, next: sameIdDifferentQuestion }).code, "MATERIAL_CHANGE_NEEDS_NEW_ID");
  assert.equal(classifyHypothesisChange({ prior: v1, next: recalculated }).ok, true);

  const otherQuestion = identityFixture({ strategyRefs: ["S3"], version: "H-S3-01/phase-A/v1", question: "A different question from S3?" });
  const newProposition = classifyHypothesisChange({ prior: v1, next: otherQuestion });
  assert.equal(newProposition.kind, "NEW_PROPOSITION");
  assert.equal(newProposition.supersedes.hypothesisId, "H-S2-01");
  assert.equal(newProposition.canonical.hypothesisId, "H-S3-01");
  const sameQuestionNewId = identityFixture({ strategyRefs: ["S3"], version: "H-S3-01/phase-A/v1", question: v1.question });
  assert.equal(classifyHypothesisChange({ prior: v1, next: sameQuestionNewId }).code, "RECALIBRATION_MUST_KEEP_ID");

  const quarter = quoteConfig();
  const mismatchedVersion = evaluateHypothesisStatus({ hypothesis: H_S1_01, configuration: quarter, evidence: { hypothesisId: "H-S1-01", hypothesisVersion: "H-S1-01/phase-A/v0", missionId: "GAS_QUARTERLY", runId: "r", artifactSha256: sha("d"), comparabilityStatus: "COMPARABLE" } });
  assert.equal(mismatchedVersion.state, "HOLD");
  assert.ok(mismatchedVersion.mismatched.includes("hypothesisVersion"));

  const tampered = { ...quarter, configurationHash: sha("0") };
  assert.equal(evaluateHypothesisStatus({ hypothesis: H_S1_01, configuration: tampered }).code, "CONFIGURATION_INTEGRITY");
});

test("ID08: single experiment binding keeps every entity distinct for BT-08/UI-08", () => {
  const configuration = quoteConfig(H_S1_01, "GAS_QUARTERLY");
  const runId = "run-1";
  const control = controlFor({ hypothesisId: "H-S1-01", runId, populationId: "pop-1", campaignId: "camp-1", obligationId: "obl-1", calendarVersion: "cal-1", sizingVersion: "sz-1", executionVersion: "ex-1", benchmarkVersion: "bm-1", artifactSha256: sha("c") });
  const bound = createExperimentBinding({ hypothesis: H_S1_01, configuration, experimentId: "exp-1", control, technicalArmId: "arm-1", runId });
  assert.equal(bound.ok, true);
  for (const field of ["hypothesisId", "hypothesisVersion", "strategyRefs", "originType", "missionId", "configurationHash", "experimentId", "runId", "technicalArmId", "control"]) {
    assert.ok(Object.hasOwn(bound.binding, field), `missing ${field}`);
  }
  assert.equal(bound.binding.hypothesisId, "H-S1-01");
  assert.equal(bound.binding.control.kind, IDENTITY.CONTROL);

  assert.equal(createExperimentBinding({ hypothesis: H_S1_01, configuration, experimentId: "exp-1", runId, technicalArmId: "H-S1-01" }).code, "IDENTITY_COLLISION");
  assert.equal(createExperimentBinding({ hypothesis: H_S1_01, configuration, experimentId: "exp-1", runId, technicalArmId: "arm-1", control: { ok: true, kind: IDENTITY.CONTROL, hypothesisId: "H-RD-01", runId, artifactSha256: sha("c") } }).code, "INVALID_CONTROL_BINDING");
  const orphanConfiguration = { artifactKind: "HYPOTHESIS_MISSION_CONFIGURATION", hypothesisId: H_RD_01.hypothesisId, hypothesisVersion: H_RD_01.version, missionId: "GAS_QUARTERLY", configurationHash: sha("1") };
  assert.equal(createExperimentBinding({ hypothesis: H_RD_01, configuration: orphanConfiguration, experimentId: "exp-1", runId, technicalArmId: "arm-1" }).code, "INVALID_CONFIGURATION_BINDING");
  assert.equal(createExperimentBinding({ hypothesis: H_S1_01, configuration, experimentId: "exp-1", runId: "", technicalArmId: "arm-1" }).code, "MISSING_RUN_ID");
});
