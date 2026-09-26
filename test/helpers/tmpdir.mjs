// Helper común de carpetas temporales para los tests de Energy Markets.
// Toda carpeta que un test crea se registra aquí y se borra al terminar el
// proceso del test (node --test corre cada archivo en su propio proceso). Evita
// que las corridas dejen inodos colgados en /tmp: FIX-05, PLAN_STATUS 2026-09-26.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const activeDirs = new Set();
let exitHookInstalled = false;

function removeDir(dir) {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    // La limpieza nunca debe enmascarar el resultado del test.
  }
}

function installExitHook() {
  if (exitHookInstalled) return;
  exitHookInstalled = true;
  process.on("exit", () => {
    for (const dir of activeDirs) removeDir(dir);
    activeDirs.clear();
  });
}

export function createTempDir(prefix) {
  installExitHook();
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  activeDirs.add(dir);
  return dir;
}

export function cleanupTempDir(dir) {
  if (typeof dir !== "string" || dir.length === 0) return;
  removeDir(dir);
  activeDirs.delete(dir);
}

export function cleanupAllTempDirs() {
  for (const dir of [...activeDirs]) cleanupTempDir(dir);
}

export function activeTempDirs() {
  return [...activeDirs];
}
