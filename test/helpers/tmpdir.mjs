// Helper común de carpetas temporales para los tests de Energy Markets.
// Toda carpeta que un test crea se registra aquí y se borra al terminar el
// proceso del test (node --test corre cada archivo en su propio proceso).
// FIX-05, PLAN_STATUS 2026-09-26: si el borrado falla, la corrida debe fallar
// (no silenciar la fuga) y quedar ficha de la carpeta para que el guard la vea.

import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// Registro compartido: cada carpeta creada por el helper deja una ficha con el
// pid de su proceso. Así el guard de FIX-05 distingue una carpeta viva (proceso
// en curso) de una fuga real (proceso muerto) aunque los archivos de test corran
// en paralelo, y no confunde las carpetas viejas de /tmp (sin ficha) con fugas.
export const REGISTRY_DIR = path.join(tmpdir(), "em-test-tmpdir-registry");

// All workers launched by one `node --test` process share its pid and kernel
// start time. The start time prevents pid reuse from attributing an old marker
// to a new run. Nested fixture processes can inherit an explicit identifier.
export function currentTestRunId() {
  if (process.env.EM_TEST_RUN_ID) return process.env.EM_TEST_RUN_ID;
  let parentStart = "unknown";
  try {
    const stat = readFileSync(`/proc/${process.ppid}/stat`, "utf8");
    parentStart = stat.slice(stat.lastIndexOf(")") + 2).trim().split(/\s+/)[19];
  } catch {
    // The verifier still isolates its TMPDIR if procfs is unavailable.
  }
  return `${process.ppid}-${parentStart}`;
}

const activeDirs = new Map(); // dir -> markerPath
const leaks = new Map(); // dir -> error string
let exitHookInstalled = false;

function installExitHook() {
  if (exitHookInstalled) return;
  exitHookInstalled = true;
  process.on("exit", () => {
    for (const dir of [...activeDirs.keys()]) cleanupNow(dir);
    if (leaks.size > 0) {
      for (const [dir, error] of leaks) {
        process.stderr.write(`[FIX-05] no se pudo borrar la carpeta temporal ${dir}: ${error}\n`);
      }
      process.exitCode = 1;
    }
  });
}

function markerPathFor(dir) {
  return path.join(REGISTRY_DIR, `${path.basename(dir)}.${process.pid}.json`);
}

function writeMarker(dir, prefix) {
  mkdirSync(REGISTRY_DIR, { recursive: true });
  const markerPath = markerPathFor(dir);
  writeFileSync(markerPath, JSON.stringify({ dir, prefix, pid: process.pid, runId: currentTestRunId(), createdAt: Date.now() }));
  return markerPath;
}

function removeMarker(markerPath) {
  try {
    unlinkSync(markerPath);
  } catch {
    // La ficha pudo borrarse ya; no es un error.
  }
}

function removeDir(dir) {
  try {
    rmSync(dir, { recursive: true, force: true });
    leaks.delete(dir);
    return true;
  } catch (error) {
    leaks.set(dir, String(error && error.message ? error.message : error));
    return false;
  }
}

function unregister(dir) {
  const markerPath = activeDirs.get(dir);
  activeDirs.delete(dir);
  if (markerPath) removeMarker(markerPath);
}

function cleanupNow(dir) {
  if (!removeDir(dir)) return false;
  unregister(dir);
  return true;
}

export function createTempDir(prefix) {
  installExitHook();
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  // Register in memory before writing the marker. An ENOSPC while writing it
  // must not leave the newly created directory outside the exit cleanup hook.
  activeDirs.set(dir, markerPathFor(dir));
  try {
    activeDirs.set(dir, writeMarker(dir, prefix));
    return dir;
  } catch (error) {
    // writeFileSync can leave a partial marker. cleanupNow removes it after
    // the directory; if deletion fails, the exit hook retries the directory.
    cleanupNow(dir);
    throw error;
  }
}

export function cleanupTempDir(dir) {
  installExitHook();
  if (typeof dir !== "string" || dir.length === 0) return false;
  return cleanupNow(dir);
}

export function cleanupAllTempDirs() {
  installExitHook();
  let ok = true;
  for (const dir of [...activeDirs.keys()]) {
    if (!cleanupNow(dir)) ok = false;
  }
  return ok;
}

export function activeTempDirs() {
  return [...activeDirs.keys()];
}

export function tempDirLeaks() {
  return [...leaks.entries()].map(([dir, error]) => ({ dir, error }));
}

export function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}

// Fugas reales = fichas cuyo proceso ya murió y cuya carpeta sigue en tmpdir.
// Without a runId this is an operational inventory, including old markers.
// The current-run guard passes its runId so a previous crash cannot fail it.
export function findLeakedTempDirs({ runId } = {}) {
  let names;
  try {
    names = readdirSync(REGISTRY_DIR);
  } catch {
    return [];
  }
  const leaked = [];
  for (const name of names) {
    const markerPath = path.join(REGISTRY_DIR, name);
    let marker;
    try {
      marker = JSON.parse(readFileSync(markerPath, "utf8"));
    } catch {
      continue;
    }
    if (!marker || typeof marker.dir !== "string") continue;
    if (runId !== undefined && marker.runId !== runId) continue;
    if (marker.pid === process.pid || isProcessAlive(marker.pid)) continue;
    if (!existsSync(marker.dir)) {
      // Preserve historical markers for separate operational inspection.
      continue;
    }
    leaked.push({ dir: marker.dir, prefix: marker.prefix, pid: marker.pid, runId: marker.runId, markerPath });
  }
  return leaked;
}
