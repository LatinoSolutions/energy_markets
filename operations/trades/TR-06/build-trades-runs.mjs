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
// El run lo lanza Bru por la ruta de jobs de BT-05, que mide el pico de RAM POR
// RUN (memory.peak del cgroup por job). El pico entra como MAPA
// { runKey -> pico } (`TR06_MEMORY_PEAK_JSON` o `--memory-peaks <json>`); un
// valor único NO es una medición por run y no se copia a todos los runs: cada run
// sin entrada en el mapa queda null (nunca un número inventado). Conectar el
// runner para que invoque un job por run es el binding de DATA-01
// (`PLAN_STATUS.md`: "añadir los tipos de job necesarios").
//
// El registro de accesos del OOS es append-only: cada ejecución parte del
// registro persistido en `trades-runs.json` (si existe) y sólo añade aperturas
// nuevas; repetir el mismo run_id es la misma apertura (patch 03 §4). El
// `atUtc` se toma del artefacto previo para que `--check` sea reproducible.
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
import { OBSERVATION_RULE_LIST } from "../../../src/trades-bridge/constants.mjs";
import { accessRegistryFromEntries } from "../../../src/oos-reservation/trades-zones.mjs";
import {
  TRADES_RUN_PHASES,
  TRADES_RUNS_VERSION,
  bridgeDecisionFromStatuses,
  runTradesMissionPhases,
  runTradesRuns,
  tradesRunKey,
} from "../../../src/trades-engine/runs.mjs";

const ZONE_PLAN_PATH = "operations/trades/TR-02/trades-zone-plan.json";
const FREEZE_PATH = "operations/trades/TR-04/TRADES_CONTRACT_V1_FREEZE.json";
const GAS_CALENDAR_PATH = "operations/audit/IMP-09/eex-exchange-calendar.json";
const POWER_CALENDAR_PATH = "operations/trades/TR-01/power-de-exchange-calendar.json";
const OUT_PATH = "operations/trades/TR-06/trades-runs.json";
const MANIFEST_PATH = "operations/trades/TR-06/trades-runs.MANIFEST.json";
// Registro de accesos del OOS append-only (patch 03 §4): una línea JSON por
// apertura. El artefacto publica una foto; este archivo es la fuente persistente.
const ACCESS_REGISTRY_PATH = "operations/trades/TR-06/trades-oos-access.jsonl";
// Decisiones del gate del puente por misión y regla, escritas por los runs del
// puente y leídas por los runs OOS aislados (selector de un solo run). Sin este
// archivo el OOS aislado queda bloqueado (fail-closed).
export const BRIDGE_DECISIONS_PATH = "operations/trades/TR-06/trades-oos-bridge-decisions.json";

// Un mercado por vez: cada misión se corre con el calendario de su mercado, no
// con la unión (patch 03 §3.4: la ventana sale del calendario del mercado).
export const MARKET_RUNS = Object.freeze([
  { market: "GAS_THE", missions: ["GAS_QUARTERLY", "GAS_MONTHLY"], tradesFlag: "--gas-trades", tobFlag: "--gas-tob", calendarPath: GAS_CALENDAR_PATH },
  { market: "POWER_DE", missions: ["POWER_QUARTERLY", "POWER_MONTHLY"], tradesFlag: "--power-trades", tobFlag: "--power-tob", calendarPath: POWER_CALENDAR_PATH },
]);

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const hashFile = (file) => sha256(readFileSync(file));

function argument(flag, args = process.argv) {
  const index = args.indexOf(flag);
  return index === -1 ? null : args[index + 1] ?? null;
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

// El pico de RAM es POR RUN: se acepta un mapa { runKey -> pico }. Un valor único
// (no objeto) no es una medición por run y se descarta; cada run sin entrada queda
// null. Nunca se copia el pico de un run a otro.
export function memoryPeaksFromInput({ memoryPeaksPath = null } = {}) {
  let raw = null;
  if (typeof memoryPeaksPath === "string" && memoryPeaksPath.length > 0) {
    try {
      raw = JSON.parse(readFileSync(memoryPeaksPath, "utf8"));
    } catch {
      return null;
    }
  } else if (typeof process.env.TR06_MEMORY_PEAK_JSON === "string" && process.env.TR06_MEMORY_PEAK_JSON.trim().length > 0) {
    try {
      raw = JSON.parse(process.env.TR06_MEMORY_PEAK_JSON);
    } catch {
      return null;
    }
  }
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return null;
  const entries = Object.entries(raw).filter(([key, value]) => typeof key === "string" && key.length > 0 && value !== null && value !== undefined);
  return entries.length === 0 ? null : Object.fromEntries(entries);
}

function freezeIsFrozen() {
  try {
    return readJson(FREEZE_PATH)?.decision === "FROZEN";
  } catch {
    return false;
  }
}

// Registro append-only: lee las entradas persistidas (una por línea JSON). Sin
// archivo, el registro está vacío (primer run).
export function readAccessRegistry(file = ACCESS_REGISTRY_PATH) {
  let text = "";
  try {
    text = readFileSync(file, "utf8");
  } catch {
    return [];
  }
  const entries = [];
  for (const line of text.split("\n")) {
    if (line.trim().length === 0) continue;
    try {
      const parsed = JSON.parse(line);
      if (parsed && typeof parsed === "object") entries.push(parsed);
    } catch {
      // Una línea corrupta no se inventa ni se reescribe: se omite y queda visible
      // en la ausencia de la apertura.
    }
  }
  return entries;
}

// Append-only (patch 03 §4: "cada lectura del OOS queda en un registro de acceso
// append-only"): TODA lectura que consume el OOS se añade, aunque repita run_id.
// El conteo de aperturas no vive aquí (es por run_id único por misión); este
// archivo es el log de accesos. Se usa como callback `onOosAccess` del motor, que
// lo invoca ANTES de leer el OOS: una caída a mitad de la lectura deja la apertura
// ya persistida.
export function appendAccessRegistry(entries, file = ACCESS_REGISTRY_PATH) {
  const fresh = (entries ?? []).filter((entry) => entry?.consumesOos === true);
  if (fresh.length === 0) return { appended: 0, entries: readAccessRegistry(file) };
  const lines = fresh.map((entry) => `${JSON.stringify(entry)}\n`).join("");
  writeFileSync(file, lines, { flag: "a" });
  return { appended: fresh.length, entries: readAccessRegistry(file) };
}

// Callback de persistencia del productor: cada apertura del OOS se escribe al
// registro append-only en el instante en que el motor la registra (antes de
// leer). Exportado para poder verificar el orden con una ruta temporal en tests.
export function persistOosAccess(entry, file = ACCESS_REGISTRY_PATH) {
  return appendAccessRegistry([entry], file);
}

// Gancho de persistencia: el registro guardado en disco contiene la apertura
// aunque el proceso muera durante la lectura (defecto TR06-OOS-PERSIST-AFTER-READ).
export function createOosAccessPersister(file = ACCESS_REGISTRY_PATH) {
  return (entry) => persistOosAccess(entry, file);
}

// Binding de procedencia del registro append-only en el manifest. Sin archivo
// (aún sin aperturas) se declara ausente, nunca un sha inventado.
export function readRegistryBinding(file = ACCESS_REGISTRY_PATH) {
  try {
    return { path: file, sha256: sha256(readFileSync(file)) };
  } catch {
    return { path: file, sha256: null, present: false };
  }
}

// Vista de APERTURAS del registro: una entrada por (misión, run_id) que consume
// el OOS. El log append-only en disco conserva TODAS las lecturas (incluidas las
// repetidas); el artefacto publica la vista de aperturas para que un relanzamiento
// con el mismo run_id no cambie sus bytes (`--check` reproducible). No oculta el
// conteo: `accessRegistryFromEntries` lo recomputa de las entradas.
export function dedupeAccessLogEntries(entries = []) {
  const seen = new Set();
  const result = [];
  for (const entry of entries) {
    if (entry?.consumesOos === true && entry.mission && entry.runId) {
      const key = `${entry.mission}|${entry.runId}`;
      if (seen.has(key)) continue;
      seen.add(key);
    }
    result.push(entry);
  }
  return result;
}

export async function buildTradesRuns({ inputs, seedRegistry = null, atUtc = null, memoryPeaks = null, codeCommit = null, onOosAccess = null }) {
  const zonePlan = readJson(ZONE_PLAN_PATH);
  const resolvedCommit = codeCommit ?? gitHead();
  const resolvedAtUtc = atUtc ?? new Date().toISOString();
  const resolvedMemoryPeaks = memoryPeaks ?? memoryPeaksFromInput({ memoryPeaksPath: inputs?.["--memory-peaks"] ?? null });
  const dataManifest = {
    zonePlan: { path: ZONE_PLAN_PATH, sha256: hashFile(ZONE_PLAN_PATH) },
    freeze: { path: FREEZE_PATH, sha256: hashFile(FREEZE_PATH) },
    trades: {},
    tob: {},
  };

  const runs = [];
  // Registro append-only: se parte del registro persistido (si existe) y se
  // encadena. El callback `onOosAccess` persiste cada apertura ANTES de leer el
  // OOS (patch 03 §4), así que una caída a mitad de la lectura no deja la lectura
  // sin registro guardado.
  let accessPlan = seedRegistry === null ? null : { ...zonePlan, accessRegistry: seedRegistry };
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
      codeCommit: resolvedCommit,
      dataManifest,
      parameters: { jobKind: "TRADES_BACKTEST", phase: "TR-06" },
      memoryPeaks: resolvedMemoryPeaks,
      atUtc: resolvedAtUtc,
      actor: "Bru",
      missions: market.missions,
      initialAccessPlan: accessPlan,
      onOosAccess,
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
    codeCommit: resolvedCommit,
    inputs: dataManifest,
    memoryPeaks: resolvedMemoryPeaks,
    runs,
    // Vista de aperturas (dedupe por misión+run_id); el log completo de lecturas
    // vive en el registro append-only en disco.
    oosAccess: accessPlan === null ? null : accessRegistryFromEntries(dedupeAccessLogEntries(accessPlan.accessRegistry?.entries ?? [])),
    blockedBy: [...new Set(blockedBy)],
  };
  return { artifact, runs };
}

// Selección de UN solo run (misión, fase y regla) para que BT-05 pueda medir el
// pico de RAM POR RUN: un proceso por run (plan TR-06 "Pico de RAM por run"). El
// proceso completo de las 20 corridas no puede atribuir un pico a cada run.
export function parseRunSelector(args = process.argv) {
  const mission = argument("--mission", args);
  const phase = argument("--phase", args);
  const rule = argument("--rule", args);
  if (mission === null && phase === null && rule === null) return null;
  return {
    mission,
    phase,
    rule,
    bridgeDecision: argument("--bridge-decision", args),
    bridgeDecisionFile: argument("--bridge-decision-file", args),
  };
}

// Decisión del gate del puente para un run OOS aislado: explícita o leída del
// archivo de decisiones (misión -> regla -> decisión) o del artefacto de runs.
// Sin decisión, el OOS queda bloqueado (fail-closed), nunca se asume PASS.
export function readBridgeDecision({ mission, bridgeDecision = null, bridgeDecisionFile = null } = {}) {
  if (typeof bridgeDecision === "string" && bridgeDecision.length > 0) return bridgeDecision;
  if (typeof bridgeDecisionFile !== "string" || bridgeDecisionFile.length === 0) return null;
  let document = null;
  try {
    document = JSON.parse(readFileSync(bridgeDecisionFile, "utf8"));
  } catch {
    return null;
  }
  if (document && typeof document === "object" && !Array.isArray(document)) {
    const forMission = document[mission];
    if (typeof forMission === "string") return forMission;
    if (forMission && typeof forMission === "object" && !Array.isArray(forMission)) {
      // El OOS exige PASS en TODAS las reglas del puente (OOS_BRIDGE_PASS_RULES):
      // una regla sin decisión cuenta como HOLD.
      return bridgeDecisionFromStatuses(OBSERVATION_RULE_LIST.map((rule) => forMission[rule] ?? "HOLD"));
    }
  }
  const runs = Array.isArray(document?.runs) ? document.runs : [];
  const bridgeRuns = runs.filter((run) => run.missionKey === mission && run.phase === TRADES_RUN_PHASES.BRIDGE);
  if (bridgeRuns.length === 0) return null;
  return bridgeDecisionFromStatuses(bridgeRuns.map((run) => run.bridgeGate?.decision ?? "HOLD"));
}

// Escribe la decisión del gate del puente de un run aislado (misión + regla) en
// el archivo de decisiones, preservando las demás misiones/reglas. La usa el run
// del puente; el run OOS aislado la lee.
export function recordBridgeDecision({ mission, observationRule, decision, file = BRIDGE_DECISIONS_PATH } = {}) {
  let document = null;
  try {
    document = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    document = null;
  }
  if (!document || typeof document !== "object" || Array.isArray(document)) document = {};
  const forMission = document[mission] && typeof document[mission] === "object" && !Array.isArray(document[mission])
    ? { ...document[mission] }
    : {};
  forMission[observationRule] = decision ?? "HOLD";
  document[mission] = forMission;
  writeFileSync(file, `${JSON.stringify(document, null, 1)}\n`);
  return document;
}

// Corre EXACTAMENTE un run (misión, fase y regla) por la ruta pura del motor.
// No escribe el artefacto de los 20 runs: el pico de RAM lo mide BT-05 sobre este
// proceso. La apertura del OOS se persiste antes de leer vía `onOosAccess`.
export async function buildSingleTradesRun({
  selector,
  inputs,
  codeCommit = null,
  dataManifest = null,
  memoryPeak = null,
  atUtc = null,
  actor = "Bru",
  onOosAccess = null,
  bridgeDecisionsPath = BRIDGE_DECISIONS_PATH,
} = {}) {
  const mission = selector?.mission ?? null;
  const phase = selector?.phase ?? null;
  const rule = selector?.rule ?? null;
  const market = MARKET_RUNS.find((entry) => entry.missions.includes(mission)) ?? null;
  if (market === null) return { ok: false, code: "UNKNOWN_MISSION", mission, phase, rule, run: null, oos: null };
  if (!Object.values(TRADES_RUN_PHASES).includes(phase)) {
    return { ok: false, code: "UNKNOWN_PHASE", mission, phase, rule, run: null, oos: null };
  }
  if (!OBSERVATION_RULE_LIST.includes(rule)) {
    return { ok: false, code: "UNKNOWN_OBSERVATION_RULE", mission, phase, rule, run: null, oos: null };
  }
  if (!freezeIsFrozen()) {
    return { ok: false, code: "TRADES_CONTRACT_NOT_FROZEN", mission, phase, rule, run: null, oos: null };
  }
  const tradesPath = inputs?.[market.tradesFlag];
  const tobPath = inputs?.[market.tobFlag];
  if (typeof tradesPath !== "string" || tradesPath.length === 0 || typeof tobPath !== "string" || tobPath.length === 0) {
    return { ok: false, code: `MISSING_INPUT_${market.market}`, mission, phase, rule, run: null, oos: null };
  }
  const zonePlan = readJson(ZONE_PLAN_PATH);
  const rows = await readNdjsonRows(tradesPath);
  const tobSeries = tobSlotsDocumentToSeries(readJson(tobPath));
  const exchangeDays = exchangeDaysOf(market.calendarPath);
  const resolvedBridge = phase === TRADES_RUN_PHASES.OOS
    ? readBridgeDecision({ mission, bridgeDecision: selector.bridgeDecision, bridgeDecisionFile: selector.bridgeDecisionFile ?? bridgeDecisionsPath })
    : null;
  const outcome = runTradesMissionPhases({
    phase,
    missionKey: mission,
    observationRule: rule,
    zonePlan,
    rows,
    exchangeDays,
    tobSeries,
    frozenContract: readJson(FREEZE_PATH),
    codeCommit: codeCommit ?? gitHead(),
    dataManifest,
    parameters: { jobKind: "TRADES_BACKTEST", phase: "TR-06" },
    memoryPeak,
    atUtc: atUtc ?? new Date().toISOString(),
    actor,
    bridgeGateDecision: resolvedBridge,
    onOosAccess,
  });
  // Un run del puente deja su decisión para el run OOS aislado de la misma misión
  // (que exige PASS en todas las reglas del puente).
  if (phase === TRADES_RUN_PHASES.BRIDGE && outcome.ok) {
    recordBridgeDecision({ mission, observationRule: rule, decision: outcome.run.bridgeGate?.decision ?? "HOLD", file: bridgeDecisionsPath });
  }
  return {
    ok: outcome.ok,
    code: outcome.code ?? null,
    mission,
    phase,
    rule,
    runKey: tradesRunKey({ market: market.market, missionKey: mission, phase, observationRule: rule }),
    run: outcome.run,
    oos: outcome.oos,
  };
}

function parseInputs() {
  return {
    "--gas-trades": argument("--gas-trades"),
    "--power-trades": argument("--power-trades"),
    "--gas-tob": argument("--gas-tob"),
    "--power-tob": argument("--power-tob"),
    "--memory-peaks": argument("--memory-peaks"),
  };
}

async function main() {
  const inputs = parseInputs();
  const selector = parseRunSelector();
  // Selector de un solo run: un proceso por run (BT-05 mide su pico de RAM).
  if (selector !== null) {
    const market = MARKET_RUNS.find((entry) => entry.missions.includes(selector.mission)) ?? null;
    const peaks = memoryPeaksFromInput({ memoryPeaksPath: inputs["--memory-peaks"] ?? null });
    const result = await buildSingleTradesRun({
      selector,
      inputs,
      memoryPeak: peaks?.[tradesRunKey({
        market: market?.market ?? "",
        missionKey: selector.mission,
        phase: selector.phase,
        observationRule: selector.rule,
      })] ?? null,
      onOosAccess: createOosAccessPersister(),
    });
    if (!result.ok) {
      console.error(`TR-06 single run (${selector.mission}/${selector.phase}/${selector.rule}) bloqueado: ${result.code}`);
      process.exitCode = 2;
      return;
    }
    console.log(`TR-06 single run: ${result.runKey} runId=${result.run.runId} memoryPeak=${result.run.manifest?.memoryPeak ?? "null"}`);
    return;
  }
  if (process.argv.includes("--check")) {
    const committed = readFileSync(OUT_PATH);
    const previous = JSON.parse(committed.toString("utf8"));
    // Reproducible: se reusa el registro persistido, la identidad de código y el
    // mapa de picos del artefacto commiteado; un check NO escribe.
    const seedEntries = readAccessRegistry();
    const seedRegistry = seedEntries.length > 0 ? accessRegistryFromEntries(seedEntries) : (previous.oosAccess ?? null);
    const { artifact } = await buildTradesRuns({
      inputs,
      seedRegistry,
      atUtc: (seedRegistry?.entries ?? []).at(-1)?.atUtc ?? null,
      memoryPeaks: previous.memoryPeaks ?? null,
      codeCommit: previous.codeCommit ?? null,
    });
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
  const seedEntries = readAccessRegistry();
  const seedRegistry = seedEntries.length === 0 ? null : accessRegistryFromEntries(seedEntries);
  const { artifact } = await buildTradesRuns({
    inputs,
    seedRegistry,
    memoryPeaks: memoryPeaksFromInput({ memoryPeaksPath: inputs["--memory-peaks"] ?? null }),
    // Cada apertura del OOS se persiste append-only ANTES de leerla (patch 03 §4):
    // una caída durante la lectura no deja la lectura sin registro guardado.
    onOosAccess: createOosAccessPersister(),
  });
  const bytes = Buffer.from(`${JSON.stringify(artifact, null, 1)}\n`);
  writeFileSync(OUT_PATH, bytes);
  const registryBinding = readRegistryBinding();
  const manifest = {
    artifactKind: "TR-06_TRADES_RUNS_MANIFEST",
    schemaVersion: "1.0",
    artifact: { path: OUT_PATH, sha256: sha256(bytes) },
    generator: { path: "operations/trades/TR-06/build-trades-runs.mjs", sha256: hashFile("operations/trades/TR-06/build-trades-runs.mjs") },
    accessRegistry: registryBinding,
    inputs: artifact.inputs,
  };
  writeFileSync(MANIFEST_PATH, `${JSON.stringify(manifest, null, 1)}\n`);
  console.log(`TR-06 runs: status=${artifact.status} runs=${artifact.runs.length} blockedBy=${artifact.blockedBy.join(",")}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
