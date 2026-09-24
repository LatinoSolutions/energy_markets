// Identidad de experimentos y candidatos de sizing de IMP-22 (§25.1 fila
// IMP-22; §§4.2,13.2,23,25.2.1). Una identidad es una unidad versionada
// separada: experimento de sizing por Mission, candidato de Sizing Policy,
// reserva. La identidad de instancia porta SPEC ID/version/hash + IMP ID
// parent + scope + versión del objeto/protocolo (§25.2.1).

import { isVersionLike, isSha256 } from "../contracts/identities.mjs";

// Identidad de la SPEC que gobierna los diseños IMP-22. El test de binding
// comprueba este hash contra los bytes del doc canónico v1_1_1 (mismo patrón
// que IMP-20). Hash calculado con sha256sum del doc vigente 2026-09-24.
export const IMP22_SPEC_IDENTITY = {
  id: "PROCUREMENT_RESEARCH_CANONICAL_ENGINEERING_SPEC_v1_1_1.md",
  version: "1.1.1",
  sha256: "d1bb4172a494a8900f782ecd4256d90bbaddd547b098b034be2867ab7884ed8b",
};

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

  // §25.2.1: instancia de ejecución = SPEC ID/version/hash + IMP ID parent +
  // scope + versión del objeto/protocolo. Sin el hash de SPEC no hay binding
  // de procedencia ni detección de colisión de versiones (Ref: hallazgo
  // IMP22-H3; mismo criterio que src/imp20-experiments/identity.mjs).
  if (identity.specId !== IMP22_SPEC_IDENTITY.id) {
    errors.push({
      field: "identity.specId",
      code: "SPEC_IDENTITY_INVALID",
      message: `specId debe ser el doc canónico ${IMP22_SPEC_IDENTITY.id} (§25.2.1).`,
    });
  }
  if (identity.specVersion !== IMP22_SPEC_IDENTITY.version) {
    errors.push({
      field: "identity.specVersion",
      code: "SPEC_IDENTITY_INVALID",
      message: `specVersion debe ser ${IMP22_SPEC_IDENTITY.version} (§25.2.1).`,
    });
  }
  if (!isSha256(identity?.specSha256) || identity.specSha256 !== IMP22_SPEC_IDENTITY.sha256) {
    errors.push({
      field: "identity.specSha256",
      code: "SPEC_IDENTITY_INVALID",
      message: "specSha256 debe ser el SHA-256 hex de 64 caracteres del doc canónico v1.1.1 (§25.2.1).",
    });
  }
  if (identity.parentImp !== "IMP-22") {
    errors.push({
      field: "identity.parentImp",
      code: "PARENT_IMP_REQUIRED",
      message: "parentImp debe ser IMP-22: las instancias conservan la identidad del IMP (§25.2.1).",
    });
  }
  if (typeof identity.scope !== "string" || identity.scope.trim().length === 0) {
    errors.push({
      field: "identity.scope",
      code: "SCOPE_REQUIRED",
      message: "scope requerido: el alcance efectivamente verificado queda identificado (§25.2.1).",
    });
  }
  if (!isVersionLike(identity?.objectVersion)) {
    errors.push({
      field: "identity.objectVersion",
      code: "OBJECT_VERSION_REQUIRED",
      message: "objectVersion ausente o sin forma de versión (§25.2.1).",
    });
  }
  if (!isVersionLike(identity?.protocolVersion)) {
    errors.push({
      field: "identity.protocolVersion",
      code: "PROTOCOL_VERSION_REQUIRED",
      message: "protocolVersion ausente o sin forma de versión (§25.2.1).",
    });
  }

  return { ok: errors.length === 0, errors };
}
