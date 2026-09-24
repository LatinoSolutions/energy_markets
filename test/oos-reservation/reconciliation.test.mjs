import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  sha256OfRaw,
  verifyMatrixIntegrity,
  verifyR01R17Reconciliation,
} from "../../src/oos-reservation/reconciliation.mjs";

const MATRIX_PATH = "operations/audit/IMP-03/data-sufficiency-matrix.json";
const RECONCILIATION_PATH = "operations/audit/IMP-09/R01-R17-reconciliation.json";

function loadRaw() {
  return readFileSync(MATRIX_PATH, "utf8");
}

function loadMatrix() {
  return JSON.parse(readFileSync(MATRIX_PATH, "utf8"));
}

function loadReconciliation() {
  return JSON.parse(readFileSync(RECONCILIATION_PATH, "utf8"));
}

// H7 (audit IMP-09): la matriz IMP-03 aceptada sigue intacta por SHA-256 y la
// contribución posterior es append-only con fuentes citadas con hash. La
// reconciliación añade evidencia; no edita la matriz ni declara lo derivable
// como cierre de la fila original.

test("la matriz aceptada de IMP-03 sigue intacta (sha256 coincide)", () => {
  const matrixRaw = loadRaw();
  const matrix = JSON.parse(matrixRaw);
  const reconciliation = loadReconciliation();
  const outcome = verifyR01R17Reconciliation({ matrixRaw, matrix, reconciliation });
  assert.equal(outcome.ok, true, JSON.stringify(outcome.errors));
  assert.equal(outcome.matrixSha256, sha256OfRaw(matrixRaw));
});

test("las filas R-01 y R-17 permanecen UNAVAILABLE en la matriz aceptada", () => {
  const matrix = loadMatrix();
  for (const requirementId of ["R-01", "R-17"]) {
    const row = matrix.rows.find((item) => item.requirementId === requirementId);
    assert.notEqual(row, undefined);
    assert.equal(row.availabilityStatus, "UNAVAILABLE");
  }
});

test("la reconciliación registra contribuciones para R-01 y R-17 con fuentes hashadas", () => {
  const reconciliation = loadReconciliation();
  const outcome = verifyR01R17Reconciliation({ matrixRaw: loadRaw(), matrix: loadMatrix(), reconciliation });
  assert.equal(outcome.ok, true);
  assert.equal(reconciliation.appendOnly.isAppendOnly, true);
  const r01 = reconciliation.reconciledRows.find((row) => row.requirementId === "R-01");
  assert.equal(r01.contribution.availabilityStatus, "AVAILABLE NOW");
  assert.ok(r01.contribution.sources.some((source) => source.path.includes("01_shared_campaign_rules")));
  const r17 = reconciliation.reconciledRows.find((row) => row.requirementId === "R-17");
  assert.equal(r17.contribution.availabilityStatus, "PROXY");
});

test("una fuente sin hash ni identidad invalida la contribución (fail-closed)", () => {
  const reconciliation = loadReconciliation();
  reconciliation.reconciledRows[0].contribution.sources.push({ path: "sin-hash.md" });
  const outcome = verifyR01R17Reconciliation({ matrixRaw: loadRaw(), matrix: loadMatrix(), reconciliation });
  assert.equal(outcome.ok, false);
  assert.ok(outcome.errors.some((error) => error.code === "SOURCES_WITHOUT_HASH"));
});

test("una matriz editada es rechazada por el verificador", () => {
  const reconciliation = loadReconciliation();
  const outcome = verifyMatrixIntegrity({ matrixRaw: loadRaw() + "\n", declaredSha256: reconciliation.acceptedMatrix.sha256 });
  assert.equal(outcome.ok, false);
  assert.ok(outcome.errors.some((error) => error.code === "MATRIX_SHA256_MISMATCH"));
});
