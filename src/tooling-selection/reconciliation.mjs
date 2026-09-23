// Reconciliación independiente de salidas clave del componente evaluado con
// fixtures permitidos (PRODUCES_EVIDENCE de IMP-04). Fuente: SPEC v1.1.1 §6.4
// ("Todo motor externo debe producir outputs clave reconciliables de forma
// independiente antes de atribuir edge") y §25.2.2 IMP-04. Un fixture sólo
// vale si está permitido por derechos y su valor esperado se inspeccionó o
// calculó de forma independiente ANTES de automatizar (§14.8/§19.3.1). Esta
// función no ejecuta el componente, no atribuye edge y no concede autoridad.
//
// Comparación EXACTA, sin tolerancia: SPEC v1.1.1 §14.8 ("reconcilian
// exactamente"), §19.3.1 ("La conversión y la reconciliación exacta ... forman
// parte de estas comprobaciones") y §19.3 ("No se añaden epsilons ni valores
// numéricos artificiales"). Cualquier cota > 0 aprobaba divergencias de hasta
// casi el 100 % (review IMP-04 2026-09-23: esperado 1000000, tolerancia 999999,
// observado 1). Un margen distinto de 0 requeriría §20.2.12.

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function isNonEmptyStringList(value) {
  return Array.isArray(value) && value.length > 0 && value.every(isNonEmptyString);
}

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

// undefined, null, NaN, ±Infinity, "" y listas vacías no son valores: con `===`
// undefined===undefined reconciliaba sin que el componente produjera nada
// (review IMP-04 2026-09-23).
function isReconcilableScalar(value) {
  return isFiniteNumber(value) || isNonEmptyString(value) || typeof value === "boolean";
}

function isReconcilableValue(value) {
  if (Array.isArray(value)) {
    return value.length > 0 && value.every(isReconcilableScalar);
  }
  return isReconcilableScalar(value);
}

function valuesAgree(observed, expected) {
  if (Array.isArray(expected)) {
    return Array.isArray(observed)
      && observed.length === expected.length
      && expected.every((item, index) => observed[index] === item);
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

function validateFixture(fixture) {
  const outputId = fixture?.outputId ?? "(sin id)";
  if (!isNonEmptyString(fixture?.outputId)) {
    return fail("INVALID_FIXTURE", "Cada fixture debe identificar la salida que reconcilia.");
  }
  if (fixture.permitted !== true) {
    return fail("FIXTURE_NOT_PERMITTED", `El fixture "${outputId}" no está permitido por derechos.`);
  }
  if (!isNonEmptyString(fixture.independentComputation)) {
    return fail("FIXTURE_NOT_INDEPENDENT", `El fixture "${outputId}" no declara cómputo/inspección independiente previa.`);
  }
  if (fixture.tolerance !== undefined && fixture.tolerance !== 0) {
    return fail("INVALID_TOLERANCE", `El fixture "${outputId}" declara tolerancia ${String(fixture.tolerance)}: la reconciliación es exacta (SPEC §14.8, §19.3.1).`, { outputId, tolerance: fixture.tolerance });
  }
  if (!isReconcilableValue(fixture.expectedValue)) {
    return fail("INVALID_EXPECTED_VALUE", `El fixture "${outputId}" no declara un valor esperado reconciliable (número finito, texto, booleano o lista no vacía de ellos).`, { outputId });
  }
  return null;
}

// `outputs`: [{ outputId, value }] tal como los produjo el componente.
// `fixtures`: [{ outputId, expectedValue, permitted, independentComputation }].
// `keyOutputs`: salidas clave declaradas por la interfaz real del componente
// (§25.1 IMP-04: "interfaces reales"); exigir su cobertura impide que un
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

  const fixtureIds = new Set();
  for (const fixture of fixtures) {
    const rejection = validateFixture(fixture);
    if (rejection) {
      return rejection;
    }
    if (fixtureIds.has(fixture.outputId)) {
      return fail("DUPLICATE_FIXTURES", `Hay más de un fixture para "${fixture.outputId}": el esperado debe ser único.`, { outputId: fixture.outputId });
    }
    fixtureIds.add(fixture.outputId);
  }

  // Cada salida clave se produce una vez: un outputId repetido (p. ej. B=999 y
  // B=102) es ambigüedad de procedencia y no se reduce a la última.
  const observedById = new Map();
  for (const output of outputs) {
    if (!isNonEmptyString(output?.outputId)) {
      return fail("INVALID_COMPONENT_OUTPUT", "Cada salida del componente debe identificarse con outputId.");
    }
    if (observedById.has(output.outputId)) {
      return fail("DUPLICATE_COMPONENT_OUTPUTS", `La salida "${output.outputId}" del componente aparece más de una vez; versiones duplicadas o contradictorias no se reducen a la última.`, { outputId: output.outputId });
    }
    observedById.set(output.outputId, output.value);
  }

  if (keyOutputs !== null) {
    const uncovered = keyOutputs.filter((outputId) => !fixtureIds.has(outputId));
    if (uncovered.length > 0) {
      return fail("KEY_OUTPUTS_NOT_COVERED", "Los fixtures aportados no cubren todas las salidas clave declaradas por la interfaz del componente.", { uncoveredKeyOutputs: uncovered });
    }
  }

  const comparisons = [];
  const mismatches = [];
  for (const fixture of fixtures) {
    const expected = fixture.expectedValue;
    if (!observedById.has(fixture.outputId)) {
      mismatches.push({ outputId: fixture.outputId, reason: "MISSING_COMPONENT_OUTPUT" });
      comparisons.push({ outputId: fixture.outputId, observed: null, expected, agreed: false });
      continue;
    }
    const observed = observedById.get(fixture.outputId);
    if (!isReconcilableValue(observed)) {
      mismatches.push({ outputId: fixture.outputId, reason: "INVALID_OBSERVED_VALUE" });
      comparisons.push({ outputId: fixture.outputId, observed: null, expected, agreed: false });
      continue;
    }
    const agreed = valuesAgree(observed, expected);
    comparisons.push({ outputId: fixture.outputId, observed, expected, agreed });
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
