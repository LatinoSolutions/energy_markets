import { test } from "node:test";
import assert from "node:assert/strict";

import { ROLE_CLASS } from "../../src/role-evaluation/roles.mjs";
import { EVALUATION_STATE, createRoleEvaluationRegistry } from "../../src/role-evaluation/registry.mjs";
import {
  SYNTHETIC_READINESS,
  SYNTHETIC_STRATEGY_GATE,
  driveToOutcome,
  driveToReady,
  evidence,
  makeEvaluation,
  makeExecutionGovernanceEvaluation,
  makeLearningEvaluation,
  makeStrategyEvidenceEvaluation,
} from "./fixtures.mjs";

test("registra el mismo componente en varios roles como procesos independientes", () => {
  const registry = createRoleEvaluationRegistry();
  const learning = makeEvaluation({ componentId: "SYN-MULTI", roleClass: ROLE_CLASS.REPRESENTATION_LEARNING });
  const engineering = makeEvaluation({ componentId: "SYN-MULTI", roleClass: ROLE_CLASS.ENGINEERING_ORCHESTRATION });

  assert.equal(registry.registerComponent(learning).ok, true);
  assert.equal(registry.registerComponent(engineering).ok, true);
  assert.equal(registry.list("SYN-MULTI").length, 2);
});

test("rechaza evaluación incompleta y colisión de identidad componente/rol", () => {
  const registry = createRoleEvaluationRegistry();
  const incomplete = makeLearningEvaluation();
  delete incomplete.currentComparator;
  const incompleteOutcome = registry.registerComponent(incomplete);
  assert.equal(incompleteOutcome.ok, false);
  assert.equal(incompleteOutcome.code, "CONTRACT_INCOMPLETE");

  assert.equal(registry.registerComponent(makeLearningEvaluation()).ok, true);
  const collision = registry.registerComponent(makeLearningEvaluation());
  assert.equal(collision.ok, false);
  assert.equal(collision.code, "IDENTITY_COLLISION");
});

test("JEV no recibe clasificación ni rol por defecto", () => {
  const registry = createRoleEvaluationRegistry();
  const noRole = makeEvaluation({ componentId: "JEV" });
  delete noRole.roleClass;
  const outcome = registry.registerComponent(noRole);
  assert.equal(outcome.ok, false);
  assert.equal(outcome.code, "CONTRACT_INCOMPLETE");
  assert.equal(registry.list("JEV").length, 0);
});

test("EVALUATION-READY exige prerequisites y evidencia, no campos completos", () => {
  const registry = createRoleEvaluationRegistry();
  const evaluation = makeLearningEvaluation();
  registry.registerComponent(evaluation);

  const nominalOnly = registry.markEvaluationReady(evaluation.componentId, evaluation.roleClass, {});
  assert.equal(nominalOnly.ok, false);
  assert.equal(nominalOnly.code, "NOT_EVALUATION_READY");
  assert.equal(registry.get(evaluation.componentId, evaluation.roleClass).state, EVALUATION_STATE.REGISTERED);

  const missingEvidence = registry.markEvaluationReady(evaluation.componentId, evaluation.roleClass, {
    prerequisitesSatisfied: ["SYN-prereq"],
  });
  assert.equal(missingEvidence.ok, false);

  const ready = registry.markEvaluationReady(evaluation.componentId, evaluation.roleClass, SYNTHETIC_READINESS);
  assert.equal(ready.ok, true);
  assert.equal(ready.record.state, EVALUATION_STATE.EVALUATION_READY);
});

test("Strategy/Evidence no alcanza readiness sin el gate aceptado de IMP-27/§8.7", () => {
  const registry = createRoleEvaluationRegistry();
  const evaluation = makeStrategyEvidenceEvaluation();
  registry.registerComponent(evaluation);

  const noGate = registry.markEvaluationReady(evaluation.componentId, evaluation.roleClass, SYNTHETIC_READINESS);
  assert.equal(noGate.ok, false);
  assert.equal(noGate.code, "MISSING_STRATEGY_ADMISSION_GATE");
  assert.equal(registry.get(evaluation.componentId, evaluation.roleClass).state, EVALUATION_STATE.REGISTERED);

  const wrongSection = registry.markEvaluationReady(evaluation.componentId, evaluation.roleClass, {
    ...SYNTHETIC_READINESS,
    strategyAdmissionGate: { ...SYNTHETIC_STRATEGY_GATE, section: "§11.6" },
  });
  assert.equal(wrongSection.ok, false);
  assert.equal(wrongSection.code, "INVALID_STRATEGY_ADMISSION_GATE");

  const withGate = registry.markEvaluationReady(evaluation.componentId, evaluation.roleClass, {
    ...SYNTHETIC_READINESS,
    strategyAdmissionGate: SYNTHETIC_STRATEGY_GATE,
  });
  assert.equal(withGate.ok, true);
});

test("un outcome exige readiness y evidencia real", () => {
  const registry = createRoleEvaluationRegistry();
  const evaluation = makeLearningEvaluation();
  registry.registerComponent(evaluation);

  const tooEarly = registry.recordOutcome(evaluation.componentId, evaluation.roleClass, "ADMIT", {
    evidenceRefs: [evidence("SYN-EV")],
  });
  assert.equal(tooEarly.ok, false);
  assert.equal(tooEarly.code, "NOT_EVALUATION_READY");

  registry.markEvaluationReady(evaluation.componentId, evaluation.roleClass, SYNTHETIC_READINESS);
  const noEvidence = registry.recordOutcome(evaluation.componentId, evaluation.roleClass, "ADMIT", {});
  assert.equal(noEvidence.ok, false);
  assert.equal(noEvidence.code, "MISSING_EVIDENCE");

  const unknownOutcome = registry.recordOutcome(evaluation.componentId, evaluation.roleClass, "MAYBE", {
    evidenceRefs: [evidence("SYN-EV")],
  });
  assert.equal(unknownOutcome.ok, false);
  assert.equal(unknownOutcome.code, "UNKNOWN_STATE_VALUE");
});

test("los outcomes de rol son independientes entre roles del mismo componente", () => {
  const registry = createRoleEvaluationRegistry();
  const learning = makeEvaluation({ componentId: "SYN-MULTI", roleClass: ROLE_CLASS.REPRESENTATION_LEARNING });
  const engineering = makeEvaluation({ componentId: "SYN-MULTI", roleClass: ROLE_CLASS.ENGINEERING_ORCHESTRATION });
  const admitted = driveToOutcome(registry, learning, "ADMIT");

  assert.equal(admitted.ok, true);
  assert.equal(admitted.record.outcome.value, "ADMIT");
  assert.deepEqual(admitted.authority.grants, ["ROLE_SCOPED_ADMISSION"]);

  driveToReady(registry, engineering);
  assert.equal(registry.get("SYN-MULTI", ROLE_CLASS.ENGINEERING_ORCHESTRATION).outcome, null);

  const integration = registry.evaluateIntegration("SYN-MULTI");
  assert.equal(integration.ok, true);
  assert.equal(integration.integrated, false);
  assert.equal(integration.eligible, true);
  assert.deepEqual(integration.admittedRoles, [ROLE_CLASS.REPRESENTATION_LEARNING]);
});

test("un outcome por versión es inmutable y no se reescribe", () => {
  const registry = createRoleEvaluationRegistry();
  const evaluation = makeLearningEvaluation();
  const first = driveToOutcome(registry, evaluation, "HOLD");
  assert.equal(first.ok, true);

  const rewrite = registry.recordOutcome(evaluation.componentId, evaluation.roleClass, "ADMIT", {
    evidenceRefs: [evidence("SYN-EV-2")],
  });
  assert.equal(rewrite.ok, false);
  assert.equal(rewrite.code, "OUTCOME_ALREADY_RECORDED");
  assert.equal(registry.get(evaluation.componentId, evaluation.roleClass).outcome.value, "HOLD");
  assert.equal(registry.get(evaluation.componentId, evaluation.roleClass).authorityGranted.length, 0);
});

test("una nueva versión preserva HOLD/REJECT previos, evidencia y retirada/rollback", () => {
  const registry = createRoleEvaluationRegistry();
  const evaluation = makeLearningEvaluation();
  driveToOutcome(registry, evaluation, "REJECT");
  const evidenceBefore = registry.get(evaluation.componentId, evaluation.roleClass).evidenceRefs.length;

  const newVersion = registry.createNewEvaluationVersion(evaluation.componentId, evaluation.roleClass, {
    materialChange: true,
    changeSummary: "Synthetic material change after REJECT.",
    newVersion: "0.2.0",
    evidenceRefs: [evidence("SYN-NEW-VERSION")],
  });
  assert.equal(newVersion.ok, true);

  const record = newVersion.record;
  assert.equal(record.componentVersion, "0.2.0");
  assert.equal(record.priorVersionId, "0.1.0");
  assert.equal(record.state, EVALUATION_STATE.REGISTERED);
  assert.equal(record.outcome, null);
  assert.equal(record.priorFindings.length, 1);
  assert.equal(record.priorFindings[0].value, "REJECT");
  assert.equal(record.evidenceRefs.length, evidenceBefore + 1);
  assert.deepEqual(record.authorityGranted, []);
  assert.deepEqual(registry.getRemovalRollback(evaluation.componentId, evaluation.roleClass).removalRollbackPath, {
    path: "Synthetic removal path back to the existing mechanism.",
  });
  assert.equal(registry.history(evaluation.componentId, evaluation.roleClass).length, 2);
});

test("no se crea versión sin cambio material ni repitiendo la misma versión", () => {
  const registry = createRoleEvaluationRegistry();
  const evaluation = makeLearningEvaluation();
  registry.registerComponent(evaluation);

  const noMaterial = registry.createNewEvaluationVersion(evaluation.componentId, evaluation.roleClass, {
    changeSummary: "Synthetic.",
    newVersion: "0.2.0",
  });
  assert.equal(noMaterial.ok, false);
  assert.equal(noMaterial.code, "MATERIAL_CHANGE_REQUIRED");

  const sameVersion = registry.createNewEvaluationVersion(evaluation.componentId, evaluation.roleClass, {
    materialChange: true,
    changeSummary: "Synthetic.",
    newVersion: "0.1.0",
  });
  assert.equal(sameVersion.ok, false);
  assert.equal(sameVersion.code, "VERSION_NOT_CHANGED");
});

test("sin rol que admita, el componente queda fuera (no integración)", () => {
  const registry = createRoleEvaluationRegistry();
  const learning = makeEvaluation({ componentId: "SYN-NOVALUE", roleClass: ROLE_CLASS.REPRESENTATION_LEARNING });
  const engineering = makeEvaluation({ componentId: "SYN-NOVALUE", roleClass: ROLE_CLASS.ENGINEERING_ORCHESTRATION });
  driveToOutcome(registry, learning, "HOLD");
  driveToOutcome(registry, engineering, "REJECT");

  const integration = registry.evaluateIntegration("SYN-NOVALUE");
  assert.equal(integration.integrated, false);
  assert.equal(integration.eligible, false);
  assert.equal(integration.reason, "NO_QUALIFYING_ROLE");
});

test("un componente desconocido se rechaza en integración y operaciones", () => {
  const registry = createRoleEvaluationRegistry();
  assert.equal(registry.markEvaluationReady("SYN-NONE", ROLE_CLASS.REPRESENTATION_LEARNING).code, "UNKNOWN_EVALUATION");
  assert.equal(registry.recordOutcome("SYN-NONE", ROLE_CLASS.REPRESENTATION_LEARNING, "ADMIT", {}).code, "UNKNOWN_EVALUATION");
  assert.equal(registry.createNewEvaluationVersion("SYN-NONE", ROLE_CLASS.REPRESENTATION_LEARNING, {}).code, "UNKNOWN_EVALUATION");
  assert.equal(registry.evaluateIntegration("SYN-NONE").code, "UNKNOWN_COMPONENT");
});

test("engineering no puede presentar su valor como procurement edge", () => {
  const registry = createRoleEvaluationRegistry();
  const evaluation = makeLearningEvaluation({ componentId: "SYN-ENG-EDGE", roleClass: ROLE_CLASS.ENGINEERING_ORCHESTRATION });
  registry.registerComponent(evaluation);

  const edgeClaim = registry.validateValueClaim(evaluation.componentId, evaluation.roleClass, "PROCUREMENT_EDGE");
  assert.equal(edgeClaim.ok, false);
  assert.equal(edgeClaim.code, "PROCUREMENT_EDGE_NOT_ALLOWED");

  const operationalClaim = registry.validateValueClaim(evaluation.componentId, evaluation.roleClass, "OPERATIONAL");
  assert.equal(operationalClaim.ok, true);
});

test("ninguna acción real obtiene autoridad; execution/governance exige validación separada", () => {
  const registry = createRoleEvaluationRegistry();
  const engineering = makeEngineeringReady(registry);
  const governance = makeExecutionGovernanceEvaluation();
  driveToOutcome(registry, governance, "ADMIT");

  const engineeringAction = registry.validateRealActionPrerequisite(engineering.componentId, engineering.roleClass, {});
  assert.equal(engineeringAction.ok, false);
  assert.equal(engineeringAction.code, "NO_PRODUCTIVE_AUTHORITY");

  const governanceWithoutValidation = registry.validateRealActionPrerequisite(
    governance.componentId,
    governance.roleClass,
    {},
  );
  assert.equal(governanceWithoutValidation.ok, false);
  assert.equal(governanceWithoutValidation.code, "MISSING_AUTHORITY_VALIDATION");

  const governanceWithValidation = registry.validateRealActionPrerequisite(governance.componentId, governance.roleClass, {
    authorityValidation: { accepted: true, ref: "SYN-SEPARATE-AUTHORITY" },
  });
  assert.equal(governanceWithValidation.ok, false);
  assert.equal(governanceWithValidation.code, "NO_PRODUCTIVE_AUTHORITY");

  assert.equal(registry.hasProductiveAuthority, false);
});

test("la evidencia es append-only y el registro no congela el objeto del llamante", () => {
  const registry = createRoleEvaluationRegistry();
  const evaluation = makeLearningEvaluation();
  assert.equal(registry.registerComponent(evaluation).ok, true);
  assert.equal(Object.isFrozen(evaluation), false);
  evaluation.currentComparator = "Synthetic mutation after register.";
  assert.notEqual(registry.get(evaluation.componentId, evaluation.roleClass).contract.currentComparator, evaluation.currentComparator);

  const first = registry.attachEvidence(evaluation.componentId, evaluation.roleClass, evidence("SYN-EV-A"));
  assert.equal(first.ok, true);
  const second = registry.attachEvidence(evaluation.componentId, evaluation.roleClass, evidence("SYN-EV-B"));
  assert.equal(second.ok, true);
  assert.equal(second.record.evidenceRefs.length, 2);
  assert.equal(Object.isFrozen(second.record.evidenceRefs), true);
  assert.equal(Object.isFrozen(second.record), true);

  const malformed = registry.attachEvidence(evaluation.componentId, evaluation.roleClass, { kind: "evaluation" });
  assert.equal(malformed.ok, false);
  assert.equal(malformed.code, "INVALID_EVIDENCE");
});

function makeEngineeringReady(registry) {
  const engineering = makeEvaluation({ componentId: "SYN-ENG-READY", roleClass: ROLE_CLASS.ENGINEERING_ORCHESTRATION });
  driveToReady(registry, engineering);
  return engineering;
}

test("A: la versión del contrato debe coincidir con newVersion", () => {
  const registry = createRoleEvaluationRegistry();
  const evaluation = makeLearningEvaluation();
  registry.registerComponent(evaluation);

  const mismatchedContract = { ...makeLearningEvaluation(), componentVersion: "0.1.0" };
  const outcome = registry.createNewEvaluationVersion(evaluation.componentId, evaluation.roleClass, {
    materialChange: true,
    changeSummary: "Synthetic version-confusion attempt.",
    newVersion: "0.2.0",
    contract: mismatchedContract,
  });
  assert.equal(outcome.ok, false);
  assert.equal(outcome.code, "VERSION_IDENTITY_MISMATCH");
  assert.equal(registry.get(evaluation.componentId, evaluation.roleClass).componentVersion, "0.1.0");
});

test("A2: un cambio de protocolo debe declararse explícitamente", () => {
  const registry = createRoleEvaluationRegistry();
  const evaluation = makeLearningEvaluation();
  registry.registerComponent(evaluation);

  const changedProtocol = { ...makeLearningEvaluation(), componentVersion: "0.2.0", protocolId: "SYN-PROTOCOL-2" };
  const undeclared = registry.createNewEvaluationVersion(evaluation.componentId, evaluation.roleClass, {
    materialChange: true,
    changeSummary: "Synthetic silent protocol change.",
    newVersion: "0.2.0",
    contract: changedProtocol,
  });
  assert.equal(undeclared.ok, false);
  assert.equal(undeclared.code, "PROTOCOL_CHANGE_NOT_DECLARED");

  const declared = registry.createNewEvaluationVersion(evaluation.componentId, evaluation.roleClass, {
    materialChange: true,
    changeSummary: "Synthetic declared protocol change.",
    newVersion: "0.2.0",
    contract: changedProtocol,
    protocolChange: true,
    protocolChangeSummary: "Synthetic protocol identity change, declared.",
  });
  assert.equal(declared.ok, true);
  assert.equal(declared.record.protocolId, "SYN-PROTOCOL-2");
  assert.equal(declared.record.materialChange.protocolChanged, true);
});

test("B: history() refleja el outcome de cada versión, no una instantánea previa", () => {
  const registry = createRoleEvaluationRegistry();
  const evaluation = makeLearningEvaluation();
  driveToOutcome(registry, evaluation, "HOLD");
  registry.createNewEvaluationVersion(evaluation.componentId, evaluation.roleClass, {
    materialChange: true,
    changeSummary: "Synthetic change after HOLD.",
    newVersion: "0.2.0",
  });

  const versions = registry.history(evaluation.componentId, evaluation.roleClass);
  assert.equal(versions.length, 2);
  assert.equal(versions[0].componentVersion, "0.1.0");
  assert.equal(versions[0].state, EVALUATION_STATE.OUTCOME_RECORDED);
  assert.equal(versions[0].outcome.value, "HOLD");
  assert.equal(versions[1].state, EVALUATION_STATE.REGISTERED);
  assert.equal(versions[1].outcome, null);
});

test("C: la evidencia ingerida no congela objetos del llamante", () => {
  const registry = createRoleEvaluationRegistry();
  const evaluation = makeLearningEvaluation();
  registry.registerComponent(evaluation);

  const callerEvidence = evidence("SYN-CALLER-EV");
  registry.attachEvidence(evaluation.componentId, evaluation.roleClass, callerEvidence);
  assert.equal(Object.isFrozen(callerEvidence), false);

  registry.markEvaluationReady(evaluation.componentId, evaluation.roleClass, SYNTHETIC_READINESS);
  const outcomeEvidence = evidence("SYN-CALLER-OUTCOME");
  registry.recordOutcome(evaluation.componentId, evaluation.roleClass, "ADMIT", { evidenceRefs: [outcomeEvidence] });
  assert.equal(Object.isFrozen(outcomeEvidence), false);

  const stored = registry.get(evaluation.componentId, evaluation.roleClass).outcome.evidenceRefs[0];
  assert.equal(Object.isFrozen(stored), true);
  assert.notEqual(stored, outcomeEvidence);
});

test("R2-B: versiones content-hash distintas no colapsan priorFindings", () => {
  const hashA = "a".repeat(64);
  const hashB = "b".repeat(64);
  const hashC = "c".repeat(64);
  const registry = createRoleEvaluationRegistry();
  const evaluation = makeLearningEvaluation({ componentVersion: { contentHash: hashA } });
  registry.registerComponent(evaluation);

  registry.markEvaluationReady(evaluation.componentId, evaluation.roleClass, SYNTHETIC_READINESS);
  registry.recordOutcome(evaluation.componentId, evaluation.roleClass, "HOLD", { evidenceRefs: [evidence("SYN-CH-1")] });

  const second = registry.createNewEvaluationVersion(evaluation.componentId, evaluation.roleClass, {
    materialChange: true,
    changeSummary: "Synthetic content-hash A -> B.",
    newVersion: { contentHash: hashB },
  });
  assert.equal(second.ok, true);
  registry.markEvaluationReady(evaluation.componentId, evaluation.roleClass, SYNTHETIC_READINESS);
  registry.recordOutcome(evaluation.componentId, evaluation.roleClass, "HOLD", { evidenceRefs: [evidence("SYN-CH-2")] });

  const third = registry.createNewEvaluationVersion(evaluation.componentId, evaluation.roleClass, {
    materialChange: true,
    changeSummary: "Synthetic content-hash B -> C.",
    newVersion: { contentHash: hashC },
  });
  assert.equal(third.ok, true);
  assert.equal(third.record.priorFindings.length, 2);
});

test("CMD-1: una identidad evaluada no se rehabilita (semver y content-hash)", () => {
  const cases = [
    { v1: "0.1.0", v2: "0.2.0" },
    { v1: { contentHash: "1".repeat(64) }, v2: { contentHash: "2".repeat(64) } },
  ];
  for (const { v1, v2 } of cases) {
    const registry = createRoleEvaluationRegistry();
    const first = makeLearningEvaluation({ componentVersion: v1, protocolId: "SYN-CMD-P", protocolVersion: "1.0.0" });
    registry.registerComponent(first);
    registry.markEvaluationReady(first.componentId, first.roleClass, SYNTHETIC_READINESS);
    registry.recordOutcome(first.componentId, first.roleClass, "REJECT", { evidenceRefs: [evidence("SYN-CMD-1")] });

    const secondContract = { ...makeLearningEvaluation(), componentVersion: v2, protocolId: "SYN-CMD-P", protocolVersion: "1.0.0" };
    const second = registry.createNewEvaluationVersion(first.componentId, first.roleClass, {
      materialChange: true,
      changeSummary: "Synthetic v1 -> v2.",
      newVersion: v2,
      contract: secondContract,
    });
    assert.equal(second.ok, true);
    registry.markEvaluationReady(first.componentId, first.roleClass, SYNTHETIC_READINESS);
    registry.recordOutcome(first.componentId, first.roleClass, "HOLD", { evidenceRefs: [evidence("SYN-CMD-2")] });

    const reuseContract = { ...makeLearningEvaluation(), componentVersion: v1, protocolId: "SYN-CMD-P", protocolVersion: "1.0.0" };
    const reuse = registry.createNewEvaluationVersion(first.componentId, first.roleClass, {
      materialChange: true,
      changeSummary: "Synthetic reuse of v1.",
      newVersion: v1,
      contract: reuseContract,
    });
    assert.equal(reuse.ok, false);
    assert.equal(reuse.code, "VERSION_ALREADY_EVALUATED");

    const current = registry.get(first.componentId, first.roleClass);
    assert.deepEqual(current.componentVersion, v2);
    assert.equal(current.state, EVALUATION_STATE.OUTCOME_RECORDED);
    assert.equal(current.outcome.value, "HOLD");
    assert.equal(registry.history(first.componentId, first.roleClass).length, 2);
  }
});

test("CMD-2: protocolId distinto no colapsa priorFindings (semver y content-hash)", () => {
  const cases = [
    { v1: "0.1.0", v2: "0.2.0", v3: "0.3.0" },
    { v1: { contentHash: "3".repeat(64) }, v2: { contentHash: "4".repeat(64) }, v3: { contentHash: "5".repeat(64) } },
  ];
  for (const { v1, v2, v3 } of cases) {
    const registry = createRoleEvaluationRegistry();
    const first = makeLearningEvaluation({ componentVersion: v1, protocolId: "SYN-P1", protocolVersion: "1.0.0" });
    registry.registerComponent(first);
    registry.markEvaluationReady(first.componentId, first.roleClass, SYNTHETIC_READINESS);
    registry.recordOutcome(first.componentId, first.roleClass, "REJECT", { evidenceRefs: [evidence("SYN-P1-REJECT")] });

    const second = registry.createNewEvaluationVersion(first.componentId, first.roleClass, {
      materialChange: true,
      changeSummary: "Synthetic v1/P1 -> v2/P1.",
      newVersion: v2,
      contract: { ...makeLearningEvaluation(), componentVersion: v2, protocolId: "SYN-P1", protocolVersion: "1.0.0" },
    });
    assert.equal(second.ok, true);

    const third = registry.createNewEvaluationVersion(first.componentId, first.roleClass, {
      materialChange: true,
      changeSummary: "Synthetic v2/P1 -> v1/P2.",
      newVersion: v1,
      contract: { ...makeLearningEvaluation(), componentVersion: v1, protocolId: "SYN-P2", protocolVersion: "1.0.0" },
      protocolChange: true,
      protocolChangeSummary: "Synthetic protocol change P1 -> P2.",
    });
    assert.equal(third.ok, true);
    registry.markEvaluationReady(first.componentId, first.roleClass, SYNTHETIC_READINESS);
    registry.recordOutcome(first.componentId, first.roleClass, "REJECT", { evidenceRefs: [evidence("SYN-P2-REJECT")] });
    assert.equal(registry.get(first.componentId, first.roleClass).priorFindings.length, 2);

    const fourth = registry.createNewEvaluationVersion(first.componentId, first.roleClass, {
      materialChange: true,
      changeSummary: "Synthetic v1/P2 -> v3/P2.",
      newVersion: v3,
      contract: { ...makeLearningEvaluation(), componentVersion: v3, protocolId: "SYN-P2", protocolVersion: "1.0.0" },
    });
    assert.equal(fourth.ok, true);
    assert.equal(fourth.record.priorFindings.length, 2);
  }
});

test("R2-C1: registrar y versionar no congelan objetos de versión del llamante", () => {
  const registry = createRoleEvaluationRegistry();
  const callerVersion = { contentHash: "d".repeat(64) };
  const evaluation = makeLearningEvaluation({ componentVersion: callerVersion });
  assert.equal(registry.registerComponent(evaluation).ok, true);
  assert.equal(Object.isFrozen(callerVersion), false);
  assert.notEqual(registry.get(evaluation.componentId, evaluation.roleClass).componentVersion, callerVersion);

  const callerNewVersion = { contentHash: "e".repeat(64) };
  const created = registry.createNewEvaluationVersion(evaluation.componentId, evaluation.roleClass, {
    materialChange: true,
    changeSummary: "Synthetic content-hash change.",
    newVersion: callerNewVersion,
  });
  assert.equal(created.ok, true);
  assert.equal(Object.isFrozen(callerNewVersion), false);
  assert.notEqual(created.record.componentVersion, callerNewVersion);
});