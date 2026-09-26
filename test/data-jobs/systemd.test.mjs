// DATA-01: unidad systemd --user y entrypoint. Fija que el path unit vigila el
// log correcto, que el servicio corre el CLI del repo sin humano al medio, y que
// el CLI decide bien ante un log sin checksum o con CHECKSUM FALLA.

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { DATA_ARCHIVE } from "../../src/data-jobs/pipeline.mjs";

const repoRoot = fileURLToPath(new URL("../../", import.meta.url));
const systemdDir = path.join(repoRoot, "operations/data-jobs/systemd");
const CLI = path.join(repoRoot, "operations/data-jobs/run-data-queue.mjs");

test("DATA-01 systemd: el path unit vigila el log de descarga y arranca el servicio de la cola", () => {
  const unit = readFileSync(path.join(systemdDir, "energy-markets-data-queue.path"), "utf8");
  assert.match(unit, /\[Path\]/);
  assert.match(unit, new RegExp(`PathModified=${DATA_ARCHIVE.logPath}`));
  assert.match(unit, /Unit=energy-markets-data-queue\.service/);
  assert.match(unit, /WantedBy=default\.target/);
});

test("DATA-01 systemd: el servicio corre el CLI del repo, sin humano, con techo de memoria y env fuera del repo", () => {
  const unit = readFileSync(path.join(systemdDir, "energy-markets-data-queue.service"), "utf8");
  assert.match(unit, /Type=oneshot/);
  assert.match(unit, /ExecStart=\/usr\/bin\/node operations\/data-jobs\/run-data-queue\.mjs/);
  assert.match(unit, /WorkingDirectory=\/srv\/hot-data\/energy-markets\/app/);
  assert.match(unit, /Environment=DATA_REPO_ROOT=\/srv\/hot-data\/energy-markets\/app/);
  assert.match(unit, /EnvironmentFile=-%h\/\.config\/energy-markets\/data-queue\.env/);
  assert.match(unit, /MemoryMax=24G/);
  assert.equal(/TELEGRAM_BOT_TOKEN=/.test(unit), false, "el token no se versiona en la unidad");
});

test("DATA-01 systemd: el timer opcional es una red de seguridad del mismo servicio", () => {
  const unit = readFileSync(path.join(systemdDir, "energy-markets-data-queue.timer"), "utf8");
  assert.match(unit, /\[Timer\]/);
  assert.match(unit, /Unit=energy-markets-data-queue\.service/);
  assert.match(unit, /WantedBy=timers\.target/);
});

test("DATA-01 CLI: existe, usa el pipeline de src/data-jobs y no corre jobs reales en tests", () => {
  assert.equal(existsSync(CLI), true);
  const source = readFileSync(CLI, "utf8");
  assert.match(source, /from "\.\.\/\.\.\/src\/data-jobs\/index\.mjs"/);
  assert.match(source, /buildDataQueueSteps/);
  assert.match(source, /createDataQueueRunner/);
  assert.match(source, /createTelegramNotifier/);
});

test("DATA-01 CLI: un log sin línea de checksum no lanza nada (WAIT)", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "data01-cli-"));
  try {
    const log = path.join(dir, "descarga.log");
    writeFileSync(log, "2026-09-25T17:00:43Z intento 1, llevo 0 bytes\n");
    const runsDir = path.join(dir, "runs");
    const output = execFileSync(process.execPath, [CLI], {
      encoding: "utf8",
      env: { ...process.env, DATA_REPO_ROOT: repoRoot, DATA_ARCHIVE_LOG: log, DATA_RUNS_DIR: runsDir },
    });
    assert.match(output, /sin línea de checksum/);
    assert.equal(existsSync(path.join(runsDir, "TRIGGER_STATE.json")), false);
    assert.equal(existsSync(path.join(runsDir, "DATA-QUEUE")), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("DATA-01 CLI: CHECKSUM FALLA no lanza nada, avisa (aunque no haya Telegram) y lo registra", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "data01-cli-"));
  try {
    const log = path.join(dir, "descarga.log");
    writeFileSync(log, `2026-09-25T23:31:00Z CHECKSUM FALLA ${"a".repeat(64)}\n`);
    const runsDir = path.join(dir, "runs");
    const output = execFileSync(process.execPath, [CLI], {
      encoding: "utf8",
      env: { ...process.env, DATA_REPO_ROOT: repoRoot, DATA_ARCHIVE_LOG: log, DATA_RUNS_DIR: runsDir },
    });
    assert.match(output, /CHECKSUM_FALLA/);
    assert.match(output, /no se lanza nada/);
    const state = JSON.parse(readFileSync(path.join(runsDir, "TRIGGER_STATE.json"), "utf8"));
    assert.equal(state.lastHandled.kind, "CHECKSUM_FALLA");
    assert.equal(state.lastHandled.notification.code, "TELEGRAM_NOT_CONFIGURED");
    // No se creó ninguna cola ni se lanzó ningún job.
    assert.equal(existsSync(path.join(runsDir, "DATA-QUEUE")), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
