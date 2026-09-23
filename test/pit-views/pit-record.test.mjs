import { test } from "node:test";
import assert from "node:assert/strict";

import {
  buildPitRecord,
  isConsumableAtBoundary,
  loadConsumptionAttestations,
  isProxyAdmissibleAtBoundary,
  semanticsOf,
} from "../../src/pit-views/index.mjs";
// Costura de tests con raíz de confianza sintética; no es superficie pública.
import { canonicalValueSha256, loadConsumptionAttestationsAt, loadValueAttestationsAt } from "../../src/pit-views/pit-record.mjs";
import { attestationRepo, ATTESTATION_PATH, FIXTURE_RECEIPT_PATH, fixtureRepo } from "./fixture-repo.mjs";

// §6.1: cuatro semánticas distintas por dato, verificadas separadamente (§19.2).

// Atestación sintética de un audit (§6.4). No es un audit real: vive en un
// repo temporal con un IMP_RECEIPT sintético (fixture-repo.mjs) y sólo existe
// para ejercitar el camino verificado en disco.
const ATTESTATION = {
  source: "fixture://ingest-log",
  locator: "row G0BQ.202604 @ 2026-04-01T06:00Z",
  sha256: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  key: "G0BQ.202604.reference",
  revisionId: "v1",
  valueSha256: canonicalValueSha256(24.35).sha256,
  consumableAtUtc: "2026-04-01T06:00:00Z",
};

// Procedencia sintética del valor 24.35 de v1 (fixture, no un audit real).
const VALUE_ATTESTATION = {
  source: "fixture://value-log",
  locator: "G0BQ.202604.reference@v1",
  sha256: "b".repeat(64),
  key: "G0BQ.202604.reference",
  revisionId: "v1",
  revisionOf: null,
  valueSha256: canonicalValueSha256(24.35).sha256,
  publishedAtUtc: "2026-03-31T18:00:00Z",
  revisionEffectiveAtUtc: null,
};

function verifiedRegistry(attestations, options) {
  const { repoRoot, attestationRef } = attestationRepo(attestations, options);
  return loadConsumptionAttestationsAt(repoRoot, { refs: [attestationRef] });
}

function verifiedValueRegistry(attestations, options) {
  const { repoRoot, attestationRef } = attestationRepo(attestations, { ...options, artifactKind: "PIT_VALUE_ATTESTATIONS" });
  return loadValueAttestationsAt(repoRoot, { refs: [attestationRef] });
}

const AUDITED = {
  evidenceRegistry: verifiedRegistry([ATTESTATION]).registry,
  valueRegistry: verifiedValueRegistry([VALUE_ATTESTATION]).registry,
};

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
  const declared = buildPitRecord(validInput({ proxy: true, proxyId: "PROXY-TRADES-MID-0.75/0.25" }), {
    ...AUDITED,
    proxyDeclarations: [{ key: "G0BQ.202604.reference", proxyId: "PROXY-TRADES-MID-0.75/0.25", allowed: true, fallbackRank: 1, declaredAtUtc: "2026-01-01T00:00:00Z" }],
  });
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
  const record = buildPitRecord(validInput(), AUDITED).record;
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
  const demonstrated = buildPitRecord(validInput(), AUDITED).record;
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

// --- Review: vínculo de evidencia con el audit (§6.1/§6.4) ---

test("source/locator arbitrarios sin vínculo con el audit no demuestran consumo: unavailable", () => {
  // Caso de review: dos cadenas cualesquiera bastaban para "demonstrated".
  const unlinked = buildPitRecord(validInput({
    consumableEvidence: { source: "cualquier-cosa", locator: "cualquier-otra", sha256: "b".repeat(64) },
  }), AUDITED);
  assert.equal(unlinked.ok, true);
  assert.equal(unlinked.record.consumability, "unavailable");
  assert.equal(unlinked.record.consumableFromUtc, null);
  assert.equal(unlinked.record.consumableEvidence.auditLinked, false);
  const atBoundary = isConsumableAtBoundary(unlinked.record, "2026-04-02T00:00:00Z");
  assert.equal(atBoundary.consumable, false);
  assert.match(atBoundary.reason, /sin vínculo comprobado con el audit/);

  // Sin registro de audit, ni siquiera la evidencia del fixture queda demostrada.
  const noRegistry = buildPitRecord(validInput());
  assert.equal(noRegistry.record.consumability, "unavailable");
});

test("evidencia sin sha256 no se vincula aunque source/locator coincidan con el audit", () => {
  const outcome = buildPitRecord(validInput({
    consumableEvidence: { source: "fixture://ingest-log", locator: "row G0BQ.202604 @ 2026-04-01T06:00Z" },
  }), AUDITED);
  assert.equal(outcome.ok, true);
  assert.equal(outcome.record.consumability, "unavailable");
});

test("hash distinto al verificado por el audit se rechaza: evidencia adulterada u otra versión", () => {
  const outcome = buildPitRecord(validInput({
    consumableEvidence: { source: "fixture://ingest-log", locator: "row G0BQ.202604 @ 2026-04-01T06:00Z", sha256: "c".repeat(64) },
  }), AUDITED);
  assert.equal(outcome.ok, false);
  assert.ok(outcome.errors.some((e) => e.code === "EVIDENCE_HASH_MISMATCH"));
});

test("evidencia vinculada por source+locator+hash queda demonstrated con identidad del audit", () => {
  const outcome = buildPitRecord(validInput(), AUDITED);
  assert.equal(outcome.record.consumability, "demonstrated");
  assert.equal(outcome.record.consumableEvidence.auditLinked, true);
  assert.equal(outcome.record.consumableEvidence.auditId, "AUDIT-FIXTURE");
});

test("el registro de evidencia auditada acepta `path` (forma de los artifacts IMP-03) y rechaza entradas incompletas", () => {
  const withPath = buildPitRecord(validInput(), {
    ...AUDITED,
    evidenceRegistry: verifiedRegistry([{ ...ATTESTATION, source: undefined, path: "fixture://ingest-log" }]).registry,
  });
  assert.equal(withPath.record.consumability, "demonstrated");
  const incomplete = verifiedRegistry([{ ...ATTESTATION, locator: undefined }]);
  assert.equal(incomplete.ok, false);
  assert.ok(incomplete.errors.some((e) => e.code === "INVALID_AUDITED_EVIDENCE"));
  const noAuditId = verifiedRegistry([ATTESTATION], { auditId: "" });
  assert.equal(noAuditId.ok, false);
  assert.ok(noAuditId.errors.some((e) => e.code === "INVALID_ATTESTATION_ARTIFACT"));
});

// --- Review 6: la atestación no la crea el llamante (§6.1/§6.4/§25.2) ---

test("review 6: una atestación en memoria con auditId FAKE no demuestra consumo; se rechaza", () => {
  const fake = buildPitRecord(validInput(), {
    auditedEvidence: [{ ...ATTESTATION, auditId: "FAKE", source: "fixture://ingest-log" }],
  });
  assert.equal(fake.ok, false);
  assert.ok(fake.errors.some((e) => e.code === "UNVERIFIED_AUDITED_EVIDENCE"));
});

test("review 6: un registro con la misma forma pero sin cargar de disco no acredita nada", () => {
  const forged = Object.freeze({ entries: [{ ...ATTESTATION, auditId: "FAKE", consumableAtUtc: "2026-04-01T06:00:00.000Z" }] });
  const outcome = buildPitRecord(validInput(), { evidenceRegistry: forged });
  assert.equal(outcome.ok, false);
  assert.ok(outcome.errors.some((e) => e.code === "UNVERIFIED_AUDITED_EVIDENCE"));
});

test("review 6: atestación en un artifact sin receipt aceptado no se carga", () => {
  const notRegistered = verifiedRegistry([ATTESTATION], { registered: false });
  assert.equal(notRegistered.ok, false);
  assert.equal(notRegistered.errors[0].code, "ARTIFACT_NOT_IN_ACCEPTED_RECEIPT");
  const inReview = verifiedRegistry([ATTESTATION], { receiptOutcome: "in_review" });
  assert.equal(inReview.ok, false);
  assert.equal(inReview.errors[0].code, "ARTIFACT_NOT_IN_ACCEPTED_RECEIPT");
});

test("review 6: el hash declarado del artifact de atestación debe coincidir con su contenido", () => {
  const { repoRoot, attestationRef } = attestationRepo([ATTESTATION]);
  const zeros = loadConsumptionAttestationsAt(repoRoot, { refs: [{ ...attestationRef, sha256: "0".repeat(64) }] });
  assert.equal(zeros.ok, false);
  assert.equal(zeros.errors[0].code, "ARTIFACT_HASH_MISMATCH");
  const invented = loadConsumptionAttestationsAt(repoRoot, { refs: [{ ...attestationRef, path: "evidence/inventado.json" }] });
  assert.equal(invented.ok, false);
  assert.equal(invented.errors[0].code, "ARTIFACT_NOT_FOUND");
});

test("review 6: un artifact aceptado que no es de atestaciones no demuestra consumo", () => {
  const { repoRoot, refs } = fixtureRepo({
    artifacts: [{ path: ATTESTATION_PATH, content: JSON.stringify({ artifactKind: "OTRA_COSA", auditId: "A", attestations: [ATTESTATION] }) }],
  });
  const outcome = loadConsumptionAttestationsAt(repoRoot, { refs });
  assert.equal(outcome.ok, false);
  assert.equal(outcome.errors[0].code, "INVALID_ATTESTATION_ARTIFACT");
});

test("review 6: en el repo real no hay atestaciones aceptadas; sin refs nada queda demostrado", () => {
  const empty = loadConsumptionAttestations();
  assert.equal(empty.ok, true);
  assert.deepEqual(empty.registry.entries, []);
  const outcome = buildPitRecord(validInput(), { evidenceRegistry: empty.registry });
  assert.equal(outcome.record.consumability, "unavailable");
});

test("la evidencia vinculada conserva la procedencia verificada del artifact de atestación", () => {
  const outcome = buildPitRecord(validInput(), AUDITED);
  const provenance = outcome.record.consumableEvidence.attestationArtifact;
  assert.equal(provenance.path, ATTESTATION_PATH);
  assert.match(provenance.sha256, /^[0-9a-f]{64}$/);
  assert.equal(provenance.receiptPath, FIXTURE_RECEIPT_PATH);
});

// --- Review: proxy predeclarado y permitido (§6.2) ---

const PROXY_ID = "PROXY-TRADES-MID-0.75/0.25";

test("un proxyId no predeclarado se rechaza: un id suelto no identifica un proxy permitido", () => {
  const outcome = buildPitRecord(validInput({ proxy: true, proxyId: "INVENTADO" }), AUDITED);
  assert.equal(outcome.ok, false);
  assert.ok(outcome.errors.some((e) => e.code === "PROXY_NOT_DECLARED"));
  const otherKey = buildPitRecord(validInput({ proxy: true, proxyId: PROXY_ID }), {
    ...AUDITED,
    proxyDeclarations: [{ key: "otra-serie", proxyId: PROXY_ID, allowed: true, fallbackRank: 1, declaredAtUtc: "2026-01-01T00:00:00Z" }],
  });
  assert.equal(otherKey.ok, false);
  assert.ok(otherKey.errors.some((e) => e.code === "PROXY_NOT_DECLARED"));
});

test("proxyId sin proxy: true se rechaza: no se mezcla dato proxy con oficial", () => {
  const outcome = buildPitRecord(validInput({ proxyId: PROXY_ID }), AUDITED);
  assert.equal(outcome.ok, false);
  assert.ok(outcome.errors.some((e) => e.code === "PROXY_ID_WITHOUT_PROXY"));
});

test("isProxyAdmissibleAtBoundary exige declaración permitida y previa al boundary", () => {
  const build = (declaration) => buildPitRecord(validInput({ proxy: true, proxyId: PROXY_ID }), {
    ...AUDITED,
    proxyDeclarations: [{ key: "G0BQ.202604.reference", proxyId: PROXY_ID, fallbackRank: 1, ...declaration }],
  }).record;
  const allowed = build({ allowed: true, declaredAtUtc: "2026-03-01T00:00:00Z" });
  assert.equal(isProxyAdmissibleAtBoundary(allowed, "2026-04-02T00:00:00Z").admissible, true);
  const forbidden = build({ allowed: false, declaredAtUtc: "2026-03-01T00:00:00Z" });
  assert.match(isProxyAdmissibleAtBoundary(forbidden, "2026-04-02T00:00:00Z").reason, /no permitido/);
  const late = build({ allowed: true, declaredAtUtc: "2026-05-01T00:00:00Z" });
  assert.match(isProxyAdmissibleAtBoundary(late, "2026-04-02T00:00:00Z").reason, /no predeclarado/);
  // Una declaración posterior al boundary no revela en él si está permitida.
  const lateForbidden = build({ allowed: false, declaredAtUtc: "2026-05-01T00:00:00Z" });
  assert.deepEqual(
    isProxyAdmissibleAtBoundary(lateForbidden, "2026-04-02T00:00:00Z"),
    isProxyAdmissibleAtBoundary(late, "2026-04-02T00:00:00Z"),
  );
  // Un record armado a mano con proxy: true y sin declaración no es admisible.
  assert.equal(isProxyAdmissibleAtBoundary({ ...allowed, proxyDeclaration: null }, "2026-04-02T00:00:00Z").admissible, false);
});

test("la atestación del audit vale sólo para su key, revisión e instante de consumo", () => {
  // Caso de validación adversarial: con un hash de archivo auditado, un record
  // de otra key o con un consumo inventado quedaba "demonstrated".
  const otherKey = buildPitRecord(validInput({ key: "otra-serie" }), AUDITED);
  assert.equal(otherKey.record.consumability, "unavailable");
  const otherRevision = buildPitRecord(validInput({ revisionId: "v2" }), AUDITED);
  assert.equal(otherRevision.record.consumability, "unavailable");
  const inventedTime = buildPitRecord(validInput({ consumableAtUtc: "2026-05-01T00:00:00Z" }), AUDITED);
  assert.equal(inventedTime.record.consumability, "unavailable");
  // Una publicación distinta de la atestada ya no es la versión auditada: se rechaza.
  const inventedPublication = buildPitRecord(validInput({ consumableAtUtc: "2020-01-01T00:00:00Z", publishedAtUtc: "2019-12-31T00:00:00Z" }), AUDITED);
  assert.equal(inventedPublication.ok, false);
  assert.ok(inventedPublication.errors.some((e) => e.code === "VALUE_ATTESTATION_MISMATCH" && e.field === "publishedAtUtc"));
  // El mismo instante con otro offset es la misma atestación.
  const offset = buildPitRecord(validInput({ consumableAtUtc: "2026-04-01T08:00:00+02:00" }), AUDITED);
  assert.equal(offset.record.consumability, "demonstrated");
});

test("review 6: guardas por boundary no aceptan una fecha imposible", () => {
  const record = buildPitRecord(validInput(), AUDITED).record;
  assert.equal(isConsumableAtBoundary(record, "2026-04-02T00:00:00Z").consumable, true);
  assert.equal(isConsumableAtBoundary(record, "2026-02-30T00:00:00Z").consumable, false);
  const proxy = buildPitRecord(validInput({ proxy: true, proxyId: PROXY_ID }), {
    ...AUDITED,
    proxyDeclarations: [{ key: "G0BQ.202604.reference", proxyId: PROXY_ID, allowed: true, fallbackRank: 1, declaredAtUtc: "2026-02-01T00:00:00Z" }],
  }).record;
  assert.equal(isProxyAdmissibleAtBoundary(proxy, "2026-02-30T00:00:00Z").admissible, false);
});

// --- Validación adversarial: la raíz de confianza no la elige el llamante ---

test("la API pública rechaza un repoRoot elegido por el llamante (receipt fabricado en otro directorio)", () => {
  // Reproducción: repo propio con un receipt "accepted" y auditId FAKE.
  const { repoRoot, attestationRef } = attestationRepo([ATTESTATION], { auditId: "FAKE" });
  const outcome = loadConsumptionAttestations({ refs: [attestationRef], repoRoot });
  assert.equal(outcome.ok, false);
  assert.equal(outcome.errors[0].code, "TRUST_ROOT_NOT_CONFIGURABLE");
  // Con la raíz fija (repo real), ese artifact no existe.
  const fixed = loadConsumptionAttestations({ refs: [attestationRef] });
  assert.equal(fixed.ok, false);
  assert.equal(fixed.errors[0].code, "ARTIFACT_NOT_FOUND");
});

test("un receipt sin commit, editado tras el commit, o cuyo IMP no está aceptado en PLAN_STATUS no acredita", () => {
  for (const options of [{ commitReceipt: false }, { editReceiptAfterCommit: true }, { planStatus: "pendiente" }]) {
    const outcome = verifiedRegistry([ATTESTATION], options);
    assert.equal(outcome.ok, false, JSON.stringify(options));
    assert.equal(outcome.errors[0].code, "ARTIFACT_NOT_IN_ACCEPTED_RECEIPT", JSON.stringify(options));
  }
});

test("un artifactRef que apunta a un directorio devuelve error, no excepción", () => {
  const { repoRoot } = attestationRepo([ATTESTATION]);
  const outcome = loadConsumptionAttestationsAt(repoRoot, { refs: [{ path: "operations", sha256: "0".repeat(64) }] });
  assert.equal(outcome.ok, false);
  assert.equal(outcome.errors[0].code, "ARTIFACT_NOT_FOUND");
});

// --- P-001 de Bru (2026-09-23): procedencia, vínculo valor↔evidencia y números finitos ---

test("P-001.3: NaN, Infinity y -Infinity se rechazan en la entrada, también anidados", () => {
  for (const value of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, { price: Number.NaN }, [1, Number.POSITIVE_INFINITY], { legs: [{ q: Number.NEGATIVE_INFINITY }] }]) {
    const outcome = buildPitRecord(validInput({ value }), AUDITED);
    assert.equal(outcome.ok, false, String(value));
    assert.ok(outcome.errors.some((e) => e.field === "value" && e.code === "NON_FINITE_VALUE"), String(value));
  }
  assert.equal(canonicalValueSha256(Number.NaN).ok, false);
  assert.equal(canonicalValueSha256(Number.POSITIVE_INFINITY).ok, false);
});

test("P-001.3: valores no JSON (bigint, undefined anidado) se rechazan; un hash canónico no puede ocultarlos", () => {
  for (const value of [10n, { price: undefined }, [1, undefined]]) {
    const outcome = buildPitRecord(validInput({ value }), AUDITED);
    assert.equal(outcome.ok, false);
    assert.ok(outcome.errors.some((e) => e.code === "INVALID_VALUE"));
  }
});

test("P-001.2: el hash canónico no depende del orden de las claves y distingue valores distintos", () => {
  assert.equal(canonicalValueSha256({ a: 1, b: [2, "x"] }).sha256, canonicalValueSha256({ b: [2, "x"], a: 1 }).sha256);
  assert.notEqual(canonicalValueSha256(24.35).sha256, canonicalValueSha256(24.36).sha256);
  assert.notEqual(canonicalValueSha256("24.35").sha256, canonicalValueSha256(24.35).sha256);
});

test("P-001.1: sin atestación de procedencia el valor no es consumible aunque el consumo esté atestado", () => {
  const outcome = buildPitRecord(validInput(), { evidenceRegistry: AUDITED.evidenceRegistry });
  assert.equal(outcome.ok, true);
  assert.equal(outcome.record.valueProvenance, null);
  assert.equal(outcome.record.consumability, "unavailable");
  const verdict = isConsumableAtBoundary(outcome.record, "2026-04-02T00:00:00Z");
  assert.equal(verdict.consumable, false);
  assert.match(verdict.reason, /sin procedencia auditada/);
});

test("P-001.1: con procedencia atestada el record conserva auditId, evidencia y valueSha256", () => {
  const outcome = buildPitRecord(validInput(), AUDITED);
  assert.equal(outcome.record.consumability, "demonstrated");
  assert.equal(outcome.record.valueSha256, canonicalValueSha256(24.35).sha256);
  assert.equal(outcome.record.valueProvenance.auditId, "AUDIT-FIXTURE");
  assert.equal(outcome.record.valueProvenance.locator, VALUE_ATTESTATION.locator);
  assert.equal(outcome.record.valueProvenance.attestationArtifact.path, ATTESTATION_PATH);
});

test("P-001.2: una atestación de consumo válida no se reutiliza para presentar otro valor", () => {
  // Sólo el registro de consumo: la atestación ata el valor 24.35.
  const outcome = buildPitRecord(validInput({ value: 999999 }), { evidenceRegistry: AUDITED.evidenceRegistry });
  assert.equal(outcome.ok, false);
  assert.ok(outcome.errors.some((e) => e.field === "value" && e.code === "VALUE_ATTESTATION_MISMATCH"));
});

test("P-001.2: una atestación de procedencia válida no se reutiliza para otro valor ni otro lineage", () => {
  const otherValue = buildPitRecord(validInput({ value: 999999 }), { valueRegistry: AUDITED.valueRegistry });
  assert.equal(otherValue.ok, false);
  assert.ok(otherValue.errors.some((e) => e.field === "value" && e.code === "VALUE_ATTESTATION_MISMATCH"));
  const otherLineage = buildPitRecord(validInput({ revisionOf: "v0" }), AUDITED);
  assert.equal(otherLineage.ok, false);
  assert.ok(otherLineage.errors.some((e) => e.field === "revisionOf" && e.code === "VALUE_ATTESTATION_MISMATCH"));
});

test("P-001.2: atestaciones sin valueSha256 no se cargan; dos procedencias para una versión son conflicto", () => {
  const consumptionWithout = verifiedRegistry([{ ...ATTESTATION, valueSha256: undefined }]);
  assert.equal(consumptionWithout.ok, false);
  assert.ok(consumptionWithout.errors.some((e) => e.code === "INVALID_AUDITED_EVIDENCE"));
  const valueWithout = verifiedValueRegistry([{ ...VALUE_ATTESTATION, valueSha256: undefined }]);
  assert.equal(valueWithout.ok, false);
  assert.ok(valueWithout.errors.some((e) => e.code === "INVALID_AUDITED_EVIDENCE"));
  const twoValues = verifiedValueRegistry([VALUE_ATTESTATION, { ...VALUE_ATTESTATION, locator: "otro", valueSha256: canonicalValueSha256(1).sha256 }]);
  assert.equal(twoValues.ok, false);
  assert.ok(twoValues.errors.some((e) => e.code === "AUDITED_VALUE_CONFLICT"));
});

test("P-001.1: un registro de procedencia armado a mano o de otra clase de artifact no acredita", () => {
  const handBuilt = buildPitRecord(validInput(), { ...AUDITED, valueRegistry: { entries: [VALUE_ATTESTATION] } });
  assert.equal(handBuilt.ok, false);
  assert.ok(handBuilt.errors.some((e) => e.field === "valueRegistry" && e.code === "UNVERIFIED_AUDITED_EVIDENCE"));
  const { repoRoot, attestationRef } = attestationRepo([VALUE_ATTESTATION], { artifactKind: "PIT_VALUE_ATTESTATIONS" });
  const asConsumption = loadConsumptionAttestationsAt(repoRoot, { refs: [attestationRef] });
  assert.equal(asConsumption.ok, false);
  assert.equal(asConsumption.errors[0].code, "INVALID_ATTESTATION_ARTIFACT");
});

test("validación adversarial: un array con huecos o propiedades extra no es dato JSON; su hash no las vería", () => {
  const extra = [1, 2];
  extra.evil = 999;
  for (const value of [extra, [, 1]]) {
    const outcome = buildPitRecord(validInput({ value }), AUDITED);
    assert.equal(outcome.ok, false);
    assert.ok(outcome.errors.some((e) => e.code === "INVALID_VALUE"));
  }
});

test("validación adversarial: un getter no puede colar NaN después de validar; se guarda la copia validada", () => {
  let reads = 0;
  const shifty = {};
  Object.defineProperty(shifty, "x", { enumerable: true, get: () => (++reads > 2 ? Number.NaN : 1) });
  const outcome = buildPitRecord(validInput({ value: shifty }), AUDITED);
  assert.equal(outcome.ok, false);
  assert.ok(outcome.errors.some((e) => e.code === "NON_FINITE_VALUE" || e.code === "INVALID_VALUE"));
});

test("validación adversarial: dos consumos atestados con valores distintos para una versión son conflicto", () => {
  const outcome = verifiedRegistry([ATTESTATION, { ...ATTESTATION, locator: "otra fila", valueSha256: canonicalValueSha256(1).sha256 }]);
  assert.equal(outcome.ok, false);
  assert.ok(outcome.errors.some((e) => e.code === "AUDITED_VALUE_CONFLICT"));
});
