import { test } from "node:test";
import assert from "node:assert/strict";

import {
  CHRONOLOGICAL_RESERVATION_BASIS,
  GAS_QUARTERLY_ELIGIBILITY_AUDIT,
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
  withNestedWindowOverlap,
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

test("sólo la elegibilidad auditada sella: una base PROXY fuerza HOLD (§25.1/§13.3)", () => {
  const audited = reserveSealedOos(validReservationInput());
  assert.equal(audited.decision, "RESERVED");
  assert.equal(audited.eligibilityBasis, "AUDITED");

  const input = validReservationInput();
  input.campaigns = input.campaigns.map((campaign) => ({ ...campaign, eligibilityBasis: "PROXY" }));
  const derived = reserveSealedOos(input);
  assert.equal(derived.decision, "HOLD");
  assert.equal(derived.eligibilityBasis, "PROXY");
  assert.deepEqual(derived.blockedBy, ["ELIGIBILITY_BASIS_NOT_AUDITED"]);
  assert.deepEqual(derived.sealedOosCampaignIds, []);
  const verdict = evaluateImp09Acceptance(derived);
  assert.equal(verdict.criterionMet, false);
  assert.equal(verdict.eligibilityBasis, "PROXY");
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

test("un solapamiento anidado no adyacente deja la reserva en HOLD (no sella fail-open)", () => {
  const input = validReservationInput();
  input.campaigns = withNestedWindowOverlap(input.campaigns, "2022Q1", "2023Q1");
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
   input.overlapResolutions = realDurationResolution(overlaps, "EMBARGO", { embargoDays: 184 });
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
  assert.equal(result.precedesCalibration, false);
});

test("un HOLD por historia insuficiente no declara que la reserva siguió a la calibración", () => {
  const input = validReservationInput();
  input.campaigns = gasQuarterlyRegister({ year: 2021, quarter: 1, count: 7 });
  const result = reserveSealedOos(input);
  assert.equal(result.decision, "HOLD");
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

test("la ausencia documentada del registro Gas Quarterly no afirma lo ya superado por la derivación", () => {
  // Regresión de comentario stale (guardrail 15 / REGLA 3): el registro ya es
  // derivable con register-builder; la constante sólo conserva la ausencia de la
  // matriz IMP-03 en el corte original. No puede decir que "aún no ha sido derivado".
  const reason = GAS_QUARTERLY_ELIGIBILITY_AUDIT.documentedAbsence.reason;
  assert.ok(reason.includes("register-builder"));
  assert.equal(reason.includes("aún no ha sido derivado"), false);
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

test("un hueco en la secuencia elegible mantiene HOLD (un quarter omitido desplaza el corte)", () => {
  const input = validReservationInput();
  input.campaigns = gasQuarterlyRegister({ year: 2021, quarter: 1, count: 11 })
    .filter((campaign) => campaign.maturity !== "2021Q2");
  const result = reserveSealedOos(input);
  assert.equal(result.decision, "HOLD");
  assert.ok(result.errors.some((error) => error.code === "NON_CONTIGUOUS_ELIGIBLE_SEQUENCE"));
});

test("BINDING: sin fecha de corte el manifest queda HOLD (§25.1/DEP-12)", () => {
  const input = validReservationInput();
  delete input.reservationBinding.cutoffIso;
  const result = reserveSealedOos(input);
  assert.equal(result.decision, "HOLD");
  assert.ok(result.errors.some((error) => error.code === "MISSING_CUTOFF_DATE"));
});

test("BINDING: sin hashes de fuentes el manifest queda HOLD", () => {
  const input = validReservationInput();
  delete input.reservationBinding.sourceHashes;
  const result = reserveSealedOos(input);
  assert.equal(result.decision, "HOLD");
  assert.ok(result.errors.some((error) => error.code === "MISSING_SOURCE_HASHES"));
});

test("BINDING: cambiar cualquier hash de fuente cambia el contentHash", () => {
  const a = reserveSealedOos(validReservationInput());
  const input2 = validReservationInput();
  input2.reservationBinding.sourceHashes.exchangeCalendar = "e".repeat(64);
  const b = reserveSealedOos(input2);
  assert.equal(a.decision, "RESERVED");
  assert.equal(b.decision, "RESERVED");
  assert.notEqual(a.contentHash, b.contentHash);
  // El binding queda visible en el manifest sellado.
  assert.equal(a.reservationBinding.cutoffIso, "2026-09-23");
  assert.equal(Object.keys(a.reservationBinding.sourceHashes).length, 4);
});

test("2026Q4 fuera de la foto: un quarter posterior al corte no es elegible con esta evidencia", () => {
  const input = validReservationInput();
  input.campaigns = gasQuarterlyRegister({ year: 2021, quarter: 1, count: 24 });
  input.reservationBinding = { cutoffIso: "2026-07-28", sourceHashes: { eexEvidence: "f".repeat(64), exchangeCalendar: "1".repeat(64) } };
  const result = reserveSealedOos(input);
  assert.equal(result.decision, "HOLD");
  assert.ok(result.errors.some((error) => error.code === "ELIGIBLE_EPISODE_AFTER_CUTOFF"));
});

test("H5: un BOUNDARY_CHANGE resuelto aplica la frontera revisada al manifest y cambia el hash", () => {
  const build = (actionConfig) => {
    const input = validReservationInput();
    input.campaigns = withNestedWindowOverlap(input.campaigns, "2022Q1", "2023Q1");
    const ordered = chronologicalEligibleComplete(input.campaigns);
    input.overlapResolutions = realDurationResolution(
      detectOverlaps({ sealedOos: ordered.slice(-8), development: ordered.slice(0, -8) }),
      "BOUNDARY_CHANGE",
      actionConfig,
    );
    return reserveSealedOos(input);
  };
  const revision = build({ revisedBoundary: "2022-01-01" });
  assert.equal(revision.decision, "RESERVED");
  assert.equal(revision.chronologicalSplit.protectedFromIso, "2022-01-01");
  assert.equal(revision.reservationBinding.cutoffIso, "2026-09-23");
  const referencia = build({ revisedBoundary: "2022-06-01" });
  assert.equal(referencia.chronologicalSplit.protectedFromIso, "2022-06-01");
  assert.notEqual(revision.contentHash, referencia.contentHash);
});
