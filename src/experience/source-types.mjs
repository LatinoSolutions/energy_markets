// Tipos de fuente de Experience (IMP-17). Fuente: SPEC v1.1.1 §12.1 (tres
// fuentes canónicas: Historical Replay / Simulation, Shadow factual, Real
// execution factual; los contrafactuales modelados conservan etiqueta
// separada), §12.3 (ninguna fuente se presenta con igual fuerza probatoria por
// defecto; toda weighting/sampling/combinación debe predeclararse y
// versionarse; la mezcla no promociona ni convierte Replay en factual) y
// §25.1 fila IMP-17 ("no mezclar fuerza probatoria").
//
// Los fills de Shadow siguen simulados salvo ejecución real existente; Shadow
// no equivale a Real Execution (§12.1). Esta capa no genera Real Experience:
// sólo clasifica y separa la que exista.

// §12.1: cada fuente declara qué es factual en ella. Todo lo que no esté
// declarado factual permanece simulado/límite probatorio.
export const EXPERIENCE_SOURCE_TYPES = Object.freeze({
  REPLAY: Object.freeze({
    id: "REPLAY",
    evidenceClass: "SIMULATED",
    factual: ["market_data_pit_admitted", "admitted_trajectory"],
    simulated: ["reproduced_actions", "execution", "outcomes_calculated_by_evaluator"],
  }),
  SHADOW: Object.freeze({
    id: "SHADOW",
    evidenceClass: "FACTUAL_LIMITED",
    factual: ["information_consumption", "timestamped_recommendation_issued_before_later_market", "posterior_realised_trajectory"],
    simulated: ["hypothetical_fills", "hypothetical_costs"],
  }),
  REAL_EXECUTION: Object.freeze({
    id: "REAL_EXECUTION",
    evidenceClass: "FACTUAL",
    factual: ["recommendation", "human_intervention_if_present", "effective_action", "real_fills", "real_costs", "observed_outcome"],
    simulated: [],
  }),
});

// §12.1: los contrafactuales modelados conservan etiqueta separada del
// resultado real; no son una cuarta fuente, es la marca que separa el
// modelado del hecho dentro de un registro Real.
export const COUNTERFACTUAL_LABEL = "COUNTERFACTUAL_MODELLED";

// §12.1/§12.3: los fills de Shadow permanecen simulados salvo ejecución real
// existente. Un Shadow record nunca firma REAL_FILL por sí solo.
export const FILL_EVIDENCE_KINDS = Object.freeze({
  REAL_FILL: "REAL_FILL",
  SIMULATED_FILL: "SIMULATED_FILL",
  COUNTERFACTUAL_FILL: "COUNTERFACTUAL_FILL",
});

function specOf(sourceType) {
  return EXPERIENCE_SOURCE_TYPES[sourceType] ?? null;
}

export function isExperienceSourceType(value) {
  return typeof value === "string" && specOf(value) !== null;
}

// Clase de fuerza probatoria de la fuente, tal como la declara la SPEC; no
// adjudica más fuerza de la declarada (§12.1).
export function probatoryForceOf(sourceType) {
  return specOf(sourceType)?.evidenceClass ?? null;
}

// §12.3: las fuentes pueden alimentar el Learning Loop únicamente con su
// source provenance preservada y sin igualar fuerza probatoria. La clase de
// cada registro la pone su sourceType, no la mezcla.
export function evidenceClassOfRecord(record) {
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    return null;
  }
  return probatoryForceOf(record.sourceType);
}

// §12.3: cualquier weighting, sampling o combinación de fuentes debe
// predeclararse y versionarse; el corpus no fija una proporción numérica y la
// ausencia de declaración es fail-closed, no una mezcla con pesos por defecto.
export function validateMixtureDeclaration(declaration) {
  if (!declaration || typeof declaration !== "object" || Array.isArray(declaration)) {
    return { ok: false, code: "MISSING_MIXTURE_DECLARATION", message: "Sin declaración predeclarada no hay combinación de fuentes (§12.3)." };
  }
  if (typeof declaration.declarationVersion !== "string" || declaration.declarationVersion.trim().length === 0) {
    return { ok: false, code: "MISSING_DECLARATION_VERSION", message: "La declaración de mezcla debe llevar declarationVersion (§12.3)." };
  }
  if (!declaration.weights || typeof declaration.weights !== "object" || Array.isArray(declaration.weights)) {
    return { ok: false, code: "MISSING_WEIGHTS", message: "La declaración debe llevar weights por fuente (§12.3)." };
  }
  for (const [sourceType, weight] of Object.entries(declaration.weights)) {
    if (!isExperienceSourceType(sourceType)) {
      return { ok: false, code: "UNKNOWN_SOURCE_IN_WEIGHTS", message: `weight ${sourceType} no es una fuente canónica §12.1.` };
    }
    if (typeof weight !== "number" || !Number.isFinite(weight) || weight < 0) {
      return { ok: false, code: "INVALID_WEIGHT", message: `weight ${sourceType} debe ser numero finito >= 0 (§12.3).` };
    }
  }
  if (typeof declaration.declaredBy !== "string" || declaration.declaredBy.trim().length === 0) {
    return { ok: false, code: "MISSING_DECLARED_BY", message: "La declaración predeclarada debe identificar quién la declara (§12.3)." };
  }
  return { ok: true };
}

function deepFreeze(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) {
      deepFreeze(child);
    }
  }
  return value;
}

// §12.3: la mezcla no concede autoridad de promoción ni convierte
// retrospectivamente Replay en factual. Devuelve un corpus tabulado por
// fuente: cada registro conserva el evidence class de SU fuente y ninguna
// fuente hereda la fuerza de otra.
export function combineCorpusBySource({ records = [], mixtureDeclaration = null }) {
  if (!Array.isArray(records)) {
    return { ok: false, code: "INVALID_RECORDS", message: "corpus debe ser lista de records (§12.3)." };
  }
  if (records.length === 0) {
    return { ok: false, code: "EMPTY_CORPUS", message: "Sin registros no hay corpus que combinar; no se fabrica corpus vacío con pesos (§12.3)." };
  }
  if (mixtureDeclaration === null || validateMixtureDeclaration(mixtureDeclaration).ok !== true) {
    // Fail-closed: cualquier weighting/combinación sin predeclaración
    // versionada está prohibido (§12.3). Sin declaración no se devuelve nada.
    const reason = mixtureDeclaration === null
      ? { ok: false, code: "MIXING_NOT_PREDECLARED", message: "Cualquier weighting/combining debe predeclararse y versionarse antes de mezclar (§12.3)." }
      : validateMixtureDeclaration(mixtureDeclaration);
    return reason;
  }
  const bySource = {};
  for (const record of records) {
    const sourceType = record?.sourceType;
    if (!isExperienceSourceType(sourceType)) {
      return { ok: false, code: "INVALID_SOURCE_TYPE", message: "Cada registro del corpus debe llevar una fuente canónica (§12.1)." };
    }
    if (!bySource[sourceType]) {
      bySource[sourceType] = { sourceType, evidenceClass: probatoryForceOf(sourceType), records: [] };
    }
    bySource[sourceType].records.push(record);
  }
  return {
    ok: true,
    // Declaración conservada tal cual: la mezcla es con provenance, nunca
    // implícita (§12.3).
    mixtureDeclaration: deepFreeze({ ...mixtureDeclaration, weights: { ...mixtureDeclaration.weights } }),
    bySource: deepFreeze(bySource),
  };
}
