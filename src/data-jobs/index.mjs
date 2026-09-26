// DATA-01 — cola automática de jobs de data (owner decision 2026-09-26).

export {
  CHECKSUM_LINE_PATTERN,
  TRIGGER_KIND,
  parseChecksumEvents,
  resolveTrigger,
  triggerFingerprint,
} from "./trigger.mjs";

export {
  DATA_ARCHIVE,
  DATA_JOB_KIND,
  PROVISIONAL_MEMORY_MAX_BYTES,
  PROVISIONAL_TIMEOUT_MS,
  STEP_ARTIFACTS,
  buildDataQueueSteps,
} from "./pipeline.mjs";

export {
  TELEGRAM_API_ORIGIN,
  createTelegramNotifier,
  jobNotificationText,
  triggerNotificationText,
} from "./telegram.mjs";

export {
  TRIGGER_STATE_FILE,
  planTriggerAction,
  readTriggerState,
  writeTriggerState,
} from "./run.mjs";

export {
  DEFAULT_DATA_RUNS_DIR,
  QUEUE_ID_PATTERN,
  QUEUE_RECEIPT_FILE,
  QUEUE_RECEIPT_KIND,
  QUEUE_STATUS,
  STEP_RECEIPT_FILE,
  STEP_RECEIPT_KIND,
  STEP_STATUS,
  buildSpawnCommand,
  createDataQueueRunner,
  queueIdFor,
  stepFingerprint,
} from "./runner.mjs";
