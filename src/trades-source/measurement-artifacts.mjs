// Mediciones TR-01 publicadas por la cola DATA-01 (operations/data-jobs/jobs/
// tr01-scan.sh): un artefacto por mercado con su manifest hermano. Este módulo es
// la única forma de consumirlas aguas abajo (plan de zonas de TR-02, UI-07): el
// artefacto vale sólo si su SHA-256 es el que declara su manifest.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

export const TRADES_MEASUREMENT_ARTIFACTS = Object.freeze({
  GAS_THE: Object.freeze({
    market: "GAS_THE",
    path: "operations/trades/TR-01/TRADES_MEASUREMENT-gas-the.json",
    manifest: "operations/trades/TR-01/TRADES_MEASUREMENT-gas-the.json.MANIFEST.json",
  }),
  POWER_DE: Object.freeze({
    market: "POWER_DE",
    path: "operations/trades/TR-01/TRADES_MEASUREMENT-power-de.json",
    manifest: "operations/trades/TR-01/TRADES_MEASUREMENT-power-de.json.MANIFEST.json",
  }),
});

// Hasta UI-07 aggregate-trades-rows.mjs escribía este path fijo en el manifest de
// cada mercado (hallazgo UI07-TR01-MANIFEST-PATH). Los manifests del escaneo del
// 2026-09-26 lo conservan: se aceptan sólo con este path exacto, y la atadura la
// da el SHA-256 del manifest hermano, que sigue siendo obligatorio.
export const LEGACY_TR01_MANIFEST_ARTIFACT_PATH = "operations/trades/TR-01/TRADES_MEASUREMENT.json";

const sha256Of = (bytes) => createHash("sha256").update(bytes).digest("hex");

function readOrNull(file) {
  try {
    return readFileSync(file);
  } catch {
    return null;
  }
}

// Verifica un par (artefacto, manifest) ya leído. Sin artefacto ni manifest es
// ausencia (el escaneo no corrió); cualquier otro desajuste es un error.
export function verifyTradesMeasurement({ spec, artifactBytes, manifestBytes }) {
  if (artifactBytes === null && manifestBytes === null) {
    return { ok: false, present: false, code: "TR01_MEASUREMENT_MISSING", market: spec.market, path: spec.path };
  }
  if (artifactBytes === null || manifestBytes === null) {
    return { ok: false, present: true, code: "TR01_MEASUREMENT_INCOMPLETE", market: spec.market, path: artifactBytes === null ? spec.path : spec.manifest };
  }
  let manifest;
  try {
    manifest = JSON.parse(manifestBytes.toString("utf8"));
  } catch {
    return { ok: false, present: true, code: "TR01_MANIFEST_INVALID", market: spec.market, path: spec.manifest };
  }
  const declaredPath = manifest?.artifact?.path;
  const declaredSha256 = manifest?.artifact?.sha256;
  const pathAccepted = declaredPath === spec.path || declaredPath === LEGACY_TR01_MANIFEST_ARTIFACT_PATH;
  if (manifest?.artifactKind !== "TR-01_TRADES_MEASUREMENT_MANIFEST" || !pathAccepted || typeof declaredSha256 !== "string") {
    return { ok: false, present: true, code: "TR01_MANIFEST_REF_INVALID", market: spec.market, path: spec.manifest };
  }
  const sha256 = sha256Of(artifactBytes);
  if (sha256 !== declaredSha256) {
    return { ok: false, present: true, code: "TR01_HASH_MISMATCH", market: spec.market, path: spec.path };
  }
  const measurement = JSON.parse(artifactBytes.toString("utf8"));
  if (measurement?.artifactKind !== "TR-01_TRADES_MEASUREMENT" || !Array.isArray(measurement.coverage)) {
    return { ok: false, present: true, code: "TR01_MEASUREMENT_INVALID", market: spec.market, path: spec.path };
  }
  return {
    ok: true,
    present: true,
    market: spec.market,
    measurement,
    provenance: {
      path: spec.path,
      sha256,
      manifestPath: spec.manifest,
      manifestSha256: sha256Of(manifestBytes),
      manifestDeclaredPath: declaredPath,
    },
  };
}

export function loadTradesMeasurements(repoRoot) {
  const results = {};
  for (const [market, spec] of Object.entries(TRADES_MEASUREMENT_ARTIFACTS)) {
    results[market] = verifyTradesMeasurement({
      spec,
      artifactBytes: readOrNull(path.join(repoRoot, spec.path)),
      manifestBytes: readOrNull(path.join(repoRoot, spec.manifest)),
    });
  }
  return results;
}

// Resumen publicado junto a la cobertura: de qué medición sale, con qué política
// de broken spread y qué rango de fechas observó la fuente. Sólo copia campos del
// artefacto; los días previos a `dateMin` no son "cero trades medidos" sino días
// que la fuente canónica no trae (DATA-02).
export function measurementSummary(loaded) {
  const { measurement, provenance } = loaded;
  return {
    market: loaded.market,
    ...provenance,
    brokenSpreadPolicy: measurement.brokenSpreadPolicy ?? null,
    source: measurement.sourceMeta?.source ?? null,
    archiveSha256: measurement.sourceMeta?.archiveVerification?.sha256 ?? null,
    dateMin: measurement.inventory?.dateMin ?? null,
    dateMax: measurement.inventory?.dateMax ?? null,
    coverageRecords: measurement.coverage.length,
    eligibleTrades: measurement.eligibility?.eligible ?? null,
  };
}
