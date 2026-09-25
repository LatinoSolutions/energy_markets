// Builder determinista del artefacto de freeze TRADES-v1 (TR-04). Fuente:
// TRADES_MODE_PLAN.md TR-04 y docs/canonical/v1_1_1/
// OWNER_PATCH_TRADES_MODE_2026-09-25.md §3-§5.
//
// NO corre el escaneo del lago ni ningún backtest: lee la medición del puente de
// TR-03 si existe, la decisión de fuente de TR-01 y una eventual aprobación del
// owner, y evalúa el freeze. Sin medición real, sin la política de broken spread
// congelada o sin la aprobación de Bru, el artefacto queda HOLD y publica el
// candidato con su configHash para que el owner pueda aprobar exactamente ese
// config. Uso:
//   node operations/trades/TR-04/build-trades-freeze.mjs

import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

import {
  TRADES_CONTRACT_ID,
  TRADES_FREEZE_SCOPE,
  TRADES_VERSION_LABEL,
  contentHashOf,
  evaluateTradesFreeze,
} from "../../../src/execution-contract/index.mjs";
import { TRADES_PATCH_IDENTITY } from "../../../src/oos-reservation/trades-zones.mjs";

export const MEASUREMENT_PATH = "operations/trades/TR-03/bridge-measurement.json";
export const MEASUREMENT_STATUS_PATH = "operations/trades/TR-03/BRIDGE_MEASUREMENT_STATUS.json";
export const SOURCE_DECISION_PATH = "operations/trades/TR-01/DATA_SOURCE_DECISION.json";
export const OWNER_APPROVAL_PATH = "operations/trades/TR-04/OWNER_FREEZE_APPROVAL.json";
export const OUT_PATH = "operations/trades/TR-04/TRADES_CONTRACT_V1_FREEZE.json";
export const MANIFEST_PATH = "operations/trades/TR-04/TRADES_CONTRACT_V1_FREEZE.MANIFEST.json";

// Núcleo puro: recibe los documentos ya leídos y evalúa el freeze. La política de
// broken spread que se congela sale de la MEDICIÓN del puente (TR-03), que se
// corrió bajo una política concreta (patch 03 §3.1); la decisión de fuente de
// TR-01 sólo se usa para comprobar consistencia.
//
// TR04-MEASUREMENT-HASH-UNBOUND: el config aprobado no puede quedar ligado sólo a
// rutas. `generatedFrom.bridgeMeasurementSha256` ata el hash del config a los
// bytes de la medición de TR-03; si se pasa explícito (main lo calcula del
// archivo), se usa ese sha; si no, se deriva del objeto de medición.
export function buildTradesFreezeArtifact({ measurement = null, sourceDecision = null, ownerApproval = null, inputsPresent = {}, bridgeMeasurementSha256 = null } = {}) {
  const deleteTmSemantics = sourceDecision?.measurements?.deleteTmSemantics?.value
    ?? sourceDecision?.deleteTmSemantics
    ?? null;

  const measurementSha256 = bridgeMeasurementSha256
    ?? (measurement && typeof measurement === "object" ? contentHashOf(measurement) : null);

  const outcome = evaluateTradesFreeze({
    measurement,
    sourceDecision,
    deleteTmSemantics,
    ownerApproval,
    generatedFrom: {
      bridgeMeasurement: inputsPresent.measurement ? MEASUREMENT_PATH : null,
      bridgeMeasurementSha256: measurementSha256,
      sourceDecision: inputsPresent.sourceDecision ? SOURCE_DECISION_PATH : null,
    },
  });

  const artifact = {
    artifactKind: "TR-04_TRADES_CONTRACT_V1_FREEZE",
    schemaVersion: "TRADES_CONTRACT_V1",
    spec: TRADES_PATCH_IDENTITY,
    contractId: TRADES_CONTRACT_ID,
    versionLabel: TRADES_VERSION_LABEL,
    decision: outcome.decision,
    status: outcome.status,
    humanGate: {
      scope: TRADES_FREEZE_SCOPE,
      requiresOwnerApproval: true,
      approvalRef: outcome.contract?.approval?.approvalRef ?? null,
      configHash: outcome.candidate?.configHash ?? outcome.contract?.configHash ?? null,
      rule: "Bru aprueba el freeze antes de cualquier run de estrategia en TRADES (TRADES_MODE_PLAN.md TR-04).",
    },
    blockedBy: outcome.blockedBy,
    errors: outcome.errors,
    reason: outcome.reason,
    candidate: outcome.candidate,
    frozenContract: outcome.contract,
    inputs: {
      measurement: {
        path: MEASUREMENT_PATH,
        present: inputsPresent.measurement === true,
        brokenSpreadPolicy: measurement?.brokenSpreadPolicy ?? null,
      },
      measurementStatus: { path: MEASUREMENT_STATUS_PATH, present: inputsPresent.measurementStatus === true },
      sourceDecision: {
        path: SOURCE_DECISION_PATH,
        present: inputsPresent.sourceDecision === true,
        brokenSpreadPolicy: sourceDecision?.brokenSpreadPolicy ?? null,
        deleteTmSemantics,
      },
      ownerApproval: { path: OWNER_APPROVAL_PATH, present: inputsPresent.ownerApproval === true },
    },
  };
  return { artifact, outcome };
}

function main() {
  const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
  const hashFile = (path) => sha256(readFileSync(path));
  const readJson = (path) => (existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : null);

  const inputsPresent = {
    measurement: existsSync(MEASUREMENT_PATH),
    measurementStatus: existsSync(MEASUREMENT_STATUS_PATH),
    sourceDecision: existsSync(SOURCE_DECISION_PATH),
    ownerApproval: existsSync(OWNER_APPROVAL_PATH),
  };
  const { artifact, outcome } = buildTradesFreezeArtifact({
    measurement: readJson(MEASUREMENT_PATH),
    sourceDecision: readJson(SOURCE_DECISION_PATH),
    ownerApproval: readJson(OWNER_APPROVAL_PATH),
    bridgeMeasurementSha256: inputsPresent.measurement ? hashFile(MEASUREMENT_PATH) : null,
    inputsPresent,
  });
  const outputBytes = Buffer.from(`${JSON.stringify(artifact, null, 1)}\n`);
  writeFileSync(OUT_PATH, outputBytes);

  const manifest = {
    artifactKind: "TR-04_TRADES_CONTRACT_V1_FREEZE_MANIFEST",
    schemaVersion: "1.0",
    artifact: { path: OUT_PATH, sha256: sha256(outputBytes) },
    generator: { path: "operations/trades/TR-04/build-trades-freeze.mjs", sha256: hashFile("operations/trades/TR-04/build-trades-freeze.mjs") },
    modules: [
      "src/execution-contract/trades-contract.mjs",
      "src/execution-contract/execution-contract.mjs",
      "src/trades-bridge/constants.mjs",
      "src/oos-reservation/trades-windows.mjs",
    ].map((path) => ({ path, sha256: hashFile(path) })),
    sources: {
      spec: { path: TRADES_PATCH_IDENTITY.path, sha256: hashFile(TRADES_PATCH_IDENTITY.path) },
      sourceDecision: inputsPresent.sourceDecision ? { path: SOURCE_DECISION_PATH, sha256: hashFile(SOURCE_DECISION_PATH) } : null,
      measurement: inputsPresent.measurement ? { path: MEASUREMENT_PATH, sha256: hashFile(MEASUREMENT_PATH) } : null,
      ownerApproval: inputsPresent.ownerApproval ? { path: OWNER_APPROVAL_PATH, sha256: hashFile(OWNER_APPROVAL_PATH) } : null,
    },
  };
  writeFileSync(MANIFEST_PATH, `${JSON.stringify(manifest, null, 1)}\n`);

  console.log(`TR-04 freeze: decision=${outcome.decision}; status=${outcome.status}; configHash=${artifact.humanGate.configHash ?? "—"}; blockedBy=${outcome.blockedBy.join(",") || "—"}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
