# Owner Patch — Canonical Office Binding

- Patch ID: `EM-SPEC-OWNER-PATCH-2026-09-24-01`
- Date: 2026-09-24
- Authority: Bru
- Baseline: `PROCUREMENT_RESEARCH_CANONICAL_ENGINEERING_SPEC_v1_1_1.md`
- Scope: §20.2, DEP-27, IMP-25/IMP-26 and references whose only semantics are the implementation-office runtime.
- Status: CANONICAL / ACTIVE targeted owner patch.

## Decision

Paperclip is retired as the runtime/orchestration substrate for Energy Markets. The canonical implementation handoff is rebound to the owned canonical Oficina currently operating the project.

This does **not** retire or weaken the D18 D4 contract. It changes only the runtime/provider binding. The following semantics remain mandatory:

- the canonical IMP graph is the only implementation plan;
- Project OFF prevents new dispatch;
- only dependency-ready canonical work may become READY/dispatched;
- work is isolated in branches/worktrees;
- implementation and independent review remain distinct where required;
- tests, receipts and parent acceptance are not interchangeable;
- recovery/continuation/failover preserve identity and evidence;
- missing factual evidence remains missing;
- a worker cannot create scope, approve architectural contradictions, or fabricate a human gate;
- Production Governance and all Real Execution gates remain unchanged.

## Migration treatment of IMP-25 and DEP-27

IMP-25 remains accepted as the historical factual office audit. It is not silently rewritten.

Because the runtime changed after that audit, IMP-26 must begin by revalidating, read-only where possible, the factual delta for the current Oficina: roles/routing, Project ON/OFF, READY/queue selection, dispatch, isolated work, review independence, receipts/acceptance, recovery/continuation and relevant permissions/state.

A historical Paperclip fact is not current evidence merely because IMP-25 was accepted. Conversely, the runtime migration does not require reopening the accepted IMP-25 parent by default. A current mismatch is:

1. a verified IMP-26 implementation gap if the canonical contract already specifies the required behavior; or
2. a `SPEC_CHANGE_REQUEST` if the mismatch is a true contradiction requiring changed semantics.

## IMP-26 authorization

IMP-26 is unpaused by this owner decision. Its acceptance still requires normal implementation, tests, independent review and merge/acceptance under the canonical Office lifecycle.

It must extend only verified gaps. Existing compliant capabilities are tested/reused, not rebuilt for activity.

## Explicit non-authorizations

This patch does not authorize:

- marking IMP-26 accepted without evidence;
- deleting IMP-26 from the completion denominator;
- reclassifying missing audit/evidence as satisfied;
- live procurement, capital use, first A1 activation, autonomy promotion, or Real Execution;
- changing reward, benchmark, strategy identity, population, OOS protocol, Safety/Autonomy Envelope, or Product Governance semantics;
- touching Alexandria.
