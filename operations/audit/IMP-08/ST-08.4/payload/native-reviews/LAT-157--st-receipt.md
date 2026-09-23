# SOURCE RECORD (verbatim body copy)
- issueDocument key: `st-receipt`
- title: st-receipt
- revisionId: 5b85ae5d-ac58-468b-9f1d-7efda42d99e4
- createdByAgentId: 2f30b8dd-306b-4735-a135-f8d3127c8c0e
- createdByUserId: None
- updatedAt: 2026-09-20T17:22:12.759Z

---

# ST_RECEIPT — LAT-157 / IMP-08 / ST-08.2

Machine-readable receipt: `operations/receipts/IMP-08-ST-2.json` (sha256 `121eceafadd66b951c86c4a319b222c8780b8844d48941570b450f3f7abfb29d`).
Synthetic calculation/fixtures phase only. **ST accepted ≠ IMP accepted; IMP-08 is NOT accepted by this ST.**

## Identity
- Packet `WP-IMP-08-ST-2-v1.1` · Subtask `ST-08.2` · Parent `IMP-08` · Project `96bbd5b1-94da-4781-8c2b-455fdfb28d1a` · native root [LAT-91](/LAT/issues/LAT-91).
- SPEC `PROCUREMENT_RESEARCH_CANONICAL_ENGINEERING_SPEC_v1_1.md` v1.1 sha256 `86c4bd4eeb5f9d0ebad94763128b221eb64525a2b7fff1007dab0af88b39cb6c`.
- Predecessor subtask: [LAT-126](/LAT/issues/LAT-126) (ST-08.1, approved; frozen oracle reused read-only).
- Workspace: `brunode:/srv/hot-data/energy-markets/app`, `main` unborn (0 commits).
- Worker/model route: Emergency Cheap Production Worker (OpenRouter) `2f30b8dd-306b-4735-a135-f8d3127c8c0e` / DeepSeek V4.1 Flash via `opencode_local`; Command-rerouted premium packet with a distinct Independent Reviewer.

## Starting baseline
`operations/bootstrap/baseline-manifest.json` sha256 `895539b7312479a4350b7eeddf207c084090cf29abd391025dd763be00ca9860`; IMP-01 receipt sha256 `78d92de8…a887c`; IMP-08-ST-1.json sha256 `1d2a6482…e251f`; oracle `fixtures.json` sha256 `33fda538…7439ec` and `independent-calculations.md` sha256 `58facba2…d061e9`. Allocated paths did not pre-exist. Six baseline hashes re-verified unchanged at start and end.

## Resulting version
Content hash `8d1ce8f29f8474379082df1b1b294dc1838ba753c2a6d1586b2136e2524416fe` over the 9 semantic deliverables (sorted `'<path>
<sha256>
'`). Superseded round-0 version `215a0e76…` recorded in the receipt (`supersededContentHashes`). No commits; the branch remains unborn.

## Inputs used
Canonical §§3, 5.1–5.8, 6.1, 19.3–19.3.1, 20.2.7–20.2.12, 25.1/25.2 IMP-08; accepted IMP-01 receipt; `baseline-manifest.json`; approved ST-08.1 receipt; the frozen ST-08.1 oracle (read-only); accepted `src/contracts` modules (read-only).

## Artifacts changed
`src/economic-calculation/{reference,benchmark,bhv,scoring,index}.mjs`; `test/economic-calculation/{benchmark,bhv,scoring}.test.mjs`; `docs/economic-calculation.md`; `operations/audit/IMP-08/ST-08.2/*`; `operations/receipts/IMP-08-ST-2.json`. No writes outside `allowed_paths`; oracle and baselines untouched.

## Result
Generic, reusable synthetic calculation of reference/benchmark, B/H/V and mission scoring. Public API (`proxyReference`, `selectDailyReference`, `benchmarkB`, `isWithinWindow`, `isWithinFallbackWindow`, `isDecisionConsumable`, `classifyOfficialValidity`, `computeV`, `computeAllInH`, `computeTotalEur`, `classifyCoverage`, `scoreQuarterly`, `minimumEvidence`, `quarterlyResearchVerdict`, `monthlyDiagnostics`, `cDiagnostic`) consumes explicit inputs with no expected-result lookup, fixture dispatch or oracle import. All 35 frozen ST-08.1 fixtures (C01–C12) map to executed tests with literal values.

Round-1 review correction (criterion 5 and 7):
- `quarterlyResearchVerdict({ scoring, evidence, dataQuality })` cannot emit PASS: `invalidCount>0` → **INVALID**; coverage ≠ `full` or provisional benchmark → **HOLD**; admissibility not declared → **HOLD**. Input-admissibility gate, no new threshold.
- `monthlyDiagnostics` decides its `researchVerdictReason` by Monthly economic criterion and evidence; the HOLD is an unconditional **scope limitation** and is independent of the diagnostic Sortino being undefined.
- `docs/economic-calculation.md` documents `cDiagnostic` as `researchPassFromCAlone`.

## Tests run and results
- `hostname`/`pwd` → `brunode` / `/srv/hot-data/energy-markets/app`; six baseline hashes unchanged at start and end.
- `/opt/node/bin/node --check src/economic-calculation/index.mjs` → exit 0.
- `/opt/node/bin/node --test test/economic-calculation/*.test.mjs` → exit 0; **53 tests, 53 pass, 0 fail**.
- `/opt/node/bin/node --test test/contracts/*.test.mjs` → exit 0; **67 tests, 67 pass, 0 fail**.
- `validateStReceipt` + `linkStReceiptToPacket` → `ok = true`, exit 0.

## Evidence produced
`operations/audit/IMP-08/ST-08.2/{fixture-coverage-matrix.json, acceptance-matrix.md, write-set-manifest.json, baseline-and-environment.txt, node-check.txt, economic-tests.txt, economic-tests.tap, contracts-tests.txt, receipt-validation.txt}`; work products on this issue (final content `8d1ce8f2`).

## Assumptions
Serialization/field names are implementation detail; the semantic content of §§5–6 is preserved. `H` is a supplied all-in value; no real-ledger `H` formula. All values and fixtures are synthetic. The premium packet was Command-rerouted to this lane with a distinct reviewer under explicit agent capability.

## Deviations
The packet classifies ST-08.2 as `premium` but it was authored by the Emergency Cheap Production Worker (OpenRouter) after Command rerouted it and the primary premium/Go lanes were unavailable; the native reviewer `0af74a08` is distinct and was preserved.

## Dependency findings
REQUIRES = accepted IMP-01 and current SPEC — satisfied, hashes verified live. Phase gate LAT-126/ST-08.1 approved (native decision `473757cf`); frozen oracle reused read-only. `REQUIRES_AUDIT=none` and `REQUIRES_EVIDENCE=none` for this synthetic scope; none claimed. IMP-05/07 and their audit scopes remain necessary before any real run. No canonical contradiction; no SPEC_CHANGE_REQUEST.

## Failures / retries
- Fallback ±60 test initially failed (string `"0"` default rejected by `Number.isFinite`); fixed to numeric `0`; suite passed.
- Earlier run `8009b942` could not author (premium packet dispatched to its own sole reviewer); returned to Command ([LAT-159](/LAT/issues/LAT-159)); Command rerouted to a distinct lane.
- Round-1 review (`cebc19f9`) returned `changes_requested` with findings H1/H2 (criterion 5) and H3 (criterion 7); all resolved. Round-2 review (`8bbf27f7`) returned `changes_requested` limited to publication (stale work products and missing `st-receipt` document); resolved by republishing and creating this document.

## Review
Single native stage `90fe07d0`, sole Independent Reviewer `0af74a08-cb39-4cf5-a94f-117b242ea08c` (`approvalsNeeded 1`, `maxReviewRounds 3`). The author does not approve. Criteria 1–6 were independently confirmed on the final content in round 2.

## Recommended status
`in_review` — ST acceptance pending; separate IMP-08 parent acceptance remains with Command under §20.2.10 (no IMP_RECEIPT claimed).
