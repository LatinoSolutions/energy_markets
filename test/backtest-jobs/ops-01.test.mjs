// Tests OPS-01 (PLAN_STATUS, Bru 2026-09-26 "sin duplicados"): un run de BT-05 no
// deja una copia del repo; conserva sólo lo necesario para reproducirlo (receipt,
// registro, log, resultado + MANIFEST por hash) y el mismo commit + datos +
// parámetros vuelve a dar el mismo resultado. Los runs anteriores a OPS-01 no se tocan.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { createTempDir } from "../helpers/tmpdir.mjs";
import path from "node:path";

import { EXPLORATORY_MANIFEST_PATH, EXPLORATORY_OUTPUT, JOB_STATUS, OUTPUT_DIR, REGISTRY_EVENT, WORKSPACE_DIR, WORKSPACE_RETENTION, claimJobLock, createBacktestJobRunner, readJobLock } from "../../src/backtest-jobs/index.mjs";
import { FIXTURE_HELPER_PATH, fixtureHelperSource, makeFixtureRepo } from "./fixture-repo.mjs";

const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const DEAD_PID = 2 ** 22 + 12345;

function filesUnder(root, relativeDir = "") {
  const files = [];
  for (const entry of readdirSync(path.join(root, relativeDir), { withFileTypes: true })) {
    const child = relativeDir === "" ? entry.name : `${relativeDir}/${entry.name}`;
    if (entry.isDirectory()) files.push(...filesUnder(root, child));
    else files.push(child);
  }
  return files.sort();
}

test("OPS-01: un run exitoso no deja workspace; sólo receipt, log, rusage y resultado + MANIFEST en output/", async () => {
  const repo = makeFixtureRepo();
  const runner = createBacktestJobRunner({ repoRoot: repo.root });
  const receipt = await runner.start({ requestedBy: "ui" }).done;
  assert.equal(receipt.status, JOB_STATUS.SUCCEEDED, JSON.stringify(receipt.failure));

  const attemptDir = path.join(runner.runsRoot, receipt.runId, "attempt-1");
  assert.equal(existsSync(path.join(attemptDir, WORKSPACE_DIR)), false);
  assert.deepEqual(filesUnder(attemptDir), [
    "RUN_RECEIPT.json",
    "child-rusage.json",
    "job.log",
    `${OUTPUT_DIR}/${EXPLORATORY_MANIFEST_PATH}`,
    `${OUTPUT_DIR}/${EXPLORATORY_OUTPUT}`,
  ].sort());
  assert.deepEqual(receipt.workspace, { path: `operations/backtest-runs/${receipt.runId}/attempt-1/${WORKSPACE_DIR}`, retention: WORKSPACE_RETENTION, removed: true });

  // lo conservado está atado por hash en el receipt
  const resultsBytes = readFileSync(path.join(repo.root, receipt.result.results.path));
  assert.equal(receipt.result.results.path, `operations/backtest-runs/${receipt.runId}/attempt-1/${OUTPUT_DIR}/${EXPLORATORY_OUTPUT}`);
  assert.equal(sha(resultsBytes), receipt.result.results.sha256);
  const manifestBytes = readFileSync(path.join(repo.root, receipt.result.manifest.path));
  assert.equal(sha(manifestBytes), receipt.result.manifest.sha256);
  // y lo necesario para reproducir sigue en el receipt: commit, datos por hash, parámetros
  assert.equal(receipt.identity.codeCommit, repo.head());
  assert.ok(receipt.inputs.files.every((file) => /^[0-9a-f]{64}$/.test(file.sha256)));
  assert.equal(typeof receipt.identity.parameters.slotsPath, "string");
  assert.match(receipt.code.staged.sha256, /^[0-9a-f]{64}$/);
});

test("OPS-01 reproducibilidad: mismo commit + datos + parámetros, sin el workspace anterior, da el mismo run_id y el mismo resultado", async () => {
  const repo = makeFixtureRepo();
  const first = await createBacktestJobRunner({ repoRoot: repo.root }).start({ requestedBy: "ui" }).done;
  const otherRunsDir = createTempDir("ops01-rerun-");
  const second = await createBacktestJobRunner({ repoRoot: repo.root, runsDir: otherRunsDir }).start({ requestedBy: "mcp" }).done;

  assert.equal(second.status, JOB_STATUS.SUCCEEDED, JSON.stringify(second.failure));
  assert.equal(second.runId, first.runId);
  assert.deepEqual(second.identity, first.identity);
  assert.equal(second.result.results.sha256, first.result.results.sha256);
  assert.equal(second.result.manifest.sha256, first.result.manifest.sha256);
  assert.equal(second.code.staged.sha256, first.code.staged.sha256);
});

test("OPS-01: un run FAILED también borra su workspace y no deja output/", async () => {
  const repo = makeFixtureRepo({ mode: "slow" });
  const runner = createBacktestJobRunner({ repoRoot: repo.root });
  const started = runner.start({ requestedBy: "ui" });
  const workspace = path.join(runner.runsRoot, started.job.runId, "attempt-1", WORKSPACE_DIR);
  writeFileSync(path.join(workspace, FIXTURE_HELPER_PATH), fixtureHelperSource("altered-in-workspace"));
  const receipt = await started.done;

  assert.equal(receipt.status, JOB_STATUS.FAILED);
  assert.equal(receipt.failure.code, "CODE_CHANGED_DURING_RUN");
  assert.equal(receipt.workspace.removed, true);
  assert.equal(existsSync(workspace), false);
  assert.equal(existsSync(path.join(runner.runsRoot, started.job.runId, "attempt-1", OUTPUT_DIR)), false);
  assert.ok(existsSync(path.join(runner.runsRoot, started.job.runId, "attempt-1", "job.log")));
});

test("OPS-01: resultados declarados fuera del workspace no se copian a output/; el run cierra FAILED", async () => {
  const repo = makeFixtureRepo({ mode: "escape" });
  const runner = createBacktestJobRunner({ repoRoot: repo.root });
  const receipt = await runner.start({ requestedBy: "ui" }).done;

  assert.equal(receipt.status, JOB_STATUS.FAILED);
  assert.equal(receipt.failure.code, "RUN_OUTPUT_NOT_PRESERVED");
  assert.equal(runner.status().currentResult, null);
  assert.equal(existsSync(path.join(runner.runsRoot, receipt.runId, "attempt-1", OUTPUT_DIR)), false);
  assert.equal(existsSync(path.join(runner.runsRoot, receipt.runId, "attempt-1", WORKSPACE_DIR)), false);
});

test("OPS-01 huérfanos: se borra el workspace que el receipt declara temporal; el de un run anterior a OPS-01 no se toca", async () => {
  const repo = makeFixtureRepo();
  const runner = createBacktestJobRunner({ repoRoot: repo.root });
  const receipt = await runner.start({ requestedBy: "ui" }).done;
  const { finishedAt, result, exit, memory, ...running } = receipt;

  // intento 2: corte a mitad con el contrato OPS-01 (workspace temporal que quedó en disco)
  const temporaryDir = path.join(runner.runsRoot, receipt.runId, "attempt-2");
  mkdirSync(path.join(temporaryDir, WORKSPACE_DIR, "src"), { recursive: true });
  writeFileSync(path.join(temporaryDir, WORKSPACE_DIR, "src", "copia.mjs"), "// copia");
  writeFileSync(path.join(temporaryDir, "RUN_RECEIPT.json"), JSON.stringify({ ...running, attempt: 2, status: JOB_STATUS.RUNNING, workspace: { ...receipt.workspace, removed: false } }));

  // otro run, anterior a OPS-01: su receipt no declara workspace temporal
  const legacyRunId = `BT-RUN-${"a".repeat(64)}`;
  const legacyDir = path.join(runner.runsRoot, legacyRunId, "attempt-1");
  mkdirSync(path.join(legacyDir, WORKSPACE_DIR, "src"), { recursive: true });
  writeFileSync(path.join(legacyDir, WORKSPACE_DIR, "src", "copia.mjs"), "// copia legacy");
  const { workspace: _ignored, ...legacyReceipt } = running;
  writeFileSync(path.join(legacyDir, "RUN_RECEIPT.json"), JSON.stringify({ ...legacyReceipt, runId: legacyRunId, schemaVersion: "3", status: JOB_STATUS.RUNNING }));
  claimJobLock(runner.runsRoot, readJobLock(runner.runsRoot).generation, { runId: receipt.runId, attempt: 2, pid: DEAD_PID });

  createBacktestJobRunner({ repoRoot: repo.root });

  const recovered = JSON.parse(readFileSync(path.join(temporaryDir, "RUN_RECEIPT.json"), "utf8"));
  assert.equal(recovered.status, JOB_STATUS.INTERRUPTED);
  assert.equal(recovered.workspace.removed, true);
  assert.equal(existsSync(path.join(temporaryDir, WORKSPACE_DIR)), false);

  const legacy = JSON.parse(readFileSync(path.join(legacyDir, "RUN_RECEIPT.json"), "utf8"));
  assert.equal(legacy.status, JOB_STATUS.INTERRUPTED);
  assert.equal(legacy.workspace, undefined);
  assert.equal(readFileSync(path.join(legacyDir, WORKSPACE_DIR, "src", "copia.mjs"), "utf8"), "// copia legacy");
});

test("OPS-01: un workspace temporal que no se pudo borrar al cerrar se borra en el siguiente arranque y queda asentado", async () => {
  const repo = makeFixtureRepo();
  const runner = createBacktestJobRunner({ repoRoot: repo.root });
  const receipt = await runner.start({ requestedBy: "ui" }).done;
  assert.equal(receipt.status, JOB_STATUS.SUCCEEDED, JSON.stringify(receipt.failure));

  // estado que deja finish() cuando rmSync falla: el run cerró, el duplicado quedó
  const attemptDir = path.join(runner.runsRoot, receipt.runId, "attempt-1");
  const receiptPath = path.join(attemptDir, "RUN_RECEIPT.json");
  mkdirSync(path.join(attemptDir, WORKSPACE_DIR, "src"), { recursive: true });
  writeFileSync(path.join(attemptDir, WORKSPACE_DIR, "src", "copia.mjs"), "// copia que no se pudo borrar");
  writeFileSync(receiptPath, JSON.stringify({ ...receipt, workspace: { ...receipt.workspace, removed: false, error: "EBUSY simulado" } }));

  createBacktestJobRunner({ repoRoot: repo.root });

  assert.equal(existsSync(path.join(attemptDir, WORKSPACE_DIR)), false);
  const swept = JSON.parse(readFileSync(receiptPath, "utf8"));
  assert.equal(swept.workspace.removed, true);
  assert.equal(swept.workspace.error, undefined);
  assert.match(swept.workspace.removedAt, /^\d{4}-\d{2}-\d{2}T/);
  // sólo cambia el workspace: estado, resultado y hashes del intento siguen iguales
  const { workspace: _a, ...sweptRest } = swept;
  const { workspace: _b, ...originalRest } = receipt;
  assert.deepEqual(sweptRest, originalRest);
  const events = readFileSync(path.join(runner.runsRoot, "REGISTRY.jsonl"), "utf8").trim().split("\n").map((line) => JSON.parse(line));
  const removal = events.filter((event) => event.event === REGISTRY_EVENT.WORKSPACE_REMOVED);
  assert.equal(removal.length, 1);
  assert.equal(removal[0].runId, receipt.runId);
  assert.equal(removal[0].previousError, "EBUSY simulado");
  // el resultado vigente no cambia
  assert.equal(runner.status().currentResult.runId, receipt.runId);

  // un segundo arranque no repite el asiento
  createBacktestJobRunner({ repoRoot: repo.root });
  const after = readFileSync(path.join(runner.runsRoot, "REGISTRY.jsonl"), "utf8").trim().split("\n").map((line) => JSON.parse(line));
  assert.equal(after.filter((event) => event.event === REGISTRY_EVENT.WORKSPACE_REMOVED).length, 1);
});

test("OPS-01: un run cerrado anterior a OPS-01 conserva su workspace aunque el servicio arranque (limpieza sólo con GO de Bru)", async () => {
  const repo = makeFixtureRepo();
  const runner = createBacktestJobRunner({ repoRoot: repo.root });
  const receipt = await runner.start({ requestedBy: "ui" }).done;
  const legacyRunId = `BT-RUN-${"b".repeat(64)}`;
  const legacyDir = path.join(runner.runsRoot, legacyRunId, "attempt-1");
  mkdirSync(path.join(legacyDir, WORKSPACE_DIR, "src"), { recursive: true });
  writeFileSync(path.join(legacyDir, WORKSPACE_DIR, "src", "copia.mjs"), "// copia legacy");
  const { workspace: _ignored, ...legacyReceipt } = receipt;
  const legacyBytes = JSON.stringify({ ...legacyReceipt, runId: legacyRunId, schemaVersion: "3" });
  writeFileSync(path.join(legacyDir, "RUN_RECEIPT.json"), legacyBytes);

  createBacktestJobRunner({ repoRoot: repo.root });

  assert.equal(readFileSync(path.join(legacyDir, WORKSPACE_DIR, "src", "copia.mjs"), "utf8"), "// copia legacy");
  assert.equal(readFileSync(path.join(legacyDir, "RUN_RECEIPT.json"), "utf8"), legacyBytes);
});
