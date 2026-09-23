#!/usr/bin/env python3
"""Audit de evidencia EEX para IMP-09 (prescripción audit IMP-09, paso 1).

Solo lectura. Recorre el lago local /srv/hot-data/EEX (NATGAS/THE) y produce
operations/audit/IMP-09/eex-quarterly-episode-evidence.json + SHA256SUMS.

Por cada maturity trimestral (ShortCode G0BQ, Simple Instrument):
  InstrumentISIN, ExpiryDate, primer y último trade observado, y por cada día de
  su ventana fiscal 3-1-3: presencia de trade y presencia de TOB <= 11:00
  Europe/Berlin (conversión DST con zoneinfo, documentada en el output).

Registra SOLO presencias y conteos; NUNCA precios, bid/ask ni volúmenes.
Procedencia de los parquet citados: se registran los _response_sha256 del
propio lake (hash de la respuesta de cada pull, trazable por _pull_id) más el
SHA-256 de los archivos de identidad de la foto (extract.complete). Re-leer los
93 GB para recomputar SHA-256 por archivo queda fuera del alcance del script
(limitación marcada; la receta _row_sha256 del lake no es pública).

Los tests de la suite NO leen el lago: este script es un artefacto de audit que
se ejecuta a mano (venv pyarrow: /home/op/apps/power-markets-explorer/.venv-data).
"""

import glob
import hashlib
import json
import os
import re
from datetime import date
from datetime import datetime
from zoneinfo import ZoneInfo

import pyarrow.parquet as pq

LAKE_ROOT = "/srv/hot-data/EEX"
TRADES_ROOT = os.path.join(LAKE_ROOT, "table=eex_derivative_trade", "cmdty=NATGAS", "area=THE")
TOB_ROOT = os.path.join(LAKE_ROOT, "table=eex_derivative_top_of_book", "cmdty=NATGAS", "area=THE")
CONTRACT_MARKER = os.path.join(LAKE_ROOT, "_logs", "extract.complete")
SIMPLE_INSTRUMENT = "Simple Instrument"
QUARTERLY_SETUP = "G0BQ"
BERLIN = ZoneInfo("Europe/Berlin")
REPORT_DIR = os.path.dirname(os.path.abspath(__file__))
REPORT_PATH = os.path.join(REPORT_DIR, "eex-quarterly-episode-evidence.json")
SUMS_PATH = os.path.join(REPORT_DIR, "SHA256SUMS")

MONTHS_BY_QUARTER = {1: 1, 2: 4, 3: 7, 4: 10}
MONTH_TO_QUARTER = {1: 1, 4: 2, 7: 3, 10: 4}


def add_months(year, month, delta):
    total = year * 12 + (month - 1) + delta
    return total // 12, total % 12 + 1


def last_day_of_month(year, month):
    year_next, month_next = add_months(year, month, 1)
    first_next = date(year_next, month_next, 1).toordinal()
    return date.fromordinal(first_next - 1).day


def fiscal_window(year, quarter):
    delivery_month = MONTHS_BY_QUARTER[quarter]
    start_year, start_month = add_months(year, delivery_month, -4)
    end_year, end_month = add_months(year, delivery_month, -2)
    return f"{start_year:04d}-{start_month:02d}-01", f"{end_year:04d}-{end_month:02d}-{last_day_of_month(end_year, end_month):02d}"


def days_of_window(start_iso, end_iso):
    start = date.fromisoformat(start_iso)
    end = date.fromisoformat(end_iso)
    return [(start.toordinal() + index) for index in range((end - start).days + 1)]


def partition_dates(root):
    result = []
    for entry in os.listdir(root):
        match = re.match(r"trd_date=(\d{4}-\d{2}-\d{2})$", entry)
        if match:
            result.append(match.group(1))
    return sorted(result)


def sha256_file(path):
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def maturity_to_quarter(maturity):
    match = re.match(r"(\d{4})(\d{2})$", maturity or "")
    if not match:
        return None
    quarter = MONTH_TO_QUARTER.get(int(match.group(2)))
    if quarter is None:
        return None
    return f"{match.group(1)}Q{quarter}"


def new_episode(maturity):
    return {
        "maturity": maturity,
        "instrumentISIN": None,
        "expiryDateObserved": None,
        "firstTradedDate": None,
        "lastTradedDate": None,
        "tradeCount": 0,
        "tradeDays": [],
        "tobBefore11BerlinDays": [],
        "window": list(fiscal_window(int(maturity[:4]), int(maturity[5]))),
    }


def read_table_with_columns(path):
    """Lee el parquet con las columnas disponibles; el campo ausente vale ''.
    El lake tiene drift de schema (particiones del TOB sin Maturity/ISIN)."""
    schema_names = set(pq.ParquetFile(path).schema_arrow.names)
    columns = [name for name in ["ShortCode", "InstrumentType", "Maturity", "InstrumentISIN", "ExpiryDate", "TrdDate", "Tm", "_response_sha256"] if name in schema_names]
    table = pq.read_table(path, columns=columns)
    rows = table.to_pylist()
    for row in rows:
        for field in ("ShortCode", "InstrumentType", "Maturity", "InstrumentISIN", "ExpiryDate", "TrdDate", "Tm"):
            row.setdefault(field, "")
    return rows


def scan_trades(episodes, pull_hashes):
    for day in partition_dates(TRADES_ROOT):
        for path in sorted(glob.glob(os.path.join(TRADES_ROOT, f"trd_date={day}", "*", "*.parquet"))):
            rows = read_table_with_columns(path)
            pull_hashes.add(next(row["_response_sha256"] for row in rows if row.get("_response_sha256")))
            for row in rows:
                short_code, instrument_type = row["ShortCode"], row["InstrumentType"]
                maturity, isin, expiry, trade_date = row["Maturity"], row["InstrumentISIN"], row["ExpiryDate"], row["TrdDate"]
                if short_code != QUARTERLY_SETUP or instrument_type != SIMPLE_INSTRUMENT:
                    continue
                quarter_key = maturity_to_quarter(maturity)
                if quarter_key is None:
                    continue
                episode = episodes.setdefault(quarter_key, new_episode(quarter_key))
                if isin and episode["instrumentISIN"] is None:
                    episode["instrumentISIN"] = isin
                if expiry and (episode["expiryDateObserved"] is None or expiry < episode["expiryDateObserved"]):
                    episode["expiryDateObserved"] = expiry
                if trade_date:
                    episode["tradeCount"] += 1
                    if episode["firstTradedDate"] is None or trade_date < episode["firstTradedDate"]:
                        episode["firstTradedDate"] = trade_date
                    if episode["lastTradedDate"] is None or trade_date > episode["lastTradedDate"]:
                        episode["lastTradedDate"] = trade_date
                    if trade_date not in episode["tradeDays"]:
                        episode["tradeDays"].append(trade_date)


def scan_tob(episodes, pull_hashes):
    for day in partition_dates(TOB_ROOT):
        for path in sorted(glob.glob(os.path.join(TOB_ROOT, f"trd_date={day}", "*", "*.parquet"))):
            rows = read_table_with_columns(path)
            pull_hashes.add(next(row["_response_sha256"] for row in rows if row.get("_response_sha256")))
            for row in rows:
                if row["ShortCode"] != QUARTERLY_SETUP or row["InstrumentType"] != SIMPLE_INSTRUMENT:
                    continue
                quarter_key = maturity_to_quarter(row["Maturity"])
                if quarter_key is None:
                    continue
                stamp = row["Tm"]
                if not stamp:
                    continue
                berlin = datetime.fromisoformat(stamp.replace("Z", "+00:00")).astimezone(BERLIN)
                if berlin.hour > 11 or (berlin.hour == 11 and berlin.minute > 0):
                    continue
                episode = episodes.setdefault(quarter_key, new_episode(quarter_key))
                if day not in episode["tobBefore11BerlinDays"]:
                    episode["tobBefore11BerlinDays"].append(day)


def main():
    episodes = {}
    pull_hashes = set()

    scan_trades(episodes, pull_hashes)
    scan_tob(episodes, pull_hashes)

    snapshot_last_day = "2026-07-28"
    for episode in episodes.values():
        window_start, window_end_raw = episode["window"]
        window_end = min(window_end_raw, snapshot_last_day)
        window_days = [str(date.fromordinal(day)) for day in days_of_window(window_start, window_end)]
        episode["windowComplete"] = window_end_raw == window_end
        episode["windowDayCount"] = len(window_days)
        episode["windowTradedDays"] = [day for day in window_days if day in set(episode["tradeDays"])]
        episode["windowTobBefore11BerlinDays"] = [day for day in window_days if day in set(episode["tobBefore11BerlinDays"])]
        episode["windowDaysMissingTob"] = [day for day in window_days if day not in set(episode["tobBefore11BerlinDays"])]
        episode["windowTradedDayCount"] = len(episode["windowTradedDays"])
        del episode["tradeDays"]

    trade_days_all = partition_dates(TRADES_ROOT)
    tob_days_all = partition_dates(TOB_ROOT)
    identity = {
        "lakeRoot": LAKE_ROOT,
        "snapshotMarker": {"path": "_logs/extract.complete", "sha256": sha256_file(CONTRACT_MARKER)},
        "exchangeYear": "tar 2026-07-28 (foto del lake)",
        "tradePartitions": {"first": trade_days_all[0], "last": trade_days_all[-1], "count": len(trade_days_all)},
        "tobPartitions": {"first": tob_days_all[0], "last": tob_days_all[-1], "count": len(tob_days_all)},
        "marketPlaceMapping": "G0BQ/NATGAS/THE (mapeo G0BM/G0BQ del explorador; identificador técnico, no prueba del mandato del cliente)",
        "timezone": "Tm UTC -> Europe/Berlin via zoneinfo (DST en conversion); TOB cuenta si timestamp <= 11:00 Berlin",
        "pullResponseSha256Count": len(pull_hashes),
        "provenanceLimitation": "El SHA-256 por parquet citado se registra via _response_sha256 del propio lake (trazable por _pull_id); no se re-leen los 93 GB. La receta _row_sha256 del lake no es pública.",
        "neverRecorded": ["precios", "bid/ask", "volúmenes", "outcomes económicos"],
    }

    report = {
        "artifactKind": "IMP-09_EEX_QUARTERLY_EPISODE_EVIDENCE",
        "method": "Presencias y conteos por episodio; ninguna cantidad de precio. Solo lectura del lake.",
        "expectedConsumer": "src/oos-reservation/register-builder.mjs (buildEligibilityRegister)",
        "identity": identity,
        "episodes": {key: value for key, value in sorted(episodes.items())},
    }
    with open(REPORT_PATH, "w", encoding="utf-8") as handle:
        json.dump(report, handle, indent=2, sort_keys=True, ensure_ascii=False)
        handle.write("\n")

    with open(SUMS_PATH, "w") as handle:
        handle.write(f"{sha256_file(REPORT_PATH)}  eex-quarterly-episode-evidence.json\n")
        handle.write(f"{sha256_file(CONTRACT_MARKER)}  <lake>/_logs/extract.complete\n")


if __name__ == "__main__":
    main()
