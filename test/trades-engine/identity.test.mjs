import { test } from "node:test";
import assert from "node:assert/strict";

import {
  buildTradesRunManifest,
  computeTradesRunIdentity,
  isTradesRunId,
} from "../../src/trades-engine/identity.mjs";
import { TRADES_ENGINE_VERSION } from "../../src/trades-engine/missions.mjs";

const base = {
  codeCommit: "1bae32a",
  dataManifest: { manifest: { path: "m.json", sha256: "a".repeat(64) }, files: [] },
  parameters: { jobKind: "TRADES_BACKTEST", mission: "GAS_QUARTERLY" },
};

test("la identidad del run TRADES tiene la forma de BT-05", () => {
  const { runId, identity } = computeTradesRunIdentity(base);
  assert.equal(isTradesRunId(runId), true);
  assert.deepEqual(Object.keys(identity).sort(), ["codeCommit", "dataManifestSha256", "engineVersion", "parameters"]);
  assert.equal(identity.engineVersion, TRADES_ENGINE_VERSION);
});

test("mismo input = mismo run_id; distinto parámetro = distinto run_id", () => {
  const first = computeTradesRunIdentity(base);
  const second = computeTradesRunIdentity(base);
  assert.equal(first.runId, second.runId);
  const other = computeTradesRunIdentity({ ...base, parameters: { jobKind: "TRADES_BACKTEST", mission: "POWER_MONTHLY" } });
  assert.notEqual(first.runId, other.runId);
});

test("el manifest del run conserva identidad, inputs y resultado", () => {
  const { runId, identity } = computeTradesRunIdentity(base);
  const manifest = buildTradesRunManifest({ runId, identity, inputs: { rows: "x" }, status: "SUCCEEDED", resultSha256: "b".repeat(64) });
  assert.equal(manifest.runId, runId);
  assert.equal(manifest.jobKind, "TRADES_BACKTEST");
  assert.equal(manifest.identity, identity);
  assert.equal(manifest.resultSha256, "b".repeat(64));
});
