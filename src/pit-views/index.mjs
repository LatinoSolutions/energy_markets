// Surface del contrato PIT de IMP-06. Fuente: SPEC v1.1.1 §6.1–§6.2,
// §14.3/§14.6/§14.7 y §19.2.

export {
  isUtcAnchored,
  toUtcTimestamp,
  presentInMarketZone,
} from "./time.mjs";

export { DEFAULT_REPO_ROOT, verifyAcceptedArtifact } from "./audited-artifacts.mjs";

export {
  buildPitRecord,
  canonicalValueSha256,
  isConsumableAtBoundary,
  isProxyAdmissibleAtBoundary,
  isVerifiedEvidenceRegistry,
  isVerifiedValueRegistry,
  loadConsumptionAttestations,
  loadValueAttestations,
  normalizeProxyDeclarations,
  PER_VERSION_EVIDENCE_DEPENDENCY,
  semanticsOf,
  sourceRankOf,
  VIEW_SCOPES,
} from "./pit-record.mjs";

export {
  auditedManifestRecords,
  buildPitManifest,
  buildPitManifestFromAudit,
  buildRevision,
  IMP03_REQUIREMENT_VIEW_SCOPES,
  isVerifiedPitManifest,
  readDecisionView,
  readEvaluationView,
  viewsAt,
  VIEW_KINDS,
} from "./views.mjs";
