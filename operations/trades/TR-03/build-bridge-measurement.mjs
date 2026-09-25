// Productor del artefacto de medición del puente (TR-03). Fuente:
// TRADES_MODE_PLAN.md TR-03 y docs/canonical/v1_1_1/
// OWNER_PATCH_TRADES_MODE_2026-09-25.md §3-§4.
//
// Este script es I/O: lee filas de trades (NDJSON del extractor de TR-01) y
// filas TOB (NDJSON del extractor TOB de TR-03), y delega TODAS las reglas al
// motor `src/trades-bridge`. No lee ledgers ni resultados de estrategia; la
// única entrada de campañas es el zone plan de TR-02 (identidad y ventana).
//
// El escaneo completo del lago es un job que lanza Bru (TRADES_MODE_PLAN.md:
// "Los agentes de la Oficina NO corren escaneos completos del lago... Los
// escaneos (TR-01, TR-03)... se lanzan como jobs por la ruta de BT-05").
// Comandos del job:
//   python3 operations/trades/TR-01/extract-trades-rows.py --source lake \
//     --area cmdty=NATGAS/area=THE --start 2025-08-12 --end 2026-07-28 \
//     --out /tmp/tr03-gas-the.ndjson
//   python3 operations/trades/TR-01/extract-trades-rows.py --source lake \
//     --area cmdty=POWER/area=DE --start 2025-08-12 --end 2026-07-28 \
//     --out /tmp/tr03-power-de.ndjson
//   python3 operations/trades/TR-03/extract-tob-rows.py --source lake \
//     --area cmdty=NATGAS/area=THE --products G0BQ,G0BM \
//     --start 2025-08-12 --end 2026-07-28 --out /tmp/tr03-tob-gas.json
//   python3 operations/trades/TR-03/extract-tob-rows.py --source lake \
//     --area cmdty=POWER/area=DE --products DEBQ,DEBM \
//     --start 2025-08-12 --end 2026-07-28 --out /tmp/tr03-tob-power.json
//   node operations/trades/TR-03/build-bridge-measurement.mjs \
//     --gas-trades /tmp/tr03-gas-the.ndjson --power-trades /tmp/tr03-power-de.ndjson \
//     --gas-tob /tmp/tr03-tob-gas.json --power-tob /tmp/tr03-tob-power.json
//
// Uso de test/verificación: `--check` recomputa y compara byte a byte con el
// artefacto commiteado.

import { createHash } from "node:crypto";
import { createReadStream, readFileSync, writeFileSync } from "node:fs";
import readline from "node:readline";
import { pathToFileURL } from "node:url";

import {
  BRIDGE_WINDOW,
  FRESHNESS_LIMIT_CANDIDATES_SECONDS,
  OBSERVATION_RULE_LIST,
  SLOT_LABELS,
  SLOT_STEP_SECONDS,
  TRADES_BRIDGE_ACCEPTANCE_TEST,
  TRADES_BRIDGE_VERSION,
  TRADES_MISSIONS,
  TRADES_PATCH_IDENTITY,
  bridgeHalves,
  buildBridgeArtifact,
  createBridgeMeasurementAccumulator,
  tobSlotsDocumentToSeries,
} from "../../../src/trades-bridge/index.mjs";
import { DEFAULT_BROKEN_SPREAD_POLICY } from "../../../src/trades-source/index.mjs";

const ZONE_PLAN_PATH = "operations/trades/TR-02/trades-zone-plan.json";
const GAS_CALENDAR_PATH = "operations/audit/IMP-09/eex-exchange-calendar.json";
const POWER_CALENDAR_PATH = "operations/trades/TR-01/power-de-exchange-calendar.json";
const SPEC_PATH = "docs/canonical/v1_1_1/OWNER_PATCH_TRADES_MODE_2026-09-25.md";
const OUT_PATH = "operations/trades/TR-03/bridge-measurement.json";

export const MARKET_PRODUCTS = Object.freeze({
  GAS_THE: Object.freeze(["G0BM", "G0BQ"]),
  POWER_DE: Object.freeze(["DEBM", "DEBQ"]),
});

const MODULES = [
  "src/trades-bridge/index.mjs",
  "src/trades-bridge/constants.mjs",
  "src/trades-bridge/time.mjs",
  "src/trades-bridge/tob-slots.mjs",
  "src/trades-bridge/observations.mjs",
  "src/trades-bridge/measurement.mjs",
  "src/trades-source/eligibility.mjs",
  "src/trades-source/delete-point-in-time.mjs",
  "src/trades-source/patch0-density.mjs",
  "src/trades-source/coverage.mjs",
  "operations/trades/TR-03/extract-tob-rows.py",
];

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const hashFile = (path) => sha256(readFileSync(path));

function argument(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index === -1 ? fallback : process.argv[index + 1];
}

async function streamNdjsonRows(path, onRow) {
  const lines = readline.createInterface({ input: createReadStream(path), crlfDelay: Infinity });
  for await (const line of lines) {
    if (line.trim() === "") continue;
    const parsed = JSON.parse(line);
    if (parsed._meta) continue;
    onRow(parsed);
  }
}

// Campañas del puente desde el zone plan de TR-02 (identidad y ventana, sin
// precios). La ventana de días sale del calendario del mercado, nunca de la
// presencia de trades (patch 03 §3.4).
export function bridgeCampaignsFromZonePlan(zonePlan, { gasExchangeDays, powerExchangeDays }) {
  const campaigns = [];
  for (const missionKey of Object.keys(TRADES_MISSIONS)) {
    const definition = TRADES_MISSIONS[missionKey];
    const exchangeDays = definition.market === "GAS_THE" ? gasExchangeDays : powerExchangeDays;
    const bridge = zonePlan?.missions?.[missionKey]?.zones?.PUENTE ?? [];
    for (const campaign of bridge) {
      const windowDays = exchangeDays.filter((day) => day >= campaign.windowStart && day <= campaign.windowEnd);
      campaigns.push({
        campaignId: campaign.campaignId,
        market: definition.market,
        mission: missionKey,
        product: campaign.product,
        shortCode: campaign.shortCode,
        maturity: campaign.maturity,
        legacyMaturity: campaign.coverage?.legacyMaturity ?? null,
        windowStart: campaign.windowStart,
        windowEnd: campaign.windowEnd,
        deadline: campaign.deadline,
        windowDays,
      });
    }
  }
  return campaigns;
}

// Núcleo determinista: mismo input -> mismo artefacto. Expuesto para tests.
export function buildMeasurementArtifact({ campaigns, tradesRows, askSeries, brokenSpreadPolicy = DEFAULT_BROKEN_SPREAD_POLICY }) {
  const accumulator = createBridgeMeasurementAccumulator({ campaigns, askSeries, brokenSpreadPolicy });
  accumulator.addRows(tradesRows);
  const built = buildBridgeArtifact({ finished: accumulator.finish(), generatedFrom: { brokenSpreadPolicy } });
  if (!built.ok) throw new Error(`TR-03 HOLD: ${JSON.stringify(built.errors)}`);
  return built.artifact;
}

function assembleArtifact({ markets, campaigns, brokenSpreadPolicy, zonePlanPath, counts }) {
  return {
    artifactKind: "TR-03_BRIDGE_MEASUREMENT",
    schemaVersion: TRADES_BRIDGE_VERSION,
    status: "MEASURED",
    spec: TRADES_PATCH_IDENTITY,
    acceptanceTest: TRADES_BRIDGE_ACCEPTANCE_TEST,
    window: { ...BRIDGE_WINDOW },
    slotsBerlin: SLOT_LABELS,
    slotStepSeconds: SLOT_STEP_SECONDS,
    freshnessLimitsSeconds: FRESHNESS_LIMIT_CANDIDATES_SECONDS,
    observationRules: OBSERVATION_RULE_LIST,
    brokenSpreadPolicy,
    halves: bridgeHalves(BRIDGE_WINDOW),
    generatedFrom: { zonePlan: zonePlanPath, brokenSpreadPolicy },
    counts: { ...counts, campaigns: campaigns.length },
    markets,
  };
}

async function main() {
  const gasTradesPath = argument("--gas-trades");
  const powerTradesPath = argument("--power-trades");
  const gasTobPath = argument("--gas-tob");
  const powerTobPath = argument("--power-tob");
  const zonePlanPath = argument("--zone-plan", ZONE_PLAN_PATH);
  const outPath = argument("--out", OUT_PATH);
  const brokenSpreadPolicy = argument("--broken-spread", DEFAULT_BROKEN_SPREAD_POLICY);
  const check = process.argv.includes("--check");

  for (const [flag, value] of Object.entries({ "--gas-trades": gasTradesPath, "--power-trades": powerTradesPath, "--gas-tob": gasTobPath, "--power-tob": powerTobPath })) {
    if (!value) throw new Error(`Falta ${flag}.`);
  }

  const zonePlan = JSON.parse(readFileSync(zonePlanPath, "utf8"));
  const gasExchangeDays = JSON.parse(readFileSync(GAS_CALENDAR_PATH, "utf8")).exchangeDays;
  const powerExchangeDays = JSON.parse(readFileSync(POWER_CALENDAR_PATH, "utf8")).exchangeDays;
  const campaigns = bridgeCampaignsFromZonePlan(zonePlan, { gasExchangeDays, powerExchangeDays });

  const gasTobRows = JSON.parse(readFileSync(gasTobPath, "utf8"));
  const powerTobRows = JSON.parse(readFileSync(powerTobPath, "utf8"));

  const markets = {};
  let rowsSeen = 0;
  let rowsInScope = 0;
  for (const market of ["GAS_THE", "POWER_DE"]) {
    const marketCampaigns = campaigns.filter((campaign) => campaign.market === market);
    const askSeries = tobSlotsDocumentToSeries(market === "GAS_THE" ? gasTobRows : powerTobRows);
    const accumulator = createBridgeMeasurementAccumulator({ campaigns: marketCampaigns, askSeries, brokenSpreadPolicy });
    await streamNdjsonRows(market === "GAS_THE" ? gasTradesPath : powerTradesPath, (row) => accumulator.addRows([row]));
    const built = buildBridgeArtifact({ finished: accumulator.finish(), generatedFrom: { brokenSpreadPolicy } });
    if (!built.ok) throw new Error(`TR-03 HOLD (${market}): ${JSON.stringify(built.errors)}`);
    Object.assign(markets, built.artifact.markets);
    rowsSeen += built.artifact.counts.rowsSeen;
    rowsInScope += built.artifact.counts.rowsInScope;
  }

  const artifact = assembleArtifact({ markets, campaigns, brokenSpreadPolicy, zonePlanPath, counts: { rowsSeen, rowsInScope } });
  const artifactBytes = Buffer.from(`${JSON.stringify(artifact, null, 2)}\n`);

  if (check) {
    const committed = readFileSync(outPath);
    if (!committed.equals(artifactBytes)) throw new Error("El artefacto de TR-03 no es reproducible desde las entradas.");
    console.log("TR-03 bridge measurement reproducible");
    return;
  }

  writeFileSync(outPath, artifactBytes);
  const manifest = {
    artifactKind: "TR-03_BRIDGE_MEASUREMENT_MANIFEST",
    schemaVersion: "1.0",
    artifact: { path: outPath, sha256: sha256(artifactBytes) },
    generator: { path: "operations/trades/TR-03/build-bridge-measurement.mjs", sha256: hashFile("operations/trades/TR-03/build-bridge-measurement.mjs") },
    modules: MODULES.map((path) => ({ path, sha256: hashFile(path) })),
    inputs: {
      gasTrades: { path: gasTradesPath, sha256: hashFile(gasTradesPath) },
      powerTrades: { path: powerTradesPath, sha256: hashFile(powerTradesPath) },
      gasTob: { path: gasTobPath, sha256: hashFile(gasTobPath) },
      powerTob: { path: powerTobPath, sha256: hashFile(powerTobPath) },
      zonePlan: { path: zonePlanPath, sha256: hashFile(zonePlanPath) },
      gasCalendar: { path: GAS_CALENDAR_PATH, sha256: hashFile(GAS_CALENDAR_PATH) },
      powerCalendar: { path: POWER_CALENDAR_PATH, sha256: hashFile(POWER_CALENDAR_PATH) },
      spec: { path: SPEC_PATH, sha256: hashFile(SPEC_PATH) },
    },
  };
  writeFileSync(`${outPath}.MANIFEST.json`, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`TR-03 bridge measurement: campaigns=${campaigns.length} rowsInScope=${rowsInScope}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
