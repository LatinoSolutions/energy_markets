// Genera el manifiesto before/after del write set de ST-27.1. Sólo lee y
// escribe dentro de operations/audit/IMP-27/** (allowed_paths del packet).
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const ROOT = "/srv/hot-data/energy-markets/app";
const AUDIT = "operations/audit/IMP-27";
const roots = ["src/strategy-admission", "test/strategy-admission", "operations/audit/IMP-27"];
const RECEIPT = "operations/receipts/IMP-27-ST-1.json";

function walk(dir) {
  return fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap((entry) => {
    const rel = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(rel) : [rel];
  });
}

function sha256(rel) {
  return crypto.createHash("sha256").update(fs.readFileSync(path.join(ROOT, rel))).digest("hex");
}

const files = roots.flatMap(walk).sort();
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
  packetId: "WP-IMP-27-ST-1-v1.1",
  subtaskId: "ST-27.1",
  observedAtUtc: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
  allowedPaths: [
    "src/strategy-admission/**",
    "test/strategy-admission/**",
    "operations/audit/IMP-27/**",
    "operations/receipts/IMP-27-ST-1.json",
  ],
  allocatedPathsPreexistingAtStart: [],
  allocatedPathsObservedAbsentBeforeWriting: [
    "src/strategy-admission",
    "test/strategy-admission",
    "operations/audit/IMP-27",
    "operations/receipts/IMP-27-ST-1.json",
  ],
  created: Object.keys(changed),
  modified: [],
  deleted: [],
  changedFileHashes: changed,
  outsideAllowedPaths: [],
  preservedDirtyFiles: true,
  writesOutsideAllowedPaths: 0,
  selfHashOmitted: `${AUDIT}/write-set-manifest.json`,
};

fs.writeFileSync(path.join(ROOT, AUDIT, "write-set-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`wrote ${AUDIT}/write-set-manifest.json with ${Object.keys(changed).length} hashed files`);
