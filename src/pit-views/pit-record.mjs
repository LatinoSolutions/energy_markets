// Registro PIT de un dato. Fuente: SPEC v1.1.1 §6.1 (cuatro semánticas
// separadas: occurred/reference, publication/availability, policy-consumable,
// revision/version), §6.2 (revisions crean versiones nuevas; missing con razón
// preservada; proxies identificados) y §6.5 (retrieval posterior no prueba
// publicación ni consumo histórico). Cada record es una versión concreta de un
// dato; la prueba de consumo es explícita, nunca presumida. Un input sin
// consumibilidad demostrada se conserva como `unavailable` (§6.1: "si no
// existe prueba suficiente, el dato se trata como unavailable"; §25.1 IMP-06:
// "los inputs no demostrablemente consumibles siguen unavailable"), nunca se
// rechaza ni se presume consumible.

import { toUtcTimestamp } from "./time.mjs";

function normalizeUtc(value) {
  if (value === undefined || value === null) {
    return { ok: true, utc: null };
  }
  return toUtcTimestamp(value);
}

function fail(errors, field, code, message) {
  errors.push({ field, code, message });
}

export function buildPitRecord(input) {
  const errors = [];

  if (!input || typeof input !== "object") {
    return { ok: false, errors: [{ field: "record", code: "MISSING_RECORD", message: "Registro PIT ausente." }] };
  }
  if (typeof input.key !== "string" || input.key.trim().length === 0) {
    fail(errors, "key", "MISSING_KEY", "El registro no declara su clave de serie/campo.");
  }

  const occurred = normalizeUtc(input.occurredAtUtc);
  if (!occurred.ok) {
    fail(errors, "occurredAtUtc", occurred.code, "occurred/reference time debe tener zona explícita (se normaliza a UTC).");
  }
  const published = normalizeUtc(input.publishedAtUtc);
  if (!published.ok) {
    fail(errors, "publishedAtUtc", published.code, "publication/availability time debe tener zona explícita (se normaliza a UTC).");
  }

  let consumable = { ok: true, utc: null };
  let consumability;
  if (input.consumableAtUtc !== undefined && input.consumableAtUtc !== null) {
    consumable = normalizeUtc(input.consumableAtUtc);
    if (!consumable.ok) {
      fail(errors, "consumableAtUtc", consumable.code, "policy-consumable time debe tener zona explícita (se normaliza a UTC).");
    }
    consumability = "demonstrated";
  } else if (input.consumableAtAnyBoundary === true) {
    consumability = "any-boundary";
  } else {
    consumability = "unavailable";
  }

  if (typeof input.revisionId !== "string" || input.revisionId.trim().length === 0) {
    fail(errors, "revisionId", "MISSING_REVISION", "El registro no declara la versión/revision del valor.");
  }

  if (input.proxy === true && (typeof input.proxyId !== "string" || input.proxyId.trim().length === 0)) {
    fail(errors, "proxyId", "MISSING_PROXY_ID", "Un proxy debe estar identificado; no se relabela como oficial (§6.2).");
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  // §6.1: un dato no puede consumirse antes de estar disponible en origen.
  // Orden temporal incoherente es invalidez del registro, no disponibilidad.
  const consumedMs = consumable.utc === null ? null : Date.parse(consumable.utc);
  const publishedMs = published.utc === null ? null : Date.parse(published.utc);
  if (consumedMs !== null && publishedMs !== null && consumedMs < publishedMs) {
    fail(
      errors,
      "consumableAtUtc",
      "PIT_ORDER_INCOHERENT",
      "Un dato no puede ser consumible antes (o como parte) de su publicación en origen.",
    );
  }
  if (errors.length > 0) {
    return { ok: false, errors };
  }

  // Reloj de la vista decision-time: instante desde el que esta versión es
  // consumible para la policy. Con consumo demostrado es consumableAtUtc; con
  // consumableAtAnyBoundary es su publicación (no puede consumirse antes de
  // existir); unavailable no tiene reloj: no entra en ninguna decisión.
  const consumableFromUtc = consumable.utc
    ?? (consumability === "any-boundary" ? published.utc : null);

  const record = {
    key: input.key,
    occurredAtUtc: occurred.utc,
    publishedAtUtc: published.utc,
    consumableAtUtc: consumable.utc,
    consumableAtAnyBoundary: input.consumableAtAnyBoundary === true,
    consumability,
    consumableFromUtc,
    revisionId: input.revisionId,
    revisionOf: input.revisionOf ?? null,
    proxy: input.proxy === true,
    proxyId: input.proxyId ?? null,
  };
  if (input.value !== undefined) {
    record.value = input.value;
  }
  if (typeof input.reason === "string" && input.reason.length > 0) {
    record.reason = input.reason;
  }
  return { ok: true, record };
}

// Prueba de consumo en un boundary (§6.1: sólo se expone información cuyo
// consumo real en ese momento pueda demostrarse).
export function isConsumableAtBoundary(record, boundaryUtc) {
  if (!record || typeof boundaryUtc !== "string") {
    return { consumable: false, reason: "registro o boundary ausente" };
  }
  const boundary = Date.parse(boundaryUtc);
  if (!Number.isFinite(boundary)) {
    return { consumable: false, reason: "boundary no parseable" };
  }
  if (record.consumableAtAnyBoundary === true) {
    return { consumable: true, reason: null };
  }
  if (record.consumableAtUtc === null) {
    return { consumable: false, reason: "consumo no demostrado (§6.1)" };
  }
  const consumable = Date.parse(record.consumableAtUtc);
  if (consumable > boundary) {
    return { consumable: false, reason: "aún no consumible en este boundary" };
  }
  return { consumable: true, reason: null };
}

// Cuatro semánticas expuestas para verificación separada (§19.2).
export function semanticsOf(record) {
  return {
    occurredAtUtc: record?.occurredAtUtc ?? null,
    publishedAtUtc: record?.publishedAtUtc ?? null,
    consumableAtUtc: record?.consumableAtUtc ?? null,
    revisionId: record?.revisionId ?? null,
  };
}
