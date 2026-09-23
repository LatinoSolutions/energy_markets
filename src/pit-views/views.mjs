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

import { buildPitRecord, isConsumableAtBoundary, semanticsOf } from "./pit-record.mjs";
import { isUtcAnchored, toUtcTimestamp } from "./time.mjs";

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

// Puente de ingesta desde el manifiesto temporal auditado de IMP-03
// (IMP-03_TEMPORAL_MANIFEST): las entradas auditadas se materializan como
// records del contrato, sin inventar valores. Una semántica MISSING no
// aporta timestamp ni valor: el record queda faltante explícito y conserva
// su razón auditada (§6.2). HISTORICAL_ASSERTION (R-06/R-11) es procedencia
// documental del audit, no dato temporal ni valor de mercado: no se relabela
// (§6.2) y no se usa como occurred/publication/consumable. El artifact no
// declara viewScope por entrada: el lote lo declara (el scope del audit es
// la toma de decisión P5, §6.5; se permite override por requisito).
export function auditedManifestRecords({ entries, defaultViewScope, viewScopeByRequirement = {} } = {}) {
  const errors = [];
  if (!Array.isArray(entries)) {
    return { ok: false, errors: [{ field: "entries", code: "INVALID_ENTRIES", message: "entries debe ser la lista del manifiesto auditado." }] };
  }
  if (defaultViewScope !== "decision" && defaultViewScope !== "evaluation") {
    return {
      ok: false,
      errors: [{ field: "defaultViewScope", code: "MISSING_VIEW_SCOPE", message: "El lote debe declarar defaultViewScope: decision o evaluation (el artifact IMP-03 no trae viewScope por entrada)." }],
    };
  }
  const SEMANTIC_TO_FIELD = {
    occurredReferenceTime: "occurredAtUtc",
    publicationSourceAvailabilityTime: "publishedAtUtc",
    policyConsumableTime: "consumableAtUtc",
  };
  const records = [];
  entries.forEach((entry, index) => {
    const semanticFields = {};
    for (const [semanticKey, field] of Object.entries(SEMANTIC_TO_FIELD)) {
      const semantic = entry[semanticKey];
      if (semantic?.status === "PRESENT" && typeof semantic.value === "string" && semantic.value.length > 0) {
        semanticFields[field] = semantic.value;
      }
    }
    // Aserción histórica del audit: procedencia documental, no timestamp.
    let assertion = null;
    for (const semanticKey of Object.keys(SEMANTIC_TO_FIELD)) {
      const semantic = entry[semanticKey];
      if (semantic?.status === "HISTORICAL_ASSERTION" && semantic.value != null) {
        assertion = {
          assertion: semantic.value,
          semantic: semanticKey,
          evidence: semantic.evidence ?? null,
          specLocator: semantic.specLocator ?? entry.specLocator ?? null,
        };
        break;
      }
    }
    // Razón auditada del faltante (§6.2): trazabilidad del missing.
    let reason = null;
    for (const semanticKey of Object.keys(SEMANTIC_TO_FIELD)) {
      const semantic = entry[semanticKey];
      if (semantic?.status === "MISSING" && typeof semantic.reason === "string" && semantic.reason.length > 0) {
        reason = semantic.reason;
        break;
      }
    }
    const viewScope = viewScopeByRequirement[entry.requirementId] ?? defaultViewScope;
    const recordInput = {
      key: entry.requirementId,
      viewScope,
      revisionId: null,
      value: null,
      occurredAtUtc: semanticFields.occurredAtUtc ?? null,
      publishedAtUtc: semanticFields.publishedAtUtc ?? null,
      consumableAtUtc: semanticFields.consumableAtUtc ?? null,
    };
    if (typeof entry.requirement === "string" && entry.requirement.length > 0) {
      recordInput.label = entry.requirement;
    }
    if (reason !== null && assertion !== null) {
      recordInput.reason = `${reason} | HISTORICAL_ASSERTION (${assertion.semantic}): ${assertion.assertion}`;
    } else if (reason !== null) {
      recordInput.reason = reason;
    } else if (assertion !== null) {
      recordInput.reason = `HISTORICAL_ASSERTION (${assertion.semantic}): ${assertion.assertion}`;
    }
    if (assertion !== null) {
      recordInput.historicalAssertion = {
        assertion: assertion.assertion,
        semantic: assertion.semantic,
        specLocator: assertion.specLocator,
        evidence: assertion.evidence,
      };
    }
    const outcome = buildPitRecord(recordInput);
    if (outcome.ok) {
      records.push(outcome.record);
    } else {
      errors.push(...outcome.errors.map((e) => ({ ...e, field: `entries[${index}](${entry.requirementId ?? "?"}).${e.field}` })));
    }
  });
  return { ok: true, records, errors };
}

// Materializa el manifiesto PIT auditado: records desde el artifact IMP-03
// más los records enriquecidos del lote, en un buildPitManifest con sus dos
// vistas. Las razones auditadas viajan dentro de los records; el manifiesto
// resultante no declara coberturas nuevas.
export function buildPitManifestFromAudit({
  manifestId,
  manifestVersion,
  entries,
  defaultViewScope,
  viewScopeByRequirement = {},
  extraRecords = [],
  revisions = [],
} = {}) {
  const ingestion = auditedManifestRecords({ entries, defaultViewScope, viewScopeByRequirement });
  if (!ingestion.ok) {
    return ingestion;
  }
  // Un record de ingesta rechazado por el contrato PIT no se descarta en
  // silencio: el manifiesto no se construye y el error sube al caller (§6.2:
  // nada se excluye sin trazabilidad).
  if (ingestion.errors.length > 0) {
    return {
      ok: false,
      errors: ingestion.errors.map((error) => ({ ...error, field: `entries.${error.field}` })),
    };
  }
  return buildPitManifest({
    manifestId,
    manifestVersion,
    records: [...ingestion.records, ...extraRecords],
    revisions,
  });
}

export function buildPitManifest({ manifestId, manifestVersion, records = [], revisions = [] } = {}) {
  const errors = [];
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
      const outcome = buildPitRecord(entry);
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

  // Trazabilidad: revisionOf debe apuntar a versiones existentes del mismo key.
  if (!conflicting) {
    for (const record of builtRecords) {
      if (record.revisionOf === null) {
        continue;
      }
      if (!identity.has(`${record.key}::${record.revisionOf}`)) {
        errors.push({
          field: "records",
          code: "DANGLING_REVISION_OF",
          message: `La versión "${record.revisionId}" de "${record.key}" declara revisionOf "${record.revisionOf}" sin record previo.`,
        });
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
    record.effectiveAtUtc = receipt !== undefined ? receipt.effectiveAtUtc : record.publishedAtUtc;
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    manifest: {
      manifestId,
      manifestVersion,
      records: builtRecords,
      revisions: sortedRevisions,
    },
  };
}


// Relojes separados por vista (§6.1: las dos vistas no comparten reloj):
//  - decision: orden por consumableFromUtc (consumo demostrado). Sin consumo
//    demostrado no hay reloj de decisión: unavailable (§25.1 IMP-06).
//  - evaluation: orden por record.effectiveAtUtc (publicación/receipt),
//    calculado en el manifest.
function timelineForKey(records, key, clockField) {
  const entries = records
    .filter((record) => record.key === key)
    .map((record, index) => ({ record, index, [clockField]: record[clockField] }))
    .filter((entry) => typeof entry[clockField] === "string")
    .sort((left, right) => left[clockField].localeCompare(right[clockField]) || left.index - right.index);
  return entries;
}

// Versión vigente hasta un instante (inclusive): la más reciente por el reloj
// de la vista. Las anteriores quedan superseded versionadas: nunca desaparecen
// (§6.2).
function effectiveEntry(timeline, clockField, cutoffMs) {
  const known = timeline.filter((entry) => Date.parse(entry[clockField]) <= cutoffMs);
  return known.length > 0 ? known[known.length - 1] : null;
}

function parseUtcBoundary(value, field, code) {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) {
    return { ok: false, error: { field, code, reason: `${field} no parseable.` } };
  }
  if (!isUtcAnchored(value)) {
    return { ok: false, error: { field, code: "NOT_UTC_ANCHORED", reason: `${field} requiere zona explícita (UTC u offset declarado, §6.1).` } };
  }
  return { ok: true, ms: Date.parse(value), iso: new Date(Date.parse(value)).toISOString() };
}

// DECISION-TIME VIEW (§6.1): en cada boundary expone únicamente las versiones
// realmente conocidas/consumibles. La policy observa exclusivamente esta vista
// (§14.3): el benchmark cerrado y los outcomes viven en la evaluación y nunca
// aparecen aquí. Tres guardas de §19.2:
//  1. publicado después del boundary => no entra por publicación.
//  2. consumable > boundary o consumo no demostrado => no entra: publicado
//     pero aún no consumible NO entra (§6.1).
//  3. versiones reemplazadas no reaparecen: el State histórico es invariante
//     ante revisiones posteriores (§14.7).
export function readDecisionView(manifest, boundaryUtc) {
  const boundary = parseUtcBoundary(boundaryUtc, "boundary", "INVALID_BOUNDARY");
  if (!boundary.ok) {
    return { ok: false, view: "decision", boundary: boundaryUtc, ...boundary.error };
  }

  const visible = [];
  const suppressed = [];

  // §14.2/§14.3: sólo los inputs de decisión entran; benchmark/outcomes
  // (viewScope "evaluation") quedan fuera de la vista de decisión. La guarda
  // exige "decision" explícito, no la mera ausencia de "evaluation": así un
  // manifest mal formado tampoco cuela un benchmark en la decisión.
  const decisionRecords = manifest.records.filter((record) => record.viewScope === "decision");
  const uniqueKeys = [...new Set(decisionRecords.map((record) => record.key))];

  for (const key of uniqueKeys) {
    const keyRecords = decisionRecords.filter((record) => record.key === key);
    const timeline = timelineForKey(keyRecords, key, "consumableFromUtc");
    const effective = effectiveEntry(timeline, "consumableFromUtc", boundary.ms);
    // Versiones sin reloj de decisión (consumo no demostrado o valor ausente)
    // no están en el timeline pero igual se reportan como unavailable. Las
    // versiones ya reemplazadas en el mismo boundary no se reportan: no
    // informan la decisión y su valor queda en la vista de evaluación (§6.2).

    if (effective !== null) {
      // §14.3 paso 2: exponer sólo lo que satisface P4 en este boundary exacto.
      // La consumibilidad se exige también a la versión vigente: un dato cuyo
      // consumo no está demostrado no entra aunque su reloj sea antiguo.
      const consumabilityNow = isConsumableAtBoundary(effective.record, boundary.iso);
      if (consumabilityNow.consumable) {
        visible.push({
          key,
          value: effective.record.value,
          revisionId: effective.record.revisionId,
          consumableFromUtc: effective.consumableFromUtc,
          semantics: semanticsOf(effective.record),
          proxy: effective.record.proxy,
          proxyId: effective.record.proxyId,
        });
      } else {
        // Razón del record (§6.2): la trazabilidad del faltante auditado no
        // se sustituye por un texto genérico; la guarda específica lo
        // complementa también en la versión vigente por reloj.
        const effectiveReason = typeof effective.record.reason === "string" && effective.record.reason.length > 0
          ? effective.record.reason
          : null;
        suppressed.push({
          key,
          revisionId: effective.record.revisionId,
          reason: effectiveReason !== null ? `${effectiveReason}; ${consumabilityNow.reason}` : consumabilityNow.reason,
        });
      }
    }

    for (const record of keyRecords) {
      if (effective !== null && record === effective.record) {
        continue;
      }
      // Razón del record (§6.2): la trazabilidad del faltante auditado no se
      // sustituye por un texto genérico; la guarda específica lo complementa.
      const recordReason = typeof record.reason === "string" && record.reason.length > 0 ? record.reason : null;
      const publication = record.publishedAtUtc === null ? null : Date.parse(record.publishedAtUtc);
      if (publication !== null && publication > boundary.ms) {
        suppressed.push({
          key,
          revisionId: record.revisionId,
          reason: recordReason !== null ? `${recordReason}; publicado después del boundary` : "publicado después del boundary",
        });
        continue;
      }
      const consumability = isConsumableAtBoundary(record, boundary.iso);
      if (!consumability.consumable) {
        suppressed.push({
          key,
          revisionId: record.revisionId,
          reason: recordReason !== null ? `${recordReason}; ${consumability.reason}` : consumability.reason,
        });
        continue;
      }
      // Las versiones posteriores no existían aún para la policy: no son un
      // "cambio retrospectivo"; simplemente no informan este boundary (§14.7).
      if (effective === null || Date.parse(record.consumableFromUtc) > boundary.ms) {
        suppressed.push({
          key,
          revisionId: record.revisionId,
          reason: recordReason !== null ? `${recordReason}; no conocida en este boundary` : "no conocida en este boundary",
        });
      }
    }
  }

  return { ok: true, view: "decision", boundary: boundary.iso, visible, suppressed };
}

// EVALUATION VIEW (§6.1): outcomes, benchmark cerrado y revisiones de
// evaluación, con su condición posterior explícita. Requiere asOfUtc: la
// vista es versionada, no un estado flotante. La versión vigente se selecciona
// por el reloj de contenido (receipt/publicación), nunca por el reloj de
// consumo de la policy: así una revisión no aparece como actual mientras
// pendingRevisions la declara pendiente. Los contenidos sin publicación ni
// receipt, y los faltantes de valor, se reportan explícitamente como
// unavailable en vez de mostrarse con un valor indefinido (§6.1/§6.2).
export function readEvaluationView(manifest, asOfUtc) {
  const asOf = parseUtcBoundary(asOfUtc, "asOf", "INVALID_AS_OF");
  if (!asOf.ok) {
    return { ok: false, view: "evaluation", ...asOf.error };
  }

  const current = [];
  const superseded = [];
  const unavailable = [];

  const uniqueKeys = [...new Set(manifest.records.map((record) => record.key))];

  for (const key of uniqueKeys) {
    const keyRecords = manifest.records.filter((record) => record.key === key);
    // §6.1: la evaluación no confía en un `effectiveAtUtc` suelto; el contenido
    // debe tener publicación/availability en origen para situarse en el tiempo.
    const contentRecords = keyRecords.filter(
      (record) => record.valueStatus === "PRESENT"
        && typeof record.publishedAtUtc === "string"
        && typeof record.effectiveAtUtc === "string",
    );
    const timeline = timelineForKey(contentRecords, key, "effectiveAtUtc");
    const effective = effectiveEntry(timeline, "effectiveAtUtc", asOf.ms);

    if (effective !== null) {
      current.push({
        key,
        value: effective.record.value,
        revisionId: effective.record.revisionId,
        publishedAtUtc: effective.record.publishedAtUtc,
        consumableAtUtc: effective.record.consumableAtUtc,
        effectiveAtUtc: effective.effectiveAtUtc,
        semantics: semanticsOf(effective.record),
        proxy: effective.record.proxy,
        proxyId: effective.record.proxyId,
        condition: effective.record.revisionOf === null ? "base" : `revised from ${effective.record.revisionOf}`,
      });
      // Las versiones anteriores se conservan versionadas (§6.2).
      for (const entry of timeline) {
        if (entry !== effective && Date.parse(entry.effectiveAtUtc) <= asOf.ms) {
          superseded.push({
            key,
            revisionId: entry.record.revisionId,
            value: entry.record.value,
            effectiveAtUtc: entry.effectiveAtUtc,
            supersededBy: effective.record.revisionId,
          });
        }
      }
    }

    // Faltantes explícitos: valor ausente o contenido sin reloj de evaluación
    // (sin publicación ni receipt). Nunca se muestran como actuales (§6.1/§6.2).
    for (const record of keyRecords) {
      // Razón del record (§6.2): la trazabilidad del faltante auditado no se
      // sustituye por un texto genérico; la guarda específica lo complementa.
      const recordReason = typeof record.reason === "string" && record.reason.length > 0 ? record.reason : null;
      if (record.valueStatus === "MISSING") {
        unavailable.push({
          key,
          revisionId: record.revisionId,
          reason: recordReason !== null ? `${recordReason}; valor ausente; faltante explícito (§6.2)` : "valor ausente; faltante explícito (§6.2)",
        });
      } else if (typeof record.publishedAtUtc !== "string" || typeof record.effectiveAtUtc !== "string") {
        unavailable.push({
          key,
          revisionId: record.revisionId,
          reason: recordReason !== null ? `${recordReason}; sin publicación ni receipt; contenido no disponible para evaluación (§6.1)` : "sin publicación ni receipt; contenido no disponible para evaluación (§6.1)",
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
    unavailable,
    appliedRevisions,
    pendingRevisions,
  };
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
