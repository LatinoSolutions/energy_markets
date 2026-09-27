import { test } from "node:test";
import assert from "node:assert/strict";
import { catchupSteps, validateCatchup } from "../../operations/data-jobs/run-fix03-catchup.mjs";
import { DATA_ARCHIVE, triggerFingerprint } from "../../src/data-jobs/index.mjs";

const trigger = { kind: "CHECKSUM_OK", event: { at: "2026-09-26T05:12:55Z", sha256: DATA_ARCHIVE.expectedSha256, lineNumber: 5 } };
const receipt = { receiptKind: "DATA-01_QUEUE_RECEIPT", status: "SUCCEEDED", triggerFingerprint: triggerFingerprint(trigger),
  steps: ["DECOMPRESS", "TR01_SCAN", "TR03_BRIDGE", "BT06_EXTRACT", "BT06_BACKTEST"].map((jobKind) => ({ jobKind })) };

test("FIX-03 catchup requires the genuine successful queue that omitted DATA-02", () => {
  assert.equal(validateCatchup({ trigger, priorReceipt: receipt }), true);
  assert.throws(() => validateCatchup({ trigger, priorReceipt: { ...receipt, status: "FAILED" } }));
  assert.throws(() => validateCatchup({ trigger, priorReceipt: { ...receipt, steps: [...receipt.steps, { jobKind: "DATA02_LAKE_SCAN" }] } }));
  assert.throws(() => validateCatchup({ trigger: { ...trigger, event: { ...trigger.event, sha256: "0".repeat(64) } }, priorReceipt: receipt }));
});

test("FIX-03 catchup runs only the bounded DATA-02 scan and rebuild with artifact receipts", () => {
  const steps = catchupSteps({ repoRoot: "/fixture/repo", scratchDir: "/fixture/scratch" });
  assert.deepEqual(steps.map((step) => step.jobKind), ["DATA02_LAKE_SCAN", "FIX03_REBUILD"]);
  for (const step of steps) {
    assert.ok(step.memoryMaxBytes > 0 && step.timeoutMs > 0);
    assert.ok(step.publishes.length > 0);
    assert.equal(step.requestedBy, "fix03-catchup");
    assert.equal(step.env.DATA_REPO_ROOT, "/fixture/repo");
  }
});
