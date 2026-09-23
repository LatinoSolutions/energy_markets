// ST-08.6 verifier. Independently re-checks the staged parent-gate inputs and
// proves the proposed IMP_RECEIPT is mechanically unable to masquerade as an
// accepted parent receipt (SPEC v1.1 20.2.10). Read-only over product code and
// prior audit trees; only reads this packet's payload and pinned inputs.
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { validateStReceipt, linkStReceiptToPacket } from "../../../../src/contracts/identities.mjs";
import { findAuthorityViolations } from "./authority-guard.mjs";

const PIN = {
  spec: "86c4bd4eeb5f9d0ebad94763128b221eb64525a2b7fff1007dab0af88b39cb6c",
  semanticHashC: "bc0ce6adef42831da21c9339c6569018a8c6b03a587558372ace336d4f661528",
  semanticHashA: "96e73ef9ce63aea6bd39934cebc17cdc656f3f0d9ef576700739e39afa914f6e",
};
const PROTECTED_HASHES = {
  "docs/canonical/PROCUREMENT_RESEARCH_CANONICAL_ENGINEERING_SPEC_v1_1.md": PIN.spec,
  "operations/bootstrap/baseline-manifest.json": "895539b7312479a4350b7eeddf207c084090cf29abd391025dd763be00ca9860",
  "operations/receipts/IMP-01-IMP_RECEIPT.json": "78d92de81d8c480b7d96c7203fa2a0661e00e5fb98525aee8c385860a89b887c",
  "operations/receipts/IMP-08-ST-1.json": "1d2a6482e1c69b4f560d9d83a15b36a336687c132d47d9129211a1767d9e251f",
  "operations/receipts/IMP-08-ST-2.json": "121eceafadd66b951c86c4a319b222c8780b8844d48941570b450f3f7abfb29d",
  "operations/receipts/IMP-08-ST-3.json": "4de9409501404e63c9ce0b0caaf7004176db46906ecc8fc4e13655d67a820110",
  "operations/receipts/IMP-08-ST-4.json": "43fe0b9b3dc145f42efadc64138f86f166cea33671e8e95d1eaa6b1aff889bf4",
  "operations/receipts/IMP-08-ST-5.json": "ee42418ed1f9bbb4e7d014e2aa109a242db426c8ca07081a84b37820f5efee71",
  "operations/audit/IMP-08/ST-08.5/manifest.json": "3cfe1efc19872838645e743bf6ec5177b9cac95b2ff95303bcb5bdf2eee5f209",
  "operations/audit/IMP-08/ST-08.4/dossier.tar.gz": "c264868bcd09af798b8343097f94832e8df3987b5c5c891ff09c46e4fef1f4af",
  "operations/audit/IMP-08/ST-08.3/manifest.json": "1d1e543edea87ec4c976b1f7c77906103c0c51dccdaa5045f20dde4a4f0c1b8e",
};

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const ST_DIR = "operations/audit/IMP-08/ST-08.6";
const RECEIPT = "operations/receipts/IMP-08-ST-6.json";
const errors = [];
const check = (condition, label) => { if (!condition) errors.push(label); };

const required = [
  `${ST_DIR}/parent-gate-verification.md`,
  `${ST_DIR}/parent-gate-inputs.json`,
  `${ST_DIR}/proposed-imp-receipt.json`,
  `${ST_DIR}/baseline-hashes.txt`,
  `${ST_DIR}/final-hashes.txt`,
  `${ST_DIR}/tests.tap`,
  `${ST_DIR}/verification.txt`,
  `${ST_DIR}/verify-delivery.mjs`,
  `${ST_DIR}/authority-guard.mjs`,
  `${ST_DIR}/authority-guard-probes.mjs`,
  `${ST_DIR}/authority-guard-probes.txt`,
  `${ST_DIR}/SHA256SUMS`,
  `${ST_DIR}/evidence-bundle.tar.gz`,
  RECEIPT,
];
for (const path of required) check(existsSync(resolve(root, path)), `missing ${path}`);

const inputs = readJson(`${ST_DIR}/parent-gate-inputs.json`);
const proposal = readJson(`${ST_DIR}/proposed-imp-receipt.json`);
const receipt = readJson(RECEIPT);

// --- 1. Proposed receipt must be non-authoritative ---------------------------------
check(proposal.receiptKind === "PROPOSED_IMP_RECEIPT", "proposal receiptKind is not PROPOSED_IMP_RECEIPT");
check(proposal._kind === "PROPOSED_IMP_RECEIPT", "proposal _kind is not exactly PROPOSED_IMP_RECEIPT");
check(proposal.outcome === "proposed", "proposal outcome is not 'proposed'");
check(proposal.acceptanceStatus === "NOT_ACCEPTED", "proposal acceptanceStatus is not NOT_ACCEPTED");
check(typeof proposal._authority === "string" && proposal._authority.includes("NON-AUTHORITATIVE"), "proposal lacks non-authoritative marker");
check(Array.isArray(proposal.claims) && proposal.claims.length === 0, "proposal claims must be empty");
check(proposal.parentAcceptancePending === true, "proposal must assert parentAcceptancePending=true");
check(!Object.prototype.hasOwnProperty.call(proposal, "acceptedAtUtc"), "proposal must omit acceptedAtUtc");
check(!existsSync(resolve(root, "operations/receipts/IMP-08-IMP_RECEIPT.json")), "accepted IMP-08-IMP_RECEIPT.json must not exist");
const forbidden = findAuthorityViolations(proposal);
check(forbidden.length === 0, `proposal contains acceptance/DEP authority violations: ${forbidden.join("; ")}`);
const probesOutput = readText(`${ST_DIR}/authority-guard-probes.txt`);
check(probesOutput.includes("RESULT PASS"), "authority guard negative probes did not record RESULT PASS");
check((probesOutput.match(/^PASS reject/gm) ?? []).length >= 38, "authority guard negative probes record fewer than 38 rejected cases");
check(probesOutput.includes("ST-08.6 lineage entry remains pending"), "authority guard probes do not assert the ST-08.6 lineage stays pending");
const st086Entry = (proposal.reviewerLineage ?? []).find((entry) => typeof entry.role === "string" && entry.role.includes("ST-08.6"));
check(st086Entry?.verdict === "pending", "proposal ST-08.6 lineage entry must remain pending");
const proposalText = JSON.stringify(proposal);
check(!proposalText.includes("DEP-13 is satisfied") && !proposalText.includes("DEP-13 closed"), "proposal must not claim DEP-13");

// --- 2. Parent-gate inputs identity and prerequisite checks ------------------------
check(proposal.specIdentity?.sha256 === inputs.specIdentity?.sha256, "spec hash mismatch between proposal and inputs");
check(inputs.specIdentity?.sha256 === PIN.spec, "inputs SPEC hash is not the canonical pin");
check(proposal.version?.contentHash === inputs.currentAcceptedSemanticVersion?.semanticHashAlgorithmC_sha256sumStyle, "proposal version does not match inputs current accepted version");
check(inputs.prerequisiteCheck?.projectON === true, "projectON prerequisite not satisfied");
check(inputs.prerequisiteCheck?.acceptedIMP01ExactScopeVersion === true, "IMP-01 prerequisite not satisfied");
check(inputs.prerequisiteCheck?.allRequiredChildrenReviewedAccepted === true, "children prerequisite not satisfied");
check(Array.isArray(inputs.parentGateCriteria) && inputs.parentGateCriteria.length >= 6, "parent-gate criteria incomplete");
check(Array.isArray(inputs.twentyFivePointOneRequirementMap) && inputs.twentyFivePointOneRequirementMap.length >= 15, "25.1 requirement map incomplete");
check(Array.isArray(inputs.claims) && inputs.claims.length === 0, "inputs claims must be empty");

// --- 3. Pinned inputs unchanged -----------------------------------------------------
for (const [path, hash] of Object.entries(PROTECTED_HASHES)) {
  check(hashFile(path) === hash, `protected pin drifted: ${path}`);
}
for (const entry of inputs.pinnedInputs ?? []) {
  check(hashFile(entry.path) === entry.sha256, `staged input drift: ${entry.path}`);
}
for (const entry of proposal.requiredStIdentities ?? []) {
  check(hashFile(entry.receiptPath) === entry.receiptSha256, `child receipt drift: ${entry.receiptPath}`);
}

// --- 4. Current accepted semantic version is reproducible --------------------------
const manifest = readJson("operations/audit/IMP-08/ST-08.5/manifest.json");
check(manifest.resultingVersion?.contentHash === PIN.semanticHashC, "ST-08.5 manifest contentHash is not the accepted value");
check(recomputeAlgorithmC() === PIN.semanticHashC, "recomputed algorithm-C semantic hash is not the accepted value");

// --- 4b. Source instance binding: protocol v1, SPEC/schema v1.1 distinct -------
check(proposal.objectProtocolVersion === "v1", `proposal objectProtocolVersion must be the source instance protocol v1, got ${proposal.objectProtocolVersion}`);
check(typeof proposal.scope === "string" && proposal.scope.includes("protocol v1"), "proposal scope must bind the protocol v1 instance");
check(!JSON.stringify(proposal).includes("protocol v1.1"), "proposal must not drift the instance protocol to v1.1");
check(receipt.packetSubtaskParentIdentity?.objectProtocolVersion === "v1", `ST receipt objectProtocolVersion must be protocol v1, got ${receipt.packetSubtaskParentIdentity?.objectProtocolVersion}`);
check(typeof receipt.packetSubtaskParentIdentity?.executionInstance === "string" && receipt.packetSubtaskParentIdentity.executionInstance.includes("protocol v1"), "ST receipt executionInstance must bind the protocol v1 instance");
check(receipt.packetSubtaskParentIdentity?.specVersion === "1.1", "ST receipt schema/SPEC version must remain 1.1 (distinct from protocol v1)");

// --- 5. This packet's ST_RECEIPT validates and links to its WORK-PACKET ------------
const packet = {
  packetId: "WP-IMP-08-ST-6-v1.1",
  project: "96bbd5b1-94da-4781-8c2b-455fdfb28d1a",
  spec: { id: "PROCUREMENT_RESEARCH_CANONICAL_ENGINEERING_SPEC_v1_1.md", version: "1.1", sha256: PIN.spec },
  parentImp: "IMP-08",
  subtaskId: "ST-08.6",
};
const receiptOutcome = validateStReceipt(receipt);
check(receiptOutcome.ok, `ST receipt validation failed: ${JSON.stringify(receiptOutcome.errors)}`);
const linkage = linkStReceiptToPacket(packet, receipt);
check(linkage.ok, `ST receipt linkage failed: ${JSON.stringify(linkage.errors)}`);
check(receipt.recommendedStatus === "in_review", "ST receipt recommendedStatus must be in_review");
check(receipt.workerRoute?.runId === receipt.receiptMeta?.writtenByRun, "ST receipt run identity mismatch");
check(receipt.review?.reviewerAgentId === "0af74a08-cb39-4cf5-a94f-117b242ea08c", "ST receipt reviewer must be the Independent Reviewer");
check(receipt.review?.authorReviewerDistinct === true, "author/reviewer must be distinct");
check((receipt.artifactsChanged ?? []).every((path) => !path.includes("IMP_RECEIPT")), "ST receipt must not touch IMP_RECEIPT paths");
check(!(receipt.artifactsChanged ?? []).includes("operations/receipts/IMP-08-IMP_RECEIPT.json"), "ST receipt must not create a parent IMP_RECEIPT");

// --- 6. SHA256SUMS covers the published payload ------------------------------------
const sumsPath = `${ST_DIR}/SHA256SUMS`;
const sums = parseSha256Sums(resolve(root, sumsPath));
check(sums.length >= 8, "SHA256SUMS has too few entries");
for (const { hash, path } of sums) check(hashFile(path) === hash, `SHA256SUMS mismatch: ${path}`);
for (const path of required) {
  if (path === sumsPath || path.endsWith("evidence-bundle.tar.gz") || path.endsWith("final-hashes.txt")) continue;
  check(sums.some((entry) => entry.path === path), `SHA256SUMS missing ${path}`);
}

if (errors.length > 0) {
  console.error(`verify-delivery: FAIL (${errors.length})`);
  for (const error of errors) console.error(`- ${error}`);
  process.exitCode = 1;
} else {
  console.log(`verify-delivery: PASS; pins=${Object.keys(PROTECTED_HASHES).length} unchanged; proposal=PROPOSED_IMP_RECEIPT/non-authoritative; claims=0; currentSemanticHash=${PIN.semanticHashC}; splitHash=${PIN.semanticHashA}; sha256sum entries=${sums.length}`);
}

function recomputeAlgorithmC() {
  const semanticPaths = [
    "src/economic-calculation/benchmark.mjs",
    "src/economic-calculation/bhv.mjs",
    "src/economic-calculation/index.mjs",
    "src/economic-calculation/reference.mjs",
    "src/economic-calculation/scoring.mjs",
    "test/economic-calculation/benchmark.test.mjs",
    "test/economic-calculation/bhv.test.mjs",
    "test/economic-calculation/scoring.test.mjs",
    "docs/economic-calculation.md",
  ].sort();
  return createHash("sha256").update(semanticPaths.map((path) => `${hashFile(path)}  ${path}\n`).join("")).digest("hex");
}

function parseSha256Sums(absolutePath) {
  const lines = readFileSync(absolutePath, "utf8").split("\n").filter((line) => /^[0-9a-f]{64}\s{2}/.test(line));
  return lines.map((line) => ({ hash: line.slice(0, 64), path: line.slice(66) }));
}

function readJson(relativePath) {
  try {
    return JSON.parse(readFileSync(resolve(root, relativePath), "utf8"));
  } catch (error) {
    errors.push(`${relativePath}: ${error.message}`);
    return {};
  }
}

function readText(relativePath) {
  try {
    return readFileSync(resolve(root, relativePath), "utf8");
  } catch (error) {
    errors.push(`${relativePath}: ${error.message}`);
    return "";
  }
}

function hashFile(relativePath) {
  try {
    return createHash("sha256").update(readFileSync(resolve(root, relativePath))).digest("hex");
  } catch (error) {
    errors.push(`${relativePath}: ${error.message}`);
    return null;
  }
}