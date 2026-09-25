// Identidad y manifest de un run TRADES (TR-05), compatibles con la maquinaria
// de BT-05. Fuente: PLAN_STATUS.md fila BT-05 ("run_id = sha256 de {commit,
// hash del manifest de datos de entrada, parametros en JSON canonico, version
// del motor}; mismo run_id = no se recalcula; cada run guarda un manifest ... en
// un registro append-only") y TRADES_MODE_PLAN.md TR-05 ("Depende de BT-05
// (run_id, manifest por run, resultado vigente único)").
//
// Misma forma exacta de identidad que `computeRunIdentity` del runner BT-05
// (src/backtest-jobs/runner.mjs): {codeCommit, dataManifestSha256, parameters,
// engineVersion} y run_id `BT-RUN-<sha256>`. Así el run TRADES puede entrar al
// mismo registro/retention sin inventar una segunda verdad de identidad.

import { canonicalValueSha256 } from "../pit-views/pit-record.mjs";
import { TRADES_ENGINE_VERSION } from "./missions.mjs";

export const TRADES_JOB_KIND = "TRADES_BACKTEST";
export const TRADES_RUN_ID_PREFIX = "BT-RUN-";

export function computeTradesRunIdentity({ codeCommit, dataManifest, parameters } = {}) {
  const hashed = canonicalValueSha256(dataManifest);
  const identity = {
    codeCommit: codeCommit ?? null,
    dataManifestSha256: hashed.ok ? hashed.sha256 : null,
    parameters: parameters ?? null,
    engineVersion: TRADES_ENGINE_VERSION,
  };
  const runIdHash = canonicalValueSha256(identity);
  return {
    runId: runIdHash.ok ? `${TRADES_RUN_ID_PREFIX}${runIdHash.sha256}` : null,
    identity,
  };
}

// Manifest de un run TRADES con la misma información de retención que BT-05
// (BT-05 punto 3): identidad, inputs, estado, hash del resultado y pico de RAM.
export function buildTradesRunManifest({
  runId,
  identity,
  inputs = null,
  startedAt = null,
  finishedAt = null,
  status = null,
  resultSha256 = null,
  memoryPeak = null,
} = {}) {
  return {
    runId: runId ?? null,
    jobKind: TRADES_JOB_KIND,
    identity: identity ?? null,
    inputs,
    startedAt,
    finishedAt,
    status,
    resultSha256,
    memoryPeak,
  };
}

export function isTradesRunId(value) {
  return typeof value === "string" && /^BT-RUN-[0-9a-f]{64}$/.test(value);
}
