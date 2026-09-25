// BT-05: la línea de estado del job tal como la muestra el botón de Backtests.
// Decisión de Bru P-009 (2026-09-25, "aprobar con cambios"): frase completa, sin
// notación ni "NONE"; mientras corre, hora de inicio y tiempo transcurrido
// publicados por el backend. Por eso el texto se arma aquí y la UI sólo lo copia
// (SPEC v1.1.1 §26.5, cero cálculo en la UI).

import { JOB_STATUS, RESULT_STATE } from "./runner.mjs";

// failure.code "en palabras" (P-009 punto 1). Cubre todos los códigos que emite
// runner.mjs; test "BT-05 display: todo failure.code del runner tiene su frase".
export const FAILURE_WORDS = Object.freeze({
  OOM_KILLED: "killed for exceeding the memory limit",
  TIMEOUT: "stopped after exceeding the time limit",
  RUN_FAILED: "the backtest script exited with an error",
  INTERRUPTED: "the process running it stopped before it finished",
  SPAWN_FAILED: "the backtest process could not be started",
  STAGING_FAILED: "the run workspace could not be prepared",
  CODE_CHANGED_DURING_RUN: "the code changed during the run",
  GENERATOR_CHANGED_DURING_RUN: "a data generator changed during the run",
  INPUT_CHANGED_DURING_RUN: "input data changed during the run",
  SLOTS_CHANGED_DURING_RUN: "slot data changed during the run",
  RUN_MANIFEST_MISSING: "the run produced no manifest",
  RUN_RESULTS_MISSING: "the run produced no results",
  RUN_RESULTS_UNREADABLE: "the run results could not be read",
  RUN_RESULTS_HASH_MISMATCH: "the run results do not match their manifest",
  JOB_ALREADY_RUNNING: "a backtest is already running",
  INVALID_REQUESTER: "the request did not say who launched it",
  CODE_NOT_COMMITTED: "the code has uncommitted changes",
  CODE_COMMIT_UNKNOWN: "the code commit could not be read",
  INPUT_HASH_MISMATCH: "input data does not match its manifest",
  INPUT_MISSING: "input data is missing",
  MANIFEST_MISSING: "the data manifest is missing",
  MANIFEST_UNREADABLE: "the data manifest could not be read",
  MANIFEST_INVALID: "the data manifest is invalid",
  RELEASE_MISMATCH: "the data manifest is not the current release",
  ENTRY_NOT_IN_MANIFEST: "the backtest script is not in the data manifest",
  REGISTRY_CORRUPT: "the run registry is corrupt",
  REGISTRY_UNREADABLE: "the run registry could not be read",
  REGISTRY_WRITE_FAILED: "the run registry could not be written",
});

export function failureInWords(code) {
  if (typeof code !== "string" || code.length === 0) return "reason not recorded";
  return FAILURE_WORDS[code] ?? code.toLowerCase().replaceAll("_", " ");
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const pad2 = (n) => String(n).padStart(2, "0");

function parseInstant(iso) {
  const date = typeof iso === "string" ? new Date(iso) : null;
  return date === null || Number.isNaN(date.getTime()) ? null : date;
}

// "15:00 UTC"
function utcTime(date) {
  return `${pad2(date.getUTCHours())}:${pad2(date.getUTCMinutes())} UTC`;
}

// "25 Sep 2026 15:00 UTC"
function utcDateTime(date) {
  return `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()} ${utcTime(date)}`;
}

// Segundos enteros desde startedAt hasta `now`, o null si startedAt no es legible.
export function elapsedSeconds(startedAt, now) {
  const started = parseInstant(startedAt);
  if (started === null) return null;
  return Math.max(0, Math.floor((now.getTime() - started.getTime()) / 1000));
}

function runningLine(job, now) {
  const started = parseInstant(job?.startedAt);
  if (started === null) return "Running · start time unavailable";
  const minutes = Math.floor(elapsedSeconds(job.startedAt, now) / 60);
  const elapsed = minutes < 1 ? "less than 1 min elapsed" : `${minutes} min elapsed`;
  return `Running · started ${utcTime(started)} · ${elapsed}`;
}

function succeededLine(job) {
  const finished = parseInstant(job.finishedAt);
  const when = finished === null ? "finish time unavailable" : utcDateTime(finished);
  const state = job.retention?.state;
  let result = "result status unavailable";
  if (state === RESULT_STATE.CURRENT) result = "current result";
  if (state === RESULT_STATE.SUPERSEDED) result = "superseded by a newer result";
  if (state === RESULT_STATE.NONE) result = "result not registered as current";
  return `Last run: succeeded · ${when} · ${result}`;
}

function lastRunLine(job) {
  if (job == null) return "No backtest has been run yet";
  if (job.status === JOB_STATUS.SUCCEEDED) return succeededLine(job);
  if (job.status === JOB_STATUS.FAILED) return `Last run: failed · ${failureInWords(job.failure?.code)}`;
  if (job.status === JOB_STATUS.INTERRUPTED) return `Last run: interrupted · ${failureInWords(job.failure?.code ?? "INTERRUPTED")}`;
  // RUNNING en disco sin lock vivo: su proceso ya no existe y aún no se cerró.
  if (job.status === JOB_STATUS.RUNNING) return "Last run: did not finish · its process is no longer running";
  return "Last run: status unavailable";
}

// Línea para GET /api/backtest-jobs (y el render inicial de /backtests).
export function describeJobStatus(status, now) {
  if (status?.running === true) return runningLine(status.current, now);
  return lastRunLine(status?.latest ?? null);
}

// Línea para la respuesta de POST /api/backtest-jobs.
export function describeLaunch(started, now) {
  if (started?.ok === true && started.reused === true) return "Last run: reused existing result";
  if (started?.ok === true) return runningLine(started.job, now);
  if (started?.code === "JOB_ALREADY_RUNNING") return runningLine(started.job, now);
  return `Not started · ${failureInWords(started?.code)}`;
}
