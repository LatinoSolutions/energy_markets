// Motor de medición de mercado del puente (TR-03), sin estrategia. Fuente:
// TRADES_MODE_PLAN.md TR-03 y OWNER_PATCH_TRADES_MODE_2026-09-25.md §3-§4.
//
// Para cada campaign del puente, por mercado, misión, instrumento y slot
// (08:00-17:30 Berlin, cada 30 min), en 2025-08-12..2026-07-28 mide:
//   - antigüedad del último trade elegible en el instante de decisión;
//   - % de slots con observación dentro de cada límite de frescura candidato;
//   - diferencia entre la observación TRADES (LAST_TRADE y SLOT_VWAP) y el best
//     ask en ESE instante, por distancia a entrega, lado agresor, estado DIP10,
//     bucket de antigüedad y mitad cronológica;
//   - mitad de calibración y mitad de evaluación por separado.
//
// No lee ledgers, fills ni resultados de estrategia: sólo filas de mercado
// (trades elegibles y best ask) y la identidad/ventana de las campaigns. El
// consumo de filas es day-local (acumula por día, como TR-01) para acotar RAM.

import { classifyMission, monthsToDelivery } from "../trades-source/patch0-density.mjs";
import { isEligibleTrade } from "../trades-source/eligibility.mjs";
import {
  isDeletedAt,
  tradeEpochMs,
  tradeLegIdentity,
} from "../trades-source/delete-point-in-time.mjs";
import { contractKey } from "../trades-source/coverage.mjs";
import { dedupTrades } from "../trades-source/dedup.mjs";
import {
  BRIDGE_WINDOW,
  DIP10,
  DIP10_HISTORY_RULE,
  FRESHNESS_LIMIT_CANDIDATES_SECONDS,
  HALVES,
  OBSERVATION_RULES,
  OBSERVATION_RULE_LIST,
  SLOT_LABELS,
  SLOT_STEP_SECONDS,
  TRADES_BRIDGE_ACCEPTANCE_TEST,
  TRADES_BRIDGE_VERSION,
  TRADES_PATCH_IDENTITY,
} from "./constants.mjs";
import { bridgeHalves, halfOfDate, isWithinWindow, slotEpochsForDay } from "./time.mjs";
import { ageBucketOf, dip10State, parsePrice, pickLastTrade, slotVwap } from "./observations.mjs";

// ---------------------------------------------------------------------------
// Estadística acumulable. Los valores crudos se guardan hasta `finish()` para
// poder calcular percentiles exactos; el volumen del puente es chico (decenas de
// miles de slots) y el artefacto NO incluye los arrays crudos.
// ---------------------------------------------------------------------------

function quantile(sortedValues, q) {
  if (sortedValues.length === 0) return null;
  if (sortedValues.length === 1) return sortedValues[0];
  const position = (sortedValues.length - 1) * q;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sortedValues[lower];
  const weight = position - lower;
  return sortedValues[lower] * (1 - weight) + sortedValues[upper] * weight;
}

export function summarizeValues(values, { shareNegative = false } = {}) {
  const sorted = values.slice().sort((left, right) => left - right);
  const count = sorted.length;
  const base = {
    count,
    mean: null,
    stdev: null,
    min: null,
    max: null,
    p10: null,
    p50: null,
    p90: null,
  };
  if (shareNegative) base.shareNegative = null;
  if (count === 0) return base;
  const sum = sorted.reduce((total, value) => total + value, 0);
  const mean = sum / count;
  const variance = count === 1 ? 0 : sorted.reduce((total, value) => total + (value - mean) ** 2, 0) / (count - 1);
  const summary = {
    count,
    mean,
    stdev: Math.sqrt(variance),
    min: sorted[0],
    max: sorted[count - 1],
    p10: quantile(sorted, 0.1),
    p50: quantile(sorted, 0.5),
    p90: quantile(sorted, 0.9),
  };
  if (shareNegative) {
    summary.shareNegative = sorted.filter((value) => value < 0).length / count;
  }
  return summary;
}

function emptyCoverageState() {
  return {
    slotsTotal: 0,
    slotsWithObservation: 0,
    byLimit: new Map(FRESHNESS_LIMIT_CANDIDATES_SECONDS.map((limit) => [limit, 0])),
    ages: [],
    byHalf: {
      [HALVES.CALIBRATION]: { slotsTotal: 0, slotsWithObservation: 0, byLimit: new Map(), ages: [] },
      [HALVES.EVALUATION]: { slotsTotal: 0, slotsWithObservation: 0, byLimit: new Map(), ages: [] },
    },
    bySlot: SLOT_LABELS.map(() => ({ slotsTotal: 0, slotsWithObservation: 0, byLimit: new Map(), ages: [] })),
  };
}

function emptyGapState() {
  return {
    overall: [],
    byDistance: new Map(),
    byAggressor: new Map(),
    byDip10: new Map(),
    // TR-04 §3.3: la penalización trade->ask se congela condicionada al estado de
    // señal (DIP10 compraría) Y al lado agresor a la vez. Los cortes por separado
    // no permiten cruzar ambos; este cross-tab es el que TR-04 consume.
    byDip10StateByAggressor: new Map(),
    // TR-04 §3.3 + plan TR-03/TR-06: la calibración del fill sale de la MITAD de
    // calibración, no del puente entero; la mitad de evaluación se reserva para
    // el gate de TR-06. El cruce señal × agresor necesita su propio corte por
    // mitad para no contaminar la calibración con la evaluación.
    byHalfByDip10StateByAggressor: new Map(),
    // TR-04 §3.4 (corrección de TR04-PENALTY-STALE-OBS): la penalización trade->ask
    // no puede calibrarse con observaciones fuera del límite de frescura congelado
    // (patch 03 §3.4: un trade fuera del límite = sin observación). El cross-tab
    // por mitad debe poder filtrarse por el límite elegido; se publica una variante
    // por cada límite candidato, con el límite como primer segmento de la clave.
    byHalfByDip10StateByAggressorByLimit: new Map(),
    byHalf: new Map(),
    byAgeBucket: new Map(),
  };
}

function emptyRuleState() {
  return { coverage: emptyCoverageState(), gaps: emptyGapState() };
}

function emptyCampaignState() {
  return Object.fromEntries(OBSERVATION_RULE_LIST.map((rule) => [rule, emptyRuleState()]));
}

function pushToMap(map, key, value) {
  if (!map.has(key)) map.set(key, []);
  map.get(key).push(value);
}

function bumpLimit(map, limit) {
  map.set(limit, (map.get(limit) ?? 0) + 1);
}

function registerSlot({ coverage, slotIndex, half, observation }) {
  coverage.slotsTotal += 1;
  const slotBucket = coverage.bySlot[slotIndex];
  slotBucket.slotsTotal += 1;
  const halfBucket = coverage.byHalf[half];
  halfBucket.slotsTotal += 1;
  if (observation === null) return;
  coverage.slotsWithObservation += 1;
  slotBucket.slotsWithObservation += 1;
  halfBucket.slotsWithObservation += 1;
  coverage.ages.push(observation.ageSeconds);
  slotBucket.ages.push(observation.ageSeconds);
  halfBucket.ages.push(observation.ageSeconds);
  for (const limit of FRESHNESS_LIMIT_CANDIDATES_SECONDS) {
    if (observation.ageSeconds <= limit) {
      bumpLimit(coverage.byLimit, limit);
      bumpLimit(slotBucket.byLimit, limit);
      bumpLimit(halfBucket.byLimit, limit);
    }
  }
}

function registerGap({ gaps, gap, distanceMonths, aggressor, dip10, half, ageSeconds }) {
  gaps.overall.push(gap);
  pushToMap(gaps.byDistance, distanceMonths, gap);
  pushToMap(gaps.byAggressor, aggressor, gap);
  pushToMap(gaps.byDip10, dip10, gap);
  // TR-04 §3.3: cruce señal × agresor. `dip10` siempre está definido cuando hay
  // observación (si no, no se registra gap); el agresor conserva su propio grupo
  // (UNKNOWN / MIXED nunca se reasignan a un lado por suposición).
  pushToMap(gaps.byDip10StateByAggressor, `${dip10}|${aggressor}`, gap);
  pushToMap(gaps.byHalfByDip10StateByAggressor, `${half}|${dip10}|${aggressor}`, gap);
  // Variante por límite de frescura: sólo entran las observaciones dentro del
  // límite, que es lo que TR-04 puede congelar (patch 03 §3.4).
  for (const limit of FRESHNESS_LIMIT_CANDIDATES_SECONDS) {
    if (ageSeconds <= limit) pushToMap(gaps.byHalfByDip10StateByAggressorByLimit, `${limit}|${half}|${dip10}|${aggressor}`, gap);
  }
  pushToMap(gaps.byHalf, half, gap);
  pushToMap(gaps.byAgeBucket, ageBucketOf(ageSeconds), gap);
}

// ---------------------------------------------------------------------------
// Acumulador day-local
// ---------------------------------------------------------------------------

function campaignContractKey(campaign) {
  return contractKey({ ShortCode: campaign.shortCode, Maturity: campaign.legacyMaturity });
}

function validateCampaign(campaign, errors) {
  const contract = campaignContractKey(campaign);
  if (contract === "") {
    errors.push({ code: "MISSING_CONTRACT", message: `La campaign "${campaign?.campaignId}" no declara ShortCode y maturity legada; sin contrato no se puede medir.` });
    return;
  }
  if (!Array.isArray(campaign.windowDays) || campaign.windowDays.length === 0) {
    errors.push({ code: "MISSING_WINDOW_DAYS", message: `La campaign "${campaign.campaignId}" no declara windowDays (Exchange Days de su ventana); la ventana sale del calendario (patch 03 §3.4), nunca de la presencia de trades.` });
  }
}

export function createBridgeMeasurementAccumulator({
  campaigns,
  askSeries = new Map(),
  brokenSpreadPolicy,
  freshnessLimitsSeconds = FRESHNESS_LIMIT_CANDIDATES_SECONDS,
  window = BRIDGE_WINDOW,
  halves = bridgeHalves(window),
  slotLabels = SLOT_LABELS,
} = {}) {
  const errors = [];
  if (!Array.isArray(campaigns) || campaigns.length === 0) {
    errors.push({ code: "NO_CAMPAIGNS", message: "El puente no tiene campaigns; no hay población que medir." });
  }
  const campaignsByContract = new Map();
  const decisionDays = new Map();
  for (const campaign of campaigns ?? []) {
    validateCampaign(campaign, errors);
    const contract = campaignContractKey(campaign);
    if (contract === "") continue;
    if (campaignsByContract.has(contract)) {
      errors.push({ code: "DUPLICATE_CONTRACT", message: `El contrato "${contract}" está en más de una campaign del puente; la atribución sería ambigua.` });
      continue;
    }
    campaignsByContract.set(contract, campaign);
    for (const day of campaign.windowDays ?? []) {
      if (!isWithinWindow(day, window)) {
        errors.push({ code: "DAY_OUTSIDE_BRIDGE", message: `La campaign "${campaign.campaignId}" tiene un día (${day}) fuera del puente; la medición no se corre sobre ese día.` });
        continue;
      }
      if (!decisionDays.has(day)) decisionDays.set(day, []);
      decisionDays.get(day).push(campaign);
    }
  }

  const state = new Map();
  for (const campaign of campaigns ?? []) {
    if (campaign?.campaignId) state.set(campaign.campaignId, emptyCampaignState());
  }

  // Todos los Exchange Days de decisión del puente, en orden. La ventana sale
  // del calendario, nunca de la presencia de trades (patch 03 §3.4): un día sin
  // filas se mide igual y sus slots cuentan como sin observación, no se borran.
  const allDecisionDays = [...decisionDays.keys()].sort();

  const deleteIndex = new Map();
  const carried = new Map();
  const dipWindows = new Map();
  let nextDecisionIndex = 0;
  let rowsSeen = 0;
  let rowsInScope = 0;
  let duplicateRows = 0;
  let unparsableDeleteTm = 0;
  let currentDay = null;
  let pending = [];

  function dipKey(campaignId, slotIndex, rule) {
    return `${campaignId}\u0001${slotIndex}\u0001${rule}`;
  }

  function dayEligibleRows(rows, contract, mission) {
    const eligible = [];
    for (const row of rows) {
      if (row?.UpdtAct === "Delete") continue;
      if (contractKey(row) !== contract) continue;
      const classified = classifyMission(row);
      if (mission !== null && classified?.mission !== mission) continue;
      if (!isEligibleTrade(row, { brokenSpreadPolicy })) continue;
      if (parsePrice(row) === null) continue;
      eligible.push(row);
    }
    return eligible;
  }

  function processSlot({ campaign, contract, dayIso, slotIndex, decisionEpochMs, half, dayEligible, askSlot }) {
    const campaignState = state.get(campaign.campaignId);
    const slotStartEpochMs = decisionEpochMs - SLOT_STEP_SECONDS * 1000;
    const carriedRow = carried.get(contract) ?? null;
    const candidates = [];
    const slotEligible = [];
    if (carriedRow !== null && carriedRow.epochMs <= decisionEpochMs && !isDeletedAt(carriedRow.row, decisionEpochMs, deleteIndex)) {
      candidates.push(carriedRow.row);
    }
    for (const row of dayEligible) {
      const epoch = tradeEpochMs(row.Tm);
      if (epoch === null || epoch > decisionEpochMs) continue;
      if (isDeletedAt(row, decisionEpochMs, deleteIndex)) continue;
      candidates.push(row);
      slotEligible.push(row);
    }
    const last = pickLastTrade(candidates);
    // El VWAP usa la misma elegibilidad point-in-time que el LAST_TRADE: un trade
    // con Delete visible en el instante de decisión ya no está en el slot.
    const vwap = slotVwap(slotEligible, { slotStartEpochMs, decisionEpochMs });
    const observations = {
      [OBSERVATION_RULES.LAST_TRADE]: last === null ? null : { value: last.price, epochMs: last.epochMs, aggressor: last.aggressor },
      [OBSERVATION_RULES.SLOT_VWAP]: vwap === null ? null : { value: vwap.vwap, epochMs: vwap.lastEpochMs, aggressor: vwap.aggressor },
    };

    for (const rule of OBSERVATION_RULE_LIST) {
      const ruleState = campaignState[rule];
      const observation = observations[rule];
      let observed = null;
      if (observation !== null) {
        const ageSeconds = (decisionEpochMs - observation.epochMs) / 1000;
        observed = { ...observation, ageSeconds };
      }
      registerSlot({ coverage: ruleState.coverage, slotIndex, half, observation: observed });

      const key = dipKey(campaign.campaignId, slotIndex, rule);
      const previousValues = dipWindows.get(key) ?? [];
      let dipState = null;
      if (observed !== null) {
        dipState = dip10State({ previousValues, value: observed.value });
        dipWindows.set(key, [...previousValues, observed.value].slice(-DIP10.LOOKBACK));
      }
      if (observed !== null && askSlot !== null && askSlot !== undefined && askSlot.ask !== undefined) {
        const gap = observed.value - askSlot.ask;
        registerGap({
          gaps: ruleState.gaps,
          gap,
          distanceMonths: monthsToDelivery(dayIso, campaign.legacyMaturity),
          aggressor: observed.aggressor,
          dip10: dipState,
          half,
          ageSeconds: observed.ageSeconds,
        });
      }
    }
  }

  function flushDay(dayIso, rows) {
    rowsSeen += rows.length;
    // Dedup entre pulls con la clave de TR-01 (patch 03 §3.1): las columnas de
    // provenance `_` no identifican el trade y no deben inflar el VWAP ni los
    // conteos. El dedup es day-local, como en TR-01.
    const deduped = dedupTrades(rows);
    duplicateRows += deduped.duplicates;
    const uniqueRows = deduped.rows;

    for (const row of uniqueRows) {
      if (row?.UpdtAct !== "Delete") continue;
      const epoch = tradeEpochMs(row.Tm);
      if (epoch === null) {
        // Mismo criterio que TR-01 (delete-point-in-time.mjs:52-55): un Delete con
        // Tm ilegible no se descarta en silencio, se cuenta.
        unparsableDeleteTm += 1;
        continue;
      }
      const identity = tradeLegIdentity(row);
      if (!deleteIndex.has(identity)) deleteIndex.set(identity, []);
      deleteIndex.get(identity).push(epoch);
    }
    for (const list of deleteIndex.values()) list.sort((left, right) => left - right);

    const scopedRows = uniqueRows.filter((row) => campaignsByContract.has(contractKey(row)));
    rowsInScope += scopedRows.length;
    const dayEndEpoch = Date.parse(`${dayIso}T23:59:59.999Z`);

    // Primero se miden los slots del día usando `carried` como semilla de días
    // PREVIOS (no incluye trades posteriores al slot que se está midiendo); el
    // arrastre se actualiza después de medir.
    const campaignsToday = decisionDays.get(dayIso);
    if (campaignsToday) {
      const slotEpochs = slotEpochsForDay(dayIso);
      const half = halfOfDate(dayIso, halves);
      for (const campaign of campaignsToday) {
        const contract = campaignContractKey(campaign);
        const askDay = askSeries.get(contract)?.get(dayIso) ?? null;
        const dayEligible = dayEligibleRows(scopedRows, contract, campaign.mission);
        for (let slotIndex = 0; slotIndex < slotLabels.length; slotIndex += 1) {
          processSlot({
            campaign,
            contract,
            dayIso,
            slotIndex,
            decisionEpochMs: slotEpochs[slotIndex],
            half,
            dayEligible,
            askSlot: askDay === null ? null : askDay[slotIndex],
          });
        }
      }
    }

    // Actualiza el último trade arrastrado de cada contrato del scope para los
    // días siguientes. Un trade borrado antes del fin del día no se arrastra.
    for (const contract of campaignsByContract.keys()) {
      const campaign = campaignsByContract.get(contract);
      const eligible = dayEligibleRows(scopedRows, contract, campaign.mission);
      if (eligible.length === 0) continue;
      let best = carried.get(contract) ?? null;
      for (const row of eligible) {
        const epoch = tradeEpochMs(row.Tm);
        const price = parsePrice(row);
        if (epoch === null || price === null) continue;
        if (isDeletedAt(row, dayEndEpoch, deleteIndex)) continue;
        if (best === null || epoch > best.epochMs) {
          best = { row, epochMs: epoch, price };
        }
      }
      if (best !== null) carried.set(contract, best);
    }
  }

  // Mide los Exchange Days de decisión que quedaron antes de `dayIso` y que no
  // trajeron filas: se miden con `carried` de los días previos y cuentan sus
  // slots como sin observación si no hay trade elegible (patch 03 §3.4).
  function flushDecisionDaysBefore(dayIso) {
    while (nextDecisionIndex < allDecisionDays.length && allDecisionDays[nextDecisionIndex] < dayIso) {
      flushDay(allDecisionDays[nextDecisionIndex], []);
      nextDecisionIndex += 1;
    }
  }

  function addRows(rows) {
    for (const row of rows) {
      const rowDay = row?.TrdDate ?? "";
      if (currentDay !== null && rowDay !== currentDay) {
        if (rowDay < currentDay) {
          throw new Error(`NDJSON fuera de orden por TrdDate: ${rowDay} después de ${currentDay}`);
        }
        flushDay(currentDay, pending);
        if (allDecisionDays[nextDecisionIndex] === currentDay) nextDecisionIndex += 1;
        pending = [];
        flushDecisionDaysBefore(rowDay);
      } else if (currentDay === null) {
        flushDecisionDaysBefore(rowDay);
      }
      currentDay = rowDay;
      pending.push(row);
    }
  }

  function finish() {
    if (currentDay !== null) {
      flushDay(currentDay, pending);
      if (allDecisionDays[nextDecisionIndex] === currentDay) nextDecisionIndex += 1;
      pending = [];
    }
    while (nextDecisionIndex < allDecisionDays.length) {
      flushDay(allDecisionDays[nextDecisionIndex], []);
      nextDecisionIndex += 1;
    }
    return { errors, state, rowsSeen, rowsInScope, duplicateRows, unparsableDeleteTm, campaignsByContract, window, halves, slotLabels, freshnessLimitsSeconds, brokenSpreadPolicy };
  }

  return { addRows, finish };
}

// ---------------------------------------------------------------------------
// Materialización del artefacto
// ---------------------------------------------------------------------------

function finalizeCoverage(coverage, freshnessLimitsSeconds) {
  const byLimit = {};
  for (const limit of freshnessLimitsSeconds) {
    const count = coverage.byLimit.get(limit) ?? 0;
    byLimit[String(limit)] = {
      slotsWithObservationWithinLimit: count,
      coverage: coverage.slotsTotal === 0 ? null : count / coverage.slotsTotal,
    };
  }
  return {
    slotsTotal: coverage.slotsTotal,
    slotsWithObservation: coverage.slotsWithObservation,
    coverage: coverage.slotsTotal === 0 ? null : coverage.slotsWithObservation / coverage.slotsTotal,
    coverageByLimit: byLimit,
    ageSeconds: summarizeValues(coverage.ages),
    byHalf: Object.fromEntries(Object.entries(coverage.byHalf).map(([half, bucket]) => [
      half,
      {
        slotsTotal: bucket.slotsTotal,
        slotsWithObservation: bucket.slotsWithObservation,
        coverage: bucket.slotsTotal === 0 ? null : bucket.slotsWithObservation / bucket.slotsTotal,
        coverageByLimit: Object.fromEntries(freshnessLimitsSeconds.map((limit) => [String(limit), {
          slotsWithObservationWithinLimit: bucket.byLimit.get(limit) ?? 0,
          coverage: bucket.slotsTotal === 0 ? null : (bucket.byLimit.get(limit) ?? 0) / bucket.slotsTotal,
        }])),
        ageSeconds: summarizeValues(bucket.ages),
      },
    ])),
    bySlot: SLOT_LABELS.map((label, index) => {
      const bucket = coverage.bySlot[index];
      return {
        slot: label,
        slotsTotal: bucket.slotsTotal,
        slotsWithObservation: bucket.slotsWithObservation,
        coverage: bucket.slotsTotal === 0 ? null : bucket.slotsWithObservation / bucket.slotsTotal,
        coverageByLimit: Object.fromEntries(freshnessLimitsSeconds.map((limit) => [String(limit), {
          slotsWithObservationWithinLimit: bucket.byLimit.get(limit) ?? 0,
          coverage: bucket.slotsTotal === 0 ? null : (bucket.byLimit.get(limit) ?? 0) / bucket.slotsTotal,
        }])),
      };
    }),
  };
}

function finalizeGapMap(map, keyName) {
  return [...map.entries()]
    .sort((left, right) => {
      if (typeof left[0] === "number" && typeof right[0] === "number") return left[0] - right[0];
      return String(left[0]) < String(right[0]) ? -1 : 1;
    })
    .map(([key, values]) => ({ [keyName]: key, ...summarizeValues(values, { shareNegative: true }) }));
}

function finalizeGaps(gaps) {
  return {
    overall: summarizeValues(gaps.overall, { shareNegative: true }),
    byDistanceMonths: finalizeGapMap(gaps.byDistance, "distanceMonths"),
    byAggressor: finalizeGapMap(gaps.byAggressor, "aggressor"),
    byDip10State: finalizeGapMap(gaps.byDip10, "dip10State"),
    byDip10StateByAggressor: finalizeGapMap(gaps.byDip10StateByAggressor, "combination"),
    byHalfByDip10StateByAggressor: finalizeGapMap(gaps.byHalfByDip10StateByAggressor, "combination"),
    byHalfByDip10StateByAggressorByLimit: finalizeGapMap(gaps.byHalfByDip10StateByAggressorByLimit, "combination"),
    byHalf: finalizeGapMap(gaps.byHalf, "half"),
    byAgeBucket: finalizeGapMap(gaps.byAgeBucket, "ageBucket"),
  };
}

function finalizeCampaign(campaign, campaignState, freshnessLimitsSeconds) {
  const contract = campaignContractKey(campaign);
  const coverage = {};
  const gaps = {};
  for (const rule of OBSERVATION_RULE_LIST) {
    coverage[rule] = finalizeCoverage(campaignState[rule].coverage, freshnessLimitsSeconds);
    gaps[rule] = finalizeGaps(campaignState[rule].gaps);
  }
  return {
    campaignId: campaign.campaignId,
    market: campaign.market,
    mission: campaign.mission,
    product: campaign.product,
    shortCode: campaign.shortCode,
    maturity: campaign.maturity,
    legacyMaturity: campaign.legacyMaturity,
    instrument: contract,
    windowStart: campaign.windowStart,
    windowEnd: campaign.windowEnd,
    deadline: campaign.deadline,
    exchangeDaysInWindow: campaign.windowDays.length,
    slotsTotal: campaign.windowDays.length * SLOT_LABELS.length,
    coverage,
    gaps,
  };
}

export function measureBridgeCampaigns({
  campaigns,
  askSeries = new Map(),
  brokenSpreadPolicy,
  freshnessLimitsSeconds = FRESHNESS_LIMIT_CANDIDATES_SECONDS,
  window = BRIDGE_WINDOW,
  halves = bridgeHalves(window),
  rows = [],
} = {}) {
  const accumulator = createBridgeMeasurementAccumulator({
    campaigns,
    askSeries,
    brokenSpreadPolicy,
    freshnessLimitsSeconds,
    window,
    halves,
  });
  const sorted = rows
    .map((row, index) => ({ row, index }))
    .sort((left, right) => {
      const a = left.row?.TrdDate ?? "";
      const b = right.row?.TrdDate ?? "";
      if (a < b) return -1;
      if (a > b) return 1;
      return left.index - right.index;
    })
    .map((entry) => entry.row);
  accumulator.addRows(sorted);
  return accumulator.finish();
}

// Construye el artefacto desde el estado acumulado. Separado para que el
// productor pueda streamear filas y llamar a `finish()` una sola vez.
export function buildBridgeArtifact({ finished, generatedFrom = {} }) {
  const { errors, state, campaignsByContract, window, halves, freshnessLimitsSeconds, rowsSeen, rowsInScope, duplicateRows, unparsableDeleteTm, brokenSpreadPolicy } = finished;
  if (errors.length > 0) {
    return {
      ok: false,
      errors,
      artifact: {
        artifactKind: "TR-03_BRIDGE_MEASUREMENT",
        schemaVersion: TRADES_BRIDGE_VERSION,
        status: "HOLD",
        spec: TRADES_PATCH_IDENTITY,
        window,
        errors,
      },
    };
  }

  const markets = {};
  for (const campaign of campaignsByContract.values()) {
    const campaignState = state.get(campaign.campaignId);
    const market = campaign.market;
    const mission = campaign.mission;
    if (!markets[market]) markets[market] = { market, missions: {} };
    if (!markets[market].missions[mission]) {
      markets[market].missions[mission] = {
        product: campaign.product,
        mission,
        market,
        shortCode: campaign.shortCode,
        campaigns: [],
      };
    }
    markets[market].missions[mission].campaigns.push(finalizeCampaign(campaign, campaignState, freshnessLimitsSeconds));
  }

  // Resumen por misión: agrega los arrays crudos de sus campaigns antes de
  // finalizar, para que los percentiles salgan de la unión real de valores.
  for (const market of Object.values(markets)) {
    for (const mission of Object.values(market.missions)) {
      mission.campaigns.sort((left, right) => left.campaignId < right.campaignId ? -1 : 1);
      const merged = emptyCampaignState();
      for (const campaign of mission.campaigns) {
        mergeCampaignState(merged, state.get(campaign.campaignId));
      }
      const summaryCoverage = {};
      const summaryGaps = {};
      for (const rule of OBSERVATION_RULE_LIST) {
        summaryCoverage[rule] = finalizeCoverage(merged[rule].coverage, freshnessLimitsSeconds);
        summaryGaps[rule] = finalizeGaps(merged[rule].gaps);
      }
      mission.summary = { coverage: summaryCoverage, gaps: summaryGaps };
    }
  }

  const artifact = {
    artifactKind: "TR-03_BRIDGE_MEASUREMENT",
    schemaVersion: TRADES_BRIDGE_VERSION,
    status: "MEASURED",
    spec: TRADES_PATCH_IDENTITY,
    acceptanceTest: TRADES_BRIDGE_ACCEPTANCE_TEST,
    window: { ...window },
    slotsBerlin: SLOT_LABELS,
    slotStepSeconds: SLOT_STEP_SECONDS,
    freshnessLimitsSeconds,
    observationRules: OBSERVATION_RULE_LIST,
    dip10HistoryRule: DIP10_HISTORY_RULE,
    brokenSpreadPolicy,
    halves,
    generatedFrom,
    counts: {
      rowsSeen,
      rowsInScope,
      duplicateRows,
      unparsableDeleteTm,
      campaigns: campaignsByContract.size,
    },
    markets,
  };
  return { ok: true, errors: [], artifact };
}

// Agrega el estado crudo de una campaign en otro (resumen por misión). Suma
// conteos y concatena valores: los percentiles se calculan una sola vez al
// finalizar, sobre la unión real.
function mergeCoverageState(target, source) {
  target.slotsTotal += source.slotsTotal;
  target.slotsWithObservation += source.slotsWithObservation;
  for (const [limit, count] of source.byLimit) target.byLimit.set(limit, (target.byLimit.get(limit) ?? 0) + count);
  target.ages.push(...source.ages);
  for (const half of Object.keys(target.byHalf)) {
    const left = target.byHalf[half];
    const right = source.byHalf[half];
    left.slotsTotal += right.slotsTotal;
    left.slotsWithObservation += right.slotsWithObservation;
    for (const [limit, count] of right.byLimit) left.byLimit.set(limit, (left.byLimit.get(limit) ?? 0) + count);
    left.ages.push(...right.ages);
  }
  for (let index = 0; index < SLOT_LABELS.length; index += 1) {
    const left = target.bySlot[index];
    const right = source.bySlot[index];
    left.slotsTotal += right.slotsTotal;
    left.slotsWithObservation += right.slotsWithObservation;
    for (const [limit, count] of right.byLimit) left.byLimit.set(limit, (left.byLimit.get(limit) ?? 0) + count);
    left.ages.push(...right.ages);
  }
}

function mergeGapState(target, source) {
  target.overall.push(...source.overall);
  for (const dimension of ["byDistance", "byAggressor", "byDip10", "byDip10StateByAggressor", "byHalfByDip10StateByAggressor", "byHalfByDip10StateByAggressorByLimit", "byHalf", "byAgeBucket"]) {
    for (const [key, values] of source[dimension]) {
      if (!target[dimension].has(key)) target[dimension].set(key, []);
      target[dimension].get(key).push(...values);
    }
  }
}

function mergeCampaignState(target, source) {
  for (const rule of OBSERVATION_RULE_LIST) {
    mergeCoverageState(target[rule].coverage, source[rule].coverage);
    mergeGapState(target[rule].gaps, source[rule].gaps);
  }
}

