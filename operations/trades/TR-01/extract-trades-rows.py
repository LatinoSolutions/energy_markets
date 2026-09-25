#!/usr/bin/env python3
"""TR-01: extraccion read-only de trades del lago EEX o del archivo sellado del cliente.

Job de escaneo que LANZA BRU (TRADES_MODE_PLAN.md TR-01: "Los agentes de la
Oficina NO corren escaneos completos del lago ni backtests completos: construyen
productores y los prueban con fixtures chicos. Los escaneos (TR-01, TR-03) ...
se lanzan como jobs por la ruta de BT-05, disparados por Bru"). Este script no
se corre completo desde la Oficina.

Salida: NDJSON (una linea por fila) precedida por una linea `_meta`. El
agregador Node (aggregate-trades-rows.mjs) aplica la regla de elegibilidad, el
dedup, el Delete point-in-time y la cobertura. Este script NO decide reglas: solo
lee y normaliza (una sola fuente de verdad para las reglas, en JS).

Fuente de la verdad de las columnas: lago /srv/hot-data/EEX, esquema por archivo
(visto en eex_derivative_trade): AgrsrAct, Area, Cmdty, Currency, ExpiryDate,
FromBrokenSpread, InstrumentISIN, InstrumentType, Maturity, ProductISIN, Px,
ShortCode, Sz, Tm, TrdDate, TrdID, TrdType, UOM, UpdtAct, VolumeOnly (+ TrdVol en
algunos pulls) y provenance `_pull_id`, `_retrieved_at_utc`, `_row_sha256`.

Uso:
  # lago
  python3 extract-trades-rows.py --source lake \
      --area cmdty=NATGAS/area=THE --start 2020-11-02 --end 2026-07-28 \
      --out rows-natgas-the.ndjson
  # archivo sellado (fail-closed hasta verificar tamano y SHA-256)
  python3 extract-trades-rows.py --source archive \
      --archive /srv/data/eex-client-archive/eex-sealed-production-outright-2020-11-02--2026-09-11.tar.zst \
      --expected-sha256 <hex> --expected-bytes <n> --area cmdty=NATGAS/area=THE \
      --out rows-archive.ndjson
"""

import argparse
import datetime as dt
import glob
import hashlib
import json
import os
import subprocess
import sys

import pyarrow.parquet as pq

LAKE_ROOT = os.environ.get("EEX_LAKE_ROOT", "/srv/hot-data/EEX")
TRADE_TABLE = "eex_derivative_trade"
PROVENANCE_COLUMNS = ("_pull_id", "_retrieved_at_utc", "_row_sha256", "_source")


def sha256_file(path):
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def emit_row(row, source, out):
    payload = {key: value for key, value in row.items()}
    payload["_source"] = source
    out.write(json.dumps(payload, ensure_ascii=False, separators=(",", ":")))
    out.write("\n")


def lake_partitions(area, start, end):
    base = os.path.join(LAKE_ROOT, f"table={TRADE_TABLE}", area)
    days = sorted(
        entry.split("=", 1)[1]
        for entry in os.listdir(base)
        if entry.startswith("trd_date=")
    )
    return [day for day in days if (start is None or day >= start) and (end is None or day <= end)]


def extract_lake(area, start, end, out, max_days):
    days = lake_partitions(area, start, end)
    if max_days is not None:
        days = days[:max_days]
    out.write(json.dumps({
        "_meta": {
            "artifactKind": "TR-01_TRADES_ROWS",
            "source": "lake",
            "lakeRoot": LAKE_ROOT,
            "table": TRADE_TABLE,
            "area": area,
            "dateMin": days[0] if days else None,
            "dateMax": days[-1] if days else None,
            "dayCount": len(days),
        },
    }, separators=(",", ":"), ensure_ascii=False))
    out.write("\n")
    rows_emitted = 0
    for day in days:
        pattern = os.path.join(LAKE_ROOT, f"table={TRADE_TABLE}", area, f"trd_date={day}", "*", "part.parquet")
        for path in sorted(glob.glob(pattern)):
            table = pq.read_table(path)
            for row in table.to_pylist():
                emit_row(row, TRADE_TABLE, out)
                rows_emitted += 1
        print(f"{day} rows={rows_emitted}", file=sys.stderr, flush=True)
    return rows_emitted


def verify_archive(path, expected_sha256, expected_bytes):
    if not os.path.exists(path):
        raise SystemExit(f"archivo ausente: {path}")
    actual_bytes = os.path.getsize(path)
    if expected_bytes is not None and actual_bytes != expected_bytes:
        raise SystemExit(f"FAIL-CLOSED: tamano {actual_bytes} != esperado {expected_bytes}; descarga incompleta")
    actual_sha256 = sha256_file(path)
    if expected_sha256 is not None and actual_sha256 != expected_sha256:
        raise SystemExit(f"FAIL-CLOSED: sha256 {actual_sha256} != esperado {expected_sha256}")
    return {"bytes": actual_bytes, "sha256": actual_sha256}


def iter_tar_members(archive_path):
    # Un solo pase de descompresion: zstd -dc | tar (streaming).
    zstd = subprocess.Popen(["zstd", "-dc", archive_path], stdout=subprocess.PIPE)
    import tarfile
    try:
        with tarfile.open(fileobj=zstd.stdout, mode="r|") as tar:
            for member in tar:
                if not member.isfile() or not member.name.endswith(".parquet"):
                    continue
                if "/area=" in member.name and "cmdty=" in member.name:
                    yield member.name, tar.extractfile(member).read()
    finally:
        zstd.stdout.close()
        zstd.wait()


def extract_archive(archive_path, area, out, expected_sha256, expected_bytes, max_members):
    verification = verify_archive(archive_path, expected_sha256, expected_bytes)
    out.write(json.dumps({
        "_meta": {
            "artifactKind": "TR-01_TRADES_ROWS",
            "source": "archive",
            "archive": archive_path,
            "archiveVerification": verification,
            "area": area,
            "layoutAssumption": "tar.zst con parquet members en layout hive table=.../cmdty=.../area=.../trd_date=... (POR VERIFICAR contra el archivo real)",
        },
    }, separators=(",", ":"), ensure_ascii=False))
    out.write("\n")
    import io
    import pyarrow.parquet as pq_local
    rows_emitted = 0
    members_seen = 0
    for name, raw in iter_tar_members(archive_path):
        members_seen += 1
        if area not in name:
            continue
        table = pq_local.read_table(io.BytesIO(raw))
        for row in table.to_pylist():
            emit_row(row, TRADE_TABLE, out)
            rows_emitted += 1
        if max_members is not None and members_seen >= max_members:
            break
    return rows_emitted


def main():
    parser = argparse.ArgumentParser(description="TR-01: extraccion read-only de trades")
    parser.add_argument("--source", choices=["lake", "archive"], required=True)
    parser.add_argument("--area", required=True, help="p.ej. cmdty=NATGAS/area=THE")
    parser.add_argument("--start")
    parser.add_argument("--end")
    parser.add_argument("--archive")
    parser.add_argument("--expected-sha256")
    parser.add_argument("--expected-bytes", type=int)
    parser.add_argument("--max-days", type=int, help="limite acotado para pruebas/fixtures")
    parser.add_argument("--max-members", type=int)
    parser.add_argument("--out", required=True)
    arguments = parser.parse_args()

    with open(arguments.out, "w", encoding="utf-8") as out:
        if arguments.source == "lake":
            rows = extract_lake(arguments.area, arguments.start, arguments.end, out, arguments.max_days)
        else:
            if not arguments.archive:
                raise SystemExit("--archive es obligatorio con --source archive")
            rows = extract_archive(
                arguments.archive, arguments.area, out,
                arguments.expected_sha256, arguments.expected_bytes, arguments.max_members,
            )
    print(f"escrito {arguments.out}: {rows} filas", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
