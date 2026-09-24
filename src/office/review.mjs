// Review e independencia (IMP-26). Fuente: SPEC v1.1.1 §20.2.9 ("Review
// verifica que el scope se respetó, las decisiones frozen se conservaron, los
// outputs están completos, los tests se ejecutaron realmente, la evidencia es
// real y las dependencias están legítimamente satisfechas") y §20.2.8 (un PASS
// del worker es una recomendación, no aceptación).
//
// Quien actuó como Command/decomposer de un IMP no es reviewer independiente de
// sus propias decisiones semánticas. Si Opus actúa como Command failover, se
// registra el rol y se usa otra vía independiente cuando la independencia
// semántica es material. Pruebas deterministas no exigen retrasos ceremoniales.

import { validateStReceipt, linkStReceiptToPacket } from "../contracts/identities.mjs";

export const REVIEW_VERDICTS = Object.freeze({ APROBADO: "APROBADO", CAMBIOS: "CAMBIOS" });

export function evaluateReviewIndependence({
  author,
  command = null,
  reviewer,
  failover = false,
  semanticIndependenceMaterial = true,
  deterministic = false,
} = {}) {
  const record = Object.freeze({ author: author ?? null, command: command ?? null, reviewer: reviewer ?? null, failover: Boolean(failover), deterministic: Boolean(deterministic) });
  if (!reviewer || !author) {
    return { ok: false, independent: false, code: "REVIEWER_MISSING", record };
  }
  if (reviewer === author) {
    return { ok: false, independent: false, code: "REVIEWER_IS_AUTHOR", record };
  }
  // El Command/decomposer no revisa sus propias decisiones semánticas.
  if (reviewer === command && semanticIndependenceMaterial && !deterministic) {
    return { ok: false, independent: false, code: "REVIEWER_IS_COMMAND", record };
  }
  return { ok: true, independent: true, code: null, record };
}

// El veredicto de review sólo es APROBADO si todos los puntos de §20.2.9 se
// cumplen y lo afirmado está respaldado por el resultado. Tests/evidencia falsos
// o no ejecutados fuerzan CAMBIOS.
export function buildReviewVerdict({
  scopeRespected,
  frozenDecisionsPreserved,
  outputsComplete,
  testsActuallyRun,
  evidenceReal,
  dependenciesLegitimatelySatisfied,
  outOfScopeChanges = [],
  claimsBackedByResult = true,
} = {}) {
  const failures = [];
  if (scopeRespected !== true) failures.push({ code: "SCOPE_VIOLATED", message: "El scope no se respetó." });
  if (frozenDecisionsPreserved !== true) failures.push({ code: "FROZEN_DECISION_CHANGED", message: "Se alteró una decisión frozen." });
  if (outputsComplete !== true) failures.push({ code: "OUTPUTS_INCOMPLETE", message: "Los outputs no están completos." });
  if (testsActuallyRun !== true) failures.push({ code: "TESTS_NOT_RUN", message: "Los tests no se ejecutaron realmente." });
  if (evidenceReal !== true) failures.push({ code: "EVIDENCE_NOT_REAL", message: "La evidencia no es real." });
  if (dependenciesLegitimatelySatisfied !== true) failures.push({ code: "DEPENDENCIES_UNSATISFIED", message: "Las dependencias no están legítimamente satisfechas." });
  if (claimsBackedByResult !== true) failures.push({ code: "CLAIM_UNBACKED", message: "Lo afirmado no está respaldado por el resultado." });
  if ((outOfScopeChanges ?? []).length > 0) failures.push({ code: "OUT_OF_SCOPE_CHANGES", message: "Hay modificaciones ajenas al alcance.", detail: outOfScopeChanges });
  const ok = failures.length === 0;
  return { ok, verdict: ok ? REVIEW_VERDICTS.APROBADO : REVIEW_VERDICTS.CAMBIOS, failures };
}

// Review estructural de una subtarea: el receipt debe ser válido, ligarse a su
// packet y declarar tests/evidencia realmente ejecutados. Un receipt con listas
// de tests/evidencia vacías, o con una identidad que no liga, no pasa.
export function reviewSubtask({ packet, receipt, independence = null, checks } = {}) {
  const failures = [];
  const receiptOutcome = validateStReceipt(receipt);
  if (!receiptOutcome.ok) failures.push({ code: "ST_RECEIPT_INVALID", detail: receiptOutcome.errors });
  const linkOutcome = linkStReceiptToPacket(packet, receipt);
  if (!linkOutcome.ok) failures.push({ code: "ST_RECEIPT_UNLINKED", detail: linkOutcome.errors });
  if ((receipt?.testsRun ?? []).length === 0) failures.push({ code: "TESTS_NOT_RUN", message: "El receipt no declara tests ejecutados." });
  if ((receipt?.testResults ?? []).length === 0) failures.push({ code: "TEST_RESULTS_MISSING", message: "El receipt no declara resultados de tests." });
  if ((receipt?.evidenceProduced ?? []).length === 0) failures.push({ code: "EVIDENCE_MISSING", message: "El receipt no declara evidencia producida." });
  if (independence && independence.ok !== true) failures.push({ code: independence.code ?? "REVIEW_NOT_INDEPENDENT", message: "El reviewer no es independiente." });
  if (checks !== undefined) {
    const verdict = buildReviewVerdict(checks);
    failures.push(...verdict.failures);
  }
  const ok = failures.length === 0;
  return { ok, verdict: ok ? REVIEW_VERDICTS.APROBADO : REVIEW_VERDICTS.CAMBIOS, failures };
}
