// Acceptance de IMP-11. Fuente: SPEC v1.1.1 §25.1 fila IMP-11 (acceptance test
// "Sólo static location altera timing; sin Z/S2–S5/drivers; thresholds frozen
// fuera de OOS"; MUST NOT "Identidad S1; A1=A0+S1; Procurement State no añade
// alpha independiente") y §25.2 fila IMP-11 (REQUIRES_AUDIT DEP-06/07 y DEP-12;
// DEP-11 es lo que produce, no un prerequisite). El veredicto no acredita edge
// ni DEP-13/14: sólo que la instanciación mínima satisface su criterio técnico.

import { isReservationIntact, reserveGasQuarterlySealedOos } from "../oos-reservation/index.mjs";
import { assertA1IsA0PlusS1, probeForbiddenTimingInputsRejected, probeStaticLocationTiming, probeTimingIndependentOfProcurementState } from "./a1-arm.mjs";
import { assertThresholdsFrozenBeforeOos } from "./calibration.mjs";
import { assertConfigurationFrozen } from "./configuration.mjs";
import { IMP11_ACCEPTANCE_TEST, IMP11_MUST_NOT_CHANGE } from "./feature-definitions.mjs";
import { assertSearchSpacePredeclared } from "./search-space.mjs";

// Sondas de ejecución del acceptance (H-IMP11-03): remaining volumes SINTÉTICOS
// para comprobar invariancia de la acción BUY/WAIT a features S1 fijas. No es
// configuración de campaña ni valor canónico; sólo entrada del test de guard.
// Spread con valores por debajo y por encima de umbrales típicos para exponer
// dependencias ocultas al remaining.
const DEFAULT_PROCUREMENT_STATE_VARIANTS = [4, 8, 16, 32, 64, 120];

export function evaluateImp11Acceptance({
  configuration,
  searchSpace,
  reservation,
  a0Arm,
  a1Arm,
  a0ControllerVersion,
  a1ControllerVersion,
  timingProbeState,
  procurementStateVariants = DEFAULT_PROCUREMENT_STATE_VARIANTS,
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
  // §8.1/§13.5: sólo la ubicación estática altera el timing. Se deriva POR
  // EJECUCIÓN con el brazo real, no de un booleano declarado por el caller
  // (H-IMP11-02, review 2026-09-24).
  const locationProbe = a1Arm?.decideAtOpportunity && timingProbeState
    ? probeStaticLocationTiming({
      a1Arm,
      currentDate: timingProbeState.currentDate,
      remainingVolumeMw: timingProbeState.remainingVolumeMw,
      favorableFeatures: timingProbeState.favorableFeatures,
      unfavorableFeatures: timingProbeState.unfavorableFeatures,
    })
    : { onlyStaticLocationAltersTiming: false };
  checks.onlyStaticLocationAltersTiming = locationProbe.onlyStaticLocationAltersTiming === true;
  // §13.5/§25.1 MUST NOT: Procurement State no añade alpha independiente. A
  // iguales features S1, la acción BUY/WAIT no puede variar con el remaining
  // volume; se deriva POR EJECUCIÓN del brazo real, no de un booleano declarado
  // por el caller (H-IMP11-03, review 2026-09-24).
  const procurementProbe = a1Arm?.decideAtOpportunity && timingProbeState
    ? probeTimingIndependentOfProcurementState({
      a1Arm,
      a0Arm,
      currentDate: timingProbeState.currentDate,
      featureSets: [timingProbeState.favorableFeatures, timingProbeState.unfavorableFeatures].filter((features) => features !== undefined),
      remainingVariants: procurementStateVariants,
    })
    : { procurementStateAddsNoTimingAlpha: false };
  checks.procurementStateAddsNoTimingAlpha = procurementProbe.procurementStateAddsNoTimingAlpha === true;
  // §13.5: sin Z/S2–S5/drivers (ni trayectoria) en el timing. El estado
  // prohibido canónico contiene un componente S (s3); su rechazo se verifica
  // ejecutando la decisión, no declarándolo.
  const forbiddenProbe = a1Arm?.decideAtOpportunity && timingProbeState?.currentDate
    ? probeForbiddenTimingInputsRejected({
      a1Arm,
      forbiddenState: { currentDate: timingProbeState.currentDate, s3: {} },
    })
    : { ok: false, forbiddenInputsRejected: false };
  checks.noForbiddenTimingInputs = forbiddenProbe.forbiddenInputsRejected === true;
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
  if (!checks.procurementStateAddsNoTimingAlpha) blockedBy.push("PROCUREMENT_STATE_ADDS_TIMING_ALPHA");
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
    timingEvidence: {
      onlyStaticLocationAltersTiming: locationProbe,
      procurementTimingIndependence: procurementProbe,
      forbiddenInputsRejected: forbiddenProbe,
    },
    oos: oosGuard.ok ? { protectedFromIso: oosGuard.protectedFromIso, frozenAtUtc: oosGuard.frozenAtUtc } : { error: oosGuard.code },
  };
}

// §25.2 fila IMP-11: "DEP-11 es lo que debe producir, no un S1 validado que
// deba existir antes". El caso real Gas Quarterly no puede instanciar una
// configuración sin referencias causales de precio suficientemente auditadas
// (R-05: el lago EEX existe por §6.5, pero su suficiencia por instrumento/
// campaña no está demostrada, DEP-06/07 sigue AUDIT-DEPENDENT) ni sin reserva
// OOS sellada (IMP-09 en HOLD). Se registra el HOLD, sin inventar configuración
// ni evidencia.
export function materializeGasQuarterlyS1(overrides = {}) {
  const reservation = overrides.reservation ?? reserveGasQuarterlySealedOos();
  const developmentPriceReferences = overrides.developmentPriceReferences ?? {
    available: false,
    source: "operations/audit/IMP-03/data-sufficiency-matrix.json",
    requirementId: "R-05",
    reason: "S1 requires a causal price at the exact decision timestamp plus reference construction. The EEX lake exists (§6.5) but per-requirement sufficiency (coverage, resolution, units, missingness, revisions, mandate link, permissions) is not demonstrated, so DEP-06/07 remains AUDIT-DEPENDENT and S1 cannot be instantiated or verified.",
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
