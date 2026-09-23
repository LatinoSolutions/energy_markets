import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  auditedManifestRecords,
  buildPitManifest,
  buildPitManifestFromAudit,
  buildRevision,
  IMP03_REQUIREMENT_VIEW_SCOPES,
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

// Atestaciones sintéticas de un audit (§6.4): una por versión del fixture que
// usa la evidencia de ingesta del fixture, con su key/revisión/instante. No es
// un audit real. Los records con otra evidencia quedan sin atestación.
function attestationsFor(records) {
  return records
    .filter((record) => record.consumableAtUtc && record.consumableEvidence
      && typeof record.revisionId === "string" && record.revisionId.trim().length > 0
      && record.consumableEvidence.source === BASE.consumableEvidence.source
      && record.consumableEvidence.sha256 === BASE.consumableEvidence.sha256)
    .map((record) => ({
      auditId: "AUDIT-FIXTURE",
      ...BASE.consumableEvidence,
      key: record.key,
      revisionId: record.revisionId,
      consumableAtUtc: record.consumableAtUtc,
    }));
}

function buildManifest({ records, revisions = [], proxyDeclarations = [], auditedEvidence } = {}) {
  const manifestRecords = records ?? [BASE];
  return buildPitManifest({
    manifestId: "PIT-MANIFEST-FIXTURE",
    manifestVersion: "v1",
    records: manifestRecords,
    revisions,
    auditedEvidence: auditedEvidence ?? attestationsFor(manifestRecords),
    proxyDeclarations,
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

test("publicado pero consumible después del boundary: no entra ni se menciona; el key queda unavailable", () => {
  const view = readDecisionView(buildManifest().manifest, "2026-03-31T18:30:00Z");
  assert.equal(view.visible.length, 0);
  assert.deepEqual(view.suppressed, []);
  assert.deepEqual(view.unavailable, [
    { key: BASE.key, reason: "sin versión consumible demostrada en este boundary (§6.1)" },
  ]);
});

test("publicado después del boundary: no existe para esa vista, ni visible ni suprimido", () => {
  const outcome = buildManifest({
    records: [{ ...BASE, publishedAtUtc: "2026-04-05T18:00:00Z", consumableAtUtc: "2026-04-05T18:05:00Z" }],  });
  const view = readDecisionView(outcome.manifest, "2026-04-05T17:59:59Z");
  assert.equal(view.visible.length, 0);
  assert.deepEqual(view.suppressed, []);
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
  assert.deepEqual(view.suppressed, []);
  assert.deepEqual(view.unavailable.map((row) => row.key), [BASE.key]);
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
    consumableEvidence: { source: "s", locator: "l", sha256: "a".repeat(64), auditLinked: true, auditId: "AUDIT-FIXTURE" },
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

// Artifacts auditados reales, leídos del repo y anclados a su sha256: el
// manifiesto IMP-03 original (write-set-manifest.json) y la instancia EEX THE
// de ST-03.3 (su SHA256SUMS). No son copias sintéticas.
const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const IMP03_ARTIFACTS = [
  { path: "operations/audit/IMP-03/temporal-manifest.json", sha256: "6b630e9edf994b58ddc7016950403ef1897d780f6baa2e6ec72e787754b58578" },
  { path: "operations/audit/IMP-03/EEX-THE-20260921/ST-03.3/temporal-manifest.json", sha256: "288e405f5bb033ea9eb602c7b28dae54dfc7de9881393b393aed2ccee2f8f77a" },
];

function loadAuditedArtifact(ref) {
  const bytes = readFileSync(`${REPO_ROOT}${ref.path}`);
  assert.equal(createHash("sha256").update(bytes).digest("hex"), ref.sha256, `${ref.path} no coincide con su hash auditado`);
  return JSON.parse(bytes.toString("utf8"));
}

const [PRIOR_REF, EEX_REF] = IMP03_ARTIFACTS;
const PRIOR_ARTIFACT = loadAuditedArtifact(PRIOR_REF);
const EEX_ARTIFACT = loadAuditedArtifact(EEX_REF);
const SEMANTIC_KEYS = ["occurredReferenceTime", "publicationSourceAvailabilityTime", "policyConsumableTime", "revisionVersion"];

for (const [ref, artifact] of [[PRIOR_REF, PRIOR_ARTIFACT], [EEX_REF, EEX_ARTIFACT]]) {
  test(`auditedManifestRecords materializa las ${artifact.entries.length} entradas de ${ref.path} sin perder ninguna semántica`, () => {
    const outcome = auditedManifestRecords({ artifact, artifactRef: ref });
    assert.equal(outcome.ok, true, JSON.stringify(outcome.errors));
    assert.equal(outcome.records.length, artifact.entries.length);
    for (const entry of artifact.entries) {
      const record = outcome.records.find((candidate) => candidate.key === entry.requirementId);
      // Cada semántica viaja íntegra: status, value, reason, note y evidencia.
      for (const semanticKey of SEMANTIC_KEYS) {
        assert.deepEqual(record.audit.semantics[semanticKey], entry[semanticKey], `${entry.requirementId}.${semanticKey}`);
      }
      assert.deepEqual(record.audit.evidence, entry.evidence ?? null);
      assert.equal(record.audit.artifact.sha256, ref.sha256);
      // El audit no entrega relojes por versión: ningún texto se vuelve reloj.
      assert.equal(record.occurredAtUtc, null);
      assert.equal(record.publishedAtUtc, null);
      assert.equal(record.consumableAtUtc, null);
      assert.equal(record.consumability, "unavailable");
      assert.equal("value" in record, false);
    }
  });
}

test("EEX ST-03.3: OBSERVED/PARTIAL se conservan como AUDIT_OBSERVED con su valor y evidencia (review 5, R-08)", () => {
  const { records } = auditedManifestRecords({ artifact: EEX_ARTIFACT, artifactRef: EEX_REF });
  const r08 = records.find((record) => record.key === "R-08");
  assert.equal(r08.valueStatus, "AUDIT_OBSERVED");
  assert.equal(r08.audit.semantics.occurredReferenceTime.status, "OBSERVED");
  assert.match(r08.audit.semantics.occurredReferenceTime.value, /UOM=MWh, Currency=EUR/);
  assert.match(r08.reason, /occurredReferenceTime OBSERVED: Per-row UOM=MWh, Currency=EUR/);
  assert.match(r08.reason, /revisionVersion PARTIAL/);
  // R-04: la evidencia de muestra del audit (digest por archivo) se conserva.
  const r04 = records.find((record) => record.key === "R-04");
  assert.equal(r04.valueStatus, "AUDIT_OBSERVED");
  assert.deepEqual(r04.audit.evidence, EEX_ARTIFACT.entries.find((entry) => entry.requirementId === "R-04").evidence);
  // R-10 PARTIAL también es observación, no faltante vacío.
  assert.equal(records.find((record) => record.key === "R-10").valueStatus, "AUDIT_OBSERVED");
  // Una entrada sin observaciones sigue siendo MISSING.
  assert.equal(records.find((record) => record.key === "R-01").valueStatus, "MISSING");
  const expectedObserved = EEX_ARTIFACT.entries
    .filter((entry) => SEMANTIC_KEYS.some((key) => ["OBSERVED", "PARTIAL"].includes(entry[key].status)))
    .map((entry) => entry.requirementId);
  assert.deepEqual(records.filter((record) => record.valueStatus === "AUDIT_OBSERVED").map((record) => record.key), expectedObserved);
});

test("las vistas muestran la observación auditada como unavailable, no como valor ni como faltante vacío", () => {
  const outcome = buildPitManifestFromAudit({ manifestId: "PIT-EEX", manifestVersion: "v1", artifact: EEX_ARTIFACT, artifactRef: EEX_REF });
  assert.equal(outcome.ok, true);
  const pair = viewsAt(outcome.manifest, "2026-04-02T00:00:00Z");
  assert.equal(pair.decision.visible.length, 0);
  assert.equal(pair.evaluation.current.length, 0);
  const decisionR08 = pair.decision.suppressed.find((row) => row.key === "R-08");
  assert.match(decisionR08.reason, /UOM=MWh, Currency=EUR/);
  assert.match(decisionR08.reason, /observado por el audit sin versión PIT materializada/);
  const evaluationR08 = pair.evaluation.unavailable.find((row) => row.key === "R-08");
  assert.match(evaluationR08.reason, /UOM=MWh, Currency=EUR/);
});

test("R-06 (Benchmark B) se clasifica evaluation por el audit y nunca entra a la decisión (review 5)", () => {
  assert.equal(IMP03_REQUIREMENT_VIEW_SCOPES["R-06"], "evaluation");
  for (const [ref, artifact] of [[PRIOR_REF, PRIOR_ARTIFACT], [EEX_REF, EEX_ARTIFACT]]) {
    const { manifest } = buildPitManifestFromAudit({ manifestId: "M", manifestVersion: "v1", artifact, artifactRef: ref });
    assert.equal(manifest.records.find((record) => record.key === "R-06").viewScope, "evaluation");
    const decision = readDecisionView(manifest, "2026-04-02T00:00:00Z");
    const decisionKeys = [...decision.suppressed, ...decision.unavailable, ...decision.visible].map((row) => row.key);
    assert.equal(decisionKeys.includes("R-06"), false);
    assert.ok(readEvaluationView(manifest, "2026-04-02T00:00:00Z").unavailable.some((row) => row.key === "R-06"));
  }
});

test("una versión con valor de R-06 declarada como decision se rechaza: un key alimenta una sola vista", () => {
  const benchmarkInDecision = {
    ...BASE, key: "R-06", viewScope: "decision", revisionId: "b1", value: 25.7,
  };
  const outcome = buildPitManifestFromAudit({
    manifestId: "M", manifestVersion: "v1", artifact: EEX_ARTIFACT, artifactRef: EEX_REF,
    extraRecords: [benchmarkInDecision], auditedEvidence: attestationsFor([benchmarkInDecision]),
  });
  assert.equal(outcome.ok, false);
  assert.ok(outcome.errors.some((e) => e.code === "VIEW_SCOPE_CONFLICT"));
  // Declarada como evaluation, la versión con valor queda sólo en evaluación.
  const benchmark = { ...benchmarkInDecision, viewScope: "evaluation" };
  const accepted = buildPitManifestFromAudit({
    manifestId: "M", manifestVersion: "v1", artifact: EEX_ARTIFACT, artifactRef: EEX_REF,
    extraRecords: [benchmark], auditedEvidence: attestationsFor([benchmark]),
  });
  assert.equal(accepted.ok, true);
  const pair = viewsAt(accepted.manifest, "2026-04-02T00:00:00Z");
  assert.equal(pair.decision.visible.some((row) => row.key === "R-06"), false);
  assert.equal(pair.evaluation.current.find((row) => row.key === "R-06").value, 25.7);
});

test("auditedManifestRecords exige el artifact completo, su procedencia y requisitos clasificados", () => {
  assert.equal(auditedManifestRecords({ artifact: { entries: [] }, artifactRef: EEX_REF }).errors[0].code, "INVALID_AUDITED_ARTIFACT");
  assert.equal(auditedManifestRecords({ artifact: EEX_ARTIFACT }).errors[0].code, "MISSING_ARTIFACT_REF");
  const unknownRequirement = { ...EEX_ARTIFACT, entries: [...EEX_ARTIFACT.entries, { ...EEX_ARTIFACT.entries[0], requirementId: "R-99" }] };
  assert.ok(auditedManifestRecords({ artifact: unknownRequirement, artifactRef: EEX_REF }).errors.some((e) => e.code === "UNCLASSIFIED_REQUIREMENT"));
  const duplicated = { ...EEX_ARTIFACT, entries: [...EEX_ARTIFACT.entries, EEX_ARTIFACT.entries[0]] };
  assert.ok(auditedManifestRecords({ artifact: duplicated, artifactRef: EEX_REF }).errors.some((e) => e.code === "DUPLICATE_REQUIREMENT"));
});

test("un status auditado fuera del vocabulario rechaza la ingesta: no se descarta en silencio", () => {
  const hostile = {
    ...EEX_ARTIFACT,
    entries: [{ ...EEX_ARTIFACT.entries[0], occurredReferenceTime: { status: "PRESENT", value: "2026-03-31T17:15:00" } }],
  };
  const outcome = buildPitManifestFromAudit({ manifestId: "M", manifestVersion: "v1", artifact: hostile, artifactRef: EEX_REF });
  assert.equal(outcome.ok, false);
  assert.ok(outcome.errors.some((e) => e.code === "UNKNOWN_AUDITED_STATUS" && e.field.includes("R-01")));
});

test("buildPitManifestFromAudit construye el manifiesto con las dos vistas desde el audit", () => {
  const outcome = buildPitManifestFromAudit({
    manifestId: "PIT-MANIFEST-IMP-03",
    manifestVersion: "v1",
    artifact: PRIOR_ARTIFACT,
    artifactRef: PRIOR_REF,
  });
  assert.equal(outcome.ok, true);
  assert.equal(outcome.manifest.records.length, 17);
  const pair = viewsAt(outcome.manifest, "2026-04-02T00:00:00Z");
  // Nada es consumible: el audit no demostró consumo. Todo queda unavailable
  // con su razón auditada visible; no se declara cobertura nueva (§25.2).
  assert.equal(pair.decision.visible.length, 0);
  assert.equal(pair.decision.suppressed.length, 16);
  assert.equal(pair.decision.unavailable.length, 16);
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

test("versión publicada pero aún no consumible no habla en la decisión; su razón sigue en el manifest", () => {
  // §25.1 IMP-06: "un dato publicado pero aún no consumible no entra". La
  // razón no se pierde: viaja en el record del manifest.
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
  assert.deepEqual(view.suppressed, []);
  assert.deepEqual(view.unavailable.map((row) => row.key), ["R-04.exec"]);
  assert.match(manifest.records[0].reason, /No price\/trade\/order-book series present in the workspace/);
  // Una vez consumible, la versión es visible.
  assert.equal(readDecisionView(manifest, "2026-04-05T06:00:00Z").visible[0].revisionId, "v1");
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

// --- Review: un boundary histórico no depende de revisiones posteriores (§6.1/§14.7) ---

function decisionAt(records, boundary) {
  return JSON.parse(JSON.stringify(readDecisionView(buildManifest({ records }).manifest, boundary)));
}

test("revisión publicada después del boundary no aparece en suppressed: la respuesta completa es idéntica", () => {
  // Caso de review: `suppressed` exponía el revisionId de v2, aún futura.
  const boundary = "2026-04-02T00:00:00Z";
  const withoutRevision = decisionAt([BASE], boundary);
  const withRevision = decisionAt(revisedRecords(), boundary);
  assert.deepEqual(withRevision, withoutRevision);
  assert.equal(withRevision.suppressed.some((row) => row.revisionId === "v2"), false);
});

test("un record aún no consumible no revela si su consumo futuro está demostrado ni con qué evidencia", () => {
  const boundary = "2026-04-25T00:00:00Z";
  // v2 publicada antes del boundary, consumo demostrado recién después.
  const future = { ...revisedRecords()[1], publishedAtUtc: "2026-04-20T10:00:00Z", consumableAtUtc: "2026-05-01T00:00:00Z" };
  // Misma v2 sin consumo declarado nunca.
  const never = { ...future, consumableAtUtc: undefined, consumableEvidence: undefined };
  // Misma v2 con consumo futuro pero evidencia no auditada.
  const unlinked = { ...future, consumableEvidence: { source: "x", locator: "y", sha256: "b".repeat(64) } };
  const a = decisionAt([BASE, future], boundary);
  const b = decisionAt([BASE, never], boundary);
  const c = decisionAt([BASE, unlinked], boundary);
  const withoutV2 = decisionAt([BASE], boundary);
  assert.equal(a.visible[0].revisionId, "v1");
  assert.deepEqual(a.suppressed, []);
  // Review 5: v2 publicada pero aún no consumible no revela su revisionId.
  // Consumo futuro, nunca declarado o con evidencia no auditada: la
  // respuesta es la misma que sin v2.
  assert.deepEqual(a, withoutV2);
  assert.deepEqual(b, withoutV2);
  assert.deepEqual(c, withoutV2);
});

test("agregar cualquier número de revisiones futuras no cambia ningún boundary histórico", () => {
  const history = revisedRecords();
  const extended = [
    ...history,
    { ...BASE, revisionId: "v3", revisionOf: "v2", publishedAtUtc: "2026-05-02T10:00:00Z", consumableAtUtc: "2026-05-02T10:30:00Z", value: 24.9 },
  ];
  for (const boundary of ["2026-03-31T18:30:00Z", "2026-04-02T00:00:00Z", "2026-04-20T11:00:00Z", "2026-05-01T00:00:00Z"]) {
    assert.deepEqual(decisionAt(extended, boundary), decisionAt(history, boundary), boundary);
  }
});

// --- Review: evidencia de consumo sin vínculo con el audit no entra (§6.1/§6.4) ---

test("evidencia con source/locator arbitrarios no hace visible el valor en la decisión", () => {
  const forged = { ...BASE, consumableEvidence: { source: "inventado", locator: "inventado", sha256: "b".repeat(64) } };
  const outcome = buildManifest({ records: [forged] });
  assert.equal(outcome.ok, true);
  assert.equal(outcome.manifest.records[0].consumability, "unavailable");
  const view = readDecisionView(outcome.manifest, "2026-04-02T00:00:00Z");
  assert.equal(view.visible.length, 0);
  assert.match(view.suppressed[0].reason, /sin vínculo comprobado con el audit/);
});

test("sin registro de evidencia auditada ningún consumo queda demostrado", () => {
  const outcome = buildPitManifest({ manifestId: "M", manifestVersion: "v1", records: [BASE] });
  assert.equal(outcome.ok, true);
  assert.equal(readDecisionView(outcome.manifest, "2026-04-02T00:00:00Z").visible.length, 0);
});

test("hash distinto al del audit rechaza el manifest", () => {
  const tampered = { ...BASE, consumableEvidence: { ...BASE.consumableEvidence, sha256: "c".repeat(64) } };
  const outcome = buildManifest({ records: [tampered], auditedEvidence: attestationsFor([BASE]) });
  assert.equal(outcome.ok, false);
  assert.ok(outcome.errors.some((e) => e.code === "EVIDENCE_HASH_MISMATCH"));
});

test("la fila visible identifica el audit que vinculó la evidencia", () => {
  const view = readDecisionView(buildManifest().manifest, "2026-04-02T00:00:00Z");
  assert.equal(view.visible[0].semantics.consumableEvidence.auditLinked, true);
  assert.equal(view.visible[0].semantics.consumableEvidence.auditId, "AUDIT-FIXTURE");
});

// --- Review: proxy predeclarado y permitido en la decision view (§6.2) ---

const PROXY = { ...BASE, key: "G0BQ.202604.proxy-reference", proxy: true, proxyId: "PROXY-TRADES-MID-0.75/0.25" };

function proxyDeclaration(overrides = {}) {
  return { key: PROXY.key, proxyId: PROXY.proxyId, allowed: true, fallbackRank: 1, declaredAtUtc: "2026-03-01T00:00:00Z", ...overrides };
}

test("proxy con proxyId no predeclarado rechaza el manifest", () => {
  const outcome = buildManifest({ records: [PROXY] });
  assert.equal(outcome.ok, false);
  assert.ok(outcome.errors.some((e) => e.code === "PROXY_NOT_DECLARED"));
});

test("proxy predeclarado y permitido entra a la decisión identificado como proxy", () => {
  const manifest = buildManifest({ records: [PROXY], proxyDeclarations: [proxyDeclaration()] }).manifest;
  const view = readDecisionView(manifest, "2026-04-02T00:00:00Z");
  assert.equal(view.visible.length, 1);
  assert.equal(view.visible[0].proxy, true);
  assert.equal(view.visible[0].proxyId, PROXY.proxyId);
});

test("proxy declarado pero no permitido no entra a la decisión", () => {
  const manifest = buildManifest({ records: [PROXY], proxyDeclarations: [proxyDeclaration({ allowed: false })] }).manifest;
  const view = readDecisionView(manifest, "2026-04-02T00:00:00Z");
  assert.equal(view.visible.length, 0);
  assert.match(view.suppressed[0].reason, /no permitido/);
});

test("proxy declarado después del boundary no entra en ese boundary (predeclaración ex ante)", () => {
  const manifest = buildManifest({ records: [PROXY], proxyDeclarations: [proxyDeclaration({ declaredAtUtc: "2026-04-10T00:00:00Z" })] }).manifest;
  assert.equal(readDecisionView(manifest, "2026-04-02T00:00:00Z").visible.length, 0);
  assert.equal(readDecisionView(manifest, "2026-04-10T00:00:00Z").visible.length, 1);
});

test("un proxy no permitido no tapa a la versión oficial anterior del mismo key", () => {
  const official = { ...BASE, key: PROXY.key };
  const proxyRevision = { ...PROXY, revisionId: "v2-proxy", publishedAtUtc: "2026-04-05T00:00:00Z", consumableAtUtc: "2026-04-05T01:00:00Z" };
  const manifest = buildManifest({
    records: [official, proxyRevision],
    proxyDeclarations: [proxyDeclaration({ allowed: false })],
  }).manifest;
  const view = readDecisionView(manifest, "2026-04-06T00:00:00Z");
  assert.deepEqual(view.visible.map((row) => row.revisionId), ["v1"]);
  assert.ok(view.suppressed.some((row) => row.revisionId === "v2-proxy" && /no permitido/.test(row.reason)));
});

test("declaraciones de proxy mal formadas o duplicadas rechazan el manifest", () => {
  const bad = buildManifest({ records: [BASE], proxyDeclarations: [{ key: PROXY.key, proxyId: PROXY.proxyId, allowed: "yes", fallbackRank: 1, declaredAtUtc: "2026-03-01T00:00:00Z" }] });
  assert.equal(bad.ok, false);
  assert.ok(bad.errors.some((e) => e.code === "INVALID_PROXY_DECLARATION"));
  const dup = buildManifest({ records: [BASE], proxyDeclarations: [proxyDeclaration(), proxyDeclaration()] });
  assert.equal(dup.ok, false);
  assert.ok(dup.errors.some((e) => e.code === "DUPLICATE_PROXY_DECLARATION"));
});

// --- Review: orden temporal del lineage (§6.1/§6.2) ---

test("revisión publicada antes que la versión que revisa se rechaza (v2 no puede verse antes que v1)", () => {
  const inverted = { ...revisedRecords()[1], publishedAtUtc: "2026-03-30T10:00:00Z", consumableAtUtc: "2026-03-30T10:30:00Z" };
  const outcome = buildManifest({ records: [BASE, inverted] });
  assert.equal(outcome.ok, false);
  assert.ok(outcome.errors.some((e) => e.code === "LINEAGE_ORDER_INCOHERENT"));
});

test("revisión publicada a la vez que su predecesora se rechaza: el orden debe ser estricto", () => {
  const simultaneous = { ...revisedRecords()[1], publishedAtUtc: BASE.publishedAtUtc, consumableAtUtc: "2026-04-20T10:30:00Z" };
  const outcome = buildManifest({ records: [BASE, simultaneous] });
  assert.equal(outcome.ok, false);
  assert.ok(outcome.errors.some((e) => e.code === "LINEAGE_ORDER_INCOHERENT"));
});

test("revisión publicada después pero consumible antes que su predecesora se rechaza", () => {
  // Publicada 2026-04-01T00:00Z (después de v1) y consumible 05:00Z, antes
  // que v1 (06:00Z): por reloj de decisión v2 se vería antes que v1.
  const consumedFirst = { ...revisedRecords()[1], publishedAtUtc: "2026-04-01T00:00:00Z", consumableAtUtc: "2026-04-01T05:00:00Z" };
  const outcome = buildManifest({ records: [BASE, consumedFirst] });
  assert.equal(outcome.ok, false);
  assert.ok(outcome.errors.some((e) => e.code === "LINEAGE_ORDER_INCOHERENT"));
});

test("receipt que hace efectiva la revisión antes que su predecesora se rechaza (reloj de evaluación)", () => {
  const records = [
    BASE,
    { ...BASE, revisionId: "v2", revisionOf: "v1", publishedAtUtc: "2026-04-20T10:00:00Z", consumableAtUtc: "2026-04-20T10:30:00Z", value: 25.1 },
    { ...BASE, revisionId: "v3", revisionOf: "v2", publishedAtUtc: "2026-04-21T10:00:00Z", consumableAtUtc: "2026-04-21T10:30:00Z", value: 24.9 },
  ];
  const lateV2 = buildRevision({ key: BASE.key, revisionId: "v2", revisesRevisionId: "v1", effectiveAtUtc: "2026-05-10T00:00:00Z" });
  const outcome = buildManifest({ records, revisions: [lateV2.revision] });
  assert.equal(outcome.ok, false);
  assert.ok(outcome.errors.some((e) => e.code === "LINEAGE_ORDER_INCOHERENT" && e.field === "revisions"));
});

test("revisión de una versión sin publicación no es ordenable y se rechaza", () => {
  const unpublishedBase = { ...BASE, publishedAtUtc: null, consumableAtUtc: null, consumableEvidence: null };
  const outcome = buildManifest({ records: [unpublishedBase, revisedRecords()[1]] });
  assert.equal(outcome.ok, false);
  assert.ok(outcome.errors.some((e) => e.code === "LINEAGE_ORDER_UNVERIFIABLE"));
});

test("revisión sin publicación propia se rechaza aunque no tenga receipt", () => {
  const unpublishedRevision = { ...revisedRecords()[1], publishedAtUtc: null, consumableAtUtc: null };
  const outcome = buildManifest({ records: [BASE, unpublishedRevision] });
  assert.equal(outcome.ok, false);
  assert.ok(outcome.errors.some((e) => e.code === "REVISION_WITHOUT_PUBLICATION"));
});

test("lineage en orden correcto: la decisión nunca muestra v2 antes que v1", () => {
  const manifest = buildManifest({ records: revisedRecords() }).manifest;
  const boundaries = ["2026-04-01T06:00:00Z", "2026-04-10T00:00:00Z", "2026-04-20T10:30:00Z", "2026-05-01T00:00:00Z"];
  const seen = boundaries.map((boundary) => readDecisionView(manifest, boundary).visible[0].revisionId);
  assert.deepEqual(seen, ["v1", "v1", "v2", "v2"]);
});

test("atestación de otra versión no demuestra el consumo de una revisión (vínculo por key/revisión/instante)", () => {
  // La evidencia auditada de v1 no acredita el consumo de v2 aunque comparta artifact.
  const outcome = buildManifest({ records: revisedRecords(), auditedEvidence: attestationsFor([BASE]) });
  assert.equal(outcome.ok, true);
  const v2 = outcome.manifest.records.find((record) => record.revisionId === "v2");
  assert.equal(v2.consumability, "unavailable");
  assert.equal(readDecisionView(outcome.manifest, "2026-04-25T00:00:00Z").visible[0].revisionId, "v1");
});

test("declaración de proxy posterior al boundary: permitida o no, la respuesta en el boundary es idéntica", () => {
  const at = (allowed) => JSON.parse(JSON.stringify(readDecisionView(
    buildManifest({ records: [PROXY], proxyDeclarations: [proxyDeclaration({ allowed, declaredAtUtc: "2026-04-10T00:00:00Z" })] }).manifest,
    "2026-04-02T00:00:00Z",
  )));
  assert.deepEqual(at(true), at(false));
});

test("hueco transitivo: v3 no puede ser consumible antes que su ancestro v1 aunque v2 no declare consumo", () => {
  // Caso de validación adversarial: dec mostraba v3 y luego retrocedía a v1.
  const records = [
    BASE,
    { ...BASE, revisionId: "v2", revisionOf: "v1", publishedAtUtc: "2026-03-31T19:00:00Z", consumableAtUtc: undefined, consumableEvidence: undefined, value: 25.1 },
    { ...BASE, revisionId: "v3", revisionOf: "v2", publishedAtUtc: "2026-03-31T20:00:00Z", consumableAtUtc: "2026-04-01T04:00:00Z", value: 24.9 },
  ];
  const outcome = buildManifest({ records });
  assert.equal(outcome.ok, false);
  assert.ok(outcome.errors.some((e) => e.code === "LINEAGE_ORDER_INCOHERENT" && /ancestro "v1"/.test(e.message)));
});

test("fork: dos revisiones de la misma versión se rechazan (lineage lineal)", () => {
  const records = [
    BASE,
    { ...BASE, revisionId: "v2", revisionOf: "v1", publishedAtUtc: "2026-04-20T10:00:00Z", consumableAtUtc: "2026-04-20T10:30:00Z", value: 25.1 },
    { ...BASE, revisionId: "v3", revisionOf: "v1", publishedAtUtc: "2026-04-20T09:00:00Z", consumableAtUtc: "2026-04-20T10:15:00Z", value: 24.9 },
  ];
  const outcome = buildManifest({ records });
  assert.equal(outcome.ok, false);
  assert.ok(outcome.errors.some((e) => e.code === "LINEAGE_FORK"));
});

// --- Review 5: jerarquía de fuentes fijada ex ante (§6.2) ---

const OFFICIAL = { ...BASE, key: PROXY.key };
const LATER_PROXY = { ...PROXY, revisionId: "p1", publishedAtUtc: "2026-04-05T00:00:00Z", consumableAtUtc: "2026-04-05T01:00:00Z", value: 99 };

test("un proxy allowed posterior no sustituye a la versión oficial disponible del mismo key", () => {
  const manifest = buildManifest({ records: [OFFICIAL, LATER_PROXY], proxyDeclarations: [proxyDeclaration()] }).manifest;
  const decision = readDecisionView(manifest, "2026-04-06T00:00:00Z");
  assert.deepEqual(decision.visible.map((row) => [row.revisionId, row.proxy, row.sourceRank]), [["v1", false, 0]]);
  const evaluation = readEvaluationView(manifest, "2026-04-06T00:00:00Z");
  assert.equal(evaluation.current[0].revisionId, "v1");
  assert.deepEqual(evaluation.outranked.map((row) => [row.revisionId, row.sourceRank]), [["p1", 1]]);
  assert.equal(evaluation.superseded.length, 0);
});

test("sin versión oficial consumible, el proxy entra como fallback identificado", () => {
  const manifest = buildManifest({ records: [OFFICIAL, LATER_PROXY], proxyDeclarations: [proxyDeclaration()] }).manifest;
  // Antes del consumo oficial (06:00Z del 1-abr) no hay oficial; el proxy aún no existe.
  assert.equal(readDecisionView(manifest, "2026-04-01T05:00:00Z").visible.length, 0);
  const onlyProxy = buildManifest({ records: [LATER_PROXY], proxyDeclarations: [proxyDeclaration()] }).manifest;
  const view = readDecisionView(onlyProxy, "2026-04-06T00:00:00Z");
  assert.deepEqual(view.visible.map((row) => [row.revisionId, row.proxyId]), [["p1", PROXY.proxyId]]);
});

test("entre proxies manda el fallbackRank declarado, no el más reciente", () => {
  const second = { ...PROXY, proxyId: "PROXY-B", revisionId: "pb1", publishedAtUtc: "2026-04-01T00:00:00Z", consumableAtUtc: "2026-04-01T06:00:00Z", value: 10 };
  const first = { ...PROXY, proxyId: "PROXY-A", revisionId: "pa1", publishedAtUtc: "2026-04-05T00:00:00Z", consumableAtUtc: "2026-04-05T01:00:00Z", value: 20 };
  const declarations = [
    proxyDeclaration({ proxyId: "PROXY-A", fallbackRank: 1 }),
    proxyDeclaration({ proxyId: "PROXY-B", fallbackRank: 2 }),
  ];
  const manifest = buildManifest({ records: [second, first], proxyDeclarations: declarations }).manifest;
  assert.equal(readDecisionView(manifest, "2026-04-02T00:00:00Z").visible[0].revisionId, "pb1");
  assert.equal(readDecisionView(manifest, "2026-04-06T00:00:00Z").visible[0].revisionId, "pa1");
});

test("la jerarquía exige fallbackRank entero y único por key", () => {
  const missingRank = buildManifest({ records: [BASE], proxyDeclarations: [proxyDeclaration({ fallbackRank: undefined })] });
  assert.ok(missingRank.errors.some((e) => e.code === "INVALID_PROXY_DECLARATION"));
  const official = buildManifest({ records: [BASE], proxyDeclarations: [proxyDeclaration({ fallbackRank: 0 })] });
  assert.ok(official.errors.some((e) => e.code === "INVALID_PROXY_DECLARATION"));
  const tie = buildManifest({ records: [BASE], proxyDeclarations: [proxyDeclaration(), proxyDeclaration({ proxyId: "PROXY-B" })] });
  assert.ok(tie.errors.some((e) => e.code === "DUPLICATE_FALLBACK_RANK"));
});

test("una revisión no cambia de fuente: proxy que revisa a la oficial se rechaza", () => {
  const relabel = { ...LATER_PROXY, revisionOf: "v1" };
  const outcome = buildManifest({ records: [OFFICIAL, relabel], proxyDeclarations: [proxyDeclaration()] });
  assert.equal(outcome.ok, false);
  assert.ok(outcome.errors.some((e) => e.code === "LINEAGE_SOURCE_MISMATCH"));
});

test("evaluación: un proxy no permitido no se usa como contenido vigente", () => {
  const manifest = buildManifest({ records: [LATER_PROXY], proxyDeclarations: [proxyDeclaration({ allowed: false })] }).manifest;
  const evaluation = readEvaluationView(manifest, "2026-04-06T00:00:00Z");
  assert.equal(evaluation.current.length, 0);
  assert.match(evaluation.unavailable[0].reason, /no permitido/);
});

// --- Review 5: suppressed no revela versiones publicadas aún no consumibles ---

test("revisión publicada antes del boundary y consumible después no cambia la respuesta histórica", () => {
  const boundary = "2026-04-25T00:00:00Z";
  const publishedNotConsumable = { ...revisedRecords()[1], publishedAtUtc: "2026-04-20T10:00:00Z", consumableAtUtc: "2026-04-30T00:00:00Z" };
  const before = decisionAt([BASE], boundary);
  const after = decisionAt([BASE, publishedNotConsumable], boundary);
  assert.deepEqual(after, before);
  assert.equal(JSON.stringify(after).includes("\"v2\""), false);
  // En su consumo sí entra.
  assert.equal(decisionAt([BASE, publishedNotConsumable], "2026-04-30T00:00:00Z").visible[0].revisionId, "v2");
});

test("sobre el audit real: agregar una versión futura de R-04 no cambia la decisión histórica", () => {
  const boundary = "2026-04-02T00:00:00Z";
  const base = buildPitManifestFromAudit({ manifestId: "M", manifestVersion: "v1", artifact: EEX_ARTIFACT, artifactRef: EEX_REF });
  // R-04 ya tiene una entrada auditada; una versión con valor publicada antes
  // del boundary pero consumible después no debe asomar.
  const futureR04 = { ...BASE, key: "R-04", revisionId: "r04-v1", publishedAtUtc: "2026-04-01T00:00:00Z", consumableAtUtc: "2026-04-03T00:00:00Z" };
  const extended = buildPitManifestFromAudit({
    manifestId: "M", manifestVersion: "v1", artifact: EEX_ARTIFACT, artifactRef: EEX_REF,
    extraRecords: [futureR04], auditedEvidence: attestationsFor([futureR04]),
  });
  assert.equal(extended.ok, true);
  const plain = (manifest) => JSON.parse(JSON.stringify(readDecisionView(manifest, boundary)));
  assert.deepEqual(plain(extended.manifest), plain(base.manifest));
  assert.equal(readDecisionView(extended.manifest, "2026-04-03T00:00:00Z").visible[0].revisionId, "r04-v1");
});

// --- Review 5: el valor de una versión es inmutable (§6.2) ---

test("mutar el objeto del llamante después de construir el manifest no cambia ninguna vista", () => {
  const value = { price: 24.35, legs: [1, 2] };
  const input = { ...BASE, value };
  const manifest = buildManifest({ records: [input] }).manifest;
  const before = JSON.parse(JSON.stringify(viewsAt(manifest, "2026-04-02T00:00:00Z")));
  value.price = 999;
  value.legs.push(3);
  input.publishedAtUtc = "2020-01-01T00:00:00Z";
  assert.deepEqual(JSON.parse(JSON.stringify(viewsAt(manifest, "2026-04-02T00:00:00Z"))), before);
});

test("el manifest y los valores expuestos por las vistas están congelados", () => {
  const manifest = buildManifest({ records: [{ ...BASE, value: { price: 24.35 } }] }).manifest;
  assert.ok(Object.isFrozen(manifest));
  assert.ok(Object.isFrozen(manifest.records));
  assert.ok(Object.isFrozen(manifest.records[0]));
  const view = readDecisionView(manifest, "2026-04-02T00:00:00Z");
  assert.throws(() => { view.visible[0].value.price = 1; }, TypeError);
  assert.throws(() => { manifest.records[0].effectiveAtUtc = "2020-01-01T00:00:00.000Z"; }, TypeError);
  assert.equal(readEvaluationView(manifest, "2026-04-02T00:00:00Z").current[0].value.price, 24.35);
});

test("un valor no serializable se rechaza en vez de guardarse por referencia", () => {
  const outcome = buildManifest({ records: [{ ...BASE, value: { compute: () => 1 } }] });
  assert.equal(outcome.ok, false);
  assert.ok(outcome.errors.some((e) => e.code === "INVALID_VALUE"));
});

// --- Validación adversarial: bordes residuales de review 5 ---

test("R-06 en decisión se rechaza también por buildPitManifest directo, sin el adaptador", () => {
  const benchmark = { ...BASE, key: "R-06", viewScope: "decision", revisionId: "b1" };
  const outcome = buildManifest({ records: [benchmark] });
  assert.equal(outcome.ok, false);
  assert.ok(outcome.errors.some((e) => e.code === "VIEW_SCOPE_CONFLICT"));
});

test("evaluación: un proxy declarado después del asOf no es contenido vigente en ese asOf", () => {
  const manifest = buildManifest({
    records: [LATER_PROXY],
    proxyDeclarations: [proxyDeclaration({ declaredAtUtc: "2026-06-01T00:00:00Z" })],
  }).manifest;
  const early = readEvaluationView(manifest, "2026-04-06T00:00:00Z");
  assert.equal(early.current.length, 0);
  assert.match(early.unavailable[0].reason, /no predeclarado/);
  assert.equal(readEvaluationView(manifest, "2026-06-01T00:00:00Z").current[0].revisionId, "p1");
});

test("valores Map/Set/Date o cíclicos se rechazan: no se pueden congelar como versión", () => {
  const cyclic = { a: 1 };
  cyclic.self = cyclic;
  for (const value of [new Map([["d", 1]]), { nested: new Set([1]) }, new Date("2026-04-01T00:00:00Z"), cyclic]) {
    const outcome = buildManifest({ records: [{ ...BASE, value }] });
    assert.equal(outcome.ok, false);
    assert.ok(outcome.errors.some((e) => e.code === "INVALID_VALUE"));
  }
});
