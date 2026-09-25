// BT-05 (PLAN_STATUS, owner request 25-sep-2026): control del job de backtest en
// la pantalla de Backtests. "No quiero mil botones, que no quede sopa": un solo
// control (1 botón + el estado del job en la misma zona), dentro del diseño de
// UI-03, sin paneles ni formularios extra. El botón sólo llama a
// POST /api/backtest-jobs y el estado copia, sin transformarlos, los campos que
// devuelve el backend (cero cálculo en la UI, SPEC v1.1.1 §26.5).
//
// GATE (fila BT-05): antes de servir la UI, Bru aprueba una propuesta visual.
// Mientras no conste esa aprobación, server.mjs NO inserta este control; sólo se
// usa para generar la propuesta (evidence/BT-05/ui-proposal/).

import { BACKTEST_JOBS_PATH } from "../backtest-jobs/http.mjs";

function esc(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

// Campos de la línea de estado, en orden. Son rutas dentro de la vista pública
// del job (publicJobView en ../backtest-jobs/runner.mjs); el valor va tal cual.
export const JOB_CONTROL_FIELDS = Object.freeze(["status", "finishedAt", "retention.state", "failure.code"]);

function pick(object, dotted) {
  return dotted.split(".").reduce((value, key) => (value == null ? undefined : value[key]), object);
}

function fieldText(value) {
  return value === undefined || value === null ? "—" : String(value);
}

function statusLine(job) {
  return JOB_CONTROL_FIELDS.map((field) => `<span data-job-field="${esc(field)}">${esc(fieldText(pick(job, field)))}</span>`).join(" · ");
}

// Script inline: POST al endpoint, luego GET periódico mientras el backend diga
// running. Copia textos; no deriva ni calcula nada.
const JOB_CONTROL_SCRIPT = `<script>
(function () {
  var root = document.querySelector("[data-backtest-job]");
  if (!root) return;
  var endpoint = root.getAttribute("data-endpoint");
  var button = root.querySelector("[data-job-start]");
  var message = root.querySelector("[data-job-message]");
  function pick(o, dotted) { return dotted.split(".").reduce(function (v, k) { return v == null ? undefined : v[k]; }, o); }
  function show(job) {
    root.querySelectorAll("[data-job-field]").forEach(function (cell) {
      var v = job ? pick(job, cell.getAttribute("data-job-field")) : undefined;
      cell.textContent = v === undefined || v === null ? "\\u2014" : String(v);
    });
  }
  function refresh() {
    fetch(endpoint, { headers: { "Accept": "application/json" } }).then(function (r) { return r.json(); }).then(function (s) {
      show(s.current || s.latest);
      button.disabled = s.running === true;
      root.setAttribute("data-running", s.running === true ? "true" : "false");
      if (s.running === true) setTimeout(refresh, 3000);
    }).catch(function () { message.textContent = "status endpoint unreachable"; });
  }
  button.addEventListener("click", function () {
    button.disabled = true;
    message.textContent = "";
    fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json", "Accept": "application/json" }, body: JSON.stringify({ requestedBy: "ui" }) })
      .then(function (r) { return r.json(); })
      .then(function (body) {
        if (!body.ok) message.textContent = body.code + (body.message ? ": " + body.message : "");
        else if (body.reused === true) message.textContent = "REUSED";
        refresh();
      })
      .catch(function () { message.textContent = "launch endpoint unreachable"; button.disabled = false; });
  });
  if (root.getAttribute("data-running") === "true") setTimeout(refresh, 3000);
})();
</script>`;

export function renderBacktestJobControl(status) {
  const running = status?.running === true;
  const job = status?.current ?? status?.latest ?? null;
  return `<div class="jobctl" data-backtest-job data-endpoint="${esc(BACKTEST_JOBS_PATH)}" data-running="${running ? "true" : "false"}" style="text-align:right">
  <button type="button" class="btn" data-job-start${running ? " disabled" : ""}>Run backtest</button>
  <div class="mono small muted" style="margin-top:4px">${statusLine(job)}</div>
  <div class="small" data-job-message></div>
</div>
${JOB_CONTROL_SCRIPT}`;
}

// Zona propuesta: la cabecera de la página de Backtests, junto a las etiquetas de brazos.
export function withBacktestJobControl(html, status) {
  const marker = '<div class="armhead">';
  const index = html.indexOf(marker);
  if (index === -1) return html;
  return `${html.slice(0, index)}${renderBacktestJobControl(status)}${html.slice(index)}`;
}
