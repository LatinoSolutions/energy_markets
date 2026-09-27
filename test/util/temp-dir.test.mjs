import assert from "node:assert/strict";
import { existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { mkdtempWithFallback } from "../../src/util/temp-dir.mjs";

test("FIX-04: los temporales usan el respaldo cuando la ubicación preferida no existe", () => {
  const preferred = join(tmpdir(), `energy-markets-missing-${process.pid}`);
  assert.equal(existsSync(preferred), false);
  const directory = mkdtempWithFallback("energy-markets-fallback-", { preferred, fallback: "/var/tmp" });
  try {
    assert.equal(directory.startsWith("/var/tmp/energy-markets-fallback-"), true);
    assert.equal(existsSync(directory), true);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
