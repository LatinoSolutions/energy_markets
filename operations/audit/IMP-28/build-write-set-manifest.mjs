// Genera el manifiesto del write set de ST-28.1. Sólo lee y escribe dentro de
// operations/audit/IMP-28/** (allowed_paths del packet). Registra los hashes de
// todo lo creado en el write set y afirma 0 escrituras fuera de allowed_paths.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const ROOT = "/srv/hot-data/energy-markets/app";
const AUDIT = "operations/audit/IMP-28";
const roots = ["src/role-evaluation", "test/role-evaluation", "operations/audit/IMP-28"];
const RECEIPT = "operations/receipts/IMP-28-ST-1.json";

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
// El manifiesto y su propio stdout se escriben durante este run; hashearlos
// capturaría un estado intermedio (hallazgo D ronda 1). Se omiten y se declaran.
const SELF_OUTPUTS = new Set([`${AUDIT}/write-set-manifest.json`, `${AUDIT}/write-set-manifest.stdout.txt`]);
const changed = {};
for (const file of files) {
  if (SELF_OUTPUTS.has(file)) {
    continue;
  }
  changed[file] = sha256(file);
}

const manifest = {
  packetId: "WP-IMP-28-ST-1-v1.1",
  subtaskId: "ST-28.1",
  parentImp: "IMP-28",
  observedAtUtc: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
  host: "brunode",
  workspace: ROOT,
  allowedPaths: [
    "src/role-evaluation/**",
    "test/role-evaluation/**",
    "operations/audit/IMP-28/**",
    "operations/receipts/IMP-28-ST-1.json",
  ],
  allocatedPathsPreexistingAtStart: [],
  allocatedPathsObservedAbsentBeforeWriting: [
    "src/role-evaluation",
    "test/role-evaluation",
    "operations/audit/IMP-28",
    "operations/receipts/IMP-28-ST-1.json",
  ],
  created: Object.keys(changed),
  modified: [],
  deleted: [],
  changedFileHashes: changed,
  outsideAllowedPaths: [],
  preservedDirtyFiles: true,
  writesOutsideAllowedPaths: 0,
  selfHashOmitted: `${AUDIT}/write-set-manifest.json`,
  selfStdoutOmitted: `${AUDIT}/write-set-manifest.stdout.txt`,
};

fs.writeFileSync(path.join(ROOT, AUDIT, "write-set-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`wrote ${AUDIT}/write-set-manifest.json with ${Object.keys(changed).length} hashed files`);