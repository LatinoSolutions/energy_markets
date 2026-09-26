// BT-07 (PLAN_STATUS fila BT-07, owner goal 2026-09-26 paso 5): el botón de
// Backtests lanza también los runs TRADES de TR-06. En modo TRADES el mismo
// control ejecuta, como UN job, la secuencia de TR-06 para las 4 misiones:
// Development, puente (contra el gate de TR-04) y OOS histórico, y `--assemble` al final.
//
// Misma ruta que BT-05 (./runner.mjs):
//   - Uno a la vez: comparte el lock por generaciones y el directorio de runs de
//     BT-05, así un job TOB y uno TRADES nunca corren juntos.
//   - Cada run de TR-06 es un proceso hijo lanzado por ./child-entry.mjs dentro del
//     cgroup del servicio; su pico de RSS y el memory.peak del cgroup quedan por
//     run en el receipt (plan TR-06 "Pico de RAM por run").
//   - run_id idempotente: sha256 de {commit, manifest de datos, parámetros,
//     versión}; mismo run_id con resultado no se recalcula. Registro append-only.
//   - El código del hijo sale del commit (git archive), no del src/ vivo
//     (hallazgo BT05-IDENTITY-08).
//
// Fail-closed (nota BT-07): sin el freeze de TR-04 aprobado por Bru
// (OWNER_FREEZE_APPROVAL.json) no se lanza nada y el motivo se publica.
// Una apertura del OOS nunca se repite por un segundo click: antes de cada paso
// OOS se lee el registro append-only de accesos; si la misión ya tiene una
// apertura, el paso no se lanza (patch 03 §4 "una sola apertura con la versión
// congelada"; "un run_id nuevo sobre el OOS es una nueva apertura y se cuenta").
//
// El hijo corre con cwd = repo: TR-06 lee y escribe sus rutas canónicas
// (operations/trades/TR-06/...), y el registro de accesos es uno solo.

import { spawn, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, closeSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync, writeSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { freezeApprovalProblem } from "../execution-contract/trades-contract.mjs";
import { canonicalValueSha256 } from "../pit-views/pit-record.mjs";
import { TRADES_ENGINE_MISSIONS } from "../trades-engine/missions.mjs";
import { TRADES_RUN_PHASES, TRADES_RUN_PHASE_ORDER, observationRulesForPhase, tradesRunKey } from "../trades-engine/runs.mjs";
import { JOB_STATUS, REGISTRY_EVENT, RESULT_STATE, claimJobLock, readCgroupMemoryPeak, readJobLock, releaseJobLock } from "./runner.mjs";

export const TRADES_JOB_KIND = "TRADES_RUN";
export const TRADES_JOB_VERSION = "1";
export const TRADES_RECEIPT_KIND = "BT-07_TRADES_RUN_RECEIPT";
export const TRADES_REGISTRY_FILE = "TRADES_REGISTRY.jsonl";
const RECEIPT_FILE = "RUN_RECEIPT.json";
const TRADES_RUN_ID_PATTERN = /^TR-RUN-[0-9a-f]{64}$/;
const ATTEMPT_DIR_PATTERN = /^attempt-(\d+)$/;

// Rutas de TR-06 (operations/trades/TR-06/build-trades-runs.mjs:58-73). Un test
// compara estas constantes con las del productor.
export const TRADES_ENTRY = "operations/trades/TR-06/build-trades-runs.mjs";
export const TRADES_RUNS_DIR = "operations/trades/TR-06/runs";
export const TRADES_ACCESS_REGISTRY_PATH = "operations/trades/TR-06/trades-oos-access.jsonl";
export const TRADES_BRIDGE_DECISIONS_PATH = "operations/trades/TR-06/trades-oos-bridge-decisions.json";
export const TRADES_ASSEMBLED_PATH = "operations/trades/TR-06/trades-runs.json";
export const TRADES_ASSEMBLED_MANIFEST_PATH = "operations/trades/TR-06/trades-runs.MANIFEST.json";
export const TRADES_ZONE_PLAN_PATH = "operations/trades/TR-02/trades-zone-plan.json";
export const TRADES_GAS_CALENDAR_PATH = "operations/audit/IMP-09/eex-exchange-calendar.json";
export const TRADES_POWER_CALENDAR_PATH = "operations/trades/TR-01/power-de-exchange-calendar.json";
// TR-04 (operations/trades/TR-04/build-trades-freeze.mjs:29-31).
export const TRADES_FREEZE_PATH = "operations/trades/TR-04/TRADES_CONTRACT_V1_FREEZE.json";
export const TRADES_FREEZE_MANIFEST_PATH = "operations/trades/TR-04/TRADES_CONTRACT_V1_FREEZE.MANIFEST.json";
export const OWNER_FREEZE_APPROVAL_PATH = "operations/trades/TR-04/OWNER_FREEZE_APPROVAL.json";

// Dónde deja la cola DATA-01 las filas de trades y los slots TOB: DATA_SCRATCH_DIR
// de ~/.config/energy-markets/data-queue.env (verificado 2026-09-26) y nota BT-07.
export const DEFAULT_TRADES_SCRATCH_DIR = "/srv/hot-data/energy-markets/data/scratch";
// Trades: historia completa del archivo del cliente (operations/data-jobs/jobs/tr01-scan.sh:27-34),
// Development y OOS la necesitan. TOB: slots del puente (operations/data-jobs/jobs/tr03-bridge.sh:31-38).
export const TRADES_SCRATCH_INPUTS = Object.freeze([
  { flag: "--gas-trades", file: "tr01-gas-the.ndjson" },
  { flag: "--power-trades", file: "tr01-power-de.ndjson" },
  { flag: "--gas-tob", file: "tr03-tob-gas.json" },
  { flag: "--power-tob", file: "tr03-tob-power.json" },
]);

// PROVISIONAL (REGLA 2, no canónico): techo de tiempo POR PASO para que un run
// colgado no retenga el lock. Recalcular con la duración medida del primer run real.
export const DEFAULT_TRADES_STEP_TIMEOUT_MS = 60 * 60 * 1000;

export const STEP_KIND = Object.freeze({ RUN: "RUN", ASSEMBLE: "ASSEMBLE" });

export const STEP_STATUS = Object.freeze({
  PENDING: "PENDING",
  RUNNING: "RUNNING",
  SUCCEEDED: "SUCCEEDED",
  // El run terminó y dejó su artefacto con blockedBy (p. ej. OOS sin PASS del puente).
  BLOCKED: "BLOCKED",
  // OOS de una misión que ya tiene apertura registrada: no se lanza.
  SKIPPED: "SKIPPED",
  FAILED: "FAILED",
});

// TR-06 sale con código 2 cuando el run queda bloqueado (build-trades-runs.mjs, main).
const BLOCKED_EXIT_CODE = 2;
// Bloqueo que TR-06 declara cuando la vista junta runs de versiones distintas
// (operations/trades/TR-06/build-trades-runs.mjs, assembleTradesRuns).
const MIXED_VERSIONS_BLOCKER = "RUN_ARTIFACTS_MIXED_VERSIONS";
const CHILD_ENTRY = fileURLToPath(new URL("./child-entry.mjs", import.meta.url));

const sha256Of = (bytes) => createHash("sha256").update(bytes).digest("hex");

function readJson(file) {
  return JSON.parse(readFileSync(file, "utf8"));
}

function writeJsonAtomic(file, value) {
  const temporary = `${file}.tmp`;
  writeFileSync(temporary, JSON.stringify(value, null, 1));
  renameSync(temporary, file);
}

function relative(root, absolute) {
  return path.relative(root, absolute).split(path.sep).join("/");
}

// La secuencia completa, en el orden de los comandos de TR-06
// (operations/trades/TR-06/build-trades-runs-status.mjs buildJobCommands): por
// misión Development -> puente -> OOS, y el ensamblado al final.
export function tradesSequenceSteps() {
  const steps = [];
  for (const [missionKey, definition] of Object.entries(TRADES_ENGINE_MISSIONS)) {
    for (const phase of TRADES_RUN_PHASE_ORDER) {
      for (const observationRule of observationRulesForPhase(phase)) {
        const runKey = tradesRunKey({ market: definition.market, missionKey, phase, observationRule });
        steps.push({
          index: steps.length + 1,
          kind: STEP_KIND.RUN,
          missionKey,
          market: definition.market,
          phase,
          observationRule,
          runKey,
          artifactPath: `${TRADES_RUNS_DIR}/${runKey.replaceAll("|", "__")}.json`,
        });
      }
    }
  }
  steps.push({ index: steps.length + 1, kind: STEP_KIND.ASSEMBLE, runKey: null });
  return steps;
}

function stepArguments(step, inputFlags) {
  if (step.kind === STEP_KIND.ASSEMBLE) return ["--assemble", ...inputFlags];
  const bridge = step.phase === TRADES_RUN_PHASES.OOS ? ["--bridge-decision-file", TRADES_BRIDGE_DECISIONS_PATH] : [];
  return ["--mission", step.missionKey, "--phase", step.phase, "--rule", step.observationRule, ...bridge, ...inputFlags];
}

// ---------- gate humano de TR-04 ----------

function readRepoFile(repoRoot, relativePath) {
  try {
    return { ok: true, bytes: readFileSync(path.join(repoRoot, relativePath)) };
  } catch (error) {
    return { ok: false, missing: error.code === "ENOENT" };
  }
}

function parseJson(bytes) {
  try {
    return JSON.parse(bytes);
  } catch {
    return undefined;
  }
}

// Gate del botón en modo TRADES. Sólo abre si Bru aprobó el freeze de TR-04 y el
// artefacto FROZEN lleva esa misma aprobación, ligada por hash en su manifest.
// Devuelve el primer motivo; nunca lanza.
export function evaluateTradesLaunchGate(repoRoot) {
  const approvalRead = readRepoFile(repoRoot, OWNER_FREEZE_APPROVAL_PATH);
  if (!approvalRead.ok) {
    return approvalRead.missing
      ? { ok: false, code: "TRADES_FREEZE_NOT_APPROVED", message: `sin aprobación de Bru: ${OWNER_FREEZE_APPROVAL_PATH} no existe` }
      : { ok: false, code: "TRADES_FREEZE_APPROVAL_UNREADABLE", message: `${OWNER_FREEZE_APPROVAL_PATH} no se pudo leer` };
  }
  const approval = parseJson(approvalRead.bytes);
  if (approval === undefined) {
    return { ok: false, code: "TRADES_FREEZE_APPROVAL_UNREADABLE", message: `${OWNER_FREEZE_APPROVAL_PATH} no es JSON` };
  }
  const freezeRead = readRepoFile(repoRoot, TRADES_FREEZE_PATH);
  const freeze = freezeRead.ok ? parseJson(freezeRead.bytes) : undefined;
  if (freeze === undefined || freeze === null) {
    return { ok: false, code: "TRADES_FREEZE_MISSING", message: `${TRADES_FREEZE_PATH} falta o no es JSON` };
  }
  const configHash = freeze.humanGate?.configHash ?? null;
  const problem = freezeApprovalProblem(approval, configHash);
  if (problem !== null) {
    return { ok: false, code: "TRADES_FREEZE_APPROVAL_INVALID", message: `${problem.code}: ${problem.message}` };
  }
  if (freeze.decision !== "FROZEN" || freeze.frozenContract?.status !== "FROZEN") {
    return { ok: false, code: "TRADES_FREEZE_NOT_FROZEN", message: `la aprobación existe pero ${TRADES_FREEZE_PATH} dice ${String(freeze.decision)}; falta reconstruir el freeze (build-trades-freeze.mjs)` };
  }
  const frozenApproval = freeze.frozenContract?.approval ?? null;
  if (freeze.frozenContract?.configHash !== approval.configHash || frozenApproval?.approvalRef !== approval.approvalRef || frozenApproval?.configHash !== approval.configHash) {
    return { ok: false, code: "TRADES_FREEZE_APPROVAL_MISMATCH", message: "el contrato FROZEN no lleva la aprobación registrada en OWNER_FREEZE_APPROVAL.json" };
  }
  const manifestRead = readRepoFile(repoRoot, TRADES_FREEZE_MANIFEST_PATH);
  const manifest = manifestRead.ok ? parseJson(manifestRead.bytes) : undefined;
  if (manifest?.artifact?.sha256 !== sha256Of(freezeRead.bytes) || manifest?.sources?.ownerApproval?.sha256 !== sha256Of(approvalRead.bytes)) {
    return { ok: false, code: "TRADES_FREEZE_MANIFEST_MISMATCH", message: `${TRADES_FREEZE_MANIFEST_PATH} no liga por hash el freeze y la aprobación actuales` };
  }
  return { ok: true, code: null, message: null, configHash, approvalRef: approval.approvalRef };
}

// ---------- inputs y código ----------

function scratchFingerprint(file) {
  const stats = statSync(file);
  return { path: file, bytes: stats.size, mtimeMs: stats.mtimeMs };
}

// Verifica todo lo que la secuencia va a leer. Archivos del repo: sha256. Filas
// de trades y slots TOB del scratch: huella (tamaño + mtime), porque los trades de
// power pesan 14 GB y hashearlos aquí bloquearía el servicio. SIMPLIFICACIÓN
// declarada: el sha256 real de esos archivos lo calcula cada run de TR-06 en su
// `inputs` (buildInputManifest) y el runner exige que todos los runs declaren el mismo.
export function verifyTradesInputs({ repoRoot, scratchDir }) {
  const gate = evaluateTradesLaunchGate(repoRoot);
  if (!gate.ok) return { ...gate, gate };
  const files = [];
  for (const relativePath of [TRADES_ZONE_PLAN_PATH, TRADES_FREEZE_PATH, TRADES_FREEZE_MANIFEST_PATH, OWNER_FREEZE_APPROVAL_PATH, TRADES_GAS_CALENDAR_PATH, TRADES_POWER_CALENDAR_PATH]) {
    const read = readRepoFile(repoRoot, relativePath);
    if (!read.ok) return { ok: false, code: "INPUT_MISSING", message: `falta ${relativePath}`, path: relativePath, gate };
    files.push({ path: relativePath, sha256: sha256Of(read.bytes) });
    if (relativePath === TRADES_ZONE_PLAN_PATH && parseJson(read.bytes)?.decision !== "RESERVED") {
      return { ok: false, code: "ZONE_PLAN_NOT_RESERVED", message: `${relativePath} no está RESERVED`, path: relativePath, gate };
    }
  }
  const scratch = [];
  const inputFlags = [];
  for (const input of TRADES_SCRATCH_INPUTS) {
    const file = path.join(scratchDir, input.file);
    try {
      scratch.push({ flag: input.flag, ...scratchFingerprint(file) });
    } catch {
      return { ok: false, code: "INPUT_MISSING", message: `falta ${file} (lo deja la cola DATA-01)`, path: file, gate };
    }
    inputFlags.push(input.flag, file);
  }
  return { ok: true, gate, files, scratch, inputFlags };
}

function git(repoRoot, args) {
  try {
    return execFileSync("git", args, { cwd: repoRoot, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    return null;
  }
}

const PINNED_CODE_PATHS = ["src", TRADES_ENTRY];

export function readTradesCodeCommit(repoRoot) {
  const head = git(repoRoot, ["rev-parse", "--verify", "HEAD"])?.trim() ?? "";
  if (!/^[0-9a-f]{40}$/.test(head)) return { ok: false, code: "CODE_COMMIT_UNKNOWN", message: "no se pudo leer el commit git del código" };
  const dirty = git(repoRoot, ["status", "--porcelain", "--untracked-files=all", "--", ...PINNED_CODE_PATHS]);
  if (dirty === null) return { ok: false, code: "CODE_COMMIT_UNKNOWN", message: "no se pudo leer git status del código" };
  if (dirty.trim().length > 0) {
    const paths = dirty.trim().split("\n").slice(0, 5).map((line) => line.slice(3));
    return { ok: false, code: "CODE_NOT_COMMITTED", message: `código con cambios sin commitear: ${paths.join(", ")}` };
  }
  return { ok: true, commit: head };
}

export function computeTradesRunIdentity({ codeCommit, verified }) {
  const dataManifest = { files: verified.files, scratch: verified.scratch };
  const identity = {
    codeCommit,
    dataManifestSha256: canonicalValueSha256(dataManifest).sha256,
    parameters: {
      jobKind: TRADES_JOB_KIND,
      entry: TRADES_ENTRY,
      steps: tradesSequenceSteps().map((step) => step.runKey ?? step.kind),
      inputFlags: verified.inputFlags,
    },
    engineVersion: TRADES_JOB_VERSION,
  };
  return { runId: `TR-RUN-${canonicalValueSha256(identity).sha256}`, identity };
}

function listFilesUnder(root, relativeDir) {
  const files = [];
  for (const entry of readdirSync(path.join(root, relativeDir), { withFileTypes: true })) {
    const child = `${relativeDir}/${entry.name}`;
    if (entry.isDirectory()) files.push(...listFilesUnder(root, child));
    else files.push(child);
  }
  return files;
}

function codeSeal(workspace) {
  const files = [...listFilesUnder(workspace, "src"), TRADES_ENTRY]
    .sort()
    .map((relativePath) => ({ path: relativePath, sha256: sha256Of(readFileSync(path.join(workspace, relativePath))) }));
  return { files: files.length, sha256: canonicalValueSha256(files).sha256 };
}

function stageCode(repoRoot, workspace, commit) {
  mkdirSync(workspace, { recursive: true });
  const archive = `${workspace}.code.tar`;
  try {
    execFileSync("git", ["archive", "--format=tar", "-o", archive, commit, "--", ...PINNED_CODE_PATHS], { cwd: repoRoot, stdio: ["ignore", "ignore", "pipe"] });
    execFileSync("tar", ["-xf", archive, "-C", workspace], { stdio: ["ignore", "ignore", "pipe"] });
  } finally {
    rmSync(archive, { force: true });
  }
  return codeSeal(workspace);
}

// ---------- registro de accesos del OOS (TR-06, append-only) ----------

// Aperturas registradas por misión. Una línea ilegible no se interpreta como
// "sin apertura": se devuelve error y el paso OOS no se lanza (fail-closed).
export function readOosOpenings(repoRoot) {
  let text = "";
  try {
    text = readFileSync(path.join(repoRoot, TRADES_ACCESS_REGISTRY_PATH), "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return { ok: true, byMission: {} };
    return { ok: false, code: "OOS_ACCESS_REGISTRY_UNREADABLE" };
  }
  const byMission = {};
  for (const line of text.split("\n")) {
    if (line.trim().length === 0) continue;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      return { ok: false, code: "OOS_ACCESS_REGISTRY_CORRUPT" };
    }
    if (entry?.consumesOos !== true || typeof entry.mission !== "string") continue;
    (byMission[entry.mission] ??= []).push({ runId: entry.runId ?? null, atUtc: entry.atUtc ?? null });
  }
  return { ok: true, byMission };
}

// ---------- resumen público ----------

function stepSummary(steps) {
  const counts = Object.fromEntries(Object.values(STEP_STATUS).map((status) => [status, 0]));
  for (const step of steps ?? []) counts[step.status] = (counts[step.status] ?? 0) + 1;
  const running = (steps ?? []).find((step) => step.status === STEP_STATUS.RUNNING) ?? null;
  return {
    total: (steps ?? []).length,
    counts,
    current: running === null ? null : { index: running.index, kind: running.kind, missionKey: running.missionKey ?? null, phase: running.phase ?? null, observationRule: running.observationRule ?? null },
  };
}

export function publicTradesJobView(receipt, retention = null) {
  if (receipt == null) return null;
  return {
    runId: receipt.runId,
    attempt: receipt.attempt ?? null,
    jobKind: receipt.jobKind,
    status: receipt.status,
    requestedBy: receipt.requestedBy,
    startedAt: receipt.startedAt,
    finishedAt: receipt.finishedAt ?? null,
    failure: receipt.failure ?? null,
    steps: stepSummary(receipt.steps),
    oos: receipt.oos ?? null,
    result: receipt.result ?? null,
    identity: receipt.identity ?? null,
    retention,
    receiptPath: receipt.receiptPath,
  };
}

function runManifest(receipt) {
  return {
    runId: receipt.runId,
    attempt: receipt.attempt,
    jobKind: receipt.jobKind,
    identity: receipt.identity,
    inputs: receipt.inputs,
    requestedBy: receipt.requestedBy,
    startedAt: receipt.startedAt,
    finishedAt: receipt.finishedAt ?? null,
    status: receipt.status,
    failureCode: receipt.failure?.code ?? null,
    memoryPeakByRunKey: Object.fromEntries((receipt.steps ?? []).filter((step) => step.memory != null).map((step) => [step.runKey ?? step.kind, { childMaxRssKb: step.memory.childMaxRssKb, cgroupMemoryPeakBytesAfter: step.memory.cgroupMemoryPeakBytesAfter }])),
    resultSha256: receipt.result?.assembled?.sha256 ?? null,
    receiptPath: receipt.receiptPath,
  };
}

// ---------- runner ----------

export function createTradesJobRunner({
  repoRoot,
  runsDir = null,
  scratchDir = process.env.DATA_SCRATCH_DIR ?? DEFAULT_TRADES_SCRATCH_DIR,
  stepTimeoutMs = DEFAULT_TRADES_STEP_TIMEOUT_MS,
  nodeBinary = process.execPath,
  now = () => new Date(),
} = {}) {
  if (typeof repoRoot !== "string" || repoRoot.length === 0) throw new TypeError("createTradesJobRunner requiere repoRoot.");
  const runsRoot = runsDir ?? path.join(repoRoot, "operations/backtest-runs");
  mkdirSync(runsRoot, { recursive: true });
  const registryPath = path.join(runsRoot, TRADES_REGISTRY_FILE);
  let active = null;
  let heldLockGeneration = null;

  const attemptDir = (runId, attempt) => path.join(runsRoot, runId, `attempt-${attempt}`);
  const receiptFile = (runId, attempt) => path.join(attemptDir(runId, attempt), RECEIPT_FILE);
  const attemptKey = (runId, attempt) => `${runId}#${attempt}`;

  function listAttempts(runId) {
    try {
      return readdirSync(path.join(runsRoot, runId), { withFileTypes: true })
        .map((entry) => (entry.isDirectory() ? ATTEMPT_DIR_PATTERN.exec(entry.name) : null))
        .filter((match) => match !== null)
        .map((match) => Number.parseInt(match[1], 10))
        .sort((a, b) => a - b);
    } catch {
      return [];
    }
  }

  function readAttemptReceipt(runId, attempt) {
    try {
      return readJson(receiptFile(runId, attempt));
    } catch {
      return null;
    }
  }

  function readLatestReceipt(runId) {
    if (!TRADES_RUN_ID_PATTERN.test(runId ?? "")) return null;
    const attempts = listAttempts(runId);
    return attempts.length === 0 ? null : readAttemptReceipt(runId, attempts.at(-1));
  }

  function listRunIds() {
    return readdirSync(runsRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && TRADES_RUN_ID_PATTERN.test(entry.name))
      .map((entry) => entry.name);
  }

  function readRegistry() {
    let text;
    try {
      text = readFileSync(registryPath, "utf8");
    } catch (error) {
      if (error.code === "ENOENT") return { ok: true, events: [] };
      return { ok: false, code: "REGISTRY_UNREADABLE", message: String(error?.message ?? error) };
    }
    const events = [];
    const lines = text.split("\n");
    for (let index = 0; index < lines.length; index += 1) {
      if (lines[index].length === 0) continue;
      try {
        events.push(JSON.parse(lines[index]));
      } catch {
        return { ok: false, code: "REGISTRY_CORRUPT", message: `${TRADES_REGISTRY_FILE} línea ${index + 1} no es JSON` };
      }
    }
    return { ok: true, events };
  }

  function appendRegistry(event) {
    appendFileSync(registryPath, `${JSON.stringify({ at: now().toISOString(), ...event })}\n`);
  }

  function foldRetention(events) {
    const states = new Map();
    const promotedAttempts = new Set();
    let currentRunId = null;
    for (const event of events) {
      if (event.event !== REGISTRY_EVENT.RESULT_PROMOTED) continue;
      promotedAttempts.add(attemptKey(event.runId, event.attempt));
      if (currentRunId !== null && currentRunId !== event.runId) states.set(currentRunId, { state: RESULT_STATE.SUPERSEDED, supersededBy: event.runId });
      states.set(event.runId, { state: RESULT_STATE.CURRENT, supersededBy: null });
      currentRunId = event.runId;
    }
    return { currentRunId, states, promotedAttempts };
  }

  const retentionOf = (runId, folded) => folded.states.get(runId) ?? { state: RESULT_STATE.NONE, supersededBy: null };
  const viewOf = (receipt, folded) => (receipt === null ? null : publicTradesJobView(receipt, folded === null ? null : retentionOf(receipt.runId, folded)));

  // Lock compartido con BT-05 (mismo runsRoot): uno a la vez entre ambos tipos de job.
  function liveLock() {
    const lock = readJobLock(runsRoot);
    return lock !== null && lock.live ? lock : null;
  }

  function acquireLock(runId, attempt) {
    const observed = readJobLock(runsRoot);
    if (observed !== null && observed.live) return false;
    const generation = claimJobLock(runsRoot, observed?.generation ?? 0, { runId, attempt, pid: process.pid, jobKind: TRADES_JOB_KIND });
    if (generation === null) return false;
    heldLockGeneration = generation;
    return true;
  }

  function releaseLock() {
    if (heldLockGeneration === null) return;
    const generation = heldLockGeneration;
    heldLockGeneration = null;
    releaseJobLock(runsRoot, generation, now().toISOString());
  }

  // Con el lock tomado: un receipt TRADES en RUNNING es huérfano (su proceso murió).
  function closeOrphans(ownRunId, ownAttempt) {
    for (const runId of listRunIds()) {
      for (const attempt of listAttempts(runId)) {
        if (runId === ownRunId && attempt === ownAttempt) continue;
        const receipt = readAttemptReceipt(runId, attempt);
        if (receipt?.status !== JOB_STATUS.RUNNING) continue;
        const closed = {
          ...receipt,
          status: JOB_STATUS.INTERRUPTED,
          finishedAt: now().toISOString(),
          steps: (receipt.steps ?? []).map((step) => (step.status === STEP_STATUS.RUNNING ? { ...step, status: STEP_STATUS.FAILED, failure: { code: "INTERRUPTED" } } : step)),
          failure: { code: "INTERRUPTED", message: "el proceso que corría la secuencia TRADES ya no existe; no se completó" },
        };
        writeJsonAtomic(receiptFile(runId, attempt), closed);
        appendRegistry({ event: REGISTRY_EVENT.RUN_CLOSED, runId, attempt, manifest: runManifest(closed) });
      }
    }
  }

  function latestStartedReceipt() {
    let latest = null;
    for (const runId of listRunIds()) {
      const receipt = readLatestReceipt(runId);
      if (receipt === null) continue;
      if (latest === null || String(receipt.startedAt) > String(latest.startedAt)) latest = receipt;
    }
    return latest;
  }

  // Estado leído del disco. `current` puede ser un job TOB de BT-05 (mismo lock).
  function status() {
    const lock = liveLock();
    const registry = readRegistry();
    const folded = registry.ok ? foldRetention(registry.events) : null;
    const running = lock === null ? null : readAttemptReceipt(lock.runId, lock.attempt);
    const currentResult = folded?.currentRunId == null ? null : readLatestReceipt(folded.currentRunId);
    const runningView = running === null ? null : running.jobKind === TRADES_JOB_KIND ? viewOf(running, folded) : { runId: running.runId, jobKind: running.jobKind, status: running.status, startedAt: running.startedAt };
    const gate = evaluateTradesLaunchGate(repoRoot);
    return {
      running: lock !== null,
      current: runningView,
      latest: viewOf(latestStartedReceipt(), folded),
      currentResult: viewOf(currentResult, folded),
      gate: { ok: gate.ok, code: gate.code, message: gate.message },
      registry: registry.ok ? { ok: true, path: relative(repoRoot, registryPath), events: registry.events.length } : { ok: false, code: registry.code, message: registry.message },
    };
  }

  function get(runId) {
    const receipt = readLatestReceipt(runId);
    if (receipt === null) return null;
    const registry = readRegistry();
    const folded = registry.ok ? foldRetention(registry.events) : null;
    return { receipt, job: viewOf(receipt, folded) };
  }

  function alreadyRunning() {
    const lock = liveLock();
    const receipt = lock === null ? null : readAttemptReceipt(lock.runId, lock.attempt);
    const view = receipt === null ? null : receipt.jobKind === TRADES_JOB_KIND ? publicTradesJobView(receipt) : { runId: receipt.runId, jobKind: receipt.jobKind, status: receipt.status, startedAt: receipt.startedAt };
    return { ok: false, code: "JOB_ALREADY_RUNNING", message: "hay un backtest en curso (lock de backtests tomado)", job: view };
  }

  function planRun(runId, registry) {
    if (!registry.ok) return { error: { ok: false, code: registry.code, message: registry.message } };
    const folded = foldRetention(registry.events);
    const previous = readLatestReceipt(runId);
    if (previous?.status === JOB_STATUS.SUCCEEDED && folded.promotedAttempts.has(attemptKey(previous.runId, previous.attempt))) {
      return { reused: { ok: true, reused: true, job: viewOf(previous, folded), done: Promise.resolve(previous) } };
    }
    return { attempt: (listAttempts(runId).at(-1) ?? 0) + 1, previous };
  }

  // Cierra la secuencia, la asienta y, si terminó, la promueve. No lanza.
  function finish(receipt, patch) {
    const closed = { ...receipt, ...patch, finishedAt: now().toISOString() };
    try {
      writeJsonAtomic(receiptFile(receipt.runId, receipt.attempt), closed);
      appendRegistry({ event: REGISTRY_EVENT.RUN_CLOSED, runId: closed.runId, attempt: closed.attempt, manifest: runManifest(closed) });
      if (closed.status === JOB_STATUS.SUCCEEDED) {
        const registry = readRegistry();
        if (!registry.ok) throw new Error(`${registry.code}: ${registry.message}`);
        const previous = foldRetention(registry.events).currentRunId;
        appendRegistry({ event: REGISTRY_EVENT.RESULT_PROMOTED, runId: closed.runId, attempt: closed.attempt, supersedes: previous === closed.runId ? null : previous });
      }
    } catch (error) {
      return { ...closed, settlement: { ok: false, code: "REGISTRY_WRITE_FAILED", message: String(error?.message ?? error) } };
    } finally {
      active = null;
      releaseLock();
    }
    return closed;
  }

  // Antes de cada paso: el código, los archivos del repo y la huella del scratch
  // siguen siendo los de la identidad del run.
  function driftBeforeStep(context) {
    const code = readTradesCodeCommit(repoRoot);
    if (!code.ok || code.commit !== context.commit) return { code: "CODE_CHANGED_DURING_RUN", message: `el commit del repo ya no es ${context.commit}` };
    let seal = null;
    try {
      seal = codeSeal(context.workspace).sha256;
    } catch {
      seal = null;
    }
    if (seal !== context.seal.sha256) return { code: "CODE_CHANGED_DURING_RUN", message: "el código del workspace no coincide con el extraído del commit" };
    for (const file of context.verified.files) {
      const read = readRepoFile(repoRoot, file.path);
      if (!read.ok || sha256Of(read.bytes) !== file.sha256) return { code: "INPUT_CHANGED_DURING_RUN", message: `cambió ${file.path}` };
    }
    for (const input of context.verified.scratch) {
      let current = null;
      try {
        current = scratchFingerprint(input.path);
      } catch {
        current = null;
      }
      if (current?.bytes !== input.bytes || current?.mtimeMs !== input.mtimeMs) return { code: "INPUT_CHANGED_DURING_RUN", message: `cambió ${input.path}` };
    }
    return null;
  }

  // Artefacto por run escrito por ESTE paso (mtime posterior al arranque del paso
  // y mismo runKey/commit). Un artefacto viejo de otro click no cuenta.
  function freshRunArtifact(step, context, stepStartedMs) {
    const file = path.join(repoRoot, step.artifactPath);
    let bytes;
    let mtimeMs;
    try {
      mtimeMs = statSync(file).mtimeMs;
      bytes = readFileSync(file);
    } catch {
      return null;
    }
    if (mtimeMs < stepStartedMs) return null;
    const artifact = parseJson(bytes);
    if (artifact?.runKey !== step.runKey || artifact?.codeCommit !== context.commit) return null;
    return { artifact, sha256: sha256Of(bytes) };
  }

  function spawnStep(step, context) {
    const rusageFile = path.join(context.runDir, `step-${step.index}.rusage.json`);
    const memoryBefore = readCgroupMemoryPeak();
    const stepStartedMs = Date.now();
    let child;
    let logFd = null;
    try {
      logFd = openSync(path.join(context.runDir, "job.log"), "a");
      writeSync(logFd, `\n=== paso ${step.index}/${context.steps.length} ${step.runKey ?? step.kind} ${now().toISOString()} ===\n`);
      child = spawn(nodeBinary, [CHILD_ENTRY, rusageFile, path.join(context.workspace, TRADES_ENTRY), ...stepArguments(step, context.verified.inputFlags)], {
        cwd: repoRoot,
        stdio: ["ignore", logFd, logFd],
      });
    } catch (error) {
      return Promise.resolve({ spawnError: String(error?.message ?? error) });
    } finally {
      if (logFd !== null) closeSync(logFd);
    }
    return new Promise((resolve) => {
      let settled = false;
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        child.kill("SIGKILL");
      }, stepTimeoutMs);
      child.once("error", (error) => {
        clearTimeout(timer);
        if (settled) return;
        settled = true;
        resolve({ spawnError: String(error?.message ?? error) });
      });
      child.once("exit", (exitCode, signal) => {
        clearTimeout(timer);
        if (settled) return;
        settled = true;
        let childMaxRssKb = null;
        try {
          childMaxRssKb = readJson(rusageFile).maxRSSKb ?? null;
        } catch {
          childMaxRssKb = null;
        }
        const memoryAfter = readCgroupMemoryPeak();
        const memory = {
          childMaxRssKb,
          cgroup: memoryAfter.cgroup,
          cgroupMemoryPeakBytesBefore: memoryBefore.memoryPeakBytes,
          cgroupMemoryPeakBytesAfter: memoryAfter.memoryPeakBytes,
          cgroupOomKillsDuringRun: memoryBefore.oomKills === null || memoryAfter.oomKills === null ? null : memoryAfter.oomKills - memoryBefore.oomKills,
          note: "childMaxRssKb es el pico propio de este run; memory.peak es el del cgroup completo desde que arrancó el servicio",
        };
        resolve({ exit: { code: exitCode, signal }, memory, timedOut, stepStartedMs, pid: child.pid });
      });
    });
  }

  function technicalFailure(outcome) {
    if (outcome.spawnError !== undefined) return { code: "SPAWN_FAILED", message: outcome.spawnError };
    if (outcome.timedOut) return { code: "TIMEOUT", message: `el paso superó ${stepTimeoutMs} ms (techo provisional)` };
    if (outcome.exit.code !== 0 && outcome.memory.cgroupOomKillsDuringRun > 0) return { code: "OOM_KILLED", message: `el cgroup ${outcome.memory.cgroup} mató el run por memoria (MemoryMax del servicio)` };
    return null;
  }

  function settleRunStep(step, outcome, context) {
    const failure = technicalFailure(outcome);
    if (failure !== null) return { status: STEP_STATUS.FAILED, failure };
    const fresh = freshRunArtifact(step, context, outcome.stepStartedMs);
    const exitCode = outcome.exit.code;
    if (fresh === null) {
      return { status: STEP_STATUS.FAILED, failure: { code: exitCode === 0 ? "RUN_ARTIFACT_MISSING" : "RUN_FAILED", message: `TR-06 terminó con code=${exitCode} signal=${outcome.exit.signal} sin artefacto nuevo de ${step.runKey}; ver job.log` } };
    }
    const blockedBy = Array.isArray(fresh.artifact.blockedBy) ? fresh.artifact.blockedBy : [];
    const artifact = {
      path: step.artifactPath,
      sha256: fresh.sha256,
      runId: fresh.artifact.run?.runId ?? null,
      blockedBy,
      bridgeGateDecision: fresh.artifact.run?.bridgeGate?.decision ?? null,
      oosOpening: fresh.artifact.oosAccess ?? null,
    };
    if (exitCode === 0 && blockedBy.length === 0) return { status: STEP_STATUS.SUCCEEDED, artifact, inputs: fresh.artifact.inputs ?? null };
    if (exitCode === BLOCKED_EXIT_CODE && blockedBy.length > 0) return { status: STEP_STATUS.BLOCKED, artifact, inputs: fresh.artifact.inputs ?? null };
    return { status: STEP_STATUS.FAILED, artifact, failure: { code: "RUN_FAILED", message: `TR-06 terminó con code=${exitCode} y blockedBy=${blockedBy.join(",") || "[]"}` } };
  }

  // Todos los runs tienen que declarar el MISMO manifest de datos (sha256 real de
  // trades y TOB calculado por TR-06): si difiere, la data cambió a mitad.
  function inputsDrift(steps) {
    const hashes = new Set(steps.filter((step) => step.inputsSha256 != null).map((step) => step.inputsSha256));
    return hashes.size > 1;
  }

  function settleAssemble(outcome, context, steps) {
    const failure = technicalFailure(outcome);
    if (failure !== null) return { status: STEP_STATUS.FAILED, failure };
    if (outcome.exit.code !== 0) return { status: STEP_STATUS.FAILED, failure: { code: "ASSEMBLE_FAILED", message: `--assemble terminó con code=${outcome.exit.code}; ver job.log` } };
    let bytes;
    let manifest;
    try {
      if (statSync(path.join(repoRoot, TRADES_ASSEMBLED_PATH)).mtimeMs < outcome.stepStartedMs) throw new Error("viejo");
      bytes = readFileSync(path.join(repoRoot, TRADES_ASSEMBLED_PATH));
      manifest = readJson(path.join(repoRoot, TRADES_ASSEMBLED_MANIFEST_PATH));
    } catch {
      return { status: STEP_STATUS.FAILED, failure: { code: "RUN_RESULTS_MISSING", message: `--assemble no dejó ${TRADES_ASSEMBLED_PATH} y su MANIFEST nuevos` } };
    }
    const assembledSha256 = sha256Of(bytes);
    if (manifest?.artifact?.sha256 !== assembledSha256) {
      return { status: STEP_STATUS.FAILED, failure: { code: "RUN_RESULTS_HASH_MISMATCH", message: "trades-runs.json no coincide con su MANIFEST" } };
    }
    // Lo ensamblado tiene que ser exactamente lo que dejaron los pasos de ESTE job.
    const bound = new Map((manifest.runArtifacts ?? []).map((entry) => [entry.runKey, entry.sha256]));
    const changed = steps.filter((step) => step.kind === STEP_KIND.RUN && step.artifact != null && step.status !== STEP_STATUS.SKIPPED && bound.get(step.runKey) !== step.artifact.sha256);
    if (changed.length > 0) {
      return { status: STEP_STATUS.FAILED, failure: { code: "RUN_ARTIFACT_CHANGED", message: `el ensamblado no liga los artefactos de este job: ${changed.map((step) => step.runKey).join(", ")}` } };
    }
    const assembled = parseJson(bytes);
    // También los artefactos que este job NO escribió (el OOS ya abierto por otra
    // versión, patch 03 §4): se declaran como de otra versión y TR-06 tiene que
    // haber bloqueado la vista por eso; nunca pasan como vigentes de este job
    // (hallazgo BT07-OOS-STALE-ASSEMBLE, 2026-09-26).
    const jobInputsSha256 = steps.find((step) => step.inputsSha256 != null)?.inputsSha256 ?? null;
    const foreignRuns = [];
    for (const entry of manifest.runArtifacts ?? []) {
      let runBytes;
      try {
        runBytes = readFileSync(path.resolve(repoRoot, entry.path));
      } catch {
        runBytes = null;
      }
      if (runBytes === null || sha256Of(runBytes) !== entry.sha256) {
        return { status: STEP_STATUS.FAILED, failure: { code: "RUN_ARTIFACT_CHANGED", message: `el artefacto ${entry.runKey} ya no coincide con el ensamblado` } };
      }
      const runArtifact = parseJson(runBytes);
      const inputsSha256 = runArtifact?.inputs == null ? null : canonicalValueSha256(runArtifact.inputs).sha256 ?? null;
      const codeCommit = runArtifact?.codeCommit ?? null;
      if (codeCommit !== context.commit || inputsSha256 !== jobInputsSha256) foreignRuns.push({ runKey: entry.runKey, codeCommit, inputsSha256 });
    }
    const declaresMixed = Array.isArray(assembled?.blockedBy) && assembled.blockedBy.includes(MIXED_VERSIONS_BLOCKER);
    if (foreignRuns.length > 0 && !declaresMixed) {
      return { status: STEP_STATUS.FAILED, failure: { code: "ASSEMBLED_MIXED_VERSIONS", message: `trades-runs.json presenta como vigentes runs de otra versión: ${foreignRuns.map((run) => run.runKey).join(", ")}` } };
    }
    return {
      status: STEP_STATUS.SUCCEEDED,
      assembled: {
        path: TRADES_ASSEMBLED_PATH,
        sha256: assembledSha256,
        manifest: { path: TRADES_ASSEMBLED_MANIFEST_PATH, sha256: sha256Of(readFileSync(path.join(repoRoot, TRADES_ASSEMBLED_MANIFEST_PATH))) },
        status: assembled?.status ?? null,
        blockedBy: assembled?.blockedBy ?? null,
        runs: Array.isArray(assembled?.runs) ? assembled.runs.length : null,
        foreignRuns,
      },
    };
  }

  async function runSequence(initialReceipt, context) {
    let receipt = initialReceipt;
    const steps = receipt.steps.map((step) => ({ ...step }));
    const oos = {};
    const save = (patch = {}) => {
      receipt = { ...receipt, ...patch, steps: steps.map((step) => ({ ...step })), oos: { ...oos } };
      try {
        writeJsonAtomic(receiptFile(receipt.runId, receipt.attempt), receipt);
      } catch {
        // el receipt en disco se pone al día en el próximo paso o en finish()
      }
    };
    const fail = (step, failure) => finish(receipt, { status: JOB_STATUS.FAILED, steps: steps.map((item) => ({ ...item })), oos: { ...oos }, failure: { ...failure, step: step?.index ?? null, runKey: step?.runKey ?? null } });

    for (const step of steps) {
      const drift = driftBeforeStep(context);
      if (drift !== null) return fail(step, drift);

      if (step.kind === STEP_KIND.RUN && step.phase === TRADES_RUN_PHASES.OOS) {
        const openings = readOosOpenings(repoRoot);
        if (!openings.ok) {
          Object.assign(step, { status: STEP_STATUS.FAILED, failure: { code: openings.code } });
          return fail(step, { code: openings.code, message: `${TRADES_ACCESS_REGISTRY_PATH} ilegible: no se puede afirmar que el OOS siga cerrado` });
        }
        const previous = openings.byMission[step.missionKey] ?? [];
        if (previous.length > 0) {
          Object.assign(step, { status: STEP_STATUS.SKIPPED, reason: "OOS_ALREADY_OPENED", previousOpenings: previous });
          oos[step.missionKey] = { opened: true, openedByThisJob: false, openings: previous.length };
          save();
          continue;
        }
      }

      Object.assign(step, { status: STEP_STATUS.RUNNING, startedAt: now().toISOString() });
      save();
      const outcome = await spawnStep(step, context);
      const settled = step.kind === STEP_KIND.ASSEMBLE ? settleAssemble(outcome, context, steps) : settleRunStep(step, outcome, context);
      Object.assign(step, {
        status: settled.status,
        finishedAt: now().toISOString(),
        exit: outcome.exit ?? null,
        memory: outcome.memory ?? null,
        artifact: settled.artifact ?? null,
        inputsSha256: settled.inputs == null ? null : canonicalValueSha256(settled.inputs).sha256 ?? null,
        failure: settled.failure ?? null,
      });
      if (step.kind === STEP_KIND.RUN && step.phase === TRADES_RUN_PHASES.OOS) {
        const after = readOosOpenings(repoRoot);
        const count = after.ok ? (after.byMission[step.missionKey] ?? []).length : null;
        oos[step.missionKey] = { opened: count !== null && count > 0, openedByThisJob: count !== null && count > 0, openings: count };
        // Un paso OOS registra a lo sumo UNA apertura (patch 03 §4).
        if (count !== null && count > 1) {
          save();
          return fail(step, { code: "OOS_OPENED_MORE_THAN_ONCE", message: `${step.missionKey} tiene ${count} aperturas registradas` });
        }
      }
      if (inputsDrift(steps)) {
        save();
        return fail(step, { code: "INPUT_CHANGED_DURING_RUN", message: "los runs declaran manifests de datos distintos (trades/TOB cambiaron durante la secuencia)" });
      }
      if (settled.status === STEP_STATUS.FAILED) {
        save();
        return fail(step, settled.failure);
      }
      if (step.kind === STEP_KIND.ASSEMBLE) {
        save();
        const inputsSha256 = steps.find((item) => item.inputsSha256 != null)?.inputsSha256 ?? null;
        return finish(receipt, {
          status: JOB_STATUS.SUCCEEDED,
          steps: steps.map((item) => ({ ...item })),
          oos: { ...oos },
          result: { assembled: settled.assembled, runsInputsSha256: inputsSha256, summary: stepSummary(steps).counts },
        });
      }
      save();
    }
    return fail(null, { code: "SEQUENCE_INCOMPLETE", message: "la secuencia terminó sin ensamblado" });
  }

  function start({ requestedBy } = {}) {
    if (requestedBy !== "ui" && requestedBy !== "mcp") {
      return { ok: false, code: "INVALID_REQUESTER", message: 'requestedBy debe ser "ui" o "mcp"' };
    }
    if (active !== null || liveLock() !== null) return alreadyRunning();
    // Gate humano primero: sin freeze aprobado no se evalúa nada más ni se lanza nada.
    const gate = evaluateTradesLaunchGate(repoRoot);
    if (!gate.ok) return { ok: false, code: gate.code, message: gate.message };
    const registry = readRegistry();
    if (!registry.ok) return { ok: false, code: registry.code, message: registry.message };
    const code = readTradesCodeCommit(repoRoot);
    if (!code.ok) return { ok: false, code: code.code, message: code.message };
    const verified = verifyTradesInputs({ repoRoot, scratchDir });
    if (!verified.ok) return { ok: false, code: verified.code, message: verified.message };
    const { runId, identity } = computeTradesRunIdentity({ codeCommit: code.commit, verified });

    const beforeLock = planRun(runId, registry);
    if (beforeLock.reused) return beforeLock.reused;
    if (beforeLock.error) return beforeLock.error;
    if (!acquireLock(runId, beforeLock.attempt)) return alreadyRunning();
    const underLock = planRun(runId, readRegistry());
    if (underLock.error || underLock.reused || underLock.attempt !== beforeLock.attempt) {
      releaseLock();
      return underLock.error ?? underLock.reused ?? start({ requestedBy });
    }
    const { attempt, previous } = underLock;
    try {
      if (previous?.status === JOB_STATUS.SUCCEEDED) {
        appendRegistry({ event: REGISTRY_EVENT.PROMOTION_MISSING, runId, attempt: previous.attempt, retriedAs: attempt, manifest: runManifest(previous) });
      }
      closeOrphans(runId, attempt);
    } catch (error) {
      releaseLock();
      return { ok: false, code: "REGISTRY_WRITE_FAILED", message: String(error?.message ?? error) };
    }

    const runDir = attemptDir(runId, attempt);
    const workspace = path.join(runDir, "workspace");
    const steps = tradesSequenceSteps().map((step) => ({ ...step, status: STEP_STATUS.PENDING }));
    let receipt = {
      receiptKind: TRADES_RECEIPT_KIND,
      schemaVersion: "1",
      runId,
      attempt,
      jobKind: TRADES_JOB_KIND,
      jobVersion: TRADES_JOB_VERSION,
      identity,
      status: JOB_STATUS.RUNNING,
      requestedBy,
      startedAt: now().toISOString(),
      receiptPath: relative(repoRoot, receiptFile(runId, attempt)),
      code: { gitHead: code.commit, entry: TRADES_ENTRY },
      gate: { configHash: gate.configHash, approvalRef: gate.approvalRef },
      inputs: { files: verified.files, scratch: verified.scratch },
      steps,
      oos: {},
      authority: "BT-07 owner goal 2026-09-26; comando autorizado con receipt (SPEC v1.1.1 §26.5). Runs TRADES de TR-06 tras el freeze de TR-04 aprobado por Bru.",
    };
    let seal;
    try {
      mkdirSync(runDir, { recursive: true });
      writeJsonAtomic(receiptFile(runId, attempt), receipt);
      seal = stageCode(repoRoot, workspace, code.commit);
      receipt = { ...receipt, code: { ...receipt.code, source: "git archive del commit", staged: seal } };
      writeJsonAtomic(receiptFile(runId, attempt), receipt);
    } catch (error) {
      const closed = finish(receipt, { status: JOB_STATUS.FAILED, failure: { code: "STAGING_FAILED", message: String(error?.message ?? error) } });
      return { ok: false, code: "STAGING_FAILED", job: publicTradesJobView(closed) };
    }
    const context = { commit: code.commit, workspace, seal, runDir, verified, steps };
    // `active` se toma ANTES de lanzar la secuencia: si falla sincrónicamente en el
    // paso 1, finish() lo libera y no queda un job fantasma bloqueando el botón
    // (hallazgo BT07-ACTIVE-RACE, 2026-09-26; mismo orden que runner.mjs:859).
    const job = { receipt, done: null };
    active = job;
    job.done = runSequence(receipt, context).catch((error) => finish(receipt, { status: JOB_STATUS.FAILED, failure: { code: "RUN_FAILED", message: String(error?.message ?? error) } }));
    return { ok: true, reused: false, job: publicTradesJobView(receipt, { state: RESULT_STATE.NONE, supersededBy: null }), done: job.done };
  }

  // Al arrancar el servicio: si nadie tiene el lock, cierra los TRADES huérfanos.
  if (acquireLock(null, null)) {
    try {
      closeOrphans(null, null);
    } finally {
      releaseLock();
    }
  }

  return {
    runsRoot,
    registryPath,
    scratchDir,
    start,
    status,
    get,
    now,
    waitForIdle: () => (active?.done ?? Promise.resolve(null)),
  };
}
