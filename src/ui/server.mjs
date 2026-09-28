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
//     Con ejecutor, /backtests lleva el botón (Bru aprobó con cambios, P-009
//     2026-09-25); ver ./backtest-job-panel.mjs.
//   - Rutas estables independientes del estado de los datos: /, /health,
//     /replay, /backtests, /research, /campaigns. Las restantes → 404
//     fail-closed.
//
// Los view models de UI-01/UI-03 usan hrefs de ancla (`href="#replay"`,
// drilldowns incluidos) pensados para el documento único. Al servirse por
// HTTP, la capa de serving reescribe esos hrefs a las rutas canónicas para
// que la navegación funcione entre páginas; ni render.mjs ni view-models.mjs
// (el boundary congelado de UI-03) cambian su salida.

import { createHash } from "node:crypto";
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
import { observationFor, TRADES_MISSION_IDS } from "./trades-panels.mjs";
import { VISUAL_LANGUAGE_ID } from "./visual-language.mjs";
import { backtestJobStatusPayload, handleBacktestJobsRequest, isBacktestJobsPath, tradesJobStatusPayload } from "../backtest-jobs/http.mjs";
import { withBacktestJobControl } from "./backtest-job-panel.mjs";
import { unknownBuildIdentity } from "./build-identity.mjs";
import { MISSIONS } from "../backtesting-semantics/contract.mjs";

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
  // SEM2-07 (owner clarification 2026-09-28): primary blocker/error descriptions
  // are English; fail-closed pages are primary product surfaces.
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>${title}</title></head><body data-state="ERROR"><h1>${title}</h1><p>${detail}</p><p data-fail-closed="${stateLabel}">fail-closed: the server only serves canonical UI routes; what is not canonical is not shown, not even as a value.</p></body></html>`;
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
    backtestReadiness: inputs?.backtestReadiness ?? null,
    researchRecords: Array.isArray(inputs?.researchRecords) ? inputs.researchRecords : [],
    campaigns: campaignInput("campaigns"),
    runs: campaignInput("runs"),
    tradesPanels: inputs?.tradesPanels ?? null,
    hypothesisResults: Array.isArray(inputs?.hypothesisResults) ? inputs.hypothesisResults : [],
  };
}

// Monta los view models una sola vez, al arrancar, sobre el estado recibido;
// cada respuesta es un render del mismo estado fail-closed (la UI no recalcula
// otra verdad por request, §26.5).
export function buildUiViewModels(inputs = {}) {
  const pouring = pickInputs(inputs);
  const backtests = buildBacktestsViewModel({ backendIndex: pouring.backendIndex, rows: pouring.backtestsRows, exploratory: pouring.exploratoryBacktest, backtestReadiness: pouring.backtestReadiness, hypothesisResults: pouring.hypothesisResults });
  // TR-07: los paneles TRADES viajan dentro del view model de Backtests; el render los
  // dibuja fail-closed y sin cálculo (trades-panels.mjs).
  backtests.tradesPanels = pouring.tradesPanels;
  // SEM-2: la MISMA proyección canónica viaja a las cuatro superficies. Replay,
  // Research y Campaigns la reciben aquí; Backtests la construye con sus entradas.
  const canonicalSemantics = backtests.canonicalSemantics;
  return {
    [SURFACES.REPLAY]: { ...buildReplayViewModel({ timeline: pouring.timeline, exposure: pouring.exposure, backendIndex: pouring.backendIndex }), exploratory: projectExploratoryPages(pouring.exploratoryBacktest), canonicalSemantics },
    [SURFACES.BACKTESTS]: backtests,
    [SURFACES.RESEARCH]: { ...buildResearchViewModel({ backendIndex: pouring.backendIndex, records: pouring.researchRecords }), exploratory: projectExploratoryPages(pouring.exploratoryBacktest), canonicalSemantics },
    [SURFACES.CAMPAIGNS]: { ...buildCampaignsViewModel({ backendIndex: pouring.backendIndex, campaigns: pouring.campaigns, runs: pouring.runs }), exploratory: projectExploratoryPages(pouring.exploratoryBacktest), canonicalSemantics },
  };
}

// TR-07: el selector (mercado/misión, modo TOB·TRADES, periodo) llega por query
// string. Sólo se aceptan valores conocidos; todo lo demás cae al default fail-closed.
const KNOWN_MISSION_IDS = Object.freeze(new Set(TRADES_MISSION_IDS));
const KNOWN_PERIOD_IDS = Object.freeze(new Set(observationFor("TRADES").zones));

// SEM2-T12: scope de los enlaces cruzados (Campaign → Replay → Backtests →
// Research). Sólo pasan valores acotados; la misión debe ser canónica. Un
// valor inválido NO se descarta en silencio: queda declarado en `invalid` para
// que el destino lo muestre como scope UNAVAILABLE (fail-closed).
const SCOPE_PARAM_PATTERN = /^[A-Za-z0-9._:@/+*-]{1,128}$/;
const CANONICAL_MISSION_IDS = Object.freeze(new Set(MISSIONS.map((mission) => mission.id)));

export function scopeFromSearchParams(searchParams) {
  const params = {};
  const invalid = [];
  for (const name of ["campaign", "run", "mission", "version"]) {
    const value = searchParams?.get?.(name);
    if (typeof value !== "string" || value.trim() === "") continue;
    if (!SCOPE_PARAM_PATTERN.test(value) || (name === "mission" && !CANONICAL_MISSION_IDS.has(value))) {
      invalid.push(name);
      continue;
    }
    params[name] = value;
  }
  return { params, invalid };
}

export function selectionFromSearchParams(searchParams) {
  const selection = {};
  const mode = searchParams?.get?.("mode");
  if (mode === "TOB" || mode === "TRADES") {
    selection.mode = mode;
  }
  const mission = searchParams?.get?.("mission");
  if (KNOWN_MISSION_IDS.has(mission)) {
    selection.missionId = mission;
  }
  const period = searchParams?.get?.("period");
  if (KNOWN_PERIOD_IDS.has(period)) {
    selection.period = period;
  }
  selection.scope = scopeFromSearchParams(searchParams);
  return selection;
}

const NO_BACKEND = Object.freeze({ manifestLoaded: false, recordCount: 0, bindableIdentities: 0, sources: [], gaps: [], errors: [] });

function healthPayload(viewModels, backend, jobRunner, build, publication = null) {
  const surfaces = {};
  for (const surface of SURFACES_LIST) {
    const vm = viewModels[surface];
    surfaces[surface] = {
      state: vm.ok === true ? "READY" : "ERROR",
      canonicalData: vm.ok === true && vm.hasAnyBoundData === true,
      exploratoryData: vm.exploratory != null,
      // SEM2-14: identity of the snapshot actually served by this surface's read.
      snapshotRevision: vm.snapshotRevision ?? null,
    };
  }
  const semantics = viewModels[SURFACES.BACKTESTS]?.canonicalSemantics ?? null;
  return {
    ok: true,
    service: "energy-markets-operator-ui",
    visualLanguage: VISUAL_LANGUAGE_ID,
    // SEM2-10: la identidad del código CARGADO, capturada al arrancar. No se lee el
    // HEAD del checkout por request, así que un checkout que cambia detrás del
    // proceso no cambia lo que el servicio declara servir.
    build: build ?? unknownBuildIdentity(),
    semanticSnapshot: semantics?.ok === true
      ? {
          semanticVersion: semantics.semanticVersion,
          source: semantics.source,
          // SEM2-14: revisión del snapshot publicado, compartida por /health y
          // las cuatro lecturas; cambia sólo con una publicación atómica nueva.
          revision: viewModels[SURFACES.BACKTESTS]?.snapshotRevision ?? null,
          publishedAt: publication?.publishedAt ?? null,
          lastPublicationRejected: publication?.rejected ?? null,
        }
      : { semanticVersion: null, source: { status: "UNAVAILABLE" }, revision: null, publishedAt: null, lastPublicationRejected: null },
    surfaces,
    backend,
    backtestJobs: backtestJobsHealth(jobRunner),
  };
}

// Mismo criterio que jobStatusForPage: si el estado del runner no se puede leer,
// /health responde igual y lo dice (running: null), en vez de tumbar el proceso.
function backtestJobsHealth(jobRunner) {
  if (jobRunner == null) return { configured: false };
  try {
    return { configured: true, statusReadable: true, running: jobRunner.status().running };
  } catch {
    return { configured: true, statusReadable: false, running: null };
  }
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

// Si el estado del job no se puede leer, el control se sirve igual con la línea
// "Backtest status unavailable": la página no cae y no se inventa un estado.
function jobStatusForPage(jobRunner, tradesJobRunner) {
  try {
    return { ...backtestJobStatusPayload(jobRunner), trades: tradesJobStatusPayload(tradesJobRunner) };
  } catch {
    return null;
  }
}

// `backend` describe qué cargó el arrancador (ver ./canonical-inputs.mjs), para que
// /health distinga "sin manifest" de "manifest cargado con 0 valores atestados".
// `jobRunner` (BT-05) es el ejecutor de ../backtest-jobs/runner.mjs; null = sin
// comando de backtest (el endpoint responde 503). `tradesJobRunner` (BT-07) es el de
// ../backtest-jobs/trades-runner.mjs; null = el modo TRADES del botón queda bloqueado.
// `hypothesisJobRunner` (BT-08) es el de ../backtest-jobs/hypothesis-runner.mjs;
// null = la ruta de hipótesis del endpoint queda bloqueada con el motivo.
// SEM2-09/SEM2-14: identidad de revisión del snapshot servido. Deriva del
// contenido publicado, así que dos promociones distintas dan revisiones
// distintas y las cuatro lecturas + /health comparten la misma.
function snapshotRevisionOf(viewModels) {
  try {
    return createHash("sha256").update(JSON.stringify(viewModels)).digest("hex");
  } catch {
    return null;
  }
}

// SEM2-T01: los resultados BT-08 del runner (families + receipts) se convierten
// en entradas de la proyección compartida. Cualquier campo ausente falla
// cerrado dentro de la propia proyección (hypothesisResultView).
export function hypothesisResultsFromRunner(runner) {
  if (runner == null) return [];
  try {
    const status = runner.status();
    return (status?.families ?? []).flatMap((family) => {
      const [hypothesisId, missionId] = String(family?.family ?? "").split("|");
      const job = runner.get?.(family.currentRunId)?.job ?? null;
      return [{
        hypothesisId,
        hypothesisVersion: job?.hypothesisVersion ?? null,
        missionId,
        runId: family.currentRunId,
        status: job?.status ?? "UNKNOWN",
        validComparison: family.tested === true,
        retention: family.retention ?? null,
        resultPath: job?.result?.results?.path ?? null,
        resultSha256: job?.result?.results?.sha256 ?? null,
      }];
    });
  } catch {
    return [];
  }
}

export function createUiServer({ inputs = {}, backend = NO_BACKEND, host = DEFAULT_UI_HOST, port = DEFAULT_UI_PORT, jobRunner = null, tradesJobRunner = null, hypothesisJobRunner = null, build = null, reloadInputs = null } = {}) {
  const startupInputs = inputs;
  // SEM2-09: el snapshot se publica UNA vez al arrancar y se reemplaza ATÓMICAMENTE
  // sólo cuando un job BT-08 válido promueve un resultado. Un artefacto malformado
  // no reemplaza el snapshot bueno: el intento queda declarado en /health y las
  // cuatro lecturas siguen sirviendo la revisión publicada anterior.
  let published = publish(startupInputs);
  let lastPublication = { publishedAt: published.publishedAt, rejected: null, reason: "startup" };

  function publish(nextInputs) {
    const viewModels = buildUiViewModels(nextInputs);
    const revision = snapshotRevisionOf(viewModels);
    for (const vm of Object.values(viewModels)) {
      vm.snapshotRevision = revision;
    }
    return { viewModels, revision, publishedAt: new Date().toISOString() };
  }

  function republish(reason) {
    try {
      const nextInputs = reloadInputs
        ? reloadInputs()
        : { ...startupInputs, hypothesisResults: hypothesisResultsFromRunner(hypothesisJobRunner) };
      const next = publish(nextInputs);
      published = next;
      lastPublication = { publishedAt: next.publishedAt, rejected: null, reason };
      return true;
    } catch (error) {
      lastPublication = { publishedAt: published.publishedAt, rejected: { reason, error: String(error?.message ?? error) } };
      return false;
    }
  }

  // El runner BT-08 notifica la promoción: cuando un run SUCCEEDED con
  // comparación válida se asienta, el snapshot se re-publica sin reinicio.
  // GET nunca inicia ni re-publica trabajo: la publicación la dispara el job.
  function wrapHypothesisRunner(runner) {
    if (runner == null) return null;
    const onSettled = (receipt) => {
      if (receipt?.status === "SUCCEEDED" && receipt?.result?.validComparison === true) {
        republish("BT-08 result promoted");
      }
    };
    return Object.freeze({
      ...runner,
      start: (args) => {
        const started = runner.start(args);
        if (started?.ok && started?.done && typeof started.done.then === "function") {
          started.done.then(onSettled).catch(() => {});
        }
        return started;
      },
      startBatch: async (args) => {
        const result = await runner.startBatch(args);
        if (result?.ok === true && (result.outcomes ?? []).some((outcome) => outcome.ok && outcome.result?.validComparison === true)) {
          republish("BT-08 batch result promoted");
        }
        return result;
      },
    });
  }
  const wrappedHypothesisRunner = wrapHypothesisRunner(hypothesisJobRunner);
  // Identidad de build capturada una sola vez para todo el proceso (SEM2-10).
  const servedBuild = build ?? unknownBuildIdentity();

  const server = createServer((req, res) => {
    const method = req.method ?? "GET";
    let pathname = null;
    let searchParams = null;
    try {
      const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
      pathname = url.pathname;
      searchParams = url.searchParams;
    } catch {
      pathname = null;
    }
    if (isBacktestJobsPath(pathname)) {
      // SEM2-T01: el payload GET comparte la MISMA proyección canónica con los
      // consumidores backend/HTTP/MCP (identidades, versión y estado de resultados).
      const sharedSemantics = published.viewModels[SURFACES.BACKTESTS]?.canonicalSemantics ?? null;
      handleBacktestJobsRequest(req, res, pathname, jobRunner, tradesJobRunner, wrappedHypothesisRunner, sharedSemantics).catch((error) => {
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
      sendResponse(res, { status: 405, contentType: "text/html; charset=utf-8", body: failClosedPage("Energy Markets — method not allowed", "METHOD_NOT_ALLOWED", "This server only serves reads of the UI; no write or command goes through here (§26.5).") });
      return;
    }
    if (route === undefined) {
      sendResponse(res, { status: 404, contentType: "text/html; charset=utf-8", body: failClosedPage("Energy Markets — non-canonical route", "ROUTE_NOT_FOUND", "This is not a canonical route of the Energy Markets UI.") });
      return;
    }
    if (route.kind === "health") {
      sendResponse(res, { status: 200, contentType: "application/json; charset=utf-8", body: JSON.stringify(healthPayload(published.viewModels, backend, jobRunner, servedBuild, lastPublication)) });
      return;
    }
    if (route.kind === "navigation") {
      sendResponse(res, { status: 200, contentType: "text/html; charset=utf-8", body: adaptLinksForServing(renderNavigationPage()) });
      return;
    }
    const vm = published.viewModels[route.surface];
    const selection = selectionFromSearchParams(searchParams);
    let html;
    try {
      html = renderSurfacePage(route.surface, vm, selection);
    } catch (error) {
      sendResponse(res, { status: 500, contentType: "text/html; charset=utf-8", body: failClosedPage("Energy Markets — render error", "RENDER_FAILED", `The surface could not be rendered fail-closed: ${String(error?.message ?? error)}`) });
      return;
    }
    // SEM2-14: cada lectura declara la revisión del snapshot que está sirviendo.
    html = html.replace("<body ", `<body data-snapshot-revision="${published.revision ?? ""}" `);
    if (route.surface === SURFACES.BACKTESTS && jobRunner !== null) {
      const mode = selection.mode === "TRADES" ? "TRADES" : "TOB";
      html = withBacktestJobControl(html, jobStatusForPage(jobRunner, tradesJobRunner), { mode });
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

  return {
    server,
    ready,
    get viewModels() { return published.viewModels; },
    republish: () => republish("manual republish"),
    publication: () => lastPublication,
    revision: () => published.revision,
  };
}
