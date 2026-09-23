# LAT-222 closure candidate v2 — native account binding callers

This version preserves the earlier manifest.json (v1, 691 tests) and records the authorized caller seam on top of it. Controller-created REFILL, FINAL-ACCEPTANCE, and COMMAND-QUESTION tickets now carry executionPolicy.assigneeAccountProfileId for command_oa1/oa2 (OA1/OA2 respectively; ANT failover remains unbound). Reviewer execution policies now carry stages[].participants[].accountProfileId for command_oa1, command_oa2, and review_oa2; stale review-participant repair preserves the selected OA1/OA2 profile. The issue-create mutator allowlist accepts this native field.

The native runtime contract was read from the separate LAT-222 native-runtime-candidate patch: normal assignee wake reads executionPolicy.assigneeAccountProfileId; review wake reads the stage participant accountProfileId and propagates executionStage.accountProfileId plus nativeAccountProfileId. This staging delta emits only those supported fields and does not add an issue-root column or unsupported assignee override.

Validation:
- Full JavaScript suite: /opt/node/bin/node --test --test-reporter=tap — 693 tests, 693 passed, 0 failed.
- Binding-focused suite: mutate, replenisher, native-final-acceptance, command-question, dispatcher, and stale-references — passed.
- Python email sink suite: python3 email-sink.test.py — 7 tests, all passed.

Final native readback before this v2 evidence write: LAT-222 remained blocked with executionState idle, no current participant or return assignee, updated 2026-09-21T21:03:01.646Z; read at 2026-09-21T22:16:41.329Z.

Residuals: this staging candidate does not install or activate the separate native runtime patch, so live profile-capacity behavior and auto-wake contention remain deployment-review concerns. No issue-wide profile override, agent/worker/quota mutation, service change, or controller installation change was made.
