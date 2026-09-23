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
} from "../../src/operator-interface/index.mjs";

function valueProvenance(sourceKind, value, overrides = {}) {
  return {
    sourceKind,
    recordKey: "fixture.record",
    revisionId: "v1",
    valueSha256: canonicalValueSha256(value).sha256,
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
  const value = { action: "BUY", sizing: 0.5 };
  const outcome = buildExposureField({
    field: "recommendation",
    condition: EXPOSURE_CONDITION.AVAILABLE,
    value,
    provenance: valueProvenance(EXPOSURE_SOURCE_KIND.RECOMMENDATION, value),
  });
  assert.equal(outcome.ok, true);
  assert.equal(outcome.record.value.action, "BUY");
  assert.equal(outcome.record.condition, EXPOSURE_CONDITION.AVAILABLE);
});

test("un valor que no coincide con su versión canónica se rechaza", () => {
  const declared = { action: "WAIT" };
  const outcome = buildExposureField({
    field: "recommendation",
    condition: EXPOSURE_CONDITION.AVAILABLE,
    value: { action: "BUY" },
    provenance: valueProvenance(EXPOSURE_SOURCE_KIND.RECOMMENDATION, declared),
  });
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

// §25.1 IMP-29: recomendación, fill hipotético y outcome no se confunden.
test("una fuente de ejecución no se muestra como recomendación", () => {
  const value = { action: "BUY" };
  const outcome = buildExposureField({
    field: "recommendation",
    condition: EXPOSURE_CONDITION.AVAILABLE,
    value,
    provenance: valueProvenance(EXPOSURE_SOURCE_KIND.EXECUTION, value),
  });
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

// §26.2: uncertainty/stale/proxy visibles; el proxy identificado, no relabelado.
test("proxy e incertidumbre se conservan visibles con su valor", () => {
  const proxied = { price: 25.1, proxyId: "PROXY-1" };
  const outcome = buildExposureField({
    field: "proxyBenchmarkStatus",
    condition: EXPOSURE_CONDITION.PROXY,
    value: proxied,
    reason: "benchmark oficial aún no publicado",
    provenance: valueProvenance(EXPOSURE_SOURCE_KIND.PROXY_BENCHMARK, proxied),
  });
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
  const value = { action: "WAIT" };
  const outcome = buildExposure({
    boundaryUtc: "2026-04-01T07:00:00Z",
    observations: [{
      field: "recommendation",
      condition: EXPOSURE_CONDITION.AVAILABLE,
      value,
      provenance: valueProvenance(EXPOSURE_SOURCE_KIND.RECOMMENDATION, value),
    }],
  });
  assert.equal(outcome.ok, true);
  assert.equal(outcome.exposure.fields.length, 13);
  assert.equal(outcome.exposure.fields.find((f) => f.field === "recommendation").condition, EXPOSURE_CONDITION.AVAILABLE);
  assert.equal(outcome.exposure.fields.filter((f) => f.condition === EXPOSURE_CONDITION.MISSING).length, 12);
  assert.equal(outcome.exposure.hasUnavailableContent, true);
});

test("una sección duplicada es doble verdad y se rechaza", () => {
  const value = { action: "WAIT" };
  const observation = {
    field: "recommendation",
    condition: EXPOSURE_CONDITION.AVAILABLE,
    value,
    provenance: valueProvenance(EXPOSURE_SOURCE_KIND.RECOMMENDATION, value),
  };
  const outcome = buildExposure({ boundaryUtc: "2026-04-01T07:00:00Z", observations: [observation, observation] });
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
