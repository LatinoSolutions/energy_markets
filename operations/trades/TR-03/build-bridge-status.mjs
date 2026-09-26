// Estado del artefacto de medición del puente (TR-03). Fuente:
// TRADES_MODE_PLAN.md TR-03 y docs/canonical/v1_1_1/
// OWNER_PATCH_TRADES_MODE_2026-09-25.md §3-§4.
//
// El artefacto de medición lo produce un job (cola DATA-01). Sin él, este estado
// declara PENDING_SCAN_JOB sin inventar ninguna medición. Con él (UI-07), pasa a
// MEASURED sólo si su SHA-256 es el de su manifest y la población de campaigns
// medida es la del puente del zone plan vigente; si no, queda
// MEASUREMENT_UNVERIFIED o MEASUREMENT_STALE con su causa. La población del
// puente (4 misiones, IDs canónicos) sale del zone plan de TR-02.
//
// Uso: node operations/trades/TR-03/build-bridge-status.mjs [--check]

import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
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
const MEASUREMENT_PATH = "operations/trades/TR-03/bridge-measurement.json";
const MEASUREMENT_MANIFEST_PATH = "operations/trades/TR-03/bridge-measurement.MANIFEST.json";

const sha256Of = (bytes) => createHash("sha256").update(bytes).digest("hex");
const hashFile = (path) => sha256Of(readFileSync(path));

const JOB_COMMANDS = [
  "python3 operations/trades/TR-01/extract-trades-rows.py --source lake --area cmdty=NATGAS/area=THE --start 2025-08-12 --end 2026-07-28 --out /tmp/tr03-gas-the.ndjson",
  "python3 operations/trades/TR-01/extract-trades-rows.py --source lake --area cmdty=POWER/area=DE --start 2025-08-12 --end 2026-07-28 --out /tmp/tr03-power-de.ndjson",
  "python3 operations/trades/TR-03/extract-tob-rows.py --source lake --area cmdty=NATGAS/area=THE --products G0BQ,G0BM --start 2025-08-12 --end 2026-07-28 --out /tmp/tr03-tob-gas.json",
  "python3 operations/trades/TR-03/extract-tob-rows.py --source lake --area cmdty=POWER/area=DE --products DEBQ,DEBM --start 2025-08-12 --end 2026-07-28 --out /tmp/tr03-tob-power.json",
  "node operations/trades/TR-03/build-bridge-measurement.mjs --gas-trades /tmp/tr03-gas-the.ndjson --power-trades /tmp/tr03-power-de.ndjson --gas-tob /tmp/tr03-tob-gas.json --power-tob /tmp/tr03-tob-power.json",
];

function campaignIdsByMission(campaignIdsWithMission) {
  const byMission = {};
  for (const { mission, campaignId } of campaignIdsWithMission) {
    byMission[mission] = byMission[mission] ?? [];
    byMission[mission].push(campaignId);
  }
  return Object.fromEntries(Object.keys(byMission).sort().map((mission) => [mission, byMission[mission].sort()]));
}

function measuredCampaignIds(measurement) {
  return Object.values(measurement?.markets ?? {}).flatMap((market) =>
    Object.values(market?.missions ?? {}).flatMap((mission) =>
      (mission?.campaigns ?? []).map((campaign) => ({ mission: campaign.mission, campaignId: campaign.campaignId }))));
}

const PENDING_REASON = "Las mediciones del puente requieren el escaneo (trades y TOB), que es un job de la cola DATA-01. Hasta que exista, no hay bridge-measurement.json y no se inventa ninguna medición.";

// Verificación de la medición: bytes contra su manifest y población contra el
// puente del zone plan vigente. `bytes`/`manifest` null = el job no corrió.
export function verifyBridgeMeasurement({ bytes, manifest, zonePlanSha256, bridgeByMission }) {
  if (bytes === null) {
    return { status: "PENDING_SCAN_JOB", reason: PENDING_REASON, measurement: null };
  }
  const sha256 = sha256Of(bytes);
  const declared = manifest?.artifact;
  if (declared?.path !== MEASUREMENT_PATH || declared?.sha256 !== sha256) {
    return {
      status: "MEASUREMENT_UNVERIFIED",
      reason: "bridge-measurement.json existe pero su SHA-256 no es el que declara bridge-measurement.MANIFEST.json (o el manifest falta); no se acredita ninguna medición.",
      measurement: { path: MEASUREMENT_PATH, sha256, manifestPath: MEASUREMENT_MANIFEST_PATH, code: manifest ? "HASH_MISMATCH" : "MANIFEST_MISSING" },
    };
  }
  const measurement = JSON.parse(bytes.toString("utf8"));
  const measuredByMission = campaignIdsByMission(measuredCampaignIds(measurement));
  const populationMatches = JSON.stringify(measuredByMission) === JSON.stringify(bridgeByMission);
  const binding = {
    path: MEASUREMENT_PATH,
    sha256,
    manifestPath: MEASUREMENT_MANIFEST_PATH,
    artifactStatus: measurement.status ?? null,
    brokenSpreadPolicy: measurement.brokenSpreadPolicy ?? null,
    measuredWithZonePlanSha256: manifest?.inputs?.zonePlan?.sha256 ?? null,
    currentZonePlanSha256: zonePlanSha256,
    bridgePopulationMatches: populationMatches,
  };
  if (measurement.status !== "MEASURED") {
    return { status: "MEASUREMENT_UNVERIFIED", reason: `bridge-measurement.json declara status "${String(measurement.status)}", no MEASURED.`, measurement: binding };
  }
  if (!populationMatches) {
    return {
      status: "MEASUREMENT_STALE",
      reason: "La medición del puente cubre otra población de campaigns que el puente del zone plan vigente; hay que volver a medir con el plan actual.",
      measurement: binding,
    };
  }
  // El zone plan cambia cuando cambia su cobertura TR-01 o su binding, no sólo su
  // población; lo que ata la medición al plan vigente es la población medida.
  return {
    status: "MEASURED",
    reason: "Medición del puente atada por SHA-256 a su manifest; mide exactamente las campaigns del puente del zone plan vigente.",
    measurement: binding,
  };
}

export function buildBridgeStatus() {
  const zonePlanBytes = readFileSync(ZONE_PLAN_PATH);
  const zonePlan = JSON.parse(zonePlanBytes.toString("utf8"));
  const gasExchangeDays = JSON.parse(readFileSync(GAS_CALENDAR_PATH, "utf8")).exchangeDays;
  const powerExchangeDays = JSON.parse(readFileSync(POWER_CALENDAR_PATH, "utf8")).exchangeDays;
  const campaigns = bridgeCampaignsFromZonePlan(zonePlan, { gasExchangeDays, powerExchangeDays });
  const byMission = campaignIdsByMission(campaigns);
  const verified = verifyBridgeMeasurement({
    bytes: existsSync(MEASUREMENT_PATH) ? readFileSync(MEASUREMENT_PATH) : null,
    manifest: existsSync(MEASUREMENT_MANIFEST_PATH) ? JSON.parse(readFileSync(MEASUREMENT_MANIFEST_PATH, "utf8")) : null,
    zonePlanSha256: sha256Of(zonePlanBytes),
    bridgeByMission: byMission,
  });
  return {
    artifactKind: "TR-03_BRIDGE_MEASUREMENT_STATUS",
    schemaVersion: TRADES_BRIDGE_VERSION,
    status: verified.status,
    spec: TRADES_PATCH_IDENTITY,
    window: { ...BRIDGE_WINDOW },
    freshnessLimitsSeconds: FRESHNESS_LIMIT_CANDIDATES_SECONDS,
    observationRules: OBSERVATION_RULE_LIST,
    reason: verified.reason,
    measurementArtifact: MEASUREMENT_PATH,
    measurementManifest: MEASUREMENT_MANIFEST_PATH,
    measurement: verified.measurement,
    jobCommands: JOB_COMMANDS,
    bridgeCampaigns: {
      count: campaigns.length,
      byMission,
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
    artifact: { path: OUT_PATH, sha256: sha256Of(bytes) },
    generator: { path: "operations/trades/TR-03/build-bridge-status.mjs", sha256: hashFile("operations/trades/TR-03/build-bridge-status.mjs") },
    sources: {
      zonePlan: { path: ZONE_PLAN_PATH, sha256: hashFile(ZONE_PLAN_PATH) },
      gasCalendar: { path: GAS_CALENDAR_PATH, sha256: hashFile(GAS_CALENDAR_PATH) },
      powerCalendar: { path: POWER_CALENDAR_PATH, sha256: hashFile(POWER_CALENDAR_PATH) },
      spec: { path: SPEC_PATH, sha256: hashFile(SPEC_PATH) },
      ...(status.measurement?.sha256 && status.status !== "MEASUREMENT_UNVERIFIED"
        ? {
          measurement: { path: MEASUREMENT_PATH, sha256: status.measurement.sha256 },
          measurementManifest: { path: MEASUREMENT_MANIFEST_PATH, sha256: hashFile(MEASUREMENT_MANIFEST_PATH) },
        }
        : {}),
    },
  };
  writeFileSync(`${OUT_PATH}.MANIFEST.json`, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`TR-03 bridge status: campaigns=${status.bridgeCampaigns.count} status=${status.status}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
