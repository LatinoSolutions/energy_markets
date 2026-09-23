# LAT-222 closure candidate v3 — active native capability descriptor

This version preserves manifest.json (v1, 691 tests) and manifest-v2-account-binding.json (v2, 693 tests). It adds the bounded native capability read without creating a route: gatherBacklog re-reads only relevant Codex command/reviewer agents through the existing GET /agents/:id when the bulk row lacks nativeAccountBinding. runtime-profile accepts a target OA1/OA2 lane only when the active descriptor is valid version 1, enabled, hash-shaped, and authorizes the actor and lane role for that target profile. The descriptor contains no HOME or secret. Invalid, absent, disabled, or unavailable metadata falls back to the existing fixed resource/HOME compatibility; current OA1 remains closed when the observed agent HOME is OA2.

Native descriptor contract consumed:
version, enabled, configSha256, profiles[{id, capacity, allowedAgentIds, legacyAgentIds, allowedRoles}]. The server-side native runtime remains responsible for selecting the per-run HOME and enforcing capacity. No local file is treated as proof of active server configuration.

Validation:
- Full JavaScript suite: /opt/node/bin/node --test --test-reporter=tap — 695 tests, 695 passed, 0 failed.
- Focused capability/binding suite: runtime-profile, controller, dispatcher, stale-references, mutate, replenisher, command-question, native-final-acceptance — passed.
- Python email sink suite remains 7/7 from v2; no Python code changed in v3.

Final native readback before this v3 evidence write: LAT-222 remained blocked with executionState idle, no current participant or return assignee, updated 2026-09-21T21:03:01.646Z; read at 2026-09-21T22:26:46.273Z.

Residuals: active native deployment and live OA1/OA2 capacity behavior are not claimed by this staging candidate. OA1 quota policy remains independently CLOSED at zero. No issue-wide override, worker/agent/quota mutation, service change, or controller installation change was made.
