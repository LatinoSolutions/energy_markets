// Productor de la decisión de fuente de trades de TR-01. Fuente:
// TRADES_MODE_PLAN.md TR-01 y OWNER_PATCH_TRADES_MODE_2026-09-25.md §1-§2.
//
// Entrada: operations/trades/TR-01/source-candidates.json — estado e inventario
// de las dos fuentes candidatas (lago EEX y archivo sellado del cliente).
// Salida: DATA_SOURCE_DECISION.json + DATA_SOURCE_DECISION.MANIFEST.json.
//
// El escaneo completo del lago y del archivo (filas, duplicados, cobertura,
// ingesta del 2026-06-12) es el job que lanza Bru con
// extract-trades-rows.py; este builder sólo consume su inventario. Mientras el
// archivo no esté verificado, la decisión queda PENDING_ARCHIVE_VERIFICATION y
// fail-closed (ver src/trades-source/source-decision.mjs).
//
// Uso: node build-trades-source-decision.mjs [--check]

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

import {
  buildDataSourceDecision,
  buildTradesSourceManifest,
} from "../../../src/trades-source/index.mjs";

const HERE = new URL("./", import.meta.url).pathname;
const CANDIDATES = `${HERE}source-candidates.json`;
const ARTIFACT = `${HERE}DATA_SOURCE_DECISION.json`;
const MANIFEST = `${HERE}DATA_SOURCE_DECISION.MANIFEST.json`;

const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");

export function buildArtifacts(candidatesDocument) {
  const decision = buildDataSourceDecision({
    candidates: candidatesDocument.candidates,
    comparison: candidatesDocument.comparison ?? null,
    measurements: candidatesDocument.measurements ?? null,
    decidedBy: candidatesDocument.decidedBy ?? "TR-01 producer",
    decidedAtUtc: candidatesDocument.decidedAtUtc ?? null,
  });
  const artifactBytes = Buffer.from(`${JSON.stringify(decision, null, 2)}\n`);
  const artifactSha256 = digest(artifactBytes);
  const manifest = buildTradesSourceManifest({
    artifact: decision,
    artifactPath: "operations/trades/TR-01/DATA_SOURCE_DECISION.json",
    artifactSha256,
    generatedAtUtc: candidatesDocument.decidedAtUtc ?? null,
    inputs: {
      candidates: { path: "operations/trades/TR-01/source-candidates.json", sha256: digest(Buffer.from(`${JSON.stringify(candidatesDocument, null, 2)}\n`)) },
    },
  });
  return { decision, artifactBytes, manifest, manifestBytes: Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`) };
}

function main() {
  const candidatesDocument = JSON.parse(readFileSync(CANDIDATES, "utf8"));
  const { artifactBytes, manifestBytes, decision } = buildArtifacts(candidatesDocument);
  if (process.argv.includes("--check")) {
    const committedArtifact = readFileSync(ARTIFACT);
    const committedManifest = readFileSync(MANIFEST);
    if (!committedArtifact.equals(artifactBytes) || !committedManifest.equals(manifestBytes)) {
      throw new Error("DATA_SOURCE_DECISION no es reproducible desde source-candidates.json.");
    }
    console.log(`TR-01 DATA_SOURCE_DECISION reproducible (status=${decision.status})`);
    return;
  }
  writeFileSync(ARTIFACT, artifactBytes);
  writeFileSync(MANIFEST, manifestBytes);
  console.log(`TR-01 DATA_SOURCE_DECISION status=${decision.status} selected=${decision.selectedSource} failClosed=${decision.failClosed}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
