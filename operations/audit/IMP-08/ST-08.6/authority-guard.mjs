// ST-08.6 proposed-IMP_RECEIPT authority guard (structural + value schema, fail-closed).
//
// Reviewer rounds 1-5 exposed bypasses of a permissive key/alias scan, of
// string-built path regexes (spoofed key names), and finally of a key-only
// schema (affirmative values in allowed keys, e.g. result="accepted" or
// free-text DEP/unlock claims). This module enforces BOTH:
//   - an explicit key schema per node via STRUCTURAL token paths (keys and array
//     indices are separate tokens, so a key literally named
//     "requiredStIdentities[99]" can never impersonate an array element), and
//   - explicit VALUE rules for typed fields and string-array elements, with
//     negation-aware detection of fabricated DEP-satisfaction / unlock claims.
//
// Allowed child-lineage acceptance leaves (only these may assert acceptance):
//   $.requiredStIdentities[<int>].status            = "accepted"
//   $.requiredStIdentities[<int>].nativeApproval.outcome = "approved"
//   $.reviewerLineage[<int>].verdict                = "approved" | "pending"
// The ST-08.6 lineage entry must remain "pending".
//
// Returns a list of human-readable violation paths.

const EXACT_PROPOSED_KIND = "PROPOSED_IMP_RECEIPT";
const RECEIPT_KIND = /IMP[_-]?RECEIPT/i;
const ACCEPTED_OR_APPROVED = /^(accepted|approved)$/i;
const APPROVED_OR_PENDING = /^(approved|pending)$/i;
const SHA256_HEX = /^[0-9a-f]{64}$/i;
const NEGATION = /(\bno\b|\bnot\b|\bnever\b|\bwithout\b|\bcannot\b|\bcan't\b|grants no|does not|do not|isn't|aren't|\bnor\b|remains?\b|unresolved|non-authoritative)/i;
const DEP_KEY = /^(DEP[-_]?\d+)$/i;
const DEP_STRUCT_KEY = /^(dependencystatus|depstatus|dependencestate|depstate|dependencyclaims|depclaims|dependencyresolution|depresolution|dependenciesresolved|resolveddeps|depsresolved|depresolutions|dependencysatisfaction|depsatisfied|depssatisfied|dependencyevidence|depevidence|satisfieddependencies|satisfieddeps|fulfilleddependencies|fulfilleddeps|satisfieddependency)$/i;

// ---- explicit proposal schema (key allowlist per node) ---------------------------
const scalar = { kind: "scalar" };
const stringArray = { kind: "stringArray" };
const claims = { kind: "claims" };
const obj = (keys) => ({ kind: "obj", keys });
const arr = (elem) => ({ kind: "arr", elem });

const identity = obj({ packetId: scalar, subtaskId: scalar, parentImp: scalar, parentIssueIdentifier: scalar, subtaskIssueIdentifier: scalar, project: scalar, specId: scalar, specVersion: scalar, specSha256: scalar });
const nativeApproval = obj({ decisionId: scalar, outcome: scalar, reviewerAgentId: scalar, reviewerUserId: scalar, reviewerRole: scalar });
const versionHash = obj({ contentHash: scalar });
const requiredStIdentitiesEntry = obj({ identity, receiptPath: scalar, receiptSha256: scalar, resultingVersion: versionHash, status: scalar, current: scalar, supersededBy: scalar, nativeApproval });
const reviewerLineageEntry = obj({ role: scalar, agentId: scalar, userId: scalar, verdict: scalar, decisionId: scalar, commentId: scalar, note: scalar });
const evidenceTestHashesEntry = obj({ path: scalar, sha256: scalar });
const prerequisiteChecksEntry = obj({ requirement: scalar, result: scalar, evidence: scalar });
const acceptanceChecksEntry = obj({ criterion: scalar, result: scalar, evidence: scalar });
const testsRunEntry = obj({ command: scalar, exitCode: scalar, expected: scalar, tests: scalar, pass: scalar, fail: scalar });
const specIdentity = obj({ id: scalar, version: scalar, sha256: scalar });
const version = obj({ contentHash: scalar, algorithm: scalar, algorithmA_sortedPathNewlineHash: scalar, sourceSubtask: scalar, sourceIssueIdentifier: scalar, note: scalar });
const root = obj({
  _kind: scalar,
  _authority: scalar,
  _prohibitions: stringArray,
  receiptKind: scalar,
  acceptanceStatus: scalar,
  outcome: scalar,
  parentAcceptancePending: scalar,
  specIdentity,
  impIdentity: scalar,
  projectId: scalar,
  issueId: scalar,
  issueIdentifier: scalar,
  scope: scalar,
  version,
  objectProtocolVersion: scalar,
  requiredStIdentities: arr(requiredStIdentitiesEntry),
  reviewerLineage: arr(reviewerLineageEntry),
  evidenceTestHashes: arr(evidenceTestHashesEntry),
  prerequisiteChecks: arr(prerequisiteChecksEntry),
  acceptanceChecks: arr(acceptanceChecksEntry),
  testsRun: arr(testsRunEntry),
  unresolvedLimits: stringArray,
  potentialUnlocks: stringArray,
  claims,
  dependencyUpdate: scalar,
  preservation: scalar,
});

export function findAuthorityViolations(proposal) {
  const hits = [];
  walk(proposal, [], root, hits);
  return hits;
}

function walk(value, tokens, schema, hits) {
  if (schema.kind === "scalar") {
    if (value !== null && typeof value === "object") hits.push(`${fmt(tokens)} (unexpected structure where scalar allowed)`);
    else if (typeof value === "string") checkValue(lastKey(tokens), value, tokens, hits);
    return;
  }
  if (schema.kind === "stringArray") {
    if (!Array.isArray(value)) {
      hits.push(`${fmt(tokens)} (expected string array)`);
      return;
    }
    value.forEach((element, index) => {
      if (typeof element !== "string") hits.push(`${fmt([...tokens, index])} (expected string element)`);
      else checkValue(lastKey(tokens), element, [...tokens, index], hits);
    });
    return;
  }
  if (schema.kind === "claims") {
    if (!Array.isArray(value)) hits.push(`${fmt(tokens)} (claims must be an array)`);
    else if (value.length > 0) hits.push(`${fmt(tokens)} (non-empty claims)`);
    return;
  }
  if (schema.kind === "arr") {
    if (!Array.isArray(value)) {
      hits.push(`${fmt(tokens)} (expected array)`);
      return;
    }
    value.forEach((item, index) => walk(item, [...tokens, index], schema.elem, hits));
    return;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    hits.push(`${fmt(tokens)} (expected object)`);
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    const here = [...tokens, key];
    const childSchema = schema.keys[key];
    if (!childSchema) {
      hits.push(`${fmt(here)} (unexpected key outside the proposal schema)`);
      continue;
    }
    checkMarkers(key, child, here, hits);
    walk(child, here, childSchema, hits);
  }
  if (schema === reviewerLineageEntry && typeof value.role === "string" && value.role.includes("ST-08.6") && value.verdict !== "pending") {
    hits.push(`${fmt([...tokens, "verdict"])} (ST-08.6 lineage must remain pending)`);
  }
}

function checkMarkers(key, child, tokens, hits) {
  const keyLower = key.toLowerCase();
  const valueLower = typeof child === "string" ? child.trim().toLowerCase() : "";
  const here = fmt(tokens);

  if (keyLower.endsWith("kind") && typeof child === "string" && RECEIPT_KIND.test(child) && child.trim().toUpperCase() !== EXACT_PROPOSED_KIND) {
    hits.push(`${here} (non-proposed IMP receipt kind)`);
  }
  if (keyLower === "outcome" && ACCEPTED_OR_APPROVED.test(valueLower) && !isNativeApprovalOutcome(tokens)) {
    hits.push(`${here} (accepted/approved outcome outside nativeApproval path)`);
  }
  if (keyLower === "acceptancestatus" && ACCEPTED_OR_APPROVED.test(valueLower)) {
    hits.push(`${here} (accepted/approved acceptanceStatus)`);
  }
  if (keyLower === "status" && ACCEPTED_OR_APPROVED.test(valueLower) && !isChildLineageStatus(tokens)) {
    hits.push(`${here} (accepted/approved status outside child lineage)`);
  }
  if (keyLower === "verdict" && APPROVED_OR_PENDING.test(valueLower) && !isReviewerLineageVerdict(tokens)) {
    hits.push(`${here} (verdict outside reviewerLineage)`);
  }
  if (DEP_KEY.test(key) && isAffirmative(child)) hits.push(`${here} (fabricated DEP satisfaction)`);
  if (DEP_STRUCT_KEY.test(key) && isNonEmpty(child)) hits.push(`${here} (structured DEP/dependency claim)`);
}

// Value-level rules for typed fields and string-array elements.
function checkValue(key, value, tokens, hits) {
  if (isAllowedAcceptanceLeaf(tokens)) return; // legitimate child lineage values
  const keyLower = key.toLowerCase();
  const trimmed = value.trim();
  const here = fmt(tokens);

  if (keyLower === "result" && ACCEPTED_OR_APPROVED.test(trimmed)) {
    hits.push(`${here} (accepted/approved result value)`);
  }
  if (keyLower === "sha256" || keyLower === "receiptsha256" || keyLower === "contenthash") {
    if (!SHA256_HEX.test(trimmed)) hits.push(`${here} (expected sha256 hex)`);
  }
  if (keyLower === "dependencyupdate" && !/^None\./.test(trimmed)) {
    hits.push(`${here} (dependencyUpdate must explicitly state None)`);
  }
  if (keyLower === "potentialunlocks" && !/not granted/i.test(trimmed)) {
    hits.push(`${here} (potential unlock must state it is not granted)`);
  }
  if (mentionsPositiveDepClaim(value)) hits.push(`${here} (fabricated DEP satisfaction in value)`);
  if (mentionsPositiveUnlockClaim(value)) hits.push(`${here} (unlock claim in value)`);
}

function mentionsPositiveDepClaim(text) {
  const re = /DEP[-_]?\d+/gi;
  let match;
  while ((match = re.exec(text)) !== null) {
    const window = text.slice(Math.max(0, match.index - 40), Math.min(text.length, match.index + 80));
    if (!/(satisf|closed|resolv|complete|passed|accept|approv)/i.test(window)) continue;
    if (NEGATION.test(window)) continue;
    return true;
  }
  return false;
}

function mentionsPositiveUnlockClaim(text) {
  const re = /unlock(?:ed|s)?/gi;
  let match;
  while ((match = re.exec(text)) !== null) {
    const window = text.slice(Math.max(0, match.index - 30), Math.min(text.length, match.index + 40));
    if (NEGATION.test(window)) continue;
    return true;
  }
  return false;
}

function isAllowedAcceptanceLeaf(tokens) {
  return isChildLineageStatus(tokens) || isNativeApprovalOutcome(tokens) || isReviewerLineageVerdict(tokens);
}
function isChildLineageStatus(tokens) {
  return tokens.length === 3 && tokens[0] === "requiredStIdentities" && Number.isInteger(tokens[1]) && tokens[2] === "status";
}
function isNativeApprovalOutcome(tokens) {
  return tokens.length === 4 && tokens[0] === "requiredStIdentities" && Number.isInteger(tokens[1]) && tokens[2] === "nativeApproval" && tokens[3] === "outcome";
}
function isReviewerLineageVerdict(tokens) {
  return tokens.length === 3 && tokens[0] === "reviewerLineage" && Number.isInteger(tokens[1]) && tokens[2] === "verdict";
}

function isAffirmative(value) {
  if (typeof value === "boolean") return value === true;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") return /^(true|yes|accepted|approved|granted|satisfied|closed|resolved|passed|pass|complete|completed|ok|done)$/i.test(value.trim());
  return false;
}

function isNonEmpty(value) {
  if (value === null || value === undefined) return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Object.keys(value).length > 0;
  if (typeof value === "string") return value.trim().length > 0;
  return isAffirmative(value);
}

function lastKey(tokens) {
  return typeof tokens[tokens.length - 1] === "string" ? tokens[tokens.length - 1] : "";
}

function fmt(tokens) {
  return tokens.reduce((acc, token) => (typeof token === "number" ? `${acc}[${token}]` : `${acc}.${token}`), "$");
}