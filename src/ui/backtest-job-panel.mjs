// BT-05 (PLAN_STATUS, owner request 25-sep-2026): control del job de backtest en
// la superficie Backtests. El botón sólo llama al endpoint backend
// POST /api/backtest-jobs y muestra, sin transformarlos, los campos que el
// backend devuelve (cero cálculo en la UI, SPEC v1.1.1 §26.5 y nota BT-05).
// El servidor lo inserta en /backtests sólo cuando tiene ejecutor configurado.

import { BACKTEST_JOBS_PATH } from "../backtest-jobs/http.mjs";

function esc(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

// Campos que se muestran, en orden. Son rutas dentro de la vista pública del job
// (publicJobView en ../backtest-jobs/runner.mjs); el valor se pinta tal cual.
export const JOB_PANEL_FIELDS = Object.freeze([
  ["runId", "Run"],
  ["status", "Status"],
  ["requestedBy", "Requested by"],
  ["startedAt", "Started (UTC)"],
  ["finishedAt", "Finished (UTC)"],
  ["failure.code", "Failure"],
  ["failure.message", "Failure detail"],
  ["result.status", "Result status"],
  ["result.results.sha256", "Results sha256"],
  ["result.reproducesCommittedResults", "Same sha as committed results"],
  ["memory.childMaxRssKb", "Job peak RSS (KB)"],
  ["memory.cgroupMemoryPeakBytesAfter", "Service cgroup memory.peak (bytes)"],
  ["memory.cgroupOomKillsDuringRun", "OOM kills during run"],
  ["receiptPath", "Receipt"],
]);

function pick(object, dotted) {
  return dotted.split(".").reduce((value, key) => (value == null ? undefined : value[key]), object);
}

function fieldText(value) {
  return value === undefined || value === null ? "—" : String(value);
}

function jobRows(job) {
  return JOB_PANEL_FIELDS.map(([field, label]) => `<tr><td class="small muted">${esc(label)}</td><td class="mono small" data-job-field="${esc(field)}">${esc(fieldText(pick(job, field)))}</td></tr>`).join("");
}

// Script inline: POST al endpoint, luego GET periódico mientras el backend diga
// running. Copia textos; no deriva ni calcula nada.
const JOB_PANEL_SCRIPT = `<script>
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
      .then(function (body) { if (!body.ok) message.textContent = body.code + (body.message ? ": " + body.message : ""); refresh(); })
      .catch(function () { message.textContent = "launch endpoint unreachable"; button.disabled = false; });
  });
  if (root.getAttribute("data-running") === "true") setTimeout(refresh, 3000);
})();
</script>`;

export function renderBacktestJobPanel(status) {
  const running = status?.running === true;
  const job = status?.current ?? status?.latest ?? null;
  return `<div class="card" data-backtest-job data-endpoint="${esc(BACKTEST_JOBS_PATH)}" data-running="${running ? "true" : "false"}" style="margin-top:14px">
  <div class="hd"><h3>Run backtest</h3><span class="small muted">one job at a time · runs in the backend on the hash-pinned exploratory snapshot · result versioned with manifest + receipt</span><span class="grow"></span><button type="button" class="btn" data-job-start${running ? " disabled" : ""}>Run backtest</button></div>
  <div class="bd"><div class="small" data-job-message></div><table class="small"><tbody>${jobRows(job)}</tbody></table></div>
</div>
${JOB_PANEL_SCRIPT}`;
}

// Se inserta antes del pie de la página ya renderizada de Backtests.
export function withBacktestJobPanel(html, status) {
  const marker = '<div class="foot">';
  const index = html.indexOf(marker);
  if (index === -1) return html;
  return `${html.slice(0, index)}${renderBacktestJobPanel(status)}${html.slice(index)}`;
}
