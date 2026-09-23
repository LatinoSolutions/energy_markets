# SOURCE RECORD (verbatim comment copy)
- issue: LAT-191
- commentId: 840c1bae-89ab-4de3-acfd-aa982c7a18d1
- authorAgentId: 0af74a08-cb39-4cf5-a94f-117b242ea08c
- authorUserId: None
- createdAt: 2026-09-21T21:04:02.978Z

---

## Changes requested — accepted ST-08.5 makes the parent dossier stale

The rev2 archive is internally hash-consistent, but it no longer represents the current accepted IMP-08 child set.

- [LAT-195](/LAT/issues/LAT-195) reached native `done/approved` at `2026-09-21T16:00:28Z`, decision `f0d45fae-3f59-45dd-b389-9f32e7442ded`, after independent Sol High review. Its accepted semantic hash is `bc0ce6adef42831da21c9339c6569018a8c6b03a587558372ace336d4f661528`.
- This dossier still says [LAT-195](/LAT/issues/LAT-195) is `in_review`, `accepted:false`, and labels its current bytes `ORIGINAL_DRIFT_UNACCEPTED`. `version-binding.json`, `native-review-lineage.json`, `parent-readiness.md`, the payload index, and the ST_RECEIPT all preserve that now-false state.
- The dossier itself requires reconsolidation if ST-08.5 becomes accepted. Therefore the current publication cannot be handed to the §20.2.10 parent gate as the complete current evidence set. Acceptance criteria 1–3 and 6 remain unsatisfied despite internal archive fidelity.

### Independent checks

- Authorized environment: `brunode:/srv/hot-data/energy-markets/app`.
- All original nine pins match; ST-08.5 receipt `ee42418e…efee71` and manifest `3cfe1efc…eee5f209` also match.
- `verify-st4.mjs`: exit 0, 59 files, payload `bab6a14d…8d5fcb`, archive `91841586…015129`. This only proves the historical ST-08.3 snapshot plus the recorded drift; its output still calls ST-08.5 unaccepted.
- Historical ST-08.3 live verifier: expected exit 1 (`manifest content hash is stale`). Payload checksums, downloaded rev2 archive/matrix/version-binding hashes, byte comparisons, and extracted checksums all pass.
- The issue primary work product still points to the superseded first archive `27bdb117…`; rev2 exists only as a non-primary work product.

### Required correction

1. Re-consolidate the parent-readiness dossier against accepted [LAT-195](/LAT/issues/LAT-195): include its receipt, manifest, evidence and native approval decision in lineage and payload, and treat its reviewed bytes as the current accepted version rather than unaccepted drift.
2. Refresh matrix, lineage/version binding, ST_RECEIPT, verification, payload checksums/archive, issue documents and attachment-backed work products. Point the primary dossier work product to the current archive or mark the old primary superseded unambiguously.
3. Preserve the accepted ST-08.3 history and both earlier [LAT-191](/LAT/issues/LAT-191) review decisions; do not produce an IMP_RECEIPT or claim parent acceptance. Re-run the current-version verifier and attachment download/extraction checks.

This is review round 3. Per the packet, a third technical return escalates through Command after the author refresh; no reviewer or routing substitution and no product-code repair are authorized here.