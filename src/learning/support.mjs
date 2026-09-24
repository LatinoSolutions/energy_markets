// Suficiencia de support/State para el aprendizaje offline (IMP-19, DEP-20).
// Fuente: SPEC v1.1.1 §11.2 ("La selección empírica debe comprobar suficiencia
// de memoria/estado, soporte de acciones, muestra efectiva de campañas y valor
// incremental frente a alternativas simples. Muchos decision points no
// equivalen a muchas campañas independientes; el solapamiento debe tratarse
// honestamente. La ausencia o rareza histórica de una acción limita lo que
// puede inferirse con offline RL. Si falta memoria relevante, se investigan
// representaciones de secuencia/belief-state."), §12.1/§12.3 (provenance
// preservada; las fuentes no se igualan en fuerza probatoria) y §25.2.3 IMP-19
// ("Si el support es insuficiente o la prueba refuta al learner, se registra el
// resultado; no se inventa suficiencia para cerrar DEP-20.").
//
// Estas funciones NO producen una versión ni entrena nada: evalúan el corpus
// real y devuelven un estado explícito. Un estado UNDETERMINED nunca se eleva a
// SUFFICIENT por conveniencia.

export const SUPPORT_STATUS = Object.freeze({
  SUFFICIENT: "SUFFICIENT",
  INSUFFICIENT: "INSUFFICIENT",
  UNDETERMINED: "UNDETERMINED",
});

const PERIODIC_ACTIONS = ["BUY", "WAIT"];

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function campaignIdentityOf(record) {
  return record?.provenance?.campaignId
    ?? record?.nextState?.campaignId
    ?? record?.stateSnapshot?.campaignId
    ?? null;
}

// Soporte de acciones (§11.2): cuántas veces aparece cada acción en el corpus.
// Una acción sin soporte histórico limita la inferencia offline; con corpus
// vacío el resultado es UNDETERMINED, nunca SUFFICIENT.
export function evaluateActionSupport({ records = null } = {}) {
  if (!Array.isArray(records)) {
    return { ok: false, code: "INVALID_CORPUS", message: "El corpus de Experience es una lista (§12.2)." };
  }
  const counts = { BUY: 0, WAIT: 0, NO_RECOMMENDATION: 0 };
  for (const record of records) {
    const action = record?.recommendedAction ?? null;
    if (action === null) {
      counts.NO_RECOMMENDATION += 1;
    } else if (PERIODIC_ACTIONS.includes(action)) {
      counts[action] += 1;
    }
  }
  const missingActions = PERIODIC_ACTIONS.filter((action) => counts[action] === 0);
  const status = records.length === 0
    ? SUPPORT_STATUS.UNDETERMINED
    : (missingActions.length === 0 ? SUPPORT_STATUS.SUFFICIENT : SUPPORT_STATUS.INSUFFICIENT);
  return {
    ok: true,
    decisionPoints: records.length,
    counts,
    missingActions,
    status,
    note: "El soporte se mide sobre acciones realmente recomendadas; una acción ausente/escasa no se rellena (§11.2).",
  };
}

// Muestra efectiva de campañas (§11.2). Los decision points no son campañas
// independientes; el número de campañas distintas se cuenta por identidad de
// provenance. Sin un mínimo predeclarado el estado es UNDETERMINED (no se
// asume un umbral).
export function evaluateCampaignSamples({ records = null, minimumCampaigns = null } = {}) {
  if (!Array.isArray(records)) {
    return { ok: false, code: "INVALID_CORPUS", message: "El corpus de Experience es una lista (§12.2)." };
  }
  const campaigns = new Set();
  let recordsWithoutCampaign = 0;
  const policyVersions = new Set();
  for (const record of records) {
    const campaignId = campaignIdentityOf(record);
    if (isNonEmptyString(campaignId)) {
      campaigns.add(campaignId);
    } else {
      recordsWithoutCampaign += 1;
    }
    if (isNonEmptyString(record?.policyVersion)) {
      policyVersions.add(record.policyVersion);
    }
  }
  const declaredMinimum = Number.isInteger(minimumCampaigns) && minimumCampaigns > 0 ? minimumCampaigns : null;
  let status;
  if (records.length === 0 || declaredMinimum === null) {
    status = SUPPORT_STATUS.UNDETERMINED;
  } else if (campaigns.size >= declaredMinimum && recordsWithoutCampaign === 0) {
    status = SUPPORT_STATUS.SUFFICIENT;
  } else {
    status = SUPPORT_STATUS.INSUFFICIENT;
  }
  return {
    ok: true,
    decisionPoints: records.length,
    distinctCampaigns: campaigns.size,
    recordsWithoutCampaign,
    policyVersions: [...policyVersions],
    minimumCampaigns: declaredMinimum,
    status,
    note: "Muchos decision points no equivalen a muchas campañas independientes; el solapamiento debe tratarse honestamente (§11.2).",
  };
}

// Adecuación Markov/estado (§11.2). Sin una declaración de memoria/estado no se
// asume Markov-like: UNDETERMINED. Si la evidencia declara que se requiere
// memoria, el estado actual es INSUFFICIENT y se recomienda investigar
// secuencia/belief-state — no se aprueba por tener muchos decision points.
export function evaluateMarkovAdequacy({ records = null, stateDeclaration = null } = {}) {
  if (!Array.isArray(records)) {
    return { ok: false, code: "INVALID_CORPUS", message: "El corpus de Experience es una lista (§12.2)." };
  }
  if (!stateDeclaration || typeof stateDeclaration !== "object" || Array.isArray(stateDeclaration)) {
    return {
      ok: true,
      status: SUPPORT_STATUS.UNDETERMINED,
      stateEncoding: null,
      reason: "Sin declaración de la representación de estado/memoria no se asume Markov-like (§11.2).",
    };
  }
  const memory = stateDeclaration.memory ?? null;
  const kind = memory?.kind ?? null;
  if (kind === "MARKOV") {
    if (isNonEmptyString(memory?.evidenceRef)) {
      return { ok: true, status: SUPPORT_STATUS.SUFFICIENT, stateEncoding: stateDeclaration.stateEncoding ?? null, reason: "La declaración Markov-like está respaldada por evidencia (§11.2)." };
    }
    return {
      ok: true,
      status: SUPPORT_STATUS.UNDETERMINED,
      stateEncoding: stateDeclaration.stateEncoding ?? null,
      reason: "Una declaración MARKOV sin evidencia referenciada no se acepta como suficiente (§11.2).",
    };
  }
  if (kind === "MEMORY_REQUIRED") {
    return {
      ok: true,
      status: SUPPORT_STATUS.INSUFFICIENT,
      stateEncoding: stateDeclaration.stateEncoding ?? null,
      reason: "La evidencia indica memoria relevante: se investigan representaciones de secuencia/belief-state (§11.2).",
    };
  }
  return {
    ok: true,
    status: SUPPORT_STATUS.UNDETERMINED,
    stateEncoding: stateDeclaration.stateEncoding ?? null,
    reason: "Declaración de estado/memoria sin kind reconocido (MARKOV/MEMORY_REQUIRED): UNDETERMINED (§11.2).",
  };
}

// Evaluación agregada del support (DEP-20). Sólo es SUFFICIENT si las tres
// dimensiones lo son; cualquier INSUFFICIENT domina; cualquier UNDETERMINED
// impide declarar suficiencia. El resultado negativo se conserva, no se
// suaviza (§25.2.3 IMP-19).
export function evaluateSupportSufficiency({ records = null, stateDeclaration = null, minimumCampaigns = null } = {}) {
  const action = evaluateActionSupport({ records });
  const campaignSamples = evaluateCampaignSamples({ records, minimumCampaigns });
  const markov = evaluateMarkovAdequacy({ records, stateDeclaration });
  const components = { action, campaignSamples, markov };
  const failedComponent = ["action", "campaignSamples", "markov"].filter((name) => components[name].ok !== true);
  if (failedComponent.length > 0) {
    return { ok: false, code: "SUPPORT_COMPONENT_INVALID", components, status: SUPPORT_STATUS.UNDETERMINED };
  }
  const statuses = [action.status, campaignSamples.status, markov.status];
  let status = SUPPORT_STATUS.SUFFICIENT;
  if (statuses.includes(SUPPORT_STATUS.INSUFFICIENT)) {
    status = SUPPORT_STATUS.INSUFFICIENT;
  } else if (statuses.includes(SUPPORT_STATUS.UNDETERMINED)) {
    status = SUPPORT_STATUS.UNDETERMINED;
  }
  return {
    ok: true,
    status,
    sufficient: status === SUPPORT_STATUS.SUFFICIENT,
    components,
    note: "Si el support es insuficiente o indeterminado se registra el resultado; no se inventa suficiencia para cerrar DEP-20 (§25.2.3).",
  };
}

export { campaignIdentityOf };