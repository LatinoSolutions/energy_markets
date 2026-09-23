// Superficie pública del contrato de campaña y coverage ownership de IMP-02.
// Fuente: SPEC v1.1.1 §4 (Procurement Problem Contract), §13.4 (episode) y
// §14.5 (coverage/remaining volume). Materializa la ficha reconstruida y sus
// invariantes; no cierra DEP-01–04 ni declara DATA_READY.

export {
  CAMPAIGN_CONTRACT_FACTS,
  CONFIRMED_OBLIGATIONS,
  confirmedQuantityFor,
  convertMwToMwh,
  createGasQuarterlyFicha,
  resolveObligationDeadline,
  validateCampaignContract,
} from "./campaign-contract.mjs";

export {
  COVERAGE_STATUSES,
  MONTHLY_QUARTERLY_RELATION_STATES,
  COVERAGE_OWNERSHIP_MAP_STATES,
  applyFilledQuantity,
  computeRemainingVolume,
  mapCoverageOwnership,
  reconcileCoverage,
  validateOwnershipAssignments,
  validateRelationDeclaration,
} from "./coverage-ownership.mjs";
