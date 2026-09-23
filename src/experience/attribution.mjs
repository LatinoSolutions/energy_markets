// Atribución (IMP-17). Fuente: SPEC v1.1.1 §12.3 ("Una intervención humana no
// puede desaparecer del dataset de aprendizaje... el outcome efectivamente
// observado no se atribuye sin más a la Candidate Policy original; la
// recomendación y la ejecución permanecen separadas") y §12.3 ("El éxito de
// una campaña tampoco atribuye automáticamente crédito a todas las Strategies
// que emitieron evidencia"). §12.2 separa recommendedAction de executedAction.
//
// El criterio de la SPEC es conservador: ante divergencia recomendación vs.
// ejecución sin intervención documentada, el outcome no se atribuye a la
// policy (fail-closed honesto), jamás se reescribe la recomendación.

import { ARTIFACT_KIND, RECORD_STATES } from "./record.mjs";
import { validateExperienceRecordShape } from "./record.mjs";

export const ATTRIBUTION_CODES = Object.freeze({
  POLICY_ATTRIBUTED: "POLICY_ATTRIBUTED",
  HUMAN_INTERVENTION: "HUMAN_INTERVENTION",
  UNATTRIBUTED_DIVERGENCE: "UNATTRIBUTED_DIVERGENCE",
  NO_EXECUTION: "NO_EXECUTION",
  NO_RECORD: "NO_RECORD",
});

function recommendedActionOf(record) {
  return record?.recommendedAction ?? null;
}

function executedActionOf(record) {
  const execution = record?.execution;
  return execution && typeof execution === "object" ? (execution.executedAction ?? null) : null;
}

// §12.3: la recomendación y la ejecución permanecen separadas para evaluar
// honestamente. Devuelve las dos piezas tal como el registro las declaró; no
// completa la que falte.
export function recommendationVsExecution(record) {
  if (!record || record.artifactKind !== ARTIFACT_KIND) {
    return { ok: false, code: "INVALID_RECORD" };
  }
  return {
    ok: true,
    recommended: { action: recommendedActionOf(record), policyVersion: record.policyVersion },
    executed: { action: executedActionOf(record), hasFills: Array.isArray(record.execution?.fills) && record.execution.fills.length > 0 },
  };
}

// Atribución del outcome (§12.3). Procedencia:
//  - Con intervención humana registrada: el outcome NO se atribuye a la
//    Candidate Policy original; se atribuye a la actuación observada con su
//    intervención como causa documentada. attributedToPolicyVersion = null.
//  - Sin intervención: recomendación == ejecución → el outcome se atribuye a
//    la policy version que generó la recomendación.
//  - Sin intervención y con divergencia recomendación vs. ejecución: no se
//    puede atribuir sin maquillaje → UNATTRIBUTED_DIVERGENCE, attributed null.
//  - Sin ejecución (registro abierto o WAIT puro simulado sin ejecución
//    efectiva): NO_EXECUTION; no hay outcome que atribuir todavía.
export function attributeOutcome(record) {
  if (!record || record.artifactKind !== ARTIFACT_KIND) {
    return { ok: false, code: "NO_RECORD", message: "Sólo se atribuye sobre un registro Experience materializado (§12.2)." };
  }
  const shape = validateExperienceRecordShape(record);
  if (!shape.ok) {
    return { ok: false, code: "INVALID_RECORD_SHAPE", errors: shape.errors };
  }
  if (record.humanIntervention) {
    return {
      ok: true,
      attribution: {
        attributionCode: "HUMAN_INTERVENTION",
        attributedToPolicyVersion: null,
        explanation: `Intervención humana (${record.humanIntervention.kind}) registrada con timestamp/razón/provenance: el outcome observado no se atribuye a la Candidate Policy original (§12.3).`,
        recommendation: { action: record.recommendedAction, policyVersion: record.policyVersion },
        executed: { action: executedActionOf(record), intervention: record.humanIntervention },
      },
    };
  }
  const recommended = recommendedActionOf(record);
  const executed = executedActionOf(record);
  if (executed === null) {
    return {
      ok: true,
      attribution: {
        attributionCode: "NO_EXECUTION",
        attributedToPolicyVersion: null,
        explanation: "Sin ejecución ejecutada registrada no hay outcome efectivo que atribuir (§12.2: la pieza existe cuando hay ejecución).",
        recommendation: { action: recommended, policyVersion: record.policyVersion },
        executed: { action: null },
      },
    };
  }
  if (recommended !== null && executed !== recommended) {
    return {
      ok: true,
      attribution: {
        attributionCode: "UNATTRIBUTED_DIVERGENCE",
        attributedToPolicyVersion: null,
        explanation: "Divergencia entre recomendación y ejecución sin intervención documentada: el outcome no se atribuye a la policy (§12.3, atribución honesta).",
        recommendation: { action: recommended, policyVersion: record.policyVersion },
        executed: { action: executed },
      },
    };
  }
  return {
    ok: true,
    attribution: {
      attributionCode: "POLICY_ATTRIBUTED",
      attributedToPolicyVersion: record.policyVersion,
      explanation: "Recomendación y ejecución coinciden sin intervención: outcome atribuible a la Candidate Policy version registrada (§12.3).",
      recommendation: { action: recommended, policyVersion: record.policyVersion },
      executed: { action: executed },
    },
  };
}

// §12.3: el éxito no atribuye automáticamente crédito a Strategies; la
// contribución se investiga con ablations/comparaciones. Este contrato no
// otorga crédito: devuelve el veredicto de NO-AUTOMATICO mientras no exista el
// estudio de contribución referenciado.
export function strategyCreditClaim(record) {
  if (!record) {
    return { ok: false, code: "NO_RECORD" };
  }
  const claimedStudy = record.strategyContributionStudy ?? null;
  if (claimedStudy === null) {
    return {
      ok: false,
      code: "NO_AUTOMATIC_STRATEGY_CREDIT",
      message: "El outcome no acredita por sí solo a las Strategies que emitieron evidencia; la contribución requiere ablation/comparación declarada (§12.3).",
    };
  }
  return { ok: false, code: "CONTRIBUTION_REQUIRES_ABLATIONS", message: "El crédito sólo puede declarar el estudio de ablation/comparación referenciado, no el registro Experience (§12.3).", study: claimedStudy };
}
