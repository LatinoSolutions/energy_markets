#!/usr/bin/env python3
"""Recheck every parquet hash claimed by the two FIX-03 v3 row releases."""

import argparse
import hashlib
import json
import os
from pathlib import Path


def digest_file(path):
    digest = hashlib.sha256()
    with open(path, "rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def verify_refs(refs, roots):
    verified = set()
    for ref in refs:
        name = ref.get("path", "")
        source, separator, relative = name.partition("/")
        if not separator or source not in roots or not relative or not isinstance(ref.get("sha256"), str):
            raise ValueError(f"Invalid FIX-03 source reference: {name}")
        root = Path(roots[source]).resolve()
        file = (root / relative).resolve()
        if not file.is_relative_to(root) or digest_file(file) != ref["sha256"]:
            raise ValueError(f"FIX-03 source file hash mismatch: {name}")
        verified.add(name)
    return verified


def verify_release(bt01_rows, imp05_rows, roots):
    if bt01_rows.get("artifactKind") != "BT-01_CAMPAIGN_PROXY_ROWS" or imp05_rows.get("artifactKind") != "IMP-05_SOURCE_PROXY_ROWS":
        raise ValueError("Unexpected FIX-03 row artifact kind")
    bt_hashes = bt01_rows.get("sourceFileHashes", {})
    bt_refs = [{"path": name, "sha256": digest} for name, digest in bt_hashes.items()]
    for campaign in bt01_rows.get("campaigns", []):
        for day in campaign.get("perDate", []):
            if day.get("selectedSource") == "DATA_INCOMPLETE" and day.get("sourceFiles"):
                raise ValueError("DATA_INCOMPLETE includes source files")
            for ref in day.get("sourceFiles", []):
                if not ref.get("path", "").startswith(f"{day.get('selectedSource')}/"):
                    raise ValueError("BT-01 day mixes sources")
                if bt_hashes.get(ref.get("path")) != ref.get("sha256"):
                    raise ValueError("BT-01 day source file differs from release hash index")
    imp_refs = []
    for day in imp05_rows.get("perDate", []):
        if day.get("selectedSource") == "DATA_INCOMPLETE" and day.get("sourceFiles"):
            raise ValueError("DATA_INCOMPLETE includes source files")
        if any(not ref.get("path", "").startswith(f"{day.get('selectedSource')}/") for ref in day.get("sourceFiles", [])):
            raise ValueError("IMP-05 day mixes sources")
        imp_refs.extend(day.get("sourceFiles", []))
    return verify_refs(bt_refs + imp_refs, roots)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--repo-root", default=str(Path(__file__).resolve().parents[3]))
    args = parser.parse_args()
    root = Path(args.repo_root)
    bt01 = json.loads((root / "operations/audit/BT-01/v3/campaign-proxy-rows-BT-01.json").read_bytes())
    imp05 = json.loads((root / "operations/audit/IMP-05/source-proxy-rows-IMP-05-v3.json").read_bytes())
    roots = {
        "CLIENT_SEALED_ARCHIVE": os.environ.get("EEX_ARCHIVE_EXTRACTED_ROOT", "/srv/data/eex-client-archive/extraido"),
        "EEX_LAKE_PATCH": os.environ.get("EEX_LAKE_ROOT", "/srv/hot-data/EEX"),
    }
    verified = verify_release(bt01, imp05, roots)
    print(f"FIX-03 verified source parquet hashes: {len(verified)}")


if __name__ == "__main__":
    main()
