# SOURCE RECORD (verbatim body copy)
- issue: LAT-195 (ST-08.5)
- key: `test-evidence`
- title: ST-08.5 test evidence
- revisionId: e3fffc6b-5376-4d47-9776-d011f7464e25
- createdByAgentId: 6c548bcb-e6aa-43ea-9c6c-319497cbe6a9
- createdByUserId: None
- updatedAt: 2026-09-21T10:47:14.710Z

---

# ST-08.5 test evidence

## Tests

```text
ST-08.5 required test execution (actual commands and observed outputs)
Workspace: brunode /srv/hot-data/energy-markets/app / main

$ hostname
brunode
exit=0

$ pwd
/srv/hot-data/energy-markets/app
exit=0

$ /opt/node/bin/node --check src/economic-calculation/bhv.mjs
exit=0

$ /opt/node/bin/node --test test/economic-calculation/*.test.mjs
output: node:test default reporter; tests 56, pass 56, fail 0, cancelled 0, skipped 0
included: ST-08.5 malformed complete cost elements; valid finite/known-zero controls; invalid base unit
exit=0

$ /opt/node/bin/node --test test/contracts/*.test.mjs
output: node:test default reporter; tests 67, pass 67, fail 0, cancelled 0, skipped 0
exit=0

$ /opt/node/bin/node --test operations/audit/IMP-08/ST-08.3/regression.test.mjs
output: node:test default reporter; tests 9, pass 9, fail 0, cancelled 0, skipped 0
exit=0

$ /opt/node/bin/node operations/audit/IMP-08/fixture-oracle/verify.mjs
output: SPEC/protected inputs match; fixtures=35; C01-C12 complete; all seven negative probes PASS; RESULT exit=0
exit=0

$ /opt/node/bin/node operations/audit/IMP-08/ST-08.3/verify-delivery.mjs
verify-delivery: FAIL: manifest content hash is stale
exit=1
Interpretation: expected historical limitation. ST-08.3 verifier is hash-pinned to the reviewed pre-ST-08.5 semantic bytes; its historical artifacts were not modified. The new ST-08.5 verifier validates the corrected delta.

Required protected-hash command before/after:
$ sha256sum docs/canonical/PROCUREMENT_RESEARCH_CANONICAL_ENGINEERING_SPEC_v1_1.md operations/bootstrap/baseline-manifest.json operations/receipts/IMP-01-IMP_RECEIPT.json operations/receipts/IMP-08-ST-1.json operations/audit/IMP-08/fixture-oracle/fixtures.json operations/audit/IMP-08/fixture-oracle/independent-calculations.md operations/receipts/IMP-08-ST-2.json operations/receipts/IMP-08-ST-3.json operations/audit/IMP-08/ST-08.3/manifest.json
output: recorded in baseline-hashes.txt and final-hashes.txt; all nine listed hashes unchanged
exit=0

Additional required commands and outputs are retained verbatim in reproducer.txt:
- LAT-194 exact reproducer with costsComplete=true: all malformed values return the established unavailable/rejected object; known-zero remains H=100; no throw.
- ST-08.5 matrix: null, undefined, sparse hole, number, string, boolean, {}, missing value, NaN, Infinity, unknown/invalid status all fail closed; valid control returns H=102.5; no throw.
```

## Verification

ST-08.5 delivery verification record

## Environment

- host: `brunode`
- cwd: `/srv/hot-data/energy-markets/app`
- branch: `main`
- packet: `WP-IMP-08-ST-5-v1.1` / `ST-08.5`
- source comparison: reviewed ST-08.3 semantic hash `140c8128eec122c295ac5b19ca1636a59674b8ea9f6706a827e21ba2bb5fc6f2`
- resulting semantic hash: `bc0ce6adef42831da21c9339c6569018a8c6b03a587558372ace336d4f661528`

## Required test status

- Economic suite: 56/56 pass, exit 0.
- Contract suite: 67/67 pass, exit 0.
- ST-08.3 regression suite: 9/9 pass, exit 0.
- Fixture oracle: 35 fixtures, C01–C12 complete, negative probes PASS, exit 0.
- Exact LAT-194 reproducer and malformed matrix: no throws; malformed complete elements unavailable/rejected; valid controls finite.
- SPEC and nine protected historical pins: unchanged.

## Historical verifier boundary

Command:

```text
/opt/node/bin/node operations/audit/IMP-08/ST-08.3/verify-delivery.mjs
```

Observed: `verify-delivery: FAIL: manifest content hash is stale`, exit 1. This is expected because the historical ST-08.3 verifier is pinned to the pre-ST-08.5 reviewed semantic bytes. No ST-08.3 artifact was rewritten.

## ST-08.5 verifier

Command:

```text
/opt/node/bin/node operations/audit/IMP-08/ST-08.5/verify-delivery.mjs
```

Observed:

```text
verify-delivery: PASS; artifacts=11; protectedHashes=9 unchanged; semanticHash=bc0ce6adef42831da21c9339c6569018a8c6b03a587558372ace336d4f661528; receipt=in_review; reviewer=Astra
exit=0
```

The isolated verifier checks all required artifact hashes, protected hashes, semantic content hash, receipt identity, review independence, and absence of a parent IMP_RECEIPT.
