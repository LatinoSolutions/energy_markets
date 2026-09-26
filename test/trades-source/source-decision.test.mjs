import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import {
  LAKE_DERIVED_ARTIFACTS,
  SOURCE_DECISION_STATUS,
  SOURCE_IDS,
  buildDataSourceDecision,
  buildTradesSourceManifest,
  compareSourceInventories,
} from "../../src/trades-source/index.mjs";
import { buildArtifacts } from "../../operations/trades/TR-01/build-trades-source-decision.mjs";
import { sourceCandidatesFixture } from "./fixtures.mjs";

const HERE = new URL("../../operations/trades/TR-01/", import.meta.url).pathname;

test("fail-closed: sin archivo verificado la decisión queda pendiente y el lago es sólo provisional", () => {
  const decision = buildDataSourceDecision(sourceCandidatesFixture());
  assert.equal(decision.status, SOURCE_DECISION_STATUS.PENDING_ARCHIVE_VERIFICATION);
  assert.equal(decision.selectedSource, SOURCE_IDS.EEX_LAKE);
  assert.equal(decision.selectedSourceRole, "PROVISIONAL_ONLY");
  assert.equal(decision.failClosed, true);
  assert.equal(decision.staleArtifacts.length, 0);
  assert.equal(decision.blocking.scanJob, "operations/trades/TR-01/extract-trades-rows.py");
});

test("sin archivo presente y sin lago la decisión queda bloqueada", () => {
  const fixture = sourceCandidatesFixture({ archivePresent: false });
  fixture.candidates[0].present = false;
  const decision = buildDataSourceDecision(fixture);
  assert.equal(decision.status, SOURCE_DECISION_STATUS.BLOCKED_NO_SOURCE);
  assert.equal(decision.selectedSource, null);
  assert.equal(decision.failClosed, true);
});

test("archivo verificado que cumple la comparación es canónico y declara stale los artefactos del lago", () => {
  const decision = buildDataSourceDecision(sourceCandidatesFixture({ archiveVerified: true }));
  assert.equal(decision.status, SOURCE_DECISION_STATUS.DECIDED);
  assert.equal(decision.selectedSource, SOURCE_IDS.CLIENT_SEALED_ARCHIVE);
  assert.equal(decision.failClosed, false);
  assert.deepEqual(
    decision.staleArtifacts.map((entry) => entry.id),
    LAKE_DERIVED_ARTIFACTS.map((entry) => entry.id),
  );
});

test("archivo verificado que no cumple la comparación cae al lago como canónico", () => {
  const fixture = sourceCandidatesFixture({ archiveVerified: true });
  fixture.candidates[1].inventory = { tables: ["eex_derivative_trade"], dateMax: "2025-01-01" };
  const decision = buildDataSourceDecision(fixture);
  assert.equal(decision.status, SOURCE_DECISION_STATUS.DECIDED_FALLBACK_LAKE);
  assert.equal(decision.selectedSource, SOURCE_IDS.EEX_LAKE);
  assert.equal(decision.staleArtifacts.length, 0);
});

test("compareSourceInventories prefiere el archivo sólo si no pierde cobertura y aporta la tabla reference", () => {
  const lake = { tables: ["eex_derivative_trade"], dateMax: "2026-07-28" };
  const archive = { tables: ["eex_derivative_trade", "eex_derivative_reference"], dateMax: "2026-09-11" };
  const result = compareSourceInventories({ lakeInventory: lake, archiveInventory: archive });
  assert.equal(result.satisfiesArchivePreference, true);
  assert.equal(result.archiveAddsReference, true);
});

test("un inventario de escaneo con tableInventory tambien habilita la preferencia del archivo", () => {
  const lake = { tables: ["eex_derivative_trade"], dateMax: "2026-07-28" };
  const archive = {
    dateMax: "2026-09-11",
    tableInventory: {
      eex_derivative_trade: { members: 100, rows: 10 },
      eex_derivative_reference: { members: 20, rows: 2 },
    },
  };
  const result = compareSourceInventories({ lakeInventory: lake, archiveInventory: archive });
  assert.equal(result.satisfiesArchivePreference, true);
  assert.equal(result.archiveAddsReference, true);
});

test("fail-closed: un dateMax ausente en el archivo cuenta como diferencia", () => {
  const lake = { tables: ["eex_derivative_trade"], dateMax: "2026-07-28" };
  const archive = { tables: ["eex_derivative_trade", "eex_derivative_reference"] };
  const result = compareSourceInventories({ lakeInventory: lake, archiveInventory: archive });
  assert.equal(result.comparable, true);
  assert.equal(result.satisfiesArchivePreference, false);
  assert.ok(result.differences.includes("archive.dateMax ausente"));
});

test("el manifest ata el artefacto a sus inputs sin acreditar acceptance", () => {
  const decision = buildDataSourceDecision(sourceCandidatesFixture());
  const manifest = buildTradesSourceManifest({
    artifact: decision,
    artifactPath: "operations/trades/TR-01/DATA_SOURCE_DECISION.json",
    artifactSha256: "a".repeat(64),
  });
  assert.equal(manifest.artifactKind, "TR-01_DATA_SOURCE_MANIFEST");
  assert.equal(manifest.decision.status, decision.status);
  assert.equal(manifest.artifact.sha256, "a".repeat(64));
});

test("el DATA_SOURCE_DECISION committeado es reproducible desde source-candidates.json", () => {
  const candidatesBytes = readFileSync(`${HERE}source-candidates.json`);
  const candidatesDocument = JSON.parse(candidatesBytes.toString("utf8"));
  const candidatesSha256 = createHash("sha256").update(candidatesBytes).digest("hex");
  const { artifactBytes, manifestBytes, decision } = buildArtifacts(candidatesDocument, { candidatesSha256 });
  assert.equal(artifactBytes.equals(readFileSync(`${HERE}DATA_SOURCE_DECISION.json`)), true);
  assert.equal(manifestBytes.equals(readFileSync(`${HERE}DATA_SOURCE_DECISION.MANIFEST.json`)), true);
  // DATA-01 (2026-09-26) verificó el archivo sellado: la decisión committeada es DECIDED.
  assert.equal(decision.status, SOURCE_DECISION_STATUS.DECIDED);
  assert.equal(decision.selectedSource, SOURCE_IDS.CLIENT_SEALED_ARCHIVE);
});
