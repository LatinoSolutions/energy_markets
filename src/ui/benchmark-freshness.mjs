// FIX-03: source lineage is a separate gate from byte integrity. A valid hash
// on a lake-era artifact does not make it current after DATA-02 changed source.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

const DECISION = "operations/trades/TR-01/DATA_SOURCE_DECISION.json";
const DECISION_MANIFEST = "operations/trades/TR-01/DATA_SOURCE_DECISION.MANIFEST.json";
const COVERAGE = "operations/trades/DATA-02/SOURCE_PERIOD_COVERAGE.json";
const COVERAGE_MANIFEST = "operations/trades/DATA-02/SOURCE_PERIOD_COVERAGE.MANIFEST.json";
const BT01_V3 = "operations/audit/BT-01/v3/campaign-provisional-benchmarks-BT-01.json";
const BT01_V3_MANIFEST = "operations/audit/BT-01/v3/campaign-provisional-benchmarks-BT-01.MANIFEST.json";
const IMP05_V3_ROWS = "operations/audit/IMP-05/source-proxy-rows-IMP-05-v3.json";
const IMP05_V3_RECEIPT = "operations/audit/IMP-05/source-benchmark-receipt-IMP-05-v3.json";
const BT02_V3 = "operations/exploratory/v3/reconciled-results-BT-02.json";
const BT02_V3_MANIFEST = "operations/exploratory/v3/reconciled-results-BT-02.MANIFEST.json";
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

function verifiedJson(root, artifactPath, manifestPath) {
  const bytes = readFileSync(path.join(root, artifactPath));
  const manifest = JSON.parse(readFileSync(path.join(root, manifestPath), "utf8"));
  if (manifest.artifact?.path !== artifactPath || manifest.artifact.sha256 !== sha256(bytes)) {
    throw new Error(`Source artifact hash mismatch: ${artifactPath}`);
  }
  return { value: JSON.parse(bytes), manifest, sha256: sha256(bytes) };
}

function sourceDaysMatchCoverage(campaigns, coverageCampaigns, shape) {
  if (!Array.isArray(campaigns)) return false;
  return campaigns.every((campaign) => {
    const start = shape === "benchmark" ? campaign.benchmarkWindow?.startInclusive : campaign.windowStart;
    const endExclusive = shape === "benchmark" ? campaign.benchmarkWindow?.endExclusive : campaign.windowEnd;
    const end = new Date(`${endExclusive}T00:00:00Z`);
    if (!Number.isFinite(end.getTime())) return false;
    end.setUTCDate(end.getUTCDate() - 1);
    const last = end.toISOString().slice(0, 10);
    const candidates = coverageCampaigns.filter((record) => record.market === "GAS_THE"
      && record.shortCode === campaign.product && record.windowStart === start && record.windowEnd === last);
    if (candidates.length !== 1 || !Array.isArray(campaign.perDate)) return false;
    const plan = candidates[0].patch?.days ?? [];
    return plan.length === campaign.perDate.length && plan.every((entry, index) =>
      entry.day === campaign.perDate[index].trdDate && entry.source === campaign.perDate[index].selectedSource);
  });
}

function imp05DaysMatchCoverage(days, coverageCampaigns) {
  if (!Array.isArray(days)) return false;
  return days.every((day) => {
    const matches = coverageCampaigns.filter((record) => record.market === "GAS_THE" && record.shortCode === "G0BQ"
      && record.windowStart <= day.trdDate && day.trdDate <= record.windowEnd)
      .flatMap((record) => (record.patch?.days ?? []).filter((entry) => entry.day === day.trdDate));
    return matches.length === 1 && matches[0].source === day.selectedSource;
  });
}

export function assessBenchmarkFreshness(root, bt02Manifest) {
  try {
    const decision = verifiedJson(root, DECISION, DECISION_MANIFEST);
    const coverage = verifiedJson(root, COVERAGE, COVERAGE_MANIFEST);
    if (coverage.manifest.inputs?.tr01Decision?.sha256 !== decision.sha256
      || coverage.manifest.inputs.tr01Decision.path !== DECISION
      || decision.value.status !== "DECIDED"
      || coverage.value.ownerDecision?.status !== "PARCHE_VERIFICADO") {
      return { status: "UNAVAILABLE", reason: "TR-01/DATA-02 source lineage is not verified" };
    }
    const stale = decision.value.staleArtifacts ?? [];
    const staleBenchmark = stale.find((entry) => entry.id === "BT-01-CAMPAIGN-BENCHMARKS");
    const staleProxy = stale.find((entry) => entry.id === "IMP-05-LAKE-PROXY-ROWS");
    if (!staleBenchmark || !staleProxy) {
      return { status: "UNAVAILABLE", reason: "TR-01 does not declare both FIX-03 stale artifacts" };
    }
    const benchmarkPath = bt02Manifest?.inputs?.bt01Benchmark?.path;
    if (staleBenchmark.paths.includes(benchmarkPath)) {
      return {
        status: "STALE",
        reason: "BT-01 B and IMP-05 proxy rows came from the EEX lake before the DATA-02 source decision",
        staleArtifacts: [staleBenchmark.id, staleProxy.id],
        sourceDecisionSha256: decision.sha256,
        periodCoverageSha256: coverage.sha256,
      };
    }
    if (coverage.value.ownerDecision.verificationStatus === "RULE_APPLIED"
      && benchmarkPath === BT01_V3
      && bt02Manifest?.artifact?.path === BT02_V3
      && bt02Manifest?.inputs?.bt01Manifest?.path === BT01_V3_MANIFEST) {
      try {
        const bt01 = verifiedJson(root, BT01_V3, BT01_V3_MANIFEST);
        const bt02 = verifiedJson(root, BT02_V3, BT02_V3_MANIFEST);
        const rowsBytes = readFileSync(path.join(root, bt01.value.sourceArtifact.path));
        const rows = JSON.parse(rowsBytes);
        const impRowsBytes = readFileSync(path.join(root, IMP05_V3_ROWS));
        const impRows = JSON.parse(impRowsBytes);
        const impReceipt = JSON.parse(readFileSync(path.join(root, IMP05_V3_RECEIPT), "utf8"));
        const bt01RowsByKey = new Map((rows.campaigns ?? []).map((campaign) => [campaign.campaignKey, campaign]));
        const filesBound = Array.isArray(rows.campaigns) && rows.campaigns.every((campaign) =>
          campaign.perDate?.every((day) => day.sourceFiles?.every((file) => rows.sourceFileHashes?.[file.path] === file.sha256)))
          && bt01.value.campaigns?.every((campaign) => campaign.perDate?.every((day, index) =>
            JSON.stringify(day.sourceFiles) === JSON.stringify(bt01RowsByKey.get(campaign.campaignKey)?.perDate?.[index]?.sourceFiles)))
          && impRows.perDate?.every((day, index) => JSON.stringify(day.sourceFiles) === JSON.stringify(impReceipt.perDate?.[index]?.sourceFiles));
        const sourceBound = (value) => value?.sourceCoverage?.sha256 === coverage.sha256
          && value?.sourceCoverage?.manifestSha256 === sha256(readFileSync(path.join(root, COVERAGE_MANIFEST)));
        const daysBound = (campaigns) => Array.isArray(campaigns) && campaigns.every((campaign) =>
          Array.isArray(campaign.perDate) && campaign.perDate.every((day) =>
            ["CLIENT_SEALED_ARCHIVE", "EEX_LAKE_PATCH", "DATA_INCOMPLETE"].includes(day.selectedSource)
            && (day.selectedSource !== "DATA_INCOMPLETE" || (day.defined !== true && day.dailyReference == null))
            && Array.isArray(day.sourceFiles)
            && (day.selectedSource === "DATA_INCOMPLETE"
              ? day.sourceFiles.length === 0
              : day.sourceFiles.some((file) => file.path?.startsWith(`${day.selectedSource}/`) && /^[0-9a-f]{64}$/.test(file.sha256)))));
        if (bt02.sha256 === bt02Manifest.artifact.sha256
          && bt01.value.artifactKind === "BT-01_CAMPAIGN_PROVISIONAL_BENCHMARKS"
          && rows.artifactKind === "BT-01_CAMPAIGN_PROXY_ROWS"
          && impRows.artifactKind === "IMP-05_SOURCE_PROXY_ROWS"
          && impReceipt.artifactKind === "IMP-05_SOURCE_PROXY_BENCHMARK_RECEIPT"
          && bt02.manifest.inputs?.bt01Benchmark?.sha256 === bt01.sha256
          && bt02.manifest.inputs?.bt01Manifest?.sha256 === sha256(readFileSync(path.join(root, BT01_V3_MANIFEST)))
          && bt01.manifest.inputs?.rowsArtifact?.sha256 === sha256(rowsBytes)
          && bt01.value.sourceArtifact?.sha256 === sha256(rowsBytes)
          && sourceBound(bt01.value) && sourceBound(rows)
          && filesBound
          && daysBound(bt01.value.campaigns) && daysBound(rows.campaigns)
          && sourceDaysMatchCoverage(bt01.value.campaigns, coverage.value.campaigns, "benchmark")
          && sourceDaysMatchCoverage(rows.campaigns, coverage.value.campaigns, "rows")
          && sourceBound(impRows) && sourceBound(impReceipt)
          && impReceipt.rowsArtifact?.path === IMP05_V3_ROWS
          && impReceipt.rowsArtifact?.sha256 === sha256(impRowsBytes)
          && Array.isArray(impRows.perDate)
          && impRows.perDate.every((day) => ["CLIENT_SEALED_ARCHIVE", "EEX_LAKE_PATCH", "DATA_INCOMPLETE"].includes(day.selectedSource)
            && Array.isArray(day.sourceFiles)
            && (day.selectedSource === "DATA_INCOMPLETE"
              ? day.sourceFiles.length === 0
              : day.sourceFiles.some((file) => file.path?.startsWith(`${day.selectedSource}/`) && /^[0-9a-f]{64}$/.test(file.sha256))))
          && imp05DaysMatchCoverage(impRows.perDate, coverage.value.campaigns)) {
          return { status: "CURRENT", reason: "BT-01, BT-02 and IMP-05 releases bind to DATA-02 verified daily source selection",
            sourceDecisionSha256: decision.sha256, periodCoverageSha256: coverage.sha256 };
        }
      } catch { /* Source-bound release is incomplete or invalid. */ }
    }
    // A new path alone does not prove reconstruction.
    return {
      status: "UNAVAILABLE",
      reason: coverage.value.ownerDecision.verificationStatus !== "RULE_APPLIED"
        ? "DATA-02 lake measurement is pending"
        : "No verified FIX-03 benchmark release is bound to the source decision",
    };
  } catch {
    return { status: "UNAVAILABLE", reason: "TR-01/DATA-02 source artifacts are missing or have invalid hashes" };
  }
}
