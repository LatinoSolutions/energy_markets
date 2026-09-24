// Captura prospectiva Shadow (IMP-18). Fuente: SPEC v1.1.1 §15.3 (registra
// qué datos podía consumir la policy, qué recomendó, cuándo y qué habría
// ejecutado bajo el contrato hipotético), §12.1 (Shadow factual: recomendación
// timestamped emitida antes del path posterior; fills hipotéticos siguen
// simulados), §13.2/§13.4 (controller común y semántica BUY/WAIT) y §12.2
// (registro Experience y sus piezas).
//
// Cada oportunidad captura: frontera y vista PIT (known-at), recomendación de
// la versión fija (arm A1 del manifest congelado) ANTES de los datos
// posteriores y ejecución hipotética etiquetada SIMULATED_FILL. Fail-closed:
// un dato presentado como consumible con timestamp posterior al decision time,
// o un "posterior" con timestamp anterior a la recomendación, aborta el paso
// (interferencia temporal; nunca ajuste retroactivo). La captura avanza sólo
// su propio estado hipotético: no interfiere con campañas reales ni con el
// replay P6.

import { executionParameterOf } from "../execution-contract/execution-contract.mjs";
import { selectEligibleReference, deriveSimulatedFillPrice } from "../execution-contract/causal-fill.mjs";
import { computeRemainingVolume } from "../procurement-contract/coverage-ownership.mjs";
import { reconcileControlQuantity } from "../sizing-controller/sizing-controller.mjs";
import { readDecisionView } from "../pit-views/index.mjs";
import { toUtcTimestamp } from "../pit-views/time.mjs";
import { buildExperienceRecord } from "../experience/record.mjs";
import { FILL_EVIDENCE_KINDS } from "../experience/source-types.mjs";
import { intactedSession, SHADOW_SESSION_KIND } from "./session.mjs";

export const SHADOW_STEP_KIND = "IMP-18_SHADOW_STEP";

function fail(code, message, extra = {}) {
  return { ok: false, code, message, ...extra };
}

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function instantMs(value) {
  const parsed = toUtcTimestamp(value);
  if (!parsed.ok) {
    return { ok: false, code: parsed.code ?? "INVALID_TIMESTAMP" };
  }
  return { ok: true, ms: Date.parse(parsed.utc) };
}

// §15.3: la captura exige la versión fija de la sesión, sin mutación y abierta.
function verifySessionBounds({ session, frozen }) {
  if (!session || typeof session !== "object" || session.artifactKind !== SHADOW_SESSION_KIND) {
    return fail("MISSING_SHADOW_SESSION", "La captura exige una sesión Shadow abierta con versión fija (§15.3).");
  }
  const sessionCheck = intactedSession(session);
  if (sessionCheck.intact !== true) {
    return fail(sessionCheck.code, "El objeto sesión no es el sellado en la apertura: no hay captura sobre una sesión mutada (§15.4).");
  }
  if (session.frozenManifestContentHash !== frozen?.contentHash) {
    return fail("SESSION_EXPERIMENT_MISMATCH", "La captura corre contra el manifest congelado de la sesión, no contra otro experimento (§15.3: versión fija).");
  }
  if (session.status !== "OPEN") {
    return fail("SESSION_CLOSED", "La sesión ya no acepta captura.");
  }
  return null;
}

// §12.1: los datos que la policy puede consumir en la frontera ya EXISTÍAN
// (timestamp <= decision time). Un consumible con timestamp posterior es fuga
// prospectiva, no información disponible.
function validateSightableObservations({ observations, decisionMs }) {
  if (!Array.isArray(observations)) {
    return fail("INVALID_PRICE_OBSERVATIONS", "Las observaciones de precio deben ser una lista.");
  }
  for (const [index, observation] of observations.entries()) {
    if (!observation || typeof observation !== "object"
      || !isFiniteNumber(observation.bestAsk) || observation.bestAsk <= 0) {
      return fail("INVALID_PRICE_OBSERVATION", `priceObservations[${index}] inválida: exige bestAsk finito > 0.`);
    }
    const when = instantMs(observation.timestamp);
    if (!when.ok) {
      return fail(when.code ?? "INVALID_PRICE_OBSERVATION_TIMESTAMP", `priceObservations[${index}].timestamp no es un instante anclado (§6.1).`);
    }
    if (when.ms > decisionMs) {
      return fail("KNOWN_AT_VIOLATION", `La observación ${observation.timestamp} es posterior al decision time: la captura sólo consume datos con timestamp <= decisionTimeUtc (§15.3).`);
    }
  }
  return null;
}

// §12.1: la trayectoria posterior realizada llega DESPUÉS de la recomendación.
// Un "posterior" con timestamp <= recommendation es retroactividad.
function validatePosteriorObservations({ observations, decisionMs }) {
  if (!Array.isArray(observations)) {
    return fail("INVALID_POSTERIOR_OBSERVATIONS", "La trayectoria posterior debe ser una lista.");
  }
  for (const [index, observation] of observations.entries()) {
    if (!observation || typeof observation !== "object" || !isFiniteNumber(observation.bestAsk)) {
      return fail("INVALID_POSTERIOR_OBSERVATION", `posteriorObservations[${index}] inválida.`);
    }
    const when = instantMs(observation.timestamp);
    if (!when.ok) {
      return fail(when.code ?? "INVALID_POSTERIOR_TIMESTAMP", `posteriorObservations[${index}].timestamp no es un instante anclado (§6.1).`);
    }
    if (when.ms <= decisionMs) {
      return fail("TEMPORAL_INTERFERENCE", `posteriorObservations[${index}] con timestamp ${observation.timestamp} no es posterior a la recomendación: el Shadow no se ajusta retroactivamente (§15.3).`);
    }
  }
  return null;
}

// §13.2/§13.6: el sizing lo derive el controller congelado común; la captura
// no inventa cantidad.Una derivación imposible aborta el paso.
function controllerQuantityOf({ bundle, remainingVolume, remainingOpportunitiesCount, isLastScheduledOpportunity }) {
  return reconcileControlQuantity({
    remainingVolumeMw: remainingVolume,
    remainingOpportunitiesCount,
    controller: {
      lotSizeMw: bundle.sizingConfiguration.lotSizeMw,
      dailyCapMw: bundle.sizingConfiguration.dailyCapMw,
    },
    isLastScheduledOpportunity,
  });
}

// §13.6 regla 1 + §14.7: referencia at-or-before la frontera y precio derivado
// del contrato frozen; sin precio elegible no hay fill y no se inventa precio.
function deriveHypotheticalFill({ sightableObservations, executionContract, decisionTimeUtc }) {
  const selection = selectEligibleReference({ observations: sightableObservations, decisionTime: decisionTimeUtc });
  if (!selection.ok) {
    return { fillable: false, executionPrice: null, referenceTimestamp: null, reason: `no-executable-price: ${selection.reason}` };
  }
  const slippageParameter = executionParameterOf(executionContract, "slippage");
  if (!slippageParameter || slippageParameter.status === "UNKNOWN" || !isFiniteNumber(slippageParameter.value)) {
    return { fillable: false, executionPrice: null, referenceTimestamp: null, reason: "no-executable-price: el execution contract no declara un slippage utilizable (§13.6 regla 4)." };
  }
  const derived = deriveSimulatedFillPrice({
    referenceBestAsk: selection.reference.bestAsk,
    slippage: slippageParameter.value,
    referenceUnit: "EUR/MWh",
    slippageUnit: slippageParameter.unit ?? "EUR/MWh",
  });
  if (!derived.ok) {
    return { fillable: false, executionPrice: null, referenceTimestamp: null, reason: `no-executable-price: ${derived.reason}` };
  }
  return { fillable: true, executionPrice: derived.price, referenceTimestamp: selection.reference.timestamp, reason: null };
}

// Estado de progreso prospectivo: la captura avanza su PROPIO estado
// hipotético de obligación/cobertura; sin campañas reales attached.
export function openShadowProgress({ session, frozen } = {}) {
  const boundsGuard = verifySessionBounds({ session, frozen });
  if (boundsGuard) return boundsGuard;

  const bundle = frozen.frozenBundles.a1;
  const opportunities = bundle.decisionCalendar.opportunities ?? [];
  if (!Array.isArray(opportunities) || opportunities.length === 0) {
    return fail("NO_DECISION_OPPORTUNITIES", "El calendario del manifest congelado no declara oportunidades de decisión (§13.2).");
  }
  const openingObligation = bundle.openingContract.openingObligation;
  if (!isFiniteNumber(openingObligation) || openingObligation <= 0) {
    return fail("INVALID_OPENING_OBLIGATION", "El opening obligation del manifest congelado no es un volumen finito positivo.");
  }
  return {
    ok: true,
    progress: {
      sessionId: session.sessionId,
      sessionContentHash: session.contentHash,
      cursor: 0,
      frontierDate: null,
      filledOnFrontier: 0,
      executedVolume: 0,
      remainingVolume: openingObligation,
      terminal: false,
    },
  };
}

// §14.3 paso 2: PIT visible en la frontera exacta; referencias reales del
// manifest de IMP-06, no listas construidas a mano.
function pitReferencesAt({ bundle, decisionTimeUtc }) {
  const view = readDecisionView(bundle.data.manifest, decisionTimeUtc);
  if (!view.ok) {
    return { references: [], note: view.reason ?? view.code ?? "vista PIT no legible en la frontera de captura (§14.3 paso 2)" };
  }
  return {
    references: view.visible.map((entry) => ({
      key: entry.key,
      revisionId: entry.revisionId,
      consumableFromUtc: entry.consumableFromUtc,
    })),
  };
}

// Fila de captura Shadow: la pieza prospectiva del path (§15.3), separada del
// registro Experience (que la construye a su vez). El posterior queda aquí.
function buildShadowStep({ sequence, opportunity, recommendedAction, requestedQuantity, hypotheticalExecution, pit, posteriorObservations, record }) {
  return {
    artifactKind: SHADOW_STEP_KIND,
    sequence,
    sessionKind: SHADOW_SESSION_KIND,
    frontier: opportunity.date,
    decisionTimeUtc: opportunity.decisionTimeUtc,
    recommendedAction,
    requestedQuantity,
    hypotheticalExecution,
    posteriorTrajectory: posteriorObservations,
    pitReferences: pit.references,
    pitNote: pit.note ?? null,
    recordId: record?.recordId ?? null,
  };
}

// §12.2: registro Experience de la recomendación capturada (sourceType
// SHADOW, synthetic cuando la sesión lo declara), con su ejecución hipotética
// cuando BUY. "Que habría ejecutado bajo el contrato hipotético" (§15.3).
function buildShadowRecord({ session, opportunity, pitReferences, recommendedAction, noRecommendationReason, execution, nextExecuted, nextRemaining, unit }) {
  return buildExperienceRecord({
    recordState: "OPEN",
    sourceType: "SHADOW",
    policyVersion: session.policyVersion,
    stateSnapshot: {
      frontierUtc: opportunity.decisionTimeUtc,
      frontierDate: opportunity.date,
      knownAtSemantics: "PROSPECTIVE_KNOWN_AT: sólo datos con timestamp <= decisionTimeUtc (§15.3)",
      pitReferences,
      dataReference: {
        kind: "PIT_DATA_MANIFEST",
        manifestId: session.datasetManifestId,
        manifestVersion: session.datasetManifestVersion,
      },
    },
    strategyOutputs: [],
    uncertainty: null,
    recommendedAction,
    noRecommendationReason,
    execution,
    humanIntervention: null,
    nextState: {
      source: "IMP-18_SHADOW_HYPOTHETICAL_STATE",
      asOfDate: opportunity.date,
      executedVolume: nextExecuted,
      remainingVolume: nextRemaining,
      unit,
    },
    outcome: null,
    recommendedAtUtc: opportunity.decisionTimeUtc,
    recordedAtUtc: opportunity.decisionTimeUtc,
    synthetic: session.synthetic,
    provenance: {
      kind: "IMP-18_SHADOW_SESSION",
      sessionId: session.sessionId,
      experimentId: session.experiment.experimentId,
      campaignId: session.campaignId,
      frozenManifestContentHash: session.frozenManifestContentHash,
      notation: "captura Shadow prospectiva; el outcome al cierre llega via closeShadowSession (§12.2)",
    },
  });
}

// Una oportunidad de la captura prospectiva. Devuelve la fila (step), el
// registro Experience y el siguiente progreso; fail-closed ante interferencia
// temporal, calendario agotado o falta de derivación del controller.
export function captureShadowOpportunity({ session, frozen, progress, sightablePriceObservations = null, posteriorObservations = [] } = {}) {
  const boundsGuard = verifySessionBounds({ session, frozen });
  if (boundsGuard) return boundsGuard;

  const bundle = frozen.frozenBundles.a1;
  const opportunities = bundle.decisionCalendar.opportunities;
  if (progress?.terminal === true || progress?.cursor >= opportunities.length) {
    return fail("CAPTURE_PAST_CALENDAR_END", "El calendario prospectivo ya se recorrió completo: no hay capturas fuera de cronología (§13.2).");
  }
  if (progress?.sessionId !== session.sessionId || progress?.sessionContentHash !== session.contentHash) {
    return fail("PROGRESS_SESSION_MISMATCH", "El progreso prospectivo pertenece a otra sesión o a otro sello de apertura (§15.3).");
  }
  if (!isFiniteNumber(progress.executedVolume) || !isFiniteNumber(progress.remainingVolume)) {
    return fail("INVALID_PROGRESS_STATE", "El progreso no declara ejecutado/restante finitos (§13.4).");
  }

  const opportunity = opportunities[progress.cursor];
  const decisionMs = instantMs(opportunity.decisionTimeUtc);
  if (!decisionMs.ok) {
    return fail(decisionMs.code ?? "INVALID_DECISION_TIME", "decisionTimeUtc del calendario no es un instante anclado (§6.1).");
  }

  const sightableGuard = validateSightableObservations({
    observations: sightablePriceObservations ?? bundle.priceObservations,
    decisionMs: decisionMs.ms,
  });
  if (sightableGuard) return sightableGuard;

  const posteriorGuard = validatePosteriorObservations({
    observations: posteriorObservations,
    decisionMs: decisionMs.ms,
  });
  if (posteriorGuard) return posteriorGuard;

  const pit = pitReferencesAt({ bundle, decisionTimeUtc: opportunity.decisionTimeUtc });
  const previousExecuted = progress.executedVolume;
  const previousRemaining = progress.remainingVolume;

  // Recomendación de la versión fija: el arm congelado decide en la frontera.
  const decision = bundle.arm.decideAtOpportunity({
    currentDate: opportunity.date,
    remainingVolumeMw: previousRemaining,
    executionNotionalMw: previousExecuted,
  });

  const isLast = progress.cursor === opportunities.length - 1;
  let recommendedAction = null;
  let noRecommendationReason = null;
  let requestedQuantity = 0;
  let execution = null;
  let filledNow = 0;
  let blockedNow = false;

  if (!decision.ok) {
    // §14.7: faltante crítico sin conducta frozen → sin recomendación, la
    // captura termina y el estado queda abierto, no reparado.
    noRecommendationReason = decision.reason ?? decision.code ?? "bloqueo de decisión en la frontera";
    blockedNow = true;
  } else {
    recommendedAction = decision.action;
    if (recommendedAction === "BUY") {
      const sizing = controllerQuantityOf({
        bundle,
        remainingVolume: previousRemaining,
        remainingOpportunitiesCount: opportunities.length - progress.cursor,
        isLastScheduledOpportunity: isLast,
      });
      if (!sizing.ok) {
        return fail(sizing.code ?? "SIZING_DERIVATION_FAILED", "La derivación del controller congelado no existe: la captura no inventa requested quantity (§13.2).");
      }
      requestedQuantity = sizing.requestedQuantityMw;
      const capParameter = executionParameterOf(bundle.executionContract, "dailyQuantityCap");
      const dailyCap = isFiniteNumber(capParameter?.value) ? capParameter.value : null;
      let fillable = requestedQuantity;
      let capConstrained = false;
      if (dailyCap !== null && fillable > dailyCap - progress.filledOnFrontier) {
        fillable = Math.max(0, dailyCap - progress.filledOnFrontier);
        capConstrained = true;
      }
      const derived = fillable > 0
        ? deriveHypotheticalFill({ sightableObservations: sightablePriceObservations ?? bundle.priceObservations, executionContract: bundle.executionContract, decisionTimeUtc: opportunity.decisionTimeUtc })
        : { fillable: false, executionPrice: null, referenceTimestamp: null, reason: "no-capacity-under-daily-cap (§13.6)" };

      const filled = derived.fillable ? fillable : 0;
      filledNow = filled;
      execution = {
        executedAction: filled > 0 ? "BUY" : null,
        requestedQuantity,
        noFill: filled <= 0,
        fills: filled > 0
          ? [{
              evidenceKind: FILL_EVIDENCE_KINDS.SIMULATED_FILL,
              quantity: filled,
              price: derived.executionPrice,
              timestampUtc: derived.referenceTimestamp,
              capConstrained,
              treatment: "HYPOTHETICAL: simulado bajo el contrato frozen (§12.1); no es una orden real",
            }]
          : [],
      };
    }
  }

  const nextExecuted = previousExecuted + filledNow;
  const after = computeRemainingVolume({
    openingObligation: bundle.openingContract.openingObligation,
    executedVolume: nextExecuted,
    openingUnit: bundle.openingContract.unit,
    executedUnit: bundle.openingContract.unit,
  });
  if (!after.computed) {
    return fail("SHADOW_CONSERVATION_VIOLATION", `La conservación del volumen hipotético viola §14.5 en ${opportunity.date}: ${after.reason}.`);
  }
  const nextRemaining = after.remainingVolume;

  const recordResult = buildShadowRecord({
    session,
    opportunity,
    pitReferences: pit.references,
    recommendedAction,
    noRecommendationReason,
    execution,
    nextExecuted,
    nextRemaining,
    unit: bundle.openingContract.unit,
  });
  if (!recordResult.ok) {
    return fail("EXPERIENCE_RECORD_BUILD_FAILED", "El registro Experience de la captura no satisface §12.2.", { errors: recordResult.errors });
  }
  const record = recordResult.record;

  const nextProgress = {
    sessionId: progress.sessionId,
    sessionContentHash: progress.sessionContentHash,
    cursor: progress.cursor + 1,
    frontierDate: opportunity.date,
    filledOnFrontier: filledNow,
    executedVolume: nextExecuted,
    remainingVolume: nextRemaining,
    terminal: progress.cursor + 1 >= opportunities.length || blockedNow,
  };
  const step = buildShadowStep({
    sequence: progress.cursor + 1,
    opportunity,
    recommendedAction,
    requestedQuantity,
    hypotheticalExecution: execution ?? null,
    pit: { references: pit.references, note: pit.note ?? null },
    posteriorObservations,
    record,
  });
  return { ok: true, step, record, nextProgress };
}
