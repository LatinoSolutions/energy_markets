// Vistas decision-time y evaluation separadas. Fuente: SPEC v1.1.1
// §6.1 (dos vistas; revisión no viaja al pasado; published ≠ consumible),
// §6.2 (revisions crean versiones nuevas, nunca reescriben el histórico;
// missing con razón preservada), §14.2/§14.3 (el benchmark se consume
// únicamente para evaluación y la policy observa exclusivamente el historical
// decision view), §14.3 P6.3 paso 2 (sólo datos que satisfacen P4 en el
// boundary exacto), §14.6/§14.7 (la revisión cambia la versión de evaluación,
// nunca la decision view histórica ni el execution ledger) y §19.2 (detectar
// revisions futuras en State histórico, outcomes futuros usados para decidir y
// confusión decision/evaluation).

import {
  buildPitRecord,
  deepFreeze,
  isConsumableAtBoundary,
  isVerifiedPitRecord,
  isProxyAdmissibleAtBoundary,
  loadConsumptionAttestationsAt,
  loadValueAttestationsAt,
  normalizeProxyDeclarations,
  PER_VERSION_EVIDENCE_DEPENDENCY,
  semanticsOf,
  sourceRankOf,
  withEvaluationClock,
} from "./pit-record.mjs";
import { DEFAULT_REPO_ROOT, dep0607AuditRegistration, trustRootNotConfigurable, verifyAcceptedArtifactAt } from "./audited-artifacts.mjs";
import { toUtcTimestamp } from "./time.mjs";

const VIEW_KINDS = ["decision", "evaluation"];

// Receipt de revisión: registra el cambio de versión con su sello UTC. La
// revisión es apócrifa si no hay record que la materialice: el manifiesto
// exige un record con el mismo key/revisionId. Las revisiones son
// append-only: nunca reescriben versiones previas (§6.2).
export function buildRevision(input) {
  const errors = [];
  if (!input || typeof input !== "object") {
    return { ok: false, errors: [{ field: "revision", code: "MISSING_REVISION", message: "Revisión ausente." }] };
  }
  if (typeof input.key !== "string" || input.key.trim().length === 0) {
    errors.push({ field: "key", code: "MISSING_KEY", message: "La revisión no declara su key." });
  }
  if (typeof input.revisionId !== "string" || input.revisionId.trim().length === 0) {
    errors.push({ field: "revisionId", code: "MISSING_REVISION", message: "La revisión no declara revisionId." });
  }
  const effective = toUtcTimestamp(input.effectiveAtUtc ?? null);
  if (!effective.ok) {
    errors.push({ field: "effectiveAtUtc", code: effective.code, message: "La revisión requiere timestamp con zona explícita (se normaliza a UTC)." });
  }
  if (input.revisesRevisionId !== undefined && input.revisesRevisionId !== null
    && (typeof input.revisesRevisionId !== "string" || input.revisesRevisionId.trim().length === 0)) {
    errors.push({ field: "revisesRevisionId", code: "INVALID_REVISION_REF", message: "revisesRevisionId debe ser identidad de revisión o null." });
  }
  if (errors.length > 0) {
    return { ok: false, errors };
  }
  return {
    ok: true,
    revision: {
      key: input.key,
      revisionId: input.revisionId,
      revisesRevisionId: input.revisesRevisionId ?? null,
      effectiveAtUtc: effective.utc,
      reason: typeof input.reason === "string" && input.reason.length > 0 ? input.reason : null,
    },
  };
}

// Manifest PIT con las dos vistas. `records` son las versiones concretas
// (cada revisión del contenido es un record nuevo con revisionOf), los
// `revisions` son los receipts de trazabilidad del cambio. Nada aquí declara
// cobertura real: el contenido lo aporta el manifest auditado (§25.2 IMP-06).

// Vista a la que alimenta cada requisito auditado de IMP-03. No es default por
// lote: cada requisito tiene su scope fijo y uno sin clasificar se rechaza.
//  - R-06 (Benchmark B) = evaluation: data-sufficiency-matrix.json R-06
//    pointInTimeValidity.note "B is evaluation-view only; it must never be
//    visible to the decision policy"; SPEC v1.1.1 §5.3 ("B cerrado/revisado
//    pertenece a la evaluation view") y §14.2 ("consumida únicamente para
//    evaluación").
//  - Resto = decision: §6.1 define la evaluation view como "outcomes,
//    benchmark cerrado y revisiones de evaluación" y ninguno de estos
//    requisitos es uno de ellos (clasificación derivada de §6.1, no una
//    asignación fila a fila del audit).
export const IMP03_REQUIREMENT_VIEW_SCOPES = Object.freeze({
  "R-01": "decision",
  "R-02": "decision",
  "R-03": "decision",
  "R-04": "decision",
  "R-05": "decision",
  "R-06": "evaluation",
  "R-07": "decision",
  "R-08": "decision",
  "R-09": "decision",
  "R-10": "decision",
  "R-11": "decision",
  "R-12": "decision",
  "R-13": "decision",
  "R-14": "decision",
  "R-15": "decision",
  "R-16": "decision",
  "R-17": "decision",
});

// Puente de ingesta del manifiesto temporal auditado de IMP-03
// (artifactKind IMP-03_TEMPORAL_MANIFEST). Cada entrada es un requisito, no
// una fila de datos: el audit no entrega timestamps por versión ni valores
// PIT, así que ningún texto del audit se convierte en reloj ni en valor
// (§6.2: no se relabela; §6.5: retrieval no prueba publicación ni consumo).
// La entrada se materializa como record unavailable que conserva íntegras
// las cuatro semánticas (status, value, reason, note, evidence), la evidencia
// de la entrada y la procedencia verificada del artifact.
//
// §25.2 ("source/evidence y receipt aceptado"): el artifact se lee de disco
// desde `artifactRef.path`, su sha256 se recalcula y debe estar registrado por
// el IMP_RECEIPT aceptado de IMP-03 con sus claims audit DEP-06/07 (§25.2.2
// fila IMP-03). No se acepta un `artifact` en memoria: sería una segunda
// verdad sin procedencia comprobada. buildPitRecord deriva el bloque audit de
// la entrada leída de disco; aquí sólo se clasifica cada requisito.
function callerChoseTrustRoot(options) {
  return options !== null && typeof options === "object" && Object.hasOwn(options, "repoRoot");
}

export function auditedManifestRecords(options = {}) {
  if (callerChoseTrustRoot(options)) {
    return trustRootNotConfigurable();
  }
  return auditedManifestRecordsAt(DEFAULT_REPO_ROOT, options ?? {});
}

// Costura de tests (ver audited-artifacts.mjs); no se exporta desde index.mjs.
export function auditedManifestRecordsAt(trustRoot, { artifactRef, ...rest } = {}) {
  if (Object.hasOwn(rest, "artifact")) {
    return {
      ok: false,
      errors: [{ field: "artifact", code: "ARTIFACT_MUST_BE_READ_FROM_REF", message: "El artifact auditado se lee de disco por artifactRef; no se acepta contenido en memoria (§25.2)." }],
    };
  }
  const verified = verifyAcceptedArtifactAt(trustRoot, artifactRef);
  if (!verified.ok) {
    return verified;
  }
  const { artifact, provenance } = verified;
  if (!artifact || typeof artifact !== "object" || artifact.artifactKind !== "IMP-03_TEMPORAL_MANIFEST"
    || !Array.isArray(artifact.entries)) {
    return {
      ok: false,
      errors: [{ field: "artifact", code: "INVALID_AUDITED_ARTIFACT", message: "Se espera el artifact IMP-03_TEMPORAL_MANIFEST completo con su lista entries." }],
    };
  }
  const accredited = dep0607AuditRegistration(provenance);
  if (!accredited.ok) {
    return accredited;
  }

  const errors = [];
  const records = [];
  const seen = new Set();
  artifact.entries.forEach((entry, index) => {
    const field = `entries[${index}](${entry?.requirementId ?? "?"})`;
    const requirementId = entry?.requirementId;
    if (typeof requirementId !== "string" || !Object.hasOwn(IMP03_REQUIREMENT_VIEW_SCOPES, requirementId)) {
      errors.push({ field, code: "UNCLASSIFIED_REQUIREMENT", message: `El requisito "${requirementId}" no tiene viewScope canónico; no se presume.` });
      return;
    }
    if (seen.has(requirementId)) {
      errors.push({ field, code: "DUPLICATE_REQUIREMENT", message: `El requisito "${requirementId}" aparece más de una vez en el artifact.` });
      return;
    }
    seen.add(requirementId);
    const outcome = buildPitRecord({
      key: requirementId,
      viewScope: IMP03_REQUIREMENT_VIEW_SCOPES[requirementId],
      audit: { artifact: provenance, requirementId },
    });
    if (outcome.ok) {
      records.push(outcome.record);
    } else {
      errors.push(...outcome.errors.map((e) => ({ ...e, field: `${field}.${e.field}` })));
    }
  });
  if (errors.length > 0) {
    return { ok: false, errors };
  }
  return { ok: true, records };
}

// Materializa el manifiesto PIT auditado: records desde el artifact IMP-03
// más los records enriquecidos del lote, en un buildPitManifest con sus dos
// vistas. Un record extra no puede cambiar la vista de un requisito auditado
// (buildPitManifest exige un único viewScope por key).
export function buildPitManifestFromAudit(options = {}) {
  if (callerChoseTrustRoot(options)) {
    return trustRootNotConfigurable();
  }
  return buildPitManifestFromAuditAt(DEFAULT_REPO_ROOT, options ?? {});
}

// Costura de tests (ver audited-artifacts.mjs); no se exporta desde index.mjs.
export function buildPitManifestFromAuditAt(trustRoot, {
  manifestId,
  manifestVersion,
  artifactRef,
  extraRecords = [],
  revisions = [],
  consumptionAttestationRefs = [],
  valueAttestationRefs = [],
  proxyDeclarations = [],
  ...rest
} = {}) {
  const ingestion = auditedManifestRecordsAt(trustRoot, { artifactRef, ...(Object.hasOwn(rest, "artifact") ? { artifact: rest.artifact } : {}) });
  if (!ingestion.ok) {
    return ingestion;
  }
  return buildPitManifestAt(trustRoot, {
    manifestId,
    manifestVersion,
    records: [...ingestion.records, ...extraRecords],
    revisions,
    consumptionAttestationRefs,
    valueAttestationRefs,
    proxyDeclarations,
    ...(Object.hasOwn(rest, "auditedEvidence") ? { auditedEvidence: rest.auditedEvidence } : {}),
  });
}

// `valueAttestationRefs` / `consumptionAttestationRefs`: artifacts de
// procedencia de valores y de consumo (§6.4) verificados en disco contra un
// IMP_RECEIPT aceptado (§25.2); de ellos sale la única evidencia que puede
// hacer usable un valor o demostrar su consumo. `proxyDeclarations`: proxies
// predeclarados/permitidos (§6.2). Sin ellos ningún consumo queda demostrado y
// ningún proxy es admisible.
//
// Las vistas sólo leen manifests producidos aquí (marca privada): un objeto
// armado a mano con `auditLinked: true` no puede saltarse la verificación.
const VERIFIED_MANIFESTS = new WeakSet();

export function buildPitManifest(options = {}) {
  if (callerChoseTrustRoot(options)) {
    return trustRootNotConfigurable();
  }
  return buildPitManifestAt(DEFAULT_REPO_ROOT, options ?? {});
}

// Costura de tests (ver audited-artifacts.mjs); no se exporta desde index.mjs.
export function buildPitManifestAt(trustRoot, {
  manifestId,
  manifestVersion,
  records = [],
  revisions = [],
  consumptionAttestationRefs = [],
  valueAttestationRefs = [],
  proxyDeclarations = [],
  ...rest
} = {}) {
  const errors = [];
  if (Object.hasOwn(rest, "auditedEvidence")) {
    return {
      ok: false,
      errors: [{ field: "auditedEvidence", code: "UNVERIFIED_AUDITED_EVIDENCE", message: "La evidencia de consumo se declara con consumptionAttestationRefs (artifacts con receipt aceptado), no como lista en memoria (§25.2)." }],
    };
  }
  const evidenceLoad = loadConsumptionAttestationsAt(trustRoot, { refs: consumptionAttestationRefs });
  const valueLoad = loadValueAttestationsAt(trustRoot, { refs: valueAttestationRefs });
  const proxyRegistry = normalizeProxyDeclarations(proxyDeclarations);
  if (!evidenceLoad.ok || !valueLoad.ok || !proxyRegistry.ok) {
    return { ok: false, errors: [...(evidenceLoad.errors ?? []), ...(valueLoad.errors ?? []), ...(proxyRegistry.errors ?? [])] };
  }
  const recordContext = {
    evidenceRegistry: evidenceLoad.registry,
    valueRegistry: valueLoad.registry,
    proxyDeclarations: proxyRegistry.declarations,
  };
  if (typeof manifestId !== "string" || manifestId.trim().length === 0) {
    errors.push({ field: "manifestId", code: "MISSING_MANIFEST_ID", message: "El manifest no declara su identidad." });
  }
  if (typeof manifestVersion !== "string" || manifestVersion.trim().length === 0) {
    errors.push({ field: "manifestVersion", code: "MISSING_MANIFEST_VERSION", message: "El manifest no declara su versión." });
  }
  if (!Array.isArray(records)) {
    errors.push({ field: "records", code: "INVALID_RECORDS", message: "records debe ser una lista." });
  }
  if (!Array.isArray(revisions)) {
    errors.push({ field: "revisions", code: "INVALID_REVISIONS", message: "revisions debe ser una lista." });
  }

  const builtRecords = [];
  if (Array.isArray(records)) {
    records.forEach((entry, index) => {
      // Un record auditado ya verificado (adaptador de IMP-03) entra tal cual:
      // su bloque audit se derivó de disco y no se reconstruye desde una copia.
      if (isVerifiedPitRecord(entry) && entry.audit !== undefined) {
        builtRecords.push(entry);
        return;
      }
      const outcome = buildPitRecord(entry, recordContext);
      if (outcome.ok) {
        builtRecords.push(outcome.record);
      } else {
        errors.push(...outcome.errors.map((e) => ({ ...e, field: `records[${index}].${e.field}` })));
      }
    });
  }

  // Identidad: (key, revisionId) es única; un mismo revisionId con valores
  // distintos no reescribe el histórico (§6.2). Las entradas auditadas MISSING
  // (revisionId null) se agrupan bajo su propia identidad: dos faltantes del
  // mismo key siguen siendo una ambigüedad, no una versión nueva.
  const identity = new Map();
  let conflicting = false;
  for (const record of builtRecords) {
    const composite = `${record.key}::${record.revisionId ?? "__MISSING_VERSION__"}`;
    const prior = identity.get(composite);
    if (prior !== undefined) {
      conflicting = true;
      errors.push({
        field: "records",
        code: "DUPLICATE_REVISION",
        message: `La versión "${record.revisionId ?? "MISSING"}" de "${record.key}" aparece más de una vez; las revisiones crean versiones nuevas, no reescrituras.`,
      });
      break;
    }
    identity.set(composite, record);
  }

  // §14.2/§14.3: un key alimenta una sola vista. Si dos versiones del mismo
  // key declaran vistas distintas, un record extra podría meter el benchmark
  // en la decisión: doble verdad, se rechaza.
  const scopeByKey = new Map();
  for (const record of builtRecords) {
    const prior = scopeByKey.get(record.key);
    if (prior !== undefined && prior !== record.viewScope) {
      errors.push({
        field: "records",
        code: "VIEW_SCOPE_CONFLICT",
        message: `"${record.key}" se declara en las vistas ${prior} y ${record.viewScope}; un key alimenta una sola vista (§14.3).`,
      });
      conflicting = true;
      break;
    }
    scopeByKey.set(record.key, record.viewScope);
  }
  // Un requisito auditado de IMP-03 conserva su vista canónica aunque llegue
  // por buildPitManifest sin pasar por el adaptador (R-06 nunca en decisión).
  for (const record of builtRecords) {
    const canonicalScope = IMP03_REQUIREMENT_VIEW_SCOPES[record.key];
    if (canonicalScope !== undefined && canonicalScope !== record.viewScope) {
      errors.push({
        field: "records",
        code: "VIEW_SCOPE_CONFLICT",
        message: `"${record.key}" pertenece a la vista ${canonicalScope} (IMP03_REQUIREMENT_VIEW_SCOPES), no a ${record.viewScope}.`,
      });
      conflicting = true;
      break;
    }
  }

  // Trazabilidad: revisionOf debe apuntar a versiones existentes del mismo key
  // y el lineage debe respetar el tiempo (§6.1/§6.2): la revisión se publica
  // estrictamente después de la versión que corrige, y si declara consumo, se
  // consume estrictamente después de todo ancestro que lo declare. Si no, una
  // vista por reloj podría mostrar v2 antes que v1. Una revisión o una versión
  // corregida sin publicación no se puede situar en el tiempo: se rechaza.
  // Cada versión se revisa a lo sumo una vez: dos revisiones de la misma
  // versión (fork) son doble verdad sobre cuál la sucede.
  const revisedBy = new Map();
  if (!conflicting) {
    for (const record of builtRecords) {
      if (record.revisionOf === null) {
        continue;
      }
      const predecessor = identity.get(`${record.key}::${record.revisionOf}`);
      if (predecessor === undefined) {
        errors.push({
          field: "records",
          code: "DANGLING_REVISION_OF",
          message: `La versión "${record.revisionId}" de "${record.key}" declara revisionOf "${record.revisionOf}" sin record previo.`,
        });
        continue;
      }
      const priorRevision = revisedBy.get(`${record.key}::${record.revisionOf}`);
      if (priorRevision !== undefined) {
        errors.push({
          field: "records",
          code: "LINEAGE_FORK",
          message: `"${record.revisionOf}" de "${record.key}" es revisada por "${priorRevision}" y por "${record.revisionId}"; el lineage es lineal (§6.2).`,
        });
        continue;
      }
      revisedBy.set(`${record.key}::${record.revisionOf}`, record.revisionId);
      // §6.2: un proxy no se relabela como oficial. El lineage vive dentro de
      // una misma fuente; cambiar de fuente es fallback, no revisión.
      if (predecessor.proxy !== record.proxy || predecessor.proxyId !== record.proxyId) {
        errors.push({
          field: "records",
          code: "LINEAGE_SOURCE_MISMATCH",
          message: `"${record.revisionId}" de "${record.key}" revisa "${predecessor.revisionId}" de otra fuente; una revisión no cambia de fuente (§6.2).`,
        });
        continue;
      }
      if (record.publishedAtUtc === null) {
        errors.push({
          field: "records",
          code: "REVISION_WITHOUT_PUBLICATION",
          message: `La revisión "${record.revisionId}" de "${record.key}" no tiene publicación/availability en origen; su lineage no se puede ordenar.`,
        });
        continue;
      }
      if (predecessor.publishedAtUtc === null) {
        errors.push({
          field: "records",
          code: "LINEAGE_ORDER_UNVERIFIABLE",
          message: `"${record.revisionId}" revisa "${predecessor.revisionId}" de "${record.key}", que no tiene publicación: el orden del lineage no es verificable.`,
        });
        continue;
      }
      if (Date.parse(record.publishedAtUtc) <= Date.parse(predecessor.publishedAtUtc)) {
        errors.push({
          field: "records",
          code: "LINEAGE_ORDER_INCOHERENT",
          message: `"${record.revisionId}" de "${record.key}" se publica antes o a la vez que "${predecessor.revisionId}", la versión que revisa.`,
        });
        continue;
      }
    }
  }

  // Orden de consumo contra toda la cadena de ancestros, no sólo el padre: un
  // eslabón intermedio sin consumo no puede dejar que v3 sea consumible antes
  // que v1. Se recorre sólo con lineage ya válido (publicación estrictamente
  // creciente por eslabón => sin ciclos).
  if (errors.length === 0) {
    for (const record of builtRecords) {
      if (record.revisionOf === null || record.consumableAtUtc === null) {
        continue;
      }
      let ancestor = identity.get(`${record.key}::${record.revisionOf}`);
      while (ancestor !== undefined) {
        if (ancestor.consumableAtUtc !== null
          && Date.parse(record.consumableAtUtc) <= Date.parse(ancestor.consumableAtUtc)) {
          errors.push({
            field: "records",
            code: "LINEAGE_ORDER_INCOHERENT",
            message: `"${record.revisionId}" de "${record.key}" es consumible antes o a la vez que su ancestro "${ancestor.revisionId}".`,
          });
          break;
        }
        ancestor = ancestor.revisionOf === null ? undefined : identity.get(`${record.key}::${ancestor.revisionOf}`);
      }
    }
  }

  const builtRevisions = [];
  const revisionIdentity = new Set();
  if (Array.isArray(revisions)) {
    revisions.forEach((entry, index) => {
      const outcome = buildRevision(entry);
      if (!outcome.ok) {
        errors.push(...outcome.errors.map((e) => ({ ...e, field: `revisions[${index}].${e.field}` })));
        return;
      }
      // Un revision receipt sin record materializado no acredita la revisión:
      // el contenido lo aporta el manifest auditado, no el receipt.
      if (!identity.has(`${outcome.revision.key}::${outcome.revision.revisionId}`)) {
        errors.push({
          field: `revisions[${index}]`,
          code: "REVISION_WITHOUT_RECORD",
          message: `El receipt de "${outcome.revision.revisionId}" no tiene record; las revisiones se materializan como versiones nuevas del manifest.`,
        });
        return;
      }
      // Lineage coherente (§6.2): el receipt declara a qué versión corrige; el
      // record materializado declara de qué versión procede. Un receipt cuyo
      // revisesRevisionId contradice el revisionOf del record es doble verdad:
      // se rechaza en vez de aceptar la revisión con lineage roto.
      const materialized = identity.get(`${outcome.revision.key}::${outcome.revision.revisionId}`);
      if (outcome.revision.revisesRevisionId !== materialized.revisionOf) {
        errors.push({
          field: `revisions[${index}]`,
          code: "REVISION_LINEAGE_MISMATCH",
          message: `El receipt de "${outcome.revision.revisionId}" declara revisar "${outcome.revision.revisesRevisionId ?? "null"}" pero el record materializado declara revisionOf "${materialized.revisionOf ?? "null"}"; el lineage del receipt y del record deben coincidir (§6.2).`,
        });
        return;
      }
      // Referencia verificable a la revisión (P-001 punto 1 de Bru,
      // 2026-09-23): el sello del receipt es el reloj de evaluación, así que
      // debe ser el que el audit atestó para esta versión. Un receipt sobre
      // una versión sin procedencia, o con otro sello, no se acepta.
      const attestedEffective = materialized.valueProvenance?.revisionEffectiveAtUtc ?? null;
      if (attestedEffective === null || attestedEffective !== outcome.revision.effectiveAtUtc) {
        errors.push({
          field: `revisions[${index}]`,
          code: "REVISION_NOT_ATTESTED",
          message: `El receipt de "${outcome.revision.revisionId}" de "${outcome.revision.key}" no coincide con una revisión atestada por un audit con receipt aceptado (revisionEffectiveAtUtc); no fija el reloj de evaluación (§25.2).`,
        });
        return;
      }
      // Un mismo receipt de revisión no puede registrarse dos veces: duplicar
      // la trazabilidad del cambio sería doble verdad sobre la revisión.
      const receiptIdentity = `${outcome.revision.key}::${outcome.revision.revisionId}`;
      if (revisionIdentity.has(receiptIdentity)) {
        errors.push({
          field: `revisions[${index}]`,
          code: "DUPLICATE_REVISION_RECEIPT",
          message: `El receipt de "${outcome.revision.revisionId}" de "${outcome.revision.key}" aparece más de una vez; cada revisión se registra una sola vez (§6.2).`,
        });
        return;
      }
      revisionIdentity.add(receiptIdentity);
      builtRevisions.push(outcome.revision);
    });
  }

  // La otra mitad del vínculo receipt↔atestación: si el audit atestó un
  // sello de revisión, omitir el receipt no puede hacer caer el reloj de
  // evaluación a la publicación y adelantar la revisión (validación
  // adversarial IMP-06, 2026-09-23).
  for (const record of builtRecords) {
    const attestedEffective = record.valueProvenance?.revisionEffectiveAtUtc ?? null;
    if (attestedEffective !== null && !revisionIdentity.has(`${record.key}::${record.revisionId}`)) {
      errors.push({
        field: "revisions",
        code: "REVISION_RECEIPT_MISSING",
        message: `"${record.revisionId}" de "${record.key}" tiene una revisión atestada efectiva en ${attestedEffective} sin su receipt; no se usa la publicación como reloj de evaluación (§6.2).`,
      });
    }
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  // Reloj de evaluación por record (§6.2): el sello del receipt de revisión
  // cuando el manifest lo declara; si no, la publicación en origen. Es el
  // reloj de contenido vigente, independiente de cuándo la policy pudo
  // consumirlo (las dos vistas no comparten reloj, §6.1). `occurredAtUtc` no
  // es disponibilidad: nunca sustituye la publicación (§6.1). Un receipt no
  // puede hacer efectiva una revisión antes de que su versión se publique.
  const sortedRevisions = [...builtRevisions]
    .sort((left, right) => left.effectiveAtUtc.localeCompare(right.effectiveAtUtc));
  const effectiveAtByIdentity = new Map();
  for (const record of builtRecords) {
    const receipt = record.revisionId === null
      ? undefined
      : sortedRevisions.find(
        (revision) => revision.key === record.key && revision.revisionId === record.revisionId,
      );
    // §6.1: una revisión no puede ser efectiva sin publicación/availability en
    // origen. Sin ella no se conoce cuándo existió la versión: el receipt no
    // sustituye la publicación.
    if (receipt !== undefined && record.publishedAtUtc === null) {
      errors.push({
        field: "revisions",
        code: "REVISION_WITHOUT_PUBLICATION",
        message: `La revisión "${receipt.revisionId}" de "${record.key}" no tiene publicación/availability en origen.`,
      });
      continue;
    }
    if (receipt !== undefined && Date.parse(receipt.effectiveAtUtc) < Date.parse(record.publishedAtUtc)) {
      errors.push({
        field: "revisions",
        code: "REVISION_EFFECTIVE_BEFORE_PUBLICATION",
        message: `La revisión "${receipt.revisionId}" de "${record.key}" se declara efectiva antes de publicarse su versión.`,
      });
      continue;
    }
    effectiveAtByIdentity.set(record, receipt !== undefined ? receipt.effectiveAtUtc : record.publishedAtUtc);
  }

  // El reloj de evaluación también respeta el lineage: un receipt no puede
  // hacer efectiva una revisión antes (o a la vez) que la versión que corrige.
  for (const record of builtRecords) {
    const recordEffective = effectiveAtByIdentity.get(record);
    if (record.revisionOf === null || typeof recordEffective !== "string") {
      continue;
    }
    const predecessor = identity.get(`${record.key}::${record.revisionOf}`);
    const predecessorEffective = effectiveAtByIdentity.get(predecessor);
    if (typeof predecessorEffective !== "string") {
      continue;
    }
    if (Date.parse(recordEffective) <= Date.parse(predecessorEffective)) {
      errors.push({
        field: "revisions",
        code: "LINEAGE_ORDER_INCOHERENT",
        message: `"${record.revisionId}" de "${record.key}" es efectiva en evaluación antes o a la vez que "${predecessor.revisionId}", la versión que revisa.`,
      });
    }
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  // El manifest es inmutable: records (con su reloj de evaluación) y receipts
  // quedan congelados; una versión no se reescribe por referencia (§6.2).
  const manifestRecords = builtRecords.map((record) => withEvaluationClock(record, effectiveAtByIdentity.get(record) ?? null));
  const manifest = deepFreeze({
    manifestId,
    manifestVersion,
    records: manifestRecords,
    revisions: sortedRevisions,
  });
  VERIFIED_MANIFESTS.add(manifest);
  return { ok: true, manifest };
}

function unverifiedManifest(view) {
  return {
    ok: false,
    view,
    field: "manifest",
    code: "UNVERIFIED_MANIFEST",
    reason: "El manifest no fue producido por buildPitManifest; sus records no tienen consumo verificado (§6.1/§25.2).",
  };
}


// Relojes separados por vista (§6.1: las dos vistas no comparten reloj):
//  - decision: consumableFromUtc (consumo demostrado).
//  - evaluation: effectiveAtUtc (receipt o publicación), fijado en el manifest.
function latestBy(records, clockField) {
  let latest = null;
  for (const record of records) {
    if (latest === null || record[clockField].localeCompare(latest[clockField]) > 0) {
      latest = record;
    }
  }
  return latest;
}

// Jerarquía de fuentes fijada ex ante (§6.2): gana la fuente de menor rango que
// tenga contenido en el instante (oficial = 0, proxies por fallbackRank); sólo
// dentro de esa fuente decide el reloj. Un proxy posterior nunca desplaza a la
// oficial disponible, y el orden no depende del resultado económico.
function selectBySourceHierarchy(records, clockField) {
  if (records.length === 0) {
    return null;
  }
  const bestRank = Math.min(...records.map(sourceRankOf));
  return latestBy(records.filter((record) => sourceRankOf(record) === bestRank), clockField);
}

function parseUtcBoundary(value, field, code) {
  if (typeof value !== "string") {
    return { ok: false, error: { field, code, reason: `${field} no parseable.` } };
  }
  const normalized = toUtcTimestamp(value);
  if (!normalized.ok) {
    return { ok: false, error: { field, code: normalized.code, reason: `${field} requiere instante ISO-8601 válido con zona explícita (UTC u offset declarado, §6.1).` } };
  }
  return { ok: true, ms: Date.parse(normalized.utc), iso: normalized.utc };
}

function withRecordReason(record, guardReason) {
  const recordReason = typeof record.reason === "string" && record.reason.length > 0 ? record.reason : null;
  return recordReason !== null ? `${recordReason}; ${guardReason}` : guardReason;
}

// Frontera temporal de la evaluación también para faltantes y observaciones
// (§6.1/§6.2): la razón de un faltante publicado después del asOf no puede
// aparecer en una lectura anterior; el reloj de contenido es el mismo que usa
// la evaluación versionada. Sin reloj de contenido (entrada auditada) el hecho
// es intemporal y siempre está presente.
function knownAtAsOf(record, asOfMs) {
  if (typeof record.effectiveAtUtc !== "string") {
    return true;
  }
  return Date.parse(record.effectiveAtUtc) <= asOfMs;
}

// Un record habla en la decision view de un boundary sólo si lo que dice es un
// hecho anterior o igual a él (§6.1 "publicado no significa disponible";
// criterio IMP-06 §25.1 "un dato publicado pero aún no consumible no entra;
// revisión futura no cambia State histórico"):
//  - un valor presente sólo habla cuando su consumo está demostrado en el
//    boundary; publicado pero no consumible no se menciona (una versión futura
//    no cambia la respuesta histórica);
//  - un faltante/observación del audit no tiene valor que consumir: su razón es
//    un hecho del audit. Sin reloj de publicación es intemporal; con
//    publicación, habla desde que se publica y nunca antes (§6.2: el faltante
//    conserva su trazabilidad sin hacerse consumible).
function speaksAtBoundary(record, boundaryMs) {
  if (record.valueStatus !== "PRESENT") {
    return record.publishedAtUtc === null || Date.parse(record.publishedAtUtc) <= boundaryMs;
  }
  return record.consumableAtUtc !== null && Date.parse(record.consumableAtUtc) <= boundaryMs;
}

// DECISION-TIME VIEW (§6.1): en cada boundary expone únicamente las versiones
// realmente conocidas/consumibles. La policy observa exclusivamente esta vista
// (§14.3): los keys de viewScope "evaluation" (benchmark, outcomes) nunca
// aparecen. Salida:
//  - visible: por key, la versión elegida por jerarquía de fuentes ex ante y,
//    dentro de la fuente, la más reciente por consumo (§6.2).
//  - suppressed: records que hablan en el boundary (ver speaksAtBoundary) y no
//    son admisibles, con su razón auditada + la guarda (§6.2).
//  - unavailable: keys sin versión consumible en el boundary (§6.1). El set de
//    keys es el esquema del manifest: una revisión de un key existente no lo
//    cambia; incorporar un key nuevo sí lo lista como unavailable.
export function readDecisionView(manifest, boundaryUtc) {
  if (!VERIFIED_MANIFESTS.has(manifest)) {
    return { ...unverifiedManifest("decision"), boundary: boundaryUtc };
  }
  const boundary = parseUtcBoundary(boundaryUtc, "boundary", "INVALID_BOUNDARY");
  if (!boundary.ok) {
    return { ok: false, view: "decision", boundary: boundaryUtc, ...boundary.error };
  }

  const visible = [];
  const suppressed = [];
  const unavailable = [];

  // Exige "decision" explícito: un manifest mal formado tampoco cuela un
  // benchmark sin scope en la decisión.
  const decisionRecords = manifest.records.filter((record) => record.viewScope === "decision");
  const uniqueKeys = [...new Set(decisionRecords.map((record) => record.key))];

  for (const key of uniqueKeys) {
    const speaking = decisionRecords.filter((record) => record.key === key && speaksAtBoundary(record, boundary.ms));

    const admissible = [];
    for (const record of speaking) {
      const consumability = isConsumableAtBoundary(record, boundary.iso);
      const proxy = isProxyAdmissibleAtBoundary(record, boundary.iso);
      if (consumability.consumable && proxy.admissible) {
        admissible.push(record);
        continue;
      }
      const guardReason = consumability.consumable ? proxy.reason : consumability.reason;
      suppressed.push({ key, revisionId: record.revisionId, reason: withRecordReason(record, guardReason) });
    }

    const selected = selectBySourceHierarchy(admissible, "consumableFromUtc");
    if (selected === null) {
      const entry = { key, reason: "sin versión consumible demostrada en este boundary (§6.1)" };
      // Sólo mira lo que habla en el boundary: una versión futura no puede
      // cambiar la respuesta histórica (§6.1, §14.7). Si lo que habla carece
      // de valor o de procedencia auditada, falta la evidencia por versión.
      const lacksEvidence = speaking.some((record) => record.valueStatus !== "PRESENT" || record.valueProvenance === null);
      if (lacksEvidence) {
        entry.blockedBy = PER_VERSION_EVIDENCE_DEPENDENCY;
      }
      unavailable.push(entry);
      continue;
    }
    visible.push({
      key,
      value: selected.value,
      revisionId: selected.revisionId,
      consumableFromUtc: selected.consumableFromUtc,
      semantics: semanticsOf(selected),
      proxy: selected.proxy,
      proxyId: selected.proxyId,
      sourceRank: sourceRankOf(selected),
    });
  }

  return { ok: true, view: "decision", boundary: boundary.iso, visible, suppressed, unavailable };
}

// EVALUATION VIEW (§6.1): outcomes, benchmark cerrado y revisiones de
// evaluación, versionada por asOfUtc. Reloj de contenido (receipt o
// publicación), nunca el de consumo de la policy. Selección por la misma
// jerarquía de fuentes ex ante (§6.2); los proxies no permitidos no se usan.
// Faltantes, observaciones del audit sin valor y contenido sin reloj se
// reportan en `unavailable` con su razón auditada (§6.1/§6.2).
export function readEvaluationView(manifest, asOfUtc) {
  if (!VERIFIED_MANIFESTS.has(manifest)) {
    return unverifiedManifest("evaluation");
  }
  const asOf = parseUtcBoundary(asOfUtc, "asOf", "INVALID_AS_OF");
  if (!asOf.ok) {
    return { ok: false, view: "evaluation", ...asOf.error };
  }

  const current = [];
  const superseded = [];
  const outranked = [];
  const unavailable = [];

  const uniqueKeys = [...new Set(manifest.records.map((record) => record.key))];

  for (const key of uniqueKeys) {
    const keyRecords = manifest.records.filter((record) => record.key === key);
    const content = [];
    for (const record of keyRecords) {
      if (record.valueStatus === "AUDIT_OBSERVED") {
        if (knownAtAsOf(record, asOf.ms)) {
          unavailable.push({ key, revisionId: record.revisionId, reason: withRecordReason(record, "observado por el audit sin versión PIT materializada (§6.5)"), blockedBy: PER_VERSION_EVIDENCE_DEPENDENCY });
        }
      } else if (record.valueStatus !== "PRESENT") {
        // Un faltante publicado después del asOf no era conocido en esta
        // lectura: su razón no se adelanta (§6.1/§6.2).
        if (knownAtAsOf(record, asOf.ms)) {
          unavailable.push({ key, revisionId: record.revisionId, reason: withRecordReason(record, "valor ausente; faltante explícito (§6.2)"), blockedBy: PER_VERSION_EVIDENCE_DEPENDENCY });
        }
      } else if (typeof record.publishedAtUtc !== "string" || typeof record.effectiveAtUtc !== "string") {
        unavailable.push({ key, revisionId: record.revisionId, reason: withRecordReason(record, "sin publicación ni receipt; contenido no disponible para evaluación (§6.1)") });
      } else if (Date.parse(record.effectiveAtUtc) <= asOf.ms && record.valueProvenance === null) {
        // P-001 punto 1 de Bru (2026-09-23): un valor sin atestación auditada
        // no se muestra como vigente aunque declare publicación. Contenido
        // futuro en este asOf no se menciona.
        unavailable.push({ key, revisionId: record.revisionId, reason: withRecordReason(record, "valor sin procedencia auditada (atestación con receipt aceptado); no se usa en evaluación (§25.2)"), blockedBy: PER_VERSION_EVIDENCE_DEPENDENCY });
      } else if (Date.parse(record.effectiveAtUtc) <= asOf.ms) {
        // §6.2: el proxy debe estar predeclarado y permitido en el asOf; una
        // declaración posterior no existe todavía para esta versión de la vista.
        const proxy = isProxyAdmissibleAtBoundary(record, asOf.iso);
        if (proxy.admissible) {
          content.push(record);
        } else {
          unavailable.push({ key, revisionId: record.revisionId, reason: withRecordReason(record, proxy.reason) });
        }
      }
    }

    const selected = selectBySourceHierarchy(content, "effectiveAtUtc");
    if (selected === null) {
      continue;
    }
    current.push({
      key,
      value: selected.value,
      revisionId: selected.revisionId,
      publishedAtUtc: selected.publishedAtUtc,
      consumableAtUtc: selected.consumableAtUtc,
      effectiveAtUtc: selected.effectiveAtUtc,
      semantics: semanticsOf(selected),
      proxy: selected.proxy,
      proxyId: selected.proxyId,
      sourceRank: sourceRankOf(selected),
      condition: selected.revisionOf === null ? "base" : `revised from ${selected.revisionOf}`,
    });
    // Versiones anteriores de la misma fuente: superseded (§6.2). Contenido de
    // otra fuente con peor rango: outranked, no reemplazo.
    for (const record of content) {
      if (record === selected) {
        continue;
      }
      if (sourceRankOf(record) === sourceRankOf(selected)) {
        superseded.push({
          key,
          revisionId: record.revisionId,
          value: record.value,
          effectiveAtUtc: record.effectiveAtUtc,
          supersededBy: selected.revisionId,
        });
      } else {
        outranked.push({
          key,
          revisionId: record.revisionId,
          proxyId: record.proxyId,
          sourceRank: sourceRankOf(record),
          outrankedBy: selected.revisionId,
        });
      }
    }
  }

  const appliedRevisions = manifest.revisions
    .filter((revision) => Date.parse(revision.effectiveAtUtc) <= asOf.ms)
    .map((revision) => ({ ...revision }));

  const pendingRevisions = manifest.revisions
    .filter((revision) => Date.parse(revision.effectiveAtUtc) > asOf.ms)
    .map((revision) => ({ ...revision, status: "pendiente en este asOf" }));

  return {
    ok: true,
    view: "evaluation",
    asOf: asOf.iso,
    current,
    superseded,
    outranked,
    unavailable,
    appliedRevisions,
    pendingRevisions,
  };
}

// Predicado para el boundary del Operator Interface (IMP-29 §26.5): la UI
// contrasta lo que muestra contra registros canónicos, y sólo un manifest
// producido por buildPitManifest acredita registros canónicos (§6.1/§25.2).
export function isVerifiedPitManifest(manifest) {
  return manifest !== null && typeof manifest === "object" && VERIFIED_MANIFESTS.has(manifest);
}

// Entrega las dos vistas separadas para un boundary/asOf idéntico. La
// separación explícita evita confundir ambas en los tests de §19.2.
export function viewsAt(manifest, boundaryUtc) {
  return {
    decision: readDecisionView(manifest, boundaryUtc),
    evaluation: readEvaluationView(manifest, boundaryUtc),
  };
}

export { VIEW_KINDS };
