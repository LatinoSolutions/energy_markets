# IMP-08 / ST-08.3 — independently frozen regression expectations

Packet `WP-IMP-08-ST-3-v1.1` · Subtask `ST-08.3` · Parent `IMP-08`.

These expectations are recorded before implementation changes. They are derived
from the Command reproduction in [LAT-176](/LAT/issues/LAT-176#document-final-acceptance-evidence)
and the frozen ST-08.1 oracle. They are synthetic only; they do not assert a
real-market validity rule, a real ledger H formula, or research authority.

## Corrective regressions

1. **Daily duplicate rows.** Captured rows for the exact requested product and
   date window, `[Jan-05:100, Jan-05:100, Jan-06:110]`, with accessible rows,
   must be deduplicated by trading date before equal weighting. The public
   pipeline must return `B=105`, `count=2`, `coverage=2/2`, `sum=210`, or an
   explicit duplicate-input rejection. It must never return
   `103.33333333333333`, count `3`, or coverage `3/2`. A conflicting duplicate
   value for one date must be explicitly rejected, never silently double
   weighted.

2. **Exact row filters.** Rows for another product, outside the inclusive-start
   / exclusive-end date window, or without explicit accessibility must not enter
   the selected daily set. The regression uses the actual captured-row
   selection path rather than a precomputed mean.

3. **Official validity and timestamps.** An official value `999` with
   `providerTimestamp='not-a-timestamp'` must be excluded, allowing valid `102`
   at `2026-01-06T18:00:00Z` to win. Explicit invalid or unknown validity must
   also be excluded, including an explicitly present `declaredValidity: null`
   encoding unknown validity; only an absent validity field may use the legacy
   compatibility path. A `0.01` official value declared valid under an explicit
   synthetic fixture assumption remains eligible. Valid corrections select the
   latest valid provider timestamp and preserve the derived fallback when no
   usable official exists.

4. **Cost completeness and types.** `computeAllInH({base:100,
   unit:'EUR/MWh',costs:[false]})` and `costs:[null]` must return an explicit
   unavailable/rejected result with a reason, never `NaN`, a finite success, or
   an uncaught exception. Omitted, non-array, empty, malformed, nonfinite and
   unknown cost inputs cannot become a zero-cost list. An explicitly declared
   complete known-zero list remains finite at `H=100`.

5. **Mission-bound evidence.** `quarterlyResearchVerdict` with
   `scoreQuarterly([4,-1])` and
   `minimumEvidence({mission:'Monthly',monthsCompleted:24})` must not PASS.
   Quarterly sufficiency must be derived from Quarterly mission identity and
   `quartersCompleted >= 8` plus `calendarYearsCovered >= 2`; a generic
   `minimumEvidenceMet: true` flag, Monthly evidence, malformed counts, or
   mixed/unsupported population identity cannot confer sufficiency. A positive
   eight-quarter fixture contains eight finite values (neutral zero campaigns
   remain visible), while the same two scored values paired with eight declared
   quarters must HOLD because `scoring.nTotal` does not reconcile with the
   completed-quarter count.

6. **Receipt run identity.** The final receipt's current `workerRoute.runId`,
   `workerModelRoute` text and `receiptMeta.writtenByRun` must identify the
   same corrective run. The initial implementation run remains recorded in
   explicit run history and is not silently overwritten. A mismatched route
   identity must fail delivery verification. R9 must call the same shared
   validator as delivery verification and reject cloned receipts with each of
   the three cross-field mismatches independently.

## Inherited invariants rerun after correction

- All 35 frozen fixtures and C01–C12 remain mapped to executable tests.
- Proxy 101, daily B 105, official replacement B 106, correction B 106.5,
  missing-date coverage, window boundaries, fallback bounds, B/H/V signs,
  quarterly formulas, Monthly separation and explicit undefined reasons remain
  unchanged.
- The accepted oracle, ST-08.1 receipt, ST-08.2 receipt and pinned protected
  hashes remain byte-identical.
- No real inputs, real ledger formula, production authority, IMP_RECEIPT or
  research PASS is claimed by this child.
