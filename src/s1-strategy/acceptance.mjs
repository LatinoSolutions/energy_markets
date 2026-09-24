// Acceptance de IMP-11. Fuente: SPEC v1.1.1 §25.1 fila IMP-11 (acceptance test
// "Sólo static location altera timing; sin Z/S2–S5/drivers; thresholds frozen
// fuera de OOS"; MUST NOT "Identidad S1; A1=A0+S1; Procurement State no añade
// alpha independiente") y §25.2 fila IMP-11 (REQUIRES_AUDIT DEP-06/07 y DEP-12;
// DEP-11 es lo que produce, no un prerequisite). El veredicto no acredita edge
// ni DEP-13/14: sólo que la instanciación mínima satisface su criterio técnico.

import { isReservationIntact, reserveGasQuarterlySealedOos } from "../oos-reservation/index.mjs";
import { assertA1IsA0PlusS1 } from "./a1-arm.mjs";
import { assertThresholdsFrozenBeforeOos } from "./calibration.mjs";
import { assertConfigurationFrozen } from "./configuration.mjs";
import { IMP11_ACCEPTANCE_TEST, IMP11_MUST_NOT_CHANGE } from "./feature-definitions.mjs";
import { assertSearchSpacePredeclared } from "./search-space.mjs";

export function evaluateImp11Acceptance({
  configuration,
  searchSpace,
  reservation,
  a0Arm,
  a1Arm,
  a0ControllerVersion,
  a1ControllerVersion,
  timingProbe,
  prerequisites,
} = {}) {
  const checks = {};

  const configurationGuard = assertConfigurationFrozen(configuration);
  checks.semanticIdentityIntact = configurationGuard.ok;
  const searchSpaceGuard = assertSearchSpacePredeclared(searchSpace);
  checks.searchSpacePredeclared = searchSpaceGuard.ok;
  const oosGuard = assertThresholdsFrozenBeforeOos(configuration, reservation);
  checks.thresholdsFrozenBeforeOos = oosGuard.ok;
  const intact = isReservationIntact(reservation);
  checks.oosReservationIntact = intact.intact;
  // §13.9/§25.1: A1 = A0 + S1 con controller y oportunidades compartidos.
  const parity = a0Arm && a1Arm
    ? assertA1IsA0PlusS1({ a0Arm, a1Arm, a0ControllerVersion, a1ControllerVersion })
    : { ok: false, code: "A1_PARITY_NOT_PROVIDED" };
  checks.a1IsA0PlusS1 = parity.ok;
  // §8.1/§13.5: sólo la ubicación estática altera el timing.
  checks.onlyStaticLocationAltersTiming = timingProbe?.onlyStaticLocationAltersTiming === true;
  // §13.5: sin Z/S2–S5/drivers (ni trayectoria) en el timing.
  checks.noForbiddenTimingInputs = timingProbe?.noForbiddenInputs === true;
  // §25.2: DEP-06/07 es prerequisite de audit, no output. La reserva sellada se
  // deriva del propio artifact, no de una declaración paralela.
  checks.developmentPriceReferencesAvailable = prerequisites?.developmentPriceReferences?.available === true;
  checks.reservationPrerequisiteSealed = reservation?.decision === "RESERVED";

  const blockedBy = [];
  if (!checks.developmentPriceReferencesAvailable) blockedBy.push("DEP-06/07_DEVELOPMENT_PRICE_REFERENCES_UNAVAILABLE");
  if (!checks.reservationPrerequisiteSealed) blockedBy.push("DEP-12_OOS_RESERVATION_NOT_SEALED");
  if (!checks.semanticIdentityIntact) blockedBy.push(configurationGuard.code);
  if (!checks.searchSpacePredeclared) blockedBy.push(searchSpaceGuard.code);
  if (!checks.thresholdsFrozenBeforeOos) blockedBy.push(oosGuard.code);
  if (!checks.oosReservationIntact) blockedBy.push(...intact.reasons);
  if (!checks.a1IsA0PlusS1) blockedBy.push(parity.code);
  if (!checks.onlyStaticLocationAltersTiming) blockedBy.push("STATIC_LOCATION_TIMING_NOT_DEMONSTRATED");
  if (!checks.noForbiddenTimingInputs) blockedBy.push("FORBIDDEN_TIMING_INPUT_ACCEPTED");

  const criterionMet = Object.values(checks).every((value) => value === true);
  return {
    artifactKind: "IMP-11_ACCEPTANCE",
    acceptanceTest: IMP11_ACCEPTANCE_TEST,
    mustNotChange: IMP11_MUST_NOT_CHANGE,
    source: "SPEC v1.1.1 §25.1/§25.2 IMP-11",
    criterionMet,
    blockedBy: [...new Set(blockedBy)],
    checks,
    configurationHash: configuration?.contentHash ?? null,
    a1Parity: parity,
    oos: oosGuard.ok ? { protectedFromIso: oosGuard.protectedFromIso, frozenAtUtc: oosGuard.frozenAtUtc } : { error: oosGuard.code },
  };
}

// §25.2 fila IMP-11: "DEP-11 es lo que debe producir, no un S1 validado que
// deba existir antes". El caso real Gas Quarterly no puede instanciar una
// configuración sin referencias causales de precio (R-05 UNAVAILABLE) ni sin
// reserva OOS sellada (IMP-09 en HOLD). Se registra el HOLD, sin inventar
// configuración ni evidencia.
export function materializeGasQuarterlyS1(overrides = {}) {
  const reservation = overrides.reservation ?? reserveGasQuarterlySealedOos();
  const developmentPriceReferences = overrides.developmentPriceReferences ?? {
    available: false,
    source: "operations/audit/IMP-03/data-sufficiency-matrix.json",
    requirementId: "R-05",
    reason: "S1 requires a causal price at the exact decision timestamp plus reference construction; no price series exists to build or verify it.",
  };
  const blockedBy = [];
  if (!developmentPriceReferences.available) blockedBy.push("DEP-06/07_DEVELOPMENT_PRICE_REFERENCES_UNAVAILABLE");
  if (reservation?.decision !== "RESERVED") blockedBy.push("DEP-12_OOS_RESERVATION_NOT_SEALED");
  return {
    artifactKind: "IMP-11_REAL_CASE",
    scope: "P5 Gas Quarterly",
    decision: blockedBy.length === 0 ? "MATERIALIZABLE" : "HOLD",
    configuration: null,
    reservation,
    developmentPriceReferences,
    blockedBy,
    reason: blockedBy.length === 0
      ? null
      : "HOLD: la instanciación real de S1 exige referencias causales de precio de development (DEP-06/07) y una reserva OOS sellada (DEP-12); ninguna está disponible en el corte auditado (§25.2 IMP-11).",
  };
}
