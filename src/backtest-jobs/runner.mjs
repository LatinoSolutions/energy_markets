// BT-05 (PLAN_STATUS, owner request 25-sep-2026): ejecución canónica de
// backtests desde la app EM. Es el único camino que lanza un backtest: el
// endpoint HTTP de ./http.mjs y la tool MCP de ./mcp-server.mjs llegan aquí.
//
// Por qué así:
//   - Uno a la vez (lock en disco con 'wx'): el 25-sep un backtest lanzado fuera
//     de este camino agotó la RAM de BruNode (nota BT-05 en PLAN_STATUS).
//   - El backtest corre en un proceso hijo del servicio, así cuenta dentro del
//     cgroup de energy-markets-ui.service (MemoryMax provisional 2G, nota BT-05).
//   - Sólo corre sobre inputs cuyo sha256 coincide con el manifest commiteado
//     (operations/exploratory/MANIFEST.json, owner patch
//     EM-SPEC-OWNER-PATCH-2026-09-24-02 §4); si algo no coincide, no arranca.
//   - Cada run queda versionado en su propio directorio con RUN_RECEIPT.json;
//     el resultado commiteado que muestra la UI no se reescribe.
//   - La escritura originada en la UI es un comando autorizado que produce su
//     receipt (SPEC v1.1.1 §26.5).

import { spawn, execFileSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { closeSync, copyFileSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const JOB_KIND = "EXPLORATORY_BACKTEST";
export const JOB_VERSION = "1";
export const RECEIPT_KIND = "BT-05_BACKTEST_RUN_RECEIPT";
export const RECEIPT_FILE = "RUN_RECEIPT.json";
export const DEFAULT_RUNS_DIR = "operations/backtest-runs";

// Entradas del backtest exploratorio tal como las fija su generador
// (operations/exploratory/run-exploratory-backtest.mjs:1-24).
export const EXPLORATORY_MANIFEST_PATH = "operations/exploratory/MANIFEST.json";
export const EXPLORATORY_ENTRY = "operations/exploratory/run-exploratory-backtest.mjs";
export const EXPLORATORY_CALENDAR = "operations/audit/IMP-09/eex-exchange-calendar.json";

// PROVISIONAL (BT-05, no canónico): techo de tiempo para que un job colgado no
// bloquee el lock para siempre. Recalcular con la duración medida del primer run real.
export const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000;

export const JOB_STATUS = Object.freeze({
  RUNNING: "RUNNING",
  SUCCEEDED: "SUCCEEDED",
  FAILED: "FAILED",
  INTERRUPTED: "INTERRUPTED",
});

const CHILD_ENTRY = fileURLToPath(new URL("./child-entry.mjs", import.meta.url));
const LOCK_FILE = ".job.lock";

const sha256Of = (bytes) => createHash("sha256").update(bytes).digest("hex");

function readJson(file) {
  return JSON.parse(readFileSync(file, "utf8"));
}

function writeJsonAtomic(file, value) {
  const temporary = `${file}.tmp`;
  writeFileSync(temporary, JSON.stringify(value, null, 1));
  renameSync(temporary, file);
}

function isProcessAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}

function newRunId(now) {
  const stamp = now.toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  return `BT-RUN-${stamp}-${randomBytes(3).toString("hex")}`;
}

// cgroup v2: el pico de memoria del servicio completo (memory.peak es monotónico
// desde que arrancó el cgroup). null si no se puede leer; nunca un número inventado.
// oomKills sale de memory.events: si sube durante el run, el cgroup mató un proceso por memoria.
export function readCgroupMemoryPeak() {
  let cgroup = null;
  try {
    const line = readFileSync("/proc/self/cgroup", "utf8").split("\n").find((item) => item.startsWith("0::"));
    cgroup = line === undefined ? null : line.slice(3).trim();
  } catch {
    cgroup = null;
  }
  if (cgroup === null) return { cgroup: null, memoryPeakBytes: null, oomKills: null };
  const readNumber = (file, pattern) => {
    try {
      const match = readFileSync(path.join("/sys/fs/cgroup", cgroup, file), "utf8").match(pattern);
      const value = match === null ? Number.NaN : Number.parseInt(match[1], 10);
      return Number.isInteger(value) ? value : null;
    } catch {
      return null;
    }
  };
  return {
    cgroup,
    memoryPeakBytes: readNumber("memory.peak", /^(\d+)/),
    oomKills: readNumber("memory.events", /^oom_kill (\d+)$/m),
  };
}

function gitHead(repoRoot) {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { cwd: repoRoot, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return null;
  }
}

// Verifica contra el manifest commiteado todo lo que el job va a leer. Devuelve
// la lista de archivos con su sha o el primer fallo; no lanza.
export function verifyExploratoryInputs(repoRoot) {
  let manifestBytes;
  try {
    manifestBytes = readFileSync(path.join(repoRoot, EXPLORATORY_MANIFEST_PATH));
  } catch {
    return { ok: false, code: "MANIFEST_MISSING", path: EXPLORATORY_MANIFEST_PATH };
  }
  let manifest;
  try {
    manifest = JSON.parse(manifestBytes);
  } catch {
    return { ok: false, code: "MANIFEST_UNREADABLE", path: EXPLORATORY_MANIFEST_PATH };
  }
  if (manifest?.artifactKind !== "EXPLORATORY_BACKTEST_MANIFEST" || manifest?.slots?.path == null || !Array.isArray(manifest?.generators)) {
    return { ok: false, code: "MANIFEST_INVALID", path: EXPLORATORY_MANIFEST_PATH };
  }
  if (!manifest.generators.some((entry) => entry?.path === EXPLORATORY_ENTRY)) {
    return { ok: false, code: "ENTRY_NOT_IN_MANIFEST", path: EXPLORATORY_ENTRY };
  }
  const pinned = [manifest.slots, ...manifest.generators];
  const files = [];
  for (const entry of pinned) {
    let bytes;
    try {
      bytes = readFileSync(path.join(repoRoot, entry.path));
    } catch {
      return { ok: false, code: "INPUT_MISSING", path: entry.path };
    }
    const actual = sha256Of(bytes);
    if (actual !== entry.sha256) {
      return { ok: false, code: "INPUT_HASH_MISMATCH", path: entry.path, expected: entry.sha256, actual };
    }
    files.push({ path: entry.path, sha256: actual });
  }
  // El calendario no figura en el manifest exploratorio: se lee y se ata por hash en el receipt.
  let calendarBytes;
  try {
    calendarBytes = readFileSync(path.join(repoRoot, EXPLORATORY_CALENDAR));
  } catch {
    return { ok: false, code: "INPUT_MISSING", path: EXPLORATORY_CALENDAR };
  }
  files.push({ path: EXPLORATORY_CALENDAR, sha256: sha256Of(calendarBytes) });
  return {
    ok: true,
    manifest: { path: EXPLORATORY_MANIFEST_PATH, sha256: sha256Of(manifestBytes) },
    committedResults: { path: manifest.results?.path ?? null, sha256: manifest.results?.sha256 ?? null },
    slotsPath: manifest.slots.path,
    files,
  };
}

// Workspace aislado: los datos y el entrypoint se copian (ya verificados); src/
// se enlaza porque el generador importa por ruta relativa. El generador escribe
// su MANIFEST relativo al cwd, así que nunca toca el manifest commiteado.
function stageWorkspace(repoRoot, workspace, files) {
  mkdirSync(workspace, { recursive: true });
  symlinkSync(path.join(repoRoot, "src"), path.join(workspace, "src"), "dir");
  for (const file of files) {
    if (file.path.startsWith("src/")) continue;
    const target = path.join(workspace, file.path);
    mkdirSync(path.dirname(target), { recursive: true });
    copyFileSync(path.join(repoRoot, file.path), target);
    if (sha256Of(readFileSync(target)) !== file.sha256) {
      throw new Error(`copia alterada: ${file.path}`);
    }
  }
}

function relative(repoRoot, absolute) {
  return path.relative(repoRoot, absolute).split(path.sep).join("/");
}

// Resumen público de un receipt: lo que el endpoint, la UI y MCP muestran tal cual.
export function publicJobView(receipt) {
  if (receipt == null) return null;
  return {
    runId: receipt.runId,
    jobKind: receipt.jobKind,
    status: receipt.status,
    requestedBy: receipt.requestedBy,
    startedAt: receipt.startedAt,
    finishedAt: receipt.finishedAt ?? null,
    failure: receipt.failure ?? null,
    result: receipt.result ?? null,
    memory: receipt.memory ?? null,
    receiptPath: receipt.receiptPath,
  };
}

export function createBacktestJobRunner({ repoRoot, runsDir = null, timeoutMs = DEFAULT_TIMEOUT_MS, nodeBinary = process.execPath, now = () => new Date() } = {}) {
  if (typeof repoRoot !== "string" || repoRoot.length === 0) {
    throw new TypeError("createBacktestJobRunner requiere repoRoot.");
  }
  const runsRoot = runsDir ?? path.join(repoRoot, DEFAULT_RUNS_DIR);
  mkdirSync(runsRoot, { recursive: true });
  const lockPath = path.join(runsRoot, LOCK_FILE);
  let active = null; // { receipt, child, done }

  const receiptFile = (runId) => path.join(runsRoot, runId, RECEIPT_FILE);

  function readReceipt(runId) {
    if (!/^BT-RUN-[0-9TZ]+-[0-9a-f]{6}$/.test(runId ?? "")) return null;
    try {
      return readJson(receiptFile(runId));
    } catch {
      return null;
    }
  }

  function listRunIds() {
    return readdirSync(runsRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name.startsWith("BT-RUN-"))
      .map((entry) => entry.name)
      .sort();
  }

  // Un receipt RUNNING sin proceso vivo que lo sostenga quedó huérfano (reinicio
  // del servicio, OOM): se cierra como INTERRUPTED, nunca como éxito.
  function recoverOrphans() {
    let lock = null;
    try {
      lock = readJson(lockPath);
    } catch {
      lock = null;
    }
    const lockHeld = lock !== null && isProcessAlive(lock.pid);
    if (lock !== null && !lockHeld) {
      rmSync(lockPath, { force: true });
    }
    for (const runId of listRunIds()) {
      const receipt = readReceipt(runId);
      if (receipt?.status !== JOB_STATUS.RUNNING) continue;
      if (lockHeld && lock.runId === runId) continue;
      writeJsonAtomic(receiptFile(runId), {
        ...receipt,
        status: JOB_STATUS.INTERRUPTED,
        finishedAt: now().toISOString(),
        failure: { code: "INTERRUPTED", message: "el proceso que corría el job ya no existe; el run no se completó" },
      });
    }
  }

  function acquireLock(runId) {
    try {
      const fd = openSync(lockPath, "wx");
      writeFileSync(fd, JSON.stringify({ runId, pid: process.pid }));
      closeSync(fd);
      return true;
    } catch (error) {
      if (error.code === "EEXIST") return false;
      throw error;
    }
  }

  function latestReceipt() {
    const ids = listRunIds();
    for (let index = ids.length - 1; index >= 0; index -= 1) {
      const receipt = readReceipt(ids[index]);
      if (receipt !== null) return receipt;
    }
    return null;
  }

  function status() {
    const latest = active?.receipt ?? latestReceipt();
    return { running: active !== null, current: publicJobView(active?.receipt ?? null), latest: publicJobView(latest) };
  }

  function finish(receipt, patch) {
    const closed = { ...receipt, ...patch, finishedAt: now().toISOString() };
    writeJsonAtomic(receiptFile(receipt.runId), closed);
    active = null;
    rmSync(lockPath, { force: true });
    return closed;
  }

  function collectResult(workspace, verified) {
    const producedManifestPath = path.join(workspace, EXPLORATORY_MANIFEST_PATH);
    let producedManifest;
    let producedManifestBytes;
    try {
      producedManifestBytes = readFileSync(producedManifestPath);
      producedManifest = JSON.parse(producedManifestBytes);
    } catch {
      return { error: { code: "RUN_MANIFEST_MISSING", message: "el generador no escribió su MANIFEST" } };
    }
    const resultsPath = path.join(workspace, producedManifest?.results?.path ?? "");
    let resultsBytes;
    try {
      resultsBytes = readFileSync(resultsPath);
    } catch {
      return { error: { code: "RUN_RESULTS_MISSING", message: "el MANIFEST del run apunta a resultados inexistentes" } };
    }
    const resultsSha256 = sha256Of(resultsBytes);
    if (resultsSha256 !== producedManifest.results.sha256) {
      return { error: { code: "RUN_RESULTS_HASH_MISMATCH", message: "los resultados no coinciden con el MANIFEST del run" } };
    }
    let resultsStatus = null;
    try {
      resultsStatus = JSON.parse(resultsBytes).status ?? null;
    } catch {
      return { error: { code: "RUN_RESULTS_UNREADABLE", message: "los resultados no son JSON" } };
    }
    // El generador vuelve a hashear su código al final: si cambió durante el run, no vale.
    const pinnedGenerators = new Map(verified.files.map((file) => [file.path, file.sha256]));
    const generatorDrift = (producedManifest.generators ?? []).filter((entry) => pinnedGenerators.get(entry.path) !== entry.sha256).map((entry) => entry.path);
    if (generatorDrift.length > 0) {
      return { error: { code: "GENERATOR_CHANGED_DURING_RUN", message: `código distinto al verificado: ${generatorDrift.join(", ")}` } };
    }
    return {
      result: {
        status: resultsStatus,
        results: { path: relative(repoRoot, resultsPath), sha256: resultsSha256 },
        manifest: { path: relative(repoRoot, producedManifestPath), sha256: sha256Of(producedManifestBytes) },
        committedResults: verified.committedResults,
        reproducesCommittedResults: verified.committedResults.sha256 === resultsSha256,
      },
    };
  }

  function start({ requestedBy } = {}) {
    if (requestedBy !== "ui" && requestedBy !== "mcp") {
      return { ok: false, code: "INVALID_REQUESTER", message: 'requestedBy debe ser "ui" o "mcp"' };
    }
    if (active !== null) {
      return { ok: false, code: "JOB_ALREADY_RUNNING", job: publicJobView(active.receipt) };
    }
    const verified = verifyExploratoryInputs(repoRoot);
    if (!verified.ok) {
      return { ok: false, code: verified.code, message: `inputs no verificados: ${verified.path}`, detail: verified };
    }
    const startedAt = now();
    const runId = newRunId(startedAt);
    if (!acquireLock(runId)) {
      return { ok: false, code: "JOB_ALREADY_RUNNING", message: "otro proceso tiene el lock de backtests" };
    }

    const runDir = path.join(runsRoot, runId);
    const workspace = path.join(runDir, "workspace");
    let receipt = {
      receiptKind: RECEIPT_KIND,
      schemaVersion: "1",
      runId,
      jobKind: JOB_KIND,
      jobVersion: JOB_VERSION,
      status: JOB_STATUS.RUNNING,
      requestedBy,
      startedAt: startedAt.toISOString(),
      receiptPath: relative(repoRoot, receiptFile(runId)),
      code: { gitHead: gitHead(repoRoot), entry: EXPLORATORY_ENTRY },
      inputs: { manifest: verified.manifest, files: verified.files },
      authority: "BT-05 owner request 25-sep-2026; comando autorizado con receipt (SPEC v1.1.1 §26.5). Resultado EXPLORATORY, no canónico.",
    };
    try {
      mkdirSync(runDir, { recursive: false });
      writeJsonAtomic(receiptFile(runId), receipt);
      stageWorkspace(repoRoot, workspace, verified.files);
    } catch (error) {
      const closed = finish(receipt, { status: JOB_STATUS.FAILED, failure: { code: "STAGING_FAILED", message: String(error?.message ?? error) } });
      return { ok: false, code: "STAGING_FAILED", job: publicJobView(closed) };
    }

    const memoryBefore = readCgroupMemoryPeak();
    const rusageFile = path.join(runDir, "child-rusage.json");
    const logFd = openSync(path.join(runDir, "job.log"), "a");
    const child = spawn(nodeBinary, [CHILD_ENTRY, rusageFile, path.join(workspace, EXPLORATORY_ENTRY), verified.slotsPath, "operations/exploratory/backtest-results.json"], {
      cwd: workspace,
      stdio: ["ignore", logFd, logFd],
    });
    closeSync(logFd);
    receipt = { ...receipt, pid: child.pid };
    writeJsonAtomic(receiptFile(runId), receipt);

    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);

    const done = new Promise((resolveOnce) => {
      // 'error' y 'exit' pueden llegar ambos; el receipt se cierra una sola vez.
      let settled = false;
      const resolve = (value) => {
        settled = true;
        resolveOnce(value);
      };
      child.once("error", (error) => {
        clearTimeout(timer);
        if (settled) return;
        resolve(finish(receipt, { status: JOB_STATUS.FAILED, failure: { code: "SPAWN_FAILED", message: String(error?.message ?? error) } }));
      });
      child.once("exit", (code, signal) => {
        clearTimeout(timer);
        if (settled) return;
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
          note: "memory.peak es el pico del cgroup completo desde que arrancó el servicio, no sólo de este job",
        };
        if (timedOut) {
          resolve(finish(receipt, { status: JOB_STATUS.FAILED, exit: { code, signal }, memory, failure: { code: "TIMEOUT", message: `superó ${timeoutMs} ms (techo provisional)` } }));
          return;
        }
        if (code !== 0 && memory.cgroupOomKillsDuringRun > 0) {
          resolve(finish(receipt, { status: JOB_STATUS.FAILED, exit: { code, signal }, memory, failure: { code: "OOM_KILLED", message: `el cgroup ${memory.cgroup} mató el job por memoria (MemoryMax del servicio)` } }));
          return;
        }
        if (code !== 0) {
          resolve(finish(receipt, { status: JOB_STATUS.FAILED, exit: { code, signal }, memory, failure: { code: "RUN_FAILED", message: `el generador terminó con code=${code} signal=${signal}; ver job.log` } }));
          return;
        }
        const collected = collectResult(workspace, verified);
        if (collected.error) {
          resolve(finish(receipt, { status: JOB_STATUS.FAILED, exit: { code, signal }, memory, failure: collected.error }));
          return;
        }
        resolve(finish(receipt, { status: JOB_STATUS.SUCCEEDED, exit: { code, signal }, memory, result: collected.result }));
      });
    });
    active = { receipt, child, done };
    return { ok: true, job: publicJobView(receipt), done };
  }

  recoverOrphans();

  return {
    runsRoot,
    start,
    status,
    get: (runId) => readReceipt(runId),
    // Para tests y apagado ordenado: espera al job en curso si lo hay.
    waitForIdle: () => (active?.done ?? Promise.resolve(null)),
  };
}
