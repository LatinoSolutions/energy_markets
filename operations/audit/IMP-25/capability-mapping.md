# IMP-25 / ST-25.1 — Factual capability audit of the existing Paperclip office, mapped to §20.2

Packet `WP-IMP-25-ST-1-v1.1` · Subtask `ST-25.1` · Parent `IMP-25` (LAT-93, `8e97305f-cb5e-4d3c-9dbc-09adb3792610`)
SPEC `PROCUREMENT_RESEARCH_CANONICAL_ENGINEERING_SPEC_v1_1.md` v1.1 · SHA256 `86c4bd4eeb5f9d0ebad94763128b221eb64525a2b7fff1007dab0af88b39cb6c` (verified live, §"Input hashes")
Project `96bbd5b1-94da-4781-8c2b-455fdfb28d1a` (Energy Markets) · Workspace `/srv/hot-data/energy-markets/app` · Host `brunode`
Author: Independent Reviewer / Command Failover `0af74a08-cb39-4cf5-a94f-117b242ea08c`, acting as **Opus hard-reasoning auditor** (not as independent reviewer of this same ST).
Observed evidence window: 2026-09-19T09:06Z – 09:12Z UTC (every fact below was read inside that window; no end time is prestated). Accuracy corrections applied in a second run 09:17Z – 09:21Z, with live re-verification at 09:17:48Z — see §9. Bounded post-review supplement observed 09:28:14Z – 09:31:27Z — see §10 (post-audit source drift) and §11 (the OFF boundary). Round-2 corrections observed 09:43:54Z – 09:5xZ — see §12. Round-3 correction of G9's entry condition observed 11:22:11Z – 11:3xZ — see §13. Machine-readable counterpart: `evidence.json`. Observed TAP: `tests-tap.txt`.

---

## 0. Audit scope and its limits

**In scope, actually inspected** (read-only): the office controller and its modules at `/home/op/.paperclip/integrations/office-continuity`; the vendored project-switch patch surface at `/home/op/office-continuity/project-switch`; live controller state and queue snapshot; live Paperclip API (projects, projects/execution, issues, agents, this issue) via the existing read-only `pcapi.mjs` contract; on-disk agent instruction files; systemd user units, the continuity timer/service and user linger; source and workspace content hashes.

**Explicitly NOT in scope and NOT claimed** (§25.1 IMP-25 "desconocidos visibles"):

| Not inspected / not claimed | Why |
|---|---|
| Paperclip server internals beyond the routes actually called | Packet limits reading to the office controller, project switch, queue, instructions, routes, native review, receipt/recovery and systemd. |
| Live project-switch **integration** tests (`switch-test.mjs`) | Packet: *"Do not run live switch integration tests that toggle Alexandria."* Not run. The patch marker was checked by the unit-level detector only. |
| Any mutating controller tick | The audit ran no dispatch, no refill, no mutation. All failure scenarios below are **derived from code + live state**, not observed executions. |
| Whether a restarted controller *would in fact* behave as derived | Not executed. Gaps G1–G6 are code-and-state findings of **high confidence**, not observed runtime outcomes. IMP-26 must test them. |
| Auth tokens, provider credentials, Telegram destinations | Never read into this document; `pcapi.mjs:6` reads the board token in-process and never prints it. No secret values appear here or in `evidence.json`. |
| Economics/quota/reserve semantics | Out of packet scope; budgets are concurrently being worked on by Bru and Claude and must not be disturbed. |

**Audit accepted ≠ capability works.** Per §25.1 IMP-25 and §25.2.1, nothing below declares DEP-27 closed as a block. This ST resolves DEP-27 **only for the interfaces/workflow/configuration/state actually inspected and listed here**. Identified gaps are *not* resolved by being identified (§25.2.2 IMP-25 RESOLVES_AUDIT).

---

## 1. Live office state at audit time

| Fact | Observed value | Source |
|---|---|---|
| Alexandria project | `state: off`, `pausedAt 2026-09-19T08:58:23.200Z`, `pauseReason manual` | `GET /companies/{c}/projects/execution` |
| Energy Markets project | `state: on`, `pausedAt null` | idem |
| Energy `executionWorkspacePolicy` | `{enabled:true, defaultMode:"shared_workspace", sharedWorkspaceConcurrency:"allow", allowIssueOverride:true, defaultProjectWorkspaceId:"5c08ab20-…", workspaceStrategy:{type:"project_primary"}}` | `GET /companies/{c}/projects` |
| Alexandria `executionWorkspacePolicy` | `null` | idem |
| This run's workspace resolution | `PAPERCLIP_WORKSPACE_SOURCE=project_primary`, `PAPERCLIP_WORKSPACE_CWD=/srv/hot-data/energy-markets/app` | run environment |
| `latinosolutions-continuity.timer` | `ActiveState=inactive`, `SubState=dead`, `UnitFileState=enabled`, `LastTriggerUSec=2026-09-19 08:59:02 UTC`, next elapse empty | `systemctl --user show` |
| `latinosolutions-continuity.service` | `WorkingDirectory=/home/op/.paperclip/integrations/office-continuity`, `ExecMainStatus=0`, `UnitFileState=static` | idem |
| `latinosolutions-awareness.timer` | `ActiveState=active`, next elapse `09:08:06 UTC` | idem |
| User linger | `Linger=yes` (`/var/lib/systemd/linger/op` present) | `loginctl show-user op` |
| Last controller tick observation | `projects: Alexandria OFF, Energy Markets OFF`; `autonomy NO_ACTIVE_PROJECT`; replenisher `last decision no_project_on` | `CONTINUITY_STATUS.md` line 13/16/18, `queue-snapshot.json` |

**Temporal note (not a contradiction).** The last controller tick (08:59:02.994Z) recorded *both* projects OFF. Energy Markets was switched ON **after** that tick and before the audit read at 09:06Z. The controller has not ticked since (timer stopped at handoff), so no controller artifact yet reflects Energy ON. The project gate itself reads live state per tick and is not stale by design — this is purely the stopped timer.

**Timer dependency.** `UnitFileState=enabled` + `Linger=yes` means the continuity timer is durable across logout and will resume on boot or on an explicit `systemctl --user start`. It is stopped **only** by the coordinator's in-session stop. Native Paperclip scheduling and `latinosolutions-awareness.timer` remain running, so this issue's own dispatch path is unaffected. **Restarting the timer while G1–G4 stand would produce the wrong-work scenario in §3.**

---

## 2. §20.2 contract → real office capability

Legend — **PRESENT**: exists and was inspected. **PARTIAL**: mechanism exists but does not carry the §20.2 requirement in full. **ABSENT**: no mechanism found in the inspected surface.

| §20.2 requirement | Status | Real mechanism (file:line) | Reconciliation |
|---|---|---|---|
| **20.2.1** Existing roles preserved | **PRESENT** | `lanes.json` defines `command_oa1`, `review_ant`, `premium_oa2_a`, `cheap_go_a/b`, `cheap_or`, `payg_deepseek` with `role`/`resource`/`maxConcurrent`; `routing` maps `routine|premium|critical` → lane order | Maps 1:1 to Astra / Opus / Luna / DeepSeek. No new role needed. `payg_deepseek` is `agentId: null` → reported `ABSENT / agent_not_configured`, an honest null, not a fake lane. |
| **20.2.1 / 20.2.4(1)** Project ON/OFF is the activation mechanism | **PRESENT** | `project-gate.mjs:41-59` (one execution GET per tick), `:65-83` (`buildProjectGate`, `isEligible`), `:30-38` (`checkPatchMarker` on installed `budgets.js`), `controller.mjs:280-289` | Fully project-agnostic and **fails closed**: if the GET is non-200 *or* the `OFFICE-PROJECT-SWITCH` marker is gone, `onProjectIds` is empty, every candidate is `switch_missing`, nothing dispatches (`project-gate.mjs:66-68`). Verified live: Energy ON / Alexandria OFF returned correctly. This is the single strongest existing match to §20.2. |
| **20.2.4** Eligibility gate consulted by *every* selector | **PARTIAL** | Consumers verified: `handoff.mjs:60`, `review-recovery.mjs:147,231`, `replenisher.mjs:149-151,226,426`, `controller.mjs:284-289` | The **project** dimension is gated everywhere it was checked. The **canonical-graph** dimension of §20.2.4 (points 2,3,5,6,7,8) — SPEC IMP existence, instance-not-accepted, `REQUIRES*` satisfied, open `SPEC_CHANGE_REQUEST` — has **no representation at all** in the office. See G5. |
| **20.2.5** Decomposition into bounded subtasks | **PRESENT (human-executed)** | Native parent/child issues; `[READY]` title prefix; `status backlog` → controller promotes to `todo` | The mechanism is the native issue tree plus Command discipline. It works — the Energy tree (LAT-91 → LAT-92/93/94/95/96) was built this way — but it is convention, not enforcement. |
| **20.2.7** WORK-PACKET carries the semantic equivalent of all 20 fields | **PARTIAL (enforcement only)** | `packet.mjs:9-23` `KNOWN_KEYS` = 13 keys; `:85` `missing` computed only over those 13; `:27` `KEY_LINE_RE = /^([a-z_]+):/` | §20.2.7 requires *"el equivalente semántico"* of 20 fields and explicitly *"no selecciona formato de almacenamiento"*, so carrying a field as packet prose **satisfies the SPEC**. This packet is in fact semantically complete: all 20 fields are present in its text (§4). The gap is **automated enforcement**: only 8 of the 20 have a typed slot, `missing` is computed over the 13 known keys (`:85`), so `parsePacket` returns `ok:true` for a packet with no SPEC hash, Parent IMP, Subtask ID, Inputs, Source Sections or Baseline. A separate parser defect, not a SPEC-compliance gap: `KEY_LINE_RE` is lowercase-only, so the literal line `Source Sections:` (capital S, space) is silently absorbed as a continuation of `scope:` — verified against this packet's own file. |
| **20.2.8** ST_RECEIPT, 15 fields, worker PASS = recommendation | **ABSENT** | No `receipt`/`ST_RECEIPT` symbol anywhere in the inspected office code | The office has no receipt object. `status: done` + a comment is all it records. This ST's own receipt is a hand-written file (`operations/receipts/IMP-25-ST-1.json`) — a workspace convention, **not** an office capability. §20.2.8's "responder «done» no cierra la subtarea" is currently unenforceable by the office. |
| **20.2.9** Review and independence | **PRESENT** | Native `executionPolicy.stages[].type="review"` with `participants[].agentId` and `approvalsNeeded`; `maxReviewRounds`; `commentRequired`. Verified live on LAT-95: one review stage, participant `2b6bf987` (Astra), `approvalsNeeded 1`, `maxReviewRounds 3` | Native review is real and configured per issue. `replenisher.mjs:304-306` even encodes the §20.2.9 failover distinction: two stages (Reviewer → Tech Lead) normally, one stage (Reviewer only) while the Command lane is CLOSED, with final acceptance deferred to the batch. Independence is a **routing** property (reviewer ≠ author), enforced by who is named in the stage, not by a rule the office checks. |
| **20.2.10** ST accepted ≠ IMP accepted; IMP_RECEIPT | **PARTIAL** | `final-acceptance.mjs:28` `FINAL-ACCEPTANCE:` comment marker (`approved\|changes_requested\|rejected`); `:42-50` readers; `state.pendingFinalAcceptance` (flat id list); `:56-66` batch-wake selector | A **two-tier** acceptance exists — native review stage, then a Tech Lead `FINAL-ACCEPTANCE:` comment that prunes the id. Structurally this is the right shape for ST→parent. But it is *per-issue*, with no parent-IMP object, no "all required STs accepted" check, and no IMP_RECEIPT artifact. The parent gate of §20.2.10 cannot be evaluated by the office. |
| **20.2.11** Typed blockers | **PARTIAL** *(corrected in round 2 — §12; the earlier "no representation" reading is superseded and false)* | `guards.mjs:78-80` marker regexes, `:93-112` `humanRequired`, `:119-128` `dependencyKind`; `queue-snapshot.mjs:101-122` `blockedKind` (`:107-110` dependency kinds, `:112-116` failure diagnostics, `:120` `NORMAL_DEPENDENCY → DEPENDENCY_BLOCKED`), call site `:338`; consumers `controller.mjs:933`/`board-sim.mjs:444` → `autonomy.mjs:165-168` | **All six §20.2.11 meanings are represented** and were reproduced by pure function (§12.1): Normal dependency, Audit-dependent, Evidence-dependent, Human decision, SPEC contradiction (via `SPEC_CHANGE_REQUEST`) and Tool/provider/worker failure (via the `evaluation.diagnostic` branch). The residual gap is **binding, not vocabulary**: the kind is recognised from free-text `unblockDescriptor.action` by regex, nothing derives `Audit-dependent`/`Evidence-dependent` from the packet's own `REQUIRES_AUDIT`/`REQUIRES_EVIDENCE` (`packet.mjs` parses neither), the kinds are consumed only by Queue rendering and autonomy diagnosis — never by an eligibility or dispatch decision — and §20.2.11's branch scope has no model. See narrowed **G10**. |
| **20.2.12** SPEC_CHANGE_REQUEST | **PARTIAL** *(corrected in round 2 — §12; the earlier "ABSENT / no symbol found" claim is superseded and false)* | `command-question.mjs:106` (the same prompt that scopes ordinary questions **directs a `SPEC_CHANGE_REQUEST:` comment when the answer would change frozen architecture**), `:161-165` `findCommandAnswer` returns `specChange`, `:242-266` converts the source's descriptor to `SPEC_CHANGE_REQUEST: …`, leaves it **blocked** and cancels the leftover ticket; `guards.mjs:78` `SPEC_CHANGE_MARKER_RE`, `:103` → `required: true, reason: "spec_change_request"`; `queue-snapshot.mjs:108`; `autonomy.mjs:166` | A **real escalation primitive exists end-to-end**: the branch stops (the issue stays blocked), authority is transferred out of agent hands (`humanRequired` → true, so no controller path resumes it, `isCommandQuestion` goes false and no further ticket is created), and it is surfaced in Queue and in the autonomy classification. What is missing is the **canonical contract around it**, not the channel: none of §20.2.12's 11 required fields is captured (the descriptor stores a ≤400-char whitespace-collapsed excerpt, `:251`), there is no SPEC version / IMP / Source Sections identity, no project binding, and no routing to the architecture/research authority distinct from the human gate. See narrowed **G9**. |
| **20.2.13** Continuation loop, SPEC-bound replenisher | **PARTIAL → actively wrong for Energy** | `replenisher.mjs:225-255` `decideRefill`; `:313-324` the refill prompt; `controller.mjs:827-828` `rootId: ROOT`, `goalId: backlog.rootGoalId` | The *loop* is real, tested and well-guarded (backoff, daily cap, in-flight dedup, production-lane check, mutation budget). Its *content* is hardcoded to Alexandria/LAT-20/Decision-Engine. See G1–G3 and the failure scenario in §3. |
| **20.2.14** Human escalation only at real limits | **PRESENT** | `notify.mjs:47-59` `sendTelegram` via `/home/op/.local/bin/hermes send --to telegram --json`, strict ack (`success!==true \|\| skipped \|\| error` → throw, never partial); guards `shouldSendDay7` (once ever), `shouldSendBlockage` (≥120 consecutive min, ≤1/6h), `SWITCH_MISSING_COOLDOWN_MS` 6h | Hermes path is real, rate-limited, and never routed through `mutate()` (`notify.mjs:8-10` — board writes and Telegram are deliberately separate). `hermes-director.service` and `hermes-gateway.service` are `active running`. stderr is never persisted (`notify.mjs:39`) — no credential leakage. Matches §20.2.14's "no routine approvals". |
| **20.2.15** Binding contrasted with the real office before claiming compliance | **THIS DOCUMENT** | — | Produces the §5 gap list for IMP-26. |

---

## 3. The central finding: Energy work is invisible to the controller

`controller.mjs:291`

```js
const children = issues.filter((issue) => issue.parentId === ROOT);
```

with `ROOT = "ff615d11-3c10-4f18-b0d6-1b56d0d6ba13"` hardcoded at `pcapi.mjs:5` (also duplicated at `pilot.mjs:26`, `economics.mjs:28`, `board-sim.mjs:28`). `ROOT` is LAT-20, the **Alexandria** program root. `children` is the sole basis for READY, dispatch candidates, refill accounting, `pendingFinalAcceptance` pruning and the queue snapshot.

Measured live:

| Quantity | Count |
|---|---|
| Issues in project Energy Markets | **6** (LAT-91…LAT-96) |
| Energy issues whose `parentId === ROOT` | **0** |
| Children of ROOT (all Alexandria) | 64 |

Every Energy issue hangs from LAT-91 (`9a134853-ded2-4aa9-8b48-fa19cd2eafd3`). **No Energy issue can ever enter the controller's backlog**, regardless of the project switch.

### Derived failure scenario if the timer is restarted as-is

This is **derived from code and live state, not observed**. With Energy ON and Alexandria OFF:

1. `children` = 64 Alexandria issues. The project gate correctly skips all 64 as `project_off`. Energy's 6 are never in the set at all. → `readyRunnable = 0`.
2. `selectActiveProject` (`replenisher.mjs:149-153`) returns the single ON project = **Energy Markets**.
3. `findOpenRefill({children, projectId: Energy})` (`:157-159`) searches ROOT's children for an Energy refill → none.
4. `decideRefill` (`:225-255`): gate present ✓, activeProject ✓, `productionOpen` ✓ (`cheap_or` OPEN, 59.03 USD vs 2.00 reserve), `readyRunnable 0 < minReady 3` ✓, no in-flight refill ✓, command lane `command_oa1` OPEN ✓ → **`refill: true`, requested 6**.
5. `createRefill` emits an issue with `projectId: Energy` (`:330`) but `parentId: rootId` = **LAT-20, the Alexandria root** (`controller.mjs:827`) and `goalId: backlog.rootGoalId` = **Alexandria's goal** (`controller.mjs:295,828`) — Energy's `goalIds` is `[]` and all six Energy issues have `goalId: null`.
6. The prompt handed to Command (`replenisher.mjs:317-323`) then instructs it to:
   - read **LAT-20** and `docs/architecture/DECISION_IMPLEMENTATION_PLAN_V1.md` (the Alexandria Decision Engine plan, which does not exist in this workspace) — `:317`;
   - create each unit as a **child of LAT-20** — `:319`;
   - dedupe against **LAT-20's children** — `:320`;
   - list 30 **Alexandria** identifiers as "Pendientes de aceptacion final" — `:320` (see G4);
   - and, verbatim, *"Prohibido: … tocar cualquier issue del proyecto **Energy Markets (OFF)**"* — `:323`.

Step 6 is **self-contradictory**: a refill ticket whose own `projectId` is Energy Markets, telling the Command that Energy Markets is OFF and must not be touched, while pointing it at the Alexandria backlog. The hardcoded `(OFF)` is now factually inverted. A refill fired in this state would produce wrong work, misfiled under the wrong parent and goal.

**This is the single highest-severity finding of the audit and the reason the coordinator's decision to hold the timer was correct.**

---

## 4. §20.2.7 field-by-field reconciliation

Parser: `packet.mjs`. Source of truth for the requirement: the §20.2.7 table, counted directly from the verified SPEC — **20 fields**, from *Packet ID* through *Expected handoff format*.

**Two distinct questions, kept separate.** §20.2.7 requires *"el equivalente semántico de todos los campos"* and states they are *"campos de un contrato semántico; no seleccionan formato de almacenamiento, API ni software nuevo"*. So (a) **semantic completeness** — is the field's content actually delivered to the worker, in any form including packet prose — is the SPEC requirement, and prose satisfies it. (b) **Automated enforcement** — can `packet.mjs` detect the field's absence — is *not* required by §20.2.7, but is what an office binding of §20.2.13 would need in order to reject a malformed packet mechanically. Column 2 answers (a); column 3 answers (b).

| §20.2.7 field | Semantically present in this packet? | Typed key in `packet.mjs`? | Where it actually lives today |
|---|---|---|---|
| Packet ID | ✓ | ✗ | prose inside `scope:` (`Packet=WP-IMP-25-ST-1-v1.1`) |
| Project | ✓ | ✗ | prose inside `scope:` + native `issue.projectId` (authoritative) |
| SPEC ID / version / hash | ✓ | ✗ | prose inside `scope:` |
| Parent IMP | ✓ | ✗ | prose inside `scope:` + native `parentId` (points at the program root, not the IMP issue) |
| Subtask ID | ✓ | ✗ | prose inside `scope:` |
| Objective | ✓ | ✓ `objective` | — |
| Allowed scope | ✓ | ✓ `allowed_paths` (split on `,`/newline, `:33-38`) | — |
| Prohibited scope | ✓ | ✓ `prohibited` | — |
| Inputs | ✓ | ✗ | scattered across `scope:` / `dependencies:` |
| Source Sections | ✓ | ✗ | line `Source Sections:` — **not** a key line under `KEY_LINE_RE` (`:27`, lowercase-only), silently absorbed into `scope:` |
| Dependencies consumed (typed) | ✓ | ✓ `dependencies` (untyped string) | `REQUIRES` / `REQUIRES_AUDIT` / `REQUIRES_EVIDENCE` written as free text; the *types* are legible to a human worker but not parsed |
| Frozen decisions | ✓ | ✗ | prose inside `scope:` (`Frozen=…`) |
| MUST NOT CHANGE | ✓ | ~ partially `prohibited` | `prohibited:` + the `Frozen=` clause together |
| Expected outputs | ✓ | ~ folded into `acceptance` | `acceptance:` names both output paths; `handoff:` names the receipt |
| Subtask acceptance criteria | ✓ | ✓ `acceptance` | — |
| Parent IMP acceptance context | ✓ | ✗ | prose inside `scope:` (the separate-parent-gate sentence) |
| Required tests | ✓ | ✓ `tests` | — |
| Required evidence | ✓ | ✓ `evidence` | — |
| Baseline version / commit | ✓ | ✗ | prose inside `scope:` (`Baseline=…`) |
| Expected handoff format | ✓ | ✓ `handoff` | — |

**Semantic completeness: 20/20 — this packet satisfies §20.2.7 as written.** No SPEC violation is asserted here.

**Automated enforcement: typed 8/20, partial 2/20, untyped prose 10/20.** `parsePacket` returns `ok:true` for any packet with a valid header and a valid `class`; `missing` is computed only over the 13 known keys (`:85`), so a *different* packet with no SPEC hash, no parent IMP and no baseline would also be reported complete. The parser is correct and well-tested **for what it models** (12/12 packet tests pass) — the gap is enforcement coverage of the §20.2.7 contract, not parser defects and not a deficiency in this packet.

One genuine parser defect is independent of that count: `KEY_LINE_RE` (`:27`) matches lowercase-only keys, so a literal `Source Sections:` line is swallowed into the preceding `scope:` value rather than being rejected or recognised. The content still reaches the worker (it is inside `scope:`), which is why semantic completeness holds.

---

## 5. Gap register for IMP-26 (smallest sufficient extension surface)

Each gap is stated with file:line evidence. Per §25.2.2, identifying a gap does **not** resolve it.

| ID | Gap | Evidence | Smallest sufficient extension | Severity |
|---|---|---|---|---|
| **G1** | Controller backlog is hardcoded to the Alexandria program root; no Energy issue can ever be a candidate | `controller.mjs:291`; `pcapi.mjs:5`; live: 0 of 6 Energy issues under ROOT, 64 Alexandria children | Resolve the program root **per ON project** instead of a module constant. Do not restructure the issue tree; keep `ROOT` as the Alexandria default. Same change covers `pilot.mjs:26`, `economics.mjs:28`. | **Critical** |
| **G2** | Refill prompt content is hardcoded to LAT-20 / Decision-Engine plan / "Energy Markets (OFF)" | `replenisher.mjs:317,319,320,323` | Make the mandate reference, plan path and prohibition list **project-derived**. For Energy they must point at LAT-91, the canonical SPEC + §25 backlog, and this workspace. | **Critical** |
| **G3** | Refill inherits the Alexandria root's `goalId`, and the created ticket's `parentId` is the Alexandria root, while `projectId` is Energy | `controller.mjs:295,827,828`; `replenisher.mjs:330-332`; live: Energy `goalIds: []`, all Energy issues `goalId: null` | Derive `parentId`/`goalId` from the active project's own root; tolerate a null goal. | **Critical** |
| **G4** | `state.pendingFinalAcceptance` is a flat, project-less id list — 30 Alexandria ids leak into an Energy refill prompt and into the Tech Lead batch wake | `controller-state.json` (30 ids); `CONTINUITY_STATUS.md:15`; `final-acceptance.mjs:35-39,56-66`; `replenisher.mjs:307,320` | Key the pending set by project, and filter the prompt/status line to the active project. | **High** |
| **G5** | No representation of canonical-graph eligibility: SPEC/IMP identity, execution instance "not already accepted", typed `REQUIRES*`, open `SPEC_CHANGE_REQUEST` | No such symbol in the inspected office; `project-gate.mjs` models only the project dimension | The SPEC-bound half of §20.2.13/§20.2.4. Needs a real (small) eligibility source the replenisher consults before asking Command for packets. | **High** |
| **G6** | No ST_RECEIPT / IMP_RECEIPT object; `FINAL-ACCEPTANCE:` comment is per-issue with no parent-IMP gate | `final-acceptance.mjs:28,42-50`; no receipt symbol in the office | Extend the existing comment-marker convention (it already works and is parsed) rather than build a new store; add the parent-gate evaluation of §20.2.10. | **High** |
| **G7** | No *automated enforcement* of §20.2.7: `packet.mjs` types 8 of the 20 fields, so a semantically incomplete packet parses as `ok:true`. Separately, `Source Sections:` is silently swallowed into `scope:`. **Not** a claim that packets are non-compliant — §20.2.7 is a semantic contract and this packet is 20/20 semantically complete (§4) | `packet.mjs:9-23,27,85`; §4 table | Add the missing keys to `KNOWN_KEYS` so `missing` becomes meaningful, and make `KEY_LINE_RE` recognise the SPEC's literal field labels. Backwards-compatible: unknown-key lines are already treated as continuations (`:70,75-77`). | **Medium** |
| **G8** | Handoff git inspection is hardcoded to the Alexandria checkout — an Energy handoff would report Alexandria's dirty state | `handoff.mjs:16,157,172` | Derive the inspected directory from the issue's resolved workspace (the native policy already provides it). | **Medium** |
| **G9** *(narrowed in round 2, entry condition corrected in round 3 — §12.2, §13)* | A §20.2.12 escalation **channel exists** (`SPEC_CHANGE_REQUEST` comment → descriptor conversion → branch stays blocked at human authority). What is absent is its **canonical contract**: none of the 11 required fields, no SPEC version / IMP / Subtask / Source Sections identity, no project binding, no separate architecture/research authority routing, and the payload is a ≤400-char excerpt. Entry is **narrow in author and source state — not in ticket existence**: the source must already be blocked with a Command-question descriptor in an ON project, and the marked comment must come from a recognised **Command** agent after the block. No `[COMMAND-QUESTION]` ticket is required (reproduced with zero tickets). A worker or Astra meeting a contradiction outside that state has no modelled route in. | `command-question.mjs:106,161-165,228-241,242-260` (present); `guards.mjs:78,103,121`; `queue-snapshot.mjs:108`; `autonomy.mjs:166`; absence of any field structure at `command-question.mjs:251-254`; entry conditions reproduced in §13 | **Extend the existing primitive, do not replace it.** Give the descriptor a structured payload carrying the 11 §20.2.12 fields (or an artifact id pointing at them), and bind it to SPEC version + IMP/Subtask + project. Widen **who and from what state** may raise one — a packet owner or reviewer on a source whose descriptor is not already a Command question — rather than adding a ticket-free entry point, which already exists. Reusing this conversion path is the *recommended* route — the earlier "must not reuse it" instruction is superseded. | **Medium** |
| **G10** *(narrowed in round 2 — §12)* | All six §20.2.11 meanings **are** represented and reproduce (§12.1). Residual: the kind is recognised from free-text descriptor prose only — nothing derives `Audit-dependent`/`Evidence-dependent` from the packet's `REQUIRES_AUDIT`/`REQUIRES_EVIDENCE`; the kind is consumed only by Queue rendering and autonomy diagnosis, never by an eligibility/dispatch decision; and §20.2.11's branch scope ("un bloqueo afecta sólo a la rama dependiente") has no model. One precedence defect observed: a row blocked by `blockedByIssueIds` that also carries any *unrecognised* descriptor prose classifies as `HUMAN_DECISION`, not `NORMAL_DEPENDENCY` (`guards.mjs:109` fires before `:126`) — a real dependency read as a human gate. | `guards.mjs:78-80,109,119-128`; `queue-snapshot.mjs:101-122`; `autonomy.mjs:165-168`; `packet.mjs` (no `REQUIRES_AUDIT`/`REQUIRES_EVIDENCE` parsing); §12.1 reproduction | Do **not** rebuild the types — they exist. Derive the dependency kind from the typed packet fields once G7 types them, let the eligibility source of G5 consult `dependencyKind` instead of only the project gate, and reorder `guards.mjs:109` after the `blockedByIssueIds` check so an ordinary dependency is not read as a human gate. | **Low** |

### Capabilities that already satisfy §20.2 and must NOT be rebuilt

Per §20.2.15 (*"extiende lo existente sólo donde el mapping detecte una carencia; no reconstruye Paperclip por preferencia"*):

- **Project ON/OFF gating, fail-closed** — `project-gate.mjs` in full. Project-agnostic, live-verified, 19 passing tests.
- **Per-project workspace binding** — native `executionWorkspacePolicy` with `workspaceStrategy: project_primary`. This run resolved `/srv/hot-data/energy-markets/app` via `PAPERCLIP_WORKSPACE_SOURCE=project_primary`, **not** via the issue override. Energy/Alexandria workspace isolation already works natively; `allowIssueOverride: true` additionally permits the per-issue `adapterAdapterOverrides.adapterConfig.cwd` that LAT-95 carries (both agree here).
- **Native review stages** — `executionPolicy.stages` with agent participants, `approvalsNeeded`, `maxReviewRounds`, `commentRequired`. Live on LAT-95.
- **Worker instructions are already Energy-aware** — all six canonical lane agents carry the `ENERGY-MARKETS-20260919` section and the Energy path (verified by content hash over each agent's on-disk `AGENTS.md`). Two distinct worker instruction hashes: `32a6dcbfc9f78f86` shared by the three cheap/emergency workers, plus one each for Command, Reviewer and Luna. The six retired agents lack the section — consistent with them being terminated. **No instruction change is needed for IMP-26.**
- **Review recovery for quota-stranded reviews** — `review-recovery.mjs`, project-gated at `:147,231`, with claim windows, per-24h caps and per-tick budgets.
- **Hermes escalation path** — `notify.mjs`, rate-limited, ack-strict, off the mutation path.
- **Refill loop guards** — `decideRefill`'s backoff/cap/in-flight/production-lane/mutation-budget conditions are sound; only their *content* is misbound.

---

## 6. Requested contrasts (packet `acceptance`)

| Contrast | Finding |
|---|---|
| **ON / OFF** | Works and fails closed. Live-verified in the inverted configuration (Energy ON, Alexandria OFF) that the office had never run in. Gated selectors: dispatch, handoff, review-recovery, refill, starvation. |
| **Routing** | `lanes.json` routing by `class` is intact and matches §20.2.1 roles. Class is parsed robustly (`packet.mjs:90-93`, first token, tolerates annotations). Unaffected by project. |
| **READY** | Single definition (`queue-snapshot.mjs:8-11`, "No second interpretation of READY exists"): `[READY]`-titled children of ROOT with a parsable packet and an open lane. **Structurally cannot see Energy work** (G1). Currently 0/0, min 3, target 6. |
| **Dispatch / recovery** | Dispatch is project-gated and functional; recovery (`review-recovery.mjs`) is real, evidence-classified and refuses to "force green" without quota evidence. Both are blocked from Energy by G1, not by their own logic. |
| **Reviews** | Native, per-issue, configured; the failover one-stage/two-stage rule is already encoded (`replenisher.mjs:304-306`). Independence is enforced by participant selection, not by a checked rule. |
| **ST / IMP receipts** | ST_RECEIPT absent as an office object (G6); this ST's receipt is a workspace file. IMP_RECEIPT and the §20.2.10 parent gate absent. The `FINAL-ACCEPTANCE:` marker is the right seed to extend. |
| **Continuation** | Loop exists with sound guards; content misbound (G2/G3) and SPEC-eligibility absent (G5). Timer stopped but `enabled` + linger → durable; restarting it before G1–G4 are fixed triggers §3. |

---

## 7. Explicit unknowns

1. Whether a restarted controller reproduces §3 — **derived, not executed**. IMP-26 must test it.
2. Whether the project-switch patch survives `paperclipai update` — the detector exists (`project-gate.mjs:30-38`) and is designed for exactly that regression, but no update was performed during this audit.
3. `payg_deepseek` lane capability — `agentId: null`, reported `ABSENT / agent_not_configured`. Not configured; nothing inferred about whether it could be.
4. Whether any of the 30 pending-final-acceptance Alexandria issues would be *mutated* by an Energy-active tick — the pruning path reads comments on those issues; not executed, not claimed.
5. Whether `latinosolutions-lat40-deferred.timer` / `latinosolutions-go-usage.timer` (both active) interact with Energy — outside the packet's named surface, not inspected.
6. Full `switch-test.mjs` integration behaviour — deliberately not run (packet prohibition).

## 8. Preservation of concurrent work

No file outside `operations/audit/IMP-25/**` and `operations/receipts/IMP-25-ST-1.json` was created, modified or deleted. No office file was written — every office interaction was a read or a non-mutating test. No API mutation was issued during the inspection. Dirty-file inventory (§"Workspace hashes" in `evidence.json`) was taken before and after writing.

Two facts about the shared workspace, recorded for the reviewer:

- `AGENTS.md` live hash `f3c40b2b…` differs from `operations/bootstrap/baseline-manifest.json`'s `098043d5…`. The baseline was captured 08:59:58Z; AGENTS.md was updated at 09:03 by the Director to add the bootstrap `.git` finding (its §17 paragraph). The three canonical documents match the manifest **exactly**, including the SPEC hash this packet declares. The baseline manifest covers only those four files.
- `operations/bootstrap/canonical-imp-rows.json` appeared in the workspace during this run (mtime 2026-09-19T09:06:10Z, sha256 `38572df5dd736c0f9d49c8a2ccaf2d6c53330d13732212461b48cda21d674d9d`, unchanged when re-hashed at 09:17Z). It is outside this packet's write set and was left untouched. **Authorship was not observable by this audit.** Per the Director's comment `842408ac` on LAT-95, it was produced by the **Director**, in the user task, by literal extraction of 29 paired SPEC rows — *not* by LAT-96 / run `c85ee7fc`. An earlier draft of this document attributed it to that concurrent run; that attribution was an inference from the shared-workspace notice, not an observation, and is corrected here.

---

**Conclusion.** The existing Paperclip office already satisfies more of §20.2 than a documentary reading would suggest — project ON/OFF gating, per-project workspaces, native review stages, quota recovery, Hermes escalation and Energy-aware worker instructions are all real and inspected. The binding gap is narrower but sharper than "Paperclip needs extending": the controller's **program root is a module constant pointing at Alexandria**, and the replenisher's **prompt content is hardcoded Alexandria prose that now asserts the opposite of live state**. Those two facts (G1–G3), plus project-less acceptance state (G4), make the current office unable to run Energy work at all and liable to generate misfiled wrong work if the timer restarts. The remaining gaps (G5–G10) are the genuine §20.2 contract surface — canonical eligibility, receipts, packet field coverage — that IMP-26 must materialize.

Per §25.1 IMP-25 and §25.2.2, this audit resolves DEP-27 **only** for the interfaces, workflow, configuration and state enumerated above, and asserts no capability that was not inspected.

---

## 9. Corrections applied after Director pre-review (2026-09-19, 09:17Z – 09:21Z)

Four accuracy corrections were requested by the Director on the draft (comments `fb3550bd` at 09:12:29Z and `842408ac` at 09:16:35Z). **No SPEC change, no semantic requirement change, and no underlying evidence was discarded** — every original observation is preserved; only claims that overstated or misattributed were rewritten.

| # | Correction | Before | After | Where |
|---|---|---|---|---|
| C1 | Evidence window prestated a future end. Server time at draft inspection was 09:11:58Z, but the header claimed reads through 09:18Z. | `09:06Z – 09:18Z` | Observed window `09:06Z – 09:12Z` (matching `evidence.json#audit.evidenceWindowUtc`, which was already correct), plus an explicit, separately-labelled correction window for this second run. | header; `evidence.json#audit` |
| C2 | §20.2.7 field count. Counted directly from the verified SPEC: *Packet ID → Expected handoff format* is **20** rows, not 19. | "19 semantic fields", "8 of 19", "typed 8/19 … untyped 9" | 20 fields; typed 8/20, partial 2/20, untyped prose 10/20 (= 20). The §4 table itself already listed all 20 rows; only the totals and prose were wrong. | §2 row 20.2.7; §4; G7; `evidence.json#gaps.G7` |
| C3 | The missing-typed-fields finding conflated two things. | Read as if prose-carried fields were a §20.2.7 compliance failure. | Split explicitly: **semantic completeness** (SPEC requirement — this packet is 20/20, prose is allowed by §20.2.7's own "contrato semántico / no selecciona formato de almacenamiento") vs **automated enforcement absence** (what `packet.mjs` cannot detect — the actual gap, and the only thing G7 claims). | §2 row 20.2.7; §4 preamble and totals; G7 |
| C4 | Provenance of `operations/bootstrap/canonical-imp-rows.json`. | Attributed to concurrent LAT-96 run `c85ee7fc` — an inference from the shared-workspace notice, not an observation. | Authorship recorded as **not observable by this audit**; per Director comment `842408ac`, produced by the Director in the user task via literal extraction of 29 paired SPEC rows. Observed facts (path, hash, mtime, untouched) unchanged and re-verified. | §8; `evidence.json#workspaceIntegrity.concurrentActivity`; `IMP-25-ST-1.json#artifactsChanged.concurrentRunArtifactLeftUntouched` |

Re-verified live during this correction run (09:17:48Z): Energy Markets `state: on`, `pausedAt null`; Alexandria `state: off`, `pausedAt 2026-09-19T08:58:23.200Z`. `canonical-imp-rows.json` re-hashed, unchanged. Deterministic tests were **not** re-run: nothing they cover changed (per Director instruction in `842408ac`); the saved TAP in `tests-tap.txt` and its module hashes remain the observed result. Output hashes were recomputed after these edits and are recorded in `IMP-25-ST-1.json#resultingVersion` — the pre-correction hashes are superseded and must not be accepted.

**None of C1–C4 changes a gap, a severity, a status, or the central finding of §3.**

---

## 10. Post-audit source drift — read-only delta (observed 2026-09-19T09:28:14.312Z)

Requested by the independent reviewer (Astra, run `2d0fee68`, change 1). Between the original observed window and the review, six of the twenty inspected office sources were rewritten by the owner's concurrent work. **The §§1–9 evidence above is preserved unchanged**: its hashes, line numbers and timestamps remain the true record of what was inspected at 09:06Z–09:12Z. This section is a separately timestamped delta whose only purpose is to make the surface that IMP-26 will bind against factual and traceable. **No office file was modified by this supplement** — every operation was `sha256sum`, `stat` or `grep`.

### 10.1 What changed, what did not

All twenty sources recorded in `evidence.json#inputHashes.officeSources` were re-hashed at 09:28:14.312Z. **Six changed, fourteen are byte-identical to the audit.**

| Source | Audited sha256 | Current sha256 | mtime (UTC) |
|---|---|---|---|
| `controller.mjs` | `e46722c7a936fd95…` | `8609331b96315ca6…` | 09:21:54.455Z |
| `replenisher.mjs` | `d792b4238312f522…` | `2083735e431244b9…` | 09:21:52.515Z |
| `command-question.mjs` | `794613680a21541f…` | `d8bb5d7d302839b4…` | 09:21:52.847Z |
| `review-recovery.mjs` | `a2d708876c903781…` | `b7190bdbd5a65745…` | 09:21:53.191Z |
| `queue-snapshot.mjs` | `e2a324ef81dae055…` | `40c35bf8653cd395…` | 09:26:49.802Z |
| `resources.json` | `58e570d63c924d40…` | `633c87932bcd2203…` | 09:21:53.823Z |

Unchanged (audited hash = current hash): `pcapi.mjs`, `project-gate.mjs`, `packet.mjs`, `final-acceptance.mjs`, `handoff.mjs`, `dispatcher.mjs`, `dead-execution.mjs`, `economics.mjs`, `guards.mjs`, `mutate.mjs`, `notify.mjs`, `pilot.mjs`, `status.mjs`, `lanes.json`.

**`queue-snapshot.mjs` changed twice inside the review window**: the reviewer observed `2290a88e…` at 09:26:34.118Z; by 09:28:14Z it was `40c35bf8…` (mtime 09:26:49.802Z). Drift is *live and ongoing*, not a single settled edit. This is itself a finding for IMP-26: **any line-numbered binding against this tree is valid only at a stated hash.** The delta below therefore identifies each finding by its *source string*, and gives the line number only as a locator at the stated hash.

`resources.json` is recorded as **advisory only**. No G-finding cites it; its content was not read into this audit, and nothing about budget, quota, routing or reserve policy is inspected, reinterpreted or claimed here (packet scope and the reviewer's instruction both exclude it).

Authorship of these edits was not observable by this audit and is **not attributed to this author**; none of them were made by this subtask (§8, and `workspaceIntegrity.officeFilesModified` is empty).

### 10.2 Effect on G1–G10

Every gap was re-located by searching for its cited source string in the current file. ~~**All ten reproduce; none changed severity, none became unknown, none is resolved.**~~ **Corrected in round 2: G1–G8 reproduce; G9 and G10 are superseded by §12** — the string-relocation method used here confirms only that a cited line still exists, and both gaps were wrong about what surrounds it. What moved, for G1–G8, is line numbers only.

| Gap | Cited at audit | At current hashes (09:28:14Z) | Status |
|---|---|---|---|
| **G1** | `controller.mjs:291`, `pcapi.mjs:5`, `pilot.mjs:26`, `economics.mjs:28` | `controller.mjs:291` — `issues.filter((issue) => issue.parentId === ROOT)`, **same line**; `pcapi.mjs:5` `ROOT="ff615d11…"` in an unchanged file; `pilot.mjs`/`economics.mjs` unchanged | **Reproduces, unmoved** |
| **G2** | `replenisher.mjs:317, 319, 320, 323` | Block moved ≈ +21 lines. `338` = *"…CONTINUITY_STATUS.md …, LAT-20 (mandato) y el plan canonico docs/architecture/DECISION_IMPLEMENTATION_PLAN_V1.md…"*; `340` = *"Crear cada unidad como ticket hijo de LAT-20"*; `341` = pending/in-flight packet list; **`344` still reads *"…tocar cualquier issue del proyecto Energy Markets (OFF)…"*** | **Reproduces verbatim.** The self-contradiction of §3 is intact at the current hash |
| **G3** | `controller.mjs:295, 827, 828`; `replenisher.mjs:330, 331, 332` | `controller.mjs:295` `rootGoalId = issues.find(i => i.id === ROOT)?.goalId` **same line**; the refill call arguments moved **827/828 → 872 (`rootId: ROOT`) / 873 (`goalId: backlog.rootGoalId`)** — line 827 now holds handoff setup, exactly as the reviewer noted; ticket construction in `replenisher.mjs` now `351` (`projectId: activeProject.projectId`), `352` (`parentId: rootId`), `353` (`goalId`) | **Reproduces; two locators corrected** |
| **G4** | `replenisher.mjs:307, 320`; `final-acceptance.mjs:35-39, 56-66`; `controller-state.json`; `CONTINUITY_STATUS.md:15` | `replenisher.mjs:310` (`pendingFinalAcceptance` parameter), `328` (`const pending = …join(", ")`), surfaced in the prompt at `341`. `final-acceptance.mjs` **unchanged**. `CONTINUITY_STATUS.md:15` still lists the same 30 Alexandria identifiers with no project key | **Reproduces** |
| **G5** | absence of a symbol; `project-gate.mjs` | `project-gate.mjs` **unchanged** (`18603a44…`); still models only the project dimension. An absence in unchanged files cannot be affected by the drift | **Unaffected** |
| **G6** | `final-acceptance.mjs:28, 42-50` | File **unchanged** | **Unaffected** |
| **G7** | `packet.mjs:9-23, 27, 85` | File **unchanged** (`dbb771b3…`); the 8-of-20 typed coverage and the lowercase-only `KEY_LINE_RE` stand exactly as corrected in C3 | **Unaffected** |
| **G8** | `handoff.mjs:16, 157, 172` | File **unchanged** | **Unaffected** |
| **G9** | `command-question.mjs:104` | Line 104 is unmoved and byte-identical, **but the conclusion drawn from it was wrong** — see §12.2. The SPEC_CHANGE_REQUEST exception sits two lines below at `:106`, with detection at `:161-165` and descriptor conversion at `:242-266`. Superseded by the narrowed G9 | ~~Reproduces, unmoved~~ **SUPERSEDED — see §12.2** |
| **G10** | `queue-snapshot.mjs:105`; `review-recovery.mjs` taxonomy | `blockedKind` did move **105 → 101** (locator correct), **but the finding it carried was wrong** — `:107-110` already surface `AUDIT_DEPENDENT`, `EVIDENCE_DEPENDENT` and `SPEC_CHANGE_REQUEST` from `guards.mjs:119-127`, and `:120` maps `NORMAL_DEPENDENCY`. See §12.1. Superseded by the narrowed G10 | ~~Reproduces; one locator corrected~~ **SUPERSEDED — see §12.1** |

> **Round-2 correction to this section's own claim.** The sentence below ("zero findings change") and the row-level *"all ten reproduce"* were **wrong for G9 and G10**. Re-locating a gap's cited string proves the string is still there; it does not prove the finding built on it was ever true. G9 and G10 asserted absences that never existed at any inspected hash — including the audit's original one. §12 supersedes both. The statement stands for G1–G8, which were re-verified against the drift and are unaffected by the round-2 corrections.

~~**Net effect: zero findings change, zero become unknown, zero are resolved by the drift.**~~ **Net effect (corrected): G1–G8 reproduce unchanged; G9 and G10 are superseded by §12 as false-absence claims, not by the drift.** Three locators are corrected (G3 controller `827/828 → 872/873`, G2 replenisher `317-323 → 338-344`, G10 queue-snapshot `105 → 101`) and one (G4) re-pinned. The binding surface for IMP-26 is therefore unchanged in substance, but must be cited at the hashes in §10.1 rather than at the audit's.

**Deterministic tests were not re-run** (reviewer's explicit instruction; `project-gate.mjs` and `packet.mjs` — the only modules the 31 tests exercise — are byte-identical to the audit, so the saved TAP remains the observed result for the tested surface). Nothing in this delta bears on a test outcome.

---

## 11. The OFF boundary: an in-flight Alexandria review may finish; OFF blocks new work

Requested by the independent reviewer (change 2) and by the packet (*"Record that active Alexandria review may finish; OFF blocks new work"*). §§1, 2 and 6 established that the gate is real and fails closed, but did not separate the three things below. All source citations are read-only; **Alexandria was not toggled, no mutating tick was run, and no Alexandria work was executed.**

### 11.1 Three different claims, kept apart

| Layer | What it is | Status in this audit |
|---|---|---|
| **A. Owner authorization** | `AGENTS.md` §ENERGY-MARKETS-20260919: *"Checkpoint any already-running Alexandria review without starting new work."* Plus the packet line. | A **rule addressed to agents**. It is an instruction, not an enforcement mechanism, and its being satisfied is not evidence that anything enforces it. |
| **B. Native enforcement** (vendored patch + Paperclip server) | What the platform mechanically permits while `pausedAt` is set. | **Inspected below.** Blocks new invocations; does not cancel an in-flight run. |
| **C. Controller enforcement** (office-continuity) | What the office controller will select while a project is OFF. | **Inspected below.** Starts, restores and nudges nothing on an OFF project. |

### 11.2 B — native enforcement, from source

The switch sets `pausedAt` with `pauseReason: "manual"`. The vendored patch reads it in `budgets.js#getInvocationBlock` and states its own boundary in the code:

> `budgets.js:736-738` — *"OFFICE-PROJECT-SWITCH: any other pausedAt (pause_reason 'manual', set by POST /projects/:id/execution) is the office execution gate. It blocks NEW invocations only; nothing here cancels or touches a run already in flight."* → returns `code: "project_execution_off"`.

Corroborated by `project-switch/README.md:18-20` (*"In-flight runs are never touched: the switch route never calls any cancel/pause hook"*).

**Blocked while OFF** — every one of these consults `getInvocationBlock` and refuses:

| Path | Location | Effect |
|---|---|---|
| Any wake enqueue | `heartbeat.js:14086` `enqueueWakeup` → `:14261` | throws `conflict(block.reason)`, writes `budget.blocked` |
| Claiming a queued run | `heartbeat.js:9513` `claimQueuedRun` → `:9529` | the queued run is **cancelled** with the block reason |
| Scheduled retry | `heartbeat.js:8134` `evaluateScheduledRetryGate` → `:8139` | `allowed: false`, `errorCode: "budget_blocked"` |
| Run liveness continuation | `heartbeat.js:6733` → `:6767`, `:6809-6816`; decision in `recovery/run-liveness-continuations.js:59-61` | `{kind: "skip", reason: "budget hard stop blocks continuation"}` |
| Successful-run handoff wake | `heartbeat.js:6900` `handleSuccessfulRunHandoff` → `:7016` | handoff wake not enqueued |
| Issue checkout | `routes/issues.js:9003` `POST /issues/:id/checkout` → `:9016` | `409 "Project is paused"` |
| Safe-recovery hand-back | `routes/issues.js:3871`, `:3884` | `conflict` |

**Not blocked while OFF** — a run already executing keeps its process and its write access:

- Nothing in the switch path cancels a live run (`budgets.js:736-738`; README:18-20).
- `pausedAt` is gated in **exactly two places** in the whole issues route file — the hand-back at `3871` and checkout at `9016` (`grep -n 'pausedAt' routes/issues.js` → `3871`, `4225` (a response field), `9016`). `POST /issues/:id/comments` (`routes/issues.js:10013`), document writes and execution-decision writes carry **no project gate**. An in-flight reviewer can therefore still record its decision and its checkpoint on an OFF-project issue.

**So the accurate statement is narrower than "an Alexandria review may finish."** What may finish is **the single run that is already executing**, including its writes. The review *stage* cannot proceed across runs: once that run ends, continuation, retry, handoff wake, new wake and checkout are all refused. A reviewer that needs a second run to complete its review will not get one while Alexandria is OFF.

### 11.3 C — controller enforcement, from source

`project-gate.mjs` (**unchanged since the audit**, `18603a44…`) yields `project_off` for an issue whose project is not in the ON set (`:79`), `no_project` for a project-less issue (`:78`), and fails closed to `switch_missing` for *everything* if the execution GET is not 200 or the marker is absent (`:76`). `controller.mjs:275-287` builds one gate per tick and hands it to every selector; `:1166-1168` reports it.

Gated selectors, at current hashes: ready-assignment dispatch `dispatcher.mjs:176`, reopen `:255`, stale-pending-review nudges `:313`, **review-recovery GET candidates `review-recovery.mjs:195`**, **wake follow-ups `review-recovery.mjs:282`**, dead-execution `controller.mjs:548`, handoff `controller.mjs:597`.

The consequence worth stating explicitly: **the controller will not restore a quota-stranded Alexandria review while Alexandria is OFF.** The "may finish" allowance covers a live process only — a review that is merely *open* (stage pending, no run executing) is not carried forward by either layer.

### 11.4 Current live instance (observed 09:31:26.995Z)

`GET /companies/{company}/live-runs` → **2 live runs, both on Energy Markets (ON)**: run `5228c431` (`running`, LAT-95, this run) and `2d563751` (`queued`, LAT-96). **Zero Alexandria runs are in flight.** The "already-running Alexandria review may finish" allowance is therefore **currently vacuous** — there is no Alexandria run to finish. Project state re-verified at 09:31:09Z: Energy Markets `on`/`pausedAt null`, Alexandria `off`/`pausedAt 2026-09-19T08:58:23.200Z`/`pauseReason manual`. Timer re-verified at 09:31:17Z: `inactive`, `enabled`, last trigger 08:59:02Z, `Linger=yes`.

### 11.5 Unknowns and one gap this boundary exposes

1. **Not executed.** Everything in §11.2/§11.3 is derived from source and live state. No OFF-project invocation was attempted, no run was allowed to expire, and `switch-test.mjs` (whose own README:132-134 describes a live in-flight check, *"SKIPPED when nothing is in flight"*) was not run — packet prohibition. The boundary is **high-confidence code evidence, not an observed runtime outcome.**
2. **Unresolved interaction, recorded as unknown.** `routes/issues.js:1521-1556`: recording `changes_requested` builds a wake for the return assignee with reason `execution_changes_requested`, and wake enqueue throws `conflict` while the project is OFF (`heartbeat.js:14261`). Whether that throw is caught (decision persists, wake silently skipped) or propagates (decision write fails) was **not determined** and is not claimed either way. It matters precisely for the authorized case — an in-flight Alexandria reviewer recording a decision while OFF — and IMP-26 should settle it by test, not by reading.
3. **Gap, not a new one.** Neither layer distinguishes *"this run may finish"* from *"this stage may proceed"*; the distinction is an emergent property of where `getInvocationBlock` happens to be called, not a modelled concept. There is no office-side representation of an authorized-to-finish run. This is a narrow instance of **G5** (no eligibility model beyond the project dimension) and is folded there rather than raised as a new gap — no gap count or severity changes.
4. **Not inspected.** Whether the 30 pending-final-acceptance Alexandria issues would be *read or mutated* by an Energy-active tick remains unknown (§7 item 4, unchanged) — the OFF gate does not cover the refill prompt's content, which is G4's point.

**Nothing in §11 claims a capability works that was not inspected.** The authorization (A) is satisfied by construction here: this audit ran no Alexandria work and toggled nothing.

---

## 12. Round-2 corrections: two false absence claims, superseded (observed 2026-09-19T09:43:54Z – 09:5xZ)

Requested by the independent reviewer (`independent-review-round-2`, items R3/G10 and R4/G9). Both findings were **wrong**, not merely mislocated: G9 and G10 asserted that capabilities are absent which are present in the office **at the audit's own original hashes** — so this is not drift and not a locator correction. The reviewer's reading is confirmed in full by independent re-inspection and by a bounded pure-function reproduction of my own.

**Method.** Read-only. The three files were re-hashed first and match the hashes the reviewer cites and the supplement's §10.1 baseline exactly, so the correction is anchored to the same bytes the reviewer inspected:

| File | sha256 at 09:43:54Z | Status |
|---|---|---|
| `guards.mjs` | `987411e0cb0b35a19709171b018a93ce283bc3a68fb83cde77b24525395d198b` | unchanged since the audit |
| `queue-snapshot.mjs` | `40c35bf8653cd3956bda6465b5b0a270b15daf75ebb7896f8417594d2c9baf8f` | as at §10.1 (09:28:14Z) |
| `command-question.mjs` | `d8bb5d7d302839b449c90e66ad7638f16989e6549d269d00275768d75f0c613c` | as at §10.1 (09:28:14Z) |

No office file was written, no API mutation issued, no controller tick run, no test re-run (`project-gate.mjs` and `packet.mjs` remain byte-identical; the saved TAP stands).

### 12.1 G10 — §20.2.11 typed blockers: all six meanings exist

`guards.mjs:119-128` `dependencyKind` returns `SPEC_CHANGE_REQUEST` (`:121`), `AUDIT_DEPENDENT` (`:122`), `EVIDENCE_DEPENDENT` (`:123`), `HUMAN_DECISION` (`:124`), `COMMAND_QUESTION` (`:125`) and `NORMAL_DEPENDENCY` (`:126`), from the markers at `:77-83`. `queue-snapshot.mjs:107-110` surfaces the first four directly and `:120` maps `NORMAL_DEPENDENCY → DEPENDENCY_BLOCKED`. The sixth §20.2.11 meaning, *Tool / provider / worker failure*, is carried by the diagnostic branch at `:112-116` (`QUOTA_RECOVERY_PENDING`, `REVIEW_RECOVERY_*`, `REAL_IMPLEMENTATION_FAILURE`). The kinds are consumed by `controller.mjs:933` and `board-sim.mjs:444` into `autonomy.mjs:165-168`, which names `SPEC_CHANGE_REQUEST`, `EVIDENCE_REQUIRED` and `AUDIT_REQUIRED` as autonomy outcomes.

**Own reproduction** (`/opt/node/bin/node --input-type=module`, synthetic in-memory rows, no file/API/office mutation; observed 09:45Z):

| Input row | `dependencyKind` | `blockedKind` |
|---|---|---|
| descriptor `AUDIT_DEPENDENT: …` | `AUDIT_DEPENDENT` | `AUDIT_DEPENDENT` |
| descriptor `AUDIT_REQUIRED: …` | `AUDIT_DEPENDENT` | `AUDIT_DEPENDENT` |
| descriptor `EVIDENCE_DEPENDENT: …` | `EVIDENCE_DEPENDENT` | `EVIDENCE_DEPENDENT` |
| descriptor `SPEC_CHANGE_REQUEST: …` | `SPEC_CHANGE_REQUEST` | `SPEC_CHANGE_REQUEST` |
| descriptor `HUMAN_DECISION: …` | `HUMAN_DECISION` | `HUMAN_DECISION` |
| `blockedByIssueIds:["dep"]`, no descriptor | `NORMAL_DEPENDENCY` | `DEPENDENCY_BLOCKED` |
| `evaluation.diagnostic` ∈ {`QUOTA_RECOVERY_PENDING`, `REVIEW_RECOVERY_RUNNING`, `REVIEW_FAILED_NON_QUOTA`, `REVIEW_RUN_ENDED_WITHOUT_DECISION`, `REVIEW_RECOVERY_BACKOFF`} | — | `QUOTA_RECOVERY_PENDING` / `REVIEW_RECOVERY_RUNNING` / `REAL_IMPLEMENTATION_FAILURE` / `REAL_IMPLEMENTATION_FAILURE` / `REVIEW_RECOVERY_BACKOFF` |
| `blockedByIssueIds:["dep"]` **+ unrecognised descriptor prose** | `HUMAN_DECISION` | `HUMAN_DECISION` |
| `blockedByIssueIds:["dep"]` + descriptor naming the Command | `COMMAND_QUESTION` | `COMMAND_DECISION_PENDING` |

**What was false.** "The §20.2.11 types `Audit-dependent`, `Evidence-dependent`, `Normal dependency`, `SPEC contradiction` have **no** representation" (§2) and "§20.2.11 blocker types … unrepresented" (G10). Both are withdrawn. IMP-26 must **not** rebuild these types.

**What remains true, narrowly** (the new G10): (1) classification is *recognition of free-text prose*, not derivation from typed packet data — `packet.mjs` parses neither `REQUIRES_AUDIT` nor `REQUIRES_EVIDENCE`, so a packet's declared audit/evidence dependency never becomes a typed blocker by itself; (2) no eligibility or dispatch path consults `dependencyKind` — its only consumers are the Queue snapshot and the autonomy classifier, i.e. it explains the board, it does not gate work; (3) §20.2.11's branch scope is unmodelled (a narrow instance of G5); (4) the precedence defect in the last-but-one row above — `guards.mjs:109` returns `human_decision` for any unrecognised descriptor text *before* `:126` can see `blockedByIssueIds`, so an ordinary dependency carrying a free-text note is classified as a human gate. (4) is a genuine, reproducible defect found while correcting this gap; it is recorded inside G10 rather than as a new gap, so the gap count stays at 10.

### 12.2 G9 — §20.2.12: the escalation channel exists

`command-question.mjs:106` — the same `CANONICAL_CONSTRAINTS` line whose *first* clause (`:104`, `WHY_COMMAND_IS_REQUIRED`) I quoted as proof of absence — ends with: *"Si responder exigiera cambiar la arquitectura congelada, NO respondas: comenta en {identifier} una linea que empiece por SPEC_CHANGE_REQUEST: con el motivo y cierra este ticket."* That is an explicit branch-stopping exception, and it is wired:

- **Detection** — `findCommandAnswer` (`:161-165`) returns the Command's comment flagged `specChange: SPEC_CHANGE_MARKER_RE.test(body)`. Reproduced: a `SPEC_CHANGE_REQUEST: …` comment yields `specChange true`; a `COMMAND-ANSWER: …` comment yields `false`.
- **Conversion** — `:242-260`: the source issue's `unblockDescriptor.action` becomes `SPEC_CHANGE_REQUEST: <excerpt>`, the issue is **left blocked**, and a controller comment records it *"parked as SPEC_CHANGE_REQUEST for Bru"*. Only *after* that, at `:261-264`, is a leftover `[COMMAND-QUESTION]` ticket looked up and cancelled — optional cleanup guarded by `if (ok && leftover …)`, **not a precondition** (round-3 correction, §13).
- **Authority transfer** — `guards.mjs:103` then returns `{required: true, reason: "spec_change_request"}`, so `mustNeverTouch`/`humanRequired` keep every controller path off it; `isCommandQuestion` (`:133-138`) goes false, so no further ticket is created; `queue-snapshot.mjs:108` shows it as `SPEC_CHANGE_REQUEST` and `autonomy.mjs:166` reports `SPEC_CHANGE_REQUEST` when it is the only remaining work.

**What was false.** "**ABSENT** — No symbol found", "A branch-stopping SPEC contradiction has no path", the reading of `:104` as evidence that the channel excludes architectural change, and — from §10.2 — "G9 reproduces unchanged". All withdrawn. The line-104 wording scopes the *ordinary* question; it does not negate the exception two lines below. The earlier extension advice ("must not reuse `[COMMAND-QUESTION]`") is also withdrawn: reusing this path is now the recommended minimal extension.

**What remains true, narrowly** (the new G9): the primitive carries a *reason*, not the §20.2.12 *contract*. None of the 11 required fields (SPEC version, IMP/subtask, Source Sections, Exact contradiction, Observed evidence, Why the SPEC cannot be implemented as written, Minimum change, Downstream impact, Work safely completed, Work blocked, Requested authority) is captured anywhere; the stored payload is a whitespace-collapsed 400-character excerpt (`:251`). There is no SPEC/IMP identity, no project binding, and no routing to the architecture/research authority that §20.2.12 distinguishes from the human gate — `humanRequired` collapses both into "a person must act". Entry is narrow, but ~~it requires an open `[COMMAND-QUESTION]` and a Command answer~~ **— corrected in round 3, §13: no `[COMMAND-QUESTION]` ticket is required at any point before conversion.** The real entry conditions are an already-blocked, gate-eligible source carrying a Command-question descriptor plus a recognised **Command agent's** post-block comment; a worker or Astra meeting a contradiction outside that state still has no modelled route in (a hand-written `SPEC_CHANGE_REQUEST:` descriptor would be *recognised* by `guards.mjs:78,103`, but nothing creates or validates it). **This primitive alone does not satisfy the §20.2.12 contract, and nothing here claims it does.**

### 12.3 Scope of this correction *(round 2; round 3's own scope is at the end of §13)*

Changed: §2 rows 20.2.11 and 20.2.12; §5 gaps G9 and G10 (text, evidence, minimal extension — severities unchanged at Medium/Low); §10.2 rows G9/G10 and its net-effect sentence; this section; the matching `evidence.json` entries and the receipt. **Unchanged:** gap count (10), all severities, G1–G8 in full, §3's central finding, the §4 field reconciliation, §6 contrasts, §7 unknowns, §8, §9, §10.1 drift data, §11 in full including its declared limits, `depResolution`, and the absence of a SPEC_CHANGE_REQUEST for this ST (these were materialization/accuracy findings inside IMP-25, not canonical contradictions). All superseded text is retained above, struck through or labelled, per the reviewer's instruction that historical observations be preserved while false claims are explicitly withdrawn.

**Effect on the audit's conclusion:** none. G9 and G10 were the two lowest-severity gaps; both shrink. The critical finding (G1–G3: Energy work is invisible to the controller and a restarted timer would refill against the wrong project) is untouched by this correction, as is the conclusion that the office must be **extended, not rebuilt** — indeed §12 strengthens it, since two more capabilities turn out to exist already.

## 13. Round-3 correction — G9's entry condition: no `[COMMAND-QUESTION]` ticket is required

Requested by the independent reviewer (`independent-review-round-3`, item R5). **The reviewer is right and the claim is withdrawn.** Round 2 narrowed G9 correctly on the *contract*, but replaced one false absence with a false *precondition*: that the existing conversion requires an open `[COMMAND-QUESTION]` ticket. It does not. Verified at the unchanged hash `command-question.mjs d8bb5d7d302839b449c90e66ad7638f16989e6549d269d00275768d75f0c613c`, re-hashed 2026-09-19T11:22:11Z alongside `guards.mjs 987411e0…`, `queue-snapshot.mjs 40c35bf8…`, `autonomy.mjs 84df72e4…` — the same bytes both prior rounds inspected.

**Where the claim fails in the source.** `:228-241` selects candidates — gate-eligible blocked rows that `isCommandQuestion`, refetched and re-checked — and reads their comments. `:242-260` converts as soon as `answer.specChange` is true. There is no ticket predicate anywhere on that path. `ticketsForSource(...)` is first called at `:261`, *after* `applied.push({step:"spec_change"})`, inside `if (ok && leftover && budget)` — cleanup, not a gate. The open-ticket lookup at `:325` belongs to Phase A, reached only when `findCommandAnswer` returned nothing.

**Independent reproduction** (my own, not the reviewer's, run 2026-09-19T11:2x Z, `/opt/node/bin/node`, imported `runCommandQuestion` + real `buildProjectGate`, injected in-memory `api`/`mutate`, no real API, no controller tick, no file or issue mutation):

- **Positive, zero tickets.** `backlog.allIssues = []` — no `[COMMAND-QUESTION]` ticket in existence. One synthetic blocked source, descriptor `no_guess: ask Command whether D3 applies`, one post-block comment from a recognised Command agent marked `SPEC_CHANGE_REQUEST:`. Result: `applied = [{step:"spec_change"}]`, diagnostic `COMMAND_SPEC_CHANGE_REQUESTED`, exactly one mutation, targeted at the **source** (`/issues/src-1`), descriptor rewritten to `SPEC_CHANGE_REQUEST: …`. **8/8 assertions passed.**
- **Boundary probes P1–P9, 12/12 assertions passed**, isolating what the entry condition actually is:

| Probe | Condition varied | Result |
|---|---|---|
| P1 | baseline (above) | converts |
| P2 | project **OFF** | not even evaluated — the gate drops it |
| P3 | descriptor without a Command-question marker | no conversion |
| P4 | descriptor **already** `SPEC_CHANGE_REQUEST` | excluded (`humanRequired`) — no re-entry, no loop |
| P5 | source status `in_progress`, not blocked | `NOT_A_COMMAND_QUESTION` |
| P6 | same marked comment authored by the **worker**, not a Command agent | **no conversion** |
| P7 | Command comment posted **before** `blockedTransitionAt` | no conversion |
| P8 | ordinary Command answer precedes the marked one | `resume_worker` wins — `findCommandAnswer` takes the first post-block Command comment only |
| P9 | `mutate.remaining() = 0` | deferred with the same diagnostic; still no ticket involved |

**The actual precondition set**, therefore: (1) the source is in the controller's blocked list and passes the project gate (ON, scoped); (2) `!mustNeverTouch`, `status === "blocked"` on refetch; (3) `isCommandQuestion` — a non-empty descriptor that is not `humanRequired`, does not start with `OFFICE-CONTINUITY`, and matches `/\b(no_guess|Command|Tech Lead)\b/i`; (4) the **first** non-deleted comment after `blockedTransitionAt ?? updatedAt` authored by an agent in `commandAgentIds` matches `/\bSPEC_CHANGE_REQUEST\b/i`; (5) `maxPerTick` and mutation budget available. Ticket existence appears in none of them.

**Withdrawn:** "Entry is single-path: it requires an open `[COMMAND-QUESTION]` and a Command answer" (§5 G9 row, §12.2), and the extension advice built on it — "add a second entry point that does not require an open `[COMMAND-QUESTION]`" (§5 G9, `evidence.json` `gaps[G9].minimalExtension`, receipt `postReviewRound2Corrections`, continuity-checkpoint). That advice asked IMP-26 to build something that already exists.

**Replaced with** the constraint that is real: entry is narrow in **author and source state**, not in ticket existence (P3, P5, P6). IMP-26's minimal extension is therefore (a) the structured 11-field payload plus SPEC/IMP/project binding, and (b) widening *who* may raise a contradiction and *from what state* — a packet owner or reviewer on a source not already parked as a Command question — while reusing this conversion path unchanged.

**Preserved:** the valid part of G9 — the missing 11-field canonical contract, the ≤400-char excerpt payload, the absent SPEC/IMP identity and project binding, and the absent architecture/research authority routing distinct from the human gate. Severity stays **Medium**; the gap count stays 10; G1–G8 and G10 are untouched. Nothing here claims the missing capability works.

### 13.1 Scope of the round-3 correction

Changed: §5 gap G9 row (entry-condition sentence, evidence locators, minimal extension — severity unchanged at **Medium**); §12.2's conversion bullet (`:242-266` → `:242-260` plus the post-conversion cleanup note) and its "single-path / requires an open `[COMMAND-QUESTION]`" sentence; the document header's evidence-window line; this section; the matching `evidence.json` `gaps[G9]` fields and `roundThreeCorrections`; the receipt's correction block.

**Unchanged:** gap count (10), every severity, G1–G8 and G10 in full, §3's central finding, §4, §6, §7, §8, §9, §10, §11, §12.1, the valid remainder of §12.2, `depResolution`, and the absence of a SPEC_CHANGE_REQUEST for this ST — this was a factual accuracy error inside my own audit, not a canonical contradiction. No architecture was regenerated, no controller code was read for modification or modified, and the unchanged required tests were not rerun (`project-gate.test.mjs`, `packet.test.mjs` remain 31/31 at unchanged target hashes). All superseded text is retained, struck through or labelled.

**Effect on the audit's conclusion:** none. G9 stays Medium and keeps its valid core — the missing 11-field §20.2.12 contract. What changes is the *shape* of the extension IMP-26 must build: widen author and source state, not ticket dependence. G1–G3 remain the critical finding and are untouched.

**Live state at correction time** (read-only, 2026-09-19T11:28:12Z): `GET /companies/{companyId}/projects/execution` — Alexandria `off`, Energy Markets `on`. `latinosolutions-continuity.timer` ActiveState `inactive`, SubState `dead`, UnitFileState `disabled`; `Linger=yes`. Unchanged and left exactly as found — no timer action was taken, per OWNER-IMP26-BLOCKER-20260919. (Incidentally: `GET /projects/execution` without the company segment returns HTTP 500 and `GET /projects` returns 404; only the companies-scoped route `project-gate.mjs:43` uses is valid. Recorded as an observation, outside this packet's scope.)
