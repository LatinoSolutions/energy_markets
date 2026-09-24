import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import {
  CANONICAL_SPEC_PATH,
  CANONICAL_SPEC_IDENTITY,
  hashSpecBytes,
  specIdentityMismatches,
  verifyCanonicalSpec,
} from "../../src/office/spec-binding.mjs";
import { SPEC_DOC_PATH, SPEC_MARKDOWN } from "./fixtures.mjs";

test("la identidad canónica coincide con los bytes reales del doc v1.1.1 (binding de contenido)", () => {
  const bytes = readFileSync(SPEC_DOC_PATH);
  assert.equal(hashSpecBytes(bytes), CANONICAL_SPEC_IDENTITY.sha256);
  assert.equal(CANONICAL_SPEC_PATH, "docs/canonical/v1_1_1/PROCUREMENT_RESEARCH_CANONICAL_ENGINEERING_SPEC_v1_1_1.md");
});

test("verifyCanonicalSpec acepta el doc vigente y rechaza una SPEC mutada (fail-closed)", () => {
  const bytes = readFileSync(SPEC_DOC_PATH);
  assert.equal(verifyCanonicalSpec({ bytes }).ok, true);
  const mutated = Buffer.from(`${SPEC_MARKDOWN}\nmutación no autorizada\n`);
  const outcome = verifyCanonicalSpec({ bytes: mutated });
  assert.equal(outcome.ok, false);
  assert.equal(outcome.code, "SPEC_SOURCE_MISMATCH");
});

test("specIdentityMismatches nombra cada campo divergente sin inventar el resto", () => {
  assert.deepEqual(specIdentityMismatches({ ...CANONICAL_SPEC_IDENTITY }), []);
  assert.deepEqual(specIdentityMismatches({ ...CANONICAL_SPEC_IDENTITY, version: "1.1" }), ["version"]);
  assert.deepEqual(
    specIdentityMismatches({ id: "otra.md", version: "1.0", sha256: "0".repeat(64) }),
    ["id", "version", "sha256"],
  );
  assert.deepEqual(specIdentityMismatches(null), ["identity"]);
});

test("verifyCanonicalSpec rechaza una identidad sin forma válida", () => {
  const outcome = verifyCanonicalSpec({ bytes: SPEC_MARKDOWN, identity: { id: "x", version: "latest", sha256: "abc" } });
  assert.equal(outcome.ok, false);
  assert.equal(outcome.code, "SPEC_IDENTITY_INVALID");
});

test("el hash del consumidor IMP-09 se rebindea a la fuente única (no queda stale)", async () => {
  const { IMP09_SPEC_IDENTITY } = await import("../../src/oos-reservation/campaign-register.mjs");
  assert.equal(IMP09_SPEC_IDENTITY.sha256, CANONICAL_SPEC_IDENTITY.sha256);
  assert.equal(createHash("sha256").update(SPEC_MARKDOWN).digest("hex"), IMP09_SPEC_IDENTITY.sha256);
});
