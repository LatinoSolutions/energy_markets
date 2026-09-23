// Operator Interface Boundary — alineación chart / time-series. Fuente: SPEC
// v1.1.1 §26.3 (requisito funcional de chart/time-series: alinear market
// context, Strategy evidence, State, recomendación, ejecución/hipotética y
// outcome en una cronología coherente sin romper el Point-in-Time Contract de
// §6) y §25.1 IMP-29 (distinción recomendación/ejecución/outcome y
// reconciliación temporal).
//
// No se elige charting library ni tecnología frontend (§26.3/§26.6): esta capa
// sólo reutiliza las vistas canónicas de IMP-06 y conserva sus relojes. Una
// coincidencia visual en el eje de fechas no demuestra que la policy pudiera
// consumir todos los valores mostrados en ese instante (§26.3), por eso cada
// punto lleva su reloj y su tipo de reloj explícitos.

import { readDecisionView, readEvaluationView } from "../pit-views/views.mjs";
import { toUtcTimestamp } from "../pit-views/time.mjs";
import { isSha256 } from "../contracts/identities.mjs";
import { backendIndexFromManifest, parseBackendRef, resolveBackendRecord } from "./backend-records.mjs";

// Modos de trabajo de §26.2: Replay / OOS / Shadow / Real Execution. Mostrar
// OOS no lo convierte en una fuente de Experience independiente de su forma de
// ejecución (§26.2/§15.2); el modo sólo etiqueta la procedencia.
export const WORKING_MODE = Object.freeze({
  REPLAY: "REPLAY",
  OOS: "OOS",
  SHADOW: "SHADOW",
  REAL: "REAL",
});

export const WORKING_MODES = Object.freeze(Object.values(WORKING_MODE));

// Clase de una actuación en la cronología (§26.3 tabla): recomendación, fills
// hipotéticos y Real/intervención humana no se confunden.
export const EXECUTION_CLASS = Object.freeze({
  SIMULATED: "SIMULATED",
  HYPOTHETICAL: "HYPOTHETICAL",
  REAL: "REAL",
});

export const EXECUTION_CLASSES = Object.freeze(Object.values(EXECUTION_CLASS));

export const HUMAN_INTERVENTION_CLASS = "HUMAN_INTERVENTION";

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function fail(code, message, field = "(timeline)") {
  return { ok: false, errors: [{ field, code, message }] };
}

function deepFreeze(value) {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) {
    return value;
  }
  for (const nested of Object.values(value)) {
    deepFreeze(nested);
  }
  return Object.freeze(value);
}

// Propaga un fallo de las vistas canónicas (manifest no verificado, boundary
// inválido) sin reinterpretarlo.
function asErrors(viewOutcome, field) {
  if (Array.isArray(viewOutcome.errors)) {
    return viewOutcome.errors;
  }
  return [{ field, code: viewOutcome.code ?? "VIEW_UNREADABLE", message: viewOutcome.reason ?? "La vista canónica no es legible." }];
}

function normalizeBoundary(value, field, code) {
  const parsed = toUtcTimestamp(value);
  if (!parsed.ok) {
    return { ok: false, error: { field, code, message: `${field} requiere instante ISO-8601 con zona explícita (§6.1).` } };
  }
  return { ok: true, iso: parsed.utc };
}

// OI29-04 (review 2026-09-23): el vínculo a la recomendación no vale por ser
// un texto con forma de referencia. Debe resolver a una versión canónica en
// el decision view del manifest verificado del propio timeline (§26.3/§26.5).
function validateRecommendationLink(ref, backendIndex, field) {
  const parsed = parseBackendRef(ref);
  if (parsed !== null) {
    const resolved = resolveBackendRecord(backendIndex, parsed.recordKey, parsed.revisionId);
    if (resolved === null) {
      return { error: { field, code: "RECOMMENDATION_REF_NOT_IN_BACKEND", message: `"${ref}" no existe en el manifest verificado del timeline; el vínculo no remite a una recomendación canónica (§26.3/§26.5).` } };
    }
    if (resolved.viewScope !== "decision") {
      return { error: { field, code: "RECOMMENDATION_REF_NOT_IN_DECISION_SCOPE", message: `"${ref}" no es una versión del decision view; la actuación se vincula a la recomendación conocida al decidir (§26.3).` } };
    }
    return { record: resolved };
  }
  return { error: { field, code: "INVALID_RECOMMENDATION_REF", message: `"${ref ?? "La referencia"}" no es una referencia a registro/versión canónico "<recordKey>@<revisionId>" (§26.3).` } };
}

function validateExecution(event, index, backendIndex) {
  const field = `executions[${index}]`;
  const errors = [];
  if (!isNonEmptyString(event?.eventId)) {
    errors.push({ field: `${field}.eventId`, code: "MISSING_EVENT_ID", message: "La actuación no declara su identidad." });
  }
  if (!EXECUTION_CLASSES.includes(event?.class)) {
    errors.push({
      field: `${field}.class`,
      code: "UNKNOWN_EXECUTION_CLASS",
      message: `class debe ser ${EXECUTION_CLASSES.join(", ")}: un fill hipotético no se muestra como Real (§26.3).`,
    });
  }
  if (!isNonEmptyString(event?.relatedRecommendationRef)) {
    errors.push({
      field: `${field}.relatedRecommendationRef`,
      code: "MISSING_RECOMMENDATION_REF",
      message: "La actuación debe vincularse a la recomendación original (§26.3).",
    });
  } else {
    const link = validateRecommendationLink(event.relatedRecommendationRef, backendIndex, `${field}.relatedRecommendationRef`);
    if (link.error !== undefined) {
      errors.push(link.error);
    }
  }
  const occurred = toUtcTimestamp(event?.occurredAtUtc);
  if (!occurred.ok) {
    errors.push({ field: `${field}.occurredAtUtc`, code: occurred.code, message: "occurredAtUtc requiere zona explícita (§6.1)." });
  }
  // §26.5/§16–18: una actuación Real no existe sin comando autorizado y su
  // receipt aplicable; una etiqueta de pantalla no concede autoridad.
  if (event?.class === EXECUTION_CLASS.REAL) {
    const authorization = event?.authorization;
    const receipt = authorization?.receipt;
    if (!authorization || !isNonEmptyString(authorization.authorityRef) || !receipt
      || !isNonEmptyString(receipt.receiptRef) || !isSha256(receipt.receiptSha256)) {
      errors.push({
        field: `${field}.authorization`,
        code: "REAL_WITHOUT_AUTHORITY",
        message: "Una actuación REAL exige autorización (authorityRef) y receipt aplicable (receiptRef + sha256) (§26.5/§16–18).",
      });
    }
  }
  if (errors.length > 0) {
    return { ok: false, errors };
  }
  return {
    ok: true,
    event: deepFreeze({
      lane: "execution",
      eventId: event.eventId,
      class: event.class,
      clock: occurred.utc,
      clockKind: "execution-occurred",
      relatedRecommendationRef: event.relatedRecommendationRef,
      // OI29-04: marca del vínculo resuelto contra el manifest verificado.
      relatedCanonicalRef: { recordKey: parseBackendRef(event.relatedRecommendationRef).recordKey, revisionId: parseBackendRef(event.relatedRecommendationRef).revisionId },
      hypothetical: event.class === EXECUTION_CLASS.HYPOTHETICAL,
      real: event.class === EXECUTION_CLASS.REAL,
      authorization: event.class === EXECUTION_CLASS.REAL
        ? { authorityRef: event.authorization.authorityRef, receipt: { receiptRef: event.authorization.receipt.receiptRef, receiptSha256: event.authorization.receipt.receiptSha256.toLowerCase() } }
        : null,
    }),
  };
}

function validateIntervention(event, index, backendIndex) {
  const field = `interventions[${index}]`;
  const errors = [];
  if (!isNonEmptyString(event?.eventId)) {
    errors.push({ field: `${field}.eventId`, code: "MISSING_EVENT_ID", message: "La intervención no declara su identidad." });
  }
  const occurred = toUtcTimestamp(event?.occurredAtUtc);
  if (!occurred.ok) {
    errors.push({ field: `${field}.occurredAtUtc`, code: occurred.code, message: "occurredAtUtc requiere zona explícita (§6.1)." });
  }
  if (!isNonEmptyString(event?.relatedRecommendationRef)) {
    errors.push({
      field: `${field}.relatedRecommendationRef`,
      code: "MISSING_RECOMMENDATION_REF",
      message: "La intervención humana se vincula a la recomendación original (§26.2/§26.3).",
    });
  } else {
    const link = validateRecommendationLink(event.relatedRecommendationRef, backendIndex, `${field}.relatedRecommendationRef`);
    if (link.error !== undefined) {
      errors.push(link.error);
    }
  }
  // §26.3: el resultado de una actuación modificada por un humano no se
  // atribuye en silencio a la recomendación original.
  if (event?.attribution !== "HUMAN") {
    errors.push({
      field: `${field}.attribution`,
      code: "POLICY_ATTRIBUTION_NOT_ALLOWED",
      message: "Una intervención humana se etiqueta HUMAN; no se atribuye a la policy original (§26.3/§12).",
    });
  }
  if (errors.length > 0) {
    return { ok: false, errors };
  }
  return {
    ok: true,
    event: deepFreeze({
      lane: "intervention",
      eventId: event.eventId,
      class: HUMAN_INTERVENTION_CLASS,
      clock: occurred.utc,
      clockKind: "intervention-occurred",
      relatedRecommendationRef: event.relatedRecommendationRef,
      relatedCanonicalRef: { recordKey: parseBackendRef(event.relatedRecommendationRef).recordKey, revisionId: parseBackendRef(event.relatedRecommendationRef).revisionId },
      attribution: "HUMAN",
    }),
  };
}

// Construye la cronología observable. Reutiliza las dos vistas de IMP-06 sin
// crear otro contrato temporal (§26.3 Source/Authority). Devuelve
// `{ ok:true, timeline }` o `{ ok:false, errors }`.
export function buildOperatorTimeline({
  manifest,
  decisionBoundaryUtc,
  evaluationAsOfUtc,
  workingMode,
  executions = [],
  interventions = [],
} = {}) {
  if (!WORKING_MODES.includes(workingMode)) {
    return fail("UNKNOWN_WORKING_MODE", `workingMode debe ser ${WORKING_MODES.join(", ")} (§26.2).`, "workingMode");
  }
  const boundary = normalizeBoundary(decisionBoundaryUtc, "decisionBoundaryUtc", "INVALID_BOUNDARY");
  if (!boundary.ok) {
    return { ok: false, errors: [boundary.error] };
  }
  const asOf = normalizeBoundary(evaluationAsOfUtc, "evaluationAsOfUtc", "INVALID_AS_OF");
  if (!asOf.ok) {
    return { ok: false, errors: [asOf.error] };
  }
  if (!Array.isArray(executions) || !Array.isArray(interventions)) {
    return fail("INVALID_TIMELINE_INPUT", "executions e interventions deben ser listas.", "executions");
  }

  const decisionOutcome = readDecisionView(manifest, boundary.iso);
  if (!decisionOutcome.ok) {
    return { ok: false, errors: asErrors(decisionOutcome, "decisionBoundaryUtc") };
  }
  const evaluationOutcome = readEvaluationView(manifest, asOf.iso);
  if (!evaluationOutcome.ok) {
    return { ok: false, errors: asErrors(evaluationOutcome, "evaluationAsOfUtc") };
  }

  const errors = [];
  const backendIndex = backendIndexFromManifest(manifest);
  const asOfMs = Date.parse(asOf.iso);
  const builtExecutions = [];
  executions.forEach((event, index) => {
    const outcome = validateExecution(event, index, backendIndex);
    if (outcome.ok) {
      // OI29-04: un evento posterior al asOf de la vista sería información
      // futura presentada en la evaluación de ese punto (§26.3).
      if (Date.parse(outcome.event.clock) > asOfMs) {
        errors.push({
          field: `executions[${index}].occurredAtUtc`,
          code: "EVENT_AFTER_EVALUATION_ASOF",
          message: `"${event.eventId}" ocurrió en ${outcome.event.clock}, posterior al asOf ${asOf.iso} de la vista; no se muestra como ya ocurrido (§26.3).`,
        });
      } else {
        builtExecutions.push(outcome.event);
      }
    } else {
      errors.push(...outcome.errors);
    }
  });
  const builtInterventions = [];
  interventions.forEach((event, index) => {
    const outcome = validateIntervention(event, index, backendIndex);
    if (outcome.ok) {
      if (Date.parse(outcome.event.clock) > asOfMs) {
        errors.push({
          field: `interventions[${index}].occurredAtUtc`,
          code: "EVENT_AFTER_EVALUATION_ASOF",
          message: `"${event.eventId}" ocurrió en ${outcome.event.clock}, posterior al asOf ${asOf.iso} de la vista; no se muestra como ya ocurrido (§26.3).`,
        });
      } else {
        builtInterventions.push(outcome.event);
      }
    } else {
      errors.push(...outcome.errors);
    }
  });
  if (errors.length > 0) {
    return { ok: false, errors };
  }

  // Los puntos de decisión sólo exponen el reloj de consumo; los de evaluación,
  // el reloj de contenido. Se conservan los tres grupos de la vista canónica.
  const decisionPoints = decisionOutcome.visible.map((row) => ({
    lane: "decision",
    key: row.key,
    value: row.value,
    revisionId: row.revisionId,
    clock: row.consumableFromUtc,
    clockKind: "policy-consumable",
    semantics: row.semantics,
    proxy: row.proxy,
    proxyId: row.proxyId,
    sourceRank: row.sourceRank,
  }));
  const evaluationPoints = evaluationOutcome.current.map((row) => ({
    lane: "evaluation",
    key: row.key,
    value: row.value,
    revisionId: row.revisionId,
    clock: row.effectiveAtUtc,
    clockKind: "evaluation-effective",
    publishedAtUtc: row.publishedAtUtc,
    consumableAtUtc: row.consumableAtUtc,
    semantics: row.semantics,
    proxy: row.proxy,
    proxyId: row.proxyId,
    sourceRank: row.sourceRank,
    condition: row.condition,
  }));

  // Separación por scope: los keys de la evaluation view (benchmark/outcomes)
  // nunca informan la decisión histórica, aunque su reloj ya haya pasado
  // (§6.1/§14.3/§26.3). El manifest verificado garantiza un scope por key.
  const evaluationScopeKeys = [...new Set(manifest.records.filter((record) => record.viewScope === "evaluation").map((record) => record.key))];
  const decisionScopeKeys = [...new Set(manifest.records.filter((record) => record.viewScope === "decision").map((record) => record.key))];

  return {
    ok: true,
    timeline: deepFreeze({
      workingMode,
      separation: { evaluationScopeKeys, decisionScopeKeys },
      decision: {
        boundary: boundary.iso,
        points: decisionPoints,
        suppressed: decisionOutcome.suppressed,
        unavailable: decisionOutcome.unavailable,
      },
      evaluation: {
        asOf: asOf.iso,
        points: evaluationPoints,
        superseded: evaluationOutcome.superseded,
        outranked: evaluationOutcome.outranked,
        unavailable: evaluationOutcome.unavailable,
        appliedRevisions: evaluationOutcome.appliedRevisions,
        pendingRevisions: evaluationOutcome.pendingRevisions,
      },
      executions: builtExecutions,
      interventions: builtInterventions,
    }),
  };
}

// Reconciliación temporal explícita (§25.1 IMP-29: tests de proyección/
// reconciliación temporal). Comprueba que ninguna lectura adelanta información:
// ni un punto de decisión posterior a su boundary, ni un outcome futuro en la
// decisión, ni un Real sin autoridad.
export function reconcileOperatorTimeline(timeline) {
  const errors = [];
  const checks = [];
  if (!timeline || typeof timeline !== "object") {
    return { ok: false, errors: [{ field: "(timeline)", code: "MISSING_TIMELINE", message: "Timeline ausente." }] };
  }
  if (!WORKING_MODES.includes(timeline.workingMode)) {
    errors.push({ field: "workingMode", code: "UNKNOWN_WORKING_MODE", message: "El timeline no declara un modo de trabajo válido (§26.2)." });
  } else {
    checks.push("workingMode");
  }

  const boundaryMs = Date.parse(timeline.decision?.boundary);
  if (Number.isNaN(boundaryMs)) {
    errors.push({ field: "decision.boundary", code: "INVALID_BOUNDARY", message: "El boundary de decisión no es un instante válido." });
  }
  const asOfMs = Date.parse(timeline.evaluation?.asOf);
  if (Number.isNaN(asOfMs)) {
    errors.push({ field: "evaluation.asOf", code: "INVALID_AS_OF", message: "El asOf de evaluación no es un instante válido." });
  }

  const decisionKeys = new Set();
  for (const point of timeline.decision?.points ?? []) {
    decisionKeys.add(point.key);
    const clockMs = Date.parse(point.clock);
    if (Number.isNaN(clockMs)) {
      errors.push({ field: `decision.points.${point.key}`, code: "INVALID_CLOCK", message: "Un punto de decisión carece de reloj de consumo válido." });
    } else if (!Number.isNaN(boundaryMs) && clockMs > boundaryMs) {
      errors.push({
        field: `decision.points.${point.key}`,
        code: "DECISION_POINT_AFTER_BOUNDARY",
        message: `"${point.key}" se muestra en una decisión anterior a su consumo: información futura visible al decidir (§26.3).`,
      });
    }
  }
  checks.push("decisionClockWithinBoundary");

  for (const point of timeline.evaluation?.points ?? []) {
    // §26.3: la evaluación no puede presentar como vigente un punto cuya
    // revisión es posterior a su asOf.
    const clockMs = Date.parse(point.clock);
    if (Number.isNaN(clockMs)) {
      errors.push({ field: `evaluation.points.${point.key}`, code: "INVALID_CLOCK", message: "Un punto de evaluación carece de reloj de contenido válido." });
    } else if (!Number.isNaN(asOfMs) && clockMs > asOfMs) {
      errors.push({
        field: `evaluation.points.${point.key}`,
        code: "EVALUATION_POINT_AFTER_ASOF",
        message: `"${point.key}" se muestra vigente antes de su revisión (§26.3).`,
      });
    }
  }
  checks.push("evaluationClockWithinAsOf");

  // OI29-04: los eventos de ejecución e intervención tampoco pueden estar
  // después del asOf evaluado, y cada uno debe conservar su vínculo canónico
  // resuelto (la marca sólo la coloca buildOperatorTimeline contra el manifest
  // verificado); un timeline armado a mano sin ese vínculo no pasa (§26.3).
  for (const [lane, events] of [["executions", timeline.executions ?? []], ["interventions", timeline.interventions ?? []]]) {
    for (const event of events) {
      const clockMs = Date.parse(event?.clock);
      if (!Number.isNaN(clockMs) && !Number.isNaN(asOfMs) && clockMs > asOfMs) {
        errors.push({
          field: `${lane}.${event.eventId}`,
          code: "EVENT_AFTER_EVALUATION_ASOF",
          message: `"${event.eventId}" se muestra ya ocurrido después del asOf ${timeline.evaluation?.asOf} de la vista (§26.3).`,
        });
      }
      if (event?.relatedCanonicalRef?.recordKey === undefined) {
        errors.push({
          field: `${lane}.${event?.eventId ?? "(sin id)"}`,
          code: "RECOMMENDATION_LINK_UNRESOLVED",
          message: "La actuación no conserva el vínculo canónico resuelto a la recomendación (§26.3/§26.5).",
        });
      }
    }
  }
  checks.push("eventsWithinEvaluationAsOf");
  checks.push("recommendationLinksResolved");

  // Un key de la evaluation view no puede informar la decisión: sería mostrar
  // un outcome/benchmark futuro como conocido al decidir (§6.1/§26.3).
  const evaluationScopeKeys = new Set(timeline.separation?.evaluationScopeKeys ?? []);
  for (const key of decisionKeys) {
    if (evaluationScopeKeys.has(key)) {
      errors.push({
        field: `decision.points.${key}`,
        code: "FUTURE_INFO_IN_DECISION",
        message: `"${key}" pertenece a la evaluation view y no puede informar la decisión histórica (§6.1/§26.3).`,
      });
    }
  }
  checks.push("evaluationScopeExcludedFromDecision");

  for (const event of timeline.executions ?? []) {
    if (event.real === true && event.authorization === null) {
      errors.push({
        field: `executions.${event.eventId}`,
        code: "REAL_WITHOUT_AUTHORITY",
        message: "Una actuación REAL sin autorización/receipt no se muestra como Real (§26.5).",
      });
    }
  }
  checks.push("realRequiresAuthority");

  for (const event of timeline.interventions ?? []) {
    if (event.attribution !== "HUMAN") {
      errors.push({
        field: `interventions.${event.eventId}`,
        code: "POLICY_ATTRIBUTION_NOT_ALLOWED",
        message: "La intervención humana no se atribuye a la policy (§26.3).",
      });
    }
  }
  checks.push("humanInterventionAttribution");

  return { ok: errors.length === 0, errors, checks: deepFreeze([...checks]) };
}
