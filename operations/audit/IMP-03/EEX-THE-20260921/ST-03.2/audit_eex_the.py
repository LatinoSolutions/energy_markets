#!/usr/bin/env python3
# IMP-03 / ST-03.2 bounded factual audit of the Brunode EEX THE NatGas lake.
# Packet WP-IMP-03-ST-2-v1.1, SPEC v1.1 §6, §20.2.7-20.2.8, §25.2.1-25.2.3.
# Census = every observed part.parquet footer (row counts + schema, no row scan).
# Sample = deterministic bounded set of partitions whose content is actually read.
# Read-only. No installs. Uses the installed reader venv (pyarrow).
import os
import sys
import json
import hashlib
import datetime
from concurrent.futures import ThreadPoolExecutor

import pyarrow.parquet as pq

LAKE = "/srv/hot-data/EEX"
OUT = os.path.dirname(os.path.abspath(__file__))
TABLES = {
    "eex_derivative_trade": os.path.join(LAKE, "table=eex_derivative_trade", "cmdty=NATGAS", "area=THE"),
    "eex_derivative_top_of_book": os.path.join(LAKE, "table=eex_derivative_top_of_book", "cmdty=NATGAS", "area=THE"),
}
# Deterministic bounded sample: relative index into the date-sorted partition list.
SAMPLE_INDEX_FRACTIONS = [0.0, 0.12, 0.25, 0.37, 0.5, 0.62, 0.75, 0.87, 0.97, 1.0]
MAX_FILES_PER_SAMPLED_PARTITION = 3


def sha256_file(path):
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def footer_info(path):
    pf = pq.ParquetFile(path)
    md = pf.metadata
    return {
        "rows": md.num_rows,
        "rowGroups": md.num_row_groups,
        "schema": str(pf.schema_arrow),
    }


def collect_files(root):
    files = []
    for dirpath, _dirnames, filenames in os.walk(root):
        for name in filenames:
            if not name.endswith(".parquet"):
                continue
            full = os.path.join(dirpath, name)
            rel = os.path.relpath(full, root)
            st = os.stat(full)
            files.append({
                "rel": rel,
                "path": full,
                "size": st.st_size,
                "mtimeNs": st.st_mtime_ns,
            })
    files.sort(key=lambda f: f["rel"])
    return files


def census_table(table, root):
    files = collect_files(root)
    with ThreadPoolExecutor(max_workers=12) as pool:
        infos = list(pool.map(lambda f: footer_info(f["path"]), files))
    per_file = []
    partitions = {}
    total_rows = 0
    total_bytes = 0
    schema_variants = {}
    for f, info in zip(files, infos):
        parts = f["rel"].split(os.sep)
        trd_date = next((p.split("=", 1)[1] for p in parts if p.startswith("trd_date=")), None)
        pull_id = next((p.split("=", 1)[1] for p in parts if p.startswith("pull_id=")), None)
        schema_hash = hashlib.sha256(info["schema"].encode("utf-8")).hexdigest()
        schema_variants.setdefault(schema_hash, {"count": 0, "schemaText": info["schema"]})
        schema_variants[schema_hash]["count"] += 1
        total_rows += info["rows"]
        total_bytes += f["size"]
        rec = {
            "rel": f["rel"],
            "trdDate": trd_date,
            "pullId": pull_id,
            "bytes": f["size"],
            "rows": info["rows"],
            "rowGroups": info["rowGroups"],
            "schemaSha256": schema_hash,
        }
        per_file.append(rec)
        p = partitions.setdefault(trd_date, {"files": 0, "bytes": 0, "rows": 0, "pullIds": set()})
        p["files"] += 1
        p["bytes"] += f["size"]
        p["rows"] += info["rows"]
        if pull_id:
            p["pullIds"].add(pull_id)
    partition_list = []
    for date in sorted(partitions):
        p = partitions[date]
        partition_list.append({
            "trdDate": date,
            "files": p["files"],
            "bytes": p["bytes"],
            "rows": p["rows"],
            "pullIds": sorted(p["pullIds"]),
        })
    return {
        "table": table,
        "root": root,
        "fileCount": len(files),
        "partitionCount": len(partition_list),
        "totalRows": total_rows,
        "totalBytes": total_bytes,
        "dateMin": partition_list[0]["trdDate"] if partition_list else None,
        "dateMax": partition_list[-1]["trdDate"] if partition_list else None,
        "distinctPullIds": len({f["pullId"] for f in per_file if f["pullId"]}),
        "schemaVariants": [
            {"schemaSha256": k, "fileCount": v["count"], "schemaText": v["schemaText"]}
            for k, v in sorted(schema_variants.items(), key=lambda kv: (-kv[1]["count"], kv[0]))
        ],
        "partitions": partition_list,
        "files": per_file,
    }


def sample_partitions(partition_list):
    n = len(partition_list)
    if n == 0:
        return []
    idx = []
    for frac in SAMPLE_INDEX_FRACTIONS:
        i = min(n - 1, int(round(frac * (n - 1))))
        if i not in idx:
            idx.append(i)
    idx.sort()
    return [partition_list[i] for i in idx]


TRADE_ID_COLUMNS = [
    "Area", "Cmdty", "Currency", "DisplayName", "ExpiryDate", "FromBrokenSpread",
    "InstrumentISIN", "InstrumentType", "Legs", "Maturity", "ProductISIN", "ShortCode",
    "TrdType", "UOM", "UpdtAct", "AgrsrAct", "VolumeOnly",
]
TOB_ID_COLUMNS = [
    "Area", "Cmdty", "Currency", "DisplayName", "ExpiryDate", "InstrumentISIN",
    "InstrumentType", "Legs", "Maturity", "ProductISIN", "ShortCode", "UOM",
    "AskType", "BidType",
]


def empty(value):
    return value is None or value == ""


def sample_content(table, partitions):
    id_columns = TRADE_ID_COLUMNS if table == "eex_derivative_trade" else TOB_ID_COLUMNS
    distinct = {c: set() for c in id_columns}
    inspected = []
    duplicate_rows = []
    duplicate_trd_ids = []
    missing = {}
    empty_counts = {}
    tm_min = None
    tm_max = None
    total_sample_rows = 0
    request_paths = set()
    for part in partitions:
        part_dir = os.path.join(TABLES[table], "trd_date=" + part["trdDate"])
        file_paths = []
        for dirpath, _d, filenames in os.walk(part_dir):
            for name in filenames:
                if name.endswith(".parquet"):
                    file_paths.append(os.path.join(dirpath, name))
        file_paths.sort()
        for path in file_paths[:MAX_FILES_PER_SAMPLED_PARTITION]:
            table_obj = pq.ParquetFile(path).read()
            data = table_obj.to_pydict()
            n = table_obj.num_rows
            total_sample_rows += n
            file_sha = sha256_file(path)
            row_hashes = data.get("_row_sha256", [])
            seen = set()
            for h in row_hashes:
                if h in seen:
                    duplicate_rows.append(h)
                else:
                    seen.add(h)
            trd_ids = data.get("TrdID")
            if trd_ids is not None:
                seen_ids = set()
                for t in trd_ids:
                    if t in seen_ids:
                        duplicate_trd_ids.append(t)
                    else:
                        seen_ids.add(t)
            for rp in data.get("_request_path", []):
                if rp:
                    request_paths.add(rp)
            for c in id_columns:
                vals = data.get(c)
                if vals is None:
                    continue
                for v in vals:
                    if empty(v):
                        missing[c] = missing.get(c, 0) + 1
                    else:
                        distinct[c].add(v)
            for c in ("Px", "Sz", "TrdVol", "BidPx", "AskPx", "BidSz", "AskSz", "BidVol", "AskVol", "Tm", "TrdID"):
                vals = data.get(c)
                if vals is None:
                    continue
                empty_counts[c] = empty_counts.get(c, 0) + sum(1 for v in vals if empty(v))
            tms = [v for v in data.get("Tm", []) if v]
            if tms:
                lo, hi = min(tms), max(tms)
                tm_min = lo if tm_min is None else min(tm_min, lo)
                tm_max = hi if tm_max is None else max(tm_max, hi)
            inspected.append({
                "path": path,
                "trdDate": part["trdDate"],
                "bytes": os.path.getsize(path),
                "rows": n,
                "sha256": file_sha,
            })
    return {
        "partitionDates": [p["trdDate"] for p in partitions],
        "inspectedFiles": inspected,
        "sampleRowsRead": total_sample_rows,
        "distinctIdentifiers": {c: sorted(distinct[c]) for c in id_columns if distinct[c]},
        "missingIdentifierCounts": missing,
        "emptyValueCounts": empty_counts,
        "duplicateRowSha256": sorted(set(duplicate_rows)),
        "duplicateTrdIds": sorted(set(duplicate_trd_ids)),
        "tmMin": tm_min,
        "tmMax": tm_max,
        "distinctRequestPaths": sorted(request_paths),
    }


def quarterly_evidence(sample):
    rows = []
    for shortcode in sample["distinctIdentifiers"].get("ShortCode", []):
        rows.append({"shortCode": shortcode})
    found = {}
    disp = sample["distinctIdentifiers"].get("DisplayName", [])
    for d in disp:
        for q in ("Q1", "Q2", "Q3", "Q4"):
            if q in d:
                found.setdefault(q, []).append(d)
    return {
        "quarterTokenDisplayNames": found,
        "note": ("Quarterly identity is evidenced by the DisplayName quarter token observed in content "
                 "(e.g. 'Q1-26'), not by the Maturity month alone. Maturity alone is explicitly NOT accepted "
                 "as quarterly evidence per packet scope."),
    }


def check_reproducible():
    cov_path = os.path.join(OUT, "coverage-summary.json")
    inv_path = os.path.join(OUT, "source-inventory.json")
    cov = json.load(open(cov_path))
    inv = json.load(open(inv_path))
    errors = []
    aggregate_keys = ("partitionCount", "fileCount", "totalRows", "totalBytes", "dateMin", "dateMax", "distinctPullIds")
    for table, root in TABLES.items():
        actual = census_table(table, root)
        expected_cov = cov["tables"][table]
        for key in aggregate_keys:
            if actual[key] != expected_cov[key]:
                errors.append(f"{table}.coverage.{key}: actual={actual[key]} expected={expected_cov[key]}")
        expected_inv = inv["censusTables"][table]
        # full partition records: dates, file counts, bytes, rows and pull ids
        actual_parts = [[p["trdDate"], p["files"], p["bytes"], p["rows"], p["pullIds"]] for p in actual["partitions"]]
        expected_parts = [[p["trdDate"], p["files"], p["bytes"], p["rows"], p["pullIds"]] for p in expected_inv["partitions"]]
        if actual_parts != expected_parts:
            errors.append(f"{table}.partitions: {len(actual_parts)} vs {len(expected_parts)} records differ")
        # full per-file records
        file_keys = ("rel", "trdDate", "pullId", "bytes", "rows", "rowGroups", "schemaSha256")
        actual_files = [[f[k] for k in file_keys] for f in actual["files"]]
        expected_files = [[f[k] for k in file_keys] for f in expected_inv["files"]]
        if actual_files != expected_files:
            errors.append(f"{table}.files: per-file records differ")
        # schema variants
        actual_schemas = [[s["schemaSha256"], s["fileCount"]] for s in actual["schemaVariants"]]
        expected_schemas = [[s["schemaSha256"], s["fileCount"]] for s in expected_inv["schemaVariants"]]
        if actual_schemas != expected_schemas:
            errors.append(f"{table}.schemaVariants: {len(actual_schemas)} vs {len(expected_schemas)} differ")
        # bounded content sample, re-read from the lake
        sampled = sample_partitions(actual["partitions"])
        actual_sample = sample_content(table, sampled)
        expected_sample = inv["contentSamples"][table]
        if actual_sample["partitionDates"] != expected_sample["partitionDates"]:
            errors.append(f"{table}.sample.partitionDates differ")
        actual_inspected = [[f["path"], f["rows"], f["bytes"], f["sha256"]] for f in actual_sample["inspectedFiles"]]
        expected_inspected = [[f["path"], f["rows"], f["bytes"], f["sha256"]] for f in expected_sample["inspectedFiles"]]
        if actual_inspected != expected_inspected:
            errors.append(f"{table}.sample.inspectedFiles: locators/rows/bytes/sha256 differ")
        for field in ("sampleRowsRead", "distinctIdentifiers", "missingIdentifierCounts",
                      "emptyValueCounts", "duplicateRowSha256", "duplicateTrdIds", "tmMin", "tmMax"):
            if actual_sample[field] != expected_sample[field]:
                errors.append(f"{table}.sample.{field}: differs from recorded inventory")
    report = {"check": "census-inventory-sample-reproducibility", "errors": errors, "ok": not errors}
    print(json.dumps(report, indent=2))
    return 0 if not errors else 1


def main():
    if "--check" in sys.argv:
        sys.exit(check_reproducible())
    started = datetime.datetime.now(datetime.timezone.utc).isoformat()
    results = {}
    samples = {}
    for table, root in TABLES.items():
        print(f"[census] {table}", flush=True)
        results[table] = census_table(table, root)
        print(f"[census] {table}: {results[table]['partitionCount']} partitions, "
              f"{results[table]['fileCount']} files, {results[table]['totalRows']} rows", flush=True)
    for table in TABLES:
        part = sample_partitions(results[table]["partitions"])
        print(f"[sample] {table}: {[p['trdDate'] for p in part]}", flush=True)
        samples[table] = sample_content(table, part)
    finished = datetime.datetime.now(datetime.timezone.utc).isoformat()

    coverage = {
        "artifactKind": "IMP-03_EEX_THE_COVERAGE_SUMMARY",
        "instance": "EEX THE trade and top-of-book factual audit 20260921",
        "instanceVersion": 1,
        "generatedAtUtc": finished,
        "censusDefinition": "Full metadata census: every observed part.parquet footer (rows/schema/bytes), no row scan.",
        "sampleDefinition": ("Deterministic bounded content sample: date-sorted partition indices "
                             + str(SAMPLE_INDEX_FRACTIONS) + f", up to {MAX_FILES_PER_SAMPLED_PARTITION} files per sampled partition."),
        "tables": {
            t: {
                "root": results[t]["root"],
                "partitionCount": results[t]["partitionCount"],
                "fileCount": results[t]["fileCount"],
                "totalRows": results[t]["totalRows"],
                "totalBytes": results[t]["totalBytes"],
                "dateMin": results[t]["dateMin"],
                "dateMax": results[t]["dateMax"],
                "distinctPullIds": results[t]["distinctPullIds"],
                "schemaVariantCount": len(results[t]["schemaVariants"]),
            } for t in TABLES
        },
        "coverageClaim": ("Observed partitions only. Presence in this census is not certified coverage of any "
                          "complete period; the 2020-2026 range remains an unverified input."),
    }

    inventory = {
        "artifactKind": "IMP-03_EEX_THE_SOURCE_INVENTORY",
        "instance": "EEX THE trade and top-of-book factual audit 20260921",
        "instanceVersion": 1,
        "generatedAtUtc": finished,
        "censusTables": {
            t: {
                "root": results[t]["root"],
                "fileCount": results[t]["fileCount"],
                "partitionCount": results[t]["partitionCount"],
                "totalRows": results[t]["totalRows"],
                "totalBytes": results[t]["totalBytes"],
                "schemaVariants": results[t]["schemaVariants"],
                "partitions": results[t]["partitions"],
                "files": results[t]["files"],
            } for t in TABLES
        },
        "contentSamples": samples,
        "quarterlyEvidence": {t: quarterly_evidence(samples[t]) for t in TABLES},
    }

    with open(os.path.join(OUT, "coverage-summary.json"), "w") as fh:
        json.dump(coverage, fh, indent=2, sort_keys=True)
        fh.write("\n")
    with open(os.path.join(OUT, "source-inventory.json"), "w") as fh:
        json.dump(inventory, fh, indent=2, sort_keys=True)
        fh.write("\n")
    print("[done] wrote coverage-summary.json and source-inventory.json", flush=True)
    print("startedUtc", started)
    print("finishedUtc", finished)


if __name__ == "__main__":
    main()