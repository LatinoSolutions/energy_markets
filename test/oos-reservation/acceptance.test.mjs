import { test } from "node:test";
import assert from "node:assert/strict";

import {
  IMP09_ACCEPTANCE_TEST,
  SEALED_OOS_CAMPAIGN_COUNT,
  evaluateImp09Acceptance,
  reserveGasQuarterlySealedOos,
  reserveSealedOos,
} from "../../src/oos-reservation/reservation.mjs";
import { gasQuarterlyRegister, validReservationInput } from "./fixtures.mjs";

// Acceptance de IMP-09 §25.1: "≥2 años; chronological split y overlaps
// resueltos por estructura real; historia insuficiente → HOLD. La reserva
// precede a features/references/parameters; cierre P6 no es prerequisite para
// reservar." El output es el manifest de las últimas 8 Gas Quarterly elegibles
// con frontera protegida y registro de acceso/consumo.

test("acceptance: el manifest sella exactamente las últimas 8 campañas elegibles", () => {
  const reservation = reserveSealedOos(validReservationInput());
  assert.equal(reservation.artifactKind, "IMP-09_SEALED_OOS_RESERVATION");
  assert.equal(reservation.decision, "RESERVED");
  assert.equal(reservation.sealedOosCampaignIds.length, SEALED_OOS_CAMPAIGN_COUNT);
  assert.equal(reservation.chronologicalSplit.protectedBoundary, "SEALED");
  assert.equal(typeof reservation.chronologicalSplit.protectedFromIso, "string");
  assert.equal(reservation.accessRegistry.oosStatus, "SEALED");
  assert.deepEqual(reservation.accessRegistry.entries, []);
  assert.equal(evaluateImp09Acceptance(reservation).criterionMet, true);
});

test("acceptance: el split es cronológico y la población queda congelada", () => {
  const reservation = reserveSealedOos(validReservationInput());
  const split = reservation.chronologicalSplit;
  const developmentIndex = reservation.developmentCampaignIds;
  // Development es estrictamente anterior al sealed OOS: la frontera protegida
  // es la primera ventana reservada.
  assert.equal(split.protectedFromIso, "2021-03-01");
  assert.deepEqual(developmentIndex, ["GAS-Q-2021Q1", "GAS-Q-2021Q2"]);
  assert.ok(reservation.span.coversMinYears);
  assert.equal(reservation.span.minCalendarYears, 2);
});

test("acceptance: historia insuficiente deja HOLD sin inventar la reserva", () => {
  const input = validReservationInput();
  input.campaigns = gasQuarterlyRegister({ year: 2021, quarter: 1, count: 6 });
  const reservation = reserveSealedOos(input);
  const verdict = evaluateImp09Acceptance(reservation);
  assert.equal(reservation.decision, "HOLD");
  assert.deepEqual(reservation.sealedOosCampaignIds, []);
  assert.equal(verdict.criterionMet, false);
  assert.deepEqual(verdict.blockedBy, ["INSUFFICIENT_ELIGIBLE_COMPLETE_CAMPAIGNS"]);
});

test("acceptance: el caso real sin campaign register auditado no cierra el IMP", () => {
  const verdict = evaluateImp09Acceptance(reserveGasQuarterlySealedOos());
  assert.equal(verdict.criterionMet, false);
  assert.equal(verdict.decision, "HOLD");
  assert.equal(IMP09_ACCEPTANCE_TEST.startsWith("≥2 años"), true);
});
