import { test } from "node:test";
import assert from "node:assert/strict";

import {
  TRADES_ENGINE_MISSIONS,
  TRADES_TARGET_MW,
  missionDefinition,
  missionKeyForContract,
  missionKeyForShortCode,
  targetMwFor,
} from "../../src/trades-engine/missions.mjs";

test("las 4 misiones declaran mercado, producto, tenor y volumen propios", () => {
  assert.deepEqual(Object.keys(TRADES_ENGINE_MISSIONS).sort(), [
    "GAS_MONTHLY",
    "GAS_QUARTERLY",
    "POWER_MONTHLY",
    "POWER_QUARTERLY",
  ]);
  assert.equal(targetMwFor("GAS_QUARTERLY"), 60);
  assert.equal(targetMwFor("GAS_MONTHLY"), 10);
  assert.equal(targetMwFor("POWER_QUARTERLY"), 10);
  assert.equal(targetMwFor("POWER_MONTHLY"), 10);
  assert.deepEqual(TRADES_TARGET_MW, {
    GAS_QUARTERLY: 60,
    GAS_MONTHLY: 10,
    POWER_QUARTERLY: 10,
    POWER_MONTHLY: 10,
  });
});

test("Power no cae en la rama Monthly de Gas: cada producto resuelve su misión", () => {
  assert.equal(missionKeyForShortCode("G0BQ"), "GAS_QUARTERLY");
  assert.equal(missionKeyForShortCode("G0BM"), "GAS_MONTHLY");
  assert.equal(missionKeyForShortCode("DEBQ"), "POWER_QUARTERLY");
  assert.equal(missionKeyForShortCode("DEBM"), "POWER_MONTHLY");
  assert.equal(TRADES_ENGINE_MISSIONS.POWER_MONTHLY.market, "POWER_DE");
  assert.equal(TRADES_ENGINE_MISSIONS.POWER_MONTHLY.shortCode, "DEBM");
  assert.equal(TRADES_ENGINE_MISSIONS.POWER_MONTHLY.mission, "Monthly");
});

test("contrato del lago sin producto conocido no resuelve misión", () => {
  assert.equal(missionKeyForContract({ shortCode: "XXXX", maturity: "202601" }), null);
  assert.equal(missionKeyForContract({ shortCode: "DEBM", maturity: "" }), null);
});

test("una misión desconocida no recibe default", () => {
  const result = missionDefinition("MARS_QUARTERLY");
  assert.equal(result.ok, false);
  assert.equal(result.code, "UNKNOWN_MISSION");
  assert.equal(targetMwFor("MARS_QUARTERLY"), null);
});
