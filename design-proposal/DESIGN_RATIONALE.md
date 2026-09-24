# Energy Markets — Claude blind design proposal (DES-01)

**Status:** design-only proposal. Not integrated, not deployed, not accepted.
**Source of the brief:** `BRIEF.md` (repo root). No other Energy Markets UI, mockup, reference or GPT proposal was opened. The only inputs were `BRIEF.md` and `PLAN_STATUS.md`.
**Data:** everything in the prototype is **synthetic**. Every id starts with `SYN-`. A striped banner on every screen says so.

## How to review it

1. Open `design-proposal/index.html` in any modern browser. It is one file, works offline, with no build step and no external fonts or libraries.
2. Use the four tabs, or keys `1`–`4`. `?` opens the **Semantics key** (the visual grammar on one card). Click any value with a dotted underline to see its **provenance**.
3. Or look at the screenshots in `design-proposal/screenshots/` (1440 px wide, taken with the local headless Chromium):

| File | What it shows |
|---|---|
| `01-campaigns.png` | Campaigns & Runs: readiness gates, explicit unknowns, runs, receipts |
| `02-replay-decision-031.png` | Replay of a BUY whose requested action differs from the recommendation, with partial fill, stale + unknown inputs, and a closed evaluation |
| `03-backtests.png` | Economic comparison: B/H/V/ΔV table, paired cumulative effect, distributions, campaign effects, method & integrity |
| `04-research.png` | Strategy Lab: candidate stack, hypothesis and criteria, authority box, integrity, version lineage, evidence receipts |
| `05-replay-040-open-hindsight-on.png` | Decision whose evaluation is **not closed**, with the hindsight overlay turned on. The overlay stops at the data as-of date. |
| `06-replay-012-hold.png` | HOLD recommendation: no order and no fill, shown as explicit "not applicable" objects |
| `07-semantics-key.png` | The visual grammar legend |
| `08-provenance-drawer.png` | Provenance drawer with two clocks (valid time and recorded time) |

Deep links work (for example `index.html#/replay?d=40&h=1`), so a reviewer can point at an exact state.

## Design stance

The brief says Energy Markets is **not a trading terminal and not a generic admin dashboard**. So the prototype avoids both:

- **No terminal look.** It has no dark neon, no tickers and no blinking P&L. The pace of the tool is weekly decisions and 12-week evaluations, not milliseconds.
- **No admin look.** It has no grid of KPI tiles and no "everything is green" summary. Each screen starts with the research question in plain words ("Does the tranche trigger buy cheaper than the calendar?"), then shows the evidence.
- **What it looks like instead: a research ledger / lab notebook.** Warm paper background, ink text, a serif for headings and the hypothesis, a monospace font for ids, timestamps and prices. It should feel like reading a careful audit file, because that is what the user is doing.

The design rests on one idea: **the visual system encodes time and certainty, not decoration.** Color and texture are spent almost entirely on telling the reader *when* something was known and *how sure* it is.

## The visual grammar (shared by all four workspaces)

### 1. Three temporal zones (never mixed)

| Zone | Treatment | Meaning |
|---|---|---|
| **T₀ · decision-time** | Slate blue `#23476b`, solid, clean surface | What the system knew at the decision instant |
| **Execution** | Neutral ink `#3d4148` | After T₀ but before evaluation: requested action and fills |
| **Later · evaluation** | Ochre `#8a4b0f` on **hatched** paper | Hindsight. Known only after the evaluation window. |

The hatch is intentional. Evaluation content always sits on a textured surface, so it cannot pass for decision-time content even in grayscale, in print, or for color-blind readers. A dashed ochre **knowledge horizon** line separates the zones wherever both appear.

### 2. Epistemic states: absence is always explicit

| State | Treatment | Rule |
|---|---|---|
| `UNKNOWN` | Plum text on a 45° plum hatch | Never blank, never `0`, never a guess |
| `NOT CLOSED` | Dashed outline | The value exists in principle but is not final. No provisional number is shown in its place. |
| `NOT RUN` | Plum hatch segment in progress bars | Decisions a run never reached. Counted separately from "open". |
| `WITHHELD` | Plum monospace | A measure the backend refuses to publish (for example an incomplete arm) |
| `NO ESTIMATE` | Hatched band in charts | A chart row with no data is drawn as a band, never as a point at zero |
| Pass / Fail / Warn | Green ✓ / red ✕ / amber ! | Always icon + word + color, never color alone |

### 3. Evidence ≠ authority

- **Evidence** (receipts, backtest results, integrity checks, provenance) uses a thin outlined `EVIDENCE` tag. Evidence **never** uses the word "approved" and never carries a checkmark of adoption.
- **Authority** is the only element with a **double-rule border** and an `AUTHORITY` seal. It names a decision owner (a synthetic role in the mockup) and a recorded act. Anything "approved" appears only there.
- In the Research candidate stack, **evidence count** and **authority status** are separate columns. The screen also says plainly that seven receipts do not change "Not requested".

### 4. Four separate objects

Recommendation ◆, Requested action ▲, Execution/fill ■ and Outcome ● are always **four cards**, each with its own glyph, id, timestamp and receipt. Arrows between them mean *sequence, not identity*. When two objects disagree (for example 4.0 MW recommended vs 3.0 MW requested), an amber **"Differs from recommendation"** note states the gap and the reason recorded, and says which facts were unknown at T₀. When an object does not exist (HOLD → no order), its card is still drawn and says **"Not applicable"**, so absence is recorded, not inferred.

### 5. Provenance is one click away, with two clocks

Every value with a dotted underline opens a provenance drawer showing source, receipt, hash and, kept visually separate, **valid time** (when it was true in the world) and **recorded time** (when the system learned it). This bitemporal split is what makes "what was known at decision time" checkable instead of asserted.

## Workspace rationale

### 1 · Campaigns & Runs: "where are we, and what don't we know?"
- The left rail lists campaigns with **backend-reported** readiness. The UI states that it does not compute or upgrade readiness.
- **Readiness gates** and **What we don't know** sit side by side with equal weight. Unknowns have an id, a reason, what they block, a date, and a blocking or non-blocking flag.
- The runs table uses one segmented bar per run: **closed / not closed / not run**. A halted run is visibly shorter, with its missing part hatched as unknown, not zero.
- Each run has drill-down buttons into Replay, Backtest and Research. A receipts ledger closes the page.

### 2 · Replay / Decision Inspector: "what was known, what was done, how did it turn out?"
- A run timeline shows all 46 decisions, the selected decision's **evaluation window** (ochre bar) and the **data as-of** line, with the future hatched as "nothing known".
- The four-object chain crosses a vertical **EVALUATION · LATER** line before the Outcome card.
- Below the chain, a two-panel split: **Known at T₀** (price chart, input table with observed-at time, age at T₀, and fresh/stale/unknown state) | knowledge horizon | **Later · evaluation**.
- The price chart's post-T₀ half is **sealed by default**. The "Hindsight overlay" toggle draws later prices only right of the horizon, in the evaluation color. Where the evaluation window runs past the data as-of date, the overlay stops and the rest says **NOT YET**, so the chart never shows prices the system does not have.
- For an open evaluation, the outcome panel says "Closes 2026-11-09 · no provisional outcome is displayed" instead of showing an interim mark-to-market.
- Simulated fills carry a `SIMULATED · fill model` tag, so a backtest fill is never mistaken for a real execution.

### 3 · Backtests / Economic Comparison: "is the difference real, and can we trust the method?"
- The page starts with a **B / H / V / ΔV table**: one row per arm, with n closed / total, a 90 % paired interval and a status. An incomplete arm shows `WITHHELD` at campaign level; its paired-subset figures are shown smaller and labelled "subset".
- **Paired effect:** cumulative ΔV by decision. Open decisions are a hatched **NOT CLOSED · excluded, not imputed** region. The span where Arm B never ran is hatched as unknown.
- **Distributions:** H − B per decision as **small multiples**, one histogram per arm on identical axes rather than overlaid, with the mean marked.
- **Across campaigns:** a forest plot. Closed estimates are filled diamonds, interim ones hollow and dashed, and a campaign with insufficient data gets a hatched **NO ESTIMATE** band.
- **Method & integrity** sits beside the charts, not in a footnote: pairing, look-ahead guard, simulated execution, closure, arm completeness, tail metric and input quality. It ends with the evidence ≠ authority note that links to Research.

### 4 · Research / Strategy Lab: "what do we believe, why, and who decides?"
- The **candidate stack** shows, per candidate, stage, readiness, evidence count and authority as separate signals.
- The **hypothesis** is set in serif as a falsifiable sentence, **pre-registered** with a date, and each success criterion has its own state (met / not met yet / unknown).
- The **Authority** box is double-ruled and reads "No adoption decision exists". The current policy's approval is cited with its receipt.
- **Readiness & integrity** checklist; a **version lineage** graph (versions → experiments, with the branch under test hatched as blocked); and an **evidence & receipts** table that links back into Backtests, Replay and Campaigns.

## How each semantic constraint in BRIEF.md is met

| BRIEF.md "Semantic constraints" | Where and how |
|---|---|
| Decision-time and later evaluation never visually conflated | Three-zone color + hatch system; knowledge horizon line in the chain, the panels and the chart; hindsight sealed by default, drawn only right of T₀ and never beyond the data as-of date |
| Evidence is not authority | `EVIDENCE` tag vs double-ruled `AUTHORITY` box; separate columns in the stack; explicit copy on Backtests, Replay and the provenance drawer |
| Recommendation, requested action, execution/fill, economic outcome are separate | Four cards with their own glyph, id, time and receipt; a deviation note when they differ; "Not applicable" cards when an object is absent |
| Missing / unknown / not-yet-closed explicit and fail-closed | `UNKNOWN`, `NOT CLOSED`, `NOT RUN`, `WITHHELD`, `NO ESTIMATE`; no interim outcome shown; open decisions excluded rather than imputed; unknowns register with what each blocks |
| Provenance and timestamps inspectable | Dotted-underline values → drawer with source, receipt, hash, valid time and recorded time; observed-at and age-at-T₀ per input; receipts ledgers |
| Synthetic demo content clearly marked | Permanent striped banner, `SYN-` prefix on every id, "(synthetic role)" on every actor, footer note, and a note in the drawer |

## Typography, color, charts

- **Type:** serif (Iowan / Palatino / Georgia fallback) for page titles, hypothesis and big object values; sans for UI text; monospace for ids, times and numbers, with tabular figures. Only system font stacks, so the file stays standalone.
- **Arm colors:** Baseline blue `#2a78d6`, Arm A orange `#eb6834`, Arm B aqua `#1baf7a`. I checked this set with the dataviz palette validator on the paper surface `#fbfaf7`, all pairs: **all checks pass** (worst CVD ΔE 9.2, worst normal-vision ΔE 24.0). Aqua is below 3:1 contrast, so arms are always direct-labelled and the comparison has a data table (`Show data table`).
- **Reserved colors:** temporal colors (slate, ochre) and status colors (green, red, amber, plum) are never reused as series colors.
- **Chart rules applied:** one y-axis per chart, small multiples instead of overlaid distributions, recessive grid, direct labels, hover tooltips on marks, and a table view for the main series.

## Simplifications and placeholders (none of this is canonical)

Stated here so nobody takes them as system truth:

1. **B / H / V / ΔV definitions are placeholders.** The table header states the working reading (B benchmark price, H achieved hedge price, V = Σ(B − H) × volume, ΔV = V_arm − V_baseline) and a visible "Definitions are mockup placeholders" tag. The canonical definitions belong to the backend method spec, which I did not have. The layout does not depend on them.
2. **Evaluation rule "T₀ + 84 days"** is invented, only to make closed vs open windows concrete.
3. **The 90 % interval** is a normal approximation computed in the mockup's JS, only to have a number. In the real product, intervals come from the backend. The frontend only displays them.
4. **Readiness, gates, integrity checks and unknowns** are hard-coded synthetic states. In the real product the backend owns them. The UI copy says so.
5. **Only three decisions (#012, #031, #040)** are fully modelled in Replay. The others show "detail not modelled". Only campaign SYN-CMP-014 and candidate Tranche-trigger v3.2 are fully drawn.
6. **Actors** ("Procurement desk", "Procurement committee", "Research desk") are synthetic roles, not real people or confirmed governance.
7. **Energy details** (Cal-27 DE Base, 1 MW = 8.76 GWh/year, prices around 86–92 €/MWh) are only there to look plausible. They are not market data.
8. **Screenshot hooks:** `?key=1` opens the key and `?prov=N` opens a provenance drawer on load. They are there only so a headless browser can capture those states.
9. **Light mode only, desktop only.** Designed for 1440 px and checked at that width. There is no dark mode and no layout below about 1280 px.

## Side-by-side comparison checklist (for Bru)

Suggested questions when putting this next to the other proposal:

1. On the Replay screen, can you tell in under five seconds which numbers the decision could see?
2. Is there any place where an interim or hindsight number could be read as a decision-time fact?
3. Are recommendation, order, fill and outcome ever merged into one row or card?
4. Is "unknown" ever rendered as blank, zero, or a green state?
5. Can you find who has authority, and is it visually distinct from the pile of evidence?
6. From any number, how many clicks to its source and timestamp?
7. Does it read like a research tool, rather than a trading terminal or an admin panel?

## Open items (outside DES-01's scope, reported rather than acted on)

- **OPEN_ITEM-1:** canonical definitions of B / H / V / ΔV, the evaluation-window rule and the interval method need to come from the product/method spec before any implementation.
- **OPEN_ITEM-2:** the role that holds adoption authority, and what act records it, is a product/governance question. The mockup uses a synthetic "Procurement committee".
- **OPEN_ITEM-3:** dark mode, narrow layouts and a full accessibility audit (keyboard paths inside charts, screen-reader summaries for SVG) are not covered by this design proposal.
