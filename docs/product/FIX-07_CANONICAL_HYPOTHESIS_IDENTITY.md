# FIX-07 · Canonical Hypothesis identity & naming

Version: `FIX-07/2026-09-28/v1`. Authority: intake `D-20260928T135440-85ac` (owner naming convention, 2026-09-28) and its operative revision `20260928-pipeline-v2`, read with SEM-1 and the accepted HYP-1 definition (`docs/product/H-S1-01_SESSION_ANCHORED_ROLLING_REFERENCE.md`). This contract does not rewrite historical artifacts or run anything.

Single backend contract: `src/backtesting-semantics/contract.mjs` (SEM-1 extended by FIX-07). There is no second hypothesis registry.

## Naming

| Origin | Format | Example |
|---|---|---|
| Derived from one Strategy | `H-S<strategy>-<nn>` | `H-S1-01`, `H-S2-01` |
| Multiple Strategies (deterministically ordered refs) | `H-S<...><...>-<nn>` | `H-S1S3-01` |
| Research Discovery, no evidenced Strategy parent | `H-RD-<nn>` | `H-RD-01` |

The suffix is sequential within its family. The ID never encodes performance, phase, campaign or mission, and a published ID is not recycled for another question or a narrower mission scope. A published identity keeps its accepted applicability: a recalibration that declares only a subset of the accepted missions is rejected (`PUBLISHED_SCOPE_COLLISION`). `canonicalHypothesisId()` is a pure function of origin family, canonical Strategy refs and sequence; `verifyCanonicalHypothesisId()` re-derives it.

## Identity fields

`H_S1_01` / `H_RD_01` / `createHypothesisIdentity()` produce a frozen record with:

- `hypothesisId`, `originType` (`STRATEGY_DERIVED` | `MULTI_STRATEGY` | `RESEARCH_DISCOVERY`), `strategyRefs` (canonical, sorted).
- `name`, `question`, `version` (proposition/config version; recalibration advances it without changing the ID).
- `missions` (canonical mission ids) + `applicabilityStatus` (`DECLARED`/`UNDECLARED`).
- `provenance` (`authority` + `locator`), `aliases`, `legacy`, `hypothesisHash`.

H-S1-01 consumes the accepted HYP-1 `name`/`question`/`version`/`contentHash`; legacy `DIP10` is provenance only, never its identity or evidence. The record validator requires `id === hypothesisId` and checks a directly supplied H-S1-01 against its published name, question, Strategy refs, four-mission scope, provenance and definition hash. Recreating the published version through `createHypothesisIdentity()` retains that hash only with the accepted provenance; contradictory provenance is rejected (`PUBLISHED_PROVENANCE_MISMATCH`). A proposed later version remains unbound until its new source definition is accepted; the current HYP-1 hash cannot authorize its configuration or run.

## Separation of entities

`createExperimentBinding()` is the single adapter for BT-08/UI-08 and keeps these distinct:

- Strategy refs (`strategyRefs`), Hypothesis (`hypothesisId`/`hypothesisVersion`), mission (`missionId`) and campaign (`campaignId`), configuration (`configurationHash`), candidate/search-space references (`candidateMission`/`searchSpaceMission`, `candidateHash`/`searchSpaceHash`), experiment (`experimentId`), CONTROL (bound `control`), technical arm (`technicalArmId`), Run (`runId`).
- The `configurationHash` is re-derived from the configuration core; an altered hash fails as `CONFIGURATION_INTEGRITY`. Campaign and mission-bound candidate/search-space references are required (`MISSING_CAMPAIGN_ID`/`MISSING_CANDIDATE_BINDING`).
- Declared `tau`/`N` must equal the bound candidate's `candidateTau`/`candidateN` (`PARAMETER_CANDIDATE_MISMATCH`).
- `technicalArmId` and `runId` may not equal the hypothesis or experiment id (`IDENTITY_COLLISION`).
- CONTROL is required and must be a bound `controlFor()` record for the same hypothesis, run and campaign (`MISSING_CONTROL_BINDING`/`INVALID_CONTROL_BINDING`).

## Mission configurations and evidence

`createMissionConfiguration()` binds one `H-S1-01` ID to one mission, one candidate and one search space (tau/N, data mode, calibration) with a content hash. Candidate and search-space references are mission-scoped: a Power configuration cannot borrow a Gas candidate/search space (`CROSS_MISSION_CONFIGURATION`), and declared `tau`/`N` must match the candidate's values (`PARAMETER_CANDIDATE_MISMATCH`). Both source artifacts must match their own content hashes: an altered search space is rejected (`SEARCH_SPACE_INTEGRITY`), and a candidate whose `N` was altered without rehashing is rejected (`CANDIDATE_INTEGRITY`). Rehashing either artifact cannot replace its `hypothesisHash`: search space and candidate must both refer to the accepted HYP-1 definition (`HYPOTHESIS_DEFINITION_MISMATCH`). An unaccepted definition/version fails as `UNBOUND_HYPOTHESIS_DEFINITION`. The same ID supports four independent configurations; mission is never encoded in the ID.

`evaluateHypothesisStatus()` returns `UNTESTED` without evidence. A version/config/run/mission mismatch cannot yield `TESTED` — it stays `HOLD` with the mismatched fields, and tampered configuration hashes fail as `CONFIGURATION_INTEGRITY`. Cross-mission substitution is rejected. Evidence cannot prove itself: a `TESTED` state additionally requires a verified experiment binding (`experiment`) for the same hypothesis, mission, configuration and run, a paired CONTROL of the same campaign, plus traceable provenance (`authority`/`locator`/`artifactSha256`).

## Versioning and history

`classifyHypothesisChange()` distinguishes `RECALIBRATION` (same ID, same question, version advances, `supersedes`/`canonical` lineage) from `NEW_PROPOSITION` (new ID). A transition without a version advance is rejected (`NO_VERSION_ADVANCE`) and so is a version rollback (`VERSION_ROLLBACK`); two spellings of the same ordinal (e.g. `v2` vs `v02`) do not advance and are rejected too, and the same question may not be split across new IDs (`RECALIBRATION_MUST_KEEP_ID`). A published ID cannot be redefined with another name/question (`PUBLISHED_IDENTITY_COLLISION`) nor lose its accepted mission scope (`PUBLISHED_SCOPE_COLLISION`), though a recalibration may advance its version while preserving that scope.

Legacy `DIP10`/`HOUR`/`ARM_A`/`ARM_B` resolve only through `resolveLegacyHypothesisAlias()` to `PROVENANCE_ONLY` (`tested:false`, `runnable:false`, `sizingParityClaim:false`). The mapping must be run-scoped (`runId` + `provenance`); a bare alias with a hash is rejected. Wrong artifact/version, a CLIENT claim, or a fabricated evidence status is rejected. `A0`/`A1` keep their SEM-1 replay-arm semantics (`resolveLegacyAlias`) and never become the active hypothesis or CLIENT.

## Boundaries

CLIENT, one BENCHMARK and canonical HYPOTHESES remain separate primary identities; CONTROL is the paired experimental counterpart only. No A0/A1/BASELINE/ARM_A/B or B/B\* is a primary product name. Unknown CLIENT economics stay `UNKNOWN`. This contract performs no run, OOS opening or historical re-evaluation; BT-08 owns execution binding and UI-08 owns presentation.
