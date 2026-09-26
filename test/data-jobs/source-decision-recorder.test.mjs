// DATA-01: el job de TR-01 registra la verificación del archivo sellado para que
// la decisión de fuente pueda cerrarse. Prueba el parseo del `_meta` del archivo
// y la actualización del candidato, sin tocar los artefactos commiteados.

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { applyArchiveVerification, mergeArchiveInventory, readMeta } from "../../operations/trades/TR-01/record-archive-verification.mjs";

const repoRoot = fileURLToPath(new URL("../../", import.meta.url));
const SCRIPT = path.join(repoRoot, "operations/trades/TR-01/record-archive-verification.mjs");

const gasMeta = {
  artifactKind: "TR-01_TRADES_ROWS",
  source: "archive",
  archiveVerification: { bytes: 100, sha256: "a".repeat(64) },
  tableInventory: { eex_derivative_trade: { members: 10, rows: 100 }, eex_derivative_reference: { members: 2, rows: 5 } },
  dateMin: "2020-11-02",
  dateMax: "2026-09-11",
};
const powerMeta = {
  artifactKind: "TR-01_TRADES_ROWS",
  source: "archive",
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

test("DATA-01 TR-01: la verificación marca el archivo como verificado y no toca el candidato del lago", () => {
  const document = {
    candidates: [
      { id: "EEX_LAKE", present: true, sha256Verified: false },
      { id: "CLIENT_SEALED_ARCHIVE", present: true, sha256Verified: false },
    ],
  };
  const updated = applyArchiveVerification(document, {
    inventory: mergeArchiveInventory([gasMeta, powerMeta]),
    archivePath: "/srv/data/eex-client-archive/archivo.tar.zst",
    sha256: "b".repeat(64),
    bytes: 108015856868,
  });
  const lake = updated.candidates.find((candidate) => candidate.id === "EEX_LAKE");
  const archive = updated.candidates.find((candidate) => candidate.id === "CLIENT_SEALED_ARCHIVE");
  assert.equal(lake.sha256Verified, false);
  assert.equal(archive.sha256Verified, true);
  assert.equal(archive.sha256, "b".repeat(64));
  assert.equal(archive.observedBytes, 108015856868);
  assert.equal(archive.inventory.dateMax, "2026-09-11");
});

test("DATA-01 TR-01: readMeta toma la última _meta del NDJSON (va al final del archivo)", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "data01-meta-"));
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
  const dir = mkdtempSync(path.join(tmpdir(), "data01-recorder-"));
  try {
    const gasRows = path.join(dir, "gas.ndjson");
    const powerRows = path.join(dir, "power.ndjson");
    writeFileSync(gasRows, `${JSON.stringify({ _meta: gasMeta })}\n`);
    writeFileSync(powerRows, `${JSON.stringify({ _meta: powerMeta })}\n`);
    const candidates = path.join(dir, "source-candidates.json");
    writeFileSync(candidates, JSON.stringify({ candidates: [{ id: "CLIENT_SEALED_ARCHIVE", sha256Verified: false }, { id: "EEX_LAKE" }] }));
    execFileSync("node", [SCRIPT, "--gas-rows", gasRows, "--power-rows", powerRows, "--archive", "/x/archivo.tar.zst", "--sha256", "c".repeat(64), "--bytes", "10", "--candidates", candidates], { encoding: "utf8" });
    const updated = JSON.parse(readFileSync(candidates, "utf8"));
    assert.equal(updated.candidates.find((candidate) => candidate.id === "CLIENT_SEALED_ARCHIVE").sha256Verified, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
