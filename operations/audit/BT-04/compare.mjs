// BT-04: compare the BT-01 / BT-02 artifacts against the independent lake
// recomputation (independent-check.py). Every difference must be either within
// float noise or attributed to a named, reproduced cause; anything else is
// UNEXPLAINED and fails the validation.
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const FLOAT_NOISE = 1e-9;
// Upper bound on |B_independent − B_BT-01| accepted only when the BT-01
// emulation reproduces BT-01 per date within FLOAT_NOISE (cause is proven).
const ATTRIBUTED_B_BOUND = 1e-4;

// v1 = accepted BT-01 / BT-02 artifacts (kept byte-for-byte); v2 = the versions
// that fix BT04-H1-TOB-TIE and BT04-C1-PROXY-WINDOW-DEDUP (2026-09-25).
export const TARGETS = Object.freeze({
  v1: Object.freeze({
    independent: "operations/audit/BT-04/independent-check-BT-04.json",
    bt01: "operations/audit/BT-01/campaign-provisional-benchmarks-BT-01.json",
    bt01Manifest: "operations/audit/BT-01/campaign-provisional-benchmarks-BT-01.MANIFEST.json",
    bt02: "operations/exploratory/reconciled-results-BT-02.json",
    bt02Manifest: "operations/exploratory/reconciled-results-BT-02.MANIFEST.json",
    exploratoryResults: "operations/exploratory/backtest-results.json",
    calendar: "operations/audit/IMP-09/eex-exchange-calendar.json",
    output: "operations/audit/BT-04/validation-BT-04.json",
  }),
  v2: Object.freeze({
    independent: "operations/audit/BT-04/independent-check-BT-04-v2.json",
    bt01: "operations/audit/BT-01/v2/campaign-provisional-benchmarks-BT-01.json",
    bt01Manifest: "operations/audit/BT-01/v2/campaign-provisional-benchmarks-BT-01.MANIFEST.json",
    bt02: "operations/exploratory/v2/reconciled-results-BT-02.json",
    bt02Manifest: "operations/exploratory/v2/reconciled-results-BT-02.MANIFEST.json",
    exploratoryResults: "operations/exploratory/v2/backtest-results.json",
    calendar: "operations/audit/IMP-09/eex-exchange-calendar.json",
    output: "operations/audit/BT-04/validation-BT-04-v2.json",
  }),
});
export const PATHS = TARGETS.v1;

export const CAUSES = {
  BT01_PROXY_IMPLEMENTATION_CHOICES: "BT-01 proxy truncates Berlin time to whole seconds (17:15:00.xxx counts as inside the strict window) and deduplicates on (Tm, price, bid, ask) only, collapsing distinct market rows. Reproduced: rerunning the independent formula with those two choices matches BT-01 per date within 1e-9.",
  TOB_SAME_TM_TIE_BY_ROW_ORDER: "Several TOB rows (EXPLICIT / IMPLIED) share the latest Tm before 11:00; build_tob_slots.py keeps the last row in file order instead of the best (lowest) ask required by client execution_and_costs.md §1 step 2.",
};

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const close = (left, right, bound = FLOAT_NOISE) => Number.isFinite(left) && Number.isFinite(right) && Math.abs(left - right) <= bound;
const mean = (values) => values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length;

// SPEC §5.3: B_t = (1/|D_t|) Σ R_d over the traced dates with a reference;
// coverage and missing dates must describe the same per-date records.
function aggregateHolds({ B, coverage, missingDates, perDate, referenceOf }) {
  const defined = perDate.filter((record) => record.defined);
  const expectedB = mean(defined.map(referenceOf));
  const bHolds = expectedB === null ? B === null : close(B, expectedB);
  return bHolds
    && coverage === `${defined.length}/${perDate.length}`
    && JSON.stringify(missingDates) === JSON.stringify(perDate.filter((record) => !record.defined).map((record) => record.trdDate));
}

// SPEC §5.3: BT-02 must carry exactly the BT-01 benchmark record it prices V
// against, not just the same B number (BT04-BT02-BENCHMARK-BINDING, 2026-09-25).
function bt02BenchmarkBindsBt01(bt02Benchmark, bt01Campaign) {
  const mismatches = [];
  if (bt02Benchmark.B !== bt01Campaign.benchmark.B) mismatches.push("B");
  if (bt02Benchmark.coverage !== bt01Campaign.benchmark.coverage) mismatches.push("coverage");
  if (bt02Benchmark.status !== bt01Campaign.status.status) mismatches.push("status");
  if (bt02Benchmark.versionId !== bt01Campaign.benchmarkVersion?.versionId) mismatches.push("versionId");
  if (JSON.stringify(bt02Benchmark.window) !== JSON.stringify(bt01Campaign.benchmarkWindow)) mismatches.push("window");
  return mismatches;
}

function compareBenchmark(independentCampaign, bt01Campaign, bt02Benchmark) {
  const bt01ByDate = new Map(bt01Campaign.perDate.map((record) => [record.trdDate, record]));
  let emulationMaxDiff = 0;
  const definitionMismatches = [];
  for (const record of independentCampaign.perDate) {
    const bt01Record = bt01ByDate.get(record.trdDate);
    if (!bt01Record || bt01Record.defined !== record.defined) {
      definitionMismatches.push(record.trdDate);
      continue;
    }
    if (!record.defined) continue;
    emulationMaxDiff = Math.max(emulationMaxDiff, Math.abs(record.bt01Emulation.R - bt01Record.dailyReference));
  }
  const bt01B = bt01Campaign.benchmark.B;
  const difference = independentCampaign.B - bt01B;
  const sameCoverage = independentCampaign.coverage === bt01Campaign.benchmark.coverage
    && JSON.stringify(independentCampaign.missingDates) === JSON.stringify(bt01Campaign.benchmark.missingDates);
  const causeProven = emulationMaxDiff <= FLOAT_NOISE;
  const independentAggregateHolds = aggregateHolds({
    B: independentCampaign.B,
    coverage: independentCampaign.coverage,
    missingDates: independentCampaign.missingDates,
    perDate: independentCampaign.perDate,
    referenceOf: (record) => record.R,
  });
  const bt01AggregateHolds = aggregateHolds({
    B: bt01B,
    coverage: bt01Campaign.benchmark.coverage,
    missingDates: bt01Campaign.benchmark.missingDates,
    perDate: bt01Campaign.perDate,
    referenceOf: (record) => record.dailyReference,
  });
  const bt02BenchmarkMismatches = bt02BenchmarkBindsBt01(bt02Benchmark, bt01Campaign);
  const comparable = definitionMismatches.length === 0 && sameCoverage && independentAggregateHolds && bt01AggregateHolds
    && bt02BenchmarkMismatches.length === 0;

  let verdict = "UNEXPLAINED";
  if (comparable && close(difference, 0)) verdict = "MATCH";
  else if (comparable && causeProven && Math.abs(difference) <= ATTRIBUTED_B_BOUND) verdict = "ATTRIBUTED_DIFFERENCE";

  return {
    bt01B,
    independentB: independentCampaign.B,
    difference,
    coverage: { bt01: bt01Campaign.benchmark.coverage, independent: independentCampaign.coverage },
    missingDates: { bt01: bt01Campaign.benchmark.missingDates, independent: independentCampaign.missingDates },
    definitionMismatches,
    aggregateHolds: { independent: independentAggregateHolds, bt01: bt01AggregateHolds },
    bt02BenchmarkMismatches,
    bt01EmulationMaxPerDateDiff: emulationMaxDiff,
    verdict,
    cause: verdict === "ATTRIBUTED_DIFFERENCE" ? "BT01_PROXY_IMPLEMENTATION_CHOICES" : null,
    status: bt01Campaign.status.status,
  };
}

function compareLedgerArm(armId, independentArm, bt02Arm, bt02B) {
  const mismatchedFills = independentArm.fills
    .filter((fill) => fill.independentPriceEurMwh === null || !close(fill.independentPriceEurMwh, fill.ledgerPriceEurMwh))
    .map((fill) => {
      const tieByRowOrder = Array.isArray(fill.distinctAsksAtTm)
        && fill.distinctAsksAtTm.length > 1
        && fill.independentQuoteTm === fill.ledgerQuoteTm
        && fill.distinctAsksAtTm.includes(fill.ledgerAsk);
      return {
        day: fill.day,
        filledMw: fill.filledMw,
        quoteTm: fill.ledgerQuoteTm,
        ledgerAsk: fill.ledgerAsk,
        bestAskAtTm: fill.independentAsk,
        distinctAsksAtTm: fill.distinctAsksAtTm,
        cause: tieByRowOrder ? "TOB_SAME_TM_TIE_BY_ROW_ORDER" : null,
      };
    });
  const hDifference = bt02Arm.hEurMwh - independentArm.H;
  // H the stored ledger fills themselves produce. An attributed H difference must
  // be carried entirely by the attributed fills: BT-02's H has to be this value
  // (BT04-H-ATTRIBUTION, 2026-09-25; SPEC §5.5 H over the executed fills).
  const ledgerEnergy = independentArm.fills.reduce((sum, fill) => sum + fill.filledMw * fill.ledgerPriceEurMwh, 0);
  const ledgerMw = independentArm.fills.reduce((sum, fill) => sum + fill.filledMw, 0);
  const ledgerH = ledgerMw > 0 ? ledgerEnergy / ledgerMw : null;
  const bt02HFromLedgerFills = close(bt02Arm.hEurMwh, ledgerH);
  const independentV = independentArm.V;
  const vDifference = bt02Arm.vEurMwh === null || independentV === null ? null : bt02Arm.vEurMwh - independentV;
  // Never by vacuous truth: with no mismatched fill there is nothing to attribute.
  const allAttributed = mismatchedFills.length > 0 && mismatchedFills.every((fill) => fill.cause !== null);
  // SPEC §5.5 V = B − H inside BT-02 itself, before comparing against the independent side.
  const bt02VCoherent = bt02Arm.vStatus === "PROVISIONAL"
    ? close(bt02Arm.vEurMwh, bt02B - bt02Arm.hEurMwh)
    : bt02Arm.vEurMwh === null;

  let verdict = "UNEXPLAINED";
  if (mismatchedFills.length === 0 && close(hDifference, 0)) verdict = "MATCH";
  else if (allAttributed && bt02HFromLedgerFills) verdict = "ATTRIBUTED_DIFFERENCE";
  if (independentArm.complete !== bt02Arm.complete || !close(independentArm.filledMw, bt02Arm.boughtMw) || !bt02VCoherent) verdict = "UNEXPLAINED";

  return {
    armId,
    fillModel: bt02Arm.fillModel,
    fills: independentArm.fills.length,
    fillsMatched: independentArm.fills.length - mismatchedFills.length,
    mismatchedFills,
    bt02H: bt02Arm.hEurMwh,
    independentH: independentArm.H,
    hDifference,
    ledgerH,
    bt02HFromLedgerFills,
    bt02V: bt02Arm.vEurMwh,
    independentV,
    vDifference,
    vStatus: bt02Arm.vStatus,
    bt02VCoherent,
    hCostCompleteness: bt02Arm.hCostCompleteness,
    verdict,
  };
}

// Arms without a stored per-day ledger (ARM_B, *@DEPTH) cannot be re-priced
// independently here; only V = B − H and the paired ΔV arithmetic are checked.
// SPEC §5.5: ΔV = H_A0 − H_A1. Each side must satisfy it with its own H, and
// the BT-02 − independent ΔV gap must be exactly the gap carried by the two
// ledger arms' H; any other ΔV difference is UNEXPLAINED.
function compareDeltaV({ bt02DeltaV, independentDeltaV, bt02Arms, independentArms, ledgerArms }) {
  const [baseline, armA] = ["BASELINE", "ARM_A"].map((armId) => ledgerArms.find((arm) => arm.armId === armId));
  const bt02Coherent = bt02DeltaV === null
    ? bt02Arms.ARM_A.deltaVStatus !== "PROVISIONAL"
    : close(bt02DeltaV, bt02Arms.BASELINE.hEurMwh - bt02Arms.ARM_A.hEurMwh);
  const independentCoherent = independentDeltaV === null
    ? !(independentArms.BASELINE.complete && independentArms.ARM_A.complete)
    : close(independentDeltaV, independentArms.BASELINE.H - independentArms.ARM_A.H);
  const bothDefined = bt02DeltaV !== null && independentDeltaV !== null;
  const bothNull = bt02DeltaV === null && independentDeltaV === null;
  const difference = bothDefined ? bt02DeltaV - independentDeltaV : null;
  const differenceCarriedByH = bothDefined ? baseline.hDifference - armA.hDifference : null;
  const differenceExplained = bothNull || close(difference, differenceCarriedByH);

  let verdict = "UNEXPLAINED";
  if (bt02Coherent && independentCoherent && differenceExplained) {
    if (ledgerArms.every((arm) => arm.verdict === "MATCH") && (bothNull || close(difference, 0))) verdict = "MATCH";
    else if (ledgerArms.every((arm) => arm.verdict !== "UNEXPLAINED")) verdict = "ATTRIBUTED_DIFFERENCE";
  }
  return {
    bt02: bt02DeltaV,
    independent: independentDeltaV,
    difference,
    differenceCarriedByH,
    bt02Coherent,
    independentCoherent,
    verdict,
  };
}

function checkArithmeticOnly(armId, bt02Arm, bt02Campaign, bt02Arms) {
  const expectedV = bt02Arm.vStatus === "PROVISIONAL" ? bt02Campaign.benchmark.B - bt02Arm.hEurMwh : null;
  const vOk = expectedV === null ? bt02Arm.vEurMwh === null : close(bt02Arm.vEurMwh, expectedV);
  const baseline = bt02Arm.fillModel === "DEPTH" ? bt02Arms["BASELINE@DEPTH"] : bt02Arms.BASELINE;
  const expectedDeltaV = bt02Arm.deltaVStatus === "PROVISIONAL" ? baseline.hEurMwh - bt02Arm.hEurMwh : null;
  const deltaOk = expectedDeltaV === null ? bt02Arm.deltaVEurMwh === null : close(bt02Arm.deltaVEurMwh, expectedDeltaV);
  return {
    armId,
    fillModel: bt02Arm.fillModel,
    check: "ARITHMETIC_ONLY_NO_LEDGER",
    vStatus: bt02Arm.vStatus,
    deltaVStatus: bt02Arm.deltaVStatus,
    verdict: vOk && deltaOk ? "MATCH" : "UNEXPLAINED",
  };
}

export function buildBt04Validation({ independent, bt01, bt02, hashes }) {
  if (independent?.artifactKind !== "BT-04_INDEPENDENT_CHECK") throw new Error("unexpected independent artifact kind");
  if (bt01?.artifactKind !== "BT-01_CAMPAIGN_PROVISIONAL_BENCHMARKS") throw new Error("unexpected BT-01 artifact kind");
  if (bt02?.artifactKind !== "BT-02_EXPLORATORY_BENCHMARK_RECONCILIATION") throw new Error("unexpected BT-02 artifact kind");

  const campaigns = independent.campaigns.map((independentCampaign) => {
    const key = independentCampaign.campaignKey;
    const bt01Campaign = bt01.campaigns.find((item) => item.campaignKey === key);
    const bt02Campaign = bt02.campaigns.find((item) => item.campaignKey === key);
    if (!bt01Campaign || !bt02Campaign) throw new Error(`${key} missing from BT-01 or BT-02`);

    const benchmark = compareBenchmark(independentCampaign, bt01Campaign, bt02Campaign.benchmark);
    const ledgerArms = ["BASELINE", "ARM_A"].map((armId) =>
      compareLedgerArm(armId, independentCampaign.arms[armId], bt02Campaign.arms[armId], bt02Campaign.benchmark.B));
    const deltaV = compareDeltaV({
      bt02DeltaV: bt02Campaign.arms.ARM_A.deltaVEurMwh,
      independentDeltaV: independentCampaign.deltaV_ARM_A_vs_BASELINE,
      bt02Arms: bt02Campaign.arms,
      independentArms: independentCampaign.arms,
      ledgerArms,
    });
    const arithmeticArms = Object.entries(bt02Campaign.arms)
      .filter(([armId]) => armId !== "BASELINE" && armId !== "ARM_A")
      .map(([armId, arm]) => checkArithmeticOnly(armId, arm, bt02Campaign, bt02Campaign.arms));

    return {
      campaignKey: key,
      benchmark,
      ledgerArms,
      deltaV_ARM_A_vs_BASELINE: deltaV,
      arithmeticArms,
      failClosed: {
        benchmarkStatus: bt01Campaign.status.status,
        officialEquivalent: bt01Campaign.reconciliation.equivalent,
        fees: bt02Campaign.fees,
      },
    };
  });

  const verdicts = campaigns.flatMap((campaign) => [
    campaign.benchmark.verdict,
    ...campaign.ledgerArms.map((arm) => arm.verdict),
    campaign.deltaV_ARM_A_vs_BASELINE.verdict,
    ...campaign.arithmeticArms.map((arm) => arm.verdict),
  ]);
  const failClosedHolds = campaigns.every(({ failClosed }) =>
    failClosed.benchmarkStatus === "BENCHMARK_PROVISIONAL"
    && failClosed.officialEquivalent === false
    && failClosed.fees.status === "UNKNOWN" && failClosed.fees.included === false);

  return {
    artifactKind: "BT-04_VALIDATION",
    schemaVersion: "1.0",
    status: "BENCHMARK_PROVISIONAL",
    inputs: hashes,
    tolerances: { floatNoise: FLOAT_NOISE, attributedBenchmarkBound: ATTRIBUTED_B_BOUND },
    causes: CAUSES,
    campaigns,
    failClosedHolds,
    unexplained: verdicts.filter((verdict) => verdict === "UNEXPLAINED").length,
    verdict: verdicts.includes("UNEXPLAINED") || !failClosedHolds
      ? "FAIL"
      : verdicts.every((verdict) => verdict === "MATCH") ? "PASS" : "PASS_WITH_ATTRIBUTED_DIFFERENCES",
  };
}

// Every input the independent check and BT-02 declare must be the exact bytes
// read here; a declared hash that does not match its file breaks provenance.
export function verifyInputBinding({ independent, bt01Manifest, bt02Manifest, fileHashes, paths = PATHS }) {
  const failures = [];
  const expect = (label, declared, path) => {
    if (declared?.path !== path || declared?.sha256 !== fileHashes[path]) failures.push(label);
  };
  expect("independent.inputs.calendar", independent.inputs?.calendar, paths.calendar);
  expect("independent.inputs.exploratoryResults", independent.inputs?.exploratoryResults, paths.exploratoryResults);
  expect("bt01Manifest.inputs.calendar", bt01Manifest.inputs?.calendar, paths.calendar);
  expect("bt02Manifest.inputs.exploratoryResults", bt02Manifest.inputs?.exploratoryResults, paths.exploratoryResults);
  expect("bt02Manifest.inputs.bt01Benchmark", bt02Manifest.inputs?.bt01Benchmark, paths.bt01);
  expect("bt02Manifest.inputs.bt01Manifest", bt02Manifest.inputs?.bt01Manifest, paths.bt01Manifest);
  if (failures.length > 0) throw new Error(`input hash binding failed: ${failures.join(", ")}`);
}

export function loadAndBuild(root, target = "v1") {
  const paths = TARGETS[target];
  if (!paths) throw new Error(`unknown BT-04 target: ${target}`);
  const bytes = (path) => readFileSync(resolve(root, path));
  const raw = Object.fromEntries(Object.entries(paths).filter(([name]) => name !== "output").map(([name, path]) => [name, bytes(path)]));
  const bt01Manifest = JSON.parse(raw.bt01Manifest);
  const bt02Manifest = JSON.parse(raw.bt02Manifest);
  if (bt01Manifest.artifact.sha256 !== sha256(raw.bt01)) throw new Error("BT-01 artifact does not match its manifest");
  if (bt02Manifest.artifact.sha256 !== sha256(raw.bt02)) throw new Error("BT-02 artifact does not match its manifest");
  const independent = JSON.parse(raw.independent);
  const fileHashes = Object.fromEntries(Object.entries(raw).map(([name, content]) => [paths[name], sha256(content)]));
  verifyInputBinding({ independent, bt01Manifest, bt02Manifest, fileHashes, paths });
  // Same lake bytes: every file the independent check read must carry the BT-01 manifest hash.
  for (const [path, hash] of Object.entries(independent.inputs.sourceFileHashes)) {
    if (bt01Manifest.inputs.sourceFileHashes[path] !== hash) throw new Error(`lake file not bound to BT-01 manifest: ${path}`);
  }
  const hashes = Object.fromEntries(Object.entries(raw).map(([name, content]) => [name, { path: paths[name], sha256: sha256(content) }]));
  hashes.independent.lakeFilesBoundToBt01Manifest = Object.keys(independent.inputs.sourceFileHashes).length;
  return { target, ...buildBt04Validation({ independent, bt01: JSON.parse(raw.bt01), bt02: JSON.parse(raw.bt02), hashes }) };
}

// Uso: node compare.mjs [--target v1|v2] [--check]
function main() {
  const root = resolve(import.meta.dirname, "../../..");
  const targetIndex = process.argv.indexOf("--target");
  const target = targetIndex === -1 ? "v2" : process.argv[targetIndex + 1];
  const validation = loadAndBuild(root, target);
  const serialized = `${JSON.stringify(validation, null, 2)}\n`;
  const output = resolve(root, TARGETS[target].output);
  if (process.argv.includes("--check")) {
    if (readFileSync(output, "utf8") !== serialized) throw new Error(`${TARGETS[target].output} is stale`);
    console.log(`BT-04 ${target} validation reproducible: ${validation.verdict}`);
    return;
  }
  writeFileSync(output, serialized);
  console.log(`BT-04 ${target} validation: ${validation.verdict} (unexplained=${validation.unexplained})`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
