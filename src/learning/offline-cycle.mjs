// Ciclo offline de aprendizaje (IMP-19). Fuente: SPEC v1.1.1 §11.5 (ciclo
// canónico: operar/reproducir una Policy Version congelada; registrar
// Experience con provenance; cerrar la ventana/campaña; Review/Learning
// offline; producir una nueva Candidate Policy Version; revalidarla mediante
// OOS/Shadow congelado; promover/mantener/rechazar/degradar según governance;
// "La policy activa no se reescribe online... cambios... crean nueva versión"),
// §12.3 (todas las rutas de Experience hacia cambios de policy pasan por el
// ciclo offline y versionado), §15.4 (todo cambio crea nueva Candidate Policy
// Version que pasa de nuevo por OOS/Shadow y governance) y §25.2.3 IMP-19
// ("Antes de entrenar/evaluar una candidate concreta deben existir datos reales
// adecuados y la configuración/protocolo aplicables deben estar congelados y
// autorizados"; "Si el support es insuficiente o la prueba refuta al learner,
// se registra el resultado").
//
// El ciclo NO activa la versión: sólo produce la candidate revalidada. La
// activación real pertenece a governance (IMP-24) y a la primera activación
// humana explícita. La Policy Version activa del holder NUNCA se muta aquí.
// El scope SYNTHETIC_FIXTURE permite materializar la ingeniería declarando que
// no cierra DEP-19/20/21 ni demuestra edge; REAL_DATA exige auditoría/PIT y
// datos adecuados.

import { contentHashOf } from "../execution-contract/execution-contract.mjs";
import { validateExperienceRecordShape, ARTIFACT_KIND } from "../experience/index.mjs";
import { validateRewardConfiguration, REWARD_CONFIG_STATES } from "./reward.mjs";
import { assertProtocolFrozenBeforeEvaluation } from "./protocol.mjs";

export const CANDIDATE_POLICY_KIND = "CANDIDATE_POLICY_VERSION";

// Los siete pasos canónicos de §11.5, declarados para trazabilidad del ciclo.
export const CYCLE_STEPS = Object.freeze([
  { step: 1, id: "OPERATE_FROZEN_VERSION", description: "Operar o reproducir una Policy Version congelada." },
  { step: 2, id: "REGISTER_EXPERIENCE", description: "Registrar Experience con provenance." },
  { step: 3, id: "CLOSE_WINDOW", description: "Cerrar la ventana/campaña de evaluación pertinente." },
  { step: 4, id: "OFFLINE_REVIEW_LEARNING", description: "Review / Learning offline." },
  { step: 5, id: "PRODUCE_CANDIDATE", description: "Producir una nueva Candidate Policy Version." },
  { step: 6, id: "REVALIDATE", description: "Revalidar mediante el proceso congelado OOS / Shadow." },
  { step: 7, id: "GOVERNANCE_OUTCOME", description: "Promover, mantener en HOLD, rechazar o degradar según governance.", owner: "IMP-24" },
]);

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

// REQUIRES_EVIDENCE (§25.2 IMP-19): el ciclo consume Experience válida
// realmente disponible con provenance/support observable. Se revalida la forma
// de cada registro; corpus ausente o inválido es fail-closed (no se fabrica).
export function assertExperienceCorpus({ corpus = null } = {}) {
  if (!Array.isArray(corpus) || corpus.length === 0) {
    return { ok: false, code: "MISSING_EXPERIENCE_CORPUS", message: "El ciclo offline exige un corpus de Experience no vacío (§25.2 IMP-19 REQUIRES_EVIDENCE)." };
  }
  const failures = [];
  for (const [index, record] of corpus.entries()) {
    if (!record || record.artifactKind !== ARTIFACT_KIND) {
      failures.push({ index, code: "NOT_EXPERIENCE_RECORD", message: "El corpus sólo contiene artifacts EXPERIENCE_RECORD (§12.2)." });
      continue;
    }
    const shape = validateExperienceRecordShape(record);
    if (!shape.ok) {
      failures.push({ index, code: "INVALID_EXPERIENCE_RECORD", errors: shape.errors });
    }
  }
  if (failures.length > 0) {
    return { ok: false, code: "INVALID_EXPERIENCE_CORPUS", failures };
  }
  return { ok: true, length: corpus.length };
}

// Gates antes de entrenar/evaluar una candidate concreta (§25.2.3 IMP-19):
// auditoría/PIT y derechos del corpus, datos reales adecuados (sólo REAL_DATA),
// reward global congelado, protocolo DEP-21 congelado e integridad, y support
// suficiente. SYNTHETIC_FIXTURE se declara fixtureOnly: materializa la
// ingeniería sin cerrar dependencias ni acreditar datos del cliente.
export function evaluateLearningGates({ corpus = null, corpusAudit = null, rewardConfig = null, protocol = null, supportEvaluation = null, evaluatedAtUtc = null } = {}) {
  const reasons = [];
  if (!corpusAudit || typeof corpusAudit !== "object" || Array.isArray(corpusAudit)) {
    return { ok: false, fixtureOnly: false, reasons: [{ code: "MISSING_CORPUS_AUDIT", message: "El corpus de Experience consumido exige audit/PIT y derechos válidos (§25.2 IMP-19 REQUIRES_AUDIT)." }] };
  }
  const corpusCheck = assertExperienceCorpus({ corpus });
  if (!corpusCheck.ok) {
    reasons.push({ code: corpusCheck.code, message: corpusCheck.message ?? "El corpus de Experience no es válido.", failures: corpusCheck.failures ?? null });
  }
  if (corpusAudit.scope !== "SYNTHETIC_FIXTURE" && corpusAudit.scope !== "REAL_DATA") {
    reasons.push({ code: "INVALID_CORPUS_SCOPE", message: "corpusAudit.scope sólo toma SYNTHETIC_FIXTURE o REAL_DATA." });
  }
  const fixtureOnly = corpusAudit.scope === "SYNTHETIC_FIXTURE";
  if (!isNonEmptyString(corpusAudit.sourceRef)) {
    reasons.push({ code: "MISSING_CORPUS_SOURCE", message: "El audit del corpus cita su fuente/provenance (§25.2)." });
  }
  if (corpusAudit.scope === "REAL_DATA") {
    if (corpusAudit.auditPitRightsValid !== true) {
      reasons.push({ code: "CORPUS_AUDIT_INVALID", message: "REQUIRES_AUDIT: audit/PIT y derechos válidos del corpus consumido no están satisfechos (§25.2 IMP-19)." });
    }
    if (corpusAudit.realDataAdequate !== true) {
      reasons.push({ code: "REAL_DATA_NOT_ADEQUATE", message: "Antes de entrenar/evaluar una candidate concreta deben existir datos reales adecuados (§25.2.3 IMP-19)." });
    }
  }
  const rewardValidation = validateRewardConfiguration(rewardConfig);
  if (!rewardValidation.ok) {
    reasons.push({ code: "REWARD_CONFIG_INVALID", message: "La configuración del reward no satisface §10.", errors: rewardValidation.errors });
  } else if (rewardConfig.state !== REWARD_CONFIG_STATES.FROZEN) {
    reasons.push({ code: "REWARD_CONFIG_NOT_FROZEN", message: "El reward aplicable debe estar congelado y autorizado antes de evaluar una candidate (§25.2.3 IMP-19)." });
  }
  const protocolGuard = assertProtocolFrozenBeforeEvaluation({ protocol, evaluatedAtUtc });
  if (!protocolGuard.ok) {
    reasons.push({ code: protocolGuard.code, message: protocolGuard.message });
  }
  if (!supportEvaluation || typeof supportEvaluation !== "object" || supportEvaluation.sufficient !== true) {
    reasons.push({ code: "SUPPORT_NOT_SUFFICIENT", message: "El support/estado no es suficiente para evaluar la candidate: se registra el resultado, no se inventa suficiencia (§25.2.3 IMP-19)." });
  }
  return { ok: reasons.length === 0, fixtureOnly, reasons };
}

// §11.5 paso 5: produce una Candidate Policy Version NUEVA (distinta de la
// activa) con linaje de la versión que la origina. No la activa.
export function produceCandidatePolicyVersion({ activeVersionHolder = null, candidateVersion = null, basedOnCorpusHash = null, learnerComparison = null, producedAtUtc = null, provenance = null } = {}) {
  if (!activeVersionHolder || typeof activeVersionHolder.current !== "function") {
    return { ok: false, code: "MISSING_ACTIVE_HOLDER", message: "El ciclo parte de la Policy Version activa (§11.5)." };
  }
  const activeVersion = activeVersionHolder.current();
  if (!isNonEmptyString(candidateVersion)) {
    return { ok: false, code: "MISSING_CANDIDATE_VERSION", message: "El ciclo produce una versión declarada (§11.5)." };
  }
  if (candidateVersion === activeVersion) {
    return { ok: false, code: "CANDIDATE_EQUALS_ACTIVE", message: "Un cambio de policy crea versión nueva; re-declarar la activa no es un cambio (§11.5)." };
  }
  if (learnerComparison === null || typeof learnerComparison !== "object" || learnerComparison.ok !== true) {
    return { ok: false, code: "MISSING_LEARNER_COMPARISON", message: "La candidate se produce desde una comparación learner/baseline evaluada (§25.1 IMP-19)." };
  }
  if (!provenance || typeof provenance !== "object" || !isNonEmptyString(provenance.kind)) {
    return { ok: false, code: "MISSING_PROVENANCE", message: "La candidate conserva provenance del corpus y del learner (§12.3)." };
  }
  const core = {
    artifactKind: CANDIDATE_POLICY_KIND,
    schemaVersion: "1.0",
    candidateVersion,
    basedOnActiveVersion: activeVersion,
    basedOnCorpusHash: basedOnCorpusHash ?? null,
    learnerSelectedByMerit: learnerComparison.selectedByMerit === true,
    learnerRefuted: learnerComparison.refuted === true,
    producedAtUtc: producedAtUtc ?? null,
    provenance,
  };
  core.contentHash = contentHashOf(core);
  return { ok: true, candidate: Object.freeze(core) };
}

// §11.5 paso 6 / §15.4: la candidate pasa de nuevo por OOS/Shadow congelado.
// Sin evidencia válida referenciada, la candidate queda en HOLD (no se
// promociona y no toca la versión activa).
export function revalidateCandidate({ candidate = null, revalidation = null } = {}) {
  if (!candidate || candidate.artifactKind !== CANDIDATE_POLICY_KIND) {
    return { ok: false, code: "MISSING_CANDIDATE", message: "La revalidación se aplica a una Candidate Policy Version producida por el ciclo (§11.5)." };
  }
  if (!revalidation || typeof revalidation !== "object" || Array.isArray(revalidation)) {
    return { ok: false, code: "MISSING_REVALIDATION", message: "La candidate exige revalidación OOS/Shadow congelada (§11.5 paso 6)." };
  }
  const errors = [];
  if (!isNonEmptyString(revalidation.processRef)) {
    errors.push({ code: "MISSING_PROCESS_REF", message: "La revalidación cita el proceso congelado aplicado (§15.2)." });
  }
  if (revalidation.mode !== "OOS" && revalidation.mode !== "SHADOW") {
    errors.push({ code: "INVALID_REVALIDATION_MODE", message: "La revalidación es OOS o SHADOW (§15.1)." });
  }
  if (!isNonEmptyString(revalidation.evaluatedAtUtc)) {
    errors.push({ code: "MISSING_EVALUATED_AT", message: "La revalidación lleva timestamp (§12.2)." });
  }
  if (!isNonEmptyString(revalidation.evidenceRef)) {
    errors.push({ code: "MISSING_EVIDENCE_REF", message: "La evidencia válida se referencia; no se declara sin ella (§25.1 IMP-19)." });
  }
  if (typeof revalidation.evidenceValid !== "boolean") {
    errors.push({ code: "MISSING_EVIDENCE_VALIDITY", message: "La revalidación declara si su evidencia es válida (§25.1 IMP-19)." });
  }
  if (errors.length > 0) {
    return { ok: false, code: "INVALID_REVALIDATION", errors };
  }
  const revalidated = revalidation.evidenceValid === true;
  return {
    ok: true,
    revalidated,
    verdict: revalidation.verdict ?? (revalidated ? "REVALIDATED" : "HOLD"),
    mode: revalidation.mode,
    processRef: revalidation.processRef,
    evidenceRef: revalidation.evidenceRef,
    evaluatedAtUtc: revalidation.evaluatedAtUtc,
  };
}

// Ejecuta el ciclo offline completo delegando la promoción real a governance
// (IMP-24). Devuelve los pasos, la candidate, la revalidación y si la versión
// activa permaneció intacta. La activación NO ocurre aquí.
export function runOfflineLearningCycle({ activeVersionHolder = null, corpus = null, corpusAudit = null, rewardConfig = null, supportEvaluation = null, protocol = null, candidateVersion = null, learnerComparison = null, revalidation = null, producedAtUtc = null, evaluatedAtUtc = null, provenance = null } = {}) {
  if (!activeVersionHolder || typeof activeVersionHolder.current !== "function") {
    return { ok: false, code: "MISSING_ACTIVE_HOLDER", message: "El ciclo offline parte de la versión activa (§11.5)." };
  }
  const activeVersionBefore = activeVersionHolder.current();
  const steps = [];

  steps.push({ ...CYCLE_STEPS[0], executed: true, activeVersionBefore });
  steps.push({ ...CYCLE_STEPS[1], executed: true, corpusLength: Array.isArray(corpus) ? corpus.length : null });
  steps.push({ ...CYCLE_STEPS[2], executed: true });
  steps.push({ ...CYCLE_STEPS[3], executed: true });

  const gates = evaluateLearningGates({ corpus, corpusAudit, rewardConfig, protocol, supportEvaluation, evaluatedAtUtc });
  if (!gates.ok) {
    steps.push({ ...CYCLE_STEPS[3], executed: false, note: "Gates no satisfechos: el Review/Learning no produce candidate." });
    const activeVersionAfter = activeVersionHolder.current();
    return {
      ok: false,
      code: "LEARNING_GATES_NOT_SATISFIED",
      reasons: gates.reasons,
      fixtureOnly: gates.fixtureOnly,
      steps,
      activeVersionBefore,
      activeVersionAfter,
      activeVersionUnchanged: activeVersionBefore === activeVersionAfter,
    };
  }

  const corpusHash = Array.isArray(corpus) ? contentHashOf(corpus) : null;
  const produced = produceCandidatePolicyVersion({
    activeVersionHolder,
    candidateVersion,
    basedOnCorpusHash: corpusHash,
    learnerComparison,
    producedAtUtc,
    provenance,
  });
  if (!produced.ok) {
    steps.push({ ...CYCLE_STEPS[4], executed: false });
    const activeVersionAfter = activeVersionHolder.current();
    return {
      ok: false,
      code: produced.code,
      message: produced.message,
      steps,
      activeVersionBefore,
      activeVersionAfter,
      activeVersionUnchanged: activeVersionBefore === activeVersionAfter,
    };
  }
  steps.push({ ...CYCLE_STEPS[4], executed: true, candidateVersion: produced.candidate.candidateVersion, candidateHash: produced.candidate.contentHash });

  const revalidationOutcome = revalidateCandidate({ candidate: produced.candidate, revalidation });
  if (!revalidationOutcome.ok) {
    steps.push({ ...CYCLE_STEPS[5], executed: false });
    const activeVersionAfter = activeVersionHolder.current();
    return {
      ok: false,
      code: revalidationOutcome.code,
      errors: revalidationOutcome.errors,
      steps,
      candidate: produced.candidate,
      activeVersionBefore,
      activeVersionAfter,
      activeVersionUnchanged: activeVersionBefore === activeVersionAfter,
    };
  }
  steps.push({ ...CYCLE_STEPS[5], executed: true, revalidated: revalidationOutcome.revalidated });

  const outcome = revalidationOutcome.revalidated
    ? (gates.fixtureOnly ? "CANDIDATE_REVALIDATED_FIXTURE_ONLY" : "CANDIDATE_REVALIDATED")
    : "HOLD";
  steps.push({ ...CYCLE_STEPS[6], executed: true, outcome, activationOwner: "IMP-24" });

  const activeVersionAfter = activeVersionHolder.current();
  return {
    ok: true,
    code: "OFFLINE_LEARNING_CYCLE_COMPLETED",
    fixtureOnly: gates.fixtureOnly,
    steps,
    gates,
    candidate: produced.candidate,
    revalidation: revalidationOutcome,
    outcome,
    promotionRecommended: revalidationOutcome.revalidated,
    activeVersionBefore,
    activeVersionAfter,
    activeVersionUnchanged: activeVersionBefore === activeVersionAfter,
    note: gates.fixtureOnly
      ? "Scope SYNTHETIC_FIXTURE: la revalidación es de ingeniería y NO cierra DEP-19/20/21 ni demuestra edge ni datos del cliente."
      : "La candidate revalidada queda recomendada para governance (IMP-24); la activación real exige aprobación/autoridad propias.",
  };
}

