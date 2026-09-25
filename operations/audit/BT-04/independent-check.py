#!/usr/bin/env python3
"""BT-04: independent recomputation of B / H / V / DeltaV for one G0BQ and one
G0BM campaign, straight from the raw EEX lake.

Written from SPEC v1.1.1 §5.2, §5.3 and §5.5 and the execution rule of
client input 02_execution_costs/execution_and_costs.md §1 (2026-09-23): latest
TOB observation at or before 11:00, its best ask + 0.15 EUR/MWh, full fill. It deliberately imports nothing from
src/, operations/audit/BT-01 or operations/exploratory code, so an error in
those producers cannot hide itself here.

Choices that differ on purpose from BT-01, so the check is not a copy:
- Dedup key is every market column of the row (all columns except the `_*`
  provenance columns). `_row_sha256` is NOT usable: the same observation
  re-pulled on another date gets a different hash (seen 2025-09-09 G0BQ-202601).
  BT-01 uses a narrower (Tm, price, bid, ask) key.
- Filters are pushed into pyarrow per file; nothing larger than one file's
  matching rows is ever held in memory.

Scope limit (not hidden): which days each arm buys is taken from the stored
decision ledger. Re-deciding would be a strategy rerun, excluded by BT-02.
"""

import hashlib
import json
import sys
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

import pyarrow.parquet as pq

ROOT = Path(__file__).resolve().parents[3]
LAKE = Path("/srv/hot-data/EEX")
CALENDAR = ROOT / "operations/audit/IMP-09/eex-exchange-calendar.json"
# Only the stored decision ledger (which days, how many MW) differs per release;
# prices, B and H are always recomputed from the lake here.
RELEASES = {
    "v1": {"results": "operations/exploratory/backtest-results.json", "output": "operations/audit/BT-04/independent-check-BT-04.json"},
    "v2": {"results": "operations/exploratory/v2/backtest-results.json", "output": "operations/audit/BT-04/independent-check-BT-04-v2.json"},
}
BERLIN = ZoneInfo("Europe/Berlin")

# Chosen by BT-04: the first G0BQ and first G0BM maturity that BT-02 marks PROVISIONAL.
CAMPAIGNS = [
    {"campaignKey": "G0BQ-202601", "product": "G0BQ", "maturity": "202601", "windowStart": "2025-09-01", "windowEnd": "2025-12-01"},
    {"campaignKey": "G0BM-202510", "product": "G0BM", "maturity": "202510", "windowStart": "2025-09-01", "windowEnd": "2025-10-01"},
]
# SPEC §5.3 table: Quarterly 3-1-3 = [Q-4m, Q-1m); Monthly 1-0-1 = [S-1m, S).

# SPEC §5.2 (D16): Gas incl. THE strict window 17:00–17:15 CE(S)T; fallback |t-17:15| <= 60 min.
STRICT_START = 17 * 3600
STRICT_END = 17 * 3600 + 15 * 60
FALLBACK_CENTER = 17 * 3600 + 15 * 60
FALLBACK_HALF_WIDTH = 3600

# backtest-results.json rules + client input: slot 11:00 Berlin, slippage 0.15 EUR/MWh.
# 900 s staleness bound is the one declared in tob-slots-the-gas.json (maxQuoteAgeSeconds).
SLOT_SECONDS = 11 * 3600
MAX_QUOTE_AGE_SECONDS = 900
SLIPPAGE = 0.15


def sha256_file(path):
    digest = hashlib.sha256()
    with open(path, "rb") as stream:
        for chunk in iter(lambda: stream.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def to_float(text):
    try:
        return float(text) if text not in (None, "") else None
    except ValueError:
        return None


def local_seconds(tm_utc, day):
    """Seconds since local midnight in Berlin, or None when the row is not on `day` locally."""
    moment = datetime.fromisoformat(tm_utc.replace("Z", "+00:00")).astimezone(BERLIN)
    if moment.date().isoformat() != day:
        return None
    return moment.hour * 3600 + moment.minute * 60 + moment.second + moment.microsecond / 1e6


def partition_files(table, day):
    folder = LAKE / f"table={table}/cmdty=NATGAS/area=THE/trd_date={day}"
    return sorted(folder.glob("*/part.parquet")) if folder.is_dir() else []


def read_rows(path, required, product, maturity):
    schema_names = pq.ParquetFile(path).schema_arrow.names
    if not set(required).issubset(schema_names):
        return []
    market_columns = [name for name in schema_names if not name.startswith("_")]
    filters = [("ShortCode", "=", product), ("Maturity", "=", maturity), ("InstrumentType", "=", "Simple Instrument")]
    return pq.read_table(path, columns=market_columns, filters=filters).to_pylist()


def market_key(row):
    return tuple(sorted(row.items()))


def exact_market(row):
    return row["Currency"] == "EUR" and row["UOM"] == "MWh" and bool(row["InstrumentISIN"])


def narrow_key(row):
    """BT-01 dedup key (calculate-campaign-daily-proxies.mjs contentKey): Tm, price, bid, ask only."""
    return (row["Tm"], to_float(row.get("Px")), to_float(row.get("BidPx")), to_float(row.get("AskPx")))


def proxy(trade_rows, tob_rows, day, whole_seconds):
    """SPEC §5.2: strict window, then nearby-60m fallback only if strict is empty."""

    def seconds_of(row):
        seconds = local_seconds(row["Tm"], day)
        if seconds is None:
            return None
        return int(seconds) if whole_seconds else seconds

    def formula(inside):
        prices = []
        midpoints = []
        for row in trade_rows:
            seconds = seconds_of(row)
            price = to_float(row["Px"])
            if seconds is not None and price is not None and inside(seconds):
                prices.append(price)
        for row in tob_rows:
            seconds = seconds_of(row)
            bid, ask = to_float(row["BidPx"]), to_float(row["AskPx"])
            if seconds is not None and bid is not None and ask is not None and inside(seconds):
                midpoints.append((bid + ask) / 2)
        t_hat = sum(prices) / len(prices) if prices else None
        m_hat = sum(midpoints) / len(midpoints) if midpoints else None
        if t_hat is not None and m_hat is not None:
            value, label = 0.75 * t_hat + 0.25 * m_hat, "trades+midpoints"
        elif t_hat is not None:
            value, label = t_hat, "trades"
        elif m_hat is not None:
            value, label = m_hat, "midpoints"
        else:
            value, label = None, "missing"
        return {"value": value, "label": label, "trades": len(prices), "midpoints": len(midpoints)}

    strict = formula(lambda seconds: STRICT_START <= seconds <= STRICT_END)
    if strict["value"] is not None:
        return {**strict, "windowUsed": "strict"}
    fallback = formula(lambda seconds: abs(seconds - FALLBACK_CENTER) <= FALLBACK_HALF_WIDTH)
    return {**fallback, "windowUsed": "nearby-60m" if fallback["value"] is not None else "none"}


def daily_reference(product, maturity, day, file_hashes):
    """SPEC §5.2 proxy R̂_d for one exact product+maturity+date.

    `R` is the independent value. `bt01Emulation` reruns the same formula with
    BT-01's two implementation choices (whole-second time, narrow dedup key) so
    that any difference against BT-01 is attributed, not just tolerated.
    """
    trades, tobs = {}, {}
    narrow_trades, narrow_tobs = {}, {}
    instruments = set()
    for path in partition_files("eex_derivative_trade", day):
        for row in read_rows(path, ["InstrumentISIN", "Currency", "UOM", "Tm", "Px"], product, maturity):
            if exact_market(row):
                trades[market_key(row)] = row
                narrow_trades[narrow_key(row)] = row
                instruments.add(row["InstrumentISIN"])
                file_hashes[path.relative_to(LAKE).as_posix()] = None
    for path in partition_files("eex_derivative_top_of_book", day):
        for row in read_rows(path, ["InstrumentISIN", "Currency", "UOM", "Tm", "BidPx", "AskPx"], product, maturity):
            if exact_market(row):
                tobs[market_key(row)] = row
                narrow_tobs[narrow_key(row)] = row
                instruments.add(row["InstrumentISIN"])
                file_hashes[path.relative_to(LAKE).as_posix()] = None

    independent = proxy(trades.values(), tobs.values(), day, whole_seconds=False)
    emulation = proxy(narrow_trades.values(), narrow_tobs.values(), day, whole_seconds=True)
    # Same rule as BT-01 (build-campaign-benchmarks.mjs): more than one ISIN per maturity is not pooled.
    ambiguous = len(instruments) > 1
    return {
        "trdDate": day,
        "instruments": sorted(instruments),
        "dedupedTradeRows": len(trades),
        "dedupedTobRows": len(tobs),
        "windowUsed": independent["windowUsed"],
        "label": independent["label"],
        "trades": independent["trades"],
        "midpoints": independent["midpoints"],
        "R": None if ambiguous else independent["value"],
        "defined": independent["value"] is not None and not ambiguous,
        "bt01Emulation": {
            "R": None if ambiguous else emulation["value"],
            "windowUsed": emulation["windowUsed"],
            "trades": emulation["trades"],
            "midpoints": emulation["midpoints"],
        },
    }


def best_ask_at_slot(product, maturity, day):
    """Best (lowest) valid TOB ask among the rows with the latest Tm in (11:00-900s, 11:00] Berlin.

    The lake publishes EXPLICIT and IMPLIED rows with the same Tm (e.g. 2025-11-04
    G0BQ-202601 09:59:02.985397Z: 33.725 EXPLICIT / 33.515 IMPLIED). Client rule is
    "best ask" (execution_and_costs.md §1 step 2), so ties resolve to the minimum ask.
    """
    best = None
    for path in partition_files("eex_derivative_top_of_book", day):
        columns = ["InstrumentISIN", "Currency", "UOM", "Tm", "BidPx", "AskPx"]
        for row in read_rows(path, columns, product, maturity):
            if not exact_market(row):
                continue
            ask, bid = to_float(row["AskPx"]), to_float(row["BidPx"])
            if ask is None or ask <= 0 or (bid is not None and bid >= ask):
                continue
            seconds = local_seconds(row["Tm"], day)
            if seconds is None or not (SLOT_SECONDS - MAX_QUOTE_AGE_SECONDS < seconds <= SLOT_SECONDS):
                continue
            # Tm strings carry a variable number of fractional digits, so order by parsed time.
            if best is None or seconds > best["seconds"]:
                best = {"seconds": seconds, "Tm": row["Tm"], "asks": {ask}}
            elif seconds == best["seconds"]:
                best["asks"].add(ask)
    if best is None:
        return None
    return {"quoteTm": best["Tm"], "ask": min(best["asks"]), "distinctAsksAtTm": sorted(best["asks"])}


def ledger_check(campaign, decisions):
    fills = []
    for decision in decisions:
        filled = decision.get("filledMw") or 0
        if filled <= 0:
            continue
        quote = best_ask_at_slot(campaign["product"], campaign["maturity"], decision["day"])
        independent_price = quote["ask"] + SLIPPAGE if quote else None
        fills.append({
            "day": decision["day"],
            "filledMw": filled,
            "independentAsk": quote["ask"] if quote else None,
            "independentQuoteTm": quote["quoteTm"] if quote else None,
            "distinctAsksAtTm": quote["distinctAsksAtTm"] if quote else None,
            "independentPriceEurMwh": independent_price,
            "ledgerAsk": decision.get("ask"),
            "ledgerQuoteTm": decision.get("quoteTm"),
            "ledgerPriceEurMwh": decision.get("priceEurMwh"),
        })
    priced = [fill for fill in fills if fill["independentPriceEurMwh"] is not None]
    total_mw = sum(fill["filledMw"] for fill in fills)
    h = None
    if priced and len(priced) == len(fills):
        h = sum(fill["filledMw"] * fill["independentPriceEurMwh"] for fill in priced) / total_mw
    return {"filledMw": total_mw, "H": h, "fills": fills}


def main():
    release = RELEASES[sys.argv[sys.argv.index("--release") + 1] if "--release" in sys.argv else "v2"]
    results_path = release["results"]
    calendar_bytes = CALENDAR.read_bytes()
    results_bytes = (ROOT / results_path).read_bytes()
    exchange_days = json.loads(calendar_bytes)["exchangeDays"]
    results = json.loads(results_bytes)
    file_hashes = {}
    campaigns_out = []
    for campaign in CAMPAIGNS:
        expected = sorted(day for day in exchange_days if campaign["windowStart"] <= day < campaign["windowEnd"])
        per_date = [daily_reference(campaign["product"], campaign["maturity"], day, file_hashes) for day in expected]
        defined = [record["R"] for record in per_date if record["defined"]]
        b = sum(defined) / len(defined) if defined else None

        replay = next(item for item in results["replay"] if item["product"] == campaign["product"] and item["maturity"] == campaign["maturity"])
        stored_campaign = next(item for item in results["campaigns"] if item["product"] == campaign["product"] and item["maturity"] == campaign["maturity"])
        arms = {}
        for arm_id in ("BASELINE", "ARM_A"):
            check = ledger_check(campaign, replay["decisions"][arm_id])
            complete = check["filledMw"] == stored_campaign["targetMw"]
            v = b - check["H"] if b is not None and check["H"] is not None and complete else None
            arms[arm_id] = {**check, "targetMw": stored_campaign["targetMw"], "complete": complete, "V": v}
        baseline, arm_a = arms["BASELINE"], arms["ARM_A"]
        delta_v = baseline["H"] - arm_a["H"] if baseline["complete"] and arm_a["complete"] else None

        campaigns_out.append({
            **campaign,
            "expectedDates": len(expected),
            "definedDates": len(defined),
            "coverage": f"{len(defined)}/{len(expected)}",
            "missingDates": [record["trdDate"] for record in per_date if not record["defined"]],
            "B": b,
            "perDate": per_date,
            "arms": arms,
            "deltaV_ARM_A_vs_BASELINE": delta_v,
        })

    for relative_path in file_hashes:
        file_hashes[relative_path] = sha256_file(LAKE / relative_path)

    artifact = {
        "artifactKind": "BT-04_INDEPENDENT_CHECK",
        "schemaVersion": "1.0",
        "status": "BENCHMARK_PROVISIONAL",
        "method": "Independent Python recomputation from raw EEX parquet per SPEC §5.2/§5.3/§5.5; dedup by all market columns; no import of BT-01/BT-02/src code",
        "scopeLimit": "Fill days/volumes come from the stored decision ledger (no strategy rerun). Fees UNKNOWN/excluded; official settlement UNKNOWN.",
        "inputs": {
            "calendar": {"path": "operations/audit/IMP-09/eex-exchange-calendar.json", "sha256": hashlib.sha256(calendar_bytes).hexdigest()},
            "exploratoryResults": {"path": results_path, "sha256": hashlib.sha256(results_bytes).hexdigest()},
            "lakeRoot": str(LAKE),
            "sourceFileHashes": dict(sorted(file_hashes.items())),
        },
        "parameters": {
            "strictWindowBerlin": "17:00:00.000–17:15:00.000 inclusive, fractional seconds kept",
            "fallbackWindowBerlin": "|t-17:15| <= 60 min",
            "slotBerlin": "11:00", "slotTieRule": "minimum ask among rows at the latest Tm", "maxQuoteAgeSeconds": MAX_QUOTE_AGE_SECONDS, "slippageEurMwh": SLIPPAGE,
            "fees": "UNKNOWN (excluded, never zero)",
        },
        "campaigns": campaigns_out,
    }
    (ROOT / release["output"]).write_text(json.dumps(artifact, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    for item in campaigns_out:
        print(item["campaignKey"], "B", item["B"], item["coverage"],
              "H_base", item["arms"]["BASELINE"]["H"], "H_armA", item["arms"]["ARM_A"]["H"], "dV", item["deltaV_ARM_A_vs_BASELINE"])


if __name__ == "__main__":
    main()
