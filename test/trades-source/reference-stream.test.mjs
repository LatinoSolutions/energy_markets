// La referencia del archivo del cliente trae una foto diaria de cada contrato:
// power DE son 2,3 GB de parquet y más de 41 GB de NDJSON (DATA-01, 2026-09-26).
// El agregador la lee en streaming y sin filas repetidas; como todos sus
// consumidores reducen por contrato, el resultado es el mismo que con todas las filas.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { readReferenceRows } from "../../operations/trades/TR-01/aggregate-trades-rows.mjs";
import { contractWindowsFromReference, measureReferenceExpiryRelation } from "../../src/trades-source/contract-windows.mjs";

const daily = (trdDate) => ({
  Cmdty: "POWER", Area: "DE", ShortCode: "DEBM", Maturity: "202512", InstrumentISIN: "ISIN-DEBM-202512",
  StartDate: "2025-06-02", EndDate: "2025-11-28", ExpiryDate: "2025-11-28", TrdDate: trdDate, _source: "eex_derivative_reference",
});

test("la referencia se lee en streaming, sin filas repetidas y con el mismo resultado", async () => {
  const directory = mkdtempSync(join(tmpdir(), "tr01-reference-"));
  try {
    const rows = [daily("2025-11-20"), daily("2025-11-21"), daily("2025-11-24"),
      { ...daily("2025-11-24"), Maturity: "202601", InstrumentISIN: "ISIN-DEBM-202601", EndDate: "2025-12-30", ExpiryDate: "2025-12-30" },
      { Cmdty: "POWER", Area: "DE", EndDate: "2025-12-30" }];
    const path = join(directory, "reference.ndjson");
    writeFileSync(path, `${JSON.stringify({ _meta: { artifactKind: "TR-01_REFERENCE_ROWS" } })}\n${rows.map((row) => JSON.stringify(row)).join("\n")}\n`);

    const read = await readReferenceRows(path);
    // 3 fotos del mismo contrato colapsan en 1; el otro contrato y la fila sin identidad se conservan.
    assert.equal(read.length, 3);
    assert.equal(read.some((row) => "TrdDate" in row || "_source" in row), false, "sólo los campos que usan los consumidores");

    const exchangeDaysBetween = (start, end) => [start, end];
    assert.deepEqual(
      [...contractWindowsFromReference(read, { exchangeDaysBetween })],
      [...contractWindowsFromReference(rows, { exchangeDaysBetween })],
    );
    assert.deepEqual(measureReferenceExpiryRelation(read), measureReferenceExpiryRelation(rows));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
