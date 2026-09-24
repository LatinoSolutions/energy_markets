"""Top-of-book EEX THE gas -> best ask por slot de 30 min (hora Berlin), fase exploratoria.

Fuente de la regla: owner patch EM-SPEC-OWNER-PATCH-2026-09-24-02 §2-§4 (hora data-driven, fills
conservadores). Criterios anti-ilusión (docs/product/UI-04_DATA_REQUIREMENTS_AND_TODO.md §3):
  - solo `InstrumentType == Simple Instrument` y la maturity exacta (fuera spreads);
  - ask > 0; si hay bid, bid < ask (libro no cruzado);
  - el valor de un slot es el último quote con Tm <= slot y Tm > slot - MAX_AGE (nada viejo, nada de otro día);
  - se guarda AskSz para poder limitar el fill a la profundidad visible.
Salida: JSON determinista con recuentos de excluidos.
"""
import glob, hashlib, json, sys
from collections import defaultdict
from datetime import date, datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo

import numpy as np
import pyarrow as pa
import pyarrow.compute as pc
import pyarrow.parquet as pq

LAKE = "/srv/hot-data/EEX/table=eex_derivative_top_of_book/cmdty=NATGAS/area=THE"
PRODUCTS = ("G0BM", "G0BQ")
BERLIN = ZoneInfo("Europe/Berlin")
SLOTS = [time(h, m) for h in range(8, 18) for m in (0, 30)]
MAX_AGE_S = 15 * 60
COLS = ["ShortCode", "Maturity", "Tm", "AskPx", "AskSz", "BidPx", "InstrumentType"]


def slot_utc_epochs(day):
    return [datetime.combine(day, s, BERLIN).astimezone(timezone.utc).timestamp() for s in SLOTS]


def load_day(files, counts):
    tables = []
    for f in files:
        names = set(pq.read_schema(f).names)
        if not {"ShortCode", "Maturity", "Tm", "AskPx", "InstrumentType"} <= names:
            counts["files_without_ask_columns"] += 1
            continue
        t = pq.read_table(f, columns=[c for c in COLS if c in names])
        for c in COLS:
            if c not in t.column_names:
                t = t.append_column(c, pa.nulls(t.num_rows, pa.string()))
        tables.append(t.select(COLS))
    if not tables:
        return None
    t = pa.concat_tables(tables)
    counts["rows_read"] += t.num_rows
    prod = pc.utf8_slice_codeunits(t["ShortCode"], 0, 4)
    keep = pc.and_(pc.is_in(prod, value_set=pa.array(list(PRODUCTS))), pc.equal(t["InstrumentType"], "Simple Instrument"))
    t = t.filter(pc.fill_null(keep, False))
    counts["rows_outright_target_products"] += t.num_rows
    return t


def main(out_path):
    counts = defaultdict(int)
    series = defaultdict(dict)  # "G0BQ|202601" -> {date: [slot entries]}
    day_dirs = sorted(glob.glob(f"{LAKE}/trd_date=*"))
    for d in day_dirs:
        day = date.fromisoformat(d.split("=")[-1])
        # Orden fijo de archivos: con Tm empatados, el quote elegido no depende del orden de glob.
        t = load_day(sorted(glob.glob(f"{d}/**/*.parquet", recursive=True)), counts)
        if t is None or t.num_rows == 0:
            continue
        sc = pc.utf8_slice_codeunits(t["ShortCode"], 0, 4).to_pylist()
        mat = t["Maturity"].to_pylist()
        tm = t["Tm"].to_pylist()
        ask = t["AskPx"].to_pylist()
        asz = t["AskSz"].to_pylist()
        bid = t["BidPx"].to_pylist()
        groups = defaultdict(list)
        for i in range(len(tm)):
            if not ask[i] or not mat[i]:
                counts["rows_no_ask_or_maturity"] += 1
                continue
            a = float(ask[i])
            b = float(bid[i]) if bid[i] else None
            if a <= 0:
                counts["rows_ask_not_positive"] += 1
                continue
            if b is not None and b >= a:
                counts["rows_crossed_book"] += 1
                continue
            # Tm trae microsegundos y sufijo Z (UTC).
            ts = datetime.fromisoformat(tm[i].replace("Z", "+00:00")).timestamp()
            groups[(sc[i], mat[i])].append((ts, a, float(asz[i]) if asz[i] else None, b, tm[i]))
        epochs = slot_utc_epochs(day)
        for (p, m), rows in groups.items():
            rows.sort(key=lambda r: r[0])
            ts_arr = np.array([r[0] for r in rows])
            slots = []
            for s_label, s_ep in zip(SLOTS, epochs):
                idx = int(np.searchsorted(ts_arr, s_ep, side="right")) - 1
                if idx < 0 or s_ep - ts_arr[idx] > MAX_AGE_S:
                    slots.append(None)
                    counts["slots_stale_or_empty"] += 1
                    continue
                _, a, az, b, raw_tm = rows[idx]
                slots.append({"ask": a, "askSz": az, "bid": b, "quoteTm": raw_tm})
                counts["slots_filled"] += 1
            series[f"{p}|{m}"][day.isoformat()] = slots
        print(day, file=sys.stderr, flush=True) if day.day == 1 else None
    doc = {
        "artifactKind": "EXPLORATORY_TOB_SLOTS_THE_GAS",
        "ownerPatch": "EM-SPEC-OWNER-PATCH-2026-09-24-02",
        "status": "EXPLORATORY",
        "source": LAKE,
        "slotsBerlin": [s.strftime("%H:%M") for s in SLOTS],
        "maxQuoteAgeSeconds": MAX_AGE_S,
        "filters": ["InstrumentType == Simple Instrument", "exact Maturity", "ask > 0", "bid < ask when bid present"],
        "counts": dict(sorted(counts.items())),
        "series": {k: dict(sorted(v.items())) for k, v in sorted(series.items())},
    }
    body = json.dumps(doc, sort_keys=True, separators=(",", ":")).encode()
    with open(out_path, "wb") as fh:
        fh.write(body)
    print(json.dumps({"sha256": hashlib.sha256(body).hexdigest(), "bytes": len(body), "counts": doc["counts"], "keys": len(doc["series"])}, indent=1))


if __name__ == "__main__":
    main(sys.argv[1])
