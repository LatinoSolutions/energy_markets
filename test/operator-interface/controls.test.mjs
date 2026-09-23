import { test } from "node:test";
import assert from "node:assert/strict";

import {
  AUTHORIZED_COMMANDS,
  GOVERNANCE_COMMAND,
  INTERVENTION_COMMAND,
  authorizeOperatorCommand,
  buildHumanIntervention,
  projectGovernanceState,
} from "../../src/operator-interface/index.mjs";

const AUTHORIZATION = {
  authorityRef: "DEP-25/activation-1",
  grantedBy: "operator-bru",
  grantedAtUtc: "2026-04-02T08:00:00Z",
};
const RECEIPT = { receiptRef: "operations/receipts/exec-1.json", receiptSha256: "d".repeat(64) };

test("los comandos autorizados cubren §18.4 y las intervenciones de §26.2", () => {
  for (const command of ["PROMOTE", "HALT", "DEMOTE", "ROLLBACK", "APPROVE", "VETO", "DELAY", "MODIFY"]) {
    assert.ok(AUTHORIZED_COMMANDS.includes(command), command);
  }
  assert.equal(GOVERNANCE_COMMAND.HALT, "HALT");
  assert.equal(INTERVENTION_COMMAND.MODIFY, "MODIFY");
});

test("un comando desconocido no se autoriza", () => {
  const outcome = authorizeOperatorCommand({ command: "SET_THRESHOLD", authorization: AUTHORIZATION });
  assert.equal(outcome.ok, false);
  assert.equal(outcome.errors[0].code, "UNKNOWN_COMMAND");
});

// §26.5: un control visible no sustituye la autorización.
test("un control en pantalla sin autorización explícita se rechaza", () => {
  const outcome = authorizeOperatorCommand({ command: GOVERNANCE_COMMAND.HALT, receipt: RECEIPT });
  assert.equal(outcome.ok, false);
  assert.equal(outcome.errors[0].code, "MISSING_AUTHORIZATION");
});

test("un comando de governance exige su receipt aplicable", () => {
  const noReceipt = authorizeOperatorCommand({ command: GOVERNANCE_COMMAND.DEMOTE, authorization: AUTHORIZATION });
  assert.equal(noReceipt.ok, false);
  assert.equal(noReceipt.errors[0].code, "MISSING_RECEIPT");

  const ok = authorizeOperatorCommand({ command: GOVERNANCE_COMMAND.DEMOTE, authorization: AUTHORIZATION, receipt: RECEIPT });
  assert.equal(ok.ok, true);
  assert.equal(ok.command.receipt.receiptSha256, "d".repeat(64));
});

test("la UI no concede autoridad: procede del backend", () => {
  const outcome = authorizeOperatorCommand({ command: GOVERNANCE_COMMAND.HALT, authorization: AUTHORIZATION, receipt: RECEIPT });
  assert.equal(outcome.command.authorityGranted, false);
  assert.equal(outcome.command.authoritySource, "BACKEND");
});

test("una intervención exige vínculo a la recomendación y acción efectiva", () => {
  const outcome = authorizeOperatorCommand({
    command: INTERVENTION_COMMAND.MODIFY,
    authorization: AUTHORIZATION,
    effectiveAction: "delay one opportunity",
  });
  assert.equal(outcome.ok, false);
  assert.equal(outcome.errors[0].code, "MISSING_INTERVENTION_LINK");

  const ok = authorizeOperatorCommand({
    command: INTERVENTION_COMMAND.MODIFY,
    authorization: AUTHORIZATION,
    recommendationRef: "rec-42",
    effectiveAction: "delay one opportunity",
  });
  assert.equal(ok.ok, true);
  assert.equal(ok.command.recommendationRef, "rec-42");
});

test("la intervención humana conserva distinción de la policy", () => {
  const outcome = buildHumanIntervention({
    recommendationRef: "rec-42",
    command: INTERVENTION_COMMAND.VETO,
    effectiveAction: "veto the recommendation",
    occurredAtUtc: "2026-04-02T09:00:00Z",
    provenance: { recordKey: "rec-42", revisionId: "v1" },
  });
  assert.equal(outcome.ok, true);
  assert.equal(outcome.intervention.attribution, "HUMAN");
  assert.equal(outcome.intervention.policyAttribution, null);
  assert.equal(outcome.intervention.class, "HUMAN_INTERVENTION");
});

test("una intervención mal formada se rechaza", () => {
  const noProvenance = buildHumanIntervention({
    recommendationRef: "rec-42",
    command: INTERVENTION_COMMAND.DELAY,
    effectiveAction: "delay",
    occurredAtUtc: "2026-04-02T09:00:00Z",
  });
  assert.equal(noProvenance.ok, false);
  assert.equal(noProvenance.errors[0].code, "MISSING_PROVENANCE");

  const unknownCommand = buildHumanIntervention({
    recommendationRef: "rec-42",
    command: "IGNORE",
    effectiveAction: "delay",
    occurredAtUtc: "2026-04-02T09:00:00Z",
    provenance: { recordKey: "rec-42", revisionId: "v1" },
  });
  assert.equal(unknownCommand.ok, false);
  assert.equal(unknownCommand.errors[0].code, "UNKNOWN_INTERVENTION_COMMAND");
});

// §26.5: el estado de governance mostrado no es una verdad paralela de la UI.
test("el estado de governance exige procedencia del backend", () => {
  const parallel = projectGovernanceState({ backendState: { level: "HALTED" } });
  assert.equal(parallel.ok, false);
  assert.equal(parallel.errors[0].code, "GOVERNANCE_STATE_FROM_UI");

  const fromBackend = projectGovernanceState({
    backendState: { level: "HALTED" },
    provenance: { recordKey: "governance.state", revisionId: "v3" },
  });
  assert.equal(fromBackend.ok, true);
  assert.equal(fromBackend.governanceState.state.level, "HALTED");
  assert.equal(fromBackend.governanceState.authorityGranted, false);
});
