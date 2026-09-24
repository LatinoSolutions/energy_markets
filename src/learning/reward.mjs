// Contrato del reward global (IMP-19, DEP-19). Fuente: SPEC v1.1.1 §10.1 (ONE
// GLOBAL PROCUREMENT REWARD; ancla V_q=B_q-H_q; R_campaign=g(Procurement
// Value); g(V)=V es el candidato más simple; una normalización futura debe
// preservar el orden económico, justificarse con las distribuciones y
// congelarse antes de la evaluación OOS que la utilice; no se inventan escala,
// clipping, pesos ni descuento), §10.2 (ninguna Strategy recibe un economic
// reward independiente; Contribution_i=R_full-R_without_i; el crédito se
// investiga por ablation), §10.3 (R_T=V_campaign es recomendación terminal; los
// costes entran en H una sola vez y no se penalizan de nuevo en el reward; la
// campaña inválida es evidencia no evaluable), §11.5 (cambios de configuración
// crean versión nueva) y §25.2.3 IMP-19 (la configuración del reward se
// investiga y formaliza en el alcance; antes de entrenar/evaluar una candidate
// concreta debe estar congelada y autorizada; sin evidencia no se inventa).
//
// Fail-closed: una configuración OPEN puede existir y describe el trabajo
// pendiente; no puede llevar parámetros numéricos inventados. Un reward local,
// un segundo reward o una penalización duplicada de costes se rechazan.

export const GLOBAL_REWARD_ID = "GLOBAL_PROCUREMENT_REWARD";
export const REWARD_ANCHOR = Object.freeze({
  definition: "V_q = B_q - H_q; R_campaign = g(Procurement Value)",
  source: "SPEC v1.1.1 §10.1",
});
export const REWARD_CONFIG_STATES = Object.freeze({
  OPEN: "OPEN",
  FROZEN: "FROZEN",
});
export const CANONICAL_IDENTITY_TRANSFORM = Object.freeze({
  kind: "IDENTITY",
  formula: "g(V)=V",
  authority: "SPEC v1.1.1 §10.1 (candidato más simple; no se declara transformación final)",
});

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function fail(errors) {
  return { ok: errors.length === 0, errors };
}

function requireNonEmpty(field, value, errors, message) {
  if (!isNonEmptyString(value)) {
    errors.push({ field, code: "MISSING_REQUIRED", message: message ?? `Falta "${field}" en el contrato del reward (§10.1).` });
  }
}

function hasOwnNumeric(value) {
  if (Array.isArray(value)) {
    return value.some(hasOwnNumeric);
  }
  if (value && typeof value === "object") {
    return Object.values(value).some(hasOwnNumeric);
  }
  return isFiniteNumber(value);
}

// §10.1/§10.2: existe UN solo reward global con un único significado de éxito.
// Un reward por Strategy, un segundo objetivo económico o una penalización de
// costes dentro del reward se rechazan en el momento (§10.3: los costes entran
// en H una sola vez).
export function assertSingleGlobalReward(declaration = {}) {
  const errors = [];
  if (!declaration || typeof declaration !== "object" || Array.isArray(declaration)) {
    return fail([{ field: "(reward)", code: "MISSING_GLOBAL_REWARD", message: "No hay declaración del reward global (§10.1)." }]);
  }
  if (declaration.rewardId !== GLOBAL_REWARD_ID) {
    errors.push({ field: "rewardId", code: "MULTIPLE_OR_UNKNOWN_REWARD", message: `El único reward económico es ${GLOBAL_REWARD_ID}; otro id sería un segundo objetivo (§10.1).` });
  }
  if (declaration.anchoredToProcurementValue !== true) {
    errors.push({ field: "anchoredToProcurementValue", code: "REWARD_NOT_ANCHORED", message: "El reward debe anclarse al Procurement Value V=B-H de §5/§10.1, no a otra métrica." });
  }
  const localRewards = declaration.localRewards ?? [];
  if (!Array.isArray(localRewards) || localRewards.length > 0) {
    errors.push({ field: "localRewards", code: "LOCAL_REWARD_FORBIDDEN", message: "Ninguna Strategy/componente recibe un economic reward independiente (§10.1/§10.2)." });
  }
  if (declaration.perStrategyReward === true) {
    errors.push({ field: "perStrategyReward", code: "PER_STRATEGY_REWARD_FORBIDDEN", message: "El reward por Strategy está prohibido: existe un único reward global (§10.2)." });
  }
  if (declaration.costsReenteredInReward === true) {
    errors.push({ field: "costsReenteredInReward", code: "DOUBLE_COST_FORBIDDEN", message: "Los costes de ejecución entran en H una sola vez; no se penalizan de nuevo en el reward (§10.3)." });
  }
  return fail(errors);
}

function validateOrderPreservation(points, errors) {
  if (!Array.isArray(points) || points.length < 2) {
    errors.push({ field: "transform.orderPreservation", code: "MISSING_ORDER_EVIDENCE", message: "Una transformación declarada exige evidencia de preservación del orden económico sobre las distribuciones (§10.1)." });
    return;
  }
  for (const point of points) {
    if (!point || !isFiniteNumber(point.V) || !isFiniteNumber(point.R)) {
      errors.push({ field: "transform.orderPreservation", code: "INVALID_ORDER_POINT", message: "Cada punto de la evidencia de orden declara V y R finitos (§10.1)." });
      return;
    }
  }
  for (let i = 1; i < points.length; i += 1) {
    const left = points[i - 1];
    const right = points[i];
    if (!(right.V > left.V)) {
      errors.push({ field: "transform.orderPreservation", code: "ORDER_POINTS_NOT_SORTED", message: "Los puntos de evidencia deben estar ordenados por V creciente para probar la monotonía (§10.1)." });
      return;
    }
    if (!(right.R > left.R)) {
      errors.push({ field: "transform.orderPreservation", code: "ORDER_NOT_PRESERVED", message: "La transformación declarada invierte/no preserva el orden económico V→R: no se admite (§10.1)." });
      return;
    }
  }
}

// Valida la configuración del reward. Estado OPEN: trabajo pendiente sin
// parámetros numéricos inventados. Estado FROZEN: exige transformación
// declarada (IDENTITY o DECLARED con evidencia de orden y justificación) y
// sello/declarante congelación ANTES de la evaluación (§10.1/§25.2.3).
export function validateRewardConfiguration(config) {
  const errors = [];
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    return fail([{ field: "(config)", code: "MISSING_REWARD_CONFIG", message: "No hay configuración de reward (§25.2.3 IMP-19)." }]);
  }
  requireNonEmpty("configVersion", config.configVersion, errors);
  if (config.state !== REWARD_CONFIG_STATES.OPEN && config.state !== REWARD_CONFIG_STATES.FROZEN) {
    errors.push({ field: "state", code: "INVALID_REWARD_STATE", message: "state sólo toma OPEN o FROZEN (§25.2.3 IMP-19)." });
  }
  errors.push(...assertSingleGlobalReward(config.reward ?? {}).errors);
  if (config.costsEnteredOnceInH !== true) {
    errors.push({ field: "costsEnteredOnceInH", code: "COST_ACCOUNTING_NOT_DECLARED", message: "La configuración declara que los costes entran en H una sola vez (§10.3)." });
  }
  const transform = config.transform ?? null;
  if (config.state === REWARD_CONFIG_STATES.OPEN) {
    if (transform !== null && hasOwnNumeric(transform)) {
      errors.push({ field: "transform", code: "INVENTED_REWARD_PARAMS", message: "Una configuración OPEN no puede portar parámetros numéricos de transformación inventados (§10.1/§25.2.3)." });
    }
  } else if (config.state === REWARD_CONFIG_STATES.FROZEN) {
    requireNonEmpty("frozenAtUtc", config.frozenAtUtc, errors, "La configuración congelada lleva su sello UTC de congelación ex-ante (§10.1).");
    requireNonEmpty("declaredBy", config.declaredBy, errors);
    if (!transform || typeof transform !== "object" || Array.isArray(transform)) {
      errors.push({ field: "transform", code: "MISSING_FROZEN_TRANSFORM", message: "Una configuración FROZEN declara su transformación g(V) (§10.1)." });
    } else if (transform.kind === "IDENTITY") {
      if (transform.formula !== "g(V)=V") {
        errors.push({ field: "transform.formula", code: "IDENTITY_FORMULA_MISMATCH", message: "La transformación IDENTITY es g(V)=V (§10.1)." });
      }
    } else if (transform.kind === "DECLARED") {
      requireNonEmpty("transform.transformVersion", transform.transformVersion, errors);
      requireNonEmpty("transform.justification", transform.justification, errors, "La normalización se justifica con sus distribuciones (§10.1).");
      requireNonEmpty("transform.distributionEvidenceRef", transform.distributionEvidenceRef, errors, "La normalización cita la evidencia de distribuciones usada (§10.1).");
      validateOrderPreservation(transform.orderPreservation, errors);
    } else {
      errors.push({ field: "transform.kind", code: "UNKNOWN_TRANSFORM", message: "transform.kind sólo toma IDENTITY o DECLARED (§10.1)." });
    }
  }
  return fail(errors);
}

function declaredTransformOf(transform, V) {
  const point = (transform.orderPreservation ?? []).find((entry) => entry.V === V);
  if (!point) {
    return { defined: false };
  }
  return { defined: true, R: point.R };
}

// Evalúa R_campaign=g(V) SÓLO con configuración FROZEN válida y V=B-H finito.
// Una transformación que no cubra el V observado queda no-evaluable: no se
// interpola ni se inventa el valor de g en ese punto (§10.1).
export function evaluateReward({ B = null, H = null, config = null } = {}) {
  const validation = validateRewardConfiguration(config);
  if (!validation.ok) {
    return { ok: false, code: "REWARD_CONFIG_INVALID", status: "HOLD", errors: validation.errors };
  }
  if (config.state !== REWARD_CONFIG_STATES.FROZEN) {
    return {
      ok: false,
      code: "REWARD_CONFIG_NOT_FROZEN",
      status: "HOLD",
      message: "§25.2.3 IMP-19: antes de evaluar una candidate concreta la configuración del reward debe estar congelada y autorizada; OPEN no se usa para puntuar.",
    };
  }
  if (!isFiniteNumber(B) || !isFiniteNumber(H)) {
    return { ok: false, code: "REWARD_UNDEFINED", status: "HOLD", message: "Sin B y H finitos no hay Procurement Value evaluable (§5.5/§10.1)." };
  }
  const V = B - H;
  if (config.transform.kind === "IDENTITY") {
    return { ok: true, V, R: V, transformKind: "IDENTITY", configVersion: config.configVersion, source: "SPEC v1.1.1 §10.1" };
  }
  const declared = declaredTransformOf(config.transform, V);
  if (!declared.defined) {
    return {
      ok: false,
      code: "REWARD_TRANSFORM_OUT_OF_EVIDENCE",
      status: "HOLD",
      V,
      message: "La transformación declarada no cubre este V con evidencia: no se interpola ni se inventa g(V) (§10.1).",
    };
  }
  return { ok: true, V, R: declared.R, transformKind: "DECLARED", configVersion: config.configVersion, source: "SPEC v1.1.1 §10.1" };
}

// §10.2: la señal de contribución se deriva del mismo objetivo global; no crea
// un segundo reward. Se devuelve la diferencia tal como fue medida.
export function contributionOf({ R_full = null, R_without_i = null } = {}) {
  if (!isFiniteNumber(R_full) || !isFiniteNumber(R_without_i)) {
    return { ok: false, code: "CONTRIBUTION_UNDEFINED", message: "La contribución exige ambos R bajo el mismo contrato experimental (§10.2)." };
  }
  return { ok: true, contribution: R_full - R_without_i, definition: "R_full - R_without_i (§10.2)" };
}