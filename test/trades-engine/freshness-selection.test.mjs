import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { readDevelopmentRows } from "../../operations/trades/TR-09/build-development-selection.mjs";
import { FRESHNESS_LIMIT_CANDIDATES_SECONDS, OBSERVATION_RULE_LIST } from "../../src/trades-bridge/constants.mjs";
import { FRESHNESS_SELECTION_METRIC, selectDevelopmentFreshness } from "../../src/trades-engine/freshness-selection.mjs";
import { measureDevelopmentGrid } from "../../src/trades-engine/development-grid.mjs";
import { buildTradesFreezeCandidate } from "../../src/execution-contract/trades-contract.mjs";
import { measurementFixture } from "../execution-contract/trades-fixtures.mjs";
import { gasQuarterlyCampaign, gasQuarterlyTradeAt } from "./fixtures.mjs";

function result(rule, seconds, { zone = "DEVELOPMENT", gain = 0 } = {}) {
  const arm = (price) => ({ summary: { complete: true, avgPriceEurMwh: price } });
  return {
    ok: true, missionKey: "GAS_QUARTERLY", zone, observationRule: rule, freshnessCandidateSeconds: seconds,
    episodes: [{ zone, campaign: { campaignId: "GAS-Q-2024Q1", zone, windowStart: "2023-09-01" }, arms: { BASELINE: arm(100), DIP10: arm(100 - gain), HOUR: arm(100 - gain) } }],
  };
}

function grid(gains = {}) {
  return Object.fromEntries(FRESHNESS_LIMIT_CANDIDATES_SECONDS.map((seconds) => [String(seconds), Object.fromEntries(OBSERVATION_RULE_LIST.map((rule) => [rule, result(rule, seconds, { gain: gains[seconds] ?? 0 })]))]));
}

test("TR-09 predeclara la grilla y elige la mejor mejora pareada en Development por misión", () => {
  assert.deepEqual(FRESHNESS_LIMIT_CANDIDATES_SECONDS, [900, 1800, 3600, 14400, 86400]);
  assert.equal(FRESHNESS_SELECTION_METRIC.zone, "DEVELOPMENT");
  const selected = selectDevelopmentFreshness({ missionKey: "GAS_QUARTERLY", resultsByLimit: grid({ 900: 0, 1800: 2, 3600: 1, 14400: -1, 86400: -2 }), expectedCampaignIds: ["GAS-Q-2024Q1"] });
  assert.equal(selected.status, "SELECTED");
  assert.equal(selected.selectedSeconds, 1800);
  assert.equal(selected.scores.length, 5);
});

test("TR-09 empata por mayor muestra y después menor frescura, sin mirar puente ni OOS", () => {
  const selected = selectDevelopmentFreshness({ missionKey: "GAS_QUARTERLY", resultsByLimit: grid() });
  assert.equal(selected.selectedSeconds, 900);
  const contaminated = grid();
  contaminated["1800"].LAST_TRADE.zone = "PUENTE";
  assert.equal(selectDevelopmentFreshness({ missionKey: "GAS_QUARTERLY", resultsByLimit: contaminated }).code, "NON_DEVELOPMENT_OR_INVALID_RESULT");
  const omitted = grid();
  delete omitted["14400"];
  assert.equal(selectDevelopmentFreshness({ missionKey: "GAS_QUARTERLY", resultsByLimit: omitted }).code, "INCOMPLETE_DEVELOPMENT_GRID");
  assert.equal(selectDevelopmentFreshness({ missionKey: "GAS_QUARTERLY", resultsByLimit: grid(), expectedCampaignIds: ["GAS-Q-2024Q1", "GAS-Q-2024Q2"] }).status, "HOLD");
});

test("el productor no lee filas ni campañas posteriores a Development", () => {
  const oos = measureDevelopmentGrid({ missionKey: "GAS_QUARTERLY", campaigns: [{ zone: "OOS_HISTORICO", windowEnd: "2024-09-01" }], rows: [{ TrdDate: "2024-09-01" }], exchangeDays: ["2024-09-01"] });
  assert.equal(oos.code, "NON_DEVELOPMENT_INPUT");
  assert.equal(oos.byLimit, null);
});

test("el productor NDJSON extrae sólo Development del fichero estándar", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "tr09-dev-"));
  try {
    const file = path.join(dir, "trades.ndjson");
    writeFileSync(file, [
      { TrdDate: "2024-05-31", Price: 50 },
      { TrdDate: "2024-06-01", Price: 999 },
      { TrdDate: "2025-08-12", Price: 999 },
    ].map((row) => JSON.stringify(row)).join("\n") + "\n");
    assert.deepEqual(await readDevelopmentRows(file), [{ TrdDate: "2024-05-31", Price: 50 }]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("el productor ejecuta las cinco hipótesis con ambos brazos usando walk-forward de Development", () => {
  const first = ["2023-09-01", "2023-09-04", "2023-09-05", "2023-09-06", "2023-09-07", "2023-09-08"];
  const second = ["2023-10-02", "2023-10-03", "2023-10-04", "2023-10-05", "2023-10-06", "2023-10-09"];
  const campaigns = [
    gasQuarterlyCampaign({ campaignId: "DEV-1", windowStart: first[0], windowEnd: first.at(-1), deadline: first.at(-1) }),
    gasQuarterlyCampaign({ campaignId: "DEV-2", windowStart: second[0], windowEnd: second.at(-1), deadline: second.at(-1) }),
  ];
  const exchangeDays = [...first, ...second];
  const rows = exchangeDays.map((day, index) => gasQuarterlyTradeAt({ day, slot: "11:00", price: 100 - index }));
  const candidate = buildTradesFreezeCandidate({ measurement: measurementFixture(), deleteTmSemantics: "deletion-time" });
  const measured = measureDevelopmentGrid({ missionKey: "GAS_QUARTERLY", campaigns, rows, exchangeDays, candidate });
  assert.equal(measured.status, "SELECTED", measured.code);
  assert.equal(Object.keys(measured.byLimit).length, 5);
  for (const byRule of Object.values(measured.byLimit)) {
    assert.deepEqual(Object.keys(byRule), ["LAST_TRADE", "SLOT_VWAP"]);
    assert.equal(byRule.LAST_TRADE.episodes[0].arms.HOUR.summary.complete, false);
    assert.equal(byRule.LAST_TRADE.episodes[1].arms.HOUR.summary.complete, true);
  }
  assert.ok(FRESHNESS_LIMIT_CANDIDATES_SECONDS.includes(measured.selection.selectedSeconds));
});
