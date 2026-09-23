// A0 — Calendar-only / price-blind baseline. Fuente: SPEC v1.1.1 §13.2 P5.2
// (no reacciona a price location, trend, anomaly, structure ni información
// fundamental/extraordinaria), §13.5 P5.5 (S1-derived price location para
// cambiar BUY/WAIT: no permitido; precios sólo para ejecución/contabilidad),
// §13.4 BUY/WAIT semantics y guard §25.1 ("Baseline no es B; controlador no es
// Sizing Policy final; baseline timing no lee precios").
import { reconcileControlQuantity } from "./sizing-controller.mjs";

// Inputs prohibidos para el timing de A0. Su presencia en el estado de
// decisión es un rechazo duro (fail-closed), nunca un silencio.
export const FORBIDDEN_TIMING_INPUT_KEYS = [
  "prices", "priceFeatures", "bestAsk", "bestBid", "referencePrice", "lastPrice",
  "s1", "s1Features", "s2", "s3", "s4", "s5", "z", "drivers",
  "sentiment", "marketDynamics", "fundamentalDrivers", "extraordinaryState",
  "benchmarkB",
];

export function validateA0TimingState(state = {}) {
  const violations = Object.keys(state).filter((key) => FORBIDDEN_TIMING_INPUT_KEYS.includes(key));
  return {
    ok: violations.length === 0,
    violations,
    code: violations.length > 0 ? "PRICE_INPUT_REJECTED" : "OK",
    message: violations.length > 0
      ? "A0 es price-blind: su timing no puede consumir precios, S1–S5, Z, sentiment, drivers ni Extraordinary State (§13.2/§13.5)."
      : "Estado compatible con Calendar-only.",
  };
}

export function createA0Baseline({ controller, calendar } = {}) {
  const definition = {
    armId: "A0",
    kind: "CALENDAR_ONLY_PRICE_BLIND",
    ruleId: controller?.ruleId ?? null,
    controllerVersion: controller?.contentHash ?? null,
    // El calendario es la única evidencia de timing del baseline (§13.2).
    timingEvidence: "DECLARED_CALENDAR",
  };
  return {
    ok: true,
    arm: {
      ...definition,
      // Decisión en una opportunity: BUY predeclarado en todo el calendario
      // mientras haya remaining; el controller común fija la cantidad.
      decideAtOpportunity({ currentDate, remainingVolumeMw, executionNotionalMw = 0 } = {}) {
        const opportunities = calendar?.opportunities;
        if (!Array.isArray(opportunities) || typeof currentDate !== "string") {
          return { ok: false, code: "INVALID_DECISION_CONTEXT" };
        }
        const index = opportunities.findIndex((o) => o.date === currentDate);
        if (index === -1) {
          // Fuera del calendario no hay oportunidad: sólo avanzar el tiempo.
          return { ok: true, action: "NO_OPPORTUNITY", requestedQuantityMw: 0 };
        }
        const remainingScheduled = opportunities.length - index;
        const isLastScheduledOpportunity = remainingScheduled === 1;
        const reconciled = reconcileControlQuantity({
          remainingVolumeMw,
          remainingOpportunitiesCount: remainingScheduled,
          isLastScheduledOpportunity,
          controller: { lotSizeMw: controller?.lotSizeMw ?? controller?.controller?.lotSizeMw, dailyCapMw: controller?.dailyCapMw ?? controller?.controller?.dailyCapMw },
        });
        if (!reconciled.ok) {
          return reconciled;
        }
        // WAIT declarado: no BUY/quantity en esta opportunity (§13.4) y el
        // remaining/obligación/deadline originales siguen vigentes.
        if (reconciled.action === "NO_ACTION" || reconciled.requestedQuantityMw === 0) {
          return { ok: true, action: "WAIT", requestedQuantityMw: 0, feasibility: reconciled.feasibility, controllerVersion: definition.controllerVersion };
        }
        return {
          ok: true,
          action: reconciled.action,
          requestedQuantityMw: reconciled.requestedQuantityMw,
          feasibility: reconciled.feasibility,
          feasibilityReason: reconciled.feasibilityReason ?? null,
          remainingScheduledOpportunities: remainingScheduled,
          remainingVolumeBeforeBuyMw: remainingVolumeMw,
          controllerVersion: definition.controllerVersion,
          pricedExecutionNote: "Las cantidades y el timing no dependen de ningún precio; el execution contract P5.6 consume precios sólo para fills/accounting (§13.5).",
        };
      },
      // El estado observable en la frontera debe estar drenado de cualquier
      // input prohibido antes de decidir: fail-closed, sin silencio.
      assertDecisionInvariant(observableState) {
        return validateA0TimingState(observableState);
      },
    },
  };
}

// PRICE-BLINDNESS verificable: la decisión A0 es invariante ante cualquier
export function assertPriceBlindness({ decision, priceVariants } = {}) {
  if (!decision || !Array.isArray(priceVariants)) {
    return { ok: false, code: "INVALID_PRICE_BLINDNESS_INPUT" };
  }
  for (const variant of priceVariants) {
    if (!variant || typeof variant.state !== "object") {
      return { ok: false, code: "INVALID_PRICE_BLINDNESS_INPUT" };
    }
    const gate = validateA0TimingState(variant.state);
    if (!gate.ok) {
      return { ok: false, code: gate.code, violations: gate.violations };
    }
    if (variant.expectedAction && variant.expectedAction !== decision.action) {
      return { ok: false, code: "TIMING_DEPENDS_ON_PRICE", expected: variant.expectedAction, actual: decision.action };
    }
  }
  return { ok: true, code: "PRICE_BLIND_INVARIANT_HOLD" };
}

export function validateA0TimingIndependence(observableState) {
  return validateA0TimingState(observableState);
}
