import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { buildLakeBenchmarkReceipt, rowsArtifactPath, receiptPath, SUPERSEDED_RECEIPT } from "../../operations/audit/IMP-05/build-lake-benchmark.mjs";

// IMP05-SCOPE-01 review 2026-09-23 (§25.2.2 IMP-05: DEP-08/09 son
// RESOLVES_AUDIT de este IMP): el benchmark se reprodujo proxy-side sobre
// fechas auditadas reales del lago EEX y existe un receipt de reconciliación
// con la vista oficial fail-closed (P-007): la sustitución no fabrica
// equivalencia. Este test recomputa el receipt desde el artefacto de
// extracción y compara contra el artefacto comprometido.
const rowsArtifact = JSON.parse(readFileSync(rowsArtifactPath, "utf8"));
const rowsSha256 = createHash("sha256").update(readFileSync(rowsArtifactPath)).digest("hex");
const recomputed = buildLakeBenchmarkReceipt({ rowsArtifact, rowsArtifactSha256: rowsSha256 });
const committed = JSON.parse(readFileSync(receiptPath, "utf8"));

test("IMP-05 lago: el receipt completo es reproducible desde el artefacto de extracción", () => {
  assert.deepEqual(recomputed, committed);
});

test("IMP-05 lago: las fechas auditadas son reales y el hash liga el receipt a esos bytes", () => {
  assert.equal(rowsArtifact.artifactKind, "IMP-05_LAKE_PROXY_ROWS");
  assert.ok(committed.rowsArtifact.auditedDates.length > 0);
  for (const date of committed.rowsArtifact.auditedDates) {
    assert.match(date, /^\d{4}-\d{2}-\d{2}$/);
  }
  assert.equal(rowsSha256, committed.rowsArtifact.sha256, "si los bytes del lago cambian, el receipt queda desligado sin rehacer la extracción");
});

test("IMP-05 lago: cobertura por fecha separada, missing trazado, nunca rellenado", () => {
  const definedDates = committed.perDate.filter((dateRecord) => dateRecord.defined === true);
  assert.equal(committed.benchmark.count, definedDates.length);
  assert.equal(committed.benchmark.coverage, `${definedDates.length}/${committed.benchmark.expectedDatesCount}`);
  const missingExpected = committed.rowsArtifact.auditedDates
    .filter((date) => !definedDates.some((dateRecord) => dateRecord.trdDate === date));
  assert.deepEqual(committed.calendarMissingDates, missingExpected);
  for (const dateRecord of definedDates) {
    assert.notEqual(dateRecord.dailyReference, 0, "ninguna fecha se rellena: su valor proviene del lago real");
  }
});

test("IMP-05 lago: B con peso igual por fecha (§5.3) y status BENCHMARK_PROVISIONAL (§5.4)", () => {
  const defined = committed.perDate.filter((dateRecord) => dateRecord.defined === true);
  assert.ok(defined.length > 0);
  const expectedB = defined.reduce((total, dateRecord) => total + dateRecord.dailyReference, 0) / defined.length;
  assert.ok(Math.abs(committed.benchmark.B - expectedB) < 1e-9);
  assert.match(committed.benchmarkVersion.versionId, /^[0-9a-f]{64}$/);
  assert.equal(committed.provisionalStatus.status, "BENCHMARK_PROVISIONAL");
  assert.equal(committed.provisionalStatus.BENCHMARK_PROVISIONAL, true);
  assert.equal(committed.provisionalStatus.officialDates, 0, "sin feed oficial demostrado, ninguna fecha es oficial");
});

test("IMP-05 lago: reconciliación official fail-closed (P-007): proxy conservado y receipt del motor", () => {
  assert.equal(committed.reconciliation.N, 0);
  assert.equal(committed.reconciliation.setEqual, false);
  assert.equal(committed.reconciliation.equalityComparable, false);
  assert.equal(committed.reconciliation.equivalent, false);
  assert.deepEqual(committed.reconciliation.proxyOnlyDates, [...committed.rowsArtifact.auditedDates].sort());
  assert.deepEqual(committed.reconciliation.officialOnlyDates, []);
  assert.equal(committed.reconciliation.proxyPreserved, true, "la vista proxy no se borra por reconciliar");
  assert.deepEqual(Object.keys(committed.engineReceipt).sort(), ["algorithm", "receiptId"], "el motor emite un receipt reproducible de §25.1");
  assert.match(committed.engineReceipt.receiptId, /^[0-9a-f]{64}$/);
});

test("IMP-05 lago v2: la versión anterior se conserva byte a byte y la v2 la referencia (SPEC §5.3 versiones anteriores)", () => {
  const previousBytes = readFileSync(new URL(`../../${SUPERSEDED_RECEIPT.path}`, import.meta.url));
  assert.equal(createHash("sha256").update(previousBytes).digest("hex"), SUPERSEDED_RECEIPT.sha256);
  assert.deepEqual(committed.supersedes, SUPERSEDED_RECEIPT);
  const previous = JSON.parse(previousBytes);
  assert.equal(previous.benchmarkVersion.versionTag, "IMP-05-lake-proxy-eval-1");
  assert.equal(committed.benchmarkVersion.versionTag, "IMP-05-lake-proxy-eval-2");
  assert.notEqual(committed.benchmarkVersion.versionId, previous.benchmarkVersion.versionId);
});

test("IMP-05 lago v2: filas en 17:15:00.xxx ya no entran en la ventana estricta (BT04-C1-PROXY-WINDOW-DEDUP)", () => {
  const previous = JSON.parse(readFileSync(new URL(`../../${SUPERSEDED_RECEIPT.path}`, import.meta.url)));
  const byDate = new Map(previous.perDate.map((record) => [record.trdDate, record]));
  let strictlyFewer = 0;
  for (const record of committed.perDate) {
    const before = byDate.get(record.trdDate);
    assert.ok(record.strictCounts.midpoints <= before.strictCounts.midpoints);
    if (record.strictCounts.midpoints < before.strictCounts.midpoints) strictlyFewer += 1;
  }
  assert.ok(strictlyFewer > 0, "el lago auditado sí tiene observaciones en 17:15:00.xxx");
});
