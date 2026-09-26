// BT-05 — ejecución canónica de backtests desde la app EM (owner request 25-sep-2026).

export {
  DEFAULT_RUNS_DIR,
  DEFAULT_TIMEOUT_MS,
  EXPLORATORY_ENTRY,
  EXPLORATORY_MANIFEST_PATH,
  EXPLORATORY_OUTPUT,
  EXPLORATORY_RELEASE,
  JOB_KIND,
  JOB_STATUS,
  JOB_VERSION,
  OUTPUT_DIR,
  RECEIPT_KIND,
  REGISTRY_EVENT,
  REGISTRY_FILE,
  RESULT_STATE,
  WORKSPACE_DIR,
  WORKSPACE_RETENTION,
  claimJobLock,
  computeRunIdentity,
  createBacktestJobRunner,
  publicJobView,
  readCgroupMemoryPeak,
  readCodeCommit,
  readJobLock,
  verifyExploratoryInputs,
} from "./runner.mjs";

export { BACKTEST_JOBS_PATH, backtestJobStatusPayload, handleBacktestJobsRequest, isBacktestJobsPath, tradesJobStatusPayload } from "./http.mjs";

export { FAILURE_WORDS, describeJobStatus, describeLaunch, describeTradesLaunch, describeTradesStatus, elapsedSeconds, failureInWords } from "./display.mjs";

// BT-07 — runs TRADES de TR-06 desde el mismo botón (owner goal 2026-09-26).
export {
  DEFAULT_TRADES_SCRATCH_DIR,
  OWNER_FREEZE_APPROVAL_PATH,
  STEP_KIND,
  STEP_STATUS,
  TRADES_ACCESS_REGISTRY_PATH,
  TRADES_ENTRY,
  TRADES_JOB_KIND,
  TRADES_RECEIPT_KIND,
  TRADES_SCRATCH_INPUTS,
  computeTradesRunIdentity,
  createTradesJobRunner,
  evaluateTradesLaunchGate,
  readOosOpenings,
  tradesSequenceSteps,
  verifyTradesInputs,
} from "./trades-runner.mjs";

export { MCP_TOOLS, handleMcpMessage, runStdioServer } from "./mcp-server.mjs";
