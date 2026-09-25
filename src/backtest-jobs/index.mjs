// BT-05 — ejecución canónica de backtests desde la app EM (owner request 25-sep-2026).

export {
  DEFAULT_RUNS_DIR,
  DEFAULT_TIMEOUT_MS,
  JOB_KIND,
  JOB_STATUS,
  JOB_VERSION,
  RECEIPT_KIND,
  createBacktestJobRunner,
  publicJobView,
  readCgroupMemoryPeak,
  verifyExploratoryInputs,
} from "./runner.mjs";

export { BACKTEST_JOBS_PATH, handleBacktestJobsRequest, isBacktestJobsPath } from "./http.mjs";

export { MCP_TOOLS, handleMcpMessage, runStdioServer } from "./mcp-server.mjs";
