import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { createTempDir } from "../helpers/tmpdir.mjs";
import path from "node:path";

// BT04-H1-TOB-TIE (2026-09-25): varias filas TOB (EXPLICIT / IMPLIED) con el mismo
// último Tm antes de las 11:00. La regla del cliente es el best ask de esa
// observación (client input 2026-09-23 execution_and_costs.md §1 paso 2), no la
// última fila del archivo. Caso real: G0BQ-202601 el 2025-11-25, 31.475 vs 31.33.
const builder = new URL("../../operations/exploratory/v2/build_tob_slots.py", import.meta.url).pathname;

const FIXTURE = `
import sys, pyarrow as pa, pyarrow.parquet as pq, os
lake = sys.argv[1]
folder = os.path.join(lake, "trd_date=2025-11-25", "pull_id=fixture")
os.makedirs(folder)
rows = [
    # Tm anterior: no debe ganar aunque su ask sea menor.
    ("2025-11-25T09:59:40.000000Z", "30.000", "9", "29.9", "EXPLICIT"),
    ("2025-11-25T09:59:50.50498Z", "31.33", "1", "", "IMPLIED"),
    ("2025-11-25T09:59:50.50498Z", "31.475", "5", "31.255", "EXPLICIT"),
    # Mismo best ask que otra fila: gana el menor AskSz conocido.
    ("2025-11-25T09:29:58.000000Z", "32.55", "4", "32.4", "EXPLICIT"),
    ("2025-11-25T09:29:58.000000Z", "32.55", "1", "", "IMPLIED"),
]
table = pa.table({
    "ShortCode": ["G0BQ"] * len(rows),
    "Maturity": ["202601"] * len(rows),
    "Tm": [row[0] for row in rows],
    "AskPx": [row[1] for row in rows],
    "AskSz": [row[2] for row in rows],
    "BidPx": [row[3] for row in rows],
    "AskType": [row[4] for row in rows],
    "InstrumentType": ["Simple Instrument"] * len(rows),
})
pq.write_table(table, os.path.join(folder, "part.parquet"))
`;

test("build_tob_slots: con Tm empatado gana el best ask, no el orden de archivo", () => {
  const workspace = createTempDir("bt04-tob-tie-");
  try {
    const lake = path.join(workspace, "lake");
    const fixture = spawnSync("python3", ["-c", FIXTURE, lake], { encoding: "utf8" });
    assert.equal(fixture.status, 0, fixture.stderr);
    const output = path.join(workspace, "slots.json");
    const run = spawnSync("python3", [builder, output], { encoding: "utf8", env: { ...process.env, EEX_TOB_LAKE: lake } });
    assert.equal(run.status, 0, run.stderr);

    const slots = JSON.parse(readFileSync(output, "utf8"));
    assert.match(slots.slotTieRule, /min ask/);
    const day = slots.series["G0BQ|202601"]["2025-11-25"];
    const at1100 = day[slots.slotsBerlin.indexOf("11:00")];
    assert.equal(at1100.ask, 31.33);
    assert.equal(at1100.askSz, 1);
    assert.equal(at1100.quoteTm, "2025-11-25T09:59:50.50498Z");
    const at1030 = day[slots.slotsBerlin.indexOf("10:30")];
    assert.deepEqual([at1030.ask, at1030.askSz], [32.55, 1]);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});
