#!/usr/bin/env python3
"""TR-03: extraccion read-only de top-of-book (best ask por slot) del lago EEX.

Job de escaneo que LANZA BRU (TRADES_MODE_PLAN.md: "Los agentes de la Oficina NO
corren escaneos completos del lago... Los escaneos (TR-01, TR-03)... se lanzan
como jobs por la ruta de BT-05"). Este script no se corre completo desde la
Oficina.

La regla de slots es la del release exploratorio v2
(`operations/exploratory/v2/build_tob_slots.py`), transcrita aqui para poder
procesar los dos mercados (gas THE y power DE) y verificar la misma regla en JS
(`src/trades-bridge/tob-slots.mjs`) sobre fixtures:
  - solo `InstrumentType == Simple Instrument` y la maturity exacta;
  - ask > 0; si hay bid, bid < ask;
  - el valor de un slot es el ultimo quote con Tm <= slot y Tm > slot - MAX_AGE;
  - a igual Tm gana el menor ask; a igual ask el menor AskSz conocido;
  - se guarda AskSz para poder limitar el fill a la profundidad visible.

Salida: JSON determinista contrato -> dia -> 20 slots (o null), con recuentos.

Uso:
  # job real (lago)
  python3 extract-tob-rows.py --source lake \
      --area cmdty=NATGAS/area=THE --products G0BQ,G0BM \
      --start 2025-08-12 --end 2026-07-28 --out tob-gas.json
  # prueba pura con filas NDJSON (sin pyarrow)
  python3 extract-tob-rows.py --from-rows rows.ndjson --products G0BQ,G0BM --out tob.json
"""

import argparse
import glob
import json
import os
import sys
from bisect import bisect_right
from collections import defaultdict
from datetime import date, datetime, time, timezone
from zoneinfo import ZoneInfo

LAKE_ROOT = os.environ.get("EEX_LAKE_ROOT", "/srv/hot-data/EEX")
TOB_TABLE = "eex_derivative_top_of_book"
BERLIN = ZoneInfo("Europe/Berlin")
SLOTS = [time(h, m) for h in range(8, 18) for m in (0, 30)]
MAX_AGE_S = 15 * 60
TIE_RULE = "min ask among rows sharing the latest Tm; equal asks keep the smaller known AskSz"
COLS = ["Cmdty", "Area", "ShortCode", "Maturity", "TrdDate", "Tm", "AskPx", "AskSz", "BidPx", "InstrumentType"]


def to_float(value):
    if value is None or value == "":
        return None
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return None
    if parsed != parsed:  # NaN
        return None
    return parsed


def parse_tm(value):
    if not value:
        return None
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00")).timestamp()
    except ValueError:
        return None


def slot_utc_epochs(day):
    return [datetime.combine(day, s, BERLIN).astimezone(timezone.utc).timestamp() for s in SLOTS]


def slots_for_rows(rows, day, products):
    """Regla de slots para UN dia. Devuelve dict contrato -> lista de 20 slots."""
    epochs = slot_utc_epochs(day)
    groups = defaultdict(list)
    for row in rows:
        if row.get("InstrumentType") != "Simple Instrument":
            continue
        short_code = str(row.get("ShortCode") or "")
        if len(short_code) < 4 or short_code[:4] not in products:
            continue
        maturity = row.get("Maturity")
        if not maturity:
            continue
        ask = to_float(row.get("AskPx"))
        if ask is None or ask <= 0:
            continue
        bid = to_float(row.get("BidPx"))
        if bid is not None and bid >= ask:
            continue
        ts = parse_tm(row.get("Tm"))
        if ts is None:
            continue
        groups[f"{short_code[:4]}|{maturity}"].append((ts, ask, to_float(row.get("AskSz")), bid, row.get("Tm")))
    result = {}
    for key, entries in groups.items():
        entries.sort(key=lambda entry: entry[0])
        times = [entry[0] for entry in entries]
        slots = []
        for slot_epoch in epochs:
            index = bisect_right(times, slot_epoch) - 1
            if index < 0 or slot_epoch - times[index] > MAX_AGE_S:
                slots.append(None)
                continue
            first = index
            while first > 0 and times[first - 1] == times[index]:
                first -= 1
            _, ask, ask_sz, bid, raw_tm = min(
                entries[first:index + 1],
                key=lambda entry: (entry[1], entry[2] if entry[2] is not None else 0.0),
            )
            slots.append({"ask": ask, "askSz": ask_sz, "bid": bid, "quoteTm": raw_tm})
        result[key] = slots
    return result


def read_ndjson(path):
    rows = []
    with open(path, "r", encoding="utf-8") as handle:
        for line in handle:
            line = line.strip()
            if not line:
                continue
            parsed = json.loads(line)
            if "_meta" in parsed:
                continue
            rows.append(parsed)
    return rows


def build_document(series, *, source, area, products, counts):
    return {
        "artifactKind": "TR-03_TOB_SLOTS",
        "schemaVersion": "1.0",
        "source": source,
        "area": area,
        "products": sorted(products),
        "slotsBerlin": [s.strftime("%H:%M") for s in SLOTS],
        "maxQuoteAgeSeconds": MAX_AGE_S,
        "slotTieRule": TIE_RULE,
        "filters": ["InstrumentType == Simple Instrument", "exact Maturity", "ask > 0", "bid < ask when bid present"],
        "counts": dict(sorted(counts.items())),
        "series": {key: dict(sorted(days.items())) for key, days in sorted(series.items())},
    }


def run_from_rows(path, products, out_path):
    rows = read_ndjson(path)
    by_day = defaultdict(list)
    for row in rows:
        by_day[str(row.get("TrdDate") or "")].append(row)
    series = {}
    for day in sorted(by_day):
        day_slots = slots_for_rows(by_day[day], date.fromisoformat(day), products)
        for contract, slots in day_slots.items():
            series.setdefault(contract, {})[day] = slots
    document = build_document(series, source="rows", area=None, products=products, counts={"days": len(by_day), "rows": len(rows)})
    write_document(document, out_path)
    return document


def lake_partitions(area, start, end):
    base = os.path.join(LAKE_ROOT, f"table={TOB_TABLE}", area)
    days = sorted(entry.split("=", 1)[1] for entry in os.listdir(base) if entry.startswith("trd_date="))
    return [day for day in days if (start is None or day >= start) and (end is None or day <= end)]


def product_mask(table, products):
    """Filas Simple Instrument de los productos pedidos (4 primeros caracteres del ShortCode)."""
    import pyarrow as pa
    import pyarrow.compute as pc

    simple = pc.equal(table["InstrumentType"], "Simple Instrument")
    prefix = pc.utf8_slice_codeunits(pc.cast(table["ShortCode"], pa.string()), 0, 4)
    wanted = pc.is_in(prefix, value_set=pa.array(sorted(products), type=pa.string()))
    return pc.fill_null(pc.and_(simple, wanted), False)


def run_lake(area, products, start, end, out_path, max_days):
    import pyarrow.parquet as pq

    days = lake_partitions(area, start, end)
    if max_days is not None:
        days = days[:max_days]
    series = {}
    counts = defaultdict(int)
    for day in days:
        pattern = os.path.join(LAKE_ROOT, f"table={TOB_TABLE}", area, f"trd_date={day}", "*", "part.parquet")
        rows = []
        day_rows_read = 0
        for path in sorted(glob.glob(pattern)):
            names = set(pq.read_schema(path).names)
            if not {"ShortCode", "Maturity", "Tm", "AskPx", "InstrumentType"} <= names:
                counts["files_without_ask_columns"] += 1
                continue
            table = pq.read_table(path, columns=[name for name in COLS if name in names], use_threads=False)
            day_rows_read += table.num_rows
            # Mismo filtro de producto e instrumento que slots_for_rows, aplicado en
            # Arrow antes de crear filas de Python: un dia de top of book de power DE
            # pesa ~371 MB de parquet (2026-03-10) y como lista de dicts superaba el
            # techo de 2 GiB del job (DATA-01, 2026-09-26).
            table = table.filter(product_mask(table, products))
            for row in table.to_pylist():
                row["TrdDate"] = day
                rows.append(row)
        counts["days"] += 1
        counts["rows"] += day_rows_read
        for contract, slots in slots_for_rows(rows, date.fromisoformat(day), products).items():
            series.setdefault(contract, {})[day] = slots
        print(day, file=sys.stderr, flush=True) if day.endswith("-01") else None
    document = build_document(series, source=LAKE_ROOT, area=area, products=products, counts=counts)
    write_document(document, out_path)
    return document


def write_document(document, out_path):
    body = json.dumps(document, sort_keys=True, separators=(",", ":")).encode()
    with open(out_path, "wb") as handle:
        handle.write(body)


def main():
    parser = argparse.ArgumentParser(description="TR-03: best ask por slot del puente")
    parser.add_argument("--source", choices=["lake"])
    parser.add_argument("--area", help="cmdty=<X>/area=<Y>")
    parser.add_argument("--products", required=True, help="codigos separados por coma, p.ej. G0BQ,G0BM")
    parser.add_argument("--start")
    parser.add_argument("--end")
    parser.add_argument("--lake-root")
    parser.add_argument("--max-days", type=int)
    parser.add_argument("--from-rows", help="prueba pura: filas NDJSON de TOB")
    parser.add_argument("--out", required=True)
    arguments = parser.parse_args()

    global LAKE_ROOT
    if arguments.lake_root:
        LAKE_ROOT = arguments.lake_root
    products = [code.strip() for code in arguments.products.split(",") if code.strip()]

    if arguments.from_rows:
        document = run_from_rows(arguments.from_rows, products, arguments.out)
        print(json.dumps({"series": len(document["series"]), "counts": document["counts"]}))
        return 0

    if not arguments.source:
        raise SystemExit("--source es obligatorio salvo con --from-rows")
    if not arguments.area:
        raise SystemExit("--area es obligatorio con --source lake")
    keys = dict(segment.split("=", 1) for segment in arguments.area.split("/") if "=" in segment)
    if "cmdty" not in keys or "area" not in keys:
        raise SystemExit("--area debe ser cmdty=<X>/area=<Y>")
    document = run_lake(arguments.area, products, arguments.start, arguments.end, arguments.out, arguments.max_days)
    print(json.dumps({"series": len(document["series"]), "counts": document["counts"]}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
