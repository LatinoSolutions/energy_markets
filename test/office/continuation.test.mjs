import { test } from "node:test";
import assert from "node:assert/strict";

import { CONTINUATION_ACTIONS, resolveContinuation } from "../../src/office/continuation.mjs";
import { makeGraph, realGraph, row } from "./fixtures.mjs";

// Grafo con un único IMP elegible cuando IMP-01/IMP-25 están accepted.
function graph() {
  return makeGraph([
    row({ id: "IMP-01" }),
    row({ id: "IMP-25" }),
    row({ id: "IMP-26", requires: ["IMP-01", "IMP-25"], requiresAuditDeps: ["DEP-27"] }),
  ]);
}

test("Project OFF no selecciona trabajo", () => {
  const outcome = resolveContinuation({ graph: graph(), projectOn: false, readyCount: 0, threshold: 3 });
  assert.equal(outcome.action, CONTINUATION_ACTIONS.PROJECT_OFF);
  assert.equal(outcome.selected, null);
});

test("READY por encima del threshold no dispara refill", () => {
  const outcome = resolveContinuation({ graph: graph(), projectOn: true, readyCount: 5, threshold: 3 });
  assert.equal(outcome.action, CONTINUATION_ACTIONS.ABOVE_THRESHOLD);
  assert.equal(outcome.selected, null);
});

test("READY bajo selecciona sólo un IMP canónico elegible, sin inventar scope", () => {
  const outcome = resolveContinuation({ graph: graph(), projectOn: true, readyCount: 0, threshold: 3, acceptedInstances: [{ imp: "IMP-01" }, { imp: "IMP-25" }], auditSatisfied: ["DEP-27"] });
  assert.equal(outcome.action, CONTINUATION_ACTIONS.SELECT);
  assert.equal(outcome.selected.id, "IMP-26");
  assert.ok(outcome.eligible.every((entry) => Object.prototype.hasOwnProperty.call(graph().imps, entry.id)));
});

test("sin IMP elegible expone blockers trazables y no fabrica trabajo", () => {
  const blockedGraph = makeGraph([
    row({ id: "IMP-02", requires: ["IMP-01"] }),
    row({ id: "IMP-26", requires: ["IMP-01", "IMP-25"] }),
  ]);
  const outcome = resolveContinuation({ graph: blockedGraph, projectOn: true, readyCount: 0, threshold: 3 });
  assert.equal(outcome.action, CONTINUATION_ACTIONS.NO_ELIGIBLE);
  assert.equal(outcome.selected, null);
  assert.ok(outcome.blockers.length > 0);
  assert.ok(outcome.blockers.every((blocker) => typeof blocker.code === "string" && typeof blocker.imp === "string"));
  assert.ok(outcome.blockers.some((blocker) => blocker.code === "REQUIRES_MISSING"));
});

test("sobre el grafo real, con IMP-01 e IMP-25 accepted, IMP-26 es elegible y la selección es canónica", () => {
  const outcome = resolveContinuation({ graph: realGraph(), projectOn: true, readyCount: 0, threshold: 3, acceptedInstances: [{ imp: "IMP-01" }, { imp: "IMP-25" }], auditSatisfied: ["DEP-27"] });
  assert.equal(outcome.action, CONTINUATION_ACTIONS.SELECT);
  assert.ok(outcome.eligible.some((entry) => entry.id === "IMP-26"));
  assert.ok(outcome.eligible.every((entry) => Object.prototype.hasOwnProperty.call(realGraph().imps, entry.id)));
  assert.ok(!outcome.eligible.some((entry) => entry.id === "IMP-01" || entry.id === "IMP-25"));
});
