// Tests BT-05 (PLAN_STATUS, owner request 25-sep-2026): un solo endpoint backend
// lanza el backtest como job (uno a la vez, estado consultable, resultado
// versionado con manifest/receipt); el botón de Backtests sólo llama a ese
// endpoint; MCP usa la misma ruta. Sólo fixtures pequeños: nunca el backtest real.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, lstatSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  BACKTEST_JOBS_PATH,
  JOB_STATUS,
  RECEIPT_KIND,
  REGISTRY_EVENT,
  RESULT_STATE,
  claimJobLock,
  computeRunIdentity,
  createBacktestJobRunner,
  handleMcpMessage,
  readJobLock,
  verifyExploratoryInputs,
} from "../../src/backtest-jobs/index.mjs";
import { DEFAULT_REPO_ROOT } from "../../src/pit-views/index.mjs";
import { createUiServer } from "../../src/ui/index.mjs";
import { renderBacktestJobControl, withBacktestJobControl } from "../../src/ui/backtest-job-panel.mjs";
import { FAILURE_WORDS, describeJobStatus, describeLaunch } from "../../src/backtest-jobs/display.mjs";
import { COMMITTED_HELPER_LABEL, FIXTURE_HELPER_PATH, fixtureHelperSource, makeFixtureRepo } from "./fixture-repo.mjs";

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

const readRegistry = (runner) => {
  if (!existsSync(runner.registryPath)) return [];
  return readFileSync(runner.registryPath, "utf8").split("\n").filter((line) => line.length > 0).map((line) => JSON.parse(line));
};

// Ningún lock vivo en disco (el lock liberado se conserva marcado, no se borra).
const lockIsFree = (runner) => readJobLock(runner.runsRoot)?.live !== true;
// pid que no existe: simula un proceso muerto a mitad de job (reinicio, OOM).
const DEAD_PID = 2 ** 22 + 12345;

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
  assert.match(receipt.runId, /^BT-RUN-[0-9a-f]{64}$/);
  assert.equal(receipt.attempt, 1);
  assert.equal(receipt.identity.codeCommit, repo.head());
  assert.equal(receipt.code.gitHead, repo.head());
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
  assert.ok(receipt.result.results.path.startsWith(`operations/backtest-runs/${receipt.runId}/attempt-1/`));

  // el receipt en disco es el mismo que devuelve el job
  assert.deepEqual(JSON.parse(readFileSync(path.join(repo.root, receipt.receiptPath))), receipt);
  // el manifest que la UI lee no se reescribe
  assert.deepEqual(readFileSync(path.join(repo.root, "operations/exploratory/MANIFEST.json")), committedManifest);
  // pico de RSS propio del hijo medido, no inventado
  assert.equal(typeof receipt.memory.childMaxRssKb, "number");
  assert.ok(receipt.memory.childMaxRssKb > 0);
  assert.ok("cgroupMemoryPeakBytesAfter" in receipt.memory);
  // lock liberado
  assert.equal(lockIsFree(runner), true);
  assert.equal(runner.status().running, false);
  assert.equal(runner.status().latest.runId, receipt.runId);
  // el run exitoso queda vigente y su manifest asentado en el registro
  assert.equal(runner.status().currentResult.runId, receipt.runId);
  assert.deepEqual(runner.status().currentResult.retention, { state: RESULT_STATE.CURRENT, supersededBy: null });
  const closedEvent = readRegistry(runner).find((event) => event.event === REGISTRY_EVENT.RUN_CLOSED);
  assert.equal(closedEvent.manifest.resultSha256, receipt.result.results.sha256);
  assert.equal(closedEvent.manifest.identity.codeCommit, repo.head());
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
  // mismos inputs: no hay segundo cálculo, se devuelve el run existente
  const again = runner.start({ requestedBy: "ui" });
  assert.equal(again.ok, true);
  assert.equal(again.reused, true);
  assert.equal(again.job.runId, first.job.runId);
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
  assert.equal(lockIsFree(runner), true);
});

test("BT-05: un generador que falla deja receipt FAILED con su log y libera el lock", async () => {
  const repo = makeFixtureRepo({ mode: "fail" });
  const runner = createBacktestJobRunner({ repoRoot: repo.root });
  const receipt = await runner.start({ requestedBy: "ui" }).done;
  assert.equal(receipt.status, JOB_STATUS.FAILED);
  assert.equal(receipt.failure.code, "RUN_FAILED");
  assert.equal(receipt.exit.code, 3);
  assert.equal(receipt.result, undefined, "sin resultado no hay sha publicado");
  assert.match(readFileSync(path.join(runner.runsRoot, receipt.runId, "attempt-1", "job.log"), "utf8"), /fallo forzado/);
  assert.equal(runner.status().currentResult, null, "un run fallido nunca queda vigente");
  assert.equal(runner.get(receipt.runId).job.retention.state, RESULT_STATE.NONE);
  assert.equal(lockIsFree(runner), true);
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
  claimJobLock(runner.runsRoot, readJobLock(runner.runsRoot).generation, { runId: receipt.runId, attempt: 1, pid: DEAD_PID });

  const restarted = createBacktestJobRunner({ repoRoot: repo.root });
  const recovered = restarted.get(receipt.runId).receipt;
  assert.equal(recovered.status, JOB_STATUS.INTERRUPTED);
  assert.equal(recovered.failure.code, "INTERRUPTED");
  assert.equal(lockIsFree(restarted), true);
  // sin resultado vigente para ese run_id, el mismo run se reintenta como attempt nuevo
  const next = restarted.start({ requestedBy: "ui" });
  assert.equal(next.ok, true);
  assert.equal(next.reused, false);
  const retried = await next.done;
  assert.equal(retried.runId, receipt.runId);
  assert.equal(retried.attempt, 2);
  assert.equal(retried.status, JOB_STATUS.SUCCEEDED);
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
    assert.equal(detailBody.job.retention.state, RESULT_STATE.CURRENT);

    // mismo run_id: 200 reused, sin recalcular
    const reused = await postJob(base, { requestedBy: "mcp" });
    assert.equal(reused.status, 200);
    const reusedBody = await reused.json();
    assert.equal(reusedBody.reused, true);
    assert.equal(reusedBody.job.runId, job.runId);
    assert.equal(reusedBody.job.requestedBy, "ui", "se devuelve el run existente tal cual");

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

// Decisión de Bru P-009 (2026-09-25, aprobar con cambios): frase completa sin
// notación; mientras corre, inicio y tiempo transcurrido publicados por el backend;
// franja superior sin "read-only" ni "no real execution"; panel conectado en server.mjs.

const P009_BANNER = "OPERATOR INTERFACE · runs simulated backtests only · no real trading from this UI · unknown stays <b>UNAVAILABLE</b> / <b>NOT CLOSED</b>, never a value";
const jobLineOf = (html) => html.match(/data-job-line>([^<]*)</)?.[1];

test("BT-05 P-009 punto 1: la línea del último run es una frase completa, sin guiones sueltos ni NONE", () => {
  const job = { runId: `BT-RUN-${"b".repeat(64)}`, status: "SUCCEEDED", startedAt: "2026-09-25T14:58:00.000Z", finishedAt: "2026-09-25T15:00:04.000Z", failure: null, retention: { state: "CURRENT", supersededBy: null } };
  const now = new Date("2026-09-25T16:00:00.000Z");
  const lines = {
    succeeded: describeJobStatus({ running: false, latest: job }, now),
    superseded: describeJobStatus({ running: false, latest: { ...job, retention: { state: "SUPERSEDED", supersededBy: "x" } } }, now),
    failed: describeJobStatus({ running: false, latest: { ...job, status: "FAILED", failure: { code: "OOM_KILLED", message: "m" }, retention: { state: "NONE", supersededBy: null } } }, now),
    interrupted: describeJobStatus({ running: false, latest: { ...job, status: "INTERRUPTED", failure: { code: "INTERRUPTED" }, retention: { state: "NONE", supersededBy: null } } }, now),
    unknownCode: describeJobStatus({ running: false, latest: { ...job, status: "FAILED", failure: { code: "SOME_NEW_CODE" } } }, now),
    reused: describeLaunch({ ok: true, reused: true, job }, now),
    rejected: describeLaunch({ ok: false, code: "INPUT_HASH_MISMATCH" }, now),
    never: describeJobStatus({ running: false, current: null, latest: null }, now),
  };
  assert.equal(lines.succeeded, "Last run: succeeded · 25 Sep 2026 15:00 UTC · current result");
  assert.equal(lines.superseded, "Last run: succeeded · 25 Sep 2026 15:00 UTC · superseded by a newer result");
  assert.equal(lines.failed, "Last run: failed · killed for exceeding the memory limit");
  assert.equal(lines.interrupted, "Last run: interrupted · the process running it stopped before it finished");
  assert.equal(lines.unknownCode, "Last run: failed · some new code");
  assert.equal(lines.reused, "Last run: reused existing result");
  assert.equal(lines.rejected, "Not started · input data does not match its manifest");
  assert.equal(lines.never, "No backtest has been run yet");
  for (const [name, line] of Object.entries(lines)) {
    for (const notation of ["NONE", "—", " - ", "_", "null", "undefined", "T15:", "Z"]) {
      assert.ok(!line.includes(notation), `${name}: sin "${notation}" en "${line}"`);
    }
  }
});

test("BT-05 P-009 punto 1: todo failure.code que emite el runner tiene su frase en palabras", () => {
  const runnerSource = readFileSync(fileURLToPath(new URL("../../src/backtest-jobs/runner.mjs", import.meta.url)), "utf8");
  const codes = new Set([...runnerSource.matchAll(/code: "([A-Z_]+)"/g)].map((match) => match[1]));
  assert.ok(codes.size > 10);
  for (const code of codes) assert.ok(typeof FAILURE_WORDS[code] === "string", `falta frase para ${code}`);
});

test("BT-05 P-009 punto 2: mientras corre, inicio y tiempo transcurrido salen del backend", () => {
  const running = (startedAt) => ({ running: true, current: { runId: "r", status: "RUNNING", startedAt } });
  const started = "2026-09-25T15:00:04.000Z";
  assert.equal(describeJobStatus(running(started), new Date("2026-09-25T15:03:30.000Z")), "Running · started 15:00 UTC · 3 min elapsed");
  assert.equal(describeJobStatus(running(started), new Date("2026-09-25T15:00:50.000Z")), "Running · started 15:00 UTC · less than 1 min elapsed");
  assert.equal(describeJobStatus(running(undefined), new Date(started)), "Running · start time unavailable");
  assert.equal(describeJobStatus({ running: true, current: null }, new Date(started)), "Running · start time unavailable");
});

test("BT-05 P-009: el endpoint publica startedAt, elapsedSeconds y la línea; /backtests sirve el botón con esa misma línea", async () => {
  const repo = makeFixtureRepo({ mode: "slow" });
  let clock = Date.parse("2026-09-25T15:00:04.000Z");
  const runner = createBacktestJobRunner({ repoRoot: repo.root, now: () => new Date(clock) });
  await withServer({ jobRunner: runner }, async (base) => {
    const idlePage = await (await fetch(`${base}/backtests`)).text();
    assert.equal((idlePage.match(/data-backtest-job /g) ?? []).length, 1, "un solo control en /backtests");
    assert.equal(jobLineOf(idlePage), "No backtest has been run yet");
    assert.ok(!/data-job-start disabled/.test(idlePage));

    const launched = await (await postJob(base, { requestedBy: "ui" })).json();
    assert.equal(launched.display.line, "Running · started 15:00 UTC · less than 1 min elapsed");

    clock += 200 * 1000;
    const during = await (await fetch(`${base}${BACKTEST_JOBS_PATH}`)).json();
    assert.equal(during.current.startedAt, "2026-09-25T15:00:04.000Z");
    assert.equal(during.current.elapsedSeconds, 200);
    assert.equal(during.display.line, "Running · started 15:00 UTC · 3 min elapsed");
    const busy = await (await postJob(base, { requestedBy: "mcp" })).json();
    assert.equal(busy.display.line, "Running · started 15:00 UTC · 3 min elapsed");
    const runningPage = await (await fetch(`${base}/backtests`)).text();
    assert.equal(jobLineOf(runningPage), "Running · started 15:00 UTC · 3 min elapsed");
    assert.match(runningPage, /data-job-start disabled/);

    await runner.waitForIdle();
    const after = await (await fetch(`${base}${BACKTEST_JOBS_PATH}`)).json();
    assert.equal(after.display.line, "Last run: succeeded · 25 Sep 2026 15:03 UTC · current result");
    assert.equal(jobLineOf(await (await fetch(`${base}/backtests`)).text()), after.display.line);

    const reused = await postJob(base, { requestedBy: "ui" });
    assert.equal(reused.status, 200);
    assert.equal((await reused.json()).display.line, "Last run: reused existing result");

    // el control sólo va en Backtests
    for (const route of ["/replay", "/research", "/campaigns", "/"]) {
      assert.ok(!(await (await fetch(`${base}${route}`)).text()).includes("data-backtest-job"), route);
    }
  });
});

test("BT-05 P-009: si el estado del job no se puede leer, /backtests sirve el control diciendo que no hay estado", async () => {
  const brokenRunner = { now: () => new Date(), status: () => { throw new Error("disco ilegible"); } };
  await withServer({ jobRunner: brokenRunner }, async (base) => {
    const response = await fetch(`${base}/backtests`);
    assert.equal(response.status, 200);
    assert.equal(jobLineOf(await response.text()), "Backtest status unavailable");
  });
});

test("BT-05 P-009 punto 3: la franja superior ya no dice read-only ni no real execution", async () => {
  const repo = makeFixtureRepo();
  const runner = createBacktestJobRunner({ repoRoot: repo.root });
  await withServer({ jobRunner: runner }, async (base) => {
    for (const route of ["/", "/backtests", "/replay", "/research", "/campaigns"]) {
      const html = await (await fetch(`${base}${route}`)).text();
      const regime = html.match(/<div class="regime">(.*?)<\/div>/)[1];
      assert.equal(regime, P009_BANNER, route);
      assert.ok(!regime.includes("read-only") && !regime.includes("no real execution"), route);
    }
  });
});

test("BT-05 P-009 punto 3 (pie): ninguna página servida con el botón dice read-only", async () => {
  const repo = makeFixtureRepo();
  const runner = createBacktestJobRunner({ repoRoot: repo.root });
  await withServer({ jobRunner: runner }, async (base) => {
    const backtests = await (await fetch(`${base}/backtests`)).text();
    assert.ok(backtests.includes("data-backtest-job"), "el control está servido");
    for (const route of ["/", "/backtests", "/replay", "/research", "/campaigns"]) {
      const html = await (await fetch(`${base}${route}`)).text();
      const foot = html.match(/<div class="foot">(.*?)<\/div>/)[1];
      assert.ok(!foot.includes("read-only"), route);
      assert.ok(!html.includes("read-only"), route);
    }
  });
});

test("BT-05 UI: un solo control (1 botón + 1 línea de estado) que sólo habla con el endpoint y copia la línea del backend", () => {
  const html = renderBacktestJobControl({ running: false, current: null, latest: null, display: { line: "Last run: failed · <b>x</b>" } });
  assert.equal((html.match(/<button/g) ?? []).length, 1, "un solo botón");
  for (const forbidden of ["<table", 'class="card"', "<form", "<input", "<select", "action=", "XMLHttpRequest", "<script src=", 'src="http']) {
    assert.ok(!html.includes(forbidden), `sin ${forbidden}`);
  }
  assert.ok(html.includes(`data-endpoint="${BACKTEST_JOBS_PATH}"`));
  const fetchCalls = html.match(/fetch\([^,)]*/g) ?? [];
  assert.equal(fetchCalls.length, 2);
  for (const call of fetchCalls) assert.equal(call, "fetch(endpoint");
  // la línea es la del backend, escapada, sin derivar nada
  assert.equal(jobLineOf(html), "Last run: failed · &lt;b&gt;x&lt;/b&gt;");
  assert.ok(!/new Date|Date\.now|getTime|Math\./.test(html), "la UI no calcula tiempos");
  assert.equal(jobLineOf(renderBacktestJobControl({ running: false })), "Backtest status unavailable");
  assert.match(renderBacktestJobControl({ running: true, display: { line: "Running · started 15:00 UTC · 3 min elapsed" } }), /data-job-start disabled/);
  // va en la cabecera de la página, no como panel aparte
  const page = '<div class="row"><div class="grow"><h1 class="page">x</h1></div><div class="armhead">arms</div></div><div class="foot">f</div>';
  const placed = withBacktestJobControl(page, { running: false, latest: null });
  assert.ok(placed.indexOf("data-backtest-job") < placed.indexOf('<div class="armhead">'));
  assert.ok(placed.indexOf("data-backtest-job") > placed.indexOf('<div class="row">'));
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


// ---------- identidad y retención (PLAN_STATUS fila BT-05, commit a9f5b82) ----------

test("BT-05 identidad: run_id = sha256 de {commit, manifest de datos, parámetros, versión}; mismos inputs no recalculan", async () => {
  const repo = makeFixtureRepo();
  const runner = createBacktestJobRunner({ repoRoot: repo.root });
  const expected = computeRunIdentity({ codeCommit: repo.head(), verified: verifyExploratoryInputs(repo.root) });
  const first = await runner.start({ requestedBy: "ui" }).done;
  assert.equal(first.runId, expected.runId);
  assert.deepEqual(first.identity, expected.identity);
  assert.deepEqual(Object.keys(first.identity).sort(), ["codeCommit", "dataManifestSha256", "engineVersion", "parameters"]);

  const eventsBefore = readRegistry(runner).length;
  const again = runner.start({ requestedBy: "mcp" });
  assert.equal(again.ok, true);
  assert.equal(again.reused, true);
  assert.equal(again.job.runId, first.runId);
  assert.equal(again.job.attempt, 1, "no se crea otro intento");
  assert.deepEqual(await again.done, first);
  assert.equal(readRegistry(runner).length, eventsBefore, "reusar no escribe en el registro");
  // otro ejecutor (otro proceso del servicio) llega al mismo run_id
  const other = createBacktestJobRunner({ repoRoot: repo.root }).start({ requestedBy: "ui" });
  assert.equal(other.reused, true);
  assert.equal(other.job.runId, first.runId);
});

test("BT-05 retención: un run nuevo supera al anterior, queda un solo vigente y se conservan ambos manifests y artefactos", async () => {
  const repo = makeFixtureRepo();
  const runner = createBacktestJobRunner({ repoRoot: repo.root });
  const older = await runner.start({ requestedBy: "ui" }).done;
  const registryAfterFirst = readFileSync(runner.registryPath, "utf8");

  repo.write("NOTES.md", "otro commit del código\n");
  repo.commitAll("cambio de código");
  const newer = await runner.start({ requestedBy: "mcp" }).done;
  assert.equal(newer.status, JOB_STATUS.SUCCEEDED);
  assert.notEqual(newer.runId, older.runId);
  assert.notEqual(newer.identity.codeCommit, older.identity.codeCommit);
  assert.equal(newer.identity.dataManifestSha256, older.identity.dataManifestSha256);

  const status = runner.status();
  assert.equal(status.currentResult.runId, newer.runId);
  assert.deepEqual(runner.get(older.runId).job.retention, { state: RESULT_STATE.SUPERSEDED, supersededBy: newer.runId });
  assert.deepEqual(runner.get(newer.runId).job.retention, { state: RESULT_STATE.CURRENT, supersededBy: null });

  // registro append-only: lo anterior queda intacto como prefijo
  const registryText = readFileSync(runner.registryPath, "utf8");
  assert.ok(registryText.startsWith(registryAfterFirst));
  const events = readRegistry(runner);
  const closed = events.filter((event) => event.event === REGISTRY_EVENT.RUN_CLOSED);
  assert.deepEqual(closed.map((event) => event.runId), [older.runId, newer.runId]);
  for (const event of closed) {
    for (const key of ["identity", "inputs", "startedAt", "finishedAt", "memoryPeak", "resultSha256", "status"]) {
      assert.ok(key in event.manifest, `${event.runId} manifest.${key}`);
    }
  }
  const promotions = events.filter((event) => event.event === REGISTRY_EVENT.RESULT_PROMOTED);
  assert.deepEqual(promotions.map((event) => [event.runId, event.supersedes]), [[older.runId, null], [newer.runId, older.runId]]);

  // nada se borra sin inventario y GO de Bru: el superado conserva receipt y artefactos pesados
  assert.ok(existsSync(path.join(repo.root, older.receiptPath)));
  assert.ok(existsSync(path.join(repo.root, older.result.results.path)));
  assert.ok(existsSync(path.join(repo.root, older.result.manifest.path)));
});

test("BT-05 retención: pedir de nuevo un run ya superado devuelve su resultado sin recalcular ni cambiar el vigente", async () => {
  const repo = makeFixtureRepo();
  const runner = createBacktestJobRunner({ repoRoot: repo.root });
  const firstCommit = repo.head();
  const older = await runner.start({ requestedBy: "ui" }).done;
  repo.write("NOTES.md", "x\n");
  repo.commitAll("cambio");
  const newer = await runner.start({ requestedBy: "ui" }).done;
  repo.git("checkout", "-q", firstCommit);
  const back = runner.start({ requestedBy: "ui" });
  assert.equal(back.reused, true);
  assert.equal(back.job.runId, older.runId);
  assert.equal(back.job.retention.state, RESULT_STATE.SUPERSEDED);
  assert.equal(runner.status().currentResult.runId, newer.runId);
});

test("BT-05 identidad: código sin commitear o sin git no arranca (el commit no lo identificaría)", () => {
  const repo = makeFixtureRepo();
  repo.write("src/exploratory/extra.mjs", "export const x = 1;\n");
  const runner = createBacktestJobRunner({ repoRoot: repo.root });
  const dirty = runner.start({ requestedBy: "ui" });
  assert.equal(dirty.ok, false);
  assert.equal(dirty.code, "CODE_NOT_COMMITTED");
  assert.match(dirty.message, /src\/exploratory\/extra\.mjs/);
  assert.equal(runner.status().latest, null);

  const noGit = mkdtempSync(path.join(tmpdir(), "bt05-nogit-"));
  const bare = createBacktestJobRunner({ repoRoot: noGit, runsDir: path.join(noGit, "runs") });
  assert.equal(bare.start({ requestedBy: "ui" }).code, "CODE_COMMIT_UNKNOWN");
});

test("BT-05 retención: un registro corrupto no se reescribe y bloquea nuevos runs (fail-closed)", async () => {
  const repo = makeFixtureRepo();
  const runner = createBacktestJobRunner({ repoRoot: repo.root });
  await runner.start({ requestedBy: "ui" }).done;
  writeFileSync(runner.registryPath, `${readFileSync(runner.registryPath, "utf8")}{roto\n`);
  const before = readFileSync(runner.registryPath);
  repo.write("NOTES.md", "x\n");
  repo.commitAll("cambio");
  const refused = runner.start({ requestedBy: "ui" });
  assert.equal(refused.ok, false);
  assert.equal(refused.code, "REGISTRY_CORRUPT");
  assert.deepEqual(readFileSync(runner.registryPath), before);
  assert.equal(runner.status().registry.ok, false);
});

// ---------- estado consultable entre procesos ----------

test("BT-05 estado: otro runner y otro proceso sobre el mismo directorio ven el job en curso", async () => {
  const repo = makeFixtureRepo({ mode: "slow" });
  const runner = createBacktestJobRunner({ repoRoot: repo.root });
  const started = runner.start({ requestedBy: "ui" });
  assert.equal(started.ok, true);

  const sameProcessOther = createBacktestJobRunner({ repoRoot: repo.root });
  const seen = sameProcessOther.status();
  assert.equal(seen.running, true);
  assert.equal(seen.current.runId, started.job.runId);
  assert.equal(seen.current.status, JOB_STATUS.RUNNING);
  const refused = sameProcessOther.start({ requestedBy: "mcp" });
  assert.equal(refused.code, "JOB_ALREADY_RUNNING");
  assert.equal(refused.job.runId, started.job.runId);

  // proceso distinto de verdad
  const runnerUrl = new URL("../../src/backtest-jobs/runner.mjs", import.meta.url).href;
  const script = `import { createBacktestJobRunner } from ${JSON.stringify(runnerUrl)};
const r = createBacktestJobRunner({ repoRoot: ${JSON.stringify(repo.root)} });
const s = r.status();
const t = r.start({ requestedBy: "mcp" });
process.stdout.write(JSON.stringify({ running: s.running, current: s.current?.runId ?? null, start: t.code ?? "STARTED", job: t.job?.runId ?? null }));`;
  const output = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--input-type=module", "-e", script], { stdio: ["ignore", "pipe", "inherit"] });
    let text = "";
    child.stdout.on("data", (chunk) => { text += chunk; });
    child.on("error", reject);
    child.on("exit", () => resolve(JSON.parse(text)));
  });
  assert.deepEqual(output, { running: true, current: started.job.runId, start: "JOB_ALREADY_RUNNING", job: started.job.runId });

  const receipt = await started.done;
  assert.equal(receipt.status, JOB_STATUS.SUCCEEDED);
  assert.equal(sameProcessOther.status().running, false);
  assert.equal(sameProcessOther.status().currentResult.runId, receipt.runId);
});

// ---------- lock obsoleto con arranques concurrentes (hallazgo BT05-LOCK-05) ----------

test("BT-05 lock: dos procesos que vieron el mismo lock obsoleto no pueden tomarlo ambos", () => {
  const runsRoot = mkdtempSync(path.join(tmpdir(), "bt05-lock-"));
  assert.equal(claimJobLock(runsRoot, 0, { runId: "muerto", attempt: 1, pid: DEAD_PID }), 1);
  // ambos leen el lock obsoleto antes de que ninguno actúe
  const seenByA = readJobLock(runsRoot);
  const seenByB = readJobLock(runsRoot);
  assert.equal(seenByA.live, false);
  assert.equal(seenByB.live, false);
  assert.equal(claimJobLock(runsRoot, seenByA.generation, { runId: "A", attempt: 1, pid: process.pid }), 2);
  assert.equal(claimJobLock(runsRoot, seenByB.generation, { runId: "B", attempt: 1, pid: process.pid }), null, "B no retira ni pisa el lock nuevo de A");
  const holder = readJobLock(runsRoot);
  assert.equal(holder.runId, "A");
  assert.equal(holder.live, true);
});

test("BT-05 lock: arranques concurrentes en procesos distintos ante un lock obsoleto dejan exactamente un job", async () => {
  const repo = makeFixtureRepo({ mode: "slow" });
  const runsDir = path.join(repo.root, "operations/backtest-runs");
  createBacktestJobRunner({ repoRoot: repo.root });
  claimJobLock(runsDir, readJobLock(runsDir).generation, { runId: "muerto", attempt: 1, pid: DEAD_PID });
  assert.equal(readJobLock(runsDir).live, false);

  // Cada proceso crea su runner y espera la señal: todos llaman start() a la vez.
  const runnerUrl = new URL("../../src/backtest-jobs/runner.mjs", import.meta.url).href;
  const script = `import { createBacktestJobRunner } from ${JSON.stringify(runnerUrl)};
const r = createBacktestJobRunner({ repoRoot: ${JSON.stringify(repo.root)} });
process.stdout.write("ready\\n");
process.stdin.once("data", async () => {
  const t = r.start({ requestedBy: "mcp" });
  const outcome = t.ok ? (t.reused ? "REUSED" : "STARTED") : t.code;
  if (t.ok) await t.done;
  process.stdout.write(JSON.stringify({ outcome }));
  process.exit(0);
});`;
  const children = Array.from({ length: 4 }, () => spawn(process.execPath, ["--input-type=module", "-e", script], { stdio: ["pipe", "pipe", "inherit"] }));
  const outputs = children.map((child) => new Promise((resolve, reject) => {
    let text = "";
    child.stdout.on("data", (chunk) => { text += chunk; });
    child.on("error", reject);
    child.on("exit", () => resolve(JSON.parse(text.slice(text.indexOf("\n") + 1)).outcome));
  }));
  await Promise.all(children.map((child) => new Promise((resolve) => {
    child.stdout.once("data", resolve);
  })));
  for (const child of children) child.stdin.write("go\n");
  const outcomes = (await Promise.all(outputs)).sort();
  assert.deepEqual(outcomes, ["JOB_ALREADY_RUNNING", "JOB_ALREADY_RUNNING", "JOB_ALREADY_RUNNING", "STARTED"]);
  const latest = createBacktestJobRunner({ repoRoot: repo.root }).status().latest;
  assert.equal(latest.attempt, 1, "un solo intento creado");
});

// ---------- promoción que no llega al registro (hallazgo BT05-REGISTRY-06) ----------

test("BT-05 registro: si falla RESULT_PROMOTED tras el receipt SUCCEEDED, no se reutiliza y el run se recalcula y promueve", async () => {
  const repo = makeFixtureRepo();
  const failPromotion = (file, line) => {
    if (line.includes(`"event":"${REGISTRY_EVENT.RESULT_PROMOTED}"`)) throw new Error("disco lleno (inyectado)");
    appendFileSync(file, line);
  };
  const broken = createBacktestJobRunner({ repoRoot: repo.root, appendRegistryLine: failPromotion });
  const first = await broken.start({ requestedBy: "ui" }).done;
  // el fallo no tumba el proceso: vuelve en settlement y el lock queda libre
  assert.equal(first.status, JOB_STATUS.SUCCEEDED);
  assert.equal(first.settlement.code, "REGISTRY_WRITE_FAILED");
  assert.equal(lockIsFree(broken), true);
  assert.equal(broken.status().currentResult, null, "sin promoción asentada no hay resultado vigente");
  assert.equal(broken.get(first.runId).job.retention.state, RESULT_STATE.NONE);
  const registryBefore = readFileSync(broken.registryPath, "utf8");

  const runner = createBacktestJobRunner({ repoRoot: repo.root });
  const next = runner.start({ requestedBy: "ui" });
  assert.equal(next.ok, true);
  assert.equal(next.reused, false, "un SUCCEEDED sin promoción nunca se devuelve como resultado reutilizado");
  const retried = await next.done;
  assert.equal(retried.runId, first.runId);
  assert.equal(retried.attempt, 2);
  assert.equal(retried.status, JOB_STATUS.SUCCEEDED);
  assert.equal(retried.settlement, undefined);

  // append-only: lo anterior intacto; queda constancia del intento sin promoción y la promoción nueva
  const registryText = readFileSync(runner.registryPath, "utf8");
  assert.ok(registryText.startsWith(registryBefore));
  const events = readRegistry(runner);
  const missing = events.filter((event) => event.event === REGISTRY_EVENT.PROMOTION_MISSING);
  assert.deepEqual(missing.map((event) => [event.runId, event.attempt, event.retriedAs]), [[first.runId, 1, 2]]);
  assert.equal(missing[0].manifest.resultSha256, first.result.results.sha256);
  const promotions = events.filter((event) => event.event === REGISTRY_EVENT.RESULT_PROMOTED);
  assert.deepEqual(promotions.map((event) => [event.runId, event.attempt, event.supersedes]), [[first.runId, 2, null]]);
  assert.deepEqual(runner.status().currentResult.retention, { state: RESULT_STATE.CURRENT, supersededBy: null });
  assert.equal(runner.status().currentResult.attempt, 2);

  // ahora sí hay resultado registrado: se reutiliza sin recalcular
  const again = runner.start({ requestedBy: "mcp" });
  assert.equal(again.reused, true);
  assert.equal(again.job.attempt, 2);
});

test("BT-05 registro: si falla el asiento de PROMOTION_MISSING, start no arranca y libera el lock", async () => {
  const repo = makeFixtureRepo();
  const failPromotion = (file, line) => {
    if (line.includes(`"event":"${REGISTRY_EVENT.RESULT_PROMOTED}"`)) throw new Error("inyectado");
    appendFileSync(file, line);
  };
  await createBacktestJobRunner({ repoRoot: repo.root, appendRegistryLine: failPromotion }).start({ requestedBy: "ui" }).done;
  const failAll = () => {
    throw new Error("registro no escribible (inyectado)");
  };
  const runner = createBacktestJobRunner({ repoRoot: repo.root, appendRegistryLine: failAll });
  const refused = runner.start({ requestedBy: "ui" });
  assert.equal(refused.ok, false);
  assert.equal(refused.code, "REGISTRY_WRITE_FAILED");
  assert.equal(lockIsFree(runner), true);
  assert.equal(runner.status().currentResult, null);
});

// ---------- fallo síncrono al lanzar el hijo (hallazgo BT05-START-07) ----------

test("BT-05 arranque: si lanzar el hijo falla en síncrono, el intento cierra FAILED, libera el lock y se puede reintentar", async () => {
  const repo = makeFixtureRepo();
  const noBinary = createBacktestJobRunner({ repoRoot: repo.root, nodeBinary: "" });
  const refused = noBinary.start({ requestedBy: "ui" });
  assert.equal(refused.ok, false);
  assert.equal(refused.code, "SPAWN_FAILED");
  assert.equal(refused.job.status, JOB_STATUS.FAILED);
  assert.equal(lockIsFree(noBinary), true);
  const firstReceipt = noBinary.get(refused.job.runId).receipt;
  assert.equal(firstReceipt.status, JOB_STATUS.FAILED);
  assert.equal(firstReceipt.failure.code, "SPAWN_FAILED");
  assert.match(firstReceipt.failure.message, /cannot be empty/);
  const closedEvents = readRegistry(noBinary).filter((event) => event.event === REGISTRY_EVENT.RUN_CLOSED);
  assert.deepEqual(closedEvents.map((event) => [event.runId, event.attempt]), [[refused.job.runId, 1]]);

  const runner = createBacktestJobRunner({ repoRoot: repo.root });
  const retried = runner.start({ requestedBy: "ui" });
  assert.equal(retried.ok, true);
  const receipt = await retried.done;
  assert.equal(receipt.runId, refused.job.runId);
  assert.equal(receipt.attempt, 2);
  assert.equal(receipt.status, JOB_STATUS.SUCCEEDED);
  assert.equal(runner.status().currentResult.attempt, 2);
});

// ---------- código ejecutado = commit de la identidad (hallazgo BT05-IDENTITY-08) ----------

test("BT-05 identidad: alterar un módulo transitivo de src/ tras el preflight no entra en el run; corre el código del commit", async () => {
  const repo = makeFixtureRepo({ mode: "slow" });
  const runner = createBacktestJobRunner({ repoRoot: repo.root });
  const started = runner.start({ requestedBy: "ui" });
  assert.equal(started.ok, true);
  // el hijo aún no importó sus módulos: se altera el repo vivo en esa ventana
  repo.write(FIXTURE_HELPER_PATH, fixtureHelperSource("altered-after-preflight"));
  const receipt = await started.done;

  assert.equal(receipt.status, JOB_STATUS.SUCCEEDED, JSON.stringify(receipt.failure));
  assert.equal(receipt.identity.codeCommit, repo.head());
  const results = JSON.parse(readFileSync(path.join(repo.root, receipt.result.results.path)));
  assert.equal(results.fixture.helper, COMMITTED_HELPER_LABEL);
  assert.equal(receipt.result.reproducesCommittedResults, true);
  const workspace = path.join(runner.runsRoot, receipt.runId, "attempt-1", "workspace");
  assert.equal(lstatSync(path.join(workspace, "src")).isSymbolicLink(), false);
  assert.equal(readFileSync(path.join(workspace, FIXTURE_HELPER_PATH), "utf8"), fixtureHelperSource(COMMITTED_HELPER_LABEL));
  assert.equal(receipt.code.source, "git archive del commit");
  assert.match(receipt.code.staged.sha256, /^[0-9a-f]{64}$/);
});

test("BT-05 identidad: si el código del workspace cambia durante el run, cierra FAILED y no se promueve", async () => {
  const repo = makeFixtureRepo({ mode: "slow" });
  const runner = createBacktestJobRunner({ repoRoot: repo.root });
  const started = runner.start({ requestedBy: "ui" });
  assert.equal(started.ok, true);
  const workspace = path.join(runner.runsRoot, started.job.runId, "attempt-1", "workspace");
  writeFileSync(path.join(workspace, FIXTURE_HELPER_PATH), fixtureHelperSource("altered-in-workspace"));
  const receipt = await started.done;

  assert.equal(receipt.status, JOB_STATUS.FAILED);
  assert.equal(receipt.failure.code, "CODE_CHANGED_DURING_RUN");
  assert.equal(readRegistry(runner).some((event) => event.event === REGISTRY_EVENT.RESULT_PROMOTED), false);
  assert.equal(runner.status().currentResult, null);
  assert.equal(lockIsFree(runner), true);
});

// Hallazgo BT05-DOCS-09 (review 25-sep-2026): la nota publicaba una versión del job que no existía.
test("BT-05 docs: la nota no fija un número de versión del job; remite a JOB_VERSION", () => {
  const note = readFileSync(path.join(DEFAULT_REPO_ROOT, "docs/product/BT-05_BACKTEST_JOBS.md"), "utf8");
  const hardcodedJobVersion = /EXPLORATORY_BACKTEST`?\s+v\d+/;
  assert.doesNotMatch(note, hardcodedJobVersion);
  assert.match(note, /JOB_VERSION/);
});

// ---------- datos leídos = datos de la identidad (hallazgo BT05-DATA-BINDING-10) ----------

test("BT-05 identidad: si los slots del workspace cambian antes de que los lea el hijo, cierra FAILED y no se promueve", async () => {
  const repo = makeFixtureRepo({ mode: "slow" });
  const runner = createBacktestJobRunner({ repoRoot: repo.root });
  const started = runner.start({ requestedBy: "ui" });
  assert.equal(started.ok, true);
  // el hijo aún no leyó sus slots: se alteran en el workspace en esa ventana
  const workspace = path.join(runner.runsRoot, started.job.runId, "attempt-1", "workspace");
  writeFileSync(path.join(workspace, "operations/exploratory/tob-slots-the-gas.json"), JSON.stringify({ mode: "ok", points: [9] }));
  const receipt = await started.done;

  assert.equal(receipt.status, JOB_STATUS.FAILED);
  assert.equal(receipt.failure.code, "SLOTS_CHANGED_DURING_RUN");
  assert.equal(readRegistry(runner).some((event) => event.event === REGISTRY_EVENT.RESULT_PROMOTED), false);
  assert.equal(runner.status().currentResult, null);
  assert.equal(lockIsFree(runner), true);
});

test("BT-05 identidad: si un dato copiado que el generador no declara (calendario) cambia durante el run, cierra FAILED y no se promueve", async () => {
  const repo = makeFixtureRepo({ mode: "slow" });
  const runner = createBacktestJobRunner({ repoRoot: repo.root });
  const started = runner.start({ requestedBy: "ui" });
  assert.equal(started.ok, true);
  const workspace = path.join(runner.runsRoot, started.job.runId, "attempt-1", "workspace");
  writeFileSync(path.join(workspace, "operations/audit/IMP-09/eex-exchange-calendar.json"), JSON.stringify({ exchangeDays: [] }));
  const receipt = await started.done;

  assert.equal(receipt.status, JOB_STATUS.FAILED);
  assert.equal(receipt.failure.code, "INPUT_CHANGED_DURING_RUN");
  assert.equal(readRegistry(runner).some((event) => event.event === REGISTRY_EVENT.RESULT_PROMOTED), false);
  assert.equal(runner.status().currentResult, null);
  assert.equal(lockIsFree(runner), true);
});
