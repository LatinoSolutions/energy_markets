import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { createTempDir } from "../helpers/tmpdir.mjs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { buildTobSlotSeries, tobSlotsDocumentToSeries } from "../../src/trades-bridge/tob-slots.mjs";
import { tobRow } from "./fixtures.mjs";

const SCRIPT = fileURLToPath(new URL("../../operations/trades/TR-03/extract-tob-rows.py", import.meta.url));
const PRODUCTS = ["G0BQ"];

const FIXTURE_ROWS = [
  tobRow({ Tm: "2025-09-01T06:59:00Z", AskPx: "100", AskSz: "1", BidPx: "99" }),
  tobRow({ Tm: "2025-09-01T06:59:30Z", AskPx: "99", AskSz: "2", BidPx: "98" }),
  tobRow({ Tm: "2025-09-01T06:44:00Z", AskPx: "111", BidPx: "110" }),
  tobRow({ InstrumentType: "Spread", Tm: "2025-09-01T06:59:00Z" }),
  tobRow({ AskPx: "0", Tm: "2025-09-01T06:59:00Z" }),
  tobRow({ BidPx: "100", Tm: "2025-09-01T06:59:00Z" }),
  tobRow({ ShortCode: "XXZZ", Tm: "2025-09-01T06:59:00Z" }),
  tobRow({ Maturity: "202604", Tm: "2025-09-01T06:59:00Z", AskPx: "200", BidPx: "190" }),
  tobRow({ TrdDate: "2025-09-02", Tm: "2025-09-02T06:59:00Z", AskPx: "101", BidPx: "99" }),
];

test("la regla Python del job TOB coincide con la implementación JS (cross-check)", () => {
  const directory = createTempDir("tr03-tob-");
  try {
    const rowsPath = join(directory, "rows.ndjson");
    writeFileSync(rowsPath, `${FIXTURE_ROWS.map((row) => JSON.stringify(row)).join("\n")}\n`);
    const outPath = join(directory, "tob.json");
    execFileSync("python3", [SCRIPT, "--from-rows", rowsPath, "--products", PRODUCTS.join(","), "--out", outPath], { encoding: "utf8" });
    const pythonSeries = tobSlotsDocumentToSeries(JSON.parse(readFileSync(outPath, "utf8")));
    const jsSeries = buildTobSlotSeries(FIXTURE_ROWS, { productCodes: new Set(PRODUCTS) });
    assert.deepEqual([...pythonSeries.keys()].sort(), [...jsSeries.keys()].sort());
    for (const contract of jsSeries.keys()) {
      for (const day of jsSeries.get(contract).keys()) {
        assert.deepEqual(pythonSeries.get(contract).get(day), jsSeries.get(contract).get(day), `${contract} ${day}`);
      }
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

const BUILD_LAKE = String.raw`
import io, os, sys
import pyarrow as pa
import pyarrow.parquet as pq

root = sys.argv[1]
rows = [
    {"Cmdty": "NATGAS", "Area": "THE", "ShortCode": "G0BQ", "Maturity": "202601",
     "TrdDate": "2025-09-01", "Tm": "2025-09-01T06:59:00Z", "AskPx": "100",
     "AskSz": "1", "BidPx": "99", "InstrumentType": "Simple Instrument"},
]
path = os.path.join(root, "table=eex_derivative_top_of_book", "cmdty=NATGAS", "area=THE",
                    "trd_date=2025-09-01", "pull_id=abc")
os.makedirs(path, exist_ok=True)
pq.write_table(pa.Table.from_pylist(rows), os.path.join(path, "part.parquet"))
`;

test("el job TOB lee el lago y emite la serie por contrato y día", () => {
  const directory = createTempDir("tr03-toblake-");
  try {
    execFileSync("python3", ["-c", BUILD_LAKE, directory], { encoding: "utf8" });
    const outPath = join(directory, "tob.json");
    execFileSync("python3", [
      SCRIPT, "--source", "lake", "--lake-root", directory,
      "--area", "cmdty=NATGAS/area=THE", "--products", PRODUCTS.join(","),
      "--start", "2025-09-01", "--end", "2025-09-01", "--out", outPath,
    ], { encoding: "utf8" });
    const series = tobSlotsDocumentToSeries(JSON.parse(readFileSync(outPath, "utf8")));
    const slots = series.get("G0BQ|202601").get("2025-09-01");
    assert.equal(slots[2].ask, 100);
    assert.equal(slots[0], null);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("el extractor TOB no crea el thread pool global de Arrow", () => {
  const readLines = readFileSync(SCRIPT, "utf8").split("\n").filter((line) => line.includes("read_table("));
  assert.ok(readLines.length >= 1);
  for (const line of readLines) {
    assert.match(line, /use_threads=False/, `read_table sin use_threads=False: ${line.trim()}`);
  }
});
