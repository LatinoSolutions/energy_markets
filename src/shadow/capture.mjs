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

import { executionParameterOf, contentHashOf } from "../execution-contract/execution-contract.mjs";
import { selectEligibleReference, deriveSimulatedFillPrice } from "../execution-contract/causal-fill.mjs";
import { computeRemainingVolume } from "../procurement-contract/coverage-ownership.mjs";
import { reconcileControlQuantity } from "../sizing-controller/sizing-controller.mjs";
import { readDecisionView } from "../pit-views/index.mjs";
import { toUtcTimestamp } from "../pit-views/time.mjs";
import { buildExperienceRecord } from "../experience/record.mjs";
import { FILL_EVIDENCE_KINDS } from "../experience/source-types.mjs";
import { DAILY_CAP_MW, minimumRequired } from "../exploratory/backtest.mjs";
import { OBSERVATION_RULE_LIST, TOB_SLOT_RULE } from "../trades-bridge/constants.mjs";
import { berlinSlotLabelOf } from "../trades-bridge/time.mjs";
import { buildDeleteIndex } from "../trades-source/delete-point-in-time.mjs";
import { observationAtInstant } from "../trades-engine/observation.mjs";
import { TRADES_POLICIES } from "../trades-engine/episode.mjs";
import { tradesFillPrice } from "../trades-engine/fill.mjs";
import { missionDefinition, missionKeyForContract } from "../trades-engine/missions.mjs";
import { missionObservationConfig, resolveFrozenConfig } from "../trades-engine/run.mjs";
import { canonicalCampaignIdFromLegacy } from "../oos-reservation/trades-windows.mjs";
import { ZONES } from "../oos-reservation/trades-zones.mjs";
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

// Un día con el registro paralelo BLOCKED (p. ej. el contrato TRADES todavía en
// HOLD) no puede dejar la sesión sin estado. La captura TOB avanzó su progreso
// igual, así que el forward avanza su cursor con él y las fuentes quedan
// intactas (ninguna decisión TRADES se tomó): el hueco no se salta en silencio,
// el paso lo registra como BLOCKED con su código (patch 03 §4 "Forward desde el
// freeze de TRADES-v1" y §7 "TRADES en forward corre en paralelo solo como
// registro shadow"). Sin esto, el primer día bloqueado deja el registro TRADES
// bloqueado para el resto de la sesión: el cursor del estado ya no coincide con
// el del progreso y toda captura posterior falla FORWARD_STATE_OUT_OF_SEQUENCE.
//
// Un estado ausente o desfasado NO se "cura" aquí: avanzarlo sería saltarse días
// sin registro. En ese caso se devuelve null y el siguiente intento vuelve a
// fallar con su código (fail-closed).
function nextForwardStateAfterBlocked({ session, frozen, progress, forwardState }) {
  const base = forwardState ?? openForwardTradesState({ session, frozen, startCursor: progress.cursor }).state;
  if (!base || base.cursor !== progress.cursor) {
    return null;
  }
  return { ...base, cursor: progress.cursor + 1 };
}

// Una oportunidad de la captura prospectiva. Devuelve la fila (step), el
// registro Experience y el siguiente progreso; fail-closed ante interferencia
// temporal, calendario agotado o falta de derivación del controller.
//
// TR-08: si el llamante aporta `forwardTrades` (misión + filas TRADES + contrato
// TRADES-v1 FROZEN + estado propio), el paso se extiende con el registro
// paralelo de las decisiones LAST_TRADE y SLOT_VWAP comparadas contra el TOB
// vivo. Sin `forwardTrades` la captura IMP-18 queda exactamente como antes.
export function captureShadowOpportunity({ session, frozen, progress, sightablePriceObservations = null, posteriorObservations = [], forwardTrades = null } = {}) {
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
  if (forwardTrades) {
    // El registro TRADES en el forward es SÓLO registro shadow (patch 03 §7): no
    // condiciona la captura TOB. Si el contrato no está FROZEN (HOLD) o falta
    // cualquier pieza del registro paralelo, el paso TOB se devuelve igual y el
    // registro queda marcado como bloqueado con su código, en vez de tumbar la
    // captura viva.
    const parallel = registerForwardTradesHypotheses({
      session,
      frozen,
      progress,
      forwardState: forwardTrades.forwardState ?? null,
      missionKey: forwardTrades.missionKey,
      tradesRows: forwardTrades.tradesRows ?? [],
      deleteIndex: forwardTrades.deleteIndex ?? null,
      frozenTradesContract: forwardTrades.frozenTradesContract ?? null,
      sightablePriceObservations: sightablePriceObservations ?? bundle.priceObservations,
      slotLabel: forwardTrades.slotLabel,
    });
    if (!parallel.ok) {
      step.parallelTradesHypotheses = {
        ok: false,
        status: "BLOCKED",
        code: parallel.code,
        reason: parallel.reason ?? parallel.message ?? null,
      };
      // El progreso TOB avanzó igual, así que el estado del forward avanza su
      // cursor con él para que el día siguiente pueda retomar; el hueco queda
      // registrado como BLOCKED con su código, nunca saltado en silencio.
      return {
        ok: true,
        step,
        record,
        nextProgress,
        nextForwardState: nextForwardStateAfterBlocked({
          session,
          frozen,
          progress,
          forwardState: forwardTrades.forwardState ?? null,
        }),
      };
    }
    step.parallelTradesHypotheses = parallel.registration;
    return { ok: true, step, record, nextProgress, nextForwardState: parallel.nextForwardState };
  }
  return { ok: true, step, record, nextProgress };
}

// ---------------------------------------------------------------------------
// TR-08: forward shadow con TOB vivo como contrato de ejecución y registro
// paralelo de las decisiones TRADES (LAST_TRADE / SLOT_VWAP). Fuente:
// TRADES_MODE_PLAN.md TR-08 ("El forward corre con el contrato TOB sobre ask
// vivo; en paralelo registra las decisiones LAST_TRADE y SLOT_VWAP para comparar
// cada hipótesis contra lo que el TOB vivo habría hecho. Requiere extender
// src/shadow/capture.mjs, que hoy usa el fill canónico TOB y consume el brazo A1
// de P5, no DIP10") y OWNER_PATCH_TRADES_MODE_2026-09-25.md §3.2/§7.
//
// La ejecución del forward sigue siendo TOB: la referencia es el último best ask
// vivo at-or-before la frontera (causal-fill) y el precio simulado añade el
// slippage frozen. Sobre la MISMA frontera se corre la MISMA policy (DIP10) con
// tres fuentes de observación —TOB vivo, LAST_TRADE y SLOT_VWAP— para que el
// contraste sea manzana-con-manzana; cada hipótesis se compara contra el TOB
// vivo. El contrato TRADES-v1 (TR-04) es un gate: sin FROZEN con frescura y
// penalización medidas, el registro de las hipótesis TRADES queda fail-closed
// (nunca se inventa frescura ni penalización). Las filas de trades llegan
// acotadas al contrato de la campaña; el módulo las valida contra la misión y el
// contrato del bundle y rechaza cualquier fila ajena (no abre el lago).

export const FORWARD_TRADES_REGISTRATION_KIND = "TR-08_FORWARD_TRADES_PARALLEL_REGISTRATION";
export const FORWARD_TRADES_SOURCE_TOB = "TOB";
export const FORWARD_TRADES_OBSERVATION_SOURCES = Object.freeze([FORWARD_TRADES_SOURCE_TOB, ...OBSERVATION_RULE_LIST]);
export const FORWARD_TRADES_HYPOTHESIS_RULES = OBSERVATION_RULE_LIST;

function forwardSourceState({ executedVolume, remainingVolume, pastPrices = [] } = {}) {
  return {
    executedVolume,
    remainingVolume,
    pastPrices: [...pastPrices],
  };
}

// Estado propio de cada fuente de observación del forward. Arranca de la
// obligación de apertura del bundle congelado; `seedPastPrices` es una historia
// PIT declarada por el llamante (sólo pasado), no un relleno de conveniencia.
//
// El estado va atado a la sesión y a la cronología (§15.3): sessionId +
// contentHash + cursor. Sin ese vínculo, repetir un día o saltarlo duplicaría o
// perdería compras y precios del historial de DIP10, como ya evita
// `PROGRESS_SESSION_MISMATCH` en el progreso IMP-18.
//
// `startCursor` (patch 03 §4: el forward corre "desde el freeze de TRADES-v1",
// no desde la apertura de la sesión TOB): cuando el contrato se congela a mitad
// de una sesión ya en curso, el forward no existía en los días previos, así que
// su estado arranca en el cursor donde se adjunta y deja constancia de ello
// (`startCursor` viaja en el estado y en el registro). Nunca se rellena un día
// previo en silencio: esos días no tienen registro forward porque el forward no
// estaba activo.
export function openForwardTradesState({ session = null, frozen, seedPastPrices = {}, startCursor = 0 } = {}) {
  const openingObligation = frozen?.frozenBundles?.a1?.openingContract?.openingObligation;
  if (!isFiniteNumber(openingObligation) || openingObligation <= 0) {
    return fail("INVALID_OPENING_OBLIGATION", "El opening obligation del bundle congelado no es un volumen finito positivo; el forward TRADES no arranca sin obligación (§13.2).");
  }
  if (!isFiniteNumber(startCursor) || startCursor < 0 || !Number.isInteger(startCursor)) {
    return fail("INVALID_START_CURSOR", "El cursor de arranque del forward debe ser un entero >= 0 (patch 03 §4).");
  }
  const sources = {};
  for (const source of FORWARD_TRADES_OBSERVATION_SOURCES) {
    sources[source] = forwardSourceState({
      executedVolume: 0,
      remainingVolume: openingObligation,
      pastPrices: seedPastPrices[source] ?? [],
    });
  }
  return {
    ok: true,
    state: {
      sessionId: session?.sessionId ?? null,
      sessionContentHash: session?.contentHash ?? null,
      startCursor,
      cursor: startCursor,
      sources,
    },
  };
}

// Identidad de las filas del forward (patch 03 §2/§6): cada fila debe pertenecer
// a la misión de la campaña congelada y a SU contrato (ShortCode + entrega), no a
// otra misión ni a otra entrega. El motor TR-05 ya acota con
// `contractRowsForCampaign`; el forward no puede registrar una hipótesis de un
// mercado ajeno aunque el llamante la cuele (fail-closed, nunca se filtra en
// silencio hacia una comparación falsa).
function validateForwardTradesRows({ tradesRows, missionKey, campaign }) {
  if (!Array.isArray(tradesRows)) {
    return fail("INVALID_TRADES_ROWS", "Las filas de trades del forward deben ser una lista.");
  }
  for (const [index, row] of tradesRows.entries()) {
    const rowMission = missionKeyForContract({ shortCode: row?.ShortCode, maturity: row?.Maturity });
    if (rowMission !== missionKey) {
      return fail("TRADES_ROWS_MISSION_MISMATCH", `tradesRows[${index}] (${row?.ShortCode ?? "?"}|${row?.Maturity ?? "?"}) pertenece a ${rowMission ?? "una misión desconocida"} y no a ${missionKey}: el forward no registra hipótesis de otra misión (patch 03 §2/§6).`);
    }
    const rowCampaignId = canonicalCampaignIdFromLegacy({ shortCode: row?.ShortCode, maturity: row?.Maturity });
    if (rowCampaignId === null || rowCampaignId !== campaign?.campaignId) {
      return fail("TRADES_ROWS_CONTRACT_MISMATCH", `tradesRows[${index}] (${row?.ShortCode ?? "?"}|${row?.Maturity ?? "?"}) es del contrato ${rowCampaignId ?? "desconocido"} y no de la campaña congelada ${campaign?.campaignId ?? "null"}: las filas del forward se validan contra el contrato del bundle (patch 03 §2/§6).`);
    }
  }
  return null;
}

// Una decisión de una fuente: sin observación no hay decisión (fail-closed); con
// observación corre la policy y, si el fill es derivable, avanza el estado
// propio de esa fuente. Nunca se inventa cantidad ni precio.
//
// El cap diario es DURO (revisión TR05-DAILY-CAP-03; `01_shared_campaign_rules.md`
// §5, cap 12 MW/día): la cantidad se recorta a min(remaining, cap, propuesta),
// aunque DIP10 proponga más para recuperar un hueco. Si el mínimo factible L_t ya
// supera el cap, NINGUNA decisión puede cumplirlo y la causa es el hueco de data
// (episode.mjs, dataForcedDays): se registra `forcedByDataGap` en vez de dejar el
// excedente pasar.
function decideForwardSource({ source, sourceState, observation, observationFailure, daysLeft, policy, fillOf, dailyCapMw = DAILY_CAP_MW }) {
  if (!observation || observationFailure) {
    return {
      source,
      status: observationFailure ?? "NO_OBSERVATION",
      observation: null,
      requestedQuantity: null,
      recommendedAction: null,
      fill: null,
      executedDelta: 0,
    };
  }
  const proposed = policy({
    remainingMw: sourceState.remainingVolume,
    daysLeftIncludingToday: daysLeft,
    price: observation.price,
    pastPrices: sourceState.pastPrices,
  });
  const floor = minimumRequired(sourceState.remainingVolume, daysLeft);
  const requestedQuantity = isFiniteNumber(proposed)
    ? Math.max(0, Math.min(sourceState.remainingVolume, dailyCapMw, proposed))
    : null;
  const forcedByDataGap = requestedQuantity !== null && requestedQuantity < floor && floor > dailyCapMw;
  const recommendedAction = requestedQuantity !== null && requestedQuantity > 0 ? "BUY" : "WAIT";
  const fill = fillOf(observation);
  const fillable = fill.ok === true && recommendedAction === "BUY";
  return {
    source,
    status: "DECISION_REGISTERED",
    observation: {
      price: observation.price,
      observationTm: observation.observationTm ?? null,
      observationRule: observation.observationRule ?? source,
      ageSeconds: observation.ageSeconds ?? null,
      aggressor: observation.aggressor ?? null,
    },
    requestedQuantity,
    proposedQuantity: isFiniteNumber(proposed) ? proposed : null,
    floorQuantity: floor,
    forcedByDataGap,
    recommendedAction,
    fill: fill.ok
      ? { fillable, executionPrice: fillable ? fill.price : null }
      : { fillable: false, code: fill.code ?? fill.reason ?? "FILL_UNAVAILABLE", executionPrice: null },
    executedDelta: fillable ? requestedQuantity : 0,
  };
}

function nextForwardSourceState(previous, decision) {
  const executedDelta = decision.executedDelta ?? 0;
  const observedPrice = decision.observation?.price;
  return forwardSourceState({
    executedVolume: previous.executedVolume + executedDelta,
    remainingVolume: Math.max(0, previous.remainingVolume - executedDelta),
    pastPrices: isFiniteNumber(observedPrice) ? [...previous.pastPrices, observedPrice] : previous.pastPrices,
  });
}

// Comparación de una hipótesis contra el TOB vivo con la misma policy. Si
// cualquiera de los dos lados no llegó a decisión, la comparación no es
// fabricable: queda no comparable con su razón.
function compareForwardDecision({ reference, hypothesis }) {
  if (reference.status !== "DECISION_REGISTERED" || hypothesis.status !== "DECISION_REGISTERED") {
    return {
      comparable: false,
      reason: reference.status !== "DECISION_REGISTERED"
        ? `referencia TOB sin decisión: ${reference.status}`
        : `hipótesis sin decisión: ${hypothesis.status}`,
      actionMatch: null,
      requestedQuantityDelta: null,
      priceDelta: null,
    };
  }
  return {
    comparable: true,
    reason: null,
    actionMatch: reference.recommendedAction === hypothesis.recommendedAction,
    requestedQuantityDelta: hypothesis.requestedQuantity - reference.requestedQuantity,
    priceDelta: hypothesis.observation.price - reference.observation.price,
  };
}

// Registra, en la frontera actual del calendario congelado, la decisión TOB vivo
// (contrato de ejecución) y las decisiones LAST_TRADE y SLOT_VWAP, y las compara.
// Fail-closed: sin contrato TRADES FROZEN (gate TR-04), sin misión conocida que
// coincida con la campaña congelada, sin ask vivo elegible o sin observación de
// una regla, ese lado queda sin decisión (no se inventa). Devuelve además el
// estado propio actualizado de cada fuente.
//
// La frontera de las tres fuentes es la MISMA: el instante sale de
// `decisionTimeUtc` del calendario congelado (TOB y TRADES no deciden en slots
// distintos por un default; patch 03 §3.2). `slotLabel`, si se aporta, es sólo
// una comprobación de que el llamante apunta al slot correcto.
export function registerForwardTradesHypotheses({
  session,
  frozen,
  progress,
  forwardState = null,
  missionKey,
  tradesRows = [],
  deleteIndex = null,
  frozenTradesContract = null,
  sightablePriceObservations = null,
  slotLabel = null,
  policyId = "DIP10",
} = {}) {
  const boundsGuard = verifySessionBounds({ session, frozen });
  if (boundsGuard) return boundsGuard;

  // Gate TR-04: sin contrato FROZEN con frescura/penalización medidas no hay
  // registro de hipótesis TRADES; el forward no corre con parámetros inventados.
  const frozenConfig = resolveFrozenConfig(frozenTradesContract);
  if (!frozenConfig.ok) {
    return fail(frozenConfig.code, frozenConfig.reason ?? "El contrato TRADES-v1 no está FROZEN (gate TR-04).");
  }

  const definition = missionDefinition(missionKey);
  if (!definition.ok) {
    return fail(definition.code, `Misión TRADES desconocida: ${missionKey ?? "null"}.`);
  }

  const bundle = frozen.frozenBundles.a1;
  // Identidad de run (patch 03 §2/§6): la misión del forward tiene que ser la de
  // la campaña congelada. Aceptar otra mezcla la obligación y el calendario de
  // una misión con la identidad y el contrato TRADES de otra.
  const campaign = bundle.campaign ?? null;
  if (!campaign || definition.definition.product !== campaign.product || definition.definition.mission !== campaign.mission) {
    return fail("MISSION_BUNDLE_MISMATCH", `La misión ${missionKey} (${definition.definition.product}/${definition.definition.mission}) no coincide con la campaña congelada ${campaign?.product ?? "null"}/${campaign?.mission ?? "null"}: el forward no mezcla identidades de misión (patch 03 §2/§6).`);
  }

  // Las filas del forward se validan contra la misión y el contrato de la
  // campaña congelada; una fila de otro mercado o de otra entrega nunca entra a
  // la comparación (patch 03 §2/§6).
  const rowsGuard = validateForwardTradesRows({ tradesRows, missionKey, campaign });
  if (rowsGuard) return rowsGuard;

  const opportunities = bundle.decisionCalendar.opportunities;
  if (progress?.terminal === true || progress?.cursor >= opportunities.length) {
    return fail("CAPTURE_PAST_CALENDAR_END", "El calendario prospectivo ya se recorrió completo: no hay registro fuera de cronología (§13.2).");
  }
  if (progress?.sessionId !== session.sessionId || progress?.sessionContentHash !== session.contentHash) {
    return fail("PROGRESS_SESSION_MISMATCH", "El progreso prospectivo pertenece a otra sesión o a otro sello de apertura (§15.3).");
  }

  const opportunity = opportunities[progress.cursor];
  const decisionMs = instantMs(opportunity.decisionTimeUtc);
  if (!decisionMs.ok) {
    return fail(decisionMs.code ?? "INVALID_DECISION_TIME", "decisionTimeUtc del calendario no es un instante anclado (§6.1).");
  }
  if (slotLabel !== null && slotLabel !== undefined) {
    const derivedSlot = berlinSlotLabelOf(decisionMs.ms);
    if (derivedSlot !== slotLabel) {
      return fail("SLOT_LABEL_MISMATCH", `El slot ${slotLabel} no es el del instante de decisión ${opportunity.decisionTimeUtc} (${derivedSlot} Europe/Berlin): TOB y TRADES deben decidir en la MISMA frontera (patch 03 §3.2).`);
    }
  }

  const policy = TRADES_POLICIES[policyId];
  if (!policy) {
    return fail("UNKNOWN_POLICY", `La policy ${policyId} no existe en el motor TRADES.`);
  }

  // Sin estado previo, el forward se abre en el cursor actual del progreso: la
  // sesión TOB pudo arrancar antes del freeze de TRADES-v1 (patch 03 §4) y el
  // forward se adjunta en ese momento. Abrir siempre en cursor 0 dejaría la
  // sesión bloqueada para siempre con FORWARD_STATE_OUT_OF_SEQUENCE. El cursor
  // de arranque queda anotado en el estado y en el registro (`startCursor`), así
  // que no hay salto silencioso: los días previos no tienen registro forward
  // porque el forward no estaba activo.
  const opened = forwardState
    ? { ok: true, state: forwardState }
    : openForwardTradesState({ session, frozen, startCursor: progress.cursor });
  if (!opened.ok) return opened;
  const state = opened.state;
  // §15.3: el estado del forward va atado a la sesión y a la cronología. Un
  // estado suelto (sin sello de sesión ni cursor) no se acepta; un estado de otra
  // sesión o de otro día no puede avanzar el forward (repetir un día duplicaría
  // el precio en el historial de DIP10 y las compras).
  if (!state || typeof state !== "object"
    || typeof state.sessionId !== "string"
    || typeof state.sessionContentHash !== "string"
    || !isFiniteNumber(state.cursor)) {
    return fail("INVALID_FORWARD_STATE", "El estado del forward no declara sessionId/sessionContentHash/cursor: un estado suelto no se ata a la sesión ni a la cronología (§15.3).");
  }
  const brokenSource = FORWARD_TRADES_OBSERVATION_SOURCES.find((source) => {
    const entry = state.sources?.[source];
    return !entry || !isFiniteNumber(entry.executedVolume) || !isFiniteNumber(entry.remainingVolume) || !Array.isArray(entry.pastPrices);
  });
  if (brokenSource) {
    return fail("INVALID_FORWARD_STATE", `El estado del forward no declara executedVolume/remainingVolume/pastPrices para ${brokenSource} (§13.4).`);
  }
  if (state.sessionId !== session.sessionId || state.sessionContentHash !== session.contentHash) {
    return fail("FORWARD_STATE_SESSION_MISMATCH", "El estado del forward pertenece a otra sesión o a otro sello de apertura (§15.3).");
  }
  if (state.cursor !== progress.cursor) {
    return fail("FORWARD_STATE_OUT_OF_SEQUENCE", `El estado del forward espera el cursor ${state.cursor} y el progreso apunta al ${progress.cursor}: no hay registro fuera de cronología (§15.3).`);
  }

  // Cursor donde arrancó este forward (patch 03 §4): los estados abiertos por
  // `openForwardTradesState` lo declaran; los de forma previa caen a 0.
  const startCursor = isFiniteNumber(state.startCursor) ? state.startCursor : 0;

  const daysLeft = opportunities.length - progress.cursor;

  // TOB vivo: la referencia de ejecución es el último best ask at-or-before la
  // frontera y el fill añade el slippage frozen del execution contract. Modo TOB
  // (patch 03 §2; `build_tob_slots.py` MAX_AGE_S): el ask debe tener <= 15 min;
  // uno más viejo no es observación viva y no entra a la media de DIP10.
  const sightable = sightablePriceObservations ?? [];
  const tobGuard = validateSightableObservations({ observations: sightable, decisionMs: decisionMs.ms });
  if (tobGuard) return tobGuard;
  const tobSelection = selectEligibleReference({ observations: sightable, decisionTime: opportunity.decisionTimeUtc });
  const tobSlippage = executionParameterOf(bundle.executionContract, "slippage");
  const tobSlippageValue = tobSlippage && tobSlippage.status !== "UNKNOWN" && isFiniteNumber(tobSlippage.value)
    ? tobSlippage.value
    : null;

  let tobObservation = null;
  let tobFailure = tobSelection.ok ? null : tobSelection.code;
  if (tobSelection.ok) {
    const tobAgeSeconds = (decisionMs.ms - Date.parse(tobSelection.reference.timestamp)) / 1000;
    if (tobAgeSeconds > TOB_SLOT_RULE.maxQuoteAgeSeconds) {
      tobFailure = "STALE_OBSERVATION";
    } else {
      tobObservation = {
        price: tobSelection.reference.bestAsk,
        observationTm: tobSelection.reference.timestamp,
        observationRule: FORWARD_TRADES_SOURCE_TOB,
        ageSeconds: tobAgeSeconds,
      };
    }
  }

  const sources = {};
  sources[FORWARD_TRADES_SOURCE_TOB] = decideForwardSource({
    source: FORWARD_TRADES_SOURCE_TOB,
    sourceState: state.sources[FORWARD_TRADES_SOURCE_TOB],
    observation: tobObservation,
    observationFailure: tobFailure,
    daysLeft,
    policy,
    fillOf: (observation) => (tobSlippageValue === null
      ? { ok: false, reason: "el execution contract TOB no declara un slippage utilizable (§13.6 regla 4)." }
      : deriveSimulatedFillPrice({ referenceBestAsk: observation.price, slippage: tobSlippageValue })),
  });

  const index = deleteIndex ?? buildDeleteIndex(tradesRows);
  for (const rule of FORWARD_TRADES_HYPOTHESIS_RULES) {
    const config = missionObservationConfig(frozenTradesContract, missionKey, rule);
    if (!config.ok) {
      sources[rule] = { source: rule, status: config.code, observation: null, requestedQuantity: null, recommendedAction: null, fill: null, executedDelta: 0 };
      continue;
    }
    const result = observationAtInstant({
      rows: tradesRows,
      rule,
      decisionEpochMs: decisionMs.ms,
      freshnessLimitSeconds: config.freshnessLimitSeconds,
      deleteIndex: index,
    });
    sources[rule] = decideForwardSource({
      source: rule,
      sourceState: state.sources[rule],
      observation: result.ok ? result.observation : null,
      observationFailure: result.ok ? null : result.code,
      daysLeft,
      policy,
      fillOf: (observation) => tradesFillPrice({ observation, penaltyEurMwh: config.penaltyEurMwh }),
    });
  }

  const reference = sources[FORWARD_TRADES_SOURCE_TOB];
  const comparison = {};
  for (const rule of FORWARD_TRADES_HYPOTHESIS_RULES) {
    comparison[rule] = compareForwardDecision({ reference, hypothesis: sources[rule] });
  }

  const nextForwardState = {
    sessionId: session.sessionId,
    sessionContentHash: session.contentHash,
    startCursor,
    cursor: progress.cursor + 1,
    sources: Object.fromEntries(FORWARD_TRADES_OBSERVATION_SOURCES.map((source) => [
      source,
      nextForwardSourceState(state.sources[source], sources[source]),
    ])),
  };

  const core = {
    artifactKind: FORWARD_TRADES_REGISTRATION_KIND,
    forwardKind: "TRADES_PARALLEL_FORWARD",
    sessionId: session.sessionId,
    sessionContentHash: session.contentHash,
    sequence: progress.cursor + 1,
    // Cursor donde arrancó el forward (patch 03 §4): si se adjuntó a mitad de
    // sesión, el registro lo declara en vez de saltar los días previos en
    // silencio.
    startCursor,
    frontier: opportunity.date,
    decisionTimeUtc: opportunity.decisionTimeUtc,
    missionKey,
    mission: definition.definition.mission,
    market: definition.definition.market,
    // Patch 03 §2: la identidad de cada run lleva market, mission, source_mode,
    // observation_rule y zone. El forward es la zona FORWARD.
    zone: ZONES.FORWARD,
    executionContract: {
      sourceMode: FORWARD_TRADES_SOURCE_TOB,
      rule: "latest live best ask at-or-before decision + frozen slippage (causal-fill)",
      slippage: tobSlippageValue,
    },
    policy: {
      policyId,
      source: "src/exploratory/backtest.mjs dipQuantity (patch 03 §3.2: DIP10, 10 previas, fallback A0 con menos de 5)",
    },
    tradesContract: { configHash: frozenConfig.configHash, status: "FROZEN" },
    sources,
    comparison,
    referenceSource: FORWARD_TRADES_SOURCE_TOB,
    notation: "forward shadow: TOB vivo como contrato de ejecución; LAST_TRADE y SLOT_VWAP registradas en paralelo con la misma policy",
  };
  return { ok: true, registration: { ...core, contentHash: contentHashOf(core) }, nextForwardState };
}
