// Guard de FIX-05: si una corrida deja carpetas temporales colgadas en
// tmpdir, este test falla. Usa el helper común como única vía de creación.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { activeTempDirs, cleanupAllTempDirs, cleanupTempDir, createTempDir } from "./tmpdir.mjs";

const GUARD_PREFIX = "emtmp-guard-";
const HELPER_URL = new URL("./tmpdir.mjs", import.meta.url).href;

function managedDirs(prefix = GUARD_PREFIX) {
  return readdirSync(tmpdir()).filter((name) => name.startsWith(prefix));
}

function runChild(source) {
  return spawnSync(process.execPath, ["--input-type=module", "-e", source], { encoding: "utf8" });
}

test("FIX-05: createTempDir se borra solo al terminar el proceso del test", () => {
  const before = managedDirs();
  const child = runChild(
    `import { createTempDir } from ${JSON.stringify(HELPER_URL)};\n` +
      `process.stdout.write(createTempDir(${JSON.stringify(GUARD_PREFIX)}));\n`,
  );
  assert.equal(child.status, 0, child.stderr);
  const created = child.stdout.trim();
  assert.equal(created.startsWith(path.join(tmpdir(), GUARD_PREFIX)), true, created);
  assert.equal(existsSync(created), false, `la corrida dejó ${created} en tmpdir`);
  assert.deepEqual(managedDirs(), before);
});

test("FIX-05: cleanupTempDir borra en el acto y desregistra la carpeta", () => {
  const dir = createTempDir(GUARD_PREFIX);
  assert.equal(existsSync(dir), true);
  assert.equal(activeTempDirs().includes(dir), true);

  cleanupTempDir(dir);
  assert.equal(existsSync(dir), false);
  assert.equal(activeTempDirs().includes(dir), false);
  assert.deepEqual(managedDirs(), []);
});

test("FIX-05: una carpeta sin registrar se detecta como fuga y no se ignora", () => {
  const child = runChild(
    `import { mkdtempSync } from "node:fs";\n` +
      `import { tmpdir } from "node:os";\n` +
      `import path from "node:path";\n` +
      `process.stdout.write(mkdtempSync(path.join(tmpdir(), ${JSON.stringify(GUARD_PREFIX)})));\n`,
  );
  assert.equal(child.status, 0, child.stderr);
  const leaked = child.stdout.trim();
  try {
    assert.equal(existsSync(leaked), true, "el detector de fugas no ve una carpeta sin registrar");
    assert.equal(managedDirs().includes(path.basename(leaked)), true);
  } finally {
    cleanupTempDir(leaked);
  }
});

test("FIX-05: cleanupAllTempDirs vacía lo registrado por el helper", () => {
  const first = createTempDir(GUARD_PREFIX);
  const second = createTempDir(GUARD_PREFIX);
  cleanupAllTempDirs();
  assert.equal(existsSync(first), false);
  assert.equal(existsSync(second), false);
  assert.deepEqual(activeTempDirs(), []);
  assert.deepEqual(managedDirs(), []);
});
