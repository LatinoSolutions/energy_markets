#!/usr/bin/env python3
"""TR-01: extraccion read-only de trades del lago EEX o del archivo sellado del cliente.

Job de escaneo que LANZA BRU (TRADES_MODE_PLAN.md TR-01: "Los agentes de la
Oficina NO corren escaneos completos del lago ni backtests completos: construyen
productores y los prueban con fixtures chicos. Los escaneos (TR-01, TR-03) ...
se lanzan como jobs por la ruta de BT-05, disparados por Bru"). Este script no
se corre completo desde la Oficina.

Salida: NDJSON (una linea por fila) con una linea `_meta`. En el lago el `_meta`
va primero; en el archivo va al final porque `tableInventory` (inventario por
tabla, con `eex_derivative_reference` aparte) recien se conoce al terminar el
escaneo. El agregador Node (aggregate-trades-rows.mjs) localiza el `_meta` en
cualquier posicion, aplica la regla de elegibilidad, el dedup, el Delete
point-in-time y la cobertura. Este script NO decide reglas: solo lee, clasifica y
normaliza (una sola fuente de verdad para las reglas, en JS).

Fuente de la verdad de las columnas: lago /srv/hot-data/EEX, esquema por archivo
(visto en eex_derivative_trade): AgrsrAct, Area, Cmdty, Currency, ExpiryDate,
FromBrokenSpread, InstrumentISIN, InstrumentType, Maturity, ProductISIN, Px,
ShortCode, Sz, Tm, TrdDate, TrdID, TrdType, UOM, UpdtVol, UpdtAct, VolumeOnly
(+ TrdVol en algunos pulls) y provenance `_pull_id`, `_retrieved_at_utc`,
`_row_sha256`.

Layout real verificado del archivo sellado (2026-09-25, primeros miembros de
`eex-sealed-production-outright-2020-11-02--2026-09-11.tar.zst`):
    data/lake/v1/table=<tabla>/cmdty=<cmdty>/area=<area>/trd_date=<dia>/pull_id=<sha>/part.parquet
Coexisten varias tablas (al menos `eex_derivative_reference` y
`eex_derivative_trade`) y varias areas por cmdty (`area=THE` y
`area=THE___TTF`; `area=DE`, `area=DE___AT`, ...). Por eso la seleccion de
miembro es por clave hive EXACTA (`cmdty` y `area`), no por substring, y solo la
tabla de trades se emite como trade; `eex_derivative_reference` se inventaria
aparte (no es un trade).

Uso:
  # lago
  python3 extract-trades-rows.py --source lake \
      --area cmdty=NATGAS/area=THE --start 2020-11-02 --end 2026-07-28 \
      --out rows-natgas-the.ndjson
  # archivo sellado (fail-closed hasta verificar tamano y SHA-256)
  python3 extract-trades-rows.py --source archive \
      --archive /srv/data/eex-client-archive/eex-sealed-production-outright-2020-11-02--2026-09-11.tar.zst \
      --expected-sha256 <hex> --expected-bytes <n> --area cmdty=NATGAS/area=THE \
      --out rows-archive.ndjson [--reference-out reference.ndjson]
  # prueba pura del clasificador (sin pyarrow)
  python3 extract-trades-rows.py --classify-member <member.name> \
      --area cmdty=NATGAS/area=THE
"""

import argparse
import glob
import hashlib
import json
import os
import subprocess
import sys

LAKE_ROOT = os.environ.get("EEX_LAKE_ROOT", "/srv/hot-data/EEX")
TRADE_TABLE = "eex_derivative_trade"
REFERENCE_TABLE = "eex_derivative_reference"
PROVENANCE_COLUMNS = ("_pull_id", "_retrieved_at_utc", "_row_sha256", "_source")


def sha256_file(path):
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def parse_hive_keys(path):
    """Extrae las claves hive `clave=valor` de cualquier segmento de la ruta."""
    keys = {}
    for segment in str(path).split("/"):
        if "=" in segment:
            key, value = segment.split("=", 1)
            keys[key] = value
    return keys


def parse_area_argument(area_argument):
    """`cmdty=NATGAS/area=THE` -> ("NATGAS", "THE")."""
    keys = parse_hive_keys(area_argument)
    if "cmdty" not in keys or "area" not in keys:
        raise SystemExit(f"--area debe ser cmdty=<X>/area=<Y>; recibido: {area_argument!r}")
    return keys["cmdty"], keys["area"]


def classify_archive_member(name, wanted_cmdty, wanted_area):
    """Clasifica un miembro del tar por clave hive EXACTA.

    Devuelve `kind` = trade | reference | other_table | other_area | not_parquet.
    Nunca etiqueta como trade una tabla que no sea la de trades: el plan TR-01
    pide inventariar `eex_derivative_reference` aparte.
    """
    if not str(name).endswith(".parquet"):
        return {"kind": "not_parquet", "table": None, "cmdty": None, "area": None}
    keys = parse_hive_keys(name)
    table = keys.get("table")
    cmdty = keys.get("cmdty")
    area = keys.get("area")
    base = {"table": table, "cmdty": cmdty, "area": area, "trd_date": keys.get("trd_date")}
    if cmdty != wanted_cmdty or area != wanted_area:
        return {**base, "kind": "other_area"}
    if table == TRADE_TABLE:
        return {**base, "kind": "trade"}
    if table == REFERENCE_TABLE:
        return {**base, "kind": "reference"}
    return {**base, "kind": "other_table"}


def emit_row(row, source, out, reference=False):
    payload = {key: value for key, value in row.items()}
    payload["_source"] = source
    out.write(json.dumps(payload, ensure_ascii=False, separators=(",", ":")))
    out.write("\n")


def read_parquet_bytes(raw):
    """Lee un parquet ya cargado en memoria sin arrancar hilos nativos de Arrow.

    El destructor de los thread pools de Arrow (CPU e IO) aborta de forma
    intermitente en el shutdown del interprete ("terminate called without an
    active exception", SIGABRT) DESPUES de escribir la salida correcta, y rompe
    el contrato de exit 0 del job. `use_threads=False` solo evita el pool CPU:
    `pq.read_table` pasa por la API de Dataset y `ParquetFile(<ruta>)` abre el
    archivo por el filesystem de Arrow; ambos arrancan el pool IO igual.
    `ParquetFile(BufferReader(bytes)).read(use_threads=False)` no crea ningun
    hilo (medido con /proc/self/task, pyarrow 25.0.1, 2026-09-25). El aborto se
    reprodujo 1/35 corridas de la suite y 1/400 extracciones en paralelo con la
    version anterior (read_table + use_threads=False).
    """
    import pyarrow as pa
    import pyarrow.parquet as pq

    return pq.ParquetFile(pa.BufferReader(raw)).read(use_threads=False)


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
            with open(path, "rb") as handle:
                table = read_parquet_bytes(handle.read())
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
                yield member.name, tar.extractfile(member).read()
    finally:
        zstd.stdout.close()
        zstd.wait()


def extract_archive(archive_path, wanted_cmdty, wanted_area, out, expected_sha256, expected_bytes,
                    max_members, reference_out=None):
    verification = verify_archive(archive_path, expected_sha256, expected_bytes)

    if reference_out is not None:
        reference_out.write(json.dumps({
            "_meta": {
                "artifactKind": "TR-01_REFERENCE_ROWS",
                "source": "archive",
                "table": REFERENCE_TABLE,
                "requestedArea": {"cmdty": wanted_cmdty, "area": wanted_area},
            },
        }, separators=(",", ":"), ensure_ascii=False))
        reference_out.write("\n")

    table_inventory = {}
    rows_emitted = 0
    members_seen = 0
    skipped_other_area = 0
    trade_dates = []

    def bump(table, member_count=0, row_count=0):
        entry = table_inventory.setdefault(table, {"members": 0, "rows": 0})
        entry["members"] += member_count
        entry["rows"] += row_count

    for name, raw in iter_tar_members(archive_path):
        members_seen += 1
        classification = classify_archive_member(name, wanted_cmdty, wanted_area)
        kind = classification["kind"]
        table = classification["table"] or "unknown"
        if kind == "other_area":
            skipped_other_area += 1
            bump(table, member_count=1)
            continue
        if kind == "not_parquet":
            continue
        if kind == "trade":
            table = TRADE_TABLE
            table_data = read_parquet_bytes(raw)
            for row in table_data.to_pylist():
                emit_row(row, TRADE_TABLE, out)
                rows_emitted += 1
                trade_date = row.get("TrdDate")
                if trade_date:
                    trade_dates.append(str(trade_date))
            bump(table, member_count=1, row_count=len(table_data))
        elif kind == "reference":
            table = REFERENCE_TABLE
            reference_data = read_parquet_bytes(raw)
            reference_rows = reference_data.to_pylist()
            bump(table, member_count=1, row_count=len(reference_rows))
            if reference_out is not None:
                for row in reference_rows:
                    emit_row(row, REFERENCE_TABLE, reference_out, reference=True)
        else:  # other_table con area pedida: se inventaria pero NO se emite como trade
            table_data = read_parquet_bytes(raw)
            bump(table, member_count=1, row_count=len(table_data))
        if max_members is not None and members_seen >= max_members:
            break

    # El inventario por tabla recien se conoce al terminar el escaneo: el _meta
    # del archivo cierra el NDJSON (el agregador lo localiza en cualquier linea).
    # El rango de fechas sale de los trades emitidos: la comparacion de fuentes
    # (source-decision.mjs) trata un dateMax ausente como diferencia, asi que el
    # inventario debe declararlo cuando hay trades.
    out.write(json.dumps({
        "_meta": {
            "artifactKind": "TR-01_TRADES_ROWS",
            "source": "archive",
            "archive": archive_path,
            "archiveVerification": verification,
            "requestedArea": {"cmdty": wanted_cmdty, "area": wanted_area},
            "table": TRADE_TABLE,
            "tableInventory": table_inventory,
            "dateMin": min(trade_dates) if trade_dates else None,
            "dateMax": max(trade_dates) if trade_dates else None,
            "skippedOtherArea": skipped_other_area,
            "membersSeen": members_seen,
        },
    }, separators=(",", ":"), ensure_ascii=False))
    out.write("\n")
    return rows_emitted, table_inventory, skipped_other_area


def main():
    parser = argparse.ArgumentParser(description="TR-01: extraccion read-only de trades")
    parser.add_argument("--source", choices=["lake", "archive"])
    parser.add_argument("--area", required=True, help="cmdty=<X>/area=<Y>, p.ej. cmdty=NATGAS/area=THE")
    parser.add_argument("--start")
    parser.add_argument("--end")
    parser.add_argument("--archive")
    parser.add_argument("--expected-sha256")
    parser.add_argument("--expected-bytes", type=int)
    parser.add_argument("--max-days", type=int, help="limite acotado para pruebas/fixtures")
    parser.add_argument("--max-members", type=int)
    parser.add_argument("--out")
    parser.add_argument("--reference-out", help="NDJSON separado para eex_derivative_reference")
    parser.add_argument("--classify-member", help="prueba pura: clasifica un nombre de miembro y sale")
    arguments = parser.parse_args()

    wanted_cmdty, wanted_area = parse_area_argument(arguments.area)

    if arguments.classify_member:
        result = classify_archive_member(arguments.classify_member, wanted_cmdty, wanted_area)
        print(json.dumps(result, ensure_ascii=False))
        return 0

    if not arguments.source:
        raise SystemExit("--source es obligatorio (salvo con --classify-member)")
    if not arguments.out:
        raise SystemExit("--out es obligatorio")

    with open(arguments.out, "w", encoding="utf-8") as out:
        if arguments.source == "lake":
            rows = extract_lake(arguments.area, arguments.start, arguments.end, out, arguments.max_days)
        else:
            if not arguments.archive:
                raise SystemExit("--archive es obligatorio con --source archive")
            reference_out = open(arguments.reference_out, "w", encoding="utf-8") if arguments.reference_out else None
            try:
                rows, table_inventory, skipped = extract_archive(
                    arguments.archive, wanted_cmdty, wanted_area, out,
                    arguments.expected_sha256, arguments.expected_bytes,
                    arguments.max_members, reference_out,
                )
            finally:
                if reference_out is not None:
                    reference_out.close()
    print(f"escrito {arguments.out}: {rows} filas", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
