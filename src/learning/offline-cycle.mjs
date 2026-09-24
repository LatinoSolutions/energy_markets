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
  } else {
    // §11.5 paso 3: la ventana/campaña de evaluación pertinente se CIERRA
    // antes del Review/Learning offline. El cierre deriva del corpus mismo
    // (records CLOSED, §12.2), no de un testigo declarado a mano.
    const openRecordIndices = [];
    for (const [index, record] of corpus.entries()) {
      if (record.recordState !== "CLOSED") {
        openRecordIndices.push(index);
      }
    }
    if (openRecordIndices.length > 0) {
      reasons.push({ code: "EVALUATION_WINDOW_NOT_CLOSED", message: "§11.5 paso 3: el Review/Learning offline sólo opera sobre la ventana/campaña cerrada; hay Experience records OPEN en el corpus (§12.2: el outcome sólo existe al cierre).", openRecordIndices });
    }
  }
  if (corpusAudit.scope !== "SYNTHETIC_FIXTURE" && corpusAudit.scope !== "REAL_DATA") {
    reasons.push({ code: "INVALID_CORPUS_SCOPE", message: "corpusAudit.scope sólo toma SYNTHETIC_FIXTURE o REAL_DATA." });
  }
  // IMP19-R2 (revisión 2026-09-24): el calificador fixtureOnly deriva del
  // corpus mismo (cotejo de la marca synthetic de los records) y no sólo del
  // scope declarado en corpusAudit. Un record marcado synthetic (§25.2 nota
  // IMP-17) es siempre fixture.
  const syntheticRecordIndices = Array.isArray(corpus)
    ? corpus.reduce((indices, record, index) => (record?.synthetic === true ? (indices.push(index), indices) : indices), [])
    : [];
  const fixtureOnly = corpusAudit.scope === "SYNTHETIC_FIXTURE" || syntheticRecordIndices.length > 0;
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
    // IMP19-R2 (revisión 2026-09-24): REAL_DATA no acepta records synthetic —
    // un corpus sintético bajo scope declarado real es mezcla de fuerza
    // probatoria (§12.3; §25.2 nota IMP-17: "casos sintéticos no ... generan
    // Real Experience").
    if (syntheticRecordIndices.length > 0) {
      reasons.push({ code: "REAL_DATA_WITH_SYNTHETIC_RECORDS", message: "REAL_DATA no acepta Experience records marcados synthetic:true (§25.2 nota IMP-17; cotejo IMP19-R2).", syntheticRecordIndices });
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
  // A testigo declarado true se exige binding verificable al proceso/artefacto
  // congelado (§25.1 IMP-19: la calidad no se atestúa a mano; §15.2). Sin él,
  // la candidate queda HOLD, nunca revalidada.
  let revalidated = revalidation.evidenceValid === true;
  let binding = null;
  if (revalidated) {
    binding = verifyEvidenceBinding({ candidate, revalidation });
    if (!binding.verified) {
      revalidated = false;
    }
  } else {
    binding = { verified: false, reasons: [{ code: "EVIDENCE_NOT_DECLARED_VALID", message: "El testigo declara la evidencia no válida; la revalidación no se produce (§25.1 IMP-19)." }] };
  }
  return {
    ok: true,
    revalidated,
    // IMP19-R1 (revisión 2026-09-24): el verdict se deriva del binding
    // verificable (§25.1 IMP-19: la calidad no se atestúa a mano); el input
    // del caller nunca lo fija.
    verdict: revalidated ? "REVALIDATED" : "HOLD",
    mode: revalidation.mode,
    processRef: revalidation.processRef,
    evidenceRef: revalidation.evidenceRef,
    evaluatedAtUtc: revalidation.evaluatedAtUtc,
    binding,
    // Marca real/synthetic declarada en la evidencia bindida (IMP19-R2):
    // el ciclo la coteja para fijar el calificador FIXTURE_ONLY del outcome.
    evidenceFixtureOnly: revalidation.evidence?.fixtureOnly === true,
  };
}

function isContentAddressedArtifact(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  if (typeof value.contentHash !== "string" || value.contentHash.length !== 64) return false;
  const { contentHash, ...core } = value;
  return contentHashOf(core) === contentHash;
}

// Artefacto del proceso OOS/Shadow congelado ex-ante (§15.2) que la
// revalidación cita. Su integridad y identidad son content-addressed: el
// binding no se atestúa a mano, se re-deriva (patrón de
// gateResearchEvaluationAgainstFrozen, §13.6 regla 5).
export function freezeOosShadowProcessArtifact({ processRef = null, mode = null, frozenAtUtc = null, declaredBy = null } = {}) {
  const errors = [];
  if (!isNonEmptyString(processRef)) {
    errors.push({ field: "processRef", code: "MISSING_PROCESS_REF" });
  }
  if (mode !== "OOS" && mode !== "SHADOW") {
    errors.push({ field: "mode", code: "INVALID_REVALIDATION_MODE" });
  }
  if (!isNonEmptyString(frozenAtUtc)) {
    errors.push({ field: "frozenAtUtc", code: "MISSING_FROZEN_AT_UTC" });
  }
  if (!isNonEmptyString(declaredBy)) {
    errors.push({ field: "declaredBy", code: "MISSING_DECLARED_BY" });
  }
  if (errors.length > 0) {
    return { ok: false, errors };
  }
  const core = {
    artifactKind: "IMP-19_FROZEN_OOS_SHADOW_PROCESS",
    schemaVersion: "1.0",
    processRef,
    mode,
    state: "FROZEN",
    frozenAtUtc,
    declaredBy,
  };
  core.contentHash = contentHashOf(core);
  return { ok: true, process: Object.freeze(core) };
}

// Evidencia producida al aplicar el proceso congelado a una candidate
// concreta: bindía por hash al proceso y a la candidate y lleva su marca
// real/synthetic (§25.1 IMP-19: la validez no se declara, se bindia al
// artefacto congelado; el calificador FIXTURE_ONLY del outcome se deriva de
// esa marca, IMP19-R2).
export function materializeRevalidationEvidence({ process = null, candidate = null, evidenceRef = null, producedAtUtc = null, fixtureOnly } = {}) {
  const errors = [];
  if (!isContentAddressedArtifact(process) || process.artifactKind !== "IMP-19_FROZEN_OOS_SHADOW_PROCESS") {
    errors.push({ field: "process", code: "MISSING_FROZEN_PROCESS_ARTIFACT" });
  }
  if (!candidate || candidate.artifactKind !== CANDIDATE_POLICY_KIND) {
    errors.push({ field: "candidate", code: "MISSING_CANDIDATE" });
  }
  if (!isNonEmptyString(evidenceRef)) {
    errors.push({ field: "evidenceRef", code: "MISSING_EVIDENCE_REF" });
  }
  // IMP19-R2 (revisión 2026-09-24): la marca real/synthetic es declarada por
  // quien ejecutó el proceso y queda sellada en el hash de la evidencia.
  if (typeof fixtureOnly !== "boolean") {
    errors.push({ field: "fixtureOnly", code: "MISSING_REAL_MARK", message: "La evidencia declara si fue producida sobre datos sintéticos (fixture) o reales (§25.2.3 IMP-19; IMP19-R2)." });
  }
  if (errors.length > 0) {
    return { ok: false, errors };
  }
  const core = {
    artifactKind: "IMP-19_REVALIDATION_EVIDENCE",
    schemaVersion: "1.0",
    evidenceRef,
    processRef: process.processRef,
    processContentHash: process.contentHash,
    candidateContentHash: candidate.contentHash,
    mode: process.mode,
    fixtureOnly,
    producedAtUtc: producedAtUtc ?? null,
  };
  core.contentHash = contentHashOf(core);
  return { ok: true, evidence: Object.freeze(core) };
}

// Verifica el binding declarativo→proceso→candidate; devuelve las razones de
// fallo explícitas. La validez de la evidencia nunca se atestúa a mano:
// sin binding verificable no existe "revalidated" (§25.1 IMP-19/§15.2).
function verifyEvidenceBinding({ candidate, revalidation }) {
  const reasons = [];
  const process = revalidation.frozenProcess;
  if (!process || typeof process !== "object" || process.artifactKind !== "IMP-19_FROZEN_OOS_SHADOW_PROCESS") {
    reasons.push({ code: "EVIDENCE_PROCESS_MALFORMED", message: "El proceso congelado citado no es el artefacto IMP-19_FROZEN_OOS_SHADOW_PROCESS (§15.2)." });
    return { verified: false, reasons };
  }
  if (typeof process.contentHash !== "string" || process.contentHash.length !== 64) {
    reasons.push({ code: "EVIDENCE_PROCESS_MALFORMED", message: "El proceso congelado citado no lleva identidad content-addressed (§15.2)." });
    return { verified: false, reasons };
  }
  const { contentHash, ...coreProcess } = process;
  if (contentHashOf(coreProcess) !== process.contentHash) {
    reasons.push({ code: "EVIDENCE_PROCESS_HASH_MISMATCH", message: "El proceso referenciado fue alterado: no gobierna la revalidación (§15.2)." });
    return { verified: false, reasons };
  }
  if (process.state !== "FROZEN" || !isNonEmptyString(process.frozenAtUtc)) {
    reasons.push({ code: "EVIDENCE_PROCESS_NOT_FROZEN", message: "El proceso de revalidación debe estar FROZEN ex-ante (§15.2)." });
  }
  if (isNonEmptyString(process.frozenAtUtc) && isNonEmptyString(revalidation.evaluatedAtUtc) && revalidation.evaluatedAtUtc < process.frozenAtUtc) {
    reasons.push({ code: "EVIDENCE_PROCESS_FROZEN_AFTER_EVALUATION", message: "El proceso se congeló después de la evaluación que cita (§15.2)." });
  }
  if (process.processRef !== revalidation.processRef) {
    reasons.push({ code: "EVIDENCE_PROCESS_NOT_REFERENCED", message: "processRef no coincide con el proceso congelado aportado (§15.2)." });
  }
  if (process.mode !== revalidation.mode) {
    reasons.push({ code: "EVIDENCE_MODE_MISMATCH", message: "El modo OOS/SHADOW no coincide con el del proceso congelado (§15.1)." });
  }
  let evidence = revalidation.evidence ?? null;
  // IMP19-R2 (revisión 2026-09-24): el binding no materializa la evidencia que
  // verifica. La evidencia la produce `materializeRevalidationEvidence` quien
  // ejecutó el proceso congelado; si no se aporta, la revalidación no existe
  // (§15.2/§25.1 IMP-19: la calidad no se atestúa a mano ni se auto-fabrica).
  if (evidence === null || evidence === undefined) {
    reasons.push({ code: "EVIDENCE_NOT_PROVIDED", message: "La evidencia de la revalidación no está presente: quien ejecutó el proceso congelado la produce con materializeRevalidationEvidence; el binding no la fabrica (§15.2/§25.1 IMP-19)." });
    return { verified: false, reasons };
  }
  if (!evidence || typeof evidence !== "object" || evidence.artifactKind !== "IMP-19_REVALIDATION_EVIDENCE") {
    reasons.push({ code: "EVIDENCE_ARTIFACT_MALFORMED", message: "La evidencia referenciada no es el artefacto IMP-19_REVALIDATION_EVIDENCE (§25.1 IMP-19)." });
    return { verified: false, reasons };
  }
  if (!isContentAddressedArtifact(evidence)) {
    reasons.push({ code: "EVIDENCE_HASH_MISMATCH", message: "La evidencia no es re-derivable: fue alterada o nunca se produjo del proceso referenciado (§25.1 IMP-19)." });
    return { verified: false, reasons };
  }
  const { contentHash: evidenceHash, ...coreEvidence } = evidence;
  if (contentHashOf(coreEvidence) !== evidenceHash) {
    reasons.push({ code: "EVIDENCE_HASH_MISMATCH", message: "La evidencia fue alterada después de producirse (§25.1 IMP-19)." });
  }
  if (typeof evidence.fixtureOnly !== "boolean") {
    // IMP19-R2 (revisión 2026-09-24): la evidencia lleva su marca
    // real/synthetic; sin ella el calificador FIXTURE_ONLY no es derivable.
    reasons.push({ code: "EVIDENCE_REAL_MARK_MISSING", message: "La evidencia declara su marca fixtureOnly (real vs sintética) para el calificador del outcome (§25.2.3 IMP-19; IMP19-R2)." });
  }
  if (evidence.processContentHash !== process.contentHash) {
    reasons.push({ code: "EVIDENCE_NOT_BOUND_TO_PROCESS", message: "La evidencia no bindía al proceso congelado referenciado: su validez no es verificable (§25.1 IMP-19)." });
  }
  if (evidence.processRef !== revalidation.processRef) {
    reasons.push({ code: "EVIDENCE_PROCESS_REF_MISMATCH", message: "La evidencia cita un processRef distinto de la revalidación (§25.1 IMP-19)." });
  }
  if (evidence.candidateContentHash !== candidate.contentHash) {
    reasons.push({ code: "EVIDENCE_NOT_BOUND_TO_CANDIDATE", message: "La evidencia no bindía a esta Candidate Policy Version (§25.1 IMP-19)." });
  }
  if (evidence.evidenceRef !== revalidation.evidenceRef) {
    reasons.push({ code: "EVIDENCE_REF_MISMATCH", message: "evidenceRef no coincide con la evidencia aportada (§25.1 IMP-19)." });
  }
  return { verified: reasons.length === 0, reasons };
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
  // §11.5 paso 3: el cierre de la ventana/campaña se reporta tal como está
  // derivado del corpus, no declarado por decreto.
  const corpusLength = Array.isArray(corpus) ? corpus.length : null;
  const closedRecords = corpusLength === null ? null : corpus.filter((record) => record?.recordState === "CLOSED").length;
  const windowClosed = corpusLength !== null && closedRecords === corpusLength;
  steps.push({ ...CYCLE_STEPS[2], executed: windowClosed, closedRecords, openRecords: corpusLength === null || closedRecords === null ? null : corpusLength - closedRecords });

  const gates = evaluateLearningGates({ corpus, corpusAudit, rewardConfig, protocol, supportEvaluation, evaluatedAtUtc });
  if (!gates.ok) {
    // IMP19-R4 (revisión 2026-09-24): el paso 4 se registra UNA sola vez, con
    // estado consistente y la razón del fallo (ventana abierta u otros gates).
    steps.push({ ...CYCLE_STEPS[3], executed: false, note: windowClosed
      ? "Gates no satisfechos: el Review/Learning no produce candidate."
      : "Ventana/campaña no cerrada (§11.5 paso 3): el Review/Learning no produce candidate." });
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
  steps.push({ ...CYCLE_STEPS[3], executed: true });

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

  // IMP19-R3 (revisión 2026-09-24): la refutación del learner por mérito
  // (§25.1 IMP-19 "Q-learning compite por mérito"; §25.2.3 IMP-19 "si la
  // prueba refuta al learner, se registra el resultado") NO produce
  // recomendación de promoción: el outcome es LEARNER_REFUTED (HOLD). El
  // outcome puede seguir siendo fixtureOnly-qualified si el corpus/evidencia
  // lo son: un resultado refutado sobre fixtures no ingresa a governance como
  // si fuera real. La activación real pertenece a governance (IMP-24); aquí
  // sólo se registra el resultado del ciclo.
  // IMP19-R2 (revisión 2026-09-24): el calificador FIXTURE_ONLY del outcome
  // deriva del scope declarado del corpus, del cotejo de records synthetic y
  // de la marca fixtureOnly sellada en la evidencia bindida: corpus o
  // evidencia sintéticos no producen CANDIDATE_REVALIDATED sin el calificador
  // FIXTURE_ONLY.
  const fixtureQualifier = gates.fixtureOnly || revalidationOutcome.evidenceFixtureOnly === true;
  const learnerRefuted = produced.candidate.learnerRefuted === true;
  const outcome = !revalidationOutcome.revalidated
    ? "HOLD"
    : learnerRefuted
      ? (fixtureQualifier ? "LEARNER_REFUTED_FIXTURE_ONLY" : "LEARNER_REFUTED")
      : (fixtureQualifier ? "CANDIDATE_REVALIDATED_FIXTURE_ONLY" : "CANDIDATE_REVALIDATED");
  steps.push({ ...CYCLE_STEPS[6], executed: true, outcome, activationOwner: "IMP-24" });

  const activeVersionAfter = activeVersionHolder.current();
  return {
    ok: true,
    code: "OFFLINE_LEARNING_CYCLE_COMPLETED",
    fixtureOnly: fixtureQualifier,
    steps,
    gates,
    candidate: produced.candidate,
    revalidation: revalidationOutcome,
    outcome,
    learnerRefuted,
    // IMP19-R3: la revalidación de evidencia no recomienda promoción de un
    // learner refutado por mérito (§25.1/§25.2.3 IMP-19).
    promotionRecommended: revalidationOutcome.revalidated && !learnerRefuted,
    activeVersionBefore,
    activeVersionAfter,
    activeVersionUnchanged: activeVersionBefore === activeVersionAfter,
    note: learnerRefuted
      ? (fixtureQualifier
        ? "La comparación por mérito refuta al learner (§25.2.3 IMP-19): se registra el resultado sin recomendación de promoción. Fixtures/scope sintético: es ejecución de ingeniería y NO cierra DEP-19/20/21 ni demuestra edge ni datos del cliente."
        : "La comparación por mérito refuta al learner (§25.2.3 IMP-19): se registra el resultado; la candidate NO queda recomendada para promoción (governance/IMP-24 decide).")
      : (fixtureQualifier
        ? "Fixtures/scope sintético: la revalidación es de ingeniería y NO cierra DEP-19/20/21 ni demuestra edge ni datos del cliente."
        : "La candidate revalidada queda recomendada para governance (IMP-24); la activación real exige aprobación/autoridad propias."),
  };
}

