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
  POLICY_VERSION_PROMOTION_SCOPE_PREFIX,
  PROMOTION_GATES,
  RESEARCH_RECEIPT_KIND,
} from "../../src/governance/index.mjs";
import {
  openShadowSession,
  openShadowProgress,
  captureShadowOpportunity,
  closeShadowSession,
  SHADOW_EVIDENCE_RECEIPT_KIND,
  SHADOW_NON_INTERFERENCE_VERIFIED,
  SHADOW_RECEIPT_KIND,
} from "../../src/shadow/index.mjs";
import {
  frozenShadowFixture,
  posteriorObservationsFor,
  sightableObservationsFor,
  benchmarkDailyClosesFixture,
} from "../shadow/fixtures.mjs";
import { contentHashOf } from "../../src/execution-contract/execution-contract.mjs";

const FIXTURE_PROVENANCE = {
  authority: "fixture sintético de test (no es límite real ni aprobación real)",
  locator: "test/governance/imp24.test.mjs",
};

const T0 = "2026-09-24T10:00:00Z";

function oosReceipt({ verdict = "PASS", synthetic = true } = {}) {
  const core = {
    receiptKind: RESEARCH_RECEIPT_KIND,
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

function shadowReceipt({
  policyVersion = "v1.0",
  synthetic = true,
  experiment = { experimentId: "EXP-FIXTURE", experimentVersion: "1.0" },
  nonInterferenceVerdict = SHADOW_NON_INTERFERENCE_VERIFIED,
  terminalCoverageStatus = "COVERED",
} = {}) {
  const core = {
    artifactKind: SHADOW_EVIDENCE_RECEIPT_KIND,
    receiptKind: SHADOW_RECEIPT_KIND,
    schemaVersion: "1.0",
    sessionId: "SHADOW-FIXTURE-1",
    experiment,
    policyVersion,
    synthetic,
    stepCount: 3,
    nonInterference: { verdict: nonInterferenceVerdict, checks: [] },
    terminalCoverage: { status: terminalCoverageStatus },
  };
  return { ...core, contentHash: contentHashOf(core) };
}

// Receipt Shadow REAL producido por el productor IMP-18 (closeShadowSession).
// No es un fixture con literales inventados: es la prueba de que el governor
// consume la misma identidad que produce el cierre Shadow (IMP24-SHADOW-KIND).
function realShadowReceipt() {
  const { frozen } = frozenShadowFixture();
  const opened = openShadowSession({
    frozen,
    startedAtUtc: "2021-06-21T00:00:00Z",
    prospectivePermissions: {
      permissionRefs: ["fixture://pit-permission/imp24-synthetic"],
      declaredBy: "SYNTHETIC fixture per §25.2 DEP-06/07 declaration",
    },
    synthetic: true,
  });
  assert.equal(opened.ok, true, "INSPECCIÓN: la sesión Shadow fixture debe abrir");
  const session = opened.session;
  let progress = openShadowProgress({ session, frozen }).progress;
  const records = [];
  const steps = [];
  while (progress.terminal !== true) {
    const currentOpportunity = frozen.frozenBundles.a1.decisionCalendar.opportunities[progress.cursor] ?? null;
    const outcome = captureShadowOpportunity({
      session,
      frozen,
      progress,
      sightablePriceObservations: sightableObservationsFor({ frozen, upToUtc: currentOpportunity?.decisionTimeUtc ?? null }),
      posteriorObservations: currentOpportunity ? posteriorObservationsFor(currentOpportunity.date) : [],
    });
    assert.equal(outcome.ok, true, "INSPECCIÓN: la captura Shadow fixture debe avanzar");
    records.push(outcome.record);
    steps.push(outcome.step);
    progress = outcome.nextProgress;
  }
  const closed = closeShadowSession({
    session,
    frozen,
    progress: { sessionId: session.sessionId, sessionContentHash: session.contentHash, executedVolume: 12, remainingVolume: 0 },
    records,
    steps,
    closedAtUtc: "2021-07-01T10:00:00Z",
    benchmarkDailyCloses: benchmarkDailyClosesFixture(),
  });
  assert.equal(closed.ok, true, "INSPECCIÓN: el cierre Shadow fixture debe producir receipt");
  return closed.receipt;
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

function actionApprovalFixture({ validatedAction = "BUY", decision = "APPROVED", modifiedQuantityMw = undefined, reason = undefined, provenance = undefined } = {}) {
  const approval = {
    validatedAction,
    decision,
    decidedAtUtc: T0,
    decidedBy: { authority: "fixture: operador humano de test", role: "OPERATIONS_HUMAN" },
  };
  if (reason !== undefined) approval.reason = reason;
  if (provenance !== undefined) approval.provenance = provenance;
  if (modifiedQuantityMw !== undefined) approval.modifiedQuantityMw = modifiedQuantityMw;
  return approval;
}

const INTERVENTION_PROVENANCE = {
  authority: "fixture: operador humano de test",
  locator: "test/governance/imp24.test.mjs",
};

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

// La primera activación A1 (§18.1) es un acto humano de DEP-25 separado del
// envelope: un governor cuyo envelope ya autoriza A1 no ejerce autoridad real
// hasta registrar ese acto. Los tests de acciones reales lo registran primero.
function activateFirstA1(judge) {
  const activation = judge.considerFirstActivation(firstActivationInput());
  assert.equal(activation.ok, true, "INSPECCIÓN: la primera activación A1 del fixture debe registrarse: " + JSON.stringify(activation));
  assert.equal(judge.currentState().firstActivationRecorded, true);
  return activation;
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
    rollbackBaseline: options.rollbackBaseline,
    rollbackBaselineAuthorizationRef: options.rollbackBaselineAuthorizationRef,
    safeNonActionState: options.safeNonActionState,
    safeNonActionStateProvenance: options.safeNonActionStateProvenance,
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

test("IMP-24: el governor consume el receipt Shadow real de IMP-18 (misma identidad que el productor)", () => {
  const receipt = realShadowReceipt();
  assert.equal(receipt.receiptKind, SHADOW_RECEIPT_KIND);
  const received = receiveGovernanceEvidence({ evidence: receipt });
  assert.equal(received.ok, true, "INSPECCIÓN: " + JSON.stringify(received));
  assert.equal(received.evidence.stage, "SHADOW");
  assert.equal(received.evidence.identity.policyVersion, receipt.policyVersion);
  assert.equal(received.evidence.receiptId, receipt.contentHash);
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

test("IMP-24: el receipt HOLD de primera activación declara la frontera de etapa, coherente con el nivel operativo (IMP24-HOLD-RECEIPT-A1-LABEL)", () => {
  // §18.4: "Nuevo estado/versión" y "Nivel de autonomía" deben ser coherentes
  // dentro del mismo receipt. La primera activación no mueve el nivel
  // operativo (§18.3), así que el HOLD no puede declarar un nivel A1 cuando el
  // governor opera en A0/A2/A3/A4.
  for (const level of ["A0", "A1", "A2", "A3", "A4"]) {
    const judge = buildGovernor({ autonomyLevel: level });
    const result = judge.considerFirstActivation(firstActivationInput({ humanApproval: null }));
    assert.equal(result.ok, false, `${level}: sin aprobación no hay activación`);
    const holds = judge.receiptRegistry.transitionsOfType("HOLD");
    assert.equal(holds.length, 1, `${level}: HOLD reconstruible registrado`);
    const receipt = holds[0];
    assert.equal(receipt.autonomyLevel, level, `${level}: el receipt declara el nivel operativo vigente`);
    assert.equal(receipt.previousState, "v1.0@SHADOW");
    assert.equal(receipt.newState, "v1.0@SHADOW:HELD", `${level}: el HOLD conserva la versión en Shadow`);
    assert.equal(receipt.newState.includes("@A1"), false, `${level}: el HOLD no declara un nivel A1 que contradiga autonomyLevel`);
  }
});

test("IMP-24: con evidencia y APG del fixture válidos y aprobación explícita: PROMOTE a A1", () => {
  const judge = buildGovernor({ autonomyLevel: "A1" });
  const result = judge.considerFirstActivation(firstActivationInput());
  assert.equal(result.ok, true, "INSPECCIÓN: " + JSON.stringify(result));
  assert.equal(result.activation.toStage, "REAL");
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
  // §18.4: la vía de mismatch queda registrada como HOLD reconstruible.
  const holds = judge.receiptRegistry.transitionsOfType("HOLD");
  assert.equal(holds.length, 1);
  assert.equal(result.transitionReceiptId, holds[0].receiptId);
});

test("IMP-24: un receipt de etapa equivocada en el slot OOS se rechaza con HOLD, nunca rompe (§25.2.3 hito 2)", () => {
  const judge = buildGovernor({ autonomyLevel: "A0" });
  // El receipt Shadow es válido, pero pertenece a otra etapa: no es evidencia OOS.
  const result = judge.considerFirstActivation(firstActivationInput({ oosEvidence: shadowReceipt({ policyVersion: "v1.0" }) }));
  assert.equal(result.ok, false);
  assert.equal(result.code, "EVIDENCE_STAGE_MISMATCH");
  assert.equal(result.stage, "OOS");
  const holds = judge.receiptRegistry.transitionsOfType("HOLD");
  assert.equal(holds.length, 1);
  assert.equal(result.transitionReceiptId, holds[0].receiptId);
});

test("IMP-24: un receipt de etapa equivocada en el slot Shadow se rechaza con HOLD (§25.2.3 hito 2)", () => {
  const judge = buildGovernor({ autonomyLevel: "A0" });
  // El receipt OOS es válido, pero pertenece a otra etapa: no es evidencia Shadow.
  const result = judge.considerFirstActivation(firstActivationInput({ shadowEvidence: oosReceipt() }));
  assert.equal(result.ok, false);
  assert.equal(result.code, "EVIDENCE_STAGE_MISMATCH");
  assert.equal(result.stage, "SHADOW");
  const holds = judge.receiptRegistry.transitionsOfType("HOLD");
  assert.equal(holds.length, 1);
  assert.equal(result.transitionReceiptId, holds[0].receiptId);
});

test("IMP-24: evidencia OOS con veredicto FAIL no soporta activación", () => {
  const judge = buildGovernor({ autonomyLevel: "A0" });
  const result = judge.considerFirstActivation(firstActivationInput({ oosEvidence: oosReceipt({ verdict: "FAIL" }) }));
  assert.equal(result.ok, false);
  assert.equal(result.code, "OOS_EVIDENCE_NOT_ELIGIBLE");
  // §18.4: el HOLD por evidencia no elegible queda en el registro de
  // transiciones, no sólo como respuesta inmediata (reconstruible).
  assert.equal(judge.receiptRegistry.transitionsOfType("HOLD").length, 1);
  assert.equal(result.transitionReceiptId, judge.receiptRegistry.transitionsOfType("HOLD")[0].receiptId);
});

test("IMP-24: evidencia Shadow sin non-interference verificada no es satisfactoria y queda HOLD (§18.1)", () => {
  const broken = shadowReceipt({ policyVersion: "v1.0", nonInterferenceVerdict: "SHADOW_NON_INTERFERENCE_BROKEN" });
  const received = receiveGovernanceEvidence({ evidence: broken });
  assert.equal(received.ok, true);
  assert.equal(received.evidence.stage, "SHADOW");
  assert.equal(received.evidence.shadowSufficiency.nonInterferenceVerdict, "SHADOW_NON_INTERFERENCE_BROKEN");

  const judge = buildGovernor({ autonomyLevel: "A0" });
  const result = judge.considerFirstActivation(firstActivationInput({ shadowEvidence: broken }));
  assert.equal(result.ok, false);
  assert.equal(result.code, "SHADOW_EVIDENCE_NOT_ELIGIBLE");
  const holds = judge.receiptRegistry.transitionsOfType("HOLD");
  assert.equal(holds.length, 1); // §18.4: HOLD reconstruible
  assert.equal(result.transitionReceiptId, holds[0].receiptId);
});

test("IMP-24: evidencia Shadow sin cobertura terminal COVERED no es satisfactoria", () => {
  const incomplete = shadowReceipt({ policyVersion: "v1.0", terminalCoverageStatus: "COVERAGE_INCOMPLETE" });
  const judge = buildGovernor({ autonomyLevel: "A0" });
  const result = judge.considerFirstActivation(firstActivationInput({ shadowEvidence: incomplete }));
  assert.equal(result.ok, false);
  assert.equal(result.code, "SHADOW_EVIDENCE_NOT_ELIGIBLE");
  assert.equal(judge.receiptRegistry.transitionsOfType("HOLD").length, 1);
});

test("IMP-24: evidencia Shadow de otra versión no activa", () => {
  const judge = buildGovernor({ autonomyLevel: "A0" });
  const result = judge.considerFirstActivation(firstActivationInput({ shadowEvidence: shadowReceipt({ policyVersion: "otra-version" }) }));
  assert.equal(result.ok, false);
  assert.equal(result.code, "EVIDENCE_VERSION_MISMATCH");
  // §18.4: HOLD reconstruible también en esta vía de mismatch.
  assert.equal(judge.receiptRegistry.transitionsOfType("HOLD").length, 1);
  assert.equal(result.transitionReceiptId, judge.receiptRegistry.transitionsOfType("HOLD")[0].receiptId);
});

test("IMP-24: la evidencia Shadow que no es de la Policy Version activada no activa y queda HOLD", () => {
  const judge = buildGovernor({ autonomyLevel: "A0" });
  // Sin oosPolicyVersion declarado, la única comparación viva es Shadow vs policyVersion.
  const result = judge.considerFirstActivation(firstActivationInput({
    oosPolicyVersion: undefined,
    shadowEvidence: shadowReceipt({ policyVersion: "otra-version" }),
  }));
  assert.equal(result.ok, false);
  assert.equal(result.code, "SHADOW_EVIDENCE_VERSION_MISMATCH");
  const holds = judge.receiptRegistry.transitionsOfType("HOLD");
  assert.equal(holds.length, 1);
  assert.equal(result.transitionReceiptId, holds[0].receiptId);
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

test("IMP-24: OOS y Shadow de experimentos distintos no son la misma identidad de versión", () => {
  const judge = buildGovernor({ autonomyLevel: "A0" });
  const result = judge.considerFirstActivation(firstActivationInput({
    shadowEvidence: shadowReceipt({ policyVersion: "v1.0", experiment: { experimentId: "EXP-OTRO", experimentVersion: "1.0" } }),
  }));
  assert.equal(result.ok, false);
  assert.equal(result.code, "EVIDENCE_VERSION_MISMATCH");
  // §18.4: el mismatch de experimento también deja HOLD reconstruible.
  const holds = judge.receiptRegistry.transitionsOfType("HOLD");
  assert.equal(holds.length, 1);
  assert.equal(result.transitionReceiptId, holds[0].receiptId);
});

test("IMP-24: sin APG satisfecho la activación no procede aunque exista aprobación", () => {
  const judge = buildGovernor({ autonomyLevel: "A0" });
  const result = judge.considerFirstActivation(firstActivationInput({ apg: null }));
  assert.equal(result.ok, false);
  assert.equal(result.code, "APG_NOT_SATISFIED");
  // §18.4: el HOLD por APG insuficiente queda en el registro reconstruible.
  assert.equal(judge.receiptRegistry.transitionsOfType("HOLD").length, 1);
  assert.equal(result.transitionReceiptId, judge.receiptRegistry.transitionsOfType("HOLD")[0].receiptId);
});

test("IMP-24: evidencia sintética produce un record marcado como demostración de mecanismo", () => {
  const judge = buildGovernor({ autonomyLevel: "A1" });
  const result = judge.considerFirstActivation(firstActivationInput());
  assert.equal(result.ok, true);
  assert.equal(result.activation.synthetic, true);
});

test("IMP-24: la segunda llamada a la primera activación se rechaza sin PROMOTE duplicado (§18.4)", () => {
  const judge = buildGovernor({ autonomyLevel: "A1" });
  const first = judge.considerFirstActivation(firstActivationInput());
  assert.equal(first.ok, true, "INSPECCIÓN: " + JSON.stringify(first));
  const promotesAfterFirst = judge.receiptRegistry.transitionsOfType("PROMOTE").length;

  const second = judge.considerFirstActivation(firstActivationInput());
  assert.equal(second.ok, false);
  assert.equal(second.code, "FIRST_ACTIVATION_ALREADY_RECORDED");
  // §18.4: ningún PROMOTE duplicado con previousState falso A0→A1.
  assert.equal(judge.receiptRegistry.transitionsOfType("PROMOTE").length, promotesAfterFirst);
  assert.equal(judge.currentState().level, "A1");
});

test("IMP-24: la vía de la primera activación registra el acto sin tocar el nivel operativo (§18.1/§18.3)", () => {
  // Governor operando a A2 por su envelope, antes de cualquier acto de DEP-25
  // ( IMP24-REAL-AUTHORITY-A2-WITHOUT-FIRST-ACTIVATION ): el gate de primera
  // activación manda sobre la versión, no sobre un nivel concreto, y
  // registrarlo nunca es un DEMOTE del nivel operativo (§18.3).
  const judge = buildGovernor({ autonomyLevel: "A2" });
  const result = judge.considerFirstActivation(firstActivationInput());
  assert.equal(result.ok, true, "INSPECCIÓN: " + JSON.stringify(result));
  assert.equal(judge.currentState().level, "A2");
  assert.equal(judge.currentState().firstActivationRecorded, true);
  const receipt = judge.receiptRegistry.receiptOf(result.transitionReceiptId);
  assert.equal(receipt.transitionType, "PROMOTE");
  // §18.4: el receipt documenta el acto de la versión ( Shadow -> Real ) con
  // la autoridad que ejecuta (A2, portada por el envelopeVersionKey), no un
  // movimiento del nivel operativo.
  assert.equal(receipt.previousState, "v1.0@SHADOW");
  assert.equal(receipt.newState, "v1.0@REAL");
  assert.equal(receipt.autonomyLevel, "A2");
  assert.equal(receipt.envelopeVersionKey, "version:v1.0");
  const demotes = judge.receiptRegistry.transitionsOfType("DEMOTE");
  assert.equal(demotes.length, 0);
});

test("IMP-24: la primera activación A1 no procede bajo un envelope A0 sin autoridad real (§16.2/§17/§18.4)", () => {
  const judge = buildGovernor({ autonomyLevel: "A0" });
  const result = judge.considerFirstActivation(firstActivationInput());
  assert.equal(result.ok, false);
  assert.equal(result.code, "ENVELOPE_WITHOUT_REAL_AUTHORITY");
  // §18.4: la vía queda registrada como HOLD reconstruible, sin PROMOTE cuyo
  // envelopeVersionKey no conceda A1.
  assert.equal(judge.receiptRegistry.transitionsOfType("PROMOTE").length, 0);
  assert.equal(judge.receiptRegistry.transitionsOfType("HOLD").length, 1);
  assert.equal(result.transitionReceiptId, judge.receiptRegistry.transitionsOfType("HOLD")[0].receiptId);
  assert.equal(judge.currentState().level, "A0");
  assert.equal(judge.currentState().firstActivationRecorded, false);
});

// --- 4) Approval enforcement A1 ---

test("IMP-24: un acto real BUY exige la primera activación A1 registrada; el envelope A1 solo no basta (§18.1/§25.2.3 hito 2)", () => {
  const judge = buildGovernor({ autonomyLevel: "A1" });
  const result = judge.authorizeRealAction({
    action: "BUY",
    policyVersion: "v1.0",
    quantityMw: 3,
    dataState: dataStateFixture(),
    humanApproval: actionApprovalFixture(),
    atUtc: T0,
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, "FIRST_ACTIVATION_REQUIRED_BEFORE_REAL_ACTION");
  assert.notEqual(result.authorized, true);
  assert.equal(judge.currentState().firstActivationRecorded, false);
});

test("IMP-24: bajo un envelope A0 ningún acto real BUY se autoriza (§16.2/§17)", () => {
  const judge = buildGovernor({ autonomyLevel: "A0" });
  const result = judge.authorizeRealAction({
    action: "BUY",
    policyVersion: "v1.0",
    quantityMw: 3,
    dataState: dataStateFixture(),
    humanApproval: actionApprovalFixture(),
    atUtc: T0,
  });
  assert.equal(result.authorized, false);
});

test("IMP-24: sin primera activación registrada, la vía A2+ no autoriza ningún BUY real (IMP24-REAL-AUTHORITY-A2-WITHOUT-FIRST-ACTIVATION)", () => {
  const judge = buildGovernor({ autonomyLevel: "A2" });
  const result = judge.authorizeRealAction({
    action: "BUY",
    policyVersion: "v1.0",
    quantityMw: 5,
    dataState: dataStateFixture(),
    humanApproval: actionApprovalFixture(),
    atUtc: T0,
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, "FIRST_ACTIVATION_REQUIRED_BEFORE_REAL_ACTION");
  assert.notEqual(result.authorized, true);
  assert.equal(judge.currentState().firstActivationRecorded, false);
});

test("IMP-24: tras registrar la primera activación, un BUY A2 dentro de límites se autoriza y queda registrado (§18.1/§18.4)", () => {
  const judge = buildGovernor({ autonomyLevel: "A2" });
  const activation = judge.considerFirstActivation(firstActivationInput());
  assert.equal(activation.ok, true, "INSPECCIÓN: " + JSON.stringify(activation));
  const result = judge.authorizeRealAction({
    action: "BUY",
    policyVersion: "v1.0",
    quantityMw: 5,
    dataState: dataStateFixture(),
    atUtc: T0,
  });
  assert.equal(result.ok, true, "INSPECCIÓN: " + JSON.stringify(result));
  assert.equal(result.authorized, true);
  assert.equal(result.action.artifactKind, "IMP-24_GOVERNED_ACTION_RECORD");
  assert.equal(result.action.recommendation.quantityMw, 5);
  assert.equal(result.action.authorizedQuantityMw, 5);
  assert.equal(result.action.operativeLevel, "A2");
  assert.equal(result.action.humanApprovalAction, null);
  assert.equal(result.action.modifiedOutcomeAttributableToRecommendation, true);
});

test("IMP-24: en A2+ el envelope sigue mandando tras la primera activación: el exceso sobre el límite se rechaza", () => {
  const judge = buildGovernor({ autonomyLevel: "A2" });
  assert.equal(judge.considerFirstActivation(firstActivationInput()).ok, true);
  const result = judge.authorizeRealAction({
    action: "BUY",
    policyVersion: "v1.0",
    quantityMw: 40,
    dataState: dataStateFixture(),
    atUtc: T0,
  });
  assert.equal(result.ok, true);
  assert.equal(result.authorized, false);
  assert.deepEqual(result.reasons.map((reason) => reason.code), ["QUANTITY_ABOVE_LIMIT"]);
});

test("IMP-24: el DEMOTE al piso A0 operativo retira la autoridad de compra aunque el envelope A2+ la conceda (§16.2/§18.3)", () => {
  const judge = buildGovernor({ autonomyLevel: "A2" });
  assert.equal(judge.considerFirstActivation(firstActivationInput()).ok, true);
  judge.applyHardGateMandate({ gateId: "G-OOD", evidenceRef: "FIXTURE-BREACH-A0-1", requestedTransition: "DEMOTE", atUtc: T0 });
  judge.applyHardGateMandate({ gateId: "G-OOD", evidenceRef: "FIXTURE-BREACH-A0-2", requestedTransition: "DEMOTE", atUtc: T0 });
  assert.equal(judge.currentState().level, "A0");
  assert.equal(judge.currentState().firstActivationRecorded, true);
  const result = judge.authorizeRealAction({
    action: "BUY",
    policyVersion: "v1.0",
    quantityMw: 3,
    dataState: dataStateFixture(),
    atUtc: T0,
  });
  assert.equal(result.ok, true);
  assert.equal(result.authorized, false);
  assert.deepEqual(result.reasons.map((reason) => reason.code), ["LEVEL_WITHOUT_BUY_AUTHORITY"]);
  assert.equal(result.recommendation.action, "BUY");
});

test("IMP-24: tras DEMOTE a A1 operativo bajo envelope A2+, la validación humana por acción vuelve a exigir (§16.2/§18.1)", () => {
  const judge = buildGovernor({ autonomyLevel: "A2" });
  assert.equal(judge.considerFirstActivation(firstActivationInput()).ok, true);
  judge.applyHardGateMandate({ gateId: "G-OOD", evidenceRef: "FIXTURE-BREACH-A1", requestedTransition: "DEMOTE", atUtc: T0 });
  assert.equal(judge.currentState().level, "A1");
  const withoutValidation = judge.authorizeRealAction({
    action: "BUY",
    policyVersion: "v1.0",
    quantityMw: 3,
    dataState: dataStateFixture(),
    atUtc: T0,
  });
  assert.equal(withoutValidation.authorized, false);
  assert.equal(withoutValidation.code, "MISSING_ACTION_APPROVAL");
  const validated = judge.authorizeRealAction({
    action: "BUY",
    policyVersion: "v1.0",
    quantityMw: 3,
    dataState: dataStateFixture(),
    humanApproval: actionApprovalFixture(),
    atUtc: T0,
  });
  assert.equal(validated.authorized, true, "INSPECCIÓN: " + JSON.stringify(validated));
  assert.equal(validated.action.humanApprovalAction.decision, "APPROVED");
});

test("IMP-24: una cantidad modificada declarada inválida se rechaza fail-closed, nunca se coacciona a sin modificación (§18.1/§12.2)", () => {
  for (const invalid of [0, -1, Number.NaN, "2", true]) {
    const judge = buildGovernor({ autonomyLevel: "A1" });
    activateFirstA1(judge);
    const result = judge.authorizeRealAction({
      action: "BUY",
      policyVersion: "v1.0",
      quantityMw: 3,
      dataState: dataStateFixture(),
      humanApproval: actionApprovalFixture({ modifiedQuantityMw: invalid, reason: "fixture: reducción declarada", provenance: INTERVENTION_PROVENANCE }),
      atUtc: T0,
    });
    assert.equal(result.authorized, false, `modifiedQuantityMw=${String(invalid)} no debe autorizar`);
    assert.equal(result.code, "INVALID_MODIFIED_QUANTITY", `modifiedQuantityMw=${String(invalid)}`);
  }
});

test("IMP-24: declarar la misma cantidad recomendada no es una modificación", () => {
  const judge = buildGovernor({ autonomyLevel: "A1" });
  activateFirstA1(judge);
  const result = judge.authorizeRealAction({
    action: "BUY",
    policyVersion: "v1.0",
    quantityMw: 3,
    dataState: dataStateFixture(),
    humanApproval: actionApprovalFixture({ modifiedQuantityMw: 3 }),
    atUtc: T0,
  });
  assert.equal(result.authorized, true);
  assert.equal(result.action.authorizedQuantityMw, 3);
  assert.equal(result.action.modification, null);
  assert.equal(result.action.modifiedOutcomeAttributableToRecommendation, true);
});

test("IMP-24: en A1 sin validación humana por acción la recomendación no ejecuta", () => {
  const judge = buildGovernor({ autonomyLevel: "A1" });
  activateFirstA1(judge);
  const result = judge.authorizeRealAction({ action: "BUY", policyVersion: "v1.0", quantityMw: 3, dataState: dataStateFixture(), atUtc: T0 });
  assert.equal(result.ok, true);
  assert.equal(result.authorized, false);
  assert.equal(result.code, "MISSING_ACTION_APPROVAL");
});

test("IMP-24: la validación humana por acción no puede venir de la policy", () => {
  const judge = buildGovernor({ autonomyLevel: "A1" });
  activateFirstA1(judge);
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
  activateFirstA1(judge);
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
  activateFirstA1(judge);
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

test("IMP-24: el veto humano se registra con timestamp, razón y provenance, y no ejecuta", () => {
  const judge = buildGovernor({ autonomyLevel: "A1" });
  activateFirstA1(judge);
  const result = judge.authorizeRealAction({
    action: "BUY",
    policyVersion: "v1.0",
    quantityMw: 3,
    dataState: dataStateFixture(),
    humanApproval: actionApprovalFixture({ decision: "VETOED", reason: "fixture: razón declarada del veto", provenance: INTERVENTION_PROVENANCE }),
    atUtc: T0,
  });
  assert.equal(result.authorized, false);
  assert.equal(result.code, "ACTION_VETOED");
  assert.equal(result.intervention.decision, "VETOED");
  assert.equal(typeof result.intervention.decidedAtUtc, "string");
  assert.equal(result.intervention.reason, "fixture: razón declarada del veto");
  assert.deepEqual(result.intervention.provenance, INTERVENTION_PROVENANCE);
});

test("IMP-24: la modificación humana de la cantidad se registra y no se atribuye a la recomendación", () => {
  const judge = buildGovernor({ autonomyLevel: "A1" });
  activateFirstA1(judge);
  const result = judge.authorizeRealAction({
    action: "BUY",
    policyVersion: "v1.0",
    quantityMw: 3,
    dataState: dataStateFixture(),
    humanApproval: actionApprovalFixture({ modifiedQuantityMw: 2, reason: "fixture: modificación de cantidad", provenance: INTERVENTION_PROVENANCE }),
    atUtc: T0,
  });
  assert.equal(result.authorized, true);
  assert.equal(result.action.authorizedQuantityMw, 2);
  assert.deepEqual(result.action.modification, { kind: "QUANTITY_MODIFIED", from: 3, to: 2 });
  assert.equal(result.action.modifiedOutcomeAttributableToRecommendation, false);
  assert.equal(result.action.humanApprovalAction.reason, "fixture: modificación de cantidad");
  assert.deepEqual(result.action.humanApprovalAction.provenance, INTERVENTION_PROVENANCE);
});

test("IMP-24: una intervención humana sin razón ni provenance no se registra (§18.1/§12.2)", () => {
  const judge = buildGovernor({ autonomyLevel: "A1" });
  activateFirstA1(judge);
  const base = { action: "BUY", policyVersion: "v1.0", quantityMw: 3, dataState: dataStateFixture(), atUtc: T0 };

  const vetoWithoutReason = judge.authorizeRealAction({ ...base, humanApproval: actionApprovalFixture({ decision: "VETOED", provenance: INTERVENTION_PROVENANCE }) });
  assert.equal(vetoWithoutReason.authorized, false);
  assert.equal(vetoWithoutReason.code, "INTERVENTION_REASON_MISSING");

  const delayedWithoutProvenance = judge.authorizeRealAction({ ...base, humanApproval: actionApprovalFixture({ decision: "DELAYED", reason: "fixture: demora" }) });
  assert.equal(delayedWithoutProvenance.authorized, false);
  assert.equal(delayedWithoutProvenance.code, "INTERVENTION_PROVENANCE_MISSING");

  const modificationWithoutReason = judge.authorizeRealAction({ ...base, humanApproval: actionApprovalFixture({ modifiedQuantityMw: 2, provenance: INTERVENTION_PROVENANCE }) });
  assert.equal(modificationWithoutReason.authorized, false);
  assert.equal(modificationWithoutReason.code, "INTERVENTION_REASON_MISSING");

  const modificationWithoutProvenance = judge.authorizeRealAction({ ...base, humanApproval: actionApprovalFixture({ modifiedQuantityMw: 2, reason: "fixture: modificación" }) });
  assert.equal(modificationWithoutProvenance.authorized, false);
  assert.equal(modificationWithoutProvenance.code, "INTERVENTION_PROVENANCE_MISSING");

  // Una aprobación simple sin modificación no es intervención: no exige razón.
  const plainApproval = judge.authorizeRealAction({ ...base, humanApproval: actionApprovalFixture() });
  assert.equal(plainApproval.authorized, true);
});

test("IMP-24: la validación humana no sustituye al envelope: exceso sobre el límite se rechaza", () => {
  const judge = buildGovernor({ autonomyLevel: "A1" });
  activateFirstA1(judge);
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
  activateFirstA1(judge);
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

test("IMP-24: la promoción aprobada produce PROMOTE sólo si el envelope autoriza el nivel destino", () => {
  const judge = buildGovernor({ autonomyLevel: "A2" });
  // El envelope autoriza A2; una demotion previa deja el nivel operativo en A1.
  judge.applyHardGateMandate({ gateId: "G-OOD", evidenceRef: "FIXTURE-PRE-PROMOTION", requestedTransition: "DEMOTE", atUtc: T0 });
  assert.equal(judge.currentState().level, "A1");
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
  assert.equal(receipt.envelopeVersionKey, "version:v1.0");
});

test("IMP-24: un ascenso a un nivel no autorizado por el envelope no registra PROMOTE", () => {
  const judge = buildGovernor({ autonomyLevel: "A1" });
  const result = judge.considerSubsequentPromotion({
    targetLevel: "A2",
    apg: apgFixture(),
    governanceChangeApproval: approvalFixture("GOVERNANCE_PROMOTION:A2"),
    atUtc: T0,
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, "TARGET_LEVEL_NOT_AUTHORIZED_BY_ENVELOPE");
  assert.equal(judge.currentState().level, "A1");
  assert.equal(judge.receiptRegistry.transitionsOfType("PROMOTE").length, 0);
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

test("IMP-24: en HALT no se registra PROMOTE y el rollback no reanuda en un nivel superior (§18.3/§18.4)", () => {
  const judge = buildGovernor({ autonomyLevel: "A2" });
  // La versión que el rollback puede restaurar debe haber obtenido autoridad
  // real por un acto gobernado (§18.3/§18.4): se activa antes del cese.
  activateFirstA1(judge);
  // Baja un nivel (A2→A1) y luego detiene la operación.
  judge.applyHardGateMandate({ gateId: "G-OOD", evidenceRef: "FIXTURE-BREACH-HALT-1", requestedTransition: "DEMOTE", atUtc: T0 });
  judge.applyHardGateMandate({ gateId: "G-OOD", evidenceRef: "FIXTURE-BREACH-HALT-2", requestedTransition: "HALT", atUtc: T0 });
  assert.equal(judge.currentState().status, "HALTED");
  assert.equal(judge.currentState().level, "A1");

  const promotesBefore = judge.receiptRegistry.transitionsOfType("PROMOTE").length;
  const promotion = judge.considerSubsequentPromotion({
    targetLevel: "A2",
    apg: apgFixture(),
    governanceChangeApproval: approvalFixture("GOVERNANCE_PROMOTION:A2"),
    atUtc: T0,
  });
  assert.equal(promotion.ok, false);
  assert.equal(promotion.code, "GOVERNOR_STATE_HALTED");
  assert.equal(judge.receiptRegistry.transitionsOfType("PROMOTE").length, promotesBefore, "en HALT no se registra PROMOTE");
  assert.equal(judge.currentState().level, "A1");

  const history = [
    { policyVersion: "v1.0", validity: [{ underEnvelopeVersion: "version:v1.0", currentValid: true }] },
  ];
  const rollback = judge.executeHaltingRollback({ policyVersionHistory: history, atUtc: "2026-09-24T11:00:00Z" });
  assert.equal(rollback.ok, true);
  assert.equal(rollback.restoredLevel, "A1");
  assert.equal(judge.currentState().status, "ACTIVE");
});

test("IMP-24: con el governor detenido la primera activación no procede (§18.3)", () => {
  const judge = buildGovernor({ autonomyLevel: "A0" });
  judge.applyHardGateMandate({ gateId: "G-OOD", evidenceRef: "FIXTURE-BREACH-HALT-3", atUtc: T0 });
  const result = judge.considerFirstActivation(firstActivationInput());
  assert.equal(result.ok, false);
  assert.equal(result.code, "GOVERNOR_STATE_HALTED");
  assert.equal(judge.receiptRegistry.transitionsOfType("PROMOTE").length, 0);
});

test("IMP-24: el hard-gate DEMOTE en el nivel mínimo A0 no fabrica un receipt A0→A0: detiene la operación (§18.3/§18.4)", () => {
  const judge = buildGovernor({ autonomyLevel: "A0" });
  const result = judge.applyHardGateMandate({ gateId: "G-OOD", evidenceRef: "FIXTURE-BREACH-FLOOR", requestedTransition: "DEMOTE", atUtc: T0 });
  assert.equal(result.ok, true);
  assert.equal(result.transition, "HALT");
  assert.equal(result.demoteAtMinimumLevel, true);
  assert.equal(judge.currentState().status, "HALTED");
  assert.equal(judge.currentState().level, "A0");
  assert.equal(judge.receiptRegistry.transitionsOfType("DEMOTE").length, 0);
  const receipt = judge.receiptRegistry.receiptOf(result.transitionReceiptId);
  assert.equal(receipt.transitionType, "HALT");
});

test("IMP-24: el HALT por DEMOTE en el piso A0 es revertible con ROLLBACK al fallback declarado (§18.3)", () => {
  const judge = buildGovernor({
    autonomyLevel: "A0",
    safeNonActionState: "WAIT",
    safeNonActionStateProvenance: { authority: "fixture: operaciones sintéticas de test" },
  });
  const halted = judge.applyHardGateMandate({ gateId: "G-OOD", evidenceRef: "FIXTURE-BREACH-FLOOR-ROLLBACK", requestedTransition: "DEMOTE", atUtc: T0 });
  assert.equal(halted.transition, "HALT");
  assert.equal(judge.currentState().status, "HALTED");
  // El mandato guardado es la transición EFECTIVA (HALT): un DEMOTE en el piso
  // se materializa como cese y executeRollback sólo acepta un mandato HALT. Si
  // se guardara el DEMOTE original el cese quedaría sin vía de rollback.
  assert.equal(judge.currentState().lastHaltingMandate.transition, "HALT");
  assert.equal(judge.currentState().lastHaltingMandate.requestedTransition, "DEMOTE");

  // En A0 no hay ninguna Policy Version con autoridad real (no puede haber
  // primera activación): el rollback no fabrica autoridad y usa el safe
  // non-action state declarado por operaciones (§18.3).
  const history = [{ policyVersion: "v1.0", validity: [{ underEnvelopeVersion: "version:v1.0", currentValid: true }] }];
  const rollback = judge.executeHaltingRollback({ policyVersionHistory: history, atUtc: "2026-09-24T11:00:00Z" });
  assert.equal(rollback.ok, true, "INSPECCIÓN: " + JSON.stringify(rollback));
  assert.equal(rollback.rollback.target.destination, "SAFE_NON_ACTION_STATE");
  assert.equal(rollback.restoredLevel, "A0");
  assert.equal(judge.currentState().status, "ACTIVE");
  assert.equal(judge.currentState().activePolicyVersion, null);
  const receipt = judge.receiptRegistry.receiptOf(rollback.transitionReceiptId);
  assert.equal(receipt.transitionType, "ROLLBACK");
  assert.equal(receipt.newState, "SAFE_NON_ACTION_STATE:A0");
});

test("IMP-24: el rollback del HALT restaura la última versión válida y no auto-amplía el nivel", () => {
  const judge = buildGovernor({ autonomyLevel: "A2" });
  activateFirstA1(judge);
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
  const judge = buildGovernor({ autonomyLevel: "A1" });
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

// --- 6) Autoridad real ligada a la Policy Version concreta
// ( IMP24-REAL-AUTHORITY-UNBOUND-POLICY-VERSION ): la autoridad no se hereda
// por estar VALID en el envelope; cada versión la obtiene por su propio acto
// gobernado (§18.2/§18.4/§25.2.3 hito 3). ---

const TWO_VERSIONS = [
  { policyVersion: "vX", underEnvelopeVersion: "v1.0", status: "VALID" },
  { policyVersion: "vY", underEnvelopeVersion: "v1.0", status: "VALID" },
];

function activateVersion(judge, version) {
  const activation = judge.considerFirstActivation(firstActivationInput({
    policyVersion: version,
    oosPolicyVersion: version,
    shadowEvidence: shadowReceipt({ policyVersion: version }),
  }));
  assert.equal(activation.ok, true, `INSPECCIÓN: activación de ${version}: ` + JSON.stringify(activation));
  return activation;
}

function versionPromotionInput(version, overrides = {}) {
  return {
    policyVersion: version,
    oosPolicyVersion: version,
    oosEvidence: oosReceipt(),
    shadowEvidence: shadowReceipt({ policyVersion: version }),
    apg: apgFixture(),
    governanceChangeApproval: approvalFixture(`${POLICY_VERSION_PROMOTION_SCOPE_PREFIX}:${version}`),
    atUtc: T0,
    ...overrides,
  };
}

test("IMP-24: tras activar vX, otra Policy Version VALID del envelope (vY) no hereda autoridad real en A1 ni en A2 (IMP24-REAL-AUTHORITY-UNBOUND-POLICY-VERSION)", () => {
  for (const level of ["A1", "A2"]) {
    const judge = buildGovernor({ autonomyLevel: level, authorizedPolicyVersions: TWO_VERSIONS });
    activateVersion(judge, "vX");
    assert.equal(judge.currentState().activePolicyVersion, "vX", `${level}: la versión activa es la activada`);
    const result = judge.authorizeRealAction({
      action: "BUY",
      policyVersion: "vY",
      quantityMw: 3,
      dataState: dataStateFixture(),
      humanApproval: actionApprovalFixture(),
      atUtc: T0,
    });
    assert.equal(result.ok, false, `${level}: vY no debe autorizar sin acto gobernado`);
    assert.equal(result.code, "POLICY_VERSION_WITHOUT_REAL_AUTHORITY", `${level}`);
    assert.notEqual(result.authorized, true, `${level}`);
  }
});

test("IMP-24: los receipts nombran la Policy Version activa real, no la unión de versiones VALID del envelope (§18.4)", () => {
  const judge = buildGovernor({ autonomyLevel: "A2", authorizedPolicyVersions: TWO_VERSIONS });
  const activation = activateVersion(judge, "vX");
  const activationReceipt = judge.receiptRegistry.receiptOf(activation.transitionReceiptId);
  assert.equal(activationReceipt.previousState, "vX@SHADOW");
  assert.equal(activationReceipt.newState, "vX@REAL");

  const halted = judge.applyHardGateMandate({ gateId: "G-OOD", evidenceRef: "FIXTURE-UNION-1", atUtc: T0 });
  const receipt = judge.receiptRegistry.receiptOf(halted.transitionReceiptId);
  assert.equal(receipt.previousState, "vX@A2");
  assert.equal(receipt.newState, "vX@A2:HALTED");
  assert.equal(receipt.previousState.includes("vY"), false);
  assert.equal(receipt.newState.includes("vY"), false);
});

test("IMP-24: una versión posterior obtiene autoridad sólo por su PROMOTE de versión con evidencia, APG y receipt (§18.2/§25.2.3 hito 3)", () => {
  const judge = buildGovernor({ autonomyLevel: "A2", authorizedPolicyVersions: TWO_VERSIONS });
  activateVersion(judge, "vX");
  const promoted = judge.considerPolicyVersionPromotion(versionPromotionInput("vY"));
  assert.equal(promoted.ok, true, "INSPECCIÓN: " + JSON.stringify(promoted));
  assert.equal(promoted.status, "POLICY_VERSION_PROMOTED");
  assert.equal(promoted.fromPolicyVersion, "vX");
  assert.equal(promoted.toPolicyVersion, "vY");
  assert.equal(judge.currentState().level, "A2", "la promoción de versión no mueve el nivel operativo");
  assert.equal(judge.currentState().activePolicyVersion, "vY");

  const receipt = judge.receiptRegistry.receiptOf(promoted.transitionReceiptId);
  assert.equal(receipt.transitionType, "PROMOTE");
  assert.equal(receipt.previousState, "vX@REAL");
  assert.equal(receipt.newState, "vY@REAL");
  assert.equal(receipt.autonomyLevel, "A2");

  const buysWithVY = judge.authorizeRealAction({ action: "BUY", policyVersion: "vY", quantityMw: 3, dataState: dataStateFixture(), atUtc: T0 });
  assert.equal(buysWithVY.authorized, true, "INSPECCIÓN: " + JSON.stringify(buysWithVY));
  const buysWithVX = judge.authorizeRealAction({ action: "BUY", policyVersion: "vX", quantityMw: 3, dataState: dataStateFixture(), atUtc: T0 });
  assert.equal(buysWithVX.ok, false, "la versión anterior deja de ejercer autoridad");
  assert.equal(buysWithVX.code, "POLICY_VERSION_WITHOUT_REAL_AUTHORITY");
});

test("IMP-24: la promoción de versión sin APG satisfecho queda HOLD y no da autoridad (§18.2)", () => {
  const judge = buildGovernor({ autonomyLevel: "A2", authorizedPolicyVersions: TWO_VERSIONS });
  activateVersion(judge, "vX");
  const result = judge.considerPolicyVersionPromotion(versionPromotionInput("vY", { apg: null }));
  assert.equal(result.ok, false);
  assert.equal(result.code, "APG_NOT_SATISFIED");
  assert.equal(judge.currentState().activePolicyVersion, "vX");
  assert.equal(judge.receiptRegistry.transitionsOfType("HOLD").length, 1);
  assert.equal(result.transitionReceiptId, judge.receiptRegistry.transitionsOfType("HOLD")[0].receiptId);
  const buy = judge.authorizeRealAction({ action: "BUY", policyVersion: "vY", quantityMw: 3, dataState: dataStateFixture(), atUtc: T0 });
  assert.equal(buy.code, "POLICY_VERSION_WITHOUT_REAL_AUTHORITY");
});

test("IMP-24: la promoción de versión sin evidencia propia de la versión queda HOLD (§25.2.3 hito 3)", () => {
  const judge = buildGovernor({ autonomyLevel: "A2", authorizedPolicyVersions: TWO_VERSIONS });
  activateVersion(judge, "vX");
  const result = judge.considerPolicyVersionPromotion(versionPromotionInput("vY", { shadowEvidence: shadowReceipt({ policyVersion: "vX" }) }));
  assert.equal(result.ok, false);
  assert.equal(result.code, "EVIDENCE_VERSION_MISMATCH");
  assert.equal(judge.currentState().activePolicyVersion, "vX");
  // §18.4: el HOLD de promoción de versión nombra SU gate, no el de primera activación.
  const hold = judge.receiptRegistry.receiptOf(result.transitionReceiptId);
  assert.equal(hold.transitionType, "HOLD");
  assert.equal(hold.triggerGate, "G_AUTONOMY_PROMOTION");
  assert.equal(hold.previousState, "vY@SHADOW", "la versión destino permanece en Shadow");
});

test("IMP-24: la promoción de versión exige aprobación de governance externa a la policy (§18.2)", () => {
  const judge = buildGovernor({ autonomyLevel: "A2", authorizedPolicyVersions: TWO_VERSIONS });
  activateVersion(judge, "vX");
  const missing = judge.considerPolicyVersionPromotion(versionPromotionInput("vY", { governanceChangeApproval: undefined }));
  assert.equal(missing.ok, false);
  assert.equal(missing.code, "MISSING_APPROVAL");
  assert.equal(judge.currentState().activePolicyVersion, "vX");
});

test("IMP-24: sin primera activación no hay promoción de versión posterior (§18.2)", () => {
  const judge = buildGovernor({ autonomyLevel: "A2", authorizedPolicyVersions: TWO_VERSIONS });
  const result = judge.considerPolicyVersionPromotion(versionPromotionInput("vY"));
  assert.equal(result.ok, false);
  assert.equal(result.code, "NO_REAL_AUTHORITY_TO_SUCCEED");
  assert.equal(judge.currentState().activePolicyVersion, null);
});

test("IMP-24: no se promociona una versión que el envelope no autoriza (§17)", () => {
  const judge = buildGovernor({ autonomyLevel: "A2", authorizedPolicyVersions: TWO_VERSIONS });
  activateVersion(judge, "vX");
  const result = judge.considerPolicyVersionPromotion(versionPromotionInput("vZ"));
  assert.equal(result.ok, false);
  assert.equal(result.code, "POLICY_VERSION_NOT_AUTHORIZED");
  assert.equal(judge.currentState().activePolicyVersion, "vX");
});

test("IMP-24: el rollback sólo elige entre Policy Versions con autoridad real: con historial [vX, vY] válido restaura vX, no vY (IMP24-ROLLBACK-GRANTS-UNGOVERNED-VERSION)", () => {
  const judge = buildGovernor({ autonomyLevel: "A2", authorizedPolicyVersions: TWO_VERSIONS });
  activateVersion(judge, "vX");
  judge.applyHardGateMandate({ gateId: "G-OOD", evidenceRef: "FIXTURE-ROLLBACK-BIND", atUtc: T0 });
  const history = [
    { policyVersion: "vX", validity: [{ underEnvelopeVersion: "version:v1.0", currentValid: true }] },
    { policyVersion: "vY", validity: [{ underEnvelopeVersion: "version:v1.0", currentValid: true }] },
  ];
  const rollback = judge.executeHaltingRollback({ policyVersionHistory: history, atUtc: "2026-09-24T11:00:00Z" });
  assert.equal(rollback.ok, true, "INSPECCIÓN: " + JSON.stringify(rollback));
  assert.equal(rollback.rollback.target.policyVersion, "vX", "vY nunca obtuvo autoridad real por un acto gobernado: no es candidata de rollback (§18.3)");
  assert.equal(judge.currentState().activePolicyVersion, "vX");
  const receipt = judge.receiptRegistry.receiptOf(rollback.transitionReceiptId);
  assert.equal(receipt.transitionType, "ROLLBACK");
  assert.equal(receipt.previousState, "vX@A2:HALT");
  assert.equal(receipt.newState, "vX@A2");
  const buysWithVY = judge.authorizeRealAction({ action: "BUY", policyVersion: "vY", quantityMw: 3, dataState: dataStateFixture(), atUtc: T0 });
  assert.equal(buysWithVY.ok, false, "vY sigue sin autoridad real tras el rollback");
  assert.equal(buysWithVY.code, "POLICY_VERSION_WITHOUT_REAL_AUTHORITY");
});

test("IMP-24: el rollback no da autoridad real a una versión sin acto gobernado: historial [vY] queda bloqueado y vY no compra (IMP24-ROLLBACK-GRANTS-UNGOVERNED-VERSION)", () => {
  const judge = buildGovernor({ autonomyLevel: "A2", authorizedPolicyVersions: TWO_VERSIONS });
  activateVersion(judge, "vX");
  judge.applyHardGateMandate({ gateId: "G-OOD", evidenceRef: "FIXTURE-ROLLBACK-BIND", atUtc: T0 });
  const history = [
    { policyVersion: "vY", validity: [{ underEnvelopeVersion: "version:v1.0", currentValid: true }] },
  ];
  const rollback = judge.executeHaltingRollback({ policyVersionHistory: history, atUtc: "2026-09-24T11:00:00Z" });
  // vY nunca tuvo acto gobernado; sin ninguna versión con autoridad real válida
  // y sin fallback declarado, el rollback no le da autoridad: queda bloqueado
  // como pendiente operacional (§18.3), sin fabricar autoridad.
  assert.equal(rollback.ok, false, "INSPECCIÓN: " + JSON.stringify(rollback));
  assert.equal(rollback.code, "NO_ROLLBACK_TARGET");
  assert.equal(rollback.pendingOperationsFallback, true);
  assert.equal(judge.currentState().activePolicyVersion, "vX", "vY no hereda autoridad real; vX sigue siendo la versión con autoridad");
  assert.equal(judge.currentState().status, "HALTED", "sin rollback viable el cese permanece fail-closed");
  const buysWithVY = judge.authorizeRealAction({ action: "BUY", policyVersion: "vY", quantityMw: 3, dataState: dataStateFixture(), atUtc: T0 });
  assert.equal(buysWithVY.ok, false);
  assert.equal(buysWithVY.code, "GOVERNOR_STATE_HALTED");
});

test("IMP-24: si ninguna versión con autoridad real sigue válida, el rollback cae al safe non-action state y ninguna versión conserva autoridad (§18.3/§18.4)", () => {
  const judge = buildGovernor({
    autonomyLevel: "A2",
    authorizedPolicyVersions: TWO_VERSIONS,
    safeNonActionState: "WAIT",
    safeNonActionStateProvenance: { authority: "fixture: operaciones sintéticas de test" },
  });
  activateVersion(judge, "vX");
  judge.applyHardGateMandate({ gateId: "G-OOD", evidenceRef: "FIXTURE-ROLLBACK-SAFE", atUtc: T0 });
  const history = [
    { policyVersion: "vY", validity: [{ underEnvelopeVersion: "version:v1.0", currentValid: true }] },
  ];
  const rollback = judge.executeHaltingRollback({ policyVersionHistory: history, atUtc: "2026-09-24T11:00:00Z" });
  assert.equal(rollback.ok, true, "INSPECCIÓN: " + JSON.stringify(rollback));
  assert.equal(rollback.rollback.target.destination, "SAFE_NON_ACTION_STATE");
  assert.equal(judge.currentState().activePolicyVersion, null, "al caer al safe state ninguna versión conserva autoridad real");
  assert.equal(judge.currentState().status, "ACTIVE");
  const receipt = judge.receiptRegistry.receiptOf(rollback.transitionReceiptId);
  assert.equal(receipt.transitionType, "ROLLBACK");
  assert.equal(receipt.newState, "SAFE_NON_ACTION_STATE:A2");
  const buysWithVX = judge.authorizeRealAction({ action: "BUY", policyVersion: "vX", quantityMw: 3, dataState: dataStateFixture(), atUtc: T0 });
  assert.equal(buysWithVX.ok, false, "vX ya no ejerce autoridad tras el rollback al safe state");
  assert.equal(buysWithVX.code, "FIRST_ACTIVATION_REQUIRED_BEFORE_REAL_ACTION");
});
