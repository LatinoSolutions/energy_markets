# Energy Markets — Backtests Table Unlock

## Goal
Populate the Backtests economic-comparison surface with every measurement that can be supported by current evidence, without relabelling provisional data as official/canonical and without fabricating fees or settlement data.

## Non-negotiable semantics
- Preserve the existing exploratory Baseline / DIP10 / Hour results and their provenance.
- `BENCHMARK_PROVISIONAL` must remain explicit until an official/authorized settlement source is reconciled.
- Unknown execution fees remain UNKNOWN/excluded; never replace them with zero.
- Do not consume or re-seal OOS merely to fill UI cells.
- Do not silently change strategy logic, execution rules, benchmark methodology, or existing accepted receipts.

## Work

### BT-01 — Campaign-level provisional benchmark producer
Generalize/reuse the accepted IMP-05 benchmark machinery to produce a versioned provisional benchmark B for the already-existing exploratory G0BQ/G0BM campaign windows, with daily coverage, missing dates, source/provenance hashes, and explicit `BENCHMARK_PROVISIONAL` status. Use existing EEX lake data and the research team's accepted EEX-derived reference methodology. No official-equivalence claim.

Acceptance:
- deterministic artifact + manifest/receipt;
- per campaign B and coverage visible;
- exact product/maturity/window mapping;
- tests prove no official/proxy conflation and no fabricated dates.

### BT-02 — Reconcile provisional H/V for existing exploratory arms
Using the existing exploratory execution ledgers, produce arm-level H/V/DeltaV against BT-01 B where evaluable. Preserve the execution assumptions explicitly: best ask + 0.15 EUR/MWh virtual slippage, current fill mode, and fees UNKNOWN/excluded. If a value cannot honestly be computed, emit unavailable/partial status rather than a number.

Acceptance:
- no strategy rerun/tuning required;
- existing decision/fill ledger is not rewritten;
- H carries cost-completeness status;
- V/DeltaV are labelled provisional/partial when fees or benchmark remain unresolved;
- tests cover fee-unknown and incomplete-depth cases.

### BT-03 — Wire Backtests UI to evidence-aware measurement status
Remove the hard-coded all-or-nothing `Canonical B / H / V (IMP-05) = NO ESTIMATE` presentation. Render the backend-produced readiness/measurement record instead: show available provisional values/statuses, show remaining blockers inline, and keep `official/canonical` unavailable wherever evidence is absent.

Acceptance:
- no UI-side economic calculation;
- every shown value comes from a hash-bound backend artifact;
- provisional/partial/official states are visually distinct;
- existing exploratory rows remain unchanged;
- UI tests and full test suite pass.

### BT-04 — Validation and handoff
Run focused + full tests, compare generated values against independent calculations for at least one G0BQ and one G0BM campaign, and produce a concise handoff listing what is now populated and what still requires client evidence (fees / official settlement access if available).
