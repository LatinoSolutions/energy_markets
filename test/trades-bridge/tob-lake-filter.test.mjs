// El extractor TOB filtra producto e instrumento en Arrow antes de crear filas de
// Python (un día de top of book de power DE pesa ~371 MB de parquet y superaba el
// techo de 2 GiB del job, DATA-01 2026-09-26). El filtro temprano no puede cambiar
// la serie: el lago con filas mezcladas da lo mismo que la regla sobre las filas.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { tobSlotsDocumentToSeries } from "../../src/trades-bridge/tob-slots.mjs";
import { tobRow } from "./fixtures.mjs";

const SCRIPT = fileURLToPath(new URL("../../operations/trades/TR-03/extract-tob-rows.py", import.meta.url));
const PRODUCTS = ["G0BQ"];

const DAY_ROWS = [
  tobRow({ Tm: "2025-09-01T06:59:00Z", AskPx: "100", AskSz: "1", BidPx: "99" }),
  tobRow({ Tm: "2025-09-01T06:59:30Z", AskPx: "99", AskSz: "2", BidPx: "98" }),
  tobRow({ InstrumentType: "Spread", Tm: "2025-09-01T06:59:40Z", AskPx: "50", BidPx: "49" }),
  tobRow({ ShortCode: "XXZZ", Tm: "2025-09-01T06:59:45Z", AskPx: "10", BidPx: "9" }),
  tobRow({ ShortCode: "G0BM", Tm: "2025-09-01T06:59:50Z", AskPx: "20", BidPx: "19" }),
  tobRow({ AskPx: "0", Tm: "2025-09-01T06:59:55Z" }),
  tobRow({ Maturity: "202604", Tm: "2025-09-01T06:59:00Z", AskPx: "200", BidPx: "190" }),
];

const BUILD_LAKE = String.raw`
import json, os, sys
import pyarrow as pa
import pyarrow.parquet as pq

root, rows_path = sys.argv[1], sys.argv[2]
rows = [json.loads(line) for line in open(rows_path) if line.strip()]
path = os.path.join(root, "table=eex_derivative_top_of_book", "cmdty=NATGAS", "area=THE",
                    "trd_date=2025-09-01", "pull_id=abc")
os.makedirs(path, exist_ok=True)
pq.write_table(pa.Table.from_pylist(rows), os.path.join(path, "part.parquet"))
`;

test("el filtro temprano en Arrow no cambia la serie ni el conteo de filas leídas", () => {
  const directory = mkdtempSync(join(tmpdir(), "tr03-toblake-filter-"));
  try {
    const rowsPath = join(directory, "rows.ndjson");
    writeFileSync(rowsPath, `${DAY_ROWS.map((row) => JSON.stringify(row)).join("\n")}\n`);
    execFileSync("python3", ["-c", BUILD_LAKE, directory, rowsPath], { encoding: "utf8" });

    const lakeOut = join(directory, "lake.json");
    execFileSync("python3", [
      SCRIPT, "--source", "lake", "--lake-root", directory,
      "--area", "cmdty=NATGAS/area=THE", "--products", PRODUCTS.join(","),
      "--start", "2025-09-01", "--end", "2025-09-01", "--out", lakeOut,
    ], { encoding: "utf8" });
    const rowsOut = join(directory, "rows.json");
    execFileSync("python3", [SCRIPT, "--from-rows", rowsPath, "--products", PRODUCTS.join(","), "--out", rowsOut], { encoding: "utf8" });

    const lakeDocument = JSON.parse(readFileSync(lakeOut, "utf8"));
    const lakeSeries = tobSlotsDocumentToSeries(lakeDocument);
    const rowsSeries = tobSlotsDocumentToSeries(JSON.parse(readFileSync(rowsOut, "utf8")));
    assert.deepEqual([...lakeSeries.keys()].sort(), [...rowsSeries.keys()].sort());
    for (const contract of rowsSeries.keys()) {
      for (const day of rowsSeries.get(contract).keys()) {
        assert.deepEqual(lakeSeries.get(contract).get(day), rowsSeries.get(contract).get(day), `${contract} ${day}`);
      }
    }
    // counts.rows sigue contando todas las filas leídas del día, no sólo las filtradas.
    assert.equal(lakeDocument.counts.rows, DAY_ROWS.length);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
