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
  applyFilledQuantity,
  computeRemainingVolume,
  mapCoverageOwnership,
  reconcileCoverage,
} from "./coverage-ownership.mjs";
