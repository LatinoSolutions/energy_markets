import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

import { controlFor, compareAblation, H_S1_01, H_RD_01 } from "../../src/backtesting-semantics/contract.mjs";
import { adaptLegacyExploratoryArtifact } from "../../src/backtesting-semantics/legacy-compat.mjs";
import { buildCanonicalSemanticsProjection } from "../../src/backtesting-semantics/projection.mjs";
import { boundDevelopmentResult } from "./sem3-fixture.mjs";

const hashOf = (bytes) => createHash("sha256").update(bytes).digest("hex");

test("SEM3-BE01..04: verified legacy bytes stay historical; current Client and experiment state are independent", () => {
  const bytes = JSON.stringify({
    artifactKind: "EXPLORATORY_BACKTEST_RESULTS", status: "EXPLORATORY",
    research: { candidates: [{ id: "A0", armId: "BASELINE" }, { id: "DIP10", armId: "ARM_A" }, { id: "HOUR", armId: "ARM_B" }] },
    results: [{ arms: { "A0@11:00/CLIENT": {}, "DIP10@11:00/CLIENT": {} } }],
  });
  const sha256 = hashOf(bytes);
  const provenance = { release: "v2", resultsPath: "operations/exploratory/v2/backtest-results.json", resultsSha256: sha256 };
  const adapter = adaptLegacyExploratoryArtifact({ provenance, artifact: bytes });
  assert.equal(adapter.ok, true);
  const unrelated = '{"artifactKind":"EXPLORATORY_BACKTEST_RESULTS","status":"EXPLORATORY"}';
  assert.equal(adaptLegacyExploratoryArtifact({ provenance: { ...provenance, resultsSha256: hashOf(unrelated) }, artifact: unrelated }).code, "LEGACY_ARTIFACT_SCHEMA_INVALID");
  assert.deepEqual(adapter.rawSourceKeys, ["A0@11:00/CLIENT", "DIP10@11:00/CLIENT"]);
  assert.equal(hashOf(bytes), sha256, "source bytes remain unchanged");
  assert.equal(adapter.roles.BASELINE.historicalKind, "CALENDAR_COMPARATOR");
  assert.equal(adapter.roles.BASELINE.identity, undefined);
  assert.equal(adapter.roles.BASELINE.hypothesisId, undefined);
  assert.equal(adapter.roles.BASELINE.clientEquivalent, false);
  assert.equal(adapter.roles.ARM_A.lineageOf, "H-S1-01");
  assert.equal(adapter.roles.ARM_B.lineageOf, "H-RD-01");
  for (const role of Object.values(adapter.roles)) {
    assert.equal(role.identity, undefined);
    assert.equal(role.tested, false);
    assert.equal(role.current, false);
    assert.equal(role.runnable, false);
  }
  const projection = buildCanonicalSemanticsProjection({});
  assert.equal(projection.current.clientsByMission.GAS_QUARTERLY.kind, "CLIENT");
  assert.equal(projection.current.clientsByMission.GAS_QUARTERLY.confirmed.purchaseTime, "11:00");
  assert.equal(projection.current.clientsByMission.GAS_QUARTERLY.confirmed.timezone, "Europe/Berlin");
  assert.deepEqual(Object.values(projection.current.clientsByMission.GAS_QUARTERLY.unknown), Array(5).fill("UNKNOWN"));
  assert.equal(projection.current.experiments.GAS_QUARTERLY["H-S1-01"].status, "UNBOUND");
  assert.equal(projection.current.experiments.GAS_QUARTERLY["H-S1-01"].control, null);
  assert.equal(projection.missions[0].control, undefined);
});

test("SEM3-BE05..09: only a complete parity-bound experiment exposes Control; mission and method scope stay frozen", () => {
  assert.deepEqual(H_S1_01.missions, ["GAS_QUARTERLY", "GAS_MONTHLY", "POWER_QUARTERLY", "POWER_MONTHLY"]);
  assert.equal(H_S1_01.parameters.tau, "CONFIGURABLE");
  assert.equal(H_S1_01.parameters.N, "CONFIGURABLE");
  assert.equal(H_S1_01.parameters.referenceMethod, "ARITHMETIC_ROLLING_MEAN_OF_N_PRIOR_SAME_ANCHOR_OBSERVATIONS");
  assert.deepEqual(H_RD_01.missions, []);
  const entry = boundDevelopmentResult({ missionId: "POWER_MONTHLY" });
  const binding = entry.ablation.experimentBinding;
  const projection = buildCanonicalSemanticsProjection({ hypothesisResults: [entry] });
  const experiment = projection.current.experiments.POWER_MONTHLY["H-S1-01"];
  assert.equal(experiment.status, "BOUND");
  assert.deepEqual(experiment.control, binding.control);
  assert.equal(experiment.control.hypothesisLayer, null);
  assert.equal(experiment.active.hypothesisLayer, "H-S1-01");
  assert.equal(experiment.control.requestedQuantity, undefined);
  assert.equal(experiment.control.timing, undefined);
  assert.equal(projection.current.results["H-S1-01"].length, 1);
  assert.equal(projection.current.experiments.GAS_MONTHLY["H-S1-01"].status, "UNBOUND");
  assert.equal(controlFor({ ...binding.control, active: { ...binding.active, sizingVersion: "other" } }).code, "CONTROL_ACTIVE_PARITY_MISMATCH");
  assert.equal(controlFor({ ...binding.control, active: binding.active, constraintsVersion: null }).code, "CONTROL_BINDING_INCOMPLETE");
});

const parityFields = [
  "experimentId", "missionId", "runId", "populationId", "campaignId",
  "obligationId", "calendarVersion", "sizingVersion", "executionVersion",
  "benchmarkVersion", "constraintsVersion",
];

for (const field of parityFields) {
  for (const variant of ["missing", "mismatched"]) {
    test(`SEM3-BE05: ${field} ${variant} fails closed in Control, ablation and projection`, () => {
      const entry = boundDevelopmentResult();
      const binding = entry.ablation.experimentBinding;
      const control = { ...binding.control };
      if (variant === "missing") delete control[field];
      else control[field] = field === "missionId" ? "POWER_MONTHLY" : `different-${field}`;

      const contract = controlFor({ ...control, active: binding.active });
      assert.equal(contract.ok, false);
      assert.equal(contract.code, variant === "missing" ? "CONTROL_BINDING_INCOMPLETE" : "CONTROL_ACTIVE_PARITY_MISMATCH");

      const ablation = compareAblation({ control, active: binding.active });
      assert.equal(ablation.ok, false);
      assert.equal(ablation.verdict, "HOLD");
      assert.equal(ablation.code, field === "runId" ? "PAIR_NOT_BOUND" : "PAIR_NOT_COMPARABLE");

      const tampered = { ...entry, ablation: { ...entry.ablation, experimentBinding: { ...binding, control } } };
      const projection = buildCanonicalSemanticsProjection({ hypothesisResults: [tampered] });
      assert.equal(projection.current.results["H-S1-01"].length, 0);
      assert.equal(projection.current.experiments.GAS_MONTHLY["H-S1-01"].status, "UNBOUND");
      assert.equal(projection.current.experiments.GAS_MONTHLY["H-S1-01"].control, null);
    });
  }
}

test("SEM3-BE05/06: forged Control mechanics cannot enter current experiment or result", () => {
  for (const extra of [{ timing: "11:00" }, { requestedQuantity: 12 }]) {
    const entry = boundDevelopmentResult();
    const binding = entry.ablation.experimentBinding;
    const control = { ...binding.control, ...extra };
    const tampered = { ...entry, ablation: { ...entry.ablation, experimentBinding: { ...binding, control } } };
    const projection = buildCanonicalSemanticsProjection({ hypothesisResults: [tampered] });
    assert.equal(projection.current.results["H-S1-01"].length, 0);
    assert.equal(projection.current.experiments.GAS_MONTHLY["H-S1-01"].status, "UNBOUND");
    assert.equal(projection.current.experiments.GAS_MONTHLY["H-S1-01"].control, null);
  }
});

test("SEM3-BE10..12: legacy or cross-bound jobs cannot increment current results or expose ablation", () => {
  const valid = boundDevelopmentResult();
  const invalid = [
    { ...valid, runId: "LEGACY_EXPLORATORY/v2/a0" },
    { ...valid, sourceKind: "EXPLORATORY" },
    { ...valid, resultPath: valid.resultPath.replace("attempt-1", "attempt-2") },
    { ...valid, missionId: "POWER_MONTHLY" },
    { ...valid, hypothesisVersion: "DIP10" },
    { ...valid, ablation: { ...valid.ablation, experimentBinding: { ...valid.ablation.experimentBinding, active: { ...valid.ablation.experimentBinding.active, executionVersion: "other" } } } },
    { ...valid, dataMode: "TRADES", family: valid.family.replace("TOB", "TRADES") },
  ];
  for (const entry of invalid) {
    const projection = buildCanonicalSemanticsProjection({ hypothesisResults: [entry] });
    assert.equal(projection.current.results["H-S1-01"].length, 0);
    assert.equal(projection.current.experiments.GAS_MONTHLY["H-S1-01"].status, "UNBOUND");
  }
  const projection = buildCanonicalSemanticsProjection({ hypothesisResults: [valid] });
  assert.equal(projection.current.results["H-S1-01"].length, 1);
  valid.ablation.experimentBinding.active.sizingVersion = "tampered-after-publication";
  assert.equal(projection.current.experiments.GAS_MONTHLY["H-S1-01"].active.sizingVersion, "sizing-v1");
  assert.equal(projection.current.results["H-RD-01"].length, 0);
  assert.equal(projection.hypotheses.find((item) => item.hypothesisId === "H-RD-01").applicabilityStatus, "UNDECLARED");
});
