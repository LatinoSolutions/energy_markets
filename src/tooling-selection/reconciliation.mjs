// Reconciliación independiente de salidas clave del componente evaluado con
// fixtures permitidos (PRODUCES_EVIDENCE de IMP-04). Fuente: SPEC v1.1 §6.4
// ("Todo motor externo debe producir outputs clave reconciliables de forma
// independiente antes de atribuir edge") y §25.2.2 IMP-04. Un fixture sólo
// vale si está permitido por derechos y su valor esperado se inspeccionó o
// calculó de forma independiente ANTES de automatizar (§14.8/§19.3.1). Esta
// función no ejecuta el componente, no atribuye edge y no concede autoridad.

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function isNonEmptyStringList(value) {
  return Array.isArray(value) && value.length > 0 && value.every(isNonEmptyString);
}

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function valuesAgree(observed, expected, tolerance) {
  if (isFiniteNumber(observed) && isFiniteNumber(expected)) {
    return Math.abs(observed - expected) <= tolerance;
  }
  return observed === expected;
}

function fail(code, message, details = {}) {
  return {
    reconciled: false,
    rejected: true,
    code,
    message,
    ...details,
    edgeAttributed: false,
    productionAuthority: false,
    requiresPermittedFixtures: true,
  };
}

// `outputs`: [{ outputId, value }] tal como los produjo el componente.
// `fixtures`: [{ outputId, expectedValue, permitted, independentComputation,
//   tolerance? }]. `permitted` y `independentComputation` son condiciones
// duras: sin ellas el fixture no es utilizable.
// `keyOutputs`: salidas clave declaradas por la interfaz real del componente
// (§25.1 IMP-04: "interfaces reales"). Exigir su cobertura impide que un
// subconjunto arbitrario de fixtures produzca `reconciled: true`.
export function reconcileKeyOutputs({ componentId = null, outputs = [], fixtures = [], keyOutputs = null } = {}) {
  if (!isNonEmptyString(componentId)) {
    return fail("MISSING_COMPONENT_ID", "La reconciliación exige la identidad del componente evaluado.");
  }
  if (!Array.isArray(outputs) || outputs.length === 0) {
    return fail("MISSING_OUTPUTS", "No hay salidas clave del componente para reconciliar.");
  }
  if (!Array.isArray(fixtures) || fixtures.length === 0) {
    return fail("MISSING_FIXTURES", "La reconciliación exige fixtures permitidos.");
  }
  if (keyOutputs !== null && !isNonEmptyStringList(keyOutputs)) {
    return fail("INVALID_KEY_OUTPUTS", "Las salidas clave declaradas por la interfaz deben ser una lista no vacía de identificadores.");
  }

  for (const fixture of fixtures) {
    if (fixture?.permitted !== true) {
      return fail("FIXTURE_NOT_PERMITTED", `El fixture "${fixture?.outputId ?? "(sin id)"}" no está permitido por derechos.`);
    }
    if (!isNonEmptyString(fixture?.independentComputation)) {
      return fail("FIXTURE_NOT_INDEPENDENT", `El fixture "${fixture?.outputId ?? "(sin id)"}" no declara cómputo/inspección independiente previa.`);
    }
    if (fixture.tolerance !== undefined && !isFiniteNumber(fixture.tolerance)) {
      return fail("INVALID_TOLERANCE", `El fixture "${fixture.outputId}" declara una tolerancia inválida.`);
    }
  }

  const observedById = new Map(outputs.map((output) => [output?.outputId, output?.value]));
  const comparisons = [];
  const mismatches = [];

  // §25.1 IMP-04: cada salida clave declarada por la interfaz del componente
  // debe estar cubierta por un fixture permitido. Un subconjunto arbitrario no
  // reconcilia "las salidas clave": reconcilia lo que conviene.
  if (keyOutputs !== null) {
    const fixtureIds = new Set(fixtures.map((fixture) => fixture?.outputId));
    const uncovered = keyOutputs.filter((outputId) => !fixtureIds.has(outputId));
    if (uncovered.length > 0) {
      return fail("KEY_OUTPUTS_NOT_COVERED", "Los fixtures aportados no cubren todas las salidas clave declaradas por la interfaz del componente.", { uncoveredKeyOutputs: uncovered });
    }
  }

  for (const fixture of fixtures) {
    const tolerance = fixture.tolerance ?? 0;
    if (!observedById.has(fixture.outputId)) {
      mismatches.push({ outputId: fixture.outputId, reason: "MISSING_COMPONENT_OUTPUT" });
      comparisons.push({ outputId: fixture.outputId, observed: null, expected: fixture.expectedValue, agreed: false, tolerance });
      continue;
    }
    const observed = observedById.get(fixture.outputId);
    const agreed = valuesAgree(observed, fixture.expectedValue, tolerance);
    comparisons.push({ outputId: fixture.outputId, observed, expected: fixture.expectedValue, agreed, tolerance });
    if (!agreed) {
      mismatches.push({ outputId: fixture.outputId, reason: "VALUE_MISMATCH" });
    }
  }

  return {
    componentId,
    reconciled: mismatches.length === 0,
    rejected: false,
    comparisons,
    mismatches,
    edgeAttributed: false,
    productionAuthority: false,
    requiresPermittedFixtures: true,
  };
}
