// DATA-01: el job de TR-01 registra la verificación del archivo sellado para que
// la decisión de fuente pueda cerrarse. Prueba el parseo del `_meta` del archivo
// y la actualización del candidato, sin tocar los artefactos commiteados.

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { createTempDir } from "../helpers/tmpdir.mjs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { applyArchiveVerification, mergeArchiveInventory, readMeta, resolveArchiveVerification } from "../../operations/trades/TR-01/record-archive-verification.mjs";

const repoRoot = fileURLToPath(new URL("../../", import.meta.url));
const SCRIPT = path.join(repoRoot, "operations/trades/TR-01/record-archive-verification.mjs");

const OBSERVED_SHA = "a".repeat(64);
const gasMeta = {
  artifactKind: "TR-01_TRADES_ROWS",
  source: "archive",
  archiveVerification: { bytes: 100, sha256: OBSERVED_SHA },
  tableInventory: { eex_derivative_trade: { members: 10, rows: 100 }, eex_derivative_reference: { members: 2, rows: 5 } },
  dateMin: "2020-11-02",
  dateMax: "2026-09-11",
};
const powerMeta = {
  artifactKind: "TR-01_TRADES_ROWS",
  source: "archive",
  archiveVerification: { bytes: 100, sha256: OBSERVED_SHA },
  tableInventory: { eex_derivative_trade: { members: 8, rows: 80 }, eex_derivative_top_of_book: { members: 3, rows: 30 } },
  dateMin: "2020-11-05",
  dateMax: "2026-09-10",
};

test("DATA-01 TR-01: el inventario del archivo une tablas y extremos de fecha", () => {
  const inventory = mergeArchiveInventory([gasMeta, powerMeta]);
  assert.deepEqual(inventory.tables, ["eex_derivative_reference", "eex_derivative_top_of_book", "eex_derivative_trade"]);
  assert.equal(inventory.dateMin, "2020-11-02");
  assert.equal(inventory.dateMax, "2026-09-11");
  assert.deepEqual(inventory.tableInventory.eex_derivative_trade, { members: 18, rows: 180 });
});

test("DATA-01 TR-01: la verificación usa el sha y el tamaño que midió el extractor, no los argumentos", () => {
  const document = {
    candidates: [
      { id: "EEX_LAKE", present: true, sha256Verified: false },
      { id: "CLIENT_SEALED_ARCHIVE", present: true, sha256Verified: false },
    ],
  };
  const verification = resolveArchiveVerification([gasMeta, powerMeta], { expectedSha256: OBSERVED_SHA, expectedBytes: 100 });
  assert.equal(verification.ok, true, JSON.stringify(verification));
  const updated = applyArchiveVerification(document, {
    inventory: mergeArchiveInventory([gasMeta, powerMeta]),
    archivePath: "/srv/data/eex-client-archive/archivo.tar.zst",
    verification,
  });
  const lake = updated.candidates.find((candidate) => candidate.id === "EEX_LAKE");
  const archive = updated.candidates.find((candidate) => candidate.id === "CLIENT_SEALED_ARCHIVE");
  assert.equal(lake.sha256Verified, false);
  assert.equal(archive.sha256Verified, true);
  assert.equal(archive.sha256, OBSERVED_SHA);
  assert.equal(archive.observedBytes, 100);
  assert.equal(archive.inventory.dateMax, "2026-09-11");
});

test("DATA-01 TR-01: sin _meta.archiveVerification o con otro sha/tamaño no se acredita la verificación", () => {
  const missing = resolveArchiveVerification([gasMeta, { ...powerMeta, archiveVerification: undefined }], { expectedSha256: OBSERVED_SHA, expectedBytes: 100 });
  assert.equal(missing.ok, false);
  assert.equal(missing.code, "ARCHIVE_VERIFICATION_MISSING");

  const wrongSha = resolveArchiveVerification([gasMeta, powerMeta], { expectedSha256: "c".repeat(64), expectedBytes: 100 });
  assert.equal(wrongSha.ok, false);
  assert.equal(wrongSha.code, "ARCHIVE_SHA_MISMATCH");

  const wrongBytes = resolveArchiveVerification([gasMeta, powerMeta], { expectedSha256: OBSERVED_SHA, expectedBytes: 999 });
  assert.equal(wrongBytes.ok, false);
  assert.equal(wrongBytes.code, "ARCHIVE_BYTES_MISMATCH");
});

test("DATA-01 TR-01: readMeta toma la última _meta del NDJSON (va al final del archivo)", async () => {
  const dir = createTempDir("data01-meta-");
  try {
    const rows = path.join(dir, "rows.ndjson");
    writeFileSync(rows, [
      JSON.stringify({ Cmdty: "NATGAS", Px: "1" }),
      JSON.stringify({ _meta: { artifactKind: "TR-01_TRADES_ROWS", dateMax: "2026-09-11", tableInventory: { eex_derivative_trade: { members: 1, rows: 1 } } } }),
    ].join("\n") + "\n");
    const meta = await readMeta(rows);
    assert.equal(meta.dateMax, "2026-09-11");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("DATA-01 TR-01: el script actualiza un source-candidates.json de fixture", () => {
  const dir = createTempDir("data01-recorder-");
  try {
    const gasRows = path.join(dir, "gas.ndjson");
    const powerRows = path.join(dir, "power.ndjson");
    writeFileSync(gasRows, `${JSON.stringify({ _meta: gasMeta })}\n`);
    writeFileSync(powerRows, `${JSON.stringify({ _meta: powerMeta })}\n`);
    const candidates = path.join(dir, "source-candidates.json");
    writeFileSync(candidates, JSON.stringify({ candidates: [{ id: "CLIENT_SEALED_ARCHIVE", sha256Verified: false }, { id: "EEX_LAKE" }] }));
    execFileSync("node", [SCRIPT, "--gas-rows", gasRows, "--power-rows", powerRows, "--archive", "/x/archivo.tar.zst", "--sha256", OBSERVED_SHA, "--bytes", "100", "--candidates", candidates], { encoding: "utf8" });
    const updated = JSON.parse(readFileSync(candidates, "utf8"));
    const archive = updated.candidates.find((candidate) => candidate.id === "CLIENT_SEALED_ARCHIVE");
    assert.equal(archive.sha256Verified, true);
    assert.equal(archive.observedBytes, 100);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("DATA-01 TR-01: el script falla cerrado si el _meta no acredita el archivo y no lo marca", () => {
  const dir = createTempDir("data01-recorder-fail-");
  try {
    const gasRows = path.join(dir, "gas.ndjson");
    const powerRows = path.join(dir, "power.ndjson");
    // power sin archiveVerification: no hay prueba de lo observado.
    writeFileSync(gasRows, `${JSON.stringify({ _meta: gasMeta })}\n`);
    writeFileSync(powerRows, `${JSON.stringify({ _meta: { ...powerMeta, archiveVerification: undefined } })}\n`);
    const candidates = path.join(dir, "source-candidates.json");
    const original = JSON.stringify({ candidates: [{ id: "CLIENT_SEALED_ARCHIVE", sha256Verified: false }, { id: "EEX_LAKE" }] });
    writeFileSync(candidates, original);
    assert.throws(() => execFileSync("node", [SCRIPT, "--gas-rows", gasRows, "--power-rows", powerRows, "--archive", "/x/archivo.tar.zst", "--sha256", OBSERVED_SHA, "--bytes", "100", "--candidates", candidates], { encoding: "utf8" }));
    assert.equal(readFileSync(candidates, "utf8"), original, "el archivo de candidatos no se tocó");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
