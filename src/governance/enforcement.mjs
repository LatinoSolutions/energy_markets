// Enforcement externo del Safety / Autonomy Envelope (IMP-23). Fuente:
// SPEC v1.1.1 §17 ("El controlador externo comprueba la acción propuesta
// antes de execution. Una acción fuera del envelope se rechaza; no se permite
// mediante una penalización en el reward"), §18.3 ("Un hard-gate failure
// puede desencadenar inmediatamente DEMOTE, HALT o ROLLBACK, sin esperar
// aprobación humana"), §16.2 (niveles canónicos) y §25.1 fila IMP-23.
//
// El controlador es EXTERNO a la policy: no acepta consentimiento, veto ni
// puntuación de la policy para autorizar. La decisión es estructural:
// autoriza o rechaza (fail-closed); no existe un canal "penalizar y permitir".

import { ADMISSION_GATE_KINDS, AUTONOMY_LEVELS, validateEnvelopeShape, envelopeVersionKeyOf } from "./envelope.mjs";

export const CONTROLLER_KIND = "EXTERNAL_ENVELOPE_CONTROLLER";

// §16.2: A0 (Research) es "Replay / OOS / Shadow; ninguna autoridad real" y
// A1 es "La policy recomienda; un humano aprueba cada acción real". Sólo los
// niveles de autonomía operativa con límites (A2+) conceden BUY dentro del
// envelope. §18.1: la primera activación exige aprobación humana explícita,
// siempre fuera de este controller.
export const LEVELS_WITH_BUY_AUTHORITY = ["A2", "A3", "A4"];

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

// §17: los gate results que el input declara deben venir de una evaluación
// EXTERNA ATRIBUIDA. Quien propone la acción no puede atestiguar sus propios
// gates de admisión; un PASSED sin atribución o auto-declarado no satisface
// ningún hard-gate (fail-closed; corrección IMP23-GATE-PROV-02, revisión
// IMP-23).
const POLICY_SELF_EVALUATION_ROLES = ["POLICY", "CANDIDATE_POLICY"];

function declaredExternalEvaluation(evaluation) {
  const attribution = evaluation?.evaluatedBy ?? null;
  if (!attribution || typeof attribution !== "object" || Array.isArray(attribution)) {
    return null;
  }
  if (!isNonEmptyString(attribution.authority) || !isNonEmptyString(attribution.locator)) {
    return null;
  }
  if (!isNonEmptyString(attribution.role) || POLICY_SELF_EVALUATION_ROLES.includes(attribution.role)) {
    return null;
  }
  return { authority: attribution.authority, locator: attribution.locator, role: attribution.role };
}

function pushRejection(reasons, code, message, field) {
  reasons.push({ code, field: field ?? null, message });
}

// Controller externo: valida el envelope congelado y ejecuta el gate por
// comprobación estructural. El caller construye siempre ASÍ una instancia
// acotada: un inválido no existe.
export function createExternalEnvelopeController({ envelope, atUtc } = {}) {
  const shapeCheck = validateEnvelopeShape(envelope);
  if (!shapeCheck.ok) {
    return { ok: false, code: "INVALID_ENVELOPE", errors: shapeCheck.errors, message: "El controller externo sólo opera el envelope válido; el envelope aprobado es su única fuente (§17)." };
  }
  if (!isNonEmptyString(atUtc)) {
    return { ok: false, code: "MISSING_TIMESTAMP", message: "El enforcement opera sobre actos temporizados; declara atUtc (§6.1)." };
  }
  const envelopeVersionKey = envelopeVersionKeyOf(envelope);
  // El controller ejecuta sobre la versión activa que recibe; una propuesta
  // de Learning nunca alcanza esta referencia (§17: no modifica la activa).
  const activeEnvelope = envelope;

  // Un gate del envelope sólo admite datos con evaluación declarada y
  // EXPLÍCITA. Sin evaluación o con evaluación desconocida, fail-closed
  // (§17: gates de validez de datos/OOD; nada se asume admisible).
  function gateState(gateId, dataState) {
    const gate = activeEnvelope.gates.find((entry) => entry.gateId === gateId) ?? null;
    if (gate === null) {
      return { exists: false };
    }
    const evaluation = Array.isArray(dataState?.gateResults)
      ? dataState.gateResults.find((result) => result.gateId === gateId) ?? null
      : null;
    if (evaluation === null || !["PASSED", "FAILED"].includes(evaluation.result)) {
      return { exists: true, evaluated: false, gate };
    }
    const externalEvaluation = declaredExternalEvaluation(evaluation);
    if (externalEvaluation === null) {
      return { exists: true, evaluated: false, gate, notAttributed: true };
    }
    return { exists: true, evaluated: true, result: evaluation.result, gate, by: externalEvaluation };
  }

  function gateBlocking(reasons, gateId, dataState) {
    const state = gateState(gateId, dataState);
    if (!state.exists) {
      pushRejection(reasons, "UNDECLARED_GATE", `El envelope no declara el gate "${gateId}"; ninguna decisión extra-envelope (§17).`, "dataState.gateResults");
      return true;
    }
    if (state.notAttributed === true) {
      pushRejection(reasons, "GATE_EVALUATION_NOT_ATTRIBUTED", `El resultado del gate "${gateId}" no declara atribución de una evaluación externa (evaluatedBy con authority/locator/role externo); la policy no atestigua sus propios gates (§17).`, "dataState.gateResults");
      return true;
    }
    if (!state.evaluated) {
      pushRejection(reasons, "GATE_NOT_EVALUATED", `El gate "${gateId}" no fue evaluado; fail-closed: sin admisión explícita de datos no hay acto (§17).`, "dataState.gateResults");
      return true;
    }
    if (state.result === "FAILED") {
      pushRejection(reasons, "GATE_FAILED", `El gate "${gateId}" falló; la acción se rechaza, no se tolera con penalización (§17).`, "dataState.gateResults");
      return true;
    }
    return false;
  }

  function checkAdmissionGates(reasons, dataState) {
    let blocked = false;
    // §17: la admisión de datos/estado se comprueba por los gates de validez
    // de datos y OOD declarados. El envelope válido siempre declara al menos
    // uno (validateGates); si no lo hiciera, no hay condiciones de admisión y
    // el acto se rechaza fail-closed (corrección IMP23-ADMISSION-GATE-REQUIRED-06).
    const admissionGates = activeEnvelope.gates.filter((gate) => ADMISSION_GATE_KINDS.includes(gate.kind));
    if (admissionGates.length === 0) {
      pushRejection(reasons, "NO_ADMISSION_GATE", `El envelope no declara ningún gate de admisión (${ADMISSION_GATE_KINDS.join("/")}); sin condiciones de admisión no hay acto admisible (§17).`, "gates");
      return true;
    }
    for (const gate of admissionGates) {
      blocked = gateBlocking(reasons, gate.gateId, dataState) || blocked;
    }
    return blocked;
  }

  // Límite de cantidad: sólo el APPROVED autoriza (§17: "Límites sólo después
  // de validación y aprobación del sizing correspondiente").
  function approvedQuantityLimit(limitKind) {
    const limit = activeEnvelope.quantityLimits.find((entry) => entry.limitKind === limitKind) ?? null;
    if (limit === null || limit.status !== "APPROVED" || !Number.isFinite(limit.maxValueMw)) {
      return null;
    }
    return limit;
  }

  return {
    ok: true,
    controller: Object.freeze({
      kind: CONTROLLER_KIND,
      envelopeVersionKey,
      constructedAtUtc: atUtc,
      isExternalToPolicy: true,
    }),

    // Comprobación ANTES de execution (§17). El resultado es estructural:
    // AUTHORIZED o REJECTED. No existe parámetro de reward/penalty y ningún
    // campo no tipado del input altera la decisión.
    authorizeAction(input = {}) {
      const reasons = [];
      const action = input.action;
      if (action === undefined || action === null) {
        return {
          ok: true, status: "REJECTED", authorized: false, envelopeVersionKey,
          reasons: [{ code: "MISSING_ACTION", field: "action", message: "Sin acción declarada no hay acto autorizable." }],
        };
      }
      if (!Array.isArray(activeEnvelope.allowedActions) || !activeEnvelope.allowedActions.includes(action)) {
        pushRejection(reasons, "ACTION_OUTSIDE_ENVELOPE", `La acción "${String(action)}" está fuera del action space autorizado (§17); se rechaza, no se penaliza y permite.`, "action");
        return { ok: true, status: "REJECTED", authorized: false, envelopeVersionKey, reasons };
      }

      const policyVersion = input.policyVersion ?? null;
      const authorization = activeEnvelope.authorizedPolicyVersions.find((entry) => entry.policyVersion === policyVersion) ?? null;
      if (authorization === null) {
        pushRejection(reasons, "POLICY_VERSION_NOT_AUTHORIZED", `La Policy Version "${String(policyVersion)}" no está autorizada por este envelope (§17).`, "policyVersion");
      } else if (authorization.status !== "VALID") {
        pushRejection(reasons, "POLICY_VERSION_RETIRED", `La Policy Version "${policyVersion}" está RETIRED bajo este envelope: haber sido aprobada en el pasado no basta (§18.3).`, "policyVersion");
      } else if (envelopeVersionKeyOf({ envelopeVersion: authorization.underEnvelopeVersion }) !== envelopeVersionKey) {
        // §18.3: la validez se declara bajo cada envelope concreto. Una
        // autorización ligada a otro envelope no confiere autoridad aquí.
        pushRejection(reasons, "AUTHORIZATION_UNDER_OTHER_ENVELOPE", `La autorización de "${policyVersion}" es para otro envelope (${authorization.underEnvelopeVersion}); sólo opera bajo el envelope activo (§17/§18.3).`, "policyVersion");
      } else if (input.envelopeVersionKey !== envelopeVersionKey) {
        pushRejection(reasons, "ENVELOPE_CONTEXT_MISMATCH", "El acto declaró otra versión de envelope; el enforcement sólo opera bajo el envelope activo (§17).", "envelopeVersionKey");
      }

      if (!AUTONOMY_LEVELS.includes(activeEnvelope.autonomyLevel)) {
        pushRejection(reasons, "INVALID_AUTONOMY_LEVEL", "Nivel de autonomía desconocido; fail-closed (§16.2).", "autonomyLevel");
      } else if (action === "BUY" && !LEVELS_WITH_BUY_AUTHORITY.includes(activeEnvelope.autonomyLevel)) {
        pushRejection(reasons, "LEVEL_WITHOUT_BUY_AUTHORITY", `El nivel ${activeEnvelope.autonomyLevel} no concede autoridad de compra real (§16.2).`, "autonomyLevel");
      }

      const dataBlocked = checkAdmissionGates(reasons, input.dataState ?? null);

      if (action === "BUY") {
        const requested = input.quantityMw;
        if (!Number.isFinite(requested) || requested <= 0) {
          pushRejection(reasons, "INVALID_QUANTITY", "BUY exige una cantidad MW positiva declarada; nada se infiere por defecto.", "quantityMw");
        } else {
          const dailyLimit = approvedQuantityLimit("DAILY_CAP");
          const positionLimit = approvedQuantityLimit("MAX_POSITION");
          if (dailyLimit === null) {
            pushRejection(reasons, "QUANTITY_LIMIT_NOT_APPROVED", "No hay límite diario aprobado; sin límite efectivo no hay autoridad de compra (§17).", "quantityLimits");
          } else if (requested > dailyLimit.maxValueMw) {
            pushRejection(reasons, "QUANTITY_ABOVE_LIMIT", `${requested} MW excede el límite diario aprobado ${dailyLimit.maxValueMw} MW/day (§17).`, "quantityMw");
          }
          if (positionLimit === null) {
            pushRejection(reasons, "QUANTITY_LIMIT_NOT_APPROVED", "No hay límite de posición aprobado; fail-closed (§17).", "quantityLimits");
          } else if (requested > positionLimit.maxValueMw) {
            pushRejection(reasons, "QUANTITY_ABOVE_LIMIT", `${requested} MW excede el límite de posición aprobado ${positionLimit.maxValueMw} MW (§17).`, "quantityMw");
          }
        }
      }

      if (reasons.length > 0 || dataBlocked) {
        return { ok: true, status: "REJECTED", authorized: false, envelopeVersionKey, reasons };
      }
      return { ok: true, status: "AUTHORIZED", authorized: true, envelopeVersionKey, reasons: [] };
    },

    // Hard-gate failure (§18.3): la transición HALT/DEMOTE se produce sin
    // esperar aprobación humana y sin consentimiento de la policy. La firma
    // no recibe veto ni consentimiento; ningún campo extra del input puede
    // cancelar el mandato. El destino ROLLBACK se resuelve en rollback.mjs;
    // aquí se emite el mandato del gate.
    mandateHardGateTransition({ gateId, evidenceRef, requestedTransition } = {}) {
      const gate = activeEnvelope.gates.find((entry) => entry.gateId === gateId) ?? null;
      if (gate === null) {
        return { ok: false, code: "UNDECLARED_GATE", message: `El gate "${String(gateId)}" no es parte del envelope; un hard-gate se origina en un gate declarado (§17).` };
      }
      if (!isNonEmptyString(evidenceRef)) {
        return { ok: false, code: "MISSING_EVIDENCE_REF", message: "El mandato declara la evidencia del breach (§18.4 receipt: gate/evidencia que la desencadena)." };
      }
      // Sin transición declarada el mandato es HALT (§18.3 el hard failure
      // detiene la operación); DEMOTE cabe cuando el caller la requiere, sin
      // consentimiento de policy en ningún caso.
      const transition = requestedTransition === "DEMOTE" ? "DEMOTE" : "HALT";
      return {
        ok: true,
        mandate: Object.freeze({
          transition,
          gateId,
          gateKind: gate.kind,
          evidenceRef,
          envelopeVersionKey,
          policyConsentRequired: false,
          policyVetoPossible: false,
        }),
      };
    },

    // El envelope activo que este controller ejecuta: una propuesta de
    // Learning no puede tocarlo (§17: no modifica la versión activa).
    activeEnvelopeSnapshot() {
      return { envelope: activeEnvelope, envelopeVersionKey };
    },
  };
}
