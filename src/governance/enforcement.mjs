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

import { AUTONOMY_LEVELS, GATE_KINDS, validateEnvelopeShape, envelopeVersionKeyOf } from "./envelope.mjs";

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
    return { exists: true, evaluated: true, result: evaluation.result, gate };
  }

  function gateBlocking(reasons, gateId, dataState) {
    const state = gateState(gateId, dataState);
    if (!state.exists) {
      pushRejection(reasons, "UNDECLARED_GATE", `El envelope no declara el gate "${gateId}"; ninguna decisión extra-envelope (§17).`, "dataState.gateResults");
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
    for (const gate of activeEnvelope.gates.filter((g) => g.kind === GATE_KINDS.DATA_VALIDITY || g.kind === GATE_KINDS.OOD)) {
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
