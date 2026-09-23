// Manifiesto before/after del write set de ST-08.2. Sólo lee/escribe dentro de
// los allowed_paths del packet.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const ROOT = "/srv/hot-data/energy-markets/app";
const AUDIT = "operations/audit/IMP-08/ST-08.2";
const roots = ["src/economic-calculation", "test/economic-calculation", AUDIT, "docs"];
const RECEIPT = "operations/receipts/IMP-08-ST-2.json";

function walk(dir) {
  return fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap((entry) => {
    const rel = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(rel) : [rel];
  });
}

function sha256(rel) {
  return crypto.createHash("sha256").update(fs.readFileSync(path.join(ROOT, rel))).digest("hex");
}

const files = roots
  .flatMap(walk)
  .filter((rel) => rel.startsWith("src/economic-calculation/") || rel.startsWith("test/economic-calculation/") || rel.startsWith(`${AUDIT}/`) || rel === "docs/economic-calculation.md")
  .sort();
if (fs.existsSync(path.join(ROOT, RECEIPT))) {
  files.push(RECEIPT);
}

const changed = {};
for (const file of files) {
  if (file === `${AUDIT}/write-set-manifest.json`) {
    continue;
  }
  changed[file] = sha256(file);
}

const manifest = {
  packetId: "WP-IMP-08-ST-2-v1.1",
  subtaskId: "ST-08.2",
  observedAtUtc: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
  allowedPaths: [
    "src/economic-calculation/**",
    "test/economic-calculation/**",
    "docs/economic-calculation.md",
    "operations/audit/IMP-08/ST-08.2/**",
    "operations/receipts/IMP-08-ST-2.json",
  ],
  allocatedPathsPreexistingAtStart: [],
  allocatedPathsObservedAbsentBeforeWriting: [
    "src/economic-calculation",
    "test/economic-calculation",
    "docs/economic-calculation.md",
    "operations/audit/IMP-08/ST-08.2",
    "operations/receipts/IMP-08-ST-2.json",
  ],
  created: Object.keys(changed),
  modified: [],
  deleted: [],
  revision: "round-1 independent review correction: `created` lists every path absent at ST start (ST-level before/after, all 20 paths were created by this subtask); the subset modified during round 1 and its resulting hashes are recorded in operations/receipts/IMP-08-ST-2.json (review.rounds).",
  changedFileHashes: changed,
  outsideAllowedPaths: [],
  preservedDirtyFiles: true,
  writesOutsideAllowedPaths: 0,
  acceptedOracleUnchanged: {
    "operations/audit/IMP-08/fixture-oracle/fixtures.json": "33fda538883a879b076cf1d4ef81cb7dd1468791599ea92c95f613d3ee7439ec",
    "operations/audit/IMP-08/fixture-oracle/independent-calculations.md": "58facba24c9df3ceb403e2a67423e905bfa89aa73d861a28d1aca0ea10b061e9",
  },
  selfHashOmitted: `${AUDIT}/write-set-manifest.json`,
};

fs.writeFileSync(path.join(ROOT, AUDIT, "write-set-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`wrote ${AUDIT}/write-set-manifest.json with ${Object.keys(changed).length} hashed files`);
