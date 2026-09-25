// Manifest del productor TR-01. Fuente: TRADES_MODE_PLAN.md TR-01 ("Salida:
// DATA_SOURCE_DECISION + manifest") y la disciplina de provenance del repo
// (cada artefacto declara sus inputs con hash; ver BT-01 build-campaign-benchmarks.mjs).
// El manifest no acredita acceptance: sólo ata el artefacto a sus inputs.

export const TRADES_SOURCE_PRODUCER_VERSION = "TR-01-trades-source-producer-1";

export function buildTradesSourceManifest({
  artifact,
  artifactPath,
  artifactSha256,
  inputs = {},
  generatedAtUtc = null,
}) {
  if (artifact?.artifactKind !== "TR-01_DATA_SOURCE_DECISION") {
    throw new TypeError("El manifest requiere el artefacto TR-01_DATA_SOURCE_DECISION.");
  }
  return {
    artifactKind: "TR-01_DATA_SOURCE_MANIFEST",
    schemaVersion: "1.0",
    producer: {
      version: TRADES_SOURCE_PRODUCER_VERSION,
      spec: "OWNER_PATCH_TRADES_MODE_2026-09-25.md",
      plan: "TRADES_MODE_PLAN.md TR-01",
    },
    generatedAtUtc,
    artifact: { path: artifactPath, sha256: artifactSha256 },
    inputs,
    decision: {
      status: artifact.status,
      selectedSource: artifact.selectedSource,
      selectedSourceRole: artifact.selectedSourceRole ?? null,
      failClosed: artifact.failClosed,
      staleArtifacts: (artifact.staleArtifacts ?? []).map((entry) => entry.id),
    },
  };
}
