# Energy Markets — Research / Backtesting delivery contract

Version: 2026-09-28/pipeline-v2. Authority: Bru's decisions in the Energy Markets conversation on 2026-09-28, including approval to implement the discovered backtesting integration and address immediate blockers. This document is an assistant-authored consolidation, not a verbatim user quotation.

## Frozen scientific and product scope

One hypothesis definition, H-S1-01 — Session-Anchored Rolling Reference (Strategy S1), applies separately to Gas Monthly, Gas Quarterly, Power Monthly and Power Quarterly. Each mission keeps its own obligation, configuration, data, campaign ledger, calibration and evidence. Support for all four is not proof of success in all four. A missing dataset/freeze or inconclusive result stays explicitly unavailable/inconclusive in that mission.

Product comparison: CLIENT / BENCHMARK / canonical HYPOTHESES. One BENCHMARK concept, with campaign-specific numerical reference and official/provisional/source/version metadata. CLIENT is evidence-based; unknown client costs/sizing are not reconstructed from its purchase time. CONTROL is the experiment's no-hypothesis counterpart, not CLIENT and not BENCHMARK. Legacy aliases A0/A1/BASELINE/ARM_A/B and legacy DIP10/HOUR evidence remain historical technical provenance only where needed, not primary product identities.

Method: CONTROL ↔ H-S1-01, with the same sizing/execution policy within each mission. Only signal/timing changes. tau and N are configurable under a bounded predeclared search; 11:00/N10 are legacy settings, not universal truths. Same policy does not mean identical evolved procurement states after WAIT. A study jointly conditioned on tau, N and the signal does not isolate a pure hour-of-day effect; report what the actual ablation tests. Future sizing/execution optimizations need separate hypotheses/ladder steps and are not introduced here.

## Work ownership and delivery order

- SEM-1: accepted semantic contract.
- HYP-1: four-mission scientific definition, causal signal/configuration contract and small tests. Not a real backtest or winner selection.
- FIX-09: parallel repair of lifecycle-sensitive plan tests and temporary-file test isolation; full safety intent retained. Independent of new research logic.
- FIX-07: canonical identity/metadata and source-bound historical compatibility, after HYP-1 and test repair. Active operative revision is the task.md referenced in its current plan row.
- BT-08: executable H-S1-01 Development integration through the existing EM job path; real-input preflight, four-mission adapters, shared-controller ablation, source-bound economic output/receipts and HTTP/MCP coverage.
- UI-08: consumes the accepted identity/execution contract, updates Scope → Hypotheses → Results, wires the single run control and verifies the served version. Active operative revision is the task.md referenced in its current plan row.

The main delivery chain is SEM-1 → HYP-1 → FIX-07 → BT-08 → UI-08. FIX-09 repairs tests in parallel before FIX-07. Read PLAN_STATUS.md for all explicit prerequisites. FIX-06 remains retired, not accepted, with its history intact. BT-08 owns the useful producer/receipt/comparability integration needed for the new experiment; no task depends on reviving FIX-06.

## Execution boundary and first real run

The existing system supports EXPLORATORY_BACKTEST and TRADES_RUN through `/api/backtest-jobs`. BT-08 reuses this infrastructure and shared lock; it does not add a competing engine, service or script-only control path. The new request binds hypothesis/version, mission, data mode, DEVELOPMENT phase and candidate/config/search-space references. HTTP, MCP and UI must agree.

H-S1-01's new path is DEVELOPMENT ONLY. The legacy TRADES runner enumerates Development, Bridge and OOS: do not inherit that sequence for the new hypothesis request. Preserve OOS reservation/access gates and forbid OOS data loads/openings on this path. No one may approve a freeze, open/reseal OOS or run a full real backtest merely to implement these tasks.

BT-08 acceptance demonstrates backend capability with end-to-end small fixtures plus read-only real-data readiness; it is not a claim that all missions have sufficient real inputs. UI-08 delivery additionally verifies the running page is on the integrated build. The first real Development run is launched by Bru through the app once its per-mission preflight is ready. Missing sources, reservation, freshness or execution-freeze gates are displayed precisely, never bypassed. Real results are labeled Development, not OOS validation or live performance.

## Versioning, comparability and no artifact graveyard

Use canonical economic producers. Paired deltas require compatible mission/campaign, obligations, execution rules, units and evidence; matching a benchmark number alone is insufficient. Requested MW are not actual fills or MWh; conversion requires delivery hours. Unknown fees/client economics remain unknown. Preserve benchmark provenance and immutable receipts, and scope current/superseded pointers by hypothesis, mission, phase and data mode so one mission never supersedes another's result. Repeated identical inputs reuse results. No deletion of prior heavy artifacts or whole-repo copies per run.

## Source precedence for this delivery

This explicit owner-approved scope and the current operative task revisions supersede prior Gas-Quarterly-only HYP-1 population limits and old first-class naming/dependencies from the retired FIX-06. Older SPEC sections and original intakes remain historical evidence; they must not be silently rewritten. This is a narrow change of research/product scope, not permission to alter economic formulas, source evidence, OOS protection, resource limits or unrelated normative requirements. Conflicts outside this scope must be reported, not guessed away.

Current task revisions contain explicit acceptance criteria so the acceptance preparer and reviewer do not infer a new task from old general specifications. Changing a contract requires a new visible revision; no regeneration may shrink the four-mission scope or reinterpret legacy outputs as new-version results.
