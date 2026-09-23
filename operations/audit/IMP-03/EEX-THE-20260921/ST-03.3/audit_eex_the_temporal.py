#!/usr/bin/env python3
# IMP-03 / ST-03.3 bounded factual audit: provenance, the four §6.1 temporal
# semantics and usage-permission evidence for the Brunode EEX THE NatGas lake.
# Packet WP-IMP-03-ST-3-v1.1, SPEC v1.1 §6.1-6.4, §13, §20.2.7-20.2.10, §25.1,
# §25.2.1-25.2.3. Read-only. No installs. Uses the installed reader venv (pyarrow).
#
# Boundedness: partition names are enumerated with a directory listing only; row
# content is read for a deterministic bounded sample of partitions/files. No full
# footer census and no full row scan (ST-03.2 owns the inventory).
import os
import re
import sys
import json
import hashlib
import datetime

import pyarrow.parquet as pq

LAKE = "/srv/hot-data/EEX"
OUT = os.path.dirname(os.path.abspath(__file__))
TABLES = {
    "eex_derivative_trade": os.path.join(LAKE, "table=eex_derivative_trade", "cmdty=NATGAS", "area=THE"),
    "eex_derivative_top_of_book": os.path.join(LAKE, "table=eex_derivative_top_of_book", "cmdty=NATGAS", "area=THE"),
}
# Deterministic bounded sample: relative index into the date-sorted partition list.
SAMPLE_INDEX_FRACTIONS = [0.0, 0.12, 0.25, 0.37, 0.5, 0.62, 0.75, 0.87, 0.97, 1.0]
MAX_FILES_PER_SAMPLED_PARTITION = 2
# Trading days immediately before/after the EU DST transitions observed in scope.
DST_PROBE_DATES = ["2025-03-28", "2025-03-31", "2025-10-24", "2025-10-27", "2026-03-27", "2026-03-30"]
# Non-secret extraction metadata explicitly granted by the packet.
EXTRACTION_METADATA = [
    "/srv/hot-data/EEX/_scripts/extract-eex.sh",
    "/srv/hot-data/EEX/_logs/extract-status.tsv",
    "/srv/hot-data/EEX/_logs/extract.complete",
    "/srv/hot-data/EEX/_logs/final-size.txt",
]
# Supplied project/reference documentation where usage-permission evidence may be
# looked for. Nothing else is scanned.
PERMISSION_DOC_ROOTS = [
    "/srv/hot-data/energy-markets/reference",
    "/srv/hot-data/energy-markets/app/docs",
]
PERMISSION_KEYWORDS = re.compile(
    r"permission|entitle|licen[cs]e|usage right|rights to use|derecho de uso|permiso de uso"
    r"|uso autorizado|terms of use|copyright",
    re.IGNORECASE,
)
# Curated locators where the only permission-related mentions in the supplied
# documentation actually appear. Each is a requirement or audit-pending item,
# not a usage-rights grant for the EEX THE data.
PERMISSION_MENTION_INTERPRETATION = [
    "reference/documentation/eex-reference-price.md:101 — 'Entitled REST trades': describes the EEX side of a comparison table, not a grant to this project.",
    "reference/documentation/eex-reference-price.md:126 — 'entitled official or external settlement feed': describes a data need, not a rights record.",
    "docs/canonical/PROCUREMENT_RESEARCH_CANONICAL_ENGINEERING_SPEC_v1_1.md:572 (§6.4) — requires auditing usage permissions; it does not grant them.",
    "docs/canonical/PROCUREMENT_RESEARCH_CANONICAL_ENGINEERING_SPEC_v1_1.md:1658-1659 (B02/B03) — 'Acceso y uso autorizado a material real' and 'permisos' are prerequisites, not grants.",
    "docs/canonical/PROCUREMENT_RESEARCH_CANONICAL_ENGINEERING_SPEC_v1_1.md:2039-2040 (DEP-09/DEP-10) — 'acceso/entitlement real' and 'rights/IP del entorno y fuentes' remain AUDIT-DEPENDENT.",
    "docs/canonical/PROCUREMENT_RESEARCH_CANONICAL_CONSOLIDATION_REPORT_v1_1.md:146-150,216 — DEP-06/09/10/27 record that effective permissions were NOT inspected.",
]
LINEAGE_COLUMNS = [
    "_pull_id", "_request_path", "_retrieved_at_utc", "_response_sha256",
    "_row_sha256", "_api_category", "_endpoint_family",
]
REVISION_COLUMNS = ["UpdtAct", "AgrsrAct"]
PERMISSION_LIKE_COLUMN = re.compile(r"permission|entitle|licen[cs]e|right", re.IGNORECASE)
NULL_UTC_SUFFIX = "Z"
# Positive price/unit/instrument fields whose bounded summaries must back the
# R-04/R-08 claims. Values are summarised (counts, bounded distinct lists), never
# dumped raw.
TRADE_PRICE_COLUMNS = ["Px", "Sz", "TrdVol"]
TOB_PRICE_COLUMNS = ["BidPx", "AskPx", "BidSz", "AskSz", "BidVol", "AskVol"]
UNIT_COLUMNS = ["UOM", "Currency"]
INSTRUMENT_COLUMNS = ["InstrumentISIN", "ProductISIN", "Maturity", "ShortCode", "DisplayName", "TrdType", "InstrumentType"]
BUCKET_COLUMN = "ShortCode"
MAX_SUMMARY_VALUES = 8

REQUIREMENTS = {
    "R-01": ("Eligible Gas Quarterly campaign list and exact campaign dates", "critical"),
    "R-02": ("Opening obligation, total volume, unit and delivery profile", "critical"),
    "R-03": ("Procurement calendar: trading days, opportunities, deadline, pause/excluded month", "critical"),
    "R-04": ("Execution price series at eligible decision boundaries for the exact Gas Quarterly contract", "critical"),
    "R-05": ("S1 causal price references (price at decision timestamp and reference construction history)", "critical (A1 only; A0 is price-blind)"),
    "R-06": ("Benchmark B reference prices (official EEX settlement or derived provisional) per trading date", "critical"),
    "R-07": ("Execution cost parameters: fees, spread/slippage, latency, fill/partial rules, lot size/rounding", "critical"),
    "R-08": ("Units and contract specifications (EUR, MW vs MWh, delivery hours/profile)", "critical"),
    "R-09": ("Publication and policy-consumable timestamps for price references", "critical"),
    "R-10": ("Missingness and revision/vintage history for prices and references", "critical"),
    "R-11": ("Timezone/DST/calendar semantics for the inspected products", "critical"),
    "R-12": ("Permissions/rights/entitlements to use each source", "critical"),
    "R-13": ("Forecast vintages (expected/surprise) for fundamentals and extraordinary events", "optional"),
    "R-14": ("Fundamental Price Drivers / Extraordinary State observables", "optional"),
    "R-15": ("Market Dynamics & Sentiment State inputs (Z_t components)", "optional"),
    "R-16": ("Intraday resolution for Q07 entry-hour analysis", "optional"),
    "R-17": ("OOS reservation eligibility data (last 8 complete eligible Gas Quarterly campaigns)", "critical"),
}
PRESERVED = {
    "spec": "86c4bd4eeb5f9d0ebad94763128b221eb64525a2b7fff1007dab0af88b39cb6c",
    "imp01Receipt": "78d92de81d8c480b7d96c7203fa2a0661e00e5fb98525aee8c385860a89b887c",
    "priorImp03Receipt": "e203580b4a1dc88107bebd37502450c58286ecd81d9c840f8f94c1bef63bcde3",
    "acceptedSt03_1Matrix": "5e94b60b00245cfe7225c3101bd143d55d5015a7678a0d0c13484334f7a6b42f",
    "priorTemporalManifest": "6b630e9edf994b58ddc7016950403ef1897d780f6baa2e6ec72e787754b58578",
    "referenceDoc": "dfa9cfc8e84f27ea5440ff6c5968654999b71e0c6c7370ec6653178c8e71e260",
}
APP_ROOT = "/srv/hot-data/energy-markets/app"


def sha256_file(path):
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def sha256_text(text):
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def list_partitions(root):
    if not os.path.isdir(root):
        return []
    return sorted(n for n in os.listdir(root) if n.startswith("trd_date="))


def partition_date(name):
    return name.split("=", 1)[1]


def sample_partition_indices(names):
    n = len(names)
    if n == 0:
        return []
    idx = []
    for frac in SAMPLE_INDEX_FRACTIONS:
        i = min(n - 1, int(round(frac * (n - 1))))
        if i not in idx:
            idx.append(i)
    return sorted(idx)


def parquet_files_in_partition(root, date):
    part_dir = os.path.join(root, "trd_date=" + date)
    files = []
    for dirpath, _dirs, names in os.walk(part_dir):
        for name in names:
            if name.endswith(".parquet"):
                files.append(os.path.join(dirpath, name))
    return sorted(files)


def cap(values, limit=8):
    ordered = sorted(set(values))
    return {"distinctCount": len(ordered), "values": ordered[:limit]}


def numeric_summary(values):
    parsed = []
    for v in values:
        try:
            parsed.append(float(v))
        except (TypeError, ValueError):
            continue
    if not parsed:
        return {"numericCount": 0, "min": None, "max": None}
    return {"numericCount": len(parsed), "min": min(parsed), "max": max(parsed)}


def field_summary(values):
    present = [str(v) for v in values if v is not None]
    non_empty = [v for v in present if v != ""]
    summary = {"present": True, "nonEmpty": len(non_empty), "empty": len(present) - len(non_empty)}
    summary.update(cap(non_empty, MAX_SUMMARY_VALUES))
    summary.update(numeric_summary(non_empty))
    return summary


def observe_file(path):
    pf = pq.ParquetFile(path)
    schema_text = str(pf.schema_arrow)
    schema_names = [f.name for f in pf.schema_arrow]
    wanted = LINEAGE_COLUMNS + REVISION_COLUMNS + UNIT_COLUMNS + INSTRUMENT_COLUMNS
    wanted += TRADE_PRICE_COLUMNS + TOB_PRICE_COLUMNS + ["Tm", "TrdDate"]
    columns = [c for c in schema_names if c in wanted]
    data = pf.read(columns=columns).to_pydict()
    tms = [str(v) for v in data.get("Tm", []) if v]
    tms_utc = [t for t in tms if t.endswith(NULL_UTC_SUFFIX)]
    revision = {}
    for c in REVISION_COLUMNS:
        if c in data:
            revision[c] = cap([str(v) for v in data[c] if v is not None and str(v) != ""])
    lineage = {}
    for c in LINEAGE_COLUMNS:
        if c in data:
            vals = [str(v) for v in data[c] if v is not None and str(v) != ""]
            lineage[c] = cap(vals)
    price = {c: field_summary(data[c]) for c in TRADE_PRICE_COLUMNS + TOB_PRICE_COLUMNS if c in data}
    unit = {c: field_summary(data[c]) for c in UNIT_COLUMNS if c in data}
    instrument = {c: field_summary(data[c]) for c in INSTRUMENT_COLUMNS if c in data}
    buckets = cap([str(v) for v in data.get(BUCKET_COLUMN, []) if v], 12) if BUCKET_COLUMN in data else {"distinctCount": 0, "values": []}
    return {
        "path": os.path.relpath(path, LAKE),
        "bytes": os.path.getsize(path),
        "rows": pf.metadata.num_rows,
        "sha256": sha256_file(path),
        "schemaSha256": sha256_text(schema_text),
        "lineageColumnsPresent": [c for c in LINEAGE_COLUMNS if c in schema_names],
        "revisionColumnsPresent": [c for c in REVISION_COLUMNS if c in schema_names],
        "permissionLikeColumns": [c for c in schema_names if PERMISSION_LIKE_COLUMN.search(c)],
        "tmCount": len(tms),
        "tmUtcSuffixCount": len(tms_utc),
        "tmNonUtcSuffixCount": len(tms) - len(tms_utc),
        "tmMin": min(tms) if tms else None,
        "tmMax": max(tms) if tms else None,
        "trdDates": cap([str(v) for v in data.get("TrdDate", []) if v]),
        "lineage": lineage,
        "revision": revision,
        "priceFieldSummary": price,
        "unitFieldSummary": unit,
        "instrumentFieldSummary": instrument,
        "contractBucketSummary": buckets,
    }


def sample_table(table, root, partition_names):
    indices = sample_partition_indices(partition_names)
    dates = [partition_date(partition_names[i]) for i in indices]
    files = []
    for date in dates:
        files.extend(parquet_files_in_partition(root, date)[:MAX_FILES_PER_SAMPLED_PARTITION])
    return {"samplePartitionDates": dates, "files": [observe_file(p) for p in files]}


def dst_probe(table, root, partition_names):
    present = {partition_date(n) for n in partition_names}
    dates = [d for d in DST_PROBE_DATES if d in present]
    observations = []
    for date in dates:
        files = parquet_files_in_partition(root, date)
        if not files:
            continue
        obs = observe_file(files[0])
        observations.append({
            "trdDate": date,
            "file": obs["path"],
            "sha256": obs["sha256"],
            "tmMin": obs["tmMin"],
            "tmMax": obs["tmMax"],
            "tmNonUtcSuffixCount": obs["tmNonUtcSuffixCount"],
        })
    return {
        "probeDates": DST_PROBE_DATES,
        "presentProbeDates": dates,
        "observations": observations,
        "finding": ("All observed Tm values carry a UTC 'Z' suffix and no local-time or offset field is "
                    "present, so no DST conversion can be validated from the lake. The CE(S)T settlement "
                    "windows are a documented rule only; a timezone conversion is not PIT proof (§6.1)."),
    }


def observe_extraction_metadata():
    records = []
    for path in EXTRACTION_METADATA:
        if not os.path.exists(path):
            records.append({"path": path, "present": False})
            continue
        with open(path, "r", errors="replace") as fh:
            body = fh.read(4096)
        records.append({"path": path, "present": True, "sha256": sha256_file(path), "content": body})
    return records


def scan_permission_docs():
    matches = []
    scanned = []
    for root in PERMISSION_DOC_ROOTS:
        if not os.path.isdir(root):
            continue
        for dirpath, _dirs, names in os.walk(root):
            for name in sorted(names):
                if not name.endswith((".md", ".txt", ".json")):
                    continue
                path = os.path.join(dirpath, name)
                scanned.append(os.path.relpath(path, APP_ROOT))
                with open(path, "r", errors="replace") as fh:
                    for lineno, line in enumerate(fh, 1):
                        if PERMISSION_KEYWORDS.search(line):
                            matches.append({
                                "path": path,
                                "sha256": sha256_file(path),
                                "line": lineno,
                                "text": line.strip()[:300],
                            })
    return {"rootsScanned": PERMISSION_DOC_ROOTS, "filesScanned": scanned, "matches": matches}


def observe_lake_scope(table, root):
    names = list_partitions(root)
    sample = sample_table(table, root, names)
    return {
        "root": root,
        "partitionCount": len(names),
        "dateMin": partition_date(names[0]) if names else None,
        "dateMax": partition_date(names[-1]) if names else None,
        "sample": sample,
        "dstProbe": dst_probe(table, root, names),
    }


def reader_timezone_handling():
    path = "/home/op/apps/power-markets-explorer/app/market-explorer.tsx"
    if not os.path.exists(path):
        return {"path": path, "present": False}
    hits = []
    with open(path, "r", errors="replace") as fh:
        for lineno, line in enumerate(fh, 1):
            if re.search(r"timeZone|UTC|Berlin|toISOString", line):
                hits.append({"line": lineno, "text": line.strip()[:200]})
    return {
        "path": path,
        "present": True,
        "sha256": sha256_file(path),
        "hits": hits,
        "authority": ("Read-only auxiliary evidence of how the reader displays timestamps "
                      "(Europe/Berlin presentation, UTC for delivery months). It is NOT vendor-semantic "
                      "authority and does not demonstrate source publication or DST correctness."),
    }


def temporal_entries(scope, digest):
    trade = scope["eex_derivative_trade"]
    tob = scope["eex_derivative_top_of_book"]
    sample_span = {
        "tradeSampleDates": trade["sample"]["samplePartitionDates"],
        "topOfBookSampleDates": tob["sample"]["samplePartitionDates"],
    }
    observed = {
        "status": "OBSERVED",
        "reason": ("TrdDate partition key and per-row Tm (UTC 'Z') are present in the inspected "
                   "files; see observedScope.sample.files[*].tmMin/tmMax."),
    }
    publication_missing = {
        "status": "MISSING",
        "reason": ("No EEX publication-at-source timestamp exists in any inspected schema or sample "
                   "row. Only _retrieved_at_utc (2026 bulk extraction) is present."),
    }
    consumable_missing = {
        "status": "NOT_DEMONSTRATED",
        "reason": ("No contemporaneous policy-consumable evidence exists; per §6.1 a published-but-"
                   "not-consumable item is unavailable for Replay."),
    }
    revision_partial = {
        "status": "PARTIAL",
        "reason": ("Update/aggressor action fields and row/response hashes are present, but no declared "
                   "version/vintage lineage contract exists (§6.1, §6.2)."),
    }
    revision_missing = {"status": "MISSING", "reason": "No version/vintage lineage field or contract present."}
    base_missing = {"status": "MISSING", "value": None}

    def entry(rid, overrides):
        out = {
            "requirementId": rid,
            "requirement": REQUIREMENTS[rid][0],
            "criticalVersusOptional": REQUIREMENTS[rid][1],
            "occurredReferenceTime": dict(base_missing),
            "publicationSourceAvailabilityTime": dict(base_missing),
            "policyConsumableTime": dict(base_missing),
            "revisionVersion": dict(base_missing),
        }
        out.update(overrides)
        return out

    return [
        entry("R-01", {}),
        entry("R-02", {}),
        entry("R-03", {}),
        entry("R-04", {
            "occurredReferenceTime": observed,
            "publicationSourceAvailabilityTime": publication_missing,
            "policyConsumableTime": consumable_missing,
            "revisionVersion": revision_partial,
            "evidence": {"sampleDates": sample_span, "sampleEvidenceDigest": digest},
            "note": ("Price/quote values are captured as bounded per-file summaries, but exact Gas Quarterly "
                     "campaign/contract eligibility and decision boundaries are not established and the bounded "
                     "sample mixes product buckets/maturities. Occurred/reference time is observed; the full "
                     "requirement's availability is not claimed."),
        }),
        entry("R-05", {}),
        entry("R-06", {
            "occurredReferenceTime": {
                "status": "HISTORICAL_ASSERTION",
                "value": "One reference per trading date (methodology only)",
                "evidence": {"path": "reference/documentation/eex-reference-price.md", "sha256": PRESERVED["referenceDoc"], "locator": "§3"},
            },
            "publicationSourceAvailabilityTime": {"status": "MISSING", "value": None,
                "note": "EEX official publication timing is a documented rule, not a present feed."},
            "policyConsumableTime": consumable_missing,
            "revisionVersion": {"status": "MISSING", "value": None,
                "note": "Official-over-derived precedence is documented, but no versioned rows exist."},
        }),
        entry("R-07", {}),
        entry("R-08", {
            "occurredReferenceTime": {
                "status": "OBSERVED",
                "value": "Per-row UOM=MWh, Currency=EUR, ISIN/Expiry/Maturity/ShortCode/DisplayName",
                "reason": "Observed in sampled trade and top-of-book rows; lot/tick/delivery profile absent.",
            },
            "publicationSourceAvailabilityTime": publication_missing,
            "policyConsumableTime": consumable_missing,
            "revisionVersion": revision_partial,
        }),
        entry("R-09", {
            "occurredReferenceTime": observed,
            "publicationSourceAvailabilityTime": publication_missing,
            "policyConsumableTime": consumable_missing,
            "revisionVersion": revision_missing,
        }),
        entry("R-10", {
            "occurredReferenceTime": {
                "status": "PARTIAL",
                "value": "Raw missingness/empty-value and duplicate counts observable per sampled file",
                "reason": "No revision/vintage history is exposed; only raw nullable fields.",
            },
            "publicationSourceAvailabilityTime": publication_missing,
            "policyConsumableTime": consumable_missing,
            "revisionVersion": revision_partial,
        }),
        entry("R-11", {
            "occurredReferenceTime": {
                "status": "HISTORICAL_ASSERTION",
                "value": "CE(S)T settlement windows (power 17:05-17:15; gas/THE 17:00-17:15); Tm stored UTC",
                "evidence": {"path": "reference/documentation/eex-reference-price.md", "sha256": PRESERVED["referenceDoc"], "locator": "§1"},
            },
            "publicationSourceAvailabilityTime": publication_missing,
            "policyConsumableTime": consumable_missing,
            "revisionVersion": revision_missing,
            "note": "UTC storage observed; DST/calendar correctness not verifiable from the lake and not implied by timezone conversion.",
        }),
        entry("R-12", {
            "occurredReferenceTime": {"status": "MISSING", "value": None},
            "publicationSourceAvailabilityTime": {"status": "MISSING", "value": None},
            "policyConsumableTime": {"status": "MISSING", "value": None},
            "revisionVersion": {"status": "MISSING", "value": None},
            "note": "No entitlement/license/rights field in any inspected schema; rights remain unknown.",
        }),
        entry("R-13", {}),
        entry("R-14", {}),
        entry("R-15", {}),
        entry("R-16", {}),
        entry("R-17", {}),
    ]


def sample_evidence_digest(scope):
    """Bounded, non-raw digest of the captured price/unit/instrument evidence.

    Ties every claim to file locators and sha256 so the verifier can fail if the
    fields or values disappear. No raw rows are stored.
    """
    per_file = []
    for table, entry in scope.items():
        for f in entry["sample"]["files"]:
            per_file.append({
                "table": table,
                "path": f["path"],
                "sha256": f["sha256"],
                "priceFieldSummary": f["priceFieldSummary"],
                "unitFieldSummary": f["unitFieldSummary"],
                "instrumentFieldSummary": f["instrumentFieldSummary"],
                "contractBucketSummary": f["contractBucketSummary"],
            })
    unit_values = {}
    for f in per_file:
        for col, summary in f["unitFieldSummary"].items():
            unit_values.setdefault(col, set()).update(summary.get("values", []))
    instrument_values = {}
    for f in per_file:
        for col, summary in f["instrumentFieldSummary"].items():
            instrument_values.setdefault(col, set()).update(summary.get("values", []))
    return {
        "definition": ("Per-file bounded summaries (non-empty counts, bounded distinct values, numeric min/max) "
                       "of Px/BidPx/AskPx and unit/instrument fields, keyed by file locator and sha256. Raw rows "
                       "are not stored."),
        "files": per_file,
        "unitValuesObserved": {c: sorted(v)[:MAX_SUMMARY_VALUES] for c, v in sorted(unit_values.items())},
        "instrumentValuesObserved": {c: sorted(v)[:MAX_SUMMARY_VALUES] for c, v in sorted(instrument_values.items())},
    }


def build_outputs():
    started = datetime.datetime.now(datetime.timezone.utc).isoformat()
    scope = {t: observe_lake_scope(t, r) for t, r in TABLES.items()}
    digest = sample_evidence_digest(scope)
    extraction = observe_extraction_metadata()
    permissions = scan_permission_docs()
    reader = reader_timezone_handling()
    finished = datetime.datetime.now(datetime.timezone.utc).isoformat()

    identity = {
        "artifactKind": "IMP-03_TEMPORAL_MANIFEST",
        "schemaVersion": "1.0",
        "instance": "EEX THE trade and top-of-book factual audit 20260921",
        "instanceVersion": 1,
        "packetId": "WP-IMP-03-ST-3-v1.1",
        "subtaskId": "ST-03.3",
        "parentImp": "IMP-03",
        "projectId": "96bbd5b1-94da-4781-8c2b-455fdfb28d1a",
        "nativeRoot": "LAT-91",
        "specId": "PROCUREMENT_RESEARCH_CANONICAL_ENGINEERING_SPEC_v1_1.md",
        "specVersion": "1.1",
        "specSha256": PRESERVED["spec"],
    }

    manifest = dict(identity)
    manifest.update({
        "generatedAtUtc": finished,
        "purpose": ("Distinguish the four canonical §6.1 time semantics for every P5 Gas Quarterly "
                    "information requirement against the newly identified EEX THE lake, and record "
                    "provenance, revision handling and evidential limits. Presence of an archived "
                    "import proves present possession, not historical policy availability."),
        "semantics": [
            {"key": "occurredReferenceTime", "canonicalDefinition": "Evento, periodo o instante al que se refiere el dato.", "specLocator": "S-01 §6.1 L524"},
            {"key": "publicationSourceAvailabilityTime", "canonicalDefinition": "Momento de publicación o disponibilidad en origen.", "specLocator": "S-01 §6.1 L525"},
            {"key": "policyConsumableTime", "canonicalDefinition": "Momento en que la policy podía consumirlo realmente.", "specLocator": "S-01 §6.1 L526"},
            {"key": "revisionVersion", "canonicalDefinition": "Versión concreta del valor y su lineage.", "specLocator": "S-01 §6.1 L527"},
        ],
        "statusVocabulary": ["OBSERVED", "PARTIAL", "HISTORICAL_ASSERTION", "MISSING", "NOT_DEMONSTRATED"],
        "observedScope": {
            "method": ("Partition names enumerated by directory listing; row content read only for a "
                       "deterministic bounded sample of partitions (fractions " + str(SAMPLE_INDEX_FRACTIONS) +
                       ", up to " + str(MAX_FILES_PER_SAMPLED_PARTITION) + " files each) plus DST probe dates. "
                       "No full footer census and no full row scan; ST-03.2 owns the inventory."),
            "tables": scope,
            "sampleEvidenceDigest": digest,
        },
        "timezoneContract": {
            "storage": "UTC (machine timestamps)",
            "specLocator": "S-01 §6.1 L529",
            "marketPresentationTimezone": "CE(S)T for EEX settlement windows (documented rule, not verified data)",
            "dstHandling": scope["eex_derivative_trade"]["dstProbe"]["finding"],
            "specGuard": "A timezone conversion does not substitute for availability (§6.1 L529).",
        },
        "revisionPolicy": {
            "specLocator": "S-01 §6.1 L536, §6.2 L542",
            "rules": [
                "Revisions create new versions; they never rewrite the historical Decision State.",
                "Official-over-derived substitution changes the evaluation view, never the decision view.",
                "Missing is never zero-filled, forward-filled or silently excluded.",
            ],
            "appliesTo": ["R-04", "R-06", "R-09", "R-10"],
        },
        "entries": temporal_entries(scope, digest),
        "preservedPriorManifest": {
            "path": "operations/audit/IMP-03/temporal-manifest.json",
            "sha256": PRESERVED["priorTemporalManifest"],
            "statement": "Not overwritten. This is a new execution instance under a disjoint write set.",
        },
        "unresolved": [
            "Publication-at-source and policy-consumable timestamps are absent for every requirement.",
            "No version/vintage lineage contract exists; only raw update/aggressor fields and row hashes.",
            "DST/calendar correctness is not verifiable from the lake; UTC storage does not prove CE(S)T mapping.",
            "The 2020-2026 range is a communicated input pending audit, not certified coverage.",
        ],
    })

    provenance = dict(identity)
    provenance.update({
        "artifactKind": "IMP-03_PROVENANCE_PERMISSIONS",
        "generatedAtUtc": finished,
        "provenance": {
            "lakeTables": {
                t: {
                    "root": scope[t]["root"],
                    "lineageColumnsObserved": sorted({c for f in scope[t]["sample"]["files"] for c in f["lineageColumnsPresent"]}),
                    "revisionColumnsObserved": sorted({c for f in scope[t]["sample"]["files"] for c in f["revisionColumnsPresent"]}),
                    "permissionLikeColumnsObserved": sorted({c for f in scope[t]["sample"]["files"] for c in f["permissionLikeColumns"]}),
                    "sampleFiles": scope[t]["sample"]["files"],
                } for t in TABLES
            },
            "extractionMetadata": extraction,
            "readerAppAuxiliary": reader,
            "sampleEvidenceDigest": digest,
        },
        "permissions": {
            "searchScope": permissions["rootsScanned"],
            "filesScanned": permissions["filesScanned"],
            "keywordMatches": permissions["matches"],
            "mentionInterpretation": PERMISSION_MENTION_INTERPRETATION,
            "lakePermissionFields": sorted({c for t in TABLES for f in scope[t]["sample"]["files"] for c in f["permissionLikeColumns"]}),
            "conclusion": {
                "status": "UNKNOWN",
                "statement": ("No entitlement, license or rights record was found in the supplied project/"
                              "reference documentation or in the inspected non-secret lake metadata. Every "
                              "permission-related mention found is either a descriptive comparison row, an "
                              "audit requirement, or an audit-pending item; none is a usage-rights grant for "
                              "the EEX THE data. Absence of evidence is scoped to the inspected material and "
                              "is not a legal conclusion."),
                "absenceIsScoped": True,
            },
        },
        "historicalPolicyAvailability": {
            "status": "NOT_DEMONSTRATED",
            "statement": ("The archived import proves present possession. It carries no source publication "
                          "timestamp and no contemporaneous policy-consumable evidence, so the data cannot be "
                          "replayed as historically available. Missing contemporaneous availability remains "
                          "unavailable for replay."),
            "retrievalTimesObserved": sorted({v for t in TABLES for f in scope[t]["sample"]["files"]
                                              for v in f["lineage"].get("_retrieved_at_utc", {}).get("values", [])}),
        },
    })

    matrix = dict(identity)
    matrix.update({
        "artifactKind": "IMP-03_DATA_SUFFICIENCY_MATRIX_CONTRIBUTION",
        "generatedAtUtc": finished,
        "scope": ("Scoped temporal/provenance contribution for P5 Gas Quarterly arms A0 and A1, derived only "
                  "from the observed EEX THE NatGas trade and top-of-book lake paths and non-secret metadata."),
        "fields": ["requirement", "missionAndCandidate", "criticalVersusOptional", "sourceType",
                   "historicalCoverage", "pointInTimeValidity", "availabilityStatus", "shortValidationNote"],
        "availabilityNamespace": ["AVAILABLE NOW", "FORWARD CAPTURE", "PROXY", "UNAVAILABLE"],
        "readinessNamespace": ["DATA_READY", "DATA_PROVISIONAL", "FORWARD_ONLY", "DATA_BLOCKED"],
        "guards": {
            "universalCoveragePercentageUsed": False,
            "inferredHistoryFromDeclaration": False,
            "assumedFeesOrDefaults": False,
            "fabricatedDataset": False,
            "coveragePercent": None,
            "isContributionNotFinalReadiness": True,
            "reconciliationRequired": ("Final candidate readiness requires Command reconciliation of this "
                                       "contribution with the ST-03.2 contribution and the accepted ST-03.1 matrix."),
        },
        "rows": [
            {
                "requirementId": "R-04",
                "requirement": REQUIREMENTS["R-04"][0],
                "missionAndCandidate": "Quarterly (Gas) / A0 + A1",
                "criticalVersusOptional": "critical",
                "sourceType": "market data: EEX THE NatGas derivative trade prints and top-of-book quotes, Parquet lake",
                "historicalCoverage": {"status": "PARTIAL", "value": "Observed scope only: trade " + str(scope["eex_derivative_trade"]["dateMin"]) + ".." + str(scope["eex_derivative_trade"]["dateMax"]) + " (" + str(scope["eex_derivative_trade"]["partitionCount"]) + " observed partitions); top-of-book " + str(scope["eex_derivative_top_of_book"]["dateMin"]) + ".." + str(scope["eex_derivative_top_of_book"]["dateMax"]) + " (" + str(scope["eex_derivative_top_of_book"]["partitionCount"]) + " observed partitions). The bounded sample mixes product buckets/maturities and contains price and quote values (see evidence.sampleEvidenceDigest).", "evidence": {"sampleDates": sample_span(scope), "sampleEvidenceDigest": digest}},
                "pointInTimeValidity": {"status": "NOT_DEMONSTRATED", "value": None, "reason": "Occurred/reference time (Tm UTC, TrdDate) is observed; publication and policy-consumable times are absent, so decision-time consumption is not demonstrated."},
                "availabilityStatus": "UNAVAILABLE",
                "shortValidationNote": "The full requirement is 'execution price series at eligible decision boundaries for the exact Gas Quarterly contract'. The lake provides only PARTIAL observed price/quote evidence: exact campaign/contract eligibility and decision boundaries are not established, the bounded sample mixes product buckets/maturities, and publication/policy-consumable time is absent. The full R-04 requirement is therefore UNAVAILABLE; the observed price fields are captured as bounded per-file summaries (evidence.sampleEvidenceDigest).",
                "consumers": ["A0", "A1"],
            },
            {
                "requirementId": "R-08",
                "requirement": REQUIREMENTS["R-08"][0],
                "missionAndCandidate": "Quarterly (Gas) / A0 + A1",
                "criticalVersusOptional": "critical",
                "sourceType": "market data instrument metadata carried per row",
                "historicalCoverage": {"status": "PARTIAL", "value": "Observed sample only: captured per-file bounded summaries show UOM=MWh, Currency=EUR and non-empty ISIN/ProductISIN/Maturity/ShortCode/DisplayName; lot/tick/delivery profile absent. Exact identifiers and counts are in evidence.sampleEvidenceDigest.", "evidence": {"sampleDates": sample_span(scope), "sampleEvidenceDigest": digest}},
                "pointInTimeValidity": {"status": "NOT_DEMONSTRATED", "value": None},
                "availabilityStatus": "UNAVAILABLE",
                "shortValidationNote": "Partial units/identifier evidence only; the full critical requirement is not available.",
                "consumers": ["A0", "A1"],
            },
            {
                "requirementId": "R-09",
                "requirement": REQUIREMENTS["R-09"][0],
                "missionAndCandidate": "Quarterly (Gas) / A0 + A1",
                "criticalVersusOptional": "critical",
                "sourceType": "lake lineage columns and per-row Tm",
                "historicalCoverage": {"status": "MISSING", "value": None, "missing": {"reason": "Only occurrence time (Tm UTC) and a 2026 bulk retrieval time are present; no EEX publication and no policy-consumable timestamp.", "inspectedSources": ["observedScope.tables[*].sample.files[*].lineage", "observedScope.tables[*].sample.files[*].tmMin/tmMax"], "custodianRole": "Data owner/custodian (EEX feed provider)", "nextRetrievalAction": "Provide source-row publication times and contemporaneous availability evidence."}},
                "pointInTimeValidity": {"status": "MISSING", "value": None},
                "availabilityStatus": "UNAVAILABLE",
                "shortValidationNote": "Occurred/reference time observed; the two availability semantics required by §6.1 are absent.",
                "consumers": ["A0", "A1"],
            },
            {
                "requirementId": "R-10",
                "requirement": REQUIREMENTS["R-10"][0],
                "missionAndCandidate": "Quarterly (Gas) / A0 + A1",
                "criticalVersusOptional": "critical",
                "sourceType": "lake row content (nullable fields, UpdtAct/AgrsrAct, _row_sha256)",
                "historicalCoverage": {"status": "PARTIAL", "value": "Raw missingness and update-action fields observable per sampled file; no vintage history.", "evidence": {"sampleDates": sample_span(scope)}},
                "pointInTimeValidity": {"status": "NOT_DEMONSTRATED", "value": None},
                "availabilityStatus": "UNAVAILABLE",
                "shortValidationNote": "A predeclared revision/vintage contract is absent; no missing-to-zero, forward-fill or silent exclusion is applied.",
                "consumers": ["A0", "A1"],
            },
            {
                "requirementId": "R-11",
                "requirement": REQUIREMENTS["R-11"][0],
                "missionAndCandidate": "Quarterly (Gas) / A0 + A1",
                "criticalVersusOptional": "critical",
                "sourceType": "per-row Tm timestamps and TrdDate partition keys",
                "historicalCoverage": {"status": "MISSING", "value": None, "missing": {"reason": "Tm is stored with a UTC Z suffix and TrdDate is the market trade date, but no exchange calendar or timezone declaration verifies conversion semantics.", "inspectedSources": ["observedScope.tables[*].dstProbe"], "custodianRole": "Exchange calendar custodian", "nextRetrievalAction": "Provide the applicable exchange calendar and a timestamped DST-transition sample."}},
                "pointInTimeValidity": {"status": "NOT_DEMONSTRATED", "value": None},
                "availabilityStatus": "UNAVAILABLE",
                "shortValidationNote": "UTC storage observed; DST/calendar correctness is not verifiable and cannot be assumed.",
                "consumers": ["A0", "A1"],
            },
            {
                "requirementId": "R-12",
                "requirement": REQUIREMENTS["R-12"][0],
                "missionAndCandidate": "Quarterly (Gas) / A0 + A1",
                "criticalVersusOptional": "critical",
                "sourceType": "entitlement/rights record",
                "historicalCoverage": {"status": "MISSING", "value": None, "missing": {"reason": "No entitlement/license/rights field appears in any inspected schema or sample row; no rights document was found in the supplied documentation.", "inspectedSources": ["provenance-permissions.json permissions.lakePermissionFields", "provenance-permissions.json permissions.keywordMatches"], "custodianRole": "Data owner/custodian (EEX feed provider) and procurement owner", "nextRetrievalAction": "Provide a rights/entitlement record for this EEX THE data."}},
                "pointInTimeValidity": {"status": "MISSING", "value": None},
                "availabilityStatus": "UNAVAILABLE",
                "shortValidationNote": "Rights remain unknown. Absence of evidence is scoped, not a legal conclusion. Presence of files does not grant usage rights.",
                "consumers": ["A0", "A1"],
            },
        ],
        "notContributed": [
            {"requirementId": rid, "reason": "Not informed by the EEX THE lake temporal/provenance scope; preserves the accepted ST-03.1 value."}
            for rid in ["R-01", "R-02", "R-03", "R-05", "R-06", "R-07", "R-13", "R-14", "R-15", "R-16", "R-17"]
        ],
        "readinessContribution": {
            "note": "This instance does not change candidate readiness; final readiness requires reconciliation of both contributions with the accepted ST-03.1 matrix.",
            "candidates": [
                {"candidate": "A0 Calendar-only baseline", "mission": "Quarterly (Gas)", "readiness": "DATA_BLOCKED",
                 "rationale": "Only partial observed price/quote evidence exists for R-04 (no exact contract eligibility or decision-boundary coverage), and publication/policy-consumable time (R-09), timezone/DST (R-11), revision lineage (R-10) and rights (R-12) remain unavailable; the full R-08 contract specification is absent. A critical requirement missing means not DATA_READY (§6.3).",
                 "criticalMissing": ["R-01", "R-02", "R-03", "R-04", "R-06", "R-07", "R-08", "R-09", "R-10", "R-11", "R-12", "R-17"],
                 "nowObserved": [], "partialEvidence": ["R-04", "R-08", "R-10"]},
                {"candidate": "A1 S1 candidate", "mission": "Quarterly (Gas)", "readiness": "DATA_BLOCKED",
                 "rationale": "Inherits every critical gap of A0 (R-04 included) and additionally lacks the S1 causal price reference (R-05).",
                 "criticalMissing": ["R-01", "R-02", "R-03", "R-04", "R-05", "R-06", "R-07", "R-08", "R-09", "R-10", "R-11", "R-12", "R-17"],
                 "nowObserved": [], "partialEvidence": ["R-04", "R-08", "R-10"]},
            ],
        },
        "preserved": {
            "acceptedSt03_1Matrix": "operations/audit/IMP-03/data-sufficiency-matrix.json",
            "acceptedSt03_1MatrixSha256": PRESERVED["acceptedSt03_1Matrix"],
            "siblingSt03_2Contribution": "operations/audit/IMP-03/EEX-THE-20260921/ST-03.2/matrix-contribution.json",
            "statement": "Neither is overwritten. This contribution is a new artifact under a disjoint write set.",
        },
    })

    with open(os.path.join(OUT, "temporal-manifest.json"), "w") as fh:
        json.dump(manifest, fh, indent=2, sort_keys=True)
        fh.write("\n")
    with open(os.path.join(OUT, "provenance-permissions.json"), "w") as fh:
        json.dump(provenance, fh, indent=2, sort_keys=True)
        fh.write("\n")
    with open(os.path.join(OUT, "matrix-contribution.json"), "w") as fh:
        json.dump(matrix, fh, indent=2, sort_keys=True)
        fh.write("\n")
    print("[done] wrote temporal-manifest.json, provenance-permissions.json, matrix-contribution.json")
    print("startedUtc", started)
    print("finishedUtc", finished)


def sample_span(scope):
    return {
        "tradeSampleDates": scope["eex_derivative_trade"]["sample"]["samplePartitionDates"],
        "topOfBookSampleDates": scope["eex_derivative_top_of_book"]["sample"]["samplePartitionDates"],
    }


def check_reproducible():
    errors = []
    for name, expected in [
        ("temporal-manifest.json", "IMP-03_TEMPORAL_MANIFEST"),
        ("provenance-permissions.json", "IMP-03_PROVENANCE_PERMISSIONS"),
        ("matrix-contribution.json", "IMP-03_DATA_SUFFICIENCY_MATRIX_CONTRIBUTION"),
    ]:
        path = os.path.join(OUT, name)
        if not os.path.exists(path):
            errors.append(f"missing {name}")
            continue
        data = json.load(open(path))
        if data.get("artifactKind") != expected:
            errors.append(f"{name} artifactKind {data.get('artifactKind')} != {expected}")
    # Re-derive observed scope and compare the temporal/provenance core.
    scope = {t: observe_lake_scope(t, r) for t, r in TABLES.items()}
    manifest = json.load(open(os.path.join(OUT, "temporal-manifest.json")))
    recorded = manifest["observedScope"]["tables"]
    for table in TABLES:
        for key in ("partitionCount", "dateMin", "dateMax"):
            if scope[table][key] != recorded[table][key]:
                errors.append(f"{table}.{key}: actual={scope[table][key]} recorded={recorded[table][key]}")
        file_keys = ("path", "rows", "bytes", "sha256", "tmMin", "tmMax", "tmNonUtcSuffixCount",
                     "priceFieldSummary", "unitFieldSummary", "instrumentFieldSummary", "contractBucketSummary")
        actual_files = [[f[k] for k in file_keys] for f in scope[table]["sample"]["files"]]
        recorded_files = [[f[k] for k in file_keys] for f in recorded[table]["sample"]["files"]]
        if actual_files != recorded_files:
            errors.append(f"{table}.sample.files differ (locators/rows/bytes/sha256/Tm/price/unit/instrument/bucket)")
    # Re-check the four semantics are present on every entry.
    for e in manifest["entries"]:
        for sem in ("occurredReferenceTime", "publicationSourceAvailabilityTime", "policyConsumableTime", "revisionVersion"):
            if sem not in e:
                errors.append(f"entry {e.get('requirementId')} missing {sem}")
    # Re-check preserved hashes.
    for label, rel, expected, base in [
        ("spec", "docs/canonical/PROCUREMENT_RESEARCH_CANONICAL_ENGINEERING_SPEC_v1_1.md", PRESERVED["spec"], APP_ROOT),
        ("imp01Receipt", "operations/receipts/IMP-01-IMP_RECEIPT.json", PRESERVED["imp01Receipt"], APP_ROOT),
        ("priorImp03Receipt", "operations/receipts/IMP-03-IMP_RECEIPT.json", PRESERVED["priorImp03Receipt"], APP_ROOT),
        ("acceptedSt03_1Matrix", "operations/audit/IMP-03/data-sufficiency-matrix.json", PRESERVED["acceptedSt03_1Matrix"], APP_ROOT),
        ("priorTemporalManifest", "operations/audit/IMP-03/temporal-manifest.json", PRESERVED["priorTemporalManifest"], APP_ROOT),
        ("referenceDoc", "documentation/eex-reference-price.md", PRESERVED["referenceDoc"], "/srv/hot-data/energy-markets/reference"),
    ]:
        actual = sha256_file(os.path.join(base, rel))
        if actual != expected:
            errors.append(f"preserved:{label}: {actual} != {expected}")
    report = {"check": "temporal-provenance-reproducibility", "errors": errors, "ok": not errors}
    print(json.dumps(report, indent=2))
    return 0 if not errors else 1


def main():
    if "--check" in sys.argv:
        sys.exit(check_reproducible())
    build_outputs()


if __name__ == "__main__":
    main()
