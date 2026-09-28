// BT-08: adaptación fail-closed de las cuatro fuentes Development de un job de
// hipótesis (hallazgo BT08-T04 de la revisión 2026-09-28). Antes el child
// consumía los JSON crudos sin atarlos a un formato de productor; este módulo
// es el contrato productor→motor: cada documento declara su artifactKind, su
// provenance (authority/locator/sourceHash) y sus campos obligatorios. Lo usa
// el child al correr y la readiness read-only del runner. No inventa campos ni
// valores: lo ausente o mal atado queda bloqueado con código y mensaje en
// inglés (los códigos son los mismos del gate de inputs de
// development-episode.mjs o INPUT_-prefijados).
import { MISSIONS as SEM_MISSIONS, MISSION_LABELS } from "../backtesting-semantics/contract.mjs";

export const DEVELOPMENT_INPUT_KINDS = Object.freeze({
  availability: "HYPOTHESIS_DEVELOPMENT_AVAILABILITY",
  observations: "HYPOTHESIS_DEVELOPMENT_OBSERVATIONS",
  benchmark: "HYPOTHESIS_DEVELOPMENT_BENCHMARK",
  deliveryHours: "HYPOTHESIS_DEVELOPMENT_DELIVERY_HOURS",
});

const isHash = (value) => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const isNonEmptyString = (value) => typeof value === "string" && value.trim().length > 0;

function docBlocker(code, message, field = null) {
  return { ok: false, code, message, ...(field ? { field } : {}) };
}

// Provenance a nivel de documento que el productor obliga a declarar.
function docProvenanceBlocker(document, name) {
  if (!document || typeof document !== "object" || Array.isArray(document)) {
    return docBlocker("INPUT_PROVENANCE_INVALID", `${name} is not a producer document`);
  }
  const provenance = document.provenance;
  if (!provenance || typeof provenance !== "object"
    || !isNonEmptyString(provenance.authority) || !isNonEmptyString(provenance.locator)) {
    return docBlocker("INPUT_PROVENANCE_INVALID", `${name} must declare provenance with authority and locator`);
  }
  if (!isHash(document.sourceHash)) {
    return docBlocker("INPUT_PROVENANCE_INVALID", `${name} must declare a sha256 sourceHash`);
  }
  return null;
}

function ownKeysOf(value, keys) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value).every((key) => keys.includes(key));
}

// availability.json → session + filas de disponibilidad de la misión.
export function adaptAvailabilitySource(document, missionId) {
  const label = MISSION_LABELS[missionId] ?? null;
  if (label === null) return { ok: false, blockers: [docBlocker("UNKNOWN_MISSION", `"${String(missionId)}" is not a canonical mission`)] };
  const blocker = (code, message, field = null) => ({ ok: false, blockers: [docBlocker(code, message, field)] });
  if (document?.artifactKind !== DEVELOPMENT_INPUT_KINDS.availability) {
    return blocker("SOURCE_ARTIFACT_INVALID", `the availability document is not ${DEVELOPMENT_INPUT_KINDS.availability}`);
  }
  if (document.mission !== label) {
    return blocker("SOURCE_ARTIFACT_INVALID", `the availability document does not belong to mission ${label}`);
  }
  const provenance = docProvenanceBlocker(document, "availability");
  if (provenance) return blocker(provenance.code, provenance.message);
  const session = document.session;
  if (!ownKeysOf(session, ["mission", "zone", "anchors", "sourceHash"]) || session.mission !== label
    || !isNonEmptyString(session.zone) || !Array.isArray(session.anchors) || session.anchors.length === 0
    || !session.anchors.every((anchor) => /^\d{2}:\d{2}$/.test(anchor)) || !isHash(session.sourceHash)) {
    return blocker("SOURCE_ARTIFACT_INVALID", "the availability document does not declare a usable market session schedule");
  }
  if (!Array.isArray(document.availability) || document.availability.length === 0
    || document.availability.some((row) => !ownKeysOf(row, ["mission", "atUtc", "sessionDate", "anchor", "available", "pitAvailableAtUtc", "sourceHash"]))) {
    return blocker("SOURCE_ARTIFACT_INVALID", "the availability rows do not match the producer row format");
  }
  return { ok: true, session, availability: document.availability };
}

// observations.json → filas de precio de decisión con evidencia TOB.
export function adaptObservationsSource(document, missionId) {
  const blocker = (code, message) => ({ ok: false, blockers: [docBlocker(code, message)] });
  if (document?.artifactKind !== DEVELOPMENT_INPUT_KINDS.observations) {
    return blocker("SOURCE_ARTIFACT_INVALID", `the observations document is not ${DEVELOPMENT_INPUT_KINDS.observations}`);
  }
  const provenance = docProvenanceBlocker(document, "observations");
  if (provenance) return blocker(provenance.code, provenance.message);
  if (!Array.isArray(document.observations) || document.observations.length === 0
    || document.observations.some((row) => !ownKeysOf(row, ["date", "price", "bestAskEurMwh", "bestAskVolumeMw", "availableAtUtc", "sourceHash"]))) {
    return blocker("SOURCE_ARTIFACT_INVALID", "the observation rows do not match the producer row format");
  }
  return { ok: true, observations: document.observations };
}

// benchmark.json → identidad BENCHMARK atada a campaña y ventana de misión.
export function adaptBenchmarkSource(document, missionId) {
  const blocker = (code, message) => ({ ok: false, blockers: [docBlocker(code, message)] });
  if (document?.artifactKind !== DEVELOPMENT_INPUT_KINDS.benchmark) {
    return blocker("SOURCE_ARTIFACT_INVALID", `the benchmark document is not ${DEVELOPMENT_INPUT_KINDS.benchmark}`);
  }
  const provenance = docProvenanceBlocker(document, "benchmark");
  if (provenance) return blocker(provenance.code, provenance.message);
  if (!ownKeysOf(document, ["artifactKind", "identity", "version", "status", "value", "unit", "artifactSha256", "sourceHash", "campaignId", "obligationId", "window", "provenance"])) {
    return blocker("SOURCE_ARTIFACT_INVALID", "the benchmark document is missing producer fields (identity/version/status/value/unit/artifactSha256/campaignId/obligationId/window)");
  }
  const mission = SEM_MISSIONS.find((entry) => entry.id === missionId) ?? null;
  if (mission === null || document.window !== mission.benchmarkWindow) {
    return blocker("SOURCE_ARTIFACT_INVALID", `the benchmark reference window does not cover mission ${String(missionId)} (expected ${mission?.benchmarkWindow ?? "unknown"})`);
  }
  return { ok: true, benchmark: document };
}

// delivery-hours.json → evidencia de horas de entrega (MW nunca → MWh sin ella).
export function adaptDeliveryHoursSource(document) {
  const blocker = (code, message, field = null) => ({ ok: false, blockers: [docBlocker(code, message, field)] });
  if (document?.artifactKind !== DEVELOPMENT_INPUT_KINDS.deliveryHours) {
    return blocker("SOURCE_ARTIFACT_INVALID", `the delivery-hours document is not ${DEVELOPMENT_INPUT_KINDS.deliveryHours}`);
  }
  const provenance = docProvenanceBlocker(document, "deliveryHours");
  if (provenance) return blocker(provenance.code, provenance.message);
  if (document.mode === "FIXED") {
    if (typeof document.hours !== "number" || !(document.hours > 0)) {
      return blocker("SOURCE_ARTIFACT_INVALID", "a fixed delivery-hours source must declare positive hours");
    }
  } else if (document.mode === "PER_TRADING_DAY") {
    if (!document.perDay || typeof document.perDay !== "object"
      || Object.keys(document.perDay).length === 0) {
      return blocker("SOURCE_ARTIFACT_INVALID", "a per-trading-day delivery-hours source must declare perDay hours");
    }
  } else {
    return blocker("SOURCE_ARTIFACT_INVALID", 'the delivery-hours mode must be "FIXED" or "PER_TRADING_DAY"');
  }
  return { ok: true, deliveryHours: document };
}

// Adaptación completa de las cuatro fuentes de una misión. Devuelve los inputs
// normalizados para el motor, o la lista exacta de bloqueos de documento.
export function adaptDevelopmentInputs(files, missionId) {
  const blockers = [];
  for (const [name, document] of Object.entries(files ?? {})) {
    if (document === null || document === undefined) {
      blockers.push(docBlocker("SOURCE_MISSING", `no ${name} source was provided for this mission`));
    }
  }
  if (blockers.length > 0) return { ok: false, blockers };
  const availability = adaptAvailabilitySource(files.availability, missionId);
  if (!availability.ok) return { ok: false, blockers: availability.blockers };
  const observations = adaptObservationsSource(files.observations, missionId);
  if (!observations.ok) return { ok: false, blockers: observations.blockers };
  const benchmark = adaptBenchmarkSource(files.benchmark, missionId);
  if (!benchmark.ok) return { ok: false, blockers: benchmark.blockers };
  const deliveryHours = adaptDeliveryHoursSource(files.deliveryHours);
  if (!deliveryHours.ok) return { ok: false, blockers: deliveryHours.blockers };
  return {
    ok: true,
    inputs: {
      session: availability.session,
      availability: availability.availability,
      observations: observations.observations,
      benchmark: benchmark.benchmark,
      deliveryHours: deliveryHours.deliveryHours,
    },
  };
}
