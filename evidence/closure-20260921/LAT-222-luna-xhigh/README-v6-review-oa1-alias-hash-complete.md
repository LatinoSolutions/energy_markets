# LAT-222 closure candidate v6 — complete-hash independent OA1 reviewer alias

This version preserves v1 through v5 and records the exact bytes frozen on disk after the OA1 reviewer alias and failover caller were added. `review_oa1` is the existing Independent Reviewer on OA1; policy, command selection, replenisher, and dispatcher use it before historical ANT while preserving author and creator exclusions. The exact proof is an OR-authored packet created by the Tech Lead with OA2 and ANT closed: `review_oa1` is selected and gets `accountProfileId: oa1` only when the active native descriptor authorizes the reviewer actor and role. No new agent, quota, service, route, or issue mutation is included.

Binding emission remains gated by `available=true`, `enabled=true`, version 1, a 64-hex config hash, and profile membership. Absent live metadata keeps fixed resource/HOME behavior and emits no account binding. The existing GET `/agents/:id` descriptor excludes HOME and secrets.

Validation: alias-focused suite 108/108; full JavaScript suite 699/699 (`/tmp/lat222-v5-final.tap`); Python email sink 7/7. Final live readback at 2026-09-21T22:49:33.339Z: LAT-222 blocked with executionState idle and no participant/return assignee; Tech Lead and Independent Reviewer idle, both GETs omit `nativeAccountBinding`. Go Global-region failures and root's administrative pause/OR recovery remain external residual evidence; no staging circuit mutation is claimed.

The manifest hashes all 95 static staging files and records their byte lengths. Runtime/generated and preserved `.orig`/`.rej` artifacts are explicitly excluded; installed-source baseline is referenced by SHA-256 only.
