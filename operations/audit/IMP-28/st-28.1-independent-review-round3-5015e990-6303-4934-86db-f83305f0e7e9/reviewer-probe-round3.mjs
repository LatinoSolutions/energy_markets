// Probe adversarial independiente de la ronda 3 (ST-28.1 / WP-IMP-28-ST-1-v1.1).
// Escrito por el Independent Reviewer 0af74a08, no por el autor. Objetivo:
//   (1) verificar de forma independiente que R2-B y R2-C1 están corregidos,
//       sin apoyarse en los tests del autor;
//   (2) comprobar que la corrección de R2-B es general (no un caso especial);
//   (3) auditar el residuo de aislamiento de la misma clase que C/R2-C1 en las
//       superficies que la ronda 2 NO cubrió correctamente (R2-C2 usó un
//       roleClass en minúsculas y por tanto pasó de forma vacía);
//   (4) confirmar que no hay regresión en lo ya aceptado.
// Todas las fixtures son sintéticas. No se evalúa ningún componente real, no se
// concede autoridad y no se toca estado de oficina.

import { createRoleEvaluationRegistry } from "../../../../src/role-evaluation/registry.mjs";
import { ROLE_CLASS } from "../../../../src/role-evaluation/roles.mjs";
import { isVersionLike } from "../../../../src/contracts/identities.mjs";

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const HASH_C = "c".repeat(64);

let failures = 0;
const results = [];

function check(id, title, expected, observed, passed) {
  results.push({ id, title, expected, observed, status: passed ? "PASS" : "FAIL" });
  if (!passed) failures += 1;
  console.log(`${passed ? "PASS" : "FAIL"} ${id} — ${title}`);
  console.log(`      esperado: ${expected}`);
  console.log(`      observado: ${observed}`);
}

function makeEvaluation(overrides = {}) {
  return {
    componentId: "SYN-R3-COMPONENT",
    componentVersion: "0.1.0",
    roleClass: ROLE_CLASS.ENGINEERING_ORCHESTRATION,
    protocolId: "SYN-PROTOCOL-1",
    protocolVersion: "1.0.0",
    exactRole: "Synthetic engineering/orchestration role under test.",
    problemToImprove: "Synthetic workflow problem; explicitly not a procurement claim.",
    currentComparator: "Synthetic existing mechanism used as comparator.",
    valueHypothesis: "Synthetic measurable operational improvement.",
    requiredInputs: ["SYN-input-A"],
    outputs: ["SYN-output-A"],
    authorityRequested: [],
    integrationBoundary: "Synthetic boundary; no real integration surface.",
    failureModes: ["SYN-failure-1"],
    reproducibilityRequirements: ["SYN-repro-1"],
    costLatencyBurden: { unknown: true, reason: "Synthetic unknown; preserved explicitly." },
    overlapAssessment: "Synthetic overlap assessed against existing mechanisms.",
    evidenceRequiredForAdmission: ["SYN-admission-evidence-1"],
    removalRollbackPath: { path: "Synthetic removal path back to the existing mechanism." },
    ...overrides,
  };
}

const READINESS = {
  prerequisitesSatisfied: ["SYN-prereq-protocol-declared"],
  readinessEvidence: [{ kind: "readiness", ref: "SYN-READY-1" }],
};

function evidence(ref, kind = "evaluation") {
  return { kind, ref };
}

// ---------------------------------------------------------------------------
// R3-A: R2-B, el defecto bloqueante de la ronda 2, reproducido desde cero.
// Dos HOLD en versiones content-hash distintas deben sobrevivir ambos en
// priorFindings al saltar a una tercera versión.
// ---------------------------------------------------------------------------
{
  const registry = createRoleEvaluationRegistry();
  const evaluation = makeEvaluation({ componentId: "SYN-R3-HASH", componentVersion: { contentHash: HASH_A } });
  const { componentId, roleClass } = evaluation;
  registry.registerComponent(evaluation);
  registry.markEvaluationReady(componentId, roleClass, READINESS);
  registry.recordOutcome(componentId, roleClass, "HOLD", { evidenceRefs: [evidence("SYN-HOLD-V1")] });
  registry.createNewEvaluationVersion(componentId, roleClass, {
    materialChange: true,
    changeSummary: "SYN: segunda versión content-hash.",
    newVersion: { contentHash: HASH_B },
    contract: makeEvaluation({ componentId: "SYN-R3-HASH", componentVersion: { contentHash: HASH_B } }),
  });
  registry.markEvaluationReady(componentId, roleClass, READINESS);
  registry.recordOutcome(componentId, roleClass, "HOLD", { evidenceRefs: [evidence("SYN-HOLD-V2")] });
  const third = registry.createNewEvaluationVersion(componentId, roleClass, {
    materialChange: true,
    changeSummary: "SYN: tercera versión content-hash.",
    newVersion: { contentHash: HASH_C },
    contract: makeEvaluation({ componentId: "SYN-R3-HASH", componentVersion: { contentHash: HASH_C } }),
  });
  const refs = (third.record?.priorFindings ?? []).flatMap((f) => f.evidenceRefs.map((e) => e.ref));
  check(
    "R3-A",
    "R2-B corregido: dos HOLD en versiones content-hash distintas sobreviven en priorFindings",
    "priorFindings=2 con refs SYN-HOLD-V1 y SYN-HOLD-V2",
    `priorFindings=${third.record?.priorFindings?.length} refs=${JSON.stringify(refs)}`,
    third.ok === true &&
      third.record.priorFindings.length === 2 &&
      refs.includes("SYN-HOLD-V1") &&
      refs.includes("SYN-HOLD-V2"),
  );
}

// ---------------------------------------------------------------------------
// R3-B: la corrección de R2-B debe ser general, no un caso especial. Un cambio
// SÓLO de protocolVersion a content-hash (misma forma de defecto en el segundo
// componente de la clave) tampoco debe colapsar dos hallazgos.
// ---------------------------------------------------------------------------
{
  const registry = createRoleEvaluationRegistry();
  const evaluation = makeEvaluation({
    componentId: "SYN-R3-PROTO",
    componentVersion: "0.1.0",
    protocolVersion: { contentHash: HASH_A },
  });
  const { componentId, roleClass } = evaluation;
  registry.registerComponent(evaluation);
  registry.markEvaluationReady(componentId, roleClass, READINESS);
  registry.recordOutcome(componentId, roleClass, "REJECT", { evidenceRefs: [evidence("SYN-REJ-P1")] });
  registry.createNewEvaluationVersion(componentId, roleClass, {
    materialChange: true,
    changeSummary: "SYN: nueva versión y nuevo protocolo content-hash.",
    protocolChange: true,
    protocolChangeSummary: "SYN: protocolo de evaluación revisado.",
    newVersion: "0.2.0",
    contract: makeEvaluation({
      componentId: "SYN-R3-PROTO",
      componentVersion: "0.2.0",
      protocolVersion: { contentHash: HASH_B },
    }),
  });
  registry.markEvaluationReady(componentId, roleClass, READINESS);
  registry.recordOutcome(componentId, roleClass, "REJECT", { evidenceRefs: [evidence("SYN-REJ-P2")] });
  const third = registry.createNewEvaluationVersion(componentId, roleClass, {
    materialChange: true,
    changeSummary: "SYN: tercera versión.",
    newVersion: "0.3.0",
    contract: makeEvaluation({
      componentId: "SYN-R3-PROTO",
      componentVersion: "0.3.0",
      protocolVersion: { contentHash: HASH_B },
    }),
  });
  const refs = (third.record?.priorFindings ?? []).flatMap((f) => f.evidenceRefs.map((e) => e.ref));
  check(
    "R3-B",
    "la clave de dedup distingue también content-hashes de protocolVersion",
    "priorFindings=2 con SYN-REJ-P1 y SYN-REJ-P2",
    `priorFindings=${third.record?.priorFindings?.length} refs=${JSON.stringify(refs)}`,
    third.ok === true && third.record.priorFindings.length === 2 && refs.includes("SYN-REJ-P1") && refs.includes("SYN-REJ-P2"),
  );
}

// ---------------------------------------------------------------------------
// R3-C: la clave de dedup no debe confundir una versión textual con un
// content-hash. versionKey() prefija "version:"/"hash:" y isVersionLike sólo
// admite semver textual, así que no debe existir colisión entre formas.
// ---------------------------------------------------------------------------
{
  check(
    "R3-C",
    "isVersionLike no admite una cadena con forma de clave de hash (sin colisión de prefijos)",
    "isVersionLike('hash:aaa…') === false",
    `isVersionLike('hash:${HASH_A}') === ${isVersionLike(`hash:${HASH_A}`)}`,
    isVersionLike(`hash:${HASH_A}`) === false,
  );
}

// ---------------------------------------------------------------------------
// R3-D: R2-C1 corregido — registerComponent no congela la versión-objeto del
// llamante, y tampoco lo hace createNewEvaluationVersion con newVersion.
// ---------------------------------------------------------------------------
{
  const registry = createRoleEvaluationRegistry();
  const callerVersion = { contentHash: HASH_A };
  const evaluation = makeEvaluation({ componentId: "SYN-R3-FREEZE", componentVersion: callerVersion });
  const registered = registry.registerComponent(evaluation);
  check(
    "R3-D1",
    "R2-C1 corregido: registerComponent no congela el objeto de versión del llamante",
    "registro ok y Object.isFrozen(callerVersion) === false",
    `ok=${registered.ok} frozen=${Object.isFrozen(callerVersion)}`,
    registered.ok === true && Object.isFrozen(callerVersion) === false,
  );

  const callerNewVersion = { contentHash: HASH_B };
  const bumped = registry.createNewEvaluationVersion(evaluation.componentId, evaluation.roleClass, {
    materialChange: true,
    changeSummary: "SYN: salto de versión.",
    newVersion: callerNewVersion,
    contract: makeEvaluation({ componentId: "SYN-R3-FREEZE", componentVersion: { contentHash: HASH_B } }),
  });
  check(
    "R3-D2",
    "createNewEvaluationVersion no congela el objeto newVersion del llamante",
    "salto ok y Object.isFrozen(callerNewVersion) === false",
    `ok=${bumped.ok} frozen=${Object.isFrozen(callerNewVersion)}`,
    bumped.ok === true && Object.isFrozen(callerNewVersion) === false,
  );
}

// ---------------------------------------------------------------------------
// R3-E: residuo de la MISMA clase que C/R2-C1 en superficies no cubiertas.
// R2-C2 de la ronda 2 usó roleClass "strategy_evidence" en minúsculas, que no
// es una de las cuatro clases: el registro fallaba, el gate nunca se guardaba y
// la comprobación pasaba de forma vacía. Se repite con el id correcto.
// ---------------------------------------------------------------------------
{
  const registry = createRoleEvaluationRegistry();
  const strategy = makeEvaluation({ componentId: "SYN-R3-STRAT", roleClass: ROLE_CLASS.STRATEGY_EVIDENCE });
  const callerGate = { accepted: true, frameworkRef: "operations/receipts/IMP-27-ST-1.json", section: "§8.7" };
  const registered = registry.registerComponent(strategy);
  const ready = registry.markEvaluationReady(strategy.componentId, strategy.roleClass, {
    ...READINESS,
    strategyAdmissionGate: callerGate,
  });
  check(
    "R3-E0",
    "control: el escenario del gate §8.7 se ejecuta de verdad (lo que R2-C2 no hizo)",
    "registerComponent ok y markEvaluationReady ok",
    `registered=${registered.ok} ready=${ready.ok} readyCode=${ready.code ?? "-"}`,
    registered.ok === true && ready.ok === true,
  );
  check(
    "R3-E1",
    "markEvaluationReady no congela el objeto de gate §8.7 del llamante",
    "Object.isFrozen(callerGate) === false",
    `frozen=${Object.isFrozen(callerGate)}`,
    Object.isFrozen(callerGate) === false,
  );

  const registry2 = createRoleEvaluationRegistry();
  const callerAuthority = { scope: "SYN-AUTH-OBJECT" };
  const gov = makeEvaluation({
    componentId: "SYN-R3-GOV",
    roleClass: ROLE_CLASS.EXECUTION_GOVERNANCE,
    authorityRequested: [callerAuthority],
  });
  registry2.registerComponent(gov);
  check(
    "R3-E2",
    "registerComponent no congela elementos-objeto de authorityRequested del llamante",
    "Object.isFrozen(callerAuthority) === false",
    `frozen=${Object.isFrozen(callerAuthority)}`,
    Object.isFrozen(callerAuthority) === false,
  );

  const registry3 = createRoleEvaluationRegistry();
  const callerPrereq = { id: "SYN-PREREQ-OBJECT" };
  const comp = makeEvaluation({ componentId: "SYN-R3-PREREQ" });
  registry3.registerComponent(comp);
  registry3.markEvaluationReady(comp.componentId, comp.roleClass, {
    prerequisitesSatisfied: [callerPrereq],
    readinessEvidence: [{ kind: "readiness", ref: "SYN-READY-1" }],
  });
  check(
    "R3-E3",
    "markEvaluationReady no congela elementos-objeto de prerequisitesSatisfied del llamante",
    "Object.isFrozen(callerPrereq) === false",
    `frozen=${Object.isFrozen(callerPrereq)}`,
    Object.isFrozen(callerPrereq) === false,
  );
}

// ---------------------------------------------------------------------------
// R3-F: sin regresión en las propiedades nucleares del packet (acceptance 2/3).
// ---------------------------------------------------------------------------
{
  const registry = createRoleEvaluationRegistry();
  const engineering = makeEvaluation({ componentId: "SYN-R3-MULTI", roleClass: ROLE_CLASS.ENGINEERING_ORCHESTRATION });
  const strategy = makeEvaluation({ componentId: "SYN-R3-MULTI", roleClass: ROLE_CLASS.STRATEGY_EVIDENCE });
  registry.registerComponent(engineering);
  registry.registerComponent(strategy);
  registry.markEvaluationReady(engineering.componentId, engineering.roleClass, READINESS);
  registry.recordOutcome(engineering.componentId, engineering.roleClass, "ADMIT", {
    evidenceRefs: [evidence("SYN-ADMIT-ENG")],
  });
  const strategyRecord = registry.get(strategy.componentId, strategy.roleClass);
  check(
    "R3-F1",
    "acceptance 2: ADMIT en un rol no admite ni altera el otro rol del mismo componente",
    "el rol Strategy/Evidence sigue en REGISTERED, sin outcome y sin autoridad",
    `state=${strategyRecord.state} outcome=${strategyRecord.outcome} authority=${JSON.stringify(strategyRecord.authorityGranted)}`,
    strategyRecord.state === "REGISTERED" && strategyRecord.outcome === null && strategyRecord.authorityGranted.length === 0,
  );

  const gateless = registry.markEvaluationReady(strategy.componentId, strategy.roleClass, READINESS);
  check(
    "R3-F2",
    "acceptance 3: Strategy/Evidence no alcanza readiness sin el gate §8.7 aceptado",
    "fallo MISSING_STRATEGY_ADMISSION_GATE",
    `ok=${gateless.ok} code=${gateless.code}`,
    gateless.ok === false && gateless.code === "MISSING_STRATEGY_ADMISSION_GATE",
  );

  const govRegistry = createRoleEvaluationRegistry();
  const gov = makeEvaluation({ componentId: "SYN-R3-GOV2", roleClass: ROLE_CLASS.EXECUTION_GOVERNANCE });
  govRegistry.registerComponent(gov);
  govRegistry.markEvaluationReady(gov.componentId, gov.roleClass, READINESS);
  govRegistry.recordOutcome(gov.componentId, gov.roleClass, "ADMIT", { evidenceRefs: [evidence("SYN-ADMIT-GOV")] });
  const withValidation = govRegistry.validateRealActionPrerequisite(gov.componentId, gov.roleClass, {
    authorityValidation: { accepted: true },
  });
  check(
    "R3-F3",
    "acceptance 3: ni con ADMIT y validación separada aceptada el framework concede autoridad productiva",
    "fallo NO_PRODUCTIVE_AUTHORITY",
    `ok=${withValidation.ok} code=${withValidation.code} hasProductiveAuthority=${govRegistry.hasProductiveAuthority}`,
    withValidation.ok === false && withValidation.code === "NO_PRODUCTIVE_AUTHORITY" && govRegistry.hasProductiveAuthority === false,
  );

  const immutable = govRegistry.recordOutcome(gov.componentId, gov.roleClass, "REJECT", {
    evidenceRefs: [evidence("SYN-REWRITE")],
  });
  check(
    "R3-F4",
    "acceptance 5: un outcome ya registrado en su versión es inmutable",
    "fallo OUTCOME_ALREADY_RECORDED",
    `ok=${immutable.ok} code=${immutable.code}`,
    immutable.ok === false && immutable.code === "OUTCOME_ALREADY_RECORDED",
  );
}

console.log(`\n--- ${results.length} comprobaciones, ${failures} fallidas ---`);
console.log(JSON.stringify(results, null, 2));
