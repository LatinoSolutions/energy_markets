# SEM-1 · Backtesting semantic contract

Version `SEM-1/2026-09-28/v1`. Authority: Bru's owner decision in intake `D-20260928T144645-8c72/task.md` (2026-09-28), read with canonical SPEC v1.1.1 §§0.4, 3.1–3.3, 4.1, 5.1–5.5, 13.1–13.9, 25.1–25.2. This freezes product and scientific identity. It does not rewrite historical runs or claim research PASS.

## Primary identities

| Identity | Meaning | Current evidence and boundary |
|---|---|---|
| CLIENT | Client behavior for one obligation and one campaign. | The current Gas Quarterly mandate confirms purchase timing at 11:00 Europe/Berlin, without identifying a current Campaign ID. It does not prove historical client purchase times or timing for other missions. A campaign-scoped timing claim requires matching campaign/obligation/mission evidence and provenance; otherwise purchase timing is `UNKNOWN`. Sizing, fills, execution model, full cost and policy are `UNKNOWN`; an hour does not establish any of them. `A0`, `BASELINE` and arm IDs never imply CLIENT. Known mandate quantities in §4.1 and owner patch 02 are obligation facts, not evidence of executed client quantities. |
| BENCHMARK | Exactly one economic reference concept, B, per campaign. | Mean of selected daily references for 1-0-1 Monthly or 3-1-3 Quarterly (§§3.2, 5.3). It makes no BUY/WAIT or sizing decision and is not an executable price. Official settlement and derived provisional references are status/version/provenance below the one identity. A provisional B remains `BENCHMARK_PROVISIONAL`; matching part of the settlement formula is no proof of equivalence (§5.2). Historical `B*` is a proxy alias, never a second benchmark identity. |
| HYPOTHESIS | A bounded falsifiable research question, not Strategy S1–S5 itself, an arm name or a demonstrated result (§§3.1, 8.7, 13.1). | Canonical IDs `H-Sx-nn`, `H-S1S3-01` for multi-Strategy, or `H-RD-nn`. An unrun hypothesis stays in Hypotheses/Research, never in Results. `H-S1-01` asks whether causal relative price location against a session-anchored rolling reference improves procurement versus CONTROL with identical sizing/execution. Tau and N are configurable and versioned; 11:00/N=10/arithmetic mean describe legacy DIP10, not a selected winning configuration. Favorability rule is explicit and frozen per experiment. The hypothesis changes only BUY/WAIT timing. 12 MW is an applicable cap, never its sizing rule. |

The four mission partitions are Gas Quarterly, Gas Monthly, Power Quarterly and Power Monthly. Client and BENCHMARK records bind to an obligation/campaign within one partition. Evaluation and evidence remain separate across product and cadence; no economic aggregate can hide a failed mission (§4.1). Missing campaign identity, evidence or units remain `UNKNOWN`/`UNAVAILABLE` with provenance, never zero.

## Experimental comparison

`CONTROL ↔ active HYPOTHESIS` is an ablation, not a fourth primary economic column. CONTROL is the same obligation, population, opportunities, calendar, sizing controller, execution/cost contract and B without the active hypothesis. In the first P5 protocol it is the deterministic Calendar-only / price-blind comparator: BUY at predeclared eligible opportunities, with requested quantity `remaining volume / remaining scheduled opportunities` (§13.2). The controller is shared, with audited lot/cap reconciliation where applicable. The active hypothesis changes only its declared signal/timing. CONTROL is neither BENCHMARK B nor an authorized production fallback (§§3.2, 13.2, 24 DEP-25).

For comparable arms with the same B, `Delta V = V_active − V_CONTROL = H_CONTROL − H_active`. The economic records must bind to the same campaign, obligation, run and benchmark artifact/version, and each arm's own artifact hash; B/H/V must share explicit compatible EUR/MWh units. Numerical equality of B alone is insufficient. This is a relative effect, not an absolute PASS, production authorization or proof of causality (§§3.2, 5.5, 13.7). Validity, cost completeness, benchmark reconciliation, sufficient evidence, frozen population and P3 gates must be checked before a scientific verdict. Without them the claim stays `HOLD`; an unavailable source stays `UNAVAILABLE` (§§5.8, 6.3, 14.10).

## Historical replay and presentation

The SPEC's `A0/A1` remain names of the frozen P5 replay arms (§13), and other old artifacts use `BASELINE`, `ARM_A/B/C`, `DIP10`, `HOUR`, `A0@11:00/CLIENT` and `B*`. Those are technical aliases only. An alias requires an explicit artifact hash, protocol version, run ID, target hypothesis and provenance; A0 maps only to CONTROL and A1 only to the active HYPOTHESIS. Even a bound alias does not establish observed CLIENT behavior. Historical DIP10 quantity/fill choices and `A0@11:00/CLIENT` are preserved as historical assumptions; they cannot be silently recast as `H-S1-01` or actual CLIENT. The main comparison uses CLIENT / BENCHMARK / canonical HYPOTHESIS identities, and displays hypothesis results only after backend comparability gates. Legacy replay is accessible as secondary provenance and is labelled exploratory; current TRADES scope/results stay outside that historical detail. Economic values come from backend artifacts only (§26.5).

## Change control and paused work

Any change to population, baseline/CONTROL, BENCHMARK, criteria, hypothesis signal or protocol requires a new explicit version with `Supersedes / Canonical` and preserved old receipts (§0.4). This contract supersedes earlier *product labels* that presented A0 as CLIENT or B/B* as separate visible benchmarks. It does not supersede the SPEC's historical replay formulas or fabricate a new experiment.

| Paused task | Disposition before resume |
|---|---|
| FIX-06 | REWRITE taxonomy around these identities; keep valid backend economic calculation and historical replay. |
| FIX-07 | REWRITE visible naming to CONTROL and canonical H IDs; keep historical aliases with explicit provenance. |
| UI-08 | REWRITE workspace presentation to consume this contract; keep Scope → Hypotheses → Results as layout direction. |
| HYP-1 | REWRITE first H-S1-01 configuration/isolation to this conceptual definition; do not tune tau/N or silently migrate DIP10. |

This row-level classification is the prerequisite from Bru's intake; implementation of those four paused tasks remains in their own tickets. No OOS opening, long run, production action or destructive rewrite is part of SEM-1.
