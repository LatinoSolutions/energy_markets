// Evidencia de dependencias del ciclo de learning (IMP-19, DEP-19/20/21).
// Fuente: SPEC v1.1.1 §25.2 fila IMP-19 (PRODUCES_EVIDENCE "DEP-19/20/21
// [learner/versión/corpus definido]: parametrización del reward, evaluación de
// support/State/value learner/gamma/tau, protocolo de mezcla/cadence y
// comparación/revalidación. Se respetan los gates internos antes de entrenar o
// validar, sin declarar selección positiva por construir el soporte") y
// §25.2.1 (PRODUCES_EVIDENCE produce evidencia; no cierra el ID global ni
// acredita datos/edge/acceptance).
//
// Un record de evidencia se materializa con provenance y estado explícito. El
// hecho de construir el soporte NO cierra DEP-19/20/21: la clausura exige un
// receipt aceptado externo, que este módulo no fabrica.

import { contentHashOf } from "../execution-contract/execution-contract.mjs";

export const DEP_EVIDENCE_KINDS = Object.freeze({
  DEP19: "DEP-19",
  DEP20: "DEP-20",
  DEP21: "DEP-21",
});
export const DEP_STATUS = Object.freeze({ OPEN: "OPEN", CLOSED: "CLOSED" });
export const LEARNING_EVIDENCE_KIND = "IMP-19_LEARNING_CYCLE_EVIDENCE";

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function buildDepRecord({ depId, subject, status, observations, provenance, producedAtUtc, acceptedReceiptRef = null, fixtureOnly = false }) {
  const errors = [];
  if (!Object.values(DEP_EVIDENCE_KINDS).includes(depId)) {
    return { ok: false, code: "UNKNOWN_DEP", message: `depId debe ser DEP-19, DEP-20 o DEP-21.` };
  }
  if (!isNonEmptyString(subject)) {
    errors.push({ field: "subject", code: "MISSING_SUBJECT", message: "El record declara su sujeto/scope (§25.2.1)." });
  }
  const closedWithoutReceipt = status === DEP_STATUS.CLOSED && !isNonEmptyString(acceptedReceiptRef);
  if (closedWithoutReceipt) {
    errors.push({ field: "status", code: "FALSE_CLOSURE", message: "Construir el soporte no cierra la DEP: una clausura exige receipt aceptado externo (§25.2.1)." });
  }
  if (status !== DEP_STATUS.OPEN && status !== DEP_STATUS.CLOSED) {
    errors.push({ field: "status", code: "INVALID_STATUS", message: "status sólo toma OPEN o CLOSED." });
  }
  if (!provenance || typeof provenance !== "object" || !isNonEmptyString(provenance.kind)) {
    errors.push({ field: "provenance", code: "MISSING_PROVENANCE", message: "La evidencia conserva provenance (§25.2.1)." });
  }
  if (!observations || typeof observations !== "object" || Array.isArray(observations)) {
    errors.push({ field: "observations", code: "MISSING_OBSERVATIONS", message: "El record describe lo realmente observado/producido." });
  }
  if (errors.length > 0) {
    return { ok: false, errors };
  }
  const core = {
    depId,
    subject,
    status,
    fixtureOnly,
    acceptedReceiptRef: acceptedReceiptRef ?? null,
    producedAtUtc: producedAtUtc ?? null,
    observations,
    provenance,
  };
  core.contentHash = contentHashOf(core);
  return { ok: true, record: Object.freeze(core) };
}

// Materializa los tres records NO por el mero hecho de construir el soporte: la
// ausencia de receipt aceptado los deja OPEN y `closedByConstruction` es falso.
export function materializeLearningEvidence({ rewardConfig = null, supportEvaluation = null, protocol = null, learnerComparison = null, candidate = null, revalidation = null, cycle = null, scope = null, acceptedReceiptRef = null, producedAtUtc = null } = {}) {
  const fixtureOnly = scope === "SYNTHETIC_FIXTURE";
  const provenance = {
    kind: "IMP-19_OFFLINE_CYCLE",
    scope,
    protocolHash: protocol?.contentHash ?? null,
    candidateHash: candidate?.contentHash ?? null,
    revalidationRef: revalidation?.evidenceRef ?? null,
  };

  const dep19 = buildDepRecord({
    depId: DEP_EVIDENCE_KINDS.DEP19,
    subject: "Parametrización del reward global",
    status: isNonEmptyString(acceptedReceiptRef) ? DEP_STATUS.CLOSED : DEP_STATUS.OPEN,
    acceptedReceiptRef,
    fixtureOnly,
    producedAtUtc,
    observations: {
      rewardConfigVersion: rewardConfig?.configVersion ?? null,
      rewardState: rewardConfig?.state ?? null,
      anchoredTo: "GLOBAL_PROCUREMENT_REWARD (§10.1)",
      costsEnteredOnceInH: rewardConfig?.costsEnteredOnceInH ?? null,
    },
    provenance,
  });

  const dep20 = buildDepRecord({
    depId: DEP_EVIDENCE_KINDS.DEP20,
    subject: "Evaluación de support/State/value learner/gamma/tau",
    status: isNonEmptyString(acceptedReceiptRef) ? DEP_STATUS.CLOSED : DEP_STATUS.OPEN,
    acceptedReceiptRef,
    fixtureOnly,
    producedAtUtc,
    observations: {
      supportStatus: supportEvaluation?.status ?? null,
      supportSufficient: supportEvaluation?.sufficient ?? null,
      learnerAlgorithm: learnerComparison?.selectedPolicy ?? null,
      learnerSelectedByMerit: learnerComparison?.selectedByMerit ?? null,
      learnerRefuted: learnerComparison?.refuted ?? null,
      revalidated: revalidation?.revalidated ?? null,
    },
    provenance,
  });

  const dep21 = buildDepRecord({
    depId: DEP_EVIDENCE_KINDS.DEP21,
    subject: "Protocolo de mezcla/cadence predeclarado y versionado",
    status: isNonEmptyString(acceptedReceiptRef) ? DEP_STATUS.CLOSED : DEP_STATUS.OPEN,
    acceptedReceiptRef,
    fixtureOnly,
    producedAtUtc,
    observations: {
      protocolVersion: protocol?.protocolVersion ?? null,
      protocolState: protocol?.state ?? null,
      mixtureDeclarationVersion: protocol?.mixtureDeclaration?.declarationVersion ?? null,
      reviewTrigger: protocol?.cadence?.reviewTrigger ?? null,
      trainingTrigger: protocol?.cadence?.trainingTrigger ?? null,
    },
    provenance,
  });

  const records = [dep19, dep20, dep21];
  const failed = records.filter((entry) => entry.ok !== true);
  if (failed.length > 0) {
    return { ok: false, code: "EVIDENCE_RECORD_INVALID", failures: failed.map((entry) => entry.errors) };
  }

  const bundle = {
    artifactKind: LEARNING_EVIDENCE_KIND,
    schemaVersion: "1.0",
    scope,
    fixtureOnly,
    records: Object.fromEntries(records.map((entry) => [entry.record.depId, entry.record])),
    depClosure: {
      "DEP-19": records[0].record.status,
      "DEP-20": records[1].record.status,
      "DEP-21": records[2].record.status,
    },
    closedByConstruction: false,
    cycleOutcome: cycle?.outcome ?? null,
    note: "PRODUCES_EVIDENCE: construir el soporte no cierra DEP-19/20/21 ni acredita edge, datos del cliente ni acceptance (§25.2.1).",
  };
  bundle.contentHash = contentHashOf(bundle);
  return { ok: true, bundle: Object.freeze(bundle) };
}