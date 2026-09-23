// Mapa de coverage ownership y reconciliación de obligación. Fuente: SPEC
// v1.1.1 §4.3 (OpeningObligation = ExecutedVolume + RemainingVolume; WAIT y
// partial fills conservan residual; una cobertura no pertenece dos veces a
// obligaciones; la cobertura se informa separadamente; sin terminal rule
// válida → COVERAGE_INCOMPLETE sin fill inventado), §14.5 (sólo fills cambian
// coverage; el cierre del residual se ejecuta o se cancela con enmienda real
// documentada que declara el ajuste correspondiente) y §24 DEP-02 (relación
// Monthly/Quarterly: adicional, solapada o alternativa según mandato).

import { STATE_NAMESPACES } from "../contracts/states.mjs";

// §4.3: la cobertura se informa separadamente. Un residual cancelado por
// enmienda documentada no es cobertura ejecutada: RESIDUAL_CANCELLED lo hace
// distinguible para el downstream (ledgers P6).
export const COVERAGE_STATUSES = ["COVERED", "RESIDUAL_CANCELLED", "COVERAGE_INCOMPLETE", "NOT_COMPUTABLE"];

// §24 DEP-02: los estados en que puede quedar la relación entre obligaciones
// Monthly y Quarterly una vez auditado el mandato. La taxonomía vive aquí para
// que ficha y mapa declaren una sola, no dos verdades distintas.
export const MONTHLY_QUARTERLY_RELATION_STATES = ["ADDITIONAL", "OVERLAPPING", "ALTERNATIVE", "DOCUMENTED_ABSENCE"];

// Estado del mapa de asignación fill→obligación de la ficha: UNAVAILABLE exige
// razón documentada; MATERIALIZED exige la lista de asignaciones.
export const COVERAGE_OWNERSHIP_MAP_STATES = ["UNAVAILABLE", "MATERIALIZED"];

const DATA_AVAILABILITY = STATE_NAMESPACES.data_availability.values;

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function isMissing(value) {
  return value === null || value === undefined;
}

// §4.3: remaining = opening − executed, sólo con magnitudes compatibles.
// Cada magnitud declara su propia unidad para poder comprobar compatibilidad;
// sin unidades iguales no hay resta, no se infiere unidad ni se convierte
// (§4.1: MW y MWh son magnitudes distintas).
export function computeRemainingVolume({ openingObligation, executedVolume, openingUnit, executedUnit } = {}) {
  if (!isFiniteNumber(openingObligation) || !isFiniteNumber(executedVolume)) {
    return { computed: false, remainingVolume: null, unit: null, code: "MISSING_MAGNITUDES", reason: "Faltan obligación de apertura o volumen ejecutado finitos; el restante no es computable." };
  }
  if (openingObligation < 0 || executedVolume < 0) {
    return { computed: false, remainingVolume: null, unit: null, code: "NEGATIVE_MAGNITUDE", reason: "La obligación de apertura y el volumen ejecutado no pueden ser negativos (§4.3)." };
  }
  if (!isNonEmptyString(openingUnit) || !isNonEmptyString(executedUnit)) {
    return { computed: false, remainingVolume: null, unit: null, code: "MISSING_UNIT", reason: "Cada magnitud debe declarar su unidad; sin ellas no se resta ni se convierte." };
  }
  if (openingUnit !== executedUnit) {
    return { computed: false, remainingVolume: null, unit: null, code: "UNIT_MISMATCH", reason: `Obligación (${openingUnit}) y volumen ejecutado (${executedUnit}) no comparten unidad; no se convierten (§4.1).` };
  }
  const remainingVolume = openingObligation - executedVolume;
  if (remainingVolume < 0) {
    return { computed: false, remainingVolume: null, unit: openingUnit, code: "CONSERVATION_VIOLATION", reason: `El volumen ejecutado (${executedVolume}) excede la obligación de apertura (${openingObligation}).` };
  }
  return { computed: true, remainingVolume, unit: openingUnit, code: null, reason: null };
}

// §4.3/§14.5: reconcilia apertura = ejecutado + restante y clasifica cobertura.
// Un close-out fill sólo puede existir con terminal rule válida declarada.
// El cierre de un residual positivo exige evidencia real: la regla marcada
// VERIFIED sólo autoriza; hay que demostrar que se aplicó (fill de cierre que
// cubre exactamente el residual) o que el residual se ejecutó/canceló mediante
// una enmienda con autoridad y locator (§14.5). Sin esa evidencia el residual
// permanece COVERAGE_INCOMPLETE.
export function reconcileCoverage({ openingObligation, executedVolume, remainingVolume, unit, terminalRuleStatus, closeOutFill, residualAmendment } = {}) {
  const errors = [];
  const magnitudes = { openingObligation, executedVolume, remainingVolume };
  const missingMagnitude = Object.entries(magnitudes).some(([, value]) => !isFiniteNumber(value));
  if (missingMagnitude) {
    return { ok: false, coverageStatus: "NOT_COMPUTABLE", errors: [{ code: "MISSING_MAGNITUDES", message: "Faltan magnitudes finitas; la reconciliación no es computable." }] };
  }
  if (!isNonEmptyString(unit)) {
    return { ok: false, coverageStatus: "NOT_COMPUTABLE", errors: [{ code: "MISSING_UNIT", message: "Sin unidad no hay reconciliación válida." }] };
  }
  if (openingObligation < 0 || executedVolume < 0 || remainingVolume < 0) {
    return { ok: false, coverageStatus: "NOT_COMPUTABLE", errors: [{ code: "NEGATIVE_MAGNITUDE", message: "Las magnitudes de cobertura no pueden ser negativas; el volumen no desaparece (§4.3)." }] };
  }

  if (openingObligation !== executedVolume + remainingVolume) {
    errors.push({ code: "CONSERVATION_VIOLATION", message: `OpeningObligation ${openingObligation} != ExecutedVolume ${executedVolume} + RemainingVolume ${remainingVolume}.` });
  }

  const terminalRuleValid = terminalRuleStatus === "VERIFIED";
  if (!isMissing(closeOutFill) && !terminalRuleValid) {
    errors.push({ code: "CLOSEOUT_WITH_UNKNOWN_TERMINAL_RULE", message: "No se fabrica un fill de cierre sin terminal rule válida (§4.3/§14.5)." });
  }

  const positiveResidual = remainingVolume > 0;
  // §14.5: la enmienda cancela una cantidad concreta con unidad compatible;
  // no cierra el residual en blanco (§4.3: faltantes y conveniencia nunca
  // eliminan volumen restante). El ajuste "correspondiente" es el que declara
  // cuánto cancela; sin cantidad declarada no hay enmienda material.
  const amendmentUnit = residualAmendment?.unit;
  const amendmentDocumented = isNonEmptyString(residualAmendment?.authority)
    && isNonEmptyString(residualAmendment?.locator)
    && isFiniteNumber(residualAmendment?.cancelledVolume)
    && residualAmendment.cancelledVolume >= 0
    && isNonEmptyString(amendmentUnit)
    && amendmentUnit === unit;
  const amendmentCoversResidual = amendmentDocumented && residualAmendment.cancelledVolume === remainingVolume;

  // Un close-out fill declara la unidad que ejecuta; sin ella no se sabe qué
  // magnitud cubre y aceptarlo sería inferir unidad (§4.1: MW y MWh son
  // magnitudes distintas). La misma regla que computeRemainingVolume aplica.
  const closeOutCoversResidual = isFiniteNumber(closeOutFill?.quantity) && closeOutFill.quantity === remainingVolume
    && isNonEmptyString(closeOutFill.unit) && closeOutFill.unit === unit;

  // §4.3: el volumen no desaparece. Un mismo residual no se ejecuta y se
  // cancela a la vez: doble cierre con doble fuente no es evidencia.
  const doubleResidualClose = closeOutCoversResidual && amendmentDocumented;

  let coverageStatus;
  if (!positiveResidual) {
    coverageStatus = "COVERED";
  } else if (terminalRuleValid && doubleResidualClose) {
    coverageStatus = "COVERAGE_INCOMPLETE";
    errors.push({
      code: "DOUBLE_RESIDUAL_CLOSE",
      message: "El residual no se ejecuta y se cancela a la vez; un único cierre por residual (§4.3).",
    });
  } else if (terminalRuleValid && closeOutCoversResidual) {
    coverageStatus = "COVERED";
  } else if (terminalRuleValid && amendmentCoversResidual) {
    // La enmienda no es cobertura ejecutada: se informa separadamente (§4.3).
    coverageStatus = "RESIDUAL_CANCELLED";
  } else {
    coverageStatus = "COVERAGE_INCOMPLETE";
    if (terminalRuleValid) {
      errors.push({
        code: "RESIDUAL_CLOSE_NOT_EVIDENCED",
        message: "El residual positivo con terminal rule VERIFIED exige evidencia de cierre: un fill con unidad que cubra exactamente el restante o una enmienda que declare la cantidad cancelada con autoridad y locator (§4.3/§14.5).",
      });
    }
  }

  return { ok: errors.length === 0, coverageStatus, errors };
}

// §24 DEP-02: la relación Monthly/Quarterly debe declararse explícitamente con
// su estado resuelto (adicional, solapada, alternativa o ausencia documentada
// según mandato). AVAILABLE_NOW exige tipo de relación, valor y provenance;
// UNAVAILABLE exige razón documentada. Negociar la relación con otra
// availability, un tipo no declarado o un estado sin soporte niega el faltante.
export function validateRelationDeclaration(relation) {
  const errors = [];
  if (!relation || typeof relation !== "object" || Array.isArray(relation)) {
    errors.push({ code: "MISSING_NOT_DOCUMENTED", message: "Falta la relación Monthly/Quarterly; su ausencia debe quedar documentada explícitamente (§4.3/DEP-02)." });
    return errors;
  }
  if (typeof relation.availability !== "string" || !DATA_AVAILABILITY.includes(relation.availability)) {
    errors.push({ code: "UNKNOWN_AVAILABILITY", message: "La relación Monthly/Quarterly usa un availability no declarado (§3.2)." });
    return errors;
  }
  if (relation.availability === "AVAILABLE_NOW") {
    if (!isNonEmptyString(relation.relationType) || !MONTHLY_QUARTERLY_RELATION_STATES.includes(relation.relationType)) {
      errors.push({ code: "RELATION_TYPE_NOT_DECLARED", message: `La relación AVAILABLE_NOW exige relationType declarado: ${MONTHLY_QUARTERLY_RELATION_STATES.join(", ")} (DEP-02).` });
    }
    if (isMissing(relation.value)) {
      errors.push({ code: "AVAILABLE_WITHOUT_VALUE", message: "La relación Monthly/Quarterly está AVAILABLE_NOW sin valor que la materialice." });
    }
    if (!isNonEmptyString(relation.authority) || !isNonEmptyString(relation.locator)) {
      errors.push({ code: "NO_PROVENANCE", message: "La relación Monthly/Quarterly está AVAILABLE_NOW sin autoridad y locator." });
    }
  } else if (!isNonEmptyString(relation.reason)) {
    errors.push({ code: "MISSING_NOT_DOCUMENTED", message: "La relación Monthly/Quarterly no resuelta exige la razón documentada de su faltante (DEP-02)." });
  }
  return errors;
}

// §4.3: cada fill/cobertura pertenece a lo sumo a una obligación; un fill
// desconocido no se asigna en silencio. La relación Monthly/Quarterly sin
// mandato queda documentada como faltante, no inventada.
export function mapCoverageOwnership({ relationMonthlyQuarterly, obligations, fills } = {}) {
  const errors = [];
  if (!Array.isArray(obligations)) {
    errors.push({ code: "OBLIGATIONS_NOT_ARRAY", message: "Las obligaciones no son una lista." });
    return { ok: false, assignments: [], errors };
  }
  if (!Array.isArray(fills)) {
    errors.push({ code: "FILLS_NOT_ARRAY", message: "Los fills no son una lista." });
    return { ok: false, assignments: [], errors };
  }

  const fillById = new Map();
  for (const fill of fills) {
    if (!fill || !isNonEmptyString(fill.fillId)) {
      errors.push({ code: "INVALID_FILL", message: "Un fill no declara fillId." });
      continue;
    }
    if (fillById.has(fill.fillId)) {
      errors.push({ code: "DUPLICATE_FILL", message: `fillId repetido: ${fill.fillId}.` });
      continue;
    }
    fillById.set(fill.fillId, fill);
  }

  const referenceCount = new Map();
  const assignments = [];
  for (const obligation of obligations) {
    if (!obligation || !isNonEmptyString(obligation.obligationId)) {
      errors.push({ code: "INVALID_OBLIGATION", message: "Una obligación no declara obligationId." });
      continue;
    }
    for (const fillId of obligation.fills ?? []) {
      if (!fillById.has(fillId)) {
        errors.push({ code: "UNKNOWN_FILL", message: `Obligación ${obligation.obligationId} referencia un fill inexistente: ${fillId}.` });
        continue;
      }
      referenceCount.set(fillId, (referenceCount.get(fillId) ?? 0) + 1);
      assignments.push({ fillId, obligationId: obligation.obligationId });
    }
  }

  for (const [fillId, count] of referenceCount) {
    if (count > 1) {
      errors.push({ code: "DUPLICATE_OWNERSHIP", message: `El fill ${fillId} pertenece a ${count} obligaciones; se prohíbe doble conteo (§4.3).` });
    }
  }

  // §4.3/DEP-02: la relación Monthly/Quarterly debe declararse explícitamente
  // con su estado resuelto o la razón documentada de su faltante. La ausencia
  // total es un faltante no documentado, no una ausencia de obligaciones: no
  // se asume "sin solapamiento".
  errors.push(...validateRelationDeclaration(relationMonthlyQuarterly));

  return { ok: errors.length === 0, assignments, errors };
}

// §4.3: "un mismo fill o cobertura no se contabiliza dos veces entre
// obligaciones solapadas". Valida una lista de asignaciones fill→obligación ya
// materializada (la que la ficha declara en su bloque coverageOwnership). Es
// el mismo invariante que mapCoverageOwnership aplica al derivar el mapa, en
// una sola fuente para ambos consumidores (ficha y mapa). Un fill repetido,
// aunque la asignación repita la misma obligación, es doble conteo.
export function validateOwnershipAssignments(assignments) {
  const errors = [];
  if (!Array.isArray(assignments)) {
    errors.push({ code: "ASSIGNMENTS_NOT_ARRAY", message: "Las asignaciones fill→obligación no son una lista." });
    return errors;
  }
  const ownershipCount = new Map();
  for (const assignment of assignments) {
    if (!assignment || typeof assignment !== "object" || Array.isArray(assignment) || !isNonEmptyString(assignment.fillId) || !isNonEmptyString(assignment.obligationId)) {
      errors.push({ code: "INVALID_ASSIGNMENT", message: "Cada asignación debe declarar fillId y obligationId no vacíos." });
      continue;
    }
    ownershipCount.set(assignment.fillId, (ownershipCount.get(assignment.fillId) ?? 0) + 1);
  }
  for (const [fillId, count] of ownershipCount) {
    if (count > 1) {
      errors.push({ code: "DUPLICATE_OWNERSHIP", message: `El fill ${fillId} pertenece a ${count} asignaciones; se prohíbe doble conteo (§4.3).` });
    }
  }
  return errors;
}

// §14.5: coverage cambia sólo por filled quantity; una partial fill conserva el
// residual no ejecutado.
export function applyFilledQuantity({ openingObligation, executedVolume, filledQuantity, unit } = {}) {
  if (!isFiniteNumber(openingObligation) || !isFiniteNumber(executedVolume) || !isFiniteNumber(filledQuantity)) {
    return { updated: false, code: "MISSING_MAGNITUDES", reason: "Faltan magnitudes finitas para aplicar un fill." };
  }
  if (openingObligation < 0 || executedVolume < 0 || filledQuantity < 0) {
    return { updated: false, code: "NEGATIVE_MAGNITUDE", reason: "Coverage sólo avanza por filled quantity efectiva; magnitudes negativas no son un fill válido (§14.5)." };
  }
  if (!isNonEmptyString(unit)) {
    return { updated: false, code: "MISSING_UNIT", reason: "Sin unidad no se actualiza coverage." };
  }
  const nextExecuted = executedVolume + filledQuantity;
  if (nextExecuted > openingObligation) {
    return { updated: false, code: "CONSERVATION_VIOLATION", reason: "Un fill no puede exceder la obligación de apertura." };
  }
  return {
    updated: true,
    executedVolume: nextExecuted,
    remainingVolume: openingObligation - nextExecuted,
    unit,
    code: null,
    reason: null,
  };
}
