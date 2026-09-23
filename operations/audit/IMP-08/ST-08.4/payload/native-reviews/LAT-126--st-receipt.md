# SOURCE RECORD (verbatim body copy)
- issueDocument key: `st-receipt`
- title: st-receipt
- revisionId: 6ce8e5c7-d1c9-4ffe-a1d8-ba78e92dbeef
- createdByAgentId: 2f30b8dd-306b-4735-a135-f8d3127c8c0e
- createdByUserId: None
- updatedAt: 2026-09-19T17:08:43.252Z

---

# ST_RECEIPT — LAT-126 / IMP-08 / ST-08.1

Machine-readable receipt: `operations/receipts/IMP-08-ST-1.json`.
Expected-results preparation phase only. **IMP-08 is NOT accepted by this ST.**

## Identity
- Packet `WP-IMP-08-ST-1-v1.1` · Subtask `ST-08.1` · Parent `IMP-08` · Project `96bbd5b1-94da-4781-8c2b-455fdfb28d1a` · native root LAT-91.
- SPEC `PROCUREMENT_RESEARCH_CANONICAL_ENGINEERING_SPEC_v1_1.md` v1.1 sha256 `86c4bd4e...39cb6c`.
- Worker/model route: Emergency Cheap Production Worker (OpenRouter) `2f30b8dd-...` / DeepSeek V4.1 Flash via opencode_local.

## Starting baseline
brunode:`/srv/hot-data/energy-markets/app`, empty `main` (no commits/remotes/worktrees); baseline manifest sha256 `895539b7...ca9860`. Allocated paths did not pre-exist.

## Resulting version
Content hash `d8728e109a06c9a435cbc136dafb34e8e97b226c5a88580e855cf8cf0aa61e6f` (sha256 of the path-sorted listing of `operations/audit/IMP-08/fixture-oracle/**` excluding the self-referential `write-set-manifest.json`).

## Artifacts changed
- `operations/audit/IMP-08/fixture-oracle/fixtures.json`
- `operations/audit/IMP-08/fixture-oracle/independent-calculations.md`
- `operations/audit/IMP-08/fixture-oracle/verify.mjs`
- `operations/audit/IMP-08/fixture-oracle/verify-run.txt`
- `operations/audit/IMP-08/fixture-oracle/write-set-manifest.json`
- `operations/receipts/IMP-08-ST-1.json`

## Result
35 synthetic fixtures cover the twelve §19.3.1 rows (C01–C12): proxy 101 from 100/104; single-source/missing; B=105 equal daily weight; official replacement B=106; correction B=106.5 by provider timestamp; missing-then-official recompute; 1-0-1 and 3-1-3 boundaries with start included/end excluded and DST; ±60 min fallback labelled `nearby-60m`/`eex-derived-reference`; post-17:15 consumability; the reported 0.01 guard as an audit case (no canonical rejection). Scoring: +4/−1 (n=2, p=0.5, μ=1.5, R=C=4, σ_down=1, Sortino=1.5), +3/−1 (μ=1, R=C=3, Sortino=1, strict screen false), +2/−2 (μ=0, R=C=1, σ_down=2, Sortino=0), neutral addition preserving n_nonzero, only-positives, only-zeros, n<2, empty population, empty winner group, Monthly screen non-applicability. B/H/V: compatible units, synthetic all-in H with coverage, reconciled signs, no MW→MWh, no fee→0, incomplete coverage reported separately, C diagnostic only, undefined ratio never a PASS. Arithmetic screen is always distinguished from the research verdict; no PASS is fabricated.

## Tests run (actual)
- `hostname` → `brunode`; `pwd` → `/srv/hot-data/energy-markets/app`; `git branch --show-current` → `main`.
- `sha256sum` SPEC / IMP-01-IMP_RECEIPT / baseline-manifest → all match expected.
- `/opt/node/bin/node --check .../verify.mjs` → exit 0.
- `/opt/node/bin/node .../verify.mjs` → exit 0 (35 fixtures, C01–C12 covered, arithmetic agrees, 7 negative probes PASS).

Full stdout/exit codes: `verify-run.txt`.

## Evidence produced
`fixtures.json`, `independent-calculations.md`, `verify.mjs`, `verify-run.txt`, `write-set-manifest.json`.

## Assumptions / deviations
All fixture values/dates/sources are synthetic. H is an explicitly supplied synthetic all-in value; no real-ledger H formula invented. The 0.01 guard is a reported limitation, not a canonical rule. Monthly 24-month evidence is outside this subset. No deviations from the packet; no file outside `allowed_paths` was modified. No SPEC contradiction → no §20.2.12 request.

## Recommended status
`in_review`. One native review stage: Independent Reviewer `0af74a08-cb39-4cf5-a94f-117b242ea08c` (comment required, maxReviewRounds 3). The reviewer must manually recompute the numeric and boundary cases; the worker script alone is not independent.

## Parent
LAT-91 / IMP-08 parent acceptance remains pending. After an accepted oracle, the remaining **premium** implementation of the complete calculation/fixtures objective, an executable acceptance suite and independent review are required, followed by a separate Command parent acceptance / IMP_RECEIPT. This ST cannot close IMP-08, IMP-13, P6, DEP-13 or any real data audit.
