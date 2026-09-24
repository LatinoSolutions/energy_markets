# UI-04 — Claude-only: UI fidelity verification and canonical data population

Owner: Bru. Clarification: 24 September 2026.
Project: energy-markets / Energy Markets · Procurement Research.
This refines the existing UI-04; it is not a new implementation plan or research phase.

## Latest owner request — literal

> Que la tarea asignada sea que tal como hizo el mockup Claude, ahora la user interface tiene que estar uno a uno a ese mockup. Luego, después de revisar eso, que eso ya está listo porque ya la corrigió y ya se ve idéntica, ahora lo que tiene que hacer es empezar a poblar esta user interface (replay - Backtest - Reseach - Campains). Entonces quiero que le preguntemos directamente a él cuáles son los requisitos y dentro de la información que nosotros tenemos dentro de la carpeta del proyecto, qué puede él utilizar para poder lograr esta poblar, digo poblar con datos esta user interface de nosotros. Entonces muy simple. y quiero que esa tarea se asigne directamente a Claude. Nadie más. Él tiene que hacerlo porque no quiero modelos baratos metiendo mano ahora en estas partes delicadas de Energy Markets.

## Assignment and operational boundary

Claude Opus 5.5 only. No cheap implementer, correction, delegated subagent or hidden provider fallback for UI-04. Unavailable Claude means waiting, not substitution. Keep independent acceptance requirements; do not self-approve or merge this work.

The task is temporarily held outside automatic dispatch/follow-ups solely to enforce this owner reservation with the current Office lifecycle. This is NOT a pause requested by Bru of the investigation or permission to abandon the task. Use one canonical Office run on an isolated task branch. Do not edit Office runtime code, restart services, change quota, or change any project's play/pause flags.

## Work, in order

1. Verify and reuse the already corrected Claude design. Do not redesign from scratch. Inspect the selected mockup and the existing fidelity correction, compare their actual files/versions and distinguish the publicized private preview from main. Preserve the corrected composition, navigation and interactions; only fix a demonstrated remaining visual discrepancy. Record evidence rather than assuming a task acceptance proves visual equality.
2. Answer directly: for Replay, Backtests, Research, and Campaigns & Runs, what are the requirements to populate them, and which information already in the project can be used? Read the current canonical SPEC, owner amendments, code and actual artifacts. Distinguish current evidence from superseded audits, templates, fixtures and examples.
3. Wire existing, usable canonical data through the accepted backend and Operator Interface Boundary in this task branch. A document can support a factual label or taxonomy; it is not a price series, experiment outcome or authority receipt. Do not silently mark questionable data admissible. Preserve point-in-time availability, record/version/source references and temporal separation.
4. Where data is missing or an output has not been produced, retain honest missing-data states within the selected visual layout and return a concrete to-do list. Per gap: screen/panel, required data, existing source (if any), missing input or binding, canonical producer/process, next action and verifiable completion condition. Separate data, audit, not-yet-run process, wiring and missing implementation. Do not invent runnable commands: provide a verified entry point or explicitly state that it does not yet exist.

## Verified starting locators (inspect, not blanket approval)

- Main project: `/srv/hot-data/energy-markets/app`.
- Canonical SPEC: `docs/canonical/v1_1_1/PROCUREMENT_RESEARCH_CANONICAL_ENGINEERING_SPEC_v1_1_1.md`, plus applicable later owner patches.
- Selected Claude blind prototype: `/srv/hot-data/oficina-data/design-selections/energy-markets/claude-blind-c35510b/index.html` (source design commit `c35510b`).
- Existing Claude fidelity correction: commit `af4d01bb862e1228e2f6acc4deb54a0f5a326297` on `/srv/hot-data/oficina-data/worktrees/energy-markets/energy-markets-UI-FIDELITY-20260924-115600-claude`.
- That correction includes `docs/product/ui-fidelity/FIDELITY_AUDIT.md` and before/golden/after comparisons. Its presence has been observed; do not infer that it was already merged/deployed to main. Reuse it through the current task branch after checking scope and compatibility; do not write into its source worktree.
- Existing private production UI: `http://100.92.44.106:8788/`.
- Existing private fidelity preview: `http://100.92.44.106:8789/`.
- Inspect current `/health` and served pages; an empty health binding alone does not prove the underlying project has no usable data.

## Scope protection

- Do not import mockup/demo/SYN values as factual data, fabricate outputs, or erase honest missing-data states to look complete.
- Keep canonical economics, taxonomy, PIT, provenance, research gates and authority unchanged. Do not add a new research hypothesis phase or reopen closed architecture decisions.
- Do not run a new research/backtesting campaign, OOS consumption, training, external data acquisition or live activation merely to fill a panel. List requirements/processes for missing outputs; do not fabricate or silently execute them. Existing deterministic readers/adapters can be used after inspection.
- No purchases, credits, plan changes, broker/capital actions, new public exposure or deployments. Do not touch Alexandria.
- All product changes stay in the canonical UI-04 task worktree and branch, with tests and a reviewable commit. Preserve existing untracked audit work in main.
- Do not edit PLAN_STATUS.md, create further executable tasks, change project state, or mark this task accepted.

## Deliverables

- Verified/reused selected visual composition, not a competing redesign.
- Available canonical information actually connected and tested in the task branch.
- `docs/product/UI-04_DATA_REQUIREMENTS_AND_TODO.md`: per-screen available vs missing requirements and ordered minimal next actions, with file/section/record references.
- Full existing test suite plus relevant data binding/fidelity/no-fabrication tests.
- Final response to Bru in plain Spanish: what already displays real data, what remains missing, and what must be run or supplied next. State precisely branch-only vs deployed.
