import { test } from "node:test";
import assert from "node:assert/strict";

import {
  MISSION,
  classifyMission,
  isGasTheExchangeDay,
  isPowerDeExchangeDay,
  measurePatch0Density,
  monthsToDelivery,
} from "../../src/trades-source/index.mjs";
import { tradeRow } from "./fixtures.mjs";

function gasQuarterly(trdDate, maturity, isin, extra = {}) {
  return tradeRow({
    Cmdty: "NATGAS",
    Area: "THE",
    ShortCode: "G0BQ",
    InstrumentISIN: isin,
    Maturity: maturity,
    TrdDate: trdDate,
    Tm: `${trdDate}T10:00:00Z`,
    ...extra,
  });
}

function powerMonthly(trdDate, maturity, isin, extra = {}) {
  return tradeRow({
    Cmdty: "POWER",
    Area: "DE",
    ShortCode: "DEBM",
    InstrumentISIN: isin,
    Maturity: maturity,
    TrdDate: trdDate,
    Tm: `${trdDate}T10:00:00Z`,
    ...extra,
  });
}

test("el calendario de gas trata 24-12 y 31-12 como Exchange Days (Power no)", () => {
  assert.equal(isGasTheExchangeDay("2025-12-24"), true);
  assert.equal(isGasTheExchangeDay("2025-12-31"), true);
  assert.equal(isGasTheExchangeDay("2025-12-25"), false);
  assert.equal(isGasTheExchangeDay("2025-12-27"), false);
  assert.equal(isPowerDeExchangeDay("2025-12-24"), false);
  assert.equal(isPowerDeExchangeDay("2025-12-31"), false);
  assert.equal(isGasTheExchangeDay("2025-12-23"), true);
  assert.equal(isPowerDeExchangeDay("2025-12-23"), true);
});

test("classifyMission reconoce los productos base Q/M y descarta los demás", () => {
  assert.equal(classifyMission(gasQuarterly("2021-01-04", "202103", "Q1")).mission, MISSION.GAS_QUARTERLY);
  assert.equal(classifyMission(tradeRow({ ShortCode: "G0BY" })), null);
  assert.equal(classifyMission(tradeRow({ ShortCode: "G0BS" })), null);
  assert.equal(classifyMission(tradeRow({ ShortCode: "DEPQ" })), null);
  assert.equal(
    classifyMission(tradeRow({ Cmdty: "POWER", Area: "DE", ShortCode: "DEBQ" })).mission,
    MISSION.POWER_QUARTERLY,
  );
});

test("monthsToDelivery mide meses hasta la entrega", () => {
  assert.equal(monthsToDelivery("2021-01-15", "202103"), 2);
  assert.equal(monthsToDelivery("2021-01-15", "202101"), 0);
  assert.equal(monthsToDelivery("2021-06-01", "202103"), -3);
});

test("densidad de Gas Q front por año contra el calendario (no contra los trades)", () => {
  const rows = [
    gasQuarterly("2021-01-04", "202106", "GAS-Q1-2021"),
    gasQuarterly("2021-01-06", "202106", "GAS-Q1-2021"),
    gasQuarterly("2022-02-01", "202206", "GAS-Q1-2022"),
  ];
  const density = measurePatch0Density({
    rows,
    mission: MISSION.GAS_QUARTERLY,
    calendarDays: [
      "2021-01-04",
      "2021-01-05",
      "2021-01-06",
      "2021-01-07",
      "2022-02-01",
      "2022-02-02",
    ],
  });
  const y2021 = density.years.find((entry) => entry.year === "2021");
  const y2022 = density.years.find((entry) => entry.year === "2022");
  assert.equal(y2021.exchangeDays, 4);
  assert.equal(y2021.daysWithoutTrades, 2);
  assert.equal(y2021.rateOfDaysWithoutTrades, 0.5);
  assert.equal(y2022.exchangeDays, 2);
  assert.equal(y2022.daysWithoutTrades, 1);
  assert.equal(y2022.rateOfDaysWithoutTrades, 0.5);
});

test("densidad de Power M respeta la distancia maxima de 3 meses", () => {
  const rows = [
    powerMonthly("2021-04-01", "202105", "PWR-M-202105"),
    powerMonthly("2021-04-01", "202112", "PWR-M-202112"),
    powerMonthly("2021-06-15", "202112", "PWR-M-202112"),
  ];
  const density = measurePatch0Density({
    rows,
    mission: MISSION.POWER_MONTHLY,
    calendarDays: ["2021-04-01", "2021-06-15"],
    maxDistanceMonths: 3,
  });
  const y2021 = density.years.find((entry) => entry.year === "2021");
  assert.equal(y2021.exchangeDays, 2);
  assert.equal(y2021.daysWithFrontTrade, 1);
  // 2021-04-01: front = 202105 (distancia 1) y tiene trade -> cuenta.
  // 2021-06-15: ningun contrato cae dentro de los 3 meses (202105 ya entregado,
  // 202112 a 6 meses) -> dia sin trade del front.
  assert.equal(y2021.daysWithoutTrades, 1);
});

test("el front excluye el contrato en entrega (distancia 0) y usa el siguiente", () => {
  const rows = [
    powerMonthly("2021-03-31", "202104", "PWR-M-202104"),
    powerMonthly("2021-04-01", "202105", "PWR-M-202105"),
    powerMonthly("2021-04-02", "202105", "PWR-M-202105"),
    powerMonthly("2021-04-06", "202105", "PWR-M-202105"),
  ];
  const density = measurePatch0Density({
    rows,
    mission: MISSION.POWER_MONTHLY,
    calendarDays: ["2021-04-01", "2021-04-02", "2021-04-06"],
    maxDistanceMonths: 3,
  });
  const y2021 = density.years.find((entry) => entry.year === "2021");
  // 202104 esta en entrega en abril: no es front. El front es 202105, que cotiza
  // los 3 dias -> 0 dias sin trades (antes daba 3).
  assert.equal(y2021.exchangeDays, 3);
  assert.equal(y2021.daysWithFrontTrade, 3);
  assert.equal(y2021.daysWithoutTrades, 0);
});

test("el catalogo del front sale del reference, no de la presencia de trades", () => {
  const referenceRows = [
    tradeRow({ Cmdty: "POWER", Area: "DE", ShortCode: "DEBM", InstrumentISIN: "PWR-M-202105", Maturity: "202105" }),
    tradeRow({ Cmdty: "POWER", Area: "DE", ShortCode: "DEBM", InstrumentISIN: "PWR-M-202106", Maturity: "202106" }),
  ];
  // El front real es 202105 pero no tuvo ningun trade; 202106 si cotiza. Con el
  // catalogo del reference, los dias del front sin trades se cuentan y NO ceden
  // el puesto al contrato siguiente.
  const rows = [
    powerMonthly("2021-04-01", "202106", "PWR-M-202106"),
    powerMonthly("2021-04-02", "202106", "PWR-M-202106"),
  ];
  const density = measurePatch0Density({
    rows,
    mission: MISSION.POWER_MONTHLY,
    calendarDays: ["2021-04-01", "2021-04-02"],
    referenceRows,
  });
  const y2021 = density.years.find((entry) => entry.year === "2021");
  assert.equal(density.catalogSource, "REFERENCE");
  assert.equal(density.contractCount, 2);
  assert.equal(y2021.daysWithFrontTrade, 0);
  assert.equal(y2021.daysWithoutTrades, 2);
});

test("sin reference la densidad declara el catalogo de trades como fallback", () => {
  const rows = [powerMonthly("2021-04-01", "202105", "PWR-M-202105")];
  const density = measurePatch0Density({
    rows,
    mission: MISSION.POWER_MONTHLY,
    calendarDays: ["2021-04-01"],
  });
  assert.equal(density.catalogSource, "TRADES_FALLBACK");
});
