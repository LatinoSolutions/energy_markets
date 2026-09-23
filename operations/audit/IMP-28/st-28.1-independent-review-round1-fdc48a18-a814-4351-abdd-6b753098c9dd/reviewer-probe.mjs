// Reviewer-authored probe for ST-28.1 (independent review, round 1). Fuente de
// verdad: SPEC v1.1 §§11.6.1-11.6.4 y los criterios 1-6 del packet
// WP-IMP-28-ST-1-v1.1. No forma parte del deliverable del autor: es evidencia
// del revisor, escrita sin reutilizar test/role-evaluation/fixtures.mjs, para
// no heredar los supuestos de la suite revisada.
//
// Todos los componentes, protocolos y evidencias son SINTÉTICOS. No representan
// capacidad real, valor empírico, admisión ni integración de ningún componente.
//
// Ejecutar:
//   /opt/node/bin/node operations/audit/IMP-28/st-28.1-independent-review-round1-fdc48a18-a814-4351-abdd-6b753098c9dd/reviewer-probe.mjs

import {
  ROLE_CLASS,
  createRoleEvaluationRegistry,
  resolveRoleAdmissionValue,
} from "../../../../src/role-evaluation/index.mjs";

let failures = 0;
function check(id, expectation, actual, pass) {
  const verdict = pass ? "PASS" : "FAIL";
  if (!pass) failures += 1;
  console.log(`[${verdict}] ${id}\n        esperado: ${expectation}\n        observado: ${actual}`);
}

// Contrato §11.6.2 completo, sintético. componentVersion/protocolVersion deben
// tener forma de versión (src/contracts/identities.mjs::isVersionLike).
function syntheticEvaluation(componentId, roleClass, componentVersion = "0.1.0") {
  return {
    componentId,
    roleClass,
    componentVersion,
    protocolId: "SYN-REVIEWER-PROTOCOL",
    protocolVersion: "1.0.0",
    exactRole: "SYN rol concreto bajo prueba.",
    problemToImprove: "SYN problema delimitado.",
    currentComparator: "SYN mecanismo vigente como comparador.",
    valueHypothesis: "SYN mejora medible esperada para este rol.",
    requiredInputs: ["SYN-input"],
    outputs: ["SYN-output"],
    authorityRequested: [],
    integrationBoundary: "SYN frontera; sin superficie real.",
    failureModes: ["SYN-failure"],
    reproducibilityRequirements: ["SYN-repro"],
    costLatencyBurden: { unknown: true, reason: "SYN desconocido preservado explícitamente." },
    overlapAssessment: "SYN solapamiento evaluado contra Paperclip, S1-S5 y Candidate Policy.",
    evidenceRequiredForAdmission: ["SYN-admission-evidence"],
    removalRollbackPath: { path: "SYN camino de retirada al mecanismo autorizado." },
  };
}

const SYN_EVIDENCE = [{ kind: "synthetic", ref: "SYN-REVIEWER-EVIDENCE-1" }];

// ---------------------------------------------------------------------------
// A. FINDING A (bloqueante, criterio 1): identidad de versión divergente.
// createNewEvaluationVersion acepta un change.contract explícito cuyo
// componentVersion no se contrasta contra change.newVersion. El registro queda
// con record.componentVersion = nueva y record.contract.componentVersion =
// antigua: la hipótesis §11.6.2 almacenada queda atribuida a otra versión.
// ---------------------------------------------------------------------------
{
  const registry = createRoleEvaluationRegistry();
  registry.registerComponent(syntheticEvaluation("SYN-A", ROLE_CLASS.REPRESENTATION_LEARNING, "0.1.0"));
  // Contrato nuevo que deliberadamente conserva la versión antigua 0.1.0.
  const staleContract = syntheticEvaluation("SYN-A", ROLE_CLASS.REPRESENTATION_LEARNING, "0.1.0");
  const outcome = registry.createNewEvaluationVersion("SYN-A", ROLE_CLASS.REPRESENTATION_LEARNING, {
    materialChange: true,
    changeSummary: "SYN cambio material.",
    newVersion: "0.9.0",
    contract: staleContract,
  });
  const recordVersion = outcome.record?.componentVersion;
  const contractVersion = outcome.record?.contract?.componentVersion;
  check(
    "A1 createNewEvaluationVersion rechaza (o normaliza) un contrato cuya componentVersion no es newVersion",
    "ok=false (IDENTITY_MISMATCH) o contract.componentVersion === record.componentVersion",
    `ok=${outcome.ok}, record.componentVersion=${recordVersion}, record.contract.componentVersion=${contractVersion}`,
    outcome.ok === false || recordVersion === contractVersion,
  );

  // Variante: la misma puerta permite cambiar la identidad de protocolo en el
  // mismo salto de versión sin que el materialChange lo declare.
  const registry2 = createRoleEvaluationRegistry();
  registry2.registerComponent(syntheticEvaluation("SYN-A2", ROLE_CLASS.REPRESENTATION_LEARNING, "0.1.0"));
  const swapped = syntheticEvaluation("SYN-A2", ROLE_CLASS.REPRESENTATION_LEARNING, "0.2.0");
  swapped.protocolId = "SYN-OTHER-PROTOCOL";
  swapped.protocolVersion = "7.0.0";
  const outcome2 = registry2.createNewEvaluationVersion("SYN-A2", ROLE_CLASS.REPRESENTATION_LEARNING, {
    materialChange: true,
    changeSummary: "SYN cambio material.",
    newVersion: "0.2.0",
    contract: swapped,
  });
  check(
    "A2 un cambio de identidad de protocolo en un salto de versión queda declarado o rechazado",
    "ok=false, o materialChange registra el cambio de protocolo explícitamente",
    `ok=${outcome2.ok}, protocolId=${outcome2.record?.protocolId}, protocolVersion=${outcome2.record?.protocolVersion}, materialChange=${JSON.stringify(outcome2.record?.materialChange)}`,
    outcome2.ok === false ||
      /SYN-OTHER-PROTOCOL|protocol/i.test(JSON.stringify(outcome2.record?.materialChange ?? {})),
  );
}

// ---------------------------------------------------------------------------
// B. FINDING B (bloqueante, criterio 5): history() devuelve la instantánea de
// registro, no el estado real de la versión anterior. Una versión que registró
// HOLD aparece en el historial como REGISTERED/outcome null. registry.test.mjs
// sólo comprueba history().length, nunca su contenido.
// ---------------------------------------------------------------------------
{
  const registry = createRoleEvaluationRegistry();
  const role = ROLE_CLASS.ENGINEERING_ORCHESTRATION;
  registry.registerComponent(syntheticEvaluation("SYN-B", role, "0.1.0"));
  registry.markEvaluationReady("SYN-B", role, {
    prerequisitesSatisfied: ["SYN-prereq"],
    readinessEvidence: SYN_EVIDENCE,
  });
  registry.recordOutcome("SYN-B", role, "HOLD", { evidenceRefs: SYN_EVIDENCE });
  registry.createNewEvaluationVersion("SYN-B", role, {
    materialChange: true,
    changeSummary: "SYN cambio material.",
    newVersion: "0.2.0",
  });

  const history = registry.history("SYN-B", role);
  const prior = history[0];
  check(
    "B1 la entrada de historial de la versión evaluada conserva su outcome registrado",
    "history()[0].outcome.value === 'HOLD' (y state OUTCOME_RECORDED)",
    `history().length=${history.length}, history()[0].state=${prior?.state}, history()[0].outcome=${JSON.stringify(prior?.outcome)}`,
    prior?.outcome?.value === "HOLD",
  );

  // Vía de preservación que SÍ funciona: priorFindings/outcomeHistory del
  // registro vigente. Se comprueba para delimitar el alcance del hallazgo.
  const current = registry.get("SYN-B", role);
  check(
    "B2 (delimitación) el registro vigente sí preserva el HOLD previo",
    "priorFindings incluye HOLD",
    `priorFindings=${JSON.stringify(current.priorFindings.map((f) => f.value))}, outcomeHistory=${JSON.stringify(current.outcomeHistory.map((f) => f.value))}`,
    current.priorFindings.some((f) => f.value === "HOLD"),
  );
}

// ---------------------------------------------------------------------------
// C. FINDING C (recomendado): el registro congela objetos propiedad del
// llamante al ingerir evidencia, mientras registerComponent hace
// structuredClone y registry.test.mjs afirma explícitamente que el registro no
// congela el objeto del llamante. La propiedad se aplica de forma inconsistente.
// ---------------------------------------------------------------------------
{
  const registry = createRoleEvaluationRegistry();
  const role = ROLE_CLASS.ENGINEERING_ORCHESTRATION;
  const callerEvidence = [{ kind: "synthetic", ref: "SYN-CALLER-OWNED" }];
  registry.registerComponent(syntheticEvaluation("SYN-C", role, "0.1.0"));
  registry.markEvaluationReady("SYN-C", role, {
    prerequisitesSatisfied: ["SYN-prereq"],
    readinessEvidence: callerEvidence,
  });
  check(
    "C1 el registro no congela el array de evidencia del llamante",
    "Object.isFrozen(callerEvidence) === false",
    `array frozen=${Object.isFrozen(callerEvidence)}, elemento frozen=${Object.isFrozen(callerEvidence[0])}`,
    Object.isFrozen(callerEvidence) === false && Object.isFrozen(callerEvidence[0]) === false,
  );
}

// ---------------------------------------------------------------------------
// D. Criterios que el revisor confirma satisfechos (contraejemplos intentados
// y fallidos). Se registran para que la ronda 2 no los reabra.
// ---------------------------------------------------------------------------
{
  // D1 criterio 2: los labels de research_verdict no entran en role_admission.
  const rejected = ["PASS", "FAIL", "INVALID"].every((v) => resolveRoleAdmissionValue(v).ok === false);
  check(
    "D1 criterio 2: PASS/FAIL/INVALID no se resuelven como outcomes de admisión por rol",
    "los tres rechazados con UNKNOWN_STATE_VALUE",
    `rechazados=${rejected}`,
    rejected && resolveRoleAdmissionValue("ADMIT").ok === true,
  );

  // D2 criterio 2/3: ADMIT en un rol no toca otro rol ni salta el gate §8.7.
  const registry = createRoleEvaluationRegistry();
  registry.registerComponent(syntheticEvaluation("SYN-D", ROLE_CLASS.ENGINEERING_ORCHESTRATION, "0.1.0"));
  registry.registerComponent(syntheticEvaluation("SYN-D", ROLE_CLASS.STRATEGY_EVIDENCE, "0.1.0"));
  registry.markEvaluationReady("SYN-D", ROLE_CLASS.ENGINEERING_ORCHESTRATION, {
    prerequisitesSatisfied: ["SYN-prereq"],
    readinessEvidence: SYN_EVIDENCE,
  });
  registry.recordOutcome("SYN-D", ROLE_CLASS.ENGINEERING_ORCHESTRATION, "ADMIT", { evidenceRefs: SYN_EVIDENCE });
  const strategy = registry.get("SYN-D", ROLE_CLASS.STRATEGY_EVIDENCE);
  check(
    "D2 criterio 2: ADMIT en Engineering deja Strategy/Evidence sin outcome",
    "outcome null y state REGISTERED",
    `outcome=${JSON.stringify(strategy.outcome)}, state=${strategy.state}`,
    strategy.outcome === null && strategy.state === "REGISTERED",
  );

  const gateless = registry.markEvaluationReady("SYN-D", ROLE_CLASS.STRATEGY_EVIDENCE, {
    prerequisitesSatisfied: ["SYN-prereq"],
    readinessEvidence: SYN_EVIDENCE,
  });
  check(
    "D3 criterio 3: Strategy/Evidence no alcanza readiness sin el gate aceptado §8.7",
    "ok=false MISSING_STRATEGY_ADMISSION_GATE",
    `ok=${gateless.ok}, code=${gateless.code}`,
    gateless.ok === false && gateless.code === "MISSING_STRATEGY_ADMISSION_GATE",
  );

  // D4 criterio 3: ningún camino devuelve autoridad productiva.
  const gov = createRoleEvaluationRegistry();
  gov.registerComponent(syntheticEvaluation("SYN-GOV", ROLE_CLASS.EXECUTION_GOVERNANCE, "0.1.0"));
  const noValidation = gov.validateRealActionPrerequisite("SYN-GOV", ROLE_CLASS.EXECUTION_GOVERNANCE, {});
  const withValidation = gov.validateRealActionPrerequisite("SYN-GOV", ROLE_CLASS.EXECUTION_GOVERNANCE, {
    authorityValidation: { accepted: true },
  });
  check(
    "D4 criterio 3: Execution/Governance exige validación separada y aun así no obtiene autoridad",
    "sin validación MISSING_AUTHORITY_VALIDATION; con validación NO_PRODUCTIVE_AUTHORITY; nunca ok=true",
    `sin=${noValidation.code}, con=${withValidation.code}, algún ok=${noValidation.ok || withValidation.ok}`,
    noValidation.code === "MISSING_AUTHORITY_VALIDATION" &&
      withValidation.code === "NO_PRODUCTIVE_AUTHORITY" &&
      noValidation.ok === false &&
      withValidation.ok === false,
  );

  // D5 criterio 4: sin rol admitido no hay elegibilidad de integración, y el
  // ADMIT de un rol nunca marca integrated.
  const integration = registry.evaluateIntegration("SYN-D");
  const emptyRegistry = createRoleEvaluationRegistry();
  emptyRegistry.registerComponent(syntheticEvaluation("SYN-E", ROLE_CLASS.ENGINEERING_ORCHESTRATION, "0.1.0"));
  const noRole = emptyRegistry.evaluateIntegration("SYN-E");
  check(
    "D5 criterio 4: elegibilidad por rol no integra; sin rol admitido NO_QUALIFYING_ROLE",
    "integrated=false en ambos; reason NO_QUALIFYING_ROLE sin ADMIT",
    `admitido: integrated=${integration.integrated} eligible=${integration.eligible} authorityGranted=${JSON.stringify(integration.authorityGranted)}; sin rol: reason=${noRole.reason} eligible=${noRole.eligible}`,
    integration.integrated === false &&
      integration.authorityGranted.length === 0 &&
      noRole.reason === "NO_QUALIFYING_ROLE" &&
      noRole.eligible === false,
  );

  // D6 criterio 4: un rol de ingeniería no puede etiquetar su valor como edge.
  const edge = registry.validateValueClaim("SYN-D", ROLE_CLASS.ENGINEERING_ORCHESTRATION, "PROCUREMENT_EDGE");
  check(
    "D6 criterio 4: Engineering no puede reclamar procurement edge",
    "ok=false PROCUREMENT_EDGE_NOT_ALLOWED",
    `ok=${edge.ok}, code=${edge.code}`,
    edge.ok === false && edge.code === "PROCUREMENT_EDGE_NOT_ALLOWED",
  );

  // D7 criterio 5: un outcome ya registrado es inmutable para esa versión.
  const immutable = registry.recordOutcome("SYN-D", ROLE_CLASS.ENGINEERING_ORCHESTRATION, "REJECT", {
    evidenceRefs: SYN_EVIDENCE,
  });
  const stillAdmit = registry.get("SYN-D", ROLE_CLASS.ENGINEERING_ORCHESTRATION).outcome.value;
  check(
    "D7 criterio 5: no se reescribe el outcome de una versión ya resuelta",
    "ok=false OUTCOME_ALREADY_RECORDED y el outcome sigue ADMIT",
    `ok=${immutable.ok}, code=${immutable.code}, outcome=${stillAdmit}`,
    immutable.ok === false && immutable.code === "OUTCOME_ALREADY_RECORDED" && stillAdmit === "ADMIT",
  );

  // D8 criterio 1/2: no hay rol por defecto; un roleClass ausente no se rellena.
  const roleless = syntheticEvaluation("SYN-F", ROLE_CLASS.ENGINEERING_ORCHESTRATION, "0.1.0");
  delete roleless.roleClass;
  const noDefault = createRoleEvaluationRegistry().registerComponent(roleless);
  check(
    "D8 criterio 1/2: sin roleClass declarado no se asigna ningún rol por defecto",
    "ok=false CONTRACT_INCOMPLETE",
    `ok=${noDefault.ok}, code=${noDefault.code}`,
    noDefault.ok === false && noDefault.code === "CONTRACT_INCOMPLETE",
  );
}

console.log(`\nreviewer-probe: ${failures} comprobación(es) fallida(s).`);
console.log(
  "Los FAIL de A1/A2/B1/C1 son los hallazgos de la ronda 1; los PASS de D delimitan lo que el revisor confirma satisfecho.",
);
process.exit(0);
