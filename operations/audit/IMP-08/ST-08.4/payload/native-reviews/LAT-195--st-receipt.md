# SOURCE RECORD (verbatim body copy)
- issue: LAT-195 (ST-08.5)
- key: `st-receipt`
- title: ST-08.5 ST_RECEIPT
- revisionId: 3015b43a-f1f3-49cb-8332-6a27360b8948
- createdByAgentId: 6c548bcb-e6aa-43ea-9c6c-319497cbe6a9
- createdByUserId: None
- updatedAt: 2026-09-21T10:47:14.671Z

---

# ST-08.5 ST_RECEIPT

```json
{
  "receiptKind": "ST_RECEIPT",
  "schema": "ST_RECEIPT v1 (SPEC §20.2.8)",
  "packetSubtaskParentIdentity": {
    "packetId": "WP-IMP-08-ST-5-v1.1",
    "subtaskId": "ST-08.5",
    "parentImp": "IMP-08",
    "project": "96bbd5b1-94da-4781-8c2b-455fdfb28d1a",
    "specId": "PROCUREMENT_RESEARCH_CANONICAL_ENGINEERING_SPEC_v1_1.md",
    "specVersion": "1.1",
    "specSha256": "86c4bd4eeb5f9d0ebad94763128b221eb64525a2b7fff1007dab0af88b39cb6c",
    "projectName": "Energy Markets",
    "programRoot": { "identifier": "LAT-91", "id": "9a134853-ded2-4aa9-8b48-fa19cd2eafd3" },
    "workIssue": { "identifier": "LAT-195", "id": "2a89265c-3143-4e1f-9071-f03fa95e81ea" },
    "predecessorSubtask": {
      "identifier": "LAT-178",
      "reviewedContentHash": "140c8128eec122c295ac5b19ca1636a59674b8ea9f6706a827e21ba2bb5fc6f2",
      "receipt": "operations/receipts/IMP-08-ST-3.json"
    },
    "sourceFinding": "LAT-194 final-acceptance-evidence",
    "workspace": "/srv/hot-data/energy-markets/app",
    "host": "brunode",
    "executionInstance": "SPEC 86c4bd4e… + IMP-08 + ST-08.5 bounded malformed complete-cost correction"
  },
  "workerModelRoute": "Premium Production Worker A (Luna) 6c548bcb-e6aa-43ea-9c6c-319497cbe6a9 / codex_local / gpt-5.6-luna / high; run 9bc9b307-a1fa-4e6d-a6a6-c21163d0fe36",
  "workerRoute": {
    "agentId": "6c548bcb-e6aa-43ea-9c6c-319497cbe6a9",
    "agentName": "Premium Production Worker A (Luna)",
    "roleInThisSubtask": "routine corrective author; not the independent reviewer",
    "adapter": "codex_local",
    "model": "gpt-5.6-luna",
    "reasoningEffort": "high",
    "runId": "9bc9b307-a1fa-4e6d-a6a6-c21163d0fe36"
  },
  "runHistory": [
    {
      "runId": "9bc9b307-a1fa-4e6d-a6a6-c21163d0fe36",
      "phase": "ST-08.5 implementation and evidence assembly",
      "status": "current",
      "note": "Corrected the bounded falsy-invalid predicate and added direct complete-list regressions."
    }
  ],
  "startingBaseline": "ST-08.3 reviewed semantic content hash 140c8128eec122c295ac5b19ca1636a59674b8ea9f6706a827e21ba2bb5fc6f2; live ST-08.5 product/test hashes captured in baseline-hashes.txt; no commit baseline",
  "startingBaselineDetail": {
    "declaredBaseline": "operations/audit/IMP-08/ST-08.5/baseline-hashes.txt",
    "reviewedComparisonBaseline": "140c8128eec122c295ac5b19ca1636a59674b8ea9f6706a827e21ba2bb5fc6f2",
    "versionIdentity": "content hashes; no commits created; branch main",
    "liveHashCheckPerformedBeforeWriting": true,
    "canonicalDocsMatchBaseline": true,
    "protectedHistoricalHashesUnchanged": true,
    "dirtyStatusObserved": "unborn/non-git content baseline with pre-existing untracked workspace trees"
  },
  "resultingVersion": {
    "type": "content-hash",
    "contentHash": "bc0ce6adef42831da21c9339c6569018a8c6b03a587558372ace336d4f661528",
    "algorithm": "sha256",
    "contentHashScope": "sha256 of sorted path+file-sha256 lines for src/economic-calculation/*.mjs, test/economic-calculation/*.test.mjs and docs/economic-calculation.md",
    "supersededContentHashes": ["140c8128eec122c295ac5b19ca1636a59674b8ea9f6706a827e21ba2bb5fc6f2"],
    "artifactHashes": {
      "src/economic-calculation/bhv.mjs": "4cc204f9eef0e191228e032b0753e68a1f4782426bf76b1de1368e21ff686cdf",
      "test/economic-calculation/bhv.test.mjs": "b523f2d15bf326d8ee0d242ed1c496e5e3f1c1cb43f736f83453e3bb073c06c7",
      "operations/audit/IMP-08/ST-08.5/baseline-hashes.txt": "df0ddf2fc4ec80d322ea2a8ad6b18197c14a5bec971eba392a4c28fdaa72bc59",
      "operations/audit/IMP-08/ST-08.5/reproducer.txt": "16d7b4a4be044e2593646bd7ba68790191ddf44c436b6f6f22e852c2c9759eba",
      "operations/audit/IMP-08/ST-08.5/tests.tap": "52e4dd7f30784211c4c994525299b4e5c645ac81da683eee3996ccd02fd6a53e",
      "operations/audit/IMP-08/ST-08.5/change-review.md": "1d6e57ac1123419f9b1d3a8ab3eeea962b75625e41c60974812059a22cf44348",
      "operations/audit/IMP-08/ST-08.5/final-hashes.txt": "4dd01a237cedbc1183430f166b470b6bca1801a9ee2362d8aae82b1ff17e335a",
      "operations/audit/IMP-08/ST-08.5/verify-delivery.mjs": "3707db11bfa97db2245f308131928ce3c4842a18550b909404a7c92b30cbbc8d",
      "operations/audit/IMP-08/ST-08.5/verification.txt": "966eeebf13875bed7c2f05685342bc766199750a43ba365f9374f0f4c4c1bfd7",
      "operations/audit/IMP-08/ST-08.5/continuity-checkpoint.md": "8a81fbf8afb077d55088522991f7ef7ba2fe2c910d8a0c268be5f1f636db4a6a"
    }
  },
  "inputsUsed": [
    "docs/canonical/PROCUREMENT_RESEARCH_CANONICAL_ENGINEERING_SPEC_v1_1.md §§5,19.3–19.3.1,20.2.7–20.2.10,25.1 IMP-08,25.2.1–25.2.3",
    "LAT-194 final-acceptance-evidence and exact reproducer",
    "operations/receipts/IMP-08-ST-3.json and operations/audit/IMP-08/ST-08.3/manifest.json (read-only historical pins)",
    "accepted IMP-01/ST-08.1 and ST-08.2 receipt/oracle evidence",
    "current ST-08.3 reviewed source/test bytes as the comparison baseline"
  ],
  "artifactsChanged": [
    "src/economic-calculation/bhv.mjs",
    "test/economic-calculation/bhv.test.mjs",
    "operations/audit/IMP-08/ST-08.5/baseline-hashes.txt",
    "operations/audit/IMP-08/ST-08.5/final-hashes.txt",
    "operations/audit/IMP-08/ST-08.5/tests.tap",
    "operations/audit/IMP-08/ST-08.5/reproducer.txt",
    "operations/audit/IMP-08/ST-08.5/change-review.md",
    "operations/audit/IMP-08/ST-08.5/manifest.json",
    "operations/audit/IMP-08/ST-08.5/verify-delivery.mjs",
    "operations/audit/IMP-08/ST-08.5/verification.txt",
    "operations/audit/IMP-08/ST-08.5/continuity-checkpoint.md",
    "operations/receipts/IMP-08-ST-5.json"
  ],
  "result": "Corrected computeAllInH so every invalid element in a declared complete cost list, including falsy values and sparse holes, is rejected by validity before reduction. Preserved exact unavailable/rejected output and reason, valid finite and known-zero arithmetic, empty complete-list behavior, frozen units and no-zero/no-conversion semantics. No real economic run or authority is claimed.",
  "testsRun": [
    "hostname",
    "pwd",
    "sha256sum SPEC and protected ST-08.1/ST-08.2/ST-08.3 pins before and after",
    "/opt/node/bin/node --check src/economic-calculation/bhv.mjs",
    "/opt/node/bin/node --test test/economic-calculation/*.test.mjs",
    "/opt/node/bin/node --test test/contracts/*.test.mjs",
    "/opt/node/bin/node --test operations/audit/IMP-08/ST-08.3/regression.test.mjs",
    "/opt/node/bin/node operations/audit/IMP-08/fixture-oracle/verify.mjs",
    "/opt/node/bin/node operations/audit/IMP-08/ST-08.3/verify-delivery.mjs",
    "/opt/node/bin/node operations/audit/IMP-08/ST-08.5/verify-delivery.mjs",
    "LAT-194 exact reproducer and ST-08.5 malformed-element matrix with costsComplete=true"
  ],
  "testResults": [
    "workspace: brunode /srv/hot-data/energy-markets/app / main, exit 0",
    "changed product/test hashes: bhv.mjs 4cc204f9…; bhv.test.mjs b523f2d1…",
    "SPEC and nine protected historical pins: unchanged, exit 0",
    "node check: exit 0",
    "economic suite: 56 pass, 0 fail, 0 skipped, exit 0",
    "contract suite: 67 pass, 0 fail, 0 skipped, exit 0",
    "ST-08.3 regression suite: 9 pass, 0 fail, 0 skipped, exit 0",
    "fixture oracle: 35 fixtures; C01–C12 and seven negative probes pass, exit 0",
    "LAT-194 reproducer/malformed matrix: no throws; all malformed complete elements unavailable/rejected; valid controls finite",
    "historical ST-08.3 delivery verifier: exit 1 with expected 'manifest content hash is stale'; historical bytes untouched",
    "ST-08.5 delivery verifier: final isolated verifier result recorded in verification.txt"
  ],
  "evidenceProduced": [
    "operations/audit/IMP-08/ST-08.5/baseline-hashes.txt",
    "operations/audit/IMP-08/ST-08.5/final-hashes.txt",
    "operations/audit/IMP-08/ST-08.5/tests.tap",
    "operations/audit/IMP-08/ST-08.5/reproducer.txt",
    "operations/audit/IMP-08/ST-08.5/change-review.md",
    "operations/audit/IMP-08/ST-08.5/manifest.json",
    "operations/audit/IMP-08/ST-08.5/verify-delivery.mjs",
    "operations/audit/IMP-08/ST-08.5/verification.txt",
    "operations/audit/IMP-08/ST-08.5/continuity-checkpoint.md",
    "operations/receipts/IMP-08-ST-5.json"
  ],
  "assumptions": [
    "H remains the supplied synthetic all-in value; this packet does not implement a real ledger formula.",
    "The established unavailable/rejected result and exact reason are frozen for malformed/unknown costs.",
    "A complete known-zero list is costsComplete=true plus known finite zero entries; an empty complete list preserves existing arithmetic.",
    "Content hashes, not commits, identify this non-git workspace baseline.",
    "Historical ST-08.3 artifacts are read-only and remain the prior accepted/reviewed record."
  ],
  "deviations": [
    "The historical ST-08.3 delivery verifier intentionally exits 1 because it pins the prior reviewed semantic content hash; this expected mismatch is recorded and no historical verifier or evidence was rewritten."
  ],
  "dependencyFindings": [
    "REQUIRES accepted IMP-01 and completed ST-08.1/ST-08.2 plus reviewed ST-08.3 bytes: satisfied by preserved pins.",
    "REQUIRES_AUDIT=none; no real cost availability or DEP-13 claim is produced.",
    "Concurrent ST-08.4 work is preserved; its directory and receipt were not edited.",
    "Parent IMP-08 remains unaccepted and requires separate Command evaluation with ST-08.4; no IMP_RECEIPT is produced."
  ],
  "failuresRetries": [
    {
      "event": "Historical ST-08.3 delivery verifier returned exit 1",
      "cause": "Its manifest content hash is frozen to the pre-ST-08.5 reviewed bytes.",
      "resolution": "Recorded as an expected historical limitation, preserved all ST-08.3 bytes, and used the isolated ST-08.5 verifier for the new delta."
    }
  ],
  "noGuessQuestionsRaised": [],
  "specChangeRequest": {
    "raised": false,
    "rationale": "LAT-194 established a local predicate defect; the correction preserves frozen cost semantics, output shape, units and governance boundaries."
  },
  "recommendedStatus": "in_review",
  "review": {
    "stage": "native independent Tech Lead Astra review",
    "reviewerAgentId": "2b6bf987-6800-4d4c-a23a-d470a4bb0ea6",
    "approvalsNeeded": 1,
    "authorReviewerDistinct": true,
    "status": "pending_native_review",
    "note": "Worker evidence is a recommendation only. Review must inspect exact delivered bytes, tests, manifest, receipt, protected hashes and frozen semantics. ST accepted is not IMP accepted."
  },
  "handoff": {
    "changes": "Two allowed product/test files changed; isolated ST-08.5 evidence, verifier, manifest and receipt added.",
    "risks": "Synthetic-only evidence; no real cost availability, campaign validity, DEP-13 closure, IMP-08 acceptance or production authority is asserted.",
    "nextAction": "Native Astra review of exact delivered bytes; after approval, Command re-evaluates IMP-08 with ST-08.4.",
    "sourceHash": "bc0ce6adef42831da21c9339c6569018a8c6b03a587558372ace336d4f661528"
  },
  "receiptMeta": {
    "specSection": "20.2.8",
    "writtenByRun": "9bc9b307-a1fa-4e6d-a6a6-c21163d0fe36",
    "revision": "corrective continuation of reviewed ST-08.3 content",
    "parentAcceptanceReminder": "No IMP_RECEIPT or parent acceptance is produced by this child."
  }
}
```
