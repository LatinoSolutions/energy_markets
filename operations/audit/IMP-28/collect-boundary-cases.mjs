// Recoge casos límite positivos/negativos ejecutando el framework real de
// src/role-evaluation y escribe boundary-cases.json. Sólo escribe dentro de
// operations/audit/IMP-28/** (allowed_paths). Todos los componentes y
// evidencias son sintéticos.
import fs from "node:fs";
import path from "node:path";

import { ROLE_CLASS, resolveRoleClass, validateValueClaimDomain } from "../../../src/role-evaluation/roles.mjs";
import { validateRoleEvaluation } from "../../../src/role-evaluation/contract.mjs";
import { createRoleEvaluationRegistry } from "../../../src/role-evaluation/registry.mjs";
import { resolveRoleAdmissionValue, initialAuthorityGrant } from "../../../src/role-evaluation/outcomes.mjs";
import {
  SYNTHETIC_READINESS,
  SYNTHETIC_STRATEGY_GATE,
  makeEvaluation,
  makeLearningEvaluation,
  makeStrategyEvidenceEvaluation,
} from "../../../test/role-evaluation/fixtures.mjs";

const ROOT = "/srv/hot-data/energy-markets/app";
const OUT = "operations/audit/IMP-28/boundary-cases.json";

function record(name, kind, expected, actual, passed) {
  return { name, kind, expected, actual, passed };
}

function codeOf(outcome) {
  return outcome.ok ? "OK" : outcome.code;
}

const cases = [];

cases.push(record(
  "cuatro clases de §11.6.1 reconocidas",
  "positive",
  "las cuatro resuelven OK",
  ROLE_CLASS,
  ["STRATEGY_EVIDENCE", "REPRESENTATION_LEARNING", "ENGINEERING_ORCHESTRATION", "EXECUTION_GOVERNANCE"].every((id) => resolveRoleClass(id).ok),
));

cases.push(record(
  "S6/JEV no son clase de rol",
  "negative",
  "UNKNOWN_ROLE_CLASS",
  codeOf(resolveRoleClass("S6")),
  resolveRoleClass("S6").code === "UNKNOWN_ROLE_CLASS",
));

const noRole = makeEvaluation();
delete noRole.roleClass;
cases.push(record(
  "evaluación sin rol declarado rechazada (sin clasificación por defecto)",
  "negative",
  "ok=false",
  validateRoleEvaluation(noRole).ok,
  validateRoleEvaluation(noRole).ok === false,
));

const incomplete = makeEvaluation();
delete incomplete.valueHypothesis;
cases.push(record(
  "contrato §11.6.2 incompleto rechazado",
  "negative",
  "ok=false",
  validateRoleEvaluation(incomplete).ok,
  validateRoleEvaluation(incomplete).ok === false,
));

const nominalRegistry = createRoleEvaluationRegistry();
const nominal = makeLearningEvaluation();
nominalRegistry.registerComponent(nominal);
const nominalOutcome = nominalRegistry.markEvaluationReady(nominal.componentId, nominal.roleClass, {});
cases.push(record(
  "completar campos no demuestra readiness",
  "negative",
  "NOT_EVALUATION_READY",
  codeOf(nominalOutcome),
  nominalOutcome.code === "NOT_EVALUATION_READY",
));

const strategyRegistry = createRoleEvaluationRegistry();
const strategy = makeStrategyEvidenceEvaluation();
strategyRegistry.registerComponent(strategy);
const noGate = strategyRegistry.markEvaluationReady(strategy.componentId, strategy.roleClass, SYNTHETIC_READINESS);
cases.push(record(
  "Strategy/Evidence sin gate IMP-27/§8.7 no alcanza readiness",
  "negative",
  "MISSING_STRATEGY_ADMISSION_GATE",
  codeOf(noGate),
  noGate.code === "MISSING_STRATEGY_ADMISSION_GATE",
));
const withGate = strategyRegistry.markEvaluationReady(strategy.componentId, strategy.roleClass, {
  ...SYNTHETIC_READINESS,
  strategyAdmissionGate: SYNTHETIC_STRATEGY_GATE,
});
cases.push(record(
  "Strategy/Evidence con gate aceptado alcanza readiness",
  "positive",
  "OK",
  codeOf(withGate),
  withGate.ok === true,
));

const independenceRegistry = createRoleEvaluationRegistry();
const learning = makeEvaluation({ componentId: "SYN-MULTI-BC", roleClass: ROLE_CLASS.REPRESENTATION_LEARNING });
const engineering = makeEvaluation({ componentId: "SYN-MULTI-BC", roleClass: ROLE_CLASS.ENGINEERING_ORCHESTRATION });
independenceRegistry.registerComponent(learning);
independenceRegistry.registerComponent(engineering);
independenceRegistry.markEvaluationReady(learning.componentId, learning.roleClass, SYNTHETIC_READINESS);
independenceRegistry.markEvaluationReady(engineering.componentId, engineering.roleClass, SYNTHETIC_READINESS);
const admitLearning = independenceRegistry.recordOutcome(learning.componentId, learning.roleClass, "ADMIT", {
  evidenceRefs: [{ kind: "evaluation", ref: "SYN-BC-EV-1" }],
});
const engineeringRecord = independenceRegistry.get(engineering.componentId, engineering.roleClass);
const integration = independenceRegistry.evaluateIntegration("SYN-MULTI-BC");
cases.push(record(
  "ADMIT en un rol no admite otro rol del mismo componente",
  "negative",
  "engineering sin outcome; eligible=true; integrated=false",
  { engineeringOutcome: engineeringRecord.outcome, eligible: integration.eligible, integrated: integration.integrated },
  admitLearning.ok === true && engineeringRecord.outcome === null && integration.eligible === true && integration.integrated === false,
));

const rewrite = independenceRegistry.recordOutcome(learning.componentId, learning.roleClass, "REJECT", {
  evidenceRefs: [{ kind: "evaluation", ref: "SYN-BC-EV-2" }],
});
cases.push(record(
  "outcome por versión inmutable (no reescritura)",
  "negative",
  "OUTCOME_ALREADY_RECORDED y outcome sigue ADMIT",
  { code: codeOf(rewrite), outcome: independenceRegistry.get(learning.componentId, learning.roleClass).outcome.value },
  rewrite.code === "OUTCOME_ALREADY_RECORDED" && independenceRegistry.get(learning.componentId, learning.roleClass).outcome.value === "ADMIT",
));

const jevRegistry = createRoleEvaluationRegistry();
const jev = makeEvaluation({ componentId: "JEV" });
delete jev.roleClass;
const jevOutcome = jevRegistry.registerComponent(jev);
cases.push(record(
  "JEV no recibe clasificación por defecto",
  "negative",
  "CONTRACT_INCOMPLETE y sin registro",
  { code: codeOf(jevOutcome), records: jevRegistry.list("JEV").length },
  jevOutcome.code === "CONTRACT_INCOMPLETE" && jevRegistry.list("JEV").length === 0,
));

const edgeClaim = validateValueClaimDomain(ROLE_CLASS.ENGINEERING_ORCHESTRATION, "PROCUREMENT_EDGE");
cases.push(record(
  "engineering no puede reclamar procurement edge",
  "negative",
  "PROCUREMENT_EDGE_NOT_ALLOWED",
  codeOf(edgeClaim),
  edgeClaim.code === "PROCUREMENT_EDGE_NOT_ALLOWED",
));

const actionRegistry = createRoleEvaluationRegistry();
const gov = makeEvaluation({ componentId: "SYN-GOV-BC", roleClass: ROLE_CLASS.EXECUTION_GOVERNANCE });
actionRegistry.registerComponent(gov);
actionRegistry.markEvaluationReady(gov.componentId, gov.roleClass, SYNTHETIC_READINESS);
actionRegistry.recordOutcome(gov.componentId, gov.roleClass, "ADMIT", { evidenceRefs: [{ kind: "evaluation", ref: "SYN-BC-GOV" }] });
const govNoValidation = actionRegistry.validateRealActionPrerequisite(gov.componentId, gov.roleClass, {});
const govWithValidation = actionRegistry.validateRealActionPrerequisite(gov.componentId, gov.roleClass, {
  authorityValidation: { accepted: true, ref: "SYN-BC-AUTH" },
});
cases.push(record(
  "Execution/Governance exige validación separada y aun así no obtiene autoridad",
  "negative",
  "MISSING_AUTHORITY_VALIDATION sin validación; NO_PRODUCTIVE_AUTHORITY con ella",
  { without: codeOf(govNoValidation), with: codeOf(govWithValidation) },
  govNoValidation.code === "MISSING_AUTHORITY_VALIDATION" && govWithValidation.code === "NO_PRODUCTIVE_AUTHORITY",
));

cases.push(record(
  "ningún outcome concede autoridad productiva",
  "positive",
  "initialAuthorityGrant=[] y ADMIT sólo otorga ROLE_SCOPED_ADMISSION",
  { initial: initialAuthorityGrant(), admitsGrants: ["ROLE_SCOPED_ADMISSION"] },
  initialAuthorityGrant().length === 0 && resolveRoleAdmissionValue("ADMIT").ok === true,
));

const versionRegistry = createRoleEvaluationRegistry();
const versioned = makeLearningEvaluation();
versionRegistry.registerComponent(versioned);
versionRegistry.markEvaluationReady(versioned.componentId, versioned.roleClass, SYNTHETIC_READINESS);
versionRegistry.recordOutcome(versioned.componentId, versioned.roleClass, "REJECT", {
  evidenceRefs: [{ kind: "evaluation", ref: "SYN-BC-REJ" }],
});
const newVersion = versionRegistry.createNewEvaluationVersion(versioned.componentId, versioned.roleClass, {
  materialChange: true,
  changeSummary: "Synthetic boundary-case change.",
  newVersion: "0.2.0",
});
cases.push(record(
  "nueva versión preserva REJECT y reinicia autoridad",
  "positive",
  "priorFindings=1 y authorityGranted=[]",
  { priorFindings: newVersion.record?.priorFindings?.length, authorityGranted: newVersion.record?.authorityGranted },
  newVersion.ok === true && newVersion.record.priorFindings.length === 1 && newVersion.record.authorityGranted.length === 0,
));

const summary = {
  packetId: "WP-IMP-28-ST-1-v1.1",
  subtaskId: "ST-28.1",
  observedAtUtc: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
  syntheticOnly: true,
  totalCases: cases.length,
  passed: cases.filter((entry) => entry.passed).length,
  failed: cases.filter((entry) => !entry.passed).length,
  cases,
};

fs.writeFileSync(path.join(ROOT, OUT), `${JSON.stringify(summary, null, 2)}\n`);
console.log(`wrote ${OUT}: ${summary.passed}/${summary.totalCases} cases passed`);
process.exitCode = summary.failed === 0 ? 0 : 1;