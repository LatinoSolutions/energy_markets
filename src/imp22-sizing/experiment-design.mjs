// Validación de diseños de experimentos IMP-22 (Sizing Policy + extensiones
// de misión). Un diseño válido: identidad completa, extensión de Mission
// cuenta separada, reserva/split propia (DEP-12), brazos de atribución con
// paridad declarada, candidatos de sizing versionados atados a brazos
// size-only, y guardas MUST NOT CHANGE en pie. Fail-closed.

import { validateIdentity } from "./identity.mjs";
import { validateMissionExtension } from "./missions.mjs";
import { validateSizingCandidate, CONSTRAINT_STATUSES } from "./sizing-candidate.mjs";
import { validateMissionReserve, RESERVE_STATUS } from "./reserve.mjs";
import { validateArmParity } from "./attribution.mjs";
import { assertNoPoolingOrPortfolioAggregation, assertActionSpaceInvariant, assertControllerIsNotFinalPolicy } from "./constraints.mjs";

export const IMP22_DESIGN_FIELDS = [
  "identity",
  "mission",
  "reserve",
  "candidates",
  "attribution",
  "separateEvaluation",
  "honestUnknowns",
];

export function validateExperimentDesign(design) {
  const errors = [];

  if (design == null || typeof design !== "object") {
    return { ok: false, code: "DESIGN_MISSING", errors: [{ field: "design", code: "DESIGN_MISSING", message: "design requerido." }] };
  }

  const identityCheck = validateIdentity(design.identity);
  errors.push(...identityCheck.errors);

  const missionCheck = validateMissionExtension(design.identity?.missionId);
  errors.push(...missionCheck.errors.map((error) => ({ ...error, field: `mission.${error.field}` })));

  const reserveCheck = validateMissionReserve(design.reserve);
  errors.push(...reserveCheck.errors);

  const missionId = design.identity?.missionId;
  if (typeof missionId === "string" && design.reserve?.missionId !== missionId) {
    errors.push({
      field: "reserve.missionId",
      code: "RESERVE_MISSION_MISMATCH",
      message: "La reserva del experimento es de la Mission del experimento, no de otra evaluación (DEP-12, evaluación separada).",
    });
  }

  const candidates = design.candidates;
  if (!Array.isArray(candidates) || candidates.length === 0) {
    errors.push({ field: "candidates", code: "CANDIDATES_REQUIRED", message: "Al menos un candidato de sizing versionado debe declararse (§4.2; DEP-18 familia/parametrización).", });
  } else {
    for (const candidate of candidates) {
      const check = validateSizingCandidate(candidate);
      errors.push(...check.errors.map((error) => ({ ...error, field: `candidates[].${error.field}` })));
      if (typeof missionId === "string" && candidate.identity?.missionId !== missionId) {
        errors.push({
          field: "candidates[].identity.missionId",
          code: "CANDIDATE_MISSION_MISMATCH",
          message: "El candidato pertenece a la misma Mission separada del diseño (§23).",
        });
      }
    }
  }

  // Los brazos se declaran por evaluación (después del audit de la Mission);
  // si ya existen, se verifican sus paridades inmediatamente.
  if (design.attribution?.arms != null) {
    const attributionCheck = validateArmParity(design.attribution.arms);
    errors.push(...attributionCheck.errors.map((error) => ({ ...error, field: `attribution.${error.field}` })));
  }

  const unknowns = design.honestUnknowns;
  if (!Array.isArray(unknowns)) {
    errors.push({
      field: "honestUnknowns",
      code: "HONEST_UNKNOWNS_REQUIRED",
      message: "Jo survey abstracto: DEP-01–08 [Mission/sizing del nuevo experimento] deben quedar declarados como unknowns AUDIT-DEPENDENT o confirmados con datos auditados; nada se descarta (§6.4).",
    });
  }

  const constraintChecks = [
    assertNoPoolingOrPortfolioAggregation,
    assertActionSpaceInvariant,
    assertControllerIsNotFinalPolicy,
  ];
  for (const check of constraintChecks) {
    const result = check(design);
    errors.push(...result.errors);
  }

  return { ok: errors.length === 0, code: errors.length === 0 ? "VALID" : "REJECTED", errors };
}

// Configuración del experimento congelada antes de su evaluación: un run no
// puede calibrar un candidato sobre su OOS ni cambiar la parametrización
// después de observar outcomes (§13.8/§15 aplicados a sizing). Este es el
// acto DEP-12 del propio experimento: exige reserva RESERVED con frontera y
// veredicto de brazos paritarios; declararlo espacio técnico no evalúa datos.
export function validateFreezeBeforeEvaluation(design) {
  const errors = [];

  if (design?.freeze == null || typeof design.freeze !== "object") {
    errors.push({
      field: "freeze",
      code: "FREEZE_REQUIRED",
      message: "El diseño debe declarar freeze: parametrización congelada antes de seleccionar/calibrar contra resultados (DEP-12, orden de reserva; §15.2).",
    });
  } else {
    for (const field of ["preDeclaredBeforeParameterSelection", "reserveStatusLocked"]) {
      if (design.freeze[field] !== true) {
        errors.push({
          field: `freeze.${field}`,
          code: "FREEZE_DECLARATION_REQUIRED",
          message: `freeze.${field} debe declararse true: la reserva precede a la calibración (DEP-12).`,
        });
      }
    }
  }

  if (design?.reserve?.status !== RESERVE_STATUS.RESERVED) {
    errors.push({
      field: "reserve.status",
      code: "RESERVE_NOT_READY",
      message: "La reserva propia debe estar RESERVED antes de seleccionar/calibrar parámetros (DEP-12). La de IMP-09 no sustituye, de otra Mission tampoco.",
    });
  } else {
    const reserveCheck = validateMissionReserve(design.reserve);
    errors.push(...reserveCheck.errors);
  }

  if (design?.attribution?.arms == null) {
    errors.push({
      field: "attribution.arms",
      code: "ARMS_REQUIRED_BEFORE_EVALUATION",
      message: "Los brazos de atribución timing/size deben declararse y pasar paridad antes de evaluar (§13.7; §13.9).",
    });
  } else {
    const parityCheck = validateArmParity(design.attribution.arms);
    errors.push(...parityCheck.errors.map((error) => ({ ...error, field: `attribution.${error.field}` })));
  }

  return { ok: errors.length === 0, errors };
}
