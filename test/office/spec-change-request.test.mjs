import { test } from "node:test";
import assert from "node:assert/strict";

import {
  SPEC_CHANGE_REQUEST_FIELDS,
  branchFromImpSubtask,
  buildSpecChangeRequest,
  stopsBranch,
  stopsWork,
} from "../../src/office/spec-change-request.mjs";

function validInput(overrides = {}) {
  return {
    specVersion: "1.1.1",
    impSubtask: "IMP-26 / ST-26.1",
    sourceSections: "§§20.2,25.2",
    exactContradiction: "El contrato frozen exige X y la implementación sólo puede Y.",
    observedEvidence: "operations/audit/IMP-25/capability-mapping.md#G5",
    whyNotImplementable: "No existe representación canónica de la elegibilidad en el runtime.",
    minimumChange: "Añadir la regla de elegibilidad §20.2.4 al contrato de handoff.",
    downstreamImpact: "Selección de IMPs elegibles y continuation.",
    workSafelyCompleted: ["auditoría de brechas", "tests deterministas"],
    workBlocked: ["dispatch automático de IMP-26"],
    requestedAuthority: "architecture/research authority",
    requestedBy: "astra",
    ...overrides,
  };
}

test("el SPEC_CHANGE_REQUEST captura los 11 campos de §20.2.12", () => {
  assert.equal(SPEC_CHANGE_REQUEST_FIELDS.length, 11);
  const outcome = buildSpecChangeRequest(validInput());
  assert.equal(outcome.ok, true, JSON.stringify(outcome.errors));
  for (const field of SPEC_CHANGE_REQUEST_FIELDS) {
    assert.ok(outcome.request[field] !== undefined, field);
  }
  assert.equal(outcome.request.branch, "IMP-26");
  assert.equal(outcome.request.resolved, false);
});

test("un campo faltante no produce solicitud (fail-closed)", () => {
  const input = validInput();
  delete input.exactContradiction;
  const outcome = buildSpecChangeRequest(input);
  assert.equal(outcome.ok, false);
  assert.ok(outcome.errors.some((error) => error.field === "exactContradiction"));
});

test("la autoridad solicitada no puede ser el propio solicitante (§20.2.12)", () => {
  const outcome = buildSpecChangeRequest(validInput({ requestedBy: "astra", requestedAuthority: "astra" }));
  assert.equal(outcome.ok, false);
  assert.ok(outcome.errors.some((error) => error.code === "SELF_APPROVAL"));
});

test("la rama afectada se detiene; el resto del trabajo continúa (§20.2.12/§20.2.11)", () => {
  const { request } = buildSpecChangeRequest(validInput());
  assert.equal(stopsBranch(request, "IMP-26"), true);
  assert.equal(stopsBranch(request, "IMP-27"), false);
  assert.equal(stopsWork(request, "dispatch automático de IMP-26"), true);
  assert.equal(stopsWork(request, "otro trabajo"), false);
  assert.equal(branchFromImpSubtask("IMP-26 / ST-26.1"), "IMP-26");
  assert.equal(branchFromImpSubtask("sin id"), null);
});
