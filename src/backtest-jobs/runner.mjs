// BT-05 (PLAN_STATUS, owner request 25-sep-2026): ejecución canónica de
// backtests desde la app EM. Es el único camino que lanza un backtest: el
// endpoint HTTP de ./http.mjs y la tool MCP de ./mcp-server.mjs llegan aquí.
//
// Por qué así:
//   - Uno a la vez (lock en disco por generaciones con link()): el 25-sep un backtest lanzado fuera
//     de este camino agotó la RAM de BruNode (nota BT-05 en PLAN_STATUS).
//   - El backtest corre en un proceso hijo del servicio, así cuenta dentro del
//     cgroup de energy-markets-ui.service (MemoryMax provisional 2G, nota BT-05).
//   - Sólo corre sobre inputs cuyo sha256 coincide con el manifest commiteado
//     (operations/exploratory/MANIFEST.json, owner patch
//     EM-SPEC-OWNER-PATCH-2026-09-24-02 §4); si algo no coincide, no arranca.
//   - Identidad y retención (PLAN_STATUS fila BT-05, "IDENTIDAD Y RETENCION",
//     owner request 25-sep-2026, commit a9f5b82): run_id = sha256 de {commit,
//     hash del manifest de datos, parámetros en JSON canónico, versión del motor};
//     mismo run_id no se recalcula; registro append-only REGISTRY.jsonl con el
//     manifest de cada run; un solo resultado vigente; nada se borra sin GO de Bru.
//   - La escritura originada en la UI es un comando autorizado que produce su
//     receipt (SPEC v1.1.1 §26.5).

import { spawn, execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { appendFileSync, closeSync, copyFileSync, linkSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { canonicalValueSha256 } from "../pit-views/pit-record.mjs";

export const JOB_KIND = "EXPLORATORY_BACKTEST";
// Versión del motor en la identidad del run (BT-05 punto 1). Subirla cuando cambie
// el contrato de ejecución de este runner, aunque el commit ya lo distinga.
export const JOB_VERSION = "2"; // 2: código extraído del commit (hallazgo BT05-IDENTITY-08)
export const RECEIPT_KIND = "BT-05_BACKTEST_RUN_RECEIPT";
export const RECEIPT_FILE = "RUN_RECEIPT.json";
export const REGISTRY_FILE = "REGISTRY.jsonl";
export const DEFAULT_RUNS_DIR = "operations/backtest-runs";

// Entradas del backtest exploratorio tal como las fija su generador
// (operations/exploratory/run-exploratory-backtest.mjs:1-24).
export const EXPLORATORY_MANIFEST_PATH = "operations/exploratory/MANIFEST.json";
export const EXPLORATORY_ENTRY = "operations/exploratory/run-exploratory-backtest.mjs";
export const EXPLORATORY_CALENDAR = "operations/audit/IMP-09/eex-exchange-calendar.json";
const EXPLORATORY_OUTPUT = "operations/exploratory/backtest-results.json";

// PROVISIONAL (BT-05, no canónico): techo de tiempo para que un job colgado no
// bloquee el lock para siempre. Recalcular con la duración medida del primer run real.
export const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000;

export const JOB_STATUS = Object.freeze({
  RUNNING: "RUNNING",
  SUCCEEDED: "SUCCEEDED",
  FAILED: "FAILED",
  INTERRUPTED: "INTERRUPTED",
});

// Vigencia del resultado (BT-05 puntos 3-4). NONE = el run no produjo resultado.
export const RESULT_STATE = Object.freeze({
  CURRENT: "CURRENT",
  SUPERSEDED: "SUPERSEDED",
  NONE: "NONE",
});

export const REGISTRY_EVENT = Object.freeze({
  RUN_CLOSED: "RUN_CLOSED",
  RESULT_PROMOTED: "RESULT_PROMOTED",
  // Un intento SUCCEEDED cuyo RESULT_PROMOTED no llegó al registro (hallazgo
  // BT05-REGISTRY-06): no se reutiliza y el run se recalcula como intento nuevo.
  PROMOTION_MISSING: "PROMOTION_MISSING",
});

const CHILD_ENTRY = fileURLToPath(new URL("./child-entry.mjs", import.meta.url));
const LOCK_PREFIX = ".job.lock.";
const LOCK_FILE_PATTERN = /^\.job\.lock\.(\d+)$/;
const RUN_ID_PATTERN = /^BT-RUN-[0-9a-f]{64}$/;
const ATTEMPT_DIR_PATTERN = /^attempt-(\d+)$/;

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

// Lock de backtests entre procesos (ver acquireLock en el runner).

function lockGenerations(runsRoot) {
  return readdirSync(runsRoot)
    .map((name) => LOCK_FILE_PATTERN.exec(name))
    .filter((match) => match !== null)
    .map((match) => Number.parseInt(match[1], 10))
    .sort((a, b) => a - b);
}

// Lock de generación más alta, o null si nunca hubo uno. `live` = no liberado y
// su proceso existe. Si el archivo desaparece entre listar y leer (lo limpió quien
// tomó una generación nueva) se vuelve a listar.
export function readJobLock(runsRoot) {
  for (let tries = 0; tries < 3; tries += 1) {
    const generation = lockGenerations(runsRoot).at(-1);
    if (generation === undefined) return null;
    let holder;
    try {
      holder = readJson(path.join(runsRoot, `${LOCK_PREFIX}${generation}`));
    } catch (error) {
      if (error.code === "ENOENT") continue;
      throw error;
    }
    const live = holder.releasedAt == null && isProcessAlive(holder.pid);
    return { ...holder, generation, live };
  }
  return null;
}

// Toma la generación siguiente a la observada. Devuelve la generación tomada o
// null si otro proceso la tomó antes. El contenido se escribe completo antes del
// link(), así nadie lee un lock a medio escribir.
export function claimJobLock(runsRoot, observedGeneration, holder) {
  const generation = observedGeneration + 1;
  const target = path.join(runsRoot, `${LOCK_PREFIX}${generation}`);
  const temporary = path.join(runsRoot, `.job.lock-claim-${process.pid}-${randomUUID()}`);
  writeFileSync(temporary, JSON.stringify({ ...holder, generation }));
  try {
    linkSync(temporary, target);
  } catch (error) {
    if (error.code === "EEXIST") return null;
    throw error;
  } finally {
    rmSync(temporary, { force: true });
  }
  // Las generaciones anteriores ya estaban liberadas u obsoletas cuando se tomó ésta.
  for (const older of lockGenerations(runsRoot)) {
    if (older < generation) rmSync(path.join(runsRoot, `${LOCK_PREFIX}${older}`), { force: true });
  }
  return generation;
}

// Sólo quien tomó la generación la libera; se reescribe atómicamente, no se borra.
export function releaseJobLock(runsRoot, generation, releasedAt) {
  const file = path.join(runsRoot, `${LOCK_PREFIX}${generation}`);
  writeJsonAtomic(file, { ...readJson(file), releasedAt });
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

function git(repoRoot, args) {
  try {
    return execFileSync("git", args, { cwd: repoRoot, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    return null;
  }
}

// El commit sólo identifica el código si lo que se ejecuta (src/ y el
// generador) no tiene cambios sin commitear (BT-05 punto 5: mismo commit + mismos
// datos + mismos parámetros = mismo resultado). Si no se puede afirmar, no arranca.
export function readCodeCommit(repoRoot) {
  const head = git(repoRoot, ["rev-parse", "--verify", "HEAD"])?.trim() ?? "";
  if (!/^[0-9a-f]{40}$/.test(head)) {
    return { ok: false, code: "CODE_COMMIT_UNKNOWN", message: "no se pudo leer el commit git del código" };
  }
  const dirty = git(repoRoot, ["status", "--porcelain", "--untracked-files=all", "--", "src", EXPLORATORY_ENTRY]);
  if (dirty === null) {
    return { ok: false, code: "CODE_COMMIT_UNKNOWN", message: "no se pudo leer git status del código" };
  }
  if (dirty.trim().length > 0) {
    const paths = dirty.trim().split("\n").slice(0, 5).map((line) => line.slice(3));
    return { ok: false, code: "CODE_NOT_COMMITTED", message: `código con cambios sin commitear: ${paths.join(", ")}` };
  }
  return { ok: true, commit: head };
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

// Identidad del run (BT-05 punto 1). El "manifest de datos de entrada" es el
// manifest commiteado más el calendario, que ese manifest no fija; ambos van por hash.
export function computeRunIdentity({ codeCommit, verified }) {
  const dataManifest = { manifest: verified.manifest, files: verified.files };
  const identity = {
    codeCommit,
    dataManifestSha256: canonicalValueSha256(dataManifest).sha256,
    parameters: { jobKind: JOB_KIND, entry: EXPLORATORY_ENTRY, slotsPath: verified.slotsPath, outputPath: EXPLORATORY_OUTPUT },
    engineVersion: JOB_VERSION,
  };
  return { runId: `BT-RUN-${canonicalValueSha256(identity).sha256}`, identity };
}

// Código del run = árbol del commit de la identidad, no el src/ vivo del repo
// (hallazgo BT05-IDENTITY-08, review 25-sep-2026): un cambio en el repo entre el
// preflight y la importación del hijo no puede colarse en un resultado atribuido a
// ese commit (BT-05 punto 5; procedencia SPEC v1.1.1 §26.5).
const PINNED_CODE_PATHS = ["src", EXPLORATORY_ENTRY];

function isPinnedCode(relativePath) {
  return relativePath === EXPLORATORY_ENTRY || relativePath.startsWith("src/");
}

function extractCommittedCode(repoRoot, commit, workspace) {
  const archive = `${workspace}.code.tar`;
  try {
    execFileSync("git", ["archive", "--format=tar", "-o", archive, commit, "--", ...PINNED_CODE_PATHS], { cwd: repoRoot, stdio: ["ignore", "ignore", "pipe"] });
    execFileSync("tar", ["-xf", archive, "-C", workspace], { stdio: ["ignore", "ignore", "pipe"] });
  } finally {
    rmSync(archive, { force: true });
  }
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

// Sello del código que ejecuta el hijo: se toma al preparar el workspace y se
// vuelve a calcular al cerrar; si difiere, el resultado no se promueve.
export function stagedCodeSeal(workspace) {
  const files = [...listFilesUnder(workspace, "src"), EXPLORATORY_ENTRY]
    .sort()
    .map((relativePath) => ({ path: relativePath, sha256: sha256Of(readFileSync(path.join(workspace, relativePath))) }));
  return { files: files.length, sha256: canonicalValueSha256(files).sha256 };
}

// sha256 de un archivo del workspace, o null si no se puede leer.
function stagedSha256(workspace, relativePath) {
  try {
    return sha256Of(readFileSync(path.join(workspace, relativePath)));
  } catch {
    return null;
  }
}

// Workspace aislado: el código sale del commit y los datos se copian; todo lo que
// fija el manifest se comprueba por hash en la copia. El generador escribe su
// MANIFEST relativo al cwd, así que nunca toca el manifest commiteado.
function stageWorkspace(repoRoot, workspace, commit, files) {
  mkdirSync(workspace, { recursive: true });
  extractCommittedCode(repoRoot, commit, workspace);
  for (const file of files) {
    const target = path.join(workspace, file.path);
    if (!isPinnedCode(file.path)) {
      mkdirSync(path.dirname(target), { recursive: true });
      copyFileSync(path.join(repoRoot, file.path), target);
    }
    if (stagedSha256(workspace, file.path) !== file.sha256) {
      throw new Error(`copia distinta a la verificada: ${file.path}`);
    }
  }
  return stagedCodeSeal(workspace);
}

function relative(repoRoot, absolute) {
  return path.relative(repoRoot, absolute).split(path.sep).join("/");
}

// Manifest del run (BT-05 punto 3) tal como queda en el registro append-only.
// Se conserva aunque un día se borren los artefactos pesados del run (punto 5).
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
    memoryPeak: {
      childMaxRssKb: receipt.memory?.childMaxRssKb ?? null,
      cgroupMemoryPeakBytesAfter: receipt.memory?.cgroupMemoryPeakBytesAfter ?? null,
    },
    resultSha256: receipt.result?.results?.sha256 ?? null,
    receiptPath: receipt.receiptPath,
  };
}

// Resumen público de un receipt: lo que el endpoint, la UI y MCP muestran tal cual.
// `retention` sale del registro append-only; el receipt no se reescribe al superarse.
export function publicJobView(receipt, retention = null) {
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
    result: receipt.result ?? null,
    memory: receipt.memory ?? null,
    identity: receipt.identity ?? null,
    retention,
    receiptPath: receipt.receiptPath,
  };
}

// `appendRegistryLine` existe para inyectar fallos de escritura en tests (BT05-REGISTRY-06).
export function createBacktestJobRunner({ repoRoot, runsDir = null, timeoutMs = DEFAULT_TIMEOUT_MS, nodeBinary = process.execPath, now = () => new Date(), appendRegistryLine = appendFileSync } = {}) {
  if (typeof repoRoot !== "string" || repoRoot.length === 0) {
    throw new TypeError("createBacktestJobRunner requiere repoRoot.");
  }
  const runsRoot = runsDir ?? path.join(repoRoot, DEFAULT_RUNS_DIR);
  mkdirSync(runsRoot, { recursive: true });
  const registryPath = path.join(runsRoot, REGISTRY_FILE);
  let active = null; // { receipt, child, done } del job que corre en ESTE proceso
  let heldLockGeneration = null; // generación del lock que tiene ESTE runner

  const attemptDir = (runId, attempt) => path.join(runsRoot, runId, `attempt-${attempt}`);
  const receiptFile = (runId, attempt) => path.join(attemptDir(runId, attempt), RECEIPT_FILE);

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

  // Receipt del último intento de un run; null si el id no es de BT-05 o no existe.
  function readLatestReceipt(runId) {
    if (!RUN_ID_PATTERN.test(runId ?? "")) return null;
    const attempts = listAttempts(runId);
    if (attempts.length === 0) return null;
    return readAttemptReceipt(runId, attempts.at(-1));
  }

  function listRunIds() {
    return readdirSync(runsRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && RUN_ID_PATTERN.test(entry.name))
      .map((entry) => entry.name);
  }

  // ---------- registro append-only (BT-05 puntos 3-5) ----------

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
        return { ok: false, code: "REGISTRY_CORRUPT", message: `${REGISTRY_FILE} línea ${index + 1} no es JSON` };
      }
    }
    return { ok: true, events };
  }

  function appendRegistry(event) {
    appendRegistryLine(registryPath, `${JSON.stringify({ at: now().toISOString(), ...event })}\n`);
  }

  // Vigencia por run según el registro: el último RESULT_PROMOTED define el vigente
  // y cada promoción marca al que reemplaza como superado por el nuevo.
  function foldRetention(events) {
    const states = new Map();
    const promotedAttempts = new Set();
    let currentRunId = null;
    for (const event of events) {
      if (event.event !== REGISTRY_EVENT.RESULT_PROMOTED) continue;
      promotedAttempts.add(attemptKey(event.runId, event.attempt));
      if (currentRunId !== null && currentRunId !== event.runId) {
        states.set(currentRunId, { state: RESULT_STATE.SUPERSEDED, supersededBy: event.runId });
      }
      states.set(event.runId, { state: RESULT_STATE.CURRENT, supersededBy: null });
      currentRunId = event.runId;
    }
    return { currentRunId, states, promotedAttempts };
  }

  const attemptKey = (runId, attempt) => `${runId}#${attempt}`;

  function retentionOf(runId, folded) {
    return folded.states.get(runId) ?? { state: RESULT_STATE.NONE, supersededBy: null };
  }

  function viewOf(receipt, folded) {
    return receipt === null ? null : publicJobView(receipt, folded === null ? null : retentionOf(receipt.runId, folded));
  }

  // ---------- lock: uno a la vez entre procesos ----------
  // Cada toma del lock crea `.job.lock.<n+1>` con link() (atómico, falla si existe),
  // donde n es la generación más alta vista. Dos procesos que vieron el mismo lock
  // obsoleto compiten por el mismo archivo y sólo uno lo crea; nunca se borra el
  // lock de otro (hallazgo BT05-LOCK-05). Al liberar, el archivo se marca liberado
  // y se conserva, así la generación nunca retrocede.

  function readLock() {
    return readJobLock(runsRoot);
  }

  function liveLock() {
    const lock = readLock();
    return lock !== null && lock.live ? lock : null;
  }

  function acquireLock(runId, attempt) {
    const observed = readLock();
    if (observed !== null && observed.live) return false;
    const generation = claimJobLock(runsRoot, observed?.generation ?? 0, { runId, attempt, pid: process.pid });
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

  // Con el lock en la mano ningún otro job corre: un RUNNING ajeno quedó huérfano
  // y se cierra como INTERRUPTED, nunca como éxito. Sólo se llama con el lock tomado.
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
          failure: { code: "INTERRUPTED", message: "el proceso que corría el job ya no existe; el run no se completó" },
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

  // Estado leído del disco (lock + receipts + registro), igual desde cualquier proceso.
  function status() {
    const lock = liveLock();
    const registry = readRegistry();
    const folded = registry.ok ? foldRetention(registry.events) : null;
    const running = lock === null ? null : readAttemptReceipt(lock.runId, lock.attempt);
    const currentResult = folded?.currentRunId == null ? null : readLatestReceipt(folded.currentRunId);
    return {
      running: lock !== null,
      current: viewOf(running, folded),
      latest: viewOf(latestStartedReceipt(), folded),
      currentResult: viewOf(currentResult, folded),
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

  // Cierra el intento, lo asienta en el registro y, si tuvo éxito, lo promueve a
  // vigente en una sola línea (una promoción parcial nunca deja dos vigentes).
  // Si falla una escritura no lanza (se llama desde el 'exit' del hijo y tumbaría
  // el servicio): lo devuelve en `settlement`. Un SUCCEEDED sin promoción asentada
  // no se reutiliza en start(), así que el fallo queda fail-closed.
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

  function collectResult(workspace, verified, seal) {
    let sealAfter;
    try {
      sealAfter = stagedCodeSeal(workspace);
    } catch {
      sealAfter = null;
    }
    if (sealAfter?.sha256 !== seal.sha256) {
      return { error: { code: "CODE_CHANGED_DURING_RUN", message: "el código del workspace no coincide con el extraído del commit" } };
    }
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
    // Hallazgo BT05-DATA-BINDING-10 (review 25-sep-2026): los slots que declara haber
    // leído el generador tienen que ser los del dataManifestSha256 del run_id (BT-05 punto 1).
    const pinnedSlots = verified.files.find((file) => file.path === verified.slotsPath);
    const producedSlots = producedManifest.slots ?? {};
    if (producedSlots.path !== verified.slotsPath || producedSlots.sha256 !== pinnedSlots?.sha256) {
      return { error: { code: "SLOTS_CHANGED_DURING_RUN", message: `slots leídos (${producedSlots.sha256 ?? "sin hash"}) distintos a los de la identidad del run (${pinnedSlots?.sha256})` } };
    }
    // El calendario no figura en el MANIFEST que escribe el generador: se re-hashean
    // en el workspace todos los datos copiados, como el sello del código.
    const dataDrift = verified.files.filter((file) => !isPinnedCode(file.path) && stagedSha256(workspace, file.path) !== file.sha256).map((file) => file.path);
    if (dataDrift.length > 0) {
      return { error: { code: "INPUT_CHANGED_DURING_RUN", message: `datos distintos a los verificados: ${dataDrift.join(", ")}` } };
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

  function alreadyRunning() {
    const lock = liveLock();
    const receipt = lock === null ? null : readAttemptReceipt(lock.runId, lock.attempt);
    const registry = readRegistry();
    const folded = registry.ok ? foldRetention(registry.events) : null;
    return { ok: false, code: "JOB_ALREADY_RUNNING", message: "hay un backtest en curso (lock de backtests tomado)", job: viewOf(receipt, folded) };
  }

  // BT-05 punto 2: mismo run_id con resultado = se devuelve, no se recalcula.
  // Resultado = intento SUCCEEDED con su RESULT_PROMOTED en el registro. Un intento
  // FAILED/INTERRUPTED, o SUCCEEDED sin promoción asentada, se reintenta como attempt nuevo.
  function planRun(runId, registry) {
    if (!registry.ok) return { error: { ok: false, code: registry.code, message: registry.message } };
    const folded = foldRetention(registry.events);
    const previous = readLatestReceipt(runId);
    if (previous?.status === JOB_STATUS.SUCCEEDED && folded.promotedAttempts.has(attemptKey(previous.runId, previous.attempt))) {
      return { reused: { ok: true, reused: true, job: viewOf(previous, folded), done: Promise.resolve(previous) } };
    }
    return { attempt: (listAttempts(runId).at(-1) ?? 0) + 1, previous };
  }

  function start({ requestedBy } = {}) {
    if (requestedBy !== "ui" && requestedBy !== "mcp") {
      return { ok: false, code: "INVALID_REQUESTER", message: 'requestedBy debe ser "ui" o "mcp"' };
    }
    if (active !== null || liveLock() !== null) {
      return alreadyRunning();
    }
    const registry = readRegistry();
    if (!registry.ok) {
      return { ok: false, code: registry.code, message: registry.message };
    }
    const code = readCodeCommit(repoRoot);
    if (!code.ok) {
      return { ok: false, code: code.code, message: code.message };
    }
    const verified = verifyExploratoryInputs(repoRoot);
    if (!verified.ok) {
      return { ok: false, code: verified.code, message: `inputs no verificados: ${verified.path}`, detail: verified };
    }
    const { runId, identity } = computeRunIdentity({ codeCommit: code.commit, verified });

    const beforeLock = planRun(runId, registry);
    if (beforeLock.reused) return beforeLock.reused;
    if (!acquireLock(runId, beforeLock.attempt)) {
      return alreadyRunning();
    }
    // Entre la primera lectura y el lock otro proceso pudo cerrar o promover un
    // intento de este run: la decisión que vale es la tomada con el lock en la mano.
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

    const startedAt = now();
    const runDir = attemptDir(runId, attempt);
    const workspace = path.join(runDir, "workspace");
    let receipt = {
      receiptKind: RECEIPT_KIND,
      schemaVersion: "3",
      runId,
      attempt,
      jobKind: JOB_KIND,
      jobVersion: JOB_VERSION,
      identity,
      status: JOB_STATUS.RUNNING,
      requestedBy,
      startedAt: startedAt.toISOString(),
      receiptPath: relative(repoRoot, receiptFile(runId, attempt)),
      code: { gitHead: code.commit, entry: EXPLORATORY_ENTRY },
      inputs: { manifest: verified.manifest, files: verified.files },
      authority: "BT-05 owner request 25-sep-2026; comando autorizado con receipt (SPEC v1.1.1 §26.5). Resultado EXPLORATORY, no canónico.",
    };
    try {
      mkdirSync(runDir, { recursive: true });
      writeJsonAtomic(receiptFile(runId, attempt), receipt);
      const seal = stageWorkspace(repoRoot, workspace, code.commit, verified.files);
      receipt = { ...receipt, code: { ...receipt.code, source: "git archive del commit", staged: seal } };
      writeJsonAtomic(receiptFile(runId, attempt), receipt);
    } catch (error) {
      const closed = finish(receipt, { status: JOB_STATUS.FAILED, failure: { code: "STAGING_FAILED", message: String(error?.message ?? error) } });
      return { ok: false, code: "STAGING_FAILED", job: publicJobView(closed) };
    }

    const memoryBefore = readCgroupMemoryPeak();
    const rusageFile = path.join(runDir, "child-rusage.json");
    // Hallazgo BT05-START-07 (review 25-sep-2026): un fallo síncrono aquí ocurre con el lock
    // tomado y el receipt RUNNING, y no hay hijo cuyo 'exit' los cierre: se cierra ahora.
    let logFd = null;
    let child;
    try {
      logFd = openSync(path.join(runDir, "job.log"), "a");
      child = spawn(nodeBinary, [CHILD_ENTRY, rusageFile, path.join(workspace, EXPLORATORY_ENTRY), verified.slotsPath, EXPLORATORY_OUTPUT], {
        cwd: workspace,
        stdio: ["ignore", logFd, logFd],
      });
    } catch (error) {
      const closed = finish(receipt, { status: JOB_STATUS.FAILED, failure: { code: "SPAWN_FAILED", message: String(error?.message ?? error) } });
      return { ok: false, code: "SPAWN_FAILED", job: publicJobView(closed) };
    } finally {
      if (logFd !== null) closeSync(logFd);
    }
    receipt = { ...receipt, pid: child.pid };

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
      child.once("exit", (exitCode, signal) => {
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
        const exit = { code: exitCode, signal };
        if (timedOut) {
          resolve(finish(receipt, { status: JOB_STATUS.FAILED, exit, memory, failure: { code: "TIMEOUT", message: `superó ${timeoutMs} ms (techo provisional)` } }));
          return;
        }
        if (exitCode !== 0 && memory.cgroupOomKillsDuringRun > 0) {
          resolve(finish(receipt, { status: JOB_STATUS.FAILED, exit, memory, failure: { code: "OOM_KILLED", message: `el cgroup ${memory.cgroup} mató el job por memoria (MemoryMax del servicio)` } }));
          return;
        }
        if (exitCode !== 0) {
          resolve(finish(receipt, { status: JOB_STATUS.FAILED, exit, memory, failure: { code: "RUN_FAILED", message: `el generador terminó con code=${exitCode} signal=${signal}; ver job.log` } }));
          return;
        }
        const collected = collectResult(workspace, verified, receipt.code.staged);
        if (collected.error) {
          resolve(finish(receipt, { status: JOB_STATUS.FAILED, exit, memory, failure: collected.error }));
          return;
        }
        resolve(finish(receipt, { status: JOB_STATUS.SUCCEEDED, exit, memory, result: collected.result }));
      });
    });
    active = { receipt, child, done };
    // Con los handlers ya puestos, el 'exit' del hijo cierra el receipt aunque este
    // asiento del pid falle; por eso su fallo no aborta el job ya lanzado.
    try {
      writeJsonAtomic(receiptFile(runId, attempt), receipt);
    } catch {
      // el receipt en disco queda RUNNING sin pid hasta que finish() lo cierre
    }
    return { ok: true, reused: false, job: publicJobView(receipt, { state: RESULT_STATE.NONE, supersededBy: null }), done };
  }

  // Al arrancar el servicio: si nadie tiene el lock, cierra los RUNNING huérfanos.
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
    start,
    status,
    get,
    // Para tests y apagado ordenado: espera al job en curso de este proceso si lo hay.
    waitForIdle: () => (active?.done ?? Promise.resolve(null)),
  };
}
