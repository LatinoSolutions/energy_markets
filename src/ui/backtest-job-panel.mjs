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
const JOB_CONTROL_SCRIPT = `<script>
(function () {
  var root = document.querySelector("[data-backtest-job]");
  if (!root) return;
  var endpoint = root.getAttribute("data-endpoint");
  var button = root.querySelector("[data-job-start]");
  var line = root.querySelector("[data-job-line]");
  var message = root.querySelector("[data-job-message]");
  function lineOf(body) { return body && body.display && typeof body.display.line === "string" ? body.display.line : "${NO_STATUS_LINE}"; }
  function refresh() {
    fetch(endpoint, { headers: { "Accept": "application/json" } }).then(function (r) { return r.json(); }).then(function (s) {
      line.textContent = lineOf(s);
      button.disabled = s.running === true;
      root.setAttribute("data-running", s.running === true ? "true" : "false");
      if (s.running === true) setTimeout(refresh, 3000);
    }).catch(function () { line.textContent = "${NO_STATUS_LINE} · status endpoint unreachable"; button.disabled = false; });
  }
  button.addEventListener("click", function () {
    button.disabled = true;
    message.textContent = "";
    fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json", "Accept": "application/json" }, body: JSON.stringify({ requestedBy: "ui" }) })
      .then(function (r) { return r.json(); })
      .then(function (body) {
        if (body.ok === true && body.reused === true) { line.textContent = lineOf(body); button.disabled = false; return; }
        if (body.ok !== true) message.textContent = lineOf(body);
        refresh();
      })
      .catch(function () { message.textContent = "Not started · launch endpoint unreachable"; button.disabled = false; });
  });
  if (root.getAttribute("data-running") === "true") setTimeout(refresh, 3000);
})();
</script>`;

// `status` = backtestJobStatusPayload(runner) de ../backtest-jobs/http.mjs.
export function renderBacktestJobControl(status) {
  const running = status?.running === true;
  const line = typeof status?.display?.line === "string" ? status.display.line : NO_STATUS_LINE;
  return `<div class="jobctl" data-backtest-job data-endpoint="${esc(BACKTEST_JOBS_PATH)}" data-running="${running ? "true" : "false"}" style="text-align:right">
  <button type="button" class="btn" data-job-start${running ? " disabled" : ""}>Run backtest</button>
  <div class="mono small muted" style="margin-top:4px" data-job-line>${esc(line)}</div>
  <div class="small" data-job-message></div>
</div>
${JOB_CONTROL_SCRIPT}`;
}

// Zona: la cabecera de la página de Backtests, junto a las etiquetas de brazos.
export function withBacktestJobControl(html, status) {
  const marker = '<div class="armhead">';
  const index = html.indexOf(marker);
  if (index === -1) return html;
  return `${html.slice(0, index)}${renderBacktestJobControl(status)}${html.slice(index)}`;
}
