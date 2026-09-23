# IMP-08 / ST-08.1 — Independent expected-result calculations (synthetic oracle)

Packet: `WP-IMP-08-ST-1-v1.1` · Subtask `ST-08.1` · Parent `IMP-08` · Project `96bbd5b1-94da-4781-8c2b-455fdfb28d1a`
SPEC: `PROCUREMENT_RESEARCH_CANONICAL_ENGINEERING_SPEC_v1_1.md`, v1.1, sha256 `86c4bd4eeb5f9d0ebad94763128b221eb64525a2b7fff1007dab0af88b39cb6c`

**Everything below is synthetic.** These are hand-worked expected results derived from the frozen formulas of §§5.2–5.7 and the fixtures listed in §19.3.1. They are prepared *before* any production implementation, so a later engine cannot generate its own oracle. They are **not** a production calculator, **not** real economic evidence and **not** a research PASS. H is an explicitly supplied synthetic all-in value; no real-ledger H formula, denominator, fee, calendar permission or threshold is invented here.

The machine-checkable twin of this document is `fixtures.json`; `verify.mjs` recomputes each documented arithmetic case and compares it to the literal expected value. The reviewer must additionally recompute by hand, because a worker script alone is not independent.

Frozen conventions applied everywhere:

- `n` is the number of **non-neutral** campaigns (`n_nonzero`); `n_total` and `n_neutral` are reported separately and never substituted.
- Downside denominator is `n − 1`; target `T = 0`; no annualization; no epsilon.
- Quarterly statistical screen is `Sortino > 1` **strict**. `C` is diagnostic only.
- Monthly never inherits the Quarterly Sortino screen.
- Benchmark B uses equal weight per included date; official/proxy/fill stay distinct.
- `V = B − H` in compatible units; unknown fees are never zero; incomplete coverage is reported separately.

---

## C01 — Proxy from trades and midpoints

**FX-C01-PROXY-MIXED.** `T_hat = 100`, `M_hat = 104`.
`R_hat = 0.75·T_hat + 0.25·M_hat = 0.75·100 + 0.25·104 = 75 + 26 = 101`.
No VWAP term is added; tick density does not enter this proxy formula (only the local intradiario counts `n` and `k`). Expected `R_hat = 101`.

## C02 — Single source and missing

- **FX-C02-TRADES-ONLY.** Only trades: `R_hat = T_hat = 100`.
- **FX-C02-MIDPOINTS-ONLY.** Only midpoints: `R_hat = M_hat = 104`.
- **FX-C02-NO-SOURCE.** Strict window empty, fallback empty → branch `missing`. `R_hat = null` with reason "no observations after the permitted fallback". Missing is not zero-filled.

## C03 — Benchmark B, equal daily weight

**FX-C03-EQUAL-WEIGHT.** Dates and selected references: `d1 = 100` (500 ticks), `d2 = 110` (3 ticks).
`|D_t| = 2`; `sum = 100 + 110 = 210`; `B_t = 210 / 2 = 105`.
The 500-tick day and the 3-tick day receive the same weight: `B` is neither tick-weighted nor volume-weighted. Expected `B = 105`.

## C04 — Official replacement of a proxy

**FX-C04-OFFICIAL-REPLACEMENT.** Prior version used proxy `100` for `d1` and `110` for `d2`, giving `B = 105`. An official row `102` for `d1` appears.
`sum = 102 + 110 = 212`; `B = 212 / 2 = 106`.
The official row has priority over the derived proxy; the new evaluation version is `106` while the prior receipt `105` is preserved and not overwritten.

## C05 — Official correction and provider timestamp

**FX-C05-OFFICIAL-CORRECTION.** Two official rows for `d1`: `102` at `2026-01-06T18:00:00Z` and `103` at `2026-01-07T09:30:00Z`. The latest provider timestamp wins → select `103`. `d2 = 110`.
`sum = 103 + 110 = 213`; `B = 213 / 2 = 106.5`.
Expected `B = 106.5`; the earlier `102` version is preserved historically.

## C06 — Missing date later receives an official row

**FX-C06-MISSING-THEN-OFFICIAL.** Expected calendar dates = 2.
Version 1: `d1 = 100`, `d2 = missing` → `|D_t| = 1`, `sum = 100`, `B = 100 / 1 = 100`, coverage `1/2`.
Version 2: `d2` receives official `110` → `|D_t| = 2`, `sum = 210`, `B = 105`, coverage `2/2`.
Set, sum, denominator and coverage all change; version 1 (`B = 100`, coverage `1/2`) is preserved. Expected `B = 105`.

## C07 — Windows, fallback and consumability

**FX-C07-MONTHLY-1-0-1.** Mission month starts `2026-04-01`; window `[2026-03-01T00:00+01:00, 2026-04-01T00:00+02:00)`.
`start ≤ t < end`: `2026-02-28T23:59:59+01:00` excluded; `2026-03-01T00:00:00+01:00` included; `2026-03-31T23:59:59+02:00` included (already CEST after the `2026-03-29` switch); `2026-04-01T00:00:00+02:00` excluded.

**FX-C07-QUARTERLY-3-1-3.** Quarter starts `2026-04-01`; window `[2025-12-01T00:00+01:00, 2026-03-01T00:00+01:00)`. Included months: Dec 2025, Jan 2026, Feb 2026. `2025-11-30` excluded; `2025-12-01T00:00` included; `2026-02-28T23:59:59` included; `2026-03-01T00:00` excluded (the excluded month before the quarter).

**FX-C07-FALLBACK-PM60.** Strict window `17:05–17:15 CE(S)T` had no accessible observations, so the deterministic fallback applies: `{x : |t_x − 17:15| ≤ 60 min} = [16:15, 18:15]` inclusive.
`16:14:59` (60 m 01 s) excluded; `16:15:00` exactly 60 m included; `17:15:00` included; `18:15:00` exactly 60 m included; `18:15:01` excluded. Rows keep the `nearby-60m` / `eex-derived-reference` labels.

**FX-C07-POST-1715-CONSUMABILITY.** A `17:20` row is available to the evaluation view, but effective availability to the policy at the decision boundary is not demonstrated, so under the declared synthetic assumption it is not decision-consumable. Publication/availability ≠ consumability.

## C08 — The reported 0.01 guard (audit case, not a canonical rule)

**FX-C08-OFFICIAL-001-VALID.** Official value `0.01` declared valid under an explicit synthetic fixture assumption (Power contract permitting a negative theoretical price). Treatment: included. The reported guard ("projection rejects 0.01 as placeholder") is recorded as an implementation limitation/audit case; no canonical rejection rule is asserted and no real-market validity is claimed.

**FX-C08-OFFICIAL-001-UNKNOWN.** Same value with validity explicitly unknown. Treatment: flagged and excluded from the valid set until validity is declared; never silently zeroed. Again no canonical rejection and no market-validity assertion.

## C09 — V = +4, −1

**FX-C09-SCORING-POS-NEG.** Values `[+4, −1]`.
`n_+ = 1`, `n_- = 1`, `n = 2`, `p = 1/2`, `l = 1/2`.
`G = 4`, `A = 1`.
`μ = (4 + (−1)) / 2 = 3/2 = 1.5`.
`R = G/A = 4`.
`C = (p/l)·R = 1·4 = 4`; check `μ = l·A·(C−1) = 0.5·1·3 = 1.5` ✓.
`σ_down = √((0² + (−1)²)/(2−1)) = 1`.
`Sortino = μ/σ_down = 1.5/1 = 1.5`.
Auxiliary: `L_rms = √(1²/1) = 1`, `κ = L_rms/A = 1`, `σ_down = A·κ·√(n_-/(n−1)) = 1·1·1 = 1` ✓.
Strict screen `1.5 > 1` → arithmetic screen true. Research verdict HOLD: two campaigns do not satisfy the ≥8-quarter / ≥2-calendar-year minimum.

**FX-C09-NEUTRAL-ADDITION.** Values `[+4, −1, 0]`. The neutral zero contributes 0 to the sum and is excluded from `n`.
`n_nonzero = 2`, `n_neutral = 1`, `n_total = 3`; `μ = 3/2 = 1.5`; `σ_down = 1`; `Sortino = 1.5`. Identical arithmetic to `+4/−1`; `n` is never replaced by `n_total = 3`.

## C10 — V = +3, −1

**FX-C10-SCORING-SORTINO-1.** `G = 3`, `A = 1`, `μ = (3−1)/2 = 1`, `R = 3`, `C = 3`, `σ_down = 1`, `Sortino = 1/1 = 1`.
Strict comparison `1 > 1` is **false** → arithmetic screen false. Research verdict HOLD (evidence below minimum); this is not presented as a research FAIL.

## C11 — V = +2, −2

**FX-C11-SCORING-ZERO-MEAN.** `G = 2`, `A = 2`, `μ = (2−2)/2 = 0`, `R = 1`, `C = 1`, `σ_down = √((0²+(−2)²)/(2−1)) = 2`, `Sortino = 0/2 = 0`.
Screen false; economic criterion `mean(V_q) > 0` also false. Research verdict HOLD.

## C12 — Degenerate and neutral cases

**FX-C12-ONLY-POSITIVES.** `[+4, +3]`. `G = 3.5`, `A` undefined (no losers), `μ = 3.5`, `σ_down = √(0/1) = 0`, `Sortino = μ/0` undefined. `R = G/A`, `C = pG/(lA)` undefined. Quarterly only-positive → HOLD; no epsilon or artificial denominator.

**FX-C12-EXACT-ZERO-ONLY.** `[0, 0]`. `n_+ = n_- = 0`, `n_nonzero = 0`, `n_neutral = 2`, `n_total = 2`. `p, l, G, A, μ, R, C, σ_down, Sortino` all undefined. Neutrality reported separately; `V = 0` is not success.

**FX-C12-N-LT-2.** `[+4]`. `n = 1 < 2`, so `n − 1 = 0` and `σ_down` is unusable → `Sortino` undefined. `G = 4`, `μ = 4`, `A/R/C` undefined. Declared insufficient case; no minimum campaign count invented.

**FX-C12-EMPTY-POPULATION.** `[]`. `n = 0`, everything undefined. HOLD; nothing fabricated.

**FX-C12-EMPTY-WINNER-GROUP.** `[−1, −2]`. `A = (1+2)/2 = 1.5`, `μ = (−1−2)/2 = −1.5`, `σ_down = √((1²+2²)/(2−1)) = √5 = 2.23606797749979`, `Sortino = −1.5/√5 = −0.6708203932499369`. `G, R, C` undefined (winner group empty). Screen false.

**FX-MONTHLY-NO-SORTINO-IMPORT.** Monthly `[+2, −1]`: `G = 2`, `A = 1`, `μ = 0.5`, `R = 2`, `C = 2`, `σ_down = 1`, `Sortino = 0.5`. Monthly does **not** import the Quarterly strict screen and does not HOLD merely for this non-applicable ratio; it is evaluated by its own `mean(V_m) > 0` contract and evidence minimum. No PASS claimed.

**FX-MONTHLY-ONLY-POSITIVE-NO-HOLD.** Monthly `[+4, +3]`: `Sortino` undefined, but `quarterlySortinoScreenApplicable = false`; the undefined ratio is not imported as a Monthly hold reason and no PASS is claimed.

**FX-EVIDENCE-TWO-CAMPAIGNS.** `[+4, −1]` arithmetic is correct, but `2 < 8` quarters and `1 < 2` calendar years → minimum evidence not met, `researchPassClaimed = false`.

## B / H / V

- **FX-BHV-POSITIVE.** `B = 105`, `H = 100` EUR/MWh (synthetic all-in, full coverage) → `V = 105 − 100 = +5` EUR/MWh.
- **FX-BHV-NEGATIVE.** `B = 100`, `H = 105` → `V = −5` EUR/MWh.
- **FX-BHV-ZERO.** `B = H = 105` → `V = 0` neutral.
- **FX-BHV-UNITS-INCOMPATIBLE.** `B` in EUR/MWh, `H` in EUR (total) → `V` undefined; no unit conversion invented.
- **FX-BHV-TOTAL-EUR-NO-MWH.** `V = 5` EUR/MWh, volume `10 MW` → total EUR undefined; no MW→MWh assumption.
- **FX-BHV-MISSING-FEE.** A fee is unknown → `H` undefined, never `0`; `V` undefined.
- **FX-BHV-INCOMPLETE-COVERAGE.** `V = 105 − 100 = 5` arithmetically, but coverage is incomplete → `validResearchValue = false`; incomplete coverage reported separately.
- **FX-BHV-C-DIAGNOSTIC.** `C = 4` is diagnostic only; `hardResearchGate = false`, `researchPassFromCAlone = false`.
- **FX-BHV-UNDEFINED-RATIO-NO-PASS.** Only-positive sample → `Sortino` undefined → HOLD, never PASS.

---

## What these fixtures do NOT do

- They do not implement the production B/H/V calculation or scoring engine (that is the remaining premium phase).
- They do not use real prices, fills, fees, calendars or permissions; missing real inputs stay outside this synthetic phase.
- They do not assert that rejecting official `0.01` is correct, nor any real-market validity.
- They do not close IMP-08, DEP-13, P6, IMP-13's ten-fixture suite or any factual data audit.
- They do not produce a research PASS or any authority.
