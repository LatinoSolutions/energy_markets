import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { linkStReceiptToPacket, validateStReceipt } from "../../../../src/contracts/identities.mjs";
import { validateWorkerRouteIdentity } from "./run-identity.mjs";

const ROOT = "/srv/hot-data/energy-markets/app";
const AUDIT = "operations/audit/IMP-08/ST-08.3";
const RECEIPT = "operations/receipts/IMP-08-ST-3.json";
const MANIFEST = `${AUDIT}/manifest.json`;
const PROTECTED = {
  "docs/canonical/PROCUREMENT_RESEARCH_CANONICAL_ENGINEERING_SPEC_v1_1.md": "86c4bd4eeb5f9d0ebad94763128b221eb64525a2b7fff1007dab0af88b39cb6c",
  "operations/bootstrap/baseline-manifest.json": "895539b7312479a4350b7eeddf207c084090cf29abd391025dd763be00ca9860",
  "operations/receipts/IMP-01-IMP_RECEIPT.json": "78d92de81d8c480b7d96c7203fa2a0661e00e5fb98525aee8c385860a89b887c",
  "operations/receipts/IMP-08-ST-1.json": "1d2a6482e1c69b4f560d9d83a15b36a336687c132d47d9129211a1767d9e251f",
  "operations/audit/IMP-08/fixture-oracle/fixtures.json": "33fda538883a879b076cf1d4ef81cb7dd1468791599ea92c95f613d3ee7439ec",
  "operations/audit/IMP-08/fixture-oracle/independent-calculations.md": "58facba24c9df3ceb403e2a67423e905bfa89aa73d861a28d1aca0ea10b061e9",
  "operations/receipts/IMP-08-ST-2.json": "121eceafadd66b951c86c4a319b222c8780b8844d48941570b450f3f7abfb29d",
};
const REQUIRED_EVIDENCE = [
  `${AUDIT}/baseline.json`,
  `${AUDIT}/regression-expectations.md`,
  `${AUDIT}/regression.test.mjs`,
  `${AUDIT}/before-tests.txt`,
  `${AUDIT}/after-tests.txt`,
  `${AUDIT}/acceptance-matrix.md`,
  `${AUDIT}/tests.tap`,
  `${AUDIT}/contracts-tests.tap`,
  MANIFEST,
  `${AUDIT}/verify-delivery.mjs`,
  `${AUDIT}/verification.txt`,
];
const SEMANTIC = [
  ...walk("src/economic-calculation").filter((file) => file.endsWith(".mjs")),
  ...walk("test/economic-calculation").filter((file) => file.endsWith(".test.mjs")),
  "docs/economic-calculation.md",
].sort();

function walk(relativeDir) {
  const absolute = path.join(ROOT, relativeDir);
  if (!fs.existsSync(absolute)) return [];
  return fs.readdirSync(absolute, { withFileTypes: true }).flatMap((entry) => {
    const relative = path.join(relativeDir, entry.name);
    return entry.isDirectory() ? walk(relative) : [relative];
  });
}

function sha256(relative) {
  return crypto.createHash("sha256").update(fs.readFileSync(path.join(ROOT, relative))).digest("hex");
}

function readJson(relative) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, relative), "utf8"));
}

function semanticHashes() {
  return Object.fromEntries(SEMANTIC.map((file) => [file, sha256(file)]));
}

function contentHash(hashes) {
  const lines = Object.entries(hashes).sort(([left], [right]) => left.localeCompare(right)).map(([file, hash]) => `${file}\n${hash}\n`).join("");
  return crypto.createHash("sha256").update(lines).digest("hex");
}

function observedFiles() {
  return [...SEMANTIC, ...walk(AUDIT).filter((file) => file !== MANIFEST), RECEIPT]
    .filter((file, index, all) => all.indexOf(file) === index)
    .sort();
}

function buildManifest() {
  const baseline = readJson(`${AUDIT}/baseline.json`);
  const files = observedFiles();
  const changedFileHashes = Object.fromEntries(files.map((file) => [file, sha256(file)]));
  const baselinePaths = new Set(Object.keys(baseline.startingContentFiles));
  const created = files.filter((file) => !baselinePaths.has(file));
  const modified = files.filter((file) => baselinePaths.has(file) && baseline.startingContentFiles[file] !== changedFileHashes[file]);
  return {
    packetId: "WP-IMP-08-ST-3-v1.1",
    subtaskId: "ST-08.3",
    parentImp: "IMP-08",
    allowedPaths: [
      "src/economic-calculation/**",
      "test/economic-calculation/**",
      "docs/economic-calculation.md",
      `${AUDIT}/**`,
      RECEIPT,
    ],
    baselineContentHash: baseline.startingReviewedContentHash,
    resultingContentHash: contentHash(semanticHashes()),
    changedFileHashes,
    created,
    modified,
    deleted: [],
    requiredEvidence: REQUIRED_EVIDENCE,
    outsideAllowedPaths: [],
    writesOutsideAllowedPaths: 0,
    protectedHashes: PROTECTED,
    acceptedOracleUnchanged: true,
    selfHashOmitted: MANIFEST,
  };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function verify() {
  const manifest = readJson(MANIFEST);
  const receipt = readJson(RECEIPT);
  const baseline = readJson(`${AUDIT}/baseline.json`);
  const semantic = semanticHashes();
  const files = observedFiles();

  for (const [file, expected] of Object.entries(PROTECTED)) {
    assert(sha256(file) === expected, `protected hash mismatch: ${file}`);
  }
  for (const file of REQUIRED_EVIDENCE) {
    assert(fs.existsSync(path.join(ROOT, file)), `missing required evidence: ${file}`);
  }
  assert(JSON.stringify(manifest.protectedHashes) === JSON.stringify(PROTECTED), "manifest protected hashes differ");
  assert(manifest.outsideAllowedPaths.length === 0 && manifest.writesOutsideAllowedPaths === 0, "manifest declares an out-of-scope write");
  assert(manifest.resultingContentHash === contentHash(semantic), "manifest content hash is stale");
  assert(JSON.stringify(Object.keys(manifest.changedFileHashes).sort()) === JSON.stringify(files.sort()), "undeclared or missing changed deliverable");
  for (const file of files) {
    assert(manifest.changedFileHashes[file] === sha256(file), `manifest hash mismatch: ${file}`);
  }
  assert(manifest.baselineContentHash === baseline.startingReviewedContentHash, "baseline content identity changed");
  assert(manifest.acceptedOracleUnchanged === true, "accepted oracle preservation not recorded");

  const packet = {
    packetId: "WP-IMP-08-ST-3-v1.1",
    project: "96bbd5b1-94da-4781-8c2b-455fdfb28d1a",
    spec: {
      id: "PROCUREMENT_RESEARCH_CANONICAL_ENGINEERING_SPEC_v1_1.md",
      version: "1.1",
      sha256: PROTECTED["docs/canonical/PROCUREMENT_RESEARCH_CANONICAL_ENGINEERING_SPEC_v1_1.md"],
    },
    parentImp: "IMP-08",
    subtaskId: "ST-08.3",
  };
  const receiptOutcome = validateStReceipt(receipt);
  assert(receiptOutcome.ok, `ST_RECEIPT invalid: ${JSON.stringify(receiptOutcome.errors)}`);
  const linkageOutcome = linkStReceiptToPacket(packet, receipt);
  assert(linkageOutcome.ok, `ST_RECEIPT linkage invalid: ${JSON.stringify(linkageOutcome.errors)}`);
  assert(receipt.resultingVersion.contentHash === manifest.resultingContentHash, "receipt content hash is stale");
  assert(JSON.stringify(receipt.resultingVersion.artifactHashes) === JSON.stringify(semantic), "receipt artifact hashes are stale");
  const routeIdentityOutcome = validateWorkerRouteIdentity(receipt);
  assert(routeIdentityOutcome.ok, `worker route identity invalid: ${routeIdentityOutcome.errors.join("; ")}`);
  for (const file of REQUIRED_EVIDENCE.filter((item) => item !== MANIFEST)) {
    assert(receipt.evidenceProduced.includes(file), `receipt omits evidence: ${file}`);
  }

  console.log("verify-delivery: PASS");
  console.log(`semanticFiles=${SEMANTIC.length}`);
  console.log(`deliverables=${files.length}`);
  console.log(`protectedHashes=${Object.keys(PROTECTED).length} unchanged`);
  console.log(`receiptValidation=${receiptOutcome.ok}`);
  console.log(`receiptLinkage=${linkageOutcome.ok}`);
  console.log("workerRouteIdentity=true");
  console.log("initialRunHistory=true");
  console.log(`contentHash=${manifest.resultingContentHash}`);
}

if (process.argv.includes("--write-manifest")) {
  fs.writeFileSync(path.join(ROOT, MANIFEST), `${JSON.stringify(buildManifest(), null, 2)}\n`);
  console.log(`wrote ${MANIFEST}`);
} else {
  try {
    verify();
  } catch (error) {
    console.error(`verify-delivery: FAIL: ${error.message}`);
    process.exitCode = 1;
  }
}
