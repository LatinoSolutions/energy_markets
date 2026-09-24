// Identidad de instancia de experimento IMP-20. Fuente: SPEC v1.1.1 §25.2.1
// ("instancia de ejecución" = SPEC ID/version/hash + IMP ID + scope + versión
// del objeto/protocolo) y §25.1 fila IMP-20 (experimentos predeclarados). La
// serialización es IMPLEMENTATION DETAIL; el linkage es normativo.

import { isVersionLike, isSha256 } from "../contracts/identities.mjs";

export const IMP20_EXPERIMENT_ID_PATTERN = /^IMP20-EX-[A-Z0-9]{1,12}-\d{2}$/;

export function isValidExperimentId(value) {
  return typeof value === "string" && IMP20_EXPERIMENT_ID_PATTERN.test(value);
}

// Identidad que toda instancia de experimento debe portar para poder ser
// comparada, reproducida o auditada después de ejecutarse.
export const EXPERIMENT_IDENTITY_FIELDS = Object.freeze([
  { key: "specId", source: "§25.2.1 SPEC ID" },
  { key: "specVersion", source: "§25.2.1 SPEC version" },
  { key: "specSha256", source: "§25.2.1 SPEC hash" },
  { key: "parentImp", source: "§25.2.1 IMP ID" },
  { key: "scope", source: "§25.2.1 scope" },
  { key: "objectVersion", source: "§25.2.1 versión del objeto" },
  { key: "protocolVersion", source: "§25.2.1 versión del protocolo" },
]);

export function validateExperimentIdentity(identity) {
  const errors = [];

  if (!isValidExperimentId(identity?.experimentId)) {
    errors.push({
      field: "experimentId",
      code: "INVALID_IDENTITY",
      message: "experimentId debe seguir el patrón IMP20-EX-<CAPA>-NN (§25.2.1).",
    });
  }

  if (typeof identity?.specId !== "string" || identity.specId.trim().length === 0) {
    errors.push({ field: "specId", code: "MISSING_REQUIRED", message: "Falta el SPEC ID obligatorio (§25.2.1)." });
  }
  if (!isVersionString(identity?.specVersion)) {
    errors.push({ field: "specVersion", code: "MISSING_VERSION", message: "specVersion no tiene forma de versión (§25.2.1)." });
  }
  if (!isSha256(identity?.specSha256)) {
    errors.push({ field: "specSha256", code: "MISSING_HASH", message: "specSha256 debe ser SHA-256 hex de 64 caracteres (§25.2.1)." });
  }
  if (identity?.parentImp !== "IMP-20") {
    errors.push({ field: "parentImp", code: "INVALID_PARENT", message: "El parent de la instancia debe ser IMP-20 (§25.2.1)." });
  }
  if (typeof identity?.scope !== "string" || identity.scope.trim().length === 0) {
    errors.push({ field: "scope", code: "MISSING_REQUIRED", message: "Falta el scope de la instancia (§25.2.1)." });
  }
  if (!isVersionLike(identity?.objectVersion) && !isVersionString(identity?.objectVersion)) {
    errors.push({ field: "objectVersion", code: "MISSING_VERSION", message: "objectVersion ausente o sin forma de versión (§25.2.1)." });
  }
  if (!isVersionLike(identity?.protocolVersion) && !isVersionString(identity?.protocolVersion)) {
    errors.push({ field: "protocolVersion", code: "MISSING_VERSION", message: "protocolVersion ausente o sin forma de versión (§25.2.1)." });
  }

  return { ok: errors.length === 0, errors };
}

function isVersionString(value) {
  return typeof value === "string" && /^v?\d+(?:\.\d+)+$/.test(value);
}
