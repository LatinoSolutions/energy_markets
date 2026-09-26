// Builder determinista del zone plan de TR-02. Fuente:
// TRADES_MODE_PLAN.md TR-02 y docs/canonical/v1_1_1/
// OWNER_PATCH_TRADES_MODE_2026-09-25.md §4.
//
// Lee SOLO calendarios (TR-01/IMP-09), reglas de campaña del cliente y la
// identidad de las campaigns del backtest TOB exploratorio (tob-seen-episodes).
// No abre el lago, no lee precios y no corre ningún backtest. Uso:
//   node operations/trades/TR-02/build-trades-zone-plan.mjs
//
// Cobertura por campaign (UI-07): sale de las mediciones de TR-01 que publica la
// cola DATA-01, verificadas por SHA-256 contra su manifest. Sin mediciones, el
// plan queda PENDING_SCAN_JOB; una medición presente pero no verificable (o sólo
// la de un mercado) no se publica: el builder falla cerrado.

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

import {
  EVIDENCE_HORIZON_END,
  registerTobSeenEpisodes,
  reserveTradesZones,
} from "../../../src/oos-reservation/trades-zones.mjs";
import { loadTradesMeasurements, measurementSummary } from "../../../src/trades-source/measurement-artifacts.mjs";

const GAS_CALENDAR_PATH = "operations/audit/IMP-09/eex-exchange-calendar.json";
const POWER_CALENDAR_PATH = "operations/trades/TR-01/power-de-exchange-calendar.json";
const TOB_SEEN_PATH = "operations/trades/TR-02/tob-seen-episodes.json";
const TRADES_DECISION_PATH = "operations/trades/TR-01/DATA_SOURCE_DECISION.json";
const CLIENT_RULES_PATH = "/srv/hot-data/oficina-data/client-inputs/energy-markets/ENERGY_MARKETS_CLIENT_INPUTS_2026-09-23/full-package/01_campaigns/01_shared_campaign_rules.md";
const OUT_PATH = "operations/trades/TR-02/trades-zone-plan.json";
const MANIFEST_PATH = "operations/trades/TR-02/trades-zone-plan.MANIFEST.json";

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const hashFile = (path) => sha256(readFileSync(path));

const gasCalendar = JSON.parse(readFileSync(GAS_CALENDAR_PATH, "utf8"));
const powerCalendar = JSON.parse(readFileSync(POWER_CALENDAR_PATH, "utf8"));
const tobSeen = JSON.parse(readFileSync(TOB_SEEN_PATH, "utf8"));

const { seenCampaignIds, unmapped } = registerTobSeenEpisodes({ tobCampaigns: tobSeen.episodes });

const measurements = Object.values(loadTradesMeasurements("."));
const presentMeasurements = measurements.filter((entry) => entry.present);
const brokenMeasurements = measurements.filter((entry) => !entry.ok);
if (presentMeasurements.length > 0 && brokenMeasurements.length > 0) {
  console.error(JSON.stringify(brokenMeasurements.map(({ code, market, path }) => ({ code, market, path }))));
  throw new Error("Las mediciones de TR-01 no verifican por hash o falta un mercado; el plan de zonas no se publica.");
}
const coverageMeasured = presentMeasurements.length > 0;
const measurementSummaries = coverageMeasured ? measurements.map(measurementSummary) : [];
const brokenSpreadPolicies = [...new Set(measurementSummaries.map((entry) => entry.brokenSpreadPolicy))];
if (brokenSpreadPolicies.length > 1) {
  throw new Error(`Las mediciones de TR-01 declaran políticas de broken spread distintas (${brokenSpreadPolicies.join(", ")}); no se mezclan.`);
}
const coverageRecords = coverageMeasured ? measurements.flatMap((entry) => entry.measurement.coverage) : [];
const measurementHashes = Object.fromEntries(measurementSummaries.map((entry) => [`tradesMeasurement_${entry.market}`, entry.sha256]));

// TR-01 (DATA-01, 2026-09-26): coverage por instrumento y día, sólo trades elegibles.
const coverageStatus = coverageMeasured
  ? {
    source: "TR-01_COVERAGE",
    status: "MEASURED",
    reason: "Cobertura por campaign proyectada desde las mediciones de TR-01 (fuente canónica, verificadas por SHA-256 contra su manifest): días de la ventana con trade elegible y trades elegibles. Un día anterior a dateMin de su mercado no trae datos en la fuente canónica (DATA-02), no es un cero medido.",
    brokenSpreadPolicy: brokenSpreadPolicies[0] ?? null,
    measurements: measurementSummaries,
  }
  : {
    source: "TR-01_COVERAGE",
    status: "PENDING_SCAN_JOB",
    reason: "El escaneo completo de TR-01 (cobertura por instrumento/día) es un job que lanza Bru; hasta que exista, ninguna campaign tiene cobertura y se declara NO_COVERAGE, sin inventar densidades.",
  };

const plan = reserveTradesZones({
  reservationId: "TRADES-ZONES-2026-09-25-1",
  gasExchangeDays: gasCalendar.exchangeDays,
  powerExchangeDays: powerCalendar.exchangeDays,
  coverageRecords,
  horizonEndIso: EVIDENCE_HORIZON_END,
  reservationBinding: {
    cutoffIso: EVIDENCE_HORIZON_END,
    sourceHashes: {
      gasExchangeCalendar: hashFile(GAS_CALENDAR_PATH),
      powerExchangeCalendar: hashFile(POWER_CALENDAR_PATH),
      clientCampaignRules: hashFile(CLIENT_RULES_PATH),
      tradesSourceDecision: hashFile(TRADES_DECISION_PATH),
      tobSeenEpisodes: hashFile(TOB_SEEN_PATH),
      ...measurementHashes,
    },
  },
  tobSeenCampaignIds: seenCampaignIds,
});

// Campaigns con Exchange Days de su ventana anteriores al primer día con trades
// de su mercado en la fuente canónica (dateMin): esos días no son "cero trades
// medidos", son días que la fuente no trae (DATA-02). Se listan fuera de
// `missions` para no alterar el contentHash de la reserva.
function campaignsBeforeSourceStart() {
  const dateMinByMarket = Object.fromEntries(measurementSummaries.map((entry) => [entry.market, entry.dateMin]));
  const exchangeDaysByMarket = { GAS_THE: gasCalendar.exchangeDays, POWER_DE: powerCalendar.exchangeDays };
  const flagged = [];
  for (const mission of Object.values(plan.missions)) {
    const dateMin = dateMinByMarket[mission.market] ?? null;
    if (dateMin === null) continue;
    const exchangeDays = exchangeDaysByMarket[mission.market];
    for (const campaigns of Object.values(mission.zones)) {
      for (const campaign of campaigns) {
        const windowDays = exchangeDays.filter((day) => day >= campaign.windowStart && day <= campaign.windowEnd);
        const daysBeforeSource = windowDays.filter((day) => day < dateMin).length;
        if (daysBeforeSource === 0) continue;
        flagged.push({
          campaignId: campaign.campaignId,
          market: mission.market,
          sourceDateMin: dateMin,
          windowExchangeDays: windowDays.length,
          windowExchangeDaysBeforeSource: daysBeforeSource,
          extent: daysBeforeSource === windowDays.length ? "WINDOW_BEFORE_SOURCE_START" : "WINDOW_PARTIALLY_BEFORE_SOURCE_START",
        });
      }
    }
  }
  return flagged;
}
if (coverageMeasured) {
  coverageStatus.campaignsBeforeSourceStart = campaignsBeforeSourceStart();
}

const output = {
  ...plan,
  coverageStatus,
  provenance: {
    gasExchangeCalendar: GAS_CALENDAR_PATH,
    powerExchangeCalendar: POWER_CALENDAR_PATH,
    tobSeenEpisodes: TOB_SEEN_PATH,
    clientCampaignRules: CLIENT_RULES_PATH,
    unmappedTobEpisodes: unmapped,
  },
};
const outputBytes = Buffer.from(`${JSON.stringify(output, null, 1)}\n`);
writeFileSync(OUT_PATH, outputBytes);

const manifest = {
  artifactKind: "TR-02_TRADES_ZONE_PLAN_MANIFEST",
  schemaVersion: "1.0",
  plan: { path: OUT_PATH, sha256: sha256(outputBytes) },
  generator: { path: "operations/trades/TR-02/build-trades-zone-plan.mjs", sha256: hashFile("operations/trades/TR-02/build-trades-zone-plan.mjs") },
  modules: [
    "src/trades-source/measurement-artifacts.mjs",
    "src/oos-reservation/trades-zones.mjs",
    "src/oos-reservation/trades-windows.mjs",
    "src/oos-reservation/reservation.mjs",
    "src/procurement-contract/campaign-contract.mjs",
  ].map((path) => ({ path, sha256: hashFile(path) })),
  sources: {
    gasExchangeCalendar: { path: GAS_CALENDAR_PATH, sha256: hashFile(GAS_CALENDAR_PATH) },
    powerExchangeCalendar: { path: POWER_CALENDAR_PATH, sha256: hashFile(POWER_CALENDAR_PATH) },
    tobSeenEpisodes: { path: TOB_SEEN_PATH, sha256: hashFile(TOB_SEEN_PATH) },
    clientCampaignRules: { path: CLIENT_RULES_PATH, sha256: hashFile(CLIENT_RULES_PATH) },
    tradesSourceDecision: { path: TRADES_DECISION_PATH, sha256: hashFile(TRADES_DECISION_PATH) },
    ...Object.fromEntries(measurementSummaries.map((entry) => [`tradesMeasurement_${entry.market}`, { path: entry.path, sha256: entry.sha256, manifest: { path: entry.manifestPath, sha256: entry.manifestSha256 } }])),
  },
};
writeFileSync(MANIFEST_PATH, `${JSON.stringify(manifest, null, 1)}\n`);

console.log(`TR-02 zone plan: decision=${plan.decision}; campaigns=${Object.values(plan.missions).reduce((sum, mission) => sum + Object.values(mission.zones).reduce((n, zone) => n + zone.length, 0), 0)}; purge=${plan.purge.length}; bridgeSeen=${plan.bridge.seenCampaignIds.length}; unmapped=${unmapped.length}`);
if (plan.decision !== "RESERVED") {
  console.error(JSON.stringify(plan.blockedBy));
  process.exitCode = 1;
}
