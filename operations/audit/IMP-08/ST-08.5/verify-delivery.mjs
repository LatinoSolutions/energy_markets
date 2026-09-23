import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const manifestRelative = "operations/audit/IMP-08/ST-08.5/manifest.json";
const receiptRelative = "operations/receipts/IMP-08-ST-5.json";
const manifest = readJson(manifestRelative);
const receipt = readJson(receiptRelative);

const requiredArtifacts = [
  "src/economic-calculation/bhv.mjs",
  "test/economic-calculation/bhv.test.mjs",
  "operations/audit/IMP-08/ST-08.5/baseline-hashes.txt",
  "operations/audit/IMP-08/ST-08.5/final-hashes.txt",
  "operations/audit/IMP-08/ST-08.5/tests.tap",
  "operations/audit/IMP-08/ST-08.5/reproducer.txt",
  "operations/audit/IMP-08/ST-08.5/change-review.md",
  "operations/audit/IMP-08/ST-08.5/verify-delivery.mjs",
  "operations/audit/IMP-08/ST-08.5/verification.txt",
  "operations/audit/IMP-08/ST-08.5/continuity-checkpoint.md",
  receiptRelative,
];

const protectedHashes = {
  "docs/canonical/PROCUREMENT_RESEARCH_CANONICAL_ENGINEERING_SPEC_v1_1.md": "86c4bd4eeb5f9d0ebad94763128b221eb64525a2b7fff1007dab0af88b39cb6c",
  "operations/bootstrap/baseline-manifest.json": "895539b7312479a4350b7eeddf207c084090cf29abd391025dd763be00ca9860",
  "operations/receipts/IMP-01-IMP_RECEIPT.json": "78d92de81d8c480b7d96c7203fa2a0661e00e5fb98525aee8c385860a89b887c",
  "operations/receipts/IMP-08-ST-1.json": "1d2a6482e1c69b4f560d9d83a15b36a336687c132d47d9129211a1767d9e251f",
  "operations/audit/IMP-08/fixture-oracle/fixtures.json": "33fda538883a879b076cf1d4ef81cb7dd1468791599ea92c95f613d3ee7439ec",
  "operations/audit/IMP-08/fixture-oracle/independent-calculations.md": "58facba24c9df3ceb403e2a67423e905bfa89aa73d861a28d1aca0ea10b061e9",
  "operations/receipts/IMP-08-ST-2.json": "121eceafadd66b951c86c4a319b222c8780b8844d48941570b450f3f7abfb29d",
  "operations/receipts/IMP-08-ST-3.json": "4de9409501404e63c9ce0b0caaf7004176db46906ecc8fc4e13655d67a820110",
  "operations/audit/IMP-08/ST-08.3/manifest.json": "1d1e543edea87ec4c976b1f7c77906103c0c51dccdaa5045f20dde4a4f0c1b8e",
};

const errors = [];
check(manifest.packetId === "WP-IMP-08-ST-5-v1.1", "packetId");
check(manifest.subtaskId === "ST-08.5", "subtaskId");
check(manifest.parentImp === "IMP-08", "parentImp");
check(manifest.selfHashOmitted === manifestRelative, "selfHashOmitted");
check(Array.isArray(manifest.outsideAllowedPaths) && manifest.outsideAllowedPaths.length === 0, "outsideAllowedPaths");
check(manifest.writesOutsideAllowedPaths === 0, "writesOutsideAllowedPaths");

const entries = new Map((manifest.artifacts ?? []).map((artifact) => [artifact.path, artifact.sha256]));
check(entries.size === requiredArtifacts.length, `artifact count ${entries.size} expected ${requiredArtifacts.length}`);
for (const path of requiredArtifacts) {
  check(entries.has(path), `manifest missing ${path}`);
  if (entries.has(path)) check(hashFile(path) === entries.get(path), `artifact hash ${path}`);
}
for (const path of entries.keys()) check(requiredArtifacts.includes(path), `unexpected artifact ${path}`);

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
const semanticHash = createHash("sha256")
  .update(semanticPaths.map((path) => `${hashFile(path)}  ${path}\n`).join(""))
  .digest("hex");
check(manifest.resultingVersion?.contentHash === semanticHash, "semantic content hash");

for (const [path, expected] of Object.entries(protectedHashes)) {
  check(hashFile(path) === expected, `protected hash ${path}`);
}

const receiptIdentity = receipt.packetSubtaskParentIdentity ?? {};
check(receipt.receiptKind === "ST_RECEIPT", "receiptKind");
check(receiptIdentity.packetId === manifest.packetId, "receipt packet identity");
check(receiptIdentity.subtaskId === manifest.subtaskId, "receipt subtask identity");
check(receiptIdentity.parentImp === manifest.parentImp, "receipt parent identity");
check(receiptIdentity.specSha256 === protectedHashes["docs/canonical/PROCUREMENT_RESEARCH_CANONICAL_ENGINEERING_SPEC_v1_1.md"], "receipt SPEC hash");
check(receipt.recommendedStatus === "in_review", "receipt recommendedStatus");
check(receipt.workerRoute?.agentId === "6c548bcb-e6aa-43ea-9c6c-319497cbe6a9", "receipt worker agent");
check(receipt.workerRoute?.runId === receipt.receiptMeta?.writtenByRun, "receipt run identity");
check(receipt.review?.reviewerAgentId === "2b6bf987-6800-4d4c-a23a-d470a4bb0ea6", "receipt independent reviewer");
check(receipt.review?.authorReviewerDistinct === true, "author/reviewer distinct");
for (const path of requiredArtifacts) check(receipt.artifactsChanged?.includes(path), `receipt changed artifact ${path}`);
check(!receipt.artifactsChanged?.includes("operations/audit/IMP-08/ST-08.3/manifest.json"), "receipt does not rewrite ST-08.3");
check(!receipt.artifactsChanged?.some((path) => path.includes("IMP_RECEIPT")), "receipt does not produce parent IMP_RECEIPT");

if (errors.length > 0) {
  console.error(`verify-delivery: FAIL (${errors.length})`);
  for (const error of errors) console.error(`- ${error}`);
  process.exitCode = 1;
} else {
  console.log(`verify-delivery: PASS; artifacts=${entries.size}; protectedHashes=${Object.keys(protectedHashes).length} unchanged; semanticHash=${semanticHash}; receipt=in_review; reviewer=Astra`);
}

function readJson(relativePath) {
  try {
    return JSON.parse(readFileSync(resolve(root, relativePath), "utf8"));
  } catch (error) {
    errors.push(`${relativePath}: ${error.message}`);
    return {};
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

function check(condition, label) {
  if (!condition) errors.push(label);
}

for (const relativePath of requiredArtifacts) {
  try {
    if (!statSync(resolve(root, relativePath)).isFile()) errors.push(`${relativePath}: not a regular file`);
  } catch {
    // hashFile/readJson already records the missing path with context.
  }
}
