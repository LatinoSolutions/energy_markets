// FIX-03: source lineage is a separate gate from byte integrity. A valid hash
// on a lake-era artifact does not make it current after DATA-02 changed source.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

const DECISION = "operations/trades/TR-01/DATA_SOURCE_DECISION.json";
const DECISION_MANIFEST = "operations/trades/TR-01/DATA_SOURCE_DECISION.MANIFEST.json";
const COVERAGE = "operations/trades/DATA-02/SOURCE_PERIOD_COVERAGE.json";
const COVERAGE_MANIFEST = "operations/trades/DATA-02/SOURCE_PERIOD_COVERAGE.MANIFEST.json";
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

function verifiedJson(root, artifactPath, manifestPath) {
  const bytes = readFileSync(path.join(root, artifactPath));
  const manifest = JSON.parse(readFileSync(path.join(root, manifestPath), "utf8"));
  if (manifest.artifact?.path !== artifactPath || manifest.artifact.sha256 !== sha256(bytes)) {
    throw new Error(`Source artifact hash mismatch: ${artifactPath}`);
  }
  return { value: JSON.parse(bytes), manifest, sha256: sha256(bytes) };
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
    // A new path alone does not prove reconstruction. FIX-03 needs a new
    // source-bound release and a completed DATA-02 lake measurement first.
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
