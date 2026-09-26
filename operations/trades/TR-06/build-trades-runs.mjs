// Productor de los runs TRADES de las 4 misiones (TR-06). Fuente:
// TRADES_MODE_PLAN.md TR-06 y docs/canonical/v1_1_1/
// OWNER_PATCH_TRADES_MODE_2026-09-25.md (EM-SPEC-OWNER-PATCH-2026-09-25-03) §2-§4.
//
// Este script es I/O: lee la zona plan de TR-02, el contrato congelado de TR-04,
// las filas de trades (NDJSON del extractor de TR-01), los slots TOB (JSON del
// extractor de TR-03) y los calendarios por mercado, y delega TODA la
// orquestación a `src/trades-engine/runs.mjs`. No calcula economía ni inventa
// resultados.
//
// Precondición fail-closed: el contrato TRADES-v1 debe estar FROZEN (gate humano
// de TR-04). Sin freeze, el script termina sin escribir resultados.
//
// El run lo lanza Bru por la ruta de jobs de BT-05, que mide el pico de RAM de
// cada run (memory.peak del cgroup). El pico se lee de la variable de entorno
// TR06_MEMORY_PEAK_JSON si el runner la publica; si no, queda null (nunca un
// número inventado).
//
// Uso:
//   node operations/trades/TR-06/build-trades-runs.mjs \
//     --gas-trades /tmp/tr06-gas-the.ndjson --power-trades /tmp/tr06-power-de.ndjson \
//     --gas-tob /tmp/tr06-tob-gas.json --power-tob /tmp/tr06-tob-power.json
//   node operations/trades/TR-06/build-trades-runs.mjs --check

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { createReadStream, readFileSync, writeFileSync } from "node:fs";
import readline from "node:readline";
import { pathToFileURL } from "node:url";

import { tobSlotsDocumentToSeries } from "../../../src/trades-bridge/tob-slots.mjs";
import { ZONES } from "../../../src/oos-reservation/trades-zones.mjs";
import { TRADES_RUNS_VERSION, runTradesRuns } from "../../../src/trades-engine/runs.mjs";

const ZONE_PLAN_PATH = "operations/trades/TR-02/trades-zone-plan.json";
const FREEZE_PATH = "operations/trades/TR-04/TRADES_CONTRACT_V1_FREEZE.json";
const GAS_CALENDAR_PATH = "operations/audit/IMP-09/eex-exchange-calendar.json";
const POWER_CALENDAR_PATH = "operations/trades/TR-01/power-de-exchange-calendar.json";
const OUT_PATH = "operations/trades/TR-06/trades-runs.json";
const MANIFEST_PATH = "operations/trades/TR-06/trades-runs.MANIFEST.json";

// Un mercado por vez: cada misión se corre con el calendario de su mercado, no
// con la unión (patch 03 §3.4: la ventana sale del calendario del mercado).
export const MARKET_RUNS = Object.freeze([
  { market: "GAS_THE", missions: ["GAS_QUARTERLY", "GAS_MONTHLY"], tradesFlag: "--gas-trades", tobFlag: "--gas-tob", calendarPath: GAS_CALENDAR_PATH },
  { market: "POWER_DE", missions: ["POWER_QUARTERLY", "POWER_MONTHLY"], tradesFlag: "--power-trades", tobFlag: "--power-tob", calendarPath: POWER_CALENDAR_PATH },
]);

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const hashFile = (file) => sha256(readFileSync(file));

function argument(flag) {
  const index = process.argv.indexOf(flag);
  return index === -1 ? null : process.argv[index + 1] ?? null;
}

async function readNdjsonRows(file) {
  const rows = [];
  const stream = createReadStream(file, { encoding: "utf8" });
  const lines = readline.createInterface({ input: stream, crlfDelay: Infinity });
  for await (const line of lines) {
    if (line.trim().length === 0) continue;
    rows.push(JSON.parse(line));
  }
  return rows;
}

function readJson(file) {
  return JSON.parse(readFileSync(file, "utf8"));
}

function exchangeDaysOf(calendarPath) {
  const calendar = readJson(calendarPath);
  if (!Array.isArray(calendar.exchangeDays)) {
    throw new Error(`el calendario ${calendarPath} no declara exchangeDays`);
  }
  return calendar.exchangeDays;
}

function gitHead() {
  try {
    return execFileSync("git", ["rev-parse", "--verify", "HEAD"], { encoding: "utf8" }).trim();
  } catch {
    return null;
  }
}

function memoryPeakFromEnv() {
  const raw = process.env.TR06_MEMORY_PEAK_JSON;
  if (typeof raw !== "string" || raw.trim().length === 0) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function freezeIsFrozen() {
  try {
    return readJson(FREEZE_PATH)?.decision === "FROZEN";
  } catch {
    return false;
  }
}

export async function buildTradesRuns({ inputs }) {
  const zonePlan = readJson(ZONE_PLAN_PATH);
  const codeCommit = gitHead();
  const memoryPeak = memoryPeakFromEnv();
  const dataManifest = {
    zonePlan: { path: ZONE_PLAN_PATH, sha256: hashFile(ZONE_PLAN_PATH) },
    freeze: { path: FREEZE_PATH, sha256: hashFile(FREEZE_PATH) },
    trades: {},
    tob: {},
  };

  const runs = [];
  let accessPlan = null;
  const blockedBy = [];

  for (const market of MARKET_RUNS) {
    const tradesPath = inputs[market.tradesFlag];
    const tobPath = inputs[market.tobFlag];
    if (tradesPath === null || tobPath === null) {
      blockedBy.push(`MISSING_INPUT_${market.market}`);
      continue;
    }
    const rows = await readNdjsonRows(tradesPath);
    const tobSeries = tobSlotsDocumentToSeries(readJson(tobPath));
    const exchangeDays = exchangeDaysOf(market.calendarPath);
    dataManifest.trades[market.market] = { path: tradesPath, sha256: hashFile(tradesPath) };
    dataManifest.tob[market.market] = { path: tobPath, sha256: hashFile(tobPath) };

    const outcome = runTradesRuns({
      zonePlan,
      rows,
      exchangeDays,
      tobSeries,
      frozenContract: readJson(FREEZE_PATH),
      codeCommit,
      dataManifest,
      parameters: { jobKind: "TRADES_BACKTEST", phase: "TR-06" },
      memoryPeak,
      atUtc: new Date().toISOString(),
      actor: "Bru",
      missions: market.missions,
      initialAccessPlan: accessPlan,
    });
    blockedBy.push(...outcome.blockedBy);
    runs.push(...outcome.runs);
    if (outcome.accessPlan) accessPlan = outcome.accessPlan;
  }

  const artifact = {
    artifactKind: "TR-06_TRADES_RUNS",
    schemaVersion: TRADES_RUNS_VERSION,
    status: blockedBy.length === 0 ? "RUN" : "BLOCKED",
    spec: { id: "OWNER_PATCH_TRADES_MODE_2026-09-25.md", version: "EM-SPEC-OWNER-PATCH-2026-09-25-03" },
    codeCommit,
    inputs: dataManifest,
    memoryPeak,
    runs,
    oosAccess: accessPlan?.accessRegistry ?? null,
    blockedBy: [...new Set(blockedBy)],
  };
  return { artifact, runs };
}

function parseInputs() {
  return {
    "--gas-trades": argument("--gas-trades"),
    "--power-trades": argument("--power-trades"),
    "--gas-tob": argument("--gas-tob"),
    "--power-tob": argument("--power-tob"),
  };
}

async function main() {
  if (process.argv.includes("--check")) {
    const committed = readFileSync(OUT_PATH);
    const { artifact } = await buildTradesRuns({ inputs: parseInputs() });
    const bytes = Buffer.from(`${JSON.stringify(artifact, null, 1)}\n`);
    if (!committed.equals(bytes)) throw new Error("trades-runs.json no es reproducible con los inputs actuales.");
    console.log("TR-06 runs reproducible");
    return;
  }
  if (!freezeIsFrozen()) {
    console.error("TRADES_CONTRACT_NOT_FROZEN: el freeze de TRADES-v1 (TR-04) es un gate humano; sin FROZEN no se corre ningún run.");
    process.exitCode = 2;
    return;
  }
  const inputs = parseInputs();
  const { artifact } = await buildTradesRuns({ inputs });
  const bytes = Buffer.from(`${JSON.stringify(artifact, null, 1)}\n`);
  writeFileSync(OUT_PATH, bytes);
  const manifest = {
    artifactKind: "TR-06_TRADES_RUNS_MANIFEST",
    schemaVersion: "1.0",
    artifact: { path: OUT_PATH, sha256: sha256(bytes) },
    generator: { path: "operations/trades/TR-06/build-trades-runs.mjs", sha256: hashFile("operations/trades/TR-06/build-trades-runs.mjs") },
    inputs: artifact.inputs,
  };
  writeFileSync(MANIFEST_PATH, `${JSON.stringify(manifest, null, 1)}\n`);
  console.log(`TR-06 runs: status=${artifact.status} runs=${artifact.runs.length} blockedBy=${artifact.blockedBy.join(",")}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
