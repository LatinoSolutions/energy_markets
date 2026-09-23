// Capability assessment de herramientas REALES del entorno (entregable DEP-10
// de IMP-04) para el consumidor IMP-05. Fuente: SPEC v1.1.1 §6.4 ("se auditan
// permisos de uso y capacidades/contrato del backtesting existente"), §6.5
// (tooling reportado: `src/economic-calculation/benchmark.mjs`, aceptado en
// IMP-08, y `/home/op/apps/power-markets-explorer/scripts/generate_eex_snapshot.py`)
// y §25.1 IMP-04 ("Interfaces reales, fixtures sintéticos, constraints de
// uso"). Los hashes son de los bytes presentes en este worktree.

import {
  benchmarkB,
  proxyReference,
  selectBenchmarkReferences,
  selectDailyReference,
} from "../economic-calculation/index.mjs";
import { deriveToolingDecision, selectMinimumTooling } from "./decision.mjs";

// Capacidades que IMP-05 necesita, cada una con su fuente en la SPEC v1.1.1.
// Review IMP-04 2026-09-23: la lista anterior (3 capacidades, sin fuente)
// omitía la reconciliación official/proxy, el caso 0.01 y la lectura de
// referencias reales, y por eso sostenía un REUSE que no cubre §5.4.
export const IMP05_CAPABILITY_SOURCES = Object.freeze({
  "benchmark.calculate": "§25.1 IMP-05 acceptance «Media por día»; §5.3 B_t=(1/|D_t|)ΣR_d",
  "benchmark.coverage": "§25.1 IMP-05 output «coverage diario»; §5.3 cobertura separada del denominador",
  "benchmark.calendar.missing_dates": "§25.2.2 IMP-05 REQUIRES_AUDIT «DEP-01/03 [producto y calendario de benchmark]»; §5.3 «El calendario de fechas esperadas se conserva por separado» y «Fechas missing no se rellenan con cero ni desaparecen sin trazabilidad»",
  "benchmark.status.provisional": "§5.4 «Un cálculo reproducible con benchmark provisional conserva `BENCHMARK_PROVISIONAL`; no se eleva silenciosamente a evidencia oficial»",
  "benchmark.window.boundaries": "§25.1 IMP-05 acceptance «fronteras correctas»; §5.3 «El extremo inicial se incluye y el final se excluye»",
  "benchmark.window.derive": "§25.1 IMP-05 MUST NOT CHANGE «1-0-1/3-1-3»; §5.3 tabla [S-1 mes,S) y [Q-4 meses,Q-1 mes)",
  "reference.select": "§5.3 «La fila oficial válida tiene prioridad; entre correcciones oficiales prevalece el timestamp de proveedor más reciente»",
  "reference.proxy": "§5.2 R̂_d=0.75T̂+0.25M̂; §19.3.1 «Proxy 101»",
  "reconciliation.official_proxy": "§25.1 IMP-05 acceptance «sustitución oficial sin borrar proxy»; §5.4 «Se conservan ambos valores» y δ_d=R̂_d−R_d^official",
  "benchmark.version": "§25.1 IMP-05 output «B versionado»; §5.4 «La sustitución oficial sobre derivado cambia la versión de evaluación»; §19.3.1 «receipt previo preservado»",
  "official.value_0_01.treatment": "§25.1 IMP-05 acceptance «caso 0.01 investigado»; §5.4 0.01 como caso de audit, no regla canónica de rechazo; §19.3.1 «Oficial 0.01»",
  "reference.read.trades": "§25.1 IMP-05 input «Referencias por fecha»; §5.2 precios de trades p_i; §6.5 raíz eex_derivative_trade",
  "reference.read.top_of_book": "§25.1 IMP-05 input «Referencias por fecha»; §5.2 bid_j/ask_j; §6.5 raíz eex_derivative_top_of_book",
  "reference.read.official": "§25.2.2 IMP-05 REQUIRES_AUDIT DEP-06/07 «referencias y metadata utilizadas»; §5.3 R_d^official; §6.5 inventario sólo con raíces trade y top_of_book",
});

// La decisión técnica aplica "al soporte que consuma esa herramienta" (§25.2.2
// IMP-04), así que IMP-05 se divide en dos soportes con decisiones separadas:
// cálculo/reconciliación del benchmark y lectura de referencias reales.
export const IMP05_CALCULATION_CAPABILITIES = Object.freeze([
  "benchmark.calculate",
  "benchmark.coverage",
  "benchmark.calendar.missing_dates",
  "benchmark.status.provisional",
  "benchmark.window.boundaries",
  "benchmark.window.derive",
  "reference.select",
  "reference.proxy",
  "reconciliation.official_proxy",
  "benchmark.version",
  "official.value_0_01.treatment",
]);

export const IMP05_REFERENCE_READ_CAPABILITIES = Object.freeze([
  "reference.read.trades",
  "reference.read.top_of_book",
  "reference.read.official",
]);

// Herramienta 1: componente en repo, aceptado por IMP-08. Faltan, verificado
// contra el código: benchmarkB() recibe `expectedDates` como número y no
// devuelve qué fechas faltan; no emite status provisional ni versión de
// evaluación; ninguna función deriva ventanas 1-0-1/3-1-3 desde S/Q;
// selectDailyReference() devuelve sólo el valor elegido (no conserva ambos ni
// calcula δ_d). El caso 0.01 se trata por validez declarada, no por valor.
const IN_REPO_BENCHMARK = Object.freeze({
  componentId: "economic-calculation.benchmark",
  componentVersion: Object.freeze({
    contentHash: "bc0ce6adef42831da21c9339c6569018a8c6b03a587558372ace336d4f661528",
    algorithm: "sha256 de líneas ordenadas path+sha256 (versión semántica IMP-08 ST-08.5)",
  }),
  role: "Cálculo de benchmark B, selección de referencias diarias y proxy del entorno Energy Markets.",
  interfaceContract: Object.freeze({
    inputs: Object.freeze(["references", "expectedDates", "product", "windowStart", "windowEnd", "officialRows", "proxy", "tradesMean", "midpointsMean", "declaredValidity"]),
    outputs: Object.freeze([
      "B", "count", "coverage", "BAfterOfficialCorrection", "windowSelection",
      "referenceSelection", "excludedSelectionCount", "dailyReferenceValue", "dailyReferenceSource",
      "proxyValue", "proxySourceLabel", "official001Value", "official001UnknownValidityValue", "official001UnknownValiditySource",
    ]),
    capabilityOutputs: Object.freeze({
      "benchmark.calculate": Object.freeze(["B", "count", "BAfterOfficialCorrection"]), // benchmarkB()
      "benchmark.coverage": Object.freeze(["coverage"]), // benchmarkB().coverage
      "benchmark.window.boundaries": Object.freeze(["windowSelection"]), // selectBenchmarkReferences({windowStart, windowEnd})
      "reference.select": Object.freeze(["referenceSelection", "excludedSelectionCount", "dailyReferenceValue", "dailyReferenceSource"]), // selectBenchmarkReferences(), selectDailyReference()
      "reference.proxy": Object.freeze(["proxyValue", "proxySourceLabel"]), // proxyReference()
      "official.value_0_01.treatment": Object.freeze(["official001Value", "official001UnknownValidityValue", "official001UnknownValiditySource"]), // selectDailyReference() con validez declarada
    }),
  }),
  declaredCapabilities: Object.freeze([
    "benchmark.calculate",
    "benchmark.coverage",
    "benchmark.window.boundaries",
    "reference.select",
    "reference.proxy",
    "official.value_0_01.treatment",
  ]),
  usageRights: Object.freeze({
    status: "permitted",
    // Código propio del repo, sin licencia de terceros; el receipt IMP-08
    // acredita su aceptación (implementación sintética), no un permiso externo.
    evidenceRef: "src/economic-calculation/benchmark.mjs#sha256=0db32ff428fe41482904803664c448b9c3d984d234aff0a1bdfa91db34bc17c1 (autoría propia) + operations/receipts/IMP-08-IMP_RECEIPT.json#sha256=43b56173f021331a889393d3697f1ca8bdf40491e450798238044ac8decc9625",
  }),
  ipExposure: Object.freeze({
    assessment: "none",
    rationale: "Código propio del repo Energy Markets, aceptado en IMP-08; sin modelo propietario ni dependencias externas.",
  }),
  // Juicio de auditoría IMP-04 (no cita de la SPEC): lo que falta son
  // fórmulas cerradas de §5.3/§5.4 sobre salidas que el componente ya produce.
  minimallyExtendable: true,
  extensionRationale: "Las capacidades que faltan para el cálculo de IMP-05 son reglas cerradas de la SPEC sobre salidas que el componente ya produce: lista de fechas esperadas y missing trazadas (§5.3) sobre el conteo de benchmarkB(); ventanas 1-0-1/3-1-3 (§5.3) como límites [inicio,fin) que selectBenchmarkReferences ya aplica; δ_d y conservación de oficial y proxy (§5.4) sobre selectDailyReference(); status BENCHMARK_PROVISIONAL y versión de evaluación de B (§5.4) sobre benchmarkB(). No requieren motor nuevo. Aplica sólo al soporte de cálculo: el componente no lee datos.",
  limitations: Object.freeze([
    "La aceptación IMP-08 es implementación/fixtures sintéticos; no acredita benchmark de campaña real (DEP-08/09 pendientes).",
    "official.value_0_01.treatment cubre el tratamiento por validez declarada (0.01 válido se selecciona; validez unknown cae a proxy). classifyOfficialValidity() devuelve canonicalRejectionRule \"none\" para toda entrada, así que no es evidencia. Contrastar el guard reportado con la fuente aplicable (§19.3.1, §25.2.2 IMP-05) es trabajo de IMP-05 y exige reference.read.official.",
  ]),
  evidenceRefs: Object.freeze([
    Object.freeze({ kind: "accepted-receipt", ref: "operations/receipts/IMP-08-IMP_RECEIPT.json", sha256: "43b56173f021331a889393d3697f1ca8bdf40491e450798238044ac8decc9625" }),
    Object.freeze({ kind: "source", ref: "src/economic-calculation/benchmark.mjs", sha256: "0db32ff428fe41482904803664c448b9c3d984d234aff0a1bdfa91db34bc17c1" }),
    Object.freeze({ kind: "source", ref: "src/economic-calculation/reference.mjs", sha256: "c8597ac83ba540b0de8b64dc2907e0e7e7c32417a02e06ee442f29d5514e511b" }),
    Object.freeze({ kind: "source", ref: "src/economic-calculation/index.mjs", sha256: "04217b163082ac848a5088a2120fb201d32b64ab9e6737b2179e7b20da2e8d66" }),
  ]),
});

// Campos que la interfaz de un lector debe exponer para cubrir cada capacidad
// de lectura. §5.2: T̂ es la media de los precios p_i de los trades del
// producto y fecha exactos dentro de la ventana 17:05–17:15 (Power) /
// 17:00–17:15 (Gas), así que hacen falta precio y hora de CADA trade; M̂ usa
// m_j=(bid_j+ask_j)/2; §5.3 R_d^official es el settlement diario oficial.
// Review IMP-04 2026-09-23 (revisión 7): se declaraba reference.read.trades
// sobre una interfaz que sólo entrega velas 4H.
export const REFERENCE_READ_REQUIRED_OUTPUTS = Object.freeze({
  "reference.read.trades": Object.freeze(["trade.price", "trade.eventTime", "trade.instrument"]),
  "reference.read.top_of_book": Object.freeze(["topOfBook.bid", "topOfBook.ask", "topOfBook.eventTime", "topOfBook.instrument"]),
  "reference.read.official": Object.freeze(["official.dailySettlementPrice", "official.tradeDate", "official.instrument"]),
});

// Salidas de la interfaz real del lector EEX, leídas del script (bytes con el
// hash de componentVersion): el JSON escrito por main() tiene, por
// instrumento, los campos de `instruments[key] = {...}` y velas
// `candle = {...}` agregadas en cubos de 4H (bucket_time = 14400 s).
export const EEX_READER_INTERFACE_OUTPUTS = Object.freeze([
  "instrument.symbol", "instrument.label", "instrument.productCode", "instrument.productISIN",
  "instrument.commodity", "instrument.contractType", "instrument.deliveryStart", "instrument.deliveryEnd",
  "instrument.marketZone", "instrument.currency", "instrument.unit", "instrument.trades",
  "instrument.candles4h.time", "instrument.candles4h.open", "instrument.candles4h.high",
  "instrument.candles4h.low", "instrument.candles4h.close", "instrument.candles4h.volume",
]);

// Herramienta 2: script de lectura EEX reportado por el audit. Su QUERY lee y
// deduplica filas de `eex_derivative_trade` (DEBM/DEBQ/G0BM/G0BQ, sin Delete),
// pero su interfaz sólo emite velas 4H: precio y hora de cada trade no salen
// del script, así que NO cubre reference.read.trades. Tampoco lee top-of-book
// ni settlements oficiales. SPEC §6.5: "La presencia de archivos no acredita
// derechos/entitlements".
const EEX_READER = Object.freeze({
  componentId: "power-markets-explorer.generate_eex_snapshot",
  componentVersion: Object.freeze({
    contentHash: "01353f730d1bcba4a6cf83098b43914ee743212006aedf7ce8e548a95e491740",
    algorithm: "sha256 del archivo del script",
  }),
  role: "Lectura/compactado de particiones Parquet EEX de trades a snapshot JSON de velas 4H.",
  interfaceContract: Object.freeze({
    inputs: Object.freeze(["/srv/hot-data/EEX/table=eex_derivative_trade/cmdty=POWER/area=DE/**/*.parquet", "/srv/hot-data/EEX/table=eex_derivative_trade/cmdty=NATGAS/area=THE/**/*.parquet"]),
    outputs: EEX_READER_INTERFACE_OUTPUTS,
    outputFiles: Object.freeze(["public/eex-deby-candles.json", "static-dist/eex-deby-candles.json"]),
    capabilityOutputs: Object.freeze({
      "eex.snapshot.candles_4h": EEX_READER_INTERFACE_OUTPUTS,
    }),
  }),
  declaredCapabilities: Object.freeze(["eex.snapshot.candles_4h"]),
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
    "No cubre reference.read.trades: lee y deduplica trades internamente (CTE valid_trades), pero su interfaz sólo expone velas 4H; sin precio ni hora por trade no se puede calcular T̂ en la ventana 17:05–17:15 de §5.2.",
    "Exponer los trades deduplicados sería una extensión del script, no evaluada como mínima: sus derechos siguen unknown y top-of-book/oficial no los lee.",
  ]),
  evidenceRefs: Object.freeze([
    Object.freeze({ kind: "source", ref: "/home/op/apps/power-markets-explorer/scripts/generate_eex_snapshot.py", sha256: "01353f730d1bcba4a6cf83098b43914ee743212006aedf7ce8e548a95e491740" }),
    Object.freeze({ kind: "spec", ref: "docs/canonical/v1_1_1/PROCUREMENT_RESEARCH_CANONICAL_ENGINEERING_SPEC_v1_1_1.md", sha256: "666a9735d9daf62764582f017056171acae52070d18499b26c5c6e426cff3ef3" }),
  ]),
});

// Herramienta 3: "su entorno de lectura" (SPEC §6.5 «Tooling y benchmark»).
// HIPÓTESIS, no nombrada por §6.5 ni U-AUDIT: es el venv `.venv-data` del
// proyecto (DuckDB 1.5.5 MIT, pyarrow 25.0.1 Apache-2.0), porque el script
// importa duckdb y el python3 del sistema no lo tiene. Su read_parquet sobre la raíz de trades
// expone las columnas por trade que el script selecciona en el CTE `base`
// (Px, Tm, InstrumentISIN…), así que SÍ cubre reference.read.trades como motor
// de lectura. Top-of-book no se declara: §6.5 reporta "top-of-book añade
// bid/ask", pero no se inspeccionó su esquema (derechos unknown); es hipótesis.
export const EEX_READ_ENVIRONMENT_TRADE_COLUMNS = Object.freeze({
  "trade.price": "Px",
  "trade.eventTime": "Tm",
  "trade.instrument": "InstrumentISIN",
  "trade.tradeDate": "TrdDate",
  "trade.tradeId": "TrdID",
  "trade.size": "Sz",
  "trade.updateAction": "UpdtAct",
  "trade.retrievedAt": "_retrieved_at_utc",
  "trade.rowHash": "_row_sha256",
});

const EEX_READ_ENVIRONMENT = Object.freeze({
  componentId: "power-markets-explorer.venv-data.duckdb",
  componentVersion: Object.freeze({
    contentHash: "585ea64989741e6a35be3d3912dc8158c6ecac777857e666464428945a12fe8f",
    algorithm: "sha256 de duckdb-1.5.5.dist-info/RECORD (manifest de archivos instalados con sus hashes)",
  }),
  role: "Entorno de lectura del script EEX (identificación como .venv-data: hipótesis): DuckDB read_parquet sobre las particiones Parquet del lago EEX.",
  interfaceContract: Object.freeze({
    inputs: Object.freeze(["/srv/hot-data/EEX/table=eex_derivative_trade/cmdty=POWER/area=DE/**/*.parquet", "/srv/hot-data/EEX/table=eex_derivative_trade/cmdty=NATGAS/area=THE/**/*.parquet"]),
    outputs: Object.freeze(Object.keys(EEX_READ_ENVIRONMENT_TRADE_COLUMNS)),
    capabilityOutputs: Object.freeze({
      "reference.read.trades": Object.freeze(["trade.price", "trade.eventTime", "trade.instrument"]),
    }),
  }),
  declaredCapabilities: Object.freeze(["reference.read.trades"]),
  usageRights: Object.freeze({
    status: "unknown",
    // Las licencias del motor (MIT/Apache-2.0) no acreditan derechos sobre los
    // datos que lee.
    evidenceRef: "docs/canonical/v1_1_1/PROCUREMENT_RESEARCH_CANONICAL_ENGINEERING_SPEC_v1_1_1.md:626#la-presencia-de-archivos-no-acredita-derechos-entitlements",
  }),
  ipExposure: Object.freeze({
    assessment: "unknown",
    rationale: "Motor open-source (DuckDB MIT, pyarrow Apache-2.0), pero lee un producto de datos EEX cuyos entitlements e IP no están auditados.",
  }),
  minimallyExtendable: false,
  limitations: Object.freeze([
    "Derechos/entitlements del lago EEX pendientes (DEP-06/07/10): leer los archivos no acredita permiso.",
    "Que .venv-data sea el entorno de lectura que reporta §6.5 es hipótesis: ni la SPEC ni U-AUDIT lo nombran.",
    "reference.read.top_of_book no se declara: el esquema de eex_derivative_top_of_book no se inspeccionó; §6.5 sólo reporta que añade bid/ask.",
    "reference.read.official no aplica: §6.5 reporta sólo raíces trade y top_of_book, sin settlement oficial.",
    "Leer trades no aplica la ventana 17:05–17:15 ni el producto/fecha exactos de §5.2: esa consulta es trabajo de IMP-05.",
  ]),
  evidenceRefs: Object.freeze([
    Object.freeze({ kind: "source", ref: "/home/op/apps/power-markets-explorer/scripts/generate_eex_snapshot.py", sha256: "01353f730d1bcba4a6cf83098b43914ee743212006aedf7ce8e548a95e491740" }),
    Object.freeze({ kind: "installed-package", ref: "/home/op/apps/power-markets-explorer/.venv-data/lib/python3.13/site-packages/duckdb-1.5.5.dist-info/RECORD", sha256: "585ea64989741e6a35be3d3912dc8158c6ecac777857e666464428945a12fe8f" }),
    Object.freeze({ kind: "installed-package", ref: "/home/op/apps/power-markets-explorer/.venv-data/lib/python3.13/site-packages/pyarrow-25.0.1.dist-info/RECORD", sha256: "c2658c5e3b843700ad96e5173d6006a889edeaa2f4a8351118f64fb25a3b55ca" }),
    Object.freeze({ kind: "spec", ref: "docs/canonical/v1_1_1/PROCUREMENT_RESEARCH_CANONICAL_ENGINEERING_SPEC_v1_1_1.md", sha256: "666a9735d9daf62764582f017056171acae52070d18499b26c5c6e426cff3ef3" }),
  ]),
});

export const REAL_TOOLING_ASSESSMENTS = Object.freeze([IN_REPO_BENCHMARK, EEX_READER, EEX_READ_ENVIRONMENT]);

export const REAL_BENCHMARK_COMPONENT_ID = "economic-calculation.benchmark";
export const REAL_EEX_READER_COMPONENT_ID = "power-markets-explorer.generate_eex_snapshot";
export const REAL_EEX_READ_ENVIRONMENT_COMPONENT_ID = "power-markets-explorer.venv-data.duckdb";

// Inventario del tooling existente para IMP-05: SPEC v1.1.1 §6.5 «Tooling y
// benchmark» reporta el script EEX «y su entorno de lectura» y el benchmark
// de `src/economic-calculation/benchmark.mjs` (U-AUDIT, sources/
// AUDIT_INPUTS_ENERGY_MARKETS.md:100); los `Program.fs`/
// `HighResolutionProcurementModel.fs` externos «no se localizaron en el
// alcance del audit». Sin este inventario completo no se demuestra necesidad
// de construir (§25.1 IMP-04).
export const REAL_TOOLING_INVENTORY = Object.freeze({
  componentIds: Object.freeze([REAL_BENCHMARK_COMPONENT_ID, REAL_EEX_READER_COMPONENT_ID, REAL_EEX_READ_ENVIRONMENT_COMPONENT_ID]),
  evidenceRefs: Object.freeze([
    Object.freeze({ kind: "spec", ref: "docs/canonical/v1_1_1/PROCUREMENT_RESEARCH_CANONICAL_ENGINEERING_SPEC_v1_1_1.md#6.5-tooling-y-benchmark", sha256: "666a9735d9daf62764582f017056171acae52070d18499b26c5c6e426cff3ef3" }),
  ]),
});

export const REAL_SELECTION_EVIDENCE = Object.freeze([
  Object.freeze({ kind: "accepted-receipt", ref: "operations/receipts/IMP-08-IMP_RECEIPT.json", sha256: "43b56173f021331a889393d3697f1ca8bdf40491e450798238044ac8decc9625" }),
  Object.freeze({ kind: "spec", ref: "docs/canonical/v1_1_1/PROCUREMENT_RESEARCH_CANONICAL_ENGINEERING_SPEC_v1_1_1.md", sha256: "666a9735d9daf62764582f017056171acae52070d18499b26c5c6e426cff3ef3" }),
]);

// Entradas sintéticas permitidas, tomadas de los fixtures documentales de
// SPEC §19.3.1 («Referencias diarias 100 y 110 → B=105», «Corrección oficial
// 102→103; segunda fecha 110 → B nuevo=106.5», «Proxy 101», «Oficial 0.01»).
// La fila del 2026-01-07 no es accesible: se excluye y cuenta como fecha
// esperada sin referencia.
export const REAL_RECONCILIATION_REFERENCES = Object.freeze([
  Object.freeze({ date: "2026-01-05", selected: 100, accessible: true }),
  Object.freeze({ date: "2026-01-06", selected: 110, accessible: true }),
  Object.freeze({ date: "2026-01-07", selected: 120, accessible: false }),
]);
export const REAL_RECONCILIATION_EXPECTED_DATES = 3;

const OFFICIAL_CORRECTION_ROWS = Object.freeze([
  Object.freeze({ value: 102, providerTimestamp: "2026-01-05T17:30:00Z" }),
  Object.freeze({ value: 103, providerTimestamp: "2026-01-06T09:00:00Z" }),
]);
const OFFICIAL_0_01_ROWS = Object.freeze([
  Object.freeze({ value: 0.01, providerTimestamp: "2026-01-05T17:30:00Z", declaredValidity: "valid-under-explicit-fixture-assumption" }),
]);
const OFFICIAL_0_01_UNKNOWN_ROWS = Object.freeze([
  Object.freeze({ value: 0.01, providerTimestamp: "2026-01-05T17:30:00Z", declaredValidity: "unknown-under-explicit-fixture-assumption" }),
]);

function fixture(outputId, expectedValue, independentComputation) {
  return Object.freeze({ outputId, expectedValue, permitted: true, independentComputation });
}

const REAL_RECONCILIATION_FIXTURES = Object.freeze([
  fixture("B", 105, "§19.3.1: media manual (100+110)/2 = 105; la fila no accesible no entra"),
  fixture("count", 2, "conteo manual de referencias accesibles: 2"),
  fixture("coverage", "2/3", "cobertura manual incluidas/esperadas = 2/3"),
  fixture("BAfterOfficialCorrection", 106.5, "§19.3.1: corrección oficial 102→103 y segunda fecha 110: (103+110)/2 = 106.5"),
  fixture("windowSelection", Object.freeze(["2026-01-05"]), "§5.3: ventana [2026-01-05, 2026-01-06) incluye el inicio y excluye el fin"),
  fixture("referenceSelection", Object.freeze(["2026-01-05", "2026-01-06"]), "fechas accesibles ordenadas; excluida la del 2026-01-07"),
  fixture("excludedSelectionCount", 1, "filas no accesibles documentadas: sólo la del 2026-01-07 = 1"),
  fixture("dailyReferenceValue", 103, "§5.3: oficial con timestamp de proveedor más reciente (09:00 del 06 > 17:30 del 05) = 103, por encima del proxy 100"),
  fixture("dailyReferenceSource", "official", "§5.3: existe fila oficial válida → fuente oficial"),
  fixture("proxyValue", 101, "§19.3.1: 0.75×100 + 0.25×104 = 75 + 26 = 101"),
  fixture("proxySourceLabel", "proxy", "§5.2: trades y midpoints presentes → fórmula combinada"),
  fixture("official001Value", 0.01, "§5.4: 0.01 declarado válido se selecciona tal cual (sin proxy de respaldo); no es regla canónica rechazarlo"),
  fixture("official001UnknownValidityValue", 100, "§5.3/§5.4: 0.01 con validez unknown no es fila oficial válida; se usa la derivada (trades 100)"),
  fixture("official001UnknownValiditySource", "trades-only", "§5.2: sólo trades → etiqueta trades-only"),
]);

// Ejecuta el componente real y devuelve la evidencia cruda de reconciliación
// (salidas observadas + fixtures permitidos). El validador recalcula desde aquí.
export function buildRealToolingReconciliation({ componentId = REAL_BENCHMARK_COMPONENT_ID } = {}) {
  const benchmark = benchmarkB({
    references: REAL_RECONCILIATION_REFERENCES,
    expectedDates: REAL_RECONCILIATION_EXPECTED_DATES,
    requireAccessible: true,
  });
  const selection = selectBenchmarkReferences({ rows: REAL_RECONCILIATION_REFERENCES, requireAccessible: true });
  const windowed = selectBenchmarkReferences({ rows: REAL_RECONCILIATION_REFERENCES, windowStart: "2026-01-05", windowEnd: "2026-01-06" });
  const corrected = selectDailyReference({ officialRows: OFFICIAL_CORRECTION_ROWS, proxy: proxyReference({ tradesMean: 100 }) });
  const afterCorrection = benchmarkB({
    references: [
      { date: "2026-01-05", selected: corrected.value, accessible: true },
      { date: "2026-01-06", selected: 110, accessible: true },
    ],
    requireAccessible: true,
  });
  const proxy = proxyReference({ tradesMean: 100, midpointsMean: 104 });
  const official001 = selectDailyReference({ officialRows: OFFICIAL_0_01_ROWS });
  const official001Unknown = selectDailyReference({ officialRows: OFFICIAL_0_01_UNKNOWN_ROWS, proxy: proxyReference({ tradesMean: 100 }) });

  return {
    componentId,
    outputs: [
      { outputId: "B", value: benchmark.B },
      { outputId: "count", value: benchmark.count },
      { outputId: "coverage", value: benchmark.coverage },
      { outputId: "BAfterOfficialCorrection", value: afterCorrection.B },
      { outputId: "windowSelection", value: windowed.references.map((reference) => reference.date) },
      { outputId: "referenceSelection", value: selection.references.map((reference) => reference.date) },
      { outputId: "excludedSelectionCount", value: selection.excludedRows.length },
      { outputId: "dailyReferenceValue", value: corrected.value },
      { outputId: "dailyReferenceSource", value: corrected.source },
      { outputId: "proxyValue", value: proxy.value },
      { outputId: "proxySourceLabel", value: proxy.sourceLabel },
      { outputId: "official001Value", value: official001.value },
      { outputId: "official001UnknownValidityValue", value: official001Unknown.value },
      { outputId: "official001UnknownValiditySource", value: official001Unknown.source },
    ],
    fixtures: REAL_RECONCILIATION_FIXTURES.map((item) => ({ ...item, expectedValue: Array.isArray(item.expectedValue) ? [...item.expectedValue] : item.expectedValue })),
  };
}

// Decisión factual DEP-10 para los dos soportes de IMP-05.
export function deriveRealImp05ToolingDecisions() {
  return {
    calculation: selectMinimumTooling({
      requiredCapabilities: IMP05_CALCULATION_CAPABILITIES,
      assessments: REAL_TOOLING_ASSESSMENTS,
      auditInventory: REAL_TOOLING_INVENTORY,
      reconciliation: buildRealToolingReconciliation(),
      evidenceRefs: REAL_SELECTION_EVIDENCE,
    }),
    referenceRead: deriveToolingDecision({
      requiredCapabilities: IMP05_REFERENCE_READ_CAPABILITIES,
      assessments: REAL_TOOLING_ASSESSMENTS,
      auditInventory: REAL_TOOLING_INVENTORY,
    }),
  };
}
