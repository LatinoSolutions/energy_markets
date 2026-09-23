// Vistas decision-time y evaluation separadas. Fuente: SPEC v1.1.1
// §6.1 (dos vistas; revisión no viaja al pasado; published ≠ consumible),
// §6.2 (revisions crean versiones nuevas, nunca reescriben el histórico),
// §14.3 P6.3 paso 2 (sólo datos que satisfacen P4 en el boundary exacto),
// §14.6/§14.7 (la revisión cambia la versión de evaluación, nunca la decision
// view histórica ni el execution ledger) y §19.2 (detectar revisions futuras
// en State histórico, outcomes futuros usados para decidir y confusión
// decision/evaluation).

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
  // distintos no reescribe el histórico (§6.2).
  const identity = new Map();
  let conflicting = false;
  for (const record of builtRecords) {
    const composite = `${record.key}::${record.revisionId}`;
    const prior = identity.get(composite);
    if (prior !== undefined) {
      conflicting = true;
      errors.push({
        field: "records",
        code: "DUPLICATE_REVISION",
        message: `La versión "${record.revisionId}" de "${record.key}" aparece más de una vez; las revisiones crean versiones nuevas, no reescrituras.`,
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
      builtRevisions.push(outcome.revision);
    });
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  // Reloj de evaluación por record (§6.2): el sello del receipt de revisión
  // cuando el manifest lo declara; si no, la publicación en origen. Es el
  // reloj de contenido vigente, independiente de cuándo la policy pudo
  // consumirlo (las dos vistas no comparten reloj, §6.1).
  const sortedRevisions = [...builtRevisions]
    .sort((left, right) => left.effectiveAtUtc.localeCompare(right.effectiveAtUtc));
  for (const record of builtRecords) {
    const receipt = sortedRevisions.find(
      (revision) => revision.key === record.key && revision.revisionId === record.revisionId,
    );
    record.effectiveAtUtc = receipt !== undefined
      ? receipt.effectiveAtUtc
      : (record.publishedAtUtc ?? record.occurredAtUtc);
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
//  - decision: orden por consumableFromUtc (consumo demostrado, o publicación
//    para consumableAtAnyBoundary). Sin consumo demostrado no hay reloj de
//    decisión: unavailable (§25.1 IMP-06).
//  - evaluation: orden por record.effectiveAtUtc, calculado en el manifest.
function timelineForKey(manifest, key, clockField) {
  const entries = manifest.records
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
// realmente conocidas/consumibles. Tres guardas de §19.2:
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

  const uniqueKeys = [...new Set(manifest.records.map((record) => record.key))];

  for (const key of uniqueKeys) {
    const timeline = timelineForKey(manifest, key, "consumableFromUtc");
    const effective = effectiveEntry(timeline, "consumableFromUtc", boundary.ms);
    // Versiones sin reloj de decisión (consumo no demostrado) no están en el
    // timeline pero igual se reportan como unavailable. Las versiones ya
    // reemplazadas en el mismo boundary no se reportan: no informan la
    // decisión y su valor queda en la vista de evaluación (§6.2).
    const keyRecords = manifest.records.filter((record) => record.key === key);

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
        suppressed.push({
          key,
          revisionId: effective.record.revisionId,
          reason: consumabilityNow.reason,
        });
      }
    }

    for (const record of keyRecords) {
      if (effective !== null && record === effective.record) {
        continue;
      }
      const publication = record.publishedAtUtc === null ? null : Date.parse(record.publishedAtUtc);
      if (publication !== null && publication > boundary.ms) {
        suppressed.push({ key, revisionId: record.revisionId, reason: "publicado después del boundary" });
        continue;
      }
      const consumability = isConsumableAtBoundary(record, boundary.iso);
      if (!consumability.consumable) {
        suppressed.push({ key, revisionId: record.revisionId, reason: consumability.reason });
        continue;
      }
      // Las versiones posteriores no existían aún para la policy: no son un
      // "cambio retrospectivo"; simplemente no informan este boundary (§14.7).
      if (effective === null || Date.parse(record.consumableFromUtc) > boundary.ms) {
        suppressed.push({ key, revisionId: record.revisionId, reason: "no conocida en este boundary" });
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
// pendingRevisions la declara pendiente.
export function readEvaluationView(manifest, asOfUtc) {
  const asOf = parseUtcBoundary(asOfUtc, "asOf", "INVALID_AS_OF");
  if (!asOf.ok) {
    return { ok: false, view: "evaluation", ...asOf.error };
  }

  const current = [];
  const superseded = [];

  const uniqueKeys = [...new Set(manifest.records.map((record) => record.key))];

  for (const key of uniqueKeys) {
    const timeline = timelineForKey(manifest, key, "effectiveAtUtc");
    const effective = effectiveEntry(timeline, "effectiveAtUtc", asOf.ms);
    if (effective === null) {
      continue;
    }
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
