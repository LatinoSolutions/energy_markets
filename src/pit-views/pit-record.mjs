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
// nuevas coberturas. Por eso una entrada del manifiesto temporal de IMP-03 (sin
// `value` ni `revisionId`) se conserva como record `unavailable` con su bloque
// `audit` íntegro (las cuatro semánticas con status/valor/razón/evidencia); no
// se rechaza por faltarle la versión ni se reduce a un MISSING genérico.
//
// §6.1/§14.2: no todo dato alimenta la decisión. El benchmark cerrado y los
// outcomes son "consumida únicamente para evaluación" (§14.2) y "permanece
// separado" (§14.3): su `viewScope` es "evaluation" y nunca entran a la
// decision-time view. `viewScope` es obligatorio: no hay default que pueda
// meter un benchmark sin declarar en la vista de decisión.

import { toUtcTimestamp } from "./time.mjs";

export const VIEW_SCOPES = ["decision", "evaluation"];

const SHA256_PATTERN = /^[0-9a-fA-F]{64}$/;

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

// §6.2: una versión no se reescribe. El record guarda una copia congelada del
// contenido; mutar el objeto del llamante después no altera el histórico.
export function deepFreeze(value) {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) {
    return value;
  }
  for (const nested of Object.values(value)) {
    deepFreeze(nested);
  }
  return Object.freeze(value);
}

// Sólo primitivos, arrays y objetos planos: Map/Set/Date guardan su contenido
// fuera de las propiedades y Object.freeze no los protege. Un ciclo no es un
// valor versionable: se rechaza en vez de desbordar la pila.
function isPlainData(value, ancestors = new Set()) {
  if (value === null || typeof value !== "object") {
    return typeof value !== "function" && typeof value !== "symbol";
  }
  if (ancestors.has(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) {
    return false;
  }
  ancestors.add(value);
  const plain = Object.values(value).every((nested) => isPlainData(nested, ancestors));
  ancestors.delete(value);
  return plain;
}

function frozenCopy(value) {
  if (!isPlainData(value)) {
    return { ok: false };
  }
  try {
    return { ok: true, copy: deepFreeze(structuredClone(value)) };
  } catch {
    return { ok: false };
  }
}

// Registro de evidencia verificada por el audit (§6.4: la auditoría verifica
// publicación y consumo; DEP-07 §25.2 IMP-06: "evidencia temporal realmente
// utilizada"). Cada entrada es una atestación: el audit `auditId` verificó que
// la versión `key`/`revisionId` era consumible en `consumableAtUtc`, con el
// artifact `source`@`locator` de hash `sha256`. Un hash de archivo solo no
// prueba el consumo de cualquier dato en cualquier instante. Acepta `path`
// porque es el campo de los artifacts auditados de IMP-03.
export function normalizeAuditedEvidence(list = []) {
  if (!Array.isArray(list)) {
    return { ok: false, errors: [{ field: "auditedEvidence", code: "INVALID_AUDITED_EVIDENCE", message: "auditedEvidence debe ser una lista." }] };
  }
  const errors = [];
  const entries = [];
  list.forEach((raw, index) => {
    const source = raw?.source ?? raw?.path;
    const consumableAt = normalizeUtc(raw?.consumableAtUtc);
    if (!isNonEmptyString(raw?.auditId) || !isNonEmptyString(source) || !isNonEmptyString(raw?.locator)
      || typeof raw?.sha256 !== "string" || !SHA256_PATTERN.test(raw.sha256)
      || !isNonEmptyString(raw?.key) || !isNonEmptyString(raw?.revisionId)
      || !consumableAt.ok || consumableAt.utc === null) {
      errors.push({
        field: `auditedEvidence[${index}]`,
        code: "INVALID_AUDITED_EVIDENCE",
        message: "La evidencia auditada requiere auditId, source/path, locator, sha256 de 64 hex, key, revisionId y consumableAtUtc con zona explícita.",
      });
      return;
    }
    const sha256 = raw.sha256.toLowerCase();
    const conflicting = entries.find((entry) => entry.source === source && entry.locator === raw.locator && entry.sha256 !== sha256);
    if (conflicting !== undefined) {
      errors.push({
        field: `auditedEvidence[${index}]`,
        code: "AUDITED_EVIDENCE_CONFLICT",
        message: `El audit declara dos hashes distintos para ${source} @ ${raw.locator}.`,
      });
      return;
    }
    entries.push({
      auditId: raw.auditId,
      source,
      locator: raw.locator,
      sha256,
      key: raw.key,
      revisionId: raw.revisionId,
      consumableAtUtc: consumableAt.utc,
    });
  });
  return errors.length > 0 ? { ok: false, errors } : { ok: true, entries };
}

// Declaraciones de proxy (§6.2: "Los proxies deben estar predeclarados,
// identificados, permitidos y ser point-in-time válidos"). La declaración la
// aporta la Candidate Policy / ledger; este módulo sólo la exige y la aplica.
// `fallbackRank` (entero >= 1, único por key) es la posición del proxy en la
// jerarquía de fallback fijada ex ante (§6.2: "su jerarquía se fija ex ante y
// no se selecciona según el resultado económico"). La fuente oficial es rango
// 0: un proxy es fallback, no se relabela como oficial ni la desplaza (§6.2).
export function normalizeProxyDeclarations(list = []) {
  if (!Array.isArray(list)) {
    return { ok: false, errors: [{ field: "proxyDeclarations", code: "INVALID_PROXY_DECLARATION", message: "proxyDeclarations debe ser una lista." }] };
  }
  const errors = [];
  const declarations = [];
  list.forEach((raw, index) => {
    const declaredAt = normalizeUtc(raw?.declaredAtUtc);
    if (!isNonEmptyString(raw?.key) || !isNonEmptyString(raw?.proxyId) || typeof raw?.allowed !== "boolean"
      || !Number.isInteger(raw?.fallbackRank) || raw.fallbackRank < 1
      || !declaredAt.ok || declaredAt.utc === null) {
      errors.push({
        field: `proxyDeclarations[${index}]`,
        code: "INVALID_PROXY_DECLARATION",
        message: "La declaración de proxy requiere key, proxyId, allowed booleano, fallbackRank entero >= 1 y declaredAtUtc con zona explícita.",
      });
      return;
    }
    if (declarations.some((entry) => entry.key === raw.key && entry.proxyId === raw.proxyId)) {
      errors.push({
        field: `proxyDeclarations[${index}]`,
        code: "DUPLICATE_PROXY_DECLARATION",
        message: `El proxy "${raw.proxyId}" de "${raw.key}" se declara más de una vez.`,
      });
      return;
    }
    if (declarations.some((entry) => entry.key === raw.key && entry.fallbackRank === raw.fallbackRank)) {
      errors.push({
        field: `proxyDeclarations[${index}]`,
        code: "DUPLICATE_FALLBACK_RANK",
        message: `Dos proxies de "${raw.key}" comparten fallbackRank ${raw.fallbackRank}; la jerarquía ex ante debe ser total (§6.2).`,
      });
      return;
    }
    declarations.push({
      key: raw.key,
      proxyId: raw.proxyId,
      allowed: raw.allowed,
      fallbackRank: raw.fallbackRank,
      declaredAtUtc: declaredAt.utc,
    });
  });
  return errors.length > 0 ? { ok: false, errors } : { ok: true, declarations };
}

export function buildPitRecord(input, { auditedEvidence = [], proxyDeclarations = [] } = {}) {
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
  let valueCopy = null;
  if (valuePresent) {
    const copied = frozenCopy(input.value);
    if (copied.ok) {
      valueCopy = copied.copy;
    } else {
      fail(errors, "value", "INVALID_VALUE", "El valor debe ser dato plano (primitivos, arrays, objetos planos) para conservarse como versión inmutable (§6.2).");
    }
  }

  // Resultado auditado de IMP-03 (§25.2 IMP-06): se conserva íntegro y
  // congelado. Sólo lo produce el adaptador del manifiesto auditado.
  let audit = null;
  if (input.audit !== undefined && input.audit !== null) {
    const copied = typeof input.audit === "object" ? frozenCopy(input.audit) : { ok: false };
    if (copied.ok && copied.copy.semantics && typeof copied.copy.semantics === "object") {
      audit = copied.copy;
    } else {
      fail(errors, "audit", "INVALID_AUDIT_BLOCK", "El bloque audit debe ser un objeto serializable con sus semánticas auditadas.");
    }
  }

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
  // para Replay". El módulo valida la forma de la referencia y la vincula con
  // la atestación del audit (§6.4) más abajo; no inspecciona el artifact.
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
  const evidenceRegistry = normalizeAuditedEvidence(auditedEvidence);
  if (!evidenceRegistry.ok) {
    errors.push(...evidenceRegistry.errors);
  }
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
      consumableEvidence = { source: evidence.source, locator: evidence.locator, auditLinked: false, auditId: null };
      if (evidence.sha256 !== undefined && evidence.sha256 !== null) {
        consumableEvidence.sha256 = evidence.sha256.toLowerCase();
      }
    }
  }

  // Vínculo con el audit (§6.4, DEP-07): source+locator sólo son la dirección
  // de la evidencia; lo que la acredita es una atestación del audit para esta
  // misma versión (key, revisionId), este mismo instante de consumo y el mismo
  // hash. Sin atestación el consumo no está demostrado (unavailable, §6.1);
  // con atestación y hash distinto es evidencia adulterada: se rechaza.
  if (consumableEvidence !== null && evidenceRegistry.ok && consumable.ok) {
    const audited = evidenceRegistry.entries.find(
      (entry) => entry.source === consumableEvidence.source
        && entry.locator === consumableEvidence.locator
        && entry.key === input.key
        && entry.revisionId === revisionId
        && entry.consumableAtUtc === consumable.utc,
    );
    if (audited !== undefined && consumableEvidence.sha256 !== undefined && consumableEvidence.sha256 !== audited.sha256) {
      fail(
        errors,
        "consumableEvidence",
        "EVIDENCE_HASH_MISMATCH",
        `El hash de la evidencia de consumo no coincide con el verificado por el audit ${audited.auditId} (§6.4).`,
      );
    } else if (audited !== undefined && consumableEvidence.sha256 === audited.sha256) {
      consumableEvidence.auditLinked = true;
      consumableEvidence.auditId = audited.auditId;
    }
  }

  // §6.2: "Los proxies deben estar predeclarados, identificados, permitidos y
  // ser point-in-time válidos". Un proxyId suelto no identifica nada: debe
  // existir una declaración para este key. Si la declaración lo permite y en
  // qué instante se declaró se evalúa por boundary en la decision view.
  const proxyRegistry = normalizeProxyDeclarations(proxyDeclarations);
  if (!proxyRegistry.ok) {
    errors.push(...proxyRegistry.errors);
  }
  let proxyDeclaration = null;
  if (input.proxy === true && !isNonEmptyString(input.proxyId)) {
    fail(errors, "proxyId", "MISSING_PROXY_ID", "Un proxy debe estar identificado; no se relabela como oficial (§6.2).");
  } else if (input.proxy === true && proxyRegistry.ok) {
    const declared = proxyRegistry.declarations.find(
      (entry) => entry.key === input.key && entry.proxyId === input.proxyId,
    );
    if (declared === undefined) {
      fail(errors, "proxyId", "PROXY_NOT_DECLARED", `El proxy "${input.proxyId}" no está predeclarado para "${input.key}" (§6.2).`);
    } else {
      proxyDeclaration = { allowed: declared.allowed, fallbackRank: declared.fallbackRank, declaredAtUtc: declared.declaredAtUtc };
    }
  }
  if (input.proxy !== true && input.proxyId !== undefined && input.proxyId !== null) {
    fail(errors, "proxyId", "PROXY_ID_WITHOUT_PROXY", "Un proxyId exige proxy: true; no se mezcla un dato proxy con uno oficial (§6.2).");
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

  // Consumo demostrado exige las piezas de §6.1: valor presente, publicación
  // en origen, timestamp de consumo y evidencia contemporánea vinculada al
  // audit por hash (§6.4). Sin cualquiera de las piezas, unavailable.
  const evidenceLinked = consumableEvidence !== null && consumableEvidence.auditLinked === true;
  const consumability = valuePresent && published.utc !== null && consumable.utc !== null && evidenceLinked
    ? "demonstrated"
    : "unavailable";

  // Reloj de la vista decision-time: instante desde el que esta versión es
  // consumible para la policy. Sin consumo demostrado no hay reloj de decisión.
  const consumableFromUtc = consumability === "demonstrated" ? consumable.utc : null;

  // Sin valor materializado, el status distingue "el audit observó contenido
  // (OBSERVED/PARTIAL) sin fila PIT versionada" de "no hay nada" (§6.2, §6.5).
  // Ninguno de los dos es consumible.
  const auditObserved = audit !== null
    && Object.values(audit.semantics).some((semantic) => semantic?.status === "OBSERVED" || semantic?.status === "PARTIAL");
  let valueStatus = "MISSING";
  if (valuePresent) {
    valueStatus = "PRESENT";
  } else if (auditObserved) {
    valueStatus = "AUDIT_OBSERVED";
  }

  const record = {
    key: input.key,
    viewScope,
    occurredAtUtc: occurred.utc,
    publishedAtUtc: published.utc,
    consumableAtUtc: consumable.utc,
    consumableEvidence,
    consumability,
    consumableFromUtc,
    valueStatus,
    revisionId,
    revisionOf,
    proxy: input.proxy === true,
    proxyId: input.proxyId ?? null,
    proxyDeclaration,
  };
  if (valuePresent) {
    record.value = valueCopy;
  }
  if (typeof input.reason === "string" && input.reason.length > 0) {
    record.reason = input.reason;
  }
  if (audit !== null) {
    record.audit = audit;
  }
  return { ok: true, record: deepFreeze(record) };
}

// Proxy admisible en la decision view de un boundary (§6.2): declarado,
// permitido y declarado antes o en el boundary (predeclarado ex ante). Un
// record no-proxy es siempre admisible. Un proxy sin declaración adjunta
// (manifest armado a mano) no es admisible.
export function isProxyAdmissibleAtBoundary(record, boundaryUtc) {
  if (record?.proxy !== true) {
    return { admissible: true, reason: null };
  }
  const declaration = record.proxyDeclaration;
  if (!declaration || typeof declaration.declaredAtUtc !== "string") {
    return { admissible: false, reason: "proxy sin declaración previa (§6.2)" };
  }
  // Primero el instante: una declaración posterior al boundary no existe en
  // él, así que su contenido (permitido o no) no puede afectar la respuesta.
  if (Date.parse(declaration.declaredAtUtc) > Date.parse(boundaryUtc)) {
    return { admissible: false, reason: "proxy no predeclarado en este boundary (§6.2)" };
  }
  if (declaration.allowed !== true) {
    return { admissible: false, reason: "proxy declarado pero no permitido (§6.2)" };
  }
  return { admissible: true, reason: null };
}

// Posición en la jerarquía de fuentes fijada ex ante (§6.2): oficial = 0,
// proxy = fallbackRank de su declaración. Menor rango = preferido.
export function sourceRankOf(record) {
  if (record?.proxy !== true) {
    return 0;
  }
  return record.proxyDeclaration?.fallbackRank ?? Number.POSITIVE_INFINITY;
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
  if (record.valueStatus === "AUDIT_OBSERVED") {
    return { consumable: false, reason: "observado por el audit sin versión PIT materializada; no consumible (§6.1/§6.5)" };
  }
  if (record.valueStatus !== "PRESENT") {
    return { consumable: false, reason: "valor ausente; faltante explícito (§6.2)" };
  }
  if (record.publishedAtUtc === null) {
    return { consumable: false, reason: "sin publicación en origen; disponibilidad no demostrada (§6.1)" };
  }
  if (Date.parse(record.publishedAtUtc) > boundary) {
    return { consumable: false, reason: "no publicado en este boundary (§6.1)" };
  }
  if (record.consumableAtUtc === null) {
    return { consumable: false, reason: "consumo no demostrado (§6.1)" };
  }
  // Consumo posterior al boundary: la razón no distingue "llegará a ser
  // consumible" de "nunca demostrado", ni mira la evidencia de ese consumo
  // futuro; la respuesta en un boundary histórico sólo depende de hechos
  // anteriores a él (§6.1, §14.7).
  if (Date.parse(record.consumableAtUtc) > boundary) {
    return { consumable: false, reason: "consumo no demostrado en este boundary (§6.1)" };
  }
  if (record.consumableEvidence === null || record.consumableEvidence === undefined) {
    return { consumable: false, reason: "consumo sin evidencia contemporánea verificable; no demostrado (§6.1)" };
  }
  if (record.consumableEvidence.auditLinked !== true) {
    return { consumable: false, reason: "evidencia de consumo sin vínculo comprobado con el audit (hash); no demostrado (§6.1/§6.4)" };
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
