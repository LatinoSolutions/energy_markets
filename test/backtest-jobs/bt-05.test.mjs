// Tests BT-05 (PLAN_STATUS, owner request 25-sep-2026): un solo endpoint backend
// lanza el backtest como job (uno a la vez, estado consultable, resultado
// versionado con manifest/receipt); el botón de Backtests sólo llama a ese
// endpoint; MCP usa la misma ruta. Sólo fixtures pequeños: nunca el backtest real.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  BACKTEST_JOBS_PATH,
  JOB_STATUS,
  RECEIPT_KIND,
  createBacktestJobRunner,
  handleMcpMessage,
  verifyExploratoryInputs,
} from "../../src/backtest-jobs/index.mjs";
import { DEFAULT_REPO_ROOT } from "../../src/pit-views/index.mjs";
import { createUiServer } from "../../src/ui/index.mjs";
import { JOB_PANEL_FIELDS, renderBacktestJobPanel } from "../../src/ui/backtest-job-panel.mjs";
import { makeFixtureRepo } from "./fixture-repo.mjs";

const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const MCP_SERVER = fileURLToPath(new URL("../../src/backtest-jobs/mcp-server.mjs", import.meta.url));

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

const postJob = (base, body, headers = { "Content-Type": "application/json" }) =>
  fetch(`${base}${BACKTEST_JOBS_PATH}`, { method: "POST", headers, body: typeof body === "string" ? body : JSON.stringify(body) });

// ---------- job: resultado versionado con manifest/receipt ----------

test("BT-05: un job exitoso deja resultados, MANIFEST y RUN_RECEIPT hash-bound sin tocar el manifest commiteado", async () => {
  const repo = makeFixtureRepo();
  const committedManifest = readFileSync(path.join(repo.root, "operations/exploratory/MANIFEST.json"));
  const runner = createBacktestJobRunner({ repoRoot: repo.root });
  const started = runner.start({ requestedBy: "ui" });
  assert.equal(started.ok, true);
  assert.equal(started.job.status, JOB_STATUS.RUNNING);
  const receipt = await started.done;

  assert.equal(receipt.status, JOB_STATUS.SUCCEEDED, JSON.stringify(receipt.failure));
  assert.equal(receipt.receiptKind, RECEIPT_KIND);
  assert.equal(receipt.requestedBy, "ui");
  assert.match(receipt.runId, /^BT-RUN-\d{8}T\d{6}Z-[0-9a-f]{6}$/);
  assert.equal(receipt.inputs.manifest.sha256, repo.manifestSha256);
  assert.deepEqual(receipt.inputs.files.map((file) => file.path).sort(), [
    "operations/audit/IMP-09/eex-exchange-calendar.json",
    "operations/exploratory/run-exploratory-backtest.mjs",
    "operations/exploratory/tob-slots-the-gas.json",
    "src/exploratory/fixture-lib.mjs",
  ]);

  // el resultado y su manifest existen y coinciden con los hashes del receipt
  const resultsBytes = readFileSync(path.join(repo.root, receipt.result.results.path));
  assert.equal(sha(resultsBytes), receipt.result.results.sha256);
  const runManifestBytes = readFileSync(path.join(repo.root, receipt.result.manifest.path));
  assert.equal(sha(runManifestBytes), receipt.result.manifest.sha256);
  assert.equal(JSON.parse(runManifestBytes).results.sha256, receipt.result.results.sha256);
  assert.equal(receipt.result.status, "EXPLORATORY");
  assert.equal(receipt.result.reproducesCommittedResults, true);
  assert.ok(receipt.result.results.path.startsWith(`operations/backtest-runs/${receipt.runId}/`));

  // el receipt en disco es el mismo que devuelve el job
  assert.deepEqual(JSON.parse(readFileSync(path.join(repo.root, receipt.receiptPath))), receipt);
  // el manifest que la UI lee no se reescribe
  assert.deepEqual(readFileSync(path.join(repo.root, "operations/exploratory/MANIFEST.json")), committedManifest);
  // pico de RSS propio del hijo medido, no inventado
  assert.equal(typeof receipt.memory.childMaxRssKb, "number");
  assert.ok(receipt.memory.childMaxRssKb > 0);
  assert.ok("cgroupMemoryPeakBytesAfter" in receipt.memory);
  // lock liberado
  assert.equal(existsSync(path.join(runner.runsRoot, ".job.lock")), false);
  assert.equal(runner.status().running, false);
  assert.equal(runner.status().latest.runId, receipt.runId);
});

test("BT-05: resultado distinto al commiteado se registra como no reproducido, sin fallar ni reemplazar nada", async () => {
  const repo = makeFixtureRepo({ committedResultsSha256: "0".repeat(64) });
  const runner = createBacktestJobRunner({ repoRoot: repo.root });
  const receipt = await runner.start({ requestedBy: "ui" }).done;
  assert.equal(receipt.status, JOB_STATUS.SUCCEEDED);
  assert.equal(receipt.result.reproducesCommittedResults, false);
  assert.equal(receipt.result.committedResults.sha256, "0".repeat(64));
});

// ---------- uno a la vez ----------

test("BT-05: sólo un job a la vez; el segundo pedido devuelve el job en curso", async () => {
  const repo = makeFixtureRepo({ mode: "slow" });
  const runner = createBacktestJobRunner({ repoRoot: repo.root });
  const first = runner.start({ requestedBy: "ui" });
  assert.equal(first.ok, true);
  const second = runner.start({ requestedBy: "mcp" });
  assert.equal(second.ok, false);
  assert.equal(second.code, "JOB_ALREADY_RUNNING");
  assert.equal(second.job.runId, first.job.runId);
  // otro ejecutor sobre el mismo directorio tampoco puede arrancar (lock en disco)
  const otherRunner = createBacktestJobRunner({ repoRoot: repo.root });
  const third = otherRunner.start({ requestedBy: "ui" });
  assert.equal(third.ok, false);
  assert.equal(third.code, "JOB_ALREADY_RUNNING");
  const receipt = await first.done;
  assert.equal(receipt.status, JOB_STATUS.SUCCEEDED);
  const again = runner.start({ requestedBy: "ui" });
  assert.equal(again.ok, true);
  await again.done;
});

// ---------- fail-closed ----------

test("BT-05: inputs que no coinciden con el manifest commiteado no arrancan el job", () => {
  const repo = makeFixtureRepo();
  repo.write("operations/exploratory/tob-slots-the-gas.json", JSON.stringify({ mode: "ok", points: [9] }));
  const runner = createBacktestJobRunner({ repoRoot: repo.root });
  const started = runner.start({ requestedBy: "ui" });
  assert.equal(started.ok, false);
  assert.equal(started.code, "INPUT_HASH_MISMATCH");
  assert.equal(runner.status().latest, null, "no se crea run");
  assert.equal(existsSync(path.join(runner.runsRoot, ".job.lock")), false);
});

test("BT-05: un generador que falla deja receipt FAILED con su log y libera el lock", async () => {
  const repo = makeFixtureRepo({ mode: "fail" });
  const runner = createBacktestJobRunner({ repoRoot: repo.root });
  const receipt = await runner.start({ requestedBy: "ui" }).done;
  assert.equal(receipt.status, JOB_STATUS.FAILED);
  assert.equal(receipt.failure.code, "RUN_FAILED");
  assert.equal(receipt.exit.code, 3);
  assert.equal(receipt.result, undefined, "sin resultado no hay sha publicado");
  assert.match(readFileSync(path.join(runner.runsRoot, receipt.runId, "job.log"), "utf8"), /fallo forzado/);
  assert.equal(existsSync(path.join(runner.runsRoot, ".job.lock")), false);
});

test("BT-05: timeout mata el job y lo cierra FAILED/TIMEOUT", async () => {
  const repo = makeFixtureRepo({ mode: "hang" });
  const runner = createBacktestJobRunner({ repoRoot: repo.root, timeoutMs: 300 });
  const receipt = await runner.start({ requestedBy: "ui" }).done;
  assert.equal(receipt.status, JOB_STATUS.FAILED);
  assert.equal(receipt.failure.code, "TIMEOUT");
});

test("BT-05: un RUNNING huérfano (servicio reiniciado) se cierra como INTERRUPTED y libera el lock", async () => {
  const repo = makeFixtureRepo();
  const runner = createBacktestJobRunner({ repoRoot: repo.root });
  const receipt = await runner.start({ requestedBy: "ui" }).done;
  // simula un corte a mitad: receipt RUNNING + lock de un pid que ya no existe
  const receiptPath = path.join(repo.root, receipt.receiptPath);
  const { finishedAt, result, exit, memory, ...running } = receipt;
  writeFileSync(receiptPath, JSON.stringify({ ...running, status: JOB_STATUS.RUNNING }));
  writeFileSync(path.join(runner.runsRoot, ".job.lock"), JSON.stringify({ runId: receipt.runId, pid: 2 ** 22 + 12345 }));

  const restarted = createBacktestJobRunner({ repoRoot: repo.root });
  const recovered = restarted.get(receipt.runId);
  assert.equal(recovered.status, JOB_STATUS.INTERRUPTED);
  assert.equal(recovered.failure.code, "INTERRUPTED");
  assert.equal(existsSync(path.join(restarted.runsRoot, ".job.lock")), false);
  const next = restarted.start({ requestedBy: "ui" });
  assert.equal(next.ok, true);
  await next.done;
});

test("BT-05: requestedBy sólo ui o mcp", () => {
  const repo = makeFixtureRepo();
  const runner = createBacktestJobRunner({ repoRoot: repo.root });
  assert.equal(runner.start({ requestedBy: "cron" }).code, "INVALID_REQUESTER");
  assert.equal(runner.start({}).code, "INVALID_REQUESTER");
});

// ---------- preflight del repo real (sin correr el backtest) ----------

test("BT-05: el snapshot exploratorio real del repo verifica por hash contra su MANIFEST (preflight, sin ejecutar)", () => {
  const verified = verifyExploratoryInputs(DEFAULT_REPO_ROOT);
  assert.equal(verified.ok, true, JSON.stringify(verified));
  assert.equal(verified.slotsPath, "operations/exploratory/tob-slots-the-gas.json");
  assert.ok(verified.files.some((file) => file.path === "operations/exploratory/run-exploratory-backtest.mjs"));
});

// ---------- endpoint HTTP ----------

test("BT-05: el endpoint lanza el job, expone estado y receipt, y rechaza lo que no es JSON", async () => {
  const repo = makeFixtureRepo({ mode: "slow" });
  const runner = createBacktestJobRunner({ repoRoot: repo.root });
  await withServer({ jobRunner: runner }, async (base) => {
    const form = await postJob(base, "requestedBy=ui", { "Content-Type": "application/x-www-form-urlencoded" });
    assert.equal(form.status, 415, "un formulario cross-site no lanza jobs");
    const badBody = await postJob(base, "no-json");
    assert.equal(badBody.status, 400);

    const launched = await postJob(base, { requestedBy: "ui" });
    assert.equal(launched.status, 202);
    const { job } = await launched.json();
    assert.equal(job.status, JOB_STATUS.RUNNING);

    const busy = await postJob(base, { requestedBy: "mcp" });
    assert.equal(busy.status, 409);
    assert.equal((await busy.json()).job.runId, job.runId);

    const during = await (await fetch(`${base}${BACKTEST_JOBS_PATH}`)).json();
    assert.equal(during.running, true);
    assert.equal(during.current.runId, job.runId);
    const health = await (await fetch(`${base}/health`)).json();
    assert.deepEqual(health.backtestJobs, { configured: true, running: true });

    await runner.waitForIdle();
    const after = await (await fetch(`${base}${BACKTEST_JOBS_PATH}`)).json();
    assert.equal(after.running, false);
    assert.equal(after.latest.status, JOB_STATUS.SUCCEEDED);

    const detail = await fetch(`${base}${BACKTEST_JOBS_PATH}/${job.runId}`);
    assert.equal(detail.status, 200);
    const detailBody = await detail.json();
    assert.equal(detailBody.receipt.receiptKind, RECEIPT_KIND);
    assert.equal(detailBody.receipt.result.results.sha256.length, 64);

    assert.equal((await fetch(`${base}${BACKTEST_JOBS_PATH}/BT-RUN-nope`)).status, 404);
    assert.equal((await fetch(`${base}${BACKTEST_JOBS_PATH}/../../etc/passwd`)).status, 404);
    assert.equal((await fetch(`${base}${BACKTEST_JOBS_PATH}/${job.runId}`, { method: "DELETE" })).status, 405);
    // el resto de la UI sigue siendo sólo lectura
    assert.equal((await fetch(`${base}/backtests`, { method: "POST" })).status, 405);
  });
});

test("BT-05: sin ejecutor configurado el endpoint responde 503 y /backtests no muestra el botón", async () => {
  await withServer({}, async (base) => {
    assert.equal((await postJob(base, { requestedBy: "ui" })).status, 503);
    const html = await (await fetch(`${base}/backtests`)).text();
    assert.ok(!html.includes("data-backtest-job"));
    const health = await (await fetch(`${base}/health`)).json();
    assert.deepEqual(health.backtestJobs, { configured: false });
  });
});

// ---------- botón de la UI: sólo llama al endpoint, cero cálculo ----------

test("BT-05: /backtests muestra el botón y su script sólo habla con el endpoint del job", async () => {
  const repo = makeFixtureRepo();
  const runner = createBacktestJobRunner({ repoRoot: repo.root });
  await withServer({ jobRunner: runner }, async (base) => {
    const html = await (await fetch(`${base}/backtests`)).text();
    assert.ok(html.includes(`data-endpoint="${BACKTEST_JOBS_PATH}"`));
    assert.ok(html.includes("data-job-start"));
    // cada fetch del documento usa la variable del endpoint declarado; no hay otra red
    const fetchCalls = html.match(/fetch\([^,)]*/g) ?? [];
    assert.equal(fetchCalls.length, 2);
    for (const call of fetchCalls) assert.equal(call, "fetch(endpoint");
    for (const forbidden of ["<form", "action=", "XMLHttpRequest", "<script src=", 'src="http']) {
      assert.ok(!html.includes(forbidden), `sin ${forbidden}`);
    }
    // el panel no se inyecta en otras superficies
    for (const route of ["/replay", "/research", "/campaigns", "/"]) {
      assert.ok(!(await (await fetch(`${base}${route}`)).text()).includes("data-backtest-job"), route);
    }
  });
});

test("BT-05: el panel pinta los campos del backend tal cual, sin derivar valores", () => {
  const job = {
    runId: "BT-RUN-20260925T150000Z-abcdef",
    status: "SUCCEEDED",
    requestedBy: "mcp",
    startedAt: "2026-09-25T15:00:00.000Z",
    finishedAt: "2026-09-25T15:00:04.000Z",
    failure: null,
    result: { status: "EXPLORATORY", results: { sha256: "a".repeat(64) }, reproducesCommittedResults: true },
    memory: { childMaxRssKb: 123456, cgroupMemoryPeakBytesAfter: 987654321 },
    receiptPath: "operations/backtest-runs/BT-RUN-20260925T150000Z-abcdef/RUN_RECEIPT.json",
  };
  const html = renderBacktestJobPanel({ running: false, current: null, latest: job });
  const cell = (field) => html.match(new RegExp(`data-job-field="${field.replaceAll(".", "\\.")}">([^<]*)<`))[1];
  assert.equal(cell("memory.childMaxRssKb"), "123456");
  assert.equal(cell("memory.cgroupMemoryPeakBytesAfter"), "987654321");
  assert.equal(cell("result.results.sha256"), "a".repeat(64));
  assert.equal(cell("result.reproducesCommittedResults"), "true");
  assert.equal(cell("failure.code"), "—");
  assert.equal(JOB_PANEL_FIELDS.length, (html.match(/data-job-field=/g) ?? []).length);
  // sin job todavía: todo "—", nada inventado
  const empty = renderBacktestJobPanel({ running: false, current: null, latest: null });
  for (const [field] of JOB_PANEL_FIELDS) {
    assert.ok(empty.includes(`data-job-field="${field}">—<`), field);
  }
  // mientras corre, el botón queda deshabilitado
  assert.match(renderBacktestJobPanel({ running: true, current: { ...job, status: "RUNNING" }, latest: null }), /data-job-start disabled/);
});

// ---------- MCP: la misma ruta ----------

test("BT-05: las tools MCP lanzan y consultan por el mismo endpoint HTTP", async () => {
  const repo = makeFixtureRepo({ mode: "slow" });
  const runner = createBacktestJobRunner({ repoRoot: repo.root });
  await withServer({ jobRunner: runner }, async (base) => {
    const baseUrl = `${base}/`;
    const init = await handleMcpMessage({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } }, { baseUrl });
    assert.equal(init.result.capabilities.tools !== undefined, true);
    assert.equal(await handleMcpMessage({ jsonrpc: "2.0", method: "notifications/initialized" }, { baseUrl }), null);
    const list = await handleMcpMessage({ jsonrpc: "2.0", id: 2, method: "tools/list" }, { baseUrl });
    assert.deepEqual(list.result.tools.map((tool) => tool.name), ["start_backtest", "backtest_status"]);

    const started = await handleMcpMessage({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "start_backtest", arguments: {} } }, { baseUrl });
    assert.equal(started.result.isError, false);
    const runId = started.result.structuredContent.job.runId;
    assert.equal(started.result.structuredContent.job.requestedBy, "mcp");

    // el lock es el mismo que el del botón: la UI ve el job de MCP y no puede lanzar otro
    assert.equal((await postJob(base, { requestedBy: "ui" })).status, 409);
    const again = await handleMcpMessage({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "start_backtest", arguments: {} } }, { baseUrl });
    assert.equal(again.result.isError, true);
    assert.equal(again.result.structuredContent.code, "JOB_ALREADY_RUNNING");

    await runner.waitForIdle();
    const status = await handleMcpMessage({ jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "backtest_status", arguments: { runId } } }, { baseUrl });
    assert.equal(status.result.structuredContent.receipt.status, JOB_STATUS.SUCCEEDED);
    assert.equal(status.result.structuredContent.receipt.requestedBy, "mcp");

    const unknown = await handleMcpMessage({ jsonrpc: "2.0", id: 6, method: "tools/call", params: { name: "rm_rf", arguments: {} } }, { baseUrl });
    assert.equal(unknown.error.code, -32602);
  });
});

test("BT-05: el servidor MCP por stdio responde tools/list y llama al endpoint", async () => {
  const repo = makeFixtureRepo();
  const runner = createBacktestJobRunner({ repoRoot: repo.root });
  await withServer({ jobRunner: runner }, async (base) => {
    const child = spawn(process.execPath, [MCP_SERVER, "--url", `${base}/`], { stdio: ["pipe", "pipe", "inherit"] });
    const responses = [];
    let buffer = "";
    const waitFor = (count) => new Promise((resolve) => {
      const check = () => (responses.length >= count ? resolve() : setTimeout(check, 20));
      check();
    });
    child.stdout.on("data", (chunk) => {
      buffer += chunk;
      const lines = buffer.split("\n");
      buffer = lines.pop();
      for (const line of lines) if (line.trim()) responses.push(JSON.parse(line));
    });
    const send = (message) => child.stdin.write(`${JSON.stringify(message)}\n`);
    send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } });
    send({ jsonrpc: "2.0", method: "notifications/initialized" });
    send({ jsonrpc: "2.0", id: 2, method: "tools/list" });
    send({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "backtest_status", arguments: {} } });
    await waitFor(3);
    child.kill();
    const byId = new Map(responses.map((response) => [response.id, response]));
    assert.equal(byId.get(1).result.serverInfo.name, "energy-markets-backtests");
    assert.equal(byId.get(2).result.tools.length, 2);
    assert.equal(byId.get(3).result.structuredContent.running, false);
  });
});

