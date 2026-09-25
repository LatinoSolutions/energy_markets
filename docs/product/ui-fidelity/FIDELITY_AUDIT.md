# UI fidelity audit: product vs. the selected DES-01 mockup

- **Owner request (Bru, 2026-09-24):** the production UI must match the Claude Blind mockup 1:1 at 1440 px. Canonical data and semantic constraints still apply.
- **Golden reference:** `energy-markets-claude-blind-ui`, commit `c35510b`, `design-proposal/index.html`. It was not modified. Its screenshots are copied to `golden/`, plus `09-replay-040-h0-live-mockup.png`, captured from the live mockup at `#/replay?d=40&h=0`.
- **Base:** canonical main `e98ac26`.
- **Viewport:** 1440 px, light mode, headless Chromium from the local Playwright cache.

## How to review

| Folder | Contents |
|---|---|
| `compare/<surface>.png` | Four columns: **BEFORE** · **GOLDEN** · **AFTER served** · **AFTER with test fixtures** |
| `before/` | What `http://100.92.44.106:8788/` served before this change |
| `after/*-served.png` | The same routes served from this branch in the default state, i.e. what the persistent service shows: no backend manifest injected, so every slot is fail-closed |
| `after/*-fixture.png` | The same pages rendered with the **synthetic test fixtures** from `test/operator-interface/fixtures.mjs`, to show how slots fill when bound data exists. These values are test data, not product facts. |

Regenerate the fixture pages with `node docs/product/ui-fidelity/render-fixture-pages.mjs <out-dir>`.

## Visual-diff checklist (BEFORE → AFTER)

### Shell (all surfaces)

| Element | Golden | Before | After |
|---|---|---|---|
| Top banner | Striped dark band | Missing | Same band and geometry. The text states the data regime instead of "synthetic demo". Since BT-05 (P-009, Bru 2026-09-25) it reads "OPERATOR INTERFACE · runs simulated backtests only · no real trading from this UI · unknown stays UNAVAILABLE / NOT CLOSED, never a value" (`src/ui/render.mjs` `renderShellTop`). |
| Tabs | 4 tabs: `1 · navigate / Campaigns & Runs` … `4 · strategy lab / Research`, two lines each | One-line Spanish/English labels, order Replay → Campaigns | Golden order, two-line tabs, same widths and active underline |
| Keyboard 1–4 | Campaigns, Replay, Backtests, Research | Replay, Backtests, Research, Campaigns; set only `#hash`, which does nothing on served routes | Golden order; follows the served route (`/replay` …) |
| Right tools | Semantics key button plus a two-line as-of clock | Button plus a clipped label | Golden button and clock. As-of shows the canonical evaluation as-of on Replay, otherwise `UNAVAILABLE`. |
| Context strip | `CONTEXT` + breadcrumb + right-hand ref | Single sentence | `CONTEXT` + breadcrumb from canonical values (T₀, as-of, working mode) + boundary ref |
| Footer | Keyboard/provenance hint | Missing | Present |
| CSS | Golden `<style>` | Partial re-implementation with different metrics | **The golden `<style>` copied literally**, plus product-only classes |

### Replay / Decision Inspector

| Element | Golden | Before | After |
|---|---|---|---|
| Page body | Full inspector | **Whole page was one red error banner** (`TIMELINE_NOT_VALIDATED`) | Full inspector composition. The error is a compact bar above it, and every slot is explicit (`UNAVAILABLE` / `NOT VALIDATED`). |
| Decision header | Mono meta line, serif h1, lede, decision selector | Missing | Same slots; h1 `Decision at <T₀>`, and T₀ is a single selector because the boundary exposes one decision |
| Run timeline | Card with an SVG strip, T₀, evaluation bar, as-of line, hatched future | Missing | Same card and SVG geometry. Marks are canonical decision/evaluation points, actuations and interventions at their clocks. Without data, a hatched `TIMELINE UNAVAILABLE` band. |
| Four-object chain | ◆ Recommendation (slate) → ▲ Requested action → ■ Execution·fill → knowledge horizon → ● Outcome (ochre hatch) | Flat lists | Same 7-column grid, same card anatomy, glyphs, zone top borders and vertical `EVALUATION · LATER` horizon |
| Human intervention | Not present | Separate list | Slim plum-topped card under the chain (added because the boundary has this object; see remaining differences) |
| Zones | Known at T₀ (slate header, chart, inputs table) · KNOWLEDGE HORIZON · Later · evaluation (hatched ochre) | Stacked lane boxes | Same `.zones` grid 1.45fr / 34px / 1fr and same headers. The hindsight toggle works: it reveals evaluation points after T₀ on the right half only. |
| T₀ chart | 760×250 price chart, sealed right half | Missing | Same frame, axes, horizon, "Sealed: after T₀" and toggle. The left half shows a `NO CANONICAL SERIES` hatch because the boundary exposes no price series. |
| Inputs table | Input · Value at T₀ · Observed · Age · State | Chip list | Same 4-column table over the 13 §26.2 exposure sections: section · value/reason · provenance · state |
| Evaluation panel | Metrics, evidence note | List | Same metric block, point rows, `NOT CLOSED` rows for pending revisions, evidence note |

### Backtests / Economic Comparison

| Element | Golden | Before | After |
|---|---|---|---|
| Header | Meta, serif h1, lede, arm legend | h2 + four chip lines | Same slots; arms legend only from canonical rows, otherwise `UNKNOWN` |
| Economic measures | Table: Arm · n · B · H · V · ΔV · interval · status | Missing | Same table. Canonical rows sit in their measure column with provenance. With no producer, the row reads `B / H / V / ΔV UNAVAILABLE` and every cell is `NO ESTIMATE`. |
| Paired effect | Wide 800×330 chart | Missing | Same card and frame, hatched `NO ESTIMATE`, with the backend reason |
| Method & integrity | Check list plus evidence ≠ authority note | Missing | Same card; checks are `Unknown` / `Not exposed` with the backend reason, never "Pass" |
| Bottom row | Two per-arm distributions + across-campaigns forest plot | Missing | Same three cards (A0, A1, Across campaigns) with `NO ESTIMATE` frames |

### Research / Strategy Lab

| Element | Golden | Before | After |
|---|---|---|---|
| Layout | 300 px candidate stack + main | Flat list | Same split |
| Candidate stack | Stage, name, readiness chip, EVIDENCE count, Authority chip | One line per strategy | Same card rows for S1–S5 and Z |
| Hypothesis | Serif 17 px hypothesis + success criteria | Missing | Same card and serif. The text states that no canonical hypothesis is exposed; one criteria row reads `Unknown`. |
| Authority | Double-rule `AUTHORITY` box | Missing | Same box; "No adoption decision is exposed", no invented decision owner |
| Readiness & integrity | Check card | Missing | Same card; canonical readiness record, or `Unknown` with the reason |
| Version lineage | Graph card | Chip line | Same card and height; hatched `LINEAGE UNAVAILABLE` frame, no invented nodes |
| Evidence & receipts | Receipts table | Chip line | Same table header; `UNAVAILABLE` row with the backend reason |

### Campaigns & Runs

| Element | Golden | Before | After |
|---|---|---|---|
| Left rail | Campaign list with selected item | Missing | Same rail; canonical campaigns, or an explicit "No canonical campaign exposed" item |
| Header | Meta, serif h1, lede, CAMPAIGN READINESS | h2 | Same; readiness `Not exposed by backend` |
| Readiness gates / What we don't know | Two cards side by side | Missing | Same two cards. The unknowns are the boundary's own `UNAVAILABLE` items, each with its reason and what it blocks. |
| Runs table | 7 columns with segmented bar and drill-downs | Empty-state box | Same 7 columns; bound runs carry drill-downs to Replay / Backtest / Research, unbound runs show a hatched bar |
| Receipts | Receipt ledger | Chip line | Same ledger card; `UNAVAILABLE` rows |

### Semantics key and provenance drawer

- **Key:** same card, 9 rows and 150 px swatch column as golden.
- **Drawer:** same right drawer, serif title, big mono value, dl rows, framed clock box and evidence note. Fields are record, revision, sha256, clock and clock kind, which is what the boundary binds.

## Remaining differences at 1440 px, and why

1. **Numbers, series and ids.** The golden shows synthetic prices, curves, histograms, forest plots, lineage nodes and `SYN-` ids. The product draws only values bound to the verified backend manifest (§26.5). The served service has no manifest injected, so those slots show `NO ESTIMATE` / `UNAVAILABLE` hatches in the same frames. This is a data-availability difference, not a layout one.
2. **Invented semantics removed.** The golden's definitions of B/H/V/ΔV, its T₀ + 84 evaluation window, 90 % interval, "Procurement committee", hypothesis text, gate names and decision owners do not appear. These were mockup placeholders (DESIGN_RATIONALE "Simplifications and placeholders") and are not canonical.
3. **Error bar on Replay (served state).** Without a validated timeline, Replay is ERROR by contract (`TIMELINE_NOT_VALIDATED`). The error stays visible as a compact bar above the composition. The golden has no such state.
4. **Human intervention card.** The golden has no slot for it, but the boundary exposes `HUMAN_INTERVENTION` as its own object, and it must never be listed as a fill (§26.3). It is a slim card under the chain in the same visual grammar.
5. **Requested action.** The boundary exposes the recommendation and actuations, but no separate requested-order object. The card keeps its slot and shows `UNKNOWN · Not exposed`.
6. **Card heights.** Where the golden had several rows (six readiness gates, seven method checks, seven receipts), the product has the rows the boundary gives (usually one explicit unknown). Cards are shorter; widths, order and anatomy match.
7. **Mixed language.** Chrome text is English, as in the mockup. Reasons produced by the backend view models stay in their original Spanish; the UI does not rewrite backend text.
8. **Narrow widths.** The body has `min-width: 1280px`, so below that width the page scrolls horizontally instead of reflowing. DES-01 defined no narrow layout.

## Contract checks kept

- `src/ui/view-models.mjs` and `src/ui/binding.mjs` are unchanged: same binding, the same fail-closed rules and the same UNAVAILABLE / ERROR states.
- The UI routes are still GET/HEAD only, with the same routes and health payload. Since BT-05 (owner request 25-sep-2026) the only write is `POST /api/backtest-jobs`, which launches a simulated backtest in the backend (`src/backtest-jobs/http.mjs`); it answers 503 when no job runner is configured.
- Every attribute contract from UI-01/UI-02/UI-03 is preserved: `data-view-scope`, `data-event-class`, `data-real`, `data-arm` / `data-measure` only when backed by the record, provenance attributes, drill-downs, `data-status`.
- The new structural tests (`test/ui/ui-fidelity.test.mjs`) pin the golden composition. They also check that no mockup demo fact leaks (`SYN-`, `Cal-27`, `Tranche-trigger`, committee, the 84-day rule, 90 %…).
