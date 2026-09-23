# IMP-03 / ST-03.3 — EEX THE temporal semantics, provenance and usage-permission audit

- Packet: `WP-IMP-03-ST-3-v1.1` · Subtask: `ST-03.3` · Parent: `IMP-03` · Native root: `LAT-91`
- Project: Energy Markets `96bbd5b1-94da-4781-8c2b-455fdfb28d1a`
- Workspace: `/srv/hot-data/energy-markets/app` on host `brunode`, branch `main` — Git repository with an **unborn HEAD** (no commits, no remote); content-hash baseline is used
- SPEC: `PROCUREMENT_RESEARCH_CANONICAL_ENGINEERING_SPEC_v1_1.md` v1.1, SHA256 `86c4bd4e…39cb6c`
- Instance: `EEX THE trade and top-of-book factual audit 20260921`, instanceVersion `1`, protocol `IMP-03 EEX THE audit protocol 1`
- Worker route: DeepSeek V4.1 Flash via OpenRouter (OpenCode), manual bounded continuation after Go provider-region rejection
- Scope: only `table=eex_derivative_trade/cmdty=NATGAS/area=THE` and `table=eex_derivative_top_of_book/cmdty=NATGAS/area=THE` under `/srv/hot-data/EEX`, plus the packet-granted non-secret extraction metadata
- Sibling `ST-03.2` owns the inventory/census under a disjoint write set. This instance does not repeat it and does not overwrite any accepted artifact.

## 1. Method and boundedness

- **Partition enumeration:** directory listing of `trd_date=*` names only (cheap, no recursion). No full footer census.
- **Content sample:** a deterministic bounded sample of partitions — indices `[0.0, 0.12, 0.25, 0.37, 0.5, 0.62, 0.75, 0.87, 0.97, 1.0]` of the date-sorted partition list, up to 2 files each. Row content is read only for those files to observe the four temporal semantics, lineage, update-action fields and bounded summaries of the price/unit/instrument fields (non-empty counts, bounded distinct values, numeric min/max). Raw rows are never stored.
- **DST probe:** the trading days immediately before/after the EU DST transitions (`2025-03-28/31`, `2025-10-24/27`, `2026-03-27/30`).
- **Reader environment:** installed venv `/srv/hot-data/alexandria/venvs/data/bin/python3` (pyarrow 25.0.1). No installation, no writes to the lake.
- **Determinism:** `audit_eex_the_temporal.py --check` re-reads the live lake and fails on any mismatch of partition counts/span, sampled file locators/rows/bytes/sha256/Tm bounds, entry semantics or preserved hashes.

## 2. Observed scope (current, not assumed)

| Table (`cmdty=NATGAS/area=THE`) | Observed partitions | Date min | Date max | Sampled files |
|---|---|---|---|---|
| `eex_derivative_trade` | 1464 | 2020-11-02 | 2026-07-28 | 12 |
| `eex_derivative_top_of_book` | 257 | 2025-07-25 | 2026-07-28 | 19 |

These are the partitions physically present today. Presence is not certified coverage of a complete period; the communicated 2020–2026 range remains an unverified input. The top-of-book span is much shorter than the trade span.

## 3. The four §6.1 temporal semantics

`temporal-manifest.json` distinguishes the four canonical semantics for all 17 requirements (R-01…R-17), with status vocabulary `OBSERVED / PARTIAL / HISTORICAL_ASSERTION / MISSING / NOT_DEMONSTRATED`.

| Req | occurred/reference | publication/source availability | policy-consumable | revision/version |
|---|---|---|---|---|
| R-04 execution prices | **OBSERVED** (`TrdDate`, `Tm` UTC) | MISSING | NOT_DEMONSTRATED | PARTIAL |
| R-08 units/contract specs | **OBSERVED** (UOM/Currency/ISIN) | MISSING | NOT_DEMONSTRATED | PARTIAL |
| R-09 publication/consumable timestamps | OBSERVED (`Tm`) | MISSING | NOT_DEMONSTRATED | MISSING |
| R-10 missingness/revision history | PARTIAL | MISSING | NOT_DEMONSTRATED | PARTIAL |
| R-11 timezone/DST/calendar | HISTORICAL_ASSERTION + UTC observed | MISSING | NOT_DEMONSTRATED | MISSING |
| R-12 permissions/rights | MISSING | MISSING | MISSING | MISSING |
| R-06 benchmark B (documented rule only) | HISTORICAL_ASSERTION | MISSING | NOT_DEMONSTRATED | MISSING |
| R-01/02/03/05/07/13–17 | MISSING (preserved from accepted ST-03.1) | MISSING | MISSING | MISSING |

**Key distinction.** The lake carries an *occurred/reference* time (`Tm`, stored UTC with a `Z` suffix; `TrdDate` partition key). It carries **no** publication-at-source timestamp and **no** policy-consumable timestamp. The only non-occurrence time present is `_retrieved_at_utc`, a 2026 bulk-extraction time. Therefore the prior accepted manifest's `occurredReferenceTime = MISSING` for R-04/R-08 is now updated to `OBSERVED` for the inspected scope, while publication and policy-consumable remain absent. This is exactly the §6.1 point that **published is not the same as available to the policy**: without contemporaneous evidence the item stays unavailable for Replay.

## 4. Timezone and DST

All observed `Tm` values end in `Z` (UTC); the sampled files show zero non-UTC-suffixed values. There is no local-time or offset column. The CE(S)T settlement windows (gas/THE 17:00–17:15) are a **documented rule**, not verified data. The DST probe dates are present in the lake but only prove that UTC storage is used; they cannot validate the CE(S)T↔UTC mapping or the exchange calendar. Per §6.1, **a timezone conversion does not create PIT proof**.

## 5. Provenance

`provenance-permissions.json` records, per sampled file: lineage columns `_pull_id`, `_request_path`, `_retrieved_at_utc`, `_response_sha256`, `_row_sha256`, `_api_category`, `_endpoint_family`; the request paths (trade `/trd/derivatives/NATGAS/THE/<date>`, top-of-book `/tobs/derivatives/NATGAS/THE/<date>/<ShortCode>/<Maturity>?...`); and the extraction metadata `_scripts/extract-eex.sh` and `_logs/{extract-status.tsv,extract.complete,final-size.txt}`. The extraction log shows a bulk archive extract completed 2026-08-03 (37.7 GB read, 59 961 parquet files, 93 GB on disk). **This proves present possession, not historical policy availability.**

Auxiliary, non-authoritative: the reader app `/home/op/apps/power-markets-explorer/app/market-explorer.tsx` presents timestamps in `Europe/Berlin` (display only) and delivery months in UTC. It is not vendor-semantic authority and does not demonstrate source publication or DST correctness.

## 6. Usage-permission evidence

Search scope: only `/srv/hot-data/energy-markets/reference/**` and `/srv/hot-data/energy-markets/app/docs/**` (`.md/.txt/.json`), plus the inspected non-secret lake metadata.

- No entitlement, license or rights field appears in any inspected schema or sampled row (`lakePermissionFields` is empty).
- Every permission-related mention found is a descriptive comparison row, an audit requirement, or an audit-pending item; none is a usage-rights grant. Notable locators: `eex-reference-price.md:101,126` ("Entitled REST trades" — describes the EEX side of a comparison); SPEC §6.4 (`:572`, requires auditing usage permissions); SPEC B02/B03 (`:1658-1659`, "Acceso y uso autorizado" as a prerequisite); SPEC DEP-09/DEP-10 (`:2039-2040`, `acceso/entitlement real` and `rights/IP` still AUDIT-DEPENDENT); Consolidation Report (`:149-150`, permissions not inspected).

**Conclusion: rights remain `UNKNOWN`.** The absence of evidence is scoped to the inspected material and is **not a legal conclusion**. Presence of files does not grant usage rights.

## 7. Scoped Data Sufficiency Matrix contribution

`matrix-contribution.json` contributes six §6.3 rows with all eight fields, reusing existing requirement IDs. A0 and A1 remain `DATA_BLOCKED`. **R-04 is `UNAVAILABLE`, not `AVAILABLE NOW`:** the lake provides only partial observed price/quote evidence — the bounded sample mixes product buckets/maturities, exact Gas Quarterly campaign/contract eligibility and decision boundaries are not established, and publication/policy-consumable time is absent. R-08 and R-10 are partial evidence but their full critical requirement is unavailable; R-09/R-11/R-12 remain `UNAVAILABLE`. This is a source contribution, not final readiness; Command reconciles it with the ST-03.2 contribution and the accepted ST-03.1 matrix.

### Captured positive evidence

`provenance-permissions.json` → `provenance.sampleEvidenceDigest` (mirrored in the temporal manifest's `observedScope.sampleEvidenceDigest`) records, per sampled file and keyed by file locator + sha256, bounded summaries of `Px`, `Sz`, `TrdVol`, `BidPx`, `AskPx`, `BidSz`, `AskSz`, `BidVol`, `AskVol` (non-empty/empty counts, bounded distinct values, numeric min/max), the unit fields (`UOM=MWh`, `Currency=EUR` observed) and the instrument fields (`InstrumentISIN`, `ProductISIN`, `Maturity`, `ShortCode`, `DisplayName`), plus a per-file product-bucket summary. The verifier asserts these summaries exist and are non-trivial, and `--check` re-reads the lake and fails on any change to the summaries, so a disappearing field or value breaks verification.

## 8. Frozen decisions respected

Four temporal semantics kept distinct; availability and readiness kept as separate axes; no missing-to-zero, forward-fill or silent exclusion; historical views/versions preserved; no fabricated official/PIT/permission claim. Accepted SPEC, receipts, matrices and the prior temporal manifest are untouched (hashes re-verified).

## 9. DEP-06/07 scoped finding

| DEP | Scoped finding |
|---|---|
| DEP-06 | **PARTIAL EVIDENCE** — real EEX THE trade/top-of-book series observed with occurred/reference time and lineage; publication/policy-consumable time, revision/vintage contract and permissions remain unresolved. |
| DEP-07 | **UNCHANGED** — no publication/policy-consumable timestamps, no forecast vintages. |

`RESOLVES_AUDIT` is claimed only for the exact inspected scope. Neither DEP is claimed fully satisfied, and the accepted default receipt is not overwritten.

## 10. Reproducibility

```
# bounded audit (writes JSON)
/srv/hot-data/alexandria/venvs/data/bin/python3 audit_eex_the_temporal.py
# reproducibility check against the recorded manifest/provenance (exit 0 on match)
/srv/hot-data/alexandria/venvs/data/bin/python3 audit_eex_the_temporal.py --check
# contract/hash/field verification via the existing src/contracts validator
node verify-eex-the-temporal.mjs
```

Real stdout and exit codes are in `verification-output.txt`; `SHA256SUMS` lists the stable non-self outputs.

## 11. Unresolved facts and next actions

- Publication-at-source and policy-consumable timestamps (custodian: EEX feed provider).
- Entitlement/rights to use the EEX THE data (custodian: data owner + procurement owner).
- Revision/vintage lineage and a predeclared missingness-handling contract.
- Exchange calendar and DST verification.
- Full contract specification: lot size, tick, rounding, delivery profile.

## 12. Recommendation

Submit for independent review as `in_review`. No parent acceptance, no downstream unlock, no readiness or rights claim.
