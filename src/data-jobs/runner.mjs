// DATA-01 (PLAN_STATUS, owner decision 2026-09-26): runner de la cola automática
// de jobs de data. Corre los pasos de a UNO, con el mismo contrato de jobs que
// BT-05 (uno a la vez con lock en disco, receipt por job, registro, memory.peak
// medido), y avisa por Telegram al terminar o fallar cada job.
//
// Diferencias con el runner de BT-05, deliberadas:
//   - Los pasos son data jobs (descomprimir, escanear, medir, extraer, backtest),
//     no sólo el backtest exploratorio de gas: por eso los tipos de job viven en
//     src/data-jobs/pipeline.mjs.
//   - Cada job declara un MemoryMax; en producción se lanza en su propio scope
//     de systemd (`systemd-run --user --scope -p MemoryMax=...`), por eso cada
//     receipt registra `memoryMaxBytes` y `enforcedBy` además del memory.peak.
//   - La cola es idempotente por huella del disparador: la misma línea terminal
//     no vuelve a lanzar los jobs; un corte a mitad reanuda desde el primer paso
//     que no quedó SUCCEEDED.
// No edita ni reemplaza el runner de BT-05.

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { closeSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { claimJobLock, readCgroupMemoryPeak, readJobLock, releaseJobLock } from "../backtest-jobs/runner.mjs";
import { canonicalValueSha256 } from "../pit-views/pit-record.mjs";
import { jobNotificationText } from "./telegram.mjs";
import { triggerFingerprint } from "./trigger.mjs";

export const DEFAULT_DATA_RUNS_DIR = "operations/data-runs";
export const QUEUE_RECEIPT_KIND = "DATA-01_QUEUE_RECEIPT";
export const STEP_RECEIPT_KIND = "DATA-01_JOB_RECEIPT";
export const QUEUE_RECEIPT_FILE = "QUEUE_RECEIPT.json";
export const STEP_RECEIPT_FILE = "JOB_RECEIPT.json";
export const QUEUE_ID_PATTERN = /^DATA-QUEUE-[0-9a-f]{64}$/;
const STEP_DIR_PATTERN = /^\d{2}-[A-Z0-9_]+$/;
// Supervisor que corre dentro del scope de systemd y escribe el pico del cgroup
// del job al terminar (hallazgo DATA01-MEMPEAK-SCOPE: el cgroup del servicio no es
// el del job, y con `--collect` el scope se borra al salir).
const CHILD_ENTRY = fileURLToPath(new URL("./child-entry.mjs", import.meta.url));
const PEAK_FILE = "job-memory.json";

export const QUEUE_STATUS = Object.freeze({
  RUNNING: "RUNNING",
  SUCCEEDED: "SUCCEEDED",
  FAILED: "FAILED",
  INTERRUPTED: "INTERRUPTED",
});

export const STEP_STATUS = Object.freeze({
  RUNNING: "RUNNING",
  SUCCEEDED: "SUCCEEDED",
  FAILED: "FAILED",
  INTERRUPTED: "INTERRUPTED",
});

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

function readJson(file) {
  return JSON.parse(readFileSync(file, "utf8"));
}

function writeJsonAtomic(file, value) {
  mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.tmp`;
  writeFileSync(temporary, JSON.stringify(value, null, 1));
  renameSync(temporary, file);
}

// MemoryMax del job: en producción cada job corre en su propio scope de systemd
// con este techo. El scope envuelve a `child-entry.mjs`, que corre el comando y
// escribe el pico del cgroup del scope en `peakFile` antes de salir (con `--collect`
// el scope se borra al terminar y su memory.peak se pierde: hallazgo
// DATA01-MEMPEAK-SCOPE). Fuera de systemd el techo no se impone (enforcedBy "none")
// y el pico se lee del cgroup del servicio, declarado como tal: nunca se finge que
// el pico es del job si no lo es.
export function buildSpawnCommand(step, { useSystemdScope = false, systemdRun = "systemd-run", nodeBinary = process.execPath, childEntry = CHILD_ENTRY, peakFile = null } = {}) {
  if (!Array.isArray(step?.command) || step.command.length === 0) {
    throw new TypeError("el paso no tiene comando");
  }
  const memoryMaxBytes = Number.isInteger(step.memoryMaxBytes) && step.memoryMaxBytes > 0 ? step.memoryMaxBytes : null;
  if (memoryMaxBytes !== null && useSystemdScope) {
    return {
      bin: systemdRun,
      args: ["--user", "--scope", "--quiet", "--collect", `--property=MemoryMax=${memoryMaxBytes}`, "--", nodeBinary, childEntry, peakFile, "--", ...step.command],
      enforcedBy: "systemd-scope",
      memoryMaxBytes,
      peakFile,
    };
  }
  return { bin: step.command[0], args: step.command.slice(1), enforcedBy: "none", memoryMaxBytes, peakFile: null };
}

// El supervisor deja `{cgroup, memoryPeakBytes, oomKills}` del cgroup en el que
// corrió. Sin archivo (o ilegible) no hay pico del job: el receipt lo declara.
function readJobPeakFile(file) {
  if (typeof file !== "string" || file.length === 0) return null;
  try {
    const parsed = readJson(file);
    return {
      cgroup: typeof parsed?.cgroup === "string" ? parsed.cgroup : null,
      memoryPeakBytes: Number.isInteger(parsed?.memoryPeakBytes) ? parsed.memoryPeakBytes : null,
      oomKills: Number.isInteger(parsed?.oomKills) ? parsed.oomKills : null,
    };
  } catch {
    return null;
  }
}

// Foto del artefacto ANTES de lanzar el job. Un artefacto que ya existía y no se
// reescribió no cuenta como publicado (hallazgo DATA01-ARTIFACT-EXISTENCE): se
// compara mtime/tamaño contra la foto. Un artefacto que no existía antes se acepta
// sólo si aparece.
function snapshotArtifacts(entries, resolve) {
  const snapshot = new Map();
  for (const entry of entries) {
    try {
      const info = statSync(resolve(entry));
      snapshot.set(entry, { mtimeMs: info.mtimeMs, size: info.size });
    } catch {
      snapshot.set(entry, null);
    }
  }
  return snapshot;
}

function checkArtifacts(entries, snapshot, resolve) {
  const missing = [];
  const stale = [];
  for (const entry of entries) {
    let info;
    try {
      info = statSync(resolve(entry));
    } catch {
      missing.push(entry);
      continue;
    }
    const before = snapshot.get(entry) ?? null;
    if (before === null) continue;
    if (info.mtimeMs !== before.mtimeMs || info.size !== before.size) continue;
    stale.push(entry);
  }
  return { missing, stale };
}

// Un timeout mata al proceso directo y a TODA su descendencia: el hijo se lanza en
// su propio grupo de procesos y se mata el grupo (hallazgo DATA01-TIMEOUT-ORPHANS).
// Sin detached (spawn inyectado en tests) sólo se puede matar al hijo directo.
function killProcessTree(child, detached) {
  if (detached && Number.isInteger(child?.pid) && child.pid > 0) {
    try {
      process.kill(-child.pid, "SIGKILL");
      return;
    } catch {
      // El grupo ya no existe: se intenta el hijo directo.
    }
  }
  try {
    child?.kill("SIGKILL");
  } catch {
    // El proceso ya terminó.
  }
}

// Huella del paso dentro de una cola: mismo comando + mismo entorno + mismo
// techo + mismo disparador = mismo resultado (se reutiliza; no se recalcula).
export function stepFingerprint(step, fingerprint) {
  return canonicalValueSha256({
    jobKind: step.jobKind,
    command: step.command,
    env: step.env ?? {},
    memoryMaxBytes: step.memoryMaxBytes ?? null,
    trigger: fingerprint,
  }).sha256;
}

// Identidad de la cola: sólo el disparador y los tipos de job (estable entre
// máquinas; no incluye rutas absolutas ni el scratch).
export function queueIdFor(trigger, steps) {
  const fingerprint = triggerFingerprint(trigger);
  if (fingerprint === null) return null;
  return `DATA-QUEUE-${canonicalValueSha256({ fingerprint, jobKinds: (steps ?? []).map((step) => step.jobKind) }).sha256}`;
}

export function createDataQueueRunner({
  repoRoot,
  runsDir = null,
  notifier = null,
  spawnJob = null,
  now = () => new Date(),
  useSystemdScope = false,
  systemdRun = "systemd-run",
} = {}) {
  if (typeof repoRoot !== "string" || repoRoot.length === 0) {
    throw new TypeError("createDataQueueRunner requiere repoRoot.");
  }
  const runsRoot = runsDir ?? path.join(repoRoot, DEFAULT_DATA_RUNS_DIR);
  mkdirSync(runsRoot, { recursive: true });
  let active = null;
  let heldLockGeneration = null;

  const relative = (absolute) => path.relative(repoRoot, absolute).split(path.sep).join("/");
  const resolveArtifact = (entry) => (path.isAbsolute(entry) ? entry : path.join(repoRoot, entry));
  const queueDir = (queueId) => path.join(runsRoot, queueId);
  const stepDir = (queueId, index, jobKind) => path.join(queueDir(queueId), `${String(index + 1).padStart(2, "0")}-${jobKind}`);
  const queueReceiptFile = (queueId) => path.join(queueDir(queueId), QUEUE_RECEIPT_FILE);

  function listQueueIds() {
    try {
      return readdirSync(runsRoot, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && QUEUE_ID_PATTERN.test(entry.name))
        .map((entry) => entry.name);
    } catch {
      return [];
    }
  }

  function readQueueReceipt(queueId) {
    try {
      return readJson(queueReceiptFile(queueId));
    } catch {
      return null;
    }
  }

  function listStepDirs(queueId) {
    try {
      return readdirSync(queueDir(queueId), { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && STEP_DIR_PATTERN.test(entry.name))
        .map((entry) => entry.name)
        .sort();
    } catch {
      return [];
    }
  }

  // Cualquier receipt RUNNING al tomar el lock es de un proceso que ya no existe:
  // se cierra INTERRUPTED, nunca como éxito (misma regla que BT-05).
  function closeOrphans() {
    for (const queueId of listQueueIds()) {
      for (const dir of listStepDirs(queueId)) {
        const file = path.join(queueDir(queueId), dir, STEP_RECEIPT_FILE);
        let receipt;
        try {
          receipt = readJson(file);
        } catch {
          continue;
        }
        if (receipt?.status !== STEP_STATUS.RUNNING) continue;
        writeJsonAtomic(file, {
          ...receipt,
          status: STEP_STATUS.INTERRUPTED,
          finishedAt: now().toISOString(),
          failure: { code: "INTERRUPTED", message: "el proceso que corría el job ya no existe; el paso no se completó" },
        });
      }
    }
  }

  function acquireLock(queueId) {
    const observed = readJobLock(runsRoot);
    if (observed !== null && observed.live) return false;
    const generation = claimJobLock(runsRoot, observed?.generation ?? 0, { queueId, pid: process.pid });
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

  function notify(text) {
    if (notifier === null) return { configured: false, ok: false, code: "NOTIFIER_NOT_CONFIGURED", at: now().toISOString() };
    // Un aviso nunca tumba la cola (ni un throw síncrono del transporte): el
    // fallo queda declarado en el receipt.
    return Promise.resolve()
      .then(() => notifier.notify(text))
      .catch((error) => ({
        configured: notifier.configured === true,
        ok: false,
        code: "TELEGRAM_UNREACHABLE",
        message: String(error?.message ?? error),
        at: now().toISOString(),
      }));
  }

  function runStep({ queueId, index, total, step, fingerprint, trigger }) {
    const dir = stepDir(queueId, index, step.jobKind);
    mkdirSync(dir, { recursive: true });
    const receiptFile = path.join(dir, STEP_RECEIPT_FILE);
    const stepPrint = stepFingerprint(step, fingerprint);
    const existing = (() => {
      try {
        return readJson(receiptFile);
      } catch {
        return null;
      }
    })();
    // Reanudación: un paso ya SUCCEEDED con la misma huella no se recalcula.
    if (existing?.status === STEP_STATUS.SUCCEEDED && existing.stepFingerprint === stepPrint) {
      return Promise.resolve({ ...existing, reused: true });
    }

    const peakFile = path.join(dir, PEAK_FILE);
    const spawnSpec = buildSpawnCommand(step, { useSystemdScope, systemdRun, peakFile });
    const memoryBefore = readCgroupMemoryPeak();
    const artifactSnapshot = snapshotArtifacts(step.publishes ?? [], resolveArtifact);
    let receipt = {
      receiptKind: STEP_RECEIPT_KIND,
      schemaVersion: "1",
      queueId,
      triggerFingerprint: fingerprint,
      stepFingerprint: stepPrint,
      index,
      total,
      jobKind: step.jobKind,
      command: step.command,
      memoryMaxBytes: spawnSpec.memoryMaxBytes,
      enforcedBy: spawnSpec.enforcedBy,
      publishes: step.publishes ?? [],
      status: STEP_STATUS.RUNNING,
      startedAt: now().toISOString(),
      receiptPath: relative(receiptFile),
      requestedBy: "systemd-path-unit",
      authority: "DATA-01 owner decision 2026-09-26: cola automática sin humano al medio.",
      trigger: { kind: trigger.kind, at: trigger.event?.at ?? null, sha256: trigger.event?.sha256 ?? null },
    };
    writeJsonAtomic(receiptFile, receipt);

    let logFd = null;
    let child = null;
    const detached = spawnJob === null;
    try {
      logFd = openSync(path.join(dir, "job.log"), "a");
      const spawnImpl = spawnJob ?? ((spec) => spawn(spec.bin, spec.args, { cwd: spec.cwd, env: spec.env, stdio: ["ignore", spec.logFd, spec.logFd], detached: true }));
      child = spawnImpl({ ...spawnSpec, cwd: repoRoot, env: { ...process.env, ...(step.env ?? {}) }, logFd });
    } catch (error) {
      if (logFd !== null) closeSync(logFd);
      receipt = { ...receipt, status: STEP_STATUS.FAILED, finishedAt: now().toISOString(), failure: { code: "SPAWN_FAILED", message: String(error?.message ?? error) } };
      writeJsonAtomic(receiptFile, receipt);
      return Promise.resolve(receipt);
    }
    // El hijo hereda el fd; el descriptor del padre se cierra ya.
    if (logFd !== null) closeSync(logFd);

    receipt = { ...receipt, pid: child.pid };
    writeJsonAtomic(receiptFile, receipt);

    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      killProcessTree(child, detached);
    }, step.timeoutMs ?? 0);

    return new Promise((resolveOnce) => {
      let settled = false;
      const settle = async (patch) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        const jobPeak = readJobPeakFile(spawnSpec.peakFile);
        const serviceAfter = readCgroupMemoryPeak();
        const jobScopePeakBytes = jobPeak?.memoryPeakBytes ?? null;
        const memory = {
          memoryMaxBytes: spawnSpec.memoryMaxBytes,
          enforcedBy: spawnSpec.enforcedBy,
          cgroup: jobPeak?.cgroup ?? serviceAfter.cgroup,
          memoryPeakBytes: jobScopePeakBytes ?? serviceAfter.memoryPeakBytes,
          peakSource: jobScopePeakBytes !== null ? "job-scope" : (serviceAfter.memoryPeakBytes !== null ? "service-cgroup" : "unavailable"),
          oomKillsDuringRun: jobPeak?.oomKills != null ? jobPeak.oomKills : (memoryBefore.oomKills === null || serviceAfter.oomKills === null ? null : serviceAfter.oomKills - memoryBefore.oomKills),
          note: spawnSpec.enforcedBy === "systemd-scope"
            ? "memory.peak es el pico del cgroup del scope del job; child-entry lo escribe al terminar, antes de que systemd lo recoja."
            : "sin scope de systemd el job corre en el cgroup del servicio: memory.peak es del servicio completo, no sólo de este job.",
        };
        const closed = { ...receipt, ...patch, memory, finishedAt: now().toISOString() };
        const notification = await notify(jobNotificationText({ queueId, step: { ...step, index, total }, receipt: closed }));
        closed.notification = notification;
        writeJsonAtomic(receiptFile, closed);
        resolveOnce(closed);
      };
      child.once("error", (error) => settle({ status: STEP_STATUS.FAILED, failure: { code: "SPAWN_FAILED", message: String(error?.message ?? error) } }));
      child.once("exit", (exitCode, signal) => {
        clearTimeout(timer);
        const exit = { code: exitCode, signal };
        if (timedOut) {
          settle({ status: STEP_STATUS.FAILED, exit, failure: { code: "TIMEOUT", message: `superó ${step.timeoutMs} ms (techo provisional)` } });
          return;
        }
        if (exitCode !== 0) {
          settle({ status: STEP_STATUS.FAILED, exit, failure: { code: "RUN_FAILED", message: `el job terminó con code=${exitCode} signal=${signal}; ver job.log` } });
          return;
        }
        const { missing, stale } = checkArtifacts(step.publishes ?? [], artifactSnapshot, resolveArtifact);
        if (missing.length > 0) {
          settle({ status: STEP_STATUS.FAILED, exit, failure: { code: "STEP_ARTIFACT_MISSING", message: `el job terminó bien pero no dejó su artefacto: ${missing.join(", ")}` } });
          return;
        }
        if (stale.length > 0) {
          settle({ status: STEP_STATUS.FAILED, exit, failure: { code: "STEP_ARTIFACT_STALE", message: `el job terminó bien pero no reescribió un artefacto que ya existía: ${stale.join(", ")}` } });
          return;
        }
        settle({ status: STEP_STATUS.SUCCEEDED, exit });
      });
    });
  }

  async function runQueue({ trigger, steps }) {
    if (trigger?.kind !== "CHECKSUM_OK") {
      return { ok: false, code: "TRIGGER_NOT_READY", kind: trigger?.kind ?? null };
    }
    if (!Array.isArray(steps) || steps.length === 0) {
      return { ok: false, code: "NO_STEPS" };
    }
    const fingerprint = triggerFingerprint(trigger);
    const queueId = queueIdFor(trigger, steps);
    const previous = readQueueReceipt(queueId);
    if (previous?.status === QUEUE_STATUS.SUCCEEDED) {
      return { ok: true, reused: true, queueId, queue: previous };
    }
    if (active !== null || (readJobLock(runsRoot)?.live ?? false)) {
      return { ok: false, code: "QUEUE_ALREADY_RUNNING", queueId };
    }
    if (!acquireLock(queueId)) {
      return { ok: false, code: "QUEUE_ALREADY_RUNNING", queueId };
    }

    let queue = {
      receiptKind: QUEUE_RECEIPT_KIND,
      schemaVersion: "1",
      queueId,
      triggerFingerprint: fingerprint,
      trigger: { kind: trigger.kind, at: trigger.event?.at ?? null, sha256: trigger.event?.sha256 ?? null },
      status: QUEUE_STATUS.RUNNING,
      startedAt: now().toISOString(),
      steps: steps.map((step, index) => ({ index, jobKind: step.jobKind })),
    };
    writeJsonAtomic(queueReceiptFile(queueId), queue);
    active = { queueId };

    try {
      closeOrphans();
      const receipts = [];
      for (let index = 0; index < steps.length; index += 1) {
        const receipt = await runStep({ queueId, index, total: steps.length, step: steps[index], fingerprint, trigger });
        receipts.push(receipt);
        if (receipt.status !== STEP_STATUS.SUCCEEDED) {
          queue = { ...queue, status: QUEUE_STATUS.FAILED, failedStep: { index, jobKind: steps[index].jobKind }, failure: receipt.failure ?? null, finishedAt: now().toISOString() };
          writeJsonAtomic(queueReceiptFile(queueId), queue);
          const notification = await notify(`DATA-01 cola detenida · paso ${index + 1}/${steps.length} ${steps[index].jobKind} falló`);
          queue = { ...queue, notification };
          writeJsonAtomic(queueReceiptFile(queueId), queue);
          return { ok: false, code: "STEP_FAILED", queueId, queue, receipts };
        }
      }
      queue = { ...queue, status: QUEUE_STATUS.SUCCEEDED, finishedAt: now().toISOString() };
      writeJsonAtomic(queueReceiptFile(queueId), queue);
      const notification = await notify(`DATA-01 cola completa · ${steps.length} jobs OK · ${queueId}`);
      queue = { ...queue, notification };
      writeJsonAtomic(queueReceiptFile(queueId), queue);
      return { ok: true, reused: false, queueId, queue, receipts };
    } finally {
      active = null;
      releaseLock();
    }
  }

  function latestQueueReceipt() {
    let latest = null;
    for (const queueId of listQueueIds()) {
      const receipt = readQueueReceipt(queueId);
      if (receipt === null) continue;
      if (latest === null || String(receipt.startedAt) > String(latest.startedAt)) latest = receipt;
    }
    return latest;
  }

  function status() {
    const lock = readJobLock(runsRoot);
    return {
      running: lock?.live === true,
      current: lock?.live === true ? readQueueReceipt(lock.queueId) : null,
      latest: latestQueueReceipt(),
      queues: listQueueIds().length,
    };
  }

  function get(queueId) {
    if (!QUEUE_ID_PATTERN.test(queueId ?? "")) return null;
    const queue = readQueueReceipt(queueId);
    if (queue === null) return null;
    const steps = listStepDirs(queueId).map((dir) => {
      try {
        return readJson(path.join(queueDir(queueId), dir, STEP_RECEIPT_FILE));
      } catch {
        return null;
      }
    }).filter((receipt) => receipt !== null);
    return { queue, steps };
  }

  return { runsRoot, runQueue, status, get, now, waitForIdle: () => Promise.resolve(null) };
}
