# IMP-08 parent-readiness dossier (ST-08.4)

This is a **consolidation/index of already-produced evidence**, published by
`WP-IMP-08-ST-4-v1.1` / `ST-08.4`. It is **not** a new functional implementation
round, **not** an `IMP_RECEIPT`, and **not** parent acceptance. Parent `IMP-08`
remains unaccepted until the separate Command FINAL-ACCEPTANCE gate under
SPEC v1.1 §20.2.10 runs and produces an `IMP_RECEIPT`.

- SPEC: `PROCUREMENT_RESEARCH_CANONICAL_ENGINEERING_SPEC_v1_1.md` v1.1 —
  SHA256 `86c4bd4eeb5f9d0ebad94763128b221eb64525a2b7fff1007dab0af88b39cb6c`.
- Project: Energy Markets `96bbd5b1-94da-4781-8c2b-455fdfb28d1a`; native root LAT-91.
- Workspace: `brunode:/srv/hot-data/energy-markets/app`, branch `main` (unborn; no commits).
- Scope: synthetic B/H/V calculation and mission-specific scoring, protocol v1.

> Every criterion below points at the **exact current test/evidence path**. Where
> a criterion is demonstrated by an inherited path, the inherited path is named;
> no missing assertion is replaced by a PASS label. Child approval, Command final
> acceptance outstanding, and parent acceptance outstanding are kept distinct.

## 0. Closure-status legend

| Label | Meaning |
|---|---|
| **CHILD-APPROVED** | The native review decision for that child accepted it in its own scope (LAT-126, LAT-157, LAT-178, LAT-195). Does **not** accept IMP-08. |
| **COMMAND-OUTSTANDING** | Command has not yet evaluated the consolidated parent. Command's only recorded verdict so far is `changes_requested` for ST-08.2 (LAT-176), which the ST-08.3 corrective responsive path addressed at the arithmetic/coverage level. |
| **PARENT-OUTSTANDING** | IMP-08 parent acceptance under §20.2.10 is not satisfied; no `IMP_RECEIPT` exists. |
| **RESIDUAL** | A limitation that must remain visible and is not closed by this dossier. |

### Child review decisions (actual, from issue execution state)

| Child | Issue | Native stage | Participant | Decision id | Outcome | Label |
|---|---|---|---|---|---|---|
| ST-08.1 | LAT-126 | `a508cbb9-c518-4857-b83f-1a6ef57b1e66` | agent Independent Reviewer `0af74a08-cb39-4cf5-a94f-117b242ea08c` | `473757cf-567b-4cc0-ad43-937825bc068d` | approved | CHILD-APPROVED |
| ST-08.2 | LAT-157 | `90fe07d0-4af4-4e7c-9c09-c5a48e784d00` | agent Independent Reviewer `0af74a08-cb39-4cf5-a94f-117b242ea08c` | `7641d5d4-de07-434b-8c71-c5c4eb39eae3` | approved | CHILD-APPROVED |
| ST-08.3 | LAT-178 | `7098b2ce-7a55-46f9-8ae1-f38c0d0efae5` | **user/Board** `I84aMJhYXgQM0RprhDchZAQP68Y0AgCO` | `7af7ec2f-f63c-4785-a447-219620ab5e78` | approved | CHILD-APPROVED |
| ST-08.5 | LAT-195 | `b7cc671c-59ca-4d57-8858-521949b96afb` | agent Command/Astra `2b6bf987-6800-4d4c-a23a-d470a4bb0ea6`, run as `gpt-5.6-sol` high (independent Sol High review; source comment `457cce45`) | `f0d45fae-3f59-45dd-b389-9f32e7442ded` | approved (2026-09-21T16:00:28Z) | CHILD-APPROVED — CURRENT |

ST-08.3's native approval was recorded by a **Board/user** participant because the
configured Independent Reviewer lane was quota-exhausted; the author/reviewer
separation is preserved (author: Luna `6c548bcb-e6aa-43ea-9c6c-319497cbe6a9`;
reviewer: external Board-recorded Codex Luna). This is a routing fact, not an
Opus approval and not an `IMP_RECEIPT`.

---

## 0b. Version binding — current accepted version is ST-08.5

This dossier indexes the **current accepted** IMP-08 synthetic version. ST-08.5
is a bounded corrective continuation of ST-08.3 (from LAT-194 FINAL-ACCEPTANCE)
and supersedes it; the ST-08.3 bytes remain preserved as history.

- Current accepted version: ST-08.5 (LAT-195), native decision
  `f0d45fae-3f59-45dd-b389-9f32e7442ded` approved 2026-09-21T16:00:28Z after an
  independent Sol High review. Authoritative review source: LAT-195 approval
  comment `457cce45-8d57-4915-9968-95a11fc640b4` (author agent `2b6bf987`; the
  participant ran as `gpt-5.6-sol` with `modelReasoningEffort=high` and OA2
  `CODEX_HOME`), archived at `native-reviews/LAT-195--approval-comment.md`.
  ST-08.5 reports content hash
  `bc0ce6adef42831da21c9339c6569018a8c6b03a587558372ace336d4f661528`
  (sha256sum-style, algorithm C); the same bytes aggregate to
  `96e73ef9ce63aea6bd39934cebc17cdc656f3f0d9ef576700739e39afa914f6e`
  under ST-08.3's algorithm A. Receipt `operations/receipts/IMP-08-ST-5.json`
  (sha256 `ee42418e…efee71`); manifest `3cfe1efc…eee5f209`.
- Historical hash role (disclosed): accepted ST-08.2 content hash is
  `8d1ce8f2…df1b1b…` (from `IMP-08-ST-2.json`, recomputed from its nine artifact
  hashes). ST-08.3's frozen baseline reference records `8d1ce8f2…df8b1b…`; that is
  a separate, disclosed historical baseline-reference value, **not** the accepted
  ST-08.2 hash. `verify-st4.mjs` asserts both roles so they cannot be conflated.
- Corrected files: `src/economic-calculation/bhv.mjs` → `4cc204f9…f686cdf`;
  `test/economic-calculation/bhv.test.mjs` → `b523f2d1…73c06c7`.
- Prior accepted versions preserved as history: ST-08.3 `140c8128…5fc6f2`
  (decision `7af7ec2f`), ST-08.2 `8d1ce8f2…`, ST-08.1 oracle `d8728e10…`.
- Verifiers: ST-08.5 verifier PASS (`artifacts=11`, `protectedHashes=9`,
  `semanticHash=bc0ce6ad…4f661528`). The ST-08.3 live verifier intentionally
  exits 1 (`manifest content hash is stale`) because it pins the pre-ST-08.5
  reviewed bytes; that failure is recorded verbatim in `verification.txt` and the
  historical bytes are untouched.
- Binding authority: `operations/audit/IMP-08/ST-08.4/version-binding.json`;
  payload layout: `payload/accepted/**` (current ST-08.5) and
  `payload/history/**` (ST-08.1/2/3).
- Parent gate: SPEC §20.2.10 consumes this current accepted version. If a later
  packet changes the accepted bytes again, this dossier must be re-consolidated.

---

## A. SPEC §25.1 IMP-08 acceptance criteria

SPEC §25.1 IMP-08: *"Materializar cálculo B/H/V y scoring con casos límite."*
Acceptance: *"Reproduce +4/−1, +3/−1, +2/−2 y neutral/denominador cero; Monthly no
hereda gate Sortino."* MUST NOT CHANGE: *"n−1, target 0, C diagnóstico,
separación de misiones."* Límites: fixtures sobre §§5,19.

| # | §25.1 criterion | Exact current test/evidence path | Child review source | Status |
|---|---|---|---|---|
| A1 | Reproducible B/H/V calculation | `src/economic-calculation/{reference,benchmark,bhv}.mjs`; `test/economic-calculation/{benchmark,bhv}.test.mjs`; `operations/audit/IMP-08/ST-08.3/regression.test.mjs` (R1–R6) | ST-08.2 `7641d5d4`; ST-08.3 R4 `7af7ec2f` | CHILD-APPROVED / COMMAND-OUTSTANDING |
| A2 | Mission scoring with edge cases | `src/economic-calculation/scoring.mjs`; `test/economic-calculation/scoring.test.mjs`; `regression.test.mjs` (R7–R8) | ST-08.2 `7641d5d4`; ST-08.3 R4 `7af7ec2f` | CHILD-APPROVED / COMMAND-OUTSTANDING |
| A3 | Reproduce +4/−1 → n=2, p=0.5, μ=1.5, R=C=4, σ_down=1, Sortino=1.5 | `test/economic-calculation/scoring.test.mjs`; oracle `operations/audit/IMP-08/fixture-oracle/independent-calculations.md` §C09 | ST-08.1 `473757cf`; ST-08.2 `7641d5d4` | CHILD-APPROVED |
| A4 | Reproduce +3/−1 → μ=1, R=C=3, Sortino=1, strict `>1` false | `scoring.test.mjs`; oracle §C10 | ST-08.1 `473757cf`; ST-08.2 `7641d5d4` | CHILD-APPROVED |
| A5 | Reproduce +2/−2 → μ=0, R=C=1, σ_down=2, Sortino=0 | `scoring.test.mjs`; oracle §C11 | ST-08.1 `473757cf`; ST-08.2 `7641d5d4` | CHILD-APPROVED |
| A6 | Neutral / zero-denominator cases explicit, no epsilon, no fabricated PASS | `scoring.test.mjs`; `regression.test.mjs` R7/R8; oracle §§C09-neutral, C12 | ST-08.1 `473757cf`; ST-08.2 `7641d5d4`; ST-08.3 R4 `7af7ec2f` | CHILD-APPROVED |
| A7 | Monthly does not inherit the Quarterly Sortino gate | `scoring.test.mjs` (Monthly cases); `regression.test.mjs` R7 (Monthly 24 months cannot satisfy Quarterly) | ST-08.2 `7641d5d4`; ST-08.3 R1→R4 | CHILD-APPROVED |
| A8 | MUST NOT CHANGE: downside `n−1`, target 0, `C` diagnostic only, mission separation | Enforced in `src/economic-calculation/scoring.mjs`; asserted in `scoring.test.mjs`; `C` diagnostic asserted in `bhv.test.mjs` (`hardResearchGate=false`, `researchPassFromCAlone=false`) | ST-08.2 `7641d5d4`; ST-08.3 `7af7ec2f` | CHILD-APPROVED |
| A9 | §25.2.3: may close with IMP-01 + synthetic values; real campaign later needs IMP-05/07 | `operations/receipts/IMP-01-IMP_RECEIPT.json` (accepted, pinned); no real run performed | Command (LAT-176) / packet | RESIDUAL — real-run gates intentionally open |

---

## B. SPEC §19.3.1 documentary cases (D08 p.14)

All twelve rows are synthetic with known arithmetic and are materialized in the
frozen oracle (`fixtures.json`, `independent-calculations.md`) and the economic
suites. The oracle verifier `operations/audit/IMP-08/fixture-oracle/verify.mjs`
recomputes each documented arithmetic and passes (35 fixtures, C01–C12, 7
adversarial negative probes).

| §19.3.1 row | Case id | Exact evidence | Status |
|---|---|---|---|
| Trades 100 / midpoints 104 → proxy 101 (no VWAP) | C01 | `fixtures.json`; `independent-calculations.md` §C01; `benchmark.test.mjs` | CHILD-APPROVED |
| Only trades / only midpoints / no source | C02 | oracle §C02; `benchmark.test.mjs`; `reference.mjs` | CHILD-APPROVED |
| Daily refs 100/110, different tick density → B=105 equal weight | C03 | oracle §C03; `benchmark.test.mjs`; `regression.test.mjs` R1 | CHILD-APPROVED |
| Proxy 100 replaced by official 102 (d2=110) → B=106, prior preserved | C04 | oracle §C04; `benchmark.test.mjs` | CHILD-APPROVED |
| Official correction 102→103 (d2=110) → B=106.5 by provider timestamp | C05 | oracle §C05; `benchmark.test.mjs`; `reference.mjs` | CHILD-APPROVED |
| Missing date later receives official → recompute set/sum/denominator/coverage | C06 | oracle §C06; `benchmark.test.mjs` | CHILD-APPROVED |
| Boundaries 1-0-1 / 3-1-3 and ±60 min fallback (start in / end out, DST, labels) | C07 | oracle §C07; `benchmark.test.mjs` (`isWithinWindow`, `isWithinFallbackWindow`, `isDecisionConsumable`) | CHILD-APPROVED |
| Official 0.01: test reported guard, contrast applicable validity, do not presume rejection | C08 | oracle §C08; `benchmark.test.mjs`; `regression.test.mjs` R4 | CHILD-APPROVED |
| V=+4,−1 → n=2, p=0.5, μ=1.5, R=C=4, σ_down=1, Sortino=1.5 | C09 | oracle §C09; `scoring.test.mjs` | CHILD-APPROVED |
| V=+3,−1 → μ=1, R=C=3, Sortino=1, strict false | C10 | oracle §C10; `scoring.test.mjs` | CHILD-APPROVED |
| V=+2,−2 → μ=0, R=C=1, σ_down=2, Sortino=0 | C11 | oracle §C11; `scoring.test.mjs` | CHILD-APPROVED |
| Only positives / exact-zero / n<2 / empty winner group explicit undefined, no epsilon/PASS | C12 | oracle §C12; `scoring.test.mjs` | CHILD-APPROVED |

---

## C. Original 35-fixture / C01–C12 coverage

- Frozen accepted oracle: `operations/audit/IMP-08/fixture-oracle/fixtures.json`
  (35 fixtures) — SHA256 `33fda538883a879b076cf1d4ef81cb7dd1468791599ea92c95f613d3ee7439ec`.
- Independent hand-worked derivations:
  `operations/audit/IMP-08/fixture-oracle/independent-calculations.md` —
  SHA256 `58facba24c9df3ceb403e2a67423e905bfa89aa73d861a28d1aca0ea10b061e9`.
- Verifier + captured run: `verify.mjs`, `verify-run.txt`.
- Fixture→test mapping: `operations/audit/IMP-08/ST-08.2/fixture-coverage-matrix.json`.
- Per-fixture execution: `operations/audit/IMP-08/ST-08.2/economic-tests.txt`
  and `.tap`; corrective coverage in `operations/audit/IMP-08/ST-08.3/{tests.tap,after-tests.txt}`.

Result: oracle verifier PASS (35 fixtures, C01–C12 complete, 7 negative probes);
economic suite 53/53; contracts 67/67. Source: ST-08.1 `473757cf`,
ST-08.2 `7641d5d4`, ST-08.3 R4 `7af7ec2f`. Status: CHILD-APPROVED.

---

## D. Inherited ST-08.2 criteria (7)

From `WP-IMP-08-ST-2-v1.1`, mapped in
`operations/audit/IMP-08/ST-08.2/acceptance-matrix.md` (doc revision
`6274edd0-907f-48af-ac9c-c10a46f8bce7`). Content version `8d1ce8f2…`.

| # | ST-08.2 criterion | Exact current evidence | Status |
|---|---|---|---|
| D1 | Reusable public API, no expected-result lookup / fixture dispatch / oracle import; 35 fixtures map to executed tests; C01–C12 traced | `src/economic-calculation/*.mjs`; `test/economic-calculation/*.test.mjs`; `ST-08.2/fixture-coverage-matrix.json` | CHILD-APPROVED |
| D2 | Reference/benchmark: proxy 101; single/missing; B=105; official 102→106; correction 103→106.5 by timestamp; missing recompute; 1-0-1/3-1-3 and ±60 fallback; consumability; 0.01 guard | `benchmark.test.mjs`; `regression.test.mjs` R1–R4 | CHILD-APPROVED |
| D3 | B/H/V with synthetic H and coverage/unit provenance; signs; missing/null/non-finite/incompatible units not coerced to zero; no MW→MWh; no fee→0 | `bhv.test.mjs`; `regression.test.mjs` R5–R6 | CHILD-APPROVED |
| D4 | Quarterly +4/−1, +3/−1, +2/−2; neutrals preserve n_nonzero; empty/zero/n<2/empty-group; no epsilon/annualization; n never replaced by n_total | `scoring.test.mjs` | CHILD-APPROVED |
| D5 | Monthly separate; evidence minimum; C diagnostic; product/Mission populations separated; research verdict distinct from arithmetic; incomplete coverage/provisional benchmark/invalid inputs not hidden by a high score | `scoring.test.mjs`; `bhv.test.mjs`; `regression.test.mjs` R7–R8 | CHILD-APPROVED |
| D6 | Real test output; LAT-126 declarative checks now executable; null coercion of H/B rejected; prerequisite/oracle hashes intact; no writes outside allowed_paths | `ST-08.2/{economic-tests.txt,contracts-tests.txt,write-set-manifest.json,baseline-and-environment.txt}` | CHILD-APPROVED |
| D7 | Full §20.2.8 `ST_RECEIPT`, checkpoint and reviewable artifacts; one native independent review | `operations/receipts/IMP-08-ST-2.json`; LAT-157 docs; review decision `7641d5d4` | CHILD-APPROVED (Command verdict separately `changes_requested`, LAT-176) |

Command verdict for ST-08.2 (LAT-176 doc `final-acceptance-evidence`, revision
`3b159e73-7a11-4465-9f09-741a1a872099`) returned **changes_requested** with four
reproducible findings (daily dedup, malformed costs, Monthly/Quarterly evidence,
invalid provider timestamp). Those four findings are the input to ST-08.3 and
are tracked in section F.

---

## E. ST-08.3 criteria (12)

From `WP-IMP-08-ST-3-v1.1`, self-mapped in
`operations/audit/IMP-08/ST-08.3/acceptance-matrix.md`; verified by
`operations/audit/IMP-08/ST-08.3/verify-delivery.mjs` (PASS) and the ST-08.3
native approval `7af7ec2f`. Note: the packet's stated ST-08.3 review round basis
is R1–R4 external Board-recorded reviews (R1–R3 changes_requested, R4 approved).

| # | ST-08.3 criterion | Exact current evidence | Status |
|---|---|---|---|
| E1 | Generic public API and 35-fixture coverage | `test/economic-calculation/*.test.mjs`; oracle verifier; `acceptance-matrix.md` row 1; `tests.tap` | CHILD-APPROVED |
| E2 | Reference validity, daily weighting, windows, provenance | `regression.test.mjs` R1–R4; inherited `benchmark.test.mjs` C01–C08 | CHILD-APPROVED |
| E3 | B/H/V, completeness, units, unknown costs | `regression.test.mjs` R5–R6; `bhv.test.mjs` | CHILD-APPROVED |
| E4 | Quarterly formulas and degenerates (n−1, target 0, strict `Sortino>1`, neutral separation) | `scoring.test.mjs`; inherited C09–C12 | CHILD-APPROVED |
| E5 | Monthly separation and mission-bound evidence | `regression.test.mjs` R7–R8 | CHILD-APPROVED |
| E6 | Actual output and independent expectations | `ST-08.3/{before-tests.txt,after-tests.txt,tests.tap,contracts-tests.tap}`; `manifest.json` | CHILD-APPROVED |
| E7 | Receipt/review boundary; no IMP_RECEIPT produced | `operations/receipts/IMP-08-ST-3.json`; `verify-delivery.mjs`; native approval `7af7ec2f` | CHILD-APPROVED |
| E8 | Duplicate daily rows through actual pipeline | `regression.test.mjs` R1–R2 | CHILD-APPROVED |
| E9 | Official validity and timestamp corrections | `regression.test.mjs` R3–R4 | CHILD-APPROVED |
| E10 | Cost invalidity and explicit zero | `regression.test.mjs` R5–R6 | CHILD-APPROVED |
| E11 | Mission evidence gate | `regression.test.mjs` R7–R8 | CHILD-APPROVED |
| E12 | Versioned evidence and protected history; shared route validator exercised | `ST-08.3/{baseline.json,manifest.json}`; `run-identity.mjs`; `verify-delivery.mjs`; `regression.test.mjs` R9 | CHILD-APPROVED |

---

## F. Command / R1–R3 findings — resolution map

| Finding | Origin | Resolution evidence | Status |
|---|---|---|---|
| Daily weights & deduplication (`benchmark.mjs` counted rows, accepted duplicates) | LAT-176 finding 1 | `regression.test.mjs` R1 (dedup, exact product/date/accessibility, B=105 count=2 coverage 2/2) and R2 (conflicting duplicate rejected); `benchmark.mjs`/`reference.mjs` pipeline | RESOLVED at implementation+regression level; parent Command re-evaluation still outstanding |
| Malformed costs became valid NaN; null threw; missing costs silently zero | LAT-176 finding 2 | `regression.test.mjs` R5 (false/null/missing/wrong-type all unavailable, finite rejected) and R6 (explicit `costsComplete` known-zero = valid finite H=100); `bhv.mjs` | RESOLVED; parent re-evaluation outstanding |
| Monthly evidence produced Quarterly PASS | LAT-176 finding 3 | `regression.test.mjs` R7 (Monthly 24 months → HOLD with Quarterly reason); R8 (Quarterly gate binds `scoring.nTotal`, forged counts/pooled products HOLD) | RESOLVED; parent re-evaluation outstanding |
| Invalid provider timestamp won official selection | LAT-176 finding 4 | `regression.test.mjs` R3 (malformed/unknown/null candidates excluded, valid 102 wins, 3 excluded); `reference.mjs` | RESOLVED; parent re-evaluation outstanding |
| R1: quarterly evidence count not reconciled (two values for eight quarters) | LAT-178 review r1 | `regression.test.mjs` R8 (`quartersCompleted === scoring.nTotal`, eight finite values, two-values-vs-eight → HOLD) | RESOLVED; R4 approved |
| R1: explicit `declaredValidity:null` followed legacy path | LAT-178 review r1 | `regression.test.mjs` R3 (`declaredValidity:null` excluded); `reference.mjs` | RESOLVED; R4 approved |
| R2: receipt actual-run identity inconsistent | LAT-178 review r2 | `operations/receipts/IMP-08-ST-3.json` current route run `6c2d1408…`; `runHistory` preserves initial/R1/R2; verifier cross-checks | RESOLVED; R4 approved |
| R3: R9 didn't invoke the shared validator | LAT-178 review r3 | `run-identity.mjs` shared `validateWorkerRouteIdentity`; used by `verify-delivery.mjs` and R9; R9 rejects each cloned mismatch | RESOLVED; R4 approved |

R1–R3 are **changes_requested** technical verdicts recorded as issue documents
on LAT-178 (revisions `dc114fb6`, `1256bf9e`, `8c131c49`). R4 (`6bd5ab95`)
approved the child. The native execution-state approval is `7af7ec2f`. These are
historical facts preserved in this dossier, not rewritten into an `IMP_RECEIPT`.

---

## F2. ST-08.5 criteria (9) — current accepted corrective

From `WP-IMP-08-ST-5-v1.1`, evidenced in
`operations/audit/IMP-08/ST-08.5/**` (archived as `payload/accepted/st-08.5/**`).
Child native approval `f0d45fae` (2026-09-21T16:00:28Z).

| # | ST-08.5 criterion | Exact current evidence | Status |
|---|---|---|---|
| F2-1 | `computeAllInH` never throws for null/undefined/primitive/sparse hole/malformed object when `costsComplete=true`; returns established unknown contract with reason | `src/economic-calculation/bhv.mjs`; `test/economic-calculation/bhv.test.mjs`; `ST-08.5/reproducer.txt` | CHILD-APPROVED |
| F2-2 | Invalid elements identified by validity, never truthiness; invalid tests reach element validation | `bhv.mjs` (`isValidCompleteCost` / `findIndex`); `bhv.test.mjs` | CHILD-APPROVED |
| F2-3 | Valid complete finite entries preserve arithmetic/units/total/output shape; empty complete list unchanged | `bhv.test.mjs`; `ST-08.5/tests.tap` | CHILD-APPROVED |
| F2-4 | Unknown values/status, missing/invalid units, NaN/Infinity/incompatible units fail closed; no coercion, no unknown→zero | `bhv.mjs`; `bhv.test.mjs`; `ST-08.5/reproducer.txt` | CHILD-APPROVED |
| F2-5 | Direct `costsComplete=true` tests for null, undefined, sparse arrays, scalar primitives, `{}`, missing/non-finite value, invalid unit/status, plus a valid control; exact unknown result/reason | `bhv.test.mjs` (ST-08.5 cases) | CHILD-APPROVED |
| F2-6 | Economic suite, contract suite, ST-08.3 regressions, fixture oracle and delivery verifier green on resulting bytes; ST-08.3 hash-pinned verifier mismatch recorded, not rewritten; ST-08.5 verifier validates the delta | `ST-08.5/tests.tap`, `ST-08.5/verification.txt`, `ST-08.5/verify-delivery.mjs` (PASS) | CHILD-APPROVED |
| F2-7 | Before/after hashes, commands, outputs, exit codes; manifest covers all ST-08.5 artifacts and both changed files; protected prior artifacts byte-identical | `ST-08.5/{baseline-hashes.txt,final-hashes.txt,manifest.json}` | CHILD-APPROVED |
| F2-8 | Complete §20.2.8 ST_RECEIPT with actual route, baseline, content hash, inputs, changed artifacts, results, evidence, assumptions, deviations, dependency findings, retries, `in_review` recommendation | `operations/receipts/IMP-08-ST-5.json` | CHILD-APPROVED |
| F2-9 | Publish readable change/test/receipt/checkpoint documents and attachment-backed evidence; one native independent review approves exact bytes; child acceptance separate from parent | LAT-195 docs (`st-receipt`, `change-review`, `test-evidence`, `continuity-checkpoint`); native decision `f0d45fae` | CHILD-APPROVED |

---

## G. Unresolved limitations (must remain visible)

1. **PARENT-OUTSTANDING.** No `IMP_RECEIPT` exists; parent IMP-08 is not accepted.
   §20.2.10 requires every required ST accepted, parent prerequisites satisfied,
   any required audit/evidence conditions satisfied, the parent acceptance test
   passed, no unresolved SPEC conflict, and no frozen decision violated.
   Command must run that bounded gate separately.
2. **COMMAND-OUTSTANDING.** Command has not yet run the consolidated IMP-08
   parent gate (§20.2.10) over the current accepted child set. The LAT-176
   ST-08.2 findings were addressed by ST-08.3 and further by ST-08.5; the
   technical resolutions are evidenced here, but Command acceptance remains
   pending.
3. **Synthetic-only.** All fixtures/values are synthetic. This dossier does **not**
   close DEP-13, IMP-13's ten-fixture P6 suite, P6, procurement, or any real
   economic result.
4. **Real-campaign gates open.** Applying the calculation to a real campaign still
   requires accepted IMP-05/07 and their applicable typed audit claims before that
   run (§25.2.3). No such claims are satisfied here.
5. **ST-08.3 predecessor document gap preserved.** LAT-178 never carried an
   `st-receipt` document (its `continuity-checkpoint` described pre-R4 pending
   review). This dossier preserves those historical bytes and records the current
   native approval separately; the human-owned predecessor is not modified and is
   not repaired here.
6. **Routing notes.** ST-08.3's native approval was recorded by a Board/user
   participant due to Independent Reviewer quota exhaustion; ST-08.5's native
   approval was recorded by Command/Astra after an independent Sol High review.
   These are routing facts preserved for traceability, not an Opus approval and
   not an acceptance of IMP-08.
7. **§26 boundary.** Nothing here constitutes procurement, real-data readiness or
   a research PASS.
8. **Historical lineage defect (ST-08.2 hash role) — residual for Command.**
   ST-08.3's frozen baseline reference records `8d1ce8f2…df8b1b…`, whereas the
   accepted ST-08.2 content hash computed from its own nine artifact hashes is
   `8d1ce8f2…df1b1b…`. This dossier records the accepted hash as `…df1b1b…` and
   keeps `…df8b1b…` strictly as ST-08.3's baseline-reference value; predecessor
   bytes are unchanged. It is a factual documentation defect in the historical
   chain, not a semantic defect in the accepted evidence, and is left for
   Command's assessment.

---

## H. Hash / pin verification for this dossier

All pins captured before and after this ST-08.4 run; see
`operations/audit/IMP-08/ST-08.4/{baseline-hashes.txt,final-hashes.txt,verification.txt}`.
The current accepted ST-08.5 bytes aggregate to `bc0ce6ad…4f661528` (algorithm C,
as ST-08.5 reports) / `96e73ef9…14f6e` (algorithm A). The frozen ST-08.3 history
inside `payload/history/st-08.3/` recomputes to
`140c8128eec122c295ac5b19ca1636a59674b8ea9f6706a827e21ba2bb5fc6f2`.
`operations/audit/IMP-08/ST-08.5/verify-delivery.mjs` PASS; the ST-08.3 live
verifier intentionally exits 1 against the superseded bytes.
`operations/audit/IMP-08/ST-08.4/verify-st4.mjs` verifies the current accepted
aggregate, the frozen ST-08.3 history, validates the receipt with the existing
validators and confirms the payload archive hash. No predecessor file, receipt,
review or product source was modified.