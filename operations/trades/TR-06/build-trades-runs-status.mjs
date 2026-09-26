// Estado de los runs TRADES de las 4 misiones (TR-06). Fuente:
// TRADES_MODE_PLAN.md TR-06 y docs/canonical/v1_1_1/
// OWNER_PATCH_TRADES_MODE_2026-09-25.md (EM-SPEC-OWNER-PATCH-2026-09-25-03) §2-§4.
//
// Los runs los lanza Bru desde BT-05, después del freeze de TRADES-v1 (TR-04) y
// con el escaneo de TR-01/TR-03 ya corrido. Hasta que esas precondiciones
// existan, este estado lo declara explícitamente (PENDING_FREEZE) sin inventar
// ningún resultado: la rejilla de runs (4 misiones × 3 fases × 2 reglas) sale de
// la zona plan de TR-02 y del contrato de TR-04, no de un run.
//
// Uso: node operations/trades/TR-06/build-trades-runs-status.mjs [--check]

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

import { OBSERVATION_RULE_LIST } from "../../../src/trades-bridge/constants.mjs";
import { ZONES } from "../../../src/oos-reservation/trades-zones.mjs";
import { TRADES_ENGINE_MISSIONS } from "../../../src/trades-engine/missions.mjs";
import {
  TRADES_PHASE_ZONES,
  TRADES_RUNS_ACCEPTANCE_TEST,
  TRADES_RUNS_VERSION,
  TRADES_RUN_PHASE_ORDER,
  observationRulesForPhase,
} from "../../../src/trades-engine/runs.mjs";
import { TRADES_PATCH_IDENTITY } from "../../../src/trades-bridge/constants.mjs";

const ZONE_PLAN_PATH = "operations/trades/TR-02/trades-zone-plan.json";
const FREEZE_PATH = "operations/trades/TR-04/TRADES_CONTRACT_V1_FREEZE.json";
const SPEC_PATH = "docs/canonical/v1_1_1/OWNER_PATCH_TRADES_MODE_2026-09-25.md";
const OUT_PATH = "operations/trades/TR-06/TRADES_RUNS_STATUS.json";
const RUNS_PATH = "operations/trades/TR-06/trades-runs.json";

// El extractor de trades no puede empezar después de la primera ventana del plan
// de TR-02: un corte tardío dejaría campaigns de Development DATA_INCOMPLETE por
// el corte, no por falta de data (patch 03 §1). El inicio sale del plan, no de
// una constante fija.
export function earliestWindowStart(zonePlan) {
  const starts = [];
  for (const mission of Object.values(zonePlan?.missions ?? {})) {
    for (const campaigns of Object.values(mission?.zones ?? {})) {
      for (const campaign of campaigns ?? []) {
        if (typeof campaign?.windowStart === "string" && campaign.windowStart.length > 0) starts.push(campaign.windowStart);
      }
    }
  }
  if (starts.length === 0) return null;
  return starts.sort()[0];
}

// Comandos del job de TR-06 por la ruta de BT-05: primero los extractores de
// TR-01/TR-03 (trades y TOB por mercado), después el productor de los runs. El
// inicio de la extracción de trades cubre la primera ventana del plan de TR-02.
export function buildJobCommands(zonePlan) {
  const tradesStart = earliestWindowStart(zonePlan) ?? "2021-01-01";
  return [
    `python3 operations/trades/TR-01/extract-trades-rows.py --source lake --area cmdty=NATGAS/area=THE --start ${tradesStart} --end 2026-07-28 --out /tmp/tr06-gas-the.ndjson`,
    `python3 operations/trades/TR-01/extract-trades-rows.py --source lake --area cmdty=POWER/area=DE --start ${tradesStart} --end 2026-07-28 --out /tmp/tr06-power-de.ndjson`,
    "python3 operations/trades/TR-03/extract-tob-rows.py --source lake --area cmdty=NATGAS/area=THE --products G0BQ,G0BM --start 2025-08-12 --end 2026-07-28 --out /tmp/tr06-tob-gas.json",
    "python3 operations/trades/TR-03/extract-tob-rows.py --source lake --area cmdty=POWER/area=DE --products DEBQ,DEBM --start 2025-08-12 --end 2026-07-28 --out /tmp/tr06-tob-power.json",
    "node operations/trades/TR-06/build-trades-runs.mjs --gas-trades /tmp/tr06-gas-the.ndjson --power-trades /tmp/tr06-power-de.ndjson --gas-tob /tmp/tr06-tob-gas.json --power-tob /tmp/tr06-tob-power.json",
  ];
}

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const hashFile = (path) => sha256(readFileSync(path));

function readJson(path) {
  try {
    return { ok: true, json: JSON.parse(readFileSync(path, "utf8")) };
  } catch {
    return { ok: false, json: null };
  }
}

function campaignCountsByZone(zonePlan, missionKey) {
  const zones = zonePlan?.missions?.[missionKey]?.zones ?? {};
  return Object.fromEntries(Object.values(ZONES).map((zone) => [zone, (zones[zone] ?? []).length]));
}

export function buildTradesRunsStatus() {
  const zonePlanRead = readJson(ZONE_PLAN_PATH);
  const freezeRead = readJson(FREEZE_PATH);
  const zonePlan = zonePlanRead.json;
  const freezeDecision = freezeRead.json?.decision ?? "MISSING";

  const missions = Object.entries(TRADES_ENGINE_MISSIONS).map(([missionKey, definition]) => ({
    missionKey,
    market: definition.market,
    product: definition.product,
    shortCode: definition.shortCode,
    targetMw: definition.targetMw,
    campaignsByZone: campaignCountsByZone(zonePlan, missionKey),
  }));
  const runGrid = missions.flatMap((mission) => TRADES_RUN_PHASE_ORDER.flatMap((phase) => observationRulesForPhase(phase).map((observationRule) => ({
    missionKey: mission.missionKey,
    phase,
    zone: TRADES_PHASE_ZONES[phase],
    observationRule,
  }))));

  const blockedBy = [];
  if (freezeDecision !== "FROZEN") blockedBy.push("TRADES_CONTRACT_NOT_FROZEN");
  if (zonePlan?.decision !== "RESERVED") blockedBy.push("ZONE_PLAN_NOT_RESERVED");
  const status = blockedBy.length > 0 ? "PENDING_FREEZE" : "PENDING_RUN_JOB";

  return {
    artifactKind: "TR-06_TRADES_RUNS_STATUS",
    schemaVersion: TRADES_RUNS_VERSION,
    status,
    spec: TRADES_PATCH_IDENTITY,
    acceptanceTest: TRADES_RUNS_ACCEPTANCE_TEST,
    phases: TRADES_RUN_PHASE_ORDER,
    phaseZones: TRADES_PHASE_ZONES,
    observationRules: OBSERVATION_RULE_LIST,
    reason: blockedBy.length > 0
      ? "Los runs TRADES exigen el freeze de TRADES-v1 (TR-04, gate humano) y el escaneo de TR-01/TR-03. Hasta que existan, no se corre ningún run ni se inventa ningún resultado."
      : "Precondiciones listas; el run lo lanza Bru por la ruta de BT-05 con pico de RAM medido.",
    runsArtifact: RUNS_PATH,
    runsManifest: "operations/trades/TR-06/trades-runs.MANIFEST.json",
    jobCommands: buildJobCommands(zonePlan),
    freeze: {
      path: FREEZE_PATH,
      present: freezeRead.ok,
      decision: freezeDecision,
      configHash: freezeRead.json?.humanGate?.configHash ?? null,
    },
    runsGrid: {
      count: runGrid.length,
      missions: missions.map((mission) => mission.missionKey),
      entries: runGrid,
    },
    missions,
    blockedBy,
    provenance: {
      zonePlan: ZONE_PLAN_PATH,
      freeze: FREEZE_PATH,
      spec: SPEC_PATH,
    },
  };
}

function main() {
  const status = buildTradesRunsStatus();
  const bytes = Buffer.from(`${JSON.stringify(status, null, 2)}\n`);
  if (process.argv.includes("--check")) {
    if (!readFileSync(OUT_PATH).equals(bytes)) throw new Error("TRADES_RUNS_STATUS no es reproducible.");
    console.log("TR-06 runs status reproducible");
    return;
  }
  writeFileSync(OUT_PATH, bytes);
  const manifest = {
    artifactKind: "TR-06_TRADES_RUNS_STATUS_MANIFEST",
    schemaVersion: "1.0",
    artifact: { path: OUT_PATH, sha256: sha256(bytes) },
    generator: { path: "operations/trades/TR-06/build-trades-runs-status.mjs", sha256: hashFile("operations/trades/TR-06/build-trades-runs-status.mjs") },
    sources: {
      zonePlan: { path: ZONE_PLAN_PATH, sha256: hashFile(ZONE_PLAN_PATH) },
      freeze: { path: FREEZE_PATH, sha256: hashFile(FREEZE_PATH) },
      spec: { path: SPEC_PATH, sha256: hashFile(SPEC_PATH) },
      runsModule: { path: "src/trades-engine/runs.mjs", sha256: hashFile("src/trades-engine/runs.mjs") },
    },
  };
  writeFileSync(`${OUT_PATH}.MANIFEST.json`, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`TR-06 runs status: runs=${status.runsGrid.count} status=${status.status} blockedBy=${status.blockedBy.join(",")}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
