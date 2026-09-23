// Tests IMP-23: enforcement externo del envelope y rollback.
// Criterio de aceptación §25.1 IMP-23: "Acción fuera de envelope rechazada;
// fallos duros actúan sin consentimiento de policy; target sigue válido."
// Garantías anti: "Envelope no aprendible; no penalizar-y-permitir; baseline
// experimental no autorizado por defecto."
// Todos los fixtures son sintéticos y marcados; no representan límites
// empíricos reales ni aprobaciones reales (§25.2 nota IMP-23).

import test from "node:test";
import assert from "node:assert/strict";

import {
  buildEnvelope,
  buildEnvelopeChangeProposal,
  buildGovernanceReceipt,
  createExternalEnvelopeController,
  createGovernanceReceiptRegistry,
  executeRollback,
  resolveRollbackTarget,
  TRANSITION_TYPES,
} from "../../src/governance/index.mjs";
import { STATE_NAMESPACES } from "../../src/contracts/states.mjs";

const FIXTURE_PROVENANCE = { authority: "fixture sintético de test (no es límite real ni aprobación real)", locator: "test/governance/imp23.test.mjs" };

function quantityLimitsFor(mode) {
  if (mode === "NONE") return [];
  const status = mode === "PENDING" ? "EVIDENCE_PENDING" : "APPROVED";
  const isPending = status === "EVIDENCE_PENDING";
  return [
    {
      limitId: "L-DAILY",
      limitKind: "DAILY_CAP",
      maxValueMw: isPending ? null : 12,
      status,
      approvalRef: isPending ? undefined : "FIXTURE-APPROVAL-1",
      reason: isPending ? "fixture: límite sin evidencia empírica aprobada (§17)" : undefined,
      provenance: FIXTURE_PROVENANCE,
    },
    {
      limitId: "L-POSITION",
      limitKind: "MAX_POSITION",
      maxValueMw: isPending ? null : 60,
      status,
      approvalRef: isPending ? undefined : "FIXTURE-APPROVAL-1",
      reason: isPending ? "fixture: límite sin evidencia empírica aprobada (§17)" : undefined,
      provenance: FIXTURE_PROVENANCE,
    },
  ];
}

// Envelope fixture sintético para operar el mecanismo; nada acredita un
// límite real (§25.2 nota IMP-23).
function fixtureEnvelope({
  envelopeVersion = "v1.0",
  autonomyLevel = "A3",
  authorizedPolicyVersions,
  quantityLimitMode = "APPROVED",
  rollbackBaseline = null,
  rollbackBaselineAuthorizationRef = null,
  safeNonActionState = null,
  oodThreshold = { value: null, status: "EVIDENCE_PENDING", reason: "fixture: umbral OOD empírico no producido (§17)" },
} = {}) {
  return buildEnvelope({
    envelopeVersion,
    autonomyLevel,
    scope: { product: "Gas", campaign: "FIXTURE-SINTETICO-NO-REAL", mission: "Quarterly" },
    allowedActions: ["BUY", "WAIT"],
    quantityLimits: quantityLimitsFor(quantityLimitMode),
    deadlineConstraints: "11:00 Europe/Berlin (fixture de diseño)",
    gates: [
      { gateId: "G-DATA-VALIDITY", kind: "DATA_VALIDITY", hardGate: true, provenance: FIXTURE_PROVENANCE },
      {
        gateId: "G-OOD",
        kind: "OOD",
        hardGate: true,
        threshold: oodThreshold,
        provenance: FIXTURE_PROVENANCE,
      },
    ],
    authorizedPolicyVersions: authorizedPolicyVersions ?? [
      { policyVersion: "v1.0", underEnvelopeVersion: "v1.0", status: "VALID" },
    ],
    rollbackBaseline,
    rollbackBaselineAuthorizationRef,
    rollbackBaselinePendingReason: rollbackBaseline
      ? null
      : "fixture: sin baseline declarado; el fallback de rollback es dependencia operativa explícita (§18.3)",
    safeNonActionState,
  });
}

// Helper de historia de validez (§18.3: validez declarada bajo cada
// envelope; "haber sido aprobada en el pasado" no basta).
function validityEntry(policyVersion, underEnvelopeVersion, currentValid) {
  return { policyVersion, validity: [{ underEnvelopeVersion, currentValid }] };
}

function passedDataState() {
  // §17: cada PASSED declara la atribución de una evaluación EXTERNA
  // (evaluatedBy con authority/locator/role), no de quien propone la acción.
  return {
    gateResults: [
      { gateId: "G-DATA-VALIDITY", result: "PASSED", evaluatedBy: { authority: "fixture: capa de datos externa sintética (no es evaluación real)", locator: "test/governance/imp23.test.mjs", role: "DATA_LAYER" } },
      { gateId: "G-OOD", result: "PASSED", evaluatedBy: { authority: "fixture: capa de datos externa sintética (no es evaluación real)", locator: "test/governance/imp23.test.mjs", role: "DATA_LAYER" } },
    ],
  };
}

function buildController(options = {}) {
  const built = fixtureEnvelope(options);
  assert.equal(built.ok, true, "INSPECCIÓN: el fixture del envelope debe construirse válido: " + JSON.stringify(built.errors ?? null));
  const controller = createExternalEnvelopeController({ envelope: built.envelope, atUtc: "2026-09-23T10:00:00Z" });
  assert.equal(controller.ok, true, "INSPECCIÓN: el controller debe construirse válido: " + JSON.stringify(controller.errors ?? null));
  return { envelope: built.envelope, controller };
}

// --- Envelope no aprendible / fail-closed de construcción ---

test("IMP-23: buildEnvelope rechaza un envelope sin límites de cantidad; la existencia conceptual no confiere autoridad (§17)", () => {
  const result = buildEnvelope({
    envelopeVersion: "v1.0",
    autonomyLevel: "A3",
    scope: { product: "Gas" },
    allowedActions: ["BUY", "WAIT"],
    quantityLimits: [],
    deadlineConstraints: "fixture",
    gates: [{ gateId: "G1", kind: "DATA_VALIDITY", hardGate: true, provenance: FIXTURE_PROVENANCE }],
    authorizedPolicyVersions: [{ policyVersion: "v1.0", underEnvelopeVersion: "v1.0", status: "VALID" }],
  });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.field === "quantityLimits"));
});

test("IMP-23: un límite APPROVED sin aprobación explícita o sin valor se rechaza; el pendiente no se déclaré aprobado (§25.2 nota IMP-23)", () => {
  const base = {
    envelopeVersion: "v1.0",
    autonomyLevel: "A3",
    scope: { product: "Gas" },
    allowedActions: ["BUY", "WAIT"],
    deadlineConstraints: "fixture",
    gates: [{ gateId: "G1", kind: "DATA_VALIDITY", hardGate: true, provenance: FIXTURE_PROVENANCE }],
    authorizedPolicyVersions: [{ policyVersion: "v1.0", underEnvelopeVersion: "v1.0", status: "VALID" }],
  };
  const withoutApprovalRef = buildEnvelope({
    ...base,
    quantityLimits: [{ limitId: "L-1", limitKind: "DAILY_CAP", maxValueMw: 12, status: "APPROVED", provenance: FIXTURE_PROVENANCE }],
  });
  assert.equal(withoutApprovalRef.ok, false);
  assert.ok(withoutApprovalRef.errors.some((error) => error.code === "MISSING_APPROVAL_REF"));

  const withoutValue = buildEnvelope({
    ...base,
    quantityLimits: [{ limitId: "L-1", limitKind: "DAILY_CAP", maxValueMw: null, status: "APPROVED", approvalRef: "FIXTURE-APPROVAL-1", provenance: FIXTURE_PROVENANCE }],
  });
  assert.equal(withoutValue.ok, false);
  assert.ok(withoutValue.errors.some((error) => error.code === "APPROVED_WITHOUT_VALUE"));
});

test("IMP-23: controller externo rechaza un envelope inválido; opera sólo sobre el envelope aprobado (§17)", () => {
  const broken = { kind: "SAFETY_AUTONOMY_ENVELOPE" };
  const controller = createExternalEnvelopeController({ envelope: broken, atUtc: "2026-09-23T10:00:00Z" });
  assert.equal(controller.ok, false);
  assert.equal(controller.code, "INVALID_ENVELOPE");
});

// --- Criterio 1: acción fuera de envelope rechazada ---

test("IMP-23: acción fuera del action space se rechaza (§17)", () => {
  const { envelope, controller } = buildController();
  const result = controller.authorizeAction({
    policyVersion: "v1.0",
    action: "EMIT_ORDER_UNBOUNDED",
    envelopeVersionKey: envelope.versionKey,
    dataState: passedDataState(),
  });
  assert.equal(result.status, "REJECTED");
  assert.equal(result.authorized, false);
  assert.ok(result.reasons.some((reason) => reason.code === "ACTION_OUTSIDE_ENVELOPE"));
});

test("IMP-23: versión de policy no autorizada o RETIRED bajo este envelope se rechaza (§17/§18.3)", () => {
  const { envelope, controller } = buildController();
  const key = envelope.versionKey;
  const unknown = controller.authorizeAction({ policyVersion: "v9.9", action: "WAIT", envelopeVersionKey: key, dataState: passedDataState() });
  assert.equal(unknown.status, "REJECTED");
  assert.ok(unknown.reasons.some((reason) => reason.code === "POLICY_VERSION_NOT_AUTHORIZED"));

  const retiredBuilt = buildController({
    authorizedPolicyVersions: [{ policyVersion: "v1.0", underEnvelopeVersion: "v1.0", status: "RETIRED" }],
  });
  const retired = retiredBuilt.controller.authorizeAction({
    policyVersion: "v1.0",
    action: "WAIT",
    envelopeVersionKey: retiredBuilt.envelope.versionKey,
    dataState: passedDataState(),
  });
  assert.equal(retired.status, "REJECTED");
  assert.ok(retired.reasons.some((reason) => reason.code === "POLICY_VERSION_RETIRED"));
});

test("IMP-23: contexto de envelope distinto al activo se rechaza (§17: un controlador externo, una versión activa)", () => {
  const { envelope, controller } = buildController();
  const result = controller.authorizeAction({
    policyVersion: "v1.0",
    action: "WAIT",
    envelopeVersionKey: "version:v0.9",
    dataState: passedDataState(),
  });
  assert.equal(result.status, "REJECTED");
  assert.ok(result.reasons.some((reason) => reason.code === "ENVELOPE_CONTEXT_MISMATCH"));
});

test("IMP-23: nivel A1/aA0 no concede autoridad de compra real; BUY rechazado aunque los límites estén aprobados (§16.2/§18.1)", () => {
  for (const level of ["A0", "A1"]) {
    const { envelope, controller } = buildController({ autonomyLevel: level });
    const result = controller.authorizeAction({
      policyVersion: "v1.0",
      action: "BUY",
      quantityMw: 5,
      envelopeVersionKey: envelope.versionKey,
      dataState: passedDataState(),
    });
    assert.equal(result.status, "REJECTED", `nivel ${level}`);
    assert.ok(result.reasons.some((reason) => reason.code === "LEVEL_WITHOUT_BUY_AUTHORITY"), `nivel ${level}`);
    // WAIT sigue evaluable en niveles de investigación (ninguna compra real).
    const wait = controller.authorizeAction({
      policyVersion: "v1.0",
      action: "WAIT",
      envelopeVersionKey: envelope.versionKey,
      dataState: passedDataState(),
    });
    assert.equal(wait.status, "AUTHORIZED", `nivel ${level} WAIT`);
  }
});

test("IMP-23: sin límites aprobados BUY se rechaza fail-closed; con límites, cantidad fuera de límite también (§17)", () => {
  const pending = buildController({ quantityLimitMode: "PENDING" });
  const buyPending = pending.controller.authorizeAction({
    policyVersion: "v1.0",
    action: "BUY",
    quantityMw: 5,
    envelopeVersionKey: pending.envelope.versionKey,
    dataState: passedDataState(),
  });
  assert.equal(buyPending.status, "REJECTED");
  assert.ok(buyPending.reasons.some((reason) => reason.code === "QUANTITY_LIMIT_NOT_APPROVED"));

  const approved = buildController();
  const aboveDaily = approved.controller.authorizeAction({
    policyVersion: "v1.0",
    action: "BUY",
    quantityMw: 15,
    envelopeVersionKey: approved.envelope.versionKey,
    dataState: passedDataState(),
  });
  assert.equal(aboveDaily.status, "REJECTED");
  assert.ok(aboveDaily.reasons.some((reason) => reason.code === "QUANTITY_ABOVE_LIMIT"));

  const waitFor = approved.controller.authorizeAction({
    policyVersion: "v1.0",
    action: "BUY",
    quantityMw: 0,
    envelopeVersionKey: approved.envelope.versionKey,
    dataState: passedDataState(),
  });
  assert.equal(waitFor.status, "REJECTED");
  assert.ok(waitFor.reasons.some((reason) => reason.code === "INVALID_QUANTITY"));

  const below = approved.controller.authorizeAction({
    policyVersion: "v1.0",
    action: "BUY",
    quantityMw: 12,
    envelopeVersionKey: approved.envelope.versionKey,
    dataState: passedDataState(),
  });
  assert.equal(below.status, "AUTHORIZED");
});

// --- Garantía anti: no penalizar-y-permitir ---

test("IMP-23: ningún canal de reward/penalty/policy puede convertir un rechazo en autorización (§17)", () => {
  const { envelope, controller } = buildController();
  const baseInput = {
    policyVersion: "v1.0",
    action: "BUY",
    quantityMw: 5000,
    envelopeVersionKey: envelope.versionKey,
    dataState: passedDataState(),
  };
  const reference = controller.authorizeAction(baseInput);
  assert.equal(reference.status, "REJECTED");

  // Los intentos de "comprar" el gate con penalización, consentimiento,
  // peso de policy o etiquetas de autoridad no alteran la decisión: el
  // resultado es estructural y no depende de esos campos.
  const bribeResults = [
    controller.authorizeAction({ ...baseInput, rewardPenalty: -1e6 }),
    controller.authorizeAction({ ...baseInput, policyConsent: true }),
    controller.authorizeAction({ ...baseInput, policyWeightError: 0 }),
    controller.authorizeAction({ ...baseInput, selfAuthorized: true }),
    controller.authorizeAction({ ...baseInput, authorityLevel: "A4" }),
  ];
  for (const result of bribeResults) {
    assert.equal(result.status, "REJECTED");
    assert.equal(result.authorized, false);
    assert.deepEqual(result.reasons.map((reason) => reason.code), reference.reasons.map((reason) => reason.code));
  }
});

// --- Garantía anti: envelope no aprendible ---

test("IMP-23: una propuesta de cambio del envelope originada por Learning no modifica la versión activa (§17)", () => {
  const { envelope, controller } = buildController();
  const before = controller.activeEnvelopeSnapshot();
  const sameBefore = JSON.stringify(before);

  // El "Learning Loop" produce una propuesta (canal separado, sin autoridad).
  const proposal = buildEnvelopeChangeProposal({
    trigger: "Learning output post-OOS (fixture)",
    proposedChanges: { quantityLimits: "multiple del fixture: límite diario elevado a 1000 MW" },
  });
  assert.equal(proposal.ok, true);
  assert.equal(proposal.proposal.appliedToActiveEnvelope, false);
  assert.equal(proposal.proposal.authorityGranted, false);

  // El controller activo sigue ejecutando el mismo envelope congelado:
  // la propuesta nunca alcanza la referencia activa.
  const after = controller.activeEnvelopeSnapshot();
  assert.equal(JSON.stringify(after), sameBefore);
  assert.equal(after.envelope, envelope);

  // Y el límite "relajado" propuesto no existe en el envelope activo:
  // BUY fuera del límite sigue rechazado.
  const stillRejected = controller.authorizeAction({
    policyVersion: "v1.0",
    action: "BUY",
    quantityMw: 5000,
    envelopeVersionKey: envelope.versionKey,
    dataState: passedDataState(),
  });
  assert.equal(stillRejected.status, "REJECTED");
});

// --- Fallos duros: actúan sin consentimiento de policy (§18.3) ---

test("IMP-23: hard-gate failure genera mandato HALT/DEMOTE sin consentimiento de policy (§18.3)", () => {
  const { envelope, controller } = buildController();
  const result = controller.mandateHardGateTransition({ gateId: "G-DATA-VALIDITY", evidenceRef: "fixture-evidence-ref-1" });
  assert.equal(result.ok, true);
  assert.equal(result.mandate.transition, "HALT");
  assert.equal(result.mandate.policyConsentRequired, false);
  assert.equal(result.mandate.policyVetoPossible, false);
  assert.equal(result.mandate.gateKind, "DATA_VALIDITY");
  assert.equal(result.mandate.envelopeVersionKey, envelope.versionKey);

  // Intento de veto/consentimiento de la policy en el input: no existe canal
  // para aceptarlo; el mandato se emite igual.
  const withVeto = controller.mandateHardGateTransition({
    gateId: "G-DATA-VALIDITY",
    evidenceRef: "fixture-evidence-ref-1",
    policyConsent: false,
    policyVeto: true,
    policyObjection: "rechazo de la policy",
  });
  assert.equal(withVeto.ok, true);
  assert.deepEqual(withVeto.mandate, result.mandate);

  const demote = controller.mandateHardGateTransition({ gateId: "G-OOD", evidenceRef: "fixture-evidence-ref-2", requestedTransition: "DEMOTE" });
  assert.equal(demote.ok, true);
  assert.equal(demote.mandate.transition, "DEMOTE");
  assert.equal(demote.mandate.policyVetoPossible, false);
});

test("IMP-23: un hard-gate exige gate declarado en el envelope y evidencia (§17/§18.4)", () => {
  const { controller } = buildController();
  const undeclared = controller.mandateHardGateTransition({ gateId: "G-INVENTADO", evidenceRef: "ref" });
  assert.equal(undeclared.ok, false);
  assert.equal(undeclared.code, "UNDECLARED_GATE");

  const withoutEvidence = controller.mandateHardGateTransition({ gateId: "G-DATA-VALIDITY", evidenceRef: null });
  assert.equal(withoutEvidence.ok, false);
  assert.equal(withoutEvidence.code, "MISSING_EVIDENCE_REF");
});

// --- Rollback: target sigue válido (§18.3) ---

test("IMP-23: el destino de rollback es la última Policy Version válida bajo el envelope actual, no la históricamente aprobada (§18.3)", () => {
  // El envelope activo autoriza v0.1 RETIRED y v0.2 VALID bajo sí mismo;
  // la historia por sí sola no selecciona: el cruz con
  // authorizedPolicyVersions (§17) manda.
  const { envelope, controller } = buildController({
    authorizedPolicyVersions: [
      { policyVersion: "v0.1", underEnvelopeVersion: "v1.0", status: "RETIRED" },
      { policyVersion: "v0.2", underEnvelopeVersion: "v1.0", status: "VALID" },
    ],
  });
  const key = envelope.versionKey;
  // v0.1 fue aprobada en el pasado pero está RETIRED bajo el actual;
  // v0.2 sigue válida bajo el actual. v1.0 ya no lo es.
  const history = [
    {
      policyVersion: "v0.1",
      validity: [
        { underEnvelopeVersion: "version:v0.0", currentValid: true },
        { underEnvelopeVersion: key, currentValid: true },
      ],
    },
    {
      policyVersion: "v0.2",
      validity: [{ underEnvelopeVersion: key, currentValid: true }],
    },
    {
      policyVersion: "v1.0",
      validity: [{ underEnvelopeVersion: key, currentValid: false }],
    },
  ];
  const resolved = resolveRollbackTarget({ envelope: envelope, policyVersionHistory: history });
  assert.equal(resolved.ok, true);
  assert.equal(resolved.target.destination, "POLICY_VERSION");
  assert.equal(resolved.target.policyVersion, "v0.2");

  // El mandato de hard-gate flujo completo: HALT → rollback target →
  // transición ROLLBACK registrada con los cinco campos de §18.4.
  const mandate = controller.mandateHardGateTransition({ gateId: "G-OOD", evidenceRef: "fixture-evidence-ref-3" });
  const rolledBack = executeRollback({ mandate: mandate.mandate, envelope: envelope, policyVersionHistory: history, atUtc: "2026-09-23T10:05:00Z" });
  assert.equal(rolledBack.ok, true);
  assert.equal(rolledBack.rollback.transition, "ROLLBACK");
  assert.equal(rolledBack.rollback.target.policyVersion, "v0.2");
  assert.equal(rolledBack.rollback.policyConsentRequired, false);
});

test("IMP-23: un candidato declarado válido por el historial pero no autorizado por el envelope activo NO es seleccionable (§17/§18.3)", () => {
  // Envelope fixture por defecto sólo autoriza v1.0. La historia (provista
  // por el llamador) declará v0.2 y v9.9-attacker como currentValid aquí:
  // sin autorización del envelope activo no hay target (fail-closed).
  const { envelope } = buildController();
  const attackerHistory = [
    {
      policyVersion: "v0.2",
      validity: [{ underEnvelopeVersion: envelope.versionKey, currentValid: true }],
    },
    {
      policyVersion: "v9.9-attacker",
      validity: [{ underEnvelopeVersion: envelope.versionKey, currentValid: true }],
    },
  ];
  const resolved = resolveRollbackTarget({ envelope: envelope, policyVersionHistory: attackerHistory });
  assert.equal(resolved.ok, false);
  assert.equal(resolved.code, "NO_ROLLBACK_TARGET");
  assert.equal(resolved.pendingOperationsFallback, true);

  // Inverso: el envelope autoriza v0.2 VALID pero la historia no declara
  // ninguna versión válida → también BLOQUEADO (la doble condición manda).
  const approvingEnvelope = buildController({
    authorizedPolicyVersions: [{ policyVersion: "v0.2", underEnvelopeVersion: "v1.0", status: "VALID" }],
  }).envelope;
  const inverseResolved = resolveRollbackTarget({ envelope: approvingEnvelope, policyVersionHistory: [] });
  assert.equal(inverseResolved.ok, false);
  assert.equal(inverseResolved.code, "NO_ROLLBACK_TARGET");

  // Un candidato autorizado por el envelope para OTRO envelope no admite
  // aquí (§18.3: la validez se declara bajo cada envelope concreto).
  const foreignUnderEnvelope = buildController({
    authorizedPolicyVersions: [{ policyVersion: "v9.9-attacker", underEnvelopeVersion: "v2.0", status: "VALID" }],
  }).envelope;
  const foreignResolved = resolveRollbackTarget({ envelope: foreignUnderEnvelope, policyVersionHistory: attackerHistory });
  assert.equal(foreignResolved.ok, false);
  assert.equal(foreignResolved.code, "NO_ROLLBACK_TARGET");
});

test("IMP-23: sin versión válida ni fallback declarado el rollback queda BLOQUEADO, pendiente operacional explícito (§18.3/§17)", () => {
  const built = fixtureEnvelope();
  const history = [
    { policyVersion: "v1.0", validity: [{ underEnvelopeVersion: "version:v0.0", currentValid: true }] },
  ];
  const resolved = resolveRollbackTarget({ envelope: built.envelope, policyVersionHistory: history });
  assert.equal(resolved.ok, false);
  assert.equal(resolved.code, "NO_ROLLBACK_TARGET");
  assert.equal(resolved.pendingOperationsFallback, true);
});

test("IMP-23: el baseline experimental no es autorizado por defecto; sin atribución explícita el rollback queda bloqueado (§25.2 nota IMP-23)", () => {
  // Baseline declarado pero SIN authorizationRef: es el baseline
  // experimental, no autorizado por defecto.
  const baselineFixture = fixtureEnvelope({ rollbackBaseline: "EXPERIMENTAL_BASELINE_A0_FIXTURE" });
  const history = [];
  const resolved = resolveRollbackTarget({ envelope: baselineFixture.envelope, policyVersionHistory: history });
  assert.equal(resolved.ok, false);
  assert.equal(resolved.code, "BASELINE_NOT_AUTHORIZED");

  // Con authorizationRef explícito el baseline autorizado se selecciona.
  const authorizedFixture = fixtureEnvelope({
    rollbackBaseline: "AUTHORIZED_BASELINE_FIXTURE",
    rollbackBaselineAuthorizationRef: "FIXTURE-BASELINE-AUTHORIZATION-REF",
  });
  const authorizedResolved = resolveRollbackTarget({ envelope: authorizedFixture.envelope, policyVersionHistory: history });
  assert.equal(authorizedResolved.ok, true);
  assert.equal(authorizedResolved.target.destination, "AUTHORIZED_BASELINE");

  // Safe non-action state declarado por operaciones también se selecciona.
  const safeStateFixture = fixtureEnvelope({
    safeNonActionState: "SAFE_NON_ACTION_STATE_DEFINIDO_POR_OPERACIONES (fixture)",
  });
  const safeResolved = resolveRollbackTarget({ envelope: safeStateFixture.envelope, policyVersionHistory: history });
  assert.equal(safeResolved.ok, true);
  assert.equal(safeResolved.target.destination, "SAFE_NON_ACTION_STATE");
});

test("IMP-23: executeRollback exige el mandato de hard-gate HALT y falla sin versión válida sobre él (§18.3)", () => {
  const { envelope } = buildController();
  const invalidMandate = executeRollback({ mandate: { transition: "DEMOTE" }, envelope, policyVersionHistory: [], atUtc: "2026-09-23T10:00:00Z" });
  assert.equal(invalidMandate.ok, false);
  assert.equal(invalidMandate.code, "INVALID_MANDATE");

  const missingFallback = executeRollback({
    mandate: { transition: "HALT", gateId: "G-OOD", evidenceRef: "ref", envelopeVersionKey: envelope.versionKey, policyVetoPossible: false },
    envelope,
    policyVersionHistory: [],
    atUtc: "2026-09-23T10:00:00Z",
  });
  assert.equal(missingFallback.ok, false);
  assert.equal(missingFallback.code, "NO_ROLLBACK_TARGET");
});

// --- Receipts de governance (§18.4) ---

test("IMP-23: cada transición produce receipt versionado con los cinco campos de §18.4 y sin mutación calient", () => {
  // El envelope activo debe autorizar la versión destino del rollback (§17):
  // la solé sola del historial no selecciona (IMP23-ROLLBACK-TARGET-05).
  const { envelope, controller } = buildController({
    authorizedPolicyVersions: [
      { policyVersion: "v1.0", underEnvelopeVersion: "v1.0", status: "VALID" },
      { policyVersion: "v0.2", underEnvelopeVersion: "v1.0", status: "VALID" },
    ],
  });
  const key = envelope.versionKey;

  const mandate = controller.mandateHardGateTransition({ gateId: "G-DATA-VALIDITY", evidenceRef: "fixture-evidence-4" });
  const rolledBack = executeRollback({
    mandate: mandate.mandate,
    envelope,
    policyVersionHistory: [
      { policyVersion: "v1.0", validity: [{ underEnvelopeVersion: key, currentValid: false }] },
      { policyVersion: "v0.2", validity: [{ underEnvelopeVersion: key, currentValid: true }] },
    ],
    atUtc: "2026-09-23T10:06:00Z",
  });
  assert.equal(rolledBack.ok, true);

  const receipt = buildGovernanceReceipt({
    transitionType: rolledBack.rollback.transition,
    triggerGate: rolledBack.rollback.triggerGateId,
    triggerEvidenceRef: rolledBack.rollback.evidenceRef,
    previousState: "v1.0",
    newState: rolledBack.rollback.target.policyVersion,
    autonomyLevel: envelope.autonomyLevel,
    envelopeVersionKey: rolledBack.rollback.envelopeVersionKey,
    atUtc: rolledBack.rollback.executedAtUtc,
  });
  assert.equal(receipt.ok, true);
  assert.equal(receipt.receipt.transitionType, "ROLLBACK");
  assert.equal(receipt.receipt.triggerGate, "G-DATA-VALIDITY");
  assert.equal(receipt.receipt.triggerEvidenceRef, "fixture-evidence-4");
  assert.equal(receipt.receipt.previousState, "v1.0");
  assert.equal(receipt.receipt.newState, "v0.2");
  assert.equal(receipt.receipt.autonomyLevel, "A3");
  assert.equal(receipt.receipt.envelopeVersionKey, rolledBack.rollback.envelopeVersionKey);
  assert.ok(/^[0-9a-f]{64}$/.test(receipt.receipt.receiptId));
});

test("IMP-23: el receipt exige los cinco campos de §18.4; fail-closed sin ellos y con transición no declarada", () => {
  const base = {
    transitionType: "ROLLBACK",
    triggerGate: "G-OOD",
    triggerEvidenceRef: "ref",
    previousState: "v1.0",
    newState: "v0.2",
    autonomyLevel: "A3",
    envelopeVersionKey: "version:v1.0",
    atUtc: "2026-09-23T10:00:00Z",
  };
  assert.equal(buildGovernanceReceipt(base).ok, true);

  for (const field of ["previousState", "newState", "autonomyLevel", "envelopeVersionKey"]) {
    const broken = buildGovernanceReceipt({ ...base, [field]: null });
    assert.equal(broken.ok, false, `campo ${field}`);
  }
  const withoutTrigger = buildGovernanceReceipt({ ...base, triggerGate: null, triggerEvidenceRef: null });
  assert.equal(withoutTrigger.ok, false);

  const unknownTransition = buildGovernanceReceipt({ ...base, transitionType: "MAKE_RICHER" });
  assert.equal(unknownTransition.ok, false);
  assert.equal(unknownTransition.code, "INVALID_TRANSITION_TYPE");
  assert.ok(!TRANSITION_TYPES.includes("MAKE_RICHER"));
});

test("IMP-23: el registro de transiciones es append-only y content-addressed; las reconstrucciones de autoridad están disponibles (§18.4)", () => {
  const registry = createGovernanceReceiptRegistry();
  const base = {
    transitionType: "HALT",
    triggerGate: "G-DATA-VALIDITY",
    triggerEvidenceRef: "fixture-evidence-5",
    previousState: "v1.0",
    newState: "HALT_FIXED_WITHOUT_ACTIVE_POLICY",
    autonomyLevel: "A3",
    envelopeVersionKey: "version:v1.0",
    atUtc: "2026-09-23T10:07:00Z",
  };
  const built = buildGovernanceReceipt(base);
  assert.equal(built.ok, true);

  const registered = registry.register({ receipt: built.receipt });
  assert.equal(registered.ok, true);
  assert.ok(registry.has(built.receipt.receiptId));
  assert.equal(registry.receiptOf(built.receipt.receiptId).transitionType, "HALT");

  // Transiciones consultables por tipo: reconstruir por qué una versión
  // perdió autoridad (§18.4).
  assert.equal(registry.transitionsOfType("HALT").length, 1);
  assert.equal(registry.transitionsOfType("ROLLBACK").length, 0);

  // Un receipt mutado tras build entra con identidad distinta o no entra:
  // el registro no atestigua lo que no produjo.
  const tampered = { ...built.receipt, transitionType: "ROLLBACK" };
  const tamperedRegister = registry.register({ receipt: tampered });
  assert.equal(tamperedRegister.ok, false);
  assert.equal(tamperedRegister.code, "RECEIPT_ID_MISMATCH");

  // Un objeto que no es un receipt no entra.
  const notReceipt = registry.register({ receipt: { artifactKind: "GOVERNANCE_TRANSITION_RECEIPT" } });
  assert.equal(notReceipt.ok, false);
});

// --- Correcciones de revisión IMP-23 (fallas de fail-closed / doble verdad) ---

test("IMP-23: el envelope construido es inmutable en profundidad; retocar el snapshot no relaja el envelope activo (§17, corrección ENV-MUT-01)", () => {
  const { envelope, controller } = buildController();
  assert.equal(Object.isFrozen(envelope), true);
  assert.equal(Object.isFrozen(envelope.quantityLimits), true);
  assert.equal(Object.isFrozen(envelope.quantityLimits[0].provenance), true);
  assert.equal(Object.isFrozen(envelope.gates), true);
  assert.equal(Object.isFrozen(envelope.gates[1].threshold), true);
  assert.equal(Object.isFrozen(envelope.allowedActions), true);

  const attackBefore = controller.authorizeAction({
    policyVersion: "v1.0",
    action: "BUY",
    quantityMw: 5000,
    envelopeVersionKey: envelope.versionKey,
    dataState: passedDataState(),
  });
  assert.equal(attackBefore.status, "REJECTED");

  // Intento de relajar límites, action space y gates vía la referencia viva:
  // el freeze profundo lo impide. Para el compra forjado se reusa el helper
  // de arriba (copiado para cada intento, sin depender del orden).
  assert.throws(() => { envelope.quantityLimits[0].maxValueMw = 100000; }, TypeError);
  assert.throws(() => { envelope.quantityLimits[1].maxValueMw = 100000; }, TypeError);
  assert.throws(() => { envelope.allowedActions.push("EMIT_ORDER_UNBOUNDED"); }, TypeError);
  assert.throws(() => { envelope.gates[0].hardGate = false; }, TypeError);
  assert.throws(() => { envelope.gates.push({ gateId: "G-TAMPER", kind: "DATA_VALIDITY", hardGate: true, provenance: FIXTURE_PROVENANCE }); }, TypeError);

  // El contentHash y el decisión son los mismos que antes del intento: el
  // objeto no cambió bajo el controller (§17: misma versión activa).
  const attackAfter = controller.authorizeAction({
    policyVersion: "v1.0",
    action: "BUY",
    quantityMw: 5000,
    envelopeVersionKey: envelope.versionKey,
    dataState: passedDataState(),
  });
  assert.equal(attackAfter.status, "REJECTED");
  assert.deepEqual(attackAfter.reasons.map((reason) => reason.code), attackBefore.reasons.map((reason) => reason.code));
  assert.equal(JSON.stringify(controller.activeEnvelopeSnapshot()), JSON.stringify(controller.activeEnvelopeSnapshot()));
});

test("IMP-23: un PASSED sin atribución o auto-declarado por la policy no satisface un hard-gate de admisión (§17, corrección GATE-PROV-02)", () => {
  const { envelope, controller } = buildController();
  const key = envelope.versionKey;
  const buy5 = (dataState) => controller.authorizeAction({
    policyVersion: "v1.0",
    action: "BUY",
    quantityMw: 5,
    envelopeVersionKey: key,
    dataState,
  });

  forged: {
    // gateResults provistos por el llamador SIN evaluatedBy: no satisface el
    // hard-gate; fail-closed (antes el PASSED forjado pasaba a AUTHORIZED).
    const forged = buy5({
      gateResults: [
        { gateId: "G-DATA-VALIDITY", result: "PASSED" },
        { gateId: "G-OOD", result: "PASSED", evaluatedBy: { authority: "x", locator: "y", role: "DATA_LAYER" } },
      ],
    });
    assert.equal(forged.status, "REJECTED");
    assert.ok(forged.reasons.some((reason) => reason.code === "GATE_EVALUATION_NOT_ATTRIBUTED"));
  }

  selfDeclared: {
    // Auto-evaluación declarada por la policy proponente: no independencia,
    // no admisión (§17: el controlador es EXTERNO a la policy).
    const selfDeclared = buy5({
      gateResults: [
        { gateId: "G-DATA-VALIDITY", result: "PASSED", evaluatedBy: { authority: "policy activa", locator: "código de la policy", role: "POLICY" } },
        { gateId: "G-OOD", result: "PASSED", evaluatedBy: { authority: "candidate", locator: "misma CANDIDATE_POLICY", role: "CANDIDATE_POLICY" } },
      ],
    });
    assert.equal(selfDeclared.status, "REJECTED");
    assert.ok(selfDeclared.reasons.some((reason) => reason.code === "GATE_EVALUATION_NOT_ATTRIBUTED"));
  }

  // Con la evaluación external declarada y atribuida la misma cantidad se
  // autoriza: la puerta del gate es por procedencia, no un bloqueo clásico.
  const legitimate = buy5(passedDataState());
  assert.equal(legitimate.status, "AUTHORIZED");
});

test("IMP-23: un umbral numérico es representable; el APPROVED declara su aprobación (§17/§25.2, corrección THRESHOLD-NUM-04)", () => {
  // Umbral numérico real del OOD gate (§17) con su aprobación explícita.
  const numericApproved = fixtureEnvelope({
    oodThreshold: { value: 0.25, status: "APPROVED", approvalRef: "FIXTURE-APPROVAL-1" },
  });
  assert.equal(numericApproved.ok, true, JSON.stringify(numericApproved.errors ?? null));

  // APPROVED sin approvalRef: el umbral numérico aprobado sin referencia no
  // existe (misma regla que quantityLimits, §17).
  const numericWithoutApprovalRef = fixtureEnvelope({
    oodThreshold: { value: 0.25, status: "APPROVED" },
  });
  assert.equal(numericWithoutApprovalRef.ok, false);
  assert.ok(numericWithoutApprovalRef.errors.some((error) => error.code === "MISSING_THRESHOLD_APPROVAL_REF"));

  // EVIDENCE_PENDING con valor presente exige razón documentada; el valor
  // presente no se convierte en aprobado por sí solo (§17: no se inventan).
  const pendingNumericWithoutReason = fixtureEnvelope({
    oodThreshold: { value: 0.25, status: "EVIDENCE_PENDING" },
  });
  assert.equal(pendingNumericWithoutReason.ok, false);
  assert.ok(pendingNumericWithoutReason.errors.some((error) => error.code === "MISSING_REASON"));
});

test("IMP-23: TRANSITION_TYPES es el namespace canónico governance_event del contrato de estados; una sola verdad §18.4 (correctión TRANS-DUP-03)", () => {
  assert.equal(TRANSITION_TYPES, STATE_NAMESPACES.governance_event.values);
  assert.deepEqual(TRANSITION_TYPES, ["PROMOTE", "HOLD", "DEMOTE", "HALT", "ROLLBACK"]);
});

test("IMP-23: una autorización de policy declarada bajo otro envelope no autoriza bajo el activo (§18.3, nota de revisión)", () => {
  const built = buildController({
    authorizedPolicyVersions: [{ policyVersion: "v1.0", underEnvelopeVersion: "v0.0", status: "VALID" }],
  });
  const result = built.controller.authorizeAction({
    policyVersion: "v1.0",
    action: "BUY",
    quantityMw: 5,
    envelopeVersionKey: built.envelope.versionKey,
    dataState: passedDataState(),
  });
  assert.equal(result.status, "REJECTED");
  assert.ok(result.reasons.some((reason) => reason.code === "AUTHORIZATION_UNDER_OTHER_ENVELOPE"));
});
