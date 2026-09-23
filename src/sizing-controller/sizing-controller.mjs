// Experimental sizing controller compartido por A0 y A1. Fuente: SPEC v1.1.1
// §13.2 P5.2: q_t(control) = RemainingVolume_t / RemainingScheduledOpportunities_t;
// "Si lotes o restricciones reales impiden la distribución exacta, la versión
// reconciliada se audita, predeclara y congela antes del experimento,
// aplicándose a A0 y A1. No se ajusta después de observar outcomes."
// Paridad de restricciones operativas: lotes 1 MW y cap diario 12 MW/day son
// PROVISIONAL según el paquete del cliente (IMP-07 execution parameters:
// trade_increment=1 MW AUDITED; normal_max_mw_per_day=12 MW/day provisional).
// El controller es experimental: NO es la Sizing Policy final (guard §25.1) y
// el baseline A0 no es benchmark B.
import { contentHashOf, versionKeyOf } from "./versioning.mjs";

export const CONTROLLER_KIND = "EXPERIMENTAL_SIZING_CONTROLLER";

export const RECONCILED_RULE_PREDECLARATION = {
  ruleId: "SIZING-RECON-V1",
  steps: [
    "Distribución exacta: q_exact = RemainingVolume / RemainingScheduledOpportunities.",
    "Rounding a lotes: redondeo hacia abajo al múltiplo de lotSize (floor), sin lotes mínimos inventados si el exacto cae por debajo.",
    "Cap diario: min(q, dailyCap) se aplica a cada opportunity.",
    "Diferencia remanente: se acumula tras cada oportunidad y se re-distribuye homogéneamente sobre las oportunidades restantes en el siguiente paso (recalculando q_exact con el remaining vivo).",
    "Última oportunidad programada: BUY de min(remaining, dailyCap). Si aún queda volumen no servible, el resultado es FEASIBILITY_HOLD explícito: no se inventa excepción al cap.",
  ],
  declaration: "Regla reconciliada ex-ante: se declara antes del experimento, se congela por content-hash y se aplica idéntica a A0 y A1. No se ajusta tras observar outcomes.",
};

export const IS_NOT_FINAL_SIZING_POLICY = "Este controller es el comparador experimental P5.2; no reemplaza la Sizing Policy futura ni la separación entre BUY/WAIT y sizing (§13.2).";

export function createSizingController({ lotSizeMw, dailyCapMw, provenance } = {}) {
  const errors = [];
  if (typeof lotSizeMw !== "number" || !Number.isFinite(lotSizeMw) || lotSizeMw <= 0 || !Number.isInteger(lotSizeMw)) {
    errors.push({ field: "lotSizeMw", code: "INVALID_LOT_SIZE", message: "lotSizeMw debe ser un entero positivo (MW)." });
  }
  if (typeof dailyCapMw !== "number" || !Number.isFinite(dailyCapMw) || dailyCapMw <= 0) {
    errors.push({ field: "dailyCapMw", code: "INVALID_DAILY_CAP", message: "dailyCapMw debe ser un número positivo (MW/day)." });
  }
  if (!provenance || typeof provenance.authority !== "string" || typeof provenance.locator !== "string") {
    errors.push({ field: "provenance", code: "NO_PROVENANCE", message: "La configuración del controller debe declarar authority y locator (§14.2)." });
  }
  if (errors.length > 0) {
    return { ok: false, errors };
  }
  const config = {
    kind: CONTROLLER_KIND,
    ruleId: RECONCILED_RULE_PREDECLARATION.ruleId,
    lotSizeMw,
    dailyCapMw,
    provenance,
    status: "FROZEN_PRE_EXPERIMENT",
  };
  return {
    ok: true,
    controller: {
      ...config,
      contentHash: contentHashOf(config),
    },
  };
}

// Distribución exacta. Si no quedan oportunidades y queda volumen, NO hay
// sizing posible: error explícito, nunca un default inventado.
export function exactControlQuantity({ remainingVolumeMw, remainingOpportunitiesCount } = {}) {
  if (!Number.isFinite(remainingVolumeMw) || remainingVolumeMw < 0) {
    return { ok: false, code: "INVALID_REMAINING_VOLUME" };
  }
  if (!Number.isInteger(remainingOpportunitiesCount) || remainingOpportunitiesCount < 0) {
    return { ok: false, code: "INVALID_REMAINING_OPPORTUNITIES" };
  }
  if (remainingOpportunitiesCount === 0) {
    if (remainingVolumeMw > 0) {
      return { ok: false, code: "INFEASIBLE_NO_OPPORTUNITIES", exactQuantityMw: null };
    }
    return { ok: true, exactQuantityMw: 0, status: "COMPLETED" };
  }
  return {
    ok: true,
    exactQuantityMw: remainingVolumeMw / remainingOpportunitiesCount,
    status: "OPEN",
  };
}

// Regla reconciliada: floor a lotes, cap diario y residual re-distribuido en
// el siguiente ciclo (la obligación viva se recalcula en cada opportunity con
// el remaining real). FEASIBILITY_HOLD si la última oportunidad no alcanza.
export function reconcileControlQuantity({ remainingVolumeMw, remainingOpportunitiesCount, controller, isLastScheduledOpportunity = false } = {}) {
  const exact = exactControlQuantity({ remainingVolumeMw, remainingOpportunitiesCount });
  if (!exact.ok) {
    return { ok: false, code: exact.code, feasibility: exact.code === "INFEASIBLE_NO_OPPORTUNITIES" ? "HOLD" : null, exactQuantityMw: exact.exactQuantityMw ?? null };
  }
  if (exact.status === "COMPLETED" || remainingVolumeMw === 0) {
    return { ok: true, action: isLastScheduledOpportunity ? "WAIT" : "NO_ACTION", requestedQuantityMw: 0, feasibility: "OK", exactQuantityMw: 0 };
  }
  if (!controller?.ok && controller?.controller === undefined) {
    const lot = controller?.lotSizeMw;
    const cap = controller?.dailyCapMw;
    if (typeof lot !== "number" || !Number.isFinite(lot) || typeof cap !== "number" || !Number.isFinite(cap)) {
      return { ok: false, code: "INVALID_CONTROLLER" };
    }
    return decide({ remainingVolumeMw, remainingOpportunitiesCount, lotSizeMw: lot, dailyCapMw: cap, isLastScheduledOpportunity, exactQuantityMw: exact.exactQuantityMw });
  }
  return decide({
    remainingVolumeMw,
    remainingOpportunitiesCount,
    lotSizeMw: controller.controller.lotSizeMw,
    dailyCapMw: controller.controller.dailyCapMw,
    isLastScheduledOpportunity,
    exactQuantityMw: exact.exactQuantityMw,
  });
}

function decide({ remainingVolumeMw, remainingOpportunitiesCount, lotSizeMw, dailyCapMw, isLastScheduledOpportunity, exactQuantityMw }) {
  if (isLastScheduledOpportunity) {
    const capped = Math.min(remainingVolumeMw, dailyCapMw);
    const requested = Math.floor(capped / lotSizeMw) * lotSizeMw;
    if (requested < remainingVolumeMw) {
      return {
        ok: true,
        action: "BUY",
        requestedQuantityMw: requested,
        feasibility: "HOLD",
        feasibilityReason: `La última oportunidad programada con cap ${dailyCapMw} MW/day no alcanza el remaining ${remainingVolumeMw} MW: no se inventa excepción al cap.`,
        exactQuantityMw,
      };
    }
    return { ok: true, action: "BUY", requestedQuantityMw: requested, feasibility: "OK", exactQuantityMw };
  }
  const exact = Math.min(exactQuantityMw, dailyCapMw);
  const requested = Math.floor(exact / lotSizeMw) * lotSizeMw;
  return {
    ok: true,
    action: requested > 0 ? "BUY" : "WAIT",
    requestedQuantityMw: requested,
    feasibility: "OK",
    exactQuantityMw,
  };
}

// Paridad: A0 y A1 comparten el MISMO content-hash de configuración del
// controller. Cualquier divergencia rompe la ablation A1 = A0 + S1 (§13.9).
export function assertSharedController({ a0Controller, a1Controller, a0Version, a1Version } = {}) {
  const a0Key = a0Version ? versionKeyOf({ contentHash: a0Version }) : versionKeyOf({ contentHash: a0Controller?.contentHash });
  const a1Key = a1Version ? versionKeyOf({ contentHash: a1Version }) : versionKeyOf({ contentHash: a1Controller?.contentHash });
  if (!a0Key || !a1Key) {
    return { ok: false, code: "MISSING_CONTROLLER_VERSION", message: "Cada brazo debe declarar la versión del controller compartido." };
  }
  if (a0Key !== a1Key) {
    return { ok: false, code: "CONTROLLER_VERSION_MISMATCH", message: "A0 y A1 declaran versiones distintas del sizing controller: paridad rota." };
  }
  return { ok: true, versionKey: a0Key };
}
