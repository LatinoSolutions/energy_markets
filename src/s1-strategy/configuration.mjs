// Configuration version de S1 (IMP-11). Fuente: SPEC v1.1.1 §8.1 (parameters y
// calibración: features continuas primero, thresholds como baselines
// interpretables; congelar antes de OOS), §8.6 (congelar parámetros; abrir
// recalibración sólo como ciclo versionado nuevo) y §25.1 IMP-11 (output
// "configuration version"; MUST NOT: identidad S1; A1=A0+S1). La configuración
// se identifica por content-hash y nace FROZEN_PRE_EXPERIMENT: no se ajusta tras
// observar outcomes (§13.2/§13.8).

import { contentHashOf } from "../sizing-controller/versioning.mjs";
import { toUtcTimestamp } from "../pit-views/time.mjs";
import {
  S1_CANONICAL_FEATURES,
  S1_EXPERIMENT_MISSION,
  S1_EXPERIMENT_PRODUCT,
  S1_SEMANTIC_IDENTITY,
  assertSemanticIdentityIntact,
  validateHorizonDeclaration,
} from "./feature-definitions.mjs";
import { assertPointInSearchSpace, assertSearchSpacePredeclared } from "./search-space.mjs";

// §8.1: features continuas primero y thresholds como baselines interpretables.
// La configuración mínima admite dos bases honestas: baseline interpretable
// predeclarado (sin ajuste) y calibración en development. Una base OOS queda
// prohibida: no es calibración, es consumo del OOS.
export const CALIBRATION_BASES = {
  PREDECLARED_INTERPRETABLE_BASELINE: "PREDECLARED_INTERPRETABLE_BASELINE",
  DEVELOPMENT_CALIBRATION: "DEVELOPMENT_CALIBRATION",
};

export const FAVORABLE_WHEN = ["LTE", "GTE"];

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

// §8.1: la regla interpretable declara qué ubicación considera favorable y con
// qué umbral. No fija un valor "aprobado": el valor debe venir del search space
// predeclarado.
export function createS1Configuration({
  reference,
  thresholds,
  searchSpace,
  calibrationBasis = CALIBRATION_BASES.PREDECLARED_INTERPRETABLE_BASELINE,
  provenance,
  frozenAtUtc,
} = {}) {
  const errors = [];
  const spaceGuard = assertSearchSpacePredeclared(searchSpace);
  if (!spaceGuard.ok) {
    errors.push({ field: "searchSpace", code: spaceGuard.code, message: spaceGuard.message });
  }
  if (!reference || typeof reference !== "object") {
    errors.push({ field: "reference", code: "MISSING_REFERENCE", message: "La configuración declara su referencia causal." });
  } else {
    const horizonOutcome = validateHorizonDeclaration(reference.horizon);
    errors.push(...horizonOutcome.errors);
  }
  if (!thresholds || typeof thresholds !== "object") {
    errors.push({ field: "thresholds", code: "MISSING_THRESHOLDS", message: "La configuración declara sus thresholds interpretables." });
  } else {
    if (!S1_CANONICAL_FEATURES.includes(thresholds.feature)) {
      errors.push({ field: "thresholds.feature", code: "INVALID_THRESHOLD_FEATURE", message: `thresholds.feature debe ser ${S1_CANONICAL_FEATURES.join(", ")}.` });
    }
    if (!FAVORABLE_WHEN.includes(thresholds.favorableWhen)) {
      errors.push({ field: "thresholds.favorableWhen", code: "INVALID_FAVORABLE_WHEN", message: `thresholds.favorableWhen debe ser ${FAVORABLE_WHEN.join(" o ")}.` });
    }
    if (!isFiniteNumber(thresholds.value)) {
      errors.push({ field: "thresholds.value", code: "INVALID_THRESHOLD_VALUE", message: "thresholds.value debe ser numérico." });
    }
  }
  if (!Object.values(CALIBRATION_BASES).includes(calibrationBasis)) {
    errors.push({ field: "calibrationBasis", code: "INVALID_CALIBRATION_BASIS", message: "La base de calibración debe ser una base declarada; una base derivada del OOS no es válida (§13.8)." });
  }
  if (!provenance || typeof provenance !== "object" || typeof provenance.authority !== "string" || typeof provenance.locator !== "string") {
    errors.push({ field: "provenance", code: "NO_PROVENANCE", message: "La configuración debe declarar authority y locator." });
  }
  const frozen = toUtcTimestamp(frozenAtUtc);
  if (!frozen.ok) {
    errors.push({ field: "frozenAtUtc", code: frozen.code, message: "La configuración exige un sello UTC de congelación antes de OOS." });
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  const point = {
    family: reference.family,
    length: reference.length,
    timeframe: reference.timeframe,
    horizon: { horizonId: reference.horizon.horizonId, kind: reference.horizon.kind },
    centerStatistic: reference.centerStatistic ?? null,
    movingAverageKind: reference.movingAverageKind ?? null,
    bandWidth: reference.bandWidth ?? null,
    favorableFeature: thresholds.feature,
    thresholdValue: thresholds.value,
  };
  const pointGuard = assertPointInSearchSpace(searchSpace, point);
  if (!pointGuard.ok) {
    return { ok: false, errors: pointGuard.errors };
  }

  const core = {
    semanticIdentity: S1_SEMANTIC_IDENTITY,
    canonicalFeatures: [...S1_CANONICAL_FEATURES],
    product: S1_EXPERIMENT_PRODUCT,
    mission: S1_EXPERIMENT_MISSION,
    reference: {
      family: reference.family,
      familyName: reference.familyName ?? null,
      length: reference.length,
      centerStatistic: reference.centerStatistic ?? null,
      movingAverageKind: reference.movingAverageKind ?? null,
      bandWidth: reference.bandWidth ?? null,
      timeframe: reference.timeframe,
      horizon: { horizonId: reference.horizon.horizonId, kind: reference.horizon.kind },
    },
    thresholds: {
      feature: thresholds.feature,
      favorableWhen: thresholds.favorableWhen,
      value: thresholds.value,
    },
    searchSpaceId: searchSpace.spaceId,
    searchSpaceHash: searchSpace.contentHash,
    calibrationBasis,
    thresholdsFrozen: true,
    frozenAtUtc: frozen.utc,
    provenance,
  };
  return {
    ok: true,
    configuration: {
      artifactKind: "IMP-11_S1_CONFIGURATION",
      ...core,
      status: "FROZEN_PRE_EXPERIMENT",
      contentHash: contentHashOf(core),
    },
  };
}

// §25.1 MUST NOT: la identidad S1 está congelada. Tampoco se admite que la
// configuración introduzca features de trayectoria (sería S3).
export function assertConfigurationFrozen(configuration) {
  if (!configuration || configuration.artifactKind !== "IMP-11_S1_CONFIGURATION"
    || configuration.status !== "FROZEN_PRE_EXPERIMENT"
    || typeof configuration.contentHash !== "string") {
    return { ok: false, code: "CONFIGURATION_NOT_FROZEN", message: "La configuración debe ser el artifact congelado de S1 (createS1Configuration)." };
  }
  const semantic = assertSemanticIdentityIntact(configuration);
  if (!semantic.ok) {
    return semantic;
  }
  if (configuration.thresholdsFrozen !== true) {
    return { ok: false, code: "THRESHOLDS_NOT_FROZEN", message: "Los thresholds deben declararse congelados antes del OOS." };
  }
  return { ok: true };
}
