// B/H/V, unidades, coste all-in, cobertura y total EUR. Fuente: SPEC v1.1
// §5.5 (H all-in unitario, V=B-H en unidades compatibles, total EUR exige MWh,
// coste desconocido nunca cero, cobertura incompleta por separado) y §5.7
// (V=0 neutral). Cálculo genérico; no hay fórmula de H de ledger real.

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function isValidCompleteCost(cost) {
  return cost !== null
    && typeof cost === "object"
    && cost.status === "known"
    && isFiniteNumber(cost.value);
}

// §5.5: V=B-H sólo con B y H finitos en la misma unidad compatible. No se
// convierte ni se asume unidad; una incompatibilidad deja V indefinido.
export function computeV({ B, BUnit, H, HUnit } = {}) {
  if (!isFiniteNumber(B) || !isFiniteNumber(H)) {
    return { V: null, defined: false, reason: "B o H no son valores finitos: V=B-H no es computable." };
  }
  if (!isNonEmptyString(BUnit) || !isNonEmptyString(HUnit) || BUnit !== HUnit) {
    return { V: null, defined: false, reason: "B y H no comparten unidad compatible: V=B-H indefinido, sin conversión inventada." };
  }
  const V = B - H;
  return { V, defined: true, sign: V > 0 ? "positive" : V < 0 ? "negative" : "neutral", reason: null };
}

// §5.5: H exige cada coste atribuible exactamente una vez. Un coste
// desconocido deja H indefinido; nunca se sustituye por cero.
export function computeAllInH({ base, unit, costs, costsComplete = false } = {}) {
  if (!isFiniteNumber(base) || !isNonEmptyString(unit)) {
    return { H: null, unit: null, defined: false, reason: "H exige una base finita con unidad." };
  }
  if (!Array.isArray(costs)) {
    return { H: null, unit, defined: false, available: false, rejected: true, reason: "La lista de costes es missing o no es una lista; H permanece unavailable." };
  }
  if (costsComplete !== true) {
    return { H: null, unit, defined: false, available: false, rejected: true, reason: "La completitud de costes no está declarada explícitamente; no se asume una lista de coste cero." };
  }
  const invalidCostIndex = costs.findIndex((cost) => !isValidCompleteCost(cost));
  if (invalidCostIndex !== -1) {
    return { H: null, unit, defined: false, available: false, rejected: true, reason: "Un coste no está reconciliado (unknown), no es un objeto válido o no es finito: H unavailable, nunca sustituido por cero." };
  }
  const total = costs.reduce((sum, cost) => sum + cost.value, base);
  return { H: total, unit, defined: Number.isFinite(total), available: Number.isFinite(total), rejected: !Number.isFinite(total), reason: Number.isFinite(total) ? null : "H no finito tras sumar costes conocidos." };
}

// §5.5: total EUR exige volumen compatible en MWh. Un volumen en MW no se
// convierte por suposición.
export function computeTotalEur({ V, VUnit, volume, volumeUnit } = {}) {
  if (!isFiniteNumber(V) || !isFiniteNumber(volume)) {
    return { totalEur: null, defined: false, reason: "V o volumen no finitos: total EUR indefinido." };
  }
  if (VUnit !== "EUR/MWh" || volumeUnit !== "MWh") {
    return { totalEur: null, defined: false, reason: "Total EUR exige volumen compatible en MWh; MW no se convierte a MWh por suposición." };
  }
  return { totalEur: V * volume, defined: true, reason: null };
}

// §5.5: la cobertura incompleta se informa por separado y no se oculta dentro
// de V; el valor aritmético no se convierte en evidencia de research válida.
export function classifyCoverage({ coverage } = {}) {
  const validResearchValue = coverage === "full";
  return {
    coverage,
    validResearchValue,
    reason: validResearchValue ? null : "Cobertura incompleta: V se informa por separado y no es evidencia de research válida.",
  };
}
