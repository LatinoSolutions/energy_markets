# Energy Markets — Blind UI Design Brief

## Isolation
This design exercise is deliberately blind.

Do not inspect or use:
- /srv/hot-data/energy-markets/app/src/ui/**
- /srv/hot-data/energy-markets/app/docs/product/UI-01_VISUAL_REFERENCE_BRIEF.md
- /srv/hot-data/oficina-data/design-references/**
- prior Energy Markets screenshots, mockups, GPT proposals, or existing visual implementations.

Do not ask another model/agent for prior visual context.

The purpose is an independent Claude design proposal.

## Product
Energy Markets is a procurement research platform, not a trading terminal and not a generic admin dashboard.

It needs four user-facing workspaces:

1. Replay / Decision Inspector
   - inspect what was known at decision time;
   - recommendation;
   - requested action/order;
   - execution/fill;
   - later evaluation/outcome.

2. Backtests / Economic Comparison
   - compare experimental arms/baselines;
   - B/H/V/Delta-V style measures;
   - distributions and paired/campaign effects;
   - method/integrity context.

3. Research / Strategy Lab
   - strategy/candidate stack;
   - experiment/version lineage;
   - hypotheses;
   - readiness/integrity;
   - evidence and receipts.

4. Campaigns & Runs
   - campaign/run navigation;
   - readiness;
   - explicit unknowns;
   - receipts;
   - drill-downs into Replay, Backtests and Research.

## Semantic constraints
- Decision-time and later Evaluation must never be visually conflated.
- Evidence is not authority.
- Recommendation, requested action, execution/fill and economic outcome are separate objects.
- Missing/unknown/not-yet-closed data must remain explicit and fail-closed.
- Provenance and timestamps must be inspectable.
- Demo content may be synthetic only when clearly marked as such.

## Deliverable
Create a standalone high-fidelity navigable prototype in design-proposal/.

Required:
- design-proposal/index.html
- coherent visual language across all four workspaces
- design-proposal/DESIGN_RATIONALE.md
- no production integration
- no modification outside this isolated repo
- screenshots for each workspace if an already-available local browser/screenshot facility permits it; do not install heavy system packages solely for screenshots.

The result must be easy for Bru to compare side-by-side with an independently produced GPT/reference-based proposal.
