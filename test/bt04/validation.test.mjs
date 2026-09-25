import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildBt04Validation, loadAndBuild, PATHS } from "../../operations/audit/BT-04/compare.mjs";

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
