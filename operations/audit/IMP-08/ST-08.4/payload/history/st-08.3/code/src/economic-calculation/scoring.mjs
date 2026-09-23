// Scoring Quarterly, diagnóstico Monthly, evidencia mínima y veredicto de
// research. Fuente: SPEC v1.1 §5.6 (fórmulas exactas, n_nonzero, n-1, T=0),
// §5.7 (neutros, degenerados, minimum evidence, Monthly sin el screen
// Quarterly), §5.8 (PASS/HOLD/FAIL/INVALID) y §19.3.1. Cálculo genérico; el
// resultado aritmético y el veredicto de research se mantienen separados.

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function mean(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

// §5.6: fórmulas exactas de scoring Quarterly. n es n_nonzero; n_total y
// n_neutral se reportan aparte y nunca se sustituyen. Denominador de downside
// n-1, target 0, sin epsilon ni anualización. C es diagnóstico.
export function scoreQuarterly(Vq = []) {
  const values = Array.isArray(Vq) ? Vq.filter(isFiniteNumber) : [];
  const invalidCount = Array.isArray(Vq) ? Vq.length - values.length : 0;

  const positives = values.filter((value) => value > 0);
  const negatives = values.filter((value) => value < 0);
  const neutral = values.filter((value) => value === 0);

  const nPlus = positives.length;
  const nMinus = negatives.length;
  const n = nPlus + nMinus;
  const nTotal = values.length;
  const nNeutral = neutral.length;

  const p = n > 0 ? nPlus / n : null;
  const l = n > 0 ? nMinus / n : null;
  const G = nPlus > 0 ? mean(positives) : null;
  const A = nMinus > 0 ? mean(negatives.map((value) => Math.abs(value))) : null;
  const mu = n > 0 ? values.reduce((sum, value) => sum + value, 0) / n : null;

  const R = G !== null && A !== null && A !== 0 ? G / A : null;
  const C = p !== null && l !== null && l !== 0 && R !== null ? (p / l) * R : null;

  const downsideSum = values.reduce((sum, value) => sum + Math.min(value, 0) ** 2, 0);
  const sigmaDown = n >= 2 ? Math.sqrt(downsideSum / (n - 1)) : null;
  const sortino = mu !== null && sigmaDown !== null && sigmaDown !== 0 ? mu / sigmaDown : null;

  const lossRms = nMinus > 0 ? Math.sqrt(negatives.reduce((sum, value) => sum + value ** 2, 0) / nMinus) : null;
  const kappa = lossRms !== null && A !== null && A !== 0 ? lossRms / A : null;

  const defined = n >= 2 && nPlus > 0 && nMinus > 0;
  const screenPass = sortino !== null && sortino > 1;

  return {
    values,
    invalidCount,
    nPlus,
    nMinus,
    n,
    nTotal,
    nNeutral,
    nNonzero: n,
    p,
    l,
    G,
    A,
    mu,
    R,
    C,
    sigmaDown,
    sortino,
    lossRms,
    kappa,
    defined,
    screenPass,
    undefinedReason: defined ? null : explainUndefined({ n, nPlus, nMinus, nTotal }),
  };
}

function explainUndefined({ n, nPlus, nMinus, nTotal }) {
  if (nTotal === 0) {
    return "Población vacía: toda razón queda indefinida; no se fabrica ningún número.";
  }
  if (n === 0) {
    return "n_nonzero=0: p, l, G, A, mu, R, C y Sortino indefinidos; la neutralidad se reporta aparte.";
  }
  if (n < 2) {
    return "n<2: la convención de downside n-1 no es utilizable; sigma_down y Sortino indefinidos.";
  }
  if (nPlus === 0) {
    return "Grupo ganador vacío: G, R y C indefinidos.";
  }
  if (nMinus === 0) {
    return "Grupo perdedor vacío: A, R y C indefinidos y sigma_down=0 deja Sortino indefinido.";
  }
  return "Población no interpretable para el scoring Quarterly.";
}

// §5.7: mínimos de evidencia separados del n de scoring.
export function minimumEvidence({ mission = "Quarterly", quartersCompleted = 0, calendarYearsCovered = 0, monthsCompleted = 0 } = {}) {
  if (mission === "Monthly") {
    return {
      mission,
      minimumQuartersRequired: null,
      minimumCalendarYearsRequired: null,
      minimumMonthsRequired: 24,
      quartersCompleted,
      calendarYearsCovered,
      monthsCompleted,
      minimumEvidenceMet: Number.isInteger(monthsCompleted) && monthsCompleted >= 24,
    };
  }
  if (mission !== "Quarterly") {
    return {
      mission,
      minimumQuartersRequired: null,
      minimumCalendarYearsRequired: null,
      minimumMonthsRequired: null,
      quartersCompleted,
      calendarYearsCovered,
      monthsCompleted,
      minimumEvidenceMet: false,
    };
  }
  return {
    mission: "Quarterly",
    minimumQuartersRequired: 8,
    minimumCalendarYearsRequired: 2,
    minimumMonthsRequired: null,
    quartersCompleted,
    calendarYearsCovered,
    monthsCompleted,
    minimumEvidenceMet: Number.isInteger(quartersCompleted) && Number.isInteger(calendarYearsCovered) && quartersCompleted >= 8 && calendarYearsCovered >= 2,
  };
}

function hasQuarterlyEvidence(evidence, scoring) {
  if (!evidence || evidence.mission !== "Quarterly") {
    return false;
  }
  if (!Number.isInteger(evidence.quartersCompleted) || !Number.isInteger(evidence.calendarYearsCovered)) {
    return false;
  }
  if (evidence.quartersCompleted < 8 || evidence.calendarYearsCovered < 2) {
    return false;
  }
  if (evidence.populationMission !== undefined && evidence.populationMission !== "Quarterly") {
    return false;
  }
  if (evidence.population?.mission !== undefined && evidence.population.mission !== "Quarterly") {
    return false;
  }
  const products = evidence.products ?? evidence.population?.products;
  if (products !== undefined && (!Array.isArray(products) || products.length !== 1)) {
    return false;
  }
  if (!Number.isInteger(scoring?.nTotal) || evidence.quartersCompleted !== scoring.nTotal) {
    return false;
  }
  return evidence.minimumEvidenceMet === true;
}

// §5.7/§5.8: el veredicto de research se decide fuera del scoring aritmético.
// Evidencia por debajo del mínimo, ratios indefinidos o muestra no
// interpretable implican HOLD; nunca se fabrica un PASS.
// §5.8: cobertura incompleta, benchmark provisional o datos inválidos no se
// compensan con un score elevado. El canal explícito `dataQuality` es un gate
// de admisibilidad de entradas (no un governor de research): sin declarar
// cobertura "full" y benchmark no provisional, el veredicto no puede ser PASS.
export function quarterlyResearchVerdict({ scoring, evidence, dataQuality } = {}) {
  if (!scoring) {
    return { verdict: "HOLD", reason: "Scoring ausente: HOLD, sin PASS fabricado." };
  }
  if (scoring.invalidCount > 0) {
    return {
      verdict: "INVALID",
      reason: `${scoring.invalidCount} entrada(s) no finita(s) o de tipo incorrecto contaminan la población: el resultado no es interpretable y no puede ocultarse tras un score elevado.`,
    };
  }
  if (!scoring.defined || scoring.sortino === null) {
    return { verdict: "HOLD", reason: "Scoring no interpretable o Sortino indefinido: HOLD, sin PASS fabricado." };
  }
  if (dataQuality?.coverage !== "full") {
    return { verdict: "HOLD", reason: "Cobertura no declarada como completa: HOLD; una cobertura incompleta no se compensa con un score elevado." };
  }
  if (dataQuality?.benchmarkProvisional !== false) {
    return { verdict: "HOLD", reason: "Benchmark provisional o no declarado como no-provisional: HOLD; no se compensa con un score elevado." };
  }
  if (!hasQuarterlyEvidence(evidence, scoring)) {
    return { verdict: "HOLD", reason: "Evidencia Quarterly ausente, cruzada con otra misión, malformada, no reconciliada con la población puntuada o por debajo del mínimo (>=8 trimestres, >=2 años calendario): HOLD." };
  }
  if (!(scoring.mu > 0)) {
    return { verdict: "HOLD", reason: "Criterio económico mean(V_q)>0 no cumplido: HOLD." };
  }
  if (scoring.screenPass) {
    return { verdict: "PASS", reason: "Criterios predeclarados cumplidos con evidencia válida y suficiente." };
  }
  return { verdict: "FAIL", reason: "Evidencia suficiente e interpretable que no cumple el screen Sortino>1 estricto." };
}

// §5.7: Monthly no importa el screen Quarterly. Su contrato es su propio
// mean(V_m)>0 con su mínimo de 24 meses; el Sortino se conserva como
// diagnóstico. No se reclama PASS en este alcance sintético.
export function monthlyDiagnostics({ Vm = [], monthsCompleted = 0 } = {}) {
  const scoring = scoreQuarterly(Vm);
  const economicCriterionMet = scoring.mu !== null && scoring.mu > 0;
  const evidenceMinimumMet = monthsCompleted >= 24;
  return {
    mission: "Monthly",
    quarterlySortinoScreenApplicable: false,
    monthlyEconomicCriterionMet: economicCriterionMet,
    monthlyEvidenceMinimumMet: evidenceMinimumMet,
    scoring,
    researchVerdict: "HOLD",
    researchVerdictReason: explainMonthlyHold({ economicCriterionMet, evidenceMinimumMet }),
  };
}

// §5.7: Monthly no hereda el HOLD del Sortino indefinido. El HOLD Monthly es
// una limitación de alcance del cálculo sintético (no se reclama un PASS sin
// run real), así que su razón se decide por criterio económico y evidencia, no
// por el estado del Sortino diagnóstico.
function explainMonthlyHold({ economicCriterionMet, evidenceMinimumMet }) {
  if (!economicCriterionMet) {
    return "Criterio económico Monthly mean(V_m)>0 no cumplido: HOLD.";
  }
  if (!evidenceMinimumMet) {
    return "Evidencia Monthly por debajo del mínimo de 24 meses: HOLD.";
  }
  return "HOLD por limitación de alcance del cálculo sintético: el screen Sortino Quarterly no se importa y no se reclama un PASS Monthly sin run real; no depende de que el Sortino esté indefinido.";
}

// §5.7: C se reporta cuando está definido; C>lambda no es un gate de PASS.
export function cDiagnostic({ C } = {}) {
  return {
    CReported: isFiniteNumber(C),
    hardResearchGate: false,
    researchPassFromCAlone: false,
  };
}
