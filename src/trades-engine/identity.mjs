// Identidad y manifest de un run TRADES (TR-05), compatibles con la maquinaria
// de BT-05. Fuente: PLAN_STATUS.md fila BT-05 ("run_id = sha256 de {commit,
// hash del manifest de datos de entrada, parametros en JSON canonico, version
// del motor}; mismo run_id = no se recalcula; cada run guarda un manifest ... en
// un registro append-only"), TRADES_MODE_PLAN.md TR-05 ("Depende de BT-05
// (run_id, manifest por run, resultado vigente único)") y OWNER_PATCH_TRADES_MODE
// §2 ("la identidad de cada run lleva market, mission, source_mode,
// observation_rule y zone").
//
// El núcleo de identidad tiene la forma de `computeRunIdentity` del runner BT-05
// (src/backtest-jobs/runner.mjs): {codeCommit, dataManifestSha256, parameters,
// engineVersion} y run_id `BT-RUN-<sha256>`. ADEMÁS, y por exigencia del patch 03
// §2, la identidad lleva el alcance del run (market, mission, sourceMode,
// observationRule, zone) y el configHash del contrato congelado (TR-04), para que
// un run_id identifique UNA misión, UNA regla, UNA zona y UN config. Sin esos
// campos, `computeTradesRunIdentity` falla (fail-closed): no se mintea un run_id
// que no pueda rastrearse hasta su alcance ni hasta su contrato.

import { canonicalValueSha256 } from "../pit-views/pit-record.mjs";
import { TRADES_ENGINE_VERSION } from "./missions.mjs";

export const TRADES_JOB_KIND = "TRADES_BACKTEST";
export const TRADES_RUN_ID_PREFIX = "BT-RUN-";

// Alcance obligatorio del run (patch 03 §2) más el configHash del contrato
// congelado. `mission` es la misión canónica (p. ej. GAS_QUARTERLY).
export const TRADES_IDENTITY_SCOPE_FIELDS = Object.freeze([
  "market",
  "mission",
  "sourceMode",
  "observationRule",
  "zone",
  "configHash",
]);

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

export function computeTradesRunIdentity({
  codeCommit,
  dataManifest,
  parameters,
  market,
  mission,
  sourceMode,
  observationRule,
  zone,
  configHash,
} = {}) {
  const scope = { market, mission, sourceMode, observationRule, zone, configHash };
  const missing = TRADES_IDENTITY_SCOPE_FIELDS.filter((field) => !isNonEmptyString(scope[field]));
  if (missing.length > 0) {
    return { ok: false, code: "MISSING_RUN_SCOPE_FIELDS", missing, runId: null, identity: null };
  }
  const hashed = canonicalValueSha256(dataManifest);
  // Un run_id identifica UNA misión, UNA regla, UNA zona y UN config: el alcance
  // del patch 03 §2 entra en el hash, no sólo en el manifest.
  const identity = {
    codeCommit: codeCommit ?? null,
    dataManifestSha256: hashed.ok ? hashed.sha256 : null,
    parameters: parameters ?? null,
    engineVersion: TRADES_ENGINE_VERSION,
    market,
    mission,
    sourceMode,
    observationRule,
    zone,
    configHash,
  };
  const runIdHash = canonicalValueSha256(identity);
  return {
    ok: true,
    code: null,
    missing: [],
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
