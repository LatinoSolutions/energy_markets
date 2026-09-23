# ST-08.5 change review

## Scope

Packet `WP-IMP-08-ST-5-v1.1`, subtask `ST-08.5`, parent `IMP-08`, corrective continuation from [LAT-194](/LAT/issues/LAT-194) for [LAT-178](/LAT/issues/LAT-178). The frozen SPEC is v1.1 with SHA-256 `86c4bd4eeb5f9d0ebad94763128b221eb64525a2b7fff1007dab0af88b39cb6c`.

## Change

- Added a local `isValidCompleteCost` predicate that checks object-ness, `status === "known"`, and finite numeric `value`.
- Replaced the truthiness check on `Array.find` with `findIndex(...) !== -1`. Falsy invalid elements and sparse holes therefore fail closed before `reduce`.
- Preserved the established unavailable/rejected result and exact reason; no value coercion, unit conversion, zero substitution, or new economic meaning was introduced.
- Added direct `costsComplete:true` regressions for null, undefined, sparse hole, scalar primitives, empty/malformed objects, non-finite values, invalid statuses, plus valid finite, known-zero, empty-complete, and invalid-base-unit controls.

## Evidence mapping

| Criterion | Evidence |
|---|---|
| 1–2 | `src/economic-calculation/bhv.mjs`; malformed matrix in `test/economic-calculation/bhv.test.mjs`; `reproducer.txt` |
| 3–5 | `bhv.test.mjs` ST-08.5 tests; 56/56 economic tests; exact result object assertions |
| 6 | `tests.tap`: economic 56/56, contracts 67/67, ST-08.3 regressions 9/9, fixture oracle exit 0; historical ST-08.3 verifier limitation recorded |
| 7 | `baseline-hashes.txt`, `final-hashes.txt`, `manifest.json`; protected nine-file hash set unchanged |
| 8 | `operations/receipts/IMP-08-ST-5.json` |
| 9 | Native review is requested from independent Tech Lead Astra; author is not the reviewer |

## Protected history and limits

The reviewed ST-08.3 source/test bytes were the starting comparison baseline. Prior ST-08.1/ST-08.2/ST-08.3 receipts, manifests, reviews, oracle files, SPEC and bootstrap files were not edited. The ST-08.3 delivery verifier remains historical and exits 1 only because its content hash is intentionally pinned to the pre-ST-08.5 reviewed bytes; it was not rewritten. No IMP_RECEIPT, real campaign, production activation, purchase, trading action, or DEP-13 closure is claimed.

## Author boundary

This document is an author handoff and recommendation only. It is not an approval or parent IMP acceptance. The next action is one native independent Astra review of the exact delivered bytes, followed by the separate Command evaluation of the IMP-08 parent together with ST-08.4.
