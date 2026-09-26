// DATA-01: pipeline de la cola. Fija el orden de los jobs, que los artefactos de
// BT-06 caen en los paths que la UI ya carga como release Power v3, y que cada
// paso declara techo de memoria, timeout y artefactos publicados.

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  DATA_ARCHIVE,
  DATA_JOB_KIND,
  PROVISIONAL_MEMORY_MAX_BYTES,
  STEP_ARTIFACTS,
  buildDataQueueSteps,
} from "../../src/data-jobs/pipeline.mjs";
import { POWER_EXPLORATORY_RELEASE } from "../../src/exploratory/missions.mjs";
import { BRIDGE_WINDOW } from "../../src/trades-bridge/index.mjs";

const repoRoot = fileURLToPath(new URL("../../", import.meta.url));
const ctx = { repoRoot, scratchDir: "/tmp/data01-scratch" };

test("DATA-01 pipeline: el hash declarado del archivo coincide con descargar.sh", () => {
  assert.equal(DATA_ARCHIVE.expectedSha256, "c0b8389dd2eae768e0144ebffa2eb8c557c1407ec8bbccb014c0ecdee075cdd3");
  assert.equal(DATA_ARCHIVE.expectedBytes, 108015856868);
  const script = "/srv/data/eex-client-archive/descargar.sh";
  if (existsSync(script)) {
    const text = readFileSync(script, "utf8");
    assert.match(text, new RegExp(`SHA=${DATA_ARCHIVE.expectedSha256}`));
    assert.match(text, new RegExp(`TAM=${DATA_ARCHIVE.expectedBytes}`));
  }
});

test("DATA-01 pipeline: los jobs corren en el orden del owner (descomprimir, TR-01, TR-03, BT-06 extract, BT-06 backtest)", () => {
  const steps = buildDataQueueSteps(ctx);
  assert.deepEqual(steps.map((step) => step.jobKind), [
    DATA_JOB_KIND.DECOMPRESS,
    DATA_JOB_KIND.TR01_SCAN,
    DATA_JOB_KIND.TR03_BRIDGE,
    DATA_JOB_KIND.BT06_EXTRACT,
    DATA_JOB_KIND.BT06_BACKTEST,
  ]);
  for (const step of steps) {
    assert.ok(Array.isArray(step.command) && step.command.length > 0);
    assert.equal(step.memoryMaxBytes, PROVISIONAL_MEMORY_MAX_BYTES[step.jobKind]);
    assert.ok(step.memoryMaxBytes > 0);
    assert.ok(step.timeoutMs > 0);
    assert.ok(step.publishes.length > 0);
    assert.equal(step.env.DATA_REPO_ROOT, repoRoot);
    assert.equal(step.env.DATA_SCRATCH_DIR, ctx.scratchDir);
    assert.equal(step.env.DATA_WINDOW_START, BRIDGE_WINDOW.startIso);
    assert.equal(step.env.DATA_WINDOW_END, BRIDGE_WINDOW.endIso);
    // Nunca credenciales en el pipeline.
    assert.equal(JSON.stringify(step.env).includes("TOKEN"), false);
  }
  const decompress = steps[0];
  assert.deepEqual(decompress.command, ["tar", "--zstd", "-xf", DATA_ARCHIVE.path, "-C", DATA_ARCHIVE.extractDir]);
});

test("DATA-01 pipeline: el backtest de BT-06 publica en los paths que la UI carga como release Power v3", () => {
  const steps = buildDataQueueSteps(ctx);
  const extract = steps.find((step) => step.jobKind === DATA_JOB_KIND.BT06_EXTRACT);
  const backtest = steps.find((step) => step.jobKind === DATA_JOB_KIND.BT06_BACKTEST);
  assert.deepEqual(extract.publishes, [POWER_EXPLORATORY_RELEASE.slots]);
  assert.deepEqual(backtest.publishes, [POWER_EXPLORATORY_RELEASE.results, POWER_EXPLORATORY_RELEASE.manifest]);
  assert.ok(extract.command.includes(POWER_EXPLORATORY_RELEASE.slots));
  assert.ok(backtest.command.includes(POWER_EXPLORATORY_RELEASE.results));
  assert.ok(backtest.command.includes(POWER_EXPLORATORY_RELEASE.generator));
  assert.ok(backtest.command.includes(POWER_EXPLORATORY_RELEASE.slots));
  // El extractor de Power exige la decisión de fuente de TR-01 (fail-closed).
  assert.ok(extract.command.includes("operations/trades/TR-01/DATA_SOURCE_DECISION.json"));
});

test("DATA-01 pipeline: los scripts de job reales existen y usan las herramientas canónicas", () => {
  const tr01 = readFileSync(`${repoRoot}/operations/data-jobs/jobs/tr01-scan.sh`, "utf8");
  const tr03 = readFileSync(`${repoRoot}/operations/data-jobs/jobs/tr03-bridge.sh`, "utf8");
  assert.match(tr01, /operations\/trades\/TR-01\/extract-trades-rows\.py/);
  assert.match(tr01, /aggregate-trades-rows\.mjs/);
  assert.match(tr01, /build-trades-source-decision\.mjs/);
  assert.match(tr01, /record-archive-verification\.mjs/);
  assert.match(tr03, /operations\/trades\/TR-01\/extract-trades-rows\.py/);
  assert.match(tr03, /operations\/trades\/TR-03\/extract-tob-rows\.py/);
  assert.match(tr03, /build-bridge-measurement\.mjs/);
  for (const script of [tr01, tr03]) {
    assert.match(script, /set -euo pipefail/);
    assert.equal(script.includes("TELEGRAM_BOT_TOKEN"), false);
  }
});

test("DATA-01 pipeline: los artefactos declarados son los que la cadena publica", () => {
  assert.deepEqual(STEP_ARTIFACTS[DATA_JOB_KIND.TR01_SCAN], [
    "operations/trades/TR-01/TRADES_MEASUREMENT-gas-the.json",
    "operations/trades/TR-01/TRADES_MEASUREMENT-gas-the.json.MANIFEST.json",
    "operations/trades/TR-01/TRADES_MEASUREMENT-power-de.json",
    "operations/trades/TR-01/TRADES_MEASUREMENT-power-de.json.MANIFEST.json",
    "operations/trades/TR-01/DATA_SOURCE_DECISION.json",
    "operations/trades/TR-01/DATA_SOURCE_DECISION.MANIFEST.json",
  ]);
  assert.deepEqual(STEP_ARTIFACTS[DATA_JOB_KIND.TR03_BRIDGE], [
    "operations/trades/TR-03/bridge-measurement.json",
    "operations/trades/TR-03/bridge-measurement.MANIFEST.json",
  ]);
});
