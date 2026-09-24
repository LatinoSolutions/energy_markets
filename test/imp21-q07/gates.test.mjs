// Tests gate REQUIRES_AUDIT DEP-17 [data audit intradía] (IMP-21).
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  evaluateIntradayAuditGate,
  consumeIntradayAuditBinding,
} from "../../src/imp21-q07/index.mjs";
import { createSyntheticIntradayAudit } from "./fixtures.mjs";

test("sin artefacto de audit intradía el gate falla cerrado con blocker explícito", () => {
  const gate = evaluateIntradayAuditGate({});
  assert.equal(gate.ok, false);
  assert.equal(gate.code, "MISSING_INTRADAY_AUDIT");
  assert.ok(/DEP-17/.test(gate.blocker));
});

test("audit fuera de alcance Q07 no satisface el gate", () => {
  const audit = { ...createSyntheticIntradayAudit(), auditScope: "DEP-06_GENERAL" };
  assert.equal(evaluateIntradayAuditGate({ intradayAudit: audit }).code, "INTRADAY_SCOPE_MISMATCH");
});

test("hallazgos auditados no aceptados no satisfacen el REQUIRES_AUDIT", () => {
  const audit = { ...createSyntheticIntradayAudit(), status: "DRAFT" };
  const gate = evaluateIntradayAuditGate({ intradayAudit: audit });
  assert.equal(gate.ok, false);
  assert.equal(gate.code, "INTRADAY_AUDIT_NOT_ACCEPTED");
});

test("audit equivalente non-IMP-03 exige hash trazable", () => {
  const audit = { ...createSyntheticIntradayAudit(), producedByImp: "EXTERNAL_FACTUAL_AUDIT", contentHash: undefined };
  const gate = evaluateIntradayAuditGate({ intradayAudit: audit });
  assert.equal(gate.ok, false);
  assert.equal(gate.code, "INTRADAY_AUDIT_NOT_SOURCED");
});

test("audit IMP-03 aceptado sin provenance de contenido no satisface el gate (simetría de integridad)", () => {
  // §25.2.1: "audit realizado ≠ ... ≠ gate satisfecho". Un ACCEPTED
  // autodeclarado por IMP-03 sin identidad de contenido no es verificable; se
  // exige el mismo binding que a un audit equivalente.
  const audit = { ...createSyntheticIntradayAudit(), producedByImp: "IMP-03", contentHash: undefined };
  const gate = evaluateIntradayAuditGate({ intradayAudit: audit });
  assert.equal(gate.ok, false);
  assert.equal(gate.code, "INTRADAY_AUDIT_NOT_SOURCED");
});

test("hash de contenido malformado (no sha256 hex) se rechaza", () => {
  const audit = { ...createSyntheticIntradayAudit(), contentHash: "no-es-un-sha256" };
  assert.equal(evaluateIntradayAuditGate({ intradayAudit: audit }).code, "INTRADAY_AUDIT_NOT_SOURCED");
});

test("audit aceptado en alcance puede ser consumido como REQUIRES_AUDIT, no como evidencia del experimento", () => {
  const gate = evaluateIntradayAuditGate({ intradayAudit: createSyntheticIntradayAudit() });
  assert.equal(gate.ok, true);
  const consumption = consumeIntradayAuditBinding({ gate });
  assert.equal(consumption.ok, true);
  assert.equal(consumption.consumed.auditScope, "DEP-17_INTRA_DAY_DATA_AUDIT");
  assert.match(consumption.consumed.contentHash, /^[0-9a-f]{64}$/);
  assert.match(consumption.consumed.evidenceRole, /no evidencia del experimento/);
});
