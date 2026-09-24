// Definiciones canónicas de S1 — Relative Price Location (IMP-11). Fuente:
// SPEC v1.1.1 §8.1 (rol "dónde está el precio", observable inputs, outputs
// continuos percentile/normalized distance/signed distance, familias de
// parámetros A–D, calibración en development con thresholds congelados), §8.6
// (protocolo compartido: predeclarar espacio de búsqueda, congelar y validar
// OOS) y §25.1/§25.2 fila IMP-11 (outputs: feature definitions, search space y
// configuration version; acceptance: sólo static location altera timing; sin
// Z/S2–S5/drivers; thresholds frozen fuera de OOS; MUST NOT: identidad S1,
// A1=A0+S1, Procurement State no añade alpha independiente).
//
// Este módulo fija la IDENTIDAD y los guards; no calcula precios ni elige
// parámetros (eso vive en causal-reference.mjs / configuration.mjs). No
// convierte ningún ejemplo de §8.1 ("MA50, H4 o percentile 15") en valor
// aprobado: son ejemplos, no defaults.

export const S1_SEMANTIC_IDENTITY = "S1_RELATIVE_PRICE_LOCATION";

// §8.1 Outputs/evidence: features continuas de ubicación. Ninguna de ellas es
// trayectoria (eso pertenece a S3, §8.1 "Relations y what it is NOT").
export const S1_CANONICAL_FEATURES = ["percentile", "normalizedDistance", "signedDistanceToReference"];

// §8.1 Parameters: familias candidatas de referencia.
export const REFERENCE_FAMILIES = {
  A: "CAUSAL_CENTER",
  B: "CAUSAL_MOVING_AVERAGE",
  C: "CAUSAL_BANDS",
  D: "NORMALIZED_EXTREME",
};

export const CENTER_STATISTICS = ["MEDIAN", "MEAN"];
export const MOVING_AVERAGE_KINDS = ["SMA", "EMA"];

// §8.1 Observable inputs: "posición relativa en rango/distribución del
// horizonte Monthly y de la ventana de procurement de tres meses, mantenidos
// separados". Un horizonte y sólo uno por referencia; nunca se mezclan misiones.
export const HORIZON_KINDS = {
  PROCUREMENT_WINDOW_3M: "PROCUREMENT_WINDOW_3M",
  MONTHLY: "MONTHLY",
};

// P5.3: el primer experimento comprende exclusivamente Gas Quarterly.
export const S1_EXPERIMENT_PRODUCT = "Gas";
export const S1_EXPERIMENT_MISSION = "Quarterly";

// §13.5 P5.5: en A1, S1-derived price location es lo ÚNICO que puede cambiar
// BUY/WAIT respecto de A0. Estos inputs quedan excluidos del timing (§13.5
// "S2–S5, Z, Fundamental Price Drivers, Extraordinary State | Excluidos", §9.2,
// §10.3 y §14.2: Benchmark B es evaluation-view). Los precios crudos tampoco
// deciden timing: el timing consume features S1, no la serie (§8.1 outputs).
export const FORBIDDEN_A1_TIMING_INPUT_KEYS = [
  "prices", "priceSeries", "priceHistory", "bestAsk", "bestBid", "referencePrice", "lastPrice",
  "s2", "s3", "s4", "s5", "z", "z_t",
  "drivers", "fundamentalDrivers", "sentiment", "marketDynamics", "extraordinaryState",
  "benchmarkB", "benchmark", "outcomes",
];

// §8.1: S1 responde "dónde está el precio", no cómo llegó allí. Un feature de
// trayectoria (slope/velocity/trend/...) pertenece a S3 y no puede alterar el
// timing de A1: su presencia se rechaza fail-closed, no se ignora.
export const TRAJECTORY_FEATURE_KEYS = [
  "slope", "velocity", "momentum", "trend", "direction", "path", "rhythm",
  "persistence", "repricing", "acceleration", "derivative", "extension",
];

export const IMP11_ACCEPTANCE_TEST = "Sólo static location altera timing; sin Z/S2–S5/drivers; thresholds frozen fuera de OOS.";

export const IMP11_MUST_NOT_CHANGE = "Identidad S1; A1=A0+S1; Procurement State no añade alpha independiente.";

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

// §8.1/§13.5: el timing de A1 sólo puede leer features de ubicación estática.
// Un feature de trayectoria o una key de otro componente (Z/S2–S5/drivers)
// invalida el estado de decisión.
export function validateA1TimingState(state = {}) {
  const violations = [];
  if (state === null || typeof state !== "object" || Array.isArray(state)) {
    return {
      ok: false,
      violations: ["state"],
      code: "INVALID_A1_TIMING_STATE",
      message: "El estado de decisión de A1 debe ser un objeto.",
    };
  }
  for (const key of Object.keys(state)) {
    if (FORBIDDEN_A1_TIMING_INPUT_KEYS.includes(key)) {
      violations.push(key);
    }
  }
  const features = state.s1Features ?? state.features ?? null;
  if (features !== null && typeof features === "object" && !Array.isArray(features)) {
    for (const key of Object.keys(features)) {
      if (TRAJECTORY_FEATURE_KEYS.includes(key)) {
        violations.push(`s1Features.${key}`);
      }
    }
  }
  return {
    ok: violations.length === 0,
    violations,
    code: violations.length > 0 ? "A1_TIMING_INPUT_REJECTED" : "OK",
    message: violations.length > 0
      ? "A1 sólo puede alterar BUY/WAIT por la ubicación estática de S1: se rechazan precios crudos, Z, S2–S5, drivers, Extraordinary State, Benchmark B y features de trayectoria (§8.1/§13.5)."
      : "Estado compatible con A1 = A0 + S1.",
  };
}

// §8.1: el output de S1 no contiene trayectoria. Se comprueba en el propio
// resultado de features, no sólo en el estado de decisión.
export function validateStaticLocationFeatures(features = {}) {
  const violations = TRAJECTORY_FEATURE_KEYS.filter((key) => Object.hasOwn(features, key));
  return {
    ok: violations.length === 0,
    violations,
    code: violations.length > 0 ? "TRAJECTORY_FEATURE_REJECTED" : "OK",
    message: violations.length > 0
      ? "La ubicación relativa de S1 es estática; slope/velocity/trend/… pertenecen a S3 (§8.1) y no forman parte de este output."
      : "Features consistentes con S1 — Relative Price Location.",
  };
}

// §8.1: cada referencia declara exactamente un horizonte; una referencia que
// declare ambos (o ninguno) mezcla la ventana de procurement con Monthly y se
// rechaza.
export function validateHorizonDeclaration(horizon) {
  const errors = [];
  if (horizon === null || typeof horizon !== "object" || Array.isArray(horizon)) {
    return { ok: false, errors: [{ field: "horizon", code: "MISSING_HORIZON", message: "La referencia debe declarar su horizonte." }] };
  }
  if (!isNonEmptyString(horizon.horizonId)) {
    errors.push({ field: "horizon.horizonId", code: "MISSING_HORIZON_ID", message: "El horizonte necesita un horizonteId estable." });
  }
  if (!Object.values(HORIZON_KINDS).includes(horizon.kind)) {
    errors.push({ field: "horizon.kind", code: "INVALID_HORIZON_KIND", message: `horizon.kind debe ser uno de ${Object.values(HORIZON_KINDS).join(", ")}.` });
  }
  return { ok: errors.length === 0, errors };
}

// §8.1: "mantenidos separados". Un conjunto de referencias no puede asignar
// horizontes distintos a un mismo horizonteId, ni declarar mixesMissions.
export function assertHorizonsSeparated(references = []) {
  const errors = [];
  const kindById = new Map();
  references.forEach((reference, index) => {
    const outcome = validateHorizonDeclaration(reference?.horizon);
    if (!outcome.ok) {
      errors.push(...outcome.errors.map((error) => ({ ...error, field: `references[${index}].${error.field}` })));
      return;
    }
    const prior = kindById.get(reference.horizon.horizonId);
    if (prior !== undefined && prior !== reference.horizon.kind) {
      errors.push({
        field: `references[${index}].horizon`,
        code: "HORIZON_KIND_CONFLICT",
        message: `El horizonte "${reference.horizon.horizonId}" se declara como ${prior} y ${reference.horizon.kind}; los horizontes se mantienen separados (§8.1).`,
      });
    }
    kindById.set(reference.horizon.horizonId, reference.horizon.kind);
  });
  return { ok: errors.length === 0, errors };
}

// §8.1: la identidad semántica de S1 está congelada. Una configuración que
// renombre S1 o cambie sus features canónicas no es una recalibración: es otro
// objeto (se rechaza, no se renombra en silencio).
export function assertSemanticIdentityIntact(definition = {}) {
  const violations = [];
  if (definition.semanticIdentity !== S1_SEMANTIC_IDENTITY) {
    violations.push("semanticIdentity");
  }
  const features = definition.canonicalFeatures;
  if (!Array.isArray(features) || S1_CANONICAL_FEATURES.some((feature) => !features.includes(feature))) {
    violations.push("canonicalFeatures");
  }
  return {
    ok: violations.length === 0,
    violations,
    code: violations.length > 0 ? "S1_SEMANTIC_IDENTITY_CHANGED" : "OK",
    message: violations.length > 0
      ? "La identidad semántica de S1 está CANONICAL/FROZEN: no se renombra ni se le quitan features de ubicación (§8.1/§25.1 MUST NOT)."
      : "Identidad S1 intacta.",
  };
}
