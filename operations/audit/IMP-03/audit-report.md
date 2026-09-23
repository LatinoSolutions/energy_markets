# IMP-03 / ST-03.1 — Data audit P5 Gas Quarterly: inventario, manifest temporal y Data Sufficiency Matrix

- Packet: `WP-IMP-03-ST-1-v1.1` · Subtask: `ST-03.1` · Parent: `IMP-03` (`LAT-109`) · Native root: `LAT-91`
- Project: Energy Markets `96bbd5b1-94da-4781-8c2b-455fdfb28d1a`
- Workspace: `/srv/hot-data/energy-markets/app` on `brunode`, empty `main` (content-hash baseline)
- SPEC: `PROCUREMENT_RESEARCH_CANONICAL_ENGINEERING_SPEC_v1_1.md` v1.1, SHA256 `86c4bd4e…39cb6c`
- Accepted prerequisite: IMP-01 receipt SHA256 `78d92de8…b887c`, content version `c7cdf47c…d15a437c`
- Scope: data audit DEP-06/07 in the inspected P5 Gas Quarterly scope only; A0/A1 price, execution, accounting and S1 causal input needs. No Q07 audit, no engine selection, no economic outcome reading.

## 1. Method

Read-only factual inspection of the project workspace and `/srv/hot-data/energy-markets/reference`.
Reference files are provenance only: never extra requirements, never a substitute for a real source or
an executable mandate. Each claim is classified with a source, hash and exact locator, or recorded as
MISSING with a named custodian role and an exact retrieval action. Nothing is inferred.

Deliverables:

| Artifact | Purpose |
|---|---|
| `source-inventory.json` | Inspected sources with hashes/locators; workspace and reference scans. |
| `temporal-manifest.json` | The four §6.1 time semantics per requirement plus timezone/DST and revision policy. |
| `data-sufficiency-matrix.json` | One row per important requirement with the eight frozen §6.3 fields and both state axes. |
| `verify.mjs` + `verify-run.txt` | Executable contract/provenance checks and labeled synthetic negative cases. |
| `write-set-manifest.json` | Before/after write set proving no writes outside `allowed_paths`. |

## 2. Inventory result

`dataArtifactsPresent = []`. **There is no market data series of any kind in the inspected material**:
no price/trade/order-book file, no calendar, no contract specification, no fee schedule, no
entitlement record, no database or data directory. The workspace holds only the canonical SPEC,
accepted IMP-01 contracts/receipts, prior operations evidence, bootstrap files and tests.

The reference corpus (`reference/`) is historical provenance (D01–D18). All **18** files are
dispositioned exactly once in `source-inventory.json`: **9 cited** in `sources[]` (S-05…S-13) and
**9 listed** in `notInspected[]` with their sha256 and a stated reason. `verify.mjs` re-enumerates the
directory and fails if any file is missing from both lists, appears in both, or drifts in hash, so the
universal negative is reproducible rather than asserted. The cited files document intended
methodology and an external system (`eex-reference-price.md`, `Program.fs` /
`HighResolutionProcurementModel.fs`) that ingests "Entitled REST trades and top-of-book
observations" (`S-05 §4 L101`). That repository, its data and its entitlements are **not present or
verifiable here**; the same document records a historical HTTP 403 for the settlement endpoint
(`S-05 §4 L108`). This is an audit finding, not an available source.

### The 2020–2026 claim

The range 2020–2026 is a **communicated input pending audit, not certified coverage**. The SPEC
states it explicitly (`S-01 §6.4 L570`; CCR-13 `S-01 L1995`), and the provenance corpus repeats it
(`S-07 p.8`; `S-10 p.6`; `S-11 p.2`). No evidence of actual coverage by source was found, so no
coverage, resolution or completeness is claimed.

## 3. Data Sufficiency Matrix

17 rows cover the P5 Gas Quarterly requirements for A0 and A1 (13 critical, 4 optional). Availability
and candidate readiness use their separate canonical namespaces.

| # | Requirement | Criticality | Availability | Basis |
|---|---|---|---|---|
| R-01 | Eligible campaign list and exact dates | critical | UNAVAILABLE | No campaign dataset |
| R-02 | Opening obligation, volume, unit, delivery profile | critical | UNAVAILABLE | Historical 60 MW only, MW≠MWh |
| R-03 | Procurement calendar, opportunities, deadline, pause | critical | UNAVAILABLE | Only benchmark windows documented |
| R-04 | Execution price series at decision boundaries | critical | UNAVAILABLE | No price/trade/book series |
| R-05 | S1 causal price references | critical (A1) | UNAVAILABLE | No reference series; S1 not instantiated |
| R-06 | Benchmark B references (official/proxy) | critical | UNAVAILABLE | Methodology documented, no rows |
| R-07 | Execution costs (fees, spread, latency, lots) | critical | UNAVAILABLE | No execution parameters |
| R-08 | Units and contract specifications | critical | UNAVAILABLE | Incomplete units only |
| R-09 | Publication / policy-consumable timestamps | critical | UNAVAILABLE | No timestamped source rows |
| R-10 | Missingness and revision/vintage history | critical | UNAVAILABLE | No versioned series |
| R-11 | Timezone/DST/calendar semantics | critical | UNAVAILABLE | Window rule documented, not verifiable |
| R-12 | Permissions/rights/entitlements | critical | UNAVAILABLE | No entitlement record; HTTP 403 history |
| R-13 | Forecast vintages | optional | UNAVAILABLE | Excluded from P5 timing |
| R-14 | Fundamental drivers / extraordinary | optional | UNAVAILABLE | Excluded from P5 timing |
| R-15 | Market Dynamics Z_t inputs | optional | UNAVAILABLE | Excluded from P5 timing |
| R-16 | Intraday resolution for Q07 | optional | UNAVAILABLE | Separate IMP-21 scope |
| R-17 | OOS reservation eligibility (last 8 campaigns) | critical | UNAVAILABLE | No eligibility dataset; IMP-09 scope |

### Candidate readiness

| Candidate | Mission | Readiness | Critical missing |
|---|---|---|---|
| A0 Calendar-only baseline | Quarterly (Gas) | **DATA_BLOCKED** | R-01, R-02, R-03, R-04, R-06, R-07, R-08, R-09, R-10, R-11, R-12, R-17 |
| A1 S1 candidate | Quarterly (Gas) | **DATA_BLOCKED** | all of the above plus R-05 |

**A missing critical requirement means the candidate is not DATA_READY** (`S-01 §6.3 L566`). No
universal coverage percentage is used to average away the missing critical inputs. No fee, unit,
history or dataset is invented.

## 4. Temporal manifest

All four §6.1 semantics are defined and recorded per requirement: occurred/reference time,
publication/source-availability time, policy-consumable time and revision/version. Every real value
is MISSING because no series exists; only documented rules (settlement windows 17:05–17:15 CE(S)T
for German power and 17:00–17:15 CE(S)T for gas/THE; official-over-derived precedence; 1-0-1/3-1-3
windows) are HISTORICAL_ASSERTION provenance. DST handling is MISSING and cannot be verified without
a real timestamped series; a time conversion does not substitute availability (`S-01 §6.1 L529`).

## 5. DEP-06/07 scope findings (P5 only)

| DEP | Status | Finding |
|---|---|---|
| DEP-06 — precios/contratos, cobertura, resolución, unidades, missingness, revisiones, permisos | **DOCUMENTED_ABSENCE** (not resolved) | No series, contract or permission exists in the inspected material. Inventory and matrix produced; every value is MISSING with a custodian. |
| DEP-07 — publication/policy-consumable time, forecast/fundamental/event history | **DOCUMENTED_ABSENCE** (not resolved) | No timestamped source rows or forecast vintages exist. All PIT claims remain NOT_DEMONSTRATED. |

`RESOLVES_AUDIT` is claimed only for the material actually inspected: an inventory plus a documented
absence. **A documented absence is not a closure** and does not certify that a source is missing
globally; it records what could not be demonstrated under the existing authority.

## 6. Unresolved facts and retrieval actions

| Fact | Custodian role | Exact retrieval action |
|---|---|---|
| Exact Gas Quarterly products/contracts | Procurement owner / mandate custodian | Provide audited campaign list with contract identity and dates. |
| Existence and entitlement of a price/trade/book source | Data owner/custodian (EEX feed provider) | Provide a hashable extract with timestamps, units and coverage; confirm entitlements in writing. |
| Historical coverage and resolution by source | Data owner/custodian | Provide coverage/resolution report for the exact series. |
| Missingness and revision/vintage lineage | Data owner/custodian | Provide revision metadata and missing-period records. |
| Publication and policy-consumable timestamps | Data owner/custodian | Provide source-row publication times and contemporaneous availability evidence. |
| Execution cost parameters | Execution/mandate custodian | Provide audited fees, spread/slippage, latency, fill rules and lots/rounding. |
| DST/timezone/calendar verification | Data owner/custodian | Provide a timestamped sample spanning a DST transition. |

## 7. Recommendation

The subtask is complete as a **negative factual audit**: inventory, temporal manifest and matrix are
produced with passing verifier and preserved prerequisite hashes. **Both P5 Gas Quarterly candidates
are DATA_BLOCKED**, so the parent IMP-03 cannot be declared DATA_READY and no downstream IMP
(IMP-04/05/06/07/09/11) may treat these inputs as available. This does not reduce parent scope or
acceptance and does not claim any global DEP closure. Parent acceptance remains pending a separate
Command §20.2.10 review/IMP_RECEIPT after the two native review stages.

## 8. How to reproduce

```
cd /srv/hot-data/energy-markets/app
hostname; pwd
sha256sum docs/canonical/PROCUREMENT_RESEARCH_CANONICAL_ENGINEERING_SPEC_v1_1.md \
          operations/receipts/IMP-01-IMP_RECEIPT.json
/opt/node/bin/node operations/audit/IMP-03/verify.mjs
```

Expected: `hostname=brunode`, `pwd=/srv/hot-data/energy-markets/app`, both hashes match the expected
values, and `verify.mjs` exits `0` (contract/provenance/namespace/negative checks pass) while
reporting the real-data insufficiency separately. Full stdout/stderr/exit code:
`operations/audit/IMP-03/verify-run.txt`.
