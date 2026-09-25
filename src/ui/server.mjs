// Servidor HTTP de la UI de Energy Markets sobre el Operator Interface
// Boundary aceptado (SPEC v1.1.1 §26.5). Tarea UI-02 (PLAN_STATUS, owner
// 24-sep-2026): servir la implementación aceptada de UI-03 desde rutas
// estables con health check.
//
// Contrato de este módulo (sirviendo, no calculando — §26.5):
//   - El servidor no calcula ni fabrica datos: sólo monta los view models
//     fail-closed de ./view-models.mjs con el estado que el proceso que
//     arranca el servidor le inyecta (ver ./serve.mjs); sin manifest
//     backend verificado todas las superficies quedan UNAVAILABLE/ERROR
//     explícitos, jamás como valores.
//   - Enlace por defecto 127.0.0.1: no se abre exposición pública nueva
//     (acceptance UI-02); un host diferente es una decisión explícita del
//     arrancador, nunca el default.
//   - Sólo GET/HEAD de lectura en las rutas de la UI. La única escritura es el
//     comando autorizado BT-05 (owner request 25-sep-2026) bajo /api/backtest-jobs,
//     que lanza el backtest en el backend y deja su receipt (§26.5); ver
//     ../backtest-jobs/http.mjs. Sin ejecutor configurado responde 503.
//   - Rutas estables independientes del estado de los datos: /, /health,
//     /replay, /backtests, /research, /campaigns. Las restantes → 404
//     fail-closed.
//
// Los view models de UI-01/UI-03 usan hrefs de ancla (`href="#replay"`,
// drilldowns incluidos) pensados para el documento único. Al servirse por
// HTTP, la capa de serving reescribe esos hrefs a las rutas canónicas para
// que la navegación funcione entre páginas; ni render.mjs ni view-models.mjs
// (el boundary congelado de UI-03) cambian su salida.

import { createServer } from "node:http";
import {
  buildBacktestsViewModel,
  buildCampaignsViewModel,
  projectExploratoryPages,
  buildReplayViewModel,
  buildResearchViewModel,
  SURFACES,
  SURFACES_LIST,
} from "./view-models.mjs";
import { renderNavigationPage, renderSurfacePage } from "./render.mjs";
import { VISUAL_LANGUAGE_ID } from "./visual-language.mjs";
import { handleBacktestJobsRequest, isBacktestJobsPath } from "../backtest-jobs/http.mjs";
import { withBacktestJobPanel } from "./backtest-job-panel.mjs";

export const DEFAULT_UI_HOST = "127.0.0.1";
export const DEFAULT_UI_PORT = 8787;

export const UI_ROUTES = Object.freeze({
  "/": { kind: "navigation" },
  "/health": { kind: "health" },
  "/replay": { kind: "surface", surface: SURFACES.REPLAY },
  "/backtests": { kind: "surface", surface: SURFACES.BACKTESTS },
  "/research": { kind: "surface", surface: SURFACES.RESEARCH },
  "/campaigns": { kind: "surface", surface: SURFACES.CAMPAIGNS },
});

// Handoff de navegación declarado por los view models, materializado como
// rutas del servidor (sólo URLs del propio servicio; nada externo, §26.5).
const ANCHOR_TO_ROUTE = Object.freeze({
  "#replay": "/replay",
  "#backtests": "/backtests",
  "#research": "/research",
  "#campaigns": "/campaigns",
});

function adaptLinksForServing(html) {
  for (const [anchor, route] of Object.entries(ANCHOR_TO_ROUTE)) {
    html = html.replaceAll(`href="${anchor}"`, `href="${route}"`);
  }
  return html;
}

function failClosedPage(title, stateLabel, detail) {
  return `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8"><title>${title}</title></head><body data-state="ERROR"><h1>${title}</h1><p>${detail}</p><p data-fail-closed="${stateLabel}">fail-closed: el servidor sólo sirve rutas canónicas de la UI; lo no canónico no se muestra ni como valor.</p></body></html>`;
}

function pickInputs(inputs) {
  const campaignInput = (key) => {
    const candidate = inputs?.[key];
    return Array.isArray(candidate) ? candidate : [];
  };
  return {
    timeline: inputs?.timeline ?? null,
    exposure: inputs?.exposure ?? null,
    backendIndex: inputs?.backendIndex ?? null,
    backtestsRows: Array.isArray(inputs?.backtestsRows) ? inputs.backtestsRows : [],
    exploratoryBacktest: inputs?.exploratoryBacktest ?? null,
    researchRecords: Array.isArray(inputs?.researchRecords) ? inputs.researchRecords : [],
    campaigns: campaignInput("campaigns"),
    runs: campaignInput("runs"),
  };
}

// Monta los view models una sola vez, al arrancar, sobre el estado recibido;
// cada respuesta es un render del mismo estado fail-closed (la UI no recalcula
// otra verdad por request, §26.5).
export function buildUiViewModels(inputs = {}) {
  const pouring = pickInputs(inputs);
  return {
    [SURFACES.REPLAY]: { ...buildReplayViewModel({ timeline: pouring.timeline, exposure: pouring.exposure, backendIndex: pouring.backendIndex }), exploratory: projectExploratoryPages(pouring.exploratoryBacktest) },
    [SURFACES.BACKTESTS]: buildBacktestsViewModel({ backendIndex: pouring.backendIndex, rows: pouring.backtestsRows, exploratory: pouring.exploratoryBacktest }),
    [SURFACES.RESEARCH]: { ...buildResearchViewModel({ backendIndex: pouring.backendIndex, records: pouring.researchRecords }), exploratory: projectExploratoryPages(pouring.exploratoryBacktest) },
    [SURFACES.CAMPAIGNS]: { ...buildCampaignsViewModel({ backendIndex: pouring.backendIndex, campaigns: pouring.campaigns, runs: pouring.runs }), exploratory: projectExploratoryPages(pouring.exploratoryBacktest) },
  };
}

const NO_BACKEND = Object.freeze({ manifestLoaded: false, recordCount: 0, bindableIdentities: 0, sources: [], gaps: [], errors: [] });

function healthPayload(viewModels, backend, jobRunner) {
  const surfaces = {};
  for (const surface of SURFACES_LIST) {
    const vm = viewModels[surface];
    surfaces[surface] = {
      state: vm.ok === true ? "READY" : "ERROR",
      canonicalData: vm.ok === true && vm.hasAnyBoundData === true,
      exploratoryData: vm.exploratory != null,
    };
  }
  return {
    ok: true,
    service: "energy-markets-operator-ui",
    visualLanguage: VISUAL_LANGUAGE_ID,
    surfaces,
    backend,
    backtestJobs: jobRunner == null ? { configured: false } : { configured: true, running: jobRunner.status().running },
  };
}

function sendResponse(res, { status, contentType, body }) {
  res.writeHead(status, {
    "Content-Type": contentType,
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  if (res.req?.method === "HEAD") {
    res.end();
    return;
  }
  res.end(body);
}

// `backend` describe qué cargó el arrancador (ver ./canonical-inputs.mjs), para que
// /health distinga "sin manifest" de "manifest cargado con 0 valores atestados".
// `jobRunner` (BT-05) es el ejecutor de ../backtest-jobs/runner.mjs; null = sin
// comando de backtest (el panel no se muestra y el endpoint responde 503).
export function createUiServer({ inputs = {}, backend = NO_BACKEND, host = DEFAULT_UI_HOST, port = DEFAULT_UI_PORT, jobRunner = null } = {}) {
  const viewModels = buildUiViewModels(inputs);

  const server = createServer((req, res) => {
    const method = req.method ?? "GET";
    let pathname = null;
    try {
      pathname = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`).pathname;
    } catch {
      pathname = null;
    }
    if (isBacktestJobsPath(pathname)) {
      handleBacktestJobsRequest(req, res, pathname, jobRunner).catch((error) => {
        if (!res.headersSent) {
          res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
        }
        res.end(JSON.stringify({ ok: false, code: "JOB_ENDPOINT_ERROR", message: String(error?.message ?? error) }));
      });
      return;
    }
    const route = pathname === null ? undefined : UI_ROUTES[pathname];
    // Sólo lectura: la UI no registra comandos ni escrituras (§26.5).
    if (method !== "GET" && method !== "HEAD") {
      res.setHeader("Allow", "GET, HEAD");
      sendResponse(res, { status: 405, contentType: "text/html; charset=utf-8", body: failClosedPage("Energy Markets — método no admitido", "METHOD_NOT_ALLOWED", "Este servidor sólo sirve lectura de la UI; ninguna escritura o comando pasa por aquí (§26.5).") });
      return;
    }
    if (route === undefined) {
      sendResponse(res, { status: 404, contentType: "text/html; charset=utf-8", body: failClosedPage("Energy Markets — ruta no canónica", "ROUTE_NOT_FOUND", "Esta no es una ruta canónica de la UI de Energy Markets.") });
      return;
    }
    if (route.kind === "health") {
      sendResponse(res, { status: 200, contentType: "application/json; charset=utf-8", body: JSON.stringify(healthPayload(viewModels, backend, jobRunner)) });
      return;
    }
    if (route.kind === "navigation") {
      sendResponse(res, { status: 200, contentType: "text/html; charset=utf-8", body: adaptLinksForServing(renderNavigationPage()) });
      return;
    }
    const vm = viewModels[route.surface];
    let html;
    try {
      html = renderSurfacePage(route.surface, vm);
    } catch (error) {
      sendResponse(res, { status: 500, contentType: "text/html; charset=utf-8", body: failClosedPage("Energy Markets — error de render", "RENDER_FAILED", `La superficie no pudo renderizarse fail-closed: ${String(error?.message ?? error)}`) });
      return;
    }
    if (route.surface === SURFACES.BACKTESTS && jobRunner != null) {
      html = withBacktestJobPanel(html, jobRunner.status());
    }
    sendResponse(res, { status: 200, contentType: "text/html; charset=utf-8", body: adaptLinksForServing(html) });
  });

  const ready = new Promise((resolve, reject) => {
    server.once("listening", () => {
      const address = server.address();
      const servedHost = address.address === "::" ? host : address.address;
      const servedPort = typeof address === "object" ? address.port : port;
      resolve({ host: servedHost, port: servedPort, url: `http://${servedHost}:${servedPort}/` });
    });
    server.once("error", reject);
  });
  server.listen(port, host);

  return { server, ready, viewModels };
}
