// Cierre de subtarea vs cierre de IMP (IMP-26). Fuente: SPEC v1.1.1 §20.2.10
// ("ST accepted ≠ IMP accepted") y §20.2.8 (ST_RECEIPT), §20.2.12 (conflicto
// SPEC sin resolver).
//
// Una subtarea cierra cuando sus entregables, pruebas, evidencia y review
// cumplen su gate. El parent IMP sólo cierra cuando TODAS las condiciones de
// §20.2.10 se cumplen y entonces se produce el IMP_RECEIPT. La review de
// subtareas y el parent acceptance no pueden cerrar falsamente un DEP factual o
// empírico.

import { validateImpReceipt } from "../contracts/identities.mjs";
import { REVIEW_VERDICTS } from "./review.mjs";

export function evaluateSubtaskClosure({ reviewVerdict, testsRun = [], evidenceProduced = [] } = {}) {
  const failures = [];
  if (reviewVerdict !== REVIEW_VERDICTS.APROBADO) failures.push({ code: "REVIEW_NOT_APPROVED", message: "La subtarea no tiene review APROBADO." });
  if ((testsRun ?? []).length === 0) failures.push({ code: "TESTS_NOT_RUN", message: "La subtarea no declara tests." });
  if ((evidenceProduced ?? []).length === 0) failures.push({ code: "EVIDENCE_MISSING", message: "La subtarea no declara evidencia." });
  const ok = failures.length === 0;
  return { ok, code: ok ? "ST_ACCEPTED" : "ST_NOT_CLOSED", failures };
}

// §20.2.10: el parent sólo cierra con todas las subtareas requeridas accepted,
// prerrequisitos vigentes, condiciones reales de audit/evidence satisfechas,
// acceptance test del padre superado, sin conflicto SPEC sin resolver y sin
// violación de decisión frozen. Sólo entonces se produce el IMP_RECEIPT.
export function evaluateParentClosure({
  requiredSubtaskClosures = [],
  parentPrerequisitesSatisfied,
  realAuditEvidenceSatisfied,
  parentAcceptanceTestPassed,
  unresolvedSpecConflicts = [],
  frozenDecisionViolations = [],
  impReceipt = null,
} = {}) {
  const failures = [];
  const notAccepted = (requiredSubtaskClosures ?? []).filter((closure) => closure?.accepted !== true).map((closure) => closure?.subtaskId ?? "(sin id)");
  if ((requiredSubtaskClosures ?? []).length === 0 || notAccepted.length > 0) {
    failures.push({ code: "SUBTASKS_NOT_ACCEPTED", detail: notAccepted, message: "No todas las subtareas requeridas están accepted." });
  }
  if (parentPrerequisitesSatisfied !== true) failures.push({ code: "PREREQUISITES_UNSATISFIED", message: "Los prerrequisitos del padre ya no están satisfechos." });
  if (realAuditEvidenceSatisfied !== true) failures.push({ code: "AUDIT_EVIDENCE_UNSATISFIED", message: "Las condiciones reales de audit/evidence no están satisfechas." });
  if (parentAcceptanceTestPassed !== true) failures.push({ code: "PARENT_ACCEPTANCE_FAILED", message: "No pasa el acceptance test del padre." });
  if ((unresolvedSpecConflicts ?? []).length > 0) failures.push({ code: "SPEC_CONFLICT_OPEN", detail: unresolvedSpecConflicts, message: "Hay un conflicto SPEC sin resolver que afecta el cierre." });
  if ((frozenDecisionViolations ?? []).length > 0) failures.push({ code: "FROZEN_DECISION_VIOLATED", detail: frozenDecisionViolations, message: "Se violó una decisión frozen." });
  if (failures.length > 0) {
    return { ok: false, closed: false, receipt: null, failures };
  }
  const receiptOutcome = validateImpReceipt(impReceipt);
  if (!receiptOutcome.ok) {
    return { ok: false, closed: false, receipt: null, failures: [{ code: "IMP_RECEIPT_INVALID", detail: receiptOutcome.errors, message: "El IMP_RECEIPT no es válido; el parent no se cierra sin receipt trazable." }] };
  }
  return { ok: true, closed: true, receipt: impReceipt, failures: [] };
}
