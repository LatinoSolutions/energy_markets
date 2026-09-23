# IMP-13 — Independent expected-result calculations for the P6 manual fixtures

Parent: `IMP-13` — *Codificar fixtures previamente verificados a mano* (SPEC v1.1.1 §25.1, §25.2.2, §25.2.3).
Source of truth: `docs/canonical/v1_1_1/PROCUREMENT_RESEARCH_CANONICAL_ENGINEERING_SPEC_v1_1_1.md` (v1.1.1, 22-sep-2026).

**Everything below is synthetic.** These are hand-worked expected results for the ten canonical
fixtures of §14.8 and the documentary benchmark/scoring fixtures of §19.3.1. They were prepared
**before** the suite was coded (the §25.2.3 internal order: independent inspection/calculation of the
expected result first, then the test). They are **not** real client data, **not** a production
calculator, **not** economic evidence and **not** a research PASS. No real price, fill, fee,
calendar, permission, threshold or campaign identity is invented here. Correct fixtures do not
certify market edge (§14.8, §19.4).

The expected values are transcribed from §14.8, §14.5, §14.7, §4.3, §5.3, §5.6 and §19.3.1 and are
asserted literally by `test/imp13/manual-fixtures.test.mjs`. The reviewer must recompute by hand:
a worker script alone is not independent.

Frozen conventions applied everywhere:

- Opening obligation conserves: `OpeningObligation = ExecutedVolume + RemainingVolume` (§4.3, §14.5).
- Coverage changes only by **filled quantity**, never by requested quantity (§14.5).
- Execution price is the frozen rule `latest best ask at-or-before the decision frontier + virtual slippage` (§13.6 regla 1; OFICINA.md execution assumption). Slippage is the only KNOWN cost; other fees stay UNKNOWN/excluded, never zero (§13.6 regla 4).
- A missing critical price yields no-fill; no executable price or decision feature is invented (§14.7).
- Residual without a valid predeclared terminal act is `COVERAGE_INCOMPLETE`; no closing fill is fabricated (§14.5).
- A revision never rewrites the historical decision state; the revised evaluation receipt is versioned separately (§14.6, §14.7).
- `V = B − H` in compatible units; `V = 0` is neutral, not success (§5.5, §5.7).
- Undefined ratios stay explicit; no epsilon and no artificial PASS (§5.6, §5.7, §19.3).

---

## Ten canonical P6 fixtures (§14.8)

### F1 — Constant price

Invariant §14.8: *igual cantidad cubierta bajo costes idénticos produce igual gross-price result; toda diferencia se explica por costes aprobados/cobertura.*

Fixture `FX-P6-01-CONSTANT-PRICE`. Flat best ask `40.5` at every frontier; frozen slippage `0.15 EUR/MWh` → execution price `40.5 + 0.15 = 40.65 EUR/MWh` per fill.
Obligation `6 MW`, lot `1 MW`, daily cap `12 MW/day`.

- Run A (3 opportunities `d1,d2,d3`): controller splits `6/3 = 2`, `4/2 = 2`, `2/1 = 2` → three fills of `2 MW`.
  Gross notional `= (2 + 2 + 2) · 40.65 = 6 · 40.65 = 243.9`. Gross-price per unit `= 243.9 / 6 = 40.65`.
- Run B (2 opportunities `d1,d3`): controller splits `6/2 = 3`, `3/1 = 3` → two fills of `3 MW`.
  Gross notional `= (3 + 3) · 40.65 = 6 · 40.65 = 243.9`. Gross-price per unit `= 40.65`.

Same covered quantity `6 MW` and same price → same gross-price result in both runs. The only recorded cost is the approved `cost.slippage.virtual` (counted once per fill); no other cost appears. Expected: both `COVERED`, `executedVolume = 6`, `remainingVolume = 0`, gross notional `243.9`, unit price `40.65`.

### F2 — Ascending price

Invariant §14.8: *se refleja aritméticamente comprar antes/después sin introducir future knowledge.*

Fixture `FX-P6-02-ASCENDING-PRICE`. Best ask per frontier: `d1 = 10`, `d2 = 20`, `d3 = 30` → prices `10.15, 20.15, 30.15`. Obligation `6 MW`, BUY at every opportunity (A0 calendar-only), lot `1 MW`.
Controller splits `2, 2, 2`. Gross notional `= 2·10.15 + 2·20.15 + 2·30.15 = 20.3 + 40.3 + 60.3 = 120.9`. Mean `= 120.9 / 6 = 20.15`.

The frontier `d1` fill uses `10.15`, not the later `20.15/30.15`: no future minimum and no retrospective selection (§13.6 regla 1). Expected prices in chronological order `[10.15, 20.15, 30.15]` and gross notional `120.9`.

### F3 — Descending price

Invariant §14.8: *se refleja aritméticamente WAIT/comprar antes sin hindsight.*

Fixture `FX-P6-03-DESCENDING-PRICE`. Best ask per frontier: `d1 = 30`, `d2 = 20`, `d3 = 10` → prices `30.15, 20.15, 10.15`. Obligation `4 MW`, lot `1 MW`. Arm WAITs on `d1` and BUYs on `d2,d3`.
`d1`: WAIT, remaining `4 MW` unchanged. `d2`: controller `4/2 = 2` → BUY `2` at `20.15`. `d3` (last): controller `min(2, cap) = 2` → BUY `2` at `10.15`.
Gross notional `= 2·20.15 + 2·10.15 = 40.3 + 20.3 = 60.6`; mean `= 60.6 / 4 = 15.15`.

The `d1` WAIT produces no execution row and the fills use only the prices available at their own frontier (no hindsight pick of the earliest, highest price). Expected: `d1` action `WAIT`, prices `[20.15, 10.15]`, gross notional `60.6`, `executedVolume = 4`.

### F4 — WAIT every decision

Invariant §14.8: *remaining persiste; se aplica terminal rule predeclarada o se declara coverage incomplete.*

Fixture `FX-P6-04-WAIT-EVERY`. Obligation `4 MW`, WAIT at every opportunity.
- `FX-P6-04a` no valid terminal act: executed `0`, remaining `4 MW` persists at every step, closure `COVERAGE_INCOMPLETE`; no closing fill fabricated.
- `FX-P6-04b` documented residual amendment (the predeclared closing act): same WAIT path, residual `4 MW` cancelled by a documented amendment (`cancelledVolume = 4 MW`, bound to the obligation, with authority and locator) → `RESIDUAL_CANCELLED`. The amendment is not executed coverage; it is reported separately (§4.3).

### F5 — Overlapping obligations

Invariant §14.8: *un fill/coverage no se cuenta dos veces entre obligaciones.*

Fixture `FX-P6-05-OVERLAPPING`. Fills `F1 = 3 MW`, `F2 = 2 MW`; relation Monthly/Quarterly declared as `OVERLAPPING`.
- Disjoint assignment `OBL-A → {F1}`, `OBL-B → {F2}`: each fill owned once → accepted, two assignments.
- Shared assignment `OBL-A → {F1,F2}`, `OBL-B → {F1}`: `F1` owned by two obligations → rejected with `DUPLICATE_OWNERSHIP`; the fill is never counted twice (§4.3).

### F6 — Missing input / missing price

Invariant §14.8: *no se inventa executable price ni decision feature.*

Fixture `FX-P6-06-MISSING`.
- `FX-P6-06a` no eligible price: obligation `6 MW`, three frontiers with no observation at-or-before them → three no-fill rows, `executionPrice = null`, `executedVolume = 0`, remaining `6 MW`, closure `COVERAGE_INCOMPLETE`, at least one missing-data event. No price is fabricated.
- `FX-P6-06b` missing critical input with no frozen fallback: the arm returns `DATA_BLOCKED` → run availability dimension `DATA_BLOCKED`, no fill, obligation intact (§14.7).

### F7 — Revised data

Invariant §14.8: *decision state sigue histórico y la revised evaluation receipt se versiona por separado.*

Fixture `FX-P6-07-REVISED`. One decision key `G0BQ.REV.reference` with two versions:
- `v1` value `24.35`, published `2026-01-04T10:00:00Z`, consumable `2026-01-04T10:30:00Z`.
- `v2` (revises `v1`) value `25.10`, published `2026-01-06T10:00:00Z`, consumable `2026-01-06T10:30:00Z`, revision effective `2026-01-06T11:00:00Z` (attested receipt).

Frontiers at `10:00Z` on `2026-01-05`, `2026-01-06`, `2026-01-07`.
- `2026-01-05`: only `v1` consumable → decision ledger references `v1` (`24.35`).
- `2026-01-06 10:00Z`: `v2` consumable at `10:30Z`, so it does not yet speak → decision ledger still references `v1`.
- `2026-01-07`: `v2` consumable → decision ledger references `v2` (`25.10`).
- Evaluation view at `2026-01-06T10:45Z` (after `v2` publication, before its receipt-effective instant): `v1` is current, `v2` pending. At `2026-01-07T00:00Z`: `v2` current and `v1` listed as `superseded` by `v2`; `appliedRevisions` includes `v2`.

The historical decision state of `2026-01-05` is unchanged; the revised evaluation is a separate version. The execution ledger prices come from the price observations, not from the revised key, and are not rewritten.

### F8 — Lot / rounding / costs

Invariant §14.8: *total volume y cada cost reconcilian exactamente una vez.*

Fixture `FX-P6-08-LOT-COSTS`. Obligation `5 MW`, lot `1 MW`, daily cap `2 MW/day` (synthetic fixture value, not the client's provisional `12`), three frontiers.
Controller: `d1 = floor(min(5/3, 2)) = floor(1.67) = 1`; `d2 = floor(min(4/2, 2)) = 2`; `d3` (last) `= min(2, 2) = 2`. Fills `1 + 2 + 2 = 5 MW` → `COVERED`.
Each requested quantity is an integer multiple of the lot (`1 MW`). Every recorded cost is the single KNOWN slippage entry, `countedOnce = true`, appearing exactly once per fill; no cost is double-counted. Expected `executedVolume = 5`, `remainingVolume = 0`, `sum(filledQuantity) = 5`, one slippage cost per fill.

### F9 — Official-over-proxy benchmark substitution

Invariant §14.8: *se recalcula/versiona B; execution ledger/H no se reescriben.*

Fixture `FX-P6-09-BENCHMARK-SUBSTITUTION`. Two dates with selected references.
- Prior version: proxy `100` for `d1`, `110` for `d2` → `B = (100 + 110)/2 = 105`.
- Official substitution: official `102` replaces the proxy for `d1`, `d2 = 110` → `B = (102 + 110)/2 = 106`.

The prior `B = 105` is preserved as a separate version. The execution ledger captured from the replay (constant price, `H` from the approved base + costs) is unchanged by the substitution: the benchmark belongs to the evaluation view and never rewrites execution/H (§14.6, §14.7).

### F10 — Neutral / undefined scoring cases

Invariant §14.8: *V = 0, no downside, n < 2 y ratios indefinidos permanecen explícitos, sin epsilon ni artificial PASS.*

Fixture `FX-P6-10-NEUTRAL-UNDEFINED`.
- `V = B − H = 105 − 105 = 0` → sign `neutral`; zero is not a success.
- No downside `[+4, +3]`: `A = R = C` undefined, `σ_down = 0`, `Sortino` undefined (no epsilon denominator).
- `n < 2` `[+4]`: `n − 1 = 0`, `σ_down` and `Sortino` undefined.
- Exact-zero population `[0, 0]`: `n_nonzero = 0`, all ratios undefined, neutrality reported separately.
- With no downside / undefined ratios the research verdict is `HOLD`, never `PASS`.

---

## Benchmark/scoring documentary fixtures (§19.3.1)

These are the synthetic §19.3.1 examples with known arithmetic. Their independent hand calculation is
recorded in `operations/audit/IMP-08/fixture-oracle/independent-calculations.md` (IMP-08, the
producer of the benchmark/scoring calculation). IMP-13 codifies them as part of the same
accounting/scoring suite; they complement the ten P6 invariants and do not replace them (§19.3.1).
Expected values transcribed from §19.3.1:

| Case | Expected |
|---|---|
| trades `100`, midpoints `104` | proxy `0.75·100 + 0.25·104 = 101`; no VWAP added |
| trades only / midpoints only / no source | `100` / `104` / missing (never zero) |
| daily references `100`, `110` | `B = 105` (equal weight per date) |
| proxy `100` replaced by official `102`; second date `110` | `B = 106`; prior `105` preserved |
| official correction `102 → 103`; second date `110` | `B = 106.5`; latest provider timestamp wins |
| missing date later receives official | set, sum, denominator and coverage recomputed |
| windows `1-0-1` / `3-1-3`, fallback `±60 min` | start included, end excluded; `[16:15, 18:15]` inclusive |
| official `0.01` | reported guard recorded; no canonical rejection presumed |
| `V = +4, −1` | `n = 2`, `p = 0.5`, `μ = 1.5`, `R = C = 4`, `σ_down = 1`, `Sortino = 1.5` |
| `V = +3, −1` | `μ = 1`, `R = C = 3`, `Sortino = 1`: does not exceed `>1` strictly |
| `V = +2, −2` | `μ = 0`, `R = C = 1`, `σ_down = 2`, `Sortino = 0` |
| only positives / exact zero / `n<2` / empty group | undefined cases explicit; no epsilon, no artificial PASS |

---

## What these fixtures do NOT do

- They do not use real prices, fills, fees, calendars, permissions or campaign identities.
- They do not implement a production B/H/V/ledger engine; H is the approved base plus KNOWN costs.
- They do not assert that rejecting official `0.01` is correct, nor any market validity.
- They do not produce a research PASS, close DEP-13, close P6 or prove edge.
- They do not close any factual data audit.
