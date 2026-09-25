#!/usr/bin/env python3
"""Read-only EEX extraction for the existing G0BQ/G0BM exploratory maturities.

The campaign list comes from the committed exploratory results. Expected
trading dates come from the accepted IMP-09 calendar. Rows are restricted to
the exact ShortCode + Maturity and retain row and source-file hashes.
"""

import hashlib
import json
import os
from pathlib import Path
from zoneinfo import ZoneInfo

import pyarrow.compute as pc
import pyarrow.parquet as pq

ROOT = Path(__file__).resolve().parents[3]
LAKE = Path(os.environ.get("EEX_LAKE_ROOT", "/srv/hot-data/EEX"))
OUTPUT = ROOT / "operations/audit/BT-01/campaign-proxy-rows-BT-01.json"
RESULTS = ROOT / "operations/exploratory/backtest-results.json"
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
    campaigns_by_key = {campaign["campaignKey"]: campaign for campaign in campaigns}
    rows_by_campaign_date = {}
    counts_by_campaign_date = {}
    active_by_date = {}
    for campaign in campaigns:
        dates = [day for day in exchange_days if campaign["windowStart"] <= day < campaign["windowEnd"]]
        expected_by_campaign[campaign["campaignKey"]] = dates
        for day in dates:
            active_by_date.setdefault(day, []).append(campaign)

    tz = ZoneInfo("Europe/Berlin")
    for day, active_campaigns in sorted(active_by_date.items()):
        campaign_by_product_maturity = {(campaign["product"], campaign["maturity"]): campaign for campaign in active_campaigns}
        per_campaign_rows = {campaign["campaignKey"]: [] for campaign in active_campaigns}
        per_campaign_counts = {campaign["campaignKey"]: {table: {"filesAvailable": 0, "filesWithMaturityRows": 0} for table in TABLES} for campaign in active_campaigns}
        for table, (price_col, bid_col, ask_col) in TABLES.items():
            folder = LAKE / f"table={table}/cmdty=NATGAS/area=THE/trd_date={day}"
            files = sorted(folder.glob("*/part.parquet")) if folder.is_dir() else []
            products = sorted({campaign["product"] for campaign in active_campaigns})
            maturities = sorted({campaign["maturity"] for campaign in active_campaigns})
            for campaign in active_campaigns:
                per_campaign_counts[campaign["campaignKey"]][table]["filesAvailable"] = len(files)
            for path in files:
                parquet = pq.ParquetFile(path)
                names = set(parquet.schema.names)
                needed = {"ShortCode", "Maturity", "InstrumentISIN", "InstrumentType", "Currency", "UOM", "Tm", "TrdDate", "_row_sha256"}
                if price_col:
                    needed.add(price_col)
                if bid_col:
                    needed.update((bid_col, ask_col))
                if not needed.issubset(names):
                    continue
                data = pq.read_table(path, columns=sorted(needed))
                code_mask = pc.is_in(data["ShortCode"], value_set=__import__("pyarrow").array(products))
                maturity_mask = pc.is_in(data["Maturity"], value_set=__import__("pyarrow").array(maturities))
                selected = data.filter(pc.and_(code_mask, maturity_mask))
                if selected.num_rows == 0:
                    continue
                relative_path = path.relative_to(LAKE).as_posix()
                source_hashes[relative_path] = sha256_file(path)
                matched_pairs = set()
                for row in selected.to_pylist():
                    campaign = campaign_by_product_maturity.get((row.get("ShortCode"), row.get("Maturity")))
                    if campaign is None:
                        continue
                    if row.get("InstrumentType") not in ("Simple Instrument", ""):
                        continue
                    if not row.get("InstrumentISIN"):
                        continue
                    if row.get("Currency") != "EUR" or row.get("UOM") != "MWh":
                        continue
                    tm = row.get("Tm") or ""
                    try:
                        local = __import__("datetime").datetime.fromisoformat(tm.replace("Z", "+00:00")).astimezone(tz)
                    except ValueError:
                        continue
                    if local.date().isoformat() != day:
                        continue
                    seconds = local.hour * 3600 + local.minute * 60 + local.second
                    # Keep the strict window and permitted ±60 minute fallback;
                    # IMP-05 applies strict-versus-fallback precedence.
                    if not (16 * 3600 + 15 * 60 <= seconds <= 18 * 3600 + 15 * 60):
                        continue
                    per_campaign_rows[campaign["campaignKey"]].append({
                        "source": table,
                        "sourcePath": relative_path,
                        "instrument": row.get("InstrumentISIN") or None,
                        "tmUtc": tm,
                        "trdDate": row.get("TrdDate") or day,
                        "price": as_float(row.get(price_col)) if price_col else None,
                        "bid": as_float(row.get(bid_col)) if bid_col else None,
                        "ask": as_float(row.get(ask_col)) if ask_col else None,
                        "rowHash": row.get("_row_sha256"),
                    })
                    matched_pairs.add(campaign["campaignKey"])
                for campaign_key in matched_pairs:
                    per_campaign_counts[campaign_key][table]["filesWithMaturityRows"] += 1
        for campaign in active_campaigns:
            key = campaign["campaignKey"]
            per_campaign_rows[key].sort(key=lambda row: (row["tmUtc"], row["source"], row["rowHash"] or ""))
            rows_by_campaign_date[(key, day)] = per_campaign_rows[key]
            counts_by_campaign_date[(key, day)] = per_campaign_counts[key]

    per_campaign = []
    for campaign in campaigns:
        dates = expected_by_campaign[campaign["campaignKey"]]
        per_date = [{
            "trdDate": day,
            "rows": rows_by_campaign_date.get((campaign["campaignKey"], day), []),
            "sourceCounts": counts_by_campaign_date.get((campaign["campaignKey"], day), {table: {"filesAvailable": 0, "filesWithMaturityRows": 0} for table in TABLES}),
        } for day in dates]
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
        "sourceLakeRoot": str(LAKE),
        "sourceRule": "EEX gas trade and top-of-book; exact product + maturity; EUR/MWh Simple Instrument; strict and IMP-05 fallback windows only",
        "calendar": {"path": "operations/audit/IMP-09/eex-exchange-calendar.json", "sha256": sha256_bytes(calendar_bytes)},
        "campaignPopulation": {"path": "operations/exploratory/backtest-results.json", "sha256": sha256_bytes(results_bytes)},
        "sourceFileHashes": dict(sorted(source_hashes.items())),
        "campaigns": per_campaign,
    }
    serialized = json.dumps(artifact, indent=2, ensure_ascii=False) + "\n"
    OUTPUT.write_text(serialized, encoding="utf-8")
    print(f"artifact={OUTPUT}")
    print(f"campaigns={len(per_campaign)} sourceFiles={len(source_hashes)} sha256={sha256_bytes(serialized.encode())}")
    for campaign in per_campaign:
        rows = sum(len(date["rows"]) for date in campaign["perDate"])
        print(f"{campaign['campaignKey']} {campaign['windowStart']}..{campaign['windowEnd']} expected={len(campaign['expectedDates'])} rows={rows}")


if __name__ == "__main__":
    main()
