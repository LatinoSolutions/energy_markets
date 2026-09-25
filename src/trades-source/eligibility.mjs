// Regla de trade elegible point-in-time del modo TRADES. Fuente normativa:
// OWNER_PATCH_TRADES_MODE_2026-09-25.md (EM-SPEC-OWNER-PATCH-2026-09-25-03)
// §3.1 "Trade elegible (point-in-time)":
//   - Simple Instrument; TrdType = 'Exchange' (Trade Registration solo como
//     variante declarada); Px no vacío; VolumeOnly <> 'true'.
//   - FromBrokenSpread: la regla de inclusión se fija en TR-01 con medición
//     completa y se congela en TR-04; aquí queda como parámetro declarado.
//   - Disponibilidad = Tm (supuesto declarado: sin retraso de publicación).
//   - Un trade con Delete posterior deja de ser elegible solo desde el Delete
//     (ver delete-point-in-time.mjs).
//   - Los trades sin AgrsrAct forman su propio grupo; nunca se les asigna un
//     lado por suposición (§3.3).
//
// Este módulo es puro: no lee el lago ni el archivo del cliente. Recibe filas
// normalizadas (una fila cruda por registro) y decide elegibilidad. La medición
// sobre la historia completa la corre el job de escaneo de TR-01.

// §3.1: la inclusión de broken spread decide la mayor parte de la muestra y se
// congela en TR-04. Se declaran las dos políticas para poder medir ambas; el
// valor congelado no vive aquí.
export const BROKEN_SPREAD_POLICIES = Object.freeze({
  INCLUDE: "INCLUDE",
  EXCLUDE: "EXCLUDE",
});

export const DEFAULT_BROKEN_SPREAD_POLICY = BROKEN_SPREAD_POLICIES.INCLUDE;

// Variantes declaradas de TrdType. §3.1: 'Exchange' es la norma; Trade
// Registration solo como variante declarada (no se incluye en silencio).
export const ELIGIBLE_TRD_TYPES = Object.freeze(["Exchange"]);
export const DECLARED_TRD_TYPE_VARIANTS = Object.freeze(["Trade Registration"]);

export const AGGREGATOR = Object.freeze({
  BUY: "BUY",
  SELL: "SELL",
  UNKNOWN: "UNKNOWN",
});

export const ELIGIBILITY_REASON = Object.freeze({
  ELIGIBLE: "ELIGIBLE",
  INSTRUMENT_NOT_SIMPLE: "INSTRUMENT_NOT_SIMPLE",
  TRD_TYPE_NOT_EXCHANGE: "TRD_TYPE_NOT_EXCHANGE",
  PX_EMPTY: "PX_EMPTY",
  VOLUME_ONLY: "VOLUME_ONLY",
  BROKEN_SPREAD_EXCLUDED: "BROKEN_SPREAD_EXCLUDED",
  NOT_A_NEW_UPDATE: "NOT_A_NEW_UPDATE",
});

const truthyString = (value) => typeof value === "string" && value.trim() !== "";
const isBlank = (value) => value === undefined || value === null || (typeof value === "string" && value.trim() === "");

export function normalizedBrokenSpread(row) {
  const value = row?.FromBrokenSpread;
  if (isBlank(value)) return null;
  return String(value).trim().toLowerCase() === "true";
}

export function classifyAggressor(row) {
  const value = isBlank(row?.AgrsrAct) ? "" : String(row.AgrsrAct).trim().toUpperCase();
  if (value === "BUY") return AGGREGATOR.BUY;
  if (value === "SELL") return AGGREGATOR.SELL;
  return AGGREGATOR.UNKNOWN;
}

// Devuelve la lista de motivos de exclusión; vacía si el trade es elegible.
// El orden es estable para que el artefacto sea reproducible.
export function eligibilityReasons(row, { brokenSpreadPolicy = DEFAULT_BROKEN_SPREAD_POLICY } = {}) {
  const reasons = [];
  if (row?.InstrumentType !== "Simple Instrument") {
    reasons.push(ELIGIBILITY_REASON.INSTRUMENT_NOT_SIMPLE);
  }
  if (!ELIGIBLE_TRD_TYPES.includes(row?.TrdType)) {
    reasons.push(ELIGIBILITY_REASON.TRD_TYPE_NOT_EXCHANGE);
  }
  if (!truthyString(row?.Px)) {
    reasons.push(ELIGIBILITY_REASON.PX_EMPTY);
  }
  if (row?.VolumeOnly === "true") {
    reasons.push(ELIGIBILITY_REASON.VOLUME_ONLY);
  }
  // Solo las filas New son trades; las filas Delete/amend son registros de
  // actualización y se resuelven en delete-point-in-time.mjs.
  if (!isBlank(row?.UpdtAct) && row.UpdtAct !== "New") {
    reasons.push(ELIGIBILITY_REASON.NOT_A_NEW_UPDATE);
  }
  if (
    brokenSpreadPolicy === BROKEN_SPREAD_POLICIES.EXCLUDE &&
    normalizedBrokenSpread(row) === true
  ) {
    reasons.push(ELIGIBILITY_REASON.BROKEN_SPREAD_EXCLUDED);
  }
  return reasons;
}

export function isEligibleTrade(row, options) {
  return eligibilityReasons(row, options).length === 0;
}

// Cuenta la muestra bajo ambas políticas de broken spread y separa el grupo sin
// agresor. Es la medición que TR-01 corre sobre la historia completa para fijar
// la regla que se congela en TR-04.
export function aggregateEligibility(rows, { brokenSpreadPolicy = DEFAULT_BROKEN_SPREAD_POLICY } = {}) {
  const counts = {
    total: rows.length,
    eligible: 0,
    eligibleBrokenSpread: 0,
    eligibleNotBrokenSpread: 0,
    eligibleUnknownAggressor: 0,
    excluded: 0,
    reasonCounts: {},
    byAggressor: { [AGGREGATOR.BUY]: 0, [AGGREGATOR.SELL]: 0, [AGGREGATOR.UNKNOWN]: 0 },
  };
  const exclusionKeys = Object.values(ELIGIBILITY_REASON).filter((reason) => reason !== ELIGIBILITY_REASON.ELIGIBLE);
  for (const reason of exclusionKeys) counts.reasonCounts[reason] = 0;

  for (const row of rows) {
    const reasons = eligibilityReasons(row, { brokenSpreadPolicy });
    if (reasons.length > 0) {
      counts.excluded += 1;
      for (const reason of reasons) counts.reasonCounts[reason] += 1;
      continue;
    }
    counts.eligible += 1;
    if (normalizedBrokenSpread(row) === true) counts.eligibleBrokenSpread += 1;
    else counts.eligibleNotBrokenSpread += 1;
    const aggressor = classifyAggressor(row);
    counts.byAggressor[aggressor] += 1;
    if (aggressor === AGGREGATOR.UNKNOWN) counts.eligibleUnknownAggressor += 1;
  }
  return counts;
}

// Mide ambas políticas de una sola pasada, sin elegir ninguna: la decisión se
// congela en TR-04 con esta medición sobre la historia completa.
export function measureBrokenSpreadPolicies(rows) {
  return {
    include: aggregateEligibility(rows, { brokenSpreadPolicy: BROKEN_SPREAD_POLICIES.INCLUDE }),
    exclude: aggregateEligibility(rows, { brokenSpreadPolicy: BROKEN_SPREAD_POLICIES.EXCLUDE }),
  };
}
