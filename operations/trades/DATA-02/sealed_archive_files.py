"""Verified allowlist for sealed archive parquets used by FIX-03.

The extracted tree also contains client-excluded pulls. Only paths present in
files.jsonl and absent from exclusions.jsonl may contribute to a source-bound
release. DATA-02's source-partitions manifest pins both listing hashes.
"""

import hashlib
import json
from pathlib import Path


def sha256_file(path):
    digest = hashlib.sha256()
    with open(path, "rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _gas_path(record):
    path = record.get("archive_path")
    if not path and isinstance(record.get("source_path"), str):
        marker = "/lake/v1/"
        source_path = record["source_path"]
        if marker in source_path:
            path = "data/lake/v1/" + source_path.split(marker, 1)[1]
    return path if isinstance(path, str) and (
        path.startswith("data/lake/v1/table=eex_derivative_trade/cmdty=NATGAS/area=THE/")
        or path.startswith("data/lake/v1/table=eex_derivative_top_of_book/cmdty=NATGAS/area=THE/")
    ) else None


def verified_gas_file_index(source_partitions, source_partitions_sha256, coverage_manifest, archive_root):
    if coverage_manifest.get("inputs", {}).get("sourcePartitions", {}).get("sha256") != source_partitions_sha256:
        raise ValueError("DATA-02 source partitions hash mismatch")
    inputs = source_partitions.get("sources", {}).get("CLIENT_SEALED_ARCHIVE", {}).get("inputs", {})
    allowed = {}
    root = Path(archive_root).resolve()
    for name in ("files", "exclusions"):
        ref = inputs.get(name, {})
        path = Path(ref.get("path", ""))
        if path.resolve() != root / f"{name}.jsonl" or sha256_file(path) != ref.get("sha256"):
            raise ValueError(f"DATA-02 {name}.jsonl hash/path mismatch")
        selected = set()
        with open(path, encoding="utf-8") as stream:
            for line in stream:
                record = json.loads(line)
                gas_path = _gas_path(record)
                if gas_path:
                    selected.add(gas_path)
        allowed[name] = selected
    if allowed["exclusions"] & allowed["files"]:
        raise ValueError("DATA-02 gas file is both sealed and excluded")
    return allowed["files"] - allowed["exclusions"], allowed["exclusions"]
