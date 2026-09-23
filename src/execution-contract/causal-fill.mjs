// Ejecución causal P5.6 (IMP-07). Fuente: SPEC v1.1.1 §13.6 regla 1 ("fills
// únicamente con precios elegibles después de conocerse BUY. No future
// minimum, selección retrospectiva ni precio no disponible en la frontera
// correspondiente"), §14.3 (orden del replay; el execution price cumple el
// contrato posterior a la acción) y §14.4 (campos del execution ledger).
//
// El contrato del caso Gas Quarterly fija la regla determinista: el precio de
// referencia es el último best ask top-of-book de la maturity exacta con
// timestamp at-or-before las 11:00, y el precio simulado añade el slippage
// virtual. Este módulo selecciona la referencia de forma determinista y
// rechaza cualquier fill que use una observación futura o que elija
// retrospectivamente una observación no-latest.

export function toEpochMs(value) {
  if (typeof value !== "string" || value.trim().length === 0) {
    return null;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

// §13.6 regla 1: elegible = observación con timestamp at-or-before la frontera
// de decisión. La referencia es la última elegible; un empate en el timestamp
// máximo con precios distintos es ambiguo y no se resuelve por conveniencia.
export function selectEligibleReference({ observations, decisionTime } = {}) {
  const decisionMs = toEpochMs(decisionTime);
  if (decisionMs === null) {
    return { ok: false, code: "INVALID_DECISION_TIME", reference: null, reason: "decisionTime no es un timestamp parseable." };
  }
  if (!Array.isArray(observations)) {
    return { ok: false, code: "MISSING_OBSERVATIONS", reference: null, reason: "La lista de observaciones no está disponible." };
  }

  const eligible = [];
  for (const observation of observations) {
    const timestampMs = toEpochMs(observation?.timestamp);
    if (timestampMs === null) {
      return { ok: false, code: "INVALID_OBSERVATION_TIMESTAMP", reference: null, reason: "Una observación no tiene timestamp parseable." };
    }
    if (typeof observation.bestAsk !== "number" || !Number.isFinite(observation.bestAsk)) {
      return { ok: false, code: "INVALID_OBSERVATION_PRICE", reference: null, reason: "Una observación no tiene bestAsk finito." };
    }
    if (timestampMs <= decisionMs) {
      eligible.push({ ...observation, timestampMs });
    }
  }

  if (eligible.length === 0) {
    return { ok: false, code: "NO_ELIGIBLE_REFERENCE", reference: null, reason: "Ninguna observación at-or-before la frontera de decisión; el precio no está disponible (no se inventa)." };
  }

  const latestMs = Math.max(...eligible.map((observation) => observation.timestampMs));
  const atLatest = eligible.filter((observation) => observation.timestampMs === latestMs);
  const distinctPrices = new Set(atLatest.map((observation) => observation.bestAsk));
  if (distinctPrices.size > 1) {
    return { ok: false, code: "AMBIGUOUS_REFERENCE", reference: null, reason: `Varias observaciones en ${atLatest[0].timestamp} con bestAsk distinto; la referencia no es determinista.` };
  }

  const chosen = atLatest[0];
  return {
    ok: true,
    code: null,
    reference: { timestamp: chosen.timestamp, bestAsk: chosen.bestAsk },
    reason: null,
  };
}

// §13.6: simulated_fill_price = reference best ask + virtual slippage. Las
// unidades deben coincidir; no se convierte ni se asume una unidad.
export function deriveSimulatedFillPrice({ referenceBestAsk, slippage, referenceUnit = "EUR/MWh", slippageUnit = "EUR/MWh" } = {}) {
  if (typeof referenceBestAsk !== "number" || !Number.isFinite(referenceBestAsk)) {
    return { ok: false, price: null, reason: "El best ask de referencia no es un número finito." };
  }
  if (typeof slippage !== "number" || !Number.isFinite(slippage) || slippage < 0) {
    return { ok: false, price: null, reason: "El slippage no es un número finito no negativo." };
  }
  if (referenceUnit !== slippageUnit) {
    return { ok: false, price: null, reason: `Unidades incompatibles: referencia ${referenceUnit}, slippage ${slippageUnit}; no se convierte por suposición.` };
  }
  return { ok: true, price: referenceBestAsk + slippage, reason: null };
}

function parameterOf(contract, key) {
  return (contract?.parameters ?? []).find((entry) => entry?.key === key) ?? null;
}

// §13.6 regla 1 + §14.3: un fill es causal sólo si su precio sale de una
// observación elegible at-or-before la frontera, con la derivación frozen, y
// no de una observación futura ni de una elegida retrospectivamente.
export function validateCausalFill({ fill, contract } = {}) {
  const errors = [];
  if (!fill || typeof fill !== "object" || Array.isArray(fill)) {
    return { ok: false, errors: [{ field: "fill", code: "MISSING_FILL", message: "Fill ausente." }] };
  }
  const requestId = typeof fill.requestId === "string" && fill.requestId.trim().length > 0 ? fill.requestId : null;
  const field = requestId ?? "fill";

  const decisionMs = toEpochMs(fill.decisionTime);
  if (decisionMs === null) {
    errors.push({ field: `${field}.decisionTime`, code: "INVALID_DECISION_TIME", message: "El fill no declara una frontera de decisión parseable." });
  }

  const reference = fill.referenceObservation;
  const referenceMs = toEpochMs(reference?.timestamp);
  if (referenceMs === null || typeof reference?.bestAsk !== "number" || !Number.isFinite(reference.bestAsk)) {
    errors.push({ field: `${field}.referenceObservation`, code: "MISSING_ELIGIBLE_REFERENCE", message: "El fill no usa una observación de precio disponible; no se inventa un precio ejecutable (§14.3)." });
  } else if (decisionMs !== null && referenceMs > decisionMs) {
    errors.push({ field: `${field}.referenceObservation`, code: "FUTURE_PRICE_SELECTED", message: `La observación ${reference.timestamp} es posterior a la frontera ${fill.decisionTime}; un precio futuro no es elegible (§13.6 regla 1).` });
  }

  // Selección retrospectiva: si el llamante aporta las observaciones
  // candidatas, la referencia debe ser exactamente la última elegible.
  if (Array.isArray(fill.candidateObservations)) {
    const selection = selectEligibleReference({ observations: fill.candidateObservations, decisionTime: fill.decisionTime });
    if (!selection.ok) {
      errors.push({ field: `${field}.candidateObservations`, code: selection.code, message: selection.reason });
    } else if (referenceMs !== null && referenceMs !== toEpochMs(selection.reference.timestamp)) {
      errors.push({ field: `${field}.referenceObservation`, code: "RETROSPECTIVE_SELECTION", message: `La referencia ${reference?.timestamp} no es la última elegible (${selection.reference.timestamp}); elegir otra es selección retrospectiva (§13.6 regla 1).` });
    }
  }

  // Derivación frozen del precio: best ask + slippage del contrato.
  const slippageParameter = parameterOf(contract, "slippage");
  if (referenceMs !== null && typeof reference?.bestAsk === "number" && Number.isFinite(reference.bestAsk)) {
    if (!slippageParameter || slippageParameter.status === "UNKNOWN") {
      errors.push({ field: `${field}.executionPrice`, code: "MISSING_SLIPPAGE", message: "El contrato no declara un slippage utilizable; el precio ejecutable no es determinable." });
    } else {
      const derived = deriveSimulatedFillPrice({ referenceBestAsk: reference.bestAsk, slippage: slippageParameter.value, referenceUnit: "EUR/MWh", slippageUnit: slippageParameter.unit });
      if (!derived.ok) {
        errors.push({ field: `${field}.executionPrice`, code: "PRICE_NOT_DERIVABLE", message: derived.reason });
      } else if (fill.executionPrice !== derived.price) {
        errors.push({ field: `${field}.executionPrice`, code: "PRICE_NOT_DERIVED_FROM_RULE", message: `executionPrice ${fill.executionPrice} != best ask + slippage = ${derived.price}; el precio no sale de la regla frozen (§13.6).` });
      }
    }
  }

  return { ok: errors.length === 0, errors };
}
