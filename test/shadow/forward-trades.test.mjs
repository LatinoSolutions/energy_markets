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
  FORWARD_TRADES_OBSERVATION_SOURCES,
} from "../../src/shadow/index.mjs";
import { executionParameterOf } from "../../src/execution-contract/execution-contract.mjs";
import { ZONES } from "../../src/oos-reservation/trades-zones.mjs";
import {
  frozenShadowFixture,
  sightableObservationsFor,
  forwardSeedPastPrices,
  forwardTradesFixture,
  frozenTradesContractFixture,
  FORWARD_SLOT_LABEL,
  FORWARD_MISSION_FIXTURE,
  forwardTradesForMission,
  frozenShadowFixtureForMission,
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
  const state = openForwardTradesState({ session, frozen, seedPastPrices }).state;
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

// --- TR-08: correcciones de la revisión (TR08-*) -----------------------------

// Estado propio del forward con una obligación pendiente declarada: cada fuente
// arranca con la misma remaining y la historia sembrada. Va atado a la sesión y
// a la cronología (patch 03 §2; §15.3).
function forwardStateWithRemaining({ session, cursor = 0, remainingVolume, seedPastPrices = forwardSeedPastPrices() }) {
  const sources = {};
  for (const source of FORWARD_TRADES_OBSERVATION_SOURCES) {
    sources[source] = { executedVolume: 0, remainingVolume, pastPrices: [...seedPastPrices[source]] };
  }
  return { sessionId: session.sessionId, sessionContentHash: session.contentHash, cursor, sources };
}

// TR08-DAILY-CAP-01: con 60 MW pendientes y 2 días por delante, L_t = 48 supera
// el cap. El forward debe recortar a 12 MW/día (cap duro, `01_shared_campaign_rules.md`
// §5) y registrar el excedente como forcing por hueco de data, no ejecutarlo.
test("TR08-DAILY-CAP-01: el forward respeta el cap duro de 12 MW/día", () => {
  const { frozen } = frozenShadowFixture();
  const { session, progress } = openForward({ frozen });
  const opportunity = frozen.frozenBundles.a1.decisionCalendar.opportunities[2];
  const result = registerForwardTradesHypotheses({
    session, frozen,
    progress: { ...progress, cursor: 2 },
    forwardState: forwardStateWithRemaining({ session, cursor: 2, remainingVolume: 60 }),
    missionKey: MISSION_KEY,
    tradesRows: forwardTradesFixture(),
    frozenTradesContract: frozenTradesContractFixture(),
    sightablePriceObservations: sightableObservationsFor({ frozen, upToUtc: opportunity.decisionTimeUtc }),
    slotLabel: FORWARD_SLOT_LABEL,
  });
  assert.equal(result.ok, true, result.code);
  for (const source of FORWARD_TRADES_OBSERVATION_SOURCES) {
    const decision = result.registration.sources[source];
    assert.equal(decision.status, "DECISION_REGISTERED", source);
    assert.ok(decision.proposedQuantity > 12, `${source}: la policy propuso ${decision.proposedQuantity}`);
    assert.ok(decision.requestedQuantity <= 12, `${source}: requested ${decision.requestedQuantity}`);
    assert.ok(decision.executedDelta <= 12, `${source}: executed ${decision.executedDelta}`);
    assert.equal(decision.forcedByDataGap, true, source);
  }
});

// TR08-FRONTIER-02: el instante de decisión de TRADES sale de decisionTimeUtc,
// no de un slotLabel por defecto. Sin slotLabel, TOB y TRADES deciden en la
// misma frontera (10:00Z = 12:00 Berlin) y las hipótesis se registran.
test("TR08-FRONTIER-02: TOB y TRADES deciden en la frontera de decisionTimeUtc", () => {
  const { frozen } = frozenShadowFixture();
  const { session, progress, state } = openForward({ frozen });
  const opportunity = frozen.frozenBundles.a1.decisionCalendar.opportunities[0];
  const result = registerForwardTradesHypotheses({
    session, frozen, progress, forwardState: state, missionKey: MISSION_KEY,
    tradesRows: forwardTradesFixture(), frozenTradesContract: frozenTradesContractFixture(),
    sightablePriceObservations: sightableObservationsFor({ frozen, upToUtc: opportunity.decisionTimeUtc }),
  });
  assert.equal(result.ok, true, result.code);
  assert.equal(result.registration.decisionTimeUtc, "2021-06-22T10:00:00Z");
  assert.equal(result.registration.sources.TOB.status, "DECISION_REGISTERED");
  assert.equal(result.registration.sources.LAST_TRADE.status, "DECISION_REGISTERED");
  assert.equal(result.registration.sources.LAST_TRADE.observation.price, 60);
  assert.equal(result.registration.sources.SLOT_VWAP.status, "DECISION_REGISTERED");
});

test("TR08-FRONTIER-02: un slotLabel que no corresponde a decisionTimeUtc falla con cierre seguro", () => {
  const { frozen } = frozenShadowFixture();
  const { session, progress, state } = openForward({ frozen });
  const opportunity = frozen.frozenBundles.a1.decisionCalendar.opportunities[0];
  const result = registerForwardTradesHypotheses({
    session, frozen, progress, forwardState: state, missionKey: MISSION_KEY,
    tradesRows: forwardTradesFixture(), frozenTradesContract: frozenTradesContractFixture(),
    sightablePriceObservations: sightableObservationsFor({ frozen, upToUtc: opportunity.decisionTimeUtc }),
    slotLabel: "11:00",
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, "SLOT_LABEL_MISMATCH");
});

// TR08-MISSION-BIND-03: la misión del forward debe ser la de la campaña
// congelada; otra misión mezcla identidad y contrato (patch 03 §2/§6).
test("TR08-MISSION-BIND-03: una misión distinta de la del bundle congelado se rechaza", () => {
  const { frozen } = frozenShadowFixture();
  const { session, progress, state } = openForward({ frozen });
  const opportunity = frozen.frozenBundles.a1.decisionCalendar.opportunities[0];
  const result = registerForwardTradesHypotheses({
    session, frozen, progress, forwardState: state, missionKey: "POWER_MONTHLY",
    tradesRows: forwardTradesFixture(), frozenTradesContract: frozenTradesContractFixture(),
    sightablePriceObservations: sightableObservationsFor({ frozen, upToUtc: opportunity.decisionTimeUtc }),
    slotLabel: FORWARD_SLOT_LABEL,
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, "MISSION_BUNDLE_MISMATCH");
});

// TR08-TOB-FRESHNESS-04: el modo TOB exige un ask de <= 15 min (patch 03 §2;
// build_tob_slots.py MAX_AGE_S). Un ask viejo no es observación y no contamina
// la media de DIP10.
test("TR08-TOB-FRESHNESS-04: el TOB vivo descarta un ask de más de 15 minutos", () => {
  const { frozen } = frozenShadowFixture();
  const { session, progress, state } = openForward({ frozen });
  const opportunity = frozen.frozenBundles.a1.decisionCalendar.opportunities[0];
  const result = registerForwardTradesHypotheses({
    session, frozen, progress, forwardState: state, missionKey: MISSION_KEY,
    tradesRows: forwardTradesFixture(), frozenTradesContract: frozenTradesContractFixture(),
    sightablePriceObservations: [{ timestamp: "2021-06-19T09:55:00Z", bestAsk: 40 }],
    slotLabel: FORWARD_SLOT_LABEL,
  });
  assert.equal(result.ok, true, result.code);
  assert.equal(result.registration.sources.TOB.status, "STALE_OBSERVATION");
  assert.equal(result.registration.sources.TOB.observation, null);
  assert.equal(result.registration.comparison.LAST_TRADE.comparable, false);
  // El ask viejo no entra a la historia de precios del TOB.
  assert.equal(result.nextForwardState.sources.TOB.pastPrices.length, 10);
});

// TR08-PARALLEL-BLOCKS-TOB-05: TRADES en forward es "sólo registro shadow"
// (patch 03 §7); un fallo del registro paralelo no descarta la captura TOB.
test("TR08-PARALLEL-BLOCKS-TOB-05: el registro TRADES bloqueado no tumba la captura TOB", () => {
  const { frozen } = frozenShadowFixture();
  const { session, progress, state } = openForward({ frozen });
  const opportunity = frozen.frozenBundles.a1.decisionCalendar.opportunities[0];
  const result = captureShadowOpportunity({
    session, frozen, progress,
    sightablePriceObservations: sightableObservationsFor({ frozen, upToUtc: opportunity.decisionTimeUtc }),
    posteriorObservations: [],
    forwardTrades: {
      missionKey: MISSION_KEY,
      tradesRows: forwardTradesFixture(),
      frozenTradesContract: { decision: "HOLD", contract: null },
      forwardState: state,
      slotLabel: FORWARD_SLOT_LABEL,
    },
  });
  assert.equal(result.ok, true, result.code);
  assert.equal(result.step.recommendedAction, "BUY");
  assert.equal(result.step.parallelTradesHypotheses.ok, false);
  assert.equal(result.step.parallelTradesHypotheses.status, "BLOCKED");
  assert.equal(result.step.parallelTradesHypotheses.code, "TRADES_CONTRACT_NOT_FROZEN");
});

// TR08-FOUR-MISSIONS-06: el forward registra las hipótesis de las 4 misiones
// (patch 03 §6), cada una sobre el manifest congelado de su campaña.
test("TR08-FOUR-MISSIONS-06: el forward registra las 4 misiones con su identidad de bundle", () => {
  const frozenTradesContract = frozenTradesContractFixture();
  for (const missionKey of Object.keys(FORWARD_MISSION_FIXTURE)) {
    const spec = FORWARD_MISSION_FIXTURE[missionKey];
    const { frozen } = frozenShadowFixtureForMission(missionKey);
    const { session, progress, state } = openForward({ frozen });
    const opportunity = frozen.frozenBundles.a1.decisionCalendar.opportunities[0];
    const result = registerForwardTradesHypotheses({
      session, frozen, progress, forwardState: state, missionKey,
      tradesRows: forwardTradesForMission({ missionKey }),
      frozenTradesContract,
      sightablePriceObservations: sightableObservationsFor({ frozen, upToUtc: opportunity.decisionTimeUtc }),
      slotLabel: FORWARD_SLOT_LABEL,
    });
    assert.equal(result.ok, true, `${missionKey}: ${result.code}`);
    assert.equal(result.registration.missionKey, missionKey);
    assert.equal(result.registration.mission, spec.mission);
    assert.equal(result.registration.market, spec.market);
    assert.equal(result.registration.sources.TOB.status, "DECISION_REGISTERED", missionKey);
    assert.equal(result.registration.sources.LAST_TRADE.status, "DECISION_REGISTERED", missionKey);
    assert.equal(result.registration.sources.SLOT_VWAP.status, "DECISION_REGISTERED", missionKey);
  }
});

// TR08-ROWS-CONTRACT-07: las filas del forward se validan contra la misión y el
// contrato de la campaña congelada (patch 03 §2/§6; el motor TR-05 acota con
// `contractRowsForCampaign`). Una fila de otro mercado no se registra como
// hipótesis de esta misión.
test("TR08-ROWS-CONTRACT-07: filas de otra misión se rechazan (identidad de run)", () => {
  const { frozen } = frozenShadowFixture();
  const { session, progress, state } = openForward({ frozen });
  const opportunity = frozen.frozenBundles.a1.decisionCalendar.opportunities[0];
  const result = registerForwardTradesHypotheses({
    session, frozen, progress, forwardState: state, missionKey: MISSION_KEY,
    tradesRows: forwardTradesForMission({ missionKey: "POWER_MONTHLY" }),
    frozenTradesContract: frozenTradesContractFixture(),
    sightablePriceObservations: sightableObservationsFor({ frozen, upToUtc: opportunity.decisionTimeUtc }),
    slotLabel: FORWARD_SLOT_LABEL,
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, "TRADES_ROWS_MISSION_MISMATCH");
});

test("TR08-ROWS-CONTRACT-07: una fila de la misión pero de otra entrega se rechaza", () => {
  const { frozen } = frozenShadowFixture();
  const { session, progress, state } = openForward({ frozen });
  const opportunity = frozen.frozenBundles.a1.decisionCalendar.opportunities[0];
  const wrongDelivery = forwardTradesFixture().map((row) => ({ ...row, Maturity: "202601" }));
  const result = registerForwardTradesHypotheses({
    session, frozen, progress, forwardState: state, missionKey: MISSION_KEY,
    tradesRows: wrongDelivery,
    frozenTradesContract: frozenTradesContractFixture(),
    sightablePriceObservations: sightableObservationsFor({ frozen, upToUtc: opportunity.decisionTimeUtc }),
    slotLabel: FORWARD_SLOT_LABEL,
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, "TRADES_ROWS_CONTRACT_MISMATCH");
});

// TR08-STATE-BINDING-08: el estado del forward va atado a la sesión y a la
// cronología (§15.3). Repetir un día con el estado ya avanzado no puede duplicar
// el precio en el historial de DIP10 ni las compras.
test("TR08-STATE-BINDING-08: el mismo día dos veces (estado ya avanzado) falla por cronología", () => {
  const { frozen } = frozenShadowFixture();
  const { session, progress, state } = openForward({ frozen });
  const opportunity = frozen.frozenBundles.a1.decisionCalendar.opportunities[0];
  const sightable = sightableObservationsFor({ frozen, upToUtc: opportunity.decisionTimeUtc });
  const first = registerForwardTradesHypotheses({
    session, frozen, progress, forwardState: state, missionKey: MISSION_KEY,
    tradesRows: forwardTradesFixture(), frozenTradesContract: frozenTradesContractFixture(),
    sightablePriceObservations: sightable, slotLabel: FORWARD_SLOT_LABEL,
  });
  assert.equal(first.ok, true, first.code);
  assert.equal(first.nextForwardState.cursor, 1);

  const repeated = registerForwardTradesHypotheses({
    session, frozen, progress, forwardState: first.nextForwardState, missionKey: MISSION_KEY,
    tradesRows: forwardTradesFixture(), frozenTradesContract: frozenTradesContractFixture(),
    sightablePriceObservations: sightable, slotLabel: FORWARD_SLOT_LABEL,
  });
  assert.equal(repeated.ok, false);
  assert.equal(repeated.code, "FORWARD_STATE_OUT_OF_SEQUENCE");
});

test("TR08-STATE-BINDING-08: un estado de otra sesión se rechaza", () => {
  const { frozen } = frozenShadowFixture();
  const { session, progress, state } = openForward({ frozen });
  const opportunity = frozen.frozenBundles.a1.decisionCalendar.opportunities[0];
  const result = registerForwardTradesHypotheses({
    session, frozen, progress,
    forwardState: { ...state, sessionContentHash: "otro-sello" },
    missionKey: MISSION_KEY, tradesRows: forwardTradesFixture(),
    frozenTradesContract: frozenTradesContractFixture(),
    sightablePriceObservations: sightableObservationsFor({ frozen, upToUtc: opportunity.decisionTimeUtc }),
    slotLabel: FORWARD_SLOT_LABEL,
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, "FORWARD_STATE_SESSION_MISMATCH");
});

// TR08-RUN-IDENTITY-ZONE-09: patch 03 §2, la identidad de cada run lleva zone.
test("TR08-RUN-IDENTITY-ZONE-09: el registro declara la zona FORWARD", () => {
  const { frozen } = frozenShadowFixture();
  const { session, progress, state } = openForward({ frozen });
  const opportunity = frozen.frozenBundles.a1.decisionCalendar.opportunities[0];
  const result = registerForwardTradesHypotheses({
    session, frozen, progress, forwardState: state, missionKey: MISSION_KEY,
    tradesRows: forwardTradesFixture(), frozenTradesContract: frozenTradesContractFixture(),
    sightablePriceObservations: sightableObservationsFor({ frozen, upToUtc: opportunity.decisionTimeUtc }),
    slotLabel: FORWARD_SLOT_LABEL,
  });
  assert.equal(result.ok, true, result.code);
  assert.equal(result.registration.zone, ZONES.FORWARD);
});

// TR08-BLOCKED-DAY-LOCKOUT-10: un día con el registro paralelo BLOCKED (contrato
// TRADES todavía en HOLD) no puede bloquear el resto de la sesión. La captura
// TOB avanzó su progreso, así que el forward avanza su cursor con él y el hueco
// queda registrado como BLOCKED; el día siguiente con el contrato FROZEN
// registra, sin repetir ni saltarse días en silencio (patch 03 §4/§7).
test("TR08-BLOCKED-DAY-LOCKOUT-10: tras un día bloqueado el día congelado siguiente registra", () => {
  const { frozen } = frozenShadowFixture();
  const frozenTradesContract = frozenTradesContractFixture();
  const { session, progress, state } = openForward({ frozen });
  const opportunities = frozen.frozenBundles.a1.decisionCalendar.opportunities;

  // Día 0: contrato TRADES todavía en HOLD → registro paralelo BLOCKED, pero la
  // captura TOB sigue y el estado del forward avanza su cursor.
  const day0 = captureShadowOpportunity({
    session, frozen, progress,
    sightablePriceObservations: sightableObservationsFor({ frozen, upToUtc: opportunities[0].decisionTimeUtc }),
    posteriorObservations: [],
    forwardTrades: {
      missionKey: MISSION_KEY,
      tradesRows: forwardTradesFixture(),
      frozenTradesContract: { decision: "HOLD", contract: null },
      forwardState: state,
      slotLabel: FORWARD_SLOT_LABEL,
    },
  });
  assert.equal(day0.ok, true, day0.code);
  assert.equal(day0.step.frontier, "2021-06-22");
  assert.equal(day0.step.parallelTradesHypotheses.status, "BLOCKED");
  assert.equal(day0.step.parallelTradesHypotheses.code, "TRADES_CONTRACT_NOT_FROZEN");
  // El día bloqueado no tomó decisión: las fuentes quedan intactas y sólo avanza
  // el cursor (el hueco no se salta en silencio).
  assert.ok(day0.nextForwardState, "el día bloqueado debe devolver el estado del forward");
  assert.equal(day0.nextForwardState.cursor, 1);
  assert.equal(day0.nextForwardState.sources.TOB.executedVolume, 0);
  assert.equal(day0.nextForwardState.sources.TOB.pastPrices.length, 10);
  assert.equal(day0.nextProgress.cursor, 1);

  // Día 1: contrato FROZEN → el forward registra en la frontera correcta,
  // retomando desde el estado avanzado (antes fallaba OUT_OF_SEQUENCE).
  const day1 = captureShadowOpportunity({
    session, frozen, progress: day0.nextProgress,
    sightablePriceObservations: sightableObservationsFor({ frozen, upToUtc: opportunities[1].decisionTimeUtc }),
    posteriorObservations: [],
    forwardTrades: {
      missionKey: MISSION_KEY,
      tradesRows: forwardTradesFixture(),
      frozenTradesContract,
      forwardState: day0.nextForwardState,
      slotLabel: FORWARD_SLOT_LABEL,
    },
  });
  assert.equal(day1.ok, true, day1.code);
  assert.equal(day1.step.frontier, "2021-06-23");
  assert.equal(day1.step.parallelTradesHypotheses.artifactKind, FORWARD_TRADES_REGISTRATION_KIND);
  assert.equal(day1.step.parallelTradesHypotheses.sources.TOB.status, "DECISION_REGISTERED");
  assert.equal(day1.nextForwardState.cursor, 2);
  assert.equal(day1.nextProgress.cursor, 2);

  // Día 2: sigue registrando; ningún día se repite ni se salta.
  const day2 = captureShadowOpportunity({
    session, frozen, progress: day1.nextProgress,
    sightablePriceObservations: sightableObservationsFor({ frozen, upToUtc: opportunities[2].decisionTimeUtc }),
    posteriorObservations: [],
    forwardTrades: {
      missionKey: MISSION_KEY,
      tradesRows: forwardTradesFixture(),
      frozenTradesContract,
      forwardState: day1.nextForwardState,
      slotLabel: FORWARD_SLOT_LABEL,
    },
  });
  assert.equal(day2.ok, true, day2.code);
  assert.equal(day2.step.frontier, "2021-06-24");
  assert.equal(day2.step.parallelTradesHypotheses.artifactKind, FORWARD_TRADES_REGISTRATION_KIND);
  assert.equal(day2.nextForwardState.cursor, 3);
});

// TR08-BLOCKED-DAY-LOCKOUT-10: el día bloqueado no "cura" en silencio un estado
// desfasado. Si el estado no está en el cursor del progreso, no se avanza: el
// siguiente intento debe seguir fallando (fail-closed), nunca saltarse días.
test("TR08-BLOCKED-DAY-LOCKOUT-10: un estado desfasado no se avanza en silencio", () => {
  const { frozen } = frozenShadowFixture();
  const { session, progress, state } = openForward({ frozen });
  const opportunity = frozen.frozenBundles.a1.decisionCalendar.opportunities[0];
  const result = captureShadowOpportunity({
    session, frozen,
    progress: { ...progress, cursor: 2 },
    sightablePriceObservations: sightableObservationsFor({ frozen, upToUtc: opportunity.decisionTimeUtc }),
    posteriorObservations: [],
    forwardTrades: {
      missionKey: MISSION_KEY,
      tradesRows: forwardTradesFixture(),
      frozenTradesContract: { decision: "HOLD", contract: null },
      forwardState: state,
      slotLabel: FORWARD_SLOT_LABEL,
    },
  });
  assert.equal(result.ok, true, result.code);
  assert.equal(result.step.parallelTradesHypotheses.status, "BLOCKED");
  assert.equal(result.nextForwardState, null);
});

// TR08-FORWARD-LATE-ATTACH-11: el forward corre "desde el freeze de TRADES-v1"
// (patch 03 §4) y en forward es sólo registro shadow (§7). La secuencia natural
// es que la sesión TOB arranque antes de que el contrato TRADES esté congelado y
// el forward se adjunte a mitad de sesión. Sin estado previo, el forward debe
// abrir su estado en el cursor actual del progreso (no en 0) y anotar el cursor
// de arranque, sin repetir ni saltarse días en silencio.
test("TR08-FORWARD-LATE-ATTACH-11: un forward adjuntado a mitad de sesión arranca en el cursor actual", () => {
  const { frozen } = frozenShadowFixture();
  const frozenTradesContract = frozenTradesContractFixture();
  const { session, progress } = openForward({ frozen });
  const opportunities = frozen.frozenBundles.a1.decisionCalendar.opportunities;

  // Día 0: la sesión TOB corre sin forwardTrades (el contrato todavía no está
  // congelado). El paso no lleva registro paralelo ni estado del forward.
  const day0 = captureShadowOpportunity({
    session, frozen, progress,
    sightablePriceObservations: sightableObservationsFor({ frozen, upToUtc: opportunities[0].decisionTimeUtc }),
    posteriorObservations: [],
  });
  assert.equal(day0.ok, true, day0.code);
  assert.equal(day0.step.parallelTradesHypotheses, undefined);
  assert.equal(day0.nextForwardState, undefined);
  assert.equal(day0.nextProgress.cursor, 1);

  // Día 1: el contrato ya está congelado y el forward se adjunta SIN estado
  // previo. Antes se abría en cursor 0 y la sesión quedaba bloqueada para
  // siempre con FORWARD_STATE_OUT_OF_SEQUENCE.
  const day1 = captureShadowOpportunity({
    session, frozen, progress: day0.nextProgress,
    sightablePriceObservations: sightableObservationsFor({ frozen, upToUtc: opportunities[1].decisionTimeUtc }),
    posteriorObservations: [],
    forwardTrades: {
      missionKey: MISSION_KEY,
      tradesRows: forwardTradesFixture(),
      frozenTradesContract,
      slotLabel: FORWARD_SLOT_LABEL,
    },
  });
  assert.equal(day1.ok, true, day1.code);
  assert.equal(day1.step.frontier, "2021-06-23");
  assert.equal(day1.step.parallelTradesHypotheses.artifactKind, FORWARD_TRADES_REGISTRATION_KIND);
  assert.equal(day1.step.parallelTradesHypotheses.sources.TOB.status, "DECISION_REGISTERED");
  // El arranque a mitad de sesión queda anotado en el estado y en el registro.
  assert.equal(day1.step.parallelTradesHypotheses.startCursor, 1);
  assert.equal(day1.nextForwardState.startCursor, 1);
  assert.equal(day1.nextForwardState.cursor, 2);

  // Día 2: continúa desde el estado devuelto, sin repetir ni saltar fronteras.
  const day2 = captureShadowOpportunity({
    session, frozen, progress: day1.nextProgress,
    sightablePriceObservations: sightableObservationsFor({ frozen, upToUtc: opportunities[2].decisionTimeUtc }),
    posteriorObservations: [],
    forwardTrades: {
      missionKey: MISSION_KEY,
      tradesRows: forwardTradesFixture(),
      frozenTradesContract,
      forwardState: day1.nextForwardState,
      slotLabel: FORWARD_SLOT_LABEL,
    },
  });
  assert.equal(day2.ok, true, day2.code);
  assert.equal(day2.step.frontier, "2021-06-24");
  assert.equal(day2.step.parallelTradesHypotheses.artifactKind, FORWARD_TRADES_REGISTRATION_KIND);
  assert.equal(day2.step.parallelTradesHypotheses.startCursor, 1);
  assert.equal(day2.nextForwardState.cursor, 3);
});

// TR08-FORWARD-LATE-ATTACH-11: un estado desfasado SÍ se sigue rechazando. El
// arranque a mitad de sesión sólo aplica cuando el llamante no aporta estado; un
// estado explícito fuera del cursor del progreso no se "cura" (fail-closed).
test("TR08-FORWARD-LATE-ATTACH-11: el arranque a mitad de sesión no relaja la cronología", () => {
  const { frozen } = frozenShadowFixture();
  const { session, progress, state } = openForward({ frozen });
  const opportunity = frozen.frozenBundles.a1.decisionCalendar.opportunities[1];
  const result = registerForwardTradesHypotheses({
    session, frozen,
    progress: { ...progress, cursor: 1 },
    forwardState: state,
    missionKey: MISSION_KEY,
    tradesRows: forwardTradesFixture(),
    frozenTradesContract: frozenTradesContractFixture(),
    sightablePriceObservations: sightableObservationsFor({ frozen, upToUtc: opportunity.decisionTimeUtc }),
    slotLabel: FORWARD_SLOT_LABEL,
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, "FORWARD_STATE_OUT_OF_SEQUENCE");
});

