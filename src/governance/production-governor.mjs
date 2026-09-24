// Production Governance governor (IMP-24). Fuente: SPEC v1.1.1 §25.1 fila
// IMP-24 ("Materializar governance, primera activación humana y después
// progresión autorizada por fases"), §25.2 fila y nota IMP-24 (tres hitos:
// materialización del governor; primera activación A1 si se autoriza;
// promociones y actos posteriores con autoridad previa), §§16–18 (APG
// conjuntivo, niveles canónicos, primera activación, DEMOTE/HALT/ROLLBACK,
// no hot learning y receipts) y §17 (envelope externo materializado por
// IMP-23).
//
// Alcance de materialización (§25.2.3 hito 1): recepción de evidencia,
// authority checks, approval enforcement, receipts,
// promotion/demotion/halt/rollback, probando también ausencia de
// autorización y evidencia insuficiente. La primera activación real exige
// la aprobación humana explícita de DEP-25: sin ella hay HOLD, nunca
// activación (fail-closed; §18.1). Los tests sintéticos no acreditan
// resultados reales ni DEP-22/24. El governor nunca auto-modifica
// reward/gates/envelope/scope/action/benchmark/comparabilidad (§18.2,
// lista 1–7) y A4 no auto-amplía autoridad: la autoridad efectiva baja
// inmediatamente por DEMOTE/HALT y sube sólo por una PROMOTE gobernada
// con aprobación cuya autoridad no es la policy.

import { contentHashOf } from "../execution-contract/execution-contract.mjs";
import { P5_EXPERIMENT_RECEIPT_KIND } from "../p5-experiment/receipt.mjs";
import { SHADOW_NON_INTERFERENCE_VERIFIED, SHADOW_RECEIPT_KIND } from "../shadow/index.mjs";
import {
  ADMISSION_GATE_KINDS,
  AUTONOMY_LEVELS,
  envelopeVersionKeyOf,
  validateEnvelopeShape,
} from "./envelope.mjs";
import { createExternalEnvelopeController } from "./enforcement.mjs";
import { buildGovernanceReceipt, createGovernanceReceiptRegistry } from "./receipts.mjs";
import { executeRollback } from "./rollback.mjs";

export const PRODUCTION_GOVERNOR_KIND = "IMP-24_PRODUCTION_GOVERNOR";

// Receipts de evidencia consumidos por etapa (§15.1; §25.2 REQUIRES_EVIDENCE
// IMP-24: "Evidencia OOS/Shadow realmente disponible de la versión según
// §§15–18"). El governor CONSUME los receipts; no los re-declara: una sola
// verdad, los producen IMP-16 (OOS) e IMP-18 (Shadow). Las etiquetas de
// discriminación se importan del productor (corrección IMP24-SHADOW-KIND).
export const RESEARCH_RECEIPT_KIND = P5_EXPERIMENT_RECEIPT_KIND;
export const SHADOW_EVIDENCE_KIND = SHADOW_RECEIPT_KIND;
export const STAGE_RECEIPT_KINDS = { OOS: RESEARCH_RECEIPT_KIND, SHADOW: SHADOW_EVIDENCE_KIND };

// §16.1: la promoción exige la CONJUNCIÓN de los seis gates.
export const PROMOTION_GATES = ["G_validity", "G_evidence", "G_economic", "G_downside", "G_stability", "G_forward"];

// §17/§18.2: quien propone no atestúa su propia evidencia ni se concede
// autoridad (misma regla estructural que IMP-23 aplica a sus gates).
export const FORBIDDEN_AUTHORITY_ROLES = ["POLICY", "CANDIDATE_POLICY"];

// Dominios que el propio sistema de autonomía nunca auto-promueve (§18.2,
// lista 1–7). Su cambio sólo sigue la vía canónica (§20.2.12), fuera de este
// artefacto.
export const PROTECTED_GOVERNANCE_DOMAINS = [
  "GLOBAL_PROCUREMENT_REWARD",
  "ACCEPTANCE_CRITERIA",
  "SAFETY_AUTONOMY_ENVELOPE",
  "PRODUCT_CAMPAIGN_SCOPE",
  "ACTION_SPACE",
  "BENCHMARK_EVALUATION_METHODOLOGY",
  "COMPARABILITY_ASSUMPTIONS",
];

// §25.2.3 hito 2: sin la aprobación humana explícita de DEP-25 no hay
// primera activación; el gate queda HOLD y visible (fail-closed).
export const FIRST_ACTIVATION_REFUSAL_CODE = "FIRST_ACTIVATION_REQUIRES_EXPLICIT_HUMAN_APPROVAL";
export const FIRST_ACTIVATION_SCOPE = "FIRST_ACTIVATION_A1";
export const GOVERNANCE_CHANGE_SCOPE_PREFIX = "GOVERNANCE_PROMOTION";

function fail(code, message, extra = {}) {
  return { ok: false, code, message, ...extra };
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function isFinitePositiveNumber(value) {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function attributionOf(attribution) {
  if (!attribution || typeof attribution !== "object" || Array.isArray(attribution)
    || !isNonEmptyString(attribution.authority) || !isNonEmptyString(attribution.role)) {
    return null;
  }
  return { authority: attribution.authority, role: attribution.role };
}

// --- 1) Recepción y verificación de evidencia (§25.2.3 hito 1) ---

// Normaliza y valida un receipt de evidencia (IMP-16 OOS o IMP-18 Shadow):
// clase conocida, integridad content-hash verificada contra el contenido
// sellado, identidad declarada por el propio receipt y sello sintético
// conservado. Un receipt mutado o de otra clase no es evidencia. La
// elegibilidad de la versión se declara en el acto concreto (§15.3: versión
// fija); el governor no la deduce.
export function receiveGovernanceEvidence({ evidence } = {}) {
  if (!evidence || typeof evidence !== "object" || Array.isArray(evidence)) {
    return fail("MISSING_EVIDENCE", "El governor consume receipts de evidencia; sin artifact no hay evidencia (§25.2 fila IMP-24).");
  }
  const stage = Object.keys(STAGE_RECEIPT_KINDS).find((key) => STAGE_RECEIPT_KINDS[key] === evidence.receiptKind) ?? null;
  if (stage === null) {
    return fail("UNKNOWN_EVIDENCE_KIND", `Los receipts de evidencia admitidos son ${RESEARCH_RECEIPT_KIND} (OOS) y ${SHADOW_EVIDENCE_KIND} (Shadow).`);
  }
  const integrity = stage === "OOS" ? researchReceiptIntact(evidence) : shadowReceiptIntact(evidence);
  if (!integrity.ok) {
    return integrity;
  }
  const identity = stage === "OOS" ? {
    policyVersion: null,
    experiment: evidence.experiment ?? null,
    s1ConfigurationHash: evidence.s1ConfigurationHash ?? null,
  } : {
    policyVersion: typeof evidence.policyVersion === "string" ? evidence.policyVersion : null,
    experiment: evidence.experiment ?? null,
    s1ConfigurationHash: null,
  };
  const researchVerdict = stage === "OOS" ? {
    evaluated: evidence.p3ResearchEvaluation?.evaluated === true,
    verdict: evidence.p3ResearchEvaluation?.verdict ?? null,
  } : null;
  const shadowSufficiency = stage === "SHADOW" ? {
    nonInterferenceVerdict: evidence.nonInterference?.verdict ?? null,
    terminalCoverageStatus: evidence.terminalCoverage?.status ?? null,
  } : null;
  return {
    ok: true,
    evidence: Object.freeze({
      stage,
      receiptId: stage === "OOS" ? evidence.receiptId : evidence.contentHash,
      identity,
      synthetic: evidence.synthetic === true,
      researchVerdict,
      shadowSufficiency,
      intact: true,
    }),
  };
}

function researchReceiptIntact(receipt) {
  if (!isNonEmptyString(receipt.receiptId)) {
    return fail("MISSING_RECEIPT_ID", "El receipt de IMP-16 declara su receiptId content-addressed (§14.9).");
  }
  const { receiptId, ...core } = receipt;
  if (contentHashOf(core) !== receiptId) {
    return fail("RECEIPT_CONTENT_HASH_MISMATCH", "El receipt OOS residente no es el sellado: el governor no consume artefactos mutados (§25.2).");
  }
  return { ok: true };
}

function shadowReceiptIntact(receipt) {
  if (!isNonEmptyString(receipt.contentHash)) {
    return fail("MISSING_CONTENT_HASH", "El receipt Shadow declara su contentHash (IMP-18).");
  }
  const { contentHash, ...core } = receipt;
  if (contentHashOf(core) !== contentHash) {
    return fail("RECEIPT_CONTENT_HASH_MISMATCH", "El receipt Shadow residente no es el sellado: el governor no consume artefactos mutados (§25.2).");
  }
  return { ok: true };
}

// --- 2) Autonomy Promotion Gate (§16.1): authority checks conjuntivos ---

// Conjunción G_validity ∧ G_evidence ∧ G_economic ∧ G_downside ∧ G_stability
// ∧ G_forward. Fail-closed: gate no declarado, evaluación no atribuida a
// una autoridad externa, sin evidencia referenciada o gate no satisfecho →
// sin promoción. ("Ninguna dimensión fuerte compensa el incumplimiento de
// otra.") Los criterios del ascenso los declara el caller congelados; el
// governor no los inventa ni los re-wirea (§25.1: "Ascensos requieren
// criterios propios congelados"; §16: EVIDENCE-DEPENDENT).
export function evaluateAutonomyPromotionGate({ apg } = {}) {
  const reasons = [];
  if (!apg || typeof apg !== "object" || Array.isArray(apg)) {
    return { reasons: [{ code: "MISSING_APG", field: "apg", message: "Sin evaluación del APG no hay promoción (§16.1)." }] };
  }
  if (!isNonEmptyString(apg.frozenCriteriaRef)) {
    reasons.push({ code: "MISSING_FROZEN_CRITERIA", field: "apg.frozenCriteriaRef", message: "El ascenso declara sus criterios propios congelados con su referencia (§25.1)." });
  }
  const declared = Array.isArray(apg.gates) ? apg.gates : [];
  for (const gateName of PROMOTION_GATES) {
    const gate = declared.find((entry) => entry?.gate === gateName) ?? null;
    if (gate === null) {
      reasons.push({ code: "APG_GATE_MISSING", field: `apg.gates.${gateName}`, message: `El gate "${gateName}" no fue declarado: la conjunción ${PROMOTION_GATES.join(" ∧ ")} no se completa (§16.1).` });
      continue;
    }
    const evaluator = attributionOf(gate.evaluatedBy);
    if (evaluator === null || FORBIDDEN_AUTHORITY_ROLES.includes(evaluator.role)) {
      reasons.push({ code: "APG_EVALUATION_NOT_ATTRIBUTED", field: `apg.gates.${gateName}.evaluatedBy`, message: `El gate "${gateName}" declara la atribución de una evaluación externa (rol distinto de la policy); la policy no atestúa su propia promoción (§17/§18.2).` });
      continue;
    }
    if (!isNonEmptyString(gate.evidenceRef)) {
      reasons.push({ code: "APG_EVIDENCE_MISSING", field: `apg.gates.${gateName}.evidenceRef`, message: `El gate "${gateName}" declara la evidencia que lo satisface (§16.1).` });
      continue;
    }
    if (gate.satisfied !== true) {
      reasons.push({ code: "APG_GATE_NOT_SATISFIED", field: `apg.gates.${gateName}`, message: `El gate "${gateName}" no está satisfecho; ninguna dimensión fuerte compensa otra (§16.1).` });
    }
  }
  return { reasons };
}

// --- 3) Approval enforcement (§18.1/DEP-25) ---

// Aprobación de un cambio de governance (primera activación, promoción):
// referencia explícita, autoridad distinta de la policy, decisión APPROVED,
// scope del acto e instante; cambios sobre dominios protegidos (§18.2) no
// viajan por este artefacto.
function governanceApprovalProblem(approval, expectedScope) {
  if (!approval || typeof approval !== "object" || Array.isArray(approval)) {
    return { code: "MISSING_APPROVAL", message: `El acto de governance exige la aprobación explícita (${expectedScope}); el default es no autoridad (§18.1).` };
  }
  if (!isNonEmptyString(approval.approvalRef)) {
    return { code: "INVALID_APPROVAL", message: "La aprobación declara su referencia explícita (DEP-25)." };
  }
  const authority = attributionOf(approval.approvedBy);
  if (authority === null || FORBIDDEN_AUTHORITY_ROLES.includes(authority.role)) {
    return { code: "APPROVAL_BY_POLICY_FORBIDDEN", message: "La policy no se concede autoridad: la aprobación proviene de otra autoridad (§18.2)." };
  }
  if (approval.decision !== "APPROVED") {
    return { code: "APPROVAL_NOT_GRANTED", message: `La decisión registrada es "${String(approval.decision)}"; no autoriza (§18.1).` };
  }
  if (approval.scope !== expectedScope) {
    return { code: "APPROVAL_SCOPE_MISMATCH", message: `La aprobación declara scope "${String(approval.scope)}"; este acto exige "${expectedScope}" (fail-closed).` };
  }
  if (!isNonEmptyString(approval.approvedAtUtc)) {
    return { code: "INVALID_APPROVAL", message: "La aprobación declara su instante (§6.1)." };
  }
  if (Array.isArray(approval.modifiesProtectedDomains) && approval.modifiesProtectedDomains.length > 0) {
    return { code: "PROTECTED_DOMAIN_CHANGE", message: `La aprobación trae cambios sobre dominios protegidos (${approval.modifiesProtectedDomains.join(", ")}): nunca auto-promueven (§18.2); su cambio exige §20.2.12.` };
  }
  return null;
}

// §18.1/§12.2: veto, retraso o modificación se registran mediante timestamp,
// razón y provenance. Una intervención sin trazabilidad desaparecería del
// dataset; el contrato aceptado validateHumanIntervention (IMP-17) ya exige
// los cuatro campos, y aquí se aplica el mismo contrato (una sola verdad).
function interventionProvenanceProblem(approval) {
  if (!isNonEmptyString(approval.reason)) {
    return { code: "INTERVENTION_REASON_MISSING", message: "La intervención humana (veto/retraso/modificación) declara su razón (§18.1/§12.2)." };
  }
  const provenance = approval.provenance;
  if (!provenance || typeof provenance !== "object" || Array.isArray(provenance)
    || !isNonEmptyString(provenance.authority) || !isNonEmptyString(provenance.locator)) {
    return { code: "INTERVENTION_PROVENANCE_MISSING", message: "La intervención humana declara su provenance con authority y locator (§18.1/§12.2)." };
  }
  return null;
}

// Validación humana por acción real en A1 (§18.1): recomendación original,
// decisión (APPROVED/VETOED/DELAYED), timestamp, razón y provenance
// declaradas; nada se infiere por defecto. Un veto/retraso o una modificación
// de cantidad es una intervención (§12.2) y exige razón y provenance.
function perActionApprovalProblem(approval, recommendation) {
  if (!approval || typeof approval !== "object" || Array.isArray(approval)) {
    return { code: "MISSING_ACTION_APPROVAL", message: "En A1 el 100% de las acciones reales exige validación humana por acción (§18.1)." };
  }
  if (!isNonEmptyString(approval.validatedAction) || !isNonEmptyString(approval.decision) || !isNonEmptyString(approval.decidedAtUtc)) {
    return { code: "INVALID_ACTION_APPROVAL", message: "La validación declara la acción validada, su decisión e instante (§18.1)." };
  }
  const authority = attributionOf(approval.decidedBy);
  if (authority === null || FORBIDDEN_AUTHORITY_ROLES.includes(authority.role)) {
    return { code: "APPROVAL_BY_POLICY_FORBIDDEN", message: "La policy no valida sus propias recomendaciones: decide otra autoridad (§18.1)." };
  }
  if (approval.validatedAction !== recommendation.action) {
    return { code: "APPROVAL_ACTION_MISMATCH", message: `La validación humana cubre "${approval.validatedAction}", no la recomendación "${String(recommendation.action)}" (§18.1).` };
  }
  if (!["APPROVED", "VETOED", "DELAYED"].includes(approval.decision)) {
    return { code: "INVALID_ACTION_DECISION", message: "La decisión es APPROVED, VETOED o DELAYED (§18.1: intervención registrada)." };
  }
  const modifiesQuantity = isFinitePositiveNumber(approval.modifiedQuantityMw)
    && approval.modifiedQuantityMw !== recommendation.quantityMw;
  const isIntervention = approval.decision !== "APPROVED" || modifiesQuantity;
  if (isIntervention) {
    const provenanceProblem = interventionProvenanceProblem(approval);
    if (provenanceProblem) {
      return provenanceProblem;
    }
  }
  if (approval.decision !== "APPROVED") {
    return {
      code: `ACTION_${approval.decision}`,
      message: `La validación humana registró "${approval.decision}" (§18.1); no ejecuta.`,
      intervention: {
        decision: approval.decision,
        decidedAtUtc: approval.decidedAtUtc,
        reason: approval.reason ?? null,
        provenance: approval.provenance ?? null,
      },
    };
  }
  return null;
}

function registerTransition({ registry, input, failures }) {
  const built = buildGovernanceReceipt(input);
  if (!built.ok) {
    failures.push(built);
    return null;
  }
  const registered = registry.register({ receipt: built.receipt });
  if (!registered.ok) {
    failures.push(registered);
    return null;
  }
  return built.receipt;
}

// --- 4) Governor (§16–§18) ---

export function createProductionGovernor({ envelope, atUtc } = {}) {
  const shapeCheck = validateEnvelopeShape(envelope);
  if (!shapeCheck.ok) {
    return { ok: false, code: "INVALID_ENVELOPE", errors: shapeCheck.errors, message: "El governor sólo opera el envelope congelado válido (§17)." };
  }
  if (!isNonEmptyString(atUtc)) {
    return { ok: false, code: "MISSING_TIMESTAMP", message: "El governor opera actos temporizados: declara atUtc (§6.1)." };
  }
  if (!AUTONOMY_LEVELS.includes(envelope.autonomyLevel)) {
    return { ok: false, code: "INVALID_AUTONOMY_LEVEL", message: "El nivel de autonomía del envelope es desconocido; fail-closed (§16.2)." };
  }
  const externalController = createExternalEnvelopeController({ envelope, atUtc });
  if (!externalController.ok) {
    return externalController;
  }
  // El enforcement externo de IMP-23 expone la comprobación estructural;
  // aquí queda ligado a una sola referencia para una sola verdad.
  const enforcement = {
    controller: externalController.controller,
    authorizeAction: externalController.authorizeAction,
    mandateHardGateTransition: externalController.mandateHardGateTransition,
    activeEnvelopeSnapshot: externalController.activeEnvelopeSnapshot,
  };
  const envelopeVersionKey = envelopeVersionKeyOf(envelope);
  const registry = createGovernanceReceiptRegistry();
  const internalFailures = [];

  // Estado operacional: baja inmediatamente por DEMOTE/HALT (§16.2:
  // "autonomy can increase slowly, but decrease immediately"); sube sólo
  // por PROMOTE gobernada. El envelope congelado no se muta.
  const state = { level: envelope.autonomyLevel, status: "ACTIVE", lastHaltingMandate: null };

  function authorizationProblem(policyVersion) {
    const authorization = Array.isArray(envelope.authorizedPolicyVersions)
      ? envelope.authorizedPolicyVersions.find((entry) => entry.policyVersion === policyVersion) ?? null
      : null;
    if (authorization === null) {
      return { code: "POLICY_VERSION_NOT_AUTHORIZED", message: `La Policy Version "${String(policyVersion)}" no está autorizada por este envelope (§17).` };
    }
    if (authorization.status !== "VALID") {
      return { code: "POLICY_VERSION_RETIRED", message: `"${policyVersion}" está RETIRED: haber sido aprobada en el pasado no basta (§18.3).` };
    }
    return null;
  }

  // Etiqueta humana de los receipts: ninguna Policy Version activa queda
  // implícita — la lista es la de autorizaciones VALID del envelope (§17)/
  // una sola verdad consumida, no re-declarada.
  function stateLabel() {
    const versions = Array.isArray(envelope.authorizedPolicyVersions)
      ? envelope.authorizedPolicyVersions.filter((entry) => entry?.status === "VALID").map((entry) => entry.policyVersion)
      : [];
    return versions.join("|") || "SIN_VERSION_AUTORIZADA";
  }

  // --- Hito 2: primera activación A1, si se autoriza (§18.1) ---

  // A diferencia de un ascenso posterior (considerSubsequentPromotion), la
  // primera activación NO se limita al nivel que concede el envelope: §18.1 la
  // hace depender de la aprobación humana explícita de DEP-25, que es la
  // autoridad del acto. El envelope recibido es el de investigación previo
  // (p.ej. A0) y el receipt documenta la autoridad del nivel A1 vía
  // approvalRef + envelopeVersionKey, de forma reconstruible (§18.4).
  function considerFirstActivation({ policyVersion, oosPolicyVersion, oosEvidence, shadowEvidence, apg, humanApproval, atUtc } = {}) {
    if (!isNonEmptyString(atUtc)) {
      return fail("MISSING_TIMESTAMP", "La activación declara su instante (§6.1).");
    }
    if (!isNonEmptyString(policyVersion)) {
      return fail("MISSING_POLICY_VERSION", "La primera activación declara la Policy Version (§15.3: versión fija).");
    }
    const humanApprovalFailure = governanceApprovalProblem(humanApproval, FIRST_ACTIVATION_SCOPE);
    if (humanApprovalFailure) {
      const holdReceiptId = holdFirstActivation({ triggerEvidenceRef: humanApprovalFailure.code, policyVersion, atUtc });
      return { ok: false, authorized: false, code: FIRST_ACTIVATION_REFUSAL_CODE, message: humanApprovalFailure.message, transitionReceiptId: holdReceiptId };
    }
    const problem = authorizationProblem(policyVersion);
    if (problem) {
      const holdReceiptId = holdFirstActivation({ triggerEvidenceRef: `${problem.code}:${policyVersion}`, policyVersion, atUtc });
      return { ok: false, authorized: false, code: problem.code, message: problem.message, transitionReceiptId: holdReceiptId };
    }
    const evidenceCheck = eligibleEvidence({ policyVersion, oosPolicyVersion, oosEvidence, shadowEvidence, atUtc });
    if (!evidenceCheck.ok) {
      return evidenceCheck;
    }
    const apgCheck = evaluateAutonomyPromotionGate({ apg });
    if (apgCheck.reasons.length > 0) {
      const holdReceiptId = holdFirstActivation({ triggerGate: "G_AUTONOMY_PROMOTION", triggerEvidenceRef: "APG_NOT_SATISFIED", policyVersion, atUtc });
      return fail("APG_NOT_SATISFIED", "El APG aplicable no está satisfecho: no hay promoción (§16.1).", { reasons: apgCheck.reasons, transitionReceiptId: holdReceiptId });
    }

    const activation = {
      artifactKind: "IMP-24_FIRST_ACTIVATION_RECORD",
      policyVersion,
      fromLevel: "A0",
      toLevel: "A1",
      humanApprovalScope: FIRST_ACTIVATION_SCOPE,
      approvalRef: humanApproval.approvalRef,
      approvedBy: { authority: humanApproval.approvedBy.authority, role: humanApproval.approvedBy.role },
      oosReceiptId: evidenceCheck.evidence.OOS.receiptId,
      shadowReceiptId: evidenceCheck.evidence.SHADOW.receiptId,
      synthetic: evidenceCheck.synthetic,
      apgFrozenCriteriaRef: apg.frozenCriteriaRef,
      envelopeVersionKey,
      activatedAtUtc: atUtc,
      note: "Primera activación A1 (§18.1): en A1 el 100% de las acciones reales exige validación humana por acción. Un record con evidencia sintética es una demostración de mecanismo y no acredita evidencia real (§25.2).",
    };
    activation.activationId = contentHashOf(activation);
    state.level = "A1";
    const promoteReceiptId = registerTransition({
      registry,
      input: {
        transitionType: "PROMOTE",
        triggerGate: "G_DEP25_FIRST_ACTIVATION",
        triggerEvidenceRef: humanApproval.approvalRef,
        previousState: `${policyVersion}@A0`,
        newState: `${policyVersion}@A1`,
        autonomyLevel: "A1",
        envelopeVersionKey,
        atUtc,
      },
      failures: internalFailures,
    })?.receiptId ?? null;
    return {
      ok: true,
      status: "ACTIVATED",
      activation: Object.freeze({ ...activation }),
      transitionReceiptId: promoteReceiptId,
      evidence: evidenceCheck.evidence,
    };
  }

  function holdFirstActivation({ triggerGate = "G_DEP25_FIRST_ACTIVATION", triggerEvidenceRef, policyVersion, atUtc }) {
    const held = registerTransition({
      registry,
      input: {
        transitionType: "HOLD",
        triggerGate,
        triggerEvidenceRef,
        previousState: `${policyVersion}@A0`,
        newState: `${policyVersion}@A1:HELD`,
        autonomyLevel: state.level,
        envelopeVersionKey,
        atUtc,
      },
      failures: internalFailures,
    });
    return held?.receiptId ?? null;
  }

  // §18.1: Research PASS/OOS válido y Shadow satisfactorio aportan evidencia
  // necesaria; la primera activación exige ambas evidencias intactas y
  // ligadas a UNA sola identidad de versión, con el veredicto de research
  // declarado. Ninguna etapa silencia la otra.
  function eligibleEvidence({ oosEvidence, shadowEvidence, oosPolicyVersion, policyVersion, atUtc }) {
    const receivedOos = receiveGovernanceEvidence({ evidence: oosEvidence });
    if (!receivedOos.ok) {
      const holdReceiptId = holdFirstActivation({
        triggerEvidenceRef: `${receivedOos.code}:STAGE_OOS`,
        policyVersion,
        atUtc,
      });
      return fail(receivedOos.code, `Evidencia OOS insuficiente: ${receivedOos.message}`, { stage: "OOS", transitionReceiptId: holdReceiptId });
    }
    if (!receivedOos.evidence.researchVerdict.evaluated || receivedOos.evidence.researchVerdict.verdict !== "PASS") {
      const verdict = receivedOos.evidence.researchVerdict.verdict ?? "SIN_EVALUAR";
      const holdReceiptId = holdFirstActivation({
        triggerEvidenceRef: `OOS_EVIDENCE_NOT_ELIGIBLE:${verdict}`,
        policyVersion,
        atUtc,
      });
      return fail("OOS_EVIDENCE_NOT_ELIGIBLE", `La evidencia OOS no es elegible (verdict = ${verdict}); un veredicto FAIL/HOLD no soporta activación (§18.1).`, { stage: "OOS", transitionReceiptId: holdReceiptId });
    }
    const receivedShadow = receiveGovernanceEvidence({ evidence: shadowEvidence });
    if (!receivedShadow.ok) {
      const holdReceiptId = holdFirstActivation({
        triggerEvidenceRef: `${receivedShadow.code}:STAGE_SHADOW`,
        policyVersion,
        atUtc,
      });
      return fail(receivedShadow.code, `Evidencia Shadow insuficiente: ${receivedShadow.message}`, { stage: "SHADOW", transitionReceiptId: holdReceiptId });
    }
    // §18.1: "Shadow satisfactorio" no es un statement auto-attribuido: el
    // receipt del productor IMP-18 declara non-interference verificada y
    // cobertura terminal COVERED; el governor las importa del productor
    // (una sola verdad) y las exige conjuntivamente.
    const shadowSufficiency = receivedShadow.evidence.shadowSufficiency;
    if (shadowSufficiency === null
      || shadowSufficiency.nonInterferenceVerdict !== SHADOW_NON_INTERFERENCE_VERIFIED
      || shadowSufficiency.terminalCoverageStatus !== "COVERED") {
      const holdReceiptId = holdFirstActivation({
        triggerEvidenceRef: `SHADOW_EVIDENCE_NOT_ELIGIBLE:${shadowSufficiency?.nonInterferenceVerdict ?? "SIN_DECLARAR"}:${shadowSufficiency?.terminalCoverageStatus ?? "SIN_DECLARAR"}`,
        policyVersion,
        atUtc,
      });
      return fail("SHADOW_EVIDENCE_NOT_ELIGIBLE", `La evidencia Shadow no es satisfactoria (nonInterference = ${shadowSufficiency?.nonInterferenceVerdict ?? "SIN_DECLARAR"}, terminalCoverage = ${shadowSufficiency?.terminalCoverageStatus ?? "SIN_DECLARAR"}); un Shadow no verificado o sin cobertura no soporta activación (§18.1).`, { stage: "SHADOW", transitionReceiptId: holdReceiptId });
    }
    // §25.2.3 hito 2: OOS y Shadow deben pertenecer a UNA sola identidad de
    // versión, que incluye el experimento. Declarar el mismo policyVersion con
    // experimentos distintos no es la misma versión.
    const oosExperiment = receivedOos.evidence.identity.experiment;
    const shadowExperiment = receivedShadow.evidence.identity.experiment;
    if (oosExperiment === null || shadowExperiment === null
      || contentHashOf(oosExperiment) !== contentHashOf(shadowExperiment)) {
      return fail("EVIDENCE_VERSION_MISMATCH", `Las etapas OOS y Shadow no comparten la identidad de experimento (OOS ${JSON.stringify(oosExperiment)} vs Shadow ${JSON.stringify(shadowExperiment)}): una sola identidad de versión (§15/§25.2.3 hito 2).`);
    }
    if (isNonEmptyString(oosPolicyVersion) && oosPolicyVersion !== receivedShadow.evidence.identity.policyVersion) {
      return fail("EVIDENCE_VERSION_MISMATCH", `Las etapas declaran versiones distintas (OOS "${oosPolicyVersion}" vs Shadow "${receivedShadow.evidence.identity.policyVersion}"): una sola identidad de versión (§15).`);
    }
    if (receivedShadow.evidence.identity.policyVersion !== policyVersion) {
      return fail("SHADOW_EVIDENCE_VERSION_MISMATCH", `La evidencia Shadow pertenece a "${String(receivedShadow.evidence.identity.policyVersion)}", no a "${policyVersion}" (§25.2 DEP-22).`);
    }
    return {
      ok: true,
      evidence: { OOS: receivedOos.evidence, SHADOW: receivedShadow.evidence },
      synthetic: receivedOos.evidence.synthetic || receivedShadow.evidence.synthetic,
    };
  }

  // --- Approval enforcement A1: 100% acciones reales con validación humana
  // por acción (§18.1); el enforcement externo del envelope sigue mandando. ---

  function authorizeRealAction({ action, policyVersion, quantityMw, dataState, humanApproval, atUtc } = {}) {
    if (!isNonEmptyString(atUtc)) {
      return fail("MISSING_TIMESTAMP", "El acto real declara su instante (§6.1).");
    }
    if (state.status !== "ACTIVE") {
      return fail("GOVERNOR_STATE_HALTED", `El estado operacional es ${state.status}: ningún acto se autoriza hasta otra decisión de governance (§18.3).`);
    }
    const recommendation = { action: action ?? null, policyVersion: policyVersion ?? null, quantityMw: quantityMw ?? null };
    if (action === "BUY" && state.level === "A1") {
      const approvalFailure = perActionApprovalProblem(humanApproval, recommendation);
      if (approvalFailure) {
        return { ok: true, authorized: false, code: approvalFailure.code, message: approvalFailure.message, recommendation, intervention: approvalFailure.intervention ?? null };
      }
      const decidedQuantityMw = isFinitePositiveNumber(humanApproval.modifiedQuantityMw) ? humanApproval.modifiedQuantityMw : recommendation.quantityMw;
      const modification = isFinitePositiveNumber(humanApproval.modifiedQuantityMw) && humanApproval.modifiedQuantityMw !== recommendation.quantityMw
        ? { kind: "QUANTITY_MODIFIED", from: recommendation.quantityMw, to: humanApproval.modifiedQuantityMw }
        : null;
      // El enforcement externo comprueba la acción decidida ANTES de
      // execution (§17); la validación humana no sustituye al envelope.
      // Único motivo filtrable: LEVEL_WITHOUT_BUY_AUTHORITY — §16.2 deja el
      // nivel A1 con autoridad de COMPRA EXCLUSIVAMENTE vía validación
      // humana por acción (§18.1), expresamente fuera del controller
      // IMP-23; el caller ya aportó aquí esa validación binada. Cualquier
      // otro rechazo del envelope manda.
      const structural = enforcement.authorizeAction({ action, policyVersion, quantityMw: decidedQuantityMw, dataState, envelopeVersionKey });
      const onlyLevelRefusal = structural.reasons != null
        && structural.reasons.length > 0
        && structural.reasons.every((reason) => reason.code === "LEVEL_WITHOUT_BUY_AUTHORITY");
      if (structural.authorized !== true && !onlyLevelRefusal) {
        return fail("ENVELOPE_REJECTION", "El enforcement externo del envelope rechazó el acto; no se ejecuta (§17).", { reasons: structural.reasons, recommendation });
      }
      const record = {
        artifactKind: "IMP-24_GOVERNED_ACTION_RECORD",
        recommendation: { action: recommendation.action, policyVersion: recommendation.policyVersion, quantityMw: recommendation.quantityMw },
        humanApprovalAction: {
          decision: humanApproval.decision,
          decidedBy: { authority: humanApproval.decidedBy.authority, role: humanApproval.decidedBy.role },
          decidedAtUtc: humanApproval.decidedAtUtc,
          reason: humanApproval.reason ?? null,
          provenance: humanApproval.provenance ?? null,
        },
        modification,
        // §18.1: el outcome modificado no se atribuye a la recomendación
        // original sin corrección; la intervención queda con timestamp/razón.
        modifiedOutcomeAttributableToRecommendation: modification === null,
        authorizedAction: action,
        authorizedQuantityMw: decidedQuantityMw,
        envelopeVersionKey,
        atUtc,
      };
      record.actionRecordId = contentHashOf(record);
      return { ok: true, authorized: true, action: Object.freeze({ ...record }) };
    }
    // Niveles operativos con límites (A2+): la decisión estructural del
    // enforcement externo del envelope manda sola (§17).
    const structural = enforcement.authorizeAction({ action, policyVersion, quantityMw, dataState, envelopeVersionKey });
    const result = { ok: true, authorized: structural.authorized, status: structural.status };
    if (structural.authorized !== true) {
      result.reasons = structural.reasons;
    }
    return result;
  }

  // --- Hito 3: promociones posteriores, DEMOTE/HALT/ROLLBACK (§18.2/§18.3) ---

  function considerSubsequentPromotion({ targetLevel, apg, governanceChangeApproval, atUtc } = {}) {
    if (!isNonEmptyString(atUtc)) {
      return fail("MISSING_TIMESTAMP", "La promoción declara su instante (§6.1).");
    }
    if (!AUTONOMY_LEVELS.includes(targetLevel)) {
      return fail("INVALID_TARGET_LEVEL", `El nivel objetivo debe ser canónico (${AUTONOMY_LEVELS.join(", ")}; §16.2).`);
    }
    if (levelIndex(targetLevel) <= levelIndex(state.level)) {
      return fail("TARGET_LEVEL_NOT_ASCENT", `El nivel vigente es ${state.level}: una PROMOTE sólo sube un nivel (§16.2).`);
    }
    if (levelIndex(targetLevel) !== levelIndex(state.level) + 1) {
      return fail("LEVEL_STEP_TOO_LARGE", "La autonomía puede aumentar lentamente: la progresión es por fases, un nivel por ascenso (§16.2/§25.1).");
    }
    const apgCheck = evaluateAutonomyPromotionGate({ apg });
    if (apgCheck.reasons.length > 0) {
      const holdReceiptId = holdPromotion({ targetLevel, triggerGate: "G_AUTONOMY_PROMOTION", triggerEvidenceRef: "APG_NOT_SATISFIED", atUtc });
      return { ok: false, authorized: false, code: "APG_NOT_SATISFIED", message: "El APG no está satisfecho para el ascenso (§16.1).", transitionReceiptId: holdReceiptId };
    }
    const approvalFailure = governanceApprovalProblem(governanceChangeApproval, `${GOVERNANCE_CHANGE_SCOPE_PREFIX}:${targetLevel}`);
    if (approvalFailure) {
      const holdReceiptId = holdPromotion({ targetLevel, triggerGate: "G_DEP25_GOVERNANCE_CHANGE", triggerEvidenceRef: approvalFailure.code, atUtc });
      return { ok: false, authorized: false, code: approvalFailure.code, message: approvalFailure.message, transitionReceiptId: holdReceiptId };
    }
    // §17/§18.2: el envelope declara la autoridad/nivel ("Authorized Policy
    // Version / autonomy level"). Un ascenso a un nivel que el envelope no
    // autoriza es un cambio de governance que exige un envelope nuevo
    // (§20.2.12); el governor nunca lo auto-amplía. Sin esto el receipt
    // registraría un autonomyLevel que el envelopeVersionKey no respalda.
    if (levelIndex(targetLevel) > levelIndex(envelope.autonomyLevel)) {
      return fail("TARGET_LEVEL_NOT_AUTHORIZED_BY_ENVELOPE", `El envelope "${String(envelope.envelopeVersion)}" autoriza hasta ${envelope.autonomyLevel}; ${targetLevel} exigiría un nuevo envelope (§17/§18.2).`);
    }
    const fromLevel = state.level;
    state.level = targetLevel;
    const promoteReceiptId = registerTransition({
      registry,
      input: {
        transitionType: "PROMOTE",
        triggerGate: "G_DEP25_GOVERNANCE_CHANGE",
        triggerEvidenceRef: governanceChangeApproval.approvalRef,
        previousState: `${stateLabel()}@${fromLevel}`,
        newState: `${stateLabel()}@${targetLevel}`,
        autonomyLevel: targetLevel,
        envelopeVersionKey,
        atUtc,
      },
      failures: internalFailures,
    })?.receiptId ?? null;
    return { ok: true, authorized: true, status: "PROMOTED", fromLevel, toLevel: targetLevel, transitionReceiptId: promoteReceiptId };
  }

  function holdPromotion({ targetLevel, triggerGate, triggerEvidenceRef, atUtc }) {
    const held = registerTransition({
      registry,
      input: {
        transitionType: "HOLD",
        triggerGate,
        triggerEvidenceRef,
        previousState: `${stateLabel()}@${state.level}`,
        newState: `${stateLabel()}@${targetLevel}:HELD`,
        autonomyLevel: state.level,
        envelopeVersionKey,
        atUtc,
      },
      failures: internalFailures,
    });
    return held?.receiptId ?? null;
  }

  // Hard-gate failure (§18.3): DEMOTE baja un nivel y HALT detiene la
  // operación, INMEDIATAMENTE, sin esperar aprobación humana y sin
  // consentimiento de la policy (IMP-23: el mandato no admite veto).
  function applyHardGateMandate({ gateId, evidenceRef, requestedTransition, atUtc } = {}) {
    if (!isNonEmptyString(atUtc)) {
      return fail("MISSING_TIMESTAMP", "El mandato declara su instante (§6.1).");
    }
    const mandateOutcome = enforcement.mandateHardGateTransition({ gateId, evidenceRef, requestedTransition });
    if (!mandateOutcome.ok) {
      return mandateOutcome;
    }
    const mandate = mandateOutcome.mandate;
    if (mandate.transition === "DEMOTE") {
      const fromLevel = state.level;
      const toLevel = AUTONOMY_LEVELS[Math.max(levelIndex(fromLevel) - 1, 0)];
      state.level = toLevel;
      const receiptId = registerTransition({
        registry,
        input: {
          transitionType: "DEMOTE",
          triggerGate: `HARD_GATE:${gateId}`,
          triggerEvidenceRef: evidenceRef,
          previousState: `${stateLabel()}@${fromLevel}`,
          newState: `${stateLabel()}@${toLevel}`,
          autonomyLevel: toLevel,
          envelopeVersionKey,
          atUtc,
        },
        failures: internalFailures,
      })?.receiptId ?? null;
      return { ok: true, transition: "DEMOTE", fromLevel, toLevel, transitionReceiptId: receiptId, mandate };
    }
    state.status = "HALTED";
    state.lastHaltingMandate = mandate;
    const receiptId = registerTransition({
      registry,
      input: {
        transitionType: "HALT",
        triggerGate: `HARD_GATE:${gateId}`,
        triggerEvidenceRef: evidenceRef,
        previousState: `${stateLabel()}@${state.level}`,
        newState: `${stateLabel()}@${state.level}:HALTED`,
        autonomyLevel: state.level,
        envelopeVersionKey,
        atUtc,
      },
      failures: internalFailures,
    })?.receiptId ?? null;
    return { ok: true, transition: "HALT", status: state.status, transitionReceiptId: receiptId, mandate };
  }

  // Rollback del mandato de hard-gate (§18.3): destino = última Policy
  // Version válida bajo el envelope actual; sin versión válida → baseline
  // autorizado o safe non-action state declarado; sin nada → bloqueo
  // operacional explícito. El rollback restaura una versión y vuelve a
  // estado activo con el MISMO nivel vigente: nunca auto-amplía autoridad.
  function executeHaltingRollback({ policyVersionHistory, atUtc } = {}) {
    if (!isNonEmptyString(atUtc)) {
      return fail("MISSING_TIMESTAMP", "El rollback declara su instante (§6.1).");
    }
    if (state.status !== "HALTED" || state.lastHaltingMandate === null) {
      return fail("NO_ACTIVE_HALT", "El rollback ejecuta el mandato de un hard-gate HALT registrado; sin halt pendiente no hay rollback (§18.3).");
    }
    const resolved = executeRollback({ mandate: state.lastHaltingMandate, envelope, policyVersionHistory, atUtc });
    if (!resolved.ok) {
      return { ok: false, code: resolved.code, message: resolved.message, pendingOperationsFallback: resolved.pendingOperationsFallback === true };
    }
    const target = resolved.rollback.target;
    const receiptId = registerTransition({
      registry,
      input: {
        transitionType: "ROLLBACK",
        triggerGate: `HARD_GATE:${state.lastHaltingMandate.gateId}`,
        triggerEvidenceRef: state.lastHaltingMandate.evidenceRef,
        previousState: `${stateLabel()}@${state.level}:HALT`,
        newState: target.destination === "POLICY_VERSION" ? `${target.policyVersion}@${state.level}` : `${target.destination}:${state.level}`,
        autonomyLevel: state.level,
        envelopeVersionKey,
        atUtc,
      },
      failures: internalFailures,
    })?.receiptId ?? null;
    state.status = "ACTIVE";
    state.lastHaltingMandate = null;
    return { ok: true, rollback: resolved.rollback, transitionReceiptId: receiptId, restoredLevel: state.level, status: state.status };
  }

  function levelIndex(level) {
    return AUTONOMY_LEVELS.indexOf(level);
  }

  return {
    ok: true,
    governor: Object.freeze({
      kind: PRODUCTION_GOVERNOR_KIND,
      envelopeVersionKey,
      constructedAtUtc: atUtc,
    }),
    // El estado se consulta; no promete autoridad: cada acto se decide en el
    // punto donde procede y se registra con receipts reconstruibles (§18.4).
    currentState() {
      return Object.freeze({
        level: state.level,
        status: state.status,
        lastHaltingMandate: state.lastHaltingMandate,
      });
    },
    receiptRegistry: registry,
    considerFirstActivation,
    authorizeRealAction,
    considerSubsequentPromotion,
    applyHardGateMandate,
    executeHaltingRollback,
    internalFailures,
  };
}
