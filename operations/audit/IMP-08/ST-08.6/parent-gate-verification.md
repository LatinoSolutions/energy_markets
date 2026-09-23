# IMP-08 / ST-08.6 — Parent-gate verification (readable)

- Packet: `WP-IMP-08-ST-6-v1.1`, subtask `ST-08.6`, parent `IMP-08`, project Energy Markets `96bbd5b1-94da-4781-8c2b-455fdfb28d1a`, native root [LAT-91](/LAT/issues/LAT-91), issue [LAT-229](/LAT/issues/LAT-229).
- Host `brunode`, workspace `/srv/hot-data/energy-markets/app`, branch `main` (unborn; content-hash baseline).
- SPEC `PROCUREMENT_RESEARCH_CANONICAL_ENGINEERING_SPEC_v1_1.md` v1.1, sha256 `86c4bd4e…39cb6c` (verified).
- Execution instance: `synthetic B/H/V calculation and mission-specific scoring, protocol v1` (distinct from the SPEC/schema version 1.1). The proposal and ST_RECEIPT bind `protocol v1`; the verifier fails on any `protocol v1.1` drift.
- Authority: **NON-AUTHORITATIVE staging only.** This document proves readiness and prepares exact inputs. It does not accept IMP-08, does not create an `IMP_RECEIPT` and does not unlock IMP-13/IMP-15.

## 1. Native lineage reconciliation (acceptance criterion 1)

All five required IMP-08 children exist with a final native approval. Author ≠ reviewer in every child.

| Subtask | Issue | Author route | ST_RECEIPT sha256 | Resulting content hash | changes_requested history | Final native approval |
|---|---|---|---|---|---|---|
| ST-08.1 | [LAT-126](/LAT/issues/LAT-126) | DeepSeek V4.1 Flash (OpenRouter) `2f30b8dd` | `1d2a6482…` | `d8728e10…` | none | IR `0af74a08` approved, decision `473757cf`, comment `234c54fc` |
| ST-08.2 | [LAT-157](/LAT/issues/LAT-157) | DeepSeek V4.1 Flash (OpenRouter) `2f30b8dd` | `121eceaf…` | `8d1ce8f2…` | 2 comment rounds (`db24bcc3`, `0e7b98e8`) + TL FINAL-ACCEPTANCE correction `c1a05299` → ST-08.3 | IR `0af74a08` approved, decision `7641d5d4`, comment `bb3c2094` |
| ST-08.3 | [LAT-178](/LAT/issues/LAT-178) | Luna `6c548bcb` (codex, gpt-5.6-luna, high) | `4de94095…` | `140c8128…` | R1 `1a9edecb`, R2 `0d50c33e`, R3 `39961cfd` (board reviewer, IR quota exhausted) | board/user participant approved, decision `7af7ec2f`, comment `e5f22db2` |
| ST-08.4 | [LAT-191](/LAT/issues/LAT-191) | DeepSeek V4.1 Flash (OpenRouter) `2f30b8dd` | `43fe0b9b…` | `a70044d9…` | R1 `56b79cc1`, R2 `a72d657d`, R3 `840c1bae` (+ board re-auth `1a0a65ab`), R4 `bc0ded02`, R5 `3c00c32b` | IR `0af74a08` approved rev5, decision `c1532101`, comment `e14f90bf` |
| ST-08.5 | [LAT-195](/LAT/issues/LAT-195) | Luna `6c548bcb` | `ee42418e…` | `bc0ce6ad…` (current accepted) | none | TL participant as independent reviewer (Sol High) approved, decision `f0d45fae`, comment `457cce45` |

[LAT-170](/LAT/issues/LAT-170) is recorded **only** as read-only operational routing provenance (stale blocker edge removal); it is not an accepted ST and not economic evidence.

Current accepted semantic version = **ST-08.5** `bc0ce6adef42831da21c9339c6569018a8c6b03a587558372ace336d4f661528` (algorithm C) = `96e73ef9ce63aea6bd39934cebc17cdc656f3f0d9ef576700739e39afa914f6e` (algorithm A). ST-08.2 and ST-08.3 hashes are superseded and preserved.

## 2. Frozen parent acceptance tests reproduced from clean commands (criterion 2)

| Test | Command | Expected | Observed |
|---|---|---|---|
| Oracle fixtures | `/opt/node/bin/node operations/audit/IMP-08/fixture-oracle/verify.mjs` | exit 0, 35 fixtures, C01–C12, 7 negative probes | **exit 0**; fixtures=35; C01–C12 covered; 7/7 probes PASS |
| Economic tests | `/opt/node/bin/node --test test/economic-calculation/*.test.mjs` | 56 pass, 0 fail | **56 pass, 0 fail** |
| Contract tests | `/opt/node/bin/node --test test/contracts/*.test.mjs` | 67 pass, 0 fail | **67 pass, 0 fail** |
| ST-08.3 regression | `/opt/node/bin/node --test operations/audit/IMP-08/ST-08.3/regression.test.mjs` | 9 pass, 0 fail | **9 pass, 0 fail** |
| ST-08.5 delivery | `/opt/node/bin/node operations/audit/IMP-08/ST-08.5/verify-delivery.mjs` | PASS, semanticHash `bc0ce6ad…` | **PASS**; artifacts=11; protectedHashes=9 unchanged; semanticHash=`bc0ce6ad…4f661528` |
| ST-08.4 dossier | `/opt/node/bin/node operations/audit/IMP-08/ST-08.4/verify-st4.mjs` | PASS, accepted ST-08.5 + approved dossier lineage | **PASS**; pins=9; payloadFiles=86; currentAcceptedST085_C=`bc0ce6ad…` A=`96e73ef9…` |

Exact stdout/exit codes are captured in `tests.tap`. Hashes before/after in `baseline-hashes.txt` / `final-hashes.txt`.

## 3. SPEC §25.1 IMP-08 requirement → direct evidence (criterion 3)

Every requirement maps to a concrete fixture, test or verifier assertion. Missing proof would be a failed readiness result; none is missing.

- **Reproducible B/H/V** — `src/economic-calculation/bhv.mjs`; fixtures `FX-BHV-POSITIVE/NEGATIVE/ZERO`; `bhv.test.mjs`.
- **+4/−1** — `FX-C09-SCORING-POS-NEG`: n=2, p=0.5, μ=1.5, R=C=4, σ_down=1, Sortino=1.5.
- **+3/−1** — `FX-C10-SCORING-SORTINO-1`: μ=1, R=C=3, Sortino=1; does **not** pass the strict `>1` screen.
- **+2/−2** — `FX-C11-SCORING-ZERO-MEAN`: μ=0, R=C=1, σ_down=2, Sortino=0.
- **Neutral addition; n_nonzero separate from n_total** — `FX-C09-NEUTRAL-ADDITION` (+4/−1/0 → n_nonzero=2, n_total=3).
- **n<2** — `FX-C12-N-LT-2` (n−1 denominator unusable).
- **Only-positive** — `FX-C12-ONLY-POSITIVES` (A/R/C undefined, σ=0, Sortino undefined).
- **Only-zero** — `FX-C12-EXACT-ZERO-ONLY` (n_nonzero=0, all undefined).
- **Empty denominator / empty winner group** — `FX-C12-EMPTY-POPULATION`, `FX-C12-EMPTY-WINNER-GROUP`, `FX-BHV-UNDEFINED-RATIO-NO-PASS`.
- **Undefined ratios never PASS** — oracle negatives (`scoring-tamper`, `undefined-without-reason`); economic test “un ratio indefinido nunca se convierte en PASS”.
- **Quarterly strict Sortino>1** — `FX-C10`; `scoring.test.mjs` quarterly screen.
- **Monthly mission separation** — `FX-MONTHLY-NO-SORTINO-IMPORT`, `FX-MONTHLY-ONLY-POSITIVE-NO-HOLD`, `FX-MONTHLY-REASON-DISCRIMINA`.
- **Valid/invalid reference selection and daily dedup** — fixtures C01–C08; ST-08.3 regression R1–R4 (9/9 pass).
- **Complete/malformed costs fail closed; unknown never zero** — `FX-BHV-MISSING-FEE`, `FX-BHV-INCOMPLETE-COVERAGE`; ST-08.5 `bhv.mjs` correction; regression R5–R6.
- **Compatible units, explicit coverage, no inferred MW→MWh** — `FX-BHV-UNITS-INCOMPATIBLE`, `FX-BHV-TOTAL-EUR-NO-MWH`.
- **C diagnostic only** — `FX-BHV-C-DIAGNOSTIC`; economic test “C no es un gate de research”.
- **n−1, target 0, no epsilon, no annualization** — fixture metadata `epsilonUsed=false`, `annualizationUsed=false`; C09/C10/C11 exact values.

## 4. SPEC §20.2.10 prerequisites (criterion 4)

- Project ON: Energy Markets `in_progress`, `pausedAt null`. Alexandria OFF/paused.
- Accepted IMP-01 exact scope/version: `operations/receipts/IMP-01-IMP_RECEIPT.json` sha256 `78d92de8…`, outcome accepted.
- All required children reviewed/accepted: ST-08.1…ST-08.5 each done with a final native approval (table §1).
- No unresolved applicable SPEC conflict: no `SPEC_CHANGE_REQUEST` exists for IMP-08.
- Frozen decisions preserved: the 15 frozen decisions are mapped in `parent-gate-inputs.json`.
- **REQUIRES_AUDIT / REQUIRES_EVIDENCE:** SPEC §25.2 IMP-08 row is `—`/`—` for the implementation/fixtures objective. **No DEP is thereby satisfied**; DEP-13 and any real campaign evidence remain open, and real use still requires accepted IMP-05/07.

## 5. Proposed receipt is non-authoritative (criterion 5)

`proposed-imp-receipt.json`: `receiptKind=PROPOSED_IMP_RECEIPT`, `outcome=proposed`, `acceptanceStatus=NOT_ACCEPTED`, `parentAcceptancePending=true`, `claims=[]`, **no `acceptedAtUtc`**. It is never written to `operations/receipts/IMP-08-IMP_RECEIPT.json` (that file does not exist).

The guard was progressively hardened across reviewer rounds 1-5. `authority-guard.mjs` now enforces **both** an explicit key schema per node over **structural token paths** (arrays validated as arrays, so a key literally named `requiredStIdentities[99]` cannot impersonate an element path) **and value-level rules**: unexpected/alias keys fail; `result`/`status`/`outcome`/`verdict`/`acceptanceStatus`/`*kind` are constrained to the exact structural allowlist with the ST-08.6 lineage asserted `pending`; `sha256`/`contentHash` must be 64-hex; `dependencyUpdate` must state `None`; each `potentialUnlocks` element must state it is `not granted`; and a negation-aware scanner rejects fabricated DEP-satisfaction and unlock claims in any string value, including string-array elements. Thirty-eight negative probes are recorded in `authority-guard-probes.txt` (38/38 rejected, clean control ok, ST-08.6 pending), and the verifier asserts them plus exact `receiptKind`/`_kind === "PROPOSED_IMP_RECEIPT"`, the ST-08.6 pending lineage, and the `protocol v1` instance binding.

## 5b. Publication path (criterion 7)

The evidence bundle and the readable verification are published on [LAT-229](/LAT/issues/LAT-229) as attachment-backed artifact work products (reviewer round-1 finding), the issue-native `st-receipt` document is republished through safe JSON encoding so the fenced payload parses and is semantically identical to the local receipt (reviewer round-2 finding), and the `continuity-checkpoint` document is republished byte-exact with the fragile newline escape removed (reviewer round-3 finding). Local paths alone are not treated as the deliverable.

## 6. Residual limits and risks

- Synthetic engineering evidence only; not DEP-13, not a research PASS, not production authority.
- Disclosed historical lineage defect: ST-08.3 baseline reference `8d1ce8f2…df8b1b…` vs accepted ST-08.2 recomputed content hash `8d1ce8f2…df1b1b…`. Predecessor bytes preserved untouched; recorded for Command assessment, not a semantic defect.
- ST-08.2/ST-08.3 semantic hashes superseded by ST-08.5.
- This packet produces no `IMP_RECEIPT`; a separate bounded Tech Lead parent gate under §20.2.10 is required.