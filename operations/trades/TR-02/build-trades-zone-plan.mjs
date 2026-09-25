// Builder determinista del zone plan de TR-02. Fuente:
// TRADES_MODE_PLAN.md TR-02 y docs/canonical/v1_1_1/
// OWNER_PATCH_TRADES_MODE_2026-09-25.md §4.
//
// Lee SOLO calendarios (TR-01/IMP-09), reglas de campaña del cliente y la
// identidad de las campaigns del backtest TOB exploratorio (tob-seen-episodes).
// No abre el lago, no lee precios y no corre ningún backtest. Uso:
//   node operations/trades/TR-02/build-trades-zone-plan.mjs
//
// La cobertura por campaign de TR-01 todavía no existe: el escaneo completo es
// un job que lanza Bru. Por eso las campaigns quedan con `NO_COVERAGE` honesto;
// cuando el job produzca el artefacto, se pasa por `coverageRecords`.

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

import {
  EVIDENCE_HORIZON_END,
  registerTobSeenEpisodes,
  reserveTradesZones,
} from "../../../src/oos-reservation/trades-zones.mjs";

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

const plan = reserveTradesZones({
  reservationId: "TRADES-ZONES-2026-09-25-1",
  gasExchangeDays: gasCalendar.exchangeDays,
  powerExchangeDays: powerCalendar.exchangeDays,
  coverageRecords: [],
  horizonEndIso: EVIDENCE_HORIZON_END,
  reservationBinding: {
    cutoffIso: EVIDENCE_HORIZON_END,
    sourceHashes: {
      gasExchangeCalendar: hashFile(GAS_CALENDAR_PATH),
      powerExchangeCalendar: hashFile(POWER_CALENDAR_PATH),
      clientCampaignRules: hashFile(CLIENT_RULES_PATH),
      tradesSourceDecision: hashFile(TRADES_DECISION_PATH),
      tobSeenEpisodes: hashFile(TOB_SEEN_PATH),
    },
  },
  tobSeenCampaignIds: seenCampaignIds,
});

const output = {
  ...plan,
  coverageStatus: {
    source: "TR-01_COVERAGE",
    status: "PENDING_SCAN_JOB",
    reason: "El escaneo completo de TR-01 (cobertura por instrumento/día) es un job que lanza Bru; hasta que exista, ninguna campaign tiene cobertura y se declara NO_COVERAGE, sin inventar densidades.",
  },
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
  },
};
writeFileSync(MANIFEST_PATH, `${JSON.stringify(manifest, null, 1)}\n`);

console.log(`TR-02 zone plan: decision=${plan.decision}; campaigns=${Object.values(plan.missions).reduce((sum, mission) => sum + Object.values(mission.zones).reduce((n, zone) => n + zone.length, 0), 0)}; purge=${plan.purge.length}; bridgeSeen=${plan.bridge.seenCampaignIds.length}; unmapped=${unmapped.length}`);
if (plan.decision !== "RESERVED") {
  console.error(JSON.stringify(plan.blockedBy));
  process.exitCode = 1;
}
