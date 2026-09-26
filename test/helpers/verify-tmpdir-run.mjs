// Run test files in a private tmpdir, then check it after every test process
// has exited. This catches unregistered directories as well as marker leaks.
// Usage: node test/helpers/verify-tmpdir-run.mjs [test files...]
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

function allTestFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const name = path.join(dir, entry.name);
    if (entry.isDirectory()) return allTestFiles(name);
    return entry.isFile() && name.endsWith(".test.mjs") ? [name] : [];
  });
}

export function verifyTempDirRun(files, { output = "inherit" } = {}) {
  const root = mkdtempSync(path.join(tmpdir(), "em-test-run-"));
  let status = 1;
  try {
    const env = { ...process.env, TMPDIR: root, TMP: root, TEMP: root };
    // A verifier invoked by a test must start a new runner, rather than
    // inherit Node's worker context and silently skip the supplied files.
    delete env.NODE_TEST_CONTEXT;
    const child = spawnSync(process.execPath, ["--test", ...files], {
      env,
      stdio: output,
    });
    status = child.status ?? 1;
    if (child.error) process.stderr.write(`[FIX-05] no se pudo lanzar la suite: ${child.error.message}\n`);

    const leftovers = readdirSync(root).filter((name) => {
      // The helper may leave its empty registry directory. A marker within it
      // is a leftover and must still fail the run.
      if (name === "em-test-tmpdir-registry") {
        return readdirSync(path.join(root, name)).length > 0;
      }
      return true;
    });
    if (leftovers.length > 0) {
      process.stderr.write(`[FIX-05] la corrida dejó entradas en tmpdir: ${leftovers.join(", ")}\n`);
      status = 1;
    } else {
      process.stderr.write("[FIX-05] verificación posterior: tmpdir sin remanentes\n");
    }
  } finally {
    // This directory belongs exclusively to this run, including any fixture
    // that intentionally leaks while testing the guard.
    rmSync(root, { recursive: true, force: true });
  }
  return status;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const files = process.argv.slice(2);
  process.exitCode = verifyTempDirRun(files.length ? files : allTestFiles(path.resolve("test")));
}
