import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  bridgeCampaignsFromZonePlan,
  buildMeasurementArtifact,
} from "../../operations/trades/TR-03/build-bridge-measurement.mjs";
import { askSeries, gasQuarterlyTrade } from "./fixtures.mjs";

const ENGINE_MODULES = [
  "src/trades-bridge/constants.mjs",
  "src/trades-bridge/time.mjs",
  "src/trades-bridge/tob-slots.mjs",
  "src/trades-bridge/observations.mjs",
  "src/trades-bridge/measurement.mjs",
  "src/trades-bridge/index.mjs",
];
const PRODUCER = "operations/trades/TR-03/build-bridge-measurement.mjs";

const FORBIDDEN_MODULES = /(^|\/)(exploratory|p6-evaluator|p5-experiment|learning|shadow)(\/|\.|$)/;
const FORBIDDEN_LITERALS = [
  "backtest-results",
  "reconciled-results",
  "filledMw",
  "boughtMw",
  "avgPriceEurMwh",
  "costEur",
  "remainingMw",
  "runEpisode",
];

function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

function importSpecifiers(source) {
  const specifiers = [];
  for (const match of source.matchAll(/from\s+["']([^"']+)["']/g)) specifiers.push(match[1]);
  for (const match of source.matchAll(/import\s*\(\s*["']([^"']+)["']\s*\)/g)) specifiers.push(match[1]);
  return specifiers;
}

test("el motor TR-03 no importa estrategia, evaluadores ni aprendizaje", () => {
  for (const path of [...ENGINE_MODULES, PRODUCER]) {
    const source = readFileSync(path, "utf8");
    for (const specifier of importSpecifiers(source)) {
      assert.doesNotMatch(specifier, FORBIDDEN_MODULES, `${path} importa ${specifier}`);
    }
  }
});

test("el motor y el productor no leen ledgers ni resultados de estrategia", () => {
  for (const path of [...ENGINE_MODULES, PRODUCER]) {
    const code = stripComments(readFileSync(path, "utf8"));
    for (const literal of FORBIDDEN_LITERALS) {
      assert.equal(code.includes(literal), false, `${path} referencia "${literal}"`);
    }
  }
});

test("campos de estrategia en las filas no cambian la medición", () => {
  const campaigns = bridgeCampaignsFromZonePlan(
    { missions: { GAS_QUARTERLY: { zones: { PUENTE: [{
      campaignId: "GAS-Q-2026Q1", product: "Gas", shortCode: "G0BQ", maturity: "2026Q1",
      windowStart: "2025-09-01", windowEnd: "2025-09-02", deadline: "2025-09-02",
      coverage: { legacyMaturity: "202601" },
    }] } } } },
    { gasExchangeDays: ["2025-09-01", "2025-09-02"], powerExchangeDays: [] },
  );
  const series = askSeries({ "G0BQ|202601": { "2025-09-01": Array(20).fill({ ask: 100, askSz: 1, bid: 99, quoteTm: null }) } });
  const clean = [gasQuarterlyTrade({ TrdDate: "2025-09-01", Tm: "2025-09-01T09:00:00Z", Px: "90" })];
  const polluted = clean.map((row) => ({
    ...row,
    filledMw: 3,
    boughtMw: 3,
    avgPriceEurMwh: 90.15,
    ledger: [{ status: "FILLED" }],
  }));
  const a = buildMeasurementArtifact({ campaigns, askSeries: series, tradesRows: clean });
  const b = buildMeasurementArtifact({ campaigns, askSeries: series, tradesRows: polluted });
  assert.deepEqual(a, b);
  const serialized = JSON.stringify(a);
  for (const literal of FORBIDDEN_LITERALS) {
    assert.equal(serialized.includes(literal), false, `el artefacto contiene "${literal}"`);
  }
});
