// Construcción causal de referencias S1 y features de ubicación. Fuente:
// SPEC v1.1.1 §8.1 (observable inputs: precio en el timestamp exacto de
// decisión, distancia a referencias válidas; outputs continuos percentile,
// normalized distance, signed distance; uncertainty/unavailable si la
// referencia no es válida), §6.1/§6.2 (semántica PIT: sólo lo conocido en el
// boundary) y §13.5 (el timing de A1 consume la ubicación S1, no la serie
// cruda). Nada de aquí usa extremos futuros, Benchmark B ni revisiones
// posteriores (§8.1 Refutation; §15.2).

import { toUtcTimestamp } from "../pit-views/time.mjs";
import {
  CENTER_STATISTICS,
  HORIZON_KINDS,
  MOVING_AVERAGE_KINDS,
  REFERENCE_FAMILIES,
  UNINSTANTIATED_REFERENCE_FAMILIES,
  validateHorizonDeclaration,
  validateStaticLocationFeatures,
} from "./feature-definitions.mjs";

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function mean(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function median(values) {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

function populationStdev(values, average) {
  const variance = values.reduce((sum, value) => sum + (value - average) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

// §8.1 Parameters: la instanciación declara la familia de referencia y sus
// parámetros (tipo de referencia, frecuencia/timeframe, longitud, anchura de
// bandas). El horizonte de procurement y el timeframe de muestreo son
// parámetros distintos; ambos se declaran.
export function buildCausalReference({
  family,
  length,
  horizon,
  timeframe,
  centerStatistic = null,
  movingAverageKind = null,
  bandWidth = null,
} = {}) {
  const errors = [];
  if (!Object.hasOwn(REFERENCE_FAMILIES, family)) {
    errors.push({ field: "family", code: "INVALID_REFERENCE_FAMILY", message: `La familia debe ser una de ${Object.keys(REFERENCE_FAMILIES).join(", ")} (§8.1).` });
  }
  if (!Number.isInteger(length) || length < 2) {
    errors.push({ field: "length", code: "INVALID_LENGTH", message: "length debe ser un entero >= 2 (lookback de la referencia)." });
  }
  if (typeof timeframe !== "string" || timeframe.trim().length === 0) {
    errors.push({ field: "timeframe", code: "MISSING_TIMEFRAME", message: "La frecuencia/timeframe de observación debe declararse (§8.1)." });
  }
  const horizonOutcome = validateHorizonDeclaration(horizon);
  errors.push(...horizonOutcome.errors);

  if (family === "A" && !CENTER_STATISTICS.includes(centerStatistic)) {
    errors.push({ field: "centerStatistic", code: "INVALID_CENTER_STATISTIC", message: `La familia A exige centerStatistic en ${CENTER_STATISTICS.join(", ")}.` });
  }
  if (family === "B" && !MOVING_AVERAGE_KINDS.includes(movingAverageKind)) {
    errors.push({ field: "movingAverageKind", code: "INVALID_MOVING_AVERAGE", message: `La familia B exige movingAverageKind en ${MOVING_AVERAGE_KINDS.join(", ")}.` });
  }
  if (family === "C" && (!isFiniteNumber(bandWidth) || bandWidth <= 0)) {
    errors.push({ field: "bandWidth", code: "INVALID_BAND_WIDTH", message: "La familia C exige bandWidth numérico > 0." });
  }
  if (UNINSTANTIATED_REFERENCE_FAMILIES.includes(family)) {
    errors.push({
      field: "family",
      code: "REFERENCE_FAMILY_NOT_INSTANTIATED",
      message: `La familia ${family} está declarada en §8.1 pero esta instanciación mínima de S1 no computa su identidad propia; no se acepta (fail-closed).`,
    });
  }
  if (errors.length > 0) {
    return { ok: false, errors };
  }
  return {
    ok: true,
    reference: {
      family,
      familyName: REFERENCE_FAMILIES[family],
      length,
      centerStatistic,
      movingAverageKind,
      bandWidth,
      timeframe,
      horizon: { horizonId: horizon.horizonId, kind: horizon.kind },
      status: "DECLARED",
    },
  };
}

function buildOrderedCausalWindow({ asOfUtc, decisionPrice, history }) {
  // §6.1: sólo observaciones conocidas en el boundary. Un instante posterior al
  // asOf es leakage y se rechaza: no se recorta en silencio.
  const observations = [];
  for (const [index, observation] of history.entries()) {
    if (observation === null || typeof observation !== "object") {
      return { ok: false, code: "INVALID_OBSERVATION", field: `history[${index}]` };
    }
    const anchored = toUtcTimestamp(observation.atUtc);
    if (!anchored.ok) {
      return { ok: false, code: "OBSERVATION_NOT_UTC_ANCHORED", field: `history[${index}].atUtc` };
    }
    if (!isFiniteNumber(observation.price)) {
      return { ok: false, code: "INVALID_OBSERVATION_PRICE", field: `history[${index}].price` };
    }
    if (Date.parse(anchored.utc) > Date.parse(asOfUtc)) {
      return { ok: false, code: "FUTURE_OBSERVATION_LEAKAGE", field: `history[${index}].atUtc`, atUtc: anchored.utc };
    }
    observations.push({ atUtc: anchored.utc, price: observation.price });
  }
  observations.sort((left, right) => left.atUtc.localeCompare(right.atUtc));
  observations.push({ atUtc: asOfUtc, price: decisionPrice });
  return { ok: true, observations };
}

// §8.1 Observable inputs + Outputs/evidence. Cálculo puramente causal: la
// ventana son las últimas `length` observaciones hasta el asOf inclusive. Si no
// hay historia suficiente la referencia NO es válida: se devuelve unavailable,
// nunca un valor inventado ni una extrapolación.
export function computeS1Features({ asOfUtc, decisionPrice, history = [], reference } = {}) {
  const anchored = toUtcTimestamp(asOfUtc);
  if (!anchored.ok) {
    return { ok: false, code: "AS_OF_NOT_UTC_ANCHORED" };
  }
  if (!isFiniteNumber(decisionPrice)) {
    return { ok: false, code: "INVALID_DECISION_PRICE" };
  }
  if (!reference || typeof reference !== "object" || !Object.hasOwn(REFERENCE_FAMILIES, reference.family)) {
    return { ok: false, code: "INVALID_REFERENCE" };
  }
  if (UNINSTANTIATED_REFERENCE_FAMILIES.includes(reference.family)) {
    return { ok: false, code: "REFERENCE_FAMILY_NOT_INSTANTIATED" };
  }
  if (!Array.isArray(history)) {
    return { ok: false, code: "INVALID_HISTORY" };
  }
  const windowOutcome = buildOrderedCausalWindow({ asOfUtc: anchored.utc, decisionPrice, history });
  if (!windowOutcome.ok) {
    return windowOutcome;
  }
  const window = windowOutcome.observations.slice(-reference.length);
  if (window.length < reference.length) {
    return {
      ok: true,
      available: false,
      status: "UNAVAILABLE",
      code: "INSUFFICIENT_CAUSAL_HISTORY",
      reason: `Se requieren ${reference.length} observaciones causales y sólo hay ${window.length}; la referencia no es válida (§8.1).`,
      horizonId: reference.horizon?.horizonId ?? null,
      referenceFamily: reference.family,
      windowSize: window.length,
      features: null,
      uncertainty: "INSUFFICIENT_CAUSAL_HISTORY",
    };
  }

  const prices = window.map((observation) => observation.price);
  const average = mean(prices);
  const scale = populationStdev(prices, average);
  let center;
  if (reference.family === "A") {
    center = reference.centerStatistic === "MEDIAN" ? median(prices) : average;
  } else if (reference.family === "B") {
    if (reference.movingAverageKind === "EMA") {
      const alpha = 2 / (reference.length + 1);
      center = prices[0];
      for (let index = 1; index < prices.length; index += 1) {
        center = alpha * prices[index] + (1 - alpha) * center;
      }
    } else {
      center = average;
    }
  } else {
    // C (bandas alrededor de un centro causal) usa el centro estadístico
    // causal; D se rechazó arriba como no instanciada (UNINSTANTIATED_REFERENCE_FAMILIES).
    center = average;
  }

  const percentile = prices.filter((price) => price <= decisionPrice).length / prices.length;
  const hasScale = scale > 0;
  const signedDistance = hasScale ? (decisionPrice - center) / scale : null;
  const normalizedDistance = hasScale ? Math.abs(signedDistance) : null;

  const features = {
    percentile,
    normalizedDistance,
    signedDistanceToReference: signedDistance,
  };
  const staticGuard = validateStaticLocationFeatures(features);
  if (!staticGuard.ok) {
    return { ok: false, code: staticGuard.code, violations: staticGuard.violations };
  }
  return {
    ok: true,
    available: true,
    status: "AVAILABLE",
    horizonId: reference.horizon?.horizonId ?? null,
    referenceFamily: reference.family,
    windowSize: window.length,
    observationAtUtc: window[window.length - 1].atUtc,
    center,
    scale,
    bands: reference.family === "C" && hasScale
      ? { lower: center - reference.bandWidth * scale, upper: center + reference.bandWidth * scale, bandWidth: reference.bandWidth }
      : null,
    features,
    uncertainty: hasScale ? null : "DEGENERATE_SCALE",
    // §8.1: una escala nula no admite distancia normalizada; se marca, no se
    // inventa un denominador.
    distanceAvailable: hasScale,
  };
}
