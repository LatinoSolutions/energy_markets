// BT-05: la única ruta HTTP que lanza backtests. La usan el botón de la UI de
// Backtests y el servidor MCP (./mcp-server.mjs); ninguno corre el backtest por
// su cuenta (nota BT-05 en PLAN_STATUS: "un solo endpoint backend").
//
//   POST /api/backtest-jobs            body {"requestedBy":"ui"|"mcp", "mode"?:"TOB"|"TRADES"} → 202 lanzado
//                                      | 200 reused (mismo run_id ya tiene resultado) | 409 | 4xx
//                                      Sin mode = TOB (BT-05). mode TRADES = secuencia TR-06 (BT-07).
//   GET  /api/backtest-jobs            → { running, current, latest, currentResult, registry, display, trades }
//   GET  /api/backtest-jobs/<runId>    → RUN_RECEIPT del último intento + vigencia | 404
//                                      (BT-RUN-… = TOB, TR-RUN-… = TRADES)
//
// POST exige Content-Type application/json: un formulario de otro sitio no puede
// mandarlo sin preflight CORS, y este servidor no responde CORS.

import { hypothesisMetadata } from "./hypothesis-runner.mjs";
import { describeHypothesisLaunch, describeHypothesisStatus, describeJobStatus, describeLaunch, describeTradesLaunch, describeTradesStatus, elapsedSeconds } from "./display.mjs";

export const BACKTEST_JOBS_PATH = "/api/backtest-jobs";
const MAX_BODY_BYTES = 65536;

function sendJson(res, status, payload) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  res.end(res.req?.method === "HEAD" ? undefined : JSON.stringify(payload));
}

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        resolve(null);
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", () => resolve(null));
  });
}

// Estado publicado del job: el del runner + `current.elapsedSeconds` y la línea de
// estado `display.line` (decisión de Bru P-009: el backend publica inicio y tiempo
// transcurrido; la UI sólo los muestra). Lo usan GET y el render de /backtests.
export function backtestJobStatusPayload(runner) {
  const now = runner.now();
  const status = runner.status();
  const current = status.current === null ? null : { ...status.current, elapsedSeconds: elapsedSeconds(status.current.startedAt, now) };
  const published = { ...status, current };
  return { ...published, display: { line: describeJobStatus(published, now) } };
}

// BT-07: estado del modo TRADES con su línea. Sin ejecutor TRADES, el motivo.
export function tradesJobStatusPayload(tradesRunner) {
  if (tradesRunner == null) {
    const gate = { ok: false, code: "TRADES_NOT_CONFIGURED", message: "este servidor no tiene ejecutor de runs TRADES" };
    return { configured: false, running: null, gate, display: { line: describeTradesStatus({ running: false, gate }, new Date()) } };
  }
  const now = tradesRunner.now();
  let status;
  try {
    status = tradesRunner.status();
  } catch (error) {
    // Estado ilegible: se dice, no se inventa ni tumba el GET del modo TOB.
    return { configured: true, running: null, statusReadable: false, gate: null, display: { line: "TRADES status unavailable" }, error: String(error?.message ?? error) };
  }
  const current = status.current === null ? null : { ...status.current, elapsedSeconds: elapsedSeconds(status.current.startedAt, now) };
  const published = { configured: true, ...status, current };
  return { ...published, display: { line: describeTradesStatus(published, now) } };
}

// BT-08: estado de los jobs de hipótesis con readiness por misión (inglés,
// backend-produced). Sin ejecutor de hipótesis, el motivo.
export function hypothesisJobStatusPayload(hypothesisRunner) {
  if (hypothesisRunner == null) {
    const gate = { ok: false, code: "HYPOTHESIS_NOT_CONFIGURED", message: "this server has no hypothesis job launcher" };
    return { configured: false, running: null, gate, display: { line: describeHypothesisStatus(null, new Date()) } };
  }
  const now = hypothesisRunner.now();
  let status;
  try {
    status = hypothesisRunner.status();
  } catch (error) {
    return { configured: true, running: null, statusReadable: false, gate: null, display: { line: "Hypothesis status unavailable" }, error: String(error?.message ?? error) };
  }
  const current = status.current === null ? null : { ...status.current, elapsedSeconds: elapsedSeconds(status.current.startedAt, now) };
  const published = { configured: true, ...status, current };
  let readiness = null;
  try {
    readiness = hypothesisRunner.readiness();
  } catch (error) {
    readiness = { readable: false, error: String(error?.message ?? error) };
  }
  return { ...published, hypothesisMetadata: hypothesisMetadata(), readiness, display: { line: describeHypothesisStatus(published, now) } };
}

function httpStatusOf(code) {
  if (code === "JOB_ALREADY_RUNNING") return 409;
  if (code === "HYPOTHESIS_NOT_CONFIGURED" || code === "TRADES_NOT_CONFIGURED") return 503;
  if (["INVALID_REQUESTER", "INVALID_MODE", "INVALID_HYPOTHESIS_REQUEST", "PHASE_NOT_DEVELOPMENT", "INVALID_DATA_MODE"].includes(code)) return 400;
  if (code === "STAGING_FAILED" || code.startsWith("REGISTRY_")) return 500;
  return 422;
}

export function isBacktestJobsPath(pathname) {
  return pathname === BACKTEST_JOBS_PATH || pathname?.startsWith(`${BACKTEST_JOBS_PATH}/`) === true;
}

export async function handleBacktestJobsRequest(req, res, pathname, runner, tradesRunner = null, hypothesisRunner = null) {
  const method = req.method ?? "GET";
  if (method === "POST") {
    const contentType = String(req.headers["content-type"] ?? "").split(";")[0].trim().toLowerCase();
    if (contentType !== "application/json") {
      sendJson(res, 415, { ok: false, code: "JSON_REQUIRED", message: "POST requiere Content-Type: application/json" });
      return;
    }
    const raw = await readBody(req);
    let body;
    try {
      body = raw === null ? null : JSON.parse(raw);
    } catch {
      body = null;
    }
    if (body === null || typeof body !== "object") {
      sendJson(res, 400, { ok: false, code: "INVALID_BODY", message: 'body JSON {"requestedBy":"ui"|"mcp", "mode"?:"TOB"|"TRADES"|"HYPOTHESIS", ...}' });
      return;
    }
    // BT-08: la ruta de hipótesis comparte endpoint y validación, y fail-closed
    // en hipótesis desconocida, hash mismatch, fase/modo inválidos o petición
    // malformada. Sin ejecutor de hipótesis, el motivo y nada se lanza.
    if (body.mode === "HYPOTHESIS") {
      if (hypothesisRunner == null) {
        sendJson(res, 503, { ok: false, code: "HYPOTHESIS_NOT_CONFIGURED", message: "this server has no hypothesis job launcher" });
        return;
      }
      const jobs = body.jobs ?? (body.job !== undefined ? [body.job] : []);
      if (!Array.isArray(jobs) || jobs.length === 0) {
        sendJson(res, 400, { ok: false, code: "INVALID_HYPOTHESIS_REQUEST", message: "the hypothesis request must include job or jobs" });
        return;
      }
      const describe = describeHypothesisLaunch;
      const clock = hypothesisRunner.now();
      const started = jobs.length === 1
        ? hypothesisRunner.start({ requestedBy: body.requestedBy, job: jobs[0] })
        : await hypothesisRunner.startBatch({ requestedBy: body.requestedBy, jobs });
      if (started.ok) {
        const display = { line: describe(started, clock) };
        sendJson(res, started.reused ? 200 : 202, {
          ok: true, mode: "HYPOTHESIS", reused: started.reused === true,
          job: started.job ?? null,
          batch: Array.isArray(started.batch) ? started.batch.map((entry) => ({ ok: entry.ok, reused: entry.reused === true, job: entry.job })) : null,
          display,
        });
        return;
      }
      sendJson(res, httpStatusOf(started.code), { ok: false, mode: "HYPOTHESIS", code: started.code, message: started.message ?? null, detail: started.detail ?? null, job: started.job ?? null, batch: started.batch ?? null, display: { line: describe(started, clock) } });
      return;
    }
    if (runner == null) {
      sendJson(res, 503, { ok: false, code: "JOB_RUNNER_NOT_CONFIGURED", message: "este servidor no tiene ejecutor de backtests" });
      return;
    }
    const mode = body.mode ?? "TOB";
    if (mode !== "TOB" && mode !== "TRADES") {
      sendJson(res, 400, { ok: false, code: "INVALID_MODE", message: 'mode debe ser "TOB" o "TRADES" (o "HYPOTHESIS" para la ruta de hipótesis)' });
      return;
    }
    const trades = mode === "TRADES";
    const describe = trades ? describeTradesLaunch : describeLaunch;
    const started = trades
      ? tradesRunner?.start({ requestedBy: body.requestedBy }) ?? { ok: false, code: "TRADES_NOT_CONFIGURED", message: "este servidor no tiene ejecutor de runs TRADES" }
      : runner.start({ requestedBy: body.requestedBy });
    const clock = trades && tradesRunner != null ? tradesRunner.now() : runner.now();
    if (started.ok) {
      const display = { line: describe(started, clock) };
      sendJson(res, started.reused ? 200 : 202, { ok: true, mode, reused: started.reused, job: started.job, display });
      return;
    }
    sendJson(res, httpStatusOf(started.code), { ok: false, mode, code: started.code, message: started.message ?? null, job: started.job ?? null, display: { line: describe(started, clock) } });
    return;
  }
  if (method !== "GET" && method !== "HEAD") {
    res.setHeader("Allow", pathname === BACKTEST_JOBS_PATH ? "GET, HEAD, POST" : "GET, HEAD");
    sendJson(res, 405, { ok: false, code: "METHOD_NOT_ALLOWED" });
    return;
  }
  if (pathname === BACKTEST_JOBS_PATH) {
    sendJson(res, 200, {
      ok: true,
      ...(runner == null
        ? { configured: false, running: false, current: null, latest: null, currentResult: null, gate: { ok: false, code: "JOB_RUNNER_NOT_CONFIGURED", message: "este servidor no tiene ejecutor de backtests" } }
        : backtestJobStatusPayload(runner)),
      trades: tradesJobStatusPayload(tradesRunner),
      hypothesis: hypothesisJobStatusPayload(hypothesisRunner),
    });
    return;
  }
  const runId = pathname.slice(BACKTEST_JOBS_PATH.length + 1);
  const found = runId.startsWith("TR-RUN-")
    ? tradesRunner?.get(runId) ?? null
    : runId.startsWith("HYP-RUN-")
      ? hypothesisRunner?.get(runId) ?? null
      : runner?.get(runId) ?? null;
  if (found === null) {
    sendJson(res, 404, { ok: false, code: "RUN_NOT_FOUND", runId });
    return;
  }
  sendJson(res, 200, { ok: true, job: found.job, receipt: found.receipt });
}
