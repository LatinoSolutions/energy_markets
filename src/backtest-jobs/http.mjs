// BT-05: la única ruta HTTP que lanza backtests. La usan el botón de la UI de
// Backtests y el servidor MCP (./mcp-server.mjs); ninguno corre el backtest por
// su cuenta (nota BT-05 en PLAN_STATUS: "un solo endpoint backend").
//
//   POST /api/backtest-jobs            body {"requestedBy":"ui"|"mcp"} → 202 lanzado
//                                      | 200 reused (mismo run_id ya tiene resultado) | 409 | 4xx
//   GET  /api/backtest-jobs            → { running, current, latest, currentResult, registry }
//   GET  /api/backtest-jobs/<runId>    → RUN_RECEIPT del último intento + vigencia | 404
//
// POST exige Content-Type application/json: un formulario de otro sitio no puede
// mandarlo sin preflight CORS, y este servidor no responde CORS.

export const BACKTEST_JOBS_PATH = "/api/backtest-jobs";
const MAX_BODY_BYTES = 4096;

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

export function isBacktestJobsPath(pathname) {
  return pathname === BACKTEST_JOBS_PATH || pathname?.startsWith(`${BACKTEST_JOBS_PATH}/`) === true;
}

export async function handleBacktestJobsRequest(req, res, pathname, runner) {
  if (runner == null) {
    sendJson(res, 503, { ok: false, code: "JOB_RUNNER_NOT_CONFIGURED", message: "este servidor no tiene ejecutor de backtests" });
    return;
  }
  const method = req.method ?? "GET";
  if (pathname === BACKTEST_JOBS_PATH && method === "POST") {
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
      sendJson(res, 400, { ok: false, code: "INVALID_BODY", message: 'body JSON {"requestedBy":"ui"|"mcp"}' });
      return;
    }
    const started = runner.start({ requestedBy: body.requestedBy });
    if (started.ok) {
      sendJson(res, started.reused ? 200 : 202, { ok: true, reused: started.reused, job: started.job });
      return;
    }
    const status = started.code === "JOB_ALREADY_RUNNING" ? 409 : started.code === "INVALID_REQUESTER" ? 400 : started.code === "STAGING_FAILED" || started.code.startsWith("REGISTRY_") ? 500 : 422;
    sendJson(res, status, { ok: false, code: started.code, message: started.message ?? null, job: started.job ?? null });
    return;
  }
  if (method !== "GET" && method !== "HEAD") {
    res.setHeader("Allow", pathname === BACKTEST_JOBS_PATH ? "GET, HEAD, POST" : "GET, HEAD");
    sendJson(res, 405, { ok: false, code: "METHOD_NOT_ALLOWED" });
    return;
  }
  if (pathname === BACKTEST_JOBS_PATH) {
    sendJson(res, 200, { ok: true, ...runner.status() });
    return;
  }
  const runId = pathname.slice(BACKTEST_JOBS_PATH.length + 1);
  const found = runner.get(runId);
  if (found === null) {
    sendJson(res, 404, { ok: false, code: "RUN_NOT_FOUND", runId });
    return;
  }
  sendJson(res, 200, { ok: true, job: found.job, receipt: found.receipt });
}
