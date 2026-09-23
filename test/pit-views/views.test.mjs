import { test } from "node:test";
import assert from "node:assert/strict";

import {
  buildPitManifest,
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
  occurredAtUtc: "2026-03-31T17:15:00Z",
  publishedAtUtc: "2026-03-31T18:00:00Z",
  consumableAtUtc: "2026-04-01T06:00:00Z",
  revisionId: "v1",
  value: 24.35,
};

const WITH_BENCHMARK = {
  key: "B.G0BQ.202604.closed",
  occurredAtUtc: "2026-06-30T17:15:00Z",
  publishedAtUtc: "2026-07-01T06:00:00Z",
  consumableAtUtc: "2026-07-01T06:30:00Z",
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
    records: [{ ...BASE, publishedAtUtc: "2026-04-05T18:00:00Z", consumableAtUtc: "2026-04-05T18:05:00Z" }],
  });
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
      occurredAtUtc: "2026-06-30T17:15:00Z",
      publishedAtUtc: "2026-04-01T06:00:00Z",
      consumableAtUtc: "2026-04-01T06:30:00Z",
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

test("el benchmark cerrado entra por su propia semántica temporal en ambas vistas", () => {
  const manifest = buildManifest({ records: [BASE, WITH_BENCHMARK] }).manifest;
  const early = viewsAt(manifest, "2026-05-01T00:00:00Z");
  assert.equal(early.decision.visible.length, 1); // sólo el precio
  assert.equal(early.evaluation.current.length, 1);

  const afterClose = viewsAt(manifest, "2026-07-02T00:00:00Z");
  assert.equal(afterClose.decision.visible.length, 2);
  assert.equal(afterClose.evaluation.current.length, 2);
});

test("readDecisionView rechaza boundary no parseable y exige vista separada", () => {
  const outcome = readDecisionView(buildManifest().manifest, " Boundary inválido ");
  assert.equal(outcome.ok, false);
  assert.equal(outcome.code, "INVALID_BOUNDARY");
});
