// Protocolo separado Q07 (IMP-21): hora de decisión intradía fuera de P5 y
// su experimento. Fuente: SPEC v1.1.1 §25.1 fila IMP-21 ("Misma lógica/
// parámetros/obligación; cambia sólo timing permitido; execution causal por
// hora" / "No fijar 11:00 ni settlement como hora óptima por documentación"),
// §25.2.2 IMP-21 (REQUIRES_AUDIT DEP-17 [data audit intradía]; PRODUCES
// DEP-17 [experimento Q07]: "ventanas/candidatos, métricas/buckets/muestra
// predeclarados") y §25.2.3 IMP-21 ("Si no existe audit intradía suficiente,
// se bloquea la evaluación dependiente y se conserva el faltante"), §15
// (el experimento separado respeta la reserva y no mezcla muestras), §24
// DEP-17.
//
// El protocolo se declara ANTES del test (§25.2.1 "debe registrar su protocolo
// y sus criterios antes del test"), se congela con hash y anti-mutación (§14.9).
// No hay hora fija por documentación: 11:00 y settlement sólo existen si el
// declarante las lista explícitamente como candidatos, sin privilegio.

import { contentHashOf } from "../execution-contract/execution-contract.mjs";

export const Q07_PROTOCOL_ID = "Q07_INTRA_DAY_ENTRY_HOUR";
export const Q07_PROTOCOL_VERSION = "v1.0.0";

export const INTRADAY_CANDIDATE_KINDS = ["FIXED_HOUR_AND_MINUTES", "DYNAMIC_WINDOW"];

export const ALLOWED_TIMING_CHANGE = {
  kind: "INTRADAY_ENTRY_TIMING_ONLY",
  invariants: [
    "same_obligation",
    "same_controller_logic_and_parameters",
    "same_decision_dates",
    "same_execution_contract_rules",
    "only_entry_hour_or_window_varies",
  ],
};

export const PROTOCOL_FIELDS = [
  "artifactKind",
  "protocolId",
  "protocolVersion",
  "specSha256",
  "createdFromImp",
  "obligationBinding",
  "controllerBinding",
  "decisionDates",
  "candidates",
  "metrics",
  "buckets",
  "minObservations",
  "sampleBinding",
  "referenceHourId",
  "allowedTimingChange",
];

export const OBLIGATION_BINDING_FIELDS = [
  "campaignId",
  "product",
  "openingObligationMw",
  "windowStart",
  "windowEnd",
  "deadlineDate",
];

export const SAMPLE_BINDING_FIELDS = ["source", "contentHash", "oosPolicy"];

// La muestra nunca puede declararse por resultado ni mezclar OOS como si no
// estuviera reservado (§15.2). OOS_POLICY valores admitidos.
export const OOS_POLICIES = [
  "SAMPLE_ONLY_DEVELOPMENT",
  "USES_SEALED_OOS_RESERVATION",
];

function hasShape(value, fields) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return fields.every((field) => field in value);
}

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function isDateKey(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function isHourNumber(value) {
  return isFiniteNumber(value)
    && Number.isInteger(value)
    && value >= 0
    && value <= 23;
}

function isMinuteNumber(value) {
  return isFiniteNumber(value)
    && Number.isInteger(value)
    && value >= 0
    && value <= 59;
}

export function validateQ07Protocol(protocol = {}) {
  if (!hasShape(protocol, PROTOCOL_FIELDS)) {
    return { ok: false, code: "MISSING_PROTOCOL_FIELDS" };
  }
  if (protocol.artifactKind !== "IMP-21_Q07_PROTOCOL"
    || protocol.protocolId !== Q07_PROTOCOL_ID
    || typeof protocol.protocolVersion !== "string") {
    return { ok: false, code: "INVALID_PROTOCOL_IDENTITY" };
  }
  if (typeof protocol.specSha256 !== "string" || protocol.specSha256.length !== 64) {
    return { ok: false, code: "INVALID_SPEC_SHA256" };
  }

  const obligation = protocol.obligationBinding ?? null;
  if (!hasShape(obligation, OBLIGATION_BINDING_FIELDS)) {
    return { ok: false, code: "INVALID_OBLIGATION_BINDING" };
  }
  if (!isFiniteNumber(obligation.openingObligationMw) || obligation.openingObligationMw <= 0) {
    return { ok: false, code: "INVALID_OBLIGATION_QUANTITY" };
  }

  const controller = protocol.controllerBinding ?? null;
  if (!controller || typeof controller !== "object"
    || typeof controller.ruleId !== "string"
    || !isFiniteNumber(controller.lotSizeMw) || controller.lotSizeMw <= 0) {
    return { ok: false, code: "INVALID_CONTROLLER_BINDING" };
  }

  const dates = protocol.decisionDates;
  if (!Array.isArray(dates) || dates.length === 0 || !dates.every(isDateKey)) {
    return { ok: false, code: "INVALID_DECISION_DATES" };
  }
  const distinctDates = new Set(dates);
  if (distinctDates.size !== dates.length) {
    return { ok: false, code: "DUPLICATED_DECISION_DATES" };
  }

  const candidates = protocol.candidates;
  if (!Array.isArray(candidates) || candidates.length < 2) {
    return { ok: false, code: "CANDIDATES_REQUIRED", message: "Un entry-hour profile exige al menos dos candidatos de timing." };
  }
  const ids = new Set();
  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== "object"
      || typeof candidate.hourId !== "string"
      || candidate.hourId.length === 0
      || !INTRADAY_CANDIDATE_KINDS.includes(candidate.kind)) {
      return { ok: false, code: "INVALID_CANDIDATE" };
    }
    if (ids.has(candidate.hourId)) {
      return { ok: false, code: "DUPLICATED_CANDIDATE_ID", hourId: candidate.hourId };
    }
    ids.add(candidate.hourId);
    if (candidate.kind === "FIXED_HOUR_AND_MINUTES"
      && (!isHourNumber(candidate.hour) || !isMinuteNumber(candidate.minutes ?? 0))) {
      return { ok: false, code: "INVALID_FIXED_HOUR_CANDIDATE", hourId: candidate.hourId };
    }
    if (candidate.kind === "DYNAMIC_WINDOW"
      && (!isHourNumber(candidate.windowStartHour) || !isHourNumber(candidate.windowEndHour)
        || candidate.windowEndHour < candidate.windowStartHour)) {
      return { ok: false, code: "INVALID_DYNAMIC_WINDOW_CANDIDATE", hourId: candidate.hourId };
    }
  }

  const metrics = protocol.metrics;
  if (!Array.isArray(metrics) || metrics.length === 0
    || !metrics.every((metric) => metric && typeof metric === "object" && typeof metric.metricId === "string")) {
    return { ok: false, code: "INVALID_METRICS" };
  }
  if (!Array.isArray(protocol.buckets) || protocol.buckets.length === 0
    || !protocol.buckets.every((bucket) => hasShape(bucket, ["bucketId", "metricId", "predicate"]))) {
    return { ok: false, code: "INVALID_BUCKETS" };
  }
  const metricIds = new Set(metrics.map((metric) => metric.metricId));
  if (!protocol.buckets.every((bucket) => metricIds.has(bucket.metricId))) {
    return { ok: false, code: "BUCKET_REFERENCES_UNKNOWN_METRIC" };
  }

  if (!isFiniteNumber(protocol.minObservations) || protocol.minObservations < 1
    || !Number.isInteger(protocol.minObservations)) {
    return { ok: false, code: "INVALID_MIN_OBSERVATIONS" };
  }

  const sample = protocol.sampleBinding ?? null;
  if (!hasShape(sample, SAMPLE_BINDING_FIELDS)
    || !OOS_POLICIES.includes(sample.oosPolicy)) {
    return { ok: false, code: "INVALID_SAMPLE_BINDING" };
  }

  // La hora de referencia es un comparator opcional predeclarado, nunca una
  // hora óptima impuesta por documentación (§25.1 "No fijar 11:00 ni
  // settlement como hora óptima").
  const referenceHourId = protocol.referenceHourId ?? null;
  if (referenceHourId !== null && !ids.has(referenceHourId)) {
    return { ok: false, code: "REFERENCE_HOUR_NOT_A_CANDIDATE", hourId: referenceHourId };
  }

  if (protocol.allowedTimingChange?.kind !== ALLOWED_TIMING_CHANGE.kind) {
    return { ok: false, code: "SCOPE_WIDER_THAN_INTRADAY_TIMING" };
  }

  return { ok: true, code: "OK" };
}

export function freezeQ07Protocol(input = {}) {
  const validation = validateQ07Protocol(input);
  if (!validation.ok) {
    return { ok: false, code: validation.code, message: validation.message ?? null };
  }
  const frozen = {
    ...input,
    allowedTimingChange: {
      ...ALLOWED_TIMING_CHANGE,
      ...(input.allowedTimingChange ?? {}),
    },
    status: "FROZEN_PRE_EXPERIMENT",
  };
  const contentHash = contentHashOf(frozen);
  return {
    ok: true,
    frozen: { ...frozen, contentHash },
  };
}

// Anti-mutación (§14.9): un protocolo alterado después de congelarse no
// alimenta evaluaciones. Forma plana: hash de canonical JSON del objeto sin
// el campo contentHash.
export function verifyFrozenQ07Protocol(candidate = null) {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    return { ok: false, code: "MISSING_FROZEN_PROTOCOL" };
  }
  const { contentHash, ...core } = candidate;
  if (candidate.status !== "FROZEN_PRE_EXPERIMENT") {
    return { ok: false, code: "NOT_FROZEN" };
  }
  if (typeof contentHash !== "string") {
    return { ok: false, code: "MISSING_PROTOCOL_HASH" };
  }
  if (contentHashOf(core) !== contentHash) {
    return { ok: false, code: "PROTOCOL_HASH_MISMATCH" };
  }
  return { ok: true, code: "OK", frozen: candidate };
}

// Un test no puede repetirse bajo la misma identidad hasta obtener PASS con
// criterios nuevos (§25.2.1): la re-declaración cambia de versión o es rechazo.
export function assertProtocolIdentityFor(protocol, { expectedVersion = null } = {}) {
  if (protocol?.protocolId !== Q07_PROTOCOL_ID) {
    return { ok: false, code: "PROTOCOL_ID_MISMATCH" };
  }
  if (expectedVersion !== null && protocol.protocolVersion !== expectedVersion) {
    return { ok: false, code: "PROTOCOL_VERSION_MISMATCH" };
  }
  return { ok: true };
}

// Guard §25.1: ningún campo del protocolo nombra una hora "óptima" heredada de
// documentación (11:00 de Liquidación, etc.). Ellos quedan bloqueados si aparecen.
export function assertNoDocumentedHourPresupposition(protocol) {
  if (!protocol || typeof protocol !== "object") {
    return { ok: false, code: "MISSING_PROTOCOL" };
  }
  const encoded = JSON.stringify(protocol).toLowerCase();
  const forbiddenMarkers = [
    '"optimalHour"',
    '"fixedCanonicHour"',
    '"settlementOptimal"',
    '"canonicalEntryHour"',
    '"presetHourBias"',
  ];
  const present = forbiddenMarkers.filter((marker) => encoded.includes(marker.toLowerCase()));
  return present.length === 0
    ? { ok: true, code: "NO_DOCUMENTED_HOUR_PRESUPPOSITION" }
    : { ok: false, code: "DOCUMENTED_HOUR_PRESUPPOSITION_REJECTED", markers: present };
}
