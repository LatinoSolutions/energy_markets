// BT-05 (PLAN_STATUS, owner request 25-sep-2026): control del job de backtest en
// la pantalla de Backtests. "No quiero mil botones, que no quede sopa": un solo
// control (1 botón + el estado del job en la misma zona), dentro del diseño de
// UI-03, sin paneles ni formularios extra. El botón sólo llama a
// POST /api/backtest-jobs y la línea de estado copia `display.line`, que arma el
// backend (../backtest-jobs/display.mjs): cero cálculo en la UI (SPEC v1.1.1 §26.5).
// Aprobado con cambios por Bru, P-009 (2026-09-25); server.mjs lo sirve en /backtests.

import { BACKTEST_JOBS_PATH } from "../backtest-jobs/http.mjs";
import { H_S1_01, MISSION_LABELS } from "../backtesting-semantics/contract.mjs";
import { blockerUserMessage, CANONICAL_LABELS } from "../backtesting-semantics/projection.mjs";

function esc(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

// UI-10 (PLAN_UI §1 "English blocker chip with a count; paths go into a 'Show
// source paths' detail", §4.B.11): a short blocked line with the count per
// blocker title; the backend userMessage, path and technical message of each
// blocker appear only inside the collapsed detail. `attribute` names the data
// attribute of each detail line (Scope card or the Development control).
export function blockerBriefHtml(blockers, attribute) {
  const counts = new Map();
  for (const blocker of blockers) {
    const title = CANONICAL_LABELS.blockers[blocker.code] ?? CANONICAL_LABELS.blockers.DEFAULT;
    counts.set(title, (counts.get(title) ?? 0) + 1);
  }
  const chips = [...counts.entries()].map(([title, count]) => `<span class="st fail"><span class="g">×</span>${esc(title)} · ${count}</span>`).join(" ");
  const plural = blockers.length === 1 ? "" : "s";
  const lines = blockers.map((blocker) => `<div class="small muted" ${attribute}="${esc(blocker.code)}">${esc(blocker.userMessage ?? blockerUserMessage(blocker))}${blocker.path ? `<div class="mono">${esc(blocker.path)}</div>` : ""}<div>${esc(blocker.message ?? "")}</div></div>`).join("");
  return `<div class="row wrap" style="gap:6px">${chips}</div><details class="blockers"><summary>Show ${blockers.length} blocker detail${plural} and source paths</summary>${lines}</details>`;
}

// UI-10 (PLAN_UI §4.B.8 "Run Development · <H> · <mission>"): the control names
// the hypothesis and the selected mission with backend identities — the launch
// metadata/readiness when published, else the canonical contract (the control
// only ever launches H-S1-01 requests; BT-08 validates them against it).
function developmentButtonLabel(launch, selected, missionId) {
  const hypothesisId = launch?.metadata?.hypothesisId ?? H_S1_01.hypothesisId;
  const mission = selected?.missionLabel ?? MISSION_LABELS[missionId] ?? "no mission selected";
  return `Run Development · ${hypothesisId} · ${mission}`;
}

// Si el backend no dio línea (estado ilegible), la UI no la inventa: lo dice.
const NO_STATUS_LINE = "Backtest status unavailable";

// Script inline: POST al endpoint, luego GET cada 3 s mientras el backend diga
// running. Copia la línea del backend tal cual; no deriva ni calcula nada.
// BT-07: en modo TRADES manda mode "TRADES" y copia `trades.display.line`; el botón
// sigue deshabilitado mientras el backend diga que el gate de TR-04 está cerrado.
// UI-08: en modo HYPOTHESIS el botón manda el job canónico YA validado por el
// backend (data-hypothesis-request), con mode "HYPOTHESIS"; nunca manda TOB/TRADES
// ni abre OOS. Sin request del backend, el botón queda deshabilitado.
const JOB_CONTROL_SCRIPT = `<script>
(function () {
  var root = document.querySelector("[data-backtest-job]");
  if (!root) return;
  var endpoint = root.getAttribute("data-endpoint");
  var mode = root.getAttribute("data-mode") === "TRADES" ? "TRADES" : root.getAttribute("data-mode") === "HYPOTHESIS" ? "HYPOTHESIS" : "TOB";
  var button = root.querySelector("[data-job-start]");
  var line = root.querySelector("[data-job-line]");
  var message = root.querySelector("[data-job-message]");
  function lineOf(body) { return body && body.display && typeof body.display.line === "string" ? body.display.line : "${NO_STATUS_LINE}"; }
  function viewOf(s) { return mode === "TRADES" ? (s && s.trades) : mode === "HYPOTHESIS" ? (s && s.hypothesis) : s; }
  function locked(s) { var v = viewOf(s); return mode === "TRADES" && !(v && v.gate && v.gate.ok === true); }
  function hypothesisBusyOrUnreadable(s) {
    var v = s && s.hypothesis;
    return !v || v.configured !== true || v.statusReadable !== true || v.running !== false;
  }
  function hypothesisReady() {
    var holder = root.querySelector("[data-hypothesis-request]");
    if (!holder) return false;
    try { return JSON.parse(holder.textContent) !== null && typeof JSON.parse(holder.textContent) === "object"; } catch (e) { return false; }
  }
  function refresh() {
    fetch(endpoint, { headers: { "Accept": "application/json" } }).then(function (r) { return r.json(); }).then(function (s) {
      line.textContent = lineOf(viewOf(s)) || (s && s.hypothesis && s.hypothesis.display ? s.hypothesis.display.line : "${NO_STATUS_LINE}");
      // UI-08 review R07: in HYPOTHESIS mode the button stays disabled unless a
      // backend-validated request is actually embedded; a finished job or a
      // readable status must never re-enable a blocked control.
      button.disabled = mode === "HYPOTHESIS"
        ? s.running === true || hypothesisBusyOrUnreadable(s) || !hypothesisReady()
        : s.running === true || locked(s);
      var running = s.running === true || (mode === "HYPOTHESIS" && s.hypothesis && s.hypothesis.running === true);
      root.setAttribute("data-running", running ? "true" : "false");
      if (running) setTimeout(refresh, 3000);
    }).catch(function () { line.textContent = "${NO_STATUS_LINE} · status endpoint unreachable"; button.disabled = mode !== "TOB"; });
  }
  function hypothesisBody() {
    var holder = root.querySelector("[data-hypothesis-request]");
    if (!holder) return null;
    try { return JSON.parse(holder.textContent); } catch (e) { return null; }
  }
  button.addEventListener("click", function () {
    button.disabled = true;
    message.textContent = "";
    var body;
    if (mode === "TRADES") body = { requestedBy: "ui", mode: "TRADES" };
    else if (mode === "HYPOTHESIS") {
      var request = hypothesisBody();
      if (!request) { message.textContent = "Not started · no backend-validated Development request for this mission"; button.disabled = true; return; }
      body = { requestedBy: "ui", mode: "HYPOTHESIS", job: request };
    } else body = { requestedBy: "ui" };
    fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json", "Accept": "application/json" }, body: JSON.stringify(body) })
      .then(function (r) { return r.json(); })
      .then(function (body) {
        if (body.ok === true && body.reused === true) {
          line.textContent = lineOf(body) || line.textContent;
          if (mode !== "HYPOTHESIS") { button.disabled = false; return; }
          // A reused result does not attest that the hypothesis runner is
          // currently idle. Read its own status before enabling Development.
          refresh();
          return;
        }
        if (body.ok !== true) message.textContent = lineOf(body) || (body.message || "Not started");
        refresh();
      })
      .catch(function () { message.textContent = "Not started · launch endpoint unreachable"; button.disabled = mode === "HYPOTHESIS"; });
  });
  if (root.getAttribute("data-running") === "true") setTimeout(refresh, 3000);
})();
</script>`;

// `status` = backtestJobStatusPayload(runner) de ../backtest-jobs/http.mjs, con
// `trades` = tradesJobStatusPayload(tradesRunner) (BT-07) y `hypothesis` =
// hypothesisJobStatusPayload(hypothesisRunner) (BT-08). `mode` = el del selector
// TOB · TRADES de TR-07 o HYPOTHESIS (UI-08): el mismo botón, sin paneles nuevos.
// `launch` = hypothesisLaunchFromRunner(runner): metadata + readiness + el request
// canónico por misión; `missionId` elige la misión del control.
export function renderBacktestJobControl(status, { mode = "TOB", launch = null, missionId = null } = {}) {
  const trades = mode === "TRADES";
  const hypothesis = mode === "HYPOTHESIS";
  const running = status?.running === true;
  const view = trades ? status?.trades : hypothesis ? status?.hypothesis : status;
  const line = typeof view?.display?.line === "string" ? view.display.line : NO_STATUS_LINE;
  // Fail-closed: en TRADES, sin gate abierto publicado por el backend, no se lanza nada.
  const locked = trades && view?.gate?.ok !== true;
  if (!hypothesis) {
    const disabled = running || locked;
    return `<div class="jobctl" data-backtest-job data-endpoint="${esc(BACKTEST_JOBS_PATH)}" data-mode="${trades ? "TRADES" : "TOB"}" data-running="${running ? "true" : "false"}"${locked ? ' data-locked="true"' : ""} style="text-align:right">
  <button type="button" class="btn" data-job-start${disabled ? " disabled" : ""}>Run ${trades ? "TRADES" : "legacy TOB"} backtest</button>
  <div class="mono small muted" style="margin-top:4px" data-job-line>${esc(line)}</div>
  <div class="small" data-job-message></div>
</div>
${JOB_CONTROL_SCRIPT}`;
  }
  const missions = launch?.missions ?? [];
  // A selected mission may be absent from an incomplete backend launch. Never
  // borrow another mission's validated request for this Development control.
  const selected = missions.find((entry) => entry.missionId === missionId) ?? null;
  const candidate = selected?.status === "READY" ? selected.request ?? null : null;
  const request = candidate?.missionId === missionId && candidate?.phase === "DEVELOPMENT" ? candidate : null;
  const ready = request !== null;
  const blockers = selected?.blockers ?? [];
  // The hypothesis runner has its own active attempt and readable status.
  // A valid request alone cannot enable another Development launch.
  const hypothesisAvailable = view?.configured === true && view?.statusReadable === true && view?.running === false;
  const hypothesisRunning = view?.running === true;
  const disabled = running || !hypothesisAvailable || !ready;
  const blockerHtml = blockers.length > 0
    ? blockerBriefHtml(blockers, "data-job-blocker")
    : "no backend-validated Development request is available for this mission";
  const requestTag = ready
    ? `<script type="application/json" data-hypothesis-request>${JSON.stringify(request).replaceAll("<", "\\u003c")}</script>`
    : "";
  return `<div class="jobctl" data-backtest-job data-endpoint="${esc(BACKTEST_JOBS_PATH)}" data-mode="HYPOTHESIS" data-running="${running || hypothesisRunning ? "true" : "false"}"${ready && hypothesisAvailable ? "" : ' data-locked="true"'} style="text-align:right">
  <button type="button" class="btn" data-job-start${disabled ? " disabled" : ""}>${esc(developmentButtonLabel(launch, selected, missionId))}</button>
  <div class="mono small muted" style="margin-top:4px" data-job-line>${esc(line)}</div>
  ${ready ? "" : `<div class="small muted" data-job-blockers style="max-width:46ch;margin-left:auto;text-align:left">${blockerHtml}</div>`}
  <div class="small" data-job-message></div>
  ${requestTag}
</div>
${JOB_CONTROL_SCRIPT}`;
}

// Zona: la cabecera de la página de Backtests, junto a las etiquetas de brazos.
export function withBacktestJobControl(html, status, { mode = "TOB", launch = null, missionId = null } = {}) {
  const slot = '<div data-job-control-slot></div>';
  if (html.includes(slot)) return html.replace(slot, renderBacktestJobControl(status, { mode, launch, missionId }));
  const marker = '<div class="armhead">';
  const index = html.indexOf(marker);
  if (index === -1) return html;
  return `${html.slice(0, index)}${renderBacktestJobControl(status, { mode, launch, missionId })}${html.slice(index)}`;
}
