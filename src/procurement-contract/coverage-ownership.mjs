// Mapa de coverage ownership y reconciliación de obligación. Fuente: SPEC
// v1.1.1 §4.3 (OpeningObligation = ExecutedVolume + RemainingVolume; WAIT y
// partial fills conservan residual; una cobertura no pertenece dos veces a
// obligaciones; sin terminal rule válida → COVERAGE_INCOMPLETE sin fill
// inventado) y §14.5 (sólo fills cambian coverage; sin closing fill fabricado).

export const COVERAGE_STATUSES = ["COVERED", "COVERAGE_INCOMPLETE", "NOT_COMPUTABLE"];

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
export function reconcileCoverage({ openingObligation, executedVolume, remainingVolume, unit, terminalRuleStatus, closeOutFill } = {}) {
  const errors = [];
  const magnitudes = { openingObligation, executedVolume, remainingVolume };
  const missingMagnitude = Object.entries(magnitudes).some(([, value]) => !isFiniteNumber(value));
  if (missingMagnitude) {
    return { ok: false, coverageStatus: "NOT_COMPUTABLE", errors: [{ code: "MISSING_MAGNITUDES", message: "Faltan magnitudes finitas; la reconciliación no es computable." }] };
  }
  if (!isNonEmptyString(unit)) {
    return { ok: false, coverageStatus: "NOT_COMPUTABLE", errors: [{ code: "MISSING_UNIT", message: "Sin unidad no hay reconciliación válida." }] };
  }

  if (openingObligation !== executedVolume + remainingVolume) {
    errors.push({ code: "CONSERVATION_VIOLATION", message: `OpeningObligation ${openingObligation} != ExecutedVolume ${executedVolume} + RemainingVolume ${remainingVolume}.` });
  }

  const terminalRuleValid = terminalRuleStatus === "VERIFIED";
  if (!isMissing(closeOutFill) && !terminalRuleValid) {
    errors.push({ code: "CLOSEOUT_WITH_UNKNOWN_TERMINAL_RULE", message: "No se fabrica un fill de cierre sin terminal rule válida (§4.3/§14.5)." });
  }

  const coverageStatus = remainingVolume > 0 && !terminalRuleValid ? "COVERAGE_INCOMPLETE" : "COVERED";
  return { ok: errors.length === 0, coverageStatus, errors };
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

  // §4.3/DEP-02: la relación Monthly/Quarterly debe declararse explícitamente.
  // Su ausencia total es un faltante no documentado, no una ausencia de
  // obligaciones: no se asume "sin solapamiento".
  const relation = relationMonthlyQuarterly;
  if (isMissing(relation) || typeof relation !== "object") {
    errors.push({ code: "MISSING_NOT_DOCUMENTED", message: "Falta la relación Monthly/Quarterly; su ausencia debe quedar documentada explícitamente (§4.3/DEP-02)." });
  } else if (relation.availability === "UNAVAILABLE" && !isNonEmptyString(relation.reason)) {
    errors.push({ code: "MISSING_NOT_DOCUMENTED", message: "La relación Monthly/Quarterly está UNAVAILABLE sin razón documentada." });
  }

  return { ok: errors.length === 0, assignments, errors };
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
