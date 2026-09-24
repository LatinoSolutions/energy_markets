// Continuation loop SPEC-bound (IMP-26). Fuente: SPEC v1.1.1 §20.2.13 ("Cuando
// READY cae por debajo del threshold configurado, el orquestador consulta qué
// IMPs canónicos son elegibles, no inventa una nueva agenda") y §20.2.11 ("Si no
// existe ninguno, se expone la causa en Queue y se aplica el continuation loop,
// sin fabricar trabajo ni cierres").
//
// El threshold/scheduler/peristencia son del office existente; este módulo sólo
// resuelve la selección SPEC-bound y los blockers trazables. Nunca inventa
// scope: si no hay IMP elegible, devuelve NO_ELIGIBLE con la causa.

import { eligibleImps, evaluateEligibility } from "./eligibility.mjs";

export const CONTINUATION_ACTIONS = Object.freeze({
  PROJECT_OFF: "PROJECT_OFF",
  ABOVE_THRESHOLD: "ABOVE_THRESHOLD",
  NO_ELIGIBLE: "NO_ELIGIBLE",
  SELECT: "SELECT",
});

// Causas tipadas de los IMPs canónicos no elegibles (sin fabricar trabajo).
function canonicalBlockers(options) {
  const rows = options.graph?.imps ? Object.values(options.graph.imps) : [];
  const blockers = [];
  for (const row of rows) {
    const result = evaluateEligibility({ ...options, impId: row.id });
    for (const blocker of result.blockers) {
      blockers.push({ imp: row.id, kind: blocker.kind, code: blocker.code, detail: blocker.detail ?? null });
    }
  }
  return blockers;
}

export function resolveContinuation({
  graph,
  projectOn,
  readyCount,
  threshold,
  ...eligibilityOptions
} = {}) {
  if (!projectOn) {
    return { action: CONTINUATION_ACTIONS.PROJECT_OFF, selected: null, eligible: [], blockers: [{ kind: "NORMAL_DEPENDENCY", code: "PROJECT_OFF", imp: null }] };
  }
  if (Number(readyCount) >= Number(threshold)) {
    return { action: CONTINUATION_ACTIONS.ABOVE_THRESHOLD, selected: null, eligible: [], blockers: [] };
  }
  const options = { graph, projectOn, ...eligibilityOptions };
  const eligible = eligibleImps(options);
  if (eligible.length === 0) {
    return { action: CONTINUATION_ACTIONS.NO_ELIGIBLE, selected: null, eligible: [], blockers: canonicalBlockers(options) };
  }
  return { action: CONTINUATION_ACTIONS.SELECT, selected: eligible[0], eligible, blockers: [] };
}
