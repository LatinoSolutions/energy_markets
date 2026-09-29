# SEM-3 backend contract and frontend migration

SEM-3 implements the backend-only revision of intake `D-20260929T155913-f260`.
The frontend task owned by Claude follows acceptance of SEM-3. No presentation,
layout, chart, or visual hierarchy is changed here.

## Canonical payload

`canonicalSemantics.current` contains source-bound `clientsByMission`,
`benchmarksByMission`, canonical `hypotheses`, current `results`, and
`experiments` by mission and hypothesis. CONTROL exists only as an experiment's
bound `control`; with no valid current run the experiment is `UNBOUND` with
`active: null` and `control: null`. Four mission results remain separate.
`canonicalSemantics.historicalEvidence.byMission` contains verified exploratory
runs with raw aliases, release, artifact path/hash, optional `lineageOf`, and
explicit false current/tested/runnable/equivalence claims. A raw key containing
`/CLIENT` has no authority over canonical CLIENT.

Current BT-08 result ingestion requires the Development/TOB job kind and family,
canonical hypothesis version and mission, a `HYP-RUN` identity, receipt and
results/manifest pointers in the same attempt, SHA-256 hashes, and a complete
CONTROL/active experiment binding. The BT-08 runner verifies source bytes and
hashes before publishing those pointers. The projection rejects incomplete or
cross-bound inputs as `UNAVAILABLE`; they do not enter `current.results`.

## Temporary frontend compatibility

The pre-migration renderers still consume `legacyAdapter`, `legacyCandidates`,
and `historicalRuns` at the old locations. `legacyAdapter` and
`legacyCandidates` are explicitly marked `deprecated`; their old `role` and
`hypothesisId` fields are lineage labels for historical detail rendering only.
They cannot populate `current`, active CONTROL, canonical hypothesis results,
or tested/runnable state. The source adapter itself exposes `historicalKind` and
`lineageOf`, with no canonical identity or hypothesis result ID.

Claude's later UI task should read `current` for Results/Comparison and nested
ablation, and `historicalEvidence` for the folded provenance area. It should
remove reads of `legacyAdapter`, `legacyCandidates`, `historicalRuns`, and any
hardcoded CONTROL 11:00 or current-looking hypothesis rows from renderers and
view models. The deprecated fields can then be deleted. Historical artifact
bytes and their source keys stay immutable.
