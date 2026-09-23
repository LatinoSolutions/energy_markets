# Economic calculation (IMP-08 / ST-08.3)

Synthetic, reusable calculation support for the procurement economic contract.
Source of truth: `docs/canonical/PROCUREMENT_RESEARCH_CANONICAL_ENGINEERING_SPEC_v1_1.md`
v1.1, §§5.1–5.8, 6.1 and 19.3.1. This module is a **generic calculator**: it
contains no expected-result lookup, no fixture-id dispatch and no oracle import.
It is not a production engine, not real economic evidence and not a research
PASS.

## Public API (`src/economic-calculation/index.mjs`)

### Reference selection — `reference.mjs`

- `proxyReference({ tradesMean, midpointsMean })` → `{ value, sourceLabel, defined, reason }`.
  Implements §5.2: `0.75·T + 0.25·M` when trades and midpoints exist; `T` with
  trades only; `M` with midpoints only; `missing` (never zero) otherwise.
- `selectDailyReference({ officialRows, proxy })` → `{ value, source, providerTimestamp, defined, reason }`.
  Implements §5.3/§5.4: only finite values with parseable provider timestamps
  and non-invalid/non-unknown supplied validity are eligible. A valid official
  row has priority and, among official corrections, the latest provider
  timestamp wins; otherwise the derived proxy; otherwise missing. Explicit
  invalid/unknown candidates remain visible in `excludedOfficialRows`; an
  explicitly present `declaredValidity: null` is unknown, while only an absent
  validity field uses the legacy synthetic compatibility path.

### Benchmark, windows and consumability — `benchmark.mjs`

- `benchmarkB({ references, expectedDates })` → `{ B, count, sum, coverage, defined, reason }`.
  §5.3: equal daily weight, missing dates excluded from the denominator but
  counted in coverage, never zero-filled.
- `selectBenchmarkReferences({ rows, product, windowStart, windowEnd,
  requireAccessible })` → a filtered and date-deduplicated reference set.
  Product and accessibility filters are exact; the date window is `[start,end)`.
  Equal duplicate values on one trading date collapse to one row. Conflicting
  daily duplicates are explicitly rejected.
- `benchmarkBFromRows({ rows, product, windowStart, windowEnd, expectedDates,
  requireAccessible })` → the public captured-row pipeline into `benchmarkB`.
- `isWithinWindow(timestamp, windowStart, windowEnd)` → boolean. Start
  included, end excluded.
- `isWithinFallbackWindow(localTime, { center, radiusMinutes })` → boolean.
  §5.2 deterministic fallback `|t − 17:15| ≤ 60 min`, bounds inclusive.
- `isDecisionConsumable({ evaluationViewAvailable, effectiveAvailabilityDemonstrated })`.
  §5.2/§6.1: published/available to the evaluation view is not the same as
  consumable by the policy at the decision boundary.
- `classifyOfficialValidity({ declaredValidity })`. §5.4: the reported `0.01`
  guard is an audit case, not a canonical rejection rule; unknown validity is
  flagged and excluded, never silently zeroed.

### B / H / V and units — `bhv.mjs`

- `computeV({ B, BUnit, H, HUnit })` → `{ V, defined, sign, reason }`. §5.5:
  `V = B − H` only with finite values in the same compatible unit; no implicit
  conversion. `V = 0` is neutral.
- `computeAllInH({ base, unit, costs, costsComplete })` → `{ H, unit, defined,
  available, rejected, reason }`. `costsComplete: true` is required to make a
  cost list admissible, including an explicit known-zero list. Every attributable
  cost enters exactly once; an unknown, malformed, missing or non-finite cost
  leaves `H` unavailable, never `0` or `NaN`.
- `computeTotalEur({ V, VUnit, volume, volumeUnit })` → `{ totalEur, defined, reason }`.
  Total EUR requires a compatible MWh volume; MW is never assumed to be MWh.
- `classifyCoverage({ coverage })` → `{ coverage, validResearchValue, reason }`.
  Incomplete coverage is reported separately and is not valid research
  evidence, even when the arithmetic `V` is defined.

### Scoring and research verdict — `scoring.mjs`

- `scoreQuarterly(Vq)` → the exact §5.6 quantities: `n_+`, `n_-`, `n_nonzero`,
  `n_total`, `n_neutral`, `p`, `l`, `G`, `A`, `mu`, `R`, `C`, `sigmaDown`,
  `sortino`, `lossRms`, `kappa`, `screenPass`, `defined`, `undefinedReason`.
  Downside denominator is `n − 1`; target `0`; no epsilon, no annualization;
  `C` is diagnostic only.
- `minimumEvidence({ mission, quartersCompleted, calendarYearsCovered, monthsCompleted })`.
  §5.7: Quarterly `≥8` quarters and `≥2` calendar years; Monthly `≥24` months.
- `quarterlyResearchVerdict({ scoring, evidence, dataQuality })` → `{ verdict, reason }`.
  HOLD for undefined/non-interpretable scoring or insufficient evidence; FAIL
  for sufficient interpretable evidence that misses the strict screen; PASS
  only when the predeclared criteria and mission-bound Quarterly evidence
  (`mission: "Quarterly"`, at least 8 completed quarters and 2 calendar years,
  reconciled one-for-one with `scoring.nTotal`) are met **and** the inputs are
  admissible. Monthly evidence cannot satisfy the Quarterly gate, and mixed product populations are rejected. §5.8: incomplete
  coverage, a provisional benchmark and invalid
  data are never compensated by a high score. `dataQuality` is the explicit
  admissibility channel — `{ coverage: "full", benchmarkProvisional: false }` —
  and `scoring.invalidCount > 0` yields INVALID. Omitting `dataQuality` (or
  declaring anything other than full coverage and a non-provisional benchmark)
  cannot produce PASS; it yields HOLD. This is an input-admissibility gate, not
  a new research threshold or governor.
- `monthlyDiagnostics({ Vm, monthsCompleted })`. Monthly never imports the
  Quarterly Sortino screen; it reports its own economic criterion and evidence
  minimum and claims no PASS. Its `researchVerdict` is HOLD as an unconditional
  **scope limitation** of the synthetic calculation (no real run is claimed),
  and its `researchVerdictReason` is decided by the Monthly economic criterion
  and evidence minimum — never by the diagnostic Sortino being undefined.
- `cDiagnostic({ C })` → `{ CReported, hardResearchGate, researchPassFromCAlone }`.
  `C` is reported when defined and is never a hard research gate.

## Undefined semantics

Every undefined result carries an explicit reason. Missing, unknown, non-finite
and unit-incompatible inputs are never coerced to `0`, never replaced by a
guessed default and never converted into a PASS. A research verdict is likewise
inadmissible to PASS when coverage is not `full`, the benchmark is provisional,
or the scoring population contains invalid (non-finite or wrong-type) entries.

## Synthetic limits

- `H` is an explicitly supplied synthetic all-in value; no real-ledger `H`
  formula, denominator, fee, calendar permission or source validity is invented.
- Values, dates, timestamps and sources in the tests are synthetic.
- The module does not close IMP-08, DEP-13, P6, the ten-fixture P6 suite or any
  data audit, and produces no authority.
