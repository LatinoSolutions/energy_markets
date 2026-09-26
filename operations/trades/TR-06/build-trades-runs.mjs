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
// UN SOLO CAMINO por run (plan TR-06 "Pico de RAM por run"): cada proceso corre
// EXACTAMENTE un run (misión, fase y regla) y guarda su artefacto por runKey; el
// pico de RAM lo mide BT-05 sobre ese proceso. No hay un productor "completo" que
// corra los 20 runs: eso duplicaba la apertura del OOS (el run aislado abría el
// sello otra vez, con otro run_id, y contaba dos aperturas por misión). La vista
// agregada `trades-runs.json` la ENSAMBLA `--assemble` a partir de los artefactos
// por run, sin volver a leer el OOS.
//
// El identificador de cada run se liga a los datos de entrada: `dataManifest`
// lleva el sha256 de la zona plan, del freeze y de los archivos de trades/TOB, así
// que dos corridas con los mismos inputs dan el mismo run_id y una con otros
// inputs da otro (una apertura nueva, que se cuenta).
//
// El registro de accesos del OOS es append-only: el run OOS parte del registro
// persistido en `trades-oos-access.jsonl` (si existe), así ve las aperturas
// anteriores y no informa "1 apertura" desde cero. Cada lectura deja su entrada;
// el conteo de aperturas es por run_id único por misión (patch 03 §4).
//
// Uso (un proceso por run, BT-05 mide el pico de RAM de cada uno):
//   node operations/trades/TR-06/build-trades-runs.mjs \
//     --mission GAS_QUARTERLY --phase OOS --rule LAST_TRADE \
//     --gas-trades /tmp/tr06-gas-the.ndjson --gas-tob /tmp/tr06-tob-gas.json
//   node operations/trades/TR-06/build-trades-runs.mjs --assemble
//   node operations/trades/TR-06/build-trades-runs.mjs --check

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { closeSync, createReadStream, mkdirSync, openSync, readFileSync, readSync, writeFileSync } from "node:fs";
import readline from "node:readline";
import { pathToFileURL } from "node:url";

import { canonicalValueSha256 } from "../../../src/pit-views/pit-record.mjs";
import { tobSlotsDocumentToSeries } from "../../../src/trades-bridge/tob-slots.mjs";
import { OBSERVATION_RULE_LIST } from "../../../src/trades-bridge/constants.mjs";
import { accessRegistryFromEntries } from "../../../src/oos-reservation/trades-zones.mjs";
import { resolveFrozenConfig } from "../../../src/trades-engine/run.mjs";
import { TRADES_ENGINE_MISSIONS } from "../../../src/trades-engine/missions.mjs";
import {
  TRADES_RUN_PHASES,
  TRADES_RUN_PHASE_ORDER,
  TRADES_RUNS_VERSION,
  bridgeDecisionFromStatuses,
  observationRulesForPhase,
  runTradesMissionPhases,
  tradesRunKey,
} from "../../../src/trades-engine/runs.mjs";

const ZONE_PLAN_PATH = "operations/trades/TR-02/trades-zone-plan.json";
const FREEZE_PATH = "operations/trades/TR-04/TRADES_CONTRACT_V1_FREEZE.json";
const GAS_CALENDAR_PATH = "operations/audit/IMP-09/eex-exchange-calendar.json";
const POWER_CALENDAR_PATH = "operations/trades/TR-01/power-de-exchange-calendar.json";
const OUT_PATH = "operations/trades/TR-06/trades-runs.json";
const MANIFEST_PATH = "operations/trades/TR-06/trades-runs.MANIFEST.json";
// Artefacto por run (plan TR-06 "Pico de RAM por run"): un archivo por runKey con
// su manifest y los hashes de sus inputs. `--assemble` los combina.
export const RUNS_DIR = "operations/trades/TR-06/runs";
// Registro de accesos del OOS append-only (patch 03 §4): una línea JSON por
// lectura. El artefacto publica una foto; este archivo es la fuente persistente.
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
// sha256 de un archivo leído por bloques: los NDJSON de trades de power pesan
// 14.023.282.996 bytes y readFileSync no lee archivos de más de 2 GiB (DATA-01,
// 2026-09-26). Mismo resultado que sha256(readFileSync(path)).
function hashFileStreamed(file) {
  const hash = createHash("sha256");
  const buffer = Buffer.alloc(16 * 1024 * 1024);
  const fd = openSync(file, "r");
  try {
    let bytesRead;
    while ((bytesRead = readSync(fd, buffer, 0, buffer.length, null)) > 0) hash.update(buffer.subarray(0, bytesRead));
  } finally {
    closeSync(fd);
  }
  return hash.digest("hex");
}
const hashFile = (file) => hashFileStreamed(file);

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

function readJsonOrNull(file) {
  try {
    return readJson(file);
  } catch {
    return null;
  }
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

// Binding de un archivo de entrada: path + sha256. Sin archivo legible se declara
// sha256 null (nunca un hash inventado); el run ya falla antes si su input falta.
function fileBinding(file) {
  try {
    return { path: file, sha256: hashFile(file) };
  } catch {
    return { path: file, sha256: null };
  }
}

// Manifest de datos de entrada del run: zona plan, freeze y los trades/TOB de
// cada mercado presente. Es la misma forma para todos los runs (los cuatro flags
// van juntos), así el run_id es estable entre procesos.
export function buildInputManifest(inputs = {}) {
  const manifest = {
    zonePlan: fileBinding(ZONE_PLAN_PATH),
    freeze: fileBinding(FREEZE_PATH),
    trades: {},
    tob: {},
  };
  for (const market of MARKET_RUNS) {
    const tradesPath = inputs?.[market.tradesFlag];
    const tobPath = inputs?.[market.tobFlag];
    if (typeof tradesPath === "string" && tradesPath.length > 0) manifest.trades[market.market] = fileBinding(tradesPath);
    if (typeof tobPath === "string" && tobPath.length > 0) manifest.tob[market.market] = fileBinding(tobPath);
  }
  return manifest;
}

// El artefacto de TR-04 en disco publica el contrato en `frozenContract`
// (operations/trades/TR-04/build-trades-freeze.mjs:81); el motor lo lee de
// `contract` (src/trades-engine/run.mjs:62-66, forma de `evaluateTradesFreeze`).
// Sin esta adaptación un freeze FROZEN aprobado por Bru bloqueaba todos los runs
// con TRADES_CONTRACT_NOT_FROZEN (hallazgo BT07-FREEZE-SHAPE, 2026-09-26).
export function freezeResultFromArtifact(artifact) {
  if (!artifact || typeof artifact !== "object" || Array.isArray(artifact)) return null;
  return { decision: artifact.decision ?? null, contract: artifact.frozenContract ?? null };
}

function freezeIsFrozen() {
  try {
    return readJson(FREEZE_PATH)?.decision === "FROZEN";
  } catch {
    return false;
  }
}

// Ruta del artefacto por run. El runKey usa `|`; en disco se sustituye por `__`.
export function runArtifactPath(runKey, dir = RUNS_DIR) {
  return `${dir}/${String(runKey).replaceAll("|", "__")}.json`;
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

// Plan del OOS con el registro persistido sembrado: el run aislado ve las
// aperturas anteriores (no informa "1 apertura" desde cero) y el conteo de
// aperturas es el real (patch 03 §4).
function seedOosPlan({ zonePlan, registryFile }) {
  const entries = readAccessRegistry(registryFile);
  if (entries.length === 0) return zonePlan;
  return { ...zonePlan, accessRegistry: accessRegistryFromEntries(entries) };
}

// Ensambla la vista agregada `trades-runs.json` a partir de los artefactos por run
// (un proceso por run, plan TR-06 "Pico de RAM por run"). NO corre ninguna
// estrategia ni lee el OOS: sólo lee artefactos ya producidos y el registro de
// accesos persistido. Un runKey sin artefacto queda declarado como bloqueo.
export function assembleTradesRuns({ inputs = null, runsDir = RUNS_DIR, registryFile = ACCESS_REGISTRY_PATH } = {}) {
  const runs = [];
  const artifacts = [];
  const runArtifacts = [];
  const blockedBy = [];
  for (const [missionKey, definition] of Object.entries(TRADES_ENGINE_MISSIONS)) {
    for (const phase of TRADES_RUN_PHASE_ORDER) {
      for (const observationRule of observationRulesForPhase(phase)) {
        const runKey = tradesRunKey({ market: definition.market, missionKey, phase, observationRule });
        const artifactPath = runArtifactPath(runKey, runsDir);
        let bytes = null;
        try {
          bytes = readFileSync(artifactPath);
        } catch {
          bytes = null;
        }
        if (bytes === null) {
          blockedBy.push("MISSING_RUN_ARTIFACT");
          continue;
        }
        const artifact = JSON.parse(bytes.toString("utf8"));
        runArtifacts.push({ runKey, path: artifactPath, sha256: sha256(bytes) });
        artifacts.push(artifact);
        blockedBy.push(...(artifact.blockedBy ?? []));
        if (artifact.run) runs.push(artifact.run);
      }
    }
  }
  const codeCommit = artifacts.find((artifact) => artifact.codeCommit)?.codeCommit ?? null;
  const inputManifest = artifacts.find((artifact) => artifact.inputs)?.inputs ?? (inputs === null ? null : buildInputManifest(inputs));
  const memoryPeaks = {};
  for (const artifact of artifacts) {
    const peak = artifact.run?.manifest?.memoryPeak;
    if (peak !== null && peak !== undefined) memoryPeaks[artifact.runKey] = peak;
  }
  const zonePlan = readJsonOrNull(ZONE_PLAN_PATH);
  return {
    artifact: {
      artifactKind: "TR-06_TRADES_RUNS",
      schemaVersion: TRADES_RUNS_VERSION,
      status: blockedBy.length === 0 ? "RUN" : "BLOCKED",
      spec: { id: "OWNER_PATCH_TRADES_MODE_2026-09-25.md", version: "EM-SPEC-OWNER-PATCH-2026-09-25-03" },
      codeCommit,
      inputs: inputManifest,
      memoryPeaks: Object.keys(memoryPeaks).length === 0 ? null : memoryPeaks,
      runs,
      // Vista de aperturas (dedupe por misión+run_id); el log completo de lecturas
      // vive en el registro append-only en disco.
      oosAccess: zonePlan?.decision === "RESERVED"
        ? accessRegistryFromEntries(dedupeAccessLogEntries(readAccessRegistry(registryFile)))
        : null,
      blockedBy: [...new Set(blockedBy)],
    },
    runs,
    runArtifacts,
  };
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
    bridgeDecisionFile: argument("--bridge-decision-file", args),
  };
}

// Versión a la que se liga una decisión del puente: commit del código, config
// del contrato congelado (TR-04) y hash canónico del manifest de datos de
// entrada. Una decisión PASS sólo vale para la MISMA versión: el OOS histórico
// es "una sola apertura con la versión congelada" (patch 03 §4), así que con otra
// data, otro commit u otro config el OOS no la acepta (fail-closed). El binding
// es todo strings/null, de modo que su comparación es exacta y barata.
export function bridgeDecisionBindingOf({ codeCommit = null, configHash = null, dataManifest = null, dataManifestSha256 = null } = {}) {
  let manifestSha256 = dataManifestSha256 ?? null;
  if (manifestSha256 === null && dataManifest !== null && dataManifest !== undefined) {
    const hashed = canonicalValueSha256(dataManifest);
    manifestSha256 = hashed.ok ? hashed.sha256 : null;
  }
  return { codeCommit: codeCommit ?? null, configHash: configHash ?? null, dataManifestSha256: manifestSha256 };
}

function sameBridgeBinding(left, right) {
  if (!left || !right) return false;
  return left.codeCommit === right.codeCommit
    && left.configHash === right.configHash
    && left.dataManifestSha256 === right.dataManifestSha256;
}

// Decisión del gate del puente para un run OOS aislado: leída del archivo de
// decisiones (misión -> regla -> {decision, binding}) o del artefacto de runs.
// Sin decisión, el OOS queda bloqueado (fail-closed), nunca se asume PASS. Sólo
// se acepta una decisión cuyo binding coincida con `expectedBinding` (la versión
// de ESTE run); sin binding esperado o con otro binding, la regla cuenta como
// HOLD. No hay override sin binding: todo PASS que abre el OOS queda ligado a la
// versión (patch 03 §4, "una sola apertura con la versión congelada").
export function readBridgeDecision({ mission, bridgeDecisionFile = null, expectedBinding = null } = {}) {
  if (typeof bridgeDecisionFile !== "string" || bridgeDecisionFile.length === 0) return null;
  let document = null;
  try {
    document = JSON.parse(readFileSync(bridgeDecisionFile, "utf8"));
  } catch {
    return null;
  }
  if (document && typeof document === "object" && !Array.isArray(document)) {
    const forMission = document[mission];
    // Una decisión sin binding (formato viejo) no habilita PASS: se conserva el
    // FAIL (más severo) y todo lo demás queda HOLD.
    if (typeof forMission === "string") return bridgeDecisionFromStatuses([forMission === "FAIL" ? "FAIL" : "HOLD"]);
    if (forMission && typeof forMission === "object" && !Array.isArray(forMission)) {
      // El OOS exige PASS en TODAS las reglas del puente (OOS_BRIDGE_PASS_RULES):
      // una regla sin decisión cuenta como HOLD, y una decisión de otra versión
      // también (patch 03 §4).
      const statuses = OBSERVATION_RULE_LIST.map((rule) => {
        const entry = forMission[rule];
        const decision = typeof entry === "string" ? entry : entry?.decision ?? "HOLD";
        const binding = typeof entry === "string" ? null : entry?.binding ?? null;
        if (expectedBinding === null || !sameBridgeBinding(binding, expectedBinding)) return "HOLD";
        return decision;
      });
      return bridgeDecisionFromStatuses(statuses);
    }
  }
  const runs = Array.isArray(document?.runs) ? document.runs : [];
  const bridgeRuns = runs.filter((run) => run.missionKey === mission && run.phase === TRADES_RUN_PHASES.BRIDGE);
  if (bridgeRuns.length === 0) return null;
  const statuses = bridgeRuns.map((run) => {
    const binding = bridgeDecisionBindingOf({
      codeCommit: run?.identity?.codeCommit ?? null,
      configHash: run?.identity?.configHash ?? null,
      dataManifestSha256: run?.identity?.dataManifestSha256 ?? null,
    });
    if (expectedBinding === null || !sameBridgeBinding(binding, expectedBinding)) return "HOLD";
    return run.bridgeGate?.decision ?? "HOLD";
  });
  return bridgeDecisionFromStatuses(statuses);
}

// Escribe la decisión del gate del puente de un run aislado (misión + regla) con
// el binding de su versión, preservando las demás misiones/reglas. La usa el run
// del puente (primero HOLD al arrancar, luego la decisión real); el run OOS
// aislado la lee y sólo la acepta si el binding coincide.
export function recordBridgeDecision({ mission, observationRule, decision, binding = null, file = BRIDGE_DECISIONS_PATH } = {}) {
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
  forMission[observationRule] = { decision: decision ?? "HOLD", binding: binding ?? null };
  document[mission] = forMission;
  writeFileSync(file, `${JSON.stringify(document, null, 1)}\n`);
  return document;
}

// Corre EXACTAMENTE un run (misión, fase y regla) por la ruta pura del motor y
// guarda su artefacto por runKey. El pico de RAM lo mide BT-05 sobre este proceso.
// El identificador del run se liga a los datos de entrada (`buildInputManifest`);
// el OOS parte del registro persistido en disco y persiste su apertura antes de
// leer vía `onOosAccess`.
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
  zonePlan = null,
  frozenContract = null,
  exchangeDays = null,
  registryFile = ACCESS_REGISTRY_PATH,
  outputDir = RUNS_DIR,
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
  const resolvedFreeze = frozenContract ?? freezeResultFromArtifact(readJsonOrNull(FREEZE_PATH));
  if (resolvedFreeze?.decision !== "FROZEN") {
    return { ok: false, code: "TRADES_CONTRACT_NOT_FROZEN", mission, phase, rule, run: null, oos: null };
  }
  const tradesPath = inputs?.[market.tradesFlag];
  const tobPath = inputs?.[market.tobFlag];
  if (typeof tradesPath !== "string" || tradesPath.length === 0 || typeof tobPath !== "string" || tobPath.length === 0) {
    return { ok: false, code: `MISSING_INPUT_${market.market}`, mission, phase, rule, run: null, oos: null };
  }
  const resolvedZonePlan = zonePlan ?? readJson(ZONE_PLAN_PATH);
  const resolvedDataManifest = dataManifest ?? buildInputManifest(inputs);
  const resolvedCommit = codeCommit ?? gitHead();
  // Versión del run (data + commit + config congelado) a la que se ligan tanto la
  // decisión que escribe el puente como la que acepta el OOS.
  const binding = bridgeDecisionBindingOf({
    codeCommit: resolvedCommit,
    configHash: resolveFrozenConfig(resolvedFreeze).configHash ?? null,
    dataManifest: resolvedDataManifest,
  });
  // Fail-closed al arrancar: el run del puente escribe HOLD ANTES de cargar los
  // trades. Si el proceso muere (el pico de RAM puede tumbarlo con la data de
  // Power en memoria), el archivo no conserva el PASS de un job anterior hecho
  // con otra data o código (TR06-BRIDGE-DECISION-UNBOUND).
  if (phase === TRADES_RUN_PHASES.BRIDGE) {
    recordBridgeDecision({ mission, observationRule: rule, decision: "HOLD", binding, file: bridgeDecisionsPath });
  }
  // La decisión del puente se lee ANTES de cargar los trades y sólo vale si su
  // binding coincide con la versión de este run.
  const resolvedBridge = phase === TRADES_RUN_PHASES.OOS
    ? readBridgeDecision({
      mission,
      bridgeDecisionFile: selector.bridgeDecisionFile ?? bridgeDecisionsPath,
      expectedBinding: binding,
    })
    : null;
  const rows = await readNdjsonRows(tradesPath);
  const tobSeries = tobSlotsDocumentToSeries(readJson(tobPath));
  const resolvedExchangeDays = exchangeDays ?? exchangeDaysOf(market.calendarPath);
  const oosPlan = phase === TRADES_RUN_PHASES.OOS
    ? seedOosPlan({ zonePlan: resolvedZonePlan, registryFile })
    : null;
  const outcome = runTradesMissionPhases({
    phase,
    missionKey: mission,
    observationRule: rule,
    zonePlan: resolvedZonePlan,
    rows,
    exchangeDays: resolvedExchangeDays,
    tobSeries,
    frozenContract: resolvedFreeze,
    codeCommit: resolvedCommit,
    dataManifest: resolvedDataManifest,
    parameters: { jobKind: "TRADES_BACKTEST", phase: "TR-06" },
    memoryPeak,
    atUtc: atUtc ?? new Date().toISOString(),
    actor,
    oosPlan,
    bridgeGateDecision: resolvedBridge,
    onOosAccess,
  });
  // Un run del puente deja su decisión para el run OOS aislado de la misma misión
  // (que exige PASS en todas las reglas del puente). Se registra SIEMPRE, también
  // cuando el run queda bloqueado (HOLD): una decisión PASS vieja no debe
  // sobrevivir a un puente que ya no da PASS (fail-closed).
  if (phase === TRADES_RUN_PHASES.BRIDGE) {
    recordBridgeDecision({ mission, observationRule: rule, decision: outcome.run?.bridgeGate?.decision ?? "HOLD", binding, file: bridgeDecisionsPath });
  }
  const runKey = tradesRunKey({ market: market.market, missionKey: mission, phase, observationRule: rule });
  const artifact = {
    artifactKind: "TR-06_TRADES_RUN",
    schemaVersion: TRADES_RUNS_VERSION,
    runKey,
    missionKey: mission,
    market: market.market,
    phase,
    observationRule: rule,
    codeCommit: resolvedCommit,
    inputs: resolvedDataManifest,
    run: outcome.run ?? null,
    oosAccess: outcome.oos?.opening ?? null,
    blockedBy: outcome.ok ? [] : [outcome.code ?? "RUN_BLOCKED"],
  };
  const artifactPath = runArtifactPath(runKey, outputDir);
  mkdirSync(outputDir, { recursive: true });
  writeFileSync(artifactPath, `${JSON.stringify(artifact, null, 1)}\n`);
  return {
    ok: outcome.ok,
    code: outcome.code ?? null,
    mission,
    phase,
    rule,
    runKey,
    run: outcome.run ?? null,
    oos: outcome.oos,
    artifact,
    artifactPath,
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
  // Selector de un solo run: un proceso por run (BT-05 mide su pico de RAM). Es el
  // ÚNICO camino que corre estrategia; guarda su artefacto por runKey.
  if (selector !== null) {
    const market = MARKET_RUNS.find((entry) => entry.missions.includes(selector.mission)) ?? null;
    const peaks = memoryPeaksFromInput({ memoryPeaksPath: inputs["--memory-peaks"] ?? null });
    const runKey = tradesRunKey({
      market: market?.market ?? "",
      missionKey: selector.mission,
      phase: selector.phase,
      observationRule: selector.rule,
    });
    const result = await buildSingleTradesRun({
      selector,
      inputs,
      memoryPeak: peaks?.[runKey] ?? null,
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
    // Reproducible y sin tocar el OOS: re-ensambla la vista agregada desde los
    // artefactos por run y el registro persistido, y compara bytes. No ejecuta
    // ninguna lectura del OOS.
    const committed = readFileSync(OUT_PATH);
    const { artifact } = assembleTradesRuns({ inputs });
    const bytes = Buffer.from(`${JSON.stringify(artifact, null, 1)}\n`);
    if (!committed.equals(bytes)) throw new Error("trades-runs.json no es reproducible con los artefactos de run actuales.");
    console.log("TR-06 runs reproducible");
    return;
  }
  if (!freezeIsFrozen()) {
    console.error("TRADES_CONTRACT_NOT_FROZEN: el freeze de TRADES-v1 (TR-04) es un gate humano; sin FROZEN no se corre ningún run.");
    process.exitCode = 2;
    return;
  }
  // Ensambla la vista agregada de los artefactos por run. No corre estrategia ni
  // lee el OOS: cada apertura ya quedó persistida por el run OOS aislado.
  const assembly = assembleTradesRuns({ inputs });
  const { artifact } = assembly;
  const bytes = Buffer.from(`${JSON.stringify(artifact, null, 1)}\n`);
  writeFileSync(OUT_PATH, bytes);
  const registryBinding = readRegistryBinding();
  const manifest = {
    artifactKind: "TR-06_TRADES_RUNS_MANIFEST",
    schemaVersion: "1.0",
    artifact: { path: OUT_PATH, sha256: sha256(bytes) },
    generator: { path: "operations/trades/TR-06/build-trades-runs.mjs", sha256: hashFile("operations/trades/TR-06/build-trades-runs.mjs") },
    accessRegistry: registryBinding,
    runArtifacts: assembly.runArtifacts,
    inputs: artifact.inputs,
  };
  writeFileSync(MANIFEST_PATH, `${JSON.stringify(manifest, null, 1)}\n`);
  console.log(`TR-06 runs: status=${artifact.status} runs=${artifact.runs.length} blockedBy=${artifact.blockedBy.join(",")}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
