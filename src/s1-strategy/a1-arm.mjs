// Brazo A1 — S1 candidate = A0 + únicamente S1. Fuente: SPEC v1.1.1 §13.4
// (A0 y A1 comparten obligación, deadline, oportunidades, controller y
// ejecución; A1 se diferencia sólo por usar S1 para BUY/WAIT), §13.5 P5.5
// (evidencia para timing: "A0 más únicamente S1"; S2–S5/Z/drivers excluidos;
// Procurement State no introduce timing alpha independiente), §13.9
// (A1=A0+S1) y §25.1 IMP-11 (MUST NOT: identidad S1; A1=A0+S1).
//
// A1 NO reimplementa el sizing: envuelve el brazo A0 y sólo puede convertir un
// BUY calendar en WAIT (o dejar el BUY) según la ubicación estática de S1. Si
// la referencia S1 no es válida, cae al timing de A0 y lo registra: no inventa
// ubicación.

import { assertSharedController } from "../sizing-controller/sizing-controller.mjs";
import { versionKeyOf } from "../sizing-controller/versioning.mjs";
import { assertConfigurationFrozen } from "./configuration.mjs";
import { validateA1TimingState } from "./feature-definitions.mjs";

// §8.1 Outputs/evidence + §8.1 Calibration concept: la preferencia es una regla
// calibrada sobre features continuas. Sin feature disponible la preferencia es
// UNKNOWN (no se decide con un valor inventado).
export function s1Preference({ features, thresholds } = {}) {
  if (!features || typeof features !== "object" || !thresholds) {
    return { ok: false, code: "MISSING_S1_FEATURES" };
  }
  const value = features[thresholds.feature];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return { ok: true, preference: "UNKNOWN", feature: thresholds.feature, value: null, reason: "FEATURE_UNAVAILABLE" };
  }
  const favorable = thresholds.favorableWhen === "LTE" ? value <= thresholds.value : value >= thresholds.value;
  return {
    ok: true,
    preference: favorable ? "FAVORABLE" : "UNFAVORABLE",
    feature: thresholds.feature,
    value,
    threshold: thresholds.value,
    favorableWhen: thresholds.favorableWhen,
  };
}

export function createA1Arm({ a0Arm, configuration, controller } = {}) {
  const configGuard = assertConfigurationFrozen(configuration);
  if (!configGuard.ok) {
    return { ok: false, code: configGuard.code, message: configGuard.message };
  }
  if (!a0Arm || typeof a0Arm.decideAtOpportunity !== "function") {
    return { ok: false, code: "MISSING_A0_ARM", message: "A1 envuelve el brazo A0; sin A0 no hay baseline compartido." };
  }
  const declaration = {
    armId: "A1",
    kind: "A0_PLUS_S1",
    // §13.9: lo único que A1 añade sobre A0 es S1.
    differsFromA0By: ["S1"],
    timingEvidence: "A0_CALENDAR + S1_STATIC_LOCATION",
    configurationHash: configuration.contentHash,
    controllerVersion: versionKeyOf({ contentHash: controller?.contentHash }) ?? null,
    a0CalendarId: a0Arm.calendarId ?? null,
  };
  return {
    ok: true,
    arm: {
      ...declaration,
      configuration,
      decideAtOpportunity(state = {}) {
        const stateGuard = validateA1TimingState(state);
        if (!stateGuard.ok) {
          return { ok: false, code: stateGuard.code, violations: stateGuard.violations, message: stateGuard.message };
        }
        const { currentDate, remainingVolumeMw, executionNotionalMw = 0, s1Features = null } = state;
        const a0Decision = a0Arm.decideAtOpportunity({ currentDate, remainingVolumeMw, executionNotionalMw });
        if (!a0Decision || a0Decision.ok !== true) {
          return a0Decision ?? { ok: false, code: "A0_DECISION_FAILED" };
        }
        // Sin BUY calendar no hay timing que alterar: la oportunidad/obligación
        // no ofrece acción (§13.4).
        if (a0Decision.action === "NO_OPPORTUNITY" || a0Decision.action === "WAIT" || a0Decision.requestedQuantityMw === 0) {
          return { ...a0Decision, armId: "A1", s1Preference: null, s1Status: "NOT_APPLICABLE" };
        }
        // §8.1 uncertainty/unavailable: sin features S1 la ubicación es UNKNOWN
        // (no se inventa) y A1 cae al timing de A0.
        const preference = s1Features === null
          ? { ok: true, preference: "UNKNOWN", feature: configuration.thresholds.feature, value: null, reason: "FEATURE_UNAVAILABLE" }
          : s1Preference({ features: s1Features, thresholds: configuration.thresholds });
        if (!preference.ok) {
          return { ok: false, code: preference.code };
        }
        if (preference.preference === "UNFAVORABLE") {
          // WAIT: no hay compra; remaining y deadline originales siguen vigentes
          // (§13.4). La cantidad del controller no se toca.
          return {
            ok: true,
            armId: "A1",
            action: "WAIT",
            requestedQuantityMw: 0,
            s1Preference: preference.preference,
            s1Status: "AVAILABLE",
            s1Feature: preference.feature,
            s1Value: preference.value,
            controllerVersion: declaration.controllerVersion,
            note: "S1 ubica el precio fuera de la región favorable: WAIT conserva el remaining.",
          };
        }
        // FAVORABLE usa el BUY calendar de A0; UNKNOWN cae al baseline A0 sin
        // inventar ubicación (§8.1 uncertainty/unavailable).
        return {
          ...a0Decision,
          armId: "A1",
          s1Preference: preference.preference,
          s1Status: preference.preference === "UNKNOWN" ? "UNAVAILABLE_FALLBACK_A0" : "AVAILABLE",
          s1Feature: preference.feature,
          s1Value: preference.value,
        };
      },
      assertDecisionInvariant(observableState) {
        return validateA1TimingState(observableState);
      },
    },
  };
}

// §13.5/§25.1: A1 = A0 + S1. Ambos brazos comparten el MISMO controller y el
// mismo calendario/oportunidades; la única evidencia de timing que A1 añade es
// S1.
export function assertA1IsA0PlusS1({ a0Arm, a1Arm, a0ControllerVersion, a1ControllerVersion } = {}) {
  const controller = assertSharedController({ a0Version: a0ControllerVersion, a1Version: a1ControllerVersion });
  if (!controller.ok) {
    return controller;
  }
  if (a1Arm?.differsFromA0By?.length !== 1 || a1Arm.differsFromA0By[0] !== "S1") {
    return { ok: false, code: "A1_ADDS_MORE_THAN_S1", message: "A1 sólo puede añadir S1 sobre A0 (§13.9); otras capas son rescue del mismo experimento (§13.9)." };
  }
  const a0CalendarId = a0Arm?.calendarId ?? a0Arm?.calendar?.calendarId ?? null;
  const a1CalendarId = a1Arm?.a0CalendarId ?? null;
  if (a0CalendarId !== null && a1CalendarId !== null && a0CalendarId !== a1CalendarId) {
    return { ok: false, code: "OPPORTUNITY_PARITY_BROKEN", message: "A0 y A1 deben compartir las mismas oportunidades/calendario (§13.9)." };
  }
  return { ok: true, versionKey: controller.versionKey };
}

// §13.5: Procurement State sólo preserva restricciones; no puede introducir
// timing alpha independiente. A iguales features S1, la acción BUY/WAIT no
// puede depender del remaining volume.
export function assertTimingIndependentOfProcurementState({ a1Arm, currentDate, s1Features, remainingVariants } = {}) {
  if (!Array.isArray(remainingVariants) || remainingVariants.length === 0) {
    return { ok: false, code: "INVALID_PROCUREMENT_VARIANTS" };
  }
  const actions = remainingVariants.map((remainingVolumeMw) => {
    const decision = a1Arm.decideAtOpportunity({ currentDate, remainingVolumeMw, s1Features });
    return decision?.ok === true ? decision.action : null;
  });
  const unique = [...new Set(actions)];
  if (unique.length !== 1 || actions.includes(null)) {
    return {
      ok: false,
      code: "PROCUREMENT_STATE_ADDS_TIMING_ALPHA",
      actions,
      message: "La acción BUY/WAIT de A1 varió con el remaining volume a iguales features S1: Procurement State no puede añadir timing alpha (§13.5).",
    };
  }
  return { ok: true, action: unique[0], actions };
}

// §13.5/§25.1 MUST NOT "Procurement State no añade alpha independiente": a
// iguales features S1, la acción BUY/WAIT no puede variar con el remaining
// volume. Se demuestra POR EJECUCIÓN del brazo real variando remainingVolumeMw
// sobre uno o más conjuntos de features S1 fijos.
//
// §13.4 A0 reparte el volumen restante y, si el remaining no alcanza para un
// lote por oportunidad, su propio calendario da WAIT por factibilidad (no es
// timing alpha). Esos variantes se excluyen: sólo se comparan los remaining en
// los que A0 SÍ ofrece BUY. La aplicabilidad se determina con el A0 compartido
// cuando se provee; sin él, con el propio s1Status del brazo (createA1Arm marca
// "NOT_APPLICABLE" cuando A0 no ofrece BUY). Si ningún variante ofrece BUY, no
// hay evidencia y el probe es fail-closed. Productor de la check
// procurementStateAddsNoTimingAlpha del acceptance de IMP-11 (H-IMP11-03,
// review 2026-09-24).
export function probeTimingIndependentOfProcurementState({ a1Arm, a0Arm, currentDate, featureSets, s1Features, remainingVariants } = {}) {
  if (typeof a1Arm?.decideAtOpportunity !== "function") {
    return { ok: false, code: "MISSING_A1_ARM", procurementStateAddsNoTimingAlpha: false };
  }
  const sets = featureSets ?? (s1Features === undefined ? [] : [s1Features]);
  if (!Array.isArray(sets) || sets.length === 0) {
    return { ok: false, code: "INVALID_PROBE_FEATURES", procurementStateAddsNoTimingAlpha: false };
  }
  if (!Array.isArray(remainingVariants) || remainingVariants.length === 0) {
    return { ok: false, code: "INVALID_PROCUREMENT_VARIANTS", procurementStateAddsNoTimingAlpha: false };
  }
  const hasA0 = typeof a0Arm?.decideAtOpportunity === "function";
  const probes = sets.map((features) => {
    const applicableVariants = remainingVariants.filter((remainingVolumeMw) => {
      if (hasA0) {
        const a0Decision = a0Arm.decideAtOpportunity({ currentDate, remainingVolumeMw });
        return a0Decision?.ok === true && a0Decision.action === "BUY" && (a0Decision.requestedQuantityMw ?? 0) > 0;
      }
      const decision = a1Arm.decideAtOpportunity({ currentDate, remainingVolumeMw, s1Features: features });
      return decision?.ok === true && decision.s1Status !== "NOT_APPLICABLE";
    });
    if (applicableVariants.length === 0) {
      return { ok: false, code: "NO_APPLICABLE_PROCUREMENT_VARIANTS" };
    }
    return assertTimingIndependentOfProcurementState({
      a1Arm,
      currentDate,
      s1Features: features,
      remainingVariants: applicableVariants,
    });
  });
  const procurementStateAddsNoTimingAlpha = probes.every((probe) => probe.ok === true);
  return {
    ok: true,
    procurementStateAddsNoTimingAlpha,
    code: procurementStateAddsNoTimingAlpha ? "OK" : "PROCUREMENT_STATE_ADDS_TIMING_ALPHA",
    probes,
  };
}

// §13.5: prueba por ejecución (no declaración) de que un input prohibido es
// RECHAZADO en el camino de decisión: el guard validateA1TimingState corre
// dentro de decideAtOpportunity (a1-arm.mjs, §13.5/P5.5). Es el productor de
// la check noForbiddenTimingInputs del acceptance de IMP-11 (H-IMP11-02,
// review 2026-09-24).
export function probeForbiddenTimingInputsRejected({ a1Arm, forbiddenState } = {}) {
  if (!forbiddenState || typeof forbiddenState !== "object" || Array.isArray(forbiddenState)) {
    return { ok: false, code: "INVALID_FORBIDDEN_STATE", forbiddenInputsRejected: false };
  }
  const guard = validateA1TimingState(forbiddenState);
  if (guard.ok) {
    return { ok: false, code: "FORBIDDEN_STATE_NOT_FORBIDDEN", forbiddenInputsRejected: false, message: "El estado de prueba no contiene inputs prohibidos; no demuestra el guard." };
  }
  const decision = typeof a1Arm?.decideAtOpportunity === "function"
    ? a1Arm.decideAtOpportunity(forbiddenState)
    : null;
  const rejectedInDecisionPath = decision?.ok === false && decision?.code === "A1_TIMING_INPUT_REJECTED";
  return {
    ok: true,
    forbiddenInputsRejected: rejectedInDecisionPath,
    rejectedInputs: guard.violations,
    guardCode: guard.code,
    decisionCode: decision?.code ?? null,
  };
}

// §8.1/§13.5: prueba que SÓLO la ubicación estática altera el timing. Con la
// misma fecha y obligación, features favorables dan BUY y desfavorables WAIT.
export function probeStaticLocationTiming({ a1Arm, currentDate, remainingVolumeMw, favorableFeatures, unfavorableFeatures } = {}) {
  const favorable = a1Arm.decideAtOpportunity({ currentDate, remainingVolumeMw, s1Features: favorableFeatures });
  const unfavorable = a1Arm.decideAtOpportunity({ currentDate, remainingVolumeMw, s1Features: unfavorableFeatures });
  const onlyStaticLocationAltersTiming = favorable?.ok === true && unfavorable?.ok === true
    && favorable.action === "BUY" && unfavorable.action === "WAIT";
  return {
    onlyStaticLocationAltersTiming,
    favorableAction: favorable?.action ?? null,
    unfavorableAction: unfavorable?.action ?? null,
  };
}
