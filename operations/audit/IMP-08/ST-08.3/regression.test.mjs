import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { validateWorkerRouteIdentity } from "./run-identity.mjs";

import {
  benchmarkBFromRows,
  computeAllInH,
  minimumEvidence,
  quarterlyResearchVerdict,
  scoreQuarterly,
  selectDailyReference,
} from "../../../../src/economic-calculation/index.mjs";

// Corrective expectations were frozen in regression-expectations.md before
// implementation changes. These tests exercise the public APIs end to end.

const QUARTERLY_EVIDENCE = minimumEvidence({
  mission: "Quarterly",
  quartersCompleted: 8,
  calendarYearsCovered: 2,
});
const ADMISSIBLE = { coverage: "full", benchmarkProvisional: false };

test("ST-08.3-R1: exact product/date/accessibility selection deduplicates daily rows", () => {
  const outcome = benchmarkBFromRows({
    rows: [
      { product: "Power", date: "2026-01-05", accessible: true, selected: 100 },
      { product: "Power", date: "2026-01-05", accessible: true, selected: 100 },
      { product: "Power", date: "2026-01-06", accessible: true, selected: 110 },
      { product: "Gas", date: "2026-01-06", accessible: true, selected: 999 },
      { product: "Power", date: "2026-01-07", accessible: true, selected: 999 },
      { product: "Power", date: "2026-01-06", accessible: false, selected: 777 },
    ],
    product: "Power",
    windowStart: "2026-01-05",
    windowEnd: "2026-01-07",
    expectedDates: 2,
    requireAccessible: true,
  });

  assert.equal(outcome.rejected, false);
  assert.equal(outcome.B, 105);
  assert.equal(outcome.count, 2);
  assert.equal(outcome.sum, 210);
  assert.equal(outcome.coverage, "2/2");
  assert.deepEqual(outcome.deduplicatedDates, ["2026-01-05"]);
  assert.equal(outcome.excludedRows.length, 3);
});

test("ST-08.3-R2: conflicting daily duplicates are explicitly rejected", () => {
  const outcome = benchmarkBFromRows({
    rows: [
      { product: "Power", date: "2026-01-05", accessible: true, selected: 100 },
      { product: "Power", date: "2026-01-05", accessible: true, selected: 101 },
      { product: "Power", date: "2026-01-06", accessible: true, selected: 110 },
    ],
    product: "Power",
    windowStart: "2026-01-05",
    windowEnd: "2026-01-07",
    expectedDates: 2,
    requireAccessible: true,
  });

  assert.equal(outcome.rejected, true);
  assert.equal(outcome.defined, false);
  assert.deepEqual(outcome.conflictingDates, ["2026-01-05"]);
  assert.match(outcome.reason, /Duplicados diarios conflictivos/);
});

test("ST-08.3-R3: malformed and unknown official candidates cannot outrank a valid row", () => {
  const selected = selectDailyReference({
    officialRows: [
      { value: 999, providerTimestamp: "not-a-timestamp" },
      { value: 998, providerTimestamp: "2026-01-08T10:00:00Z", declaredValidity: "unknown-under-explicit-fixture-assumption" },
      { value: 997, providerTimestamp: "2026-01-09T10:00:00Z", declaredValidity: null },
      { value: 102, providerTimestamp: "2026-01-06T18:00:00Z", declaredValidity: "valid-under-explicit-fixture-assumption" },
    ],
  });

  assert.equal(selected.value, 102);
  assert.equal(selected.source, "official");
  assert.equal(selected.providerTimestamp, "2026-01-06T18:00:00Z");
  assert.equal(selected.excludedOfficialRows.length, 3);
});

test("ST-08.3-R4: valid synthetic 0.01 remains eligible and invalid rows fall back to proxy", () => {
  const valid = selectDailyReference({
    officialRows: [{ value: 0.01, providerTimestamp: "2026-01-06T18:00:00Z", declaredValidity: "valid-under-explicit-fixture-assumption" }],
  });
  assert.equal(valid.value, 0.01);
  assert.equal(valid.defined, true);

  const fallback = selectDailyReference({
    officialRows: [{ value: 999, providerTimestamp: "2026-01-06T18:00:00Z", declaredValidity: "invalid" }],
    proxy: { value: 101, sourceLabel: "proxy", defined: true },
  });
  assert.equal(fallback.value, 101);
  assert.equal(fallback.source, "proxy");
  assert.equal(fallback.excludedOfficialRows.length, 1);
});

test("ST-08.3-R5: malformed, missing and incomplete costs remain unavailable", () => {
  for (const costs of [[false], [null], undefined, null, "not-a-list"]) {
    const outcome = computeAllInH({ base: 100, unit: "EUR/MWh", costs });
    assert.equal(outcome.defined, false);
    assert.equal(outcome.available, false);
    assert.equal(outcome.rejected, true);
    assert.ok(!Number.isFinite(outcome.H));
    assert.equal(typeof outcome.reason, "string");
  }

  const omittedCompleteness = computeAllInH({ base: 100, unit: "EUR/MWh", costs: [] });
  assert.equal(omittedCompleteness.defined, false);
  assert.match(omittedCompleteness.reason, /completitud/);
});

test("ST-08.3-R6: an explicitly complete known-zero cost list is finite", () => {
  const outcome = computeAllInH({
    base: 100,
    unit: "EUR/MWh",
    costs: [{ value: 0, status: "known" }],
    costsComplete: true,
  });
  assert.equal(outcome.H, 100);
  assert.equal(outcome.defined, true);
  assert.equal(outcome.available, true);
  assert.equal(outcome.reason, null);
});

test("ST-08.3-R7: Monthly evidence cannot satisfy the Quarterly gate", () => {
  const outcome = quarterlyResearchVerdict({
    scoring: scoreQuarterly([4, -1]),
    evidence: minimumEvidence({ mission: "Monthly", monthsCompleted: 24 }),
    dataQuality: ADMISSIBLE,
  });
  assert.equal(outcome.verdict, "HOLD");
  assert.match(outcome.reason, /Quarterly/);
});

test("ST-08.3-R8: Quarterly sufficiency is derived from mission-bound counts", () => {
  const eightQuarterValues = [4, -1, 0, 0, 0, 0, 0, 0];
  const pass = quarterlyResearchVerdict({
    scoring: scoreQuarterly(eightQuarterValues),
    evidence: QUARTERLY_EVIDENCE,
    dataQuality: ADMISSIBLE,
  });
  assert.equal(pass.verdict, "PASS");
  assert.equal(scoreQuarterly(eightQuarterValues).nTotal, 8);
  assert.equal(scoreQuarterly(eightQuarterValues).nNonzero, 2);

  const twoValuesForEightQuarters = quarterlyResearchVerdict({
    scoring: scoreQuarterly([4, -1]),
    evidence: QUARTERLY_EVIDENCE,
    dataQuality: ADMISSIBLE,
  });
  assert.equal(twoValuesForEightQuarters.verdict, "HOLD");
  assert.match(twoValuesForEightQuarters.reason, /reconciliada|población puntuada/);

  const forged = quarterlyResearchVerdict({
    scoring: scoreQuarterly([4, -1]),
    evidence: { mission: "Quarterly", minimumEvidenceMet: true, quartersCompleted: 2, calendarYearsCovered: 1 },
    dataQuality: ADMISSIBLE,
  });
  assert.equal(forged.verdict, "HOLD");

  const pooled = quarterlyResearchVerdict({
    scoring: scoreQuarterly([4, -1]),
    evidence: { ...QUARTERLY_EVIDENCE, products: ["Gas", "Power"] },
    dataQuality: ADMISSIBLE,
  });
  assert.equal(pooled.verdict, "HOLD");
});

test("ST-08.3-R9: receipt route identity matches corrective run and preserves initial history", () => {
  const receipt = JSON.parse(fs.readFileSync("operations/receipts/IMP-08-ST-3.json", "utf8"));
  assert.equal(validateWorkerRouteIdentity(receipt).ok, true);

  const mutations = [
    ["workerRoute.runId", (copy) => { copy.workerRoute.runId = "mismatched-run-id"; }],
    ["workerModelRoute", (copy) => { copy.workerModelRoute = "route-without-current-run"; }],
    ["receiptMeta.writtenByRun", (copy) => { copy.receiptMeta.writtenByRun = "mismatched-run-id"; }],
  ];
  for (const [field, mutate] of mutations) {
    const mismatched = structuredClone(receipt);
    mutate(mismatched);
    const outcome = validateWorkerRouteIdentity(mismatched);
    assert.equal(outcome.ok, false, `${field} mismatch must be rejected`);
    assert.ok(outcome.errors.length > 0, `${field} mismatch must report an error`);
  }
});
