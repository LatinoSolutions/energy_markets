import { test } from "node:test";
import assert from "node:assert/strict";

import {
  buildPitRecord,
  isConsumableAtBoundary,
  semanticsOf,
} from "../../src/pit-views/index.mjs";

// §6.1: cuatro semánticas distintas por dato, verificadas separadamente (§19.2).

function validInput(overrides = {}) {
  return {
    key: "G0BQ.202604.reference",
    viewScope: "decision",
    occurredAtUtc: "2026-03-31T17:15:00Z",
    publishedAtUtc: "2026-03-31T18:00:00Z",
    consumableAtUtc: "2026-04-01T06:00:00Z",
    // Fixture sintético de evidencia contemporánea de consumo; no es cobertura
    // real (§25.2 IMP-06). Identifica dónde quedó demostrado el consumo.
    consumableEvidence: {
      source: "fixture://ingest-log",
      locator: "row G0BQ.202604 @ 2026-04-01T06:00Z",
      sha256: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    },
    revisionId: "v1",
    value: 24.35,
    ...overrides,
  };
}

test("buildPitRecord acepta un registro con las cuatro semánticas explícitas", () => {
  const outcome = buildPitRecord(validInput());
  assert.equal(outcome.ok, true);
  const record = outcome.record;
  assert.equal(record.publishedAtUtc, "2026-03-31T18:00:00.000Z");
  assert.equal(record.consumableAtUtc, "2026-04-01T06:00:00.000Z");
  assert.deepEqual(Object.keys(semanticsOf(record)).sort(), [
    "consumableAtUtc",
    "consumableEvidence",
    "occurredAtUtc",
    "publishedAtUtc",
    "revisionId",
  ]);
});

test("sin policy-consumable time demostrado el registro se conserva como unavailable, no se presume (§6.1)", () => {
  const outcome = buildPitRecord(validInput({ consumableAtUtc: undefined }));
  assert.equal(outcome.ok, true);
  const record = outcome.record;
  assert.equal(record.consumability, "unavailable");
  assert.equal(record.consumableAtUtc, null);
  assert.equal(record.consumableFromUtc, null);
});

test("consumible 'en todo boundary' se rechaza: publicación no prueba consumo de la policy (§6.1)", () => {
  const outcome = buildPitRecord(validInput({ consumableAtUtc: undefined, consumableAtAnyBoundary: true }));
  assert.equal(outcome.ok, false);
  assert.ok(outcome.errors.some((e) => e.code === "UNSUPPORTED_CONSUMABILITY"));
});

test("timestamps sin zona explícita se rechazan: presumir UTC ocultaría su origen", () => {
  const naive = buildPitRecord(validInput({ occurredAtUtc: "2026-03-31T17:15:00" }));
  assert.equal(naive.ok, false);
  assert.equal(naive.errors[0].code, "NOT_UTC_ANCHORED");
});

test("published con offset explícito se normaliza a UTC sin perder el instante", () => {
  // 19:00+01:00 == 18:00Z: misma información, almacenada en UTC (§6.1).
  const outcome = buildPitRecord(validInput({ publishedAtUtc: "2026-03-31T19:00:00+01:00" }));
  assert.equal(outcome.ok, true);
  assert.equal(outcome.record.publishedAtUtc, "2026-03-31T18:00:00.000Z");
});

test("revisionId ausente se rechaza: toda versión concreta se declara", () => {
  const outcome = buildPitRecord(validInput({ revisionId: "  " }));
  assert.equal(outcome.ok, false);
  assert.ok(outcome.errors.some((e) => e.code === "MISSING_REVISION"));
});

test("proxy sin identificador se rechaza; el proxy declarado conserva su id", () => {
  const anonymous = buildPitRecord(validInput({ proxy: true }));
  assert.equal(anonymous.ok, false);
  assert.equal(anonymous.errors[0].code, "MISSING_PROXY_ID");
  const declared = buildPitRecord(validInput({ proxy: true, proxyId: "PROXY-TRADES-MID-0.75/0.25" }));
  assert.equal(declared.ok, true);
  assert.equal(declared.record.proxy, true);
  assert.equal(declared.record.proxyId, "PROXY-TRADES-MID-0.75/0.25");
});

test("consumible antes de su publicación es incoherencia PIT, no disponibilidad", () => {
  const outcome = buildPitRecord(validInput({
    publishedAtUtc: "2026-04-01T08:00:00Z",
    consumableAtUtc: "2026-04-01T06:00:00Z",
  }));
  assert.equal(outcome.ok, false);
  assert.equal(outcome.errors[0].code, "PIT_ORDER_INCOHERENT");
});

test("isConsumableAtBoundary: consumableAtUtc posterior al boundary no entra", () => {
  const record = buildPitRecord(validInput()).record;
  const before = isConsumableAtBoundary(record, "2026-04-01T05:59:59Z");
  assert.equal(before.consumable, false);
  const at = isConsumableAtBoundary(record, "2026-04-01T06:00:00Z");
  assert.equal(at.consumable, true);
});

test("sin prueba de consumo el dato es unavailable para la policy, no consumible", () => {
  const record = buildPitRecord(validInput({ consumableAtUtc: undefined })).record;
  const outcome = isConsumableAtBoundary(record, "2026-04-01T23:00:00Z");
  assert.equal(outcome.consumable, false);
  assert.match(outcome.reason, /no demostrado/);
});

test("consumableFromUtc separa los relojes: consumo demostrado vs unavailable", () => {
  const demonstrated = buildPitRecord(validInput()).record;
  assert.equal(demonstrated.consumableFromUtc, "2026-04-01T06:00:00.000Z");
  const unavailable = buildPitRecord(validInput({ consumableAtUtc: undefined })).record;
  assert.equal(unavailable.consumableFromUtc, null);
});

test("entrada auditada MISSING sin versión ni valor se conserva unavailable, no se rechaza (§25.2)", () => {
  const outcome = buildPitRecord({
    key: "R-01",
    viewScope: "decision",
    revisionId: null,
    value: null,
    occurredAtUtc: null,
    publishedAtUtc: null,
    consumableAtUtc: null,
    reason: "MISSING",
  });
  assert.equal(outcome.ok, true);
  assert.equal(outcome.record.revisionId, null);
  assert.equal(outcome.record.valueStatus, "MISSING");
  assert.equal(outcome.record.consumability, "unavailable");
  assert.equal(outcome.record.consumableFromUtc, null);
});

test("sin viewScope el registro se rechaza: no se presume input de decisión (§14.2/§14.3)", () => {
  const outcome = buildPitRecord(validInput({ viewScope: undefined }));
  assert.equal(outcome.ok, false);
  assert.ok(outcome.errors.some((e) => e.code === "MISSING_VIEW_SCOPE"));
});

test("consumo sin publicación en origen no se demuestra: el registro queda unavailable (§6.1)", () => {
  const outcome = buildPitRecord(validInput({ publishedAtUtc: null }));
  assert.equal(outcome.ok, true);
  assert.equal(outcome.record.consumability, "unavailable");
  assert.equal(outcome.record.consumableFromUtc, null);
  const atBoundary = isConsumableAtBoundary(outcome.record, "2026-04-02T00:00:00Z");
  assert.equal(atBoundary.consumable, false);
  assert.match(atBoundary.reason, /sin publicación/);
});

test("timestamp de consumo sin evidencia contemporánea no demuestra consumo: unavailable (§6.1)", () => {
  // Un consumableAtUtc declarado por sí solo es una afirmación suelta: sin
  // prueba verificable, el dato se trata como unavailable (§6.1). Es el caso
  // señalado en review: un timestamp arbitrario no puede marcarse "demonstrated".
  const outcome = buildPitRecord(validInput({ consumableEvidence: undefined }));
  assert.equal(outcome.ok, true);
  assert.equal(outcome.record.consumability, "unavailable");
  assert.equal(outcome.record.consumableFromUtc, null);
  assert.equal(outcome.record.consumableEvidence, null);
  const atBoundary = isConsumableAtBoundary(outcome.record, "2026-04-02T00:00:00Z");
  assert.equal(atBoundary.consumable, false);
  assert.match(atBoundary.reason, /sin evidencia contemporánea/);
});

test("evidencia de consumo mal formada se rechaza: source/locator no vacíos y sha256 de 64 hex", () => {
  const noLocator = buildPitRecord(validInput({ consumableEvidence: { source: "log" } }));
  assert.equal(noLocator.ok, false);
  assert.ok(noLocator.errors.some((e) => e.code === "INVALID_CONSUMABLE_EVIDENCE"));
  const badSha = buildPitRecord(validInput({
    consumableEvidence: { source: "log", locator: "row", sha256: "no-hex" },
  }));
  assert.equal(badSha.ok, false);
  assert.ok(badSha.errors.some((e) => e.code === "INVALID_CONSUMABLE_EVIDENCE"));
  const okSha = buildPitRecord(validInput({
    consumableEvidence: { source: "log", locator: "row", sha256: "ABCDEF0123456789abcdef0123456789abcdef0123456789abcdef0123456789" },
  }));
  assert.equal(okSha.ok, true);
  assert.equal(okSha.record.consumableEvidence.sha256, "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789");
});

test("consumableAtUtc sin evidencia no entra a la decisión aunque el boundary sea posterior", () => {
  const record = buildPitRecord(validInput({ consumableEvidence: undefined })).record;
  const outcome = isConsumableAtBoundary(record, "2026-04-01T06:00:00Z");
  assert.equal(outcome.consumable, false);
  assert.match(outcome.reason, /sin evidencia contemporánea/);
});

test("un registro consumible sin value queda unavailable y no expone un valor indefinido (§6.2)", () => {
  const outcome = buildPitRecord(validInput({ value: undefined }));
  assert.equal(outcome.ok, true);
  assert.equal(outcome.record.valueStatus, "MISSING");
  assert.equal(outcome.record.consumability, "unavailable");
  assert.equal("value" in outcome.record, false);
  const atBoundary = isConsumableAtBoundary(outcome.record, "2026-04-02T00:00:00Z");
  assert.equal(atBoundary.consumable, false);
  assert.match(atBoundary.reason, /valor ausente/);
});

test("un valor presente sin versión se rechaza: el contenido no se materializa sin revisionId", () => {
  const outcome = buildPitRecord(validInput({ revisionId: undefined }));
  assert.equal(outcome.ok, false);
  assert.ok(outcome.errors.some((e) => e.code === "MISSING_REVISION"));
});
