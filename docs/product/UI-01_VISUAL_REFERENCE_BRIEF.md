# UI-01 — Visual Reference Brief

Owner-added product follow-up, 2026-09-23. This document does **not** modify or supersede the canonical Energy Markets SPEC. `IMP-29` and the canonical backend contracts remain authoritative for semantics.

## Purpose

Build the first product UI surfaces on top of the accepted Operator Interface Boundary from `IMP-29`, using Bru's approved visualization/mockup direction as design reference.

The UI task is deliberately independent from unfinished procurement research where the backend contract already supports explicit unknown/not-yet-available states. It must never manufacture backtest results, campaign facts, benchmark outputs, fills, or strategy evidence merely to make a screen look complete.

## Reference package

Source on Bru's Mac:

`/Users/brunillo/Documents/energy_markets/strategy_visualizations_documents`

Canonical BruNode destination:

`/srv/hot-data/oficina-data/design-references/energy-markets/strategy_visualizations_documents/`

Intake note:

`/srv/hot-data/oficina-data/design-references/energy-markets/REFERENCE_INTAKE.md`

Hermes Director has been given the Mac source path by Bru. If the folder is present on BruNode, inventory and inspect it before visual polish. Preserve filenames and treat all images/documents as **non-normative visual/product references**.

## Owner-approved visual direction

The reference work covers four related surfaces:

1. **Replay / Decision Inspector** — central time-series view with Decision Time vs Evaluation, synchronized strategy/evidence lanes, procurement state, recommendation, request, execution and after-state.
2. **Backtests / Economic Comparison** — A0 vs A1 comparison, B/H/V/ΔV, campaign-level paired effects, distributions and integrity/method context.
3. **Research / Strategy Lab** — strategy stack S1–S5/Z, experiment/version lineage, hypotheses, readiness/integrity and evidence/receipts.
4. **Campaigns & Runs** — campaign/run navigation, readiness, explicit unknowns, receipts and drill-downs into Replay/Backtests/Research.

## Non-negotiable invariants

- Decision-time and Evaluation are visually and semantically distinct.
- Strategy evidence is not presented as policy authority.
- Recommendation, requested order, execution/fill and economic outcome are distinct objects.
- Unknown/missing/not-yet-closed data remains explicit and fail-closed.
- Provenance and timestamps are inspectable.
- Only data actually exposed by the accepted backend boundary may be shown as factual.
- Reference screenshots may guide layout/aesthetics but never override the SPEC or invent backend capabilities.

## Scope for UI-01

UI-01 may build navigation, layout, components, empty/loading/error/unknown states, and bind the surfaces that `IMP-29` already exposes. Downstream research results that do not yet exist must render honest unavailable/empty states and can be filled automatically as their canonical producers are accepted later.
