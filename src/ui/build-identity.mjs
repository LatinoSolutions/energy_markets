// SEM-2 · identidad del build servido. Se captura UNA vez, cuando arranca el
// proceso, desde el código cargado; no se lee el HEAD nuevo del checkout en cada
// request (acceptance SEM2-10, audit CS-04). Un checkout que cambia detrás del
// proceso no reescribe lo que el servicio declara que está corriendo.
import { execFileSync } from "node:child_process";

function git(repoRoot, args) {
  try {
    return execFileSync("git", args, { cwd: repoRoot, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return null;
  }
}

// Captura commit y estado sucio del código. Sin git legible el commit queda null
// (no se inventa uno); `dirty` igual: null es "no se pudo determinar", no false.
export function captureBuildIdentity(repoRoot) {
  const commit = git(repoRoot, ["rev-parse", "--verify", "HEAD"]);
  const dirty = git(repoRoot, ["status", "--porcelain", "--untracked-files=no", "--", "src"]);
  return Object.freeze({
    service: "energy-markets-operator-ui",
    commit: /^[0-9a-f]{40}$/.test(commit ?? "") ? commit : null,
    dirty: dirty === null ? null : dirty.length > 0,
    capturedAt: new Date().toISOString(),
  });
}

// Identidad de build sin repositorio (tests o serving programático): se declara
// explícitamente desconocida en vez de aparentar un commit.
export function unknownBuildIdentity() {
  return Object.freeze({ service: "energy-markets-operator-ui", commit: null, dirty: null, capturedAt: null });
}
