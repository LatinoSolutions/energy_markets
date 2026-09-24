// Tests IMP-24: materialización del governor de Production Governance.
// Criterio de aceptación §25.1 IMP-24: "Governance receipts; primera
// activación A1 si se autoriza; posteriores promociones/demotions con
// autoridad previa. En A1 un humano valida cada acción real."
// Garantías anti (MUST NOT): "Nunca auto-modificar reward/gates/envelope/
// scope/action/benchmark/comparabilidad; A4 no autoamplía autoridad."
// Regla del alcance (§25.2.3): los tres hitos son materialización; todos los
// fixtures son sintéticos y marcados — no acreditan primera compra, niveles
// reales ni evidencia futura DEP-22/24. La primera activación REAL es
// DEP-25-DEPENDENT y queda fail-closed sin ella.

import test from "node:test";
import assert from "node:assert/strict";

import {
  buildEnvelope,
  createProductionGovernor,
  receiveGovernanceEvidence,
  evaluateAutonomyPromotionGate,
  FIRST_ACTIVATION_REFUSAL_CODE,
  FIRST_ACTIVATION_SCOPE,
  PROMOTION_GATES,
} from "../../src/governance/index.mjs";
import { contentHashOf } from "../../src/execution-contract/execution-contract.mjs";

const FIXTURE_PROVENANCE = {
  authority: "fixture sintético de test (no es límite real ni aprobación real)",
  locator: "test/governance/imp24.test.mjs",
};

const T0 = "2026-09-24T10:00:00Z";

function oosReceipt({ verdict = "PASS", synthetic = true } = {}) {
  const core = {
    receiptKind: "IMP-16_P5_EXPERIMENT_RECEIPT",
    schemaVersion: "1.0",
    experiment: { experimentId: "EXP-FIXTURE", experimentVersion: "1.0" },
    scope: { products: ["FIXTURE"], synthetic },
    exAnteManifest: {
      manifestContentHash: "FIXTURE-MANIFEST-HASH",
      frozenAtUtc: "2026-09-01T00:00:00Z",
    },
    p3ResearchEvaluation: verdict === null
      ? { evaluated: true, verdict: null }
      : { evaluated: true, verdict },
    runTimestampUtc: "2026-09-02T00:00:00Z",
    invalidRuns: [],
  };
  return { ...core, synthetic, receiptId: contentHashOf({ ...core, synthetic }) };
}

function shadowReceipt({ policyVersion = "v1.0", synthetic = true } = {}) {
  const core = {
    artifactKind: "IMP-18_SHADOW_EVIDENCE_RECEIPT",
    receiptKind: "IMP-18_SHADOW_EVIDENCE_RECEIPT",
    schemaVersion: "1.0",
    sessionId: "SHADOW-FIXTURE-1",
    experiment: { experimentId: "EXP-FIXTURE", experimentVersion: "1.0" },
    policyVersion,
    synthetic,
    stepCount: 3,
    nonInterference: { verdict: "INTACTA", checks: [] },
    terminalCoverage: { status: "COVERED" },
  };
  return { ...core, contentHash: contentHashOf(core) };
}

function approvalFixture(scope, { role = "OPERATIONS_HUMAN", decision = "APPROVED", modifiesProtectedDomains = undefined } = {}) {
  const approval = {
    approvalRef: "FIXTURE-DEP25-1",
    approvedBy: { authority: "fixture: autoridad humana de governance de test (no es una aprobación real)", role },
    decision,
    scope,
    approvedAtUtc: T0,
  };
  if (modifiesProtectedDomains !== undefined) {
    approval.modifiesProtectedDomains = modifiesProtectedDomains;
  }
  return approval;
}

function apgFixture({ frozenCriteriaRef = "FIXTURE-CRITERIA-CONGELADOS" } = {}) {
  return {
    frozenCriteriaRef,
    gates: PROMOTION_GATES.map((gate) => ({
      gate,
      satisfied: true,
      evidenceRef: `FIXTURE-EVIDENCIA:${gate}`,
      evaluatedBy: { authority: "fixture: evaluador externo sintético de test", locator: "test/governance/imp24.test.mjs", role: "EVALUATOR" },
    })),
  };
}

function dataStateFixture() {
  return {
    gateResults: [
      { gateId: "G-DATA-VALIDITY", result: "PASSED", evaluatedBy: { authority: "fixture: capa de datos externa sintética", locator: "test/governance/imp24.test.mjs", role: "DATA_LAYER" } },
      { gateId: "G-OOD", result: "PASSED", evaluatedBy: { authority: "fixture: capa de datos externa sintética", locator: "test/governance/imp24.test.mjs", role: "DATA_LAYER" } },
    ],
  };
}

function actionApprovalFixture({ validatedAction = "BUY", decision = "APPROVED", modifiedQuantityMw = undefined, reason = undefined } = {}) {
  const approval = {
    validatedAction,
    decision,
    decidedAtUtc: T0,
    decidedBy: { authority: "fixture: operador humano de test", role: "OPERATIONS_HUMAN" },
  };
  if (reason !== undefined) approval.reason = reason;
  if (modifiedQuantityMw !== undefined) approval.modifiedQuantityMw = modifiedQuantityMw;
  return approval;
}

function firstActivationInput(overrides = {}) {
  return {
    policyVersion: "v1.0",
    oosPolicyVersion: "v1.0",
    oosEvidence: oosReceipt(),
    shadowEvidence: shadowReceipt({ policyVersion: "v1.0" }),
    apg: apgFixture(),
    humanApproval: approvalFixture(FIRST_ACTIVATION_SCOPE),
    atUtc: T0,
    ...overrides,
  };
}

function buildGovernor(options = {}) {
  const built = buildEnvelope({
    envelopeVersion: options.envelopeVersion ?? "v1.0",
    autonomyLevel: options.autonomyLevel ?? "A1",
    scope: { product: "Gas", campaign: "FIXTURE-SINTETICO-NO-REAL", mission: "Quarterly" },
    allowedActions: ["BUY", "WAIT"],
    deadlineConstraints: "11:00 Europe/Berlin (fixture de diseño, no es mandato real)",
    gates: [
      { gateId: "G-DATA-VALIDITY", kind: "DATA_VALIDITY", hardGate: true, provenance: FIXTURE_PROVENANCE },
      { gateId: "G-OOD", kind: "OOD", hardGate: true, threshold: { value: null, status: "EVIDENCE_PENDING", reason: "fixture: umbral OOD empírico no producido (§17)" }, provenance: FIXTURE_PROVENANCE },
    ],
    authorizedPolicyVersions: options.authorizedPolicyVersions ?? [
      { policyVersion: "v1.0", underEnvelopeVersion: options.envelopeVersion ?? "v1.0", status: "VALID" },
    ],
    rollbackBaselinePendingReason: "fixture: sin baseline declarado; el fallback de rollback es dependencia operativa explícita (§18.3)",
    quantityLimits: options.quantityLimits === "NONE" ? [] : [
      { limitId: "L-DAILY", limitKind: "DAILY_CAP", maxValueMw: 12, status: "APPROVED", approvalRef: "FIXTURE-APPROVAL-1", provenance: FIXTURE_PROVENANCE },
      { limitId: "L-POSITION", limitKind: "MAX_POSITION", maxValueMw: 60, status: "APPROVED", approvalRef: "FIXTURE-APPROVAL-1", provenance: FIXTURE_PROVENANCE },
    ],
  });
  assert.equal(built.ok, true, "INSPECCIÓN: el fixture del envelope debe construirse válido: " + JSON.stringify(built.errors ?? null));
  const governorResult = createProductionGovernor({ envelope: built.envelope, atUtc: T0 });
  assert.equal(governorResult.ok, true, "INSPECCIÓN: el governor debe construirse válido: " + JSON.stringify(governorResult.errors ?? null));
  return governorResult;
}

const TRANSITION_FIELDS = ["transitionType", "previousState", "newState", "autonomyLevel", "envelopeVersionKey"];

// --- 1) Recepción de evidencia ---

test("IMP-24: receiveGovernanceEvidence acepta un receipt OOS intacto, conservando etapa, identidad y sello sintético", () => {
  const receipt = oosReceipt();
  const received = receiveGovernanceEvidence({ evidence: receipt });
  assert.equal(received.ok, true);
  assert.equal(received.evidence.stage, "OOS");
  assert.equal(received.evidence.receiptId, receipt.receiptId);
  assert.equal(received.evidence.synthetic, true);
  assert.deepEqual(received.evidence.researchVerdict, { evaluated: true, verdict: "PASS" });
});

test("IMP-24: un receipt OOS mutado no es evidencia", () => {
  const mutated = { ...oosReceipt(), p3ResearchEvaluation: { evaluated: true, verdict: "FAIL" } };
  const received = receiveGovernanceEvidence({ evidence: mutated });
  assert.equal(received.ok, false);
  assert.equal(received.code, "RECEIPT_CONTENT_HASH_MISMATCH");
});

test("IMP-24: un receipt de otra clase no es evidencia de governance", () => {
  const received = receiveGovernanceEvidence({ evidence: { receiptKind: "RUN_RECEIPT", contentHash: contentHashOf({}) } });
  assert.equal(received.ok, false);
  assert.equal(received.code, "UNKNOWN_EVIDENCE_KIND");
});

test("IMP-24: sin artifact no hay evidencia", () => {
  const received = receiveGovernanceEvidence({});
  assert.equal(received.ok, false);
  assert.equal(received.code, "MISSING_EVIDENCE");
});

test("IMP-24: un receipt Shadow intacto lleva la identidad de versión", () => {
  const received = receiveGovernanceEvidence({ evidence: shadowReceipt({ policyVersion: "v1.0" }) });
  assert.equal(received.ok, true);
  assert.equal(received.evidence.stage, "SHADOW");
  assert.equal(received.evidence.identity.policyVersion, "v1.0");
});

test("IMP-24: un receipt Shadow mutado no es evidencia", () => {
  const mutated = { ...shadowReceipt(), policyVersion: "otra-version" };
  const received = receiveGovernanceEvidence({ evidence: mutated });
  assert.equal(received.ok, false);
  assert.equal(received.code, "RECEIPT_CONTENT_HASH_MISMATCH");
});

// --- 2) APG conjuntivo ---

test("IMP-24: el APG satisfecho con evaluación externa atribuida no añade razones", () => {
  assert.deepEqual(evaluateAutonomyPromotionGate({ apg: apgFixture() }).reasons, []);
});

test("IMP-24: la ausencia de un gate rompe la conjunción de seis gates", () => {
  const apg = apgFixture();
  apg.gates = apg.gates.filter((gate) => gate.gate !== "G_downside");
  const reasons = evaluateAutonomyPromotionGate({ apg }).reasons;
  assert.equal(reasons.length, 1);
  assert.equal(reasons[0].code, "APG_GATE_MISSING");
  assert.equal(reasons[0].field, "apg.gates.G_downside");
});

test("IMP-24: un gate no satisfecho no lo compensan dimensiones fuertes", () => {
  const apg = apgFixture();
  apg.gates.find((gate) => gate.gate === "G_economic").satisfied = false;
  const reasons = evaluateAutonomyPromotionGate({ apg }).reasons;
  assert.equal(reasons.length, 1);
  assert.equal(reasons[0].code, "APG_GATE_NOT_SATISFIED");
});

test("IMP-24: la policy no atestúa su propia promoción", () => {
  const apg = apgFixture();
  apg.gates.find((gate) => gate.gate === "G_validity").evaluatedBy = { authority: "policy candidata", locator: "test", role: "POLICY" };
  const reasons = evaluateAutonomyPromotionGate({ apg }).reasons;
  assert.equal(reasons.length, 1);
  assert.equal(reasons[0].code, "APG_EVALUATION_NOT_ATTRIBUTED");
});

test("IMP-24: sin evaluación atribuida el gate del APG quedó sin pronunciar", () => {
  const apg = apgFixture();
  delete apg.gates.find((gate) => gate.gate === "G_forward").evaluatedBy;
  const reasons = evaluateAutonomyPromotionGate({ apg }).reasons;
  assert.equal(reasons.length, 1);
  assert.equal(reasons[0].code, "APG_EVALUATION_NOT_ATTRIBUTED");
});

test("IMP-24: el ascenso exige criterios propios congelados con referencia", () => {
  const apg = apgFixture();
  apg.frozenCriteriaRef = "";
  const reasons = evaluateAutonomyPromotionGate({ apg }).reasons;
  assert.equal(reasons.length, 1);
  assert.equal(reasons[0].code, "MISSING_FROZEN_CRITERIA");
});

// --- 3) Primera activación A1 si se autoriza ---

test("IMP-24: sin aprobación humana explícita de DEP-25 no hay primera activación: HOLD registrado", () => {
  const judge = buildGovernor({ autonomyLevel: "A0" });
  const result = judge.considerFirstActivation(firstActivationInput({ humanApproval: null }));
  assert.equal(result.ok, false);
  assert.equal(result.code, FIRST_ACTIVATION_REFUSAL_CODE);
  const holds = judge.receiptRegistry.transitionsOfType("HOLD");
  assert.equal(holds.length, 1);
  for (const field of TRANSITION_FIELDS) {
    assert.ok(holds[0][field] !== null && holds[0][field] !== undefined, `receipt HOLD declara ${field}`);
  }
});

test("IMP-24: con evidencia y APG del fixture válidos y aprobación explícita: PROMOTE a A1", () => {
  const judge = buildGovernor({ autonomyLevel: "A0" });
  const result = judge.considerFirstActivation(firstActivationInput());
  assert.equal(result.ok, true, "INSPECCIÓN: " + JSON.stringify(result));
  assert.equal(result.activation.toLevel, "A1");
  assert.equal(result.activation.approvedBy.role, "OPERATIONS_HUMAN");
  const receipt = judge.receiptRegistry.receiptOf(result.transitionReceiptId);
  assert.equal(receipt.transitionType, "PROMOTE");
  assert.equal(receipt.autonomyLevel, "A1");
  for (const field of TRANSITION_FIELDS) {
    assert.ok(receipt[field] !== undefined && receipt[field] !== null, `receipt PROMOTE declara ${field}`);
  }
});

test("IMP-24: evidencias de versiones distintas no activan: una sola identidad de versión", () => {
  const judge = buildGovernor({ autonomyLevel: "A0" });
  const result = judge.considerFirstActivation(firstActivationInput({ oosPolicyVersion: "otra-version" }));
  assert.equal(result.ok, false);
  assert.equal(result.code, "EVIDENCE_VERSION_MISMATCH");
});

test("IMP-24: evidencia OOS con veredicto FAIL no soporta activación", () => {
  const judge = buildGovernor({ autonomyLevel: "A0" });
  const result = judge.considerFirstActivation(firstActivationInput({ oosEvidence: oosReceipt({ verdict: "FAIL" }) }));
  assert.equal(result.ok, false);
  assert.equal(result.code, "OOS_EVIDENCE_NOT_ELIGIBLE");
});

test("IMP-24: evidencia OOS sin veredicto evaluado es evidencia insuficiente", () => {
  const judge = buildGovernor({ autonomyLevel: "A0" });
  const base = oosReceipt();
  const { p3ResearchEvaluation, ...withoutEvaluation } = base;
  const repaired = { ...withoutEvaluation };
  delete repaired.receiptId;
  repaired.receiptId = contentHashOf(repaired);
  const result = judge.considerFirstActivation(firstActivationInput({ oosEvidence: repaired }));
  assert.equal(result.ok, false);
  assert.equal(result.code, "OOS_EVIDENCE_NOT_ELIGIBLE");
});

test("IMP-24: evidencia Shadow de otra versión no activa", () => {
  const judge = buildGovernor({ autonomyLevel: "A0" });
  const result = judge.considerFirstActivation(firstActivationInput({ shadowEvidence: shadowReceipt({ policyVersion: "otra-version" }) }));
  assert.equal(result.ok, false);
  assert.equal(result.code, "EVIDENCE_VERSION_MISMATCH");
});

test("IMP-24: sin APG satisfecho la activación no procede aunque exista aprobación", () => {
  const judge = buildGovernor({ autonomyLevel: "A0" });
  const result = judge.considerFirstActivation(firstActivationInput({ apg: null }));
  assert.equal(result.ok, false);
  assert.equal(result.code, "APG_NOT_SATISFIED");
});

test("IMP-24: evidencia sintética produce un record marcado como demostración de mecanismo", () => {
  const judge = buildGovernor({ autonomyLevel: "A0" });
  const result = judge.considerFirstActivation(firstActivationInput());
  assert.equal(result.ok, true);
  assert.equal(result.activation.synthetic, true);
});

// --- 4) Approval enforcement A1 ---

test("IMP-24: en A1 sin validación humana por acción la recomendación no ejecuta", () => {
  const judge = buildGovernor({ autonomyLevel: "A1" });
  const result = judge.authorizeRealAction({ action: "BUY", policyVersion: "v1.0", quantityMw: 3, dataState: dataStateFixture(), atUtc: T0 });
  assert.equal(result.ok, true);
  assert.equal(result.authorized, false);
  assert.equal(result.code, "MISSING_ACTION_APPROVAL");
});

test("IMP-24: la validación humana por acción no puede venir de la policy", () => {
  const judge = buildGovernor({ autonomyLevel: "A1" });
  const result = judge.authorizeRealAction({
    action: "BUY",
    policyVersion: "v1.0",
    quantityMw: 3,
    dataState: dataStateFixture(),
    humanApproval: { validatedAction: "BUY", decision: "APPROVED", decidedAtUtc: T0, decidedBy: { authority: "policy candidata", role: "POLICY" } },
    atUtc: T0,
  });
  assert.equal(result.authorized, false);
  assert.equal(result.code, "APPROVAL_BY_POLICY_FORBIDDEN");
});

test("IMP-24: en A1 la validación humana autoriza; recomendación y decisión quedan separadas", () => {
  const judge = buildGovernor({ autonomyLevel: "A1" });
  const result = judge.authorizeRealAction({
    action: "BUY",
    policyVersion: "v1.0",
    quantityMw: 3,
    dataState: dataStateFixture(),
    humanApproval: actionApprovalFixture({ reason: "fixture: validación por acción" }),
    atUtc: T0,
  });
  assert.equal(result.authorized, true, "INSPECCIÓN: " + JSON.stringify(result));
  assert.equal(result.action.recommendation.action, "BUY");
  assert.equal(result.action.recommendation.quantityMw, 3);
  assert.equal(result.action.humanApprovalAction.decision, "APPROVED");
  assert.equal(result.action.modifiedOutcomeAttributableToRecommendation, true);
});

test("IMP-24: la validación adherida a otra acción no autoriza esta recomendación", () => {
  const judge = buildGovernor({ autonomyLevel: "A1" });
  const result = judge.authorizeRealAction({
    action: "BUY",
    policyVersion: "v1.0",
    quantityMw: 3,
    dataState: dataStateFixture(),
    humanApproval: actionApprovalFixture({ validatedAction: "WAIT" }),
    atUtc: T0,
  });
  assert.equal(result.authorized, false);
  assert.equal(result.code, "APPROVAL_ACTION_MISMATCH");
});

test("IMP-24: el veto humano se registra con timestamp y razón, y no ejecuta", () => {
  const judge = buildGovernor({ autonomyLevel: "A1" });
  const result = judge.authorizeRealAction({
    action: "BUY",
    policyVersion: "v1.0",
    quantityMw: 3,
    dataState: dataStateFixture(),
    humanApproval: actionApprovalFixture({ decision: "VETOED", reason: "fixture: razón declarada del veto" }),
    atUtc: T0,
  });
  assert.equal(result.authorized, false);
  assert.equal(result.code, "ACTION_VETOED");
  assert.equal(result.intervention.decision, "VETOED");
  assert.equal(typeof result.intervention.decidedAtUtc, "string");
});

test("IMP-24: la modificación humana de la cantidad se registra y no se atribuye a la recomendación", () => {
  const judge = buildGovernor({ autonomyLevel: "A1" });
  const result = judge.authorizeRealAction({
    action: "BUY",
    policyVersion: "v1.0",
    quantityMw: 3,
    dataState: dataStateFixture(),
    humanApproval: actionApprovalFixture({ modifiedQuantityMw: 2 }),
    atUtc: T0,
  });
  assert.equal(result.authorized, true);
  assert.equal(result.action.authorizedQuantityMw, 2);
  assert.deepEqual(result.action.modification, { kind: "QUANTITY_MODIFIED", from: 3, to: 2 });
  assert.equal(result.action.modifiedOutcomeAttributableToRecommendation, false);
});

test("IMP-24: la validación humana no sustituye al envelope: exceso sobre el límite se rechaza", () => {
  const judge = buildGovernor({ autonomyLevel: "A1" });
  const approved = judge.authorizeRealAction({
    action: "BUY",
    policyVersion: "v1.0",
    quantityMw: 3,
    dataState: dataStateFixture(),
    humanApproval: actionApprovalFixture(),
    atUtc: T0,
  });
  const rejected = judge.authorizeRealAction({
    action: "BUY",
    policyVersion: "v1.0",
    quantityMw: 40,
    dataState: dataStateFixture(),
    humanApproval: actionApprovalFixture(),
    atUtc: T0,
  });
  assert.equal(judge.currentState().status, "ACTIVE");
  assert.equal(approved.authorized, true);
  assert.equal(rejected.ok, false);
  assert.equal(rejected.code, "ENVELOPE_REJECTION");
});

test("IMP-24: sin gates de admisión evaluados en dataState el acto falla dentro del envelope", () => {
  const judge = buildGovernor({ autonomyLevel: "A1" });
  const result = judge.authorizeRealAction({
    action: "BUY",
    policyVersion: "v1.0",
    quantityMw: 3,
    dataState: { gateResults: [] },
    humanApproval: actionApprovalFixture(),
    atUtc: T0,
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, "ENVELOPE_REJECTION");
});

// --- 5) Promociones posteriores, DEMOTE/HALT/ROLLBACK ---

test("IMP-24: la promoción posterior sin aprobación explícita queda HOLD registrado", () => {
  const judge = buildGovernor({ autonomyLevel: "A1" });
  const result = judge.considerSubsequentPromotion({ targetLevel: "A2", apg: apgFixture(), atUtc: T0 });
  assert.equal(result.ok, false);
  assert.equal(result.code, "MISSING_APPROVAL");
  assert.equal(judge.receiptRegistry.transitionsOfType("HOLD").length, 1);
});

test("IMP-24: la promoción aprobada produce PROMOTE con autoridad previa", () => {
  const judge = buildGovernor({ autonomyLevel: "A1" });
  const result = judge.considerSubsequentPromotion({
    targetLevel: "A2",
    apg: apgFixture(),
    governanceChangeApproval: approvalFixture("GOVERNANCE_PROMOTION:A2"),
    atUtc: T0,
  });
  assert.equal(result.ok, true, "INSPECCIÓN: " + JSON.stringify(result));
  assert.equal(result.fromLevel, "A1");
  assert.equal(result.toLevel, "A2");
  const receipt = judge.receiptRegistry.receiptOf(result.transitionReceiptId);
  assert.equal(receipt.transitionType, "PROMOTE");
  assert.equal(receipt.autonomyLevel, "A2");
});

test("IMP-24: ascenso de dos niveles no procede: progresión por fases", () => {
  const judge = buildGovernor({ autonomyLevel: "A1" });
  const result = judge.considerSubsequentPromotion({
    targetLevel: "A3",
    apg: apgFixture(),
    governanceChangeApproval: approvalFixture("GOVERNANCE_PROMOTION:A3"),
    atUtc: T0,
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, "LEVEL_STEP_TOO_LARGE");
});

test("IMP-24: lo que no sube de nivel no es PROMOTE", () => {
  const judge = buildGovernor({ autonomyLevel: "A2" });
  const result = judge.considerSubsequentPromotion({
    targetLevel: "A1",
    apg: apgFixture(),
    governanceChangeApproval: approvalFixture("GOVERNANCE_PROMOTION:A1"),
    atUtc: T0,
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, "TARGET_LEVEL_NOT_ASCENT");
});

test("IMP-24: la aprobación de la propia policy no puede promover", () => {
  const judge = buildGovernor({ autonomyLevel: "A1" });
  const result = judge.considerSubsequentPromotion({
    targetLevel: "A2",
    apg: apgFixture(),
    governanceChangeApproval: approvalFixture("GOVERNANCE_PROMOTION:A2", { role: "CANDIDATE_POLICY" }),
    atUtc: T0,
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, "APPROVAL_BY_POLICY_FORBIDDEN");
});

test("IMP-24: la promoción no puede llevar dominios protegidos", () => {
  const judge = buildGovernor({ autonomyLevel: "A1" });
  const result = judge.considerSubsequentPromotion({
    targetLevel: "A2",
    apg: apgFixture(),
    governanceChangeApproval: approvalFixture("GOVERNANCE_PROMOTION:A2", { modifiesProtectedDomains: ["SAFETY_AUTONOMY_ENVELOPE"] }),
    atUtc: T0,
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, "PROTECTED_DOMAIN_CHANGE");
  assert.equal(judge.currentState().level, "A1");
});

test("IMP-24: el hard-gate fallado demueve un nivel inmediatamente, sin consentimiento de policy", () => {
  const judge = buildGovernor({ autonomyLevel: "A2" });
  const result = judge.applyHardGateMandate({ gateId: "G-OOD", evidenceRef: "FIXTURE-BREACH-1", requestedTransition: "DEMOTE", atUtc: T0 });
  assert.equal(result.ok, true, "INSPECCIÓN: " + JSON.stringify(result));
  assert.equal(result.fromLevel, "A2");
  assert.equal(result.toLevel, "A1");
  assert.equal(judge.currentState().level, "A1");
  assert.equal(result.mandate.policyVetoPossible, false);
  const receipt = judge.receiptRegistry.receiptOf(result.transitionReceiptId);
  assert.equal(receipt.transitionType, "DEMOTE");
});

test("IMP-24: el hard-gate puede HALT inmediatamente y ningún acto se autoriza en HALT", () => {
  const judge = buildGovernor({ autonomyLevel: "A3" });
  const result = judge.applyHardGateMandate({ gateId: "G-OOD", evidenceRef: "FIXTURE-BREACH-2", atUtc: T0 });
  assert.equal(result.ok, true);
  assert.equal(result.transition, "HALT");
  assert.equal(judge.currentState().status, "HALTED");
  const refused = judge.authorizeRealAction({ action: "BUY", policyVersion: "v1.0", quantityMw: 1, atUtc: T0 });
  assert.equal(refused.ok, false);
  assert.equal(refused.code, "GOVERNOR_STATE_HALTED");
});

test("IMP-24: el rollback del HALT restaura la última versión válida y no auto-amplía el nivel", () => {
  const judge = buildGovernor({ autonomyLevel: "A2" });
  judge.applyHardGateMandate({ gateId: "G-OOD", evidenceRef: "FIXTURE-BREACH-3", atUtc: T0 });
  const history = [
    { policyVersion: "v0.9", validity: [{ underEnvelopeVersion: "version:v1.0", currentValid: true }] },
    { policyVersion: "v1.0", validity: [{ underEnvelopeVersion: "version:v1.0", currentValid: true }] },
  ];
  const result = judge.executeHaltingRollback({ policyVersionHistory: history, atUtc: "2026-09-24T11:00:00Z" });
  assert.equal(result.ok, true, "INSPECCIÓN: " + JSON.stringify(result));
  assert.equal(result.rollback.target.destination, "POLICY_VERSION");
  assert.equal(result.rollback.target.policyVersion, "v1.0"); // IMP-23: última versión válida bajo el envelope actual
  assert.equal(result.restoredLevel, "A2"); // el rollback no auto-amplía: se conserva el nivel vigente del envelope
  assert.equal(judge.currentState().status, "ACTIVE");
  const receipt = judge.receiptRegistry.receiptOf(result.transitionReceiptId);
  assert.equal(receipt.transitionType, "ROLLBACK");
});

test("IMP-24: sin versión válida ni fallback declarado, el rollback queda bloqueado como pendiente operacional", () => {
  const judge = buildGovernor({ autonomyLevel: "A2" });
  judge.applyHardGateMandate({ gateId: "G-OOD", evidenceRef: "FIXTURE-BREACH-4", atUtc: T0 });
  const result = judge.executeHaltingRollback({ policyVersionHistory: [], atUtc: T0 });
  assert.equal(result.ok, false);
  assert.equal(result.code, "NO_ROLLBACK_TARGET");
  assert.equal(result.pendingOperationsFallback, true);
});

test("IMP-24: la cadena de receipts permite reconstruir cómo la versión obtuvo, conservó o perdió autoridad", () => {
  const judge = buildGovernor({ autonomyLevel: "A0" });
  const activated = judge.considerFirstActivation(firstActivationInput());
  assert.equal(activated.ok, true);
  judge.applyHardGateMandate({ gateId: "G-OOD", evidenceRef: "FIXTURE-BREACH-5", atUtc: T0 });
  const entries = judge.receiptRegistry.snapshot();
  assert.equal(entries.length, 2);
  assert.equal(entries[0].receipt.transitionType, "PROMOTE");
  assert.equal(entries[1].receipt.transitionType, "HALT");
  for (const entry of entries) {
    assert.equal(entry.receipt.envelopeVersionKey, "version:v1.0");
    assert.equal(typeof entry.receipt.executedAtUtc, "string");
  }
});
