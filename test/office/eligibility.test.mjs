import { test } from "node:test";
import assert from "node:assert/strict";

import { BLOCKER_KINDS } from "../../src/office/blockers.mjs";
import { evaluateEligibility, eligibleImps, isNewInstance, sameInstance } from "../../src/office/eligibility.mjs";
import { makeGraph, realGraph, row } from "./fixtures.mjs";

function graph() {
  return makeGraph([
    row({ id: "IMP-01" }),
    row({ id: "IMP-02", requires: ["IMP-01"] }),
    row({ id: "IMP-03", producesEvidenceDeps: ["DEP-07"], resolvesAuditDeps: ["DEP-06"] }),
    row({ id: "IMP-26", requires: ["IMP-01", "IMP-25"], requiresAuditDeps: ["DEP-27"] }),
    row({ id: "IMP-25" }),
  ]);
}

function codes(result) {
  return result.blockers.map((blocker) => blocker.code);
}

test("Project OFF impide dispatch de cualquier IMP (§20.2.4.1)", () => {
  const result = evaluateEligibility({ graph: graph(), impId: "IMP-26", projectOn: false, acceptedInstances: [{ imp: "IMP-01" }, { imp: "IMP-25" }] });
  assert.equal(result.eligible, false);
  assert.deepEqual(codes(result), ["PROJECT_OFF"]);
  assert.equal(result.blockers[0].kind, BLOCKER_KINDS.NORMAL_DEPENDENCY);
});

test("un IMP fuera del grafo canónico no es elegible", () => {
  const result = evaluateEligibility({ graph: graph(), impId: "IMP-99", projectOn: true });
  assert.equal(result.eligible, false);
  assert.deepEqual(codes(result), ["CANONICAL_ID_UNKNOWN"]);
});

test("la falta de REQUIRES* bloquea; aceptarlos habilita (IMP-26 requiere IMP-01 e IMP-25)", () => {
  const missing = evaluateEligibility({ graph: graph(), impId: "IMP-26", projectOn: true, acceptedInstances: [{ imp: "IMP-01" }] });
  assert.equal(missing.eligible, false);
  assert.deepEqual(codes(missing), ["REQUIRES_MISSING"]);
  assert.deepEqual(missing.blockers[0].detail.missing, ["IMP-25"]);

  const satisfied = evaluateEligibility({ graph: graph(), impId: "IMP-26", projectOn: true, acceptedInstances: [{ imp: "IMP-01" }, { imp: "IMP-25" }], auditSatisfied: ["DEP-27"] });
  assert.equal(satisfied.eligible, true, JSON.stringify(satisfied.blockers));
});

test("REQUIRES_AUDIT satisfecho habilita; ausente produce blocker AUDIT_DEPENDENT", () => {
  const blocked = evaluateEligibility({ graph: graph(), impId: "IMP-26", projectOn: true, acceptedInstances: [{ imp: "IMP-01" }, { imp: "IMP-25" }] });
  assert.equal(blocked.eligible, false);
  assert.equal(blocked.blockers[0].kind, BLOCKER_KINDS.AUDIT_DEPENDENT);
  assert.deepEqual(blocked.blockers[0].detail.missing, ["DEP-27"]);

  const ok = evaluateEligibility({ graph: graph(), impId: "IMP-26", projectOn: true, acceptedInstances: [{ imp: "IMP-01" }, { imp: "IMP-25" }], auditSatisfied: ["DEP-27"] });
  assert.equal(ok.eligible, true);
});

test("REQUIRES_EVIDENCE ausente produce blocker EVIDENCE_DEPENDENT", () => {
  const g = makeGraph([row({ id: "IMP-19", requiresEvidenceDeps: ["DEP-13"] })]);
  const blocked = evaluateEligibility({ graph: g, impId: "IMP-19", projectOn: true });
  assert.equal(blocked.eligible, false);
  assert.equal(blocked.blockers[0].kind, BLOCKER_KINDS.EVIDENCE_DEPENDENT);
  const ok = evaluateEligibility({ graph: g, impId: "IMP-19", projectOn: true, evidenceSatisfied: ["DEP-13"] });
  assert.equal(ok.eligible, true);
});

test("RESOLVES_AUDIT / PRODUCES_EVIDENCE propios abiertos NO bloquean al productor (§20.2.3)", () => {
  const result = evaluateEligibility({ graph: graph(), impId: "IMP-03", projectOn: true });
  assert.equal(result.eligible, true, JSON.stringify(result.blockers));
  assert.deepEqual(result.blockers, []);
});

test("la misma instancia ya accepted no se reinicia; una instancia nueva sí es elegible (§20.2.4.3/§25.2.1)", () => {
  const acceptedInstances = [{ imp: "IMP-03", scope: "P5-gas-quarterly", version: "v1", objectProtocolVersion: "proto-1" }];
  const same = evaluateEligibility({ graph: graph(), impId: "IMP-03", projectOn: true, acceptedInstances, instance: { scope: "P5-gas-quarterly", version: "v1", objectProtocolVersion: "proto-1" } });
  assert.equal(same.eligible, false);
  assert.deepEqual(codes(same), ["IMP_ALREADY_ACCEPTED"]);

  const fresh = evaluateEligibility({ graph: graph(), impId: "IMP-03", projectOn: true, acceptedInstances, instance: { scope: "Q07-intraday", version: "v1", objectProtocolVersion: "proto-1" } });
  assert.equal(fresh.eligible, true, JSON.stringify(fresh.blockers));
});

test("sameInstance exige la tupla completa (scope+versión+protocolo)", () => {
  assert.equal(sameInstance({ scope: "s", version: "v1", objectProtocolVersion: "p" }, { scope: "s", version: "v1", objectProtocolVersion: "p" }), true);
  assert.equal(sameInstance({ scope: "s", version: "v1", objectProtocolVersion: "p" }, { scope: "s", version: "v2", objectProtocolVersion: "p" }), false);
  assert.equal(isNewInstance({ scope: "s", version: "v1" }, [{ scope: "s", version: "v1" }]), false);
  assert.equal(isNewInstance({ scope: "s" }, [{ scope: "s", version: "v1" }]), false);
});

test("HT-IMP-26-001: redeclaración que omite el protocolo ante instancia accepted de igual scope/versión es fail-closed (IMP_ALREADY_ACCEPTED)", () => {
  const acceptedInstances = [{ imp: "IMP-03", scope: "P5-gas-quarterly", version: "v1", objectProtocolVersion: "proto-1" }];

  assert.equal(isNewInstance({ scope: "P5-gas-quarterly", version: "v1" }, acceptedInstances.filter((entry) => entry.imp === "IMP-03")), false);

  const result = evaluateEligibility({ graph: graph(), impId: "IMP-03", projectOn: true, acceptedInstances, instance: { scope: "P5-gas-quarterly", version: "v1" } });
  assert.equal(result.eligible, false);
  assert.deepEqual(codes(result), ["IMP_ALREADY_ACCEPTED"]);
});

test("HT-IMP-26-001: protocolo distinto declarado ante igual scope/versión sí es instancia nueva", () => {
  const acceptedInstances = [{ imp: "IMP-03", scope: "P5-gas-quarterly", version: "v1", objectProtocolVersion: "proto-1" }];
  const result = evaluateEligibility({ graph: graph(), impId: "IMP-03", projectOn: true, acceptedInstances, instance: { scope: "P5-gas-quarterly", version: "v1", objectProtocolVersion: "proto-2" } });
  assert.equal(result.eligible, true, JSON.stringify(result.blockers));
});

test("un SPEC_CHANGE_REQUEST abierto bloquea sólo su rama (SPEC_CONTRADICTION)", () => {
  const options = { graph: graph(), projectOn: true, acceptedInstances: [{ imp: "IMP-01" }, { imp: "IMP-25" }], auditSatisfied: ["DEP-27"] };
  const blocked = evaluateEligibility({ ...options, impId: "IMP-26", openSpecChangeRequests: [{ id: "SCR-1", branch: "IMP-26", resolved: false }] });
  assert.equal(blocked.eligible, false);
  assert.equal(blocked.blockers[0].kind, BLOCKER_KINDS.SPEC_CONTRADICTION);

  const other = evaluateEligibility({ ...options, impId: "IMP-26", openSpecChangeRequests: [{ id: "SCR-2", branch: "IMP-27", resolved: false }] });
  assert.equal(other.eligible, true, JSON.stringify(other.blockers));
});

test("un human gate aplicable bloquea la rama (HUMAN_DECISION)", () => {
  const options = { graph: graph(), projectOn: true, acceptedInstances: [{ imp: "IMP-01" }, { imp: "IMP-25" }], auditSatisfied: ["DEP-27"] };
  const blocked = evaluateEligibility({ ...options, impId: "IMP-26", humanGates: [{ ref: "P-001", branch: "IMP-26" }] });
  assert.equal(blocked.eligible, false);
  assert.equal(blocked.blockers[0].kind, BLOCKER_KINDS.HUMAN_DECISION);
});

test("eligibleImps excluye accepted y ordena canónicamente, sin inventar scope", () => {
  const graphReal = realGraph();
  const eligible = eligibleImps({ graph: graphReal, projectOn: true, acceptedInstances: [{ imp: "IMP-01" }] });
  const ids = eligible.map((entry) => entry.id);
  assert.ok(!ids.includes("IMP-01"), "un IMP accepted no vuelve a ser elegible");
  assert.ok(ids.includes("IMP-02"), "IMP-02 sólo requiere IMP-01");
  assert.ok(ids.every((id) => getImpExists(graphReal, id)));
  assert.deepEqual(ids, [...ids].sort());
});

function getImpExists(graph, id) {
  return Object.prototype.hasOwnProperty.call(graph.imps, id);
}
