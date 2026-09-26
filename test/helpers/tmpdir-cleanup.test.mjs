// Guard de FIX-05: si una corrida de los tests de Energy Markets deja carpetas
// temporales colgadas en tmpdir, este test falla. Detecta fugas de los prefijos
// reales de la suite (p.ej. bt05-repo-), no solo los de este archivo.
// FIX-05, PLAN_STATUS 2026-09-26.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, rmSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  REGISTRY_DIR,
  activeTempDirs,
  cleanupAllTempDirs,
  cleanupTempDir,
  createTempDir,
  findLeakedTempDirs,
  isProcessAlive,
} from "./tmpdir.mjs";

const HELPER_URL = new URL("./tmpdir.mjs", import.meta.url).href;
const SUITE_PREFIX = "bt05-repo-";

function runChild(source) {
  return spawnSync(process.execPath, ["--input-type=module", "-e", source], { encoding: "utf8" });
}

function helperImport() {
  return `import { createTempDir, cleanupTempDir } from ${JSON.stringify(HELPER_URL)};\n`;
}

test("FIX-05: una corrida con un prefijo real de la suite no deja carpetas", () => {
  const child = runChild(helperImport() + `process.stdout.write(createTempDir(${JSON.stringify(SUITE_PREFIX)}));\n`);
  assert.equal(child.status, 0, child.stderr);
  const created = child.stdout.trim();
  assert.equal(created.startsWith(path.join(tmpdir(), SUITE_PREFIX)), true, created);
  assert.equal(existsSync(created), false, `la corrida dejó ${created} en tmpdir`);
  assert.deepEqual(
    findLeakedTempDirs().filter((entry) => entry.dir === created),
    [],
  );
});

test("FIX-05: una fuga real con prefijo de la suite se detecta como fuga", () => {
  // Un proceso que crea la carpeta y muere con SIGKILL reproduce una corrida
  // interrumpida: la carpeta y su ficha quedan con el pid muerto.
  const child = runChild(
    helperImport() +
      `process.stdout.write(createTempDir(${JSON.stringify(SUITE_PREFIX)}));\n` +
      `process.kill(process.pid, "SIGKILL");\n`,
  );
  assert.equal(child.signal, "SIGKILL", child.stderr);
  const leakedDir = child.stdout.trim();
  assert.equal(existsSync(leakedDir), true, "la simulación no dejó la carpeta");

  const detected = findLeakedTempDirs().filter((entry) => entry.dir === leakedDir);
  try {
    assert.equal(detected.length, 1, `el guard no detectó la fuga ${leakedDir}`);
    assert.equal(detected[0].prefix, SUITE_PREFIX);
    assert.equal(isProcessAlive(detected[0].pid), false);
  } finally {
    rmSync(leakedDir, { recursive: true, force: true });
    try {
      unlinkSync(path.join(REGISTRY_DIR, `${path.basename(leakedDir)}.${child.pid}.json`));
    } catch {
      // La ficha pudo no crearse; es limpieza del test, no del helper.
    }
  }
  assert.deepEqual(
    findLeakedTempDirs().filter((entry) => entry.dir === leakedDir),
    [],
  );
});

test("FIX-05: una carpeta viva no se reporta como fuga", () => {
  const dir = createTempDir(SUITE_PREFIX);
  try {
    assert.deepEqual(
      findLeakedTempDirs().filter((entry) => entry.dir === dir),
      [],
    );
  } finally {
    cleanupTempDir(dir);
  }
});

test("FIX-05: un fallo de borrado se informa y hace fallar la corrida", () => {
  const child = runChild(helperImport() + `cleanupTempDir(String.fromCharCode(0) + "bad");\n`);
  assert.equal(child.status, 1, `se esperaba que la corrida fallara, salió ${child.status}`);
  assert.match(child.stderr, /FIX-05/);
  assert.match(child.stderr, /no se pudo borrar/);
});

test("FIX-05: cleanupTempDir borra en el acto y desregistra la carpeta", () => {
  const dir = createTempDir(SUITE_PREFIX);
  assert.equal(existsSync(dir), true);
  assert.equal(activeTempDirs().includes(dir), true);

  assert.equal(cleanupTempDir(dir), true);
  assert.equal(existsSync(dir), false);
  assert.equal(activeTempDirs().includes(dir), false);
});

test("FIX-05: cleanupAllTempDirs vacía lo registrado por el helper", () => {
  const first = createTempDir(SUITE_PREFIX);
  const second = createTempDir("data01-repo-");
  assert.equal(cleanupAllTempDirs(), true);
  assert.equal(existsSync(first), false);
  assert.equal(existsSync(second), false);
  assert.deepEqual(activeTempDirs(), []);
});

test("FIX-05: no hay fugas registradas al terminar el guard", () => {
  assert.deepEqual(findLeakedTempDirs(), [], "hay carpetas temporales de tests EM sin borrar");
});
