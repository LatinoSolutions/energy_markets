// One mission per invocation. Reads the standard trade NDJSON and calendar,
// or a Development-only JSON fixture. Campaigns come from TR-02. No bridge or
// sealed OOS observation is passed to the selection engine.
import { createHash } from "node:crypto";
import { closeSync, createReadStream, existsSync, openSync, readFileSync, readSync, writeFileSync } from "node:fs";
import readline from "node:readline";
import { pathToFileURL } from "node:url";
import { measureDevelopmentGrid } from "../../../src/trades-engine/development-grid.mjs";
import { buildTradesFreezeCandidate } from "../../../src/execution-contract/trades-contract.mjs";
import { ZONES } from "../../../src/oos-reservation/trades-zones.mjs";

const OUT = "operations/trades/TR-09/DEVELOPMENT_SELECTION.json";
const ZONES_PATH = "operations/trades/TR-02/trades-zone-plan.json";
const FREEZE_PATH = "operations/trades/TR-04/TRADES_CONTRACT_V1_FREEZE.json";
const MEASUREMENT_PATH = "operations/trades/TR-03/bridge-measurement.json";
const SOURCE_PATH = "operations/trades/TR-01/DATA_SOURCE_DECISION.json";
function binding(path) {
  const hash = createHash("sha256");
  const buffer = Buffer.alloc(16 * 1024 * 1024);
  const fd = openSync(path, "r");
  try {
    let count;
    while ((count = readSync(fd, buffer, 0, buffer.length, null)) > 0) hash.update(buffer.subarray(0, count));
  } finally { closeSync(fd); }
  return { path, sha256: hash.digest("hex") };
}

// The normal extractor emits NDJSON. Select dates before retaining rows, so a
// Development run cannot receive a bridge or sealed OOS observation.
export async function readDevelopmentRows(file) {
  const rows = [];
  const lines = readline.createInterface({ input: createReadStream(file, { encoding: "utf8" }), crlfDelay: Infinity });
  for await (const line of lines) {
    if (!line.trim()) continue;
    const row = JSON.parse(line);
    if (typeof row.TrdDate !== "string") throw new Error("Trade sin TrdDate; extracción Development HOLD.");
    if (row.TrdDate <= "2024-05-31") rows.push(row);
  }
  return rows;
}

export function buildSelectionDocument({ prior = null, missionKey, input, zonePlan, candidate, sources }) {
  const campaigns = zonePlan?.missions?.[missionKey]?.zones?.[ZONES.DEVELOPMENT] ?? [];
  const result = measureDevelopmentGrid({ missionKey, campaigns, rows: input?.rows, exchangeDays: input?.exchangeDays, candidate });
  if (result.status !== "SELECTED") return { ok: false, code: result.code, document: null };
  const sameSources = prior?.sources?.zonePlan?.sha256 === sources.zonePlan.sha256
    && prior?.sources?.measurement?.sha256 === sources.measurement.sha256
    && prior?.sources?.sourceDecision?.sha256 === sources.sourceDecision.sha256
    && prior?.candidateConfigHash === candidate.configHash;
  const byMission = sameSources ? { ...prior.byMission } : {};
  byMission[missionKey] = result.byLimit;
  return { ok: true, code: null, document: { artifactKind: "TR-09_DEVELOPMENT_FRESHNESS_SELECTION", schemaVersion: "1.0", candidateConfigHash: candidate.configHash, metricId: result.selection.metric.id, gridSeconds: result.selection.scores.map((score) => score.seconds), sources: { ...(sameSources ? prior.sources : {}), zonePlan: sources.zonePlan, measurement: sources.measurement, sourceDecision: sources.sourceDecision, [missionKey]: sources.input }, byMission } };
}

async function main() {
  const arg = (name) => { const i = process.argv.indexOf(name); return i < 0 ? null : process.argv[i + 1]; };
  const missionKey = arg("--mission");
  const inputPath = arg("--input");
  const tradesPath = arg("--trades");
  const calendarPath = arg("--calendar");
  if (!missionKey || (inputPath ? (tradesPath || calendarPath) : (!tradesPath || !calendarPath))) {
    throw new Error("Uso: --mission MISSION (--input development-only.json | --trades trades.ndjson --calendar calendar.json)");
  }
  const freeze = JSON.parse(readFileSync(FREEZE_PATH, "utf8"));
  if (freeze.decision !== "HOLD" || !freeze.candidate) throw new Error("Se necesita un candidato TR-04 en HOLD para medir Development.");
  const sources = { zonePlan: binding(ZONES_PATH), measurement: binding(MEASUREMENT_PATH), sourceDecision: binding(SOURCE_PATH), input: inputPath ? binding(inputPath) : { trades: binding(tradesPath), calendar: binding(calendarPath) } };
  const measurement = JSON.parse(readFileSync(MEASUREMENT_PATH, "utf8"));
  const sourceDecision = JSON.parse(readFileSync(SOURCE_PATH, "utf8"));
  const candidate = buildTradesFreezeCandidate({
    measurement, sourceDecision,
    deleteTmSemantics: sourceDecision?.measurements?.deleteTmSemantics?.value ?? sourceDecision?.deleteTmSemantics ?? null,
    generatedFrom: { bridgeMeasurement: MEASUREMENT_PATH, bridgeMeasurementSha256: sources.measurement.sha256, sourceDecision: SOURCE_PATH, developmentSelectionSha256: null },
  });
  const input = inputPath ? JSON.parse(readFileSync(inputPath, "utf8")) : {
    rows: await readDevelopmentRows(tradesPath),
    exchangeDays: JSON.parse(readFileSync(calendarPath, "utf8")).exchangeDays?.filter((day) => day <= "2024-05-31"),
  };
  if (!Array.isArray(input.rows) || !Array.isArray(input.exchangeDays)) throw new Error("Input Development sin rows/exchangeDays; HOLD.");
  const result = buildSelectionDocument({
    prior: existsSync(OUT) ? JSON.parse(readFileSync(OUT, "utf8")) : null,
    missionKey,
    input,
    zonePlan: JSON.parse(readFileSync(ZONES_PATH, "utf8")),
    candidate,
    sources,
  });
  if (!result.ok) throw new Error(`Development grid HOLD: ${result.code}`);
  writeFileSync(OUT, `${JSON.stringify(result.document, null, 1)}\n`);
  console.log(`TR-09 Development: ${missionKey} selected; ${Object.keys(result.document.byMission).length}/4 missions.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch((error) => { console.error(error); process.exitCode = 1; });
