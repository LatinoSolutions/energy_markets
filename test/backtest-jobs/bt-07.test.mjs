// Tests BT-07 (PLAN_STATUS fila BT-07, owner goal 2026-09-26 paso 5): en modo
// TRADES el mismo botón de Backtests lanza, como un job por la ruta de BT-05, la
// secuencia de TR-06 para las 4 misiones (Development, puente, OOS histórico) y
// `--assemble` al final. Fail-closed sin el freeze de TR-04 aprobado por Bru; una
// apertura del OOS nunca se repite por un segundo click. Sólo fixtures.

import { test } from "node:test";
import assert from "node:assert/strict";
import { appendFileSync, existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  BACKTEST_JOBS_PATH,
  JOB_STATUS,
  OWNER_FREEZE_APPROVAL_PATH,
  REGISTRY_EVENT,
  STEP_STATUS,
  TRADES_ACCESS_REGISTRY_PATH,
  TRADES_ENTRY,
  TRADES_JOB_KIND,
  TRADES_RECEIPT_KIND,
  claimJobLock,
  createBacktestJobRunner,
  createTradesJobRunner,
  describeTradesStatus,
  evaluateTradesLaunchGate,
  handleMcpMessage,
  readJobLock,
  tradesSequenceSteps,
} from "../../src/backtest-jobs/index.mjs";
import {
  TRADES_ASSEMBLED_PATH,
  TRADES_BRIDGE_DECISIONS_PATH,
  TRADES_FREEZE_MANIFEST_PATH,
  TRADES_FREEZE_PATH,
  TRADES_RUNS_DIR,
} from "../../src/backtest-jobs/trades-runner.mjs";
import { FAILURE_WORDS } from "../../src/backtest-jobs/display.mjs";
import { renderBacktestJobControl } from "../../src/ui/backtest-job-panel.mjs";
import { createUiServer } from "../../src/ui/index.mjs";
import { resolveFrozenConfig } from "../../src/trades-engine/run.mjs";
import {
  BRIDGE_DECISIONS_PATH as TR06_BRIDGE_DECISIONS_PATH,
  RUNS_DIR as TR06_RUNS_DIR,
  freezeResultFromArtifact,
  runArtifactPath,
} from "../../operations/trades/TR-06/build-trades-runs.mjs";
import { MANIFEST_PATH as TR04_MANIFEST_PATH, OUT_PATH as TR04_OUT_PATH, OWNER_APPROVAL_PATH as TR04_OWNER_APPROVAL_PATH } from "../../operations/trades/TR-04/build-trades-freeze.mjs";
import { FREEZE_PATH, freezeFixture, makeTradesFixtureRepo, writeFreeze } from "./trades-fixture-repo.mjs";

const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const DEAD_PID = 2 ** 22 + 12345;

const newRunner = (repo, options = {}) => createTradesJobRunner({ repoRoot: repo.root, scratchDir: repo.scratchDir, ...options });

const tradesRegistry = (runner) => {
  if (!existsSync(runner.registryPath)) return [];
  return readFileSync(runner.registryPath, "utf8").split("\n").filter((line) => line.length > 0).map((line) => JSON.parse(line));
};

const runCalls = (repo) => repo.calls().filter((call) => !call.args.includes("--assemble"));
const oosCalls = (repo) => runCalls(repo).filter((call) => call.args[call.args.indexOf("--phase") + 1] === "OOS");

async function withServer(options, run) {
  const { server, ready } = createUiServer({ port: 0, ...options });
  const served = await ready;
  const base = served.url.slice(0, -1);
  try {
    await run(base);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

// ---------- contrato con TR-06 y TR-04 ----------

test("BT-07: las rutas del runner son las del productor de TR-06 y del freeze de TR-04", () => {
  assert.equal(TRADES_RUNS_DIR, TR06_RUNS_DIR);
  assert.equal(TRADES_BRIDGE_DECISIONS_PATH, TR06_BRIDGE_DECISIONS_PATH);
  const producer = readFileSync(path.join(REPO_ROOT, TRADES_ENTRY), "utf8");
  assert.ok(producer.includes(`const ACCESS_REGISTRY_PATH = "${TRADES_ACCESS_REGISTRY_PATH}";`));
  assert.ok(producer.includes(`const OUT_PATH = "${TRADES_ASSEMBLED_PATH}";`));
  for (const step of tradesSequenceSteps().filter((item) => item.kind === "RUN")) {
    assert.equal(step.artifactPath, runArtifactPath(step.runKey));
  }
  assert.equal(OWNER_FREEZE_APPROVAL_PATH, TR04_OWNER_APPROVAL_PATH);
  assert.equal(TRADES_FREEZE_PATH, TR04_OUT_PATH);
  assert.equal(TRADES_FREEZE_MANIFEST_PATH, TR04_MANIFEST_PATH);
});

test("BT-07: la secuencia son los 20 runs de TR-06 (4 misiones × Development 2 + puente 2 + OOS 1) y el ensamblado al final", () => {
  const steps = tradesSequenceSteps();
  assert.equal(steps.length, 21);
  assert.equal(steps.at(-1).kind, "ASSEMBLE");
  const runs = steps.slice(0, 20);
  assert.deepEqual([...new Set(runs.map((step) => step.missionKey))], ["GAS_QUARTERLY", "GAS_MONTHLY", "POWER_QUARTERLY", "POWER_MONTHLY"]);
  for (const mission of ["GAS_QUARTERLY", "GAS_MONTHLY", "POWER_QUARTERLY", "POWER_MONTHLY"]) {
    const phases = runs.filter((step) => step.missionKey === mission).map((step) => `${step.phase}/${step.observationRule}`);
    assert.deepEqual(phases, ["DEVELOPMENT/LAST_TRADE", "DEVELOPMENT/SLOT_VWAP", "BRIDGE/LAST_TRADE", "BRIDGE/SLOT_VWAP", "OOS/LAST_TRADE"]);
  }
});

test("BT07-FREEZE-SHAPE: TR-06 consume el artefacto de TR-04 tal como está en disco (frozenContract)", () => {
  const { artifact } = freezeFixture({ approved: true });
  assert.equal(artifact.decision, "FROZEN");
  // Sin adaptar, el motor no lo reconoce (defecto que bloqueaba todos los runs).
  assert.equal(resolveFrozenConfig(artifact).code, "TRADES_CONTRACT_NOT_FROZEN");
  const resolved = resolveFrozenConfig(freezeResultFromArtifact(artifact));
  assert.equal(resolved.ok, true, resolved.reason);
  assert.equal(resolved.configHash, artifact.humanGate.configHash);
  // Un freeze en HOLD sigue sin habilitar nada.
  const hold = freezeFixture({ approved: false }).artifact;
  assert.equal(resolveFrozenConfig(freezeResultFromArtifact(hold)).ok, false);
  assert.equal(freezeResultFromArtifact(null), null);
});

// ---------- gate humano de TR-04 (fail-closed) ----------

test("BT-07 gate: sin OWNER_FREEZE_APPROVAL.json el modo TRADES no lanza nada y publica el motivo", () => {
  const repo = makeTradesFixtureRepo({ approved: false });
  const runner = newRunner(repo);
  const started = runner.start({ requestedBy: "ui" });
  assert.equal(started.ok, false);
  assert.equal(started.code, "TRADES_FREEZE_NOT_APPROVED");
  assert.equal(repo.calls().length, 0);
  assert.equal(readdirSync(runner.runsRoot).some((name) => name.startsWith("TR-RUN-")), false);
  assert.notEqual(readJobLock(runner.runsRoot)?.live, true);
  const status = runner.status();
  assert.equal(status.gate.ok, false);
  assert.equal(describeTradesStatus(status, new Date()), `TRADES runs locked · ${FAILURE_WORDS.TRADES_FREEZE_NOT_APPROVED}`);
});

test("BT-07 gate: el repo real hoy (freeze HOLD, sin aprobación de Bru) queda bloqueado", () => {
  const gate = evaluateTradesLaunchGate(REPO_ROOT);
  if (existsSync(path.join(REPO_ROOT, OWNER_FREEZE_APPROVAL_PATH))) return; // cuando Bru apruebe, este caso deja de aplicar
  assert.equal(gate.ok, false);
  assert.equal(gate.code, "TRADES_FREEZE_NOT_APPROVED");
});

test("BT-07 gate: aprobación de otro config, freeze sin reconstruir o manifest desfasado no abren", () => {
  // Aprobación que cubre otro configHash.
  const other = makeTradesFixtureRepo();
  writeFreeze(other, { approved: false, writeApproval: true, approvalConfigHash: "0".repeat(64) });
  assert.equal(evaluateTradesLaunchGate(other.root).code, "TRADES_FREEZE_APPROVAL_INVALID");

  // Bru aprobó (archivo válido) pero el freeze sigue en HOLD: falta reconstruirlo.
  const notRebuilt = makeTradesFixtureRepo();
  writeFreeze(notRebuilt, { approved: false, writeApproval: true });
  assert.equal(evaluateTradesLaunchGate(notRebuilt.root).code, "TRADES_FREEZE_NOT_FROZEN");

  // Freeze FROZEN, pero su manifest no liga los bytes actuales.
  const drifted = makeTradesFixtureRepo();
  appendFileSync(path.join(drifted.root, FREEZE_PATH), "\n");
  assert.equal(evaluateTradesLaunchGate(drifted.root).code, "TRADES_FREEZE_MANIFEST_MISMATCH");

  // Aprobación ilegible.
  const unreadable = makeTradesFixtureRepo();
  writeFileSync(path.join(unreadable.root, OWNER_FREEZE_APPROVAL_PATH), "{no json");
  assert.equal(evaluateTradesLaunchGate(unreadable.root).code, "TRADES_FREEZE_APPROVAL_UNREADABLE");

  for (const code of ["TRADES_FREEZE_APPROVAL_INVALID", "TRADES_FREEZE_NOT_FROZEN", "TRADES_FREEZE_MANIFEST_MISMATCH", "TRADES_FREEZE_APPROVAL_UNREADABLE"]) {
    assert.equal(typeof FAILURE_WORDS[code], "string");
  }
  assert.equal(evaluateTradesLaunchGate(makeTradesFixtureRepo().root).ok, true);
});

test("BT-07: sin las filas de trades o los slots TOB de DATA-01 no arranca", () => {
  const repo = makeTradesFixtureRepo();
  rmSync(path.join(repo.scratchDir, "tr01-power-de.ndjson"));
  const started = newRunner(repo).start({ requestedBy: "ui" });
  assert.equal(started.ok, false);
  assert.equal(started.code, "INPUT_MISSING");
  assert.match(started.message, /tr01-power-de\.ndjson/);
  assert.equal(repo.calls().length, 0);
});

// ---------- la secuencia ----------

test("BT-07: un click corre Development, puente y OOS de las 4 misiones y ensambla; receipt con pico de RAM por run", async () => {
  const repo = makeTradesFixtureRepo();
  const runner = newRunner(repo);
  const started = runner.start({ requestedBy: "ui" });
  assert.equal(started.ok, true, started.message);
  assert.equal(started.job.jobKind, TRADES_JOB_KIND);
  assert.match(started.job.runId, /^TR-RUN-[0-9a-f]{64}$/);
  const receipt = await started.done;

  assert.equal(receipt.status, JOB_STATUS.SUCCEEDED, JSON.stringify(receipt.failure));
  assert.equal(receipt.receiptKind, TRADES_RECEIPT_KIND);
  assert.equal(receipt.code.gitHead, repo.head());
  assert.equal(receipt.gate.approvalRef, "BRU-TRADES-FREEZE-FIXTURE");

  // Un proceso por run, en orden, con el código del commit y cwd = repo.
  const calls = repo.calls();
  assert.equal(calls.length, 21);
  const expected = tradesSequenceSteps();
  calls.forEach((call, index) => {
    assert.equal(call.cwd, repo.root);
    assert.ok(call.entry.startsWith(path.join(runner.runsRoot, receipt.runId, "attempt-1", "workspace")), call.entry);
    if (expected[index].kind === "ASSEMBLE") {
      assert.ok(call.args.includes("--assemble"));
      return;
    }
    assert.equal(call.args[call.args.indexOf("--mission") + 1], expected[index].missionKey);
    assert.equal(call.args[call.args.indexOf("--phase") + 1], expected[index].phase);
    assert.equal(call.args[call.args.indexOf("--rule") + 1], expected[index].observationRule);
    assert.equal(call.args.includes("--bridge-decision-file"), expected[index].phase === "OOS");
    assert.equal(call.args[call.args.indexOf("--power-trades") + 1], path.join(repo.scratchDir, "tr01-power-de.ndjson"));
  });

  // Pico de RAM medido POR RUN (pico propio del proceso hijo).
  for (const step of receipt.steps) {
    assert.equal(step.status, STEP_STATUS.SUCCEEDED);
    assert.ok(Number.isInteger(step.memory.childMaxRssKb) && step.memory.childMaxRssKb > 0, step.runKey);
  }
  const manifest = tradesRegistry(runner).find((event) => event.event === REGISTRY_EVENT.RUN_CLOSED).manifest;
  assert.equal(Object.keys(manifest.memoryPeakByRunKey).length, 21);

  // Una apertura del OOS por misión.
  assert.deepEqual(repo.openings().map((entry) => entry.mission), ["GAS_QUARTERLY", "GAS_MONTHLY", "POWER_QUARTERLY", "POWER_MONTHLY"]);
  for (const mission of Object.values(receipt.oos)) assert.deepEqual(mission, { opened: true, openedByThisJob: true, openings: 1 });

  // Resultado ensamblado ligado por hash; promovido en el registro.
  const assembledBytes = readFileSync(path.join(repo.root, TRADES_ASSEMBLED_PATH));
  assert.equal(receipt.result.assembled.sha256, (await import("node:crypto")).createHash("sha256").update(assembledBytes).digest("hex"));
  assert.equal(receipt.result.assembled.runs, 20);
  assert.equal(typeof receipt.result.runsInputsSha256, "string");
  assert.ok(tradesRegistry(runner).some((event) => event.event === REGISTRY_EVENT.RESULT_PROMOTED && event.runId === receipt.runId));
  assert.notEqual(readJobLock(runner.runsRoot)?.live, true);
  assert.match(describeTradesStatus(runner.status(), new Date()), /^Last TRADES run: finished · .* · 21 done, 0 blocked, 0 skipped · historical OOS opened for 4 of 4 missions$/);
});

test("BT-07: un segundo click con el mismo commit y datos devuelve el resultado sin recalcular ni reabrir el OOS", async () => {
  const repo = makeTradesFixtureRepo();
  const runner = newRunner(repo);
  const first = await runner.start({ requestedBy: "ui" }).done;
  assert.equal(first.status, JOB_STATUS.SUCCEEDED);
  const second = runner.start({ requestedBy: "ui" });
  assert.equal(second.ok, true);
  assert.equal(second.reused, true);
  assert.equal(second.job.runId, first.runId);
  assert.equal(repo.calls().length, 21);
  assert.equal(repo.openings().length, 4);
});

test("BT-07: con otro commit (run_id nuevo) el OOS ya abierto no se vuelve a abrir; Development y puente sí se recorren", async () => {
  const repo = makeTradesFixtureRepo();
  const runner = newRunner(repo);
  const first = await runner.start({ requestedBy: "ui" }).done;
  assert.equal(first.status, JOB_STATUS.SUCCEEDED);
  repo.write("src/fixture-lib.mjs", 'export const FIXTURE_LABEL = "second commit";\n');
  repo.commitAll("otro commit");

  const second = await runner.start({ requestedBy: "ui" }).done;
  assert.notEqual(second.runId, first.runId);
  assert.equal(second.status, JOB_STATUS.SUCCEEDED, JSON.stringify(second.failure));
  const oosSteps = second.steps.filter((step) => step.phase === "OOS");
  assert.equal(oosSteps.length, 4);
  for (const step of oosSteps) {
    assert.equal(step.status, STEP_STATUS.SKIPPED);
    assert.equal(step.reason, "OOS_ALREADY_OPENED");
    assert.equal(step.memory ?? null, null);
  }
  // Ningún proceso OOS nuevo y el registro sigue con una apertura por misión.
  assert.equal(oosCalls(repo).length, 4);
  assert.equal(repo.openings().length, 4);
  assert.equal(runCalls(repo).length, 20 + 16);
  for (const mission of Object.values(second.oos)) assert.equal(mission.openedByThisJob, false);
  assert.match(describeTradesStatus(runner.status(), new Date()), /0 blocked, 4 skipped · historical OOS opened for 4 of 4 missions$/);
});

test("BT-07: sin PASS del puente el OOS queda BLOCKED, no se abre y el job termina", async () => {
  const repo = makeTradesFixtureRepo();
  repo.setConfig({ bridge: "HOLD" });
  const receipt = await newRunner(repo).start({ requestedBy: "ui" }).done;
  assert.equal(receipt.status, JOB_STATUS.SUCCEEDED, JSON.stringify(receipt.failure));
  const oosSteps = receipt.steps.filter((step) => step.phase === "OOS");
  for (const step of oosSteps) {
    assert.equal(step.status, STEP_STATUS.BLOCKED);
    assert.deepEqual(step.artifact.blockedBy, ["OOS_NOT_OPENED_BRIDGE_GATE_NOT_PASS"]);
  }
  for (const step of receipt.steps.filter((item) => item.phase === "BRIDGE")) assert.equal(step.artifact.bridgeGateDecision, "HOLD");
  assert.equal(repo.openings().length, 0);
  for (const mission of Object.values(receipt.oos)) assert.equal(mission.opened, false);
});

test("BT-07: un registro de accesos ilegible no se interpreta como OOS cerrado: el paso OOS no se lanza", async () => {
  const repo = makeTradesFixtureRepo();
  repo.write(TRADES_ACCESS_REGISTRY_PATH, "{roto\n");
  const receipt = await newRunner(repo).start({ requestedBy: "ui" }).done;
  assert.equal(receipt.status, JOB_STATUS.FAILED);
  assert.equal(receipt.failure.code, "OOS_ACCESS_REGISTRY_CORRUPT");
  assert.equal(receipt.failure.step, 5);
  assert.equal(oosCalls(repo).length, 0);
});

test("BT-07: un run que falla corta la secuencia, cierra FAILED en ese paso y libera el lock; reintentar es un intento nuevo", async () => {
  const repo = makeTradesFixtureRepo();
  repo.setConfig({ failAt: "GAS_THE|GAS_MONTHLY|BRIDGE|LAST_TRADE" });
  const runner = newRunner(repo);
  const failed = await runner.start({ requestedBy: "ui" }).done;
  assert.equal(failed.status, JOB_STATUS.FAILED);
  assert.equal(failed.failure.code, "RUN_FAILED");
  assert.equal(failed.failure.step, 8);
  assert.equal(failed.steps[7].status, STEP_STATUS.FAILED);
  assert.ok(failed.steps.slice(8).every((step) => step.status === STEP_STATUS.PENDING));
  assert.equal(repo.calls().length, 8);
  assert.notEqual(readJobLock(runner.runsRoot)?.live, true);
  assert.match(describeTradesStatus(runner.status(), new Date()), /^Last TRADES run: failed at step 8 of 21 · the backtest script exited with an error$/);

  repo.setConfig({});
  const retried = await runner.start({ requestedBy: "ui" }).done;
  assert.equal(retried.runId, failed.runId);
  assert.equal(retried.attempt, 2);
  assert.equal(retried.status, JOB_STATUS.SUCCEEDED, JSON.stringify(retried.failure));
  // GAS_QUARTERLY ya abrió su OOS en el intento 1: el intento 2 no la repite.
  assert.equal(retried.steps[4].status, STEP_STATUS.SKIPPED);
  assert.equal(repo.openings().length, 4);
});

test("BT-07: si las filas de trades o los slots TOB cambian durante la secuencia, cierra FAILED y no se promueve", async () => {
  const repo = makeTradesFixtureRepo();
  repo.setConfig({ touchScratchAt: "GAS_THE|GAS_QUARTERLY|DEVELOPMENT|SLOT_VWAP" });
  const runner = newRunner(repo);
  const receipt = await runner.start({ requestedBy: "ui" }).done;
  assert.equal(receipt.status, JOB_STATUS.FAILED);
  assert.equal(receipt.failure.code, "INPUT_CHANGED_DURING_RUN");
  assert.equal(receipt.failure.step, 3);
  assert.equal(tradesRegistry(runner).some((event) => event.event === REGISTRY_EVENT.RESULT_PROMOTED), false);
});

test("BT-07: código sin commitear no arranca (el commit no lo identificaría)", () => {
  const repo = makeTradesFixtureRepo();
  repo.write("src/fixture-lib.mjs", 'export const FIXTURE_LABEL = "dirty";\n');
  const started = newRunner(repo).start({ requestedBy: "ui" });
  assert.equal(started.code, "CODE_NOT_COMMITTED");
  assert.equal(repo.calls().length, 0);
});

// ---------- uno a la vez con BT-05 ----------

test("BT-07: comparte el lock de BT-05: con un backtest TOB en curso no lanza, y viceversa", async () => {
  const repo = makeTradesFixtureRepo();
  const runner = newRunner(repo);
  // Un job de otro proceso vivo (este mismo pid) tiene el lock.
  claimJobLock(runner.runsRoot, readJobLock(runner.runsRoot)?.generation ?? 0, { runId: "BT-RUN-otro", attempt: 1, pid: process.pid });
  const blocked = runner.start({ requestedBy: "ui" });
  assert.equal(blocked.code, "JOB_ALREADY_RUNNING");
  assert.equal(repo.calls().length, 0);
  assert.equal(runner.status().running, true);

  const free = makeTradesFixtureRepo();
  const tradesRunner = newRunner(free);
  const exploratory = createBacktestJobRunner({ repoRoot: free.root, runsDir: tradesRunner.runsRoot });
  const started = tradesRunner.start({ requestedBy: "ui" });
  assert.equal(started.ok, true);
  const tob = exploratory.start({ requestedBy: "ui" });
  assert.equal(tob.code, "JOB_ALREADY_RUNNING");
  assert.equal(exploratory.status().running, true);
  await started.done;
});

test("BT-07: un receipt TRADES que quedó RUNNING (servicio reiniciado) se cierra INTERRUPTED al arrancar", async () => {
  const repo = makeTradesFixtureRepo();
  const runner = newRunner(repo);
  const receipt = await runner.start({ requestedBy: "ui" }).done;
  const file = path.join(runner.runsRoot, receipt.runId, "attempt-1", "RUN_RECEIPT.json");
  const stale = { ...receipt, status: JOB_STATUS.RUNNING, finishedAt: null, steps: receipt.steps.map((step, index) => (index === 3 ? { ...step, status: STEP_STATUS.RUNNING } : step)) };
  writeFileSync(file, JSON.stringify(stale));
  claimJobLock(runner.runsRoot, readJobLock(runner.runsRoot).generation, { runId: receipt.runId, attempt: 1, pid: DEAD_PID });
  newRunner(repo);
  const closed = JSON.parse(readFileSync(file, "utf8"));
  assert.equal(closed.status, JOB_STATUS.INTERRUPTED);
  assert.equal(closed.steps[3].status, STEP_STATUS.FAILED);
});

// ---------- endpoint, botón y MCP ----------

test("BT-07 endpoint: POST mode TRADES sin freeze aprobado responde el motivo; GET publica la línea TRADES", async () => {
  const repo = makeTradesFixtureRepo({ approved: false });
  const jobRunner = createBacktestJobRunner({ repoRoot: repo.root });
  const tradesJobRunner = newRunner(repo, { runsDir: jobRunner.runsRoot });
  await withServer({ jobRunner, tradesJobRunner }, async (base) => {
    const post = await fetch(`${base}${BACKTEST_JOBS_PATH}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ requestedBy: "ui", mode: "TRADES" }) });
    assert.equal(post.status, 422);
    const body = await post.json();
    assert.equal(body.code, "TRADES_FREEZE_NOT_APPROVED");
    assert.equal(body.display.line, `Not started · ${FAILURE_WORDS.TRADES_FREEZE_NOT_APPROVED}`);
    const invalid = await fetch(`${base}${BACKTEST_JOBS_PATH}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ requestedBy: "ui", mode: "DEPTH" }) });
    assert.equal(invalid.status, 400);
    const status = await (await fetch(`${base}${BACKTEST_JOBS_PATH}`)).json();
    assert.equal(status.trades.gate.ok, false);
    assert.equal(status.trades.display.line, `TRADES runs locked · ${FAILURE_WORDS.TRADES_FREEZE_NOT_APPROVED}`);
    // La línea TOB de BT-05 no cambia.
    assert.equal(status.display.line, "No backtest has been run yet");

    // El mismo botón: en TRADES deshabilitado con el motivo; en TOB habilitado.
    const tradesPage = await (await fetch(`${base}/backtests?mode=TRADES`)).text();
    assert.equal((tradesPage.match(/<button type="button" class="btn" data-job-start/g) ?? []).length, 1);
    assert.match(tradesPage, /data-mode="TRADES"[^>]*data-locked="true"/);
    assert.match(tradesPage, /<button type="button" class="btn" data-job-start disabled>Run backtest<\/button>/);
    assert.ok(tradesPage.includes(`TRADES runs locked · ${FAILURE_WORDS.TRADES_FREEZE_NOT_APPROVED}`));
    const tobPage = await (await fetch(`${base}/backtests`)).text();
    assert.match(tobPage, /data-mode="TOB"/);
    assert.match(tobPage, /<button type="button" class="btn" data-job-start>Run backtest<\/button>/);
  });
  assert.equal(repo.calls().length, 0);
});

test("BT-07 endpoint: con el freeze aprobado POST mode TRADES lanza; GET /<TR-RUN-…> devuelve el receipt", async () => {
  const repo = makeTradesFixtureRepo();
  const jobRunner = createBacktestJobRunner({ repoRoot: repo.root });
  const tradesJobRunner = newRunner(repo, { runsDir: jobRunner.runsRoot });
  await withServer({ jobRunner, tradesJobRunner }, async (base) => {
    const page = await (await fetch(`${base}/backtests?mode=TRADES`)).text();
    assert.match(page, /<button type="button" class="btn" data-job-start>Run backtest<\/button>/);
    assert.ok(page.includes("No TRADES run has been launched yet"));
    const post = await fetch(`${base}${BACKTEST_JOBS_PATH}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ requestedBy: "ui", mode: "TRADES" }) });
    assert.equal(post.status, 202);
    const body = await post.json();
    assert.equal(body.mode, "TRADES");
    assert.match(body.display.line, /^Running TRADES · /);
    // Segundo click mientras corre: no lanza otro.
    const again = await fetch(`${base}${BACKTEST_JOBS_PATH}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ requestedBy: "ui", mode: "TRADES" }) });
    assert.equal(again.status, 409);
    await tradesJobRunner.waitForIdle();
    const receipt = await (await fetch(`${base}${BACKTEST_JOBS_PATH}/${body.job.runId}`)).json();
    assert.equal(receipt.ok, true);
    assert.equal(receipt.receipt.status, JOB_STATUS.SUCCEEDED);
    const reused = await (await fetch(`${base}${BACKTEST_JOBS_PATH}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ requestedBy: "ui", mode: "TRADES" }) })).json();
    assert.equal(reused.reused, true);
    assert.equal(reused.display.line, "Last TRADES run: reused existing result");
  });
  assert.equal(repo.openings().length, 4);
});

test("BT-07 UI: el control es el mismo botón; en TRADES copia la línea del backend y no calcula nada", () => {
  const status = { running: false, display: { line: "No backtest has been run yet" }, trades: { gate: { ok: false, code: "TRADES_FREEZE_NOT_APPROVED" }, display: { line: "TRADES runs locked · x" } } };
  const trades = renderBacktestJobControl(status, { mode: "TRADES" });
  assert.equal((trades.match(/<button/g) ?? []).length, 1);
  assert.ok(trades.includes(">TRADES runs locked · x<"));
  assert.ok(trades.includes('mode: "TRADES"'));
  const running = renderBacktestJobControl({ ...status, running: true, trades: { gate: { ok: true }, display: { line: "Running TRADES · step 3 of 21" } } }, { mode: "TRADES" });
  assert.match(running, /data-job-start disabled/);
  // Sin estado TRADES publicado, fail-closed.
  assert.match(renderBacktestJobControl({ running: false }, { mode: "TRADES" }), /data-job-start disabled/);
  // TOB sigue igual que en BT-05.
  assert.match(renderBacktestJobControl(status), /data-mode="TOB"[\s\S]*data-job-start>Run backtest/);
});

test("BT-07 endpoint: sin ejecutor TRADES configurado el modo TRADES queda bloqueado con motivo", async () => {
  const repo = makeTradesFixtureRepo();
  const jobRunner = createBacktestJobRunner({ repoRoot: repo.root });
  await withServer({ jobRunner }, async (base) => {
    const post = await fetch(`${base}${BACKTEST_JOBS_PATH}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ requestedBy: "ui", mode: "TRADES" }) });
    assert.equal(post.status, 503);
    assert.equal((await post.json()).code, "TRADES_NOT_CONFIGURED");
    const page = await (await fetch(`${base}/backtests?mode=TRADES`)).text();
    assert.match(page, /data-job-start disabled/);
  });
});

test("BT-07 MCP: start_backtest acepta mode TRADES y llama al mismo endpoint", async () => {
  const repo = makeTradesFixtureRepo({ approved: false });
  const jobRunner = createBacktestJobRunner({ repoRoot: repo.root });
  const tradesJobRunner = newRunner(repo, { runsDir: jobRunner.runsRoot });
  await withServer({ jobRunner, tradesJobRunner }, async (base) => {
    const listed = await handleMcpMessage({ jsonrpc: "2.0", id: 1, method: "tools/list" }, { baseUrl: base });
    const tool = listed.result.tools.find((item) => item.name === "start_backtest");
    assert.deepEqual(tool.inputSchema.properties.mode.enum, ["TOB", "TRADES"]);
    const called = await handleMcpMessage({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "start_backtest", arguments: { mode: "TRADES" } } }, { baseUrl: base });
    assert.equal(called.result.isError, true);
    assert.equal(called.result.structuredContent.mode, "TRADES");
    assert.equal(called.result.structuredContent.code, "TRADES_FREEZE_NOT_APPROVED");
  });
});

test("BT-07 display: todo failure.code del runner TRADES tiene su frase en palabras", () => {
  const source = readFileSync(fileURLToPath(new URL("../../src/backtest-jobs/trades-runner.mjs", import.meta.url)), "utf8");
  const codes = new Set([...source.matchAll(/code: "([A-Z_]+)"/g)].map((match) => match[1]));
  assert.ok(codes.size > 20);
  for (const code of codes) assert.ok(typeof FAILURE_WORDS[code] === "string", `falta frase para ${code}`);
});

// ---------- extremo a extremo con el productor real de TR-06 ----------

test("BT-07 e2e: el botón corre el productor REAL de TR-06 con un freeze FROZEN de disco (datos sintéticos diminutos)", async () => {
  const repo = makeTradesFixtureRepo({ realEntry: true });
  const runner = newRunner(repo);
  const receipt = await runner.start({ requestedBy: "ui" }).done;
  assert.equal(receipt.status, JOB_STATUS.SUCCEEDED, JSON.stringify(receipt.failure));
  // Ningún run queda bloqueado por no reconocer el freeze (BT07-FREEZE-SHAPE).
  for (const step of receipt.steps.filter((item) => item.kind === "RUN")) {
    assert.equal((step.artifact.blockedBy ?? []).includes("TRADES_CONTRACT_NOT_FROZEN"), false, step.runKey);
  }
  for (const step of receipt.steps.filter((item) => item.phase === "DEVELOPMENT" || item.phase === "BRIDGE")) {
    assert.equal(step.status, STEP_STATUS.SUCCEEDED, step.runKey);
  }
  // Sin TOB en el fixture el gate del puente no da PASS: el OOS no se abre.
  for (const step of receipt.steps.filter((item) => item.phase === "OOS")) {
    assert.equal(step.status, STEP_STATUS.BLOCKED);
  }
  assert.equal(existsSync(path.join(repo.root, TRADES_ACCESS_REGISTRY_PATH)), false);
  assert.equal(existsSync(path.join(repo.root, TRADES_BRIDGE_DECISIONS_PATH)), true);
  const assembled = JSON.parse(readFileSync(path.join(repo.root, TRADES_ASSEMBLED_PATH), "utf8"));
  assert.equal(assembled.artifactKind, "TR-06_TRADES_RUNS");
  assert.equal(receipt.result.assembled.runs, 16);
  // Todos los runs declaran el mismo manifest de datos (sha256 real de trades/TOB).
  assert.equal(new Set(receipt.steps.filter((step) => step.inputsSha256 != null).map((step) => step.inputsSha256)).size, 1);
});
