# IMP-03 / ST-03.2 — EEX THE trade & top-of-book factual audit

- Packet: `WP-IMP-03-ST-2-v1.1` · Subtask: `ST-03.2` · Parent: `IMP-03` · Native root: `LAT-91`
- Project: Energy Markets `96bbd5b1-94da-4781-8c2b-455fdfb28d1a`
- Workspace: `/srv/hot-data/energy-markets/app` on host `brunode`, branch `main` (non-git baseline, empty repo)
- SPEC: `PROCUREMENT_RESEARCH_CANONICAL_ENGINEERING_SPEC_v1_1.md` v1.1, SHA256 `86c4bd4e…39cb6c`
- Instance: `EEX THE trade and top-of-book factual audit 20260921`, instanceVersion `1`, protocol `IMP-03 EEX THE audit protocol 1`
- Worker route: DeepSeek V4.1 Flash via OpenRouter (OpenCode), bounded recovery run
- Scope: enumerate only `table=eex_derivative_trade/cmdty=NATGAS/area=THE` and `table=eex_derivative_top_of_book/cmdty=NATGAS/area=THE` under `/srv/hot-data/EEX`
- Previous accepted audit `operations/audit/IMP-03` examined the project/reference corpus, not this lake. Its historical negative findings and hashes are preserved unchanged; this is a new factual execution instance.

## 1. Method and boundedness

- **Census (full metadata):** every observed `part.parquet` footer is read (row count, row groups, Arrow schema). No row scan. This yields exact file/partition/row/byte totals for the scoped paths.
- **Sample (bounded content):** a deterministic sample of partitions — indices `[0.0, 0.12, 0.25, 0.37, 0.5, 0.62, 0.75, 0.87, 0.97, 1.0]` of the date-sorted partition list, up to 3 files per sampled partition. Row content is read only for those files to observe identifiers, units, missingness and duplicates.
- **Reader environment:** installed venv `/srv/hot-data/alexandria/venvs/data/bin/python3` (pyarrow 25.0.1). No installation, no package changes, no writes to the lake.
- **Determinism:** sampling is a pure function of the observed partition list; `audit_eex_the.py --check` re-reads the live lake and fails on any mismatch with the recorded inventory — per-partition records, per-file records, `distinctPullIds`, schema variants and the 41 sampled file locators/rows/bytes/sha256.
- **Read-only:** the lake is mounted read-only in practice; only `operations/audit/IMP-03/EEX-THE-20260921/ST-03.2/**` inside the workspace is written.

## 2. Census result (observed scope)

| Table | Partitions | Files | Rows | Bytes | Date min | Date max | Schema variants |
|---|---|---|---|---|---|---|---|
| `eex_derivative_trade` (`cmdty=NATGAS/area=THE`) | 1464 | 2801 | 282 693 | 51 080 320 | 2020-11-02 | 2026-07-28 | 14 |
| `eex_derivative_top_of_book` (`cmdty=NATGAS/area=THE`) | 257 | 9251 | 94 714 717 | 7 490 373 724 | 2025-07-25 | 2026-07-28 | 11 |

Partition key is `trd_date=YYYY-MM-DD`; each partition holds one or more `pull_id=<sha256>/part.parquet` files. The top-of-book table carries many more files per partition (multiple per-instrument pulls), consistent with its request path shape `/tob/derivatives/NATGAS/THE/<date>/<ShortCode>/<Maturity>`. Trade uses one request per date `/trd/derivatives/NATGAS/THE/<date>`.

**Schema drift is real within the observed scope:** 14 Arrow-schema variants in trade and 11 in top-of-book. Column sets differ across files (e.g. 20–30 columns). Any consumer must resolve schema per file, not assume one global schema. Schema identity is captured by `schemaSha256` per file in `source-inventory.json`.

**Coverage is not certified.** These are the partitions physically present today. The communicated 2020–2026 range is not thereby proven, and the top-of-book span (2025-07 onward) is much shorter than the trade span. No coverage percentage is used.

## 3. Sampled content observations

Product/contract identity observed in the sample (exact identifiers are in `source-inventory.json` → `contentSamples[*].distinctIdentifiers`):

- `Cmdty=NATGAS`, `Area=THE`, `Currency=EUR`, `UOM=MWh` in every inspected row.
- `ShortCode` observed: `G0BM` (monthly), `G0BQ` (quarterly), `G0BS` (season), `G0BY` (yearly) in trade; `G0BM`, `G0BQ` in top-of-book.
- `InstrumentType`: `Simple Instrument` and `Futures Spread` (spreads carry a `Legs` JSON array).
- `ProductISIN` observed: `DE000A0MEW81`, `DE000A0MEW99` in top-of-book; additionally `DE000A0G9FX0`, `DE000A0MEXA7` in trade. `InstrumentISIN`, `ExpiryDate` and `Maturity` are per contract.

### Quarterly classification evidence (not maturity alone)

Quarterly identity is evidenced by the `DisplayName` quarter token observed in content, e.g. `G0BQ Q1-26`, `G0BQ Q4-25`, `G0BQ Q1-23`. Quarterly `G0BQ` products are observed in trade for years 2023–2028 and in top-of-book for 2025–2026. The `Maturity` month (e.g. `202601`) is explicitly **not** accepted as quarterly evidence by itself, per packet scope. No official EEX contract-specification document was cross-checked, so this is content-based classification only.

### Missingness, units/quality, duplicates (observed sample only)

| Observation | trade sample (1701 rows) | top-of-book sample (533 108 rows) |
|---|---|---|
| Rows missing `DisplayName`/`ExpiryDate`/`InstrumentISIN`/`Maturity` | 34 (~2%) | 153 972 (~29%) |
| Empty `Px` | 587 (volume-only rows) | n/a |
| Empty `BidPx` / `AskPx` | n/a | 64 897 / 42 814 (one-sided books) |
| Duplicate `_row_sha256` | 0 | 167 |
| Duplicate `TrdID` | 34 (coexists with `UpdtAct` = `New`/`Delete`) | n/a |

`Tm` is present in 100% of inspected rows and stored with a UTC `Z` suffix. `_retrieved_at_utc` is 2026 (bulk extraction). These are observed counts inside the sample; they are not projected to the whole lake.

## 4. Scoped Data Sufficiency Matrix contribution

`matrix-contribution.json` contributes six §6.3 rows with all eight fields, reusing existing requirement IDs:

| Req | Availability now | Key evidence |
|---|---|---|
| R-04 execution price series | `AVAILABLE NOW` (observed scope) | Trade `Px` + top-of-book `BidPx`/`AskPx`; PIT `NOT_DEMONSTRATED` |
| R-08 units/contract specs | `UNAVAILABLE` (partial evidence) | `UOM=MWh`, `Currency=EUR`, Isin/Expiry/Maturity observed; lot/tick/delivery absent, so the full critical requirement is not available |
| R-09 publication/policy timestamps | `UNAVAILABLE` | Only `Tm` (occurrence) and 2026 retrieval time exist |
| R-10 missingness/revision history | `UNAVAILABLE` (missingness observed) | Missing counts observed; no vintage/lineage contract |
| R-11 timezone/DST/calendar | `UNAVAILABLE` | UTC storage observed; DST/calendar not verifiable |
| R-12 permissions/rights | `UNAVAILABLE` | No entitlement/rights field appears in any in-scope schema or sampled row |

Requirements this lake does not inform (`R-01, R-02, R-03, R-05, R-06, R-07, R-13…R-17`) preserve the accepted ST-03.1 values and are listed in `notContributed`. **A0 and A1 remain `DATA_BLOCKED`**: only R-04 is now observed; R-08 is partial evidence but the full requirement remains critical-missing, along with R-01, R-02, R-03, R-06, R-07, R-09, R-10, R-11, R-12 and R-17. This is a source contribution, not final readiness; Command reconciles it with the ST-03.3 temporal contribution and the accepted ST-03.1 matrix.

## 5. Frozen decisions respected

Four §6.1 temporal semantics are kept distinct; availability and readiness are separate axes; no missing-to-zero, no forward-fill, no silent exclusion; historical versions preserved; no fabricated official/PIT/permission claim. `Px`/`BidPx`/`AskPx` may be empty and are reported as empty, never as zero.

## 6. DEP-06/07 scoped finding

| DEP | Scoped finding |
|---|---|
| DEP-06 (prices/contracts/coverage/resolution/units/missingness/revisions/permissions) | **PARTIAL EVIDENCE** — real EEX THE trade/top-of-book series observed and source-linked (R-04), plus partial units/identifier evidence (R-08). Coverage, PIT, contract specification, revision/vintage and permissions remain unresolved. |
| DEP-07 (publication/policy-consumable time, forecast/fundamental/event history) | **UNCHANGED** — no publication/policy-consumable timestamps, no forecast vintages. |

`RESOLVES_AUDIT` is claimed only for the exact inspected scope. This execution instance does not overwrite the accepted default receipt and does not claim DEP-06/07 fully satisfied.

## 7. Reproducibility

```
# census + sample (writes JSON)
/srv/hot-data/alexandria/venvs/data/bin/python3 audit_eex_the.py
# deep reproducibility check against source-inventory.json + coverage-summary.json (exit 0 on match)
/srv/hot-data/alexandria/venvs/data/bin/python3 audit_eex_the.py --check
# contract/hash/field verification
node verify-eex-the.mjs
```

The `--check` mode re-reads the live lake and compares the full per-partition records (dates/counts/bytes/rows/pull ids), per-file records, `distinctPullIds`, schema variants and the 41 sampled file locators/rows/bytes/sha256 plus all sample aggregates against the recorded JSON. `verify-eex-the.mjs` additionally rejects any expected output missing from `SHA256SUMS` and any unexpected entry. `verification-output.txt` contains the real captured stdout/exit codes; `SHA256SUMS` lists all stable non-self outputs (`ST_RECEIPT.json`, `SHA256SUMS` excluded as self-referential).

## 8. Unresolved facts and next actions

- Publication-at-source and policy-consumable timestamps (custodian: EEX feed provider).
- Entitlement/rights to use the EEX THE data (custodian: data owner + procurement owner).
- Revision/vintage lineage and predeclared missingness handling.
- DST/calendar verification (sample spanning a DST transition + exchange calendar).
- Full contract specification: lot size, tick, rounding, delivery profile.
- Official benchmark B reference series (not this trade/top-of-book lake).

## 9. Recommendation

Submit for independent review as `in_review`. No parent acceptance, no downstream unlock, no readiness claim.