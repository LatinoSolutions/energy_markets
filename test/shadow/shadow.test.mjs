// Tests IMP-18: captura Shadow y non-interference. Fuente: SPEC v1.1.1 §25.1
// fila IMP-18 ("Recomendación timestamped; no órdenes reales; hypothetical
// fills siguen simulated; correcciones en receipts separados"; MUST NOT
// "Shadow≠Replay≠Real; sin entrenamiento dentro de run"), §15.3 (Forward /
// Shadow contract: prospectiva, versión fija, comparación con baseline y
// closed benchmark al cierre), §12.1 (límites probatorios por fuente), §12.2
// (piezas del registro) y §25.2 fila IMP-18 (DEP-22: no se cierra con
// fixture sintético). Fixtures sintéticos declarados.

import test from "node:test";
import assert from "node:assert/strict";

import {
  openShadowSession,
  openShadowProgress,
  captureShadowOpportunity,
  verifyShadowNonInterference,
  closeShadowSession,
  applyShadowCorrection,
  SHADOW_SESSION_KIND,
  SHADOW_EVIDENCE_RECEIPT_KIND,
} from "../../src/shadow/index.mjs";
import { validateExperienceRecordShape } from "../../src/experience/record.mjs";
import { executionParameterOf, contentHashOf } from "../../src/execution-contract/execution-contract.mjs";
import {
  frozenShadowFixture,
  posteriorObservationsFor,
  sightableObservationsFor,
  benchmarkDailyClosesFixture,
} from "./fixtures.mjs";

const PERMISSIONS = {
  permissionRefs: ["fixture://pit-permission/imp18-synthetic"],
  declaredBy: "SYNTHETIC fixture per §25.2 DEP-06/07 declaration",
};
const SESSION_START = "2021-06-21T00:00:00Z";
const CLOSE_AT = "2021-07-01T10:00:00Z";

// Recorre el calendario prospectivo completo de la versión fija: cada paso
// ve sólo la ventana de datos llegada hasta su decision time (known-at).
function runCapture({ session, frozen }) {
  const opened = openShadowProgress({ session, frozen });
  assert.equal(opened.ok, true);
  let progress = opened.progress;
  const records = [];
  const steps = [];
  while (progress.terminal !== true) {
    const currentOpportunity = frozen
      .frozenBundles.a1
      .decisionCalendar.opportunities[progress.cursor] ?? null;
    const outcome = captureShadowOpportunity({
      session,
      frozen,
      progress,
      sightablePriceObservations: sightableObservationsFor({ frozen, upToUtc: currentOpportunity?.decisionTimeUtc ?? null }),
      posteriorObservations: currentOpportunity ? posteriorObservationsFor(currentOpportunity.date) : [],
    });
    if (!outcome.ok) {
      return { ok: false, code: outcome.code, records, steps, progress, failure: outcome };
    }
    records.push(outcome.record);
    steps.push(outcome.step);
    progress = outcome.nextProgress;
  }
  return { ok: true, records, steps, progress };
}

test("§15.3: la sesión Shadow se abre con la Policy Version fija del manifest congelado", () => {
  const { frozen } = frozenShadowFixture();
  const opened = openShadowSession({
    frozen,
    startedAtUtc: SESSION_START,
    prospectivePermissions: PERMISSIONS,
    synthetic: true,
  });
  assert.equal(opened.ok, true);

  const session = opened.session;
  assert.equal(session.artifactKind, SHADOW_SESSION_KIND);
  assert.equal(session.policyVersion, frozen.frozenBundles.a1.arm.armVersion);
  assert.equal(session.realOrderChannel, null);
  assert.equal(session.declaredAuthority, "A0_RESEARCH_NO_REAL_ORDERS");
  assert.equal(session.synthetic, true);
  assert.ok(session.contentHash);
  assert.equal(session.prospectivePermissions.permissionRefs.length, 1);
  // Prospectiva: la captura arranca después de congelar la versión.
  assert.ok(new Date(session.startedAtUtc) > new Date(session.frozenAtUtc));
});

test("fail-closed: manifest mutable, startedAtUtc sin ancla o no prospectivo abortan la sesión", () => {
  const { frozen } = frozenShadowFixture();
  const tampered = {
    ...frozen,
    frozenBundles: {
      ...frozen.frozenBundles,
      a1: { ...frozen.frozenBundles.a1, benchmark: { sourceVersion: "otro", status: "RECONCILED_OFFICIAL" } },
    },
  };
  // Un manifest re-sellado con un bundle mutado: el estado ex-ante roto
  // se detecta exactamente por el hash del bundle (§14.9).
  const { contentHash: ignored, ...rehashedCore } = tampered;
  const rehashed = { ...rehashedCore, contentHash: contentHashOf(rehashedCore) };
  const tamperedOutcome = openShadowSession({ frozen: rehashed, startedAtUtc: SESSION_START, prospectivePermissions: PERMISSIONS });
  assert.equal(tamperedOutcome.ok, false);
  assert.equal(tamperedOutcome.code, "FROZEN_BUNDLE_HASH_MISMATCH");

  const unanchored = openShadowSession({ frozen, startedAtUtc: "hace un rato", prospectivePermissions: PERMISSIONS });
  assert.equal(unanchored.ok, false);
  assert.equal(unanchored.code, "NOT_UTC_ANCHORED");

  const retrospective = openShadowSession({ frozen, startedAtUtc: "2021-01-01T00:00:00Z", prospectivePermissions: PERMISSIONS });
  assert.equal(retrospective.ok, false);
  assert.equal(retrospective.code, "SESSION_NOT_PROSPECTIVE");
});

test("fail-closed: canal de órdenes reales o permisos prospectivos ausentes abortan la sesión", () => {
  const { frozen } = frozenShadowFixture();
  const withOrders = openShadowSession({
    frozen,
    startedAtUtc: SESSION_START,
    prospectivePermissions: PERMISSIONS,
    realOrderChannel: { endpoint: "broker-api://real" },
  });
  assert.equal(withOrders.ok, false);
  assert.equal(withOrders.code, "REAL_ORDERS_FORBIDDEN");

  const withoutPermissions = openShadowSession({ frozen, startedAtUtc: SESSION_START, prospectivePermissions: null });
  assert.equal(withoutPermissions.ok, false);
  assert.equal(withoutPermissions.code, "MISSING_PROSPECTIVE_PERMISSIONS");
});

test("§25.1: no es posible capturar fuera de cronología en el calendario agotado", () => {
  const { frozen } = frozenShadowFixture();
  const session = openShadowSession({ frozen, startedAtUtc: SESSION_START, prospectivePermissions: PERMISSIONS, synthetic: true }).session;
  const initial = openShadowProgress({ session, frozen });
  let progress = initial.progress;
  while (progress.terminal !== true) {
    const currentOpportunity = frozen
      .frozenBundles.a1
      .decisionCalendar.opportunities[progress.cursor] ?? null;
    const outcome = captureShadowOpportunity({
      session,
      frozen,
      progress,
      sightablePriceObservations: sightableObservationsFor({ frozen, upToUtc: currentOpportunity?.decisionTimeUtc }),
    });
    assert.equal(outcome.ok, true);
    progress = outcome.nextProgress;
  }
  const pastEnd = captureShadowOpportunity({ session, frozen, progress });
  assert.equal(pastEnd.ok, false);
  assert.equal(pastEnd.code, "CAPTURE_PAST_CALENDAR_END");
});
test("§15.3: la captura recorre el calendario cronológico; la recomendación es timestamped y el posterior llega después", () => {
  const { frozen } = frozenShadowFixture();
  const session = openShadowSession({ frozen, startedAtUtc: SESSION_START, prospectivePermissions: PERMISSIONS, synthetic: true }).session;
  const { ok, records, steps, progress } = runCapture({ session, frozen });
  assert.equal(ok, true);
  assert.equal(records.length, 4);
  assert.equal(steps.length, 4);

  // Recomendación de la versión fija: BUY/WAIT/WAIT? NO — BUY en D1, WAIT en
  // el spike D2, BUY en D3 y D4 (S1 umbrales frozen del manifest).
  assert.equal(steps.map((step) => step.frontier).join(","), "2021-06-22,2021-06-23,2021-06-24,2021-06-25");
  assert.equal(steps[0].recommendedAction, "BUY");
  assert.equal(steps[1].recommendedAction, "WAIT");
  assert.equal(steps[2].recommendedAction, "BUY");
  assert.equal(steps[3].recommendedAction, "BUY");

  // Recomendación timestamped en la frontera exacta del calendario.
  for (const step of steps) {
    const record = records.find((r) => r.recordId === step.recordId);
    assert.ok(record);
    assert.equal(record.recommendedAtUtc, step.decisionTimeUtc);
    assert.equal(record.sourceType, "SHADOW");
    assert.ok(validateExperienceRecordShape(record).ok);
  }

  // El path posterior queda registrado por fila y ES posterior.
  assert.ok(steps[0].posteriorTrajectory[0].timestamp > steps[0].decisionTimeUtc);
  assert.equal(steps[3].posteriorTrajectory.length, 0);

  // Estado hipotético prospectivo: la obligación define la transición (§13.4).
  assert.equal(progress.executedVolume + progress.remainingVolume, 12);
  assert.equal(progress.remainingVolume, 0);
});

test("§15.3/§12.1: los fills hipotéticos siguen SIMULATED y salen de la derivación frozen", () => {
  const { frozen, fx } = frozenShadowFixture();
  const session = openShadowSession({ frozen, startedAtUtc: SESSION_START, prospectivePermissions: PERMISSIONS, synthetic: true }).session;
  const { records } = runCapture({ session, frozen });

  const slippage = executionParameterOf(fx.freezeInput.executionContract, "slippage").value;
  const bestAskByFrontier = { "2021-06-22": 40, "2021-06-24": 40, "2021-06-25": 40 };
  for (const record of records) {
    if (record.recommendedAction !== "BUY") {
      // WAIT no actúa: sin ejecución fabricada (§12.2 "cuando aplique").
      assert.equal(record.execution, null);
      continue;
    }
    assert.equal(record.execution.noFill, false);
    assert.equal(record.execution.fills.length, 1);
    const fill = record.execution.fills[0];
    assert.equal(fill.evidenceKind, "SIMULATED_FILL");
    // Precio = best ask ya existente a la frontera + slippage frozen (§13.6).
    assert.equal(fill.price, bestAskByFrontier[record.stateSnapshot.frontierDate] + slippage);
  }
});

test("fail-closed: consumible posterior al decision time aborta (KNOWN_AT_VIOLATION)", () => {
  const { frozen } = frozenShadowFixture();
  const session = openShadowSession({ frozen, startedAtUtc: SESSION_START, prospectivePermissions: PERMISSIONS, synthetic: true }).session;
  const progress = openShadowProgress({ session, frozen }).progress;
  const outcome = captureShadowOpportunity({
    session,
    frozen,
    progress,
    sightablePriceObservations: [
      { timestamp: "2021-06-22T09:55:00Z", bestAsk: 40 },
      { timestamp: "2021-06-22T10:05:00Z", bestAsk: 39.5 },
    ],
  });
  assert.equal(outcome.ok, false);
  assert.equal(outcome.code, "KNOWN_AT_VIOLATION");
});

test("fail-closed: posterior con timestamp <= recomendación aborta (TEMPORAL_INTERFERENCE)", () => {
  const { frozen } = frozenShadowFixture();
  const session = openShadowSession({ frozen, startedAtUtc: SESSION_START, prospectivePermissions: PERMISSIONS, synthetic: true }).session;
  const progress = openShadowProgress({ session, frozen }).progress;
  const outcome = captureShadowOpportunity({
    session,
    frozen,
    progress,
    sightablePriceObservations: [{ timestamp: "2021-06-22T09:55:00Z", bestAsk: 40 }],
    posteriorObservations: [{ timestamp: "2021-06-22T09:59:00Z", bestAsk: 40.1 }],
  });
  assert.equal(outcome.ok, false);
  assert.equal(outcome.code, "TEMPORAL_INTERFERENCE");
});

test("§15.1/§25.1: non-interference verificada y fail-closed ante cada interferencia", () => {
  const { frozen } = frozenShadowFixture();
  const session = openShadowSession({ frozen, startedAtUtc: SESSION_START, prospectivePermissions: PERMISSIONS, synthetic: true }).session;
  const { records, steps } = runCapture({ session, frozen });

  const clean = verifyShadowNonInterference({ session, frozen, records, steps, trainingEvents: null });
  assert.equal(clean.ok, true);
  assert.equal(clean.code, "SHADOW_NON_INTERFERENCE_VERIFIED");
  const checkCodes = clean.checks.map((check) => check.code);
  assert.deepEqual(checkCodes, [
    "SESSION_CONTENT_HASH_INTACT",
    "POLICY_VERSION_FROZEN",
    "NO_TRAINING_DURING_RUN",
    "NO_REAL_ORDERS",
    "SOURCE_SEPARATION",
    "RECOMMENDATION_BEFORE_POSTERIOR",
  ]);

  // Sesión mutada: no es el sello de la apertura (§15.4).
  const mutatedSession = { ...session, synthetic: !session.synthetic };
  assert.equal(verifyShadowNonInterference({ session: mutatedSession, frozen, records, steps }).ok, false);

  // Entrenamiento dentro del run: prohibido (§15.1/§11.5).
  const trainingOutcome = verifyShadowNonInterference({
    session, frozen, records, steps,
    trainingEvents: [{ event: "PARAMETER_UPDATE", atUtc: "2021-06-22T12:00:00Z" }],
  });
  assert.equal(trainingOutcome.ok, false);
  assert.equal(trainingOutcome.checks.find((c) => c.code === "NO_TRAINING_DURING_RUN").ok, false);

  // Fuente mezclada: REPLAY dentro del corpus Shadow rompe la separación
  // probatoria (§12.1/§12.3: Shadow≠Replay≠Real).
  const mixedRecords = [...records];
  mixedRecords[1] = { ...records[1], sourceType: "REPLAY" };
  assert.equal(verifyShadowNonInterference({ session, frozen, records: mixedRecords, steps }).ok, false);

  // Fill real dentro de un fill de Shadow: PROBATORY force mixing (§12.1).
  const realFillRecords = [...records];
  realFillRecords[0] = {
    ...records[0],
    execution: {
      executedAction: "BUY",
      requestedQuantity: 3,
      noFill: false,
      fills: [{ ...records[0].execution.fills[0], evidenceKind: "REAL_FILL" }],
    },
  };
  const realFillOutcome = verifyShadowNonInterference({ session, frozen, records: realFillRecords, steps });
  assert.equal(realFillOutcome.ok, false);
  assert.equal(realFillOutcome.checks.find((c) => c.code === "NO_REAL_ORDERS").ok, false);
});

test("§15.3: al cierre, comparación con baseline A0 — divergencia de acción en el spike D2", () => {
  const { frozen } = frozenShadowFixture();
  const session = openShadowSession({ frozen, startedAtUtc: SESSION_START, prospectivePermissions: PERMISSIONS, synthetic: true }).session;
  const { records, steps } = runCapture({ session, frozen });

  const closed = closeShadowSession({
    session, frozen, progress: { sessionId: session.sessionId, executedVolume: 12, remainingVolume: 0 }, records, steps,
    closedAtUtc: CLOSE_AT, benchmarkDailyCloses: benchmarkDailyClosesFixture(),
  });
  assert.equal(closed.ok, true);

  const { receipt } = closed;
  assert.equal(receipt.artifactKind, SHADOW_EVIDENCE_RECEIPT_KIND);
  assert.equal(receipt.receiptKind, "SHADOW_EVIDENCE_RECEIPT");
  assert.equal(receipt.policyVersion, session.policyVersion);
  assert.equal(receipt.originalRecordIds.length, 4);
  assert.equal(receipt.closedRecordIds.length, 4);
  assert.ok(receipt.contentHash);
  assert.equal(receipt.nonInterference.verdict, "SHADOW_NON_INTERFERENCE_VERIFIED");

  const baseline = receipt.comparisons.baseline;
  assert.equal(baseline.status, "BASELINE_COMPARED");
  assert.equal(baseline.components.length, 4);
  assert.equal(baseline.divergences.length, 3);
  // D2: A1 espera el spike (WAIT) donde A0 calendar compra (BUY).
  assert.equal(baseline.divergences[0].frontier, "2021-06-23");
  assert.equal(baseline.divergences[0].kind, "ACTION_DIVERGENCE");
  assert.equal(baseline.divergences[0].shadow, "WAIT");
  assert.equal(baseline.divergences[0].baseline, "BUY");
  // D3/D4: el residual se re-distribuye sobre las oportunidades restantes.
  assert.deepEqual(baseline.divergences.slice(1).map((divergence) => divergence.kind), [
    "REQUESTED_QUANTITY_DIVERGENCE",
    "REQUESTED_QUANTITY_DIVERGENCE",
  ]);

  // Los registros cerrados son CLOSED NUEVOS: los originales siguen OPEN
  // (append-only, §12.2).
  for (const closedRecord of closed.closedRecords) {
    assert.equal(closedRecord.recordState, "CLOSED");
  }
  for (const original of records) {
    assert.equal(original.recordState, "OPEN");
  }
});

test("fail-closed: cierre sin registros no fabrica evidencia", () => {
  const { frozen } = frozenShadowFixture();
  const session = openShadowSession({ frozen, startedAtUtc: SESSION_START, prospectivePermissions: PERMISSIONS, synthetic: true }).session;
  const { records, steps } = runCapture({ session, frozen });

  const empty = closeShadowSession({
    session, frozen, progress: { sessionId: session.sessionId, executedVolume: 0, remainingVolume: 12 }, records: [], steps: [],
    closedAtUtc: CLOSE_AT,
  });
  assert.equal(empty.ok, false);
  assert.equal(empty.code, "EMPTY_SHADOW_CAPTURE");

  // Con non-interference rota (entrenamiento en el run) tampoco se cierra.
  const withTraining = closeShadowSession({
    session, frozen, progress: { sessionId: session.sessionId, executedVolume: 12, remainingVolume: 0 },
    records, steps, closedAtUtc: CLOSE_AT, trainingEvents: [{ event: "PARAMETER_UPDATE" }],
  });
  assert.equal(withTraining.ok, false);
  assert.equal(withTraining.code, "SHADOW_NON_INTERFERENCE_BROKEN");
});

test("§15.3: sin closed benchmark disponible la comparación queda UNAVAILABLE, nunca fabricada", () => {
  const { frozen } = frozenShadowFixture();
  const session = openShadowSession({ frozen, startedAtUtc: SESSION_START, prospectivePermissions: PERMISSIONS, synthetic: true }).session;
  const { records, steps } = runCapture({ session, frozen });

  const closed = closeShadowSession({
    session, frozen, progress: { sessionId: session.sessionId, executedVolume: 12, remainingVolume: 0 }, records, steps,
    closedAtUtc: CLOSE_AT, benchmarkDailyCloses: null,
  });
  assert.equal(closed.ok, true);
  assert.equal(closed.receipt.comparisons.benchmark.status, "UNAVAILABLE_AT_CLOSE");
  assert.equal(closed.closedRecords[0].outcome.benchmarkVersion, "BENCHMARK_UNAVAILABLE_AT_CLOSE");
});

test("§15.3: comparación con closed benchmark disponible — premium por fill", () => {
  const { frozen, fx } = frozenShadowFixture();
  const session = openShadowSession({ frozen, startedAtUtc: SESSION_START, prospectivePermissions: PERMISSIONS, synthetic: true }).session;
  const { records, steps } = runCapture({ session, frozen });

  const slippage = executionParameterOf(fx.freezeInput.executionContract, "slippage").value;
  const closed = closeShadowSession({
    session, frozen, progress: { sessionId: session.sessionId, executedVolume: 12, remainingVolume: 0 }, records, steps,
    closedAtUtc: CLOSE_AT, benchmarkDailyCloses: benchmarkDailyClosesFixture(),
  });
  assert.equal(closed.ok, true);
  const fills = closed.receipt.comparisons.benchmark.fillComparisons;
  assert.equal(fills.length, 3);
  // D1: best ask 40 + slippage; close 40 → premium = slippage.
  assert.ok(Math.abs(fills[0].premium - slippage) < 1e-9);
  assert.equal(fills[0].frontier, "2021-06-22");
});

test("§15.3/§25.1: las correcciones viven en receipts separados; el original no se toca", () => {
  const { frozen } = frozenShadowFixture();
  const session = openShadowSession({ frozen, startedAtUtc: SESSION_START, prospectivePermissions: PERMISSIONS, synthetic: true }).session;
  const { records, steps } = runCapture({ session, frozen });
  const closed = closeShadowSession({
    session, frozen, progress: { sessionId: session.sessionId, executedVolume: 12, remainingVolume: 0 }, records, steps,
    closedAtUtc: CLOSE_AT, benchmarkDailyCloses: benchmarkDailyClosesFixture(),
  });
  const receipt = closed.receipt;

  const first = applyShadowCorrection({
    receipt,
    correction: {
      reason: "corrección tardía del posterior de D1 (§15.3: revisiones conservadas por separado)",
      targetRecordId: receipt.originalRecordIds[0],
      correctedRecordId: "record-corrected-1",
    },
  });
  assert.equal(first.ok, true);
  assert.equal(first.originalReceiptHash, receipt.contentHash);
  assert.equal(receipt.corrections.length, 0);
  assert.equal(first.correctedReceipt.corrections.length, 1);

  const second = applyShadowCorrection({ receipt: first.correctedReceipt, correction: {
    reason: "segunda corrección tardía",
    targetRecordId: receipt.originalRecordIds[2],
    correctedRecordId: "record-corrected-2",
  } });
  assert.equal(second.ok, true);
  assert.equal(second.correctedReceipt.corrections.length, 2);
  assert.notEqual(second.correctedReceipt.contentHash, first.correctedReceipt.contentHash);

  // Fail-closed: target externo o razón ausente no producen corrección.
  const badTarget = applyShadowCorrection({ receipt, correction: {
    reason: "x", targetRecordId: "record-inexistente", correctedRecordId: "y",
  } });
  assert.equal(badTarget.ok, false);
  assert.equal(badTarget.code, "CORRECTION_TARGET_UNKNOWN");

  const noReason = applyShadowCorrection({ receipt, correction: { targetRecordId: receipt.originalRecordIds[0], correctedRecordId: "z" } });
  assert.equal(noReason.ok, false);
  assert.equal(noReason.code, "INVALID_CORRECTION");
});
