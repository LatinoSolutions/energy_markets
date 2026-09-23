import { test } from "node:test";
import assert from "node:assert/strict";

import { canonicalValueSha256 } from "../../src/pit-views/pit-record.mjs";
import {
  EXPOSURE_CONDITION,
  EXPOSURE_FIELDS,
  EXPOSURE_FIELD_KEYS,
  EXPOSURE_SOURCE_KIND,
  buildExposure,
  buildExposureField,
  backendIndexFromManifest,
} from "../../src/operator-interface/index.mjs";
import { EVALUATION_BENCHMARK, DECISION_BASE, RECOMMENDATION_BASE, buildManifest } from "./fixtures.mjs";

// Manifest backend verificado: toda procedencia se contrasta contra él
// (§26.5; OI29-01 del review 2026-09-23).
function backendFor(records) {
  const built = buildManifest({ records });
  assert.equal(built.ok, true, JSON.stringify(built.errors ?? "manifest no construido"));
  return { manifest: built.manifest, index: backendIndexFromManifest(built.manifest) };
}

function provenance(sourceKind, record, overrides = {}) {
  return {
    sourceKind,
    recordKey: record.key,
    revisionId: record.revisionId,
    valueSha256: canonicalValueSha256(record.value).sha256,
    ...overrides,
  };
}

// §26.2: la tabla de información mínima observable, sin omitir ninguna fila.
test("EXPOSURE_FIELDS enumera las secciones de §26.2", () => {
  assert.equal(EXPOSURE_FIELDS.length, 13);
  for (const key of [
    "marketContext",
    "campaignProductMission",
    "procurementWindowAndDeadline",
    "policyAndAuthority",
    "procurementState",
    "recommendation",
    "strategyEvidence",
    "qualityAndProvenance",
    "proxyBenchmarkStatus",
    "workingMode",
    "humanIntervention",
    "outcomes",
    "controlAndGovernance",
  ]) {
    assert.ok(EXPOSURE_FIELD_KEYS.includes(key), key);
  }
});

// §26.5: un valor mostrado remite a su versión canónica; la UI no calcula otra
// verdad económica.
test("una sección AVAILABLE expone el valor canónico con su procedencia", () => {
  const { index } = backendFor([RECOMMENDATION_BASE]);
  const outcome = buildExposureField({
    field: "recommendation",
    condition: EXPOSURE_CONDITION.AVAILABLE,
    value: RECOMMENDATION_BASE.value,
    provenance: provenance(EXPOSURE_SOURCE_KIND.RECOMMENDATION, RECOMMENDATION_BASE),
  }, { backendIndex: index });
  assert.equal(outcome.ok, true);
  assert.equal(outcome.record.value.action, "BUY");
  assert.equal(outcome.record.condition, EXPOSURE_CONDITION.AVAILABLE);
});

test("un valor que no coincide con su versión canónica se rechaza", () => {
  const { index } = backendFor([RECOMMENDATION_BASE]);
  const declared = { action: "WAIT" };
  const outcome = buildExposureField({
    field: "recommendation",
    condition: EXPOSURE_CONDITION.AVAILABLE,
    value: { action: "BUY" },
    provenance: provenance(EXPOSURE_SOURCE_KIND.RECOMMENDATION, RECOMMENDATION_BASE, {
      valueSha256: canonicalValueSha256(declared).sha256,
    }),
  }, { backendIndex: index });
  assert.equal(outcome.ok, false);
  assert.equal(outcome.errors[0].code, "VALUE_PROVENANCE_MISMATCH");
});

test("una sección con valor exige procedencia", () => {
  const outcome = buildExposureField({
    field: "recommendation",
    condition: EXPOSURE_CONDITION.AVAILABLE,
    value: { action: "BUY" },
  });
  assert.equal(outcome.ok, false);
  assert.equal(outcome.errors[0].code, "MISSING_PROVENANCE");
});

// OI29-01 (§25.1/§26.5): el recordKey se contrasta contra el backend
// verificado; una referencia que el backend no tiene no acredita nada.
test("un recordKey que no existe en el backend verificado se rechaza", () => {
  const { index } = backendFor([RECOMMENDATION_BASE]);
  const outcome = buildExposureField({
    field: "recommendation",
    condition: EXPOSURE_CONDITION.AVAILABLE,
    value: { action: "BUY" },
    provenance: provenance(EXPOSURE_SOURCE_KIND.RECOMMENDATION, RECOMMENDATION_BASE, {
      recordKey: "never.exists",
      revisionId: "v404",
    }),
  }, { backendIndex: index });
  assert.equal(outcome.ok, false);
  assert.equal(outcome.errors[0].code, "RECORD_NOT_IN_BACKEND");
});

// OI29-01: el hash del valor que el llamador inventó no acredita procedencia:
// el backend debe tener registrado ese valor para esa versión.
test("el hash de un valor que el backend no registró se rechaza", () => {
  const { index } = backendFor([RECOMMENDATION_BASE]);
  const invented = { action: "BUY", sizing: 9.99 };
  const outcome = buildExposureField({
    field: "recommendation",
    condition: EXPOSURE_CONDITION.AVAILABLE,
    value: invented,
    provenance: provenance(EXPOSURE_SOURCE_KIND.RECOMMENDATION, RECOMMENDATION_BASE, {
      valueSha256: canonicalValueSha256(invented).sha256,
    }),
  }, { backendIndex: index });
  assert.equal(outcome.ok, false);
  assert.equal(outcome.errors[0].code, "BACKEND_VALUE_MISMATCH");
});

// OI29-01: sin manifest backend verificado, fail-closed.
test("una procedencia sin manifest backend verificado no se acepta", () => {
  const observation = {
    field: "recommendation",
    condition: EXPOSURE_CONDITION.AVAILABLE,
    value: { action: "BUY" },
    provenance: provenance(EXPOSURE_SOURCE_KIND.RECOMMENDATION, RECOMMENDATION_BASE),
  };
  const withoutBackend = buildExposureField(observation, {});
  assert.equal(withoutBackend.ok, false);
  assert.equal(withoutBackend.errors[0].code, "PROVENANCE_BACKEND_UNVERIFIED");

  const withNullIndex = buildExposureField(observation, { backendIndex: null });
  assert.equal(withNullIndex.ok, false);
  assert.equal(withNullIndex.errors[0].code, "PROVENANCE_BACKEND_UNVERIFIED");
});

// §25.1 IMP-29: recomendación, fill hipotético y outcome no se confunden.
test("una fuente de ejecución no se muestra como recomendación", () => {
  const { index } = backendFor([RECOMMENDATION_BASE]);
  const outcome = buildExposureField({
    field: "recommendation",
    condition: EXPOSURE_CONDITION.AVAILABLE,
    value: { action: "BUY" },
    provenance: provenance(EXPOSURE_SOURCE_KIND.EXECUTION, RECOMMENDATION_BASE),
  }, { backendIndex: index });
  assert.equal(outcome.ok, false);
  assert.equal(outcome.errors[0].code, "SOURCE_KIND_MISMATCH");
});

// §26.2: una ausencia no se completa con datos ficticios.
test("una condición sin valor no admite un valor inventado", () => {
  const outcome = buildExposureField({
    field: "outcomes",
    condition: EXPOSURE_CONDITION.NOT_YET_CLOSED,
    value: { outcome: "WIN" },
    reason: "campaña aún abierta",
  });
  assert.equal(outcome.ok, false);
  assert.equal(outcome.errors[0].code, "INVENTED_VALUE");
});

test("una condición sin valor exige preservar la razón", () => {
  const outcome = buildExposureField({
    field: "outcomes",
    condition: EXPOSURE_CONDITION.UNAVAILABLE,
  });
  assert.equal(outcome.ok, false);
  assert.equal(outcome.errors[0].code, "MISSING_REASON");
});

// OI29-01: una condición sin valor con procedencia también remite al backend.
test("la procedencia de una condición sin valor se contrasta con el backend", () => {
  const { index } = backendFor([EVALUATION_BENCHMARK]);
  const ok = buildExposureField({
    field: "outcomes",
    condition: EXPOSURE_CONDITION.NOT_YET_CLOSED,
    reason: "outcome pendiente de cierre; condición derivada del backend",
    provenance: {
      sourceKind: EXPOSURE_SOURCE_KIND.OUTCOME,
      recordKey: EVALUATION_BENCHMARK.key,
      revisionId: EVALUATION_BENCHMARK.revisionId,
    },
  }, { backendIndex: index });
  assert.equal(ok.ok, true);

  const unknown = buildExposureField({
    field: "outcomes",
    condition: EXPOSURE_CONDITION.NOT_YET_CLOSED,
    reason: "outcome pendiente",
    provenance: { sourceKind: EXPOSURE_SOURCE_KIND.OUTCOME, recordKey: "never.exists", revisionId: "v404" },
  }, { backendIndex: index });
  assert.equal(unknown.ok, false);
  assert.equal(unknown.errors[0].code, "RECORD_NOT_IN_BACKEND");
});

// §26.2: uncertainty/stale/proxy visibles; el proxy identificado, no relabelado.
test("proxy e incertidumbre se conservan visibles con su valor", () => {
  const { index } = backendFor([RECOMMENDATION_BASE]);
  const proxied = RECOMMENDATION_BASE.value;
  const outcome = buildExposureField({
    field: "proxyBenchmarkStatus",
    condition: EXPOSURE_CONDITION.PROXY,
    value: proxied,
    reason: "benchmark oficial aún no publicado",
    provenance: provenance(EXPOSURE_SOURCE_KIND.PROXY_BENCHMARK, RECOMMENDATION_BASE),
  }, { backendIndex: index });
  assert.equal(outcome.ok, true);
  assert.equal(outcome.record.condition, EXPOSURE_CONDITION.PROXY);
  assert.equal(outcome.record.reason, "benchmark oficial aún no publicado");

  const uncertain = buildExposureField({
    field: "qualityAndProvenance",
    condition: EXPOSURE_CONDITION.UNCERTAIN,
    reason: "revisión pendiente de confirmar",
  });
  assert.equal(uncertain.ok, true);
  assert.equal(uncertain.record.condition, EXPOSURE_CONDITION.UNCERTAIN);
});

test("NOT_YET_CLOSED no se presenta como resultado final conocido", () => {
  const outcome = buildExposureField({
    field: "outcomes",
    condition: EXPOSURE_CONDITION.NOT_YET_CLOSED,
    reason: "outcome pendiente de cierre (§26.2)",
  });
  assert.equal(outcome.ok, true);
  assert.equal(outcome.record.value, undefined);
  assert.equal(outcome.record.condition, EXPOSURE_CONDITION.NOT_YET_CLOSED);
});

// §26.2: todas las secciones quedan presentes; lo no observado se declara
// MISSING en vez de desaparecer o aparentar cobertura.
test("la exposición completa declara MISSING las secciones no observadas", () => {
  const { manifest, index } = backendFor([RECOMMENDATION_BASE]);
  const outcome = buildExposure({
    boundaryUtc: "2026-04-01T07:00:00Z",
    backendManifest: manifest,
    observations: [{
      field: "recommendation",
      condition: EXPOSURE_CONDITION.AVAILABLE,
      value: RECOMMENDATION_BASE.value,
      provenance: provenance(EXPOSURE_SOURCE_KIND.RECOMMENDATION, RECOMMENDATION_BASE),
    }],
  });
  assert.equal(outcome.ok, true);
  assert.equal(outcome.exposure.fields.length, 13);
  assert.equal(outcome.exposure.fields.find((f) => f.field === "recommendation").condition, EXPOSURE_CONDITION.AVAILABLE);
  assert.equal(outcome.exposure.fields.filter((f) => f.condition === EXPOSURE_CONDITION.MISSING).length, 12);
  assert.equal(outcome.exposure.hasUnavailableContent, true);
});

// OI29-05 (§6.1/§25.1/§26.3): el boundary del Decision-time view limita por el
// reloj de consumo de la policy, no por la publicación. Un registro publicado
// antes del boundary pero consumible después no se expone como AVAILABLE.
test("un registro decision publicado pero aún no consumible no entra al boundary", () => {
  const { manifest } = backendFor([RECOMMENDATION_BASE]);
  const observation = {
    field: "recommendation",
    condition: EXPOSURE_CONDITION.AVAILABLE,
    value: RECOMMENDATION_BASE.value,
    provenance: provenance(EXPOSURE_SOURCE_KIND.RECOMMENDATION, RECOMMENDATION_BASE),
  };
  // published 2026-03-31T18:05Z; consumable 2026-04-01T06:00Z: en un boundary
  // entre ambos el valor no era consumible por la policy, no AVAILABLE.
  const beforeConsumable = buildExposure({
    boundaryUtc: "2026-03-31T20:00:00Z",
    backendManifest: manifest,
    observations: [observation],
  });
  assert.equal(beforeConsumable.ok, true);
  const degraded = beforeConsumable.exposure.fields.find((f) => f.field === "recommendation");
  assert.equal(degraded.condition, EXPOSURE_CONDITION.NOT_YET_CLOSED, JSON.stringify(degraded));
  assert.ok(degraded.reason.includes("consumible por la policy"), degraded.reason);
  assert.ok(beforeConsumable.exposure.hasUnavailableContent, true);

  // Ya consumible en el boundary: AVAILABLE.
  const afterConsumable = buildExposure({
    boundaryUtc: "2026-04-01T07:00:00Z",
    backendManifest: manifest,
    observations: [observation],
  });
  assert.equal(afterConsumable.ok, true);
  assert.equal(
    afterConsumable.exposure.fields.find((f) => f.field === "recommendation").condition,
    EXPOSURE_CONDITION.AVAILABLE,
  );
});

// OI29-02 (§26.2/§26.3): lo pendiente de cierre no aparece como resultado
// final conocido. Un registro posterior al boundary no se muestra como VALOR
// conocido: se degrada a NOT_YET_CLOSED, visible sólo en evaluación posterior.
test("un outcome posterior al boundary no se expone como conocido", () => {
  const { manifest } = backendFor([EVALUATION_BENCHMARK]);
  const outcome = buildExposure({
    boundaryUtc: "2026-04-01T07:00:00Z",
    backendManifest: manifest,
    observations: [{
      field: "outcomes",
      condition: EXPOSURE_CONDITION.AVAILABLE,
      value: EVALUATION_BENCHMARK.value,
      provenance: provenance(EXPOSURE_SOURCE_KIND.OUTCOME, EVALUATION_BENCHMARK),
    }],
  });
  assert.equal(outcome.ok, true);
  const outcomes = outcome.exposure.fields.find((f) => f.field === "outcomes");
  assert.equal(outcomes.condition, EXPOSURE_CONDITION.NOT_YET_CLOSED);
  assert.equal(outcomes.value, undefined);
  assert.ok(outcomes.reason.includes("posterior al boundary"));
  assert.ok(outcome.exposure.hasUnavailableContent, true);
});

// Sin backend no hay nada que contraste: una observación con procedencia no
// pasa (fail-closed); la exposición se construye, pero no acepta el valor.
test("una observación con valor sin backend verificado se rechaza", () => {
  const outcome = buildExposure({
    boundaryUtc: "2026-04-01T07:00:00Z",
    observations: [{
      field: "recommendation",
      condition: EXPOSURE_CONDITION.AVAILABLE,
      value: { action: "BUY" },
      provenance: provenance(EXPOSURE_SOURCE_KIND.RECOMMENDATION, RECOMMENDATION_BASE),
    }],
  });
  assert.equal(outcome.ok, false);
  assert.equal(outcome.errors[0].code, "PROVENANCE_BACKEND_UNVERIFIED");
});

// OI29-02: un manifest no verificado no sirve de backend.
test("un manifest backend no verificado se rechaza", () => {
  const outcome = buildExposure({
    boundaryUtc: "2026-04-01T07:00:00Z",
    backendManifest: { records: [{ key: "fake", revisionId: "v1", value: { action: "BUY" } }] },
    observations: [],
  });
  assert.equal(outcome.ok, false);
  assert.equal(outcome.errors[0].code, "UNVERIFIED_BACKEND_MANIFEST");
});

test("una sección duplicada es doble verdad y se rechaza", () => {
  const { manifest } = backendFor([RECOMMENDATION_BASE]);
  const observation = {
    field: "recommendation",
    condition: EXPOSURE_CONDITION.AVAILABLE,
    value: RECOMMENDATION_BASE.value,
    provenance: provenance(EXPOSURE_SOURCE_KIND.RECOMMENDATION, RECOMMENDATION_BASE),
  };
  const outcome = buildExposure({
    boundaryUtc: "2026-04-01T07:00:00Z",
    backendManifest: manifest,
    observations: [observation, observation],
  });
  assert.equal(outcome.ok, false);
  assert.equal(outcome.errors[0].code, "DUPLICATE_EXPOSURE_FIELD");
});

test("sin observaciones, ninguna sección aparenta cobertura", () => {
  const outcome = buildExposure({ boundaryUtc: "2026-04-01T07:00:00Z" });
  assert.equal(outcome.ok, true);
  assert.equal(outcome.exposure.fields.every((f) => f.condition === EXPOSURE_CONDITION.MISSING), true);
});

test("boundary sin zona explícita se rechaza", () => {
  const outcome = buildExposure({ boundaryUtc: "2026-04-01T07:00:00" });
  assert.equal(outcome.ok, false);
  assert.equal(outcome.errors[0].code, "NOT_UTC_ANCHORED");
});
