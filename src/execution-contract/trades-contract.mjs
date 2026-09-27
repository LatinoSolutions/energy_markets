// Contrato de ejecución TRADES-v1 y su freeze (TR-04). Fuente normativa:
// docs/canonical/v1_1_1/OWNER_PATCH_TRADES_MODE_2026-09-25.md
// (EM-SPEC-OWNER-PATCH-2026-09-25-03) §3 (reglas de TRADES-v1: trade elegible,
// observación, fill, calendario y data ausente) y §5 (riesgos de modelo), y
// TRADES_MODE_PLAN.md TR-04.
//
// Es una versión NUEVA del contrato de ejecución de IMP-07 para el modo
// TRADES. El contrato TOB vigente (`src/execution-contract/execution-contract.mjs`)
// NO se toca: el modo TRADES no reescribe `src/exploratory/backtest.mjs` ni
// `comparison.mjs` (sus hashes están fijados en los manifests que la UI verifica).
//
// El freeze es un gate humano (TRADES_MODE_PLAN.md TR-04): Bru aprueba el freeze
// antes de cualquier run de estrategia en TRADES. Este módulo NO inventa esa
// aprobación: construye el CANDIDATO con hash y exige una aprobación explícita
// ligada a ese hash para pasar a FROZEN. Sin medición del puente (TR-03), sin la
// política de broken spread ligada a esa medición (o con una decisión de TR-01
// inconsistente) o sin aprobación, queda HOLD.
//
// TR-09 (decisión de Bru 2026-09-26): la frescura es una grilla de hipótesis;
// sólo Development walk-forward elige una por misión. El puente informa el
// contraste sin umbrales automáticos. El contentHash usa la serialización
// canónica propia de IMP-06/07.

import { isVersionLike } from "../contracts/identities.mjs";
import { TRADES_MISSIONS } from "../oos-reservation/trades-windows.mjs";
import { BRIDGE_WINDOW, FRESHNESS_LIMIT_CANDIDATES_SECONDS, HALVES, OBSERVATION_RULES, OBSERVATION_RULE_LIST } from "../trades-bridge/constants.mjs";
import { BROKEN_SPREAD_POLICIES } from "../trades-source/eligibility.mjs";
import { P56_FROZEN_RULES, contentHashOf } from "./execution-contract.mjs";
import { FRESHNESS_SELECTION_METRIC } from "../trades-engine/freshness-selection.mjs";

export const TRADES_CONTRACT_ID = "EXEC-TRADES-v1";
export const TRADES_CONTRACT_VERSION = "v1.0";
export const TRADES_VERSION_LABEL = "TRADES-v1";
export const TRADES_SOURCE_MODE = "TRADES";
export const TRADES_CONTROL_SOURCE_MODE = "TOB";

export const TRADES_FREEZE_SCOPE = "TRADES_V1_FREEZE";

// Patch 03 §3.1: la política de inclusión de broken spread se mide en TR-01 y se
// congela en TR-04. La fuente congelable es la medición del puente (TR-03) que
// se corrió BAJO una política concreta; TR-04 la valida y la liga al config.
export const DECLARED_BROKEN_SPREAD_POLICIES = Object.freeze(Object.values(BROKEN_SPREAD_POLICIES));

export function isDeclaredBrokenSpreadPolicy(value) {
  return DECLARED_BROKEN_SPREAD_POLICIES.includes(value);
}

export const TRADES_CONTRACT_ACCEPTANCE_TEST = "Versión TRADES con grilla de frescura, selección Development, regla de dato ausente y penalización trade->ask medida por mercado/misión/regla (separada del 0,15); contraste descriptivo del puente, config con hash y freeze sólo con aprobación explícita de Bru.";

// La cobertura histórica sólo es diagnóstico; este umbral queda para el
// reporte antiguo de TR-03 y nunca elige una hipótesis en TR-09. La penalización
// requiere una muestra medida en la mitad de calibración del puente.
export const FRESHNESS_COVERAGE_TARGET = 0.95;
export const MIN_PENALTY_OBSERVATIONS = 30;

// §13.6 (reglas frozen de P5.6) + reglas propias del modo TRADES. El validador
// rechaza un contrato que omita cualquiera.
export const TRADES_FROZEN_RULES = Object.freeze([
  ...P56_FROZEN_RULES,
  {
    id: "TRADE_NEVER_PRESENTED_AS_ASK",
    section: "patch 03 §2",
    text: "el precio de un trade nunca se presenta como ask; el volumen negociado no es profundidad y el fill model DEPTH no existe en TRADES.",
  },
  {
    id: "OBSERVATION_LAST_TRADE_PIT",
    section: "patch 03 §3.2",
    text: "LAST_TRADE = último trade elegible con Tm <= instante de decisión; SLOT_VWAP = VWAP de los trades elegibles del slot que termina en la decisión; DIP10 conserva su lógica exacta (10 previas, fallback A0 con menos de 5).",
  },
  {
    id: "PENALTY_SEPARATE_FROM_SLIPPAGE",
    section: "patch 03 §3.3",
    text: "fill = trade observado + penalización trade->ask por mercado y misión + 0,15 EUR/MWh de slippage, sin omitir ni contar dos veces el 0,15; la penalización de Gas no se hereda a Power.",
  },
  {
    id: "PENALTY_SIGN_UNRESTRICTED",
    section: "patch 03 §3.3",
    text: "la penalización trade->ask es la media observada de (ask - trade) y no se le impone signo: un mercado cuyos trades queden por encima del ask produce una penalización negativa, que es un valor medido válido y no un error de schema.",
  },
  {
    id: "PENALTY_BY_DECLARED_AGGRESSOR_GROUP",
    section: "patch 03 §3.3",
    text: "cada lado agresor conserva su propia media y conteo; el grupo sin agresor (UNKNOWN) y el mixto (MIXED) forman su propio grupo declarado y nunca se reasignan a BUY/SELL por suposición.",
  },
  {
    id: "NO_AGGRESSOR_OWN_GROUP",
    section: "patch 03 §3.3",
    text: "los trades sin agresor forman su propio grupo con regla explícita; nunca se asignan a un lado por suposición.",
  },
  {
    id: "BROKEN_SPREAD_POLICY_FROM_MEASUREMENT",
    section: "patch 03 §3.1",
    text: "la política de inclusión de broken spread que se congela es la que se usó en la medición del puente (TR-03); si la decisión de fuente de TR-01 declara una política distinta, el freeze queda en HOLD por inconsistencia.",
  },
  {
    id: "DELETE_POINT_IN_TIME_DECLARED",
    section: "patch 03 §3.1",
    text: "el trade elegible exige declarar la regla de Delete point-in-time: si la fila Delete lleva la hora del borrado o la del trade original, o el supuesto declarado si no puede saberse; el contrato no se congela con la regla vacía.",
  },
  {
    id: "WINDOW_FROM_CALENDAR",
    section: "patch 03 §3.4",
    text: "la ventana de cada campaign sale del calendario de la misión y del calendario de negociación del mercado, nunca de la presencia de trades.",
  },
  {
    id: "FRESHNESS_NO_CARRY",
    section: "patch 03 §3.4",
    text: "día de decisión sin trade elegible dentro del límite de frescura = sin observación; no se arrastra un precio indefinidamente.",
  },
  {
    id: "FRESHNESS_DEVELOPMENT_GRID",
    section: "TR-09, decisión de Bru 2026-09-26",
    text: "Las hipótesis de frescura son 900, 1800, 3600, 14400 y 86400 segundos; una sola se elige por misión exclusivamente con Development walk-forward antes de abrir el OOS.",
  },
  {
    id: "DATA_INCOMPLETE_DISTINCT",
    section: "patch 03 §3.4",
    text: "si la obligación no puede completarse por falta de trades, la campaign queda DATA_INCOMPLETE, distinta del hard-reject por forcing del cliente.",
  },
]);

// §3.4: reglas de calendario y data ausente, declaradas como contrato.
export const TRADES_MISSING_DATA_RULES = Object.freeze({
  WINDOW_SOURCE: "WINDOW_FROM_MISSION_AND_MARKET_CALENDAR_NOT_FROM_TRADE_PRESENCE",
  DECISION_DAY_WITHOUT_TRADE: "DECISION_DAY_WITHOUT_ELIGIBLE_TRADE_WITHIN_FRESHNESS_IS_NO_OBSERVATION",
  CARRY: "NO_CARRY_OF_A_PRICE_BEYOND_THE_FRESHNESS_LIMIT",
  INCOMPLETE_OBLIGATION: "CAMPAIGN_WITH_OBLIGATION_UNCOMPLETABLE_BY_LACK_OF_TRADES_IS_DATA_INCOMPLETE",
  INCOMPLETE_VS_FORCING: "DATA_INCOMPLETE_IS_DISTINCT_FROM_CLIENT_FORCING_HARD_REJECT",
});

// §5 riesgo 1: la penalización se calibra en el puente (2025-2026) y se aplica a
// años anteriores, así que el OOS histórico no es un OOS temporal íntegro. La
// mitigación es esta grilla de sensibilidad predeclarada.
export const TRADES_SENSITIVITY_GRID = Object.freeze({
  id: "TRADES_V1_SENSITIVITY_GRID",
  source: "patch 03 §5 riesgo 1",
  penaltyMultipliers: Object.freeze([0, 0.5, 1, 1.5, 2]),
  freshnessLimitSeconds: FRESHNESS_LIMIT_CANDIDATES_SECONDS,
  observationRules: Object.freeze([OBSERVATION_RULES.LAST_TRADE, OBSERVATION_RULES.SLOT_VWAP]),
  declaration: "Grilla fijada por Bru el 2026-09-26 antes de mirar resultados TRADES; la elección por misión se hace sólo con Development walk-forward.",
});

// Exports conservados para consumidores antiguos: el contraste ya no contiene
// umbrales de pase/fallo automáticos.
export const BRIDGE_GATE_THRESHOLDS = Object.freeze({});
export const BRIDGE_GATE_CONTRAST_THRESHOLD_KINDS = Object.freeze(["report_only"]);
export function isContrastGateThreshold(kind) { return kind === "report_only"; }

// Owner decision 2026-09-26: publish the TOB/TRADES comparison by mission and
// arm. No invented pass/fail threshold is allowed to decide whether it is shown.
export const TRADES_BRIDGE_GATE = Object.freeze({
  id: "TRADES_BRIDGE_CONTRAST_V2",
  zone: BRIDGE_WINDOW.zone,
  window: Object.freeze({ ...BRIDGE_WINDOW }),
  arms: Object.freeze(["BASELINE", "DIP10", "HOUR"]),
  toBridgeResultsAlreadyKnown: true,
  independence: "NOT_INDEPENDENT_VALIDATION",
  thresholdStatus: "NO_AUTOMATIC_THRESHOLD",
  metrics: Object.freeze([
    { id: "BUY_WAIT_AGREEMENT", description: "% de decisiones BUY/WAIT iguales entre TOB y TRADES", definition: "fracción pareada de decisiones iguales por misión y brazo", unit: "fraction" },
    { id: "BOUGHT_MW", description: "MW comprados por modo", definition: "fracción de la obligación comprada por modo, misión y brazo", unit: "fraction_of_target" },
    { id: "FILL_PRICE", description: "precio de fill medio por modo", definition: "precio medio de fills por modo, misión y brazo", unit: "EUR/MWh" },
    { id: "H", description: "H por modo", definition: "coste unitario de obligación completa; incompleto = unavailable", unit: "EUR/MWh" },
    { id: "DELTA_V", description: "ΔV, signo y orden de brazos", definition: "ΔV contra Baseline, signo y orden de los tres brazos por modo", unit: "EUR" },
  ]),
  armOrderRule: Object.freeze({ id: "ARM_SIGN_ORDER", arms: Object.freeze(["BASELINE", "DIP10", "HOUR"]), rule: "Reportar signo y orden de TOB y TRADES; Bru decide con las cifras a la vista." }),
  declaration: "Contraste descriptivo del puente, ya conocido y no independiente. Sin umbrales automáticos; decisión de Bru con números visibles.",
});

export function evaluateBridgeGateMetric(metric, { tobValue, tradesValue } = {}) {
  const id = metric?.id ?? null;
  if (id === "BUY_WAIT_AGREEMENT") {
    if (!Array.isArray(tobValue) || !Array.isArray(tradesValue) || tobValue.length === 0 || tobValue.length !== tradesValue.length) return { id, status: "NOT_EVALUABLE" };
    const equal = tobValue.filter((value, index) => value === tradesValue[index]).length;
    return { id, status: "REPORTED", observed: equal / tobValue.length, compared: tobValue.length };
  }
  if (id === "DELTA_V") {
    const arms = TRADES_BRIDGE_GATE.arms;
    if (!arms.every((arm) => isFiniteNumber(tobValue?.[arm]) && isFiniteNumber(tradesValue?.[arm]))) return { id, status: "NOT_EVALUABLE" };
    const signMatches = arms.every((arm) => Math.sign(tobValue[arm]) === Math.sign(tradesValue[arm]));
    const orderOf = (values) => arms.slice().sort((a, b) => values[a] - values[b]);
    return { id, status: "REPORTED", tob: tobValue, trades: tradesValue, signMatches, orderMatches: orderOf(tobValue).join("|") === orderOf(tradesValue).join("|") };
  }
  if (!isFiniteNumber(tobValue) || !isFiniteNumber(tradesValue)) return { id, status: "NOT_EVALUABLE" };
  return { id, status: "REPORTED", tob: tobValue, trades: tradesValue, delta: tradesValue - tobValue };
}

export function evaluateTradesBridgeGate({ metrics = TRADES_BRIDGE_GATE.metrics, tob = {}, trades = {} } = {}) {
  const results = metrics.map((metric) => evaluateBridgeGateMetric(metric, { tobValue: tob[metric.id], tradesValue: trades[metric.id] }));
  const notEvaluable = results.filter((result) => result.status === "NOT_EVALUABLE");
  return { gateId: TRADES_BRIDGE_GATE.id, decision: results.find((result) => result.id === "FILL_PRICE")?.status === "REPORTED" ? "REPORTED" : "HOLD", metrics: results, failed: [], notEvaluable };
}

// Provenance del 0,15: la MISMA suposición de ejecución del cliente que fija el
// contrato TOB (02_execution_costs). La penalización trade->ask es un parámetro
// NUEVO y separado; el 0,15 no se omite ni se cuenta dos veces (patch 03 §3.3).
const SLIPPAGE_PROVENANCE = {
  authority: "Fundamental (cliente); paquete ENERGY_MARKETS_CLIENT_INPUTS_2026-09-23 verificado",
  locator: "02_execution_costs/execution_parameters.csv",
  quote: "virtual_slippage,0.15,EUR/MWh,Execution assumption",
};

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function isSha256(value) {
  return typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
}

function isFiniteNonNegativeNumber(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

// §3.3: fill = trade observado + penalización trade->ask + 0,15 EUR/MWh de
// slippage. La penalización por mercado/misión entra una vez; el 0,15 también,
// sin omitirse ni contarse dos veces. El precio del trade puede ser negativo
// (los mercados de power admiten precios negativos) y la penalización tampoco
// tiene signo impuesto: si los trades quedan por encima del ask, la media
// observada de (ask - trade) es negativa y es un valor válido. El 0,15 vive en el
// contrato TOB y aquí se declara como suposición separada de la penalización
// nueva (no se hereda ni se duplica).
export function deriveTradesFillPrice({ tradePrice, penaltyEurMwh, slippageEurMwh = 0.15 } = {}) {
  if (!isFiniteNumber(tradePrice)) {
    return { ok: false, price: null, reason: "El precio del trade observado no es un número finito." };
  }
  if (!isFiniteNumber(penaltyEurMwh)) {
    return { ok: false, price: null, reason: "La penalización trade->ask debe ser un número finito (nunca se omite)." };
  }
  if (!isFiniteNonNegativeNumber(slippageEurMwh)) {
    return { ok: false, price: null, reason: "El slippage debe ser un número finito no negativo." };
  }
  return { ok: true, price: tradePrice + penaltyEurMwh + slippageEurMwh, reason: null };
}

function pushError(errors, field, code, message) {
  errors.push({ field, code, message });
}

// Parámetros compartidos por las 4 misiones. `slippage` es el 0,15 del cliente;
// `fees` sigue UNKNOWN/excluded, nunca cero (patch 03 §7).
function sharedParameters() {
  return [
    {
      key: "slippage",
      status: "PROVISIONAL",
      value: 0.15,
      unit: "EUR/MWh",
      source: { ...SLIPPAGE_PROVENANCE },
    },
    {
      key: "fees",
      status: "UNKNOWN",
      value: null,
      unit: null,
      excluded: true,
      reason: "Brokerage, exchange, clearing u otros fees siguen unknown/excluded pending evidence; nunca se representan como cero (patch 03 §7).",
      source: { authority: "Fundamental (cliente)", locator: "02_execution_costs/execution_and_costs.md", quote: "other_fees,unknown / excluded pending evidence" },
    },
  ];
}

// §3.3: el fill se calibra por lado agresor; los trades sin agresor forman su
// propio grupo declarado y nunca se reasignan a un lado. El headline es la media
// ponderada por observación sobre los grupos BELOW_MEAN declarados, y cada grupo
// conserva su propia media y conteo para que el fill no reciba un valor opaco.
export const TRADES_PENALTY_AGGRESSION_RULE = Object.freeze({
  id: "PENALTY_BY_DECLARED_AGGRESSOR_GROUP",
  section: "patch 03 §3.3",
  headlineAggregation: "OBSERVATION_FREQUENCY_WEIGHTED_MEAN_OVER_ALL_DECLARED_BELOW_MEAN_GROUPS",
  groups: Object.freeze([
    Object.freeze({ aggressor: "BUY", role: "KNOWN_SIDE", reassignedToSide: false }),
    Object.freeze({ aggressor: "SELL", role: "KNOWN_SIDE", reassignedToSide: false }),
    Object.freeze({ aggressor: "UNKNOWN", role: "OWN_GROUP_NO_AGGRESSOR", reassignedToSide: false }),
    Object.freeze({ aggressor: "MIXED", role: "OWN_GROUP_MIXED_SIDE", reassignedToSide: false }),
  ]),
  rule: "cada grupo agresor conserva su identidad y su propia media/conteo; el grupo sin agresor (UNKNOWN) y el mixto (MIXED) forman su propio grupo declarado y nunca se reasignan a BUY/SELL por suposición (patch 03 §3.3).",
});

export const TRADES_PENALTY_SIGN_RULE = Object.freeze({
  id: "PENALTY_SIGN_UNRESTRICTED",
  section: "patch 03 §3.3",
  rule: "la penalización trade->ask es la media observada de (ask - trade) y no se le impone signo; una media negativa por trades por encima del ask es un valor medido válido.",
});

// Derivación de la penalización a partir del cross-tab señal × agresor de la
// MITAD DE CALIBRACIÓN del puente (plan TR-03/TR-06: la evaluación se reserva
// para el gate, no para calibrar el fill). gap = trade - ask, así que
// ask - trade = -gap. La señal es BELOW_MEAN (los momentos en que DIP10
// compraría). Cada grupo agresor aporta su propia media observada; el grupo sin
// agresor (UNKNOWN / MIXED) nunca se reasigna a un lado.
//
// Patch 03 §3.4 (corrección TR04-PENALTY-STALE-OBS): un trade fuera del límite de
// frescura cuenta como SIN observación; la penalización sólo puede calibrarse con
// observaciones de antigüedad <= el límite de frescura congelado para esa
// misión/regla. Por eso se lee el cross-tab por límite, no el cross-tab total.
export function derivePenaltyForMission({ measurement, market, mission, observationRule = OBSERVATION_RULES.LAST_TRADE, freshnessLimitSeconds = null } = {}) {
  const freshness = deriveFreshnessForMission({ measurement, market, mission, observationRule });
  const limit = freshnessLimitSeconds ?? freshness.value;
  const summary = measurement?.markets?.[market]?.missions?.[mission]?.summary;
  const cells = summary?.gaps?.[observationRule]?.byHalfByDip10StateByAggressorByLimit;
  const list = Array.isArray(cells) ? cells : [];
  const byAggressor = [];
  if (limit === null) {
    return {
      status: "UNKNOWN",
      value: null,
      observations: 0,
      freshnessLimitSeconds: null,
      byAggressor,
      aggregationRuleId: TRADES_PENALTY_AGGRESSION_RULE.id,
      signRuleId: TRADES_PENALTY_SIGN_RULE.id,
      reason: "Sin límite de frescura medido en la mitad de calibración; la penalización no se calibra sin saber qué observaciones cuentan (patch 03 §3.4).",
    };
  }
  let observations = 0;
  let weighted = 0;
  const calibrationPrefix = `${limit}|${HALVES.CALIBRATION}|BELOW_MEAN|`;
  for (const cell of list) {
    const combination = String(cell?.combination ?? "");
    if (!combination.startsWith(calibrationPrefix)) continue;
    const aggressor = combination.split("|")[3] ?? "UNKNOWN";
    if (typeof cell.mean !== "number" || !Number.isFinite(cell.mean) || !Number.isFinite(cell.count)) continue;
    const penaltyEurMwh = -cell.mean;
    byAggressor.push({ aggressor, count: cell.count, meanGapEurMwh: cell.mean, penaltyEurMwh });
    observations += cell.count;
    weighted += penaltyEurMwh * cell.count;
  }
  byAggressor.sort((left, right) => (left.aggressor < right.aggressor ? -1 : 1));
  if (observations < MIN_PENALTY_OBSERVATIONS) {
    return {
      status: "UNKNOWN",
      value: null,
      observations,
      freshnessLimitSeconds: limit,
      byAggressor,
      aggregationRuleId: TRADES_PENALTY_AGGRESSION_RULE.id,
      signRuleId: TRADES_PENALTY_SIGN_RULE.id,
      reason: `Menos de ${MIN_PENALTY_OBSERVATIONS} observaciones BELOW_MEAN dentro del límite de frescura de la mitad de calibración; la penalización trade->ask no se congela con una muestra insuficiente (nunca se sustituye por cero).`,
    };
  }
  return {
    status: "MEASURED",
    value: weighted / observations,
    observations,
    freshnessLimitSeconds: limit,
    byAggressor,
    aggregationRuleId: TRADES_PENALTY_AGGRESSION_RULE.id,
    signRuleId: TRADES_PENALTY_SIGN_RULE.id,
    reason: null,
  };
}

// Diagnóstico histórico de cobertura de TR-03, conservado para comparar con el
// antiguo candidato. TR-09 no lo usa para elegir frescura ni para el freeze.
export function deriveFreshnessForMission({ measurement, market, mission, observationRule = OBSERVATION_RULES.LAST_TRADE } = {}) {
  const summary = measurement?.markets?.[market]?.missions?.[mission]?.summary;
  const coverage = summary?.coverage?.[observationRule]?.byHalf?.[HALVES.CALIBRATION];
  if (!coverage || !Number.isFinite(coverage.slotsTotal) || coverage.slotsTotal === 0) {
    return { status: "UNKNOWN", value: null, coverage: null, reason: "Sin slots medidos en la mitad de calibración del puente para esta misión; el límite de frescura no se congela." };
  }
  const candidates = [...FRESHNESS_LIMIT_CANDIDATES_SECONDS].sort((left, right) => left - right);
  for (const limit of candidates) {
    const entry = coverage.coverageByLimit?.[String(limit)];
    if (entry && typeof entry.coverage === "number" && entry.coverage >= FRESHNESS_COVERAGE_TARGET) {
      return { status: "MEASURED", value: limit, coverage: entry.coverage, reason: null };
    }
  }
  const largest = candidates[candidates.length - 1];
  const entry = coverage.coverageByLimit?.[String(largest)];
  return {
    status: "LOW_COVERAGE",
    value: largest,
    coverage: entry?.coverage ?? null,
    reason: `Ningún candidato alcanza la cobertura objetivo ${FRESHNESS_COVERAGE_TARGET} en la mitad de calibración; se declara el mayor con LOW_COVERAGE.`,
  };
}

// Cada misión declara las dos reglas y la penalización medida para cada
// hipótesis. La penalización aplicable se toma sólo después de la selección.
function buildMarkets({ measurement }) {
  const markets = {};
  for (const [missionKey, definition] of Object.entries(TRADES_MISSIONS)) {
    const { market, product, mission, shortCode } = definition;
    if (!markets[market]) markets[market] = { market, missions: {} };
    const observations = {};
    for (const rule of OBSERVATION_RULE_LIST) {
      observations[rule] = {
        freshness: { status: "HYPOTHESIS_GRID", candidatesSeconds: FRESHNESS_LIMIT_CANDIDATES_SECONDS, selectedSeconds: null, selectionZone: "DEVELOPMENT", metricId: FRESHNESS_SELECTION_METRIC.id },
        penaltiesByFreshness: Object.fromEntries(FRESHNESS_LIMIT_CANDIDATES_SECONDS.map((seconds) => [String(seconds), derivePenaltyForMission({ measurement, market, mission: missionKey, observationRule: rule, freshnessLimitSeconds: seconds })])),
        penalty: { status: "UNKNOWN", value: null, reason: "La penalización depende de la frescura elegida en Development." },
      };
    }
    markets[market].missions[missionKey] = {
      product,
      mission,
      shortCode,
      observations,
      missingDataRule: TRADES_MISSING_DATA_RULES.INCOMPLETE_OBLIGATION,
    };
  }
  return markets;
}

// Subconjunto canónico que fija el hash del config. Excluye `status`, `approval`
// y `configHash` (que se derivan); incluye provenance para que un cambio de
// fuentes cambie el hash.
function configCoreOf(contract) {
  return {
    contractId: contract.contractId,
    contractVersion: contract.contractVersion,
    versionLabel: contract.versionLabel,
    sourceMode: contract.sourceMode,
    controlSourceMode: contract.controlSourceMode,
    frozenRules: contract.frozenRules,
    observationRules: contract.observationRules,
    missingDataRules: contract.missingDataRules,
    halves: contract.halves,
    tradeEligibility: contract.tradeEligibility,
    sharedParameters: contract.sharedParameters,
    fillModel: contract.fillModel,
    markets: contract.markets,
    sensitivityGrid: contract.sensitivityGrid,
    freshnessSelection: contract.freshnessSelection,
    bridgeGate: contract.bridgeGate,
    generatedFrom: contract.generatedFrom,
  };
}

export function tradesConfigHash(contract) {
  return contentHashOf(configCoreOf(contract));
}

// Construye el CANDIDATO de freeze con su hash. No lo congela: eso exige la
// aprobación explícita (evaluateTradesFreeze). La política de broken spread que
// se congela es la de la medición del puente (TR-03), no un valor que TR-01 deba
// entregar aparte (patch 03 §3.1).
export function buildTradesFreezeCandidate({
  measurement,
  sourceDecision = null,
  deleteTmSemantics,
  developmentSelection = null,
  generatedFrom = {},
} = {}) {
  const brokenSpreadPolicy = isDeclaredBrokenSpreadPolicy(measurement?.brokenSpreadPolicy)
    ? measurement.brokenSpreadPolicy
    : null;
  // TR04-MEASUREMENT-HASH-UNBOUND / TR04-MEASUREMENT-BINDING-NOT-VALIDATED: el
  // config congelado queda ligado a la identidad (sha256 canónico) de la medición
  // de TR-03. Si el builder no recibió el sha (undefined/null), lo deriva del
  // objeto. Un valor explícito NO se sobrescribe: si no tiene forma de sha256, el
  // validador lo rechaza (MISSING_MEASUREMENT_BINDING) en vez de taparlo.
  const receivedMeasurementSha256 = generatedFrom?.bridgeMeasurementSha256;
  const needsDerivedMeasurementSha256 = measurement && typeof measurement === "object"
    && (receivedMeasurementSha256 === undefined || receivedMeasurementSha256 === null);
  const boundGeneratedFrom = needsDerivedMeasurementSha256
    ? { ...generatedFrom, bridgeMeasurementSha256: contentHashOf(measurement) }
    : generatedFrom;
  const contract = {
    artifactKind: "TRADES_CONTRACT_V1",
    contractId: TRADES_CONTRACT_ID,
    contractVersion: TRADES_CONTRACT_VERSION,
    versionLabel: TRADES_VERSION_LABEL,
    sourceMode: TRADES_SOURCE_MODE,
    controlSourceMode: TRADES_CONTROL_SOURCE_MODE,
    frozenRules: TRADES_FROZEN_RULES.map((rule) => rule.id),
    observationRules: { primary: OBSERVATION_RULES.LAST_TRADE, secondary: OBSERVATION_RULES.SLOT_VWAP },
    missingDataRules: TRADES_MISSING_DATA_RULES,
    // Plan TR-03/TR-06: la calibración del fill sale de la mitad de calibración;
    // la de evaluación se reserva para el gate del puente de TR-06. Declarado.
    halves: {
      calibration: HALVES.CALIBRATION,
      evaluation: HALVES.EVALUATION,
      calibrationUsedFor: ["penaltyEurMwh"],
      developmentUsedFor: ["freshnessLimitSeconds"],
      evaluationUsedFor: ["bridgeGate"],
    },
    tradeEligibility: {
      brokenSpreadPolicy,
      brokenSpreadPolicySource: brokenSpreadPolicy === null ? null : "TR-03 bridge measurement",
      sourceDecisionPolicy: sourceDecision?.brokenSpreadPolicy ?? null,
      deleteTmSemantics: deleteTmSemantics ?? null,
      penaltySignRule: TRADES_PENALTY_SIGN_RULE,
      penaltyAggressionRule: TRADES_PENALTY_AGGRESSION_RULE,
    },
    sharedParameters: sharedParameters(),
    // §3.3: el modelo de fill declara explícitamente de dónde sale la penalización
    // (grupo agresor y signo) para que el fill no reciba un valor opaco.
    fillModel: {
      authority: "patch 03 §3.3",
      formula: "tradeObserved + penaltyEurMwh(mission, observationRule) + slippageEurMwh",
      penaltySource: "market/mission/observationRule, calibrada en la mitad de calibración del puente",
      penaltyAggressionRuleId: TRADES_PENALTY_AGGRESSION_RULE.id,
      penaltySignRuleId: TRADES_PENALTY_SIGN_RULE.id,
      slippageSource: "02_execution_costs/execution_parameters.csv (0,15 EUR/MWh, cliente)",
    },
    markets: buildMarkets({ measurement }),
    freshnessSelection: { metric: FRESHNESS_SELECTION_METRIC, gridSeconds: FRESHNESS_LIMIT_CANDIDATES_SECONDS, results: developmentSelection },
    sensitivityGrid: TRADES_SENSITIVITY_GRID,
    bridgeGate: TRADES_BRIDGE_GATE,
    generatedFrom: boundGeneratedFrom,
  };
  for (const [missionKey, definition] of Object.entries(TRADES_MISSIONS)) {
    const selected = developmentSelection?.[missionKey];
    if (selected?.status !== "SELECTED" || selected.zone !== "DEVELOPMENT" || selected.metric?.id !== FRESHNESS_SELECTION_METRIC.id || !FRESHNESS_LIMIT_CANDIDATES_SECONDS.includes(selected.selectedSeconds)) continue;
    for (const rule of OBSERVATION_RULE_LIST) {
      const observation = contract.markets[definition.market].missions[missionKey].observations[rule];
      observation.freshness = { ...observation.freshness, status: "SELECTED_DEVELOPMENT", selectedSeconds: selected.selectedSeconds };
      observation.penalty = observation.penaltiesByFreshness[String(selected.selectedSeconds)];
    }
  }
  return { ...contract, configHash: tradesConfigHash(contract) };
}

export function validateTradesContract(contract) {
  const errors = [];
  if (!contract || typeof contract !== "object" || Array.isArray(contract)) {
    return { ok: false, errors: [{ field: "contract", code: "MISSING_CONTRACT", message: "Contrato TRADES ausente." }] };
  }
  if (contract.contractId !== TRADES_CONTRACT_ID) {
    pushError(errors, "contractId", "INVALID_CONTRACT_ID", `El contrato TRADES debe identificarse como ${TRADES_CONTRACT_ID}.`);
  }
  if (!isVersionLike(contract.contractVersion)) {
    pushError(errors, "contractVersion", "MISSING_VERSION", "El contrato TRADES no declara versión congelable.");
  }
  if (contract.sourceMode !== TRADES_SOURCE_MODE) {
    pushError(errors, "sourceMode", "INVALID_SOURCE_MODE", `El contrato TRADES debe declarar sourceMode ${TRADES_SOURCE_MODE}.`);
  }
  if (contract.controlSourceMode !== TRADES_CONTROL_SOURCE_MODE) {
    pushError(errors, "controlSourceMode", "INVALID_CONTROL_MODE", "El control debe seguir siendo el release TOB; el contrato TRADES no lo sustituye.");
  }

  const ruleIds = Array.isArray(contract.frozenRules) ? contract.frozenRules : [];
  for (const rule of TRADES_FROZEN_RULES) {
    if (!ruleIds.includes(rule.id)) {
      pushError(errors, "frozenRules", "MISSING_FROZEN_RULE", `Falta la regla frozen "${rule.id}" (${rule.section}).`);
    }
  }

  if (contract.observationRules?.primary !== OBSERVATION_RULES.LAST_TRADE || contract.observationRules?.secondary !== OBSERVATION_RULES.SLOT_VWAP) {
    pushError(errors, "observationRules", "INVALID_OBSERVATION_RULES", "La observación principal es LAST_TRADE y la secundaria SLOT_VWAP (patch 03 §3.2).");
  }
  if (!contract.missingDataRules || typeof contract.missingDataRules !== "object") {
    pushError(errors, "missingDataRules", "MISSING_MISSING_DATA_RULES", "El contrato TRADES no declara la regla de dato ausente (patch 03 §3.4).");
  }
  if (contract.halves?.calibration !== HALVES.CALIBRATION) {
    pushError(errors, "halves", "INVALID_CALIBRATION_HALF", "La calibración del fill sale de la mitad de calibración del puente, no del puente entero (plan TR-03/TR-06).");
  }

  const slippage = (contract.sharedParameters ?? []).find((entry) => entry?.key === "slippage");
  if (!slippage || slippage.value !== 0.15 || slippage.unit !== "EUR/MWh") {
    pushError(errors, "sharedParameters.slippage", "MISSING_SLIPPAGE", "El contrato TRADES no declara el 0,15 EUR/MWh de slippage (patch 03 §3.3).");
  }
  const fees = (contract.sharedParameters ?? []).find((entry) => entry?.key === "fees");
  if (!fees || fees.status !== "UNKNOWN" || fees.value !== null) {
    pushError(errors, "sharedParameters.fees", "INVENTED_FEES", "Los fees siguen UNKNOWN/excluded sin valor; nunca cero (patch 03 §7).");
  }

  if (!isDeclaredBrokenSpreadPolicy(contract.tradeEligibility?.brokenSpreadPolicy)) {
    pushError(errors, "tradeEligibility.brokenSpreadPolicy", "INVALID_BROKEN_SPREAD_POLICY", `La política de broken spread congelada debe ser una de ${DECLARED_BROKEN_SPREAD_POLICIES.join(" / ")} (patch 03 §3.1).`);
  }
  // Corrección TR04-DELETE-SEMANTICS-UNDECLARED: el patch 03 §3.1 exige declarar
  // la regla de Delete point-in-time (o su supuesto); no se congela vacía.
  if (!isNonEmptyString(contract.tradeEligibility?.deleteTmSemantics)) {
    pushError(errors, "tradeEligibility.deleteTmSemantics", "MISSING_DELETE_TM_SEMANTICS", "El contrato TRADES no declara la regla de Delete point-in-time del trade elegible; el patch 03 §3.1 exige declararla (o su supuesto) y no se congela vacía.");
  }
  // TR04-MEASUREMENT-BINDING-NOT-VALIDATED: la corrección TR04-MEASUREMENT-HASH-UNBOUND
  // liga el config a la identidad sha256 de la medición del puente. El freeze
  // promete cerrar por defecto en cada paso: un sha ausente o con forma inválida
  // se rechaza, no se deja pasar un contrato sin rastrear hasta sus datos.
  if (!isSha256(contract.generatedFrom?.bridgeMeasurementSha256)) {
    pushError(errors, "generatedFrom.bridgeMeasurementSha256", "MISSING_MEASUREMENT_BINDING", "El contrato TRADES no liga la identidad sha256 de la medición del puente (TR-03); sin ella el freeze no se puede rastrear hasta los datos que lo produjeron (TR04-MEASUREMENT-HASH-UNBOUND).");
  }

  for (const [missionKey, definition] of Object.entries(TRADES_MISSIONS)) {
    const entry = contract.markets?.[definition.market]?.missions?.[missionKey];
    if (!entry) {
      pushError(errors, `markets.${definition.market}.${missionKey}`, "MISSING_MISSION", `Falta la misión ${missionKey}; TR-04 cubre las 4 misiones (patch 03 §6).`);
      continue;
    }
    for (const rule of OBSERVATION_RULE_LIST) {
      const observation = entry.observations?.[rule];
      if (!observation) {
        pushError(errors, `observations.${missionKey}.${rule}`, "MISSING_OBSERVATION_RULE", `Falta la regla de observación ${rule} de ${missionKey}; TR-04 congela ambas (patch 03 §3.2).`);
        continue;
      }
      const penalty = observation.penalty;
      if (!penalty || !["MEASURED", "UNKNOWN"].includes(penalty.status)) {
        pushError(errors, `penalty.${missionKey}.${rule}`, "INVALID_PENALTY", `La penalización de ${missionKey} (${rule}) no declara un status válido.`);
      } else if (penalty.status === "MEASURED" && !isFiniteNumber(penalty.value)) {
        pushError(errors, `penalty.${missionKey}.${rule}`, "INVALID_PENALTY_VALUE", `La penalización medida de ${missionKey} (${rule}) no es un número finito; el signo es libre (patch 03 §3.3).`);
      } else if (penalty.status === "UNKNOWN" && penalty.value !== null) {
        pushError(errors, `penalty.${missionKey}.${rule}`, "INVENTED_PENALTY", `La penalización de ${missionKey} (${rule}) está UNKNOWN y no puede traer valor; nunca se sustituye por cero.`);
      }
      const freshness = observation.freshness;
      if (!freshness || !["HYPOTHESIS_GRID", "SELECTED_DEVELOPMENT"].includes(freshness.status)
        || JSON.stringify(freshness.candidatesSeconds) !== JSON.stringify(FRESHNESS_LIMIT_CANDIDATES_SECONDS)
        || (freshness.status === "SELECTED_DEVELOPMENT" && !FRESHNESS_LIMIT_CANDIDATES_SECONDS.includes(freshness.selectedSeconds))) {
        pushError(errors, `freshness.${missionKey}.${rule}`, "INVALID_FRESHNESS", `El límite de frescura de ${missionKey} (${rule}) no declara un status válido.`);
      }
      if (JSON.stringify(Object.keys(observation.penaltiesByFreshness ?? {}).map(Number)) !== JSON.stringify(FRESHNESS_LIMIT_CANDIDATES_SECONDS)) {
        pushError(errors, `penaltiesByFreshness.${missionKey}.${rule}`, "INCOMPLETE_PENALTY_GRID", "Cada hipótesis requiere penalización calibrada separada.");
      }
    }
  }

  if (!contract.sensitivityGrid || !Array.isArray(contract.sensitivityGrid.penaltyMultipliers)) {
    pushError(errors, "sensitivityGrid", "MISSING_SENSITIVITY_GRID", "El contrato TRADES no declara la grilla de sensibilidad (patch 03 §5 riesgo 1).");
  }
  if (contract.freshnessSelection?.metric?.id !== FRESHNESS_SELECTION_METRIC.id
    || JSON.stringify(contract.freshnessSelection?.gridSeconds) !== JSON.stringify(FRESHNESS_LIMIT_CANDIDATES_SECONDS)) {
    pushError(errors, "freshnessSelection", "INVALID_DEVELOPMENT_SELECTION_POLICY", "La métrica y la grilla deben estar predeclaradas.");
  }
  for (const [missionKey, definition] of Object.entries(TRADES_MISSIONS)) {
    const selected = contract.freshnessSelection?.results?.[missionKey];
    if (selected?.status !== "SELECTED") continue;
    if (selected.zone !== "DEVELOPMENT" || selected.metric?.id !== FRESHNESS_SELECTION_METRIC.id
      || !FRESHNESS_LIMIT_CANDIDATES_SECONDS.includes(selected.selectedSeconds)
      || !isSha256(contract.generatedFrom?.developmentSelectionSha256)) {
      pushError(errors, `freshnessSelection.${missionKey}`, "INVALID_DEVELOPMENT_SELECTION", "La elección debe provenir de Development y estar ligada a un SHA-256.");
    }
    for (const rule of OBSERVATION_RULE_LIST) {
      const observation = contract.markets?.[definition.market]?.missions?.[missionKey]?.observations?.[rule];
      if (observation?.freshness?.selectedSeconds !== selected.selectedSeconds || observation?.penalty?.freshnessLimitSeconds !== selected.selectedSeconds) {
        pushError(errors, `freshnessSelection.${missionKey}.${rule}`, "SELECTION_PARAMETER_MISMATCH", "Frescura y penalización deben usar la misma hipótesis elegida.");
      }
    }
  }
  if (!isNonEmptyString(contract.fillModel?.formula) || contract.fillModel?.penaltyAggressionRuleId !== TRADES_PENALTY_AGGRESSION_RULE.id) {
    pushError(errors, "fillModel", "MISSING_FILL_MODEL", "El contrato TRADES no declara el modelo de fill con la regla de grupo agresor (patch 03 §3.3).");
  }
  if (!contract.bridgeGate || contract.bridgeGate.toBridgeResultsAlreadyKnown !== true) {
    pushError(errors, "bridgeGate", "MISSING_BRIDGE_GATE", "El contrato TRADES no declara el gate del puente predeclarado (plan TR-04).");
  } else {
    const metrics = Array.isArray(contract.bridgeGate.metrics) ? contract.bridgeGate.metrics : [];
    if (metrics.length === 0) {
      pushError(errors, "bridgeGate.metrics", "MISSING_GATE_METRICS", "El gate del puente no declara métricas.");
    }
    for (const metric of metrics) {
      if (!isNonEmptyString(metric?.definition)) {
        pushError(errors, `bridgeGate.metrics.${metric?.id}`, "MISSING_GATE_METRIC_DEFINITION", `La métrica ${metric?.id} del gate no declara definición.`);
      }
      if (metric?.threshold !== undefined || metric?.passCriterion !== undefined || metric?.failCriterion !== undefined) {
        pushError(errors, `bridgeGate.metrics.${metric?.id}`, "INVENTED_BRIDGE_THRESHOLD", "El contraste del puente no usa umbrales automáticos (decisión de Bru 2026-09-26).");
      }
    }
  }

  if (isNonEmptyString(contract.configHash) && contract.configHash !== tradesConfigHash(contract)) {
    pushError(errors, "configHash", "CONFIG_HASH_MISMATCH", "El configHash no corresponde al contenido del contrato; el config fue alterado.");
  }

  return { ok: errors.length === 0, errors };
}

// Aprobación explícita del owner ligada al hash exacto del config: aprobar un
// config no aprueba otro distinto (fail-closed).
export function freezeApprovalProblem(approval, expectedConfigHash) {
  if (!approval || typeof approval !== "object" || Array.isArray(approval)) {
    return { code: "MISSING_OWNER_APPROVAL", message: `El freeze de TRADES-v1 exige la aprobación explícita de Bru (scope ${TRADES_FREEZE_SCOPE}); el default es no congelar.` };
  }
  if (!isNonEmptyString(approval.approvalRef)) {
    return { code: "INVALID_OWNER_APPROVAL", message: "La aprobación declara su referencia explícita." };
  }
  const authority = approval.approvedBy;
  if (!authority || !isNonEmptyString(authority.authority) || !isNonEmptyString(authority.role) || authority.role === "POLICY") {
    return { code: "APPROVAL_AUTHORITY_INVALID", message: "La aprobación declara una autoridad distinta de la policy." };
  }
  if (approval.decision !== "APPROVED") {
    return { code: "APPROVAL_NOT_GRANTED", message: `La decisión registrada es "${String(approval.decision)}"; no congela.` };
  }
  if (approval.scope !== TRADES_FREEZE_SCOPE) {
    return { code: "APPROVAL_SCOPE_MISMATCH", message: `La aprobación declara scope "${String(approval.scope)}"; este acto exige "${TRADES_FREEZE_SCOPE}".` };
  }
  if (!isNonEmptyString(approval.approvedAtUtc)) {
    return { code: "INVALID_OWNER_APPROVAL", message: "La aprobación declara su instante." };
  }
  if (approval.configHash !== expectedConfigHash) {
    return { code: "APPROVAL_HASH_MISMATCH", message: "La aprobación cubre otro configHash; el freeze no se transfiere a un config distinto." };
  }
  return null;
}

function hold({ status, blockedBy, errors = [], reason, candidate = null }) {
  return {
    decision: "HOLD",
    status,
    contract: null,
    candidate,
    blockedBy: [...new Set(blockedBy)],
    errors,
    reason,
  };
}

// Un contrato con penalización o frescura UNKNOWN para alguna misión o regla de
// observación no se congela: el modelo de fill quedaría incompleto y no se
// sustituye por cero (patch 03 §3.3/§3.4). LOW_COVERAGE no bloquea: es un estado
// de data declarado.
function unmeasuredParameters(contract) {
  const unmeasured = [];
  for (const [missionKey, definition] of Object.entries(TRADES_MISSIONS)) {
    const entry = contract.markets?.[definition.market]?.missions?.[missionKey];
    if (!entry) continue;
    for (const rule of OBSERVATION_RULE_LIST) {
      const observation = entry.observations?.[rule];
      if (observation?.penalty?.status !== "MEASURED") {
        unmeasured.push({ mission: missionKey, observationRule: rule, parameter: "penaltyEurMwh", status: observation?.penalty?.status ?? "MISSING" });
      }
      if (observation?.freshness?.status !== "SELECTED_DEVELOPMENT") {
        unmeasured.push({ mission: missionKey, observationRule: rule, parameter: "freshnessLimitSeconds", status: "PENDING_DEVELOPMENT_SELECTION" });
      }
    }
  }
  return unmeasured;
}

// Evalúa el freeze. Fail-closed en cada eslabón: sin medición del puente, sin la
// política de broken spread ligada a la medición, con una política de TR-01
// inconsistente, con un contrato inválido, con parámetros sin medir o sin la
// aprobación de Bru ligada al hash, no hay FROZEN.
export function evaluateTradesFreeze({
  measurement = null,
  sourceDecision = null,
  deleteTmSemantics = null,
  ownerApproval = null,
  developmentSelection = null,
  generatedFrom = {},
} = {}) {
  const blockedBy = [];
  if (!measurement || typeof measurement !== "object") blockedBy.push("MISSING_BRIDGE_MEASUREMENT");
  const measurementPolicy = isDeclaredBrokenSpreadPolicy(measurement?.brokenSpreadPolicy)
    ? measurement.brokenSpreadPolicy
    : null;
  if (measurementPolicy === null) blockedBy.push("MISSING_BROKEN_SPREAD_POLICY");
  if (blockedBy.length > 0) {
    return hold({
      status: "PENDING_MEASUREMENT",
      blockedBy,
      reason: "La medición del puente (TR-03), que trae la política de broken spread bajo la que se midió, es un job que lanza Bru; hasta que exista no se inventa ninguna penalización ni límite de frescura.",
    });
  }

  // La política congelable sale de la medición (TR-03). Si la decisión de fuente
  // de TR-01 declara una política concreta distinta, los dos documentos se
  // contradicen: HOLD, no se elige una arbitrariamente.
  const sourceDecisionPolicy = sourceDecision?.brokenSpreadPolicy ?? null;
  if (isDeclaredBrokenSpreadPolicy(sourceDecisionPolicy) && sourceDecisionPolicy !== measurementPolicy) {
    return hold({
      status: "INCONSISTENT_BROKEN_SPREAD_POLICY",
      blockedBy: ["BROKEN_SPREAD_POLICY_MISMATCH"],
      errors: [{ field: "brokenSpreadPolicy", code: "BROKEN_SPREAD_POLICY_MISMATCH", message: `La medición del puente se corrió con "${measurementPolicy}" y TR-01 declara "${sourceDecisionPolicy}"; el freeze no elige una arbitrariamente.` }],
      reason: "La política de broken spread del contrato no coincide con la que usó la medición de TR-03.",
    });
  }

  const candidate = buildTradesFreezeCandidate({ measurement, sourceDecision, deleteTmSemantics, developmentSelection, generatedFrom });
  if (JSON.stringify(measurement.freshnessLimitsSeconds) !== JSON.stringify(FRESHNESS_LIMIT_CANDIDATES_SECONDS)) {
    return hold({ status: "PENDING_MEASUREMENT", blockedBy: ["BRIDGE_MEASUREMENT_GRID_STALE"], reason: "TR-03 debe medir la grilla 15m, 30m, 1h, 4h y 24h antes del freeze.", candidate });
  }
  const validation = validateTradesContract(candidate);
  if (!validation.ok) {
    return hold({
      status: "REJECTED",
      blockedBy: validation.errors.map((error) => error.code),
      errors: validation.errors,
      reason: "El candidato de freeze no satisface su propio schema; no se congela.",
      candidate,
    });
  }

  const unmeasured = unmeasuredParameters(candidate);
  if (unmeasured.length > 0) {
    const awaitingDevelopment = unmeasured.some((entry) => entry.parameter === "freshnessLimitSeconds");
    return hold({
      status: awaitingDevelopment ? "PENDING_DEVELOPMENT_SELECTION" : "PENDING_MEASUREMENT",
      blockedBy: awaitingDevelopment ? ["DEVELOPMENT_SELECTION_MISSING"] : ["UNMEASURED_CONTRACT_PARAMETERS"],
      errors: unmeasured,
      reason: awaitingDevelopment ? "Falta elegir la frescura por misión usando sólo la grilla completa de Development; el freeze queda en HOLD." : "Hay penalizaciones sin medición suficiente en el puente; el freeze queda en HOLD y no se sustituyen por cero.",
      candidate,
    });
  }

  const approvalProblem = freezeApprovalProblem(ownerApproval, candidate.configHash);
  if (approvalProblem) {
    return hold({
      status: "PENDING_OWNER_APPROVAL",
      blockedBy: [approvalProblem.code],
      errors: [approvalProblem],
      reason: approvalProblem.message,
      candidate,
    });
  }

  return {
    decision: "FROZEN",
    status: "FROZEN",
    contract: {
      ...candidate,
      status: "FROZEN",
      approval: {
        approvalRef: ownerApproval.approvalRef,
        approvedBy: { authority: ownerApproval.approvedBy.authority, role: ownerApproval.approvedBy.role },
        // `decision` se copia para que la aprobación congelada siga siendo
        // validable por `freezeApprovalProblem`: sin este campo el propio
        // resultado FROZEN no pasa su validador (revisión TR05-FREEZE-SHAPE-02).
        decision: ownerApproval.decision,
        approvedAtUtc: ownerApproval.approvedAtUtc,
        scope: ownerApproval.scope,
        configHash: ownerApproval.configHash,
      },
    },
    candidate,
    blockedBy: [],
    errors: [],
    reason: null,
  };
}
