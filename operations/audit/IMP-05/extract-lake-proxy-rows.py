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

Releases (BT04-C1-IMP05-DEDUP-NOT-APPLIED, 2026-09-25):
- v1 -> lake-proxy-rows-IMP-05.json: dedup por tupla (tmUtc, source, price,
  bid, ask); funde trades distintos con igual Tm y precio. Se conserva y sigue
  regenerable con --release v1.
- v2 -> lake-proxy-rows-IMP-05-v2.json: mismas fechas auditadas que v1 (la
  muestra no se mueve con el lago); cada fila lleva `observationKey` = sha256 de
  todas las columnas de mercado (no `_`), la misma regla que BT-01 v2
  (operations/audit/BT-01/extract-campaign-proxy-rows.py), y el dedup es por
  (source, observationKey): SPEC v1.1.1 §5.2 «filas deduplicadas» = misma
  observacion, no misma tupla. `_row_sha256` no sirve: la misma observacion en
  otro pull trae otro hash.

Uso:  python3 extract-lake-proxy-rows.py [--release v1|v2] [--check]
"""

import argparse
import datetime as dt
import glob
import hashlib
import json
import os
import sys
from pathlib import Path
from zoneinfo import ZoneInfo

import pyarrow.compute as pc
import pyarrow.parquet as pq

LAKE = os.environ.get("EEX_LAKE_ROOT", "/srv/hot-data/EEX")
ARCHIVE = os.environ.get("EEX_ARCHIVE_EXTRACTED_ROOT", "/srv/data/eex-client-archive/extraido")
ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "operations/trades/DATA-02"))
from sealed_archive_files import verified_gas_file_index
COVERAGE = ROOT / "operations/trades/DATA-02/SOURCE_PERIOD_COVERAGE.json"
COVERAGE_MANIFEST = ROOT / "operations/trades/DATA-02/SOURCE_PERIOD_COVERAGE.MANIFEST.json"
AREA_DIR = "cmdty=NATGAS/area=THE"
TOB_TABLE = "eex_derivative_top_of_book"
TRADE_TABLE = "eex_derivative_trade"
TABLES = [TOB_TABLE, TRADE_TABLE]
AUDITED_DATES_COUNT = 5
LOCAL_START_SECONDS = 15 * 3600 + 45 * 60
LOCAL_END_SECONDS = 18 * 3600 + 45 * 60
HERE = os.path.dirname(os.path.abspath(__file__))
RELEASES = {
    "v1": {"output": os.path.join(HERE, "lake-proxy-rows-IMP-05.json"), "dedupRule": "content-tuple"},
    "v2": {"output": os.path.join(HERE, "lake-proxy-rows-IMP-05-v2.json"), "dedupRule": "observation-key"},
    "v3": {"output": os.path.join(HERE, "source-proxy-rows-IMP-05-v3.json"), "dedupRule": "observation-key"},
}
V1_ROWS_PATH = RELEASES["v1"]["output"]


def available_dates(table):
    base = os.path.join(LAKE, f"table={table}", AREA_DIR)
    return set(
        entry.split("=", 1)[1]
        for entry in os.listdir(base)
        if entry.startswith("trd_date=")
    )


def pinned_v1_dates():
    with open(V1_ROWS_PATH, encoding="utf-8") as handle:
        return [record["trdDate"] for record in json.load(handle)["perDate"]]


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


def list_files(table, trd_date, selected_source=None):
    root = os.path.join(ARCHIVE, "data/lake/v1") if selected_source == "CLIENT_SEALED_ARCHIVE" else LAKE
    pattern = os.path.join(root, f"table={table}", AREA_DIR, f"trd_date={trd_date}", "*", "part.parquet")
    return sorted(glob.glob(pattern))


def verified_source_days(dates):
    coverage_bytes = COVERAGE.read_bytes()
    manifest_bytes = COVERAGE_MANIFEST.read_bytes()
    manifest = json.loads(manifest_bytes)
    digest = hashlib.sha256(coverage_bytes).hexdigest()
    if manifest.get("artifact", {}).get("path") != COVERAGE.relative_to(ROOT).as_posix() or manifest["artifact"].get("sha256") != digest:
        raise ValueError("DATA-02 coverage manifest hash mismatch")
    decision_path = ROOT / "operations/trades/TR-01/DATA_SOURCE_DECISION.json"
    if manifest.get("inputs", {}).get("tr01Decision", {}).get("sha256") != hashlib.sha256(decision_path.read_bytes()).hexdigest():
        raise ValueError("DATA-02 coverage is not bound to TR-01 decision")
    coverage = json.loads(coverage_bytes)
    if coverage.get("ownerDecision", {}).get("verificationStatus") != "RULE_APPLIED":
        raise ValueError("DATA-02 lake measurement is pending; cannot publish IMP-05 v3")
    selection = {}
    for day in dates:
        matches = [item for item in coverage.get("campaigns", []) if item.get("market") == "GAS_THE"
                   and item.get("shortCode") == "G0BQ" and item.get("windowStart", "") <= day <= item.get("windowEnd", "")]
        if len(matches) != 1:
            raise ValueError(f"Missing or ambiguous DATA-02 Gas Quarterly window for {day}")
        day_rows = [item for item in matches[0].get("patch", {}).get("days", []) if item.get("day") == day]
        if len(day_rows) != 1 or day_rows[0].get("source") not in ("CLIENT_SEALED_ARCHIVE", "EEX_LAKE_PATCH", "DATA_INCOMPLETE"):
            raise ValueError(f"Missing verified DATA-02 source for {day}")
        selection[day] = day_rows[0]["source"]
    partitions_path = ROOT / "operations/trades/DATA-02/source-partitions.json"
    partitions_bytes = partitions_path.read_bytes()
    archive_files = verified_gas_file_index(json.loads(partitions_bytes), hashlib.sha256(partitions_bytes).hexdigest(), manifest, ARCHIVE)
    return selection, {"path": COVERAGE.relative_to(ROOT).as_posix(), "sha256": digest,
                       "manifestSha256": hashlib.sha256(manifest_bytes).hexdigest()}, archive_files


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


def observation_key(row):
    market = sorted((name, value) for name, value in row.items() if not name.startswith("_"))
    return hashlib.sha256(json.dumps(market, default=str, ensure_ascii=False, separators=(",", ":")).encode()).hexdigest()


def lake_row(table, row, release):
    entry = lake_row_v1(table, row)
    if release in ("v2", "v3"):
        entry["observationKey"] = observation_key(row)
    return entry


def lake_row_v1(table, row):
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


def dedup_key(entry, release):
    if release in ("v2", "v3"):
        return (entry["source"], entry["observationKey"])
    return (entry["tmUtc"], entry["source"], entry["price"], entry["bid"], entry["ask"])


def extract_date(trd_date, release, selected_source=None, archive_files=None):
    files_by_table = {table: ([] if selected_source == "DATA_INCOMPLETE" else list_files(table, trd_date, selected_source)) for table in TABLES}
    excluded_counts = {table: 0 for table in TABLES}
    if selected_source == "CLIENT_SEALED_ARCHIVE":
        included, excluded = archive_files
        for table in TABLES:
            relative = {path: os.path.relpath(path, ARCHIVE) for path in files_by_table[table]}
            if any(item not in included and item not in excluded for item in relative.values()):
                raise ValueError(f"Unlisted archive parquet for {table} {trd_date}")
            prefix = f"data/lake/v1/table={table}/cmdty=NATGAS/area=THE/trd_date={trd_date}/"
            if any(item not in relative.values() for item in included if item.startswith(prefix)):
                raise ValueError(f"Listed sealed archive parquet missing for {table} {trd_date}")
            excluded_counts[table] = sum(item in excluded for item in relative.values())
            if table == TRADE_TABLE and excluded_counts[table]:
                raise ValueError(f"DATA-02 selected archive trade day with excluded pulls: {trd_date}")
            files_by_table[table] = [] if table == TOB_TABLE and excluded_counts[table] else [path for path in files_by_table[table] if relative[path] in included]
    if release == "v3" and selected_source != "DATA_INCOMPLETE" and not files_by_table[TRADE_TABLE]:
        raise ValueError(f"Selected DATA-02 trade partition missing: {selected_source} {trd_date}")
    contract, identity_complete = choose_contract(trd_date, files_by_table)
    record = {
        "trdDate": trd_date,
        "contract": contract,
        "contractSelectionComplete": identity_complete,
        "sourceCounts": {},
        "rows": [],
    }
    if release == "v3":
        record["selectedSource"] = selected_source
        record["sourceFiles"] = [{"path": f"{selected_source}/{os.path.relpath(path, ARCHIVE if selected_source == 'CLIENT_SEALED_ARCHIVE' else LAKE)}",
                                  "sha256": hashlib.sha256(Path(path).read_bytes()).hexdigest()}
                                 for table in TABLES for path in files_by_table[table]]
        record["excludedByClient"] = excluded_counts
        if selected_source == "DATA_INCOMPLETE":
            record["reason"] = "DATA-02 did not verify a complete source for this date."
            return record
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
                candidates.append(lake_row(table, row, release))
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
        entry.get("observationKey", ""),
    ))
    deduplicated = []
    seen = set()
    for entry in candidates:
        key = dedup_key(entry, release)
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


def build_artifact(release):
    audited_dates = select_dates() if release == "v1" else pinned_v1_dates()
    source_days, source_coverage, archive_files = verified_source_days(audited_dates) if release == "v3" else (None, None, None)
    per_date = [extract_date(date, release, source_days[date] if source_days else None, archive_files) for date in audited_dates]
    artifact = {
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
    if release == "v2":
        artifact["methodologyVersion"] = 2
        artifact["dedupRule"] = RELEASES["v2"]["dedupRule"]
        artifact["declaration"]["dateRule"] = "las mismas fechas auditadas que lake-proxy-rows-IMP-05.json (v1); la muestra no se mueve con el lago"
        artifact["declaration"]["dedupRule"] = "(source, observationKey); observationKey = sha256 de todas las columnas de mercado (no `_`), misma regla que BT-01 v2 (SPEC v1.1.1 §5.2 «filas deduplicadas»)"
    if release == "v3":
        artifact["artifactKind"] = "IMP-05_SOURCE_PROXY_ROWS"
        artifact.pop("lakeRoot")
        artifact.pop("lakeState")
        artifact["sourceRoots"] = {"CLIENT_SEALED_ARCHIVE": ARCHIVE, "EEX_LAKE_PATCH": LAKE}
        artifact["methodologyVersion"] = 3
        artifact["dedupRule"] = RELEASES["v3"]["dedupRule"]
        artifact["sourceCoverage"] = source_coverage
        artifact["sourceSelection"] = "DATA-02 complete-day patch.days; DATA_INCOMPLETE has no rows"
        artifact["declaration"]["dateRule"] = "same pinned dates as v1/v2; one complete DATA-02 source per day"
        artifact["declaration"]["dedupRule"] = "(source, observationKey); same market observation is deduplicated"
    return artifact


def serialize(artifact):
    return json.dumps(artifact, indent=2, ensure_ascii=False) + "\n"


def load_existing(output_path):
    if not os.path.exists(output_path):
        return None
    with open(output_path, encoding="utf-8") as handle:
        return json.load(handle)


def main():
    parser = argparse.ArgumentParser(description="Extraccion read-only G0BQ para IMP-05")
    parser.add_argument("--release", choices=sorted(RELEASES), default="v2")
    parser.add_argument("--check", action="store_true", help="regenera y compara con el artefacto existente, sin escribir")
    arguments = parser.parse_args()

    output_path = RELEASES[arguments.release]["output"]
    artifact = build_artifact(arguments.release)
    # El timestamp de extraccion es del momento de la corrida: para --check se
    # excluye; el contenido factual se compara completo.
    if arguments.check:
        existing = load_existing(output_path)
        if existing is None:
            print(f"--check: no existe artefacto en {output_path}")
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

    with open(output_path, "w", encoding="utf-8") as handle:
        handle.write(serialize(artifact))
    rows_total = sum(len(record["rows"]) for record in artifact["perDate"] if record.get("contract"))
    print(f"Artefacto escrito: {output_path} (fechas={len(artifact['perDate'])}, filas={rows_total})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
