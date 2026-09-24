// Reserva/split por Mission para una evaluación separada de sizing
// (DEP-12 §24; §25.2.3 IMP-22). La reserva de IMP-09 sólo acredita Gas
// Quarterly P5: una nueva Mission formaliza SU PROPIA reserva antes de
// seleccionar o calibrar parámetros, y prohibe reutilizar la reserva Gas
// Quarterly como si cubriera Power/Monthly. Historia insuficiente => HOLD,
// nunca poblaciones sustituidas.

import { IMP22_RESERVE_ID_PATTERN } from "./identity.mjs";
import { getMission, isMissionId } from "./missions.mjs";
// Contratos ya aceptados (IMP-09): el scope de la reserva de Gas Quarterly y
// el hashing canónico de estado se consumen del módulo aceptado, no se
// re-implementan aquí (Ref: hallazgo IMP22-H6).
import { OOS_PRODUCT, OOS_MISSION } from "../oos-reservation/campaign-register.mjs";
import { contentHashOf } from "../oos-reservation/reservation.mjs";

export { contentHashOf as reserveContentHashOf, OOS_PRODUCT as IMP09_OOS_PRODUCT, OOS_MISSION as IMP09_OOS_MISSION };

export const RESERVE_STATUS = { RESERVED: "RESERVED", HOLD: "HOLD" };

export function validateMissionReserve(reserve) {
  const errors = [];

  if (reserve == null || typeof reserve !== "object") {
    return { ok: false, errors: [{ field: "reserve", code: "RESERVE_MISSING", message: "reserve requerido." }] };
  }

  if (!IMP22_RESERVE_ID_PATTERN.test(reserve.reserveId ?? "")) {
    errors.push({
      field: "reserveId",
      code: "RESERVE_ID_PATTERN",
      message: `reserveId debe encajar ${IMP22_RESERVE_ID_PATTERN}.`,
    });
  }

  if (!isMissionId(reserve.missionId)) {
    errors.push({
      field: "missionId",
      code: "MISSION_ID_KNOWN",
      message: "La reserva pertenece a exactamente una Mission separada (§23).",
    });
  }

  const mission = getMission(reserve.missionId);
  if (mission != null) {
    // El minimum instalado debe ser el canónico de esa Mission; sustituir el
    // estándar (p.ej. Monthly con menos de 24 meses) es un downgrade prohibido
    // (§13.8 "no se acorta el estándar ni se sustituye la población" aplicado
    // por misión; DEP-12).
    const declared = reserve.minimumEvidence ?? {};
    const minimum = mission.minimumEvidence;
    for (const [key, value] of Object.entries(minimum)) {
      if (declared[key] !== value) {
        errors.push({
          field: `minimumEvidence.${key}`,
          code: "MINIMUM_STANDARD_DOWNGRADE",
          message: `El mínimo ${key}=${value} de ${mission.missionId} no se acorta ni sustituye (DEP-12; §13.8 aplicado por Mission).`,
        });
      }
    }
  }

  const split = reserve.split;
  if (split == null || typeof split !== "object") {
    errors.push({ field: "split", code: "SPLIT_REQUIRED", message: "split requerido: la frontera existe antes de seleccionar/calibrar parámetros (DEP-12). RESOLVES_AUDIT propio, no prerequisite del productor." });
  } else {
    // La frontera se registra en acto (antes de usar OOS), no de diseño;
    // HOLDER/EVIDENCE: un diseño pre-audit puede declarar HOLD sin frontera
    // todavía, pero al reservar (status RESERVED) debe ya existir (DEP-12).
    if (reserve.status === RESERVE_STATUS.RESERVED && (typeof split.boundary !== "string" || split.boundary.trim() === "")) {
      errors.push({
        field: "split.boundary",
        code: "SPLIT_BOUNDARY_REQUIRED",
        message: "status RESERVED exige frontera registrada antes de consumir/calibrar (DEP-12, orden de reserva).",
      });
    }
    if (split.randomShuffle === true) {
      errors.push({
        field: "split.randomShuffle",
        code: "RANDOM_SHUFFLE_FORBIDDEN",
        message: "Chronological split; random shuffle prohibido (§13.8).",
      });
    }
  }

  if (reserve.reusesGasQuarterlyImp09Reservation === true) {
    errors.push({
      field: "reusesGasQuarterlyImp09Reservation",
      code: "OOS_REUSE_FORBIDDEN",
      message: `La reserva Gas Quarterly de IMP-09 sólo acredita ${OOS_PRODUCT} ${OOS_MISSION} P5: prohibido reutilizarla para Power/Monthly (§25.2.3 IMP-22).`,
    });
  }

  if (reserve.status !== RESERVE_STATUS.RESERVED && reserve.status !== RESERVE_STATUS.HOLD) {
    errors.push({
      field: "status",
      code: "STATUS_KNOWN",
      message: `status debe ser RESERVED u HOLD; insuficiencia se registra HOLD, no poblaciones sustituidas (§13.8).`,
    });
  }

  if (reserve.missionAuditScopeDeclaresOwnHistory !== true) {
    errors.push({
      field: "missionAuditScopeDeclaresOwnHistory",
      code: "OWN_HISTORY_AUDIT_REQUIRED",
      message: "DEP-01–08 [producto/Mission del nuevo experimento]: la propia Mission necesita su mandato/ownership/calendario/lotes/PIT/B auditados; no hereda validez de una campaña Gas auditada (§25.2.3 IMP-22; §6.4).",
    });
  }

  return { ok: errors.length === 0, errors };
}
