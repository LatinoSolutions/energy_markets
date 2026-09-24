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
//
// La autoridad real está ligada a la Policy Version CONCRETA que la obtuvo por
// un acto gobernado (primera activación o promoción de versión), no a un
// booleano global ni a la mera presencia VALID en el envelope: una versión
// posterior se promociona sólo si vuelve a cumplir todos los Promotion Gates
// congelados y deja receipt que nombra la versión anterior y la nueva (§18.2,
// §18.4, §25.2.3 hito 3).
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
// §18.2: la autoridad de una Policy Version posterior no se hereda de otra
// versión VALID del envelope; se concede por un acto gobernado propio
// (revalidación OOS/Shadow + APG) cuyo scope se declara.
export const POLICY_VERSION_PROMOTION_SCOPE_PREFIX = "POLICY_VERSION_PROMOTION";
// §18.2/§18.4: una versión sin acto gobernado no ejerce autoridad real.
export const POLICY_VERSION_WITHOUT_REAL_AUTHORITY = "POLICY_VERSION_WITHOUT_REAL_AUTHORITY";

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
  // §18.1/§12.2: una cantidad modificada declarada pero inválida (cero,
  // negativa, no numérica) no se descarta en silencio — eso convertiría una
  // reducción humana declarada en "sin modificación" y atribuiría a la
  // recomendación un outcome alterado. Fail-closed: se rechaza el acto; para
  // no comprar, la decisión es VETOED, no una cantidad inválida.
  const declaredModifiedQuantity = approval.modifiedQuantityMw;
  const declaredModification = declaredModifiedQuantity !== undefined && declaredModifiedQuantity !== null;
  if (declaredModification && !isFinitePositiveNumber(declaredModifiedQuantity)) {
    return { code: "INVALID_MODIFIED_QUANTITY", message: "La cantidad modificada declarada debe ser un número MW positivo; una modificación declarada no se coacciona a \"sin modificación\" (§18.1/§12.2)." };
  }
  const modifiesQuantity = declaredModification && declaredModifiedQuantity !== recommendation.quantityMw;
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
  //
  // §18.2/§18.4: la autoridad real no es un booleano global. `realAuthorityEntered`
  // registra que la PRIMERA Policy Version cruzó Shadow→Real (§18.1) y
  // `activePolicyVersion` nombra la versión concreta que hoy ejerce esa
  // autoridad (primera activación, promoción de versión o rollback gobernado).
  // Ninguna otra versión VALID del envelope queda autorizada por ello.
  const state = {
    level: envelope.autonomyLevel,
    status: "ACTIVE",
    lastHaltingMandate: null,
    realAuthorityEntered: false,
    activePolicyVersion: null,
  };

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

  // Etiqueta humana de los receipts: la Policy Version que la transición
  // nombra es la que realmente ejerce autoridad (`activePolicyVersion`), no la
  // unión de las autorizaciones VALID del envelope (§18.4: poder reconstruir
  // por qué una versión obtuvo, conservó o perdió autoridad). Antes de la
  // primera activación no hay versión activa: se declara explícitamente.
  function activeVersionLabel() {
    return isNonEmptyString(state.activePolicyVersion) ? state.activePolicyVersion : "SIN_VERSION_ACTIVA";
  }

  // --- Hito 2: primera activación, si se autoriza (§18.1) ---

  // A diferencia de un ascenso posterior (considerSubsequentPromotion), la
  // primera activación NO es un ascenso del nivel operativo: §18.1 registra
  // el acto humano explícito (DEP-25) con el que la Policy Version pasa de
  // Shadow a Real, junto con la evidencia OOS/Shadow elegible y el APG
  // aplicable; el envelope debe conceder la autoridad real (A1+; §16.2/§17).
  // El acto se registra UNA vez (`realAuthorityEntered`) y fija la
  // `activePolicyVersion`; su receipt documenta el acto vía approvalRef +
  // envelopeVersionKey (§18.4). El nivel
  // operativo lo declara el envelope y baja por DEMOTE/HALT (§18.3):
  // registrar el acto nunca lo mueve ( IMP24-FIRST-ACTIVATION-STATE-
  // INCONSISTENCY ).
  function considerFirstActivation({ policyVersion, oosPolicyVersion, oosEvidence, shadowEvidence, apg, humanApproval, atUtc } = {}) {
    if (!isNonEmptyString(atUtc)) {
      return fail("MISSING_TIMESTAMP", "La activación declara su instante (§6.1).");
    }
    // §18.3/§18.4: HALT detiene la operación de forma inmediata; ninguna
    // transición que AMPLÍE autoridad (primera activación incluida) procede
    // mientras el governor esté detenido. Se exige el rollback previo; sin
    // este control se registraría un PROMOTE reconstruible que contradice el
    // halt (la versión "obtuvo" autoridad durante un cese).
    if (state.status !== "ACTIVE") {
      return fail("GOVERNOR_STATE_HALTED", `El estado operacional es ${state.status}: la progresión de governance no procede hasta el rollback (§18.3).`);
    }
    // §18.3/§18.4 (el estado no baja por una vía de promoción) y §18.4
    // (reconstrucción de receipts): la primera activación es UNA sola por
    // governor. El flag es la verdad de "ya activada": el nivel puede superar
    // A1 por el propio envelope ANTES de que exista el acto humano de DEP-25
    // (el envelope autoriza el nivel, no sustituye la aprobación; §17). Sin
    // este guard, una segunda llamada registraría un PROMOTE duplicado A0→A1
    // con `previousState` falso ( IMP24-FIRST-ACTIVATION-STATE-INCONSISTENCY ).
    if (state.realAuthorityEntered) {
      return fail("FIRST_ACTIVATION_ALREADY_RECORDED", `El estado operacional es ${state.level}: la primera activación ya quedó registrada; no hay segunda (§18.1).`);
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
    // §18.1/§16.2: la primera activación registra el acto de DEP-25 para la
    // Policy Version, no un nivel operativo. El envelope debe conceder
    // autoridad real (A1+; §16.2/§17). Bajo un envelope que la concede, el
    // acto también se registra cuando el nivel operativo está por encima
    // (A2+): el gate manda sobre la versión, no sobre el nivel, y sin esta
    // vía el acto quedaría imposible y el gate de BUY fail-open (§25.2.3
    // hito 2). El nivel operativo NO baja: registrar el acto no es un DEMOTE
    // (§18.3). Bajo un envelope A0 no hay autoridad real que activar.
    if (levelIndex(envelope.autonomyLevel) < levelIndex("A1")) {
      const holdReceiptId = holdFirstActivation({
        triggerGate: "G_ENVELOPE_REAL_AUTHORITY",
        triggerEvidenceRef: `ENVELOPE_WITHOUT_REAL_AUTHORITY:${envelope.autonomyLevel}`,
        policyVersion,
        atUtc,
      });
      return fail("ENVELOPE_WITHOUT_REAL_AUTHORITY", `El envelope "${String(envelope.envelopeVersion)}" autoriza ${envelope.autonomyLevel} (Research, sin autoridad real; §16.2): la primera activación exigiría un envelope que conceda A1 (§17/§25.2.3 hito 2).`, { transitionReceiptId: holdReceiptId });
    }

    const activation = {
      artifactKind: "IMP-24_FIRST_ACTIVATION_RECORD",
      policyVersion,
      fromStage: "SHADOW",
      toStage: "REAL",
      humanApprovalScope: FIRST_ACTIVATION_SCOPE,
      approvalRef: humanApproval.approvalRef,
      approvedBy: { authority: humanApproval.approvedBy.authority, role: humanApproval.approvedBy.role },
      oosReceiptId: evidenceCheck.evidence.OOS.receiptId,
      shadowReceiptId: evidenceCheck.evidence.SHADOW.receiptId,
      synthetic: evidenceCheck.synthetic,
      apgFrozenCriteriaRef: apg.frozenCriteriaRef,
      envelopeVersionKey,
      operativeLevel: state.level,
      activatedAtUtc: atUtc,
      note: "Primera activación (§18.1): registro del acto DEP-25 de la Policy Version (Shadow -> Real), no un ascenso de nivel operativo. En A1 operacional el 100% de las acciones reales exige validación humana por acción. Un record con evidencia sintética es una demostración de mecanismo y no acredita evidencia real (§25.2).",
    };
    activation.activationId = contentHashOf(activation);
    state.realAuthorityEntered = true;
    state.activePolicyVersion = policyVersion;
    const promoteReceiptId = registerTransition({
      registry,
      input: {
        transitionType: "PROMOTE",
        triggerGate: "G_DEP25_FIRST_ACTIVATION",
        triggerEvidenceRef: humanApproval.approvalRef,
        previousState: `${policyVersion}@SHADOW`,
        newState: `${policyVersion}@REAL`,
        autonomyLevel: state.level,
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
    // §18.4: el HOLD no mueve la Policy Version ni el nivel operativo: la
    // versión permanece en Shadow y el acto no se registra. Nombrar aquí un
    // nivel de autonomía (la antigua etiqueta @A1, de cuando este acto movía
    // A0→A1) contradecía el campo `autonomyLevel` bajo A0/A2+ dentro del mismo
    // receipt; "Nuevo estado/versión" debe declarar la frontera de etapa
    // ( IMP24-HOLD-RECEIPT-A1-LABEL ).
    const held = registerTransition({
      registry,
      input: {
        transitionType: "HOLD",
        triggerGate,
        triggerEvidenceRef,
        previousState: `${policyVersion}@SHADOW`,
        newState: `${policyVersion}@SHADOW:HELD`,
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
  function eligibleEvidence({ oosEvidence, shadowEvidence, oosPolicyVersion, policyVersion, atUtc, holdTriggerGate = "G_DEP25_FIRST_ACTIVATION" }) {
    // §18.4: el HOLD nombra el gate que lo desencadena. La primera activación y
    // la promoción de versión comparten este borde de evidencia, pero no el
    // gate: el caller elige la etiqueta correcta.
    const registerHold = ({ triggerEvidenceRef }) => holdFirstActivation({ triggerGate: holdTriggerGate, triggerEvidenceRef, policyVersion, atUtc });
    const receivedOos = receiveGovernanceEvidence({ evidence: oosEvidence });
    if (!receivedOos.ok) {
      const holdReceiptId = registerHold({
        triggerEvidenceRef: `${receivedOos.code}:STAGE_OOS`,
        policyVersion,
        atUtc,
      });
      return fail(receivedOos.code, `Evidencia OOS insuficiente: ${receivedOos.message}`, { stage: "OOS", transitionReceiptId: holdReceiptId });
    }
    // §25.2.3 hito 2: cada slot exige la evidencia de SU etapa. Un receipt
    // válido de otra etapa (p.ej. un Shadow en el slot OOS) no es evidencia
    // de este slot; sin este control el borde de recepción leería
    // `researchVerdict` (null para Shadow) y rompería por excepción en vez de
    // rechazar fail-closed (§18.1). Se rechaza con HOLD, nunca se lanza.
    if (receivedOos.evidence.stage !== "OOS") {
      const holdReceiptId = registerHold({
        triggerEvidenceRef: `EVIDENCE_STAGE_MISMATCH:${receivedOos.evidence.stage}:STAGE_OOS`,
        policyVersion,
        atUtc,
      });
      return fail("EVIDENCE_STAGE_MISMATCH", `El slot OOS recibió un receipt de etapa ${receivedOos.evidence.stage}: se exige un receipt OOS (§25.2.3 hito 2).`, { stage: "OOS", transitionReceiptId: holdReceiptId });
    }
    if (!receivedOos.evidence.researchVerdict.evaluated || receivedOos.evidence.researchVerdict.verdict !== "PASS") {
      const verdict = receivedOos.evidence.researchVerdict.verdict ?? "SIN_EVALUAR";
      const holdReceiptId = registerHold({
        triggerEvidenceRef: `OOS_EVIDENCE_NOT_ELIGIBLE:${verdict}`,
        policyVersion,
        atUtc,
      });
      return fail("OOS_EVIDENCE_NOT_ELIGIBLE", `La evidencia OOS no es elegible (verdict = ${verdict}); un veredicto FAIL/HOLD no soporta activación (§18.1).`, { stage: "OOS", transitionReceiptId: holdReceiptId });
    }
    const receivedShadow = receiveGovernanceEvidence({ evidence: shadowEvidence });
    if (!receivedShadow.ok) {
      const holdReceiptId = registerHold({
        triggerEvidenceRef: `${receivedShadow.code}:STAGE_SHADOW`,
        policyVersion,
        atUtc,
      });
      return fail(receivedShadow.code, `Evidencia Shadow insuficiente: ${receivedShadow.message}`, { stage: "SHADOW", transitionReceiptId: holdReceiptId });
    }
    // Mismo control de etapa para el slot Shadow (rechazo HOLD fail-closed).
    if (receivedShadow.evidence.stage !== "SHADOW") {
      const holdReceiptId = registerHold({
        triggerEvidenceRef: `EVIDENCE_STAGE_MISMATCH:${receivedShadow.evidence.stage}:STAGE_SHADOW`,
        policyVersion,
        atUtc,
      });
      return fail("EVIDENCE_STAGE_MISMATCH", `El slot Shadow recibió un receipt de etapa ${receivedShadow.evidence.stage}: se exige un receipt Shadow (§25.2.3 hito 2).`, { stage: "SHADOW", transitionReceiptId: holdReceiptId });
    }
    // §18.1: "Shadow satisfactorio" no es un statement auto-attribuido: el
    // receipt del productor IMP-18 declara non-interference verificada y
    // cobertura terminal COVERED; el governor las importa del productor
    // (una sola verdad) y las exige conjuntivamente.
    const shadowSufficiency = receivedShadow.evidence.shadowSufficiency;
    if (shadowSufficiency === null
      || shadowSufficiency.nonInterferenceVerdict !== SHADOW_NON_INTERFERENCE_VERIFIED
      || shadowSufficiency.terminalCoverageStatus !== "COVERED") {
      const holdReceiptId = registerHold({
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
      const holdReceiptId = registerHold({
        triggerEvidenceRef: "EVIDENCE_VERSION_MISMATCH:EXPERIMENT",
        policyVersion,
        atUtc,
      });
      return fail("EVIDENCE_VERSION_MISMATCH", `Las etapas OOS y Shadow no comparten la identidad de experimento (OOS ${JSON.stringify(oosExperiment)} vs Shadow ${JSON.stringify(shadowExperiment)}): una sola identidad de versión (§15/§25.2.3 hito 2).`, { transitionReceiptId: holdReceiptId });
    }
    if (isNonEmptyString(oosPolicyVersion) && oosPolicyVersion !== receivedShadow.evidence.identity.policyVersion) {
      const holdReceiptId = registerHold({
        triggerEvidenceRef: `EVIDENCE_VERSION_MISMATCH:POLICY_VERSION:${oosPolicyVersion}`,
        policyVersion,
        atUtc,
      });
      return fail("EVIDENCE_VERSION_MISMATCH", `Las etapas declaran versiones distintas (OOS "${oosPolicyVersion}" vs Shadow "${receivedShadow.evidence.identity.policyVersion}"): una sola identidad de versión (§15).`, { transitionReceiptId: holdReceiptId });
    }
    if (receivedShadow.evidence.identity.policyVersion !== policyVersion) {
      const holdReceiptId = registerHold({
        triggerEvidenceRef: `SHADOW_EVIDENCE_VERSION_MISMATCH:${String(receivedShadow.evidence.identity.policyVersion)}`,
        policyVersion,
        atUtc,
      });
      return fail("SHADOW_EVIDENCE_VERSION_MISMATCH", `La evidencia Shadow pertenece a "${String(receivedShadow.evidence.identity.policyVersion)}", no a "${policyVersion}" (§25.2 DEP-22).`, { transitionReceiptId: holdReceiptId });
    }
    return {
      ok: true,
      evidence: { OOS: receivedOos.evidence, SHADOW: receivedShadow.evidence },
      synthetic: receivedOos.evidence.synthetic || receivedShadow.evidence.synthetic,
    };
  }

  // --- Approval enforcement de actos reales: gate común de primera
  // activation (§18.1/§25.2.3 hito 2) para todo BUY, validación humana por
  // acción en A1 operativo y enforcement externo en A2+ (§16.2/§17) ---

  function authorizeRealAction({ action, policyVersion, quantityMw, dataState, humanApproval, atUtc } = {}) {
    if (!isNonEmptyString(atUtc)) {
      return fail("MISSING_TIMESTAMP", "El acto real declara su instante (§6.1).");
    }
    if (state.status !== "ACTIVE") {
      return fail("GOVERNOR_STATE_HALTED", `El estado operacional es ${state.status}: ningún acto se autoriza hasta otra decisión de governance (§18.3).`);
    }
    const recommendation = { action: action ?? null, policyVersion: policyVersion ?? null, quantityMw: quantityMw ?? null };
    if (action === "BUY") {
      // --- Gates comunes de todo acto real de compra ---
      // 1) §16.2/§17: la autoridad de compra exige nivel operativo A1+ y
      //    envelope con autoridad real A1+; A0 en cualquiera de los dos es
      //    "ninguna autoridad real" (§16.2).
      const operativeBuys = levelIndex(state.level) >= levelIndex("A1")
        && levelIndex(envelope.autonomyLevel) >= levelIndex("A1");
      if (!operativeBuys) {
        return {
          ok: true, authorized: false, status: "REJECTED", recommendation,
          reasons: [{
            code: "LEVEL_WITHOUT_BUY_AUTHORITY",
            field: "autonomyLevel",
            message: `El nivel operativo ${state.level} (envelope ${envelope.autonomyLevel}) no concede autoridad de compra real (§16.2).`,
          }],
        };
      }
      // 2) §18.1/§25.2.3 hito 2: la primera Policy Version que pasa de Shadow
      //    a Real exige la aprobación humana explícita de DEP-25 (acto de
      //    primera activación) ANTES de ejercer autoridad real, sea cual sea
      //    el nivel ( IMP24-REAL-AUTHORITY-A2-WITHOUT-FIRST-ACTIVATION ). El
      //    gate manda sobre la versión, no sobre un nivel concreto; la
      //    validación por acción no lo sustituye.
      if (state.realAuthorityEntered !== true || !isNonEmptyString(state.activePolicyVersion)) {
        return fail("FIRST_ACTIVATION_REQUIRED_BEFORE_REAL_ACTION", "Sin la primera activación registrada (DEP-25, §18.1) no se ejerce autoridad real; la validación por acción no la sustituye (§25.2.3 hito 2).", { authorized: false, recommendation });
      }
      // 3) §18.2/§18.4: la autoridad real está ligada a la versión concreta
      //    que la obtuvo por un acto gobernado. Estar VALID en el envelope no
      //    basta: una versión posterior debe pasar de nuevo por el APG y su
      //    PROMOTE de versión antes de ejercer ( IMP24-REAL-AUTHORITY-UNBOUND-
      //    POLICY-VERSION ). Sin este gate, activar vX autorizaría cualquier
      //    vY VALID del mismo envelope, incluidas versiones sin evidencia
      //    OOS/Shadow ni revalidación (§25.2.3 hito 3).
      if (state.activePolicyVersion !== policyVersion) {
        return fail(POLICY_VERSION_WITHOUT_REAL_AUTHORITY, `La Policy Version "${String(policyVersion)}" no obtuvo autoridad real por un acto gobernado (primera activación o PROMOTE de versión); estar VALID en el envelope no se hereda (§18.2/§18.4). Versión activa: "${String(state.activePolicyVersion)}".`, { authorized: false, recommendation });
      }
    }
    if (state.level === "A1") {
      // --- A1 operativo: validación humana por acción (§18.1) ---
      const approvalFailure = perActionApprovalProblem(humanApproval, recommendation);
      if (approvalFailure) {
        return { ok: true, authorized: false, code: approvalFailure.code, message: approvalFailure.message, recommendation, intervention: approvalFailure.intervention ?? null };
      }
      const declaredModifiedQuantity = humanApproval.modifiedQuantityMw;
      const quantityModified = isFinitePositiveNumber(declaredModifiedQuantity) && declaredModifiedQuantity !== recommendation.quantityMw;
      const decidedQuantityMw = quantityModified ? declaredModifiedQuantity : recommendation.quantityMw;
      const modification = quantityModified
        ? { kind: "QUANTITY_MODIFIED", from: recommendation.quantityMw, to: declaredModifiedQuantity }
        : null;
      // El enforcement externo comprueba la acción decidida ANTES de
      // execution (§17); la validación humana no sustituye al envelope.
      // Único motivo filtrable: LEVEL_WITHOUT_BUY_AUTHORITY — el gate común
      // ya resolvió la autoridad de compra (nivel operativo y envelope A1+),
      // el controller IMP-23 no ve la validación humana binada que §18.1
      // exige aquí. Cualquier otro rechazo del envelope manda.
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
    // enforcement externo del envelope manda (§17). En BUY ya aplicó el gate
    // común de primera activación; en WAIT (safe non-action, §18.3) manda
    // sólo el envelope, que es la no-acción. §18.1/§12.2/§18.4: todo acto
    // real autorizado se registra con recommendation y decisión separadas
    // (reconstruible, §18.4); la vía de niveles con límites no queda fuera
    // del registro.
    const structural = enforcement.authorizeAction({ action, policyVersion, quantityMw, dataState, envelopeVersionKey });
    if (structural.authorized !== true) {
      return { ok: true, authorized: false, status: structural.status, recommendation, reasons: structural.reasons };
    }
    const record = {
      artifactKind: "IMP-24_GOVERNED_ACTION_RECORD",
      recommendation: { action: recommendation.action, policyVersion: recommendation.policyVersion, quantityMw: recommendation.quantityMw },
      humanApprovalAction: null,
      modification: null,
      modifiedOutcomeAttributableToRecommendation: true,
      authorizedAction: action,
      authorizedQuantityMw: quantityMw,
      envelopeVersionKey,
      operativeLevel: state.level,
      atUtc,
    };
    record.actionRecordId = contentHashOf(record);
    return { ok: true, authorized: true, status: structural.status, action: Object.freeze({ ...record }) };
  }

  // --- Hito 3: promociones posteriores, DEMOTE/HALT/ROLLBACK (§18.2/§18.3) ---

  function considerSubsequentPromotion({ targetLevel, apg, governanceChangeApproval, atUtc } = {}) {
    if (!isNonEmptyString(atUtc)) {
      return fail("MISSING_TIMESTAMP", "La promoción declara su instante (§6.1).");
    }
    // §18.3/§18.4: un governor HALTED no asciende. Sin este control una
    // PROMOTE registrada durante el halt elevaba el nivel operativo y el
    // rollback posterior reanudaba ACTIVE en ese nivel superior: el hard-gate
    // que causó el HALT quedaba neutralizado y el registro declaraba una
    // autoridad que el cese impedía ejercer.
    if (state.status !== "ACTIVE") {
      return fail("GOVERNOR_STATE_HALTED", `El estado operacional es ${state.status}: la progresión de governance no procede hasta el rollback (§18.3).`);
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
        previousState: `${activeVersionLabel()}@${fromLevel}`,
        newState: `${activeVersionLabel()}@${targetLevel}`,
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
        previousState: `${activeVersionLabel()}@${state.level}`,
        newState: `${activeVersionLabel()}@${targetLevel}:HELD`,
        autonomyLevel: state.level,
        envelopeVersionKey,
        atUtc,
      },
      failures: internalFailures,
    });
    return held?.receiptId ?? null;
  }

  // --- Hito 3: promoción de una Policy Version posterior (§18.2) ---

  // §18.2/§18.4/§25.2.3 hito 3: una Policy Version posterior puede obtener
  // autoridad real sólo si vuelve a cumplir TODOS los Promotion Gates
  // congelados con su propia evidencia OOS/Shadow. El acto deja un receipt
  // PROMOTE que nombra la versión activa anterior y la nueva: así se
  // reconstruye por qué versión obtuvo autoridad. El nivel operativo no cambia.
  function considerPolicyVersionPromotion({ policyVersion, oosPolicyVersion, oosEvidence, shadowEvidence, apg, governanceChangeApproval, atUtc } = {}) {
    if (!isNonEmptyString(atUtc)) {
      return fail("MISSING_TIMESTAMP", "La promoción de versión declara su instante (§6.1).");
    }
    if (state.status !== "ACTIVE") {
      return fail("GOVERNOR_STATE_HALTED", `El estado operacional es ${state.status}: la progresión de governance no procede hasta el rollback (§18.3).`);
    }
    if (state.realAuthorityEntered !== true || !isNonEmptyString(state.activePolicyVersion)) {
      return fail("NO_REAL_AUTHORITY_TO_SUCCEED", "Una versión posterior se promociona dentro del espacio real ya autorizado; sin la primera activación (§18.1) no hay promoción posterior (§18.2).");
    }
    if (!isNonEmptyString(policyVersion)) {
      return fail("MISSING_POLICY_VERSION", "La promoción de versión declara la Policy Version destino (§15.3).");
    }
    if (policyVersion === state.activePolicyVersion) {
      return fail("POLICY_VERSION_ALREADY_ACTIVE", `"${policyVersion}" ya ejerce autoridad real; no hay promoción que registrar (§18.2).`);
    }
    const authorizationFailure = authorizationProblem(policyVersion);
    if (authorizationFailure) {
      return fail(authorizationFailure.code, authorizationFailure.message);
    }
    // §25.2.3 hito 3: la versión posterior se revalida con evidencia propia,
    // no con la de la versión activa.
    const evidenceCheck = eligibleEvidence({ policyVersion, oosPolicyVersion, oosEvidence, shadowEvidence, atUtc, holdTriggerGate: "G_AUTONOMY_PROMOTION" });
    if (!evidenceCheck.ok) {
      return evidenceCheck;
    }
    const apgCheck = evaluateAutonomyPromotionGate({ apg });
    if (apgCheck.reasons.length > 0) {
      const holdReceiptId = holdPolicyVersionPromotion({ targetVersion: policyVersion, triggerGate: "G_AUTONOMY_PROMOTION", triggerEvidenceRef: "APG_NOT_SATISFIED", atUtc });
      return { ok: false, authorized: false, code: "APG_NOT_SATISFIED", message: "La versión posterior no satisface nuevamente todos los Promotion Gates congelados (§18.2).", reasons: apgCheck.reasons, transitionReceiptId: holdReceiptId };
    }
    // §18.2 ("sólo si el nivel de autonomía vigente lo permite")/§16.2: el
    // envelope no declara una autorización de promoción automática de versión.
    // Fail-closed: el acto exige la misma aprobación de governance que el resto
    // de cambios, con autoridad distinta de la policy; no se inventa automatismo.
    const approvalFailure = governanceApprovalProblem(governanceChangeApproval, `${POLICY_VERSION_PROMOTION_SCOPE_PREFIX}:${policyVersion}`);
    if (approvalFailure) {
      const holdReceiptId = holdPolicyVersionPromotion({ targetVersion: policyVersion, triggerGate: "G_DEP25_GOVERNANCE_CHANGE", triggerEvidenceRef: approvalFailure.code, atUtc });
      return { ok: false, authorized: false, code: approvalFailure.code, message: approvalFailure.message, transitionReceiptId: holdReceiptId };
    }
    const fromPolicyVersion = state.activePolicyVersion;
    state.activePolicyVersion = policyVersion;
    const promoteReceiptId = registerTransition({
      registry,
      input: {
        transitionType: "PROMOTE",
        triggerGate: "G_DEP25_GOVERNANCE_CHANGE",
        triggerEvidenceRef: governanceChangeApproval.approvalRef,
        previousState: `${fromPolicyVersion}@REAL`,
        newState: `${policyVersion}@REAL`,
        autonomyLevel: state.level,
        envelopeVersionKey,
        atUtc,
      },
      failures: internalFailures,
    })?.receiptId ?? null;
    return { ok: true, authorized: true, status: "POLICY_VERSION_PROMOTED", fromPolicyVersion, toPolicyVersion: policyVersion, transitionReceiptId: promoteReceiptId };
  }

  function holdPolicyVersionPromotion({ targetVersion, triggerGate, triggerEvidenceRef, atUtc }) {
    const held = registerTransition({
      registry,
      input: {
        transitionType: "HOLD",
        triggerGate,
        triggerEvidenceRef,
        previousState: `${activeVersionLabel()}@REAL`,
        newState: `${targetVersion}@REAL:HELD`,
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
    // §18.3/§18.4: DEMOTE sólo procede si hay un nivel inferior que reduzca
    // autoridad. En el mínimo A0 no existe tal nivel: registrar A0→A0 sería un
    // receipt que declara una pérdida de autoridad que no ocurrió. El
    // hard-gate detiene la operación (HALT), degradación efectiva y
    // reconstruible, en vez de fabricar un DEMOTE vacío.
    const demoteTargetIndex = levelIndex(state.level) - 1;
    if (mandate.transition === "DEMOTE" && demoteTargetIndex >= 0) {
      const fromLevel = state.level;
      const toLevel = AUTONOMY_LEVELS[demoteTargetIndex];
      state.level = toLevel;
      const receiptId = registerTransition({
        registry,
        input: {
          transitionType: "DEMOTE",
          triggerGate: `HARD_GATE:${gateId}`,
          triggerEvidenceRef: evidenceRef,
          previousState: `${activeVersionLabel()}@${fromLevel}`,
          newState: `${activeVersionLabel()}@${toLevel}`,
          autonomyLevel: toLevel,
          envelopeVersionKey,
          atUtc,
        },
        failures: internalFailures,
      })?.receiptId ?? null;
      return { ok: true, transition: "DEMOTE", fromLevel, toLevel, transitionReceiptId: receiptId, mandate };
    }
    // §18.3: el cese debe poder revertirse con ROLLBACK. executeRollback sólo
    // acepta un mandato HALT; guardar el DEMOTE original (cuando en el piso se
    // materializa como HALT) dejaba el cese sin vía de rollback, atrapando al
    // governor en HALTED de forma permanente. Se guarda la transición
    // EFECTIVA (HALT), conservando el pedido original para trazabilidad.
    state.status = "HALTED";
    state.lastHaltingMandate = Object.freeze({ ...mandate, transition: "HALT", requestedTransition: mandate.transition });
    const receiptId = registerTransition({
      registry,
      input: {
        transitionType: "HALT",
        triggerGate: `HARD_GATE:${gateId}`,
        triggerEvidenceRef: evidenceRef,
        previousState: `${activeVersionLabel()}@${state.level}`,
        newState: `${activeVersionLabel()}@${state.level}:HALTED`,
        autonomyLevel: state.level,
        envelopeVersionKey,
        atUtc,
      },
      failures: internalFailures,
    })?.receiptId ?? null;
    const demoteAtMinimumLevel = mandate.transition === "DEMOTE";
    return { ok: true, transition: "HALT", status: state.status, transitionReceiptId: receiptId, mandate, demoteAtMinimumLevel };
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
    // §18.3: el rollback restaura la última Policy Version válida como la que
    // ejerce autoridad real (acto gobernado con su propio receipt). Si el
    // governor nunca entró en Real (§18.1), el rollback no fabrica autoridad.
    const restoresPolicyVersion = target.destination === "POLICY_VERSION";
    const receiptId = registerTransition({
      registry,
      input: {
        transitionType: "ROLLBACK",
        triggerGate: `HARD_GATE:${state.lastHaltingMandate.gateId}`,
        triggerEvidenceRef: state.lastHaltingMandate.evidenceRef,
        previousState: `${activeVersionLabel()}@${state.level}:HALT`,
        newState: restoresPolicyVersion ? `${target.policyVersion}@${state.level}` : `${target.destination}:${state.level}`,
        autonomyLevel: state.level,
        envelopeVersionKey,
        atUtc,
      },
      failures: internalFailures,
    })?.receiptId ?? null;
    if (restoresPolicyVersion && state.realAuthorityEntered === true) {
      state.activePolicyVersion = target.policyVersion;
    }
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
        firstActivationRecorded: state.realAuthorityEntered,
        activePolicyVersion: state.activePolicyVersion,
        lastHaltingMandate: state.lastHaltingMandate,
      });
    },
    receiptRegistry: registry,
    considerFirstActivation,
    authorizeRealAction,
    considerSubsequentPromotion,
    considerPolicyVersionPromotion,
    applyHardGateMandate,
    executeHaltingRollback,
    internalFailures,
  };
}
