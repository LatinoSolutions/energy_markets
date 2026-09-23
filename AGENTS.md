# Dos sistemas trabajan en este repo (Bru, 2026-09-23)

- Si te lanzó la **Oficina propia** (tu prompt dice "Estás en un git worktree aislado"): sigue `OFICINA.md` y no lo de abajo. Allí los commits en tu rama están autorizados.
- Si te lanzó **Paperclip**: siguen vigentes las reglas de abajo, sin cambios.
- El repo ahora tiene historial git en `main` (commit f545d86). Paperclip no debe crear ramas `run/*`: son de la Oficina.

---

# Energy Markets / Procurement Research v1.1

Owner authorization: Bru, 2026-09-19, this task. Run on brunode in /srv/hot-data/energy-markets/app. The existing Paperclip project is 96bbd5b1-94da-4781-8c2b-455fdfb28d1a. Alexandria is OFF for new office work; preserve all its code, issues and evidence. No branches/worktrees, commits/push, purchases, trading, production activation, autonomy changes or budget/routing changes are authorized here.

Sole normative engineering source: docs/canonical/PROCUREMENT_RESEARCH_CANONICAL_ENGINEERING_SPEC_v1_1.md (v1.1, SHA256 86c4bd4eeb5f9d0ebad94763128b221eb64525a2b7fff1007dab0af88b39cb6c). Consolidation Report gives status/provenance; Patch Report records changes already applied. Never reapply D1-D5. /srv/hot-data/energy-markets/reference contains historical provenance, not extra requirements. Full frontend design will come from Bru later; preserve §26 backend observability boundary.

Read §§20.2,25.1,25.2 before coordination; relevant normative sections before each implementation. Project ON and scoped, accepted REQUIRES* govern eligibility. RESOLVES_AUDIT and PRODUCES_EVIDENCE are outputs, not prerequisites. No invented data, fees, evidence or accepted receipts. Only IMP-01 and IMP-25 are initially eligible; no parent IMP is accepted yet. IMP-26 requires accepted IMP-01 and IMP-25 and sufficient DEP-27 audit scope. ST accepted is not IMP accepted. Paperclip issue done is not an IMP_RECEIPT.

Use current office roles, routes, quotas and review mechanism. Command decomposes and reviews parent acceptance; DeepSeek implements routine packets; Luna handles eligible premium work; Opus reviews independently and is authorized Command failover. No new office, agents, architecture or arbitrary backlog. Follow the existing WORK-PACKET v1 parser while including all semantic fields of §20.2.7, full ST_RECEIPT of §20.2.8, independent review of §20.2.9 and parent acceptance/IMP_RECEIPT of §20.2.10. Preserve accepted prior receipts and scope/version identity.

Known preflight gap: office controller ROOT and refill prompts still point to LAT-20/Alexandria. Do not create Energy issues as children of LAT-20 or use Decision Engine requirements. Bootstrap runs use native Paperclip assignments under Director coordination while the automated controller timer is temporarily held. This is not proof of IMP-26 compliance. IMP-25 audits the gap; IMP-26 must bind the existing controller, then restore the same timer and verify a real continuation cycle. Do not alter quotas/reserves/providers while Bru and Claude work on budgets.

Only modify packet allowed_paths; preserve dirty files. Baseline for this new non-git workspace is the manifest in operations/bootstrap; code and evidence are identified by content hashes until the owner chooses repository publication. No implicit requirement to initialize git or create branches. Run on brunode and verify actual cwd. Existing instructions restricting Alexandria to its main branch apply to Alexandria, not to this new directory.

Scope technical failures to their branch and use existing bounded recovery. SPEC contradictions require §20.2.12 SPEC_CHANGE_REQUEST with exact evidence, never a silent frozen decision change. Escalate genuine human authority needs through existing Director Hermes Telegram, as Bru authorized. No routine approvals. Respect machine quotas and report technical blockers accurately.

Bootstrap technical finding: this Paperclip install requires .git metadata even for non_git_path workspaces. Director initialized the new Energy directory as its own empty repository, initial main, with no commits, remotes or worktrees. Content hashes remain the starting baseline; this does not change Alexandria. Workers must not create additional branches.

Current coordination note: read operations/bootstrap/CONCURRENT_OWNER_WORK.md before any shared office integration. Project-local work/reviews may continue; do not modify shared files concurrently with Bru/Claude.

## OWNER EVENT-DRIVEN COMMAND CORRECTION — 2026-09-19
Read operations/bootstrap/COMMAND_HANDOFF.md and OWNER_EVENT_DRIVEN_COMMAND_20260919.txt. Command operates only in bounded event-triggered bursts and exits; no polling/waiting for workers/reviews. Claude exclusively owns BOTH office-continuity and office-awareness and related policy/tests/config; no concurrent changes or timer actions until ownership release. This later owner instruction supersedes narrower controller-only holds and earlier timer restoration permission. Native dependency gates, not an interactive session, wake parent acceptance.

## OWNER-IMP26-BLOCKER-20260919
Read /srv/hot-data/energy-markets/app/operations/bootstrap/IMP-26-BLOCKER-EVIDENCE-UPDATE.md. Claude's cutover is complete; North Star resource policy at 3a02669 remains READ-ONLY. IMP-26 project binding is eligible only after canonical prerequisites. Timer must stay OFF until all ten scope/isolation requirements AND the observed Energy-only worker/review/continuation sequence pass. Earlier permission to restore before live validation is superseded. Command remains event-driven and bounded.
