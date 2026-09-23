// Superficie pública de la reserva OOS de IMP-09. Fuente: SPEC v1.1.1 §25.1
// IMP-09, §13.8 (sealed OOS) y §15.2 (consumo y versiones). Identifica y sella
// las últimas 8 campañas Gas Quarterly completas y elegibles antes de
// cualquier selección/calibración de S1; sin historia suficiente, HOLD.

export {
  COMPLETENESS_STATUSES,
  ELIGIBILITY_BASES,
  ELIGIBILITY_STATUSES,
  IMP09_SPEC_IDENTITY,
  OOS_MISSION,
  OOS_PRODUCT,
  calendarYearOf,
  chronologicalEligibleComplete,
  compareIsoDates,
  parseIsoDate,
  quarterIndex,
  resolveEligibilityBasis,
  validateEligibilityRegister,
  validateSpecIdentity,
} from "./campaign-register.mjs";

export {
  DEVELOPMENT_MATERIAL,
  OVERLAP_ACTIONS,
  OVERLAP_KINDS,
  detectOverlaps,
  resolveOverlaps,
} from "./overlap.mjs";

export {
  CHRONOLOGICAL_RESERVATION_BASIS,
  GAS_QUARTERLY_ELIGIBILITY_AUDIT,
  IMP09_ACCEPTANCE_TEST,
  SEALED_OOS_CAMPAIGN_COUNT,
  SEALED_OOS_MIN_CALENDAR_YEARS,
  computeOosSpan,
  contentHashOf,
  evaluateImp09Acceptance,
  isReservationIntact,
  recordOosAccess,
  reserveGasQuarterlySealedOos,
  reserveSealedOos,
} from "./reservation.mjs";
