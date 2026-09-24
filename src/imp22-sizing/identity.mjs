// Identidad de experimentos y candidatos de sizing de IMP-22 (§25.1 fila
// IMP-22; §§4.2,13.2,23). Una identidad es una unidad versionada separada:
// experimento de sizing por Mission, candidato de Sizing Policy, reserva.

export const IMP22_EXPERIMENT_ID_PATTERN = /^IMP22-EX-SZ\d{2}-\d{2}$/;

export const IMP22_SIZING_CANDIDATE_ID_PATTERN = /^IMP22-SZ-\d{2}-\d{2}$/;

export const IMP22_RESERVE_ID_PATTERN = /^IMP22-RSV-\d{2}-\d{2}$/;

export const MISSION_IDS = ["GAS-MONTHLY", "GAS-QUARTERLY", "POWER-MONTHLY", "POWER-QUARTERLY"];

export function isImp22ExperimentId(value) {
  return typeof value === "string" && IMP22_EXPERIMENT_ID_PATTERN.test(value);
}

export function isImp22SizingCandidateId(value) {
  return typeof value === "string" && IMP22_SIZING_CANDIDATE_ID_PATTERN.test(value);
}

export function isImp22ReserveId(value) {
  return typeof value === "string" && IMP22_RESERVE_ID_PATTERN.test(value);
}

export function validateIdentity(identity) {
  const errors = [];

  if (identity == null || typeof identity !== "object") {
    return { ok: false, errors: [{ field: "identity", code: "IDENTITY_MISSING", message: "identity requerido." }] };
  }

  if (!isImp22ExperimentId(identity.experimentId)) {
    errors.push({
      field: "identity.experimentId",
      code: "EXPERIMENT_ID_PATTERN",
      message: `experimentId debe encajar ${IMP22_EXPERIMENT_ID_PATTERN} (§25.1 fila IMP-22).`,
    });
  }

  if (!MISSION_IDS.includes(identity.missionId)) {
    errors.push({
      field: "identity.missionId",
      code: "MISSION_ID_KNOWN",
      message: `missionId debe ser uno de ${MISSION_IDS.join(", ")}: la evaluación es separada por producto/Mission (§23 OD-01).`,
    });
  }

  if (typeof identity.actionSpaceVersion !== "string" || identity.actionSpaceVersion.trim() === "") {
    errors.push({
      field: "identity.actionSpaceVersion",
      code: "ACTION_SPACE_VERSION_REQUIRED",
      message: "actionSpaceVersion requerido: añadir/modificar el action space exige versión explícita (§25.1 MUST NOT CHANGE).",
    });
  }

  if (typeof identity.createdAt !== "string" || Number.isNaN(Date.parse(identity.createdAt))) {
    errors.push({
      field: "identity.createdAt",
      code: "CREATED_AT_REQUIRED",
      message: "createdAt debe ser fecha ISO.",
    });
  }

  return { ok: errors.length === 0, errors };
}
