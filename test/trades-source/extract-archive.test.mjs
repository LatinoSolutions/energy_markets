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
reference_rows = [
    {"Cmdty": "NATGAS", "Area": "THE", "ShortCode": "G0BM", "InstrumentISIN": "ISIN-1",
     "Maturity": "202512", "StartDate": "2025-11-01", "EndDate": "2025-11-21", "ExpiryDate": "2025-11-25"},
]
members = {
    "data/lake/v1/table=eex_derivative_trade/cmdty=NATGAS/area=THE/trd_date=2025-11-20/pull_id=abc/part.parquet": parquet_bytes(trade_rows),
    "data/lake/v1/table=eex_derivative_reference/cmdty=NATGAS/area=THE/trd_date=2025-11-20/pull_id=abc/part.parquet": parquet_bytes(reference_rows),
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
    assert.equal(meta.tableInventory.eex_derivative_reference.rows, 1);
    const tradeLines = lines.filter((line) => !line._meta);
    assert.equal(tradeLines.length, 2);
    const referenceLines = readFileSync(referencePath, "utf8").trim().split("\n").map((line) => JSON.parse(line));
    assert.equal(referenceLines.filter((line) => !line._meta).length, 1);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
