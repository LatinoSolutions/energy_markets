// Repo mínimo para los tests de BT-05. El generador es un doble pequeño con la
// misma interfaz que el generador de la release vigente (EXPLORATORY_ENTRY: argv
// <slots> <salida>, escribe resultados + MANIFEST junto a la salida): los
// tests nunca corren el backtest real (nota BT-05 en PLAN_STATUS).
// Es un repo git con commit: el commit forma parte de la identidad del run.

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { createTempDir } from "../helpers/tmpdir.mjs";
import path from "node:path";

import { EXPLORATORY_ENTRY, EXPLORATORY_MANIFEST_PATH, EXPLORATORY_OUTPUT } from "../../src/backtest-jobs/index.mjs";

const RELEASE_DIR = path.posix.dirname(EXPLORATORY_MANIFEST_PATH);
const SRC_FROM_ENTRY = path.posix.relative(path.posix.dirname(EXPLORATORY_ENTRY), "src");

const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");

const FAKE_GENERATOR = `import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describeFixture } from "${SRC_FROM_ENTRY}/exploratory/fixture-lib.mjs";

const [slotsPath, outPath] = process.argv.slice(2);
const slotsBytes = readFileSync(slotsPath);
const slots = JSON.parse(slotsBytes);
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
if (slots.mode === "fail") {
  console.error("fixture: fallo forzado");
  process.exit(3);
}
if (slots.mode === "slow") {
  await new Promise((resolve) => setTimeout(resolve, 600));
}
if (slots.mode === "hang") {
  await new Promise((resolve) => setTimeout(resolve, 60000));
}
const output = { artifactKind: "EXPLORATORY_BACKTEST_RESULTS", status: "EXPLORATORY", inputs: { slots: { path: slotsPath, sha256: sha(slotsBytes) } }, fixture: describeFixture(slots) };
const outputBytes = Buffer.from(JSON.stringify(output, null, 1));
// "escape": declara resultados fuera del workspace (OPS-01, no deben copiarse a output/).
const resultsPath = slots.mode === "escape" ? "../escaped-results.json" : outPath;
writeFileSync(resultsPath, outputBytes);
const manifest = {
  artifactKind: "EXPLORATORY_BACKTEST_MANIFEST",
  status: "EXPLORATORY",
  results: { path: resultsPath, sha256: sha(outputBytes) },
  slots: output.inputs.slots,
  generators: [${JSON.stringify(EXPLORATORY_ENTRY)}, "src/exploratory/fixture-lib.mjs"].map((path) => ({ path, sha256: sha(readFileSync(path)) })),
};
writeFileSync(join(dirname(outPath), "MANIFEST.json"), JSON.stringify(manifest, null, 1));
`;

// fixture-helper es una dependencia transitiva que el manifest NO fija, como
// src/sizing-controller en el generador real (hallazgo BT05-IDENTITY-08).
const FIXTURE_LIB = `import { HELPER_LABEL } from "./fixture-helper.mjs";

export function describeFixture(slots) {
  return { mode: slots.mode, points: Array.isArray(slots.points) ? slots.points.length : 0, helper: HELPER_LABEL };
}
`;

export const FIXTURE_HELPER_PATH = "src/exploratory/fixture-helper.mjs";
export const fixtureHelperSource = (label) => `export const HELPER_LABEL = ${JSON.stringify(label)};\n`;
export const COMMITTED_HELPER_LABEL = "committed";

export const SLOTS_PATH = `${RELEASE_DIR}/tob-slots-the-gas.json`;

// Resultado que produce el doble para unos slots dados (mismo JSON que escribe).
function expectedResultsBytes(slotsBytes, slots) {
  const output = { artifactKind: "EXPLORATORY_BACKTEST_RESULTS", status: "EXPLORATORY", inputs: { slots: { path: SLOTS_PATH, sha256: sha(slotsBytes) } }, fixture: { mode: slots.mode, points: Array.isArray(slots.points) ? slots.points.length : 0, helper: COMMITTED_HELPER_LABEL } };
  return Buffer.from(JSON.stringify(output, null, 1));
}

export function makeFixtureRepo({ mode = "ok", committedResultsSha256 = null, committedResultsPath = EXPLORATORY_OUTPUT } = {}) {
  const root = createTempDir("bt05-repo-");
  const write = (relative, content) => {
    const target = path.join(root, relative);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, content);
    return readFileSync(target);
  };
  const slots = { mode, points: [1, 2, 3] };
  const slotsBytes = write(SLOTS_PATH, JSON.stringify(slots));
  const generatorBytes = write(EXPLORATORY_ENTRY, FAKE_GENERATOR);
  const libBytes = write("src/exploratory/fixture-lib.mjs", FIXTURE_LIB);
  write(FIXTURE_HELPER_PATH, fixtureHelperSource(COMMITTED_HELPER_LABEL));
  write("operations/audit/IMP-09/eex-exchange-calendar.json", JSON.stringify({ exchangeDays: ["2025-09-01"] }));
  const manifest = {
    artifactKind: "EXPLORATORY_BACKTEST_MANIFEST",
    status: "EXPLORATORY",
    results: { path: committedResultsPath, sha256: committedResultsSha256 ?? sha(expectedResultsBytes(slotsBytes, slots)) },
    slots: { path: SLOTS_PATH, sha256: sha(slotsBytes) },
    generators: [
      { path: EXPLORATORY_ENTRY, sha256: sha(generatorBytes) },
      { path: "src/exploratory/fixture-lib.mjs", sha256: sha(libBytes) },
    ],
  };
  const manifestBytes = write(EXPLORATORY_MANIFEST_PATH, JSON.stringify(manifest, null, 1));
  // Los runs quedan fuera del árbol que identifica el código.
  write(".gitignore", "operations/backtest-runs/\n");
  const git = (...args) => execFileSync("git", ["-c", "user.name=bt05", "-c", "user.email=bt05@test", ...args], { cwd: root, stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
  git("init", "-q", "-b", "main");
  const commitAll = (message) => {
    git("add", "-A");
    git("commit", "-q", "-m", message);
    return git("rev-parse", "HEAD");
  };
  commitAll("fixture");
  return { root, manifest, manifestSha256: sha(manifestBytes), write, commitAll, git, head: () => git("rev-parse", "HEAD") };
}
