# SOURCE RECORD (verbatim comment copy)
- issue: LAT-191
- commentId: bc0ded02-436e-47e6-babf-459dc838bae7
- authorAgentId: 0af74a08-cb39-4cf5-a94f-117b242ea08c
- authorUserId: None
- createdAt: 2026-09-21T21:23:25.706Z

---

## Changes requested — historical hash and review-source lineage must be reconciled

The rev3 current-version correction is technically sound: accepted ST-08.5 bytes, payload/archive hashes, downloads, work products and current-version verifier all pass. Approval is blocked by two factual lineage defects in the parent-acceptance dossier.

### Findings

1. **ST-08.2 has two incompatible historical content hashes with no disclosure.** The accepted ST-08.2 receipt `121eceaf…` records—and recomputation from its nine artifact hashes confirms—`8d1ce8f29f8474379082df1b1b294dc1838ba753c2a6d1586b2136e2524416fe`. The frozen ST-08.3 receipt/manifest instead reference `8d1ce8f29f8474379082df8b1b294dc1838ba753c2a6d1586b2136e2524416fe`. Rev3 correctly uses the first value in `native-review-lineage.json` for ST-08.2, but incorrectly labels the second value as the ST-08.2 aggregate in `version-binding.json` and the ST_RECEIPT. This violates the required hash reconciliation and makes the historical chain ambiguous.
2. **The Sol High review route cites the wrong source record.** Matrix, binding, lineage and receipt cite [LAT-191 round 3](/LAT/issues/LAT-191#comment-840c1bae-89ab-4de3-acfd-aa982c7a18d1), which is this reviewer’s changes-requested comment, not the ST-08.5 approval record. The authoritative source is the [LAT-195 approval comment](/LAT/issues/LAT-195#comment-457cce45-8d57-4915-9968-95a11fc640b4), plus native decision `f0d45fae-3f59-45dd-b389-9f32e7442ded`. The payload currently archives only a minimal handcrafted `LAT-195--native-approval.json`; it omits the actual approval body, comment id, author and recorded Sol High route.

### Independent verification

- `verify-delivery.mjs` for ST-08.5: PASS, semantic hash `bc0ce6ad…4f661528`; historical ST-08.3 verifier: expected exit 1.
- `verify-st4.mjs`: PASS, 83 files, payload `fa98b0bd…b795e6`, current A/C hashes correct, archive `8ecd4287…17aa1`.
- All 11 declared pins match. Current accepted source/test/docs copies are byte-identical to live files.
- Payload checksums, downloaded rev3 archive/matrix/binding byte comparisons and extracted checksums pass.
- Recomputing algorithm A directly from the accepted ST-08.2 receipt yields `…df1b1b…`, confirming that `…df8b1b…` is a predecessor baseline-reference defect rather than the accepted ST-08.2 content hash.

### Required correction

- Preserve all predecessor bytes unchanged. Record accepted ST-08.2 as `…df1b1b…`; explicitly disclose the frozen ST-08.3 `…df8b1b…` baseline-reference mismatch as a historical lineage defect/residual for Command assessment. Add a verifier assertion so the two roles cannot be conflated again.
- Archive the full [LAT-195 approval comment](/LAT/issues/LAT-195#comment-457cce45-8d57-4915-9968-95a11fc640b4) with source metadata and point matrix/binding/lineage/receipt to that record and decision `f0d45fae`; retain the prior [LAT-191](/LAT/issues/LAT-191) review history separately.
- Refresh checksums, archive, issue documents and current attachment-backed work products; rerun the same bounded publication checks. Do not change product code, predecessor evidence or parent acceptance.

If the one-cycle recovery authority does not cover this newly discovered index-only defect, return it as the packet’s typed `no_guess` blocker to Command rather than asserting the lineage is reconciled. No `IMP_RECEIPT` or parent acceptance is granted.