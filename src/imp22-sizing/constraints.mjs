// Guardas MUST NOT CHANGE de §25.1 fila IMP-22: "No modificar action space
// sin versión; no pooling ni portfolio aggregation en el alcance actual
// (D18 D5)". Cada guard es fail-closed.

const POOLING_FIELDS = [
  "portfolioAggregation",
  "combinedScoreAcrossMissions",
  "samplePoolingAcrossMissions",
  "weightedCrossMissionScore",
  "portfolioObjective",
];// Los campos de pooling/aggregación no pueden estar presentes: el resultado
// de este alcance son evaluaciones separadas, común semántico de reward, no
// agregador (D18 D5.1–D5.4; §23 OD-01; §10).
export function assertNoPoolingOrPortfolioAggregation(design) {
  const errors = [];

  for (const field of POOLING_FIELDS) {
    if (design?.[field] !== undefined && design?.[field] !== false) {
      errors.push({
        field,
        code: "POOLS_ACROSS_MISSIONS",
        message: `${field} está prohibido en el alcance actual (D18 D5; §23 OD-01 OUT OF CURRENT SCOPE).`,
      });
    }
  }

  const declarations = design?.separateEvaluation ?? {};
  for (const field of ["byProduct", "byMission", "ownBenchmarkPerMission"]) {
    if (declarations[field] !== true) {
      errors.push({
        field: `separateEvaluation.${field}`,
        code: "SEPARATE_EVALUATION_UNDECLARED",
        message: `El diseño debe declarar evaluación separada: ${field} (D18 D5; §25.1 aceptación IMP-22).`,
      });
    }
  }

  return { ok: errors.length === 0, errors };
}

// El action space no cambia sin versión: un experimento/sizing candidate no
// añade cantidad al action space, no lo renombra y no introduce local
// policies o meta-policy por el lateral (§4.2; §23 párrafo 2).
export function assertActionSpaceInvariant(design) {
  const errors = [];

  const identity = design?.identity ?? {};
  if (typeof identity.actionSpaceVersion !== "string" || identity.actionSpaceVersion.trim() === "") {
    errors.push({
      field: "identity.actionSpaceVersion",
      code: "ACTION_SPACE_VERSION_REQUIRED",
      message: "El diseño debe fijar su actionSpaceVersion explícita (§25.1 MUST NOT CHANGE).",
    });
  }

  const modifications = design?.actionSpaceModification;
  if (modifications === undefined || modifications === null) {
    errors.push({
      field: "actionSpaceModification",
      code: "ACTION_SPACE_UNCHANGED_UNDECLARED",
      message: "El diseño debe declarar actionSpaceModification: none o una versión dedicada con provenance; nada silencioso (§4.2; §23).",
    });
  } else if (modifications !== "NONE" && (typeof modifications !== "object" || modifications == null || typeof modifications.dedicatedVersion === "undefined")) {
    errors.push({
      field: "actionSpaceModification",
      code: "ACTION_SPACE_CHANGE_UNVERSIONED",
      message: "Añadir cantidad u otra capacidad al action space exige versión dedicada predeclarada (§4.2; §23); un valor distinto de NONE requiere dedicatedVersion.",
    });
  }

  return { ok: errors.length === 0, errors };
}

// El controller compartido P5.2 aportado aquí no es la Sizing Policy final:
// el enunciado normativo vive en el módulo aceptado del controller (IMP-10)
// y el diseño debe declarar el controllerKind experimental, no uno propio
// re-implementado (§13.2; DEP-18 sigue abierto hasta su propia evidencia).
// Ref: hallazgo IMP22-H6.
import { CONTROLLER_KIND, IS_NOT_FINAL_SIZING_POLICY } from "../sizing-controller/sizing-controller.mjs";

export { CONTROLLER_KIND, IS_NOT_FINAL_SIZING_POLICY };

export function assertControllerIsNotFinalPolicy(design) {
  const errors = [];
  if (design?.controllerKind !== CONTROLLER_KIND) {
    errors.push({
      field: "controllerKind",
      code: "CONTROLLER_KIND_UNBOUND",
      message: `El diseño debe declarar controllerKind "${CONTROLLER_KIND}" del módulo aceptado de controller; ${IS_NOT_FINAL_SIZING_POLICY} (§13.2; DEP-18).`,
    });
  }
  if (design?.decessorControllerClaim === true || design?.controllerIsFinalSizingPolicy === true) {
    errors.push({
      field: "controllerIsFinalSizingPolicy",
      code: "CONTROLLER_UPDATE_FORBIDDEN",
      message: `El controller experimental P5.2 no se declara Sizing Policy final: ${IS_NOT_FINAL_SIZING_POLICY} (§13.2; DEP-18).`,
    });
  }
  return { ok: errors.length === 0, errors };
}
