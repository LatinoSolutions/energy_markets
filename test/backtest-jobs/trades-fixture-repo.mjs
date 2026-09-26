// Repo mínimo para los tests de BT-07. El productor de TR-06 es un doble pequeño
// con la misma interfaz de línea de comandos que operations/trades/TR-06/
// build-trades-runs.mjs (un run por proceso con --mission/--phase/--rule, código 2
// si queda bloqueado, --assemble al final) y las mismas rutas canónicas relativas
// al cwd. Nunca corre un run real (nota BT-07: "el agente construye y prueba con
// fixtures; no corre runs reales"). `realEntry` copia el src/ y el productor reales
// para el test de extremo a extremo con datos sintéticos diminutos.

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { createTempDir } from "../helpers/tmpdir.mjs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { buildTradesFreezeArtifact } from "../../operations/trades/TR-04/build-trades-freeze.mjs";
import { TRADES_FREEZE_SCOPE } from "../../src/execution-contract/index.mjs";
import {
  OWNER_FREEZE_APPROVAL_PATH,
  TRADES_ENTRY,
  TRADES_SCRATCH_INPUTS,
} from "../../src/backtest-jobs/index.mjs";
import { tradesBridgeMeasurement } from "../trades-engine/fixtures.mjs";

const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");

export const FREEZE_PATH = "operations/trades/TR-04/TRADES_CONTRACT_V1_FREEZE.json";
export const FREEZE_MANIFEST_PATH = "operations/trades/TR-04/TRADES_CONTRACT_V1_FREEZE.MANIFEST.json";
export const ZONE_PLAN_PATH = "operations/trades/TR-02/trades-zone-plan.json";
export const GAS_CALENDAR_PATH = "operations/audit/IMP-09/eex-exchange-calendar.json";
export const POWER_CALENDAR_PATH = "operations/trades/TR-01/power-de-exchange-calendar.json";
export const ACCESS_REGISTRY = "operations/trades/TR-06/trades-oos-access.jsonl";
const CALLS_FILE = "fixture-calls.jsonl";
const CONFIG_FILE = "fixture-tr06.json";

// Doble de TR-06. Config en fixture-tr06.json (cwd): bridge PASS|HOLD, failAt
// <runKey> (sale 3 sin artefacto), touchScratchAt <runKey> (cambia el TOB de gas),
// hideMixedVersions (el ensamblado no declara runs de otra versión).
const FAKE_TR06 = `import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { FIXTURE_LABEL } from "../../../src/fixture-lib.mjs";

const args = process.argv.slice(2);
const arg = (flag) => { const index = args.indexOf(flag); return index === -1 ? null : args[index + 1]; };
const config = existsSync("${CONFIG_FILE}") ? JSON.parse(readFileSync("${CONFIG_FILE}", "utf8")) : {};
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const commit = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const RUNS = "operations/trades/TR-06/runs";
mkdirSync(RUNS, { recursive: true });
const inputs = {};
for (const flag of ["--gas-trades", "--power-trades", "--gas-tob", "--power-tob"]) inputs[flag] = { path: arg(flag), sha256: sha(readFileSync(arg(flag))) };
appendFileSync("${CALLS_FILE}", JSON.stringify({ args, cwd: process.cwd(), entry: process.argv[1], label: FIXTURE_LABEL }) + "\\n");

if (args.includes("--assemble")) {
  const files = readdirSync(RUNS).filter((name) => name.endsWith(".json")).sort();
  const runArtifacts = files.map((name) => { const bytes = readFileSync(RUNS + "/" + name); return { runKey: JSON.parse(bytes).runKey, path: RUNS + "/" + name, sha256: sha(bytes) }; });
  const runs = files.map((name) => JSON.parse(readFileSync(RUNS + "/" + name, "utf8"))).filter((artifact) => artifact.run).map((artifact) => artifact.run);
  const versions = new Set(files.map((name) => { const run = JSON.parse(readFileSync(RUNS + "/" + name, "utf8")); return run.codeCommit + "|" + JSON.stringify(run.inputs); }));
  const blockedBy = versions.size > 1 && config.hideMixedVersions !== true ? ["RUN_ARTIFACTS_MIXED_VERSIONS"] : [];
  const artifact = { artifactKind: "TR-06_TRADES_RUNS", status: runArtifacts.length === 20 && blockedBy.length === 0 ? "RUN" : "BLOCKED", runs, blockedBy };
  const bytes = Buffer.from(JSON.stringify(artifact, null, 1) + "\\n");
  writeFileSync("operations/trades/TR-06/trades-runs.json", bytes);
  writeFileSync("operations/trades/TR-06/trades-runs.MANIFEST.json", JSON.stringify({ artifact: { path: "operations/trades/TR-06/trades-runs.json", sha256: sha(bytes) }, runArtifacts }, null, 1));
  process.exit(0);
}

const mission = arg("--mission");
const phase = arg("--phase");
const rule = arg("--rule");
const runKey = (mission.startsWith("GAS") ? "GAS_THE" : "POWER_DE") + "|" + mission + "|" + phase + "|" + rule;
if (config.failAt === runKey) {
  console.error("fixture: fallo forzado");
  process.exit(3);
}
if (config.touchScratchAt === runKey) appendFileSync(arg("--gas-tob"), " ");
const runId = "BT-RUN-" + sha(JSON.stringify({ commit, inputs, runKey }));
const write = (extra) => writeFileSync(RUNS + "/" + runKey.replaceAll("|", "__") + ".json", JSON.stringify({ artifactKind: "TR-06_TRADES_RUN", runKey, missionKey: mission, phase, observationRule: rule, codeCommit: commit, inputs, ...extra }, null, 1) + "\\n");
if (phase === "OOS") {
  if ((config.bridge ?? "PASS") !== "PASS") {
    write({ run: null, oosAccess: null, blockedBy: ["OOS_NOT_OPENED_BRIDGE_GATE_NOT_PASS"] });
    process.exit(2);
  }
  const opening = { consumesOos: true, mission, runId, atUtc: new Date().toISOString(), purpose: "TRADES_OOS_OPENING" };
  appendFileSync("${ACCESS_REGISTRY}", JSON.stringify(opening) + "\\n");
  write({ run: { runId }, oosAccess: opening, blockedBy: [] });
  process.exit(0);
}
write({ run: { runId, bridgeGate: phase === "BRIDGE" ? { decision: config.bridge ?? "PASS" } : null }, oosAccess: null, blockedBy: [] });
`;

// Freeze de TR-04 con la forma real del artefacto en disco (buildTradesFreezeArtifact)
// sobre la medición sintética de los fixtures de TR-05.
export function freezeFixture({ approved = true, approvalConfigHash = null } = {}) {
  const measurement = tradesBridgeMeasurement();
  const sourceDecision = { deleteTmSemantics: "deletion-time" };
  const inputsPresent = { measurement: true };
  const candidate = buildTradesFreezeArtifact({ measurement, sourceDecision, inputsPresent }).artifact;
  const approval = {
    approvalRef: "BRU-TRADES-FREEZE-FIXTURE",
    approvedBy: { authority: "Bru", role: "OWNER" },
    decision: "APPROVED",
    scope: TRADES_FREEZE_SCOPE,
    approvedAtUtc: "2026-09-26T00:00:00Z",
    configHash: approvalConfigHash ?? candidate.humanGate.configHash,
  };
  const { artifact } = buildTradesFreezeArtifact({ measurement, sourceDecision, inputsPresent: { ...inputsPresent, ownerApproval: approved }, ownerApproval: approved ? approval : null });
  return { artifact, approval };
}

export function writeFreeze(repo, { approved = true, approvalConfigHash = null, writeApproval = approved } = {}) {
  const { artifact, approval } = freezeFixture({ approved, approvalConfigHash });
  const freezeBytes = repo.write(FREEZE_PATH, `${JSON.stringify(artifact, null, 1)}\n`);
  const approvalBytes = writeApproval ? repo.write(OWNER_FREEZE_APPROVAL_PATH, `${JSON.stringify(approval, null, 1)}\n`) : null;
  repo.write(FREEZE_MANIFEST_PATH, JSON.stringify({
    artifactKind: "TR-04_TRADES_CONTRACT_V1_FREEZE_MANIFEST",
    artifact: { path: FREEZE_PATH, sha256: sha(freezeBytes) },
    sources: { ownerApproval: approvalBytes === null ? null : { path: OWNER_FREEZE_APPROVAL_PATH, sha256: sha(approvalBytes) } },
  }, null, 1));
  return { artifact, approval };
}

export function makeTradesFixtureRepo({ approved = true, realEntry = false, scratch = null } = {}) {
  const root = createTempDir("bt07-repo-");
  const scratchDir = createTempDir("bt07-scratch-");
  const write = (relative, content) => {
    const target = path.join(root, relative);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, content);
    return readFileSync(target);
  };
  if (realEntry) {
    cpSync(path.join(REPO_ROOT, "src"), path.join(root, "src"), { recursive: true });
    write(TRADES_ENTRY, readFileSync(path.join(REPO_ROOT, TRADES_ENTRY)));
    for (const file of [ZONE_PLAN_PATH, GAS_CALENDAR_PATH, POWER_CALENDAR_PATH]) write(file, readFileSync(path.join(REPO_ROOT, file)));
  } else {
    write("src/fixture-lib.mjs", 'export const FIXTURE_LABEL = "committed";\n');
    write(TRADES_ENTRY, FAKE_TR06);
    write(ZONE_PLAN_PATH, JSON.stringify({ decision: "RESERVED" }));
    write(GAS_CALENDAR_PATH, JSON.stringify({ exchangeDays: ["2025-09-01"] }));
    write(POWER_CALENDAR_PATH, JSON.stringify({ exchangeDays: ["2025-09-01"] }));
  }
  writeFreeze({ write }, { approved });
  for (const input of TRADES_SCRATCH_INPUTS) {
    const content = scratch?.[input.flag] ?? (input.file.endsWith(".ndjson") ? `{"fixture":"${input.flag}"}\n` : JSON.stringify({ series: {} }));
    writeFileSync(path.join(scratchDir, input.file), content);
  }
  write(".gitignore", `operations/backtest-runs/\n${CALLS_FILE}\n${CONFIG_FILE}\n`);
  const git = (...args) => execFileSync("git", ["-c", "user.name=bt07", "-c", "user.email=bt07@test", ...args], { cwd: root, stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
  git("init", "-q", "-b", "main");
  const commitAll = (message) => {
    git("add", "-A");
    git("commit", "-q", "-m", message);
    return git("rev-parse", "HEAD");
  };
  commitAll("fixture");
  const calls = () => {
    const file = path.join(root, CALLS_FILE);
    if (!existsSync(file)) return [];
    return readFileSync(file, "utf8").split("\n").filter((line) => line.length > 0).map((line) => JSON.parse(line));
  };
  const openings = () => {
    const file = path.join(root, ACCESS_REGISTRY);
    if (!existsSync(file)) return [];
    return readFileSync(file, "utf8").split("\n").filter((line) => line.length > 0).map((line) => JSON.parse(line));
  };
  const setConfig = (config) => writeFileSync(path.join(root, CONFIG_FILE), JSON.stringify(config));
  return { root, scratchDir, write, git, commitAll, calls, openings, setConfig, head: () => git("rev-parse", "HEAD") };
}
