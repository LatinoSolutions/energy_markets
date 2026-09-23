// Capability assessment de herramientas REALES del entorno (entregable DEP-10
// de IMP-04). Fuente: SPEC v1.1.1 §6.4 —"se auditan permisos de uso y
// capacidades/contrato del backtesting existente"—, §6.5 —tooling reportado:
// `src/economic-calculation/benchmark.mjs` (aceptado en IMP-08) y
// `/home/op/apps/power-markets-explorer/scripts/generate_eex_snapshot.py`— y
// §25.1 IMP-04 ("Interfaces reales, fixtures sintéticos, constraints de uso").
// A diferencia de las fixtures de test/, aquí interfaces y constraints son de
// componentes que existen; la reconciliación usa fixtures sintéticos permitidos
// con cómputo independiente. Los hashes citados son de los bytes presentes en
// este worktree; no se reafirma nada que la evidencia no sostenga (DEP-06/07/10:
// derechos del lago y benchmark de campaña siguen pendientes).

import { benchmarkB, selectBenchmarkReferences } from "../economic-calculation/benchmark.mjs";

// Capacidades que el consumidor de benchmark (IMP-05, SPEC §25.1) exige. Cada
// una corresponde a un export real de `src/economic-calculation/index.mjs`.
export const REAL_REQUIRED_CAPABILITIES = Object.freeze([
  "benchmark.calculate",
  "benchmark.coverage",
  "reference.select",
]);

// Herramienta 1 — componente en repo, aceptado por IMP-08. Interfaces reales:
// `benchmarkB()` y `selectBenchmarkReferences()`. Derechos: código propio del
// proyecto; sin modelo propietario ni dependencias de terceros. No expone IP.
const IN_REPO_BENCHMARK = Object.freeze({
  componentId: "economic-calculation.benchmark",
  componentVersion: Object.freeze({
    contentHash: "bc0ce6adef42831da21c9339c6569018a8c6b03a587558372ace336d4f661528",
    algorithm: "sha256 de líneas ordenadas path+sha256 (versión semántica IMP-08 ST-08.5)",
  }),
  role: "Cálculo de benchmark B y selección de referencias diarias del entorno Energy Markets.",
  interfaceContract: Object.freeze({
    inputs: Object.freeze(["references", "expectedDates", "product", "windowStart", "windowEnd"]),
    outputs: Object.freeze(["B", "count", "coverage", "referenceSelection", "excludedSelectionCount"]),
    // Cada capacidad requerida por IMP-05 queda ligada a las salidas que la
    // evidencian; sin esto `reference.select` se aprobaba sin reconciliar
    // (review IMP-04 2026-09-23).
    capabilityOutputs: Object.freeze({
      "benchmark.calculate": Object.freeze(["B", "count"]), // benchmarkB().B / .count
      "benchmark.coverage": Object.freeze(["coverage"]), // benchmarkB().coverage
      "reference.select": Object.freeze(["referenceSelection", "excludedSelectionCount"]), // fechas de selectBenchmarkReferences().references / excludedRows.length
    }),
  }),
  declaredCapabilities: Object.freeze([
    "benchmark.calculate", // benchmarkB() / benchmarkBFromRows()
    "benchmark.coverage", // benchmarkB().coverage contra expectedDates
    "reference.select", // selectBenchmarkReferences()
  ]),
  usageRights: Object.freeze({
    status: "permitted",
    // Derechos por autoría: código propio del repo, sin licencia de terceros.
    // El receipt IMP-08 acredita su aceptación (implementación sintética), no
    // un permiso externo; ambos quedan trazados.
    evidenceRef: "src/economic-calculation/benchmark.mjs#sha256=0db32ff428fe41482904803664c448b9c3d984d234aff0a1bdfa91db34bc17c1 (autoría propia) + operations/receipts/IMP-08-IMP_RECEIPT.json#sha256=43b56173f021331a889393d3697f1ca8bdf40491e450798238044ac8decc9625",
  }),
  ipExposure: Object.freeze({
    assessment: "none",
    rationale: "Código propio del repo Energy Markets, aceptado en IMP-08; sin modelo propietario ni dependencias externas.",
  }),
  minimallyExtendable: false,
  limitations: Object.freeze([
    "La aceptación IMP-08 es implementación/fixtures sintéticos; no acredita benchmark de campaña real (DEP-08/09 pendientes).",
  ]),
  evidenceRefs: Object.freeze([
    Object.freeze({ kind: "accepted-receipt", ref: "operations/receipts/IMP-08-IMP_RECEIPT.json", sha256: "43b56173f021331a889393d3697f1ca8bdf40491e450798238044ac8decc9625" }),
    Object.freeze({ kind: "source", ref: "src/economic-calculation/benchmark.mjs", sha256: "0db32ff428fe41482904803664c448b9c3d984d234aff0a1bdfa91db34bc17c1" }),
    Object.freeze({ kind: "source", ref: "src/economic-calculation/index.mjs", sha256: "04217b163082ac848a5088a2120fb201d32b64ab9e6737b2179e7b20da2e8d66" }),
  ]),
});

// Herramienta 2 — script de lectura EEX reportado por el audit. Se materializa
// su assessment pero NO es usable: la SPEC §6.5/§6.6 deja los derechos del lago
// y del tooling por auditar, y "datos legibles no prueban derechos". Se incluye
// para que la decisión no lo adopte silenciosamente.
const EEX_READER = Object.freeze({
  componentId: "power-markets-explorer.generate_eex_snapshot",
  componentVersion: Object.freeze({
    contentHash: "01353f730d1bcba4a6cf83098b43914ee743212006aedf7ce8e548a95e491740",
    algorithm: "sha256 del archivo del script",
  }),
  role: "Lectura/compactado de particiones Parquet EEX a snapshot JSON de candles 4H.",
  interfaceContract: Object.freeze({
    inputs: Object.freeze(["/srv/hot-data/EEX/table=eex_derivative_trade/cmdty=POWER/area=DE/**/*.parquet", "/srv/hot-data/EEX/table=eex_derivative_trade/cmdty=NATGAS/area=THE/**/*.parquet"]),
    outputs: Object.freeze(["public/eex-deby-candles.json", "static-dist/eex-deby-candles.json"]),
  }),
  declaredCapabilities: Object.freeze(["eex.snapshot.build"]),
  usageRights: Object.freeze({
    status: "unknown",
    evidenceRef: "docs/canonical/v1_1_1/PROCUREMENT_RESEARCH_CANONICAL_ENGINEERING_SPEC_v1_1_1.md:626#la-presencia-de-archivos-no-acredita-derechos-entitlements",
  }),
  ipExposure: Object.freeze({
    assessment: "unknown",
    rationale: "Producto de datos EEX: ni los entitlements ni la exposición de IP están auditados; no se presume permiso.",
  }),
  minimallyExtendable: false,
  limitations: Object.freeze([
    "Derechos/entitlements del lago EEX pendientes (DEP-06/07/10); el audit no acreditó permiso de uso.",
  ]),
  evidenceRefs: Object.freeze([
    Object.freeze({ kind: "source", ref: "/home/op/apps/power-markets-explorer/scripts/generate_eex_snapshot.py", sha256: "01353f730d1bcba4a6cf83098b43914ee743212006aedf7ce8e548a95e491740" }),
    Object.freeze({ kind: "spec", ref: "docs/canonical/v1_1_1/PROCUREMENT_RESEARCH_CANONICAL_ENGINEERING_SPEC_v1_1_1.md", sha256: "666a9735d9daf62764582f017056171acae52070d18499b26c5c6e426cff3ef3" }),
  ]),
});

export const REAL_TOOLING_ASSESSMENTS = Object.freeze([IN_REPO_BENCHMARK, EEX_READER]);

export const REAL_BENCHMARK_COMPONENT_ID = "economic-calculation.benchmark";

// Evidencia de auditoría que sostiene la selección de IMP-04.
export const REAL_SELECTION_EVIDENCE = Object.freeze([
  Object.freeze({ kind: "accepted-receipt", ref: "operations/receipts/IMP-08-IMP_RECEIPT.json", sha256: "43b56173f021331a889393d3697f1ca8bdf40491e450798238044ac8decc9625" }),
  Object.freeze({ kind: "spec", ref: "docs/canonical/v1_1_1/PROCUREMENT_RESEARCH_CANONICAL_ENGINEERING_SPEC_v1_1_1.md", sha256: "666a9735d9daf62764582f017056171acae52070d18499b26c5c6e426cff3ef3" }),
]);

// Entrada documentada y salidas esperadas por cómputo manual independiente.
// Los valores no se leen de la herramienta: 100, 102, 104 y 106 son cuatro
// referencias diarias sintéticas permitidas; la fila del 2026-01-08 no está
// marcada accesible, así que el esperado es media 102, conteo 3, cobertura 3/3
// y una selección que excluye esa fila.
export const REAL_RECONCILIATION_REFERENCES = Object.freeze([
  Object.freeze({ date: "2026-01-05", selected: 100, accessible: true }),
  Object.freeze({ date: "2026-01-06", selected: 102, accessible: true }),
  Object.freeze({ date: "2026-01-07", selected: 104, accessible: true }),
  Object.freeze({ date: "2026-01-08", selected: 106, accessible: false }),
]);
export const REAL_RECONCILIATION_EXPECTED_DATES = 3;

const REAL_RECONCILIATION_FIXTURES = Object.freeze([
  Object.freeze({
    outputId: "B",
    expectedValue: 102,
    permitted: true,
    independentComputation: "media aritmética manual (100+102+104)/3 = 102",
    tolerance: 0,
  }),
  Object.freeze({
    outputId: "count",
    expectedValue: 3,
    permitted: true,
    independentComputation: "conteo manual de tres referencias diarias",
    tolerance: 0,
  }),
  Object.freeze({
    outputId: "coverage",
    expectedValue: "3/3",
    permitted: true,
    independentComputation: "cobertura manual = incluidas/esperadas = 3/3",
    tolerance: 0,
  }),
  // Salida de la capacidad `reference.select` (selectBenchmarkReferences):
  // fechas seleccionadas, ordenadas, excluyendo la fila no accesible. El
  // cómputo manual es la lista ordenada de fechas accesibles documentadas;
  // sin este fixture la reconciliación no cubría la salida de la capacidad.
  Object.freeze({
    outputId: "referenceSelection",
    expectedValue: Object.freeze(["2026-01-05", "2026-01-06", "2026-01-07"]),
    permitted: true,
    independentComputation: "selección manual: ordenadas por fecha las filas accesibles documentadas, excluida la del 2026-01-08 (no accesible)",
    tolerance: 0,
  }),
  Object.freeze({
    outputId: "excludedSelectionCount",
    expectedValue: 1,
    permitted: true,
    independentComputation: "conteo manual de filas no accesibles documentadas: sólo la del 2026-01-08 = 1",
    tolerance: 0,
  }),
]);

// Ejecuta el componente real y devuelve la evidencia cruda de reconciliación
// (salidas observadas + fixtures permitidos). El validador recalcula desde aquí,
// así que no se pasa ningún `reconciled: true` predeclarado.
export function buildRealToolingReconciliation({ componentId = REAL_BENCHMARK_COMPONENT_ID } = {}) {
  const result = benchmarkB({
    references: REAL_RECONCILIATION_REFERENCES,
    expectedDates: REAL_RECONCILIATION_EXPECTED_DATES,
    requireAccessible: true,
  });
  const selection = selectBenchmarkReferences({
    rows: REAL_RECONCILIATION_REFERENCES,
    requireAccessible: true,
  });
  return {
    componentId,
    outputs: [
      { outputId: "B", value: result.B },
      { outputId: "count", value: result.count },
      { outputId: "coverage", value: result.coverage },
      { outputId: "referenceSelection", value: selection.rejected ? [] : selection.references.map((reference) => reference.date) },
      { outputId: "excludedSelectionCount", value: selection.excludedRows.length },
    ],
    fixtures: REAL_RECONCILIATION_FIXTURES.map((fixture) => ({ ...fixture, expectedValue: Array.isArray(fixture.expectedValue) ? [...fixture.expectedValue] : fixture.expectedValue })),
  };
}
