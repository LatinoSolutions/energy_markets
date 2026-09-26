// Test fixtures live in one directory per test worker. The host's /tmp can run
// out of inodes while another filesystem still has room; honor TMPDIR first,
// then use /var/tmp when the preferred location cannot hold the suite.
import { rmSync } from "node:fs";
import { mkdtempWithFallback } from "../../src/util/temp-dir.mjs";

let workerRoot;

export function tmpdir() {
  if (workerRoot) return workerRoot;
  workerRoot = mkdtempWithFallback("energy-markets-test-");
  process.once("exit", () => rmSync(workerRoot, { recursive: true, force: true }));
  return workerRoot;
}
