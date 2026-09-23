# OWNER-IMP26-BLOCKER-20260919

Latest owner instruction supersedes older shared-edit holds and timer-restoration instructions only to the extent stated here. Claude has completed the North Star cutover. The resource policy baseline is controller commit 3a02669 and is READ-ONLY for IMP-26. Project binding work may proceed only when the existing canonical eligibility gates pass; no budget, reserve, routing, autonomy or North Star policy modifications are authorized. A demonstrated frozen-decision contradiction requires a scoped SPEC_CHANGE_REQUEST, not silent changes.

Exact blocker: office-continuity imports fixed ROOT from pcapi.mjs; gatherBacklog filters issue.parentId === ROOT. ROOT refers to LAT-20 while Energy Markets is ON under LAT-91. Owner reports that a dry-run attempted an Energy refill under LAT-20. This report is evidence of the blocker, not evidence that a fix or live acceptance test passed.

Mandatory IMP-26 acceptance requirements:
1. The controller resolves the currently ON project.
2. It resolves that project's corresponding root/goal without hardcoding LAT-20.
3. Backlog, READY, replenisher, command-question, reviews, final acceptance, handoff, dead-execution and autonomy operate only within the ON project's scope.
4. Alexandria OFF produces zero new work.
5. Energy Markets ON uses only its canonical tree/graph.
6. A Project Switch changes controller scope dynamically without code changes or architectural restart.
7. An issue without a project remains non-executable.
8. Replenisher never creates a ticket below another project's root.
9. Previous OFF-project state cannot contaminate READY, pending acceptance, recovery claims or starvation for the ON project. Preserve prior history and state; isolate it rather than deleting it.
10. Reactivate the timer only AFTER all this validation passes.

Required observed acceptance sequence:
Energy Markets ON + Alexandria OFF -> bounded controller tick -> scope/root Energy Markets / LAT-91 -> no LAT-20 child enters executable backlog -> refill, if warranted by existing policy, belongs to Energy Markets and LAT-91 -> worker executes -> independent review -> continuation -> Astra stays idle except a bounded Command event.

Use an explicitly bounded live validation with the recurring timer OFF; do not turn the timer on in order to obtain acceptance evidence. No interactive watching or polling of workers/reviews: preserve the continuation checkpoint, use native events, return idle. Fixture tests and dry-runs alone cannot satisfy the observed live sequence. Dynamic switch isolation may be tested with injected test state; this instruction does not authorize activating Alexandria's real work. If safe live validation is technically unavailable, record the precise gap and remain blocked with timer OFF.

Timer safety state verified after this update: latinosolutions-continuity.timer inactive/dead and disabled. It was previously inactive but enabled; disabled to preserve OFF across restart until the gate passes. Only an eligible bounded Command action after the complete acceptance evidence and independent review may re-enable/start it. This supersedes prior packet wording that allowed restoring the timer after code review but before live validation.

Existing dependencies are unchanged: separately ACCEPTED IMP-01 and IMP-25, scoped canonical receipts and independent reviews, sufficient DEP-27 audit scope, Project ON, no unresolved applicable SPEC_CHANGE_REQUEST. Child completion/native done does not accept the IMP parent. No new scheduler, agents, worktrees, purchases or continuous Command monitoring. NORTH STAR POLICY FROZEN; integration seams must preserve its behavior and values. All other existing packet path restrictions remain; if a prohibited policy surface seems necessary, provide precise evidence and scoped change request before modifying it.
