import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// BT04-V1-GENERATOR-PROVENANCE (2026-09-25): each exploratory version keeps its
// own generators, so v1 (accepted) and v2 stay reproducible side by side and
// every hash in each MANIFEST.json matches the bytes on disk.
const root = resolve(import.meta.dirname, "../..");
const sha256 = (path) => createHash("sha256").update(readFileSync(resolve(root, path))).digest("hex");

for (const [version, manifestPath] of [["v1", "operations/exploratory/MANIFEST.json"], ["v2", "operations/exploratory/v2/MANIFEST.json"]]) {
  test(`exploratory ${version} manifest: results, slots and generators match the files on disk`, () => {
    const manifest = JSON.parse(readFileSync(resolve(root, manifestPath), "utf8"));
    for (const entry of [manifest.results, manifest.slots, ...manifest.generators]) {
      assert.equal(sha256(entry.path), entry.sha256, entry.path);
    }
  });
}

test("v1 and v2 name different TOB slot / backtest generators", () => {
  const generatorPaths = (manifestPath) => JSON.parse(readFileSync(resolve(root, manifestPath), "utf8")).generators.map((entry) => entry.path);
  const v1 = generatorPaths("operations/exploratory/MANIFEST.json");
  const v2 = generatorPaths("operations/exploratory/v2/MANIFEST.json");
  assert.ok(v1.includes("operations/exploratory/build_tob_slots.py"));
  assert.ok(v2.includes("operations/exploratory/v2/build_tob_slots.py"));
  assert.ok(v2.includes("operations/exploratory/v2/run-exploratory-backtest.mjs"));
});

// BT04-V2-RESULTS-STALE-MANIFEST-TEXT (2026-09-25): the "Code pinned" check shown
// in the UI must name the manifest that actually pins that version's generators.
for (const [version, resultsPath, manifestPath] of [
  ["v1", "operations/exploratory/backtest-results.json", "operations/exploratory/MANIFEST.json"],
  ["v2", "operations/exploratory/v2/backtest-results.json", "operations/exploratory/v2/MANIFEST.json"],
]) {
  test(`exploratory ${version}: the "Code pinned" integrity check names its own manifest`, () => {
    const results = JSON.parse(readFileSync(resolve(root, resultsPath), "utf8"));
    const codePinned = results.research.integrity.find((check) => check.label === "Code pinned");
    assert.equal(codePinned.detail, `generator sha256 in ${manifestPath}`);
  });
}
