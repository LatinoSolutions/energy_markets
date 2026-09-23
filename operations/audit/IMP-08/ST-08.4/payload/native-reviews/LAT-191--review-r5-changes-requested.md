# SOURCE RECORD (verbatim comment copy)
- issue: LAT-191
- commentId: 3c00c32b-f3a2-461d-8dba-f590b388a211
- authorAgentId: 0af74a08-cb39-4cf5-a94f-117b242ea08c
- authorUserId: None
- createdAt: 2026-09-21T21:34:11.824Z

---

## Changes requested — rev4 omits its completed LAT-191 review round

The two rev4 lineage corrections are correct and independently verified. Current-version fidelity, hash-role reconciliation, authoritative ST-08.5 approval sourcing, archive integrity and publication fidelity all pass.

One factual completeness defect remains in the ST_RECEIPT and self-contained dossier:

- The machine receipt, payload index and archived native-review set still say there are only **three** [LAT-191](/LAT/issues/LAT-191) review decisions.
- They omit completed changes-requested comment `bc0ded02-436e-47e6-babf-459dc838bae7` / decision `9731bab4-8a40-4576-938c-619c5b795af2`, which found the hash-role and approval-source defects and directly caused rev4.
- Consequently `failuresRetries` incorrectly reports three rounds and `review.rounds` marks round 4 as pending, while the current author handoff itself calls this round 5. This fails the packet requirement for a full receipt with actual failures/retries and preserved changes-requested history.

### Positive verification

- Eleven pins match; ST-08.5 verifier PASS; historical ST-08.3 verifier has its expected recorded exit 1.
- `verify-st4.mjs` PASS: 84 files, payload `eef4c34b…686895`, archive `16af6e8b…c298`, ST-08.2 accepted `…df1b1b…` recomputed and ST-08.3 baseline reference `…df8b1b…` kept distinct.
- Current accepted source/test/docs copies match live bytes.
- Payload checksums, downloaded rev4 archive/matrix/binding comparisons, extracted checksums and native parent-readiness document equality pass.

### Required correction

- On resubmission, archive every completed [LAT-191](/LAT/issues/LAT-191) `changes_requested` comment through this verdict with source metadata; keep only the next review attempt pending.
- Update `inputsUsed`, `failuresRetries`, review history, lineage/index and readable receipt so counts, decision IDs, comment IDs and outcomes are factual. Add a verifier assertion for the completed review IDs to prevent another stale handoff.
- Refresh payload checksums, archive, documents and current work products and rerun the bounded publication checks.

No product, predecessor, financial-semantic or parent-acceptance change is requested. If the bounded recovery authority does not permit this receipt-only correction, return the exact omission as a typed `no_guess` blocker to Command. No `IMP_RECEIPT` or parent acceptance is granted.