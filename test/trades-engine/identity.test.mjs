import { test } from "node:test";
import assert from "node:assert/strict";

import {
  TRADES_IDENTITY_SCOPE_FIELDS,
  buildTradesRunManifest,
  computeTradesRunIdentity,
  isTradesRunId,
} from "../../src/trades-engine/identity.mjs";
import { TRADES_ENGINE_VERSION } from "../../src/trades-engine/missions.mjs";

const base = {
  codeCommit: "1bae32a",
  dataManifest: { manifest: { path: "m.json", sha256: "a".repeat(64) }, files: [] },
  parameters: { jobKind: "TRADES_BACKTEST" },
  market: "GAS_THE",
  mission: "GAS_QUARTERLY",
  sourceMode: "TRADES",
  observationRule: "LAST_TRADE",
  zone: "DEVELOPMENT",
  configHash: "c".repeat(64),
};

test("la identidad del run TRADES lleva el núcleo BT-05 y el alcance del patch 03 §2", () => {
  const { ok, runId, identity } = computeTradesRunIdentity(base);
  assert.equal(ok, true);
  assert.equal(isTradesRunId(runId), true);
  assert.deepEqual(Object.keys(identity).sort(), [
    "codeCommit",
    "configHash",
    "dataManifestSha256",
    "engineVersion",
    "market",
    "mission",
    "observationRule",
    "parameters",
    "sourceMode",
    "zone",
  ]);
  assert.equal(identity.engineVersion, TRADES_ENGINE_VERSION);
  for (const field of TRADES_IDENTITY_SCOPE_FIELDS) {
    assert.equal(identity[field], base[field]);
  }
});

test("sin algún campo obligatorio del alcance, la identidad falla (fail-closed)", () => {
  for (const field of TRADES_IDENTITY_SCOPE_FIELDS) {
    const incomplete = { ...base };
    delete incomplete[field];
    const result = computeTradesRunIdentity(incomplete);
    assert.equal(result.ok, false, `faltando ${field} debería fallar`);
    assert.equal(result.code, "MISSING_RUN_SCOPE_FIELDS");
    assert.deepEqual(result.missing, [field]);
    assert.equal(result.runId, null);
  }
});

test("mismo input = mismo run_id; distinto alcance = distinto run_id", () => {
  const first = computeTradesRunIdentity(base);
  const second = computeTradesRunIdentity(base);
  assert.equal(first.runId, second.runId);
  const other = computeTradesRunIdentity({ ...base, observationRule: "SLOT_VWAP" });
  assert.notEqual(first.runId, other.runId);
  const otherZone = computeTradesRunIdentity({ ...base, zone: "OOS_HISTORICO" });
  assert.notEqual(first.runId, otherZone.runId);
});

test("el manifest del run conserva identidad, inputs y resultado", () => {
  const { runId, identity } = computeTradesRunIdentity(base);
  const manifest = buildTradesRunManifest({ runId, identity, inputs: { rows: "x" }, status: "SUCCEEDED", resultSha256: "b".repeat(64) });
  assert.equal(manifest.runId, runId);
  assert.equal(manifest.jobKind, "TRADES_BACKTEST");
  assert.equal(manifest.identity, identity);
  assert.equal(manifest.resultSha256, "b".repeat(64));
});