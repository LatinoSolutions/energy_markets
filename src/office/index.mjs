// Surface del binding de la Oficina canónica (IMP-26). Fuente: SPEC v1.1.1
// §§20.2,25.1 (fila IMP-26),25.2 y owner patch
// EM-SPEC-OWNER-PATCH-2026-09-24-01.

export {
  CANONICAL_SPEC_PATH,
  CANONICAL_SPEC_IDENTITY,
  hashSpecBytes,
  specIdentityMismatches,
  verifyCanonicalSpec,
} from "./spec-binding.mjs";

export {
  CANONICAL_IMP_COUNT,
  normalizeImpId,
  expandImpIds,
  expandDepIds,
  requiredDepIds,
  parseRequires,
  parseCanonicalGraph,
  buildCanonicalGraph,
  getImp,
  listImps,
} from "./canonical-graph.mjs";

export {
  BLOCKER_KINDS,
  BLOCKER_KIND_VALUES,
  isBlockerKind,
  createBlocker,
  affectsBranch,
  blockersForBranch,
  hasBlockingFor,
} from "./blockers.mjs";

export {
  acceptedImpSet,
  sameInstance,
  isNewInstance,
  evaluateEligibility,
  eligibleImps,
} from "./eligibility.mjs";

export {
  REVIEW_VERDICTS,
  evaluateReviewIndependence,
  buildReviewVerdict,
  reviewSubtask,
} from "./review.mjs";

export {
  evaluateSubtaskClosure,
  evaluateParentClosure,
} from "./closure.mjs";

export {
  SPEC_CHANGE_REQUEST_FIELDS,
  branchFromImpSubtask,
  buildSpecChangeRequest,
  stopsBranch,
  stopsWork,
} from "./spec-change-request.mjs";

export {
  CONTINUATION_ACTIONS,
  resolveContinuation,
} from "./continuation.mjs";
