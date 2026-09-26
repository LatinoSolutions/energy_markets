// BT-05 (PLAN_STATUS, owner request 25-sep-2026): control del job de backtest en
// la pantalla de Backtests. "No quiero mil botones, que no quede sopa": un solo
// control (1 botón + el estado del job en la misma zona), dentro del diseño de
// UI-03, sin paneles ni formularios extra. El botón sólo llama a
// POST /api/backtest-jobs y la línea de estado copia `display.line`, que arma el
// backend (../backtest-jobs/display.mjs): cero cálculo en la UI (SPEC v1.1.1 §26.5).
// Aprobado con cambios por Bru, P-009 (2026-09-25); server.mjs lo sirve en /backtests.

import { BACKTEST_JOBS_PATH } from "../backtest-jobs/http.mjs";

function esc(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

// Si el backend no dio línea (estado ilegible), la UI no la inventa: lo dice.
const NO_STATUS_LINE = "Backtest status unavailable";

// Script inline: POST al endpoint, luego GET cada 3 s mientras el backend diga
// running. Copia la línea del backend tal cual; no deriva ni calcula nada.
// BT-07: en modo TRADES manda mode "TRADES" y copia `trades.display.line`; el botón
// sigue deshabilitado mientras el backend diga que el gate de TR-04 está cerrado.
const JOB_CONTROL_SCRIPT = `<script>
(function () {
  var root = document.querySelector("[data-backtest-job]");
  if (!root) return;
  var endpoint = root.getAttribute("data-endpoint");
  var mode = root.getAttribute("data-mode") === "TRADES" ? "TRADES" : "TOB";
  var button = root.querySelector("[data-job-start]");
  var line = root.querySelector("[data-job-line]");
  var message = root.querySelector("[data-job-message]");
  function lineOf(body) { return body && body.display && typeof body.display.line === "string" ? body.display.line : "${NO_STATUS_LINE}"; }
  function viewOf(s) { return mode === "TRADES" ? (s && s.trades) : s; }
  function locked(s) { var v = viewOf(s); return mode === "TRADES" && !(v && v.gate && v.gate.ok === true); }
  function refresh() {
    fetch(endpoint, { headers: { "Accept": "application/json" } }).then(function (r) { return r.json(); }).then(function (s) {
      line.textContent = lineOf(viewOf(s));
      button.disabled = s.running === true || locked(s);
      root.setAttribute("data-running", s.running === true ? "true" : "false");
      if (s.running === true) setTimeout(refresh, 3000);
    }).catch(function () { line.textContent = "${NO_STATUS_LINE} · status endpoint unreachable"; button.disabled = mode === "TRADES"; });
  }
  button.addEventListener("click", function () {
    button.disabled = true;
    message.textContent = "";
    var body = mode === "TRADES" ? { requestedBy: "ui", mode: "TRADES" } : { requestedBy: "ui" };
    fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json", "Accept": "application/json" }, body: JSON.stringify(body) })
      .then(function (r) { return r.json(); })
      .then(function (body) {
        if (body.ok === true && body.reused === true) { line.textContent = lineOf(body); button.disabled = false; return; }
        if (body.ok !== true) message.textContent = lineOf(body);
        refresh();
      })
      .catch(function () { message.textContent = "Not started · launch endpoint unreachable"; button.disabled = mode === "TRADES"; });
  });
  if (root.getAttribute("data-running") === "true") setTimeout(refresh, 3000);
})();
</script>`;

// `status` = backtestJobStatusPayload(runner) de ../backtest-jobs/http.mjs, con
// `trades` = tradesJobStatusPayload(tradesRunner) (BT-07). `mode` = el del selector
// TOB · TRADES de TR-07: el mismo botón, sin paneles nuevos.
export function renderBacktestJobControl(status, { mode = "TOB" } = {}) {
  const trades = mode === "TRADES";
  const running = status?.running === true;
  const view = trades ? status?.trades : status;
  const line = typeof view?.display?.line === "string" ? view.display.line : NO_STATUS_LINE;
  // Fail-closed: en TRADES, sin gate abierto publicado por el backend, no se lanza nada.
  const locked = trades && view?.gate?.ok !== true;
  const disabled = running || locked;
  return `<div class="jobctl" data-backtest-job data-endpoint="${esc(BACKTEST_JOBS_PATH)}" data-mode="${trades ? "TRADES" : "TOB"}" data-running="${running ? "true" : "false"}"${locked ? ' data-locked="true"' : ""} style="text-align:right">
  <button type="button" class="btn" data-job-start${disabled ? " disabled" : ""}>Run backtest</button>
  <div class="mono small muted" style="margin-top:4px" data-job-line>${esc(line)}</div>
  <div class="small" data-job-message></div>
</div>
${JOB_CONTROL_SCRIPT}`;
}

// Zona: la cabecera de la página de Backtests, junto a las etiquetas de brazos.
export function withBacktestJobControl(html, status, { mode = "TOB" } = {}) {
  const marker = '<div class="armhead">';
  const index = html.indexOf(marker);
  if (index === -1) return html;
  return `${html.slice(0, index)}${renderBacktestJobControl(status, { mode })}${html.slice(index)}`;
}
