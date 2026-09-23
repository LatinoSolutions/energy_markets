import { test } from "node:test";
import assert from "node:assert/strict";

import { buildRevision } from "../../src/pit-views/index.mjs";
import {
  EXECUTION_CLASS,
  WORKING_MODE,
  buildOperatorTimeline,
  reconcileOperatorTimeline,
} from "../../src/operator-interface/index.mjs";
import { DECISION_BASE, EVALUATION_BENCHMARK, RECOMMENDATION_BASE, buildManifest } from "./fixtures.mjs";

const RECOMMENDATION_REF = `${RECOMMENDATION_BASE.key}@${RECOMMENDATION_BASE.revisionId}`;

function timelineOf(manifest, boundary, asOf, extra = {}) {
  return buildOperatorTimeline({
    manifest,
    decisionBoundaryUtc: boundary,
    evaluationAsOfUtc: asOf,
    workingMode: WORKING_MODE.REPLAY,
    ...extra,
  });
}

// §26.3: un outcome/benchmark de la evaluation view no aparece conocido al
// decidir, aunque su reloj ya haya pasado.
test("la evaluación posterior no informa la decisión histórica", () => {
  const built = buildManifest({ records: [DECISION_BASE, EVALUATION_BENCHMARK] });
  assert.equal(built.ok, true);
  const outcome = timelineOf(built.manifest, "2026-08-01T00:00:00Z", "2026-08-01T00:00:00Z");
  assert.equal(outcome.ok, true);
  const { decision, evaluation } = outcome.timeline;
  assert.deepEqual(decision.points.map((point) => point.key), [DECISION_BASE.key]);
  assert.ok(evaluation.points.some((point) => point.key === EVALUATION_BENCHMARK.key));
  assert.ok(outcome.timeline.separation.evaluationScopeKeys.includes(EVALUATION_BENCHMARK.key));
  const reconciled = reconcileOperatorTimeline(outcome.timeline);
  assert.equal(reconciled.ok, true);
  assert.ok(reconciled.checks.includes("evaluationScopeExcludedFromDecision"));
});

// §26.3: cada punto lleva su reloj y su tipo de reloj, no sólo la fecha visual.
test("los puntos de decisión y evaluación conservan su reloj PIT", () => {
  const built = buildManifest({ records: [DECISION_BASE, EVALUATION_BENCHMARK] });
  const outcome = timelineOf(built.manifest, "2026-04-01T07:00:00Z", "2026-07-01T07:00:00Z");
  const decisionPoint = outcome.timeline.decision.points[0];
  assert.equal(decisionPoint.clockKind, "policy-consumable");
  assert.equal(decisionPoint.clock, "2026-04-01T06:00:00.000Z");
  const evaluationPoint = outcome.timeline.evaluation.points.find((point) => point.key === EVALUATION_BENCHMARK.key);
  assert.equal(evaluationPoint.clockKind, "evaluation-effective");
  assert.equal(evaluationPoint.clock, "2026-07-01T06:00:00.000Z");
});

// §6.1/§26.3: la revisión entra a la decisión sólo cuando es consumible.
test("la cronología distingue versiones por su consumo, no por su fecha de eje", () => {
  const receipt = buildRevision({
    key: DECISION_BASE.key,
    revisionId: "v2",
    revisesRevisionId: "v1",
    effectiveAtUtc: "2026-04-20T10:30:00Z",
  });
  const v2 = {
    ...DECISION_BASE,
    revisionId: "v2",
    revisionOf: "v1",
    publishedAtUtc: "2026-04-20T10:00:00Z",
    consumableAtUtc: "2026-04-20T10:30:00Z",
    value: 25.1,
  };
  const built = buildManifest({ records: [DECISION_BASE, v2], revisions: [receipt.revision] });
  assert.equal(built.ok, true);

  const before = timelineOf(built.manifest, "2026-04-10T00:00:00Z", "2026-04-10T00:00:00Z");
  assert.equal(before.timeline.decision.points[0].revisionId, "v1");
  const after = timelineOf(built.manifest, "2026-04-21T00:00:00Z", "2026-04-21T00:00:00Z");
  assert.equal(after.timeline.decision.points[0].revisionId, "v2");
  assert.equal(after.timeline.decision.points[0].value, 25.1);
});

// §26.5: una actuación Real exige autorización y receipt; la hipotética se
// etiqueta y no se confunde con Real.
test("una actuación REAL sin autoridad se rechaza; la hipotética se etiqueta", () => {
  const built = buildManifest({ records: [DECISION_BASE, RECOMMENDATION_BASE] });
  const real = timelineOf(built.manifest, "2026-04-01T07:00:00Z", "2026-04-03T00:00:00Z", {
    executions: [{
      eventId: "exec-1",
      class: EXECUTION_CLASS.REAL,
      relatedRecommendationRef: RECOMMENDATION_REF,
      occurredAtUtc: "2026-04-02T09:00:00Z",
    }],
  });
  assert.equal(real.ok, false);
  assert.equal(real.errors[0].code, "REAL_WITHOUT_AUTHORITY");

  const hypothetical = timelineOf(built.manifest, "2026-04-01T07:00:00Z", "2026-04-03T00:00:00Z", {
    executions: [{
      eventId: "exec-2",
      class: EXECUTION_CLASS.HYPOTHETICAL,
      relatedRecommendationRef: RECOMMENDATION_REF,
      occurredAtUtc: "2026-04-02T09:00:00Z",
    }],
  });
  assert.equal(hypothetical.ok, true);
  assert.equal(hypothetical.timeline.executions[0].hypothetical, true);
  assert.equal(hypothetical.timeline.executions[0].real, false);
});

test("una actuación REAL autorizada se registra con su receipt", () => {
  const built = buildManifest({ records: [DECISION_BASE, RECOMMENDATION_BASE] });
  const outcome = timelineOf(built.manifest, "2026-04-01T07:00:00Z", "2026-04-03T00:00:00Z", {
    executions: [{
      eventId: "exec-real",
      class: EXECUTION_CLASS.REAL,
      relatedRecommendationRef: RECOMMENDATION_REF,
      occurredAtUtc: "2026-04-02T09:00:00Z",
      authorization: {
        authorityRef: "DEP-25/activation-1",
        receipt: { receiptRef: "receipts/exec-1.json", receiptSha256: "c".repeat(64) },
      },
    }],
  });
  assert.equal(outcome.ok, true);
  assert.equal(outcome.timeline.executions[0].real, true);
  assert.equal(outcome.timeline.executions[0].authorization.authorityRef, "DEP-25/activation-1");
});

// OI29-04 (§26.3): el vínculo debe resolver a una recomendación canónica del
// decision view del manifest verificado; una referencia inexistente o de la
// evaluation view se rechaza.
test("un vínculo de actuación que no resuelve a recomendación canónica se rechaza", () => {
  const built = buildManifest({ records: [DECISION_BASE, RECOMMENDATION_BASE, EVALUATION_BENCHMARK] });
  const unknown = timelineOf(built.manifest, "2026-04-01T07:00:00Z", "2026-04-03T00:00:00Z", {
    executions: [{
      eventId: "exec-1",
      class: EXECUTION_CLASS.HYPOTHETICAL,
      relatedRecommendationRef: "never.exists@v404",
      occurredAtUtc: "2026-04-02T09:00:00Z",
    }],
  });
  assert.equal(unknown.ok, false);
  assert.equal(unknown.errors[0].field, "executions[0].relatedRecommendationRef");
  assert.equal(unknown.errors[0].code, "RECOMMENDATION_REF_NOT_IN_BACKEND");

  const fromEvaluation = timelineOf(built.manifest, "2026-04-01T07:00:00Z", "2026-08-01T00:00:00Z", {
    interventions: [{
      eventId: "int-1",
      occurredAtUtc: "2026-04-02T09:00:00Z",
      relatedRecommendationRef: `${EVALUATION_BENCHMARK.key}@${EVALUATION_BENCHMARK.revisionId}`,
      attribution: "HUMAN",
    }],
  });
  assert.equal(fromEvaluation.ok, false);
  assert.equal(fromEvaluation.errors[0].code, "RECOMMENDATION_REF_NOT_IN_DECISION_SCOPE");
});

// OI29-04 (§26.3): un evento posterior al asOf es información futura.
test("un evento posterior al asOf de la evaluación se rechaza", () => {
  const built = buildManifest({ records: [DECISION_BASE, RECOMMENDATION_BASE] });
  const lateExecution = timelineOf(built.manifest, "2026-04-01T07:00:00Z", "2026-04-01T12:00:00Z", {
    executions: [{
      eventId: "exec-late",
      class: EXECUTION_CLASS.HYPOTHETICAL,
      relatedRecommendationRef: RECOMMENDATION_REF,
      occurredAtUtc: "2026-04-02T09:00:00Z",
    }],
  });
  assert.equal(lateExecution.ok, false);
  assert.equal(lateExecution.errors[0].code, "EVENT_AFTER_EVALUATION_ASOF");

  const lateIntervention = timelineOf(built.manifest, "2026-04-01T07:00:00Z", "2026-04-01T12:00:00Z", {
    interventions: [{
      eventId: "int-late",
      occurredAtUtc: "2027-01-01T00:00:00Z",
      relatedRecommendationRef: RECOMMENDATION_REF,
      attribution: "HUMAN",
    }],
  });
  assert.equal(lateIntervention.ok, false);
  assert.equal(lateIntervention.errors[0].code, "EVENT_AFTER_EVALUATION_ASOF");
});

test("una intervención humana no se atribuye a la policy", () => {
  const built = buildManifest({ records: [DECISION_BASE, RECOMMENDATION_BASE] });
  const bad = timelineOf(built.manifest, "2026-04-01T07:00:00Z", "2026-04-03T00:00:00Z", {
    interventions: [{
      eventId: "int-1",
      occurredAtUtc: "2026-04-02T09:00:00Z",
      relatedRecommendationRef: RECOMMENDATION_REF,
      attribution: "POLICY",
    }],
  });
  assert.equal(bad.ok, false);
  assert.equal(bad.errors[0].code, "POLICY_ATTRIBUTION_NOT_ALLOWED");
});

test("un manifest no verificado no produce timeline", () => {
  const outcome = buildOperatorTimeline({
    manifest: { records: [] },
    decisionBoundaryUtc: "2026-04-01T07:00:00Z",
    evaluationAsOfUtc: "2026-04-01T07:00:00Z",
    workingMode: WORKING_MODE.REPLAY,
  });
  assert.equal(outcome.ok, false);
  assert.equal(outcome.errors[0].code, "UNVERIFIED_MANIFEST");
});

test("un modo de trabajo no declarado se rechaza", () => {
  const built = buildManifest({ records: [DECISION_BASE] });
  const outcome = buildOperatorTimeline({
    manifest: built.manifest,
    decisionBoundaryUtc: "2026-04-01T07:00:00Z",
    evaluationAsOfUtc: "2026-04-01T07:00:00Z",
    workingMode: "LIVE",
  });
  assert.equal(outcome.ok, false);
  assert.equal(outcome.errors[0].code, "UNKNOWN_WORKING_MODE");
});

// La reconciliación detecta una lectura que adelanta información aunque el
// timeline se arme fuera del constructor.
test("la reconciliación detecta información futura y puntos fuera de reloj", () => {
  const tampered = {
    workingMode: WORKING_MODE.REPLAY,
    separation: { evaluationScopeKeys: ["B.key"], decisionScopeKeys: ["D.key"] },
    decision: {
      boundary: "2026-04-01T06:00:00Z",
      points: [{ lane: "decision", key: "D.key", clock: "2026-04-01T07:00:00Z" }, { lane: "decision", key: "B.key", clock: "2026-03-01T00:00:00Z" }],
    },
    evaluation: { asOf: "2026-04-01T06:00:00Z", points: [] },
    executions: [],
    interventions: [],
  };
  const outcome = reconcileOperatorTimeline(tampered);
  assert.equal(outcome.ok, false);
  assert.ok(outcome.errors.some((error) => error.code === "DECISION_POINT_AFTER_BOUNDARY"));
  assert.ok(outcome.errors.some((error) => error.code === "FUTURE_INFO_IN_DECISION"));
});

// OI29-04: la reconciliación también rechaza eventos posteriores al asOf y
// actuaciones sin su vínculo canónico resuelto.
test("la reconciliación detecta eventos fuera de la ventana evaluada", () => {
  const tampered = {
    workingMode: WORKING_MODE.REPLAY,
    separation: { evaluationScopeKeys: [], decisionScopeKeys: ["D.key"] },
    decision: { boundary: "2026-04-01T06:00:00Z", points: [] },
    evaluation: { asOf: "2026-04-01T06:00:00Z", points: [] },
    executions: [{
      lane: "execution",
      eventId: "exec-future",
      class: "HYPOTHETICAL",
      clock: "2026-04-02T00:00:00Z",
      relatedRecommendationRef: "R.key@v1",
      relatedCanonicalRef: { recordKey: "R.key", revisionId: "v1" },
      hypothetical: true,
      real: false,
      authorization: null,
    }],
    interventions: [],
  };
  const outcome = reconcileOperatorTimeline(tampered);
  assert.equal(outcome.ok, false);
  assert.ok(outcome.errors.some((error) => error.code === "EVENT_AFTER_EVALUATION_ASOF"));
});

test("la reconciliación rechaza actuaciones sin vínculo canónico", () => {
  const tampered = {
    workingMode: WORKING_MODE.REPLAY,
    separation: { evaluationScopeKeys: [], decisionScopeKeys: [] },
    decision: { boundary: "2026-04-01T06:00:00Z", points: [] },
    evaluation: { asOf: "2026-04-01T06:00:00Z", points: [] },
    executions: [],
    interventions: [{
      lane: "intervention",
      eventId: "int-1",
      clock: "2026-04-01T05:00:00Z",
      relatedRecommendationRef: "rec-1",
      attribution: "HUMAN",
    }],
  };
  const outcome = reconcileOperatorTimeline(tampered);
  assert.equal(outcome.ok, false);
  assert.ok(outcome.errors.some((error) => error.code === "RECOMMENDATION_LINK_UNRESOLVED"));
});

test("un timeline válido reconcilia todas las comprobaciones", () => {
  const built = buildManifest({ records: [DECISION_BASE] });
  const outcome = timelineOf(built.manifest, "2026-04-01T07:00:00Z", "2026-04-01T07:00:00Z");
  const reconciled = reconcileOperatorTimeline(outcome.timeline);
  assert.equal(reconciled.ok, true);
  for (const check of [
    "workingMode",
    "decisionClockWithinBoundary",
    "evaluationClockWithinAsOf",
    "evaluationScopeExcludedFromDecision",
    "realRequiresAuthority",
    "humanInterventionAttribution",
    "eventsWithinEvaluationAsOf",
    "recommendationLinksResolved",
  ]) {
    assert.ok(reconciled.checks.includes(check), check);
  }
});
