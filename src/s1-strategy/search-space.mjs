// Search space predeclarado y congelado de S1 (IMP-11). Fuente: SPEC v1.1.1
// §8.6 ("predeclarar espacio de búsqueda; usar development/calibration
// cronológicos; preferir regiones estables; congelar parámetros") y §25.1
// IMP-11 (output "search space"). El espacio se declara ANTES del experimento y
// no se amplía tras examinar el OOS (§13.8): ampliarlo o reescribirlo crea una
// versión nueva y consume el OOS.

import { contentHashOf } from "../sizing-controller/versioning.mjs";
import {
  CENTER_STATISTICS,
  HORIZON_KINDS,
  MOVING_AVERAGE_KINDS,
  REFERENCE_FAMILIES,
  S1_CANONICAL_FEATURES,
  UNINSTANTIATED_REFERENCE_FAMILIES,
  assertHorizonsSeparated,
} from "./feature-definitions.mjs";

function isNonEmptyArray(value) {
  return Array.isArray(value) && value.length > 0;
}

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

// §8.6: cada dimensión del espacio de búsqueda se enumera ex-ante. Un espacio
// vacío no es un espacio: no se "busca" sobre dimensiones sin declarar.
export function defineSearchSpace({
  spaceId,
  referenceFamilies,
  lengths,
  timeframes,
  horizons,
  centerStatistics = [],
  movingAverageKinds = [],
  bandWidths = [],
  favorableFeatures,
  thresholdValues,
  provenance,
} = {}) {
  const errors = [];
  if (typeof spaceId !== "string" || spaceId.trim().length === 0) {
    errors.push({ field: "spaceId", code: "MISSING_SPACE_ID", message: "El search space declara su identidad." });
  }
  if (!isNonEmptyArray(referenceFamilies) || referenceFamilies.some((family) => !Object.hasOwn(REFERENCE_FAMILIES, family))) {
    errors.push({ field: "referenceFamilies", code: "INVALID_REFERENCE_FAMILIES", message: `referenceFamilies debe enumerar familias de ${Object.keys(REFERENCE_FAMILIES).join(", ")}.` });
  } else if (referenceFamilies.some((family) => UNINSTANTIATED_REFERENCE_FAMILIES.includes(family))) {
    // H-IMP11-01: una familia no instanciada (D) no entra en el espacio de
    // búsqueda; incluirla sería predeclarar un eje sin implementación.
    errors.push({
      field: "referenceFamilies",
      code: "REFERENCE_FAMILY_NOT_INSTANTIATED",
      message: `Las familias ${UNINSTANTIATED_REFERENCE_FAMILIES.join(", ")} no están instanciadas en esta versión de S1; el search space no debe predeclarlas (§8.6).`,
    });
  }
  if (!isNonEmptyArray(lengths) || lengths.some((length) => !Number.isInteger(length) || length < 2)) {
    errors.push({ field: "lengths", code: "INVALID_LENGTHS", message: "lengths debe enumerar enteros >= 2." });
  }
  if (!isNonEmptyArray(timeframes) || timeframes.some((timeframe) => typeof timeframe !== "string" || timeframe.trim().length === 0)) {
    errors.push({ field: "timeframes", code: "INVALID_TIMEFRAMES", message: "timeframes debe enumerar frecuencias de observación no vacías." });
  }
  if (!isNonEmptyArray(horizons)) {
    errors.push({ field: "horizons", code: "MISSING_HORIZONS", message: "horizons debe enumerar los horizontes admitidos." });
  } else {
    const horizonOutcome = assertHorizonsSeparated(horizons.map((horizon) => ({ horizon })));
    errors.push(...horizonOutcome.errors);
  }
  if (Array.isArray(referenceFamilies) && referenceFamilies.includes("A")
    && (!isNonEmptyArray(centerStatistics) || centerStatistics.some((statistic) => !CENTER_STATISTICS.includes(statistic)))) {
    errors.push({ field: "centerStatistics", code: "MISSING_CENTER_STATISTICS", message: `La familia A exige centerStatistics en ${CENTER_STATISTICS.join(", ")}.` });
  }
  if (Array.isArray(referenceFamilies) && referenceFamilies.includes("B")
    && (!isNonEmptyArray(movingAverageKinds) || movingAverageKinds.some((kind) => !MOVING_AVERAGE_KINDS.includes(kind)))) {
    errors.push({ field: "movingAverageKinds", code: "MISSING_MOVING_AVERAGE_KINDS", message: `La familia B exige movingAverageKinds en ${MOVING_AVERAGE_KINDS.join(", ")}.` });
  }
  if (Array.isArray(referenceFamilies) && referenceFamilies.includes("C")
    && (!isNonEmptyArray(bandWidths) || bandWidths.some((width) => !isFiniteNumber(width) || width <= 0))) {
    errors.push({ field: "bandWidths", code: "MISSING_BAND_WIDTHS", message: "La familia C exige bandWidths numéricos > 0." });
  }
  if (!isNonEmptyArray(favorableFeatures) || favorableFeatures.some((feature) => !S1_CANONICAL_FEATURES.includes(feature))) {
    errors.push({ field: "favorableFeatures", code: "INVALID_FAVORABLE_FEATURES", message: `favorableFeatures debe enumerar features de ubicación de S1 (${S1_CANONICAL_FEATURES.join(", ")}).` });
  }
  if (!isNonEmptyArray(thresholdValues) || thresholdValues.some((value) => !isFiniteNumber(value))) {
    errors.push({ field: "thresholdValues", code: "INVALID_THRESHOLD_VALUES", message: "thresholdValues debe enumerar umbrales numéricos predeclarados." });
  }
  if (!provenance || typeof provenance !== "object" || typeof provenance.authority !== "string" || typeof provenance.locator !== "string") {
    errors.push({ field: "provenance", code: "NO_PROVENANCE", message: "El search space debe declarar authority y locator de su origen." });
  }
  if (errors.length > 0) {
    return { ok: false, errors };
  }
  const core = {
    spaceId,
    referenceFamilies: [...referenceFamilies],
    lengths: [...lengths],
    timeframes: [...timeframes],
    horizons: horizons.map((horizon) => ({ horizonId: horizon.horizonId, kind: horizon.kind })),
    centerStatistics: [...centerStatistics],
    movingAverageKinds: [...movingAverageKinds],
    bandWidths: [...bandWidths],
    favorableFeatures: [...favorableFeatures],
    thresholdValues: [...thresholdValues],
    provenance,
  };
  return {
    ok: true,
    searchSpace: {
      artifactKind: "IMP-11_S1_SEARCH_SPACE",
      ...core,
      status: "FROZEN_PRE_EXPERIMENT",
      predeclared: true,
      frozenBeforeOos: true,
      contentHash: contentHashOf(core),
    },
  };
}

// §8.6/§13.8: el espacio se predeclara. Un espacio no predeclarado (armado a
// mano) no es un espacio congelado.
export function assertSearchSpacePredeclared(searchSpace) {
  if (!searchSpace || searchSpace.artifactKind !== "IMP-11_S1_SEARCH_SPACE"
    || searchSpace.predeclared !== true || searchSpace.frozenBeforeOos !== true
    || typeof searchSpace.contentHash !== "string") {
    return {
      ok: false,
      code: "SEARCH_SPACE_NOT_PREDECLARED",
      message: "El search space debe ser el artifact predeclarado y congelado (defineSearchSpace); no se acepta una lista armada al vuelo (§8.6/§13.8).",
    };
  }
  return { ok: true };
}

// §8.6/§8.1: el punto elegido (referencia + feature/umbral favorable) debe caer
// dentro del espacio declarado. Elegir fuera del espacio es búsqueda no
// predeclarada: se rechaza.
export function assertPointInSearchSpace(searchSpace, point = {}) {
  const errors = [];
  const membership = [
    ["family", "referenceFamilies"],
    ["length", "lengths"],
    ["timeframe", "timeframes"],
  ];
  for (const [pointKey, spaceKey] of membership) {
    if (!searchSpace?.[spaceKey]?.includes(point[pointKey])) {
      errors.push({ field: pointKey, code: "POINT_OUT_OF_SPACE", message: `${pointKey}=${JSON.stringify(point[pointKey])} no está en ${spaceKey} del search space predeclarado.` });
    }
  }
  if (UNINSTANTIATED_REFERENCE_FAMILIES.includes(point.family)) {
    errors.push({ field: "family", code: "REFERENCE_FAMILY_NOT_INSTANTIATED", message: "La familia no está instanciada en esta versión de S1." });
  }
  const horizonMatch = searchSpace?.horizons?.some((horizon) => horizon.horizonId === point.horizon?.horizonId && horizon.kind === point.horizon?.kind);
  if (!horizonMatch) {
    errors.push({ field: "horizon", code: "POINT_OUT_OF_SPACE", message: "El horizonte de la referencia no está declarado en el search space." });
  }
  if (point.family === "A" && !searchSpace?.centerStatistics?.includes(point.centerStatistic)) {
    errors.push({ field: "centerStatistic", code: "POINT_OUT_OF_SPACE", message: "centerStatistic no está en el search space." });
  }
  if (point.family === "B" && !searchSpace?.movingAverageKinds?.includes(point.movingAverageKind)) {
    errors.push({ field: "movingAverageKind", code: "POINT_OUT_OF_SPACE", message: "movingAverageKind no está en el search space." });
  }
  if (point.family === "C" && !searchSpace?.bandWidths?.includes(point.bandWidth)) {
    errors.push({ field: "bandWidth", code: "POINT_OUT_OF_SPACE", message: "bandWidth no está en el search space." });
  }
  if (!searchSpace?.favorableFeatures?.includes(point.favorableFeature)) {
    errors.push({ field: "favorableFeature", code: "POINT_OUT_OF_SPACE", message: "La feature favorable no está en el search space." });
  }
  if (!searchSpace?.thresholdValues?.includes(point.thresholdValue)) {
    errors.push({ field: "thresholdValue", code: "POINT_OUT_OF_SPACE", message: "El umbral favorable no está en los thresholdValues predeclarados." });
  }
  return { ok: errors.length === 0, errors };
}

export { HORIZON_KINDS };
