// Negative probes for the ST-08.6 structural authority guard. Each mutation
// must be rejected by findAuthorityViolations; the clean proposal must pass.
// A probe entry is [label, mutation] where mutation is either a partial object
// merged into the proposal or a function (clean) => mutatedCopy.
// Exit 0 iff every probe is rejected and the clean control passes.
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { findAuthorityViolations } from "./authority-guard.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const clean = JSON.parse(readFileSync(resolve(root, "operations/audit/IMP-08/ST-08.6/proposed-imp-receipt.json"), "utf8"));

const probes = [
  ["top-level accepted:true", { accepted: true }],
  ["top-level parentAccepted:true", { parentAccepted: true }],
  ["dependencyStatus DEP-13 satisfied", { dependencyStatus: { "DEP-13": "satisfied" } }],
  ["depClaims list", { depClaims: ["DEP-13 satisfied"] }],
  ["isAccepted:true", { isAccepted: true }],
  ["impAccepted:true", { impAccepted: true }],
  ["DEP-13:true", { "DEP-13": true }],
  ["resolvedDeps map", { resolvedDeps: { "DEP-13": "closed" } }],
  ["acceptedOutcome:accepted", { acceptedOutcome: "accepted" }],
  ["acceptedAtUtc present", { acceptedAtUtc: "2026-09-22T00:00:00Z" }],
  ["receiptKind IMP_RECEIPT", { receiptKind: "IMP_RECEIPT" }],
  ["outcome accepted", { outcome: "accepted" }],
  ["claims non-empty", { claims: ["DEP-13"] }],
  ["nested metadata.accepted:true", { metadata: { accepted: true } }],
  ["approvalGranted:true", { approvalGranted: true }],
  ["nested parentAccepted under result", { result: { parentAccepted: true } }],
  ["top-level _kind:IMP_RECEIPT", { _kind: "IMP_RECEIPT" }],
  ["top-level status:accepted", { status: "accepted" }],
  ["nested metadata._kind:IMP_RECEIPT", { metadata: { _kind: "IMP_RECEIPT" } }],
  ["nested metadata.status:accepted", { metadata: { status: "accepted" } }],
  ["case _Kind:imp_receipt", { _Kind: "imp_receipt" }],
  ["case receiptKind:imp_receipt", { receiptKind: "imp_receipt" }],
  ["nested result.status:approved", { result: { status: "approved" } }],
  ["metadata.outcome:approved", { metadata: { outcome: "approved" } }],
  ["metadata.acceptanceStatus:approved", { metadata: { acceptanceStatus: "approved" } }],
  ["metadata._kind:PROPOSED_IMP_RECEIPT_ACCEPTED", { metadata: { _kind: "PROPOSED_IMP_RECEIPT_ACCEPTED" } }],
  ["satisfiedDependencies:[DEP-13]", { satisfiedDependencies: ["DEP-13"] }],
  ["metadata.claims string", { metadata: { claims: "DEP-13 satisfied" } }],
  ["top-level verdict:approved", { verdict: "approved" }],
  ["top-level parentVerdict:approved", { parentVerdict: "approved" }],
  ["ST-08.6 lineage verdict approved", (base) => {
    const copy = structuredClone(base);
    const entry = copy.reviewerLineage.find((item) => typeof item.role === "string" && item.role.includes("ST-08.6"));
    entry.verdict = "approved";
    return copy;
  }],
  ["spoof key requiredStIdentities[99]", { "requiredStIdentities[99]": { nativeApproval: { outcome: "approved" } } }],
  ["fulfilledDependencies:[DEP-13]", { fulfilledDependencies: ["DEP-13"] }],
  ["acceptanceChecks[0].result accepted", (base) => { const copy = structuredClone(base); copy.acceptanceChecks[0].result = "accepted"; return copy; }],
  ["prerequisiteChecks[0].result approved", (base) => { const copy = structuredClone(base); copy.prerequisiteChecks[0].result = "approved"; return copy; }],
  ["dependencyUpdate DEP-13 satisfied", { dependencyUpdate: "DEP-13 satisfied" }],
  ["unresolvedLimits[0] DEP-13 resolved", (base) => { const copy = structuredClone(base); copy.unresolvedLimits[0] = "DEP-13 resolved"; return copy; }],
  ["potentialUnlocks IMP-13 unlocked", (base) => { const copy = structuredClone(base); copy.potentialUnlocks = ["IMP-13 unlocked"]; return copy; }],
];

let failures = 0;
for (const [label, mutation] of probes) {
  const merged = typeof mutation === "function" ? mutation(clean) : merge(clean, mutation);
  const hits = findAuthorityViolations(merged);
  const rejected = hits.length > 0;
  if (!rejected) failures += 1;
  console.log(`${rejected ? "PASS" : "FAIL"} reject ${label}${rejected ? ` -> ${hits[0]}` : " (evaded the guard!)"}`);
}

const cleanHits = findAuthorityViolations(clean);
if (cleanHits.length > 0) failures += 1;
console.log(`${cleanHits.length === 0 ? "PASS" : "FAIL"} clean proposal has no authority violation${cleanHits.length === 0 ? "" : ` -> ${cleanHits.join("; ")}`}`);

const st086 = clean.reviewerLineage.find((item) => typeof item.role === "string" && item.role.includes("ST-08.6"));
const pendingOk = st086 && st086.verdict === "pending";
if (!pendingOk) failures += 1;
console.log(`${pendingOk ? "PASS" : "FAIL"} ST-08.6 lineage entry remains pending`);

console.log(`RESULT ${failures === 0 ? "PASS" : "FAIL"}: probes=${probes.length} rejected, clean control ${cleanHits.length === 0 ? "ok" : "rejected"}`);
process.exitCode = failures === 0 ? 0 : 1;

function merge(base, mutation) {
  if (Array.isArray(base) || Array.isArray(mutation)) return mutation;
  if (!base || typeof base !== "object" || !mutation || typeof mutation !== "object") return mutation;
  const out = { ...base };
  for (const [key, value] of Object.entries(mutation)) {
    out[key] = key in base ? merge(base[key], value) : value;
  }
  return out;
}