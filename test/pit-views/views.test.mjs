import { test } from "node:test";
import assert from "node:assert/strict";

import {
  auditedManifestRecords,
  buildPitManifest,
  buildPitManifestFromAudit,
  buildRevision,
  presentInMarketZone,
  readDecisionView,
  readEvaluationView,
  toUtcTimestamp,
  viewsAt,
} from "../../src/pit-views/index.mjs";

// Criterio IMP-06 (§25.1): "Un dato publicado pero aún no consumible no entra;
// revisión futura no cambia State histórico." Tests de decision/evaluation
// views, UTC, consumibilidad y revisiones exigidos por §6. Fixtures
// explícitamente sintéticos; el módulo no declara cobertura de datos real
// (§25.2 IMP-06: materializa sin declarar nuevas coberturas).

const BASE = {
  key: "G0BQ.202604.reference",
  viewScope: "decision",
  occurredAtUtc: "2026-03-31T17:15:00Z",
  publishedAtUtc: "2026-03-31T18:00:00Z",
  consumableAtUtc: "2026-04-01T06:00:00Z",
  // Fixture sintético de evidencia contemporánea: identifica el log de
  // ingesta donde quedó demostrado el consumo. No es cobertura real.
  consumableEvidence: {
    source: "fixture://ingest-log",
    locator: "row G0BQ.202604 @ 2026-04-01T06:00Z",
    sha256: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  },
  revisionId: "v1",
  value: 24.35,
};

const WITH_BENCHMARK = {
  key: "B.G0BQ.202604.closed",
  viewScope: "evaluation",
  occurredAtUtc: "2026-06-30T17:15:00Z",
  publishedAtUtc: "2026-07-01T06:00:00Z",
  consumableAtUtc: "2026-07-01T06:30:00Z",
  consumableEvidence: BASE.consumableEvidence,
  revisionId: "bench-v1",
  value: 25.7,
};

function buildManifest({ records, revisions = [] } = {}) {
  return buildPitManifest({
    manifestId: "PIT-MANIFEST-FIXTURE",
    manifestVersion: "v1",
    records: records ?? [BASE],
    revisions,
  });
}

test("buildPitManifest valida identidad y contenido de records/revisions", () => {
  const outcome = buildManifest({ records: [{ ...BASE, revisionId: "" }] });
  assert.equal(outcome.ok, false);
  assert.equal(outcome.errors[0].code, "MISSING_REVISION");
});

test("buildRevision exige revisionId, key y effectiveAtUtc con zona explícita", () => {
  const naive = buildRevision({ key: "k", revisionId: "v2", effectiveAtUtc: "2026-04-02T06:00:00" });
  assert.equal(naive.ok, false);
  assert.ok(naive.errors.some((e) => e.code === "NOT_UTC_ANCHORED"));
  const ok = buildRevision({ key: "k", revisionId: "v2", effectiveAtUtc: "2026-04-02T06:00:00+02:00" });
  assert.equal(ok.ok, true);
  assert.equal(ok.revision.effectiveAtUtc, "2026-04-02T04:00:00.000Z");
});

test("un revision receipt sin record materializado no acredita la revisión", () => {
  const outcome = buildManifest({ records: [BASE] });
  const ghost = buildRevision({
    key: BASE.key,
    revisionId: "v9",
    revisesRevisionId: "v1",
    effectiveAtUtc: "2026-04-20T10:00:00Z",
  });
  const withGhost = buildPitManifest({
    manifestId: "M",
    manifestVersion: "v2",
    records: outcome.manifest.records,
    revisions: [ghost.revision],
  });
  assert.equal(withGhost.ok, false);
  assert.equal(withGhost.errors[0].code, "REVISION_WITHOUT_RECORD");
});

test("(key, revisionId) duplicado se rechaza: las revisiones crean versiones nuevas", () => {
  const outcome = buildManifest({ records: [BASE, { ...BASE, value: 99 }] });
  assert.equal(outcome.ok, false);
  assert.ok(outcome.errors.some((e) => e.code === "DUPLICATE_REVISION"));
});

test("revisionOf colgante se rechaza: la cadena de versiones es trazable", () => {
  const outcome = buildManifest({
    records: [{ ...BASE, revisionId: "v2", revisionOf: "v1-perdido" }],
  });
  assert.equal(outcome.ok, false);
  assert.ok(outcome.errors.some((e) => e.code === "DANGLING_REVISION_OF"));
});

// --- Aceptación: publicado pero aún no consumible NO entra ---

test("consumible después del boundary: no entra, la razón se preserva", () => {
  const view = readDecisionView(buildManifest().manifest, "2026-03-31T18:30:00Z");
  assert.equal(view.visible.length, 0);
  assert.deepEqual(view.suppressed, [
    { key: BASE.key, revisionId: "v1", reason: "aún no consumible en este boundary" },
  ]);
});

test("publicado después del boundary: no entra por publicación", () => {
  const outcome = buildManifest({
    records: [{ ...BASE, publishedAtUtc: "2026-04-05T18:00:00Z", consumableAtUtc: "2026-04-05T18:05:00Z" }],  });
  const view = readDecisionView(outcome.manifest, "2026-04-05T17:59:59Z");
  assert.equal(view.visible.length, 0);
  assert.equal(view.suppressed[0].reason, "publicado después del boundary");
});

test("sin prueba de consumo demostrado: el record se conserva unavailable y no entra a la decisión (§6.1)", () => {
  const outcome = buildManifest({
    records: [{ ...BASE, consumableAtUtc: undefined }],
  });
  assert.equal(outcome.ok, true);
  const record = outcome.manifest.records[0];
  assert.equal(record.consumability, "unavailable");
  const view = readDecisionView(outcome.manifest, "2026-04-01T23:00:00Z");
  assert.equal(view.visible.length, 0);
  assert.match(view.suppressed[0].reason, /no demostrado/);
  // La evaluación usa el reloj de contenido (publicación/receipt), no el de
  // consumo: el dato publicado es visible ahí como outcome (§6.1 vistas
  // separadas), mientras la decisión lo mantiene unavailable.
  const evaluation = readEvaluationView(outcome.manifest, "2026-04-02T00:00:00Z");
  assert.equal(evaluation.current.length, 1);
  assert.equal(evaluation.current[0].revisionId, "v1");
});

test("publicado y consumible antes del boundary: entra con sus cuatro semánticas", () => {
  const view = readDecisionView(buildManifest().manifest, "2026-04-01T07:00:00Z");
  assert.equal(view.visible.length, 1);
  const row = view.visible[0];
  assert.equal(row.value, 24.35);
  assert.equal(row.revisionId, "v1");
  assert.equal(row.semantics.publishedAtUtc, "2026-03-31T18:00:00.000Z");
  assert.equal(row.semantics.consumableAtUtc, "2026-04-01T06:00:00.000Z");
});

test("el boundary exacto del consumo ya ve el dato; un ms antes no (§14.3 paso 2)", () => {
  const manifest = buildManifest().manifest;
  assert.equal(readDecisionView(manifest, "2026-04-01T06:00:00Z").visible.length, 1);
  assert.equal(readDecisionView(manifest, "2026-04-01T05:59:59.999Z").visible.length, 0);
});

// --- Aceptación: revisión futura no cambia el State histórico ---

function revisedRecords() {
  return [
    BASE,
    {
      ...BASE,
      revisionId: "v2",
      revisionOf: "v1",
      publishedAtUtc: "2026-04-20T10:00:00Z",
      consumableAtUtc: "2026-04-20T10:30:00Z",
      value: 25.1,
    },
  ];
}

test("la revisión entra en decisión sólo cuando es consumible; antes no existe para la policy", () => {
  const manifest = buildManifest({ records: revisedRecords() }).manifest;
  const before = readDecisionView(manifest, "2026-04-10T12:00:00Z");
  assert.equal(before.visible[0].revisionId, "v1");
  assert.equal(before.visible[0].value, 24.35);

  const after = readDecisionView(manifest, "2026-04-20T11:00:00Z");
  assert.equal(after.visible[0].revisionId, "v2");
  assert.equal(after.visible[0].value, 25.1);
});

test("la revisión vigente en evaluación coincide con appliedRevisions, no con pendingRevisions (§6.1/§6.2)", () => {
  // Receipt declara que v2 es efectiva recién a las 11:30, después del asOf:
  // aunque el record v2 esté publicado/consumible antes, la evaluación no lo
  // muestra como contenido vigente en este asOf.
  const receipt = buildRevision({
    key: BASE.key,
    revisionId: "v2",
    revisesRevisionId: "v1",
    effectiveAtUtc: "2026-04-20T11:30:00Z",
  });
  const manifest = buildManifest({ records: revisedRecords(), revisions: [receipt.revision] }).manifest;

  const at10 = readEvaluationView(manifest, "2026-04-20T10:45:00Z");
  assert.equal(at10.current[0].revisionId, "v1");
  assert.equal(at10.pendingRevisions.length, 1);
  assert.equal(at10.appliedRevisions.length, 0);

  // La decisión sigue su propio reloj: v2 era consumible desde las 10:30.
  // La evaluación exige coherencia con el receipt de contenido (§6.2): v2
  // recién es vigente a las 11:30, cuando appliedRevisions lo declara.
  const decisionAt1045 = readDecisionView(manifest, "2026-04-20T10:45:00Z");
  assert.equal(decisionAt1045.visible[0].revisionId, "v2");

  const at12 = readEvaluationView(manifest, "2026-04-20T12:00:00Z");
  assert.equal(at12.current[0].revisionId, "v2");
  assert.deepEqual(at12.appliedRevisions.map((r) => r.revisionId), ["v2"]);
});

test("revisión futura no reescribe el State histórico: mismo boundary, misma lectura", () => {
  const original = readDecisionView(buildManifest().manifest, "2026-04-02T00:00:00Z");
  const revised = readDecisionView(buildManifest({ records: revisedRecords() }).manifest, "2026-04-02T00:00:00Z");
  assert.deepEqual(
    JSON.parse(JSON.stringify(revised.visible)),
    JSON.parse(JSON.stringify(original.visible)),
  );
});

test("la evaluación es versionada: asOf anterior ve la versión base, asOf posterior la revisada", () => {
  const manifest = buildManifest({ records: revisedRecords() }).manifest;
  const before = readEvaluationView(manifest, "2026-04-19T23:59:59Z");
  assert.equal(before.current[0].revisionId, "v1");
  assert.equal(before.current[0].condition, "base");

  const after = readEvaluationView(manifest, "2026-04-20T10:30:01Z");
  assert.equal(after.current[0].revisionId, "v2");
  assert.equal(after.current[0].condition, "revised from v1");
  assert.deepEqual(after.superseded, [{
    key: BASE.key,
    revisionId: "v1",
    value: 24.35,
    effectiveAtUtc: "2026-03-31T18:00:00.000Z",
    supersededBy: "v2",
  }]);
});

test("la versión anterior no desaparece: la evaluación con asOf previo la conserva intacta", () => {
  const manifest = buildManifest({ records: revisedRecords() }).manifest;
  const prior = readEvaluationView(manifest, "2026-04-19T23:59:59Z").current[0];
  const later = readEvaluationView(manifest, "2026-04-20T10:30:01Z");
  assert.equal(prior.revisionId, "v1");
  assert.equal(later.superseded[0].value, 24.35);
  assert.equal(later.superseded[0].value, prior.value);
});

test("dos revisiones encadenadas: v1 -> v2 -> v3 queda trazable y versionada", () => {
  const manifest = buildManifest({
    records: [
      BASE,
      { ...BASE, revisionId: "v2", revisionOf: "v1", publishedAtUtc: "2026-04-20T10:00:00Z", consumableAtUtc: "2026-04-20T10:30:00Z", value: 25.1 },
      { ...BASE, revisionId: "v3", revisionOf: "v2", publishedAtUtc: "2026-05-02T10:00:00Z", consumableAtUtc: "2026-05-02T10:30:00Z", value: 24.9 },
    ],
  }).manifest;

  const mid = readDecisionView(manifest, "2026-04-25T00:00:00Z");
  assert.equal(mid.visible[0].revisionId, "v2");

  const end = readEvaluationView(manifest, "2026-05-03T00:00:00Z");
  assert.equal(end.current[0].revisionId, "v3");
  assert.equal(end.superseded.length, 2);
  assert.deepEqual(end.superseded.map((entry) => entry.revisionId), ["v1", "v2"]);
});

test("las revisiones pending en un asOf no se aplican ni se Retrieved como actuales", () => {
  const manifest = buildManifest({ records: revisedRecords() }).manifest;
  const receipt = buildRevision({
    key: BASE.key,
    revisionId: "v2",
    revisesRevisionId: "v1",
    effectiveAtUtc: "2026-04-20T10:30:00Z",
  });
  const withReceipt = buildManifest({
    records: revisedRecords(),
    revisions: [receipt.revision],
  }).manifest;
  const before = readEvaluationView(withReceipt, "2026-04-19T23:59:59Z");
  assert.equal(before.pendingRevisions.length, 1);
  assert.equal(before.appliedRevisions.length, 0);
});

// --- Cuatro semánticas y UTC ---

test("occurred futoro no bloquea: el vintage consumible entonces es input de decisión (§6.1)", () => {
  const outcome = buildManifest({
    records: [{
      key: "forecast.202606.settlement",
      viewScope: "decision",
      occurredAtUtc: "2026-06-30T17:15:00Z",
      publishedAtUtc: "2026-04-01T06:00:00Z",
      consumableAtUtc: "2026-04-01T06:30:00Z",
      consumableEvidence: BASE.consumableEvidence,
      revisionId: "vintage-2026-04-01",
      value: 25.1,
    }],
  });
  const view = readDecisionView(outcome.manifest, "2026-04-01T07:00:00Z");
  assert.equal(view.visible.length, 1);
});

test("los timestamps de máquina quedan almacenados en UTC Z", () => {
  const record = buildManifest().manifest.records[0];
  for (const key of ["occurredAtUtc", "publishedAtUtc", "consumableAtUtc", "consumableFromUtc", "effectiveAtUtc"]) {
    if (record[key] !== null) {
      assert.equal(record[key].endsWith("Z"), true, key);
    }
  }
  const normalized = toUtcTimestamp("2026-04-01T08:00:00+02:00");
  assert.equal(normalized.ok, true);
  assert.equal(normalized.utc, "2026-04-01T06:00:00.000Z");
});

test("boundary sin zona explícita se rechaza: presumir UTC oculta el origen (§6.1)", () => {
  const outcome = readDecisionView(buildManifest().manifest, "2026-04-01T06:00:00");
  assert.equal(outcome.ok, false);
  assert.equal(outcome.code, "NOT_UTC_ANCHORED");
  // Un offset explícito sí es zona declarada: se normaliza sin presumir.
  const withOffset = readDecisionView(buildManifest().manifest, "2026-04-01T08:00:00+02:00");
  assert.equal(withOffset.ok, true);
  assert.equal(withOffset.boundary, "2026-04-01T06:00:00.000Z");
  assert.equal(withOffset.visible.length, 1);
});

test("asOf sin zona explícita se rechaza en evaluation", () => {
  const outcome = readEvaluationView(buildManifest().manifest, "2026-04-02T00:00:00");
  assert.equal(outcome.ok, false);
  assert.equal(outcome.code, "NOT_UTC_ANCHORED");
});

test("la conversión a zona de mercado es presentación: no cambia la consumibilidad", () => {
  const manifest = buildManifest().manifest;
  const boundaryUtc = "2026-04-01T06:00:00Z";
  const before = readDecisionView(manifest, boundaryUtc);
  const presented = presentInMarketZone(boundaryUtc, "Europe/Berlin");
  assert.equal(presented.ok, true);
  // El boundary exacto se preserva como instante; el formato puede llevar ms.
  assert.equal(Date.parse(presented.utc), Date.parse(boundaryUtc));
  const after = readDecisionView(manifest, presented.utc);
  assert.deepEqual(
    JSON.parse(JSON.stringify(after.visible)),
    JSON.parse(JSON.stringify(before.visible)),
  );
});

test("presentInMarketZone rechaza timestamp inválido y zona desconocida", () => {
  assert.equal(presentInMarketZone("not-a-date", "Europe/Berlin").ok, false);
  assert.equal(presentInMarketZone("2026-04-01T06:00:00Z", "Mars/Olympus").ok, false);
});

// --- Separación de vistas (§19.2) ---

test("viewsAt entrega las dos vistas separadas para el mismo boundary", () => {
  const pair = viewsAt(buildManifest().manifest, "2026-04-02T00:00:00Z");
  assert.equal(pair.decision.view, "decision");
  assert.equal(pair.evaluation.view, "evaluation");
  assert.equal(pair.decision.visible.length, 1);
  assert.equal(pair.evaluation.current.length, 1);
});

test("el benchmark cerrado permanece en la vista de evaluación y nunca en la decisión (§14.2/§14.3)", () => {
  const manifest = buildManifest({ records: [BASE, WITH_BENCHMARK] }).manifest;
  const early = viewsAt(manifest, "2026-05-01T00:00:00Z");
  assert.equal(early.decision.visible.length, 1); // sólo el precio
  assert.equal(early.evaluation.current.length, 1);

  const afterClose = viewsAt(manifest, "2026-07-02T00:00:00Z");
  // El benchmark ya está cerrado/publicado, pero la policy observa sólo el
  // historical decision view: no entra a la decisión ni después del cierre.
  assert.equal(afterClose.decision.visible.length, 1);
  assert.equal(afterClose.evaluation.current.length, 2);
  assert.deepEqual(
    afterClose.evaluation.current.map((row) => row.key).sort(),
    [BASE.key, WITH_BENCHMARK.key].sort(),
  );
});

test("sin publicación no se usa occurredAtUtc para mostrar contenido en evaluación (§6.1)", () => {
  const outcome = buildManifest({
    records: [{
      key: "outcome.202606.settlement",
      viewScope: "decision",
      occurredAtUtc: "2026-06-30T17:15:00Z",
      publishedAtUtc: undefined,
      consumableAtUtc: undefined,
      revisionId: "v1",
      value: 25.1,
    }],
  });
  assert.equal(outcome.ok, true);
  const evaluation = readEvaluationView(outcome.manifest, "2026-12-31T00:00:00Z");
  assert.equal(evaluation.current.length, 0);
  assert.equal(evaluation.unavailable.length, 1);
  assert.match(evaluation.unavailable[0].reason, /sin publicación/);
  assert.equal(readDecisionView(outcome.manifest, "2026-12-31T00:00:00Z").visible.length, 0);
});

test("un receipt no puede hacer efectiva una revisión antes de publicarse la versión (§6.1)", () => {
  const receipt = buildRevision({
    key: BASE.key,
    revisionId: "v2",
    revisesRevisionId: "v1",
    effectiveAtUtc: "2026-04-20T09:00:00Z",
  });
  const outcome = buildManifest({ records: revisedRecords(), revisions: [receipt.revision] });
  assert.equal(outcome.ok, false);
  assert.ok(outcome.errors.some((e) => e.code === "REVISION_EFFECTIVE_BEFORE_PUBLICATION"));
});

test("una revisión sin publicación en origen no se materializa: el receipt no sustituye la publicación (§6.1)", () => {
  const receipt = buildRevision({
    key: BASE.key,
    revisionId: "v2",
    revisesRevisionId: "v1",
    effectiveAtUtc: "2026-04-20T10:30:00Z",
  });
  const records = revisedRecords().map((record) => (
    record.revisionId === "v2" ? { ...record, publishedAtUtc: null, consumableAtUtc: null } : record
  ));
  const outcome = buildManifest({ records, revisions: [receipt.revision] });
  assert.equal(outcome.ok, false);
  assert.ok(outcome.errors.some((e) => e.code === "REVISION_WITHOUT_PUBLICATION"));
});

test("entradas auditadas MISSING se materializan como unavailable en ambas vistas (§25.2)", () => {
  const missing = {
    key: "R-04",
    viewScope: "decision",
    revisionId: null,
    value: null,
    occurredAtUtc: null,
    publishedAtUtc: null,
    consumableAtUtc: null,
    reason: "No price/trade/order-book series present.",
  };
  const outcome = buildManifest({ records: [BASE, missing] });
  assert.equal(outcome.ok, true);
  const pair = viewsAt(outcome.manifest, "2026-04-02T00:00:00Z");
  assert.equal(pair.decision.visible.length, 1);
  assert.ok(pair.decision.suppressed.some((row) => row.key === "R-04" && /valor ausente/.test(row.reason)));
  assert.equal(pair.evaluation.current.length, 1);
  assert.ok(pair.evaluation.unavailable.some((row) => row.key === "R-04"));
});

test("un registro consumible sin value no se expone visible y se marca el faltante (§6.2)", () => {
  const outcome = buildManifest({
    records: [BASE, { ...BASE, key: "G0BQ.202604.volume", revisionId: "vol-v1", value: undefined }],
  });
  assert.equal(outcome.ok, true);
  const pair = viewsAt(outcome.manifest, "2026-04-02T00:00:00Z");
  assert.equal(pair.decision.visible.length, 1);
  assert.ok(pair.decision.suppressed.some((row) => row.key === "G0BQ.202604.volume" && /valor ausente/.test(row.reason)));
  assert.ok(pair.evaluation.unavailable.some((row) => row.key === "G0BQ.202604.volume"));
});

test("readDecisionView sólo admite viewScope 'decision' explícito: un benchmark no declarado no entra", () => {
  const decisionRecord = {
    key: "price", viewScope: "decision", value: 1, valueStatus: "PRESENT",
    occurredAtUtc: null, publishedAtUtc: "2026-04-01T00:00:00.000Z",
    consumableAtUtc: "2026-04-01T06:00:00.000Z", consumableFromUtc: "2026-04-01T06:00:00.000Z",
    effectiveAtUtc: "2026-04-01T00:00:00.000Z", revisionId: "v1", revisionOf: null,
    proxy: false, proxyId: null,
  };
  const undeclaredBenchmark = { ...decisionRecord, key: "bench", value: 2, revisionId: "b1", viewScope: undefined };
  const manifest = { manifestId: "M", manifestVersion: "v1", records: [decisionRecord, undeclaredBenchmark], revisions: [] };
  const view = readDecisionView(manifest, "2026-04-02T00:00:00Z");
  assert.deepEqual(view.visible.map((row) => row.key), ["price"]);
});

test("readEvaluationView no muestra contenido sin publicación aunque traiga effectiveAtUtc (§6.1)", () => {
  const record = {
    key: "outcome", viewScope: "evaluation", value: 9, valueStatus: "PRESENT",
    occurredAtUtc: "2026-06-30T17:15:00.000Z", publishedAtUtc: null,
    consumableAtUtc: null, consumableFromUtc: null,
    effectiveAtUtc: "2026-06-30T17:15:00.000Z", revisionId: "v1", revisionOf: null,
    proxy: false, proxyId: null,
  };
  const manifest = { manifestId: "M", manifestVersion: "v1", records: [record], revisions: [] };
  const view = readEvaluationView(manifest, "2026-12-31T00:00:00Z");
  assert.equal(view.current.length, 0);
  assert.equal(view.unavailable.length, 1);
  assert.match(view.unavailable[0].reason, /sin publicación/);
});

test("readDecisionView rechaza boundary no parseable y exige vista separada", () => {
  const outcome = readDecisionView(buildManifest().manifest, " Boundary inválido ");
  assert.equal(outcome.ok, false);
  assert.equal(outcome.code, "INVALID_BOUNDARY");
});

// --- Materialización del manifiesto auditado de IMP-03 (§25.1/§25.2 IMP-06) ---

// Fixture con la misma forma que operations/audit/IMP-03/temporal-manifest.json
// (IMP-03_TEMPORAL_MANIFEST): 17 entradas R-01..R-17, semánticas MISSING con
// razón auditada y HISTORICAL_ASSERTION en R-06/R-11. Copia sintética mínima:
// el test no lee el artifact real, la forma la fija el artifact auditado.
const AUDITED_ENTRIES = [
  {
    requirementId: "R-01",
    requirement: "Eligible Gas Quarterly campaign list and exact campaign dates",
    occurredReferenceTime: { status: "MISSING", value: null, reason: "No campaign dataset exists; exact list is populated later from the audited dataset (S-08 p.5)." },
    publicationSourceAvailabilityTime: { status: "MISSING", value: null },
    policyConsumableTime: { status: "MISSING", value: null },
    revisionVersion: { status: "MISSING", value: null },
  },
  {
    requirementId: "R-04",
    requirement: "Execution price series at eligible decision boundaries for the exact Gas Quarterly contract",
    occurredReferenceTime: { status: "MISSING", value: null, reason: "No price/trade/order-book series present in the workspace." },
    publicationSourceAvailabilityTime: { status: "MISSING", value: null },
    policyConsumableTime: { status: "MISSING", value: null },
    revisionVersion: { status: "MISSING", value: null },
  },
  {
    requirementId: "R-06",
    requirement: "Benchmark B reference prices (official EEX settlement or derived provisional) per trading date",
    occurredReferenceTime: {
      status: "HISTORICAL_ASSERTION",
      value: "One reference per trading date (methodology only)",
      evidence: { path: "reference/documentation/eex-reference-price.md", sha256: "dfa9cfc8e84f27ea5440ff6c5968654999b71e0c6c7370ec6653178c8e71e260", locator: "§3 L74-98" },
    },
    publicationSourceAvailabilityTime: { status: "MISSING", value: null, note: "EEX official publication timing is described as a rule, not demonstrated by a present feed." },
    policyConsumableTime: { status: "MISSING", value: null },
    revisionVersion: { status: "MISSING", value: null },
  },
];

test("auditedManifestRecords materializa el manifiesto auditado de IMP-03 sin inventar valores", () => {
  const outcome = auditedManifestRecords({ entries: AUDITED_ENTRIES, defaultViewScope: "decision" });
  assert.equal(outcome.ok, true);
  assert.equal(outcome.errors.length, 0);
  assert.equal(outcome.records.length, 3);
  const r01 = outcome.records.find((record) => record.key === "R-01");
  // MISSING: sin timestamp ni valor; la razón auditada se preserva (§6.2).
  assert.equal(r01.valueStatus, "MISSING");
  assert.equal(r01.occurredAtUtc, null);
  assert.equal(r01.publishedAtUtc, null);
  assert.equal(r01.consumableAtUtc, null);
  assert.equal(r01.consumability, "unavailable");
  assert.equal(r01.reason, "No campaign dataset exists; exact list is populated later from the audited dataset (S-08 p.5).");
  const r06 = outcome.records.find((record) => record.key === "R-06");
  // HISTORICAL_ASSERTION: procedencia documental conservada, no se relabela
  // como timestamp ni como valor de mercado (§6.2).
  assert.equal(r06.occurredAtUtc, null);
  assert.equal(r06.valueStatus, "MISSING");
  assert.equal(r06.historicalAssertion.assertion, "One reference per trading date (methodology only)");
  assert.equal(r06.historicalAssertion.evidence.sha256, "dfa9cfc8e84f27ea5440ff6c5968654999b71e0c6c7370ec6653178c8e71e260");
});

test("auditedManifestRecords exige defaultViewScope: el artifact no trae viewScope por entrada", () => {
  const outcome = auditedManifestRecords({ entries: AUDITED_ENTRIES });
  assert.equal(outcome.ok, false);
  assert.equal(outcome.errors[0].code, "MISSING_VIEW_SCOPE");
});

test("buildPitManifestFromAudit construye el manifiesto con las dos vistas desde el audit", () => {
  const outcome = buildPitManifestFromAudit({
    manifestId: "PIT-MANIFEST-IMP-03",
    manifestVersion: "v1",
    entries: AUDITED_ENTRIES,
    defaultViewScope: "decision",
  });
  assert.equal(outcome.ok, true);
  assert.equal(outcome.manifest.records.length, 3);
  const pair = viewsAt(outcome.manifest, "2026-04-02T00:00:00Z");
  // Nada es consumible: el audit no demostró consumo. Todo queda unavailable
  // con su razón auditada visible; no se declara cobertura nueva (§25.2).
  assert.equal(pair.decision.visible.length, 0);
  assert.equal(pair.decision.suppressed.length, 3);
  const r04 = pair.decision.suppressed.find((row) => row.key === "R-04");
  assert.match(r04.reason, /No price\/trade\/order-book series present in the workspace/);
  assert.ok(pair.evaluation.unavailable.some((row) => row.key === "R-04" && /No price\/trade\/order-book series/.test(row.reason)));
});

// --- Razón auditada preservada en las vistas (§6.2, review) ---

test("la vista de decisión preserva la razón auditada del record, no la sustituye por texto genérico", () => {
  const auditedMissing = {
    ...BASE,
    key: "R-04.exec",
    value: null,
    reason: "No price/trade/order-book series present in the workspace.",
  };
  const manifest = buildManifest({ records: [BASE, auditedMissing] }).manifest;
  const view = readDecisionView(manifest, "2026-04-02T00:00:00Z");
  const suppressed = view.suppressed.find((row) => row.key === "R-04.exec");
  assert.ok(suppressed);
  assert.match(suppressed.reason, /No price\/trade\/order-book series present in the workspace/);
  // La guarda específica complementa la razón; no la reemplaza.
  assert.match(suppressed.reason, /valor ausente/);
});

test("la vista de evaluación preserva la razón auditada del record en unavailable", () => {
  const auditedMissing = {
    ...BASE,
    key: "R-04.exec",
    value: null,
    reason: "No price/trade/order-book series present in the workspace.",
  };
  const manifest = buildManifest({ records: [BASE, auditedMissing] }).manifest;
  const evaluation = readEvaluationView(manifest, "2026-04-02T00:00:00Z");
  const row = evaluation.unavailable.find((entry) => entry.key === "R-04.exec");
  assert.ok(row);
  assert.match(row.reason, /No price\/trade\/order-book series present in the workspace/);
});

test("sin razón auditada el texto de guarda se mantiene como antes", () => {
  const manifest = buildManifest({ records: [BASE, { ...BASE, key: "plain", value: null }] }).manifest;
  const view = readDecisionView(manifest, "2026-04-02T00:00:00Z");
  const suppressed = view.suppressed.find((row) => row.key === "plain");
  assert.equal(suppressed.reason, "valor ausente; faltante explícito (§6.2)");
});

// --- Lineage receipt/record coherente (§6.2, review) ---

test("receipt cuyo revisesRevisionId contradice el revisionOf del record se rechaza", () => {
  // Caso de review: record con revisionOf "v1" y receipt que declara revisar
  // "not-v1". El lineage del receipt y del record deben coincidir: aceptar la
  // contradicción sería doble verdad sobre qué versión corrige cuál.
  const records = [
    BASE,
    { ...BASE, revisionId: "v2", revisionOf: "v1", publishedAtUtc: "2026-04-20T10:00:00Z", consumableAtUtc: "2026-04-20T10:30:00Z", value: 25.1 },
  ];
  const receipt = buildRevision({
    key: BASE.key,
    revisionId: "v2",
    revisesRevisionId: "not-v1",
    effectiveAtUtc: "2026-04-20T11:30:00Z",
  });
  const outcome = buildPitManifest({
    manifestId: "M",
    manifestVersion: "v1",
    records,
    revisions: [receipt.revision],
  });
  assert.equal(outcome.ok, false);
  assert.ok(outcome.errors.some((e) => e.code === "REVISION_LINEAGE_MISMATCH"));
});

test("receipt coherente con el revisionOf del record se acepta", () => {
  const receipt = buildRevision({
    key: BASE.key,
    revisionId: "v2",
    revisesRevisionId: "v1",
    effectiveAtUtc: "2026-04-20T11:30:00Z",
  });
  const outcome = buildPitManifest({
    manifestId: "M",
    manifestVersion: "v1",
    records: revisedRecords(),
    revisions: [receipt.revision],
  });
  assert.equal(outcome.ok, true);
  assert.equal(outcome.manifest.revisions.length, 1);
});

test("receipt sin revisesRevisionId sobre un record con revisionOf se rechaza (lineage incompleto)", () => {
  const receipt = buildRevision({
    key: BASE.key,
    revisionId: "v2",
    effectiveAtUtc: "2026-04-20T11:30:00Z",
  });
  const outcome = buildPitManifest({
    manifestId: "M",
    manifestVersion: "v1",
    records: revisedRecords(),
    revisions: [receipt.revision],
  });
  assert.equal(outcome.ok, false);
  assert.ok(outcome.errors.some((e) => e.code === "REVISION_LINEAGE_MISMATCH"));
});

test("la versión vigente por reloj pero no consumible también preserva la razón auditada", () => {
  // Rama de review: record vigente por consumableFromUtc pero cuya
  // consumibilidad falla en el boundary exacto. La razón auditada no se
  // sustituye por el texto genérico de la guarda (§6.2).
  const delayed = {
    ...BASE,
    key: "R-04.exec",
    revisionId: "v1",
    consumableAtUtc: "2026-04-05T06:00:00Z",
    reason: "No price/trade/order-book series present in the workspace.",
  };
  const manifest = buildManifest({ records: [delayed] }).manifest;
  const view = readDecisionView(manifest, "2026-04-02T00:00:00Z");
  assert.equal(view.visible.length, 0);
  const suppressed = view.suppressed.find((row) => row.key === "R-04.exec");
  assert.ok(suppressed);
  assert.match(suppressed.reason, /No price\/trade\/order-book series present in the workspace/);
  assert.match(suppressed.reason, /aún no consumible en este boundary/);
});

test("un receipt duplicado (mismo key y revisionId) se rechaza: cada revisión se registra una vez", () => {
  const receipt = buildRevision({
    key: BASE.key,
    revisionId: "v2",
    revisesRevisionId: "v1",
    effectiveAtUtc: "2026-04-20T11:30:00Z",
  });
  const outcome = buildPitManifest({
    manifestId: "M",
    manifestVersion: "v1",
    records: revisedRecords(),
    revisions: [receipt.revision, { ...receipt.revision }],
  });
  assert.equal(outcome.ok, false);
  assert.ok(outcome.errors.some((e) => e.code === "DUPLICATE_REVISION_RECEIPT"));
});

test("buildPitManifestFromAudit no descarta entradas inválidas en silencio: el error sube al caller", () => {
  const badEntries = [
    ...AUDITED_ENTRIES,
    {
      requirementId: "R-99",
      requirement: "Entrada hostil con timestamp sin zona",
      occurredReferenceTime: { status: "PRESENT", value: "2026-03-31T17:15:00" },
      publicationSourceAvailabilityTime: { status: "MISSING", value: null },
      policyConsumableTime: { status: "MISSING", value: null },
      revisionVersion: { status: "MISSING", value: null },
    },
  ];
  const outcome = buildPitManifestFromAudit({
    manifestId: "PIT-MANIFEST-IMP-03",
    manifestVersion: "v1",
    entries: badEntries,
    defaultViewScope: "decision",
  });
  assert.equal(outcome.ok, false);
  assert.ok(outcome.errors.some((e) => e.code === "NOT_UTC_ANCHORED" && e.field.includes("R-99")));
});
