import { test } from "node:test";
import assert from "node:assert/strict";

import { reserveSealedOos } from "../../src/oos-reservation/index.mjs";
import {
  assertA1IsA0PlusS1,
  assertPointInSearchSpace,
  assertThresholdsFrozenBeforeOos,
  assertTimingIndependentOfProcurementState,
  buildCausalReference,
  calibrateDevelopment,
  computeS1Features,
  createA1Arm,
  createS1Configuration,
  defineSearchSpace,
  evaluateImp11Acceptance,
  materializeGasQuarterlyS1,
  probeForbiddenTimingInputsRejected,
  probeStaticLocationTiming,
  s1Preference,
  validateA1TimingState,
} from "../../src/s1-strategy/index.mjs";
import { buildDecisionCalendar, createA0Baseline, createSizingController } from "../../src/sizing-controller/index.mjs";
import { validReservationInput } from "../oos-reservation/fixtures.mjs";

const PROVENANCE = {
  authority: "SYNTHETIC fixture — no es evidencia de precios reales",
  locator: "test/s1-strategy/imp11.test.mjs",
};

function sealedReservation() {
  const reserved = reserveSealedOos(validReservationInput());
  assert.equal(reserved.decision, "RESERVED", JSON.stringify(reserved.blockedBy));
  return reserved;
}

function searchSpace() {
  const built = defineSearchSpace({
    spaceId: "S1-SS-SYN-1",
    referenceFamilies: ["A", "B", "C"],
    lengths: [4, 8],
    timeframes: ["DAILY"],
    horizons: [{ horizonId: "PROC-WINDOW-3M", kind: "PROCUREMENT_WINDOW_3M" }],
    centerStatistics: ["MEDIAN", "MEAN"],
    movingAverageKinds: ["SMA", "EMA"],
    bandWidths: [1, 2],
    favorableFeatures: ["percentile", "signedDistanceToReference"],
    thresholdValues: [0.15, 0.3, 0.5],
    provenance: PROVENANCE,
  });
  assert.equal(built.ok, true, JSON.stringify(built.errors));
  return built.searchSpace;
}

function referenceA() {
  const built = buildCausalReference({
    family: "A",
    length: 4,
    centerStatistic: "MEDIAN",
    timeframe: "DAILY",
    horizon: { horizonId: "PROC-WINDOW-3M", kind: "PROCUREMENT_WINDOW_3M" },
  });
  assert.equal(built.ok, true, JSON.stringify(built.errors));
  return built.reference;
}

function configuration({ frozenAtUtc = "2020-12-01T00:00:00Z", thresholds } = {}) {
  const built = createS1Configuration({
    reference: referenceA(),
    thresholds: thresholds ?? { feature: "percentile", favorableWhen: "LTE", value: 0.15 },
    searchSpace: searchSpace(),
    calibrationBasis: "DEVELOPMENT_CALIBRATION",
    provenance: PROVENANCE,
    frozenAtUtc,
  });
  assert.equal(built.ok, true, JSON.stringify(built.errors));
  return built.configuration;
}

function priceHistory({ asOfUtc = "2021-01-15T11:00:00Z", prices = [30, 31, 29, 28, 27] } = {}) {
  const start = Date.parse("2021-01-10T11:00:00Z");
  const history = prices.map((price, index) => ({
    atUtc: new Date(start + index * 86_400_000).toISOString(),
    price,
  }));
  return { asOfUtc, decisionPrice: prices[prices.length - 1], history };
}

// §8.1: features continuas de ubicación, sin trayectoria.
test("computeS1Features produce percentile y signed/normalized distance causales", () => {
  const { asOfUtc, decisionPrice, history } = priceHistory();
  const result = computeS1Features({ asOfUtc, decisionPrice, history, reference: referenceA() });
  assert.equal(result.ok, true);
  assert.equal(result.available, true);
  assert.ok(result.features.percentile >= 0 && result.features.percentile <= 1);
  assert.equal(typeof result.features.signedDistanceToReference, "number");
  assert.equal(result.features.normalizedDistance, Math.abs(result.features.signedDistanceToReference));
  assert.deepEqual(Object.keys(result.features).sort(), ["normalizedDistance", "percentile", "signedDistanceToReference"]);
});

// §8.1 Refutation / §6.1: un dato posterior al boundary es leakage, no se recorta.
test("computeS1Features rechaza observaciones futuras al asOf (fail-closed)", () => {
  const { asOfUtc, decisionPrice } = priceHistory();
  const leaky = [{ atUtc: "2021-01-20T11:00:00Z", price: 99 }];
  const result = computeS1Features({ asOfUtc: "2021-01-15T11:00:00Z", decisionPrice, history: leaky, reference: referenceA() });
  assert.equal(result.ok, false);
  assert.equal(result.code, "FUTURE_OBSERVATION_LEAKAGE");
});

// §8.1: "uncertainty/unavailable si la referencia no es válida" — sin historia
// suficiente no se inventa ningún valor.
test("historia insuficiente deja la referencia unavailable, sin valores inventados", () => {
  const result = computeS1Features({
    asOfUtc: "2021-01-15T11:00:00Z",
    decisionPrice: 30,
    history: [{ atUtc: "2021-01-14T11:00:00Z", price: 31 }],
    reference: referenceA(),
  });
  assert.equal(result.ok, true);
  assert.equal(result.available, false);
  assert.equal(result.code, "INSUFFICIENT_CAUSAL_HISTORY");
  assert.equal(result.features, null);
});

// §8.1: una escala nula no admite distancia normalizada; se marca.
test("escala degenerada marca DEGENERATE_SCALE sin inventar denominador", () => {
  const result = computeS1Features({
    asOfUtc: "2021-01-15T11:00:00Z",
    decisionPrice: 30,
    history: [30, 30, 30, 30].map((price, index) => ({ atUtc: new Date(Date.parse("2021-01-11T00:00:00Z") + index * 86_400_000).toISOString(), price })),
    reference: referenceA(),
  });
  assert.equal(result.available, true);
  assert.equal(result.distanceAvailable, false);
  assert.equal(result.features.signedDistanceToReference, null);
  assert.equal(result.uncertainty, "DEGENERATE_SCALE");
});

// §13.5: S2–S5/Z/drivers/B no pueden entrar en el timing de A1; la trayectoria
// pertenece a S3.
test("validateA1TimingState rechaza Z/S2–S5/drivers/B y features de trayectoria", () => {
  for (const key of ["s2", "s3", "s4", "s5", "z", "fundamentalDrivers", "extraordinaryState", "benchmarkB", "prices"]) {
    const gate = validateA1TimingState({ currentDate: "2021-01-15", [key]: 1 });
    assert.equal(gate.ok, false, key);
    assert.equal(gate.code, "A1_TIMING_INPUT_REJECTED");
  }
  const trajectory = validateA1TimingState({ currentDate: "2021-01-15", s1Features: { percentile: 0.1, slope: 0.5 } });
  assert.equal(trajectory.ok, false);
  assert.ok(trajectory.violations.includes("s1Features.slope"));
  const clean = validateA1TimingState({ currentDate: "2021-01-15", s1Features: { percentile: 0.1 } });
  assert.equal(clean.ok, true);
});

// §8.6: el punto elegido debe caer dentro del search space predeclarado.
test("assertPointInSearchSpace rechaza puntos fuera del espacio declarado", () => {
  const space = searchSpace();
  const inside = assertPointInSearchSpace(space, {
    family: "A",
    length: 4,
    timeframe: "DAILY",
    horizon: { horizonId: "PROC-WINDOW-3M", kind: "PROCUREMENT_WINDOW_3M" },
    centerStatistic: "MEDIAN",
    favorableFeature: "percentile",
    thresholdValue: 0.15,
  });
  assert.equal(inside.ok, true);
  const outside = assertPointInSearchSpace(space, {
    family: "A",
    length: 99,
    timeframe: "DAILY",
    horizon: { horizonId: "PROC-WINDOW-3M", kind: "PROCUREMENT_WINDOW_3M" },
    centerStatistic: "MEDIAN",
    favorableFeature: "percentile",
    thresholdValue: 0.15,
  });
  assert.equal(outside.ok, false);
});

// §8.6/§13.8: la configuración se congela por content-hash y su punto debe
// estar dentro del espacio.
test("createS1Configuration congela por hash y rechaza puntos fuera del espacio", () => {
  const first = configuration();
  const same = configuration();
  assert.equal(first.contentHash, same.contentHash);
  assert.equal(first.status, "FROZEN_PRE_EXPERIMENT");
  assert.equal(first.semanticIdentity, "S1_RELATIVE_PRICE_LOCATION");
  const outOfSpace = createS1Configuration({
    reference: referenceA(),
    thresholds: { feature: "percentile", favorableWhen: "LTE", value: 0.999 },
    searchSpace: searchSpace(),
    calibrationBasis: "DEVELOPMENT_CALIBRATION",
    provenance: PROVENANCE,
    frozenAtUtc: "2020-12-01T00:00:00Z",
  });
  assert.equal(outOfSpace.ok, false);
});

// §8.1: la preferencia es una regla interpretable sobre la feature continua.
test("s1Preference clasifica favorable/desfavorable y desconoce una feature no disponible", () => {
  const thresholds = { feature: "percentile", favorableWhen: "LTE", value: 0.15 };
  assert.equal(s1Preference({ features: { percentile: 0.1 }, thresholds }).preference, "FAVORABLE");
  assert.equal(s1Preference({ features: { percentile: 0.9 }, thresholds }).preference, "UNFAVORABLE");
  assert.equal(s1Preference({ features: { percentile: null }, thresholds }).preference, "UNKNOWN");
});

function buildArms() {
  const controller = createSizingController({ lotSizeMw: 1, dailyCapMw: 12, provenance: PROVENANCE });
  assert.equal(controller.ok, true);
  const calendar = buildDecisionCalendar({ tradingDates: ["2021-01-15", "2021-01-18", "2021-01-19"], campaignId: "GAS-Q-TEST" }).calendar;
  const a0 = createA0Baseline({ controller: controller.controller, calendar });
  const a0Arm = { ...a0.arm, calendarId: calendar.calendarId };
  const builtA1 = createA1Arm({ a0Arm, configuration: configuration(), controller: controller.controller });
  assert.equal(builtA1.ok, true, builtA1.message);
  return { controller: controller.controller, a0Arm, a1Arm: builtA1.arm };
}

// §13.4/§13.5: A1 usa S1 sólo para BUY/WAIT; el sizing de A0 no cambia.
test("A1 convierte el BUY calendar en WAIT con ubicación desfavorable y mantiene BUY con favorable", () => {
  const { a1Arm } = buildArms();
  const favorable = { percentile: 0.05, normalizedDistance: 2, signedDistanceToReference: -2 };
  const unfavorable = { percentile: 0.9, normalizedDistance: 0.1, signedDistanceToReference: 0.1 };
  const buy = a1Arm.decideAtOpportunity({ currentDate: "2021-01-15", remainingVolumeMw: 30, s1Features: favorable });
  assert.equal(buy.ok, true);
  assert.equal(buy.action, "BUY");
  assert.equal(buy.requestedQuantityMw, 10);
  const wait = a1Arm.decideAtOpportunity({ currentDate: "2021-01-15", remainingVolumeMw: 30, s1Features: unfavorable });
  assert.equal(wait.ok, true);
  assert.equal(wait.action, "WAIT");
  assert.equal(wait.requestedQuantityMw, 0);
});

// §8.1 uncertainty: sin referencia válida A1 cae al timing de A0 y lo registra.
test("A1 sin features S1 válidas cae a A0 y lo deja registrado", () => {
  const { a1Arm } = buildArms();
  const decision = a1Arm.decideAtOpportunity({ currentDate: "2021-01-15", remainingVolumeMw: 30, s1Features: null });
  assert.equal(decision.action, "BUY");
  assert.equal(decision.s1Status, "UNAVAILABLE_FALLBACK_A0");
});

test("A1 rechaza un estado con inputs prohibidos (fail-closed)", () => {
  const { a1Arm } = buildArms();
  const decision = a1Arm.decideAtOpportunity({ currentDate: "2021-01-15", remainingVolumeMw: 30, s1Features: { percentile: 0.1 }, s3: {} });
  assert.equal(decision.ok, false);
  assert.equal(decision.code, "A1_TIMING_INPUT_REJECTED");
});

// H-IMP11-01 (§8.1 Parameters): la familia D es NORMALIZED_EXTREME, distinta
// de A; la instanciación mínima no la computa, así que se rechaza fail-closed
// en vez de colapsarla al centro de A bajo etiqueta D.
test("familia D se rechaza como no instanciada en reference, features y search space", () => {
  const declared = buildCausalReference({
    family: "D",
    length: 4,
    timeframe: "DAILY",
    horizon: { horizonId: "PROC-WINDOW-3M", kind: "PROCUREMENT_WINDOW_3M" },
  });
  assert.equal(declared.ok, false);
  assert.equal(declared.errors.some((error) => error.code === "REFERENCE_FAMILY_NOT_INSTANTIATED"), true);
  const features = computeS1Features({ asOfUtc: "2021-01-15T11:00:00Z", decisionPrice: 30, history: [], reference: { family: "D", length: 4, horizon: null } });
  assert.equal(features.ok, false);
  assert.equal(features.code, "REFERENCE_FAMILY_NOT_INSTANTIATED");
  const space = defineSearchSpace({
    spaceId: "S1-SS-D",
    referenceFamilies: ["A", "D"],
    lengths: [4],
    timeframes: ["DAILY"],
    horizons: [{ horizonId: "PROC-WINDOW-3M", kind: "PROCUREMENT_WINDOW_3M" }],
    centerStatistics: ["MEAN"],
    favorableFeatures: ["percentile"],
    thresholdValues: [0.5],
    provenance: PROVENANCE,
  });
  assert.equal(space.ok, false);
  assert.equal(space.errors.some((error) => error.code === "REFERENCE_FAMILY_NOT_INSTANTIATED"), true);
});

// §13.5: Procurement State no añade timing alpha independiente.
test("la acción BUY/WAIT de A1 no depende del remaining volume", () => {
  const { a1Arm } = buildArms();
  const features = { percentile: 0.9 };
  const outcome = assertTimingIndependentOfProcurementState({
    a1Arm,
    currentDate: "2021-01-15",
    s1Features: features,
    remainingVariants: [5, 30, 60],
  });
  assert.equal(outcome.ok, true);
  assert.equal(outcome.action, "WAIT");
});

// §13.9/§25.1: A1=A0+S1 con el MISMO controller.
test("assertA1IsA0PlusS1 exige controller y oportunidades compartidos", () => {
  const { controller, a0Arm, a1Arm } = buildArms();
  const ok = assertA1IsA0PlusS1({ a0Arm, a1Arm, a0ControllerVersion: controller.contentHash, a1ControllerVersion: controller.contentHash });
  assert.equal(ok.ok, true, JSON.stringify(ok));
  const other = createSizingController({ lotSizeMw: 2, dailyCapMw: 12, provenance: PROVENANCE }).controller;
  const mismatch = assertA1IsA0PlusS1({ a0Arm, a1Arm, a0ControllerVersion: controller.contentHash, a1ControllerVersion: other.contentHash });
  assert.equal(mismatch.ok, false);
});

test("probeStaticLocationTiming demuestra que sólo la ubicación estática altera el timing", () => {
  const { a1Arm } = buildArms();
  const probe = probeStaticLocationTiming({
    a1Arm,
    currentDate: "2021-01-15",
    remainingVolumeMw: 30,
    favorableFeatures: { percentile: 0.05 },
    unfavorableFeatures: { percentile: 0.9 },
  });
  assert.equal(probe.onlyStaticLocationAltersTiming, true);
  assert.equal(probe.favorableAction, "BUY");
  assert.equal(probe.unfavorableAction, "WAIT");
});

// §8.6/§13.8: la calibración sólo usa development; el OOS no se toca.
test("calibrateDevelopment valida sobre development con reserva intacta", () => {
  const reservation = sealedReservation();
  const developmentWindows = reservation.developmentCampaignIds.map((campaignId) => ({
    campaignId,
    ...priceHistory(),
  }));
  const outcome = calibrateDevelopment({ configuration: configuration(), searchSpace: searchSpace(), developmentWindows, reservation, provenance: PROVENANCE });
  assert.equal(outcome.ok, true, JSON.stringify(outcome));
  assert.equal(outcome.status, "CALIBRATED_DEVELOPMENT");
  assert.ok(outcome.calibrationReceipt.contentHash);
});

test("calibrateDevelopment bloquea una ventana OOS y una reserva no sellada", () => {
  const reservation = sealedReservation();
  const oosWindow = { campaignId: reservation.sealedOosCampaignIds[0], ...priceHistory() };
  const withOos = calibrateDevelopment({ configuration: configuration(), searchSpace: searchSpace(), developmentWindows: [oosWindow], reservation, provenance: PROVENANCE });
  assert.equal(withOos.ok, false);
  assert.equal(withOos.code, "OOS_WINDOW_IN_DEVELOPMENT");
  const notSealed = materializeGasQuarterlyS1().reservation;
  const blocked = calibrateDevelopment({ configuration: configuration(), searchSpace: searchSpace(), developmentWindows: [{ campaignId: "DEV", ...priceHistory() }], reservation: notSealed, provenance: PROVENANCE });
  assert.equal(blocked.ok, false);
  assert.equal(blocked.code, "DEP-12_OOS_NOT_INTACT");
});

// §13.8: los thresholds deben quedar congelados antes de la frontera OOS.
test("assertThresholdsFrozenBeforeOos exige congelado anterior a la frontera", () => {
  const reservation = sealedReservation();
  assert.equal(assertThresholdsFrozenBeforeOos(configuration(), reservation).ok, true);
  const late = configuration({ frozenAtUtc: "2026-01-01T00:00:00Z" });
  const outcome = assertThresholdsFrozenBeforeOos(late, reservation);
  assert.equal(outcome.ok, false);
  assert.equal(outcome.code, "THRESHOLDS_FROZEN_AFTER_OOS");
});

// §13.5: la check noForbiddenTimingInputs del acceptance se deriva POR
// EJECUCIÓN del guard real en el camino de decisión (H-IMP11-02).
test("probeForbiddenTimingInputsRejected demuestra el rechazo por ejecución", () => {
  const { a1Arm } = buildArms();
  const probe = probeForbiddenTimingInputsRejected({ a1Arm, forbiddenState: { currentDate: "2021-01-15", s3: {} } });
  assert.equal(probe.ok, true);
  assert.equal(probe.forbiddenInputsRejected, true);
  assert.deepEqual(probe.rejectedInputs, ["s3"]);
  const cleanState = probeForbiddenTimingInputsRejected({ a1Arm, forbiddenState: { currentDate: "2021-01-15" } });
  assert.equal(cleanState.ok, false);
  assert.equal(cleanState.code, "FORBIDDEN_STATE_NOT_FORBIDDEN");
});

// §25.1: acceptance de IMP-11 derivado de los artefactos.
test("evaluateImp11Acceptance marca criterionMet con evidencia completa y lo niega sin prerequisites", () => {
  const reservation = sealedReservation();
  const { controller, a0Arm, a1Arm } = buildArms();
  const common = {
    configuration: configuration(),
    searchSpace: searchSpace(),
    reservation,
    a0Arm,
    a1Arm,
    a0ControllerVersion: controller.contentHash,
    a1ControllerVersion: controller.contentHash,
    timingProbeState: {
      currentDate: "2021-01-15",
      remainingVolumeMw: 30,
      favorableFeatures: { percentile: 0.05 },
      unfavorableFeatures: { percentile: 0.9 },
    },
  };
  const met = evaluateImp11Acceptance({ ...common, prerequisites: { developmentPriceReferences: { available: true } } });
  assert.equal(met.criterionMet, true, JSON.stringify(met.blockedBy));
  assert.deepEqual(met.blockedBy, []);
  assert.equal(met.timingEvidence.onlyStaticLocationAltersTiming.onlyStaticLocationAltersTiming, true);
  assert.equal(met.timingEvidence.forbiddenInputsRejected.forbiddenInputsRejected, true);
  const blocked = evaluateImp11Acceptance({ ...common, prerequisites: { developmentPriceReferences: { available: false } } });
  assert.equal(blocked.criterionMet, false);
  assert.ok(blocked.blockedBy.includes("DEP-06/07_DEVELOPMENT_PRICE_REFERENCES_UNAVAILABLE"));
  // H-IMP11-02: sin brazo real que ejecute el guard, la check es falsa.
  const { a1Arm: _a1, ...noArm } = common;
  const withoutArm = evaluateImp11Acceptance({ ...noArm, a1Arm: null, prerequisites: { developmentPriceReferences: { available: true } } });
  assert.equal(withoutArm.criterionMet, false);
  assert.ok(withoutArm.blockedBy.includes("A1_PARITY_NOT_PROVIDED"));
  assert.equal(withoutArm.checks.noForbiddenTimingInputs, false);
});

// §25.2: el caso real no puede instanciarse sin referencias de precio ni reserva.
test("materializeGasQuarterlyS1 permanece en HOLD sin inventar configuración", () => {
  const real = materializeGasQuarterlyS1();
  assert.equal(real.decision, "HOLD");
  assert.equal(real.configuration, null);
  assert.ok(real.blockedBy.includes("DEP-06/07_DEVELOPMENT_PRICE_REFERENCES_UNAVAILABLE"));
  assert.ok(real.blockedBy.includes("DEP-12_OOS_RESERVATION_NOT_SEALED"));
});
