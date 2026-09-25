// BT-05 gate UI (PLAN_STATUS fila BT-05: "antes de implementar la UI, entregar a
// Bru una propuesta visual (captura) y esperar su aprobacion"). Genera la página
// /backtests tal como la sirve la app hoy, con el control propuesto insertado.
// Los estados del job son ILUSTRATIVOS (no son runs reales): sólo muestran cómo
// se vería el control. Uso: node evidence/BT-05/ui-proposal/make-proposal.mjs
// Captura: ver README.md de esta carpeta.

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { loadCanonicalUiInputs } from "../../../src/ui/canonical-inputs.mjs";
import { createUiServer } from "../../../src/ui/server.mjs";
import { withBacktestJobControl } from "../../../src/ui/backtest-job-panel.mjs";
import { describeJobStatus } from "../../../src/backtest-jobs/display.mjs";

const ILLUSTRATIVE_RUN_ID = `BT-RUN-${"0".repeat(64)}`;
const STATES = {
  idle: { running: false, current: null, latest: { runId: ILLUSTRATIVE_RUN_ID, status: "SUCCEEDED", startedAt: "2026-09-25T14:58:00.000Z", finishedAt: "2026-09-25T15:00:04.000Z", failure: null, retention: { state: "CURRENT", supersededBy: null } } },
  running: { running: true, current: { runId: ILLUSTRATIVE_RUN_ID, status: "RUNNING", startedAt: "2026-09-25T15:00:04.000Z", finishedAt: null, failure: null, retention: { state: "NONE", supersededBy: null } }, latest: null },
};
// Reloj ILUSTRATIVO para la línea "Running · … elapsed" (P-009 punto 2).
const ILLUSTRATIVE_NOW = new Date("2026-09-25T15:03:30.000Z");
const BANNER = '<div style="background:#fff3c4;border-bottom:1px solid #d9b100;padding:6px 14px;font:13px system-ui">PROPUESTA BT-05 — valores del job ILUSTRATIVOS, no es un run real. Sólo cambia el bloque "Run backtest" arriba a la derecha.</div>';

const canonical = loadCanonicalUiInputs();
const { server, ready } = createUiServer({ inputs: canonical.inputs, backend: canonical.backend, port: 0 });
const served = await ready;
try {
  const page = await (await fetch(`${served.url}backtests`)).text();
  for (const [name, status] of Object.entries(STATES)) {
    const html = withBacktestJobControl(page, { ...status, display: { line: describeJobStatus(status, ILLUSTRATIVE_NOW) } }).replace(/<body([^>]*)>/, `<body$1>${BANNER}`);
    writeFileSync(fileURLToPath(new URL(`./backtests-${name}.html`, import.meta.url)), html);
  }
} finally {
  server.close();
}
