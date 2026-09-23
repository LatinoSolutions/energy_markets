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

import { createHash } from "node:crypto";

import {
  deepFreeze,
  DEFAULT_REPO_ROOT,
  dep0607AuditRegistration,
  dep0607EvidenceRegistration,
  trustRootNotConfigurable,
  verifyAcceptedArtifactAt,
} from "./audited-artifacts.mjs";
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
export { deepFreeze };

// Sólo dato JSON: null, boolean, string, número finito, arrays y objetos
// planos. Map/Set/Date guardan su contenido fuera de las propiedades y
// Object.freeze no los protege. Un ciclo no es un valor versionable: se
// rechaza en vez de desbordar la pila. NaN/±Infinity (y undefined/bigint) no
// son JSON: JSON.stringify los convierte en null u omite, así que el hash
// canónico y la vista mostrarían otro dato (review IMP-06 2026-09-23, P-001
// punto 3 de Bru).
function isPlainData(value, ancestors = new Set()) {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return true;
  }
  if (typeof value === "number") {
    return Number.isFinite(value);
  }
  if (typeof value !== "object") {
    return false;
  }
  if (ancestors.has(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) {
    return false;
  }
  // Un array con huecos o con propiedades que no son índices no es JSON: el
  // hash canónico (value.map) no vería esas propiedades y la vista sí.
  if (Array.isArray(value)) {
    const keys = Object.keys(value);
    if (keys.length !== value.length || !keys.every((name, index) => name === String(index))) {
      return false;
    }
  }
  ancestors.add(value);
  const plain = Object.values(value).every((nested) => isPlainData(nested, ancestors));
  ancestors.delete(value);
  return plain;
}

function containsNonFiniteNumber(value, ancestors = new Set()) {
  if (typeof value === "number") {
    return !Number.isFinite(value);
  }
  if (value === null || typeof value !== "object" || ancestors.has(value)) {
    return false;
  }
  ancestors.add(value);
  const found = Object.values(value).some((nested) => containsNonFiniteNumber(nested, ancestors));
  ancestors.delete(value);
  return found;
}

// Hash canónico del valor de una versión: JSON con claves de objeto ordenadas
// (orden de code units), sin espacios, UTF-8, sha256 hex. Es lo que una
// atestación auditada firma como `valueSha256`: vincula el valor consumido con
// su evidencia (P-001 punto 2 de Bru, 2026-09-23).
// PLACEHOLDER de contrato (no canónico): la SPEC v1.1.1 no fija una
// serialización canónica; ésta es la asumida hasta que un audit la fije.
function canonicalJson(value) {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    const members = Object.keys(value).sort().map((name) => `${JSON.stringify(name)}:${canonicalJson(value[name])}`);
    return `{${members.join(",")}}`;
  }
  return JSON.stringify(value);
}

export function canonicalValueSha256(value) {
  if (value === undefined || !isPlainData(value)) {
    return { ok: false, code: "INVALID_VALUE" };
  }
  return { ok: true, sha256: createHash("sha256").update(canonicalJson(value), "utf8").digest("hex") };
}

// Se valida el original (structuredClone borra prototipos de clase) y
// también la copia, que es lo que se guarda: un getter del llamante no puede
// devolver un dato al validar y otro al copiar.
function snapshotOf(value) {
  if (!isPlainData(value)) {
    return { ok: false };
  }
  let copy;
  try {
    copy = structuredClone(value);
  } catch {
    return { ok: false };
  }
  return isPlainData(copy) ? { ok: true, copy } : { ok: false };
}

function frozenCopy(value) {
  const snapshot = snapshotOf(value);
  return snapshot.ok ? { ok: true, copy: deepFreeze(snapshot.copy) } : { ok: false };
}

// Registros de atestaciones verificadas por un audit (§6.4: la auditoría
// verifica publicación y consumo; DEP-07 §25.2 IMP-06: "evidencia temporal
// realmente utilizada"; §25.2: cada claim con "source/evidence y receipt
// aceptado"). Dos clases:
//  - PIT_VALUE_ATTESTATIONS (procedencia): el audit `auditId` verificó que la
//    versión `key`/`revisionId` (que revisa `revisionOf`) tiene el valor de
//    hash canónico `valueSha256`, publicado en `publishedAtUtc` y, si es una
//    revisión con receipt, efectiva en `revisionEffectiveAtUtc`; evidencia en
//    `source`@`locator` de hash `sha256`. Sin ella ningún valor es consumible
//    ni se usa en evaluación (P-001 punto 1 de Bru, 2026-09-23).
//  - PIT_CONSUMPTION_ATTESTATIONS (consumo): el audit verificó que el valor
//    `valueSha256` de `key`/`revisionId` era consumible en `consumableAtUtc`.
// `valueSha256` ata la atestación al dato: no se reutiliza para presentar
// otro valor con la misma key/revisión (P-001 punto 2 de Bru, 2026-09-23).
//
// Las atestaciones NO las aporta el llamante en memoria: se leen de artifacts
// verificados en disco contra un IMP_RECEIPT aceptado (verifyAcceptedArtifact).
// El registro resultante lleva una marca privada; buildPitRecord sólo acepta
// registros con esa marca, así que una lista armada a mano (auditId "FAKE")
// no demuestra nada.
//
// PLACEHOLDER de contrato (no canónico): la SPEC no fija el formato de estos
// artifacts. Forma asumida:
//   { artifactKind: "PIT_VALUE_ATTESTATIONS", auditId, scope, attestations: [{ key,
//     revisionId, revisionOf|null, valueSha256, publishedAtUtc,
//     revisionEffectiveAtUtc|null, source|path, locator, sha256 }] }
//   { artifactKind: "PIT_CONSUMPTION_ATTESTATIONS", auditId, scope, attestations:
//     [{ key, revisionId, valueSha256, consumableAtUtc, source|path, locator, sha256 }] }
// Además del receipt aceptado, el artifact debe estar acreditado como evidencia
// DEP-06/07 del scope y keys que atesta (dep0607EvidenceRegistration).
// Quién los produce: DEP-06/07 del audit IMP-03 (§25.2.2 fila IMP-03
// "Produce DEP-06/07"; fila IMP-06 "Consume DEP-06/07 ... Los inputs no
// demostrablemente consumibles siguen unavailable"). Hoy no existen: ver
// PER_VERSION_EVIDENCE_DEPENDENCY.
const VERIFIED_EVIDENCE_REGISTRIES = new WeakSet();
const VERIFIED_VALUE_REGISTRIES = new WeakSet();

// Dependencia técnica explícita (P-001 punto 4 de Bru, 2026-09-23). Estado
// verificado en el repo el 2026-09-23: IMP-03 aceptado sólo como "negative
// audit only" (operations/receipts/IMP-03-IMP_RECEIPT.json); ST-03.3
// (operations/audit/IMP-03/EEX-THE-20260921/ST-03.3/ST_RECEIPT.json) sigue
// `in_review`, los claims DEP-06 y DEP-07 del IMP_RECEIPT de IMP-03 tienen
// result "unresolved", y el temporal-manifest de ST-03.3 marca publicationSourceAvailabilityTime
// MISSING y policyConsumableTime MISSING/NOT_DEMONSTRATED en R-01..R-17. Hasta
// que un receipt aceptado registre atestaciones por versión, todo valor queda
// unavailable en ambas vistas.
export const PER_VERSION_EVIDENCE_DEPENDENCY = Object.freeze({
  dependency: "DEP-06/07",
  producer: "IMP-03",
  consumer: "IMP-06",
  artifacts: Object.freeze(["PIT_VALUE_ATTESTATIONS", "PIT_CONSUMPTION_ATTESTATIONS"]),
  source: "SPEC v1.1.1 §6.1, §6.4, §24 DEP-07, §25.2.2 filas IMP-03 e IMP-06",
  status: "not_produced: ST-03.3 in_review; IMP-03 aceptado sólo como negative audit (claims DEP-06/07 unresolved)",
});

const ATTESTATION_KINDS = {
  PIT_CONSUMPTION_ATTESTATIONS: {
    timeField: "consumableAtUtc",
    required: "source/path, locator, sha256 de 64 hex, key, revisionId, valueSha256 de 64 hex y consumableAtUtc con zona explícita",
  },
  PIT_VALUE_ATTESTATIONS: {
    timeField: "publishedAtUtc",
    required: "source/path, locator, sha256 de 64 hex, key, revisionId, revisionOf (string o null), valueSha256 de 64 hex, publishedAtUtc y revisionEffectiveAtUtc (o null) con zona explícita",
  },
};

function isSha256(value) {
  return typeof value === "string" && SHA256_PATTERN.test(value);
}

function normalizeAttestation(raw, kind) {
  const source = raw?.source ?? raw?.path;
  const time = normalizeUtc(raw?.[ATTESTATION_KINDS[kind].timeField]);
  if (!isNonEmptyString(source) || !isNonEmptyString(raw?.locator) || !isSha256(raw?.sha256)
    || !isNonEmptyString(raw?.key) || !isNonEmptyString(raw?.revisionId) || !isSha256(raw?.valueSha256)
    || !time.ok || time.utc === null) {
    return null;
  }
  const entry = {
    source,
    locator: raw.locator,
    sha256: raw.sha256.toLowerCase(),
    key: raw.key,
    revisionId: raw.revisionId,
    valueSha256: raw.valueSha256.toLowerCase(),
  };
  if (kind === "PIT_CONSUMPTION_ATTESTATIONS") {
    return { ...entry, consumableAtUtc: time.utc };
  }
  const revisionOf = raw.revisionOf ?? null;
  const effective = normalizeUtc(raw.revisionEffectiveAtUtc);
  if ((revisionOf !== null && !isNonEmptyString(revisionOf)) || !effective.ok) {
    return null;
  }
  return { ...entry, revisionOf, publishedAtUtc: time.utc, revisionEffectiveAtUtc: effective.utc };
}

// Dos atestaciones con el mismo source@locator y hashes distintos, o dos
// procedencias con valor distinto para la misma versión, son doble verdad.
function conflictOf(entries, entry, kind) {
  const sameEvidence = entries.find((prior) => prior.source === entry.source && prior.locator === entry.locator && prior.sha256 !== entry.sha256);
  if (sameEvidence !== undefined) {
    return { code: "AUDITED_EVIDENCE_CONFLICT", message: `Se declaran dos hashes distintos para ${entry.source} @ ${entry.locator}.` };
  }
  if (kind === "PIT_CONSUMPTION_ATTESTATIONS") {
    const otherValue = entries.find((prior) => prior.key === entry.key && prior.revisionId === entry.revisionId && prior.valueSha256 !== entry.valueSha256);
    if (otherValue !== undefined) {
      return { code: "AUDITED_VALUE_CONFLICT", message: `Se atesta el consumo de dos valores distintos para la versión "${entry.revisionId}" de "${entry.key}"; una versión tiene un único valor (§6.2).` };
    }
    return null;
  }
  const sameVersion = entries.find((prior) => prior.key === entry.key && prior.revisionId === entry.revisionId);
  if (sameVersion !== undefined) {
    return { code: "AUDITED_VALUE_CONFLICT", message: `La versión "${entry.revisionId}" de "${entry.key}" tiene más de una procedencia atestada; una versión tiene un único valor (§6.2).` };
  }
  return null;
}

function loadAttestationsAt(trustRoot, refs, kind, marks) {
  const refsField = kind === "PIT_VALUE_ATTESTATIONS" ? "valueAttestationRefs" : "consumptionAttestationRefs";
  if (!Array.isArray(refs)) {
    return { ok: false, errors: [{ field: refsField, code: "INVALID_AUDITED_EVIDENCE", message: `${refsField} debe ser una lista.` }] };
  }
  const errors = [];
  const entries = [];
  refs.forEach((ref, refIndex) => {
    const field = `${refsField}[${refIndex}]`;
    const verified = verifyAcceptedArtifactAt(trustRoot, ref);
    if (!verified.ok) {
      errors.push(...verified.errors.map((e) => ({ ...e, field })));
      return;
    }
    const { artifact, provenance } = verified;
    if (artifact?.artifactKind !== kind || !isNonEmptyString(artifact?.auditId)) {
      errors.push({ field, code: "INVALID_ATTESTATION_ARTIFACT", message: `"${provenance.path}" no es un artifact ${kind} con auditId.` });
      return;
    }
    if (!Array.isArray(artifact.attestations)) {
      errors.push({ field: `${field}.attestations`, code: "INVALID_AUDITED_EVIDENCE", message: "attestations debe ser una lista." });
      return;
    }
    // §25.2.1/§25.2.2: el artifact vale como evidencia DEP-06/07 sólo si el
    // receipt aceptado de IMP-03 lo acredita para su scope y sus keys.
    const attestedKeys = [...new Set(artifact.attestations.map((raw) => raw?.key))];
    const accreditation = dep0607EvidenceRegistration(provenance, { scope: artifact.scope, keys: attestedKeys }, field);
    if (!accreditation.ok) {
      errors.push(...accreditation.errors);
      return;
    }
    const { registration } = accreditation;
    const attestationArtifact = {
      path: registration.path,
      sha256: registration.sha256,
      receiptPath: registration.receiptPath,
      impIdentity: registration.impIdentity,
      acceptedAtUtc: registration.acceptedAtUtc,
      dependency: "DEP-06/07",
      scope: artifact.scope,
    };
    artifact.attestations.forEach((raw, index) => {
      const entryField = `${field}.attestations[${index}]`;
      const normalized = normalizeAttestation(raw, kind);
      if (normalized === null) {
        errors.push({ field: entryField, code: "INVALID_AUDITED_EVIDENCE", message: `La atestación requiere ${ATTESTATION_KINDS[kind].required}.` });
        return;
      }
      const entry = { auditId: artifact.auditId, ...normalized, attestationArtifact };
      const conflict = conflictOf(entries, entry, kind);
      if (conflict !== null) {
        errors.push({ field: entryField, ...conflict });
        return;
      }
      entries.push(entry);
    });
  });
  if (errors.length > 0) {
    return { ok: false, errors };
  }
  const registry = deepFreeze({ entries });
  marks.add(registry);
  return { ok: true, registry };
}

// Carga el registro de atestaciones de consumo desde artifacts verificados.
// `refs` = [{ path, sha256 }] relativos al repo. Sin refs, registro vacío
// (nada demostrado).
export function loadConsumptionAttestations(options = {}) {
  if (options !== null && typeof options === "object" && Object.hasOwn(options, "repoRoot")) {
    return trustRootNotConfigurable();
  }
  return loadConsumptionAttestationsAt(DEFAULT_REPO_ROOT, options ?? {});
}

// Costura de tests (ver audited-artifacts.mjs); no se exporta desde index.mjs.
export function loadConsumptionAttestationsAt(trustRoot, { refs = [] } = {}) {
  return loadAttestationsAt(trustRoot, refs, "PIT_CONSUMPTION_ATTESTATIONS", VERIFIED_EVIDENCE_REGISTRIES);
}

// Carga el registro de procedencia de valores. Sin refs, registro vacío:
// ningún valor tiene procedencia auditada.
export function loadValueAttestations(options = {}) {
  if (options !== null && typeof options === "object" && Object.hasOwn(options, "repoRoot")) {
    return trustRootNotConfigurable();
  }
  return loadValueAttestationsAt(DEFAULT_REPO_ROOT, options ?? {});
}

// Costura de tests (ver audited-artifacts.mjs); no se exporta desde index.mjs.
export function loadValueAttestationsAt(trustRoot, { refs = [] } = {}) {
  return loadAttestationsAt(trustRoot, refs, "PIT_VALUE_ATTESTATIONS", VERIFIED_VALUE_REGISTRIES);
}

export function isVerifiedValueRegistry(value) {
  return VERIFIED_VALUE_REGISTRIES.has(value);
}

export function isVerifiedEvidenceRegistry(value) {
  return VERIFIED_EVIDENCE_REGISTRIES.has(value);
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

export function buildPitRecord(input, context = {}) {
  const errors = [];
  const { evidenceRegistry = null, valueRegistry = null, proxyDeclarations = [] } = context ?? {};

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
  let valueSha256 = null;
  if (valuePresent) {
    const snapshot = snapshotOf(input.value);
    if (containsNonFiniteNumber(input.value) || (snapshot.ok && containsNonFiniteNumber(snapshot.copy))) {
      fail(errors, "value", "NON_FINITE_VALUE", "NaN, Infinity y -Infinity no son valores: se rechazan en la entrada en vez de mostrarse vigentes o serializarse como null (P-001 punto 3).");
    } else if (snapshot.ok) {
      valueCopy = deepFreeze(snapshot.copy);
      valueSha256 = canonicalValueSha256(valueCopy).sha256;
    } else {
      fail(errors, "value", "INVALID_VALUE", "El valor debe ser dato JSON (null, boolean, string, número finito, arrays sin huecos ni propiedades extra, objetos planos) para conservarse como versión inmutable (§6.2).");
    }
  }

  // Resultado auditado de IMP-03 (§25.2.2 fila IMP-06: "materializa los
  // resultados auditados"). El llamante no aporta el contenido del audit: sólo
  // la referencia { artifact: provenance de verifyAcceptedArtifact, requirementId }.
  // El bloque (semánticas, evidencia, nota) y la razón se derivan de la entrada
  // leída de disco de un manifiesto registrado por el receipt DEP-06/07 de
  // IMP-03; un bloque en memoria no puede presentarse como AUDIT_OBSERVED
  // (review IMP-06 #8, 2026-09-23).
  let audit = null;
  let auditedReason = null;
  if (input.audit !== undefined && input.audit !== null) {
    const derived = auditBlockFromVerifiedArtifact(input.audit, input.key);
    if (!derived.ok) {
      fail(errors, "audit", derived.code, derived.message);
    } else {
      audit = derived.audit;
      auditedReason = derived.reason;
    }
    if (valuePresent) {
      fail(errors, "value", "AUDIT_RECORD_WITH_VALUE", "Una entrada auditada de IMP-03 no trae valor PIT; no se le adjunta uno (§6.2/§6.5).");
    }
    if (input.reason !== undefined && input.reason !== null) {
      fail(errors, "reason", "AUDIT_REASON_FROM_CALLER", "La razón de una entrada auditada se deriva del artifact; no la aporta el llamante (§6.2).");
    }
    // Revisión 9 (2026-09-23): el resultado auditado no hereda atributos del
    // llamante. Las cuatro semánticas de la entrada viajan en el audit como
    // texto del artifact (MISSING en R-01..R-17 salvo las aserciones
    // históricas), nunca como reloj ni versión del record (§6.5: retrieval no
    // prueba publicación ni consumo histórico; §6.2: no se relabela). Un
    // record auditado nace sin ellos; un campo aportado se rechaza en vez de
    // atribuirse a la entrada en disco, porque la vista histórica lo mostraría
    // como revisión/timestamps del resultado auditado sin evidencia propia.
    const attributedFromCaller = [
      ["occurredAtUtc", input.occurredAtUtc],
      ["publishedAtUtc", input.publishedAtUtc],
      ["consumableAtUtc", input.consumableAtUtc],
      ["consumableEvidence", input.consumableEvidence],
      ["revisionId", input.revisionId],
      ["revisionOf", input.revisionOf],
    ];
    for (const [field, provided] of attributedFromCaller) {
      if (provided !== undefined && provided !== null) {
        fail(
          errors,
          field,
          "AUDIT_FIELD_FROM_CALLER",
          `La entrada auditada se materializa sólo con su bloque audit derivado del artifact; "${field}" aportado por el llamante no se atribuye al resultado auditado sin evidencia propia en el artifact (§6.2/§6.5).`,
        );
      }
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
  // una atestación cargada de un artifact con receipt aceptado (§6.4/§25.2)
  // más abajo; el artifact de datos al que apunta source@locator no se lee.
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
  // Evidencia en memoria del llamante no es evidencia auditada (§6.4/§25.2):
  // se rechaza en voz alta en vez de ignorarse, para que nadie crea que
  // acreditó un consumo.
  if (context !== null && typeof context === "object" && Object.hasOwn(context, "auditedEvidence")) {
    fail(errors, "auditedEvidence", "UNVERIFIED_AUDITED_EVIDENCE", "La evidencia de consumo se carga con loadConsumptionAttestations desde artifacts con receipt aceptado; no se acepta una lista en memoria (§25.2).");
  }
  if (evidenceRegistry !== null && !isVerifiedEvidenceRegistry(evidenceRegistry)) {
    fail(errors, "evidenceRegistry", "UNVERIFIED_AUDITED_EVIDENCE", "evidenceRegistry no proviene de loadConsumptionAttestations; no acredita consumo (§6.4/§25.2).");
  }
  if (valueRegistry !== null && !isVerifiedValueRegistry(valueRegistry)) {
    fail(errors, "valueRegistry", "UNVERIFIED_AUDITED_EVIDENCE", "valueRegistry no proviene de loadValueAttestations; no acredita procedencia (§25.2).");
  }
  const attestations = evidenceRegistry !== null && isVerifiedEvidenceRegistry(evidenceRegistry) ? evidenceRegistry.entries : [];
  const valueAttestations = valueRegistry !== null && isVerifiedValueRegistry(valueRegistry) ? valueRegistry.entries : [];
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
      consumableEvidence = { source: evidence.source, locator: evidence.locator, auditLinked: false, auditId: null, attestationArtifact: null };
      if (evidence.sha256 !== undefined && evidence.sha256 !== null) {
        consumableEvidence.sha256 = evidence.sha256.toLowerCase();
      }
    }
  }

  // Procedencia del valor (P-001 puntos 1 y 2 de Bru, 2026-09-23; §25.2
  // "source/evidence y receipt aceptado"): la versión (key, revisionId) debe
  // tener una atestación de valor cuyo valueSha256, revisionOf y publicación
  // coincidan con lo que el llamante presenta. Sin atestación: sin procedencia,
  // unavailable en ambas vistas. Con atestación de la misma versión pero otro
  // valor/lineage/publicación: dato adulterado, se rechaza.
  let valueProvenance = null;
  if (valuePresent && valueSha256 !== null && revisionId !== null && published.ok) {
    const sameVersion = valueAttestations.find((entry) => entry.key === input.key && entry.revisionId === revisionId);
    const revisionOfDeclared = input.revisionOf ?? null;
    if (sameVersion !== undefined) {
      if (sameVersion.valueSha256 !== valueSha256) {
        fail(errors, "value", "VALUE_ATTESTATION_MISMATCH", `El valor presentado para "${input.key}"/"${revisionId}" no es el atestado por el audit ${sameVersion.auditId} (valueSha256 distinto).`);
      } else if (sameVersion.revisionOf !== revisionOfDeclared) {
        fail(errors, "revisionOf", "VALUE_ATTESTATION_MISMATCH", `El lineage de "${input.key}"/"${revisionId}" no es el atestado por el audit ${sameVersion.auditId} (revisionOf "${sameVersion.revisionOf ?? "null"}").`);
      } else if (sameVersion.publishedAtUtc !== published.utc) {
        fail(errors, "publishedAtUtc", "VALUE_ATTESTATION_MISMATCH", `La publicación de "${input.key}"/"${revisionId}" no es la atestada por el audit ${sameVersion.auditId}.`);
      } else {
        valueProvenance = {
          auditId: sameVersion.auditId,
          source: sameVersion.source,
          locator: sameVersion.locator,
          sha256: sameVersion.sha256,
          valueSha256: sameVersion.valueSha256,
          revisionEffectiveAtUtc: sameVersion.revisionEffectiveAtUtc,
          attestationArtifact: sameVersion.attestationArtifact,
        };
      }
    }
  }

  // Vínculo con el audit (§6.4, DEP-07): source+locator sólo son la dirección
  // de la evidencia; lo que la acredita es una atestación verificada (registro
  // de loadConsumptionAttestations) del audit para esta misma versión (key,
  // revisionId), este mismo instante de consumo, el mismo hash de evidencia y
  // el mismo valor (valueSha256). Sin atestación el consumo no está demostrado
  // (unavailable, §6.1); con atestación y hash o valor distinto es evidencia
  // adulterada: se rechaza.
  if (consumableEvidence !== null && consumable.ok) {
    const audited = attestations.find(
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
    } else if (audited !== undefined && valuePresent && audited.valueSha256 !== valueSha256) {
      fail(
        errors,
        "value",
        "VALUE_ATTESTATION_MISMATCH",
        `El valor presentado no es el que el audit ${audited.auditId} atestó como consumido; la atestación no se reutiliza para otro valor.`,
      );
    } else if (audited !== undefined && valuePresent && consumableEvidence.sha256 === audited.sha256) {
      consumableEvidence.auditLinked = true;
      consumableEvidence.auditId = audited.auditId;
      consumableEvidence.attestationArtifact = audited.attestationArtifact;
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

  // Consumo demostrado exige las piezas de §6.1: valor presente con
  // procedencia auditada, publicación en origen, timestamp de consumo y
  // evidencia contemporánea vinculada al audit por hash y valor (§6.4). Sin
  // cualquiera de las piezas, unavailable.
  const evidenceLinked = consumableEvidence !== null && consumableEvidence.auditLinked === true;
  const consumability = valuePresent && valueProvenance !== null && published.utc !== null && consumable.utc !== null && evidenceLinked
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
    valueSha256,
    valueProvenance,
    revisionId,
    revisionOf,
    proxy: input.proxy === true,
    proxyId: input.proxyId ?? null,
    proxyDeclaration,
  };
  if (valuePresent) {
    record.value = valueCopy;
  }
  if (auditedReason !== null) {
    record.reason = auditedReason;
  } else if (typeof input.reason === "string" && input.reason.length > 0) {
    record.reason = input.reason;
  }
  if (audit !== null) {
    record.audit = audit;
  }
  deepFreeze(record);
  VERIFIED_RECORDS.add(record);
  return { ok: true, record };
}

// Records producidos por buildPitRecord (o derivados con withEvaluationClock).
// Los predicados públicos sólo responden por ellos: un objeto armado a mano
// con `auditLinked: true` no es un record verificado (review IMP-06 #8).
const VERIFIED_RECORDS = new WeakSet();

export function isVerifiedPitRecord(record) {
  return record !== null && typeof record === "object" && VERIFIED_RECORDS.has(record);
}

// Copia del record con el reloj de evaluación fijado por el manifest. Sólo
// acepta records verificados; la copia hereda la marca. No se exporta desde
// index.mjs.
export function withEvaluationClock(record, effectiveAtUtc) {
  if (!isVerifiedPitRecord(record)) {
    return null;
  }
  const derived = deepFreeze({ ...record, effectiveAtUtc });
  VERIFIED_RECORDS.add(derived);
  return derived;
}

const AUDITED_SEMANTIC_KEYS = [
  "occurredReferenceTime",
  "publicationSourceAvailabilityTime",
  "policyConsumableTime",
  "revisionVersion",
];

// Vocabulario de ST-03.3 (EEX-THE-20260921/ST-03.3/temporal-manifest.json
// `statusVocabulary`); el manifiesto previo de IMP-03 usa un subconjunto.
const AUDITED_STATUSES = ["OBSERVED", "PARTIAL", "HISTORICAL_ASSERTION", "MISSING", "NOT_DEMONSTRATED"];

function auditedReasonOf(entry) {
  const parts = [];
  for (const semanticKey of AUDITED_SEMANTIC_KEYS) {
    const semantic = entry[semanticKey];
    const detail = [semantic.value, semantic.reason, semantic.note]
      .filter((text) => typeof text === "string" && text.length > 0)
      .join(" — ");
    parts.push(detail.length > 0 ? `${semanticKey} ${semantic.status}: ${detail}` : `${semanticKey} ${semantic.status}`);
  }
  if (typeof entry.note === "string" && entry.note.length > 0) {
    parts.push(`note: ${entry.note}`);
  }
  return parts.join(" | ");
}

function auditFailure(code, message) {
  return { ok: false, code, message };
}

function auditBlockFromVerifiedArtifact(reference, key) {
  if (typeof reference !== "object" || !isNonEmptyString(reference.requirementId)) {
    return auditFailure("INVALID_AUDIT_BLOCK", "audit debe ser { artifact: provenance verificada, requirementId }.");
  }
  const accredited = dep0607AuditRegistration(reference.artifact, "audit.artifact");
  if (!accredited.ok) {
    return auditFailure("UNVERIFIED_AUDIT_BLOCK", accredited.errors[0].message);
  }
  const { artifact, registration } = accredited;
  if (artifact?.artifactKind !== "IMP-03_TEMPORAL_MANIFEST" || !Array.isArray(artifact.entries)) {
    return auditFailure("UNVERIFIED_AUDIT_BLOCK", "El artifact verificado no es un IMP-03_TEMPORAL_MANIFEST con entries.");
  }
  const { requirementId } = reference;
  if (key !== requirementId) {
    return auditFailure("AUDIT_KEY_MISMATCH", `El record "${key}" no es el requisito auditado "${requirementId}".`);
  }
  const matches = artifact.entries.filter((entry) => entry?.requirementId === requirementId);
  if (matches.length !== 1) {
    return auditFailure("UNVERIFIED_AUDIT_BLOCK", `El artifact verificado contiene ${matches.length} entradas para "${requirementId}"; se exige exactamente una.`);
  }
  const [entry] = matches;
  const vocabulary = Array.isArray(artifact.statusVocabulary) ? artifact.statusVocabulary : AUDITED_STATUSES;
  const badSemantic = AUDITED_SEMANTIC_KEYS.find((semanticKey) => {
    const status = entry[semanticKey]?.status;
    return !AUDITED_STATUSES.includes(status) || !vocabulary.includes(status);
  });
  if (badSemantic !== undefined) {
    return auditFailure("UNKNOWN_AUDITED_STATUS", `${requirementId}.${badSemantic}: status auditado "${entry[badSemantic]?.status}" fuera del vocabulario; no se descarta en silencio.`);
  }
  const semantics = {};
  for (const semanticKey of AUDITED_SEMANTIC_KEYS) {
    semantics[semanticKey] = entry[semanticKey];
  }
  const audit = deepFreeze(structuredClone({
    artifact: {
      path: registration.path,
      sha256: registration.sha256,
      receiptPath: registration.receiptPath,
      impIdentity: registration.impIdentity,
      acceptedAtUtc: registration.acceptedAtUtc,
      dependency: "DEP-06/07",
      packetId: artifact.packetId ?? null,
      subtaskId: artifact.subtaskId ?? null,
    },
    requirementId,
    requirement: entry.requirement ?? null,
    criticalVersusOptional: entry.criticalVersusOptional ?? null,
    note: entry.note ?? null,
    evidence: entry.evidence ?? null,
    semantics,
  }));
  return { ok: true, audit, reason: auditedReasonOf(entry) };
}

// Proxy admisible en la decision view de un boundary (§6.2): declarado,
// permitido y declarado antes o en el boundary (predeclarado ex ante). Un
// record no-proxy es siempre admisible. Un proxy sin declaración adjunta
// (manifest armado a mano) no es admisible.
export function isProxyAdmissibleAtBoundary(record, boundaryUtc) {
  if (!isVerifiedPitRecord(record)) {
    return { admissible: false, reason: "no es un record producido por buildPitRecord; nada verificado (§6.1/§25.2)" };
  }
  if (record.proxy !== true) {
    return { admissible: true, reason: null };
  }
  const declaration = record.proxyDeclaration;
  if (!declaration || typeof declaration.declaredAtUtc !== "string") {
    return { admissible: false, reason: "proxy sin declaración previa (§6.2)" };
  }
  const boundary = toUtcTimestamp(boundaryUtc);
  if (!boundary.ok) {
    return { admissible: false, reason: "boundary no parseable como instante UTC válido" };
  }
  // Primero el instante: una declaración posterior al boundary no existe en
  // él, así que su contenido (permitido o no) no puede afectar la respuesta.
  if (Date.parse(declaration.declaredAtUtc) > Date.parse(boundary.utc)) {
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
  if (!isVerifiedPitRecord(record)) {
    return Number.POSITIVE_INFINITY;
  }
  if (record.proxy !== true) {
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
  // Sólo records del constructor verificado: los campos auditLinked /
  // valueProvenance de un objeto ajeno no prueban nada (review IMP-06 #8).
  if (!isVerifiedPitRecord(record)) {
    return { consumable: false, reason: "no es un record producido por buildPitRecord; consumo no demostrado (§6.1/§25.2)" };
  }
  const normalizedBoundary = toUtcTimestamp(boundaryUtc);
  if (!normalizedBoundary.ok) {
    return { consumable: false, reason: "boundary no parseable como instante UTC válido" };
  }
  const boundary = Date.parse(normalizedBoundary.utc);
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
  if (record.valueProvenance === null || record.valueProvenance === undefined) {
    return { consumable: false, reason: "valor sin procedencia auditada (atestación con receipt aceptado); no consumible (§25.2)" };
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
