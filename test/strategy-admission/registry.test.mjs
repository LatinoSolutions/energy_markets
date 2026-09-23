import { test } from "node:test";
import assert from "node:assert/strict";

import { createStrategyAdmissionRegistry } from "../../src/strategy-admission/registry.mjs";
import {
  STRATEGY_ADMISSION_NAMESPACE,
  STRATEGY_LIFECYCLE_NAMESPACE,
} from "../../src/strategy-admission/lifecycle.mjs";
import {
  SYNTHETIC_READINESS,
  driveToUnderTest,
  evidence,
  makeCandidate,
  makeChannel1Candidate,
  makeChannel2Candidate,
  makeChannel3Candidate,
} from "./fixtures.mjs";

test("registra candidatos de los tres canales en un mismo proceso", () => {
  const registry = createStrategyAdmissionRegistry();
  for (const candidate of [makeChannel1Candidate(), makeChannel2Candidate(), makeChannel3Candidate()]) {
    assert.equal(registry.register(candidate).ok, true);
  }
  assert.equal(registry.list().length, 3);
  assert.equal(registry.history("CAND-SYN-01").length, 1);
});

test("rechaza colisión de id y de canonical name", () => {
  const registry = createStrategyAdmissionRegistry();
  assert.equal(registry.register(makeCandidate()).ok, true);

  const sameId = registry.register(makeCandidate({ canonicalName: "Other synthetic name" }));
  assert.equal(sameId.ok, false);
  assert.equal(sameId.code, "IDENTITY_COLLISION");

  const sameName = registry.register(makeCandidate({ strategyId: "CAND-SYN-99" }));
  assert.equal(sameName.ok, false);
  assert.equal(sameName.code, "IDENTITY_COLLISION");
});

test("rechaza un contrato incompleto en el registro", () => {
  const registry = createStrategyAdmissionRegistry();
  const candidate = makeCandidate();
  delete candidate.refutationCriteria;
  const outcome = registry.register(candidate);
  assert.equal(outcome.ok, false);
  assert.equal(outcome.code, "CONTRACT_INCOMPLETE");
});

test("rechaza registrar un candidato ya admitido", () => {
  const registry = createStrategyAdmissionRegistry();
  const candidate = makeCandidate({
    admissionStatus: { namespace: STRATEGY_ADMISSION_NAMESPACE, value: "ADMITTED_EVIDENCE_GENERATOR" },
  });
  const outcome = registry.register(candidate);
  assert.equal(outcome.ok, false);
  assert.equal(outcome.code, "NON_INITIAL_ADMISSION_STATUS");
});

test("recorre el lifecycle completo y admite sólo con decisión explícita", () => {
  const registry = createStrategyAdmissionRegistry();
  const candidate = makeChannel1Candidate();
  const experimentId = driveToUnderTest(registry, candidate);

  assert.equal(registry.get(candidate.strategyId).lifecycle.value, "UNDER_TEST");

  const verdict = registry.recordVerdict(candidate.strategyId, "PASS", {
    experimentId,
    evidenceRefs: [evidence("SYN-PASS-1")],
  });
  assert.equal(verdict.ok, true);
  assert.equal(registry.get(candidate.strategyId).admission.value, "NOT_ADMITTED");

  const admitted = registry.admit(candidate.strategyId, {
    justification: "Synthetic framework test decision; not a real admission.",
    authority: "SYNTHETIC_REVIEW_AUTHORITY",
    evidenceRefs: [evidence("SYN-ADMISSION-1", "admission")],
  });
  assert.equal(admitted.ok, true);
  assert.equal(admitted.record.admission.value, "ADMITTED_EVIDENCE_GENERATOR");
  assert.deepEqual(admitted.authority.denies.includes("BUY_WAIT_AUTHORITY"), true);
});

test("EXPERIMENT-READY se rechaza sin prerequisites ni evidencia de readiness", () => {
  const registry = createStrategyAdmissionRegistry();
  const candidate = makeCandidate();
  registry.register(candidate);
  registry.transition(candidate.strategyId, "FORMALIZED");

  const nominalOnly = registry.transition(candidate.strategyId, "EXPERIMENT_READY", {});
  assert.equal(nominalOnly.ok, false);
  assert.equal(nominalOnly.code, "NOT_EXPERIMENT_READY");
  assert.equal(registry.get(candidate.strategyId).lifecycle.value, "FORMALIZED");
});

test("no se salta de PROPOSED a EXPERIMENT_READY", () => {
  const registry = createStrategyAdmissionRegistry();
  const candidate = makeCandidate();
  registry.register(candidate);
  const outcome = registry.transition(candidate.strategyId, "EXPERIMENT_READY", SYNTHETIC_READINESS);
  assert.equal(outcome.ok, false);
  assert.equal(outcome.code, "ILLEGAL_TRANSITION");
});

test("no se registra veredicto antes de UNDER TEST ni con otro experimento", () => {
  const registry = createStrategyAdmissionRegistry();
  const candidate = makeCandidate();
  registry.register(candidate);
  registry.transition(candidate.strategyId, "FORMALIZED");
  registry.transition(candidate.strategyId, "EXPERIMENT_READY", SYNTHETIC_READINESS);

  const tooEarly = registry.recordVerdict(candidate.strategyId, "PASS", {
    experimentId: "SYN-EXPERIMENT-1",
    evidenceRefs: [evidence("SYN-EARLY")],
  });
  assert.equal(tooEarly.ok, false);
  assert.equal(tooEarly.code, "NOT_UNDER_TEST");

  registry.transition(candidate.strategyId, "UNDER_TEST", { experimentId: "SYN-EXPERIMENT-1" });
  const mismatch = registry.recordVerdict(candidate.strategyId, "PASS", {
    experimentId: "SYN-EXPERIMENT-OTHER",
    evidenceRefs: [evidence("SYN-MISMATCH")],
  });
  assert.equal(mismatch.ok, false);
  assert.equal(mismatch.code, "EXPERIMENT_MISMATCH");
});

test("la admisión exige justificación, autoridad y evidencia", () => {
  const registry = createStrategyAdmissionRegistry();
  const candidate = makeCandidate();
  const experimentId = driveToUnderTest(registry, candidate);
  registry.recordVerdict(candidate.strategyId, "PASS", { experimentId, evidenceRefs: [evidence("SYN-PASS")] });

  const incomplete = registry.admit(candidate.strategyId, {});
  assert.equal(incomplete.ok, false);
  assert.equal(incomplete.code, "ADMISSION_DECISION_INCOMPLETE");
  assert.equal(registry.get(candidate.strategyId).admission.value, "NOT_ADMITTED");
});

test("FAIL exige nueva versión y no admite la versión refutada", () => {
  const registry = createStrategyAdmissionRegistry();
  const candidate = makeCandidate();
  const experimentId = driveToUnderTest(registry, candidate);
  registry.recordVerdict(candidate.strategyId, "FAIL", { experimentId, evidenceRefs: [evidence("SYN-FAIL")] });

  const outcome = registry.admit(candidate.strategyId, {
    justification: "Synthetic attempt.",
    authority: "SYNTHETIC_REVIEW_AUTHORITY",
    evidenceRefs: [evidence("SYN-ADMISSION")],
  });
  assert.equal(outcome.ok, false);
  assert.equal(outcome.code, "REFUTED_REQUIRES_NEW_VERSION");
});

test("un cambio material crea nueva versión y preserva FAIL y OOS consumido", () => {
  const registry = createStrategyAdmissionRegistry();
  const candidate = makeCandidate();
  const experimentId = driveToUnderTest(registry, candidate);
  registry.consumeOos(candidate.strategyId, "SYN-OOS-REF-1");
  registry.recordVerdict(candidate.strategyId, "FAIL", { experimentId, evidenceRefs: [evidence("SYN-FAIL")] });

  const outcome = registry.createNewVersion(candidate.strategyId, {
    materialChange: true,
    changeSummary: "Synthetic material change after FAIL.",
    newVersion: "0.2.0",
    evidenceRefs: [evidence("SYN-NEW-VERSION")],
  });
  assert.equal(outcome.ok, true);

  const next = outcome.record;
  assert.equal(next.version, "0.2.0");
  assert.equal(next.priorVersionId, "0.1.0");
  assert.equal(next.versionIndex, 1);
  assert.equal(next.lifecycle.value, "FORMALIZED");
  assert.equal(next.admission.value, "NOT_ADMITTED");
  assert.equal(next.oosConsumption.consumed, true);
  assert.equal(next.oosConsumption.references.length, 1);
  assert.equal(next.priorFindings.length, 1);
  assert.equal(next.priorFindings[0].value, "FAIL");
  assert.equal(registry.history(candidate.strategyId).length, 2);
});

test("no se crea versión sin cambio material ni repitiendo la misma versión", () => {
  const registry = createStrategyAdmissionRegistry();
  const candidate = makeCandidate();
  registry.register(candidate);

  const noMaterial = registry.createNewVersion(candidate.strategyId, {
    changeSummary: "Synthetic.",
    newVersion: "0.2.0",
  });
  assert.equal(noMaterial.ok, false);
  assert.equal(noMaterial.code, "MATERIAL_CHANGE_REQUIRED");

  const sameVersion = registry.createNewVersion(candidate.strategyId, {
    materialChange: true,
    changeSummary: "Synthetic.",
    newVersion: "0.1.0",
  });
  assert.equal(sameVersion.ok, false);
  assert.equal(sameVersion.code, "VERSION_NOT_CHANGED");
});

test("no se resetea silenciosamente un OOS consumido", () => {
  const registry = createStrategyAdmissionRegistry();
  const candidate = makeCandidate();
  registry.register(candidate);
  registry.consumeOos(candidate.strategyId, "SYN-OOS-REF-1");

  const contract = { ...makeCandidate(), version: "0.2.0", oosConsumption: { consumed: false, references: [] } };
  const outcome = registry.createNewVersion(candidate.strategyId, {
    materialChange: true,
    changeSummary: "Synthetic reset attempt.",
    newVersion: "0.2.0",
    contract,
  });
  assert.equal(outcome.ok, false);
  assert.equal(outcome.code, "OOS_RESET_ATTEMPT");
});

test("la evidencia es append-only y queda congelada", () => {
  const registry = createStrategyAdmissionRegistry();
  const candidate = makeCandidate();
  registry.register(candidate);

  const first = registry.attachEvidence(candidate.strategyId, evidence("SYN-EV-1"));
  assert.equal(first.ok, true);
  const second = registry.attachEvidence(candidate.strategyId, evidence("SYN-EV-2"));
  assert.equal(second.ok, true);
  assert.equal(second.record.evidenceRefs.length, 2);
  assert.equal(Object.isFrozen(second.record.evidenceRefs), true);
  assert.equal(Object.isFrozen(second.record), true);

  const malformed = registry.attachEvidence(candidate.strategyId, { kind: "experiment" });
  assert.equal(malformed.ok, false);
  assert.equal(malformed.code, "INVALID_EVIDENCE");
});

test("un candidato desconocido se rechaza en todas las operaciones", () => {
  const registry = createStrategyAdmissionRegistry();
  assert.equal(registry.transition("SYN-MISSING", "FORMALIZED").code, "UNKNOWN_STRATEGY");
  assert.equal(registry.recordVerdict("SYN-MISSING", "PASS", {}).code, "UNKNOWN_STRATEGY");
  assert.equal(registry.admit("SYN-MISSING", {}).code, "UNKNOWN_STRATEGY");
  assert.equal(registry.createNewVersion("SYN-MISSING", {}).code, "UNKNOWN_STRATEGY");
  assert.equal(registry.consumeOos("SYN-MISSING", "x").code, "UNKNOWN_STRATEGY");
});

test("no se reescribe el veredicto de una misma versión/experimento (FAIL→PASS)", () => {
  const registry = createStrategyAdmissionRegistry();
  const candidate = makeCandidate();
  const experimentId = driveToUnderTest(registry, candidate);
  assert.equal(
    registry.recordVerdict(candidate.strategyId, "FAIL", { experimentId, evidenceRefs: [evidence("SYN-FAIL")] }).ok,
    true,
  );

  const rewritten = registry.recordVerdict(candidate.strategyId, "PASS", {
    experimentId,
    evidenceRefs: [evidence("SYN-PASS")],
  });
  assert.equal(rewritten.ok, false);
  assert.equal(rewritten.code, "VERDICT_ALREADY_RECORDED");
  assert.equal(registry.get(candidate.strategyId).verdict.value, "FAIL");

  const admitted = registry.admit(candidate.strategyId, {
    justification: "Synthetic attempt after FAIL.",
    authority: "SYNTHETIC_REVIEW_AUTHORITY",
    evidenceRefs: [evidence("SYN-ADMISSION")],
  });
  assert.equal(admitted.ok, false);
  assert.equal(admitted.code, "REFUTED_REQUIRES_NEW_VERSION");
  assert.equal(registry.get(candidate.strategyId).admission.value, "NOT_ADMITTED");
  assert.equal(registry.get(candidate.strategyId).versionIndex, 0);
});

test("un FAIL posterior a la admisión no se registra ni revoca la admisión en silencio", () => {
  const registry = createStrategyAdmissionRegistry();
  const candidate = makeCandidate();
  const experimentId = driveToUnderTest(registry, candidate);
  registry.recordVerdict(candidate.strategyId, "PASS", { experimentId, evidenceRefs: [evidence("SYN-PASS")] });
  const admitted = registry.admit(candidate.strategyId, {
    justification: "Synthetic framework decision.",
    authority: "SYNTHETIC_REVIEW_AUTHORITY",
    evidenceRefs: [evidence("SYN-ADMISSION", "admission")],
  });
  assert.equal(admitted.ok, true);

  const laterFail = registry.recordVerdict(candidate.strategyId, "FAIL", {
    experimentId,
    evidenceRefs: [evidence("SYN-LATER-FAIL")],
  });
  assert.equal(laterFail.ok, false);
  assert.equal(laterFail.code, "VERDICT_ALREADY_RECORDED");
  assert.equal(registry.get(candidate.strategyId).admission.value, "ADMITTED_EVIDENCE_GENERATOR");
  assert.equal(registry.get(candidate.strategyId).verdict.value, "PASS");
});

test("una nueva versión puede pasar y admitirse conservando el FAIL previo", () => {
  const registry = createStrategyAdmissionRegistry();
  const candidate = makeCandidate();
  const experimentId = driveToUnderTest(registry, candidate);
  registry.recordVerdict(candidate.strategyId, "FAIL", { experimentId, evidenceRefs: [evidence("SYN-FAIL")] });

  assert.equal(
    registry.createNewVersion(candidate.strategyId, {
      materialChange: true,
      changeSummary: "Synthetic material change after FAIL.",
      newVersion: "0.2.0",
    }).ok,
    true,
  );

  const nextExperiment = "SYN-EXPERIMENT-2";
  assert.equal(registry.transition(candidate.strategyId, "EXPERIMENT_READY", SYNTHETIC_READINESS).ok, true);
  assert.equal(registry.transition(candidate.strategyId, "UNDER_TEST", { experimentId: nextExperiment }).ok, true);
  assert.equal(
    registry.recordVerdict(candidate.strategyId, "PASS", { experimentId: nextExperiment, evidenceRefs: [evidence("SYN-PASS-2")] }).ok,
    true,
  );

  const admitted = registry.admit(candidate.strategyId, {
    justification: "Synthetic decision after a new version.",
    authority: "SYNTHETIC_REVIEW_AUTHORITY",
    evidenceRefs: [evidence("SYN-ADMISSION-2", "admission")],
  });
  assert.equal(admitted.ok, true);
  assert.equal(admitted.record.version, "0.2.0");
  assert.equal(admitted.record.priorFindings.length, 1);
  assert.equal(admitted.record.priorFindings[0].value, "FAIL");
  assert.equal(admitted.record.priorFindings[0].version, "0.1.0");
});

test("priorFindings no duplica refutaciones tras cambios materiales sucesivos", () => {
  const registry = createStrategyAdmissionRegistry();
  const candidate = makeCandidate();
  const experimentId = driveToUnderTest(registry, candidate);
  registry.recordVerdict(candidate.strategyId, "FAIL", { experimentId, evidenceRefs: [evidence("SYN-FAIL")] });
  registry.createNewVersion(candidate.strategyId, { materialChange: true, changeSummary: "c1", newVersion: "0.2.0" });
  registry.createNewVersion(candidate.strategyId, { materialChange: true, changeSummary: "c2", newVersion: "0.3.0" });
  assert.equal(registry.get(candidate.strategyId).priorFindings.length, 1);
});

test("register no congela el objeto del llamante", () => {
  const registry = createStrategyAdmissionRegistry();
  const candidate = makeCandidate();
  assert.equal(registry.register(candidate).ok, true);
  assert.equal(Object.isFrozen(candidate), false);
  assert.equal(Object.isFrozen(candidate.provenance), false);
  candidate.role = "Synthetic mutation after register; must not affect the record.";
  assert.notEqual(registry.get(candidate.strategyId).contract.role, candidate.role);
});

test("createNewVersion rechaza un contrato cuya Version no coincide con newVersion", () => {
  const registry = createStrategyAdmissionRegistry();
  const candidate = makeCandidate();
  registry.register(candidate);

  const outcome = registry.createNewVersion(candidate.strategyId, {
    materialChange: true,
    changeSummary: "Synthetic version mismatch.",
    newVersion: "0.2.0",
    contract: makeCandidate({ version: "9.9.9" }),
  });
  assert.equal(outcome.ok, false);
  assert.equal(outcome.code, "VERSION_MISMATCH");
  assert.equal(registry.get(candidate.strategyId).version, "0.1.0");
});

test("createNewVersion rechaza un contrato que se declara ya admitido", () => {
  const registry = createStrategyAdmissionRegistry();
  const candidate = makeCandidate();
  registry.register(candidate);

  const outcome = registry.createNewVersion(candidate.strategyId, {
    materialChange: true,
    changeSummary: "Synthetic false admission claim.",
    newVersion: "0.2.0",
    contract: makeCandidate({
      version: "0.2.0",
      admissionStatus: { namespace: STRATEGY_ADMISSION_NAMESPACE, value: "ADMITTED_EVIDENCE_GENERATOR" },
    }),
  });
  assert.equal(outcome.ok, false);
  assert.equal(outcome.code, "NON_INITIAL_ADMISSION_STATUS");
});

test("un experimentId ya veredictado no se reutiliza en una versión nueva", () => {
  const registry = createStrategyAdmissionRegistry();
  const candidate = makeCandidate();
  const experimentId = driveToUnderTest(registry, candidate);
  registry.recordVerdict(candidate.strategyId, "FAIL", { experimentId, evidenceRefs: [evidence("SYN-FAIL")] });
  registry.createNewVersion(candidate.strategyId, { materialChange: true, changeSummary: "c", newVersion: "0.2.0" });
  registry.transition(candidate.strategyId, "EXPERIMENT_READY", SYNTHETIC_READINESS);

  const reuse = registry.transition(candidate.strategyId, "UNDER_TEST", { experimentId });
  assert.equal(reuse.ok, false);
  assert.equal(reuse.code, "EXPERIMENT_ID_REUSED");
});

test("una segunda admisión no sobrescribe la decisión anterior", () => {
  const registry = createStrategyAdmissionRegistry();
  const candidate = makeCandidate();
  const experimentId = driveToUnderTest(registry, candidate);
  registry.recordVerdict(candidate.strategyId, "PASS", { experimentId, evidenceRefs: [evidence("SYN-PASS")] });
  assert.equal(
    registry.admit(candidate.strategyId, {
      justification: "Synthetic first admission.",
      authority: "SYNTHETIC_REVIEW_AUTHORITY",
      evidenceRefs: [evidence("SYN-ADMISSION-1", "admission")],
    }).ok,
    true,
  );

  const second = registry.admit(candidate.strategyId, {
    justification: "Synthetic second admission.",
    authority: "SYNTHETIC_REVIEW_AUTHORITY",
    evidenceRefs: [evidence("SYN-ADMISSION-2", "admission")],
  });
  assert.equal(second.ok, false);
  assert.equal(second.code, "ADMISSION_ALREADY_DECIDED");
  assert.equal(registry.get(candidate.strategyId).admissionDecision.justification, "Synthetic first admission.");
});

test("el reciclaje a una versión {contentHash} ya refutada no se admite", () => {
  const registry = createStrategyAdmissionRegistry();
  const versionA = { contentHash: "a".repeat(64) };
  const versionB = { contentHash: "b".repeat(64) };
  const candidate = makeCandidate({ version: versionA });
  const experimentId = driveToUnderTest(registry, candidate, "SYN-EXP-A");
  registry.recordVerdict(candidate.strategyId, "FAIL", { experimentId, evidenceRefs: [evidence("SYN-FAIL")] });

  assert.equal(
    registry.createNewVersion(candidate.strategyId, { materialChange: true, changeSummary: "to B", newVersion: versionB }).ok,
    true,
  );
  assert.equal(
    registry.createNewVersion(candidate.strategyId, { materialChange: true, changeSummary: "back to A", newVersion: versionA }).ok,
    true,
  );

  assert.equal(registry.transition(candidate.strategyId, "EXPERIMENT_READY", SYNTHETIC_READINESS).ok, true);
  assert.equal(registry.transition(candidate.strategyId, "UNDER_TEST", { experimentId: "SYN-EXP-A2" }).ok, true);
  assert.equal(
    registry.recordVerdict(candidate.strategyId, "PASS", { experimentId: "SYN-EXP-A2", evidenceRefs: [evidence("SYN-PASS")] }).ok,
    true,
  );

  const outcome = registry.admit(candidate.strategyId, {
    justification: "Synthetic contentHash recycling attempt.",
    authority: "SYNTHETIC_REVIEW_AUTHORITY",
    evidenceRefs: [evidence("SYN-ADMISSION", "admission")],
  });
  assert.equal(outcome.ok, false);
  assert.equal(outcome.code, "REFUTED_REQUIRES_NEW_VERSION");
  assert.equal(registry.get(candidate.strategyId).admission.value, "NOT_ADMITTED");
});

test("transition, recordVerdict y admit no congelan los arrays del llamante", () => {
  const registry = createStrategyAdmissionRegistry();
  const candidate = makeCandidate();
  registry.register(candidate);
  registry.transition(candidate.strategyId, "FORMALIZED");

  const readiness = {
    prerequisitesSatisfied: ["SYN-prereq"],
    readinessEvidence: [evidence("SYN-READY")],
  };
  assert.equal(registry.transition(candidate.strategyId, "EXPERIMENT_READY", readiness).ok, true);
  assert.equal(Object.isFrozen(readiness.readinessEvidence), false);
  assert.equal(Object.isFrozen(readiness.readinessEvidence[0]), false);

  assert.equal(registry.transition(candidate.strategyId, "UNDER_TEST", { experimentId: "SYN-EXP-P4" }).ok, true);
  const verdictEvidence = [evidence("SYN-VERDICT")];
  assert.equal(registry.recordVerdict(candidate.strategyId, "PASS", { experimentId: "SYN-EXP-P4", evidenceRefs: verdictEvidence }).ok, true);
  assert.equal(Object.isFrozen(verdictEvidence), false);
  assert.equal(Object.isFrozen(verdictEvidence[0]), false);

  const admissionEvidence = [evidence("SYN-ADMISSION", "admission")];
  assert.equal(
    registry.admit(candidate.strategyId, {
      justification: "Synthetic.",
      authority: "SYNTHETIC_REVIEW_AUTHORITY",
      evidenceRefs: admissionEvidence,
    }).ok,
    true,
  );
  assert.equal(Object.isFrozen(admissionEvidence), false);
  assert.equal(Object.isFrozen(admissionEvidence[0]), false);
});

test("attachEvidence y createNewVersion tampoco congelan los objetos del llamante", () => {
  const registry = createStrategyAdmissionRegistry();
  const candidate = makeCandidate();
  registry.register(candidate);

  const attached = evidence("SYN-ATTACHED");
  assert.equal(registry.attachEvidence(candidate.strategyId, attached).ok, true);
  assert.equal(Object.isFrozen(attached), false);

  const changeEvidence = [evidence("SYN-NEW-VERSION")];
  const change = {
    materialChange: true,
    changeSummary: "Synthetic.",
    newVersion: "0.2.0",
    evidenceRefs: changeEvidence,
  };
  assert.equal(registry.createNewVersion(candidate.strategyId, change).ok, true);
  assert.equal(Object.isFrozen(changeEvidence), false);
  assert.equal(Object.isFrozen(changeEvidence[0]), false);
});

test("EXPERIMENT-READY rechaza prerequisites falsos en los tres canales", () => {
  for (const candidate of [makeChannel1Candidate(), makeChannel2Candidate(), makeChannel3Candidate()]) {
    const registry = createStrategyAdmissionRegistry();
    registry.register(candidate);
    registry.transition(candidate.strategyId, "FORMALIZED");

    const outcome = registry.transition(candidate.strategyId, "EXPERIMENT_READY", {
      prerequisitesSatisfied: [false],
      readinessEvidence: [evidence("SYN-UNVERIFIED-CLAIM")],
    });
    assert.equal(outcome.ok, false, candidate.strategyId);
    assert.equal(outcome.code, "NOT_EXPERIMENT_READY");
    assert.equal(registry.get(candidate.strategyId).lifecycle.value, "FORMALIZED");
  }
});

test("createNewVersion rechaza una identidad/provenance contradictorias de otra Strategy", () => {
  const registry = createStrategyAdmissionRegistry();
  const a = makeChannel1Candidate();
  const b = makeChannel2Candidate();
  registry.register(a);
  registry.register(b);

  const contradictory = {
    ...makeChannel1Candidate({ version: "0.2.0" }),
    canonicalName: b.canonicalName,
    intakeChannel: b.intakeChannel,
    provenance: b.provenance,
  };
  const outcome = registry.createNewVersion(a.strategyId, {
    materialChange: true,
    changeSummary: "Synthetic contradictory identity.",
    newVersion: "0.2.0",
    contract: contradictory,
  });
  assert.equal(outcome.ok, false);
  assert.equal(outcome.code, "IDENTITY_MISMATCH");

  const history = registry.history(a.strategyId);
  assert.equal(history.length, 1);
  assert.equal(registry.get(a.strategyId).version, "0.1.0");
  assert.equal(registry.get(a.strategyId).canonicalName, a.canonicalName);
});

test("createNewVersion rechaza cambiar el intake channel de la identidad", () => {
  const registry = createStrategyAdmissionRegistry();
  const a = makeChannel1Candidate();
  registry.register(a);

  const contract = {
    ...makeChannel2Candidate({ version: "0.2.0" }),
    strategyId: a.strategyId,
    canonicalName: a.canonicalName,
  };
  const outcome = registry.createNewVersion(a.strategyId, {
    materialChange: true,
    changeSummary: "Synthetic channel change.",
    newVersion: "0.2.0",
    contract,
  });
  assert.equal(outcome.ok, false);
  assert.equal(outcome.code, "IDENTITY_MISMATCH");
  assert.equal(registry.get(a.strategyId).channel, "HYPOTHESIS_TO_CANDIDATE");
});

test("una nueva versión conserva identidad y deja record y contrato consistentes", () => {
  const registry = createStrategyAdmissionRegistry();
  const a = makeChannel1Candidate();
  registry.register(a);

  const outcome = registry.createNewVersion(a.strategyId, {
    materialChange: true,
    changeSummary: "Synthetic identity-preserving change.",
    newVersion: "0.2.0",
    contract: makeChannel1Candidate({ version: "0.2.0", role: "Synthetic updated role." }),
  });
  assert.equal(outcome.ok, true);

  const record = outcome.record;
  assert.equal(record.canonicalName, record.contract.canonicalName);
  assert.equal(record.channel, record.contract.intakeChannel);
  assert.deepEqual(record.provenance, record.contract.provenance);

  const history = registry.history(a.strategyId);
  assert.equal(history.length, 2);
  assert.equal(history[0].version, "0.1.0");
  assert.equal(history[0].contract.role, a.role);
});
