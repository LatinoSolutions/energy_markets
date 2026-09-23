// Vistas decision-time y evaluation separadas. Fuente: SPEC v1.1.1
// §6.1 (dos vistas; revisión no viaja al pasado; published ≠ consumible),
// §6.2 (revisions crean versiones nuevas, nunca reescriben el histórico),
// §14.3 P6.3 paso 2 (sólo datos que satisfacen P4 en el boundary exacto),
// §14.6/§14.7 (la revisión cambia la versión de evaluación, nunca la decision
// view histórica ni el execution ledger) y §19.2 (detectar revisions futuras
// en State histórico, outcomes futuros usados para decidir y confusión
// decision/evaluation).

import { buildPitRecord, isConsumableAtBoundary, semanticsOf } from "./pit-record.mjs";
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
  return {
    ok: true,
    manifest: {
      manifestId,
      manifestVersion,
      records: builtRecords,
      revisions: [...builtRevisions].sort((left, right) => left.effectiveAtUtc.localeCompare(right.effectiveAtUtc)),
    },
  };
}


// knownAtUtc = consumableAtUtc, o en su defecto publishedAtUtc; en el
// manifest auditado siempre existe uno de los dos.
function timelineForKey(manifest, key) {
  const entries = manifest.records
    .filter((record) => record.key === key)
    .map((record) => ({ record, knownAtUtc: record.knownAtUtc }))
    .filter((entry) => typeof entry.knownAtUtc === "string")
    .sort((left, right) => left.knownAtUtc.localeCompare(right.knownAtUtc));
  return entries;
}

// Versión vigente de un key conocido hasta un instante (inclusive): la más
// reciente por knownAtUtc. Las anteriores quedan superseded versionadas:
// nunca desaparecen (§6.2).
function effectiveEntry(timeline, cutoffMs) {
  const known = timeline.filter((entry) => Date.parse(entry.knownAtUtc) <= cutoffMs);
  return known.length > 0 ? known[known.length - 1] : null;
}

// DECISION-TIME VIEW (§6.1): en cada boundary expone únicamente las versiones
// realmente conocidas/consumibles. Tres guardas de §19.2:
//  1. publicado después del boundary => no entra por publicación.
//  2. consumable > boundary o consumo no demostrado => no entra: publicado
//     pero aún no consumible NO entra (§6.1).
//  3. versiones reemplazadas no reaparecen: el State histórico es invariante
//     ante revisiones posteriores (§14.7).
export function readDecisionView(manifest, boundaryUtc) {
  const boundary = Date.parse(boundaryUtc);
  if (!Number.isFinite(boundary)) {
    return { ok: false, view: "decision", boundary: boundaryUtc, code: "INVALID_BOUNDARY", reason: "Boundary no parseable." };
  }

  const visible = [];
  const suppressed = [];

  const uniqueKeys = [...new Set(manifest.records.map((record) => record.key))];

  for (const key of uniqueKeys) {
    const timeline = timelineForKey(manifest, key);
    const effective = effectiveEntry(timeline, boundary);
    if (effective === null) {
      // Ninguna versión conocida/consumible en este boundary.
      for (const entry of timeline) {
        const publication = entry.record.publishedAtUtc === null ? null : Date.parse(entry.record.publishedAtUtc);
        if (publication !== null && publication > boundary) {
          suppressed.push({ key, revisionId: entry.record.revisionId, reason: "publicado después del boundary" });
          continue;
        }
        const consumability = isConsumableAtBoundary(
          entry.record,
          new Date(boundary).toISOString(),
        );
        if (!consumability.consumable) {
          suppressed.push({ key, revisionId: entry.record.revisionId, reason: consumability.reason });
        }
      }
      continue;
    }

    // §14.3 paso 2: exponer sólo lo que satisface P4 en este boundary exacto.
    // La consumibilidad se exige también a la versión vigente: un dato cuyo
    // consumo no está demostrado no entra aunque su knownAt sea antiguo.
    const consumabilityNow = isConsumableAtBoundary(effective.record, new Date(boundary).toISOString());
    if (!consumabilityNow.consumable) {
      suppressed.push({
        key,
        revisionId: effective.record.revisionId,
        reason: consumabilityNow.reason,
      });
      continue;
    }
    visible.push({
      key,
      value: effective.record.value,
      revisionId: effective.record.revisionId,
      knownAtUtc: effective.knownAtUtc,
      semantics: semanticsOf(effective.record),
      proxy: effective.record.proxy,
      proxyId: effective.record.proxyId,
    });

    // Las versiones posteriores no existían aún para la policy: no son un
    // "cambio retrospectivo"; simplemente no informan este boundary.
    for (const entry of timeline) {
      if (entry !== effective && Date.parse(entry.knownAtUtc) > boundary) {
        suppressed.push({ key, revisionId: entry.record.revisionId, reason: "no conocida en este boundary" });
      }
    }
  }

  return { ok: true, view: "decision", boundary: new Date(boundary).toISOString(), visible, suppressed };
}

// EVALUATION VIEW (§6.1): outcomes, benchmark cerrado y revisiones de
// evaluación, con su condición posterior explícita. Requiere asOfUtc: la
// vista es versionada, no un estado flotante.
export function readEvaluationView(manifest, asOfUtc) {
  const asOf = Date.parse(asOfUtc);
  if (!Number.isFinite(asOf)) {
    return { ok: false, view: "evaluation", code: "INVALID_AS_OF", reason: "asOf no parseable." };
  }

  const current = [];
  const superseded = [];

  const uniqueKeys = [...new Set(manifest.records.map((record) => record.key))];

  for (const key of uniqueKeys) {
    const timeline = timelineForKey(manifest, key);
    const effective = effectiveEntry(timeline, asOf);
    if (effective === null) {
      continue;
    }
    current.push({
      key,
      value: effective.record.value,
      revisionId: effective.record.revisionId,
      publishedAtUtc: effective.record.publishedAtUtc,
      consumableAtUtc: effective.record.consumableAtUtc,
      knownAtUtc: effective.knownAtUtc,
      semantics: semanticsOf(effective.record),
      proxy: effective.record.proxy,
      proxyId: effective.record.proxyId,
      condition: effective.record.revisionOf === null ? "base" : `revised from ${effective.record.revisionOf}`,
    });
    // Las versiones anteriores se conservan versionadas (§6.2).
    for (const entry of timeline) {
      if (entry !== effective && Date.parse(entry.knownAtUtc) <= asOf) {
        superseded.push({
          key,
          revisionId: entry.record.revisionId,
          value: entry.record.value,
          knownAtUtc: entry.knownAtUtc,
          supersededBy: effective.record.revisionId,
        });
      }
    }
  }

  const appliedRevisions = manifest.revisions
    .filter((revision) => Date.parse(revision.effectiveAtUtc) <= asOf)
    .map((revision) => ({ ...revision }));

  const pendingRevisions = manifest.revisions
    .filter((revision) => Date.parse(revision.effectiveAtUtc) > asOf)
    .map((revision) => ({ ...revision, status: "pendiente en este asOf" }));

  return {
    ok: true,
    view: "evaluation",
    asOf: new Date(asOf).toISOString(),
    current,
    superseded,
    appliedRevisions,
    pendingRevisions,
  };
}

// Entrega las dos vistas separadas para un boundary/asOf idéntico. Lauestra
// separación explícita evita confundir ambas en los tests de §19.2.
export function viewsAt(manifest, boundaryUtc) {
  return {
    decision: readDecisionView(manifest, boundaryUtc),
    evaluation: readEvaluationView(manifest, boundaryUtc),
  };
}

export { VIEW_KINDS };
