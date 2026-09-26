// Fixtures SINTÉTICOS de la sesión Shadow (IMP-18). No son datos prospectivos
// reales del cliente: ejercitan la ingeniería de captura sobre el manifest
// congelado del experimento P5. El carácter sintético queda declarado en la
// sesión y en el receipt; no cierra DEP-22 (precedente IMP-08/15, §25.2).
//
// Mecánica (4 fronteras, obligación 12 MW, lote 1, cap diario 12):
//   A1 (versión fija): BUY en D1, WAIT en el spike de D2, BUY en D3 y D4.
//   Baseline A0: BUY calendar en D1..D4 → divergencia ACCIÓN en D2.
//   La trayectoria posterior se alimenta por frontera posterior.

import { buildExperimentFixture } from "../p5-experiment/fixtures.mjs";
import { freezeP5Experiment } from "../../src/p5-experiment/index.mjs";
import { contentHashOf, createGasQuarterlyExecutionContract } from "../../src/execution-contract/execution-contract.mjs";
import {
  gasQuarterlyTradeAt,
  gasMonthlyTradeAt,
  powerQuarterlyTradeAt,
  powerMonthlyTradeAt,
  frozenTradesResult,
} from "../trades-engine/fixtures.mjs";

// --- TR-08: forward shadow con TOB vivo + registro paralelo TRADES ----------
// Fixtures SINTÉTICAS: reproducen la forma de las filas del lago sin copiar
// datos de mercado. El slot "12:00" Europe/Berlin de junio equivale a las
// 10:00Z del calendario congelado del fixture Shadow.

export const FORWARD_SLOT_LABEL = "12:00";
export const FORWARD_HISTORY_PRICES = Object.freeze(Array.from({ length: 10 }, () => 50));

export function forwardSeedPastPrices(overrides = {}) {
  const seed = {};
  for (const source of ["TOB", "LAST_TRADE", "SLOT_VWAP"]) {
    seed[source] = [...(overrides[source] ?? FORWARD_HISTORY_PRICES)];
  }
  return seed;
}

// Precios por frontera: LAST_TRADE por encima de la media sembrada en D1 (WAIT)
// y SLOT_VWAP por debajo (BUY), para ejercitar una divergencia de acción real.
const FORWARD_LAST_TRADE_PRICES = {
  "2021-06-22": 60,
  "2021-06-23": 39,
  "2021-06-24": 39.5,
  "2021-06-25": 39.7,
};
const FORWARD_VWAP_TRADE_PRICES = {
  "2021-06-22": 30,
  "2021-06-23": 39,
  "2021-06-24": 39.5,
  "2021-06-25": 39.7,
};

// Filas elegibles GAS_QUARTERLY (G0BQ/202107) de un día: dos trades dentro del
// slot que forman el VWAP y uno más tardío que es el LAST_TRADE. La entrega
// `202107` es la legada de la campaña GAS-Q-2021Q3 del manifest P5 (identidad
// de run, patch 03 §2/§6): la fila pertenece al contrato de la campaña.
export function forwardTradesForDate({ date }) {
  const vwapPrice = FORWARD_VWAP_TRADE_PRICES[date];
  const lastTradePrice = FORWARD_LAST_TRADE_PRICES[date];
  return [
    gasQuarterlyTradeAt({ day: date, slot: FORWARD_SLOT_LABEL, price: vwapPrice, size: "10", overrides: { Tm: `${date}T09:35:00.000000Z`, TrdID: `V1-${date}`, Maturity: "202107" } }),
    gasQuarterlyTradeAt({ day: date, slot: FORWARD_SLOT_LABEL, price: vwapPrice, size: "10", overrides: { Tm: `${date}T09:40:00.000000Z`, TrdID: `V2-${date}`, Maturity: "202107" } }),
    gasQuarterlyTradeAt({ day: date, slot: FORWARD_SLOT_LABEL, price: lastTradePrice, size: "1", overrides: { Tm: `${date}T09:55:00.000000Z`, TrdID: `L-${date}`, Maturity: "202107" } }),
  ];
}

export function forwardTradesFixture({ dates = ["2021-06-22", "2021-06-23", "2021-06-24", "2021-06-25"] } = {}) {
  return dates.flatMap((date) => forwardTradesForDate({ date }));
}

// Resultado FROZEN del contrato TRADES-v1 (TR-04) con la aprobación explícita
// del owner ligada al configHash: es el gate que el forward TRADES consume.
export function frozenTradesContractFixture() {
  return frozenTradesResult();
}

// Manifest P5 congelado del experimento, versión fija del brazo A1.
export function frozenShadowFixture() {
  const fx = buildExperimentFixture({});
  const frozen = freezeP5Experiment(fx.freezeInput);
  if (!frozen.ok) {
    throw new Error(`el manifest P5 del fixture no se congela: ${JSON.stringify(frozen.failures ?? frozen)}`);
  }
  return { fx, frozen: frozen.frozen };
}

// Pasos posteriores sintéticos: tras cada decisión llega la observación del
// día siguiente (31 horas después, ya sabemos el path posterior del día).
const POSTERIOR_BEST_ASKS = {
  "2021-06-22": { timestamp: "2021-06-22T17:00:00Z", bestAsk: 39.8 },
  "2021-06-23": { timestamp: "2021-06-23T17:00:00Z", bestAsk: 51.5 },
  "2021-06-24": { timestamp: "2021-06-24T17:00:00Z", bestAsk: 39.7 },
};

export function posteriorObservationsFor(frontierDate) {
  return POSTERIOR_BEST_ASKS[frontierDate] ? [POSTERIOR_BEST_ASKS[frontierDate]] : [];
}

// La ventana sightable en cada frontera: sólo observaciones que YA LLEGARON
// (timestamp <= upToUtc). El caller prospectivo pasa la ventana real; la
// captura la audita known-at y aborta ante fugas (KNOWN_AT_VIOLATION).
export function sightableObservationsFor({ frozen, upToUtc }) {
  const upToMs = Date.parse(upToUtc);
  if (!Number.isFinite(upToMs)) {
    throw new Error("upToUtc no es un instante parseable");
  }
  return (frozen.frozenBundles.a1.priceObservations ?? [])
    .filter((observation) => Date.parse(observation.timestamp) <= upToMs);
}

// Fixture de closes diarios del benchmark (disponible al cierre).
export function benchmarkDailyClosesFixture({ overridden = {} } = {}) {
  return [
    { date: "2021-06-22", close: 40 },
    { date: "2021-06-23", close: 45 },
    { date: "2021-06-24", close: 40 },
    { date: "2021-06-25", close: 40.2 },
    ...Object.entries(overridden).map(([date, close]) => ({ date, close })),
  ];
}

// --- TR-08: cobertura de las 4 misiones (patch 03 §6) ------------------------
// El forward corre sobre el manifest P5 congelado, que es POR campaña. Para
// ejercitar la identidad y el registro en las 4 misiones se construye un
// manifest sintético por misión reutilizando la estructura del fixture P5 y los
// MISMOS parámetros provisionales del paquete (slippage 0.15, cap 12). El
// contrato de ejecución Power REAL (IMP-07) es un entregable aparte: esto es una
// fixture de ingeniería declarada, no un contrato de mercado ni evidencia.
//
// Cada misión declara su `maturity` canónica y la entrega legada `YYYYMM` de su
// contrato; las filas de trades usan esa entrega para que la identidad de run
// (patch 03 §2/§6) coincida (el fixture anterior mezclaba la entrega 202601 con
// campañas 2021Q3/2021Q3-inválidas).
export const FORWARD_MISSION_FIXTURE = Object.freeze({
  GAS_QUARTERLY: { campaignId: "GAS-Q-2021Q3", product: "Gas", mission: "Quarterly", market: "GAS_THE", maturity: "2021Q3", legacyMaturity: "202107", targetMw: 12 },
  GAS_MONTHLY: { campaignId: "GAS-M-2021-07", product: "Gas", mission: "Monthly", market: "GAS_THE", maturity: "2021-07", legacyMaturity: "202107", targetMw: 10 },
  POWER_QUARTERLY: { campaignId: "POW-Q-2021Q3", product: "Power", mission: "Quarterly", market: "POWER_DE", maturity: "2021Q3", legacyMaturity: "202107", targetMw: 10 },
  POWER_MONTHLY: { campaignId: "POW-M-2021-07", product: "Power", mission: "Monthly", market: "POWER_DE", maturity: "2021-07", legacyMaturity: "202107", targetMw: 10 },
});

const MISSION_TRADE_AT = Object.freeze({
  GAS_QUARTERLY: gasQuarterlyTradeAt,
  GAS_MONTHLY: gasMonthlyTradeAt,
  POWER_QUARTERLY: powerQuarterlyTradeAt,
  POWER_MONTHLY: powerMonthlyTradeAt,
});

// Filas del lago por misión: misma forma que `forwardTradesForDate` pero con el
// ShortCode/maturity de la misión. La entrega sale del contrato de la campaña
// del fixture (`legacyMaturity`), no de un valor suelto, para que la identidad
// de run coincida (patch 03 §2/§6).
export function forwardTradesForMission({ missionKey, dates = ["2021-06-22"] }) {
  const tradeAt = MISSION_TRADE_AT[missionKey];
  if (!tradeAt) throw new Error(`misión sin fixture de trades: ${missionKey}`);
  const maturity = FORWARD_MISSION_FIXTURE[missionKey].legacyMaturity;
  return dates.flatMap((date) => {
    const vwapPrice = FORWARD_VWAP_TRADE_PRICES[date];
    const lastTradePrice = FORWARD_LAST_TRADE_PRICES[date];
    return [
      tradeAt({ day: date, slot: FORWARD_SLOT_LABEL, price: vwapPrice, size: "10", overrides: { Tm: `${date}T09:35:00.000000Z`, TrdID: `V1-${missionKey}-${date}`, Maturity: maturity } }),
      tradeAt({ day: date, slot: FORWARD_SLOT_LABEL, price: vwapPrice, size: "10", overrides: { Tm: `${date}T09:40:00.000000Z`, TrdID: `V2-${missionKey}-${date}`, Maturity: maturity } }),
      tradeAt({ day: date, slot: FORWARD_SLOT_LABEL, price: lastTradePrice, size: "1", overrides: { Tm: `${date}T09:55:00.000000Z`, TrdID: `L-${missionKey}-${date}`, Maturity: maturity } }),
    ];
  });
}

function syntheticExecutionContractFor({ product, mission, missionKey }) {
  const base = createGasQuarterlyExecutionContract();
  const frozenRules = [...base.frozenRules];
  const parameters = base.parameters.map((entry) => ({ ...entry }));
  return {
    ...base,
    contractId: `EXEC-${missionKey}-TR08-FIXTURE`,
    product,
    mission,
    frozenRules,
    parameters,
    contentHash: contentHashOf({ frozenRules, parameters }),
  };
}

function rehashedBundle(bundle) {
  const { contentHash, ...core } = bundle;
  return { ...core, contentHash: contentHashOf(core) };
}

// Manifest P5 sintético de una misión: identidad de campaña, obligación de
// apertura y contrato de ejecución de la misión; re-sella bundles y manifest
// para que la sesión Shadow acepte la versión fija (verifyFrozenIntegrity).
export function frozenShadowFixtureForMission(missionKey) {
  const spec = FORWARD_MISSION_FIXTURE[missionKey];
  if (!spec) throw new Error(`misión sin fixture de manifest: ${missionKey}`);
  const { frozen } = frozenShadowFixture();
  const campaign = { campaignId: spec.campaignId, product: spec.product, mission: spec.mission, maturity: spec.maturity };
  const executionContract = syntheticExecutionContractFor({ product: spec.product, mission: spec.mission, missionKey });
  const patch = (bundle) => rehashedBundle({
    ...bundle,
    campaign,
    openingContract: { ...bundle.openingContract, openingObligation: spec.targetMw },
    executionContract,
    execution: { ...bundle.execution, executionContractVersion: executionContract.contractVersion },
  });
  const a0 = patch(frozen.frozenBundles.a0);
  const a1 = patch(frozen.frozenBundles.a1);
  const { contentHash, ...core } = frozen;
  const nextCore = {
    ...core,
    frozenBundles: { a0, a1 },
    arms: {
      ...core.arms,
      a0: { ...core.arms.a0, bundleContentHash: a0.contentHash },
      a1: { ...core.arms.a1, bundleContentHash: a1.contentHash },
    },
  };
  return { frozen: { ...nextCore, contentHash: contentHashOf(nextCore) } };
}
