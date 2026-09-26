// Fixtures de DATA-01: scripts de job chicos que nunca tocan datos reales. Cada
// test corre la cola con estos pasos, no con los jobs reales del pipeline.

import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { createTempDir } from "../helpers/tmpdir.mjs";
import path from "node:path";

// Uso: node fixture-job.mjs <outPath> <mode> [marker]
//   ok          escribe el artefacto y sale 0
//   fail        escribe stderr y sale 3
//   hang        duerme 60 s
//   no-artifact sale 0 sin escribir el artefacto (para probar STEP_ARTIFACT_MISSING)
export const FIXTURE_JOB_SOURCE = `import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const [outPath, mode, marker = "fixture"] = process.argv.slice(2);
const absolute = path.resolve(outPath);
if (mode === "fail") {
  process.stderr.write("fixture: fallo forzado\\n");
  process.exit(3);
}
if (mode === "hang") {
  await new Promise((resolve) => setTimeout(resolve, 60000));
}
if (mode !== "no-artifact") {
  mkdirSync(path.dirname(absolute), { recursive: true });
  writeFileSync(absolute, JSON.stringify({ marker, mode, at: new Date().toISOString() }));
}
if (process.env.FIXTURE_COUNTER) appendFileSync(process.env.FIXTURE_COUNTER, marker + "\\n");
`;

export function makeDataFixtureRepo() {
  const root = createTempDir("data01-repo-");
  const fixture = path.join(root, "fixture-job.mjs");
  writeFileSync(fixture, FIXTURE_JOB_SOURCE);
  const counter = path.join(root, "counter.log");
  return {
    root,
    fixture,
    counter,
    runsDir: path.join(root, "operations/data-runs"),
    step: (jobKind, outPath, mode = "ok", extra = {}) => ({
      jobKind,
      command: [process.execPath, fixture, outPath, mode, jobKind],
      env: { FIXTURE_COUNTER: counter },
      memoryMaxBytes: 64 * 1024 * 1024,
      timeoutMs: 5000,
      publishes: mode === "no-artifact" ? [outPath] : [outPath],
      ...extra,
    }),
    write: (relative, content) => {
      const target = path.join(root, relative);
      mkdirSync(path.dirname(target), { recursive: true });
      writeFileSync(target, content);
    },
    readCounter: () => {
      try {
        return readFileSync(counter, "utf8").split("\n").filter((line) => line.length > 0);
      } catch {
        return [];
      }
    },
  };
}

export const CHECKSUM_OK_TRIGGER = Object.freeze({
  kind: "CHECKSUM_OK",
  event: { at: "2026-09-25T23:31:00Z", verdict: "OK", sha256: "c0b8389dd2eae768e0144ebffa2eb8c557c1407ec8bbccb014c0ecdee075cdd3", lineNumber: 3, line: "2026-09-25T23:31:00Z CHECKSUM OK c0b8389dd2eae768e0144ebffa2eb8c557c1407ec8bbccb014c0ecdee075cdd3" },
  expectedSha256: "c0b8389dd2eae768e0144ebffa2eb8c557c1407ec8bbccb014c0ecdee075cdd3",
});
