// Tests TR-08: forward shadow con TOB vivo como contrato de ejecución y
// registro paralelo de las decisiones LAST_TRADE y SLOT_VWAP. Fuente:
// TRADES_MODE_PLAN.md TR-08 y OWNER_PATCH_TRADES_MODE_2026-09-25.md §3.2/§7.
//
// Fixtures SINTÉTICAS declaradas (precedente IMP-08/15/18): no son datos de
// mercado del cliente ni cierran DEP-22. El contrato TRADES-v1 de prueba pasa
// por el freeze real de TR-04 con aprobación explícita ligada al configHash.

import test from "node:test";
import assert from "node:assert/strict";

import {
  openShadowSession,
  openShadowProgress,
  captureShadowOpportunity,
  registerForwardTradesHypotheses,
  openForwardTradesState,
  FORWARD_TRADES_REGISTRATION_KIND,
  FORWARD_TRADES_SOURCE_TOB,
} from "../../src/shadow/index.mjs";
import { executionParameterOf } from "../../src/execution-contract/execution-contract.mjs";
import {
  frozenShadowFixture,
  sightableObservationsFor,
  forwardSeedPastPrices,
  forwardTradesFixture,
  frozenTradesContractFixture,
  FORWARD_SLOT_LABEL,
} from "./fixtures.mjs";

const PERMISSIONS = {
  permissionRefs: ["fixture://pit-permission/tr08-synthetic"],
  declaredBy: "SYNTHETIC fixture per TR-08 declaration",
};
const SESSION_START = "2021-06-21T00:00:00Z";
const MISSION_KEY = "GAS_QUARTERLY";

function openForward({ frozen, seedPastPrices = forwardSeedPastPrices() } = {}) {
  const session = openShadowSession({
    frozen, startedAtUtc: SESSION_START, prospectivePermissions: PERMISSIONS, synthetic: true,
  }).session;
  const progress = openShadowProgress({ session, frozen }).progress;
  const state = openForwardTradesState({ frozen, seedPastPrices }).state;
  return { session, progress, state };
}

// Recorre las 4 fronteras del calendario congelado, avanzando el estado propio
// de cada fuente con la obligación de apertura del bundle.
function runForward({ frozen, frozenTradesContract, tradesRows = forwardTradesFixture(), sightable = null } = {}) {
  const { session, progress, state: initialState } = openForward({ frozen });
  const opportunities = frozen.frozenBundles.a1.decisionCalendar.opportunities;
  let forwardState = initialState;
  const registrations = [];
  for (let cursor = 0; cursor < opportunities.length; cursor += 1) {
    const opportunity = opportunities[cursor];
    const result = registerForwardTradesHypotheses({
      session,
      frozen,
      progress: { ...progress, cursor },
      forwardState,
      missionKey: MISSION_KEY,
      tradesRows,
      frozenTradesContract,
      sightablePriceObservations: sightable ?? sightableObservationsFor({ frozen, upToUtc: opportunity.decisionTimeUtc }),
      slotLabel: FORWARD_SLOT_LABEL,
    });
    if (!result.ok) return { ok: false, code: result.code, registrations };
    registrations.push(result.registration);
    forwardState = result.nextForwardState;
  }
  return { ok: true, session, registrations, forwardState };
}

test("TR-08: el forward ejecuta con el contrato TOB vivo y registra LAST_TRADE y SLOT_VWAP en paralelo", () => {
  const { fx, frozen } = frozenShadowFixture();
  const frozenTradesContract = frozenTradesContractFixture();
  const result = runForward({ frozen, frozenTradesContract });
  assert.equal(result.ok, true);
  assert.equal(result.registrations.length, 4);

  const day1 = result.registrations[0];
  assert.equal(day1.artifactKind, FORWARD_TRADES_REGISTRATION_KIND);
  assert.equal(day1.forwardKind, "TRADES_PARALLEL_FORWARD");
  assert.equal(day1.frontier, "2021-06-22");
  assert.equal(day1.referenceSource, FORWARD_TRADES_SOURCE_TOB);
  // TOB vivo es el contrato de ejecución declarado.
  assert.equal(day1.executionContract.sourceMode, "TOB");
  assert.ok(day1.contentHash);

  // TOB vivo: ask elegible 40 + slippage frozen.
  const slippage = executionParameterOf(fx.freezeInput.executionContract, "slippage").value;
  assert.equal(day1.sources.TOB.status, "DECISION_REGISTERED");
  assert.equal(day1.sources.TOB.observation.price, 40);
  assert.equal(day1.sources.TOB.recommendedAction, "BUY");
  assert.equal(day1.sources.TOB.requestedQuantity, 12);
  assert.equal(day1.sources.TOB.fill.fillable, true);
  assert.ok(Math.abs(day1.sources.TOB.fill.executionPrice - (40 + slippage)) < 1e-9);

  // LAST_TRADE (principal): 60 por encima de la media sembrada → WAIT.
  assert.equal(day1.sources.LAST_TRADE.observation.observationRule, "LAST_TRADE");
  assert.equal(day1.sources.LAST_TRADE.observation.price, 60);
  assert.equal(day1.sources.LAST_TRADE.recommendedAction, "WAIT");
  assert.equal(day1.sources.LAST_TRADE.requestedQuantity, 0);

  // SLOT_VWAP (secundaria): VWAP de (30x10 + 30x10 + 60x1)/21 por debajo de la
  // media → BUY con fill trade + penalización + 0,15.
  const expectedVwap = (30 * 10 + 30 * 10 + 60) / 21;
  assert.equal(day1.sources.SLOT_VWAP.observation.observationRule, "SLOT_VWAP");
  assert.ok(Math.abs(day1.sources.SLOT_VWAP.observation.price - expectedVwap) < 1e-9);
  assert.equal(day1.sources.SLOT_VWAP.recommendedAction, "BUY");
  assert.equal(day1.sources.SLOT_VWAP.fill.fillable, true);
  assert.ok(Math.abs(day1.sources.SLOT_VWAP.fill.executionPrice - (expectedVwap + 0.5 + 0.15)) < 1e-9);

  // Comparación de cada hipótesis contra el TOB vivo, con la MISMA policy.
  assert.equal(day1.policy.policyId, "DIP10");
  assert.equal(day1.comparison.LAST_TRADE.comparable, true);
  assert.equal(day1.comparison.LAST_TRADE.actionMatch, false);
  assert.equal(day1.comparison.LAST_TRADE.requestedQuantityDelta, -12);
  assert.equal(day1.comparison.SLOT_VWAP.actionMatch, true);
  assert.equal(day1.comparison.SLOT_VWAP.requestedQuantityDelta, 0);
  assert.ok(Math.abs(day1.comparison.SLOT_VWAP.priceDelta - (expectedVwap - 40)) < 1e-9);
});

test("TR-08: cada fuente avanza su obligación por separado (el estado no se comparte)", () => {
  const { frozen } = frozenShadowFixture();
  const result = runForward({ frozen, frozenTradesContract: frozenTradesContractFixture() });
  assert.equal(result.ok, true);

  // D1: TOB compra 12 (queda 0), LAST_TRADE espera (queda 12), SLOT_VWAP compra 12 (queda 0).
  const day1 = result.registrations[0];
  assert.equal(day1.sources.TOB.requestedQuantity, 12);
  assert.equal(day1.sources.LAST_TRADE.requestedQuantity, 0);
  assert.equal(day1.sources.SLOT_VWAP.requestedQuantity, 12);

  // El estado devuelto refleja la transición propia de cada fuente.
  // Tras D1, LAST_TRADE conserva obligación y compra en D2 (39 < media).
  const day2 = result.registrations[1];
  assert.equal(day2.frontier, "2021-06-23");
  assert.equal(day2.sources.TOB.recommendedAction, "WAIT");
  assert.equal(day2.sources.LAST_TRADE.recommendedAction, "BUY");
  assert.equal(day2.sources.LAST_TRADE.requestedQuantity, 12);
  assert.equal(day2.comparison.LAST_TRADE.actionMatch, false);
});

test("fail-closed: sin contrato TRADES FROZEN no se registra ninguna hipótesis", () => {
  const { frozen } = frozenShadowFixture();
  const { session, progress, state } = openForward({ frozen });
  const opportunity = frozen.frozenBundles.a1.decisionCalendar.opportunities[0];
  const result = registerForwardTradesHypotheses({
    session,
    frozen,
    progress,
    forwardState: state,
    missionKey: MISSION_KEY,
    tradesRows: forwardTradesFixture(),
    frozenTradesContract: { decision: "HOLD", contract: null },
    sightablePriceObservations: sightableObservationsFor({ frozen, upToUtc: opportunity.decisionTimeUtc }),
    slotLabel: FORWARD_SLOT_LABEL,
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, "TRADES_CONTRACT_NOT_FROZEN");
});

test("fail-closed: sin ask vivo elegible el TOB queda sin decisión y la comparación no se fabrica", () => {
  const { frozen } = frozenShadowFixture();
  const { session, progress, state } = openForward({ frozen });
  const result = registerForwardTradesHypotheses({
    session,
    frozen,
    progress,
    forwardState: state,
    missionKey: MISSION_KEY,
    tradesRows: forwardTradesFixture(),
    frozenTradesContract: frozenTradesContractFixture(),
    sightablePriceObservations: [],
    slotLabel: FORWARD_SLOT_LABEL,
  });
  assert.equal(result.ok, true);
  assert.equal(result.registration.sources.TOB.status, "NO_ELIGIBLE_REFERENCE");
  assert.equal(result.registration.sources.TOB.requestedQuantity, null);
  assert.equal(result.registration.comparison.LAST_TRADE.comparable, false);
  assert.match(result.registration.comparison.LAST_TRADE.reason, /TOB/);
  // La hipótesis sí se registró con su propia observación.
  assert.equal(result.registration.sources.LAST_TRADE.status, "DECISION_REGISTERED");
});

test("fail-closed: sin trade la regla queda NO_OBSERVATION; fuera de frescura, STALE_OBSERVATION", () => {
  const { frozen } = frozenShadowFixture();
  const { session, progress, state } = openForward({ frozen });
  const opportunity = frozen.frozenBundles.a1.decisionCalendar.opportunities[0];
  const sightable = sightableObservationsFor({ frozen, upToUtc: opportunity.decisionTimeUtc });

  const empty = registerForwardTradesHypotheses({
    session, frozen, progress, forwardState: state, missionKey: MISSION_KEY,
    tradesRows: [], frozenTradesContract: frozenTradesContractFixture(), sightablePriceObservations: sightable, slotLabel: FORWARD_SLOT_LABEL,
  });
  assert.equal(empty.ok, true);
  assert.equal(empty.registration.sources.LAST_TRADE.status, "NO_OBSERVATION");
  assert.equal(empty.registration.sources.SLOT_VWAP.status, "NO_OBSERVATION");

  // Trade a las 09:00Z: 3600 s de antigüedad, fuera del límite congelado (900 s).
  const staleRows = forwardTradesFixture().map((row) => ({ ...row, Tm: "2021-06-22T09:00:00.000000Z" }));
  const stale = registerForwardTradesHypotheses({
    session, frozen, progress, forwardState: state, missionKey: MISSION_KEY,
    tradesRows: staleRows, frozenTradesContract: frozenTradesContractFixture(), sightablePriceObservations: sightable, slotLabel: FORWARD_SLOT_LABEL,
  });
  assert.equal(stale.ok, true);
  assert.equal(stale.registration.sources.LAST_TRADE.status, "STALE_OBSERVATION");
  // 09:00 no cae dentro del slot (09:30, 10:00] → SLOT_VWAP sin observación.
  assert.equal(stale.registration.sources.SLOT_VWAP.status, "NO_OBSERVATION");
});

test("fail-closed: misión desconocida, calendario agotado y progreso de otra sesión", () => {
  const { frozen } = frozenShadowFixture();
  const { session, progress, state } = openForward({ frozen });
  const sightable = sightableObservationsFor({ frozen, upToUtc: "2021-06-22T10:00:00Z" });
  const base = { session, frozen, progress, forwardState: state, missionKey: MISSION_KEY, tradesRows: forwardTradesFixture(), frozenTradesContract: frozenTradesContractFixture(), sightablePriceObservations: sightable, slotLabel: FORWARD_SLOT_LABEL };

  const unknown = registerForwardTradesHypotheses({ ...base, missionKey: "NOPE" });
  assert.equal(unknown.ok, false);
  assert.equal(unknown.code, "UNKNOWN_MISSION");

  const past = registerForwardTradesHypotheses({ ...base, progress: { ...progress, cursor: 4, terminal: true } });
  assert.equal(past.ok, false);
  assert.equal(past.code, "CAPTURE_PAST_CALENDAR_END");

  const crossed = registerForwardTradesHypotheses({ ...base, progress: { ...progress, sessionContentHash: "otro-sello" } });
  assert.equal(crossed.ok, false);
  assert.equal(crossed.code, "PROGRESS_SESSION_MISMATCH");
});

test("TR-08: determinista y sin mutación del manifest congelado (non-interference)", () => {
  const { frozen } = frozenShadowFixture();
  const frozenContentHash = frozen.contentHash;
  const first = runForward({ frozen, frozenTradesContract: frozenTradesContractFixture() });
  const second = runForward({ frozen, frozenTradesContract: frozenTradesContractFixture() });
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.deepEqual(
    first.registrations.map((registration) => registration.contentHash),
    second.registrations.map((registration) => registration.contentHash),
  );
  // El registro no re-sella ni muta el manifest congelado.
  assert.equal(frozen.contentHash, frozenContentHash);
});

test("TR-08: captureShadowOpportunity extiende el paso con el registro paralelo cuando se aporta forwardTrades", () => {
  const { frozen } = frozenShadowFixture();
  const { session, progress, state } = openForward({ frozen });
  const opportunity = frozen.frozenBundles.a1.decisionCalendar.opportunities[0];
  const sightable = sightableObservationsFor({ frozen, upToUtc: opportunity.decisionTimeUtc });
  const base = { session, frozen, progress, sightablePriceObservations: sightable, posteriorObservations: [] };

  // Sin forwardTrades, la captura IMP-18 queda intacta (sin campo nuevo).
  const plain = captureShadowOpportunity(base);
  assert.equal(plain.ok, true);
  assert.equal(plain.step.parallelTradesHypotheses, undefined);

  // Con forwardTrades, el paso lleva el registro paralelo y devuelve el estado.
  const extended = captureShadowOpportunity({
    ...base,
    forwardTrades: {
      missionKey: MISSION_KEY,
      tradesRows: forwardTradesFixture(),
      frozenTradesContract: frozenTradesContractFixture(),
      forwardState: state,
      slotLabel: FORWARD_SLOT_LABEL,
    },
  });
  assert.equal(extended.ok, true);
  assert.equal(extended.step.parallelTradesHypotheses.artifactKind, FORWARD_TRADES_REGISTRATION_KIND);
  assert.equal(extended.step.parallelTradesHypotheses.sources.TOB.status, "DECISION_REGISTERED");
  assert.equal(extended.step.parallelTradesHypotheses.sources.LAST_TRADE.recommendedAction, "WAIT");
  assert.ok(extended.nextForwardState);
});

test("fail-closed: un estado de forward incompleto no produce registro", () => {
  const { frozen } = frozenShadowFixture();
  const { session, progress, state } = openForward({ frozen });
  const opportunity = frozen.frozenBundles.a1.decisionCalendar.opportunities[0];
  const brokenState = { sources: { ...state.sources, SLOT_VWAP: { executedVolume: 0, remainingVolume: null, pastPrices: [] } } };
  const result = registerForwardTradesHypotheses({
    session, frozen, progress, forwardState: brokenState, missionKey: MISSION_KEY,
    tradesRows: forwardTradesFixture(), frozenTradesContract: frozenTradesContractFixture(),
    sightablePriceObservations: sightableObservationsFor({ frozen, upToUtc: opportunity.decisionTimeUtc }),
    slotLabel: FORWARD_SLOT_LABEL,
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, "INVALID_FORWARD_STATE");
});
