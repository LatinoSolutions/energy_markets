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
// razón documentada; MATERIALIZED exige la lista de asignaciones con su filled
// quantity, reconciliada con el volumen ejecutado
// (reconcileOwnershipWithExecutedVolume).
export const COVERAGE_OWNERSHIP_MAP_STATES = ["UNAVAILABLE", "MATERIALIZED"];

const DATA_AVAILABILITY = STATE_NAMESPACES.data_availability.values;

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

// Los IDs se exigen en forma canónica y no se normalizan: "F1 " o "F1\u200b"
// junto a "F1" permitirían contar dos veces el mismo fill o desviar volumen a
// una obligación inexistente sin que el doble conteo lo detecte (§4.3).
// PROVISIONAL (no es formato de la SPEC, que no define IDs): ASCII visible sin
// espacios. Mayúsculas/minúsculas o erratas sólo se detectan contra un
// registro real de fills y obligaciones (DEP-02), que aún no existe.
const CANONICAL_ID_PATTERN = /^[\x21-\x7E]+$/;

function isCanonicalId(value) {
  return typeof value === "string" && CANONICAL_ID_PATTERN.test(value);
}

// Misma forma canónica para unidades: " MW " no es "MW" y rompería la
// comparación de unidades sin que nadie lo vea (§4.1).
function isCanonicalUnit(value) {
  return isCanonicalId(value);
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
// §14.5: "Coverage cambia por filled quantity". Un close-out fill es un fill:
// cubre sólo si ya está contado en executedVolume, y entonces el restante es
// cero. Un residual positivo nunca es COVERED. El único cierre de un residual
// positivo es una enmienda real que declara la cantidad cancelada con
// autoridad y locator (§4.3 "salvo enmiendas/cancelaciones explícitamente
// documentadas"; §14.5 "ajuste documentado correspondiente").
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

  // §4.3: sin la identidad de conservación el restante publicado no es el
  // real; no se clasifica cobertura sobre magnitudes que no reconcilian.
  if (openingObligation !== executedVolume + remainingVolume) {
    return { ok: false, coverageStatus: "NOT_COMPUTABLE", errors: [{ code: "CONSERVATION_VIOLATION", message: `OpeningObligation ${openingObligation} != ExecutedVolume ${executedVolume} + RemainingVolume ${remainingVolume}.` }] };
  }

  const terminalRuleValid = terminalRuleStatus === "VERIFIED";
  const closeOutDeclared = !isMissing(closeOutFill);
  if (closeOutDeclared && !terminalRuleValid) {
    errors.push({ code: "CLOSEOUT_WITH_UNKNOWN_TERMINAL_RULE", message: "No se fabrica un fill de cierre sin terminal rule válida (§4.3/§14.5)." });
  }

  // Un close-out fill declara la unidad que ejecuta y debe caber en el volumen
  // ejecutado que lo contiene; sin eso no está contado en el ledger (§14.5) y
  // aceptar su unidad ausente sería inferirla (§4.1).
  const closeOutInExecutedVolume = closeOutDeclared
    && isFiniteNumber(closeOutFill.quantity)
    && closeOutFill.quantity >= 0
    && closeOutFill.quantity <= executedVolume
    && isNonEmptyString(closeOutFill.unit)
    && closeOutFill.unit === unit;
  if (closeOutDeclared && !closeOutInExecutedVolume) {
    errors.push({
      code: "CLOSEOUT_NOT_IN_EXECUTED_VOLUME",
      message: "El close-out fill debe declarar su unidad y estar contado en executedVolume; coverage sólo cambia por filled quantity registrada (§14.5).",
    });
  }

  // Un close-out fill inválido o fuera del ledger no es cobertura real aunque
  // la aritmética deje el restante en cero.
  const closeOutInvalid = closeOutDeclared && (!terminalRuleValid || !closeOutInExecutedVolume);
  const positiveResidual = remainingVolume > 0;
  if (!positiveResidual) {
    const coverageStatus = closeOutInvalid ? "COVERAGE_INCOMPLETE" : "COVERED";
    return { ok: errors.length === 0, coverageStatus, errors };
  }

  if (closeOutDeclared) {
    // Un fill de cierre con residual aún positivo no está en executedVolume o
    // no cubrió el residual: en ambos casos el residual sigue abierto.
    errors.push({
      code: "CLOSEOUT_WITH_POSITIVE_RESIDUAL",
      message: `Queda remainingVolume ${remainingVolume} ${unit} tras declarar el close-out fill; un residual positivo no es COVERED (§4.3/§14.5).`,
    });
    return { ok: false, coverageStatus: "COVERAGE_INCOMPLETE", errors };
  }

  // §14.5: la enmienda cancela una cantidad concreta con unidad compatible;
  // no cierra el residual en blanco (§4.3: faltantes y conveniencia nunca
  // eliminan volumen restante). La identidad de conservación admite ajuste
  // "salvo enmiendas/cancelaciones explícitamente documentadas" (§4.3): una
  // cancelación real documentada es el acto de cierre por sí misma, así la
  // terminal rule no exista o esté sin verificar; exigir además terminal rule
  // VERIFIED denegaba el cierre que §4.3/§14.5 admiten. Sin esa evidencia, el
  // residual sigue abierto pase lo que pase con la terminal rule.
  const amendmentCoversResidual = isNonEmptyString(residualAmendment?.authority)
    && isNonEmptyString(residualAmendment?.locator)
    && isFiniteNumber(residualAmendment?.cancelledVolume)
    && residualAmendment.cancelledVolume === remainingVolume
    && isNonEmptyString(residualAmendment?.unit)
    && residualAmendment.unit === unit;

  if (amendmentCoversResidual) {
    // La enmienda no es cobertura ejecutada: se informa separadamente (§4.3).
    return { ok: errors.length === 0, coverageStatus: "RESIDUAL_CANCELLED", errors };
  }

  if (terminalRuleValid) {
    errors.push({
      code: "RESIDUAL_CLOSE_NOT_EVIDENCED",
      message: "El residual positivo con terminal rule VERIFIED exige evidencia de cierre: una enmienda que declare exactamente la cantidad cancelada, con unidad, autoridad y locator (§4.3/§14.5).",
    });
  }
  return { ok: errors.length === 0, coverageStatus: "COVERAGE_INCOMPLETE", errors };
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
// mandato queda documentada como faltante, no inventada. §14.5 "Coverage
// cambia por filled quantity": cada fill trae su cantidad positiva y su unidad,
// y cada asignación las hereda, así la salida cumple el mismo contrato que
// validateOwnershipAssignments aplica al mapa de la ficha (una sola verdad).
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
  const rejectedFillIds = new Set();
  for (const fill of fills) {
    if (!fill || typeof fill !== "object" || !isCanonicalId(fill.fillId)) {
      errors.push({ code: "INVALID_FILL", message: "Un fill no declara fillId canónico." });
      continue;
    }
    if (fillById.has(fill.fillId) || rejectedFillIds.has(fill.fillId)) {
      errors.push({ code: "DUPLICATE_FILL", message: `fillId repetido: ${fill.fillId}.` });
      continue;
    }
    const hasFilledQuantity = isFiniteNumber(fill.quantity) && fill.quantity > 0;
    if (!hasFilledQuantity || !isCanonicalUnit(fill.unit)) {
      errors.push({ code: "INVALID_FILL_QUANTITY", message: `El fill ${fill.fillId} no declara una filled quantity finita positiva con unidad (§14.5).` });
      rejectedFillIds.add(fill.fillId);
      continue;
    }
    fillById.set(fill.fillId, fill);
  }

  const assignments = [];
  const seenObligationIds = new Set();
  for (const obligation of obligations) {
    if (!obligation || !isCanonicalId(obligation.obligationId)) {
      errors.push({ code: "INVALID_OBLIGATION", message: "Una obligación no declara obligationId canónico." });
      continue;
    }
    // Dos entradas con el mismo ID fusionarían dos obligaciones en una.
    if (seenObligationIds.has(obligation.obligationId)) {
      errors.push({ code: "DUPLICATE_OBLIGATION", message: `obligationId repetido: ${obligation.obligationId}.` });
      continue;
    }
    seenObligationIds.add(obligation.obligationId);
    const obligationFills = obligation.fills ?? [];
    if (!Array.isArray(obligationFills)) {
      errors.push({ code: "INVALID_OBLIGATION", message: `Los fills de ${obligation.obligationId} no son una lista.` });
      continue;
    }
    let obligationUnit = null;
    for (const fillId of obligationFills) {
      // Un fill rechazado ya tiene su error; no se reporta como inexistente.
      if (rejectedFillIds.has(fillId)) {
        continue;
      }
      const fill = fillById.get(fillId);
      if (!fill) {
        errors.push({ code: "UNKNOWN_FILL", message: `Obligación ${obligation.obligationId} referencia un fill inexistente: ${fillId}.` });
        continue;
      }
      // §4.1: MW y MWh son magnitudes distintas; la cobertura de una misma
      // obligación no suma unidades distintas.
      obligationUnit ??= fill.unit;
      if (fill.unit !== obligationUnit) {
        errors.push({ code: "ASSIGNMENT_UNIT_MISMATCH", message: `Obligación ${obligation.obligationId} mezcla ${obligationUnit} y ${fill.unit} (fill ${fillId}); no se convierte (§4.1).` });
        continue;
      }
      assignments.push({ fillId, obligationId: obligation.obligationId, quantity: fill.quantity, unit: fill.unit });
    }
  }

  // §4.3: una cobertura sin obligación que la posea no tiene dueño auditado.
  // Devolverla en assignments vacíos con ok:true dejaría volumen ejecutado que
  // nadie reclama y escaparía al doble conteo y a la reconciliación con el
  // volumen ejecutado de la ficha.
  for (const [fillId, fill] of fillById) {
    if (!assignments.some((assignment) => assignment.fillId === fillId)) {
      errors.push({ code: "UNOWNED_FILL", message: `El fill ${fillId} (${fill.quantity} ${fill.unit}) no es referenciado por ninguna obligación; la cobertura sin dueño no entra al mapa (§4.3).` });
    }
  }

  // §4.3: el doble conteo se detecta con el mismo validador que la ficha.
  errors.push(...validateOwnershipAssignments(assignments));

  // §4.3/DEP-02: la relación Monthly/Quarterly debe declararse explícitamente
  // con su estado resuelto o la razón documentada de su faltante. La ausencia
  // total es un faltante no documentado, no una ausencia de obligaciones: no
  // se asume "sin solapamiento".
  errors.push(...validateRelationDeclaration(relationMonthlyQuarterly));

  return { ok: errors.length === 0, assignments, errors };
}

// §4.3: "un mismo fill o cobertura no se contabiliza dos veces entre
// obligaciones solapadas". Valida una lista de asignaciones fill→obligación ya
// materializada (la que la ficha declara en su bloque coverageOwnership) con
// el mismo invariante de doble conteo que mapCoverageOwnership aplica al
// derivar el mapa. Un fill repetido, aunque la asignación repita la misma
// obligación, es doble conteo.
export function validateOwnershipAssignments(assignments) {
  const errors = [];
  if (!Array.isArray(assignments)) {
    errors.push({ code: "ASSIGNMENTS_NOT_ARRAY", message: "Las asignaciones fill→obligación no son una lista." });
    return errors;
  }
  const ownershipCount = new Map();
  for (const assignment of assignments) {
    if (!assignment || typeof assignment !== "object" || Array.isArray(assignment) || !isCanonicalId(assignment.fillId) || !isCanonicalId(assignment.obligationId)) {
      errors.push({ code: "INVALID_ASSIGNMENT", message: "Cada asignación debe declarar fillId y obligationId no vacíos y sin espacios en los extremos." });
      continue;
    }
    // §14.5: toda asignación, sea de la obligación de la ficha o de otra,
    // declara la filled quantity que aporta con su unidad; no hay asignaciones
    // sin volumen que escapen a la revisión.
    if (!isFiniteNumber(assignment.quantity) || assignment.quantity <= 0 || !isCanonicalUnit(assignment.unit)) {
      errors.push({ code: "ASSIGNMENT_QUANTITY_INVALID", message: `La asignación de ${assignment.fillId} no declara una filled quantity finita positiva con unidad (§14.5).` });
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

// §4.3 + §14.5 ("Coverage cambia por filled quantity"): el mapa materializado
// es la cobertura de la obligación, no una lista de IDs. Cada asignación a la
// obligación de la ficha declara la filled quantity que aporta, en la unidad
// de la obligación, y su suma es exactamente el executed volume publicado. Sin
// esto un mapa vacío o parcial pasaría como ownership determinado con volumen
// ejecutado que nadie posee. Las asignaciones a otras obligaciones sólo cuentan
// para el doble conteo (validateOwnershipAssignments); su volumen pertenece a
// la ficha de esa obligación, y su forma se valida en
// validateOwnershipAssignments.
export function reconcileOwnershipWithExecutedVolume({ assignments, obligationId, executedVolume, unit } = {}) {
  const errors = [];
  if (!Array.isArray(assignments)) {
    errors.push({ code: "ASSIGNMENTS_NOT_ARRAY", message: "Las asignaciones fill→obligación no son una lista." });
    return errors;
  }
  if (!isCanonicalId(obligationId)) {
    errors.push({ code: "OBLIGATION_ID_MISSING", message: "El mapa materializado debe declarar el obligationId de la obligación de la ficha; sin él no se sabe qué asignaciones cubren su volumen ejecutado." });
    return errors;
  }
  if (!isFiniteNumber(executedVolume) || executedVolume < 0 || !isNonEmptyString(unit)) {
    errors.push({ code: "EXECUTED_VOLUME_MISSING", message: "El mapa materializado exige el volumen ejecutado disponible, con unidad, para reconciliar las asignaciones (§4.3)." });
    return errors;
  }

  const ownAssignments = assignments.filter((assignment) => assignment?.obligationId === obligationId);
  let assignedVolume = 0;
  for (const assignment of ownAssignments) {
    if (!isFiniteNumber(assignment.quantity) || assignment.quantity <= 0) {
      errors.push({ code: "ASSIGNMENT_QUANTITY_INVALID", message: `La asignación de ${assignment.fillId} no declara una filled quantity finita positiva (§14.5).` });
      continue;
    }
    if (assignment.unit !== unit) {
      errors.push({ code: "ASSIGNMENT_UNIT_MISMATCH", message: `La asignación de ${assignment.fillId} está en ${assignment.unit} y la obligación en ${unit}; no se convierte (§4.1).` });
      continue;
    }
    assignedVolume += assignment.quantity;
  }
  if (errors.length > 0) {
    return errors;
  }
  if (assignedVolume !== executedVolume) {
    errors.push({
      code: "OWNERSHIP_EXECUTED_MISMATCH",
      message: `Las asignaciones a ${obligationId} suman ${assignedVolume} ${unit} y el volumen ejecutado es ${executedVolume} ${unit}; cada fill ejecutado debe tener dueño y ninguno sobra (§4.3).`,
    });
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
