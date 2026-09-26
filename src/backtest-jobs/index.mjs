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

export { BACKTEST_JOBS_PATH, backtestJobStatusPayload, handleBacktestJobsRequest, isBacktestJobsPath } from "./http.mjs";

export { FAILURE_WORDS, describeJobStatus, describeLaunch, elapsedSeconds, failureInWords } from "./display.mjs";

export { MCP_TOOLS, handleMcpMessage, runStdioServer } from "./mcp-server.mjs";
