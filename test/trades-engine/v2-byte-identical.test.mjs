// TR-05: el control TOB (release exploratorio v2) queda intacto. Este test
// recomputa el sha256 de cada generador/artifact declarado en el MANIFEST
// commiteado de v2 y comprueba que `src/exploratory/backtest.mjs` y
// `src/exploratory/comparison.mjs` no fueron editados (TRADES_MODE_PLAN.md
// TR-05: "Control TOB = release v2 intacto (test byte-idéntico)"; §Non-negotiable
// semantics: los dos archivos NO se editan).

import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const MANIFEST = "operations/exploratory/v2/MANIFEST.json";
const sha256Of = (bytes) => createHash("sha256").update(bytes).digest("hex");

function manifest() {
  return JSON.parse(readFileSync(path.join(REPO_ROOT, MANIFEST), "utf8"));
}

test("v2: cada artifact y generador declarado coincide byte a byte con su sha256", () => {
  const doc = manifest();
  const entries = [doc.results, doc.slots, ...(doc.generators ?? [])];
  for (const entry of entries) {
    const bytes = readFileSync(path.join(REPO_ROOT, entry.path));
    assert.equal(sha256Of(bytes), entry.sha256, `${entry.path} no coincide con el manifest de v2`);
  }
});

test("v2: backtest.mjs y comparison.mjs del release TOB no fueron editados", () => {
  const doc = manifest();
  const pinned = Object.fromEntries((doc.generators ?? []).map((entry) => [entry.path, entry.sha256]));
  for (const file of ["src/exploratory/backtest.mjs", "src/exploratory/comparison.mjs"]) {
    const bytes = readFileSync(path.join(REPO_ROOT, file));
    assert.equal(sha256Of(bytes), pinned[file], `${file} fue editado; el control TOB debe quedar intacto`);
  }
});

test("v2: los resultados siguen atados al sha256 de los slots del manifest", () => {
  const doc = manifest();
  const results = JSON.parse(readFileSync(path.join(REPO_ROOT, doc.results.path), "utf8"));
  assert.equal(results.inputs?.slots?.sha256, doc.slots.sha256);
});
