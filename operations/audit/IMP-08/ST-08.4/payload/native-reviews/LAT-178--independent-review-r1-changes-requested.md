# SOURCE RECORD (verbatim body copy)
- issueDocument key: `codex-luna-independent-review-r1`
- title: Independent technical review R1 — ST-08.3
- revisionId: dc114fb6-54e4-4ca5-8298-8d9cfcb54ecd
- createdByAgentId: None
- createdByUserId: I84aMJhYXgQM0RprhDchZAQP68Y0AgCO
- updatedAt: 2026-09-20T23:24:28.085Z

---

# Independent technical review R1 — CHANGES_REQUESTED

Reviewer path: external Codex subagent gpt-5.6-luna, reasoning xhigh, acting read-only and independently from the Paperclip Luna implementation author. Board records the verdict because the configured Opus participant is quota-exhausted until 2026-09-23 06:00 UTC. This child-specific replacement does not modify shared routing, budgets, frozen policy or any other issue.

## Blocking finding — quarterly evidence count is not reconciled

- `operations/audit/IMP-08/ST-08.3/regression.test.mjs:138-145` calculates `scoreQuarterly([4,-1])`: only two completed observations.
- The same case supplies `quartersCompleted=8`, `calendarYearsCovered=2` and expects PASS.
- `src/economic-calculation/scoring.mjs:134-155,164-192` validates the declared metadata but never reconciles `evidence.quartersCompleted` with `scoring.nTotal`.
- Result: two scored campaigns can satisfy the eight-quarter minimum. This fails LAT-178 acceptance criteria 5 and 11 and SPEC v1.1 §5.7.

Required correction: reconcile completed-quarter evidence with the scored campaign population, or supply another independently verifiable campaign-to-score binding. Do not equate `n_nonzero` with completed quarters. Make the positive fixture contain eight finite campaign values (neutral campaigns may remain zero), and add a negative fixture proving two values cannot satisfy evidence for eight completed quarters.

## Secondary finding — explicit unknown validity

`src/economic-calculation/reference.mjs:19-25` uses `declaredValidity ?? validity`, so `declaredValidity:null` follows the legacy-missing-field compatibility path. The packet permits legacy compatibility only when the field is absent. If null is the input encoding for unknown validity, exclude it and add a negative regression.

## Independent verification executed on brunode

- preflight: `pwd` = `/srv/hot-data/energy-markets/app`; host = `brunode`.
- Protected hashes unchanged before/after: SPEC `86c4bd4e...b39cb6c`; baseline manifest `895539b7...ca9860`; IMP-01 receipt `78d92de8...a89b887c`; ST-08.1 receipt `1d2a6482...d9e251f`; fixtures `33fda538...7439ec`; independent calculations `58facba2...b061e9`; ST-08.2 receipt `121eceaf...fb29d`.
- `node --check src/economic-calculation/index.mjs` → exit 0.
- oracle verifier → 35 fixtures, C01-C12, 7 negative checks, exit 0.
- economic tests → 53/53 pass.
- contract tests → 67/67 pass.
- ST-08.3 regression → 8/8 pass, but R8 encodes the blocking inconsistency above.
- delivery verifier → PASS, 9 semantic files, 20 deliverables, content hash `d992a19b2df0491065022d1d44b8a9b4189b5f45eba2aecac96c5b0a5cfa231a`.

This is a technical changes-requested verdict. It is not ST acceptance or IMP-08 acceptance.