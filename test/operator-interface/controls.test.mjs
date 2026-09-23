import { test } from "node:test";
import assert from "node:assert/strict";

import { canonicalValueSha256 } from "../../src/pit-views/pit-record.mjs";
import {
  AUTHORIZED_COMMANDS,
  GOVERNANCE_COMMAND,
  INTERVENTION_COMMAND,
  authorizeOperatorCommand,
  buildHumanIntervention,
  projectGovernanceState,
} from "../../src/operator-interface/index.mjs";
import { AUTHORITY_BASE, EVALUATION_BENCHMARK, GOVERNANCE_STATE_BASE, RECEIPT_BASE, RECOMMENDATION_BASE, buildManifest } from "./fixtures.mjs";

// Backend verificado (§26.5; OI29-03 del review 2026-09-23): la autoridad, el
// receipt y la recomendación vinculada son registros del manifest backend.
function backendFor(extraRecords = []) {
  const built = buildManifest({
    records: [RECOMMENDATION_BASE, AUTHORITY_BASE, RECEIPT_BASE, EVALUATION_BENCHMARK, GOVERNANCE_STATE_BASE, ...extraRecords],
  });
  assert.equal(built.ok, true, JSON.stringify(built.errors ?? "manifest no construido"));
  return built.manifest;
}

const AUTHORIZATION = {
  authorityRef: `${AUTHORITY_BASE.key}@${AUTHORITY_BASE.revisionId}`,
  grantedBy: "operator-bru",
  grantedAtUtc: "2026-04-02T08:00:00Z",
};
const RECEIPT = {
  receiptRef: `${RECEIPT_BASE.key}@${RECEIPT_BASE.revisionId}`,
  receiptSha256: canonicalValueSha256(RECEIPT_BASE.value).sha256,
};
const RECOMMENDATION_REF = `${RECOMMENDATION_BASE.key}@${RECOMMENDATION_BASE.revisionId}`;
const BACKEND = { backendManifest: backendFor() };

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
  const noReceipt = authorizeOperatorCommand(
    { command: GOVERNANCE_COMMAND.DEMOTE, authorization: AUTHORIZATION },
    BACKEND,
  );
  assert.equal(noReceipt.ok, false);
  assert.equal(noReceipt.errors[0].code, "MISSING_RECEIPT");

  const ok = authorizeOperatorCommand(
    { command: GOVERNANCE_COMMAND.DEMOTE, authorization: AUTHORIZATION, receipt: RECEIPT },
    BACKEND,
  );
  assert.equal(ok.ok, true);
  assert.equal(ok.command.receipt.receiptSha256, canonicalValueSha256(RECEIPT_BASE.value).sha256);
});

test("la UI no concede autoridad: procede del backend", () => {
  const outcome = authorizeOperatorCommand(
    { command: GOVERNANCE_COMMAND.HALT, authorization: AUTHORIZATION, receipt: RECEIPT },
    BACKEND,
  );
  assert.equal(outcome.command.authorityGranted, false);
  assert.equal(outcome.command.authoritySource, "BACKEND");
  // OI29-03: la autoridad misma quedó registrada en el backend verificado.
  assert.equal(outcome.command.authorization.origin.recordKey, AUTHORITY_BASE.key);
});

// OI29-03: la autoridad y el receipt se contrastan contra el backend
// verificado; una referencia inventada no basta.
test("un comando con autoridad y receipt inexistentes se rechaza", () => {
  const outcome = authorizeOperatorCommand({
    command: GOVERNANCE_COMMAND.PROMOTE,
    authorization: { ...AUTHORIZATION, authorityRef: "GOV.never@v404" },
    receipt: RECEIPT,
  }, BACKEND);
  assert.equal(outcome.ok, false);
  assert.equal(outcome.errors[0].field, "authorization.authorityRef");
  assert.equal(outcome.errors[0].code, "RECORD_NOT_IN_BACKEND");

  const withoutBackend = authorizeOperatorCommand({
    command: GOVERNANCE_COMMAND.HALT,
    authorization: AUTHORIZATION,
    receipt: RECEIPT,
  });
  assert.equal(withoutBackend.ok, false);
  assert.equal(withoutBackend.errors[0].code, "AUTHORIZATION_BACKEND_UNVERIFIED");
});

// OI29-03: el receipt no vale por su forma; su hash debe coincidir con el
// registro verificado del backend.
test("un receipt cuyo hash no coincide con el backend se rechaza", () => {
  const outcome = authorizeOperatorCommand({
    command: GOVERNANCE_COMMAND.DEMOTE,
    authorization: AUTHORIZATION,
    receipt: { ...RECEIPT, receiptSha256: "d".repeat(64) },
  }, BACKEND);
  assert.equal(outcome.ok, false);
  assert.equal(outcome.errors[0].code, "RECEIPT_CONTENT_MISMATCH");
});

test("una intervención exige vínculo a la recomendación y acción efectiva", () => {
  const outcome = authorizeOperatorCommand({
    command: INTERVENTION_COMMAND.MODIFY,
    authorization: AUTHORIZATION,
    effectiveAction: "delay one opportunity",
  }, BACKEND);
  assert.equal(outcome.ok, false);
  assert.equal(outcome.errors[0].code, "MISSING_INTERVENTION_LINK");

  const ok = authorizeOperatorCommand({
    command: INTERVENTION_COMMAND.MODIFY,
    authorization: AUTHORIZATION,
    recommendationRef: RECOMMENDATION_REF,
    effectiveAction: "delay one opportunity",
  }, BACKEND);
  assert.equal(ok.ok, true);
  assert.equal(ok.command.recommendationRef, RECOMMENDATION_REF);
});

// OI29-03: el vínculo de la intervención debe resolver a una recomendación
// canónica del decision view del backend.
test("una intervención vinculada a una recomendación inexistente se rechaza", () => {
  const missing = authorizeOperatorCommand({
    command: INTERVENTION_COMMAND.MODIFY,
    authorization: AUTHORIZATION,
    recommendationRef: "never.exists@v404",
    effectiveAction: "delay one opportunity",
  }, BACKEND);
  assert.equal(missing.ok, false);
  assert.equal(missing.errors[0].field, "recommendationRef");
  assert.equal(missing.errors[0].code, "RECORD_NOT_IN_BACKEND");

  const evaluationScope = authorizeOperatorCommand({
    command: INTERVENTION_COMMAND.MODIFY,
    authorization: AUTHORIZATION,
    recommendationRef: "B.G0BQ.202604.closed@bench-v1",
    effectiveAction: "delay one opportunity",
  }, BACKEND);
  assert.equal(evaluationScope.ok, false);
  assert.equal(evaluationScope.errors[0].code, "RECOMMENDATION_REF_NOT_IN_DECISION_SCOPE");
});

test("la intervención humana conserva distinción de la policy", () => {
  const outcome = buildHumanIntervention({
    recommendationRef: `${RECOMMENDATION_BASE.key}@${RECOMMENDATION_BASE.revisionId}`,
    command: INTERVENTION_COMMAND.VETO,
    effectiveAction: "veto the recommendation",
    occurredAtUtc: "2026-04-02T09:00:00Z",
    provenance: { recordKey: RECOMMENDATION_BASE.key, revisionId: RECOMMENDATION_BASE.revisionId },
  }, BACKEND);
  assert.equal(outcome.ok, true);
  assert.equal(outcome.intervention.attribution, "HUMAN");
  assert.equal(outcome.intervention.policyAttribution, null);
  assert.equal(outcome.intervention.class, "HUMAN_INTERVENTION");
  assert.equal(outcome.intervention.provenance.resolved.recordKey, RECOMMENDATION_BASE.key);
});

test("una intervención mal formada se rechaza", () => {
  const noProvenance = buildHumanIntervention({
    recommendationRef: `${RECOMMENDATION_BASE.key}@${RECOMMENDATION_BASE.revisionId}`,
    command: INTERVENTION_COMMAND.DELAY,
    effectiveAction: "delay",
    occurredAtUtc: "2026-04-02T09:00:00Z",
  }, BACKEND);
  assert.equal(noProvenance.ok, false);
  assert.equal(noProvenance.errors[0].code, "MISSING_PROVENANCE");

  const unknownCommand = buildHumanIntervention({
    recommendationRef: `${RECOMMENDATION_BASE.key}@${RECOMMENDATION_BASE.revisionId}`,
    command: "IGNORE",
    effectiveAction: "delay",
    occurredAtUtc: "2026-04-02T09:00:00Z",
    provenance: { recordKey: RECOMMENDATION_BASE.key, revisionId: RECOMMENDATION_BASE.revisionId },
  }, BACKEND);
  assert.equal(unknownCommand.ok, false);
  assert.equal(unknownCommand.errors[0].code, "UNKNOWN_INTERVENTION_COMMAND");
});

// OI29-07 (§25.1/§26.5): el registro de intervención se contrasta contra el
// backend verificado; un vínculo o una procedencia que no resuelven no pasan.
test("una intervención con vínculo o procedencia ausentes del backend se rechaza", () => {
  const unknownLink = buildHumanIntervention({
    recommendationRef: "never.exists@v404",
    command: INTERVENTION_COMMAND.VETO,
    effectiveAction: "veto",
    occurredAtUtc: "2026-04-02T09:00:00Z",
    provenance: { recordKey: RECOMMENDATION_BASE.key, revisionId: RECOMMENDATION_BASE.revisionId },
  }, BACKEND);
  assert.equal(unknownLink.ok, false);
  assert.equal(unknownLink.errors[0].code, "RECOMMENDATION_REF_NOT_IN_BACKEND");

  const unknownProvenance = buildHumanIntervention({
    recommendationRef: `${RECOMMENDATION_BASE.key}@${RECOMMENDATION_BASE.revisionId}`,
    command: INTERVENTION_COMMAND.VETO,
    effectiveAction: "veto",
    occurredAtUtc: "2026-04-02T09:00:00Z",
    provenance: { recordKey: "no.such.record", revisionId: "v404" },
  }, BACKEND);
  assert.equal(unknownProvenance.ok, false);
  assert.equal(unknownProvenance.errors[0].code, "PROVENANCE_NOT_IN_BACKEND");

  const noBackend = buildHumanIntervention({
    recommendationRef: `${RECOMMENDATION_BASE.key}@${RECOMMENDATION_BASE.revisionId}`,
    command: INTERVENTION_COMMAND.VETO,
    effectiveAction: "veto",
    occurredAtUtc: "2026-04-02T09:00:00Z",
    provenance: { recordKey: RECOMMENDATION_BASE.key, revisionId: RECOMMENDATION_BASE.revisionId },
  });
  assert.equal(noBackend.ok, false);
  assert.equal(noBackend.errors[0].code, "INTERVENTION_BACKEND_UNVERIFIED");

  const unverified = buildHumanIntervention({
    recommendationRef: `${RECOMMENDATION_BASE.key}@${RECOMMENDATION_BASE.revisionId}`,
    command: INTERVENTION_COMMAND.VETO,
    effectiveAction: "veto",
    occurredAtUtc: "2026-04-02T09:00:00Z",
    provenance: { recordKey: RECOMMENDATION_BASE.key, revisionId: RECOMMENDATION_BASE.revisionId },
  }, { backendManifest: { records: [] } });
  assert.equal(unverified.ok, false);
  assert.equal(unverified.errors[0].code, "INTERVENTION_BACKEND_UNVERIFIED");
});

// §26.5 + OI29-06: el estado de governance mostrado no es una verdad paralela
// de la UI; procede del backend verificado y debe ser el valor registrado.
test("el estado de governance exige procedencia del backend", () => {
  const parallel = projectGovernanceState({ backendState: { level: "HALTED" } });
  assert.equal(parallel.ok, false);
  assert.equal(parallel.errors[0].code, "GOVERNANCE_STATE_BACKEND_UNVERIFIED");

  const noProvenance = projectGovernanceState({
    backendState: { level: "HALTED" },
    backendManifest: BACKEND.backendManifest,
  });
  assert.equal(noProvenance.ok, false);
  assert.equal(noProvenance.errors[0].code, "GOVERNANCE_STATE_FROM_UI");

  const unknownRecord = projectGovernanceState({
    backendState: { level: "HALTED" },
    provenance: { recordKey: "governance.never", revisionId: "v404" },
    backendManifest: BACKEND.backendManifest,
  });
  assert.equal(unknownRecord.ok, false);
  assert.equal(unknownRecord.errors[0].code, "GOVERNANCE_RECORD_NOT_IN_BACKEND");

  // OI29-06: un estado distinto del registrado por la versión canonical no es
  // verdad de este backend; el llamador no lo sostiene por su cuenta.
  const forgedState = projectGovernanceState({
    backendState: { level: "PROMOTED", autonomy: "A4" },
    provenance: { recordKey: GOVERNANCE_STATE_BASE.key, revisionId: GOVERNANCE_STATE_BASE.revisionId },
    backendManifest: BACKEND.backendManifest,
  });
  assert.equal(forgedState.ok, false);
  assert.equal(forgedState.errors[0].code, "GOVERNANCE_STATE_VALUE_MISMATCH");

  const fromBackend = projectGovernanceState({
    backendState: { level: "HALTED", receiptRef: "GOV.receipt.exec-1@v1" },
    provenance: { recordKey: GOVERNANCE_STATE_BASE.key, revisionId: GOVERNANCE_STATE_BASE.revisionId },
    backendManifest: BACKEND.backendManifest,
  });
  assert.equal(fromBackend.ok, true);
  assert.equal(fromBackend.governanceState.state.level, "HALTED");
  assert.equal(fromBackend.governanceState.authorityGranted, false);
  assert.equal(fromBackend.governanceState.provenance.resolved.recordKey, GOVERNANCE_STATE_BASE.key);
});
