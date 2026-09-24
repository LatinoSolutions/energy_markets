// Familia y versión de candidatos de Sizing Policy (§4.2; DEP-18 §24).
// La selección algorítmica de la Sizing Policy no está congelada, pero todo
// candidato debe ser predeclarado y versionado antes de evaluarse, respetar
// la obligación restante y las restricciones auditadas, y no inventar valores
// para restricciones desconocidas (P5.6 regla 4 aplicada al sizing).
//
// Un candidato NO es por sí mismo la Sizing Policy final validada: su
// validación exige el experimento de atribución y su registro en el design.

import { IMP22_SIZING_CANDIDATE_ID_PATTERN } from "./identity.mjs";
import { isMissionId } from "./missions.mjs";

export const SIZING_FAMILIES = { RULE: "RULE", CALIBRATED: "CALIBRATED", LEARNED: "LEARNED" };

// Estado de la auditoría de restricciones operativas (lotes, redondeo,
// mínimo ejecutable) al fijar la parametrización de un candidato.
export const CONSTRAINT_STATUSES = {
  AUDIT_PENDING: "AUDIT_PENDING",
  AUDITED: "AUDITED",
};

// Campo que el candidato debe proveer para la evaluación fail-closed.
export const SIZING_CANDIDATE_FIELDS = ["identity", "constraintStatus", "constraints", "evaluationBinding"];

export function validateSizingCandidate(candidate) {
  const errors = [];

  if (candidate == null || typeof candidate !== "object") {
    return { ok: false, errors: [{ field: "candidate", code: "CANDIDATE_MISSING", message: "candidato requerido." }] };
  }

  const identity = candidate.identity;
  if (identity == null || typeof identity !== "object") {
    errors.push({ field: "identity", code: "IDENTITY_MISSING", message: "candidate.identity requerido." });
  } else {
    if (!IMP22_SIZING_CANDIDATE_ID_PATTERN.test(identity.sizingCandidateId ?? "")) {
      errors.push({
        field: "identity.sizingCandidateId",
        code: "SIZING_CANDIDATE_ID_PATTERN",
        message: `sizingCandidateId debe encajar ${IMP22_SIZING_CANDIDATE_ID_PATTERN}.`,
      });
    }
    if (typeof identity.parametrizationVersion !== "string" || identity.parametrizationVersion.trim() === "") {
      errors.push({
        field: "identity.parametrizationVersion",
        code: "PARAMETRIZATION_VERSION_REQUIRED",
        message: "Cada parametrización es una versión explícita; no hay valores por defecto implícitos (§4.2; P5.6 regla 4).",
      });
    }
    if (!isMissionId(identity.missionId)) {
      errors.push({
        field: "identity.missionId",
        code: "MISSION_ID_KNOWN",
        message: "El candidato pertenece a exactamente una Mission evaluada separadamente (§23).",
      });
    }
  }

  if (!Object.values(SIZING_FAMILIES).includes(candidate.family)) {
    errors.push({
      field: "family",
      code: "FAMILY_KNOWN",
      message: `family debe ser una de ${Object.values(SIZING_FAMILIES).join(", ")} (§4.2).`,
    });
  }

  if (candidate.family === SIZING_FAMILIES.LEARNED) {
    const protocolOk =
      typeof candidate.learningProtocol === "object" &&
      candidate.learningProtocol != null &&
      typeof candidate.learningProtocol.protocolId === "string" &&
      candidate.learningProtocol.protocolId.trim() !== "";
    if (!protocolOk) {
      errors.push({
        field: "learningProtocol",
        code: "LEARNED_PROTOCOL_REQUIRED",
        message: "Un candidato aprendido debe declarar su protocolo de aprendizaje versionado (§11; no hot learning §18.4).",
      });
    }
  }

  if (candidate.constraintStatus !== CONSTRAINT_STATUSES.AUDITED && candidate.constraintStatus !== CONSTRAINT_STATUSES.AUDIT_PENDING) {
    errors.push({
      field: "constraintStatus",
      code: "CONSTRAINT_STATUS_KNOWN",
      message: "constraintStatus debe ser AUDITED o AUDIT_PENDING; un estado inventado invalida la interpretación (P5.6 regla 5).",
    });
  }

  const constraints = candidate.constraints;
  if (constraints == null || typeof constraints !== "object") {
    errors.push({ field: "constraints", code: "CONSTRAINTS_REQUIRED", message: "constraints requerido: lotes/redondeo/volumen restante debe estar declarado o marcado faltante." });
  } else {
    // Disponibilidad de restricción se declara explícita (true/false); el
    // faltante se registra en unknownsDeclared, no se sustituye por inventado
    // (P5.6 regla 4). Sólo AUDITED exige todas a true con unknowns vacíos.
    // El lot y el redondeo cubren P5.6 regla 4/5; el deadline entra porque el
    // guard declara cobertura de factibilidad "RemainingVolume y deadline"
    // (§4.2). Ref: hallazgo IMP22-H7.
    const auditedExpectationsMet = candidate.constraintStatus === CONSTRAINT_STATUSES.AUDITED;
    for (const field of ["lotSizeAvailable", "roundingRuleAvailable", "deadlineRuleAvailable"]) {
      if (typeof constraints[field] !== "boolean") {
        errors.push({
          field: `constraints.${field}`,
          code: "CONSTRAINT_DECLARATION_REQUIRED",
          message: `constraints.${field} debe declararse true/false explícito; lo desconocido se registra como faltante sin inventarlo (P5.6 regla 4).`,
        });
      } else if (auditedExpectationsMet && constraints[field] !== true) {
        errors.push({
          field: `constraints.${field}`,
          code: "CONSTRAINT_AUDITED_WITH_UNKNOWNS",
          message: `constraintStatus AUDITED exige ${field}=true con unknowns consumidos (P5.6 regla 5).`,
        });
      }
    }
    if (!Array.isArray(constraints.unknownsDeclared)) {
      errors.push({
        field: "constraints.unknownsDeclared",
        code: "UNKNOWNS_LIST_REQUIRED",
        message: "unknownsDeclared debe listar los faltantes operativos del candidato; lista ausente oculta el faltante (§6.4).",
      });
    } else if (auditedExpectationsMet && constraints.unknownsDeclared.length > 0) {
      errors.push({
        field: "constraints.unknownsDeclared",
        code: "CONSTRAINT_AUDITED_WITH_UNKNOWNS",
        message: "constraintStatus AUDITED exige unknownsDeclared vacío (P5.6 regla 5).",
      });
    }
    if (constraints.feasibilityGuardsInstalled !== true) {
      errors.push({
        field: "constraints.feasibilityGuardsInstalled",
        code: "GUARD_REQUIRED",
        message: "El guard factible (respecto a RemainingVolume y deadline) es invariante del candidato, audite o no el resto (§4.2).",
      });
    }
    const guardOk =
      typeof constraints.guardFunction === "function" &&
      validateGuardInvariants(constraints.guardFunction);
    if (!guardOk) {
      errors.push({
        field: "constraints.guardFunction",
        code: "GUARD_INVARIANTS_FAILED",
        message: "guardFunction debe clampear q_t a [0, RemainingVolume] y ser determinista (§4.2 cantidades respetan obligación restante).",
      });
    }
  }

  const binding = candidate.evaluationBinding;
  if (binding == null || typeof binding !== "object") {
    errors.push({ field: "evaluationBinding", code: "EVALUATION_BINDING_REQUIRED", message: "evaluationBinding requerido: el candidato se evalúa dentro de un experimento de atribución, no por sí solo." });
  } else {
    if (binding.sizeOnlyArm !== true) {
      errors.push({
        field: "evaluationBinding.sizeOnlyArm",
        code: "SIZE_ONLY_ARM_UNDECLARED",
        message: "El candidato de sizing se evalúan en brazo size-only con timing fijo (A0 calendar); atribución timing vs tamaño exige ese aislamiento (§13.5/§13.9 estructura).",
      });
    }
    if (binding.executedStandalone !== undefined && binding.executedStandalone !== false) {
      errors.push({
        field: "evaluationBinding.executedStandalone",
        code: "STANDALONE_EXECUTION_FORBIDDEN",
        message: "El candidato no se ejecuta standalone: la ejecución pasa por el contrato compartido (§13.6).",
      });
    }
  }

  return { ok: errors.length === 0, errors };
}

// Invariantes del guard: determinista y clampeado a [0, RemainingVolume].
// Fixture de prueba estándar para todos los candidatos versionados.
function validateGuardInvariants(guard) {
  const probes = [
    { projectedQ: 7, remainingVolume: 10, expected: 7 },
    { projectedQ: -1, remainingVolume: 10, expected: 0 },
    { projectedQ: 25, remainingVolume: 10, expected: 10 },
    { projectedQ: 3, remainingVolume: 0, expected: 0 },
  ];
  return probes.every((probe) => guard(probe.projectedQ, probe.remainingVolume) === probe.expected);
}
