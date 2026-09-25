#!/usr/bin/env python3
"""BT-06: top-of-book EEX -> best ask por slot de 30 min (hora Berlin), parametrizado
por mercado/producto. Ruta versionada nueva (v3); el v2 queda intacto con el gas fijo.

Regla de slots (idéntica al release exploratorio v2
`operations/exploratory/v2/build_tob_slots.py`, owner patch
EM-SPEC-OWNER-PATCH-2026-09-24-02 §2-§4 y hallazgo BT04-H1-TOB-TIE):
  - sólo `InstrumentType == Simple Instrument` y la maturity exacta (fuera spreads);
  - ask > 0; si hay bid, bid < ask (libro no cruzado);
  - el valor de un slot es el último quote con Tm <= slot y Tm > slot - MAX_AGE;
  - si varias filas comparten ese último Tm, gana el menor ask; a igual ask, el
    menor AskSz conocido;
  - se guarda AskSz para poder limitar el fill a la profundidad visible.

Diferencia con v2 (BT-06, owner request 2026-09-26): el mercado, el área y los
productos llegan por CLI, y la lectura del lago es por lotes (`iter_batches`): el
proceso mantiene sólo el mejor candidato por (contrato, slot), nunca acumula las
filas en memoria. El top of book de Power pesa ~49 GB en el lago (gas ~7,1 GB), así
que este script corre como job con techo de RAM (lo lanza DATA-01), no desde la
Oficina.

Salida: JSON determinista con recuentos y `market`/`area`/`products`.

Uso:
  # job real (lago), fuente decidida por TR-01
  python3 build_tob_slots.py --source lake --market POWER_DE \
      --products DEBQ,DEBM --start 2025-08-12 --end 2026-07-28 \
      --source-decision operations/trades/TR-01/DATA_SOURCE_DECISION.json \
      --out operations/exploratory/v3/tob-slots-power.json
  # prueba pura con filas NDJSON (sin pyarrow), para fixtures chicos
  python3 build_tob_slots.py --from-rows rows.ndjson --market POWER_DE --products DEBQ,DEBM --out out.json
"""
import argparse
import glob
import hashlib
import json
import os
import sys
from collections import defaultdict
from datetime import date, datetime, time, timezone
from zoneinfo import ZoneInfo

DEFAULT_LAKE_ROOT = os.environ.get("EEX_LAKE_ROOT", "/srv/hot-data/EEX")
TOB_TABLE = "eex_derivative_top_of_book"
BERLIN = ZoneInfo("Europe/Berlin")
SLOTS = [time(h, m) for h in range(8, 18) for m in (0, 30)]
MAX_AGE_S = 15 * 60
TIE_RULE = "min ask among rows sharing the latest Tm; equal asks keep the smaller known AskSz"
COLS = ["ShortCode", "Maturity", "Tm", "AskPx", "AskSz", "BidPx", "InstrumentType"]

# Mercado -> partición del lago. El v2 tenía NATGAS/THE fijo (líneas 24-25); aquí
# se declara la tabla de mercados conocidos y se exige una coincidencia exacta.
MARKETS = {
    "GAS_THE": {"cmdty": "NATGAS", "area": "THE"},
    "POWER_DE": {"cmdty": "POWER", "area": "DE"},
}


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


def row_is_usable(row, products):
    if row.get("InstrumentType") != "Simple Instrument":
        return False
    short_code = str(row.get("ShortCode") or "")
    if len(short_code) < 4 or short_code[:4] not in products:
        return False
    if not row.get("Maturity"):
        return False
    ask = to_float(row.get("AskPx"))
    if ask is None or ask <= 0:
        return False
    bid = to_float(row.get("BidPx"))
    if bid is not None and bid >= ask:
        return False
    return parse_tm(row.get("Tm")) is not None


def slot_index_for(epochs, ts):
    """Índice del primer slot que este quote puede servir, o None.

    Un quote sirve al slot s si ts <= s y s - ts <= MAX_AGE. Como los slots
    distan 30 min y MAX_AGE es 15 min, cada quote sirve a lo sumo un slot.
    """
    for index, slot_epoch in enumerate(epochs):
        if slot_epoch < ts:
            continue
        return index if slot_epoch - ts <= MAX_AGE_S else None
    return None


def better(candidate, ask, ask_sz):
    """El candidato gana si es más nuevo; a igual Tm, el menor (ask, AskSz conocido)."""
    if candidate is None:
        return True
    cand_ask = candidate[1]
    cand_sz = candidate[2]
    if ask < cand_ask:
        return True
    if ask == cand_ask and (ask_sz if ask_sz is not None else 0.0) < (cand_sz if cand_sz is not None else 0.0):
        return True
    return False


def aggregate_day(rows, day, products, counts):
    """Estado por (contrato, slot) de UN día, alimentado fila a fila (streaming)."""
    epochs = slot_utc_epochs(day)
    candidates = {}  # (contract, slot_index) -> (ts, ask, askSz, bid, rawTm)
    contracts = set()
    for row in rows:
        if not row_is_usable(row, products):
            counts["rows_excluded"] += 1
            continue
        counts["rows_usable"] += 1
        short_code = str(row["ShortCode"])
        contract = f"{short_code[:4]}|{row['Maturity']}"
        contracts.add(contract)
        ts = parse_tm(row.get("Tm"))
        index = slot_index_for(epochs, ts)
        if index is None:
            counts["rows_out_of_slot"] += 1
            continue
        ask = to_float(row.get("AskPx"))
        ask_sz = to_float(row.get("AskSz"))
        bid = to_float(row.get("BidPx"))
        key = (contract, index)
        current = candidates.get(key)
        if current is None or ts > current[0] or (ts == current[0] and better(current, ask, ask_sz)):
            candidates[key] = (ts, ask, ask_sz, bid, row.get("Tm"))
    series = {}
    for contract in sorted(contracts):
        slots = []
        for index in range(len(SLOTS)):
            candidate = candidates.get((contract, index))
            if candidate is None:
                slots.append(None)
                counts["slots_empty"] += 1
            else:
                _, ask, ask_sz, bid, raw_tm = candidate
                slots.append({"ask": ask, "askSz": ask_sz, "bid": bid, "quoteTm": raw_tm})
                counts["slots_filled"] += 1
        series[contract] = slots
    return series


def build_document(series, *, source, market, area, products, counts, source_decision):
    return {
        "artifactKind": "EXPLORATORY_TOB_SLOTS",
        "schemaVersion": "3.0",
        "status": "EXPLORATORY",
        "ownerPatch": "EM-SPEC-OWNER-PATCH-2026-09-24-02",
        "market": market,
        "area": area,
        "products": sorted(products),
        "source": source,
        "sourceDecision": source_decision,
        "slotsBerlin": [s.strftime("%H:%M") for s in SLOTS],
        "maxQuoteAgeSeconds": MAX_AGE_S,
        "slotTieRule": TIE_RULE,
        "filters": ["InstrumentType == Simple Instrument", "exact Maturity", "ask > 0", "bid < ask when bid present"],
        "counts": dict(sorted(counts.items())),
        "series": {key: dict(sorted(days.items())) for key, days in sorted(series.items())},
    }


def write_document(document, out_path):
    body = json.dumps(document, sort_keys=True, separators=(",", ":")).encode()
    with open(out_path, "wb") as handle:
        handle.write(body)
    return body


def read_ndjson(path):
    with open(path, "r", encoding="utf-8") as handle:
        for line in handle:
            line = line.strip()
            if not line:
                continue
            parsed = json.loads(line)
            if "_meta" in parsed:
                continue
            yield parsed


def run_from_rows(path, products, market, out_path):
    counts = defaultdict(int)
    by_day = defaultdict(list)
    for row in read_ndjson(path):
        by_day[str(row.get("TrdDate") or "")].append(row)
    series = {}
    for day in sorted(by_day):
        day_series = aggregate_day(by_day[day], date.fromisoformat(day), products, counts)
        for contract, slots in day_series.items():
            series.setdefault(contract, {})[day] = slots
    counts["days"] += len(by_day)
    document = build_document(series, source="rows", market=market, area=None, products=products, counts=counts, source_decision=None)
    write_document(document, out_path)
    return document


def lake_partitions(lake_root, market, start, end):
    partition = MARKETS[market]
    base = os.path.join(lake_root, f"table={TOB_TABLE}", f"cmdty={partition['cmdty']}", f"area={partition['area']}")
    days = sorted(entry.split("=", 1)[1] for entry in os.listdir(base) if entry.startswith("trd_date="))
    return [day for day in days if (start is None or day >= start) and (end is None or day <= end)]


def iter_day_rows(lake_root, market, day, batch_size):
    import pyarrow.parquet as pq

    partition = MARKETS[market]
    pattern = os.path.join(lake_root, f"table={TOB_TABLE}", f"cmdty={partition['cmdty']}", f"area={partition['area']}", f"trd_date={day}", "*", "part.parquet")
    for path in sorted(glob.glob(pattern)):
        names = set(pq.read_schema(path).names)
        if not {"ShortCode", "Maturity", "Tm", "AskPx", "InstrumentType"} <= names:
            yield None, path
            continue
        columns = [name for name in COLS if name in names]
        for batch in pq.ParquetFile(path).iter_batches(batch_size=batch_size, columns=columns):
            for row in batch.to_pylist():
                yield row, path


def run_lake(lake_root, market, products, start, end, out_path, source_decision, batch_size):
    partitions = lake_partitions(lake_root, market, start, end)
    series = {}
    counts = defaultdict(int)
    for day in partitions:
        def day_rows(day=day):
            for row, path in iter_day_rows(lake_root, market, day, batch_size):
                if row is None:
                    counts["files_without_ask_columns"] += 1
                    continue
                counts["rows_read"] += 1
                yield row

        counts["days"] += 1
        day_series = aggregate_day(day_rows(), date.fromisoformat(day), products, counts)
        for contract, slots in day_series.items():
            series.setdefault(contract, {})[day] = slots
        if day.endswith("-01"):
            print(day, file=sys.stderr, flush=True)
    document = build_document(series, source=lake_root, market=market, area=MARKETS[market], products=products, counts=counts, source_decision=source_decision)
    write_document(document, out_path)
    return document


def read_source_decision(path):
    with open(path, "rb") as handle:
        body = handle.read()
    decision = json.loads(body)
    selected = decision.get("selectedSource")
    if selected != "EEX_LAKE":
        raise SystemExit(f"TR-01 no eligió EEX_LAKE (selectedSource={selected!r}); no se extrae de otra fuente")
    return {"path": path, "sha256": hashlib.sha256(body).hexdigest(), "status": decision.get("status"), "selectedSource": selected}


def main():
    parser = argparse.ArgumentParser(description="BT-06: best ask por slot, parametrizado por mercado/producto")
    parser.add_argument("--source", choices=["lake"])
    parser.add_argument("--market", required=True, choices=sorted(MARKETS))
    parser.add_argument("--products", required=True, help="códigos separados por coma, p.ej. DEBQ,DEBM")
    parser.add_argument("--start")
    parser.add_argument("--end")
    parser.add_argument("--lake-root", default=DEFAULT_LAKE_ROOT)
    parser.add_argument("--source-decision", help="artifact TR-01 de decisión de fuente; se liga por sha256")
    parser.add_argument("--batch-size", type=int, default=65536)
    parser.add_argument("--from-rows", help="prueba pura: filas NDJSON de TOB")
    parser.add_argument("--out", required=True)
    arguments = parser.parse_args()

    products = [code.strip() for code in arguments.products.split(",") if code.strip()]
    if not products:
        raise SystemExit("--products no puede estar vacío")

    if arguments.from_rows:
        document = run_from_rows(arguments.from_rows, products, arguments.market, arguments.out)
        print(json.dumps({"series": len(document["series"]), "counts": document["counts"]}))
        return 0

    if not arguments.source:
        raise SystemExit("--source es obligatorio salvo con --from-rows")
    # La fuente la decide TR-01 (PLAN_STATUS BT-06): el job del lago no arranca sin
    # atar el artifact de decisión, y falla cerrado si TR-01 no eligió EEX_LAKE.
    if not arguments.source_decision:
        raise SystemExit("--source-decision es obligatorio con --source lake: la fuente la decide TR-01")
    source_decision = read_source_decision(arguments.source_decision)
    document = run_lake(arguments.lake_root, arguments.market, products, arguments.start, arguments.end, arguments.out, source_decision, arguments.batch_size)
    print(json.dumps({"series": len(document["series"]), "counts": document["counts"]}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
