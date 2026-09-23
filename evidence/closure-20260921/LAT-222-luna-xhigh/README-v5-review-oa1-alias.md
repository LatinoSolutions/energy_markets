# LAT-222 closure candidate v5 — independent OA1 reviewer alias

This version preserves v1 through v4 and adds the missing independent route for a Codex reviewer on OA1. `lanes.json` defines `review_oa1` for the existing Independent Reviewer agent, with the same actor and reviewer role as `review_oa2`/`review_ant`. Policy evaluates the alias against OA1 quota and native profile compatibility; routing order is `command_oa1 -> command_oa2 -> review_oa2 -> review_oa1 -> review_ant`. The dispatcher still excludes both execution author and creator, so an OR-authored packet created by the Tech Lead selects `review_oa1` when OA2 is closed and ANT is unavailable, stamping `accountProfileId: oa1` only when the active descriptor authorizes that actor and reviewer role. No new agent, quota, route, service, or issue mutation is introduced.

Native binding remains gated by `available=true`, `enabled=true`, version 1, a 64-hex config hash, and profile membership. Absent live metadata keeps fixed resource/HOME behavior and emits no account binding. The existing GET `/agents/:id` descriptor has no HOME or secret fields.

Validation: focused policy/dispatcher/replenisher/runtime suite 205/205; full JavaScript suite 698/698; Python email sink 7/7. Final live readback at 2026-09-21T22:46:06.425Z: LAT-222 blocked with executionState idle and no participant/return assignee; Tech Lead and Independent Reviewer idle, both GETs omit `nativeAccountBinding`. Go Global-region failures and root's administrative pause/OR recovery remain external residual evidence; no staging circuit mutation is claimed.

The manifest carries a complete 95-file static staging inventory, excludes runtime/generated and preserved `.orig`/`.rej` artifacts, and references the installed-source baseline by SHA-256 only.
