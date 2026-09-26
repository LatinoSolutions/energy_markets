// DATA-01: runner de la cola. Prueba que corre los jobs de a UNO, en orden, con
// receipt por job (MemoryMax declarado + memory.peak medido), aviso por Telegram
// al terminar o fallar, idempotencia por disparador y reanudación tras un corte.

import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import {
  QUEUE_STATUS,
  STEP_RECEIPT_FILE,
  STEP_STATUS,
  buildSpawnCommand,
  createDataQueueRunner,
  queueIdFor,
  stepFingerprint,
} from "../../src/data-jobs/index.mjs";
import { readJobLock } from "../../src/backtest-jobs/runner.mjs";
import { CHECKSUM_OK_TRIGGER, makeDataFixtureRepo } from "./fixtures.mjs";

const sha = "c0b8389dd2eae768e0144ebffa2eb8c557c1407ec8bbccb014c0ecdee075cdd3";
const DEAD_PID = 2 ** 22 + 999;

function recordingNotifier() {
  const messages = [];
  return { configured: true, messages, notify: (text) => { messages.push(text); return Promise.resolve({ configured: true, ok: true, at: "t" }); } };
}

function stepsFor(repo, modes) {
  return modes.map((mode, index) => repo.step(`STEP_${index + 1}`, `out/step-${index + 1}.json`, mode));
}

test("DATA-01 runner: los jobs corren de a uno y en orden, cada uno con su receipt y su memory.peak", async () => {
  const repo = makeDataFixtureRepo();
  const notifier = recordingNotifier();
  const runner = createDataQueueRunner({ repoRoot: repo.root, runsDir: repo.runsDir, notifier });
  const steps = stepsFor(repo, ["ok", "ok", "ok"]);
  const result = await runner.runQueue({ trigger: CHECKSUM_OK_TRIGGER, steps });

  assert.equal(result.ok, true, JSON.stringify(result.queue));
  assert.equal(result.queue.status, QUEUE_STATUS.SUCCEEDED);
  assert.match(result.queueId, /^DATA-QUEUE-[0-9a-f]{64}$/);
  // Orden real de ejecución (el fixture deja su marcador en el counter).
  assert.deepEqual(repo.readCounter(), ["STEP_1", "STEP_2", "STEP_3"]);

  const found = runner.get(result.queueId);
  assert.equal(found.steps.length, 3);
  for (const receipt of found.steps) {
    assert.equal(receipt.receiptKind, "DATA-01_JOB_RECEIPT");
    assert.equal(receipt.status, STEP_STATUS.SUCCEEDED);
    assert.equal(receipt.memoryMaxBytes, 64 * 1024 * 1024);
    assert.equal(receipt.enforcedBy, "none", "sin scope de systemd el techo queda declarado, no fingido");
    // Sin scope el job corre en el cgroup del servicio: se declara como tal.
    assert.equal(receipt.memory.peakSource, "service-cgroup");
    assert.equal(typeof receipt.memory.memoryPeakBytes, "number");
    assert.equal(typeof receipt.memory.cgroup, "string");
    assert.equal(receipt.notification.ok, true);
  }
  assert.deepEqual(notifier.messages, [
    `SUCCEEDED · DATA-01 STEP_1 (1/3) · ${result.queueId}`,
    `SUCCEEDED · DATA-01 STEP_2 (2/3) · ${result.queueId}`,
    `SUCCEEDED · DATA-01 STEP_3 (3/3) · ${result.queueId}`,
    `DATA-01 cola completa · 3 jobs OK · ${result.queueId}`,
  ]);
  // Lock libre al terminar.
  assert.equal(readJobLock(runner.runsRoot)?.live !== true, true);
  assert.equal(runner.status().running, false);
});

test("DATA-01 runner: el mismo disparador no vuelve a correr los jobs (idempotente)", async () => {
  const repo = makeDataFixtureRepo();
  const runner = createDataQueueRunner({ repoRoot: repo.root, runsDir: repo.runsDir });
  const steps = stepsFor(repo, ["ok", "ok"]);
  const first = await runner.runQueue({ trigger: CHECKSUM_OK_TRIGGER, steps });
  assert.equal(first.ok, true);
  assert.deepEqual(repo.readCounter(), ["STEP_1", "STEP_2"]);

  const again = await runner.runQueue({ trigger: CHECKSUM_OK_TRIGGER, steps });
  assert.equal(again.ok, true);
  assert.equal(again.reused, true);
  assert.equal(again.queueId, first.queueId);
  assert.deepEqual(repo.readCounter(), ["STEP_1", "STEP_2"], "no se recalculó");
});

test("DATA-01 runner: un job que falla detiene la cola (no corre el siguiente) y lo avisa", async () => {
  const repo = makeDataFixtureRepo();
  const notifier = recordingNotifier();
  const runner = createDataQueueRunner({ repoRoot: repo.root, runsDir: repo.runsDir, notifier });
  const steps = stepsFor(repo, ["ok", "fail", "ok"]);
  const result = await runner.runQueue({ trigger: CHECKSUM_OK_TRIGGER, steps });

  assert.equal(result.ok, false);
  assert.equal(result.code, "STEP_FAILED");
  assert.equal(result.queue.status, QUEUE_STATUS.FAILED);
  assert.equal(result.queue.failedStep.jobKind, "STEP_2");
  assert.deepEqual(repo.readCounter(), ["STEP_1"], "STEP_3 no corre tras el fallo");
  const failed = runner.get(result.queueId).steps.find((receipt) => receipt.jobKind === "STEP_2");
  assert.equal(failed.status, STEP_STATUS.FAILED);
  assert.equal(failed.failure.code, "RUN_FAILED");
  assert.equal(failed.exit.code, 3);
  assert.match(readFileSync(`${repo.root}/operations/data-runs/${result.queueId}/02-STEP_2/job.log`, "utf8"), /fallo forzado/);
  assert.ok(notifier.messages.some((text) => text.includes("FAILED · DATA-01 STEP_2")));
  assert.ok(notifier.messages.some((text) => text.includes("cola detenida")));
  assert.equal(readJobLock(runner.runsRoot)?.live !== true, true);
});

test("DATA-01 runner: un job que sale 0 sin dejar su artefacto es un fallo", async () => {
  const repo = makeDataFixtureRepo();
  const runner = createDataQueueRunner({ repoRoot: repo.root, runsDir: repo.runsDir });
  const result = await runner.runQueue({ trigger: CHECKSUM_OK_TRIGGER, steps: stepsFor(repo, ["no-artifact"]) });
  assert.equal(result.ok, false);
  assert.equal(result.queue.failure.code, "STEP_ARTIFACT_MISSING");
});

test("DATA-01 runner: timeout mata el job y lo cierra FAILED/TIMEOUT", async () => {
  const repo = makeDataFixtureRepo();
  const runner = createDataQueueRunner({ repoRoot: repo.root, runsDir: repo.runsDir });
  const steps = [repo.step("STEP_1", "out/step-1.json", "hang", { timeoutMs: 300 })];
  const result = await runner.runQueue({ trigger: CHECKSUM_OK_TRIGGER, steps });
  assert.equal(result.ok, false);
  assert.equal(result.queue.failure.code, "TIMEOUT");
});

test("DATA-01 runner: reanuda desde el primer paso no completado y no recalcula los ya SUCCEEDED", async () => {
  const repo = makeDataFixtureRepo();
  const runner = createDataQueueRunner({ repoRoot: repo.root, runsDir: repo.runsDir });
  const steps = stepsFor(repo, ["ok", "fail", "ok"]);
  const failed = await runner.runQueue({ trigger: CHECKSUM_OK_TRIGGER, steps });
  assert.equal(failed.ok, false);
  assert.deepEqual(repo.readCounter(), ["STEP_1"]);

  // El siguiente intento reusa STEP_1 y reintenta desde STEP_2 (ya no falla).
  const retrySteps = stepsFor(repo, ["ok", "ok", "ok"]);
  const retried = await runner.runQueue({ trigger: CHECKSUM_OK_TRIGGER, steps: retrySteps });
  assert.equal(retried.ok, true);
  assert.equal(retried.reused, false);
  assert.equal(retried.queueId, failed.queueId);
  // STEP_1 no se volvió a ejecutar (reuso); STEP_2 y STEP_3 sí.
  assert.deepEqual(repo.readCounter(), ["STEP_1", "STEP_2", "STEP_3"]);
  assert.equal(retried.receipts[0].reused, true);
  const step1 = runner.get(retried.queueId).steps.find((receipt) => receipt.jobKind === "STEP_1");
  assert.equal(step1.status, STEP_STATUS.SUCCEEDED);
});

test("DATA-01 runner: un disparador que no es CHECKSUM OK no lanza la cola", async () => {
  const repo = makeDataFixtureRepo();
  const runner = createDataQueueRunner({ repoRoot: repo.root, runsDir: repo.runsDir });
  const result = await runner.runQueue({ trigger: { kind: "CHECKSUM_FALLA", event: { at: "t", sha256: "x" } }, steps: stepsFor(repo, ["ok"]) });
  assert.equal(result.ok, false);
  assert.equal(result.code, "TRIGGER_NOT_READY");
  assert.equal(repo.readCounter().length, 0);
});

test("DATA-01 runner: dos procesos no corren la cola a la vez (lock en disco)", async () => {
  const repo = makeDataFixtureRepo();
  const runner = createDataQueueRunner({ repoRoot: repo.root, runsDir: repo.runsDir });
  const { claimJobLock } = await import("../../src/backtest-jobs/runner.mjs");
  const steps = stepsFor(repo, ["ok"]);
  const queueId = queueIdFor(CHECKSUM_OK_TRIGGER, steps);
  claimJobLock(repo.runsDir, 0, { queueId, pid: DEAD_PID });
  // Un lock de un pid muerto no bloquea (se recupera).
  const recovered = await runner.runQueue({ trigger: CHECKSUM_OK_TRIGGER, steps });
  assert.equal(recovered.ok, true);
});

test("DATA-01 runner: MemoryMax se impone con un scope de systemd por job cuando está habilitado", () => {
  const step = { command: ["python3", "job.py", "--x"], memoryMaxBytes: 12345 };
  const peakFile = "/tmp/data01-peak.json";
  const scoped = buildSpawnCommand(step, { useSystemdScope: true, peakFile });
  assert.equal(scoped.bin, "systemd-run");
  assert.equal(scoped.enforcedBy, "systemd-scope");
  assert.ok(scoped.args.includes("--property=MemoryMax=12345"));
  // El scope corre child-entry, que escribe el pico del cgroup del job.
  const separator = scoped.args.indexOf("--");
  assert.equal(scoped.args[separator + 1], process.execPath);
  assert.match(scoped.args[separator + 2], /child-entry\.mjs$/);
  assert.equal(scoped.args[separator + 3], peakFile);
  assert.equal(scoped.args[separator + 4], "--");
  assert.deepEqual(scoped.args.slice(separator + 5), step.command);
  const plain = buildSpawnCommand(step, { useSystemdScope: false });
  assert.equal(plain.bin, "python3");
  assert.equal(plain.enforcedBy, "none");
  assert.equal(plain.memoryMaxBytes, 12345, "el techo declarado se conserva aunque no se imponga");
  assert.equal(plain.peakFile, null);
  assert.throws(() => buildSpawnCommand({ command: [] }), /no tiene comando/);
});

test("DATA-01 runner: con scope de systemd el receipt registra el cgroup y el pico del JOB, no del servicio", async () => {
  const repo = makeDataFixtureRepo();
  const artifact = path.join(repo.root, "out/step-1.json");
  let observedSpec = null;
  const spawnJob = (spec) => {
    observedSpec = spec;
    // El supervisor (child-entry) escribe el pico de SU cgroup al terminar.
    writeFileSync(spec.peakFile, JSON.stringify({ cgroup: "/user.slice/user-1001.slice/run-abc.scope", memoryPeakBytes: 4242, oomKills: 2 }));
    mkdirSync(path.dirname(artifact), { recursive: true });
    writeFileSync(artifact, JSON.stringify({ ok: true }));
    const child = new EventEmitter();
    child.pid = 987654;
    setImmediate(() => child.emit("exit", 0, null));
    return child;
  };
  const runner = createDataQueueRunner({ repoRoot: repo.root, runsDir: repo.runsDir, useSystemdScope: true, spawnJob });
  const result = await runner.runQueue({ trigger: CHECKSUM_OK_TRIGGER, steps: stepsFor(repo, ["ok"]) });
  assert.equal(result.ok, true, JSON.stringify(result.queue));
  assert.equal(observedSpec.bin, "systemd-run");
  assert.match(observedSpec.peakFile, /job-memory\.json$/);
  const receipt = runner.get(result.queueId).steps[0];
  assert.equal(receipt.enforcedBy, "systemd-scope");
  assert.equal(receipt.memory.cgroup, "/user.slice/user-1001.slice/run-abc.scope");
  assert.equal(receipt.memory.memoryPeakBytes, 4242);
  assert.equal(receipt.memory.peakSource, "job-scope");
  assert.equal(receipt.memory.oomKillsDuringRun, 2);
});

test("DATA-01 runner: el timeout mata al proceso directo y a sus hijos (no quedan huérfanos)", async () => {
  const repo = makeDataFixtureRepo();
  const pidFile = path.join(repo.root, "tree.pid");
  const killer = path.join(repo.root, "hang-tree.sh");
  writeFileSync(killer, `#!/bin/bash\nsleep 300 & echo $! > "$TREE_PID_FILE"\nsleep 300\n`);
  const runner = createDataQueueRunner({ repoRoot: repo.root, runsDir: repo.runsDir });
  const step = {
    jobKind: "HANG_TREE",
    command: ["bash", killer],
    env: { TREE_PID_FILE: pidFile },
    memoryMaxBytes: 64 * 1024 * 1024,
    timeoutMs: 400,
    publishes: [],
  };
  const result = await runner.runQueue({ trigger: CHECKSUM_OK_TRIGGER, steps: [step] });
  assert.equal(result.ok, false);
  assert.equal(result.queue.failure.code, "TIMEOUT");
  const grandchild = Number.parseInt(readFileSync(pidFile, "utf8").trim(), 10);
  assert.ok(Number.isInteger(grandchild) && grandchild > 0);
  // SIGKILL es asíncrono: se espera a que el grupo muera.
  let alive = true;
  for (let attempt = 0; attempt < 50 && alive; attempt += 1) {
    try {
      process.kill(grandchild, 0);
      await new Promise((resolve) => setTimeout(resolve, 20));
    } catch {
      alive = false;
    }
  }
  assert.equal(alive, false, `el proceso ${grandchild} del job sobrevivió al timeout`);
});

test("DATA-01 runner: un artefacto que ya existía y no se reescribió no cuenta como publicado", async () => {
  const repo = makeDataFixtureRepo();
  repo.write("out/step-1.json", JSON.stringify({ viejo: true }));
  const runner = createDataQueueRunner({ repoRoot: repo.root, runsDir: repo.runsDir });
  const result = await runner.runQueue({ trigger: CHECKSUM_OK_TRIGGER, steps: stepsFor(repo, ["no-artifact"]) });
  assert.equal(result.ok, false);
  assert.equal(result.queue.failure.code, "STEP_ARTIFACT_STALE");
});

test("DATA-01 runner: la huella del paso ata comando, entorno, techo y disparador", () => {
  const base = { jobKind: "X", command: ["a"], env: { A: "1" }, memoryMaxBytes: 1 };
  const same = stepFingerprint(base, "fp");
  assert.equal(stepFingerprint({ ...base }, "fp"), same);
  assert.notEqual(stepFingerprint({ ...base, command: ["b"] }, "fp"), same);
  assert.notEqual(stepFingerprint({ ...base, memoryMaxBytes: 2 }, "fp"), same);
  assert.notEqual(stepFingerprint(base, "otro"), same);
});
