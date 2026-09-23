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

function arraysAgree(left, right) {
  return Array.isArray(left) && Array.isArray(right)
    && left.length === right.length
    && left.every((item, index) => isFiniteNumber(item) && isFiniteNumber(right[index])
      ? item === right[index]
      : item === right[index]);
}

function valuesAgree(observed, expected, tolerance) {
  if (isFiniteNumber(observed) && isFiniteNumber(expected)) {
    return Math.abs(observed - expected) <= tolerance;
  }
  if (Array.isArray(observed) || Array.isArray(expected)) {
    return arraysAgree(observed, expected);
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
    if (fixture.tolerance !== undefined && (!isFiniteNumber(fixture.tolerance) || fixture.tolerance < 0)) {
      return fail("INVALID_TOLERANCE", `El fixture "${fixture.outputId}" declara una tolerancia negativa, no finita o de tipo inválido.`);
    }
    // Una tolerancia sólo tiene sentido si acota una discrepancia menor que la
    // propia magnitud esperada: una cota >= |esperado| aprobaría cualquier
    // divergencia hasta el 100% (repaso del audit 2026-09-23: observado 102,
    // esperado 1000000 y tolerancia 1000000 producían REUSE). Cuando el valor
    // esperado es 0 no hay magnitud que acotar y la comparación es exacta;
    // una tolerancia positiva lo permitiría todo (review IMP-04 2026-09-23:
    // esperado 0 y tolerancia 100 reconciliaban un observado de 100).
    if (fixture.tolerance !== undefined && isFiniteNumber(fixture.expectedValue)) {
      const exceedsExpectedMagnitude = fixture.expectedValue !== 0
        ? fixture.tolerance >= Math.abs(fixture.expectedValue)
        : fixture.tolerance > 0;
      if (exceedsExpectedMagnitude) {
        const message = fixture.expectedValue === 0
          ? `El fixture "${fixture.outputId}" espera 0: no hay magnitud que acotar y la comparación es exacta; una tolerancia positiva no es válida.`
          : `El fixture "${fixture.outputId}" declara una tolerancia que iguala o supera la magnitud del valor esperado; aprobaría una discrepancia total.`;
        return fail("INVALID_TOLERANCE", message, { outputId: fixture.outputId, expectedValue: fixture.expectedValue, tolerance: fixture.tolerance });
      }
    }
  }

  // Review IMP-04 2026-09-23: con `Map(outputs.map(...))` las salidas
  // duplicadas con el mismo outputId se reducían a la última y contradicciones
  // (p. ej. B=999 y B=102) reconciliaban. Cada salida clave se produce una vez:
  // un outputId repetido es ambigüedad de procedencia y se rechaza.
  const observedById = new Map();
  for (const output of outputs) {
    if (observedById.has(output?.outputId)) {
      return fail("DUPLICATE_COMPONENT_OUTPUTS", `La salida "${output?.outputId ?? "(sin id)"}" del componente aparece más de una vez; versiones duplicadas o contradictorias no se reducen a la última.`, { outputId: output?.outputId ?? null });
    }
    observedById.set(output?.outputId, output?.value);
  }
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
