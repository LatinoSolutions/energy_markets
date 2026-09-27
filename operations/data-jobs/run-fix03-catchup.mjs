// FIX-03: complete the DATA-02 job omitted from the already successful DATA-01
// queue, then rebuild source-bound artifacts. Uses the same lock, scoped memory
// limits, artifact checks and receipts as DATA-01; never replays old jobs.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  DATA_ARCHIVE, DATA_JOB_KIND, buildDataQueueSteps, createDataQueueRunner,
  resolveTrigger, triggerFingerprint,
} from "../../src/data-jobs/index.mjs";

const repoRoot = process.env.DATA_REPO_ROOT ?? path.resolve(fileURLToPath(new URL("../../", import.meta.url)));
const priorReceiptPath = process.env.DATA_PRIOR_QUEUE_RECEIPT;
const runsDir = process.env.DATA_RUNS_DIR;
const scratchDir = process.env.DATA_SCRATCH_DIR;
const priorKinds = ["DECOMPRESS", "TR01_SCAN", "TR03_BRIDGE", "BT06_EXTRACT", "BT06_BACKTEST"];
const published = [
  "operations/trades/DATA-02/TRADES_MEASUREMENT-lake-gas-the.json",
  "operations/trades/DATA-02/TRADES_MEASUREMENT-lake-gas-the.json.MANIFEST.json",
  "operations/trades/DATA-02/TRADES_MEASUREMENT-lake-power-de.json",
  "operations/trades/DATA-02/TRADES_MEASUREMENT-lake-power-de.json.MANIFEST.json",
  "operations/trades/DATA-02/SOURCE_PERIOD_COVERAGE.json",
  "operations/trades/DATA-02/SOURCE_PERIOD_COVERAGE.MANIFEST.json",
];
const rebuildPublished = [
  "operations/audit/BT-01/v3/campaign-proxy-rows-BT-01.json",
  "operations/audit/BT-01/v3/campaign-provisional-benchmarks-BT-01.json",
  "operations/audit/BT-01/v3/campaign-provisional-benchmarks-BT-01.MANIFEST.json",
  "operations/audit/IMP-05/source-proxy-rows-IMP-05-v3.json",
  "operations/audit/IMP-05/source-benchmark-receipt-IMP-05-v3.json",
  "operations/exploratory/v3/reconciled-results-BT-02.json",
  "operations/exploratory/v3/reconciled-results-BT-02.MANIFEST.json",
];

export function validateCatchup({ trigger, priorReceipt }) {
  if (trigger?.kind !== "CHECKSUM_OK" || trigger.event?.sha256 !== DATA_ARCHIVE.expectedSha256) {
    throw new Error("FIX-03 requires the verified archive CHECKSUM OK trigger");
  }
  if (priorReceipt?.receiptKind !== "DATA-01_QUEUE_RECEIPT" || priorReceipt.status !== "SUCCEEDED"
    || priorReceipt.triggerFingerprint !== triggerFingerprint(trigger)
    || JSON.stringify(priorReceipt.steps?.map((step) => step.jobKind)) !== JSON.stringify(priorKinds)) {
    throw new Error("FIX-03 requires the successful five-step DATA-01 receipt that omitted DATA02_LAKE_SCAN");
  }
  return true;
}

export function catchupSteps({ repoRoot, scratchDir }) {
  const scan = buildDataQueueSteps({ repoRoot, scratchDir }).find((step) => step.jobKind === DATA_JOB_KIND.DATA02_LAKE_SCAN);
  if (JSON.stringify(scan.publishes) !== JSON.stringify(published)) throw new Error("DATA-02 job artifact contract changed");
  const authority = "FIX-03 catchup of DATA02_LAKE_SCAN omitted from the successful 2026-09-26 DATA-01 queue; verified original checksum and receipt.";
  return [
    { ...scan, requestedBy: "fix03-catchup", authority },
    { jobKind: "FIX03_REBUILD", command: ["bash", "operations/data-jobs/jobs/fix03-rebuild.sh"],
      env: scan.env, memoryMaxBytes: scan.memoryMaxBytes, timeoutMs: scan.timeoutMs,
      publishes: rebuildPublished, requestedBy: "fix03-catchup", authority },
  ];
}

async function main() {
  if (!priorReceiptPath || !runsDir || !scratchDir) throw new Error("DATA_PRIOR_QUEUE_RECEIPT, DATA_RUNS_DIR and DATA_SCRATCH_DIR are required");
  if (!existsSync(path.join(repoRoot, "operations/trades/DATA-02/SOURCE_PERIOD_COVERAGE.json"))) throw new Error("DATA-02 baseline missing");
  const trigger = resolveTrigger({ text: readFileSync(DATA_ARCHIVE.logPath, "utf8"), expectedSha256: DATA_ARCHIVE.expectedSha256 });
  validateCatchup({ trigger, priorReceipt: JSON.parse(readFileSync(priorReceiptPath, "utf8")) });
  const runner = createDataQueueRunner({ repoRoot, runsDir, useSystemdScope: true });
  const result = await runner.runQueue({ trigger, steps: catchupSteps({ repoRoot, scratchDir }) });
  process.stdout.write(`${JSON.stringify({ ok: result.ok, code: result.code ?? null, queueId: result.queueId, status: result.queue?.status })}\n`);
  if (!result.ok) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
}
