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
//
// §25.2 IMP-06: el módulo materializa los resultados auditados sin declarar
// nuevas coberturas. Por eso un input auditado MISSING (sin `value` y con
// `revisionId` MISSING, como las entradas del manifiesto temporal de IMP-03)
// se conserva como record `unavailable`; no se rechaza por faltarle la versión.
//
// §6.1/§14.2: no todo dato alimenta la decisión. El benchmark cerrado y los
// outcomes son "consumida únicamente para evaluación" (§14.2) y "permanece
// separado" (§14.3): su `viewScope` es "evaluation" y nunca entran a la
// decision-time view. `viewScope` es obligatorio: no hay default que pueda
// meter un benchmark sin declarar en la vista de decisión.

import { toUtcTimestamp } from "./time.mjs";

export const VIEW_SCOPES = ["decision", "evaluation"];

function normalizeUtc(value) {
  if (value === undefined || value === null) {
    return { ok: true, utc: null };
  }
  return toUtcTimestamp(value);
}

function fail(errors, field, code, message) {
  errors.push({ field, code, message });
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

export function buildPitRecord(input) {
  const errors = [];

  if (!input || typeof input !== "object") {
    return { ok: false, errors: [{ field: "record", code: "MISSING_RECORD", message: "Registro PIT ausente." }] };
  }
  if (!isNonEmptyString(input.key)) {
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

  // §14.2/§14.3: el dato declara explícitamente a qué vista alimenta. No hay
  // default: un benchmark/outcome sin declarar terminaría en la decision view,
  // justo lo que §14.3 prohíbe. La ausencia de viewScope es un error, no una
  // presunción de "decision".
  const viewScope = input.viewScope;
  if (viewScope === undefined || viewScope === null) {
    fail(errors, "viewScope", "MISSING_VIEW_SCOPE", `El registro debe declarar viewScope: ${VIEW_SCOPES.join(" o ")}.`);
  } else if (!VIEW_SCOPES.includes(viewScope)) {
    fail(errors, "viewScope", "INVALID_VIEW_SCOPE", `viewScope debe ser uno de: ${VIEW_SCOPES.join(", ")}.`);
  }

  // §6.2: missing nunca se inventa. Un `value` ausente/null se conserva como
  // faltante explícito en vez de exponerse como valor indefinido.
  const valuePresent = input.value !== undefined && input.value !== null;

  // §6.1: la versión concreta del valor. Un valor presente exige versión; una
  // entrada auditada MISSING puede no tenerla y se conserva como unavailable.
  let revisionId = null;
  if (input.revisionId !== undefined && input.revisionId !== null) {
    if (typeof input.revisionId !== "string") {
      fail(errors, "revisionId", "INVALID_REVISION", "revisionId debe ser una identidad de versión no vacía.");
    } else if (input.revisionId.trim().length > 0) {
      revisionId = input.revisionId;
    }
  }
  if (valuePresent && revisionId === null) {
    fail(errors, "revisionId", "MISSING_REVISION", "Un valor presente requiere declarar su versión/revision.");
  }

  const revisionOf = input.revisionOf ?? null;
  if (revisionOf !== null && !isNonEmptyString(revisionOf)) {
    fail(errors, "revisionOf", "INVALID_REVISION_REF", "revisionOf debe ser identidad de revisión o null.");
  }
  if (revisionId === null && revisionOf !== null) {
    fail(errors, "revisionOf", "REVISION_OF_WITHOUT_REVISION", "Una versión MISSING no puede declarar lineage.");
  }

  // §6.1: consumo demostrado únicamente con evidencia contemporánea
  // verificable (`consumableAtUtc` + `consumableEvidence`). Un timestamp de
  // consumo declarado sin evidencia que lo respalde es una afirmación suelta:
  // §6.1 "Si no existe prueba suficiente, el dato se trata como unavailable
  // para Replay". El módulo exige que la referencia de evidencia exista y esté
  // bien formada; verificar su contenido es trabajo del audit (§6.4).
  if (input.consumableAtAnyBoundary === true) {
    fail(
      errors,
      "consumableAtAnyBoundary",
      "UNSUPPORTED_CONSUMABILITY",
      "La consumibilidad debe demostrarse con consumableAtUtc; no se acepta consumo genérico en todo boundary (§6.1).",
    );
  }
  let consumable = { ok: true, utc: null };
  if (input.consumableAtUtc !== undefined && input.consumableAtUtc !== null) {
    consumable = normalizeUtc(input.consumableAtUtc);
    if (!consumable.ok) {
      fail(errors, "consumableAtUtc", consumable.code, "policy-consumable time debe tener zona explícita (se normaliza a UTC).");
    }
  }
  const SHA256_PATTERN = /^[0-9a-fA-F]{64}$/;
  let consumableEvidence = null;
  if (input.consumableEvidence !== undefined && input.consumableEvidence !== null) {
    const evidence = input.consumableEvidence;
    const sourceOk = isNonEmptyString(evidence?.source);
    const locatorOk = isNonEmptyString(evidence?.locator);
    const shaOk = evidence?.sha256 === undefined || evidence?.sha256 === null || SHA256_PATTERN.test(evidence.sha256);
    if (!sourceOk || !locatorOk || !shaOk) {
      fail(
        errors,
        "consumableEvidence",
        "INVALID_CONSUMABLE_EVIDENCE",
        "La evidencia de consumo requiere source y locator no vacíos, y sha256 hexadecimal de 64 caracteres cuando se declara (§6.1).",
      );
    } else {
      consumableEvidence = { source: evidence.source, locator: evidence.locator };
      if (evidence.sha256 !== undefined && evidence.sha256 !== null) {
        consumableEvidence.sha256 = evidence.sha256.toLowerCase();
      }
    }
  }

  if (input.proxy === true && !isNonEmptyString(input.proxyId)) {
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

  // Consumo demostrado exige las cuatro piezas de §6.1: valor presente,
  // publicación en origen (no se puede consumir lo que nunca se publicó),
  // timestamp de consumo y evidencia contemporánea verificable de ese consumo.
  // El timestamp sin evidencia no demuestra nada: la evidencia es la prueba,
  // el timestamp es sólo su instante. Sin cualquiera de las piezas, unavailable.
  const consumability = valuePresent && published.utc !== null && consumable.utc !== null && consumableEvidence !== null
    ? "demonstrated"
    : "unavailable";

  // Reloj de la vista decision-time: instante desde el que esta versión es
  // consumible para la policy. Sin consumo demostrado no hay reloj de decisión.
  const consumableFromUtc = consumability === "demonstrated" ? consumable.utc : null;

  const record = {
    key: input.key,
    viewScope,
    occurredAtUtc: occurred.utc,
    publishedAtUtc: published.utc,
    consumableAtUtc: consumable.utc,
    consumableEvidence,
    consumability,
    consumableFromUtc,
    valueStatus: valuePresent ? "PRESENT" : "MISSING",
    revisionId,
    revisionOf,
    proxy: input.proxy === true,
    proxyId: input.proxyId ?? null,
  };
  if (valuePresent) {
    record.value = input.value;
  }
  if (typeof input.reason === "string" && input.reason.length > 0) {
    record.reason = input.reason;
  }
  // Procedencia de audit (§6.2): una aserción histórica declarada por el
  // manifiesto auditado viaja con el record para no perder trazabilidad. No es
  // un timestamp ni un valor: se conserva tal cual para lectura/verificación.
  if (input.historicalAssertion && typeof input.historicalAssertion === "object"
    && isNonEmptyString(input.historicalAssertion.assertion)) {
    record.historicalAssertion = {
      assertion: input.historicalAssertion.assertion,
      semantic: input.historicalAssertion.semantic ?? null,
      specLocator: input.historicalAssertion.specLocator ?? null,
      evidence: input.historicalAssertion.evidence ?? null,
    };
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
  if (record.valueStatus === "MISSING") {
    return { consumable: false, reason: "valor ausente; faltante explícito (§6.2)" };
  }
  if (record.publishedAtUtc === null) {
    return { consumable: false, reason: "sin publicación en origen; disponibilidad no demostrada (§6.1)" };
  }
  if (record.consumableAtUtc === null) {
    return { consumable: false, reason: "consumo no demostrado (§6.1)" };
  }
  if (record.consumableEvidence === null) {
    return { consumable: false, reason: "consumo sin evidencia contemporánea verificable; no demostrado (§6.1)" };
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
    consumableEvidence: record?.consumableEvidence ?? null,
    revisionId: record?.revisionId ?? null,
  };
}
