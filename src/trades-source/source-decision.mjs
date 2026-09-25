// Decisión de fuente canónica de trades (TR-01). Fuente:
// TRADES_MODE_PLAN.md TR-01 ("Salida: DATA_SOURCE_DECISION + manifest. Si la
// fuente elegida no es el lago actual, declarar qué artefactos quedan stale (B
// de BT-01)") y OWNER_PATCH_TRADES_MODE_2026-09-25.md §1-§2 (dos fuentes
// candidatas: el lago auditado /srv/hot-data/EEX y el archivo sellado del
// cliente).
//
// La decisión es determinista y fail-closed: mientras el archivo del cliente no
// esté presente y su SHA-256 verificado, NO se declara al archivo como fuente
// canónica. El lago es la única fuente accesible hoy y se usa como fuente
// provisional, pero el artefacto queda PENDING_ARCHIVE_VERIFICATION y no
// acredita acceptance. La comparación lago vs archivo (filas, duplicados,
// cobertura por instrumento y día, ingesta del 2026-06-12) se corre en el job de
// escaneo de TR-01 que lanza Bru.

export const SOURCE_IDS = Object.freeze({
  EEX_LAKE: "EEX_LAKE",
  CLIENT_SEALED_ARCHIVE: "CLIENT_SEALED_ARCHIVE",
});

// Patch 03 §3.1: la política de inclusión de broken spread se mide sobre la
// historia completa y se congela en TR-04. El escaneo de TR-01 puede reportarla
// en `measurements.brokenSpreadPolicy.value`; mientras no exista, el artefacto
// declara explícitamente que sigue pending (nunca la inventa). El freeze de TR-04
// toma la política de la medición del puente (TR-03) y contrasta esta decisión
// con ella: si difieren, queda HOLD por inconsistencia.
const DECLARED_BROKEN_SPREAD_POLICIES = Object.freeze(["INCLUDE", "EXCLUDE"]);
const PENDING_BROKEN_SPREAD_POLICY = "PENDING_MEASUREMENT; se congela en TR-04";

function resolvedBrokenSpreadPolicy(measurements) {
  const measured = measurements?.brokenSpreadPolicy?.value ?? null;
  return DECLARED_BROKEN_SPREAD_POLICIES.includes(measured) ? measured : PENDING_BROKEN_SPREAD_POLICY;
}

export const SOURCE_DECISION_STATUS = Object.freeze({
  PENDING_ARCHIVE_VERIFICATION: "PENDING_ARCHIVE_VERIFICATION",
  DECIDED: "DECIDED",
  DECIDED_FALLBACK_LAKE: "DECIDED_FALLBACK_LAKE",
  BLOCKED_NO_SOURCE: "BLOCKED_NO_SOURCE",
});

// Artefactos que quedan stale si la fuente elegida no es el lago actual. El
// benchmark B de BT-01 se construyó sobre las tablas del lago (IMP-05/BT-01);
// cambiar de fuente obliga a declararlo stale y reconstruirlo.
export const LAKE_DERIVED_ARTIFACTS = Object.freeze([
  {
    id: "BT-01-CAMPAIGN-BENCHMARKS",
    paths: [
      "operations/audit/BT-01/campaign-provisional-benchmarks-BT-01.json",
      "operations/audit/BT-01/v2/campaign-provisional-benchmarks-BT-01.json",
    ],
    reason: "B provisional construido desde las tablas del lago EEX; si TRADES adopta el archivo del cliente como fuente canónica, B debe declararse stale y reconstruirse con esa fuente.",
  },
  {
    id: "IMP-05-LAKE-PROXY-ROWS",
    paths: [
      "operations/audit/IMP-05/lake-proxy-rows-IMP-05.json",
      "operations/audit/IMP-05/lake-proxy-rows-IMP-05-v2.json",
    ],
    reason: "Filas proxy extraídas del lago EEX; quedan stale si la fuente canónica de trades deja de ser el lago.",
  },
]);

function requireCandidate(candidates, id) {
  return candidates.find((candidate) => candidate.id === id) ?? null;
}

// Tablas de un inventario. El escaneo del archivo reporta `tableInventory`
// (inventario separado de eex_derivative_reference, que NO se emite como trade);
// los inventarios de directorio del lago traen `tables`. Se aceptan ambas formas
// para que la comparación no quede sesgada hacia el lago por una fuente que sí
// aporta la tabla de referencia.
function inventoryTables(inventory) {
  if (!inventory) return [];
  if (Array.isArray(inventory.tables)) return inventory.tables;
  if (inventory.tableInventory && typeof inventory.tableInventory === "object") {
    return Object.keys(inventory.tableInventory);
  }
  return [];
}

// Compara inventarios lago vs archivo con criterios declarados. Devuelve
// `satisfiesArchivePreference` y las diferencias observadas. No decide por sí
// sola: la decisión la toma buildDataSourceDecision.
export function compareSourceInventories({ lakeInventory, archiveInventory }) {
  const differences = [];
  if (!lakeInventory || !archiveInventory) {
    return { comparable: false, satisfiesArchivePreference: false, differences: ["inventario ausente"] };
  }
  const lakeMaxDate = lakeInventory.dateMax ?? null;
  const archiveMaxDate = archiveInventory.dateMax ?? null;
  // Fail-closed: una fecha ausente no deja pasar la comparación. El `_meta` del
  // archivo puede no traer `dateMax`; sin fecha no se puede afirmar que el
  // archivo no pierde cobertura, así que cuenta como diferencia.
  if (archiveMaxDate === null) differences.push("archive.dateMax ausente");
  if (lakeMaxDate === null) differences.push("lake.dateMax ausente");
  if (archiveMaxDate !== null && lakeMaxDate !== null && archiveMaxDate < lakeMaxDate) {
    differences.push("archive.dateMax < lake.dateMax");
  }
  const archiveTables = inventoryTables(archiveInventory);
  const lakeTables = inventoryTables(lakeInventory);
  const archiveHasReference = archiveTables.includes("eex_derivative_reference");
  const lakeHasReference = lakeTables.includes("eex_derivative_reference");
  if (!archiveHasReference && !lakeHasReference) {
    differences.push("ninguna fuente aporta eex_derivative_reference");
  }
  return {
    comparable: true,
    archiveAddsReference: archiveHasReference && !lakeHasReference,
    satisfiesArchivePreference: differences.length === 0,
    differences,
  };
}

export function buildDataSourceDecision({
  candidates = [],
  comparison = null,
  measurements = null,
  decidedBy = "TR-01 producer",
  decidedAtUtc = null,
} = {}) {
  const lake = requireCandidate(candidates, SOURCE_IDS.EEX_LAKE);
  const archive = requireCandidate(candidates, SOURCE_IDS.CLIENT_SEALED_ARCHIVE);
  if (lake === null) throw new TypeError("Falta el candidato EEX_LAKE.");

  const archiveVerified = Boolean(archive?.present && archive?.sha256Verified);
  const base = {
    artifactKind: "TR-01_DATA_SOURCE_DECISION",
    schemaVersion: "1.0",
    decidedBy,
    decidedAtUtc,
    eligibilityRule: "OWNER_PATCH_TRADES_MODE_2026-09-25.md §3.1",
    brokenSpreadPolicy: resolvedBrokenSpreadPolicy(measurements),
    dedupRule: "sha256 de todas las columnas de mercado (no `_`); misma convención que IMP-05 v2 / BT-01 v2",
    deleteTmSemantics: "deletion-time (medido en TR-01)",
    measurements: measurements ?? null,
    candidates: candidates.map(({ id, path, kind, present, sha256, sha256Verified, inventory }) => ({
      id,
      path,
      kind,
      present: Boolean(present),
      sha256: sha256 ?? null,
      sha256Verified: Boolean(sha256Verified),
      inventory: inventory ?? null,
    })),
  };

  if (!lake.present && !archiveVerified) {
    return {
      ...base,
      status: SOURCE_DECISION_STATUS.BLOCKED_NO_SOURCE,
      selectedSource: null,
      failClosed: true,
      staleArtifacts: [],
      blocking: {
        reason: "Ni el lago ni el archivo verificado están disponibles.",
        requiredAction: "Verificar disponibilidad del lago EEX o completar y verificar el SHA-256 del archivo del cliente.",
      },
    };
  }

  if (!archiveVerified) {
    const reason = archive?.present
      ? "El archivo del cliente está presente pero su SHA-256 no está verificado."
      : "El archivo del cliente no está presente.";
    return {
      ...base,
      status: SOURCE_DECISION_STATUS.PENDING_ARCHIVE_VERIFICATION,
      selectedSource: SOURCE_IDS.EEX_LAKE,
      selectedSourceRole: "PROVISIONAL_ONLY",
      failClosed: true,
      comparison: comparison ?? null,
      staleArtifacts: [],
      blocking: {
        reason,
        requiredAction: "Completar la descarga del archivo sellado, verificar su SHA-256 contra el hash declarado y correr el job de escaneo de TR-01 (inventario + comparación lago/archivo).",
        scanJob: "operations/trades/TR-01/extract-trades-rows.py",
      },
    };
  }

  const effectiveComparison = comparison ?? compareSourceInventories({
    lakeInventory: lake.inventory,
    archiveInventory: archive.inventory,
  });
  if (effectiveComparison.satisfiesArchivePreference) {
    return {
      ...base,
      status: SOURCE_DECISION_STATUS.DECIDED,
      selectedSource: SOURCE_IDS.CLIENT_SEALED_ARCHIVE,
      selectedSourceRole: "CANONICAL",
      failClosed: false,
      comparison: effectiveComparison,
      staleArtifacts: LAKE_DERIVED_ARTIFACTS,
    };
  }
  return {
    ...base,
    status: SOURCE_DECISION_STATUS.DECIDED_FALLBACK_LAKE,
    selectedSource: SOURCE_IDS.EEX_LAKE,
    selectedSourceRole: "CANONICAL",
    failClosed: false,
    comparison: effectiveComparison,
    staleArtifacts: [],
    reason: `El archivo verificado no cumple los criterios de preferencia: ${effectiveComparison.differences.join("; ")}`,
  };
}
