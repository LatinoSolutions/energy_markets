// Estado del artefacto de medición del puente (TR-03). Fuente:
// TRADES_MODE_PLAN.md TR-03 y docs/canonical/v1_1_1/
// OWNER_PATCH_TRADES_MODE_2026-09-25.md §3-§4.
//
// El artefacto de medición requiere el escaneo del lago, que es un job lanzado
// por Bru; hasta que corra, no existe `bridge-measurement.json` y este estado lo
// declara explícitamente (PENDING_SCAN_JOB) sin inventar ninguna medición. La
// población del puente (4 misiones, IDs canónicos) sale del zone plan de TR-02.
//
// Uso: node operations/trades/TR-03/build-bridge-status.mjs [--check]

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

import {
  BRIDGE_WINDOW,
  FRESHNESS_LIMIT_CANDIDATES_SECONDS,
  OBSERVATION_RULE_LIST,
  TRADES_BRIDGE_VERSION,
  TRADES_PATCH_IDENTITY,
} from "../../../src/trades-bridge/index.mjs";
import { bridgeCampaignsFromZonePlan } from "./build-bridge-measurement.mjs";

const ZONE_PLAN_PATH = "operations/trades/TR-02/trades-zone-plan.json";
const GAS_CALENDAR_PATH = "operations/audit/IMP-09/eex-exchange-calendar.json";
const POWER_CALENDAR_PATH = "operations/trades/TR-01/power-de-exchange-calendar.json";
const SPEC_PATH = "docs/canonical/v1_1_1/OWNER_PATCH_TRADES_MODE_2026-09-25.md";
const OUT_PATH = "operations/trades/TR-03/BRIDGE_MEASUREMENT_STATUS.json";

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const hashFile = (path) => sha256(readFileSync(path));

const JOB_COMMANDS = [
  "python3 operations/trades/TR-01/extract-trades-rows.py --source lake --area cmdty=NATGAS/area=THE --start 2025-08-12 --end 2026-07-28 --out /tmp/tr03-gas-the.ndjson",
  "python3 operations/trades/TR-01/extract-trades-rows.py --source lake --area cmdty=POWER/area=DE --start 2025-08-12 --end 2026-07-28 --out /tmp/tr03-power-de.ndjson",
  "python3 operations/trades/TR-03/extract-tob-rows.py --source lake --area cmdty=NATGAS/area=THE --products G0BQ,G0BM --start 2025-08-12 --end 2026-07-28 --out /tmp/tr03-tob-gas.json",
  "python3 operations/trades/TR-03/extract-tob-rows.py --source lake --area cmdty=POWER/area=DE --products DEBQ,DEBM --start 2025-08-12 --end 2026-07-28 --out /tmp/tr03-tob-power.json",
  "node operations/trades/TR-03/build-bridge-measurement.mjs --gas-trades /tmp/tr03-gas-the.ndjson --power-trades /tmp/tr03-power-de.ndjson --gas-tob /tmp/tr03-tob-gas.json --power-tob /tmp/tr03-tob-power.json",
];

export function buildBridgeStatus() {
  const zonePlan = JSON.parse(readFileSync(ZONE_PLAN_PATH, "utf8"));
  const gasExchangeDays = JSON.parse(readFileSync(GAS_CALENDAR_PATH, "utf8")).exchangeDays;
  const powerExchangeDays = JSON.parse(readFileSync(POWER_CALENDAR_PATH, "utf8")).exchangeDays;
  const campaigns = bridgeCampaignsFromZonePlan(zonePlan, { gasExchangeDays, powerExchangeDays });
  const byMission = {};
  for (const campaign of campaigns) {
    byMission[campaign.mission] = byMission[campaign.mission] ?? [];
    byMission[campaign.mission].push(campaign.campaignId);
  }
  return {
    artifactKind: "TR-03_BRIDGE_MEASUREMENT_STATUS",
    schemaVersion: TRADES_BRIDGE_VERSION,
    status: "PENDING_SCAN_JOB",
    spec: TRADES_PATCH_IDENTITY,
    window: { ...BRIDGE_WINDOW },
    freshnessLimitsSeconds: FRESHNESS_LIMIT_CANDIDATES_SECONDS,
    observationRules: OBSERVATION_RULE_LIST,
    reason: "Las mediciones del puente requieren el escaneo del lago (trades y TOB), que es un job que lanza Bru. Hasta que exista, no hay bridge-measurement.json y no se inventa ninguna medición.",
    measurementArtifact: "operations/trades/TR-03/bridge-measurement.json",
    measurementManifest: "operations/trades/TR-03/bridge-measurement.MANIFEST.json",
    jobCommands: JOB_COMMANDS,
    bridgeCampaigns: {
      count: campaigns.length,
      byMission: Object.fromEntries(Object.entries(byMission).map(([mission, ids]) => [mission, ids.sort()])),
    },
    provenance: {
      zonePlan: ZONE_PLAN_PATH,
      gasCalendar: GAS_CALENDAR_PATH,
      powerCalendar: POWER_CALENDAR_PATH,
      spec: SPEC_PATH,
    },
  };
}

function main() {
  const status = buildBridgeStatus();
  const bytes = Buffer.from(`${JSON.stringify(status, null, 2)}\n`);
  if (process.argv.includes("--check")) {
    if (!readFileSync(OUT_PATH).equals(bytes)) throw new Error("BRIDGE_MEASUREMENT_STATUS no es reproducible.");
    console.log("TR-03 bridge status reproducible");
    return;
  }
  writeFileSync(OUT_PATH, bytes);
  const manifest = {
    artifactKind: "TR-03_BRIDGE_MEASUREMENT_STATUS_MANIFEST",
    schemaVersion: "1.0",
    artifact: { path: OUT_PATH, sha256: sha256(bytes) },
    generator: { path: "operations/trades/TR-03/build-bridge-status.mjs", sha256: hashFile("operations/trades/TR-03/build-bridge-status.mjs") },
    sources: {
      zonePlan: { path: ZONE_PLAN_PATH, sha256: hashFile(ZONE_PLAN_PATH) },
      gasCalendar: { path: GAS_CALENDAR_PATH, sha256: hashFile(GAS_CALENDAR_PATH) },
      powerCalendar: { path: POWER_CALENDAR_PATH, sha256: hashFile(POWER_CALENDAR_PATH) },
      spec: { path: SPEC_PATH, sha256: hashFile(SPEC_PATH) },
    },
  };
  writeFileSync(`${OUT_PATH}.MANIFEST.json`, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`TR-03 bridge status: campaigns=${status.bridgeCampaigns.count} status=${status.status}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
