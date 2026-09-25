#!/usr/bin/env python3
"""Read-only EEX extraction for the existing G0BQ/G0BM exploratory maturities.

The campaign list comes from the committed exploratory results. Expected
trading dates come from the accepted IMP-09 calendar. Rows are restricted to
the exact ShortCode + Maturity and retain row and source-file hashes.

v2 (2026-09-25, BT04-C1-PROXY-WINDOW-DEDUP): each row carries `observationKey`,
a digest of every market column (all non-`_` columns), so only the same market
observation is deduplicated (SPEC §5.2 «filas deduplicadas»); `_row_sha256` is
not usable because a re-pull of the same observation gets a new hash. Window
prefilter keeps fractional seconds. v1 artifacts stay in operations/audit/BT-01/.
"""

import hashlib
import gc
import json
import os
import subprocess
from pathlib import Path
from zoneinfo import ZoneInfo

import pyarrow.compute as pc
import pyarrow as pa
import pyarrow.parquet as pq

ROOT = Path(__file__).resolve().parents[3]
LAKE = Path(os.environ.get("EEX_LAKE_ROOT", "/srv/hot-data/EEX"))
OUTPUT = ROOT / "operations/audit/BT-01/v2/campaign-proxy-rows-BT-01.json"
PROXY_WORKER = ROOT / "operations/audit/BT-01/calculate-campaign-daily-proxies.mjs"
RESULTS = ROOT / "operations/exploratory/v2/backtest-results.json"
CALENDAR = ROOT / "operations/audit/IMP-09/eex-exchange-calendar.json"
TABLES = {
    "eex_derivative_trade": ("Px", None, None),
    "eex_derivative_top_of_book": (None, "BidPx", "AskPx"),
}


def sha256_bytes(value):
    return hashlib.sha256(value).hexdigest()


def sha256_file(path):
    digest = hashlib.sha256()
    with open(path, "rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def as_float(value):
    try:
        return float(value) if value not in (None, "") else None
    except (TypeError, ValueError):
        return None


def observation_key(row):
    market = sorted((name, value) for name, value in row.items() if not name.startswith("_"))
    return sha256_bytes(json.dumps(market, default=str, ensure_ascii=False, separators=(",", ":")).encode())


def month_start(maturity):
    if len(maturity) != 6 or not maturity.isdigit():
        raise ValueError(f"Maturity inválida: {maturity!r}")
    return f"{maturity[:4]}-{maturity[4:]}-01"


def month_shift(ymd, months):
    year, month, _day = map(int, ymd.split("-"))
    index = year * 12 + month - 1 + months
    return f"{index // 12:04d}-{index % 12 + 1:02d}-01"


def campaigns_from_results(results):
    campaigns = []
    for product, section in sorted(results["comparison"].items()):
        mission = "quarterly" if product == "G0BQ" else "monthly" if product == "G0BM" else None
        if mission is None:
            continue
        for episode in sorted(section["perEpisode"], key=lambda row: row["maturity"]):
            maturity = episode["maturity"]
            start = month_start(maturity)
            window_start = month_shift(start, -4 if mission == "quarterly" else -1)
            window_end = month_shift(start, -1) if mission == "quarterly" else start
            campaigns.append({
                "campaignKey": f"{product}-{maturity}",
                "product": product,
                "maturity": maturity,
                "mission": mission,
                "windowRule": "3-1-3" if mission == "quarterly" else "1-0-1",
                "windowStart": window_start,
                "windowEnd": window_end,
            })
    return campaigns


def extract(campaigns, exchange_days):
    source_hashes = {}
    expected_by_campaign = {}
    proxies_by_campaign_date = {}
    active_by_date = {}
    for campaign in campaigns:
        dates = [day for day in exchange_days if campaign["windowStart"] <= day < campaign["windowEnd"]]
        expected_by_campaign[campaign["campaignKey"]] = dates
        for day in dates:
            active_by_date.setdefault(day, []).append(campaign)

    tz = ZoneInfo("Europe/Berlin")
    worker = subprocess.Popen(
        ["node", str(PROXY_WORKER)], stdin=subprocess.PIPE, stdout=subprocess.PIPE,
        text=True, encoding="utf-8", bufsize=1,
    )
    try:
      for day, active_campaigns in sorted(active_by_date.items()):
        # Read each partition once per date. Raw observations are sent in small
        # chunks per exact product/maturity; the previous version retained all
        # campaign rows for a whole date and could exhaust BruNode RAM.
        campaign_by_product_maturity = {(item["product"], item["maturity"]): item for item in active_campaigns}
        state = {}
        for campaign in active_campaigns:
            key = campaign["campaignKey"]
            state[key] = {
                "rows": [],
                "sourceFiles": [],
                "exclusions": {"unsupportedInstrument": 0, "withoutInstrument": 0, "invalidMarketMetadata": 0, "invalidTimestamp": 0, "outsideLocalDate": 0, "outsideWindow": 0},
                "sourceCounts": {table: {"filesAvailable": 0, "filesWithMaturityRows": 0} for table in TABLES},
            }
            worker.stdin.write(json.dumps({"type": "begin", "campaignKey": key, "trdDate": day}) + "\n")
        worker.stdin.flush()
        for table, (price_col, bid_col, ask_col) in TABLES.items():
            folder = LAKE / f"table={table}/cmdty=NATGAS/area=THE/trd_date={day}"
            files = sorted(folder.glob("*/part.parquet")) if folder.is_dir() else []
            for campaign_state in state.values():
                campaign_state["sourceCounts"][table]["filesAvailable"] = len(files)
            for path in files:
                needed = {"ShortCode", "Maturity", "InstrumentISIN", "InstrumentType", "Currency", "UOM", "Tm", "TrdDate", "_row_sha256"}
                if price_col:
                    needed.add(price_col)
                if bid_col:
                    needed.update((bid_col, ask_col))
                parquet = pq.ParquetFile(path)
                schema_names = set(parquet.schema_arrow.names)
                if not needed.issubset(schema_names):
                    continue
                read_columns = sorted(name for name in schema_names if not name.startswith("_")) + ["_row_sha256"]
                relative_path = path.relative_to(LAKE).as_posix()
                matched_campaigns = set()
                for batch in parquet.iter_batches(batch_size=4096, columns=read_columns, use_threads=False):
                    code_index = batch.schema.get_field_index("ShortCode")
                    maturity_index = batch.schema.get_field_index("Maturity")
                    products = sorted({campaign["product"] for campaign in active_campaigns})
                    maturities = sorted({campaign["maturity"] for campaign in active_campaigns})
                    selected = batch.filter(pc.and_(
                        pc.is_in(batch.column(code_index), value_set=pa.array(products)),
                        pc.is_in(batch.column(maturity_index), value_set=pa.array(maturities)),
                    ))
                    if selected.num_rows == 0:
                        del selected, batch
                        continue
                    for row in selected.to_pylist():
                        campaign = campaign_by_product_maturity.get((row.get("ShortCode"), row.get("Maturity")))
                        if campaign is None:
                            continue
                        key = campaign["campaignKey"]
                        target = state[key]
                        matched_campaigns.add(key)
                        if row.get("InstrumentType") != "Simple Instrument":
                            target["exclusions"]["unsupportedInstrument"] += 1
                            continue
                        if not row.get("InstrumentISIN"):
                            target["exclusions"]["withoutInstrument"] += 1
                            continue
                        if row.get("Currency") != "EUR" or row.get("UOM") != "MWh":
                            target["exclusions"]["invalidMarketMetadata"] += 1
                            continue
                        tm = row.get("Tm") or ""
                        try:
                            local = __import__("datetime").datetime.fromisoformat(tm.replace("Z", "+00:00")).astimezone(tz)
                        except ValueError:
                            target["exclusions"]["invalidTimestamp"] += 1
                            continue
                        if local.date().isoformat() != day:
                            target["exclusions"]["outsideLocalDate"] += 1
                            continue
                        seconds = local.hour * 3600 + local.minute * 60 + local.second + local.microsecond / 1e6
                        if not (16 * 3600 + 15 * 60 <= seconds <= 18 * 3600 + 15 * 60):
                            target["exclusions"]["outsideWindow"] += 1
                            continue
                        target["rows"].append({
                            "source": table, "sourcePath": relative_path,
                            "instrument": row.get("InstrumentISIN"), "instrumentType": row.get("InstrumentType"),
                            "tmUtc": tm, "trdDate": row.get("TrdDate") or day,
                            "price": as_float(row.get(price_col)) if price_col else None,
                            "bid": as_float(row.get(bid_col)) if bid_col else None,
                            "ask": as_float(row.get(ask_col)) if ask_col else None,
                            "rowHash": row.get("_row_sha256"),
                            "observationKey": observation_key(row),
                        })
                        if len(target["rows"]) == 512:
                            worker.stdin.write(json.dumps({"type": "rows", "campaignKey": key, "rows": target["rows"]}, ensure_ascii=False) + "\n")
                            target["rows"] = []
                    del selected, batch
                    gc.collect()
                    pa.default_memory_pool().release_unused()
                if matched_campaigns:
                    source_hashes[relative_path] = sha256_file(path)
                    for key in matched_campaigns:
                        target = state[key]
                        target["sourceCounts"][table]["filesWithMaturityRows"] += 1
                        target["sourceFiles"].append({"path": relative_path, "sha256": source_hashes[relative_path]})
        for campaign in active_campaigns:
            key = campaign["campaignKey"]
            target = state[key]
            if target["rows"]:
                worker.stdin.write(json.dumps({"type": "rows", "campaignKey": key, "rows": target["rows"]}, ensure_ascii=False) + "\n")
            worker.stdin.write(json.dumps({
                "type": "end", "campaignKey": key, "sourceCounts": target["sourceCounts"],
                "sourceFiles": sorted(target["sourceFiles"], key=lambda source: source["path"]),
                "exclusions": target["exclusions"],
            }, ensure_ascii=False) + "\n")
            del target["rows"]
        worker.stdin.flush()
        for campaign in active_campaigns:
            key = campaign["campaignKey"]
            result = worker.stdout.readline()
            if not result:
                raise RuntimeError(f"El cálculo proxy terminó sin respuesta para {key} {day}.")
            proxies_by_campaign_date[(key, day)] = json.loads(result)
        del state
        gc.collect()
    finally:
        worker.stdin.close()
        return_code = worker.wait()
        if return_code != 0:
            raise RuntimeError(f"El cálculo proxy terminó con código {return_code}.")

    per_campaign = []
    for campaign in campaigns:
        dates = expected_by_campaign[campaign["campaignKey"]]
        per_date = [proxies_by_campaign_date.get((campaign["campaignKey"], day), {
            "trdDate": day,
            "exclusions": {"unsupportedInstrument": 0, "withoutInstrument": 0, "invalidMarketMetadata": 0, "invalidTimestamp": 0, "outsideLocalDate": 0, "outsideWindow": 0},
            "instrumentIdentities": [],
            "sourceRows": 0,
            "sourceRowHashCount": 0,
            "sourceRowHashesDigest": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
            "sourceFiles": [],
            "sourceCounts": {table: {"filesAvailable": 0, "filesWithMaturityRows": 0} for table in TABLES},
            "strictCounts": {"trades": 0, "midpoints": 0},
            "fallbackCounts": {"trades": 0, "midpoints": 0},
            "windowUsed": "none",
            "fallbackUsed": False,
            "sourceLabel": "missing",
            "dailyReference": None,
            "defined": False,
            "reason": "No hay filas elegibles en las fuentes EEX para esta fecha.",
        }) for day in dates]
        per_campaign.append({**campaign, "expectedDates": dates, "perDate": per_date})
    return per_campaign, source_hashes


def main():
    results_bytes = RESULTS.read_bytes()
    calendar_bytes = CALENDAR.read_bytes()
    results = json.loads(results_bytes)
    calendar = json.loads(calendar_bytes)
    campaigns = campaigns_from_results(results)
    per_campaign, source_hashes = extract(campaigns, calendar["exchangeDays"])
    artifact = {
        "artifactKind": "BT-01_CAMPAIGN_PROXY_ROWS",
        "schemaVersion": "1.0",
        "status": "BENCHMARK_PROVISIONAL",
        "methodologyVersion": 2,
        "dedupRule": "observationKey = sha256 of every non-underscore market column",
        "windowTimeResolution": "fractional seconds from Tm",
        "sourceLakeRoot": str(LAKE),
        "sourceRule": "EEX gas trade and top-of-book; exact product + maturity; EUR/MWh Simple Instrument; strict and IMP-05 fallback windows only",
        "calendar": {"path": "operations/audit/IMP-09/eex-exchange-calendar.json", "sha256": sha256_bytes(calendar_bytes)},
        "campaignPopulation": {"path": RESULTS.relative_to(ROOT).as_posix(), "sha256": sha256_bytes(results_bytes)},
        "sourceFileHashes": dict(sorted(source_hashes.items())),
        "campaigns": per_campaign,
    }
    serialized = json.dumps(artifact, indent=2, ensure_ascii=False) + "\n"
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(serialized, encoding="utf-8")
    print(f"artifact={OUTPUT}")
    print(f"campaigns={len(per_campaign)} sourceFiles={len(source_hashes)} sha256={sha256_bytes(serialized.encode())}")
    for campaign in per_campaign:
        rows = sum(date["sourceRows"] for date in campaign["perDate"])
        print(f"{campaign['campaignKey']} {campaign['windowStart']}..{campaign['windowEnd']} expected={len(campaign['expectedDates'])} rows={rows}")


if __name__ == "__main__":
    main()
