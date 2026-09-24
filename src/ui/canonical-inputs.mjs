// Carga el estado canónico que la UI puede mostrar hoy (UI-04, owner 24-sep-2026,
// docs/product/UI-04_OWNER_BRIEF_2026-09-24.md §Work 3). Solo lee artifacts
// registrados en un IMP_RECEIPT aceptado y pasa por el verificador PIT
// (buildPitManifestFromAudit); nunca lee el lago EEX ni fixtures.
//
// Replay exige además un decision boundary canónico (buildOperatorTimeline). Ningún
// artifact acreditado lo declara todavía, así que no se construye timeline: Replay
// queda ERROR con la causa explícita, en vez de inventar un boundary.

import { readFileSync } from "node:fs";
import path from "node:path";

import { DEFAULT_REPO_ROOT } from "../pit-views/index.mjs";
import { buildPitManifestFromAudit } from "../pit-views/views.mjs";
import { backendIndexFromManifest } from "../operator-interface/index.mjs";

export const TEMPORAL_MANIFEST_RECEIPT = "operations/receipts/IMP-03-IMP_RECEIPT.json";
export const TEMPORAL_MANIFEST_PATH = "operations/audit/IMP-03/temporal-manifest.json";

export const BACKEND_GAP = Object.freeze({
  NO_CANONICAL_DECISION_BOUNDARY: "NO_CANONICAL_DECISION_BOUNDARY",
  NO_VALUE_ATTESTATIONS: "NO_VALUE_ATTESTATIONS",
});

function emptyResult(errors) {
  return {
    inputs: {},
    backend: { manifestLoaded: false, recordCount: 0, bindableIdentities: 0, sources: [], gaps: [], errors },
  };
}

// El sha256 sale del receipt aceptado, no de este archivo: si el artifact cambia
// sin nuevo receipt, la carga falla cerrada.
function temporalManifestRef(repoRoot) {
  const receipt = JSON.parse(readFileSync(path.join(repoRoot, TEMPORAL_MANIFEST_RECEIPT), "utf8"));
  const entry = (receipt.evidenceTestHashes ?? []).find((item) => item?.path === TEMPORAL_MANIFEST_PATH);
  if (entry === undefined) {
    return null;
  }
  return { path: entry.path, sha256: entry.sha256 };
}

export function loadCanonicalUiInputs() {
  let artifactRef;
  try {
    artifactRef = temporalManifestRef(DEFAULT_REPO_ROOT);
  } catch (error) {
    return emptyResult([{ code: "RECEIPT_UNREADABLE", message: String(error?.message ?? error) }]);
  }
  if (artifactRef === null) {
    return emptyResult([{ code: "ARTIFACT_NOT_IN_RECEIPT", message: `${TEMPORAL_MANIFEST_PATH} no figura en ${TEMPORAL_MANIFEST_RECEIPT}` }]);
  }

  const built = buildPitManifestFromAudit({ manifestId: "ui-04-canonical", manifestVersion: "1", artifactRef });
  if (!built.ok) {
    return emptyResult(built.errors ?? []);
  }
  const backendIndex = backendIndexFromManifest(built.manifest);
  if (backendIndex === null) {
    return emptyResult([{ code: "BACKEND_NOT_VERIFIED", message: "el manifest no salió del verificador PIT" }]);
  }

  const records = built.manifest.records ?? [];
  const gaps = [
    { code: BACKEND_GAP.NO_CANONICAL_DECISION_BOUNDARY, surface: "replay", message: "ningún artifact acreditado declara decision boundary, as-of ni working mode" },
  ];
  if (backendIndex.byIdentity.size === 0) {
    gaps.push({ code: BACKEND_GAP.NO_VALUE_ATTESTATIONS, surface: "all", message: `${records.length} records del manifest temporal IMP-03, ninguno con valor ni revisionId atestado` });
  }
  return {
    inputs: { backendIndex },
    backend: {
      manifestLoaded: true,
      recordCount: records.length,
      bindableIdentities: backendIndex.byIdentity.size,
      sources: [{ path: artifactRef.path, sha256: artifactRef.sha256, receiptPath: TEMPORAL_MANIFEST_RECEIPT }],
      gaps,
      errors: [],
    },
  };
}
