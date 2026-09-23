# LAT-222 closure candidate — Luna xHigh

This evidence records the bounded staging candidate after the native assignment continuity fix. The only code write set is operations/audit/IMP-26/LAT-222/staging/**; this directory is the new closure evidence set under evidence/closure-20260921/**. Historical evidence and installed office files were not overwritten.

The concrete defect closed here is native assignment adoption. gatherBacklog now re-gets scoped [READY] children assigned natively, parses and canonical-checks them, applies an explicit ON-project guard, and idempotently merges eligible todo, in_progress, in_review, or unaccepted done packets into pendingFinalAcceptance. A done packet is excluded when a Tech Lead stage or a Tech Lead FINAL-ACCEPTANCE: marker already exists. The new focused test covers scope, idempotence, canonical ineligibility, Tech Lead stage, and acceptance-marker cases.

Validation:
- JavaScript full suite: /opt/node/bin/node --test --test-reporter=tap — 691 tests, 691 passed, 0 failed.
- Focused suite: native adoption, controller, IMP-26 autonomy, continuity E2E, replenisher, policy, dispatcher, review recovery, runtime profile, routing telemetry, and North Star — passed.
- Python email sink suite: python3 email-sink.test.py — 7 tests, all passed.

Native readback immediately before this evidence write:
- LAT-222 (86a06588-9bce-4880-ac9d-9947a272001e4) remained blocked, execution state idle, no current participant or return assignee, updated 2026-09-21T21:03:01.646Z.
- Tech Lead 2b6bf987-6800-4d4c-a23a-d470a4bb0ea6 and Independent Reviewer 0af74a08-cb39-4cf5-a94f-117b242ea08c were both idle, codex_local, with only the CODEX_HOME environment key observed. Fixed Sol HIGH/OA2 attribution remains the verified execution profile.

Residuals are explicit: dynamic per-stage/per-run account-profile binding and shared OA2 capacity under auto-wake were not proven by this candidate and remain pending the separate native runtime patch. No issue-wide override, worker/agent/quota mutation, service change, or controller installation change is included.
