// BT-08 (hallazgo BT08-T01): el servidor real de la app (src/ui/serve.mjs) debe
// instanciar y inyectar el runner de jobs de hipótesis; antes arrancaba sin él
// y GET /api/backtest-jops... GET /api/backtest-jobs informaba
// hypothesis.configured=false y el POST devolvía 503.

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { existsSync, readdirSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const BACKTEST_JOBS_PATH = "/api/backtest-jobs";
// El CLI de serve usa el runsRoot real; el test deja el directorio como estaba:
// si sólo quedaron locks muertos del arranque, se eliminan (los receipt dirs se
// conservan siempre).
function cleanServeRunsLeftovers() {
  const runsRoot = path.join(REPO_ROOT, "operations/backtest-runs");
  if (!existsSync(runsRoot)) return;
  const entries = readdirSync(runsRoot);
  const runDirs = entries.filter((name) => /^(BT-RUN|TR-RUN|HYP-RUN)-/.test(name));
  if (runDirs.length > 0) return;
  for (const entry of entries) {
    rmSync(path.join(runsRoot, entry), { force: true, recursive: true });
  }
  rmSync(runsRoot, { force: true, recursive: true });
}

async function startServeCli() {
  const child = execFile(process.execPath, ["src/ui/serve.mjs", "--port", "0"], { cwd: REPO_ROOT });
  let stdout = "";
  const urlPromise = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`serve.mjs no publicó su URL a tiempo: ${stdout}`)), 15000);
    const onData = (chunk) => {
      stdout += chunk;
      const match = /Energy Markets Operator UI: (http:\/\/\S+)/.exec(stdout);
      if (match) {
        clearTimeout(timer);
        resolve(match[1]);
      }
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.once("exit", () => reject(new Error(`serve.mjs terminó antes de publicar la URL: ${stdout}`)));
  });
  const url = await urlPromise;
  return { child, url };
}

test("BT08-T01: serve.mjs arranca con el runner de hipótesis conectado (GET configured=true; POST sin fallback legacy)", async () => {
  const { child, url } = await startServeCli();
  const base = url.slice(0, -1);
  try {
    const status = await (await fetch(`${base}${BACKTEST_JOBS_PATH}`)).json();
    assert.equal(status.hypothesis.configured, true);
    assert.equal(status.hypothesis.hypothesisMetadata.hypothesisId, "H-S1-01");
    assert.equal(status.hypothesis.hypothesisMetadata.name, "Session-Anchored Rolling Reference");
    assert.deepEqual(status.hypothesis.hypothesisMetadata.missions, ["Gas Monthly", "Gas Quarterly", "Power Monthly", "Power Quarterly"]);
    assert.equal(Array.isArray(status.hypothesis.readiness), true);

    // Con el runner inyectado, un POST de hipótesis ya no devuleve 503: la
    // validación canónica del runner responde (fail-closed) en la app real.
    const unknown = await fetch(`${base}${BACKTEST_JOBS_PATH}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ requestedBy: "ui", mode: "HYPOTHESIS", job: { hypothesisId: "H-RD-01" } }),
    });
    assert.equal(unknown.status, 422);
    assert.equal((await unknown.json()).code, "UNKNOWN_HYPOTHESIS");

    // Un payload de hipótesis sin mode HYPOTHESIS se rechaza sin runner legacy (T02).
    const missing = await fetch(`${base}${BACKTEST_JOBS_PATH}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ requestedBy: "ui", job: { hypothesisId: "H-S1-01" } }),
    });
    assert.equal(missing.status, 400);
    assert.equal((await missing.json()).code, "INVALID_MODE");

    const onRunPath = await fetch(`${base}${BACKTEST_JOBS_PATH}/HYP-RUN-${"0".repeat(64)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ requestedBy: "ui", mode: "HYPOTHESIS", job: { hypothesisId: "H-S1-01" } }),
    });
    assert.equal(onRunPath.status, 405); // T03
  } finally {
    child.kill("SIGTERM");
    await new Promise((resolve) => child.once("exit", resolve));
    cleanServeRunsLeftovers();
  }
});
