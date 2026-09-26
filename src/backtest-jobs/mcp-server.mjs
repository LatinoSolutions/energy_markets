// BT-05 (PLAN_STATUS, owner request 25-sep-2026): servidor MCP por stdio para
// que un asistente externo dispare el backtest por la MISMA ruta que el botón de
// la UI. No ejecuta nada: cada tool es un request HTTP a /api/backtest-jobs del
// servicio EM, que es quien aplica el lock de un job a la vez y deja el receipt.
//
// Uso: node src/backtest-jobs/mcp-server.mjs --url http://<host>:<puerto>
//      (o variable EM_UI_URL). Protocolo: JSON-RPC 2.0, un mensaje por línea.

import { createInterface } from "node:readline";
import { pathToFileURL } from "node:url";

import { BACKTEST_JOBS_PATH } from "./http.mjs";

export const MCP_PROTOCOL_VERSION = "2025-06-18";
export const MCP_SERVER_INFO = Object.freeze({ name: "energy-markets-backtests", version: "1.0.0" });

export const MCP_TOOLS = Object.freeze([
  {
    name: "start_backtest",
    description: "Lanza el backtest de Energy Markets en el backend EM (un job a la vez). mode TOB (default): backtest exploratorio. mode TRADES: secuencia TR-06 de las 4 misiones (Development, puente, OOS histórico con una sola apertura); sin el freeze de TR-04 aprobado por Bru no lanza nada y devuelve el motivo. Si ya existe un resultado para el mismo commit, datos, parámetros y versión lo devuelve sin recalcular (reused). Si no, devuelve el run creado o JOB_ALREADY_RUNNING con el job en curso.",
    inputSchema: { type: "object", properties: { mode: { type: "string", enum: ["TOB", "TRADES"], description: "TOB por defecto" } }, additionalProperties: false },
  },
  {
    name: "backtest_status",
    description: "Estado de los backtests de Energy Markets: job en curso, último run y resultado vigente; con runId devuelve el RUN_RECEIPT completo.",
    inputSchema: { type: "object", properties: { runId: { type: "string", description: "BT-RUN-<sha256> opcional" } }, additionalProperties: false },
  },
]);

async function callEndpoint(baseUrl, { method, path, body }) {
  const response = await fetch(new URL(path, baseUrl), {
    method,
    headers: body === undefined ? { Accept: "application/json" } : { "Content-Type": "application/json", Accept: "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload = await response.json();
  return { httpStatus: response.status, payload };
}

async function callTool(baseUrl, name, args) {
  if (name === "start_backtest") {
    // BT-07: mismo endpoint que el botón; sin mode queda el TOB de BT-05.
    const body = args?.mode === undefined ? { requestedBy: "mcp" } : { requestedBy: "mcp", mode: args.mode };
    return callEndpoint(baseUrl, { method: "POST", path: BACKTEST_JOBS_PATH, body });
  }
  if (name === "backtest_status") {
    const runId = typeof args?.runId === "string" && args.runId.length > 0 ? args.runId : null;
    const path = runId === null ? BACKTEST_JOBS_PATH : `${BACKTEST_JOBS_PATH}/${encodeURIComponent(runId)}`;
    return callEndpoint(baseUrl, { method: "GET", path });
  }
  return null;
}

// Responde un mensaje JSON-RPC; null para notificaciones (sin id).
export async function handleMcpMessage(message, { baseUrl }) {
  const { id, method, params } = message ?? {};
  const isNotification = id === undefined || id === null;
  const reply = (result) => ({ jsonrpc: "2.0", id, result });
  const fail = (code, text) => ({ jsonrpc: "2.0", id: id ?? null, error: { code, message: text } });

  if (method === "initialize") {
    return reply({ protocolVersion: params?.protocolVersion ?? MCP_PROTOCOL_VERSION, capabilities: { tools: {} }, serverInfo: MCP_SERVER_INFO });
  }
  if (isNotification) return null;
  if (method === "ping") return reply({});
  if (method === "tools/list") return reply({ tools: MCP_TOOLS });
  if (method === "tools/call") {
    const name = params?.name;
    if (!MCP_TOOLS.some((tool) => tool.name === name)) {
      return fail(-32602, `tool desconocida: ${name}`);
    }
    try {
      const called = await callTool(baseUrl, name, params?.arguments ?? {});
      const isError = called.httpStatus >= 400;
      return reply({ content: [{ type: "text", text: JSON.stringify(called.payload) }], structuredContent: called.payload, isError });
    } catch (error) {
      return reply({ content: [{ type: "text", text: `endpoint EM inalcanzable en ${baseUrl}: ${String(error?.message ?? error)}` }], isError: true });
    }
  }
  return fail(-32601, `método no soportado: ${method}`);
}

function resolveBaseUrl(argv) {
  const index = argv.indexOf("--url");
  const value = index === -1 ? process.env.EM_UI_URL : argv[index + 1];
  if (typeof value !== "string" || value.length === 0) {
    console.error("usage: node src/backtest-jobs/mcp-server.mjs --url http://<host>:<port>  (o EM_UI_URL)");
    process.exit(2);
  }
  return value;
}

export function runStdioServer({ baseUrl, input = process.stdin, output = process.stdout }) {
  const lines = createInterface({ input });
  lines.on("line", async (line) => {
    if (line.trim().length === 0) return;
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      output.write(`${JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "parse error" } })}\n`);
      return;
    }
    const response = await handleMcpMessage(message, { baseUrl });
    if (response !== null) output.write(`${JSON.stringify(response)}\n`);
  });
  return lines;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runStdioServer({ baseUrl: resolveBaseUrl(process.argv.slice(2)) });
}
