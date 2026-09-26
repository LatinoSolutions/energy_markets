import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT = fileURLToPath(new URL("../../operations/trades/TR-01/extract-trades-rows.py", import.meta.url));

function classify(member, areaArgument) {
  const output = execFileSync("python3", [SCRIPT, "--classify-member", member, "--area", areaArgument], {
    encoding: "utf8",
  });
  return JSON.parse(output);
}

const TRADE = "data/lake/v1/table=eex_derivative_trade/cmdty=NATGAS/area=THE/trd_date=2025-11-20/pull_id=abc/part.parquet";

test("solo la tabla de trades con area exacta se clasifica como trade", () => {
  const result = classify(TRADE, "cmdty=NATGAS/area=THE");
  assert.equal(result.kind, "trade");
  assert.equal(result.table, "eex_derivative_trade");
  assert.equal(result.cmdty, "NATGAS");
  assert.equal(result.area, "THE");
});

test("el filtro por substring no admite area=THE___TTF", () => {
  const member = TRADE.replace("/area=THE/", "/area=THE___TTF/");
  const result = classify(member, "cmdty=NATGAS/area=THE");
  assert.equal(result.kind, "other_area");
});

test("una tabla distinta de trades no se emite como trade", () => {
  const member = TRADE.replace("table=eex_derivative_trade", "table=eex_derivative_top_of_book");
  const result = classify(member, "cmdty=NATGAS/area=THE");
  assert.equal(result.kind, "other_table");
  assert.equal(result.table, "eex_derivative_top_of_book");
});

test("eex_derivative_reference se inventaria aparte y nunca como trade", () => {
  const member = TRADE.replace("table=eex_derivative_trade", "table=eex_derivative_reference");
  const result = classify(member, "cmdty=NATGAS/area=THE");
  assert.equal(result.kind, "reference");
  assert.equal(result.table, "eex_derivative_reference");
});

test("POWER/DE se clasifica con su propia area exacta", () => {
  const member =
    "data/lake/v1/table=eex_derivative_trade/cmdty=POWER/area=DE/trd_date=2025-11-20/pull_id=abc/part.parquet";
  assert.equal(classify(member, "cmdty=POWER/area=DE").kind, "trade");
  assert.equal(classify(member, "cmdty=POWER/area=DE___AT").kind, "other_area");
});

const BUILD_ARCHIVE = String.raw`
import io, os, subprocess, sys, tarfile
import pyarrow as pa
import pyarrow.parquet as pq

outdir = sys.argv[1]

def parquet_bytes(rows):
    buf = io.BytesIO()
    pq.write_table(pa.Table.from_pylist(rows), buf)
    return buf.getvalue()

trade_rows = [
    {"Cmdty": "NATGAS", "Area": "THE", "ShortCode": "G0BM", "InstrumentISIN": "ISIN-1",
     "Maturity": "202512", "TrdDate": "2025-11-20", "Tm": "2025-11-20T10:00:00Z", "Px": "32.5"},
    {"Cmdty": "NATGAS", "Area": "THE", "ShortCode": "G0BM", "InstrumentISIN": "ISIN-1",
     "Maturity": "202512", "TrdDate": "2025-11-24", "Tm": "2025-11-24T10:00:00Z", "Px": "33.1"},
]
reference_row = {"Cmdty": "NATGAS", "Area": "THE", "ShortCode": "G0BM", "InstrumentISIN": "ISIN-1",
     "Maturity": "202512", "StartDate": "2025-11-01", "EndDate": "2025-11-21", "ExpiryDate": "2025-11-25"}
# La misma foto dos veces (la tabla trae una por dia): se emite una sola vez.
reference_rows = [reference_row, dict(reference_row)]
members = {
    "data/lake/v1/table=eex_derivative_trade/cmdty=NATGAS/area=THE/trd_date=2025-11-20/pull_id=abc/part.parquet": parquet_bytes(trade_rows),
    "data/lake/v1/table=eex_derivative_reference/cmdty=NATGAS/area=THE/trd_date=2025-11-20/pull_id=abc/part.parquet": parquet_bytes(reference_rows),
    # No es un parquet valido: si el extractor lo leyera, fallaria. Otra tabla del area
    # pedida se inventaria por miembro sin leerse (un top of book real pesa hasta 2,66 GB).
    "data/lake/v1/table=eex_derivative_top_of_book/cmdty=NATGAS/area=THE/trd_date=2025-11-20/pull_id=abc/part.parquet": b"not a parquet: must never be read",
}
tar_path = os.path.join(outdir, "fixture.tar")
with tarfile.open(tar_path, "w") as tar:
    for name, data in members.items():
        info = tarfile.TarInfo(name)
        info.size = len(data)
        tar.addfile(info, io.BytesIO(data))
zst_path = os.path.join(outdir, "fixture.tar.zst")
subprocess.run(["zstd", "-q", "-f", "-o", zst_path, tar_path], check=True)
print(zst_path)
`;

// El destructor de los thread pools de Arrow aborta de forma intermitente en el
// shutdown ("terminate called without an active exception") DESPUES de escribir
// la salida: 1/35 corridas de la suite con read_table + use_threads=False
// (2026-09-25). La carrera no se puede forzar; se prueba su causa: leer parquet
// no deja hilos nativos vivos, y ninguna lectura esquiva read_parquet_bytes.
const COUNT_THREADS_AFTER_READ = String.raw`
import importlib.util, io, os, sys
import pyarrow as pa
import pyarrow.parquet as pq

spec = importlib.util.spec_from_file_location("extractor", sys.argv[1])
extractor = importlib.util.module_from_spec(spec)
spec.loader.exec_module(extractor)

buf = io.BytesIO()
pq.write_table(pa.Table.from_pylist([{"TrdDate": "2025-11-20", "Px": "32.5"}]), buf)
before = len(os.listdir("/proc/self/task"))
rows = extractor.read_parquet_bytes(buf.getvalue()).to_pylist()
after = len(os.listdir("/proc/self/task"))
print(len(rows), after - before)
`;

test("leer parquet no arranca hilos nativos de Arrow (aborto intermitente en el shutdown)", () => {
  const [rowCount, extraThreads] = execFileSync("python3", ["-B", "-c", COUNT_THREADS_AFTER_READ, SCRIPT], {
    encoding: "utf8",
  }).trim().split(" ").map(Number);
  assert.equal(rowCount, 1);
  assert.equal(extraThreads, 0, "la lectura de parquet dejo hilos nativos vivos");
});

test("toda lectura de parquet del extractor pasa por read_parquet_bytes", () => {
  const source = readFileSync(SCRIPT, "utf8");
  assert.doesNotMatch(source, /\bread_table\(/, "pq.read_table usa la API de Dataset y arranca el pool IO");
  const parquetFileCalls = source.split("\n").filter((line) => line.includes("pq.ParquetFile("));
  assert.equal(parquetFileCalls.length, 1);
  assert.match(parquetFileCalls[0], /ParquetFile\(pa\.BufferReader\(raw\)\)\.read\(use_threads=False\)/);
});

test("el inventario del archivo declara dateMin/dateMax y separa la tabla de referencia", () => {
  const directory = mkdtempSync(join(tmpdir(), "tr01-archive-"));
  try {
    const archivePath = execFileSync("python3", ["-c", BUILD_ARCHIVE, directory], { encoding: "utf8" }).trim();
    const archiveBytes = readFileSync(archivePath);
    const sha256 = createHash("sha256").update(archiveBytes).digest("hex");
    const outPath = join(directory, "rows.ndjson");
    const referencePath = join(directory, "reference.ndjson");
    execFileSync(
      "python3",
      [
        SCRIPT,
        "--source", "archive",
        "--archive", archivePath,
        "--expected-sha256", sha256,
        "--expected-bytes", String(archiveBytes.length),
        "--area", "cmdty=NATGAS/area=THE",
        "--out", outPath,
        "--reference-out", referencePath,
      ],
      { encoding: "utf8" },
    );
    const lines = readFileSync(outPath, "utf8").trim().split("\n").map((line) => JSON.parse(line));
    const meta = lines.find((line) => line._meta)?._meta;
    assert.equal(meta.dateMin, "2025-11-20");
    assert.equal(meta.dateMax, "2025-11-24");
    assert.equal(meta.tableInventory.eex_derivative_trade.rows, 2);
    assert.equal(meta.tableInventory.eex_derivative_reference.rows, 2);
    assert.equal(meta.referenceRowsEmittedDistinct, 1);
    // Top of book: contado por miembro, sin leer sus filas; null = no medido, nunca 0.
    assert.deepEqual(meta.tableInventory.eex_derivative_top_of_book, { members: 1, rows: null });
    const tradeLines = lines.filter((line) => !line._meta);
    assert.equal(tradeLines.length, 2);
    const referenceLines = readFileSync(referencePath, "utf8").trim().split("\n").map((line) => JSON.parse(line));
    assert.equal(referenceLines.filter((line) => !line._meta).length, 1);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
