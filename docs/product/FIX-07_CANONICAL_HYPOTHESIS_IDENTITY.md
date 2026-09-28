# FIX-07 · Canonical Hypothesis identity & naming

Version: `FIX-07/2026-09-28/v1`. Authority: intake `D-20260928T135440-85ac` (owner naming convention, 2026-09-28) and its operative revision `20260928-pipeline-v2`, read with SEM-1 and the accepted HYP-1 definition (`docs/product/H-S1-01_SESSION_ANCHORED_ROLLING_REFERENCE.md`). This contract does not rewrite historical artifacts or run anything.

Single backend contract: `src/backtesting-semantics/contract.mjs` (SEM-1 extended by FIX-07). There is no second hypothesis registry.

## Naming

| Origin | Format | Example |
|---|---|---|
| Derived from one Strategy | `H-S<strategy>-<nn>` | `H-S1-01`, `H-S2-01` |
| Multiple Strategies (deterministically ordered refs) | `H-S<...><...>-<nn>` | `H-S1S3-01` |
| Research Discovery, no evidenced Strategy parent | `H-RD-<nn>` | `H-RD-01` |

The suffix is sequential within its family. The ID never encodes performance, phase, campaign or mission, and a published ID is not recycled for another question. `canonicalHypothesisId()` is a pure function of origin family, canonical Strategy refs and sequence; `verifyCanonicalHypothesisId()` re-derives it.

## Identity fields

`H_S1_01` / `H_RD_01` / `createHypothesisIdentity()` produce a frozen record with:

- `hypothesisId`, `originType` (`STRATEGY_DERIVED` | `MULTI_STRATEGY` | `RESEARCH_DISCOVERY`), `strategyRefs` (canonical, sorted).
- `name`, `question`, `version` (proposition/config version; recalibration advances it without changing the ID).
- `missions` (canonical mission ids) + `applicabilityStatus` (`DECLARED`/`UNDECLARED`).
- `provenance` (`authority` + `locator`), `aliases`, `legacy`, `hypothesisHash`.

H-S1-01 consumes the accepted HYP-1 `name`/`question`/`version`/`contentHash`; legacy `DIP10` is provenance only, never its identity or evidence.

## Separation of entities

`createExperimentBinding()` is the single adapter for BT-08/UI-08 and keeps these distinct:

- Strategy refs (`strategyRefs`), Hypothesis (`hypothesisId`/`hypothesisVersion`), mission (`missionId`), configuration (`configurationHash`), experiment (`experimentId`), CONTROL (bound `control`), technical arm (`technicalArmId`), Run (`runId`).
- `technicalArmId` and `runId` may not equal the hypothesis or experiment id (`IDENTITY_COLLISION`).
- CONTROL must be a bound `controlFor()` record for the same hypothesis and run (`INVALID_CONTROL_BINDING`).

## Mission configurations and evidence

`createMissionConfiguration()` binds one `H-S1-01` ID to one mission and one configuration (tau/N, data mode, calibration) with a content hash. The same ID supports four independent configurations; mission is never encoded in the ID.

`evaluateHypothesisStatus()` returns `UNTESTED` without evidence. A version/config/run/mission mismatch cannot yield `TESTED` — it stays `HOLD` with the mismatched fields, and tampered configuration hashes fail as `CONFIGURATION_INTEGRITY`. Cross-mission substitution is rejected.

## Versioning and history

`classifyHypothesisChange()` distinguishes `RECALIBRATION` (same ID, same question, version advances, `supersedes`/`canonical` lineage) from `NEW_PROPOSITION` (new ID). The same question may not be split across new IDs (`RECALIBRATION_MUST_KEEP_ID`).

Legacy `DIP10`/`HOUR`/`ARM_A`/`ARM_B` resolve only through `resolveLegacyHypothesisAlias()` to `PROVENANCE_ONLY` (`tested:false`, `runnable:false`, `sizingParityClaim:false`). Wrong artifact/version, a CLIENT claim, or a fabricated evidence status is rejected. `A0`/`A1` keep their SEM-1 replay-arm semantics (`resolveLegacyAlias`) and never become the active hypothesis or CLIENT.

## Boundaries

CLIENT, one BENCHMARK and canonical HYPOTHESES remain separate primary identities; CONTROL is the paired experimental counterpart only. No A0/A1/BASELINE/ARM_A/B or B/B\* is a primary product name. Unknown CLIENT economics stay `UNKNOWN`. This contract performs no run, OOS opening or historical re-evaluation; BT-08 owns execution binding and UI-08 owns presentation.
