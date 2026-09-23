#!/usr/bin/env python3
"""IMP-05 / SCOPE-01: extraccion read-only de filas G0BQ del lago EEX auditado.

Fuente factual: /srv/hot-data/EEX (lago auditado por IMP-03 ST-03.2:
operations/audit/IMP-03/EEX-THE-20260921/ST-03.2/audit-report.md — esquema por
archivo/proyeccion, cobertura no certificada, sin proyeccion del rango 2020-2026).

Reglas de seleccion declaradas (no inventadas; declaradas como provisionales):
- Fechas: las 5 fechas mas recientes presentes en AMBAS tablas
  eex_derivative_trade y eex_derivative_top_of_book (cmdty=NATGAS/area=THE).
- Contrato por fecha: instrumento G0BQ (Gas Quarterly, contenido del lago)
  Simple Instrument con ExpiryDate futura mas temprana; desempate
  InstrumentISIN. Regla provisional de reproduccion proxy-side; NO es el
  contrato de campana (DEP-01 es DOCUMENTED_ABSENCE: no hay mandato real).
- Ventana intradia declarada: hora local Europe/Berlin en [15:45, 18:45] del
  propio trdDate (cubre la ventana estricta 17:00/17:05-17:15 y el fallback
  17:15 +/- 60 min de SPEC v1.1.1 SS5.2/SS6 con margen de conversion UTC/DST).

Solo lectura del lago. El unico archivo escrito es el artefacto JSON del
workspace. Cada fila conserva fuente (tabla), tmUtc, precio/bid/ask y
_row_sha256; el dedup es exacto y determinista (orden de lectura fijo).

Uso:  python3 extract-lake-proxy-rows.py [--check]
"""

import argparse
import datetime as dt
import glob
import json
import os
from zoneinfo import ZoneInfo

import pyarrow.compute as pc
import pyarrow.parquet as pq

LAKE = os.environ.get("EEX_LAKE_ROOT", "/srv/hot-data/EEX")
AREA_DIR = "cmdty=NATGAS/area=THE"
TOB_TABLE = "eex_derivative_top_of_book"
TRADE_TABLE = "eex_derivative_trade"
TABLES = [TOB_TABLE, TRADE_TABLE]
AUDITED_DATES_COUNT = 5
LOCAL_START_SECONDS = 15 * 3600 + 45 * 60
LOCAL_END_SECONDS = 18 * 3600 + 45 * 60
HERE = os.path.dirname(os.path.abspath(__file__))
OUTPUT_PATH = os.path.join(HERE, "lake-proxy-rows-IMP-05.json")


def available_dates(table):
    base = os.path.join(LAKE, f"table={table}", AREA_DIR)
    return set(
        entry.split("=", 1)[1]
        for entry in os.listdir(base)
        if entry.startswith("trd_date=")
    )


def select_dates():
    common = available_dates(TOB_TABLE) & available_dates(TRADE_TABLE)
    return sorted(common, reverse=True)[:AUDITED_DATES_COUNT]


def parse_iso(value):
    return dt.datetime.fromisoformat(value.replace("Z", "+00:00"))


def berlin_local_seconds(trd_date, tm_utc):
    try:
        instant = parse_iso(tm_utc)
        trade_day = dt.date.fromisoformat(trd_date)
        local = instant.astimezone(ZoneInfo("Europe/Berlin"))
    except (ValueError, TypeError):
        return None
    if local.date() != trade_day:
        return None
    return local.hour * 3600 + local.minute * 60 + local.second


def float_or_none(value):
    if value is None or (isinstance(value, str) and value.strip() == ""):
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def list_files(table, trd_date):
    pattern = os.path.join(LAKE, f"table={table}", AREA_DIR, f"trd_date={trd_date}", "*", "part.parquet")
    return sorted(glob.glob(pattern))


def choose_contract(trd_date, files_by_table):
    """G0BQ Simple Instrument con ExpiryDate futura mas temprana; desempate ISIN."""
    candidates = {}
    identity_columns_complete = True
    for table in TABLES:
        identity_missing_in_table = True
        for path in files_by_table[table]:
            data = pq.read_table(path)
            if "ShortCode" not in data.column_names or "InstrumentType" not in data.column_names:
                continue
            quarterly = data.filter(pc.equal(data["ShortCode"], "G0BQ"))
            quarterly = quarterly.filter(pc.equal(quarterly["InstrumentType"], "Simple Instrument"))
            if "InstrumentISIN" not in quarterly.column_names or "ExpiryDate" not in quarterly.column_names:
                continue
            identity_missing_in_table = False
            for row in quarterly.to_pylist():
                isin = row.get("InstrumentISIN") or ""
                expiry = row.get("ExpiryDate") or ""
                if not isin or len(expiry) < 10:
                    continue
                try:
                    expiry_date = dt.date.fromisoformat(expiry[:10])
                    trade_day = dt.date.fromisoformat(trd_date)
                except ValueError:
                    continue
                if expiry_date <= trade_day:
                    continue
                candidate = candidates.get(isin)
                if candidate is None or expiry < candidate["expiry"]:
                    candidates[isin] = {
                        "expiry": expiry,
                        "displayName": row.get("DisplayName") or "",
                    }
        if identity_missing_in_table:
            identity_columns_complete = False
    if not candidates:
        return None, identity_columns_complete
    ranked = sorted(candidates.items(), key=lambda item: (item[1]["expiry"], item[0]))
    isin, chosen = ranked[0]
    contract = {
        "instrument": isin,
        "expiryDate": chosen["expiry"],
        "displayName": chosen["displayName"],
    }
    return contract, identity_columns_complete


def lake_row(table, row):
    if table == TOB_TABLE:
        return {
            "source": TOB_TABLE,
            "tmUtc": row.get("Tm"),
            "price": None,
            "bid": float_or_none(row.get("BidPx")),
            "ask": float_or_none(row.get("AskPx")),
            "rowHash": row.get("_row_sha256"),
        }
    return {
        "source": TRADE_TABLE,
        "tmUtc": row.get("Tm"),
        "price": float_or_none(row.get("Px")),
        "bid": None,
        "ask": None,
        "rowHash": row.get("_row_sha256"),
    }


def extract_date(trd_date):
    files_by_table = {table: list_files(table, trd_date) for table in TABLES}
    contract, identity_complete = choose_contract(trd_date, files_by_table)
    record = {
        "trdDate": trd_date,
        "contract": contract,
        "contractSelectionComplete": identity_complete,
        "sourceCounts": {},
        "rows": [],
    }
    if contract is None:
        record["reason"] = "Sin instrumento G0BQ con ExpiryDate futura en las tablas de la fecha auditada."
        return record

    malformed_unit_rows = 0
    outside_window_rows = 0
    candidates = []
    for table in TABLES:
        extracted = 0
        for path in files_by_table[table]:
            data = pq.read_table(path)
            if "ShortCode" not in data.column_names or "InstrumentISIN" not in data.column_names:
                continue
            mine = data.filter(pc.equal(data["ShortCode"], "G0BQ"))
            mine = mine.filter(pc.equal(mine["InstrumentISIN"], contract["instrument"]))
            mine = mine.filter(pc.equal(mine["InstrumentType"], "Simple Instrument"))
            for row in mine.to_pylist():
                currency = row.get("Currency")
                uom = row.get("UOM")
                if currency != "EUR" or uom != "MWh":
                    malformed_unit_rows += 1
                    continue
                trd = row.get("TrdDate") or trd_date
                seconds = berlin_local_seconds(trd, row.get("Tm") or "")
                if seconds is None or seconds < LOCAL_START_SECONDS or seconds > LOCAL_END_SECONDS:
                    outside_window_rows += 1
                    continue
                candidates.append(lake_row(table, row))
                extracted += 1
        record["sourceCounts"][table] = {
            "files": len(files_by_table[table]),
            "rowsInWindow": extracted,
        }

    candidates.sort(key=lambda entry: (
        entry["tmUtc"] or "",
        entry["source"],
        str(entry["price"]),
        str(entry["bid"]),
        str(entry["ask"]),
        str(entry["rowHash"]),
    ))
    deduplicated = []
    seen = set()
    for entry in candidates:
        key = (entry["tmUtc"], entry["source"], entry["price"], entry["bid"], entry["ask"])
        if key in seen:
            continue
        seen.add(key)
        deduplicated.append(entry)
    record["sourceCounts"][TOB_TABLE]["rowsInWindow"] = sum(1 for entry in deduplicated if entry["source"] == TOB_TABLE)
    record["sourceCounts"][TRADE_TABLE]["rowsInWindow"] = sum(1 for entry in deduplicated if entry["source"] == TRADE_TABLE)
    record["malformedUnitRows"] = malformed_unit_rows
    record["outsideWindowRows"] = outside_window_rows
    record["rows"] = deduplicated
    return record


def lake_state():
    state = {}
    for table in TABLES:
        dates = sorted(available_dates(table))
        state[table] = {"dateMin": dates[0], "dateMax": dates[-1], "partitions": len(dates)}
    return state


def build_artifact():
    audited_dates = select_dates()
    per_date = [extract_date(date) for date in audited_dates]
    return {
        "artifactKind": "IMP-05_LAKE_PROXY_ROWS",
        "schemaVersion": "1.0",
        "generatedAtUtc": dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "lakeRoot": LAKE,
        "declaration": {
            "auditedDatesCount": AUDITED_DATES_COUNT,
            "dateRule": "las 5 fechas más recientes presentes en eex_derivative_trade y eex_derivative_top_of_book (cmdty=NATGAS/area=THE); cobertura del lago no certificada (ST-03.2)",
            "contractRule": "G0BQ (Gas Quarterly) Simple Instrument con ExpiryDate futura más temprana; desempate InstrumentISIN; regla provisional, no es el contrato de campaña (DEP-01 DOCUMENTED_ABSENCE)",
            "intradayRule": "hora local Europe/Berlin en [15:45, 18:45] del propio trdDate (ventana estricta y fallback ±60 min de SPEC v1.1.1 §5.2, con margen UTC/DST)",
            "accessible": "cada fila del artefacto no declara accesible; el build node marca accessible:true con base en la decisión P-005 aceptada (OWNER-DECISION-P-005-EEX-RIGHTS.md)",
        },
        "lakeState": lake_state(),
        "perDate": per_date,
    }


def serialize(artifact):
    return json.dumps(artifact, indent=2, ensure_ascii=False) + "\n"


def load_existing():
    if not os.path.exists(OUTPUT_PATH):
        return None
    with open(OUTPUT_PATH, encoding="utf-8") as handle:
        return json.load(handle)


def main():
    parser = argparse.ArgumentParser(description="Extraccion read-only G0BQ para IMP-05")
    parser.add_argument("--check", action="store_true", help="regenera y compara con el artefacto existente, sin escribir")
    arguments = parser.parse_args()

    artifact = build_artifact()
    # El timestamp de extraccion es del momento de la corrida: para --check se
    # excluye; el contenido factual se compara completo.
    if arguments.check:
        existing = load_existing()
        if existing is None:
            print(f"--check: no existe artefacto en {OUTPUT_PATH}")
            return 1
        comparison_now = dict(artifact)
        stored = dict(existing)
        comparison_now.pop("generatedAtUtc", None)
        stored.pop("generatedAtUtc", None)
        if comparison_now != stored:
            print("--check: el lago ya no reproduce el artefacto guardado (estado o reglas cambiaron)")
            return 1
        print("--check: el artefacto guardado reproduce el estado actual del lago")
        return 0

    with open(OUTPUT_PATH, "w", encoding="utf-8") as handle:
        handle.write(serialize(artifact))
    rows_total = sum(len(record["rows"]) for record in artifact["perDate"] if record.get("contract"))
    print(f"Artefacto escrito: {OUTPUT_PATH} (fechas={len(artifact['perDate'])}, filas={rows_total})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
