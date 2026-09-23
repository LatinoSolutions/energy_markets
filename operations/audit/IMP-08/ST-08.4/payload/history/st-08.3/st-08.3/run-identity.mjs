// Shared ST-08.3 receipt route identity validation. The delivery verifier and
// regression suite must exercise the same cross-field contract.

export function validateWorkerRouteIdentity(receipt) {
  const errors = [];
  const currentRunId = receipt?.workerRoute?.runId;

  if (typeof currentRunId !== "string" || currentRunId.length === 0) {
    errors.push("workerRoute.runId is missing");
  }
  if (receipt?.receiptMeta?.writtenByRun !== currentRunId) {
    errors.push("receiptMeta.writtenByRun does not match workerRoute.runId");
  }
  if (typeof receipt?.workerModelRoute !== "string" || !receipt.workerModelRoute.includes(currentRunId ?? "")) {
    errors.push("workerModelRoute does not identify workerRoute.runId");
  }
  if (!Array.isArray(receipt?.runHistory) || !receipt.runHistory.some((entry) => entry?.phase === "initial implementation")) {
    errors.push("initial implementation run history is missing");
  }
  if (!Array.isArray(receipt?.runHistory) || !receipt.runHistory.some((entry) => entry?.runId === currentRunId)) {
    errors.push("current worker route run is missing from runHistory");
  }

  return { ok: errors.length === 0, errors };
}
