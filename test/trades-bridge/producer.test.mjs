import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  MODULES,
  bridgeCampaignsFromZonePlan,
  buildMeasurementArtifact,
} from "../../operations/trades/TR-03/build-bridge-measurement.mjs";
import { askSeries, gasQuarterlyTrade } from "./fixtures.mjs";

const sha256OfFile = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");

function syntheticZonePlan() {
  return {
    missions: {
      GAS_QUARTERLY: {
        zones: {
          PUENTE: [
            {
              campaignId: "GAS-Q-2026Q1",
              product: "Gas",
              shortCode: "G0BQ",
              maturity: "2026Q1",
              windowStart: "2025-09-01",
              windowEnd: "2025-09-02",
              deadline: "2025-09-02",
              coverage: { legacyMaturity: "202601" },
            },
          ],
        },
      },
    },
  };
}

test("las campañas del puente salen del zone plan con windowDays del calendario", () => {
  const campaigns = bridgeCampaignsFromZonePlan(syntheticZonePlan(), {
    gasExchangeDays: ["2025-08-29", "2025-09-01", "2025-09-02", "2025-09-03"],
    powerExchangeDays: [],
  });
  assert.equal(campaigns.length, 1);
  assert.equal(campaigns[0].market, "GAS_THE");
  assert.equal(campaigns[0].mission, "GAS_QUARTERLY");
  assert.deepEqual(campaigns[0].windowDays, ["2025-09-01", "2025-09-02"]);
});

test("la ventana Monthly termina en el deadline de TR-02, no en windowEnd", () => {
  const zonePlan = {
    missions: {
      GAS_MONTHLY: {
        zones: {
          PUENTE: [{
            campaignId: "GAS-M-2025-10",
            product: "Gas",
            shortCode: "G0BM",
            maturity: "2025-10",
            windowStart: "2025-09-01",
            windowEnd: "2025-09-30",
            deadline: "2025-09-29",
            coverage: { legacyMaturity: "202510" },
          }],
        },
      },
    },
  };
  const campaigns = bridgeCampaignsFromZonePlan(zonePlan, {
    gasExchangeDays: ["2025-09-29", "2025-09-30"],
    powerExchangeDays: [],
  });
  assert.equal(campaigns.length, 1);
  // La regla Monthly 1-0-1 excluye el día anterior al inicio de entrega; TR-02
  // ya lo resolvió en el deadline (2025-09-29).
  assert.deepEqual(campaigns[0].windowDays, ["2025-09-29"]);
});

test("buildMeasurementArtifact mide y acepta la superficie sin estrategia", () => {
  const campaigns = bridgeCampaignsFromZonePlan(syntheticZonePlan(), {
    gasExchangeDays: ["2025-09-01", "2025-09-02"],
    powerExchangeDays: [],
  });
  const series = askSeries({ "G0BQ|202601": { "2025-09-01": Array(20).fill({ ask: 100, askSz: 1, bid: 99, quoteTm: null }) } });
  const artifact = buildMeasurementArtifact({
    campaigns,
    askSeries: series,
    tradesRows: [gasQuarterlyTrade({ TrdDate: "2025-09-01", Tm: "2025-09-01T09:00:00Z", Px: "90" })],
  });
  assert.equal(artifact.status, "MEASURED");
  const campaign = artifact.markets.GAS_THE.missions.GAS_QUARTERLY.campaigns[0];
  assert.equal(campaign.gaps.LAST_TRADE.overall.mean, -10);
});

test("el estado del artefacto commiteado es coherente con su manifest y el zone plan", () => {
  const statusPath = "operations/trades/TR-03/BRIDGE_MEASUREMENT_STATUS.json";
  const manifestPath = `${statusPath}.MANIFEST.json`;
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  assert.equal(sha256OfFile(manifest.artifact.path), manifest.artifact.sha256);
  assert.equal(sha256OfFile(manifest.generator.path), manifest.generator.sha256);
  for (const entry of Object.values(manifest.sources)) {
    assert.equal(sha256OfFile(entry.path), entry.sha256, `${entry.path} stale`);
  }
  const status = JSON.parse(readFileSync(statusPath, "utf8"));
  assert.equal(status.status, "PENDING_SCAN_JOB");
  assert.deepEqual(Object.keys(status.bridgeCampaigns.byMission).sort(), ["GAS_MONTHLY", "GAS_QUARTERLY", "POWER_MONTHLY", "POWER_QUARTERLY"]);
  assert.equal(status.bridgeCampaigns.count, 26);
  // El artefacto de medición todavía no existe: el job lo produce.
  assert.equal(status.measurementArtifact, "operations/trades/TR-03/bridge-measurement.json");
});

test("la lista de módulos del manifest cubre las dependencias del motor y del productor", () => {
  const modules = new Set(MODULES);
  const entries = [
    "src/trades-bridge/measurement.mjs",
    "operations/trades/TR-03/build-bridge-measurement.mjs",
  ];
  const importPattern = /from\s+["'](\.[^"']+)["']/g;
  for (const entry of entries) {
    const source = readFileSync(entry, "utf8");
    for (const match of source.matchAll(importPattern)) {
      const resolved = path.normalize(path.join(path.dirname(entry), match[1]));
      assert.ok(modules.has(resolved), `${resolved} (importado por ${entry}) falta en MODULES`);
    }
  }
  // El motor mide con la regla de duplicados de TR-01: si cambia, el hash del
  // manifest tiene que cambiar.
  assert.ok(modules.has("src/trades-source/dedup.mjs"));
  assert.ok(modules.has("src/trades-source/index.mjs"));
});
