// Rollback de Policy Version bajo el envelope (IMP-23). Fuente: SPEC v1.1.1
// §18.3: "El destino de rollback es la última Policy Version que siga siendo
// válida bajo el envelope actual; no basta con que haya sido aprobada en el
// pasado. Si no existe una versión válida, se utiliza el baseline autorizado
// o el safe non-action state definido por operaciones." §17 (rollback target
// como campo del envelope) y §25.2 nota IMP-23 ("baseline experimental no
// autorizado por defecto" / "no fabrica el límite ni su aprobación").
//
// La disponibilidad del fallback es dependencia operativa explícita: si no
// hay versión válida y nadie declaró baseline autorizado o safe non-action
// state, el rollback queda BLOQUEADO con pendiente explícito; no se inventa
// WAIT indefinido como respuesta segura (§17).

import { isVersionLike } from "../contracts/identities.mjs";

export const ROLLBACK_BLOCKED_CODE = "NO_ROLLBACK_TARGET";

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

// El historial declara, por cada Policy Version, su validez bajo cada
// envelope concreto. "Válida bajo el envelope actual" exige
// underEnvelopeVersion == envelopeVersion vigente y status VALID.
export function isVersionValidUnderEnvelope(policyVersion, envelopeVersionKey, history) {
  if (!isNonEmptyString(policyVersion) || !isNonEmptyString(envelopeVersionKey) || !Array.isArray(history)) {
    return false;
  }
  const declaration = history.find((entry) => entry.policyVersion === policyVersion) ?? null;
  if (declaration === null || !Array.isArray(declaration.validity)) {
    return false;
  }
  const underCurrent = declaration.validity.find((entry) => entry.underEnvelopeVersion === envelopeVersionKey) ?? null;
  return underCurrent !== null && underCurrent.currentValid === true;
}

// Resuelve el destino de rollback (§18.3). Orden: 1) última Policy Version
// válida bajo el envelope actual (la historia se recorre en orden de
// activación, la más reciente al final); 2) baseline autorizado explícito
// (el baseline experimental NO es autorizado por defecto, §25.2 nota
// IMP-23); 3) safe non-action state declarado por operaciones, no
// inventado. Si nada aplica → BLOQUEADO fail-closed.
export function resolveRollbackTarget({ envelope, policyVersionHistory } = {}) {
  if (!envelope || typeof envelope !== "object" || Array.isArray(envelope) || !isVersionLike(envelope.envelopeVersion)) {
    return { ok: false, code: "INVALID_ENVELOPE", message: "El rollback se resuelve contra el envelope actual con su versión declarada (§18.3)." };
  }
  const envelopeVersionKey = typeof envelope.envelopeVersion === "string"
    ? `version:${envelope.envelopeVersion}`
    : `hash:${envelope.envelopeVersion.contentHash}`;
  const history = Array.isArray(policyVersionHistory) ? policyVersionHistory : [];

  // 1) Última versión válida bajo el envelope actual, en orden de historia.
  const orderedVersions = history
    .filter((entry) => entry && isNonEmptyString(entry.policyVersion))
    .map((entry) => entry.policyVersion);
  const validCandidates = orderedVersions.filter((version) => isVersionValidUnderEnvelope(version, envelopeVersionKey, history));
  if (validCandidates.length > 0) {
    const targetVersion = validCandidates[validCandidates.length - 1];
    return {
      ok: true,
      target: Object.freeze({
        destination: "POLICY_VERSION",
        policyVersion: targetVersion,
        underEnvelopeVersion: envelopeVersionKey,
        selectedBecause: "Última Policy Version válida bajo el envelope actual (§18.3); la aprobación histórica por sí sola no selecciona.",
      }),
    };
  }

  // 2) Baseline autorizado: exige authorizationRef explícito. El baseline
  // experimental (A0/Research) no es autorizado por defecto.
  const baseline = envelope.rollbackBaseline ?? null;
  if (isNonEmptyString(baseline)) {
    const authorizationRef = envelope.rollbackBaselineAuthorizationRef ?? null;
    if (!isNonEmptyString(authorizationRef)) {
      return {
        ok: false,
        code: "BASELINE_NOT_AUTHORIZED",
        message: "El baseline declarado no está autorizado para rollback: sin authorizationRef es baseline experimental no autorizado por defecto (§25.2 nota IMP-23).",
      };
    }
    return {
      ok: true,
      target: Object.freeze({
        destination: "AUTHORIZED_BASELINE",
        baseline,
        authorizationRef,
        underEnvelopeVersion: envelopeVersionKey,
        selectedBecause: "Baseline autorizado explícitamente; no hay Policy Version válida bajo el envelope actual (§18.3).",
      }),
    };
  }

  // 3) Safe non-action state definido por operaciones (§18.3); hay que
  // DECLARARLO, no se inventa WAIT indefinido (§17).
  const safeState = envelope.safeNonActionState ?? null;
  if (isNonEmptyString(safeState)) {
    return {
      ok: true,
      target: Object.freeze({
        destination: "SAFE_NON_ACTION_STATE",
        state: safeState,
        definedBy: envelope.safeNonActionStateProvenance?.authority ?? null,
        underEnvelopeVersion: envelopeVersionKey,
        selectedBecause: "Safe non-action state declarado por operaciones; no hay versión válida ni baseline autorizado (§18.3).",
      }),
    };
  }

  return {
    ok: false,
    code: ROLLBACK_BLOCKED_CODE,
    pendingOperationsFallback: true,
    message: "Sin Policy Version válida ni fallback declarado: el rollback queda bloqueado como pendiente operacional explícito; no se inventa fallback (§17/§18.3).",
  };
}

// Ejecuta el rollback del mandato de hard-gate (§18.3): recibe el mandato
// (sin consentimiento de policy), resuelve el target con el historial vivo
// y el envelope ACTUAL, y produce la transición ROLLBACK para su receipt.
// El envelope se pasa de nuevo (no se guarda entre llamadas) para que ninguna
// mutación silenciosa del caller tape el cambio de versión.
export function executeRollback({ mandate, envelope, policyVersionHistory, atUtc } = {}) {
  if (!mandate || mandate.transition !== "HALT" || mandate.policyVetoPossible !== false) {
    return { ok: false, code: "INVALID_MANDATE", message: "El rollback ejecuta el mandato de un hard-gate HALT (§18.3)." };
  }
  if (!isNonEmptyString(atUtc)) {
    return { ok: false, code: "MISSING_TIMESTAMP", message: "El rollback declara su instante (§6.1)." };
  }
  const resolved = resolveRollbackTarget({ envelope, policyVersionHistory });
  if (!resolved.ok) {
    return { ok: false, code: resolved.code, message: resolved.message, pendingOperationsFallback: resolved.pendingOperationsFallback === true };
  }
  return {
    ok: true,
    rollback: Object.freeze({
      transition: "ROLLBACK",
      triggerGateId: mandate.gateId,
      evidenceRef: mandate.evidenceRef,
      target: resolved.target,
      envelopeVersionKey: typeof envelope.envelopeVersion === "string"
        ? `version:${envelope.envelopeVersion}`
        : `hash:${envelope.envelopeVersion.contentHash}`,
      executedAtUtc: atUtc,
      policyConsentRequired: false,
    }),
  };
}
