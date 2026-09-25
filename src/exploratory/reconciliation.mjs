import { createHash } from "node:crypto";

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const campaignKey = (product, maturity) => `${product}-${maturity}`;
const closeEnough = (left, right) => Math.abs(left - right) <= 1e-8 * Math.max(1, Math.abs(left), Math.abs(right));

function uniqueBy(values, keyOf, description) {
  const result = new Map();
  for (const value of values) {
    const key = keyOf(value);
    if (result.has(key)) throw new Error(`duplicate ${description}: ${key}`);
    result.set(key, value);
  }
  return result;
}

function ledgerTotals(decisions) {
  if (!Array.isArray(decisions)) return null;
  let filledMw = 0;
  let costEur = 0;
  for (const decision of decisions) {
    const filled = decision.filledMw ?? 0;
    if (!Number.isFinite(filled) || filled < 0) throw new Error("invalid ledger filledMw");
    if (filled === 0) continue;
    if (!Number.isFinite(decision.priceEurMwh)) throw new Error("filled ledger row has no execution price");
    filledMw += filled;
    costEur += filled * decision.priceEurMwh;
  }
  return { filledMw, hEurMwh: filledMw > 0 ? costEur / filledMw : null };
}

function benchmarkIndex(benchmarkArtifact) {
  if (benchmarkArtifact?.artifactKind !== "BT-01_CAMPAIGN_PROVISIONAL_BENCHMARKS") {
    throw new Error("unexpected BT-01 artifact kind");
  }
  return uniqueBy(benchmarkArtifact.campaigns ?? [], (item) => item.campaignKey, "BT-01 campaign");
}

/** Reconcile stored exploratory run summaries against exact BT-01 campaign B values.
 * This consumes persisted ledgers only; it never calls the strategy runner. */
export function buildBt02Reconciliation({ results, benchmarkArtifact, resultsSha256, resultsManifestSha256, benchmarkSha256, benchmarkManifestSha256 }) {
  if (results?.artifactKind !== "EXPLORATORY_BACKTEST_RESULTS") throw new Error("unexpected exploratory results artifact kind");
  if (results?.rules?.slippageEurMwh !== 0.15) throw new Error("BT-02 requires the existing 0.15 EUR/MWh slippage assumption");
  if (!String(results?.rules?.feesEurMwh ?? "").startsWith("UNKNOWN")) throw new Error("BT-02 must preserve fees as UNKNOWN");

  const benchmarks = benchmarkIndex(benchmarkArtifact);
  const replay = uniqueBy(results.replay ?? [], (item) => campaignKey(item.product, item.maturity), "replay campaign");
  const outputCampaigns = [];

  for (const campaign of results.campaigns ?? []) {
    const key = campaignKey(campaign.product, campaign.maturity);
    const benchmark = benchmarks.get(key) ?? null;
    const replayCampaign = replay.get(key) ?? null;
    const b = benchmark?.benchmark?.B;
    const bDefined = Number.isFinite(b) && benchmark.status?.status === "BENCHMARK_PROVISIONAL";
    const hours = replayCampaign?.hours ?? null;
    const runs = Array.isArray(campaign.runs) ? campaign.runs : Object.values(campaign.runs ?? {});
    const runByArm = uniqueBy(runs, (run) => run.armId, `run arm for ${key}`);
    const decisionsByArm = replayCampaign?.decisions ?? {};
    const arms = {};

    for (const [armId, run] of runByArm) {
      const decisions = decisionsByArm[armId] ?? null;
      const totals = ledgerTotals(decisions);
      const h = Number.isFinite(run.hEurMwh) ? run.hEurMwh : null;
      const boughtMw = Number.isFinite(run.boughtMw) ? run.boughtMw : null;
      if (totals && boughtMw !== null && !closeEnough(totals.filledMw, boughtMw)) {
        throw new Error(`${key}/${armId}: stored fill total disagrees with decision ledger`);
      }
      if (totals && totals.hEurMwh !== null && h !== null && !closeEnough(totals.hEurMwh, h)) {
        throw new Error(`${key}/${armId}: stored H disagrees with decision ledger`);
      }
      const runComplete = run.status === "COMPLETE" && boughtMw === campaign.targetMw;
      const vEur = bDefined && h !== null && boughtMw !== null && Number.isFinite(hours) && hours > 0
        ? (b - h) * boughtMw * hours
        : null;
      arms[armId] = {
        runStatus: run.status,
        complete: runComplete,
        boughtMw,
        targetMw: campaign.targetMw,
        hEurMwh: h,
        hCostCompleteness: "PARTIAL",
        hCostReason: "Fees are UNKNOWN and excluded; H preserves the stored execution-price average.",
        decisionLedgerCheck: totals ? "MATCHED_TO_STORED_H_AND_VOLUME" : "NOT_AVAILABLE_IN_REPLAY",
        vEur,
        vStatus: vEur === null ? "UNAVAILABLE" : runComplete ? "PROVISIONAL" : "PARTIAL",
        vReason: vEur === null
          ? (bDefined ? "Stored H/fills or delivery hours unavailable." : "Exact campaign B is unavailable or undefined in BT-01.")
          : "Uses provisional BT-01 B and excludes UNKNOWN fees; incomplete fills value only the recorded filled MW.",
        filledLedgerRows: totals ? decisions.filter((decision) => (decision.filledMw ?? 0) > 0).length : null,
        decisionLedgerRows: Array.isArray(decisions) ? decisions.length : null,
      };
    }

    const baseline = arms.BASELINE;
    for (const [armId, arm] of Object.entries(arms)) {
      if (armId === "BASELINE") {
        arm.deltaVEur = null;
        arm.deltaVStatus = "NOT_APPLICABLE";
        continue;
      }
      const equalFilledMw = baseline && arm.boughtMw !== null && baseline.boughtMw !== null && closeEnough(arm.boughtMw, baseline.boughtMw);
      const deltaAvailable = equalFilledMw && arm.vEur !== null && baseline.vEur !== null;
      arm.deltaVEur = deltaAvailable ? arm.vEur - baseline.vEur : null;
      arm.deltaVStatus = !deltaAvailable
        ? "UNAVAILABLE"
        : arm.complete && baseline.complete ? "PROVISIONAL" : "PARTIAL";
      arm.deltaVReason = !baseline
        ? "Stored BASELINE run is unavailable."
        : !equalFilledMw
          ? "Baseline and arm do not cover equal filled MW; no unmatched-volume delta is reported."
          : "Paired against stored BASELINE on equal filled MW; BT-01 B remains provisional and UNKNOWN fees are excluded.";
    }

    const campaignStatus = !benchmark || !bDefined || !replayCampaign ? "UNAVAILABLE" : "PROVISIONAL";
    outputCampaigns.push({
      campaignKey: key,
      product: campaign.product,
      maturity: campaign.maturity,
      targetMw: campaign.targetMw,
      campaignReadiness: campaign.readiness,
      benchmark: benchmark ? {
        status: benchmark.status?.status ?? "UNKNOWN",
        B: bDefined ? b : null,
        coverage: benchmark.benchmark?.coverage ?? null,
        versionId: benchmark.benchmarkVersion?.versionId ?? null,
        window: benchmark.benchmarkWindow ?? null,
      } : null,
      deliveryHours: Number.isFinite(hours) ? hours : null,
      fees: { status: "UNKNOWN", included: false },
      status: campaignStatus,
      arms,
    });
  }

  return {
    artifactKind: "BT-02_EXPLORATORY_BENCHMARK_RECONCILIATION",
    schemaVersion: "1.0",
    status: "EXPLORATORY_PROVISIONAL",
    method: "Reconcile persisted H and decision/fill ledgers against exact BT-01 product+maturity B; do not rerun strategies.",
    assumptions: {
      slippageEurMwh: results.rules.slippageEurMwh,
      fillModels: results.rules.fillModels,
      feesEurMwh: "UNKNOWN (excluded, never treated as zero)",
      decisionAndFillLedgers: "Never rewritten; replay rows are checked where present and stored run summaries are consumed where per-arm rows are absent.",
    },
    inputs: {
      exploratoryResults: { path: "operations/exploratory/backtest-results.json", sha256: resultsSha256 },
      exploratoryManifest: { path: "operations/exploratory/MANIFEST.json", sha256: resultsManifestSha256 },
      bt01Benchmark: { path: "operations/audit/BT-01/campaign-provisional-benchmarks-BT-01.json", sha256: benchmarkSha256 },
      bt01Manifest: { path: "operations/audit/BT-01/campaign-provisional-benchmarks-BT-01.MANIFEST.json", sha256: benchmarkManifestSha256 },
    },
    campaigns: outputCampaigns,
  };
}

export function buildBt02Manifest({ artifact, artifactSha256 }) {
  return {
    artifactKind: "BT-02_EXPLORATORY_BENCHMARK_RECONCILIATION_MANIFEST",
    schemaVersion: "1.0",
    status: artifact.status,
    artifact: { path: "operations/exploratory/reconciled-results-BT-02.json", sha256: artifactSha256 },
    inputs: artifact.inputs,
    producer: "src/exploratory/reconciliation.mjs",
  };
}

export { sha256 as sha256Hex };
