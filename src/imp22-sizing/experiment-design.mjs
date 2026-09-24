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
import { validateCoverageDeclarations } from "./coverage.mjs";

// Campos de contrato del diseño (§25.2.1 identidad de instancia; §4/§5/§23
// para misión, reserva, cobertura y guardas). La lista es el contrato
// declarado y validateExperimentDesign la exige campo a campo: una constante
// que nadie lee no bindea nada (Ref: hallazgo IMP22-H11).
export const IMP22_DESIGN_FIELDS = [
  "identity",
  "mission",
  "reserve",
  "candidates",
  "attribution",
  "coverage",
  "separateEvaluation",
  "controllerKind",
  "honestUnknowns",
  "honestUnknownReferenceScope",
  "actionSpaceModification",
  "controllerIsFinalSizingPolicy",
  "freeze",
];

// Verificación del bloque design.mission: las extas declaraciones de la
// Mission tienen que estar vivas (propias del propio experimento), no inertes
// frente al registro canónico (Ref: hallazgo IMP22-H4).
function validateMissionDeclarations(design) {
  const errors = [];
  const missionId = design?.identity?.missionId;
  const mission = design?.mission;
  if (mission == null || typeof mission !== "object") {
    errors.push({
      field: "mission",
      code: "MISSION_BLOCK_REQUIRED",
      message: "El bloque mission del diseño es requerido: el experimento declara su extensión de Mission (§25.1 aceptación IMP-22).",
    });
    return errors;
  }
  if (mission.missionId !== missionId) {
    errors.push({
      field: "mission.missionId",
      code: "MISSION_MISMATCH",
      message: "mission.missionId debe coincidir con identity.missionId: un diseño es una Mission separada (§23).",
    });
  }
  for (const field of ["ownBenchmarkBDeclaration", "separateEvaluationDeclaration", "minimumEvidenceDeclaration"]) {
    if (mission[field] !== true) {
      errors.push({
        field: `mission.${field}`,
        code: "MISSION_DECLARATION_REQUIRED",
        message: `mission.${field} debe declararse true en el propio experimento: B propio, evaluación separada y mínimos de la Mission (§25.1; DEP-12).`,
      });
    }
  }
  return errors;
}

export function validateExperimentDesign(design) {
  const errors = [];

  if (design == null || typeof design !== "object") {
    return { ok: false, code: "DESIGN_MISSING", errors: [{ field: "design", code: "DESIGN_MISSING", message: "design requerido." }] };
  }

  // El contrato declarado se exige entero: un campo de §25.2.1 ausente deja el
  // diseño incompleto aunque su validación específica pase (§25.2.1). Ref:
  // hallazgo IMP22-H11.
  for (const field of IMP22_DESIGN_FIELDS) {
    if (design[field] === undefined) {
      errors.push({
        field,
        code: "DESIGN_FIELD_REQUIRED",
        message: `El diseño debe declarar ${field}: es parte del contrato IMP-22 (§25.2.1; §4/§5/§23).`,
      });
    }
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

  errors.push(...validateMissionDeclarations(design));

  errors.push(...validateCoverageDeclarations(design.coverage));

  const candidates = design.candidates;
  if (!Array.isArray(candidates) || candidates.length === 0) {
    errors.push({ field: "candidates", code: "CANDIDATES_REQUIRED", message: "Al menos un candidato de sizing versionado debe declararse (§4.2; DEP-18 familia/parametrización).", });
  } else {
    // El tamaño de una misma Mission es un objeto único versionado: dos
    // candidatos con el mismo sizingCandidateId dentro del diseño son una
    // identidad ambigua (Ref: hallazgo IMP22-H5).
    const seenCandidateIds = new Set();
    for (const candidate of candidates) {
      const check = validateSizingCandidate(candidate);
      errors.push(...check.errors.map((error) => ({ ...error, field: `candidates[].${error.field}` })));
      const candidateId = candidate?.identity?.sizingCandidateId;
      if (typeof candidateId === "string" && candidateId.trim() !== "") {
        if (seenCandidateIds.has(candidateId)) {
          errors.push({
            field: "candidates[].identity.sizingCandidateId",
            code: "SIZING_CANDIDATE_ID_COLLISION",
            message: `sizingCandidateId duplicado dentro del diseño: ${candidateId} (§4.2 identidad versionada).`,
          });
        }
        seenCandidateIds.add(candidateId);
      }
      if (typeof missionId === "string" && candidate?.identity?.missionId !== missionId) {
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

  // Un diseño sin un solo desconocido visible es un faltante disimulado: los
  // DEP-01–08 [Mission/sizing] deben quedar registrados como AUDIT_MISSING
  // (o confirmados con datos auditados); array vacío no descarta nada (§6.4;
  // §25.1). Ref: hallazgo IMP22-H2.
  const unknowns = design.honestUnknowns;
  if (!Array.isArray(unknowns) || unknowns.length === 0) {
    errors.push({
      field: "honestUnknowns",
      code: "UNKNOWN_NOT_VISIBLE",
      message: "El diseño no declaró ningún desconocido visible; los DEP-01–08 [Mission/sizing del nuevo experimento] deben quedar en el registro (§6.4).",
    });
  } else {
    const seenUnknownIds = new Set();
    for (const unknown of unknowns) {
      if (unknown == null || typeof unknown !== "object") {
        errors.push({ field: "honestUnknowns[]", code: "INVALID_UNKNOWN", message: "Cada desconocido visible debe ser un objeto con sujeto y razón." });
        continue;
      }
      for (const field of ["unknownId", "subject", "reason"]) {
        if (typeof unknown[field] !== "string" || unknown[field].trim().length === 0) {
          errors.push({
            field: `honestUnknowns[].${field}`,
            code: "UNKNOWN_FIELD_REQUIRED",
            message: `La entrada de desconocido necesita ${field} estable y con razón preservada (§6.2).`,
          });
        }
      }
      if (typeof unknown.unknownId === "string") {
        if (seenUnknownIds.has(unknown.unknownId)) {
          errors.push({
            field: "honestUnknowns[].unknownId",
            code: "DUPLICATE_UNKNOWN",
            message: `Desconocido duplicado: ${unknown.unknownId}.`,
          });
        }
        seenUnknownIds.add(unknown.unknownId);
      }
    }
  }

  // El scope de referencia que declara el builder debe enlazar el registro de
  // desconocidos con los DEP del §24; si desaparece, la encuesta pierde su
  // ancla (Ref: hallazgo IMP22-H2).
  const referenceScope = design.honestUnknownReferenceScope;
  if (!Array.isArray(referenceScope) || referenceScope.length === 0 || referenceScope.some((entry) => typeof entry !== "string" || entry.trim().length === 0)) {
    errors.push({
      field: "honestUnknownReferenceScope",
      code: "REFERENCE_SCOPE_REQUIRED",
      message: "honestUnknownReferenceScope debe enlazar cada desconocido con su DEP del §24; nada se descarta (§25.1; §6.4).",
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

  // Defensa en profundidad del gate de freeze: la reserva debe ser de la
  // Mission del experimento, no de otra evaluación separada (DEP-12; §25.2.3).
  // validateExperimentDesign ya lo atrapa; el freeze no puede ser más laxo
  // que el diseño que habilita (Ref: hallazgo IMP22-H10).
  const freezeMissionId = design?.identity?.missionId;
  if (typeof freezeMissionId === "string" && design?.reserve?.missionId !== freezeMissionId) {
    errors.push({
      field: "reserve.missionId",
      code: "RESERVE_MISSION_MISMATCH",
      message: "La reserva del experimento es de la Mission del experimento, no de otra evaluación (DEP-12, evaluación separada).",
    });
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

  // §4.2: las cantidades deben respetar las restricciones AUDITADAS antes de
  // evaluar/calibrar; con restricciones pendientes de audit el candidato
  // queda HOLD y no administrar la evaluación (P5.6 reglas 4/5 aplicadas al
  // sizing). Ref: hallazgo IMP22-H1.
  for (const candidate of Array.isArray(design?.candidates) ? design.candidates : []) {
    if (candidate?.constraintStatus !== CONSTRAINT_STATUSES.AUDITED) {
      errors.push({
        field: "candidates[].constraintStatus",
        code: "CONSTRAINT_AUDITED_REQUIRED",
        message: "El gate de freeze/evaluación exige constraintStatus AUDITED (lotes/redondeo disponible y unknowns consumidos); AUDIT_PENDING no calibra (§4.2; P5.6 regla 5).",
      });
    }
  }

  // La cobertura declarada (§4.3) debe seguir en pie antes de evaluar:
  // identidad Opening = Executed + Remaining y prohibición de doble conteo
  // declaradas ex-ante (Ref: hallazgo IMP22-H7).
  errors.push(...validateCoverageDeclarations(design?.coverage));

  return { ok: errors.length === 0, errors };
}
