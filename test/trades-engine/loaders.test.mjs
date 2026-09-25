import { test } from "node:test";
import assert from "node:assert/strict";

import { SLOT_LABELS } from "../../src/trades-bridge/constants.mjs";
import {
  buildTobSlotsForMission,
  contractRowsForCampaign,
  filterTradesByZone,
  indexTradesByContract,
  isRunnableZone,
  loadTobSeries,
  tobSlotsForCampaign,
  tradingDaysForCampaign,
} from "../../src/trades-engine/loaders.mjs";
import { gasQuarterlyCampaign, gasQuarterlyTradeAt, powerMonthlyTradeAt, tobDocument } from "./fixtures.mjs";
import { tobRow } from "../trades-bridge/fixtures.mjs";

test("la ventana sale del calendario: días sin observación siguen en la lista", () => {
  const campaign = gasQuarterlyCampaign();
  const exchangeDays = ["2025-08-29", "2025-09-01", "2025-09-02", "2025-09-03", "2025-09-04"];
  const result = tradingDaysForCampaign({ campaign, exchangeDays });
  assert.equal(result.ok, true);
  assert.deepEqual(result.tradingDays, ["2025-09-01", "2025-09-02", "2025-09-03"]);
});

test("loader de trades resuelve el contrato por ShortCode|Maturity legado", () => {
  const rows = [
    gasQuarterlyTradeAt({ day: "2025-09-01", slot: "11:00", price: 100 }),
    powerMonthlyTradeAt({ day: "2025-09-01", slot: "11:00", price: 50 }),
  ];
  const index = indexTradesByContract(rows);
  const gasCampaign = gasQuarterlyCampaign();
  assert.equal(contractRowsForCampaign({ index, campaign: gasCampaign }).length, 1);
  const powerCampaign = {
    campaignId: "POW-M-2026-01",
    product: "Power",
    mission: "Monthly",
    market: "POWER_DE",
    shortCode: "DEBM",
    maturity: "2026-01",
    windowStart: "2025-09-01",
    deadline: "2025-09-03",
  };
  assert.equal(contractRowsForCampaign({ index, campaign: powerCampaign }).length, 1);
});

test("filtro por zona deja fuera días fuera de la frontera", () => {
  const rows = [
    gasQuarterlyTradeAt({ day: "2023-09-01", slot: "11:00", price: 100 }), // DEVELOPMENT
    gasQuarterlyTradeAt({ day: "2025-06-15", slot: "11:00", price: 100 }), // EMBARGO
  ];
  const development = filterTradesByZone({ rows, zone: "DEVELOPMENT" });
  assert.equal(development.length, 1);
  assert.equal(development[0].TrdDate, "2023-09-01");
  assert.equal(filterTradesByZone({ rows, zone: "EMBARGO" }).length, 1);
});

test("loader TOB es generalizado: Power carga su propia serie, no la de Gas", () => {
  const series = loadTobSeries({ slotsDocument: tobDocument({ contract: "DEBM|202601", day: "2025-09-01", slot: "11:00", ask: 42 }) });
  const powerCampaign = {
    campaignId: "POW-M-2026-01",
    product: "Power",
    mission: "Monthly",
    shortCode: "DEBM",
    maturity: "2026-01",
  };
  const slots = tobSlotsForCampaign({ series, campaign: powerCampaign });
  assert.ok(slots instanceof Map);
  assert.equal(slots.get("2025-09-01")[SLOT_LABELS.indexOf("11:00")].ask, 42);
  const gasCampaign = gasQuarterlyCampaign();
  assert.equal(tobSlotsForCampaign({ series, campaign: gasCampaign }), null);
});

test("el loader TOB construido desde filas crudas se generaliza por misión (Power DE)", () => {
  const rows = [
    tobRow({ Cmdty: "POWER", Area: "DE", ShortCode: "DEBM", Maturity: "202601", TrdDate: "2025-09-01", Tm: "2025-09-01T08:50:00Z", AskPx: "42", BidPx: "41" }),
    tobRow({ Cmdty: "POWER", Area: "DE", ShortCode: "DEBQ", Maturity: "202603", TrdDate: "2025-09-01", Tm: "2025-09-01T08:50:00Z", AskPx: "77", BidPx: "76" }),
  ];
  const result = buildTobSlotsForMission({ rows, missionKey: "POWER_MONTHLY" });
  assert.equal(result.ok, true);
  assert.deepEqual([...result.series.keys()], ["DEBM|202601"]);
  const unknown = buildTobSlotsForMission({ rows, missionKey: "MARS_MONTHLY" });
  assert.equal(unknown.ok, false);
  assert.equal(unknown.code, "UNKNOWN_MISSION");
});

test("sólo las zonas corridas son runnable", () => {
  assert.equal(isRunnableZone("DEVELOPMENT"), true);
  assert.equal(isRunnableZone("OOS_HISTORICO"), true);
  assert.equal(isRunnableZone("PUENTE"), true);
  assert.equal(isRunnableZone("POST_PUENTE"), true);
  assert.equal(isRunnableZone("EMBARGO"), false);
  assert.equal(isRunnableZone("PURGE"), false);
  assert.equal(isRunnableZone("FORWARD"), false);
});
