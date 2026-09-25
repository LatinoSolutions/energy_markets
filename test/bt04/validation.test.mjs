import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildBt04Validation, loadAndBuild, PATHS, TARGETS, verifyInputBinding } from "../../operations/audit/BT-04/compare.mjs";

const root = resolve(import.meta.dirname, "../..");
const readJson = (path) => JSON.parse(readFileSync(resolve(root, path), "utf8"));
const committed = readJson(PATHS.output);
const campaign = (validation, key) => validation.campaigns.find((item) => item.campaignKey === key);

function inputs() {
  return { independent: readJson(PATHS.independent), bt01: readJson(PATHS.bt01), bt02: readJson(PATHS.bt02), hashes: {} };
}

test("BT-04 validation is reproducible from the hash-bound BT-01 / BT-02 / independent artifacts", () => {
  assert.deepEqual(loadAndBuild(root), committed);
  assert.ok(committed.inputs.independent.lakeFilesBoundToBt01Manifest > 0);
});

test("BT-04 covers one G0BQ and one G0BM campaign with no unexplained difference", () => {
  const keys = committed.campaigns.map((item) => item.campaignKey);
  assert.ok(keys.some((key) => key.startsWith("G0BQ-")));
  assert.ok(keys.some((key) => key.startsWith("G0BM-")));
  assert.equal(committed.unexplained, 0);
  assert.equal(committed.verdict, "PASS_WITH_ATTRIBUTED_DIFFERENCES");
});

test("independent B matches BT-01 coverage exactly and differs only by the reproduced BT-01 implementation choices", () => {
  for (const item of committed.campaigns) {
    assert.deepEqual(item.benchmark.coverage.independent, item.benchmark.coverage.bt01);
    assert.deepEqual(item.benchmark.missingDates.independent, item.benchmark.missingDates.bt01);
    assert.ok(item.benchmark.bt01EmulationMaxPerDateDiff <= 1e-9);
    assert.ok(Math.abs(item.benchmark.difference) <= 1e-4);
    assert.equal(item.benchmark.cause, "BT01_PROXY_IMPLEMENTATION_CHOICES");
  }
});

test("independent B and H are the plain means of the committed per-date / per-fill values (SPEC §5.3 equal daily weight)", () => {
  for (const item of readJson(PATHS.independent).campaigns) {
    const references = item.perDate.filter((record) => record.defined).map((record) => record.R);
    const meanB = references.reduce((sum, value) => sum + value, 0) / references.length;
    assert.ok(Math.abs(meanB - item.B) <= 1e-12);
    for (const arm of Object.values(item.arms)) {
      const energy = arm.fills.reduce((sum, fill) => sum + fill.filledMw * fill.independentPriceEurMwh, 0);
      assert.ok(Math.abs(energy / arm.filledMw - arm.H) <= 1e-12);
      for (const fill of arm.fills) assert.ok(Math.abs(fill.independentPriceEurMwh - (fill.independentAsk + 0.15)) <= 1e-12);
    }
  }
});

test("G0BM-202510 H, V and ΔV of the ledger arms match the independent recomputation", () => {
  const item = campaign(committed, "G0BM-202510");
  for (const arm of item.ledgerArms) {
    assert.equal(arm.verdict, "MATCH");
    assert.equal(arm.fillsMatched, arm.fills);
  }
  assert.equal(item.deltaV_ARM_A_vs_BASELINE.verdict, "MATCH");
});

test("G0BQ-202601 BASELINE differs by exactly one same-Tm tie fill resolved by row order, not best ask", () => {
  const item = campaign(committed, "G0BQ-202601");
  const baseline = item.ledgerArms.find((arm) => arm.armId === "BASELINE");
  assert.equal(baseline.verdict, "ATTRIBUTED_DIFFERENCE");
  assert.equal(baseline.fillsMatched, baseline.fills - 1);
  const [fill] = baseline.mismatchedFills;
  assert.equal(fill.day, "2025-11-25");
  assert.equal(fill.cause, "TOB_SAME_TM_TIE_BY_ROW_ORDER");
  assert.deepEqual(fill.distinctAsksAtTm, [31.33, 31.475]);
  assert.equal(fill.ledgerAsk, 31.475);
  assert.equal(fill.bestAskAtTm, 31.33);
  // 1 MW of 60 MW overpriced by 0.145 EUR/MWh.
  assert.ok(Math.abs(baseline.hDifference - 0.145 / 60) <= 1e-9);
  assert.equal(item.ledgerArms.find((arm) => arm.armId === "ARM_A").verdict, "MATCH");
});

test("arms without a per-day ledger are only arithmetic-checked, and say so", () => {
  for (const item of committed.campaigns) {
    assert.ok(item.arithmeticArms.length > 0);
    for (const arm of item.arithmeticArms) {
      assert.equal(arm.check, "ARITHMETIC_ONLY_NO_LEDGER");
      assert.equal(arm.verdict, "MATCH");
    }
  }
});

test("provisional status stays fail-closed: no official equivalence, fees UNKNOWN and excluded", () => {
  assert.equal(committed.failClosedHolds, true);
  for (const item of committed.campaigns) {
    assert.equal(item.failClosed.benchmarkStatus, "BENCHMARK_PROVISIONAL");
    assert.equal(item.failClosed.officialEquivalent, false);
    assert.deepEqual(item.failClosed.fees, { status: "UNKNOWN", included: false });
  }
});

test("a fill price difference without a same-Tm tie is UNEXPLAINED and fails", () => {
  const data = inputs();
  const fill = data.independent.campaigns.find((item) => item.campaignKey === "G0BM-202510").arms.BASELINE.fills[0];
  fill.independentAsk += 0.01;
  fill.independentPriceEurMwh += 0.01;
  fill.distinctAsksAtTm = [fill.independentAsk];
  const validation = buildBt04Validation(data);
  assert.equal(validation.verdict, "FAIL");
  assert.ok(validation.unexplained > 0);
});

test("a B difference that the BT-01 emulation does not reproduce is UNEXPLAINED", () => {
  const data = inputs();
  const record = data.independent.campaigns.find((item) => item.campaignKey === "G0BQ-202601").perDate.find((item) => item.defined);
  record.bt01Emulation.R += 0.001;
  assert.equal(buildBt04Validation(data).verdict, "FAIL");
});

test("fees represented as zero/included, or an official-equivalence claim, fail the validation", () => {
  const withFees = inputs();
  withFees.bt02.campaigns.find((item) => item.campaignKey === "G0BM-202510").fees = { status: "KNOWN", included: true, eurMwh: 0 };
  assert.equal(buildBt04Validation(withFees).verdict, "FAIL");

  const official = inputs();
  official.bt01.campaigns.find((item) => item.campaignKey === "G0BQ-202601").reconciliation.equivalent = true;
  assert.equal(buildBt04Validation(official).verdict, "FAIL");
});

test("BT04-DELTA-GATE: a ΔV that does not follow from both arms' H fails even when the arms are attributed", () => {
  const data = inputs();
  data.bt02.campaigns.find((item) => item.campaignKey === "G0BQ-202601").arms.ARM_A.deltaVEurMwh += 10;
  const validation = buildBt04Validation(data);
  assert.equal(validation.verdict, "FAIL");
  assert.equal(campaign(validation, "G0BQ-202601").deltaV_ARM_A_vs_BASELINE.verdict, "UNEXPLAINED");
});

test("BT04-DELTA-GATE: an independent ΔV inconsistent with its own H fails", () => {
  const data = inputs();
  data.independent.campaigns.find((item) => item.campaignKey === "G0BM-202510").deltaV_ARM_A_vs_BASELINE += 0.001;
  assert.equal(buildBt04Validation(data).verdict, "FAIL");
});

test("BT04-B-AGGREGATE: a B that is not the mean of its per-date references fails (SPEC §5.3)", () => {
  const independentB = inputs();
  independentB.independent.campaigns.find((item) => item.campaignKey === "G0BQ-202601").B += 0.00005;
  const validation = buildBt04Validation(independentB);
  assert.equal(validation.verdict, "FAIL");
  assert.equal(campaign(validation, "G0BQ-202601").benchmark.aggregateHolds.independent, false);

  const bt01B = inputs();
  bt01B.bt01.campaigns.find((item) => item.campaignKey === "G0BM-202510").benchmark.B += 0.00005;
  assert.equal(buildBt04Validation(bt01B).verdict, "FAIL");
});

test("BT04-B-AGGREGATE: BT-02 pricing V against a different B than BT-01 fails", () => {
  const data = inputs();
  data.bt02.campaigns.find((item) => item.campaignKey === "G0BM-202510").benchmark.B += 0.00005;
  assert.equal(buildBt04Validation(data).verdict, "FAIL");
});

test("BT04-INPUT-BINDING: declared calendar / ledger / BT-01 hashes must match the files read", () => {
  const read = (path) => readJson(path);
  const fileHashes = Object.fromEntries(Object.values(committed.inputs).map(({ path, sha256 }) => [path, sha256]));
  const base = () => ({
    independent: read(PATHS.independent),
    bt01Manifest: read(PATHS.bt01Manifest),
    bt02Manifest: read(PATHS.bt02Manifest),
    fileHashes,
  });
  assert.doesNotThrow(() => verifyInputBinding(base()));

  const calendar = base();
  calendar.independent.inputs.calendar.sha256 = "0".repeat(64);
  assert.throws(() => verifyInputBinding(calendar), /independent.inputs.calendar/);

  const ledger = base();
  ledger.independent.inputs.exploratoryResults.sha256 = "0".repeat(64);
  assert.throws(() => verifyInputBinding(ledger), /independent.inputs.exploratoryResults/);

  const bt02Ledger = base();
  bt02Ledger.bt02Manifest.inputs.exploratoryResults.sha256 = "0".repeat(64);
  assert.throws(() => verifyInputBinding(bt02Ledger), /bt02Manifest.inputs.exploratoryResults/);
});

// v2 = BT-01 / backtest / BT-02 regenerated with BT04-H1-TOB-TIE and
// BT04-C1-PROXY-WINDOW-DEDUP fixed: the independent check must now match exactly.
test("BT-04 v2: validation is reproducible and every value matches the independent recomputation", () => {
  const v2 = readJson(TARGETS.v2.output);
  assert.deepEqual(loadAndBuild(root, "v2"), v2);
  assert.equal(v2.target, "v2");
  assert.equal(v2.verdict, "PASS");
  assert.equal(v2.unexplained, 0);
  assert.equal(v2.failClosedHolds, true);
  for (const item of v2.campaigns) {
    assert.equal(item.benchmark.verdict, "MATCH", item.campaignKey);
    assert.ok(Math.abs(item.benchmark.difference) <= 1e-9, item.campaignKey);
    for (const arm of item.ledgerArms) {
      assert.equal(arm.verdict, "MATCH", `${item.campaignKey} ${arm.armId}`);
      assert.deepEqual(arm.mismatchedFills, []);
    }
    assert.equal(item.deltaV_ARM_A_vs_BASELINE.verdict, "MATCH", item.campaignKey);
  }
  const g0bq = campaign(v2, "G0BQ-202601");
  assert.ok(Math.abs(g0bq.ledgerArms.find((arm) => arm.armId === "BASELINE").bt02H - 33.536583333333) <= 1e-9);
});

test("BT-04 v1 stays the historical contrast of the accepted artifacts; v2 binds only v2 inputs", () => {
  assert.equal(committed.target, "v1");
  const v2 = readJson(TARGETS.v2.output);
  for (const name of ["independent", "bt01", "bt01Manifest", "bt02", "bt02Manifest", "exploratoryResults"]) {
    assert.equal(v2.inputs[name].path, TARGETS.v2[name]);
    assert.notEqual(v2.inputs[name].path, committed.inputs[name].path);
  }
});

// BT04-H-ATTRIBUTION (2026-09-25): an H difference is attributed only when it is
// carried by attributed mismatched fills, never by vacuous truth over zero fills.
test("BT04-H-ATTRIBUTION: an H that no mismatched fill explains is UNEXPLAINED, even with V and ΔV kept coherent", () => {
  const data = { ...inputs(), bt02: readJson(TARGETS.v2.bt02), bt01: readJson(TARGETS.v2.bt01), independent: readJson(TARGETS.v2.independent) };
  const bt02Campaign = data.bt02.campaigns.find((item) => item.campaignKey === "G0BM-202510");
  const armA = bt02Campaign.arms.ARM_A;
  armA.hEurMwh += 0.5;
  armA.vEurMwh = bt02Campaign.benchmark.B - armA.hEurMwh;
  armA.deltaVEurMwh = bt02Campaign.arms.BASELINE.hEurMwh - armA.hEurMwh;
  const validation = buildBt04Validation(data);
  const arm = campaign(validation, "G0BM-202510").ledgerArms.find((item) => item.armId === "ARM_A");
  assert.deepEqual(arm.mismatchedFills, []);
  assert.equal(arm.bt02HFromLedgerFills, false);
  assert.equal(arm.verdict, "UNEXPLAINED");
  assert.equal(validation.verdict, "FAIL");
});

test("BT04-H-ATTRIBUTION: an attributed tie fill does not cover an extra H shift on the same arm", () => {
  const data = inputs();
  const bt02Campaign = data.bt02.campaigns.find((item) => item.campaignKey === "G0BQ-202601");
  const baseline = bt02Campaign.arms.BASELINE;
  baseline.hEurMwh += 0.5;
  baseline.vEurMwh = bt02Campaign.benchmark.B - baseline.hEurMwh;
  bt02Campaign.arms.ARM_A.deltaVEurMwh = baseline.hEurMwh - bt02Campaign.arms.ARM_A.hEurMwh;
  const validation = buildBt04Validation(data);
  const arm = campaign(validation, "G0BQ-202601").ledgerArms.find((item) => item.armId === "BASELINE");
  assert.equal(arm.mismatchedFills.length, 1);
  assert.equal(arm.verdict, "UNEXPLAINED");
  assert.equal(validation.verdict, "FAIL");
});

test("BT04-H-ATTRIBUTION: the committed attributed tie is carried by the ledger fills", () => {
  const baseline = campaign(committed, "G0BQ-202601").ledgerArms.find((arm) => arm.armId === "BASELINE");
  assert.equal(baseline.bt02HFromLedgerFills, true);
});

// BT04-BT02-BENCHMARK-BINDING (2026-09-25): SPEC §5.3, BT-02 carries the full
// BT-01 benchmark record, not only the same B.
for (const [field, mutate] of [
  ["coverage", (benchmark) => { benchmark.coverage = "20/22"; }],
  ["versionId", (benchmark) => { benchmark.versionId = "0".repeat(64); }],
  ["window", (benchmark) => { benchmark.window = { ...benchmark.window, endExclusive: "2025-10-02" }; }],
  ["status", (benchmark) => { benchmark.status = "BENCHMARK_OFFICIAL"; }],
]) {
  test(`BT04-BT02-BENCHMARK-BINDING: a BT-02 benchmark ${field} different from BT-01 fails`, () => {
    const data = inputs();
    mutate(data.bt02.campaigns.find((item) => item.campaignKey === "G0BM-202510").benchmark);
    const validation = buildBt04Validation(data);
    const benchmark = campaign(validation, "G0BM-202510").benchmark;
    assert.deepEqual(benchmark.bt02BenchmarkMismatches, [field]);
    assert.equal(benchmark.verdict, "UNEXPLAINED");
    assert.equal(validation.verdict, "FAIL");
  });
}

// BT04-HCOST-COMPLETENESS-GATE (2026-09-25): with fees UNKNOWN / excluded, H is
// the execution-price average only; a COMPLETE (or missing) cost status is a false claim.
test("BT04-HCOST-COMPLETENESS-GATE: an H marked COMPLETE while fees are UNKNOWN fails, on ledger and arithmetic arms", () => {
  for (const armId of ["BASELINE", "ARM_A", "ARM_B", "BASELINE@DEPTH"]) {
    const data = inputs();
    data.bt02.campaigns.find((item) => item.campaignKey === "G0BM-202510").arms[armId].hCostCompleteness = "COMPLETE";
    const validation = buildBt04Validation(data);
    assert.equal(validation.verdict, "FAIL", armId);
    assert.ok(validation.unexplained > 0, armId);
  }
  const missing = inputs();
  delete missing.bt02.campaigns.find((item) => item.campaignKey === "G0BQ-202601").arms.ARM_A.hCostCompleteness;
  assert.equal(buildBt04Validation(missing).verdict, "FAIL");
});

test("BT04-HCOST-COMPLETENESS-GATE: every committed arm (v1 and v2) keeps H cost completeness PARTIAL", () => {
  for (const validation of [committed, readJson(TARGETS.v2.output)]) {
    for (const item of validation.campaigns) {
      for (const arm of [...item.ledgerArms, ...item.arithmeticArms]) {
        assert.equal(arm.hCostCompleteness, "PARTIAL", `${item.campaignKey} ${arm.armId}`);
        assert.equal(arm.hCostCompletenessHolds, true, `${item.campaignKey} ${arm.armId}`);
      }
    }
  }
});
