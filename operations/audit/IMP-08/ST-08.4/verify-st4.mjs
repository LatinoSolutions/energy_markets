import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { linkStReceiptToPacket, validateStReceipt } from "../../../../src/contracts/identities.mjs";

const ROOT = "/srv/hot-data/energy-markets/app";
const AUDIT = "operations/audit/IMP-08/ST-08.4";
const PAYLOAD = `${AUDIT}/payload`;
const RECEIPT = "operations/receipts/IMP-08-ST-4.json";
const ARCHIVE = `${AUDIT}/dossier.tar.gz`;
const VERSION_BINDING = `${AUDIT}/version-binding.json`;

const PINS = {
  "docs/canonical/PROCUREMENT_RESEARCH_CANONICAL_ENGINEERING_SPEC_v1_1.md": "86c4bd4eeb5f9d0ebad94763128b221eb64525a2b7fff1007dab0af88b39cb6c",
  "operations/bootstrap/baseline-manifest.json": "895539b7312479a4350b7eeddf207c084090cf29abd391025dd763be00ca9860",
  "operations/receipts/IMP-01-IMP_RECEIPT.json": "78d92de81d8c480b7d96c7203fa2a0661e00e5fb98525aee8c385860a89b887c",
  "operations/receipts/IMP-08-ST-1.json": "1d2a6482e1c69b4f560d9d83a15b36a336687c132d47d9129211a1767d9e251f",
  "operations/receipts/IMP-08-ST-2.json": "121eceafadd66b951c86c4a319b222c8780b8844d48941570b450f3f7abfb29d",
  "operations/receipts/IMP-08-ST-3.json": "4de9409501404e63c9ce0b0caaf7004176db46906ecc8fc4e13655d67a820110",
  "operations/audit/IMP-08/ST-08.3/manifest.json": "1d1e543edea87ec4c976b1f7c77906103c0c51dccdaa5045f20dde4a4f0c1b8e",
  "operations/audit/IMP-08/fixture-oracle/fixtures.json": "33fda538883a879b076cf1d4ef81cb7dd1468791599ea92c95f613d3ee7439ec",
  "operations/audit/IMP-08/fixture-oracle/independent-calculations.md": "58facba24c9df3ceb403e2a67423e905bfa89aa73d861a28d1aca0ea10b061e9",
};
// Current accepted version = ST-08.5 (LAT-195 native approval f0d45fae).
const ACCEPTED = {
  reportedHashC: "bc0ce6adef42831da21c9339c6569018a8c6b03a587558372ace336d4f661528",
  aggregateA: "96e73ef9ce63aea6bd39934cebc17cdc656f3f0d9ef576700739e39afa914f6e",
  files: {
    "src/economic-calculation/bhv.mjs": "4cc204f9eef0e191228e032b0753e68a1f4782426bf76b1de1368e21ff686cdf",
    "test/economic-calculation/bhv.test.mjs": "b523f2d15bf326d8ee0d242ed1c496e5e3f1c1cb43f736f83453e3bb073c06c7",
  },
};
const ST083_HISTORY_AGGREGATE_A = "140c8128eec122c295ac5b19ca1636a59674b8ea9f6706a827e21ba2bb5fc6f2";

function sha256File(absolute) {
  return crypto.createHash("sha256").update(fs.readFileSync(absolute)).digest("hex");
}
function sha256Rel(relative) {
  return sha256File(path.join(ROOT, relative));
}
function readJson(relative) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, relative), "utf8"));
}
function walkFiles(relativeDir) {
  const absolute = path.join(ROOT, relativeDir);
  return fs.readdirSync(absolute, { withFileTypes: true }).flatMap((entry) => {
    const relative = path.join(relativeDir, entry.name);
    return entry.isDirectory() ? walkFiles(relative) : [relative];
  });
}
function assert(condition, message) {
  if (!condition) throw new Error(message);
}
function semanticFilesIn(relativeDir) {
  const out = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
      const rel = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(rel);
      else if (/(src\/economic-calculation\/.*\.mjs|test\/economic-calculation\/.*\.test\.mjs|docs\/economic-calculation\.md)$/.test(rel)) out.push(rel);
    }
  };
  walk(relativeDir);
  return out;
}
// Algorithm A: sorted '<path>\n<sha>\n'.
function aggregateA(pairs) {
  const lines = [...pairs].sort(([a], [b]) => a.localeCompare(b)).map(([file, hash]) => `${file}\n${hash}\n`).join("");
  return crypto.createHash("sha256").update(lines).digest("hex");
}
// Algorithm C: sorted '<sha>  <path>\n' (ST-08.5's convention).
function aggregateC(pairs) {
  const lines = [...pairs].sort(([a], [b]) => a.localeCompare(b)).map(([file, hash]) => `${hash}  ${file}\n`).join("");
  return crypto.createHash("sha256").update(lines).digest("hex");
}
function normalize(pairs, prefix) {
  return pairs.map(([file, hash]) => [file.replace(prefix, ""), hash]);
}
function payloadPathFor(repoRelative) {
  if (repoRelative === "docs/economic-calculation.md") return `${PAYLOAD}/accepted/code/docs/economic-calculation.md`;
  if (repoRelative.startsWith("src/") || repoRelative.startsWith("test/")) return `${PAYLOAD}/accepted/code/${repoRelative}`;
  throw new Error(`unmapped semantic path: ${repoRelative}`);
}

function verifyPayloadChecksums() {
  const lines = fs.readFileSync(path.join(ROOT, PAYLOAD, "SHA256SUMS"), "utf8").trim().split("\n");
  let checked = 0;
  for (const line of lines) {
    const match = line.match(/^([0-9a-f]{64})  (.+)$/);
    assert(match, `malformed SHA256SUMS line: ${line}`);
    const [, expected, relative] = match;
    const cleaned = relative.replace(/^\.\//, "");
    assert(cleaned !== "SHA256SUMS", "SHA256SUMS must not list itself");
    assert(sha256File(path.join(ROOT, PAYLOAD, cleaned)) === expected, `payload checksum mismatch: ${cleaned}`);
    checked += 1;
  }
  const onDisk = walkFiles(PAYLOAD).map((f) => path.relative(PAYLOAD, f)).filter((f) => f !== "SHA256SUMS").sort();
  assert(onDisk.length === checked, `SHA256SUMS covers ${checked} but payload has ${onDisk.length} files`);
  return checked;
}
function payloadAggregate() {
  const files = walkFiles(PAYLOAD).map((f) => path.relative(PAYLOAD, f)).filter((f) => f !== "SHA256SUMS").sort();
  const lines = files.map((f) => `${f}\n${sha256File(path.join(PAYLOAD, f))}\n`).join("");
  return { hash: crypto.createHash("sha256").update(lines).digest("hex"), count: files.length };
}

function verifyCurrentAccepted() {
  const binding = readJson(VERSION_BINDING);
  assert(binding.currentAcceptedVersion, "version binding lacks currentAcceptedVersion");
  assert(binding.currentAcceptedVersion.aggregateAlgorithmA === ACCEPTED.aggregateA, "binding A aggregate mismatch");
  assert(binding.currentAcceptedVersion.contentHashReportedByST085 === ACCEPTED.reportedHashC, "binding C hash mismatch");
  const liveFiles = [
    "docs/economic-calculation.md",
    ...walkFiles("src/economic-calculation").filter((f) => f.endsWith(".mjs")),
    ...walkFiles("test/economic-calculation").filter((f) => f.endsWith(".test.mjs")),
  ];
  const livePairs = liveFiles.map((f) => [f, sha256Rel(f)]);
  assert(aggregateA(livePairs) === ACCEPTED.aggregateA, "live algorithm-A aggregate mismatch");
  assert(aggregateC(livePairs) === ACCEPTED.reportedHashC, "live algorithm-C aggregate mismatch");
  for (const [file, expected] of Object.entries(ACCEPTED.files)) {
    assert(sha256Rel(file) === expected, `accepted file mismatch: ${file}`);
  }
  // Accepted payload copies must equal live accepted bytes.
  for (const [file, expected] of Object.entries(ACCEPTED.files)) {
    assert(sha256File(path.join(ROOT, payloadPathFor(file))) === expected, `accepted payload copy mismatch: ${file}`);
  }
}

function verifyHistory() {
  const st083Files = semanticFilesIn(`${PAYLOAD}/history/st-08.3/code`);
  assert(st083Files.length === 9, `expected 9 ST-08.3 semantic history files, found ${st083Files.length}`);
  const pairs = st083Files.map((f) => [f.replace(`${PAYLOAD}/history/st-08.3/code/`, ""), sha256File(path.join(ROOT, f))]);
  const agg = aggregateA(pairs);
  assert(agg === ST083_HISTORY_AGGREGATE_A, `ST-08.3 history aggregate ${agg} != ${ST083_HISTORY_AGGREGATE_A}`);
  return st083Files.length;
}

// ST-08.2 accepted hash role vs ST-08.3 baseline reference must stay distinct.
const ST082_ACCEPTED_A = "8d1ce8f29f8474379082df1b1b294dc1838ba753c2a6d1586b2136e2524416fe";
const ST082_ST083_BASELINE_REF = "8d1ce8f29f8474379082df8b1b294dc1838ba753c2a6d1586b2136e2524416fe";

function verifyLineageReconciliation() {
  const st082 = readJson("operations/receipts/IMP-08-ST-2.json");
  const artifactHashes = st082.resultingVersion.artifactHashes;
  const recomputed = aggregateA(Object.entries(artifactHashes));
  assert(recomputed === ST082_ACCEPTED_A, `accepted ST-08.2 recomputation ${recomputed} != ${ST082_ACCEPTED_A}`);
  assert(st082.resultingVersion.contentHash === ST082_ACCEPTED_A, "ST-08.2 receipt contentHash mismatch");

  const st083Manifest = readJson(`${PAYLOAD}/history/st-08.3/st-08.3/manifest.json`);
  assert(st083Manifest.baselineContentHash === ST082_ST083_BASELINE_REF, "ST-08.3 baseline reference mismatch");
  assert(ST082_ACCEPTED_A !== ST082_ST083_BASELINE_REF, "ST-08.2 hash roles were conflated");

  const binding = readJson(VERSION_BINDING);
  const st082Entry = binding.priorAcceptedVersions.find((v) => v.subtask === "ST-08.2");
  assert(st082Entry && st082Entry.acceptedAggregateAlgorithmA === ST082_ACCEPTED_A, "binding ST-08.2 accepted hash not reconciled");
  assert(Array.isArray(binding.historicalLineageDefects) && binding.historicalLineageDefects.length > 0, "binding lacks disclosed lineage defect");
  assert(binding.currentAcceptedVersion.nativeApproval.independentReviewRoute.includes("457cce45-8d57-4915-9968-95a11fc640b4"), "ST-08.5 approval source comment not cited");
  assert(fs.existsSync(path.join(PAYLOAD, "native-reviews/LAT-195--approval-comment.md")), "archived ST-08.5 approval comment missing");

  // Every completed LAT-191 changes_requested review must be archived and recorded.
  const completed = [
    ["56b79cc1-34c4-42df-b1db-0d560b5c622b", "LAT-191--review-r1-changes-requested.md"],
    ["a72d657d-b715-473a-b828-8dc988014676", "LAT-191--review-r2-changes-requested.md"],
    ["840c1bae-89ab-4de3-acfd-aa982c7a18d1", "LAT-191--review-r3-changes-requested.md"],
    ["bc0ded02-436e-47e6-babf-459dc838bae7", "LAT-191--review-r4-changes-requested.md"],
    ["3c00c32b-f3a2-461d-8dba-f590b388a211", "LAT-191--review-r5-changes-requested.md"],
  ];
  const receipt2 = readJson(RECEIPT);
  assert(receipt2.review.completedChangesRequestedRounds === completed.length, "receipt review-round count stale");
  for (const [commentId, file] of completed) {
    assert(fs.existsSync(path.join(PAYLOAD, "native-reviews", file)), `missing archived review: ${file}`);
    assert(receipt2.review.rounds.some((r) => r.commentId === commentId), `receipt omits completed review comment ${commentId}`);
  }
  const pending = receipt2.review.rounds.filter((r) => r.outcome === "pending");
  assert(pending.length === 1, "receipt must mark exactly one next review round pending");
  const lineage2 = readJson(`${AUDIT}/native-review-lineage.json`);
  assert(lineage2.lat191ReviewHistory && lineage2.lat191ReviewHistory.completedChangesRequestedRounds === completed.length, "lineage review history stale");
}

function verify() {
  const receipt = readJson(RECEIPT);
  for (const [file, expected] of Object.entries(PINS)) {
    assert(sha256Rel(file) === expected, `pin mismatch: ${file}`);
  }
  const packet = {
    packetId: "WP-IMP-08-ST-4-v1.1",
    project: "96bbd5b1-94da-4781-8c2b-455fdfb28d1a",
    spec: {
      id: "PROCUREMENT_RESEARCH_CANONICAL_ENGINEERING_SPEC_v1_1.md",
      version: "1.1",
      sha256: PINS["docs/canonical/PROCUREMENT_RESEARCH_CANONICAL_ENGINEERING_SPEC_v1_1.md"],
    },
    parentImp: "IMP-08",
    subtaskId: "ST-08.4",
  };
  const receiptOutcome = validateStReceipt(receipt);
  assert(receiptOutcome.ok, `ST_RECEIPT invalid: ${JSON.stringify(receiptOutcome.errors)}`);
  const linkageOutcome = linkStReceiptToPacket(packet, receipt);
  assert(linkageOutcome.ok, `ST_RECEIPT linkage invalid: ${JSON.stringify(linkageOutcome.errors)}`);

  const payloadFiles = verifyPayloadChecksums();
  const aggregate = payloadAggregate();
  assert(receipt.resultingVersion.contentHash === aggregate.hash, "receipt content hash is stale vs payload aggregate");
  verifyCurrentAccepted();
  const historyCount = verifyHistory();
  verifyLineageReconciliation();

  const archiveHash = sha256Rel(ARCHIVE);
  assert(archiveHash === receipt.resultingVersion.dossierArchive.sha256, "dossier archive hash mismatch");

  for (const artifact of receipt.evidenceProduced) {
    if (artifact === RECEIPT) continue;
    assert(fs.existsSync(path.join(ROOT, artifact)), `missing evidence: ${artifact}`);
  }

  console.log("verify-st4: PASS");
  console.log(`pins=${Object.keys(PINS).length} unchanged`);
  console.log(`receiptValidation=${receiptOutcome.ok}`);
  console.log(`receiptLinkage=${linkageOutcome.ok}`);
  console.log(`payloadFiles=${payloadFiles}`);
  console.log(`payloadAggregateContentHash=${aggregate.hash}`);
  console.log(`currentAcceptedST085_C=${ACCEPTED.reportedHashC} A=${ACCEPTED.aggregateA}`);
  console.log(`historyST083Files=${historyCount} aggregateA=${ST083_HISTORY_AGGREGATE_A}`);
  console.log(`dossierArchiveSha256=${archiveHash}`);
}

try {
  verify();
} catch (error) {
  console.error(`verify-st4: FAIL: ${error.message}`);
  process.exitCode = 1;
}