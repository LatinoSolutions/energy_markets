import { test } from "node:test";
import assert from "node:assert/strict";

import {
  CHRONOLOGICAL_RESERVATION_BASIS,
  computeOosSpan,
  evaluateImp09Acceptance,
  isReservationIntact,
  recordOosAccess,
  reserveGasQuarterlySealedOos,
  reserveSealedOos,
} from "../../src/oos-reservation/reservation.mjs";
import { IMP09_SPEC_IDENTITY, chronologicalEligibleComplete } from "../../src/oos-reservation/campaign-register.mjs";
import { detectOverlaps } from "../../src/oos-reservation/overlap.mjs";
import {
  gasQuarterlyRegister,
  realDurationResolution,
  validReservationInput,
  withWindowOverlap,
} from "./fixtures.mjs";

test("materializa la reserva de las últimas 8 Gas Quarterly elegibles con split cronológico", () => {
  const result = reserveSealedOos(validReservationInput());
  assert.equal(result.decision, "RESERVED");
  assert.equal(result.sealedOosCount, 8);
  assert.deepEqual(result.developmentCampaignIds, ["GAS-Q-2021Q1", "GAS-Q-2021Q2"]);
  assert.deepEqual(result.sealedOosCampaignIds, [
    "GAS-Q-2021Q3", "GAS-Q-2021Q4", "GAS-Q-2022Q1", "GAS-Q-2022Q2",
    "GAS-Q-2022Q3", "GAS-Q-2022Q4", "GAS-Q-2023Q1", "GAS-Q-2023Q2",
  ]);
  assert.equal(result.chronologicalSplit.protectedFromIso, "2021-03-01");
  assert.equal(result.chronologicalSplit.protectedBoundary, "SEALED");
  assert.equal(result.span.coversMinYears, true);
  assert.deepEqual(result.span.calendarYears, [2021, 2022, 2023]);
  assert.equal(result.accessRegistry.oosStatus, "SEALED");
  assert.equal(result.precedesCalibration, true);
  assert.equal(typeof result.contentHash, "string");
  assert.equal(result.contentHash.length, 64);
});

test("sin 8 campañas completas y elegibles permanece HOLD, sin reserva ficticia (§13.8)", () => {
  const input = validReservationInput();
  input.campaigns = gasQuarterlyRegister({ year: 2021, quarter: 1, count: 7 });
  const result = reserveSealedOos(input);
  assert.equal(result.decision, "HOLD");
  assert.equal(result.sealedOosCount, 0);
  assert.deepEqual(result.sealedOosCampaignIds, []);
  assert.deepEqual(result.blockedBy, ["INSUFFICIENT_ELIGIBLE_COMPLETE_CAMPAIGNS"]);
  assert.equal(result.chronologicalSplit, null);
});

test("excluye campañas no elegibles o incompletas del conteo y del split", () => {
  const input = validReservationInput();
  input.campaigns = gasQuarterlyRegister({ year: 2021, quarter: 1, count: 11 });
  input.campaigns[0].eligibility = "INELIGIBLE";
  input.campaigns[10].completeness = "INCOMPLETE";
  const result = reserveSealedOos(input);
  assert.equal(result.decision, "RESERVED");
  assert.deepEqual(result.developmentCampaignIds, ["GAS-Q-2021Q2"]);
  assert.deepEqual(result.excludedCampaigns, [
    { campaignId: "GAS-Q-2021Q1", reason: "INELIGIBLE" },
    { campaignId: "GAS-Q-2023Q3", reason: "INCOMPLETE" },
  ]);
});

test("un solapamiento sin resolución real deja la reserva en HOLD", () => {
  const input = validReservationInput();
  input.campaigns = withWindowOverlap(input.campaigns, "2021Q3", "2021Q4");
  const result = reserveSealedOos(input);
  assert.equal(result.decision, "HOLD");
  assert.ok(result.blockedBy.includes("UNRESOLVED_OVERLAP"));
  assert.deepEqual(result.sealedOosCampaignIds, []);
});

test("un solapamiento resuelto con estructura real sella la reserva", () => {
  const input = validReservationInput();
  input.campaigns = withWindowOverlap(input.campaigns, "2021Q3", "2021Q4");
  const ordered = chronologicalEligibleComplete(input.campaigns);
  const overlaps = detectOverlaps({ sealedOos: ordered.slice(-8), development: ordered.slice(0, -8) });
  input.overlapResolutions = realDurationResolution(overlaps, "EMBARGO", { embargoDays: 10 });
  const result = reserveSealedOos(input);
  assert.equal(result.decision, "RESERVED");
  assert.equal(result.overlapResolutions.length, 1);
  assert.equal(result.overlapResolutions[0].action, "EMBARGO");
});

test("seleccionar por outcome se rechaza (IMP-09 MUST NOT, §15.2)", () => {
  const input = validReservationInput();
  input.reservationBasis = "OUTCOME";
  const result = reserveSealedOos(input);
  assert.equal(result.decision, "HOLD");
  assert.ok(result.errors.some((error) => error.code === "OUTCOME_BASED_SELECTION"));
});

test("una reserva posterior a la calibración se rechaza (§13.8 precede a features/references/parameters)", () => {
  const input = validReservationInput();
  input.s1Configuration = { version: "v1" };
  const result = reserveSealedOos(input);
  assert.equal(result.decision, "HOLD");
  assert.ok(result.errors.some((error) => error.code === "RESERVATION_AFTER_CALIBRATION"));
  assert.equal(result.precedesCalibration, true);
});

test("sin basis cronológico declarado no se elige una base en silencio", () => {
  const input = validReservationInput();
  delete input.reservationBasis;
  const result = reserveSealedOos(input);
  assert.equal(result.decision, "HOLD");
  assert.ok(result.errors.some((error) => error.code === "INVALID_RESERVATION_BASIS"));
});

test("el registro real sin campaign register auditado produce HOLD con la ausencia citada", () => {
  const result = reserveGasQuarterlySealedOos();
  assert.equal(result.decision, "HOLD");
  assert.deepEqual(result.blockedBy, ["INSUFFICIENT_ELIGIBLE_COMPLETE_CAMPAIGNS"]);
  assert.deepEqual(result.sealedOosCampaignIds, []);
  assert.ok(result.registerAbsence);
  assert.ok(result.registerAbsence.sources.some((source) => source.includes("IMP-03")));
  assert.equal(evaluateImp09Acceptance(result).criterionMet, false);
});

test("computeOosSpan verifica los años calendario de la evidencia reservada", () => {
  const ordered = chronologicalEligibleComplete(gasQuarterlyRegister({ year: 2021, quarter: 1, count: 10 }));
  const span = computeOosSpan(ordered.slice(-8));
  assert.equal(span.minCalendarYears, 2);
  assert.equal(span.coversMinYears, true);
  assert.deepEqual(span.calendarYears, [2021, 2022, 2023]);
});

test("registro de acceso: la inspección de evaluación no consume el OOS", () => {
  const reservation = reserveSealedOos(validReservationInput());
  const accessed = recordOosAccess(reservation, { atUtc: "2026-09-23T12:00:00Z", actor: "reviewer", purpose: "OOS_EVALUATION_INSPECTION" });
  assert.equal(accessed.ok, true);
  assert.equal(accessed.reservation.accessRegistry.oosStatus, "SEALED");
  assert.equal(isReservationIntact(accessed.reservation).intact, true);
});

test("registro de acceso: calibrar sobre el OOS lo consume (§13.8/§15.2)", () => {
  const reservation = reserveSealedOos(validReservationInput());
  const consumed = recordOosAccess(reservation, { atUtc: "2026-09-23T12:00:00Z", actor: "implementer", purpose: "PARAMETER_SELECTION" });
  assert.equal(consumed.ok, true);
  assert.equal(consumed.reservation.accessRegistry.oosStatus, "CONSUMED");
  assert.deepEqual(isReservationIntact(consumed.reservation), { intact: false, reasons: ["OOS_CONSUMED"] });
});

test("registro de acceso falla cerrado ante HOLD, timestamp o propósito inválidos", () => {
  const reservation = reserveSealedOos(validReservationInput());
  const input = validReservationInput();
  input.campaigns = gasQuarterlyRegister({ year: 2021, quarter: 1, count: 2 });
  const held = reserveSealedOos(input);

  assert.equal(recordOosAccess(held, { atUtc: "2026-09-23T12:00:00Z", purpose: "OOS_EVALUATION_INSPECTION" }).code, "RESERVATION_NOT_SEALED");
  assert.equal(recordOosAccess(reservation, { atUtc: "2026-09-23 12:00", purpose: "OOS_EVALUATION_INSPECTION" }).code, "INVALID_ACCESS_TIME");
  assert.equal(recordOosAccess(reservation, { atUtc: "2026-09-23T12:00:00Z", purpose: "MADE_UP" }).code, "UNKNOWN_ACCESS_PURPOSE");
  assert.equal(recordOosAccess(reservation, { atUtc: "2026-09-23T12:00:00Z", purpose: "OOS_EVALUATION_INSPECTION", modifiesDesign: true }).reservation.accessRegistry.oosStatus, "CONSUMED");
});

test("evaluateImp09Acceptance sólo acredita la reserva materializada", () => {
  const accepted = evaluateImp09Acceptance(reserveSealedOos(validReservationInput()));
  assert.equal(accepted.criterionMet, true);
  assert.equal(accepted.source, "SPEC v1.1.1 §25.1 IMP-09");

  const input = validReservationInput();
  input.reservationBasis = "OUTCOME";
  const held = evaluateImp09Acceptance(reserveSealedOos(input));
  assert.equal(held.criterionMet, false);
});

test("la identidad de la SPEC es la vigente v1.1.1", () => {
  assert.equal(IMP09_SPEC_IDENTITY.version, "1.1.1");
  assert.equal(CHRONOLOGICAL_RESERVATION_BASIS, "CHRONOLOGICAL_ELIGIBLE");
});
