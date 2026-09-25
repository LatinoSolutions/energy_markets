// Capability assessment de herramientas REALES del entorno (entregable DEP-10
// de IMP-04) para el consumidor IMP-05. Fuente: SPEC v1.1.1 §6.4 ("se auditan
// permisos de uso y capacidades/contrato del backtesting existente"), §6.5
// (tooling reportado: `src/economic-calculation/benchmark.mjs`, aceptado en
// IMP-08, y `/home/op/apps/power-markets-explorer/scripts/generate_eex_snapshot.py`)
// y §25.1 IMP-04 ("Interfaces reales, fixtures sintéticos, constraints de
// uso"). Los hashes son de los bytes presentes en este worktree. El hash de la
// SPEC (d1bb4172…) es el del doc canónico vigente tras el owner patch
// EM-SPEC-OWNER-PATCH-2026-09-24-01 (docs/canonical/v1_1_1/SHA256SUMS).

import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  benchmarkB,
  proxyReference,
  selectBenchmarkReferences,
  selectDailyReference,
} from "../economic-calculation/index.mjs";
import { deriveToolingDecision, selectMinimumTooling } from "./decision.mjs";
import { REFERENCE_READ_REQUIRED_OUTPUTS } from "./read-capabilities.mjs";
// Fuente única de la identidad de la SPEC (IMP-26): el hash previo al owner
// patch del 24-sep-2026 quedaba stale en este módulo.
import { CANONICAL_SPEC_IDENTITY } from "../office/spec-binding.mjs";

export { REFERENCE_READ_REQUIRED_OUTPUTS };

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
  "reference.select.validity_guard": "§5.3 «existe fila oficial válida»: la fila se selecciona sólo si su validez es declarada utilizable; una fila oficial sin declaración de validez no se selecciona como oficial (§19.3.1 «Oficial 0.01»: «Probar el guard reportado y contrastar validez aplicable»; revisión 11: sin este guard selectDailyReference() promueve por defecto una fila sin declaredValidity, y §5.3/§19.3.1 no lo admiten)",
  "reference.select.group_by_date_instrument": "§5.3 «Para cada fecha de negociación d se selecciona una referencia»: la corrección oficial más reciente se elige dentro de las filas de la fecha e instrumento pedidos, no entre filas mezcladas de otras fechas o instrumentos",
  "reference.proxy": "§5.2 R̂_d=0.75T̂+0.25M̂; §19.3.1 «Proxy 101»",
  "reference.proxy.rows.exact_product_date": "§5.2 «El proxy utiliza filas accesibles y deduplicadas del producto y fecha exactos»",
  "reference.proxy.rows.deduplicate": "§5.2 «El proxy utiliza filas accesibles y deduplicadas del producto y fecha exactos»",
  "reference.proxy.window.strict": "§5.2 «17:05–17:15 CE(S)T para German Power y 17:00–17:15 CE(S)T para Gas» y «Su materialización exige producto exacto, calendario y conversión UTC/DST según §6»",
  "reference.proxy.means": "§5.2 m_j=(bid_j+ask_j)/2, T̂=(1/n)Σp_i, M̂=(1/k)Σm_j",
  "reference.proxy.window.fallback": "§5.2 W_fallback={x:|t_x−17:15|≤60 minutos} y etiquetado «`nearby-60m` / `eex-derived-reference`»",
  "reconciliation.official_proxy": "§25.1 IMP-05 acceptance «sustitución oficial sin borrar proxy»; §5.4 «Se conservan ambos valores» y δ_d=R̂_d−R_d^official",
  "benchmark.version": "§25.1 IMP-05 output «B versionado»; §5.4 «La sustitución oficial sobre derivado cambia la versión de evaluación»; §19.3.1 «receipt previo preservado»",
  "official.value_0_01.treatment": "§25.1 IMP-05 acceptance «caso 0.01 investigado»; §5.4 0.01 como caso de audit, no regla canónica de rechazo; §19.3.1 «Oficial 0.01»",
  "reference.read.trades": "§25.1 IMP-05 input «Referencias por fecha»; §5.2 precios de trades p_i; §6.5 raíz eex_derivative_trade",
  "reference.read.top_of_book": "§25.1 IMP-05 input «Referencias por fecha»; §5.2 bid_j/ask_j; §6.5 raíz eex_derivative_top_of_book",
  "reference.read.official": "§25.2.2 IMP-05 REQUIRES_AUDIT DEP-06/07 «referencias y metadata utilizadas»; §5.3 R_d^official y «entre correcciones oficiales prevalece el timestamp de proveedor más reciente»; §6.5 inventario sólo con raíces trade y top_of_book",
});

// La decisión técnica aplica "al soporte que consuma esa herramienta" (§25.2.2
// IMP-04), así que IMP-05 se divide en tres soportes con decisiones separadas:
// cálculo/reconciliación del benchmark, lectura de las filas EEX que alimentan
// el proxy (§5.2) y lectura del settlement oficial (§5.3), que es otra fuente
// (§5.2 «Se preservan tres valores diferentes»).
// Review IMP-04 2026-09-23 (revisión 8): el cálculo omitía obtener T̂/M̂ desde
// filas del producto y fecha exactos, deduplicadas, en ventana estricta y con
// fallback; la reconciliación partía de medias ya calculadas.
export const IMP05_CALCULATION_CAPABILITIES = Object.freeze([
  "benchmark.calculate",
  "benchmark.coverage",
  "benchmark.calendar.missing_dates",
  "benchmark.status.provisional",
  "benchmark.window.boundaries",
  "benchmark.window.derive",
  "reference.select",
  "reference.select.group_by_date_instrument",
  "reference.select.validity_guard",
  "reference.proxy",
  "reference.proxy.rows.exact_product_date",
  "reference.proxy.rows.deduplicate",
  "reference.proxy.window.strict",
  "reference.proxy.means",
  "reference.proxy.window.fallback",
  "reconciliation.official_proxy",
  "benchmark.version",
  "official.value_0_01.treatment",
]);

export const IMP05_REFERENCE_READ_CAPABILITIES = Object.freeze([
  "reference.read.trades",
  "reference.read.top_of_book",
]);

export const IMP05_OFFICIAL_READ_CAPABILITIES = Object.freeze([
  "reference.read.official",
]);

// Herramienta 1: componente en repo, aceptado por IMP-08. Faltan, verificado
// contra el código: benchmarkB() recibe `expectedDates` como número y no
// devuelve qué fechas faltan; no emite status provisional ni versión de
// evaluación; ninguna función deriva ventanas 1-0-1/3-1-3 desde S/Q;
// selectDailyReference() devuelve sólo el valor elegido (no conserva ambos ni
// calcula δ_d) y toma el máximo timestamp GLOBAL de `officialRows` sin acotar
// por fecha ni instrumento: §5.3 selecciona «para cada fecha de negociación d»
// dentro de las filas de esa fecha e instrumento (review IMP-04 2026-09-23,
// revisión 10). proxyReference() recibe `tradesMean`/`midpointsMean` ya
// calculadas. Sobre filas intradía de trades/top-of-book no hay filtro por
// producto (ShortCode+Maturity) y fecha, deduplicación por fila, ventana
// 17:05/17:00–17:15 CE(S)T con conversión desde Tm UTC, medias T̂/M̂ ni la
// regla de fallback (activar sólo con ventana estricta vacía y etiquetar
// nearby-60m). Sí existen piezas que la extensión reutiliza:
// isWithinWindow() ([inicio,fin)), isWithinFallbackWindow() (|t−17:15|≤60 min
// sobre hora local) y el filtro de producto y la deduplicación por fecha de
// selectBenchmarkReferences(), que operan sobre referencias diarias, no sobre
// filas intradía. El caso 0.01 se trata por validez declarada, no por valor.
const IN_REPO_BENCHMARK = Object.freeze({
  componentId: "economic-calculation.benchmark",
  componentVersion: Object.freeze({
    // Versión semántica IMP-08 ST-08.5 aceptada (receipts/IMP-08); se conserva
    // como versión de registro. Los bytes actuales incluyen el EXTEND IMP-05
    // (DEP-10 rev. 11) y se versionan aparte en postExtensionContentHash
    // (recomputable desde evidenceRefs; IMP05-PROV-01 review 2026-09-23).
    // Rebind 2026-09-25: ventana §5.2 con fracción de segundo y dedup por
    // observationKey (BT04-C1-PROXY-WINDOW-DEDUP) en index/reconciliation.
    contentHash: "bc0ce6adef42831da21c9339c6569018a8c6b03a587558372ace336d4f661528",
    contentHashAlgorithm: "sha256 de líneas ordenadas path+sha256 (versión semántica IMP-08 ST-08.5 aceptada)",
    postExtensionContentHash: "093648d17a9a6120e1c05422a98592fe6723a08b8281ec062642c229d77c4c7c",
    postExtensionContentHashAlgorithm: "sha256 de evidenceRefs ordenadas como «<sha256>  <path>\\n» (bytes actuales tras el EXTEND post-IMP-08)",
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
  // fórmulas cerradas de §5.2/§5.3/§5.4 sobre entradas o salidas que el
  // componente ya maneja.
  minimallyExtendable: true,
  extensionRationale: "Las capacidades que faltan para el cálculo de IMP-05 son reglas cerradas de la SPEC sobre entradas o salidas que el componente ya maneja: filtro por producto y fecha exactos, deduplicación, ventana estricta 17:05/17:00–17:15 CE(S)T, medias T̂ y M̂ y fallback ±60 min etiquetado (§5.2) producen las `tradesMean`/`midpointsMean` que proxyReference() ya combina, reutilizando isWithinWindow() e isWithinFallbackWindow(); lista de fechas esperadas y missing trazadas (§5.3) sobre el conteo de benchmarkB(); ventanas 1-0-1/3-1-3 (§5.3) como límites [inicio,fin) que selectBenchmarkReferences ya aplica; agrupar las filas oficiales por fecha e instrumento antes de aplicar la regla de corrección más reciente (§5.3, «para cada fecha de negociación d») sobre selectDailyReference(), que hoy toma el máximo global de filas mezcladas; δ_d y conservación de oficial y proxy (§5.4) sobre selectDailyReference(); status BENCHMARK_PROVISIONAL y versión de evaluación de B (§5.4) sobre benchmarkB(). No requieren motor nuevo. Aplica sólo al soporte de cálculo: el componente no lee datos; recibe las filas del soporte de lectura.",
  limitations: Object.freeze([
    "La aceptación IMP-08 es implementación/fixtures sintéticos; no acredita benchmark de campaña real (DEP-08/09 pendientes).",
    "official.value_0_01.treatment cubre el tratamiento por validez declarada (0.01 válido se selecciona; validez unknown cae a proxy). classifyOfficialValidity() devuelve canonicalRejectionRule \"none\" para toda entrada, así que no es evidencia. Contrastar el guard reportado con la fuente aplicable (§19.3.1, §25.2.2 IMP-05) es trabajo de IMP-05 y exige reference.read.official.",
    // Review IMP-04 2026-09-23 (revisión 11): el default de compatibilidad de
    // declaredValidity() promueve una fila sin declaración. No es una
    // capacidad demostrada: es desconocida como guard de §5.3 y entra en los
    // añadidos del EXTEND.
    "reference.select.validity_guard no está demostrada en el componente: declaredValidity() promueve por defecto una fila oficial sin declaredValidity (revisión 11, reproducido con fila 0.01), y §5.3 exige «fila oficial válida» con validez declarada. La extensión debe exigir declaración explícita utilizable antes de seleccionar.",
  ]),
  evidenceRefs: Object.freeze([
    Object.freeze({ kind: "accepted-receipt", ref: "operations/receipts/IMP-08-IMP_RECEIPT.json", sha256: "43b56173f021331a889393d3697f1ca8bdf40491e450798238044ac8decc9625" }),
    Object.freeze({ kind: "source", ref: "src/economic-calculation/benchmark.mjs", sha256: "0db32ff428fe41482904803664c448b9c3d984d234aff0a1bdfa91db34bc17c1" }),
    Object.freeze({ kind: "source", ref: "src/economic-calculation/index.mjs", sha256: "f4d93389ec359be2f1529a1794656331268195c6597a98361239461ec8fc2704" }),
    Object.freeze({ kind: "source", ref: "src/economic-calculation/reference.mjs", sha256: "c8597ac83ba540b0de8b64dc2907e0e7e7c32417a02e06ee442f29d5514e511b" }),
    Object.freeze({ kind: "source", ref: "src/economic-calculation/reconciliation.mjs", sha256: "50513d9ce288235204120bcdd4ac2a42e1993678144e58c66cc9ec860b853327" }),
  ]),
});

// Campos que la interfaz de un lector debe exponer para cubrir cada capacidad
// de lectura. §5.2: T̂ es la media de los precios p_i y M̂ la de
// m_j=(bid_j+ask_j)/2, sobre «filas accesibles y deduplicadas del producto y
// fecha exactos» dentro de la ventana 17:05–17:15 (Power) / 17:00–17:15 (Gas):
// hacen falta precio o bid/ask, hora, instrumento, producto (ShortCode +
// Maturity), fecha de negociación y hash de fila para deduplicar. §5.3
// R_d^official es el settlement diario oficial y «entre correcciones oficiales
// prevalece el timestamp de proveedor más reciente»: sin ese timestamp no se
// puede aplicar la selección, así que el lector oficial debe exponerlo.
// Review IMP-04 2026-09-23 (revisión 7): se declaraba reference.read.trades
// sobre una interfaz que sólo entrega velas 4H.
// Review IMP-04 2026-09-23 (revisión 9): reference.read.official omitía el
// timestamp de proveedor de §5.3 y ningún test lo detectaba.
// Review IMP-04 2026-09-23 (revisión 10): también debe acreditar la VALIDEZ de
// la fila (§5.3 «fila oficial válida»; §19.3.1 «Oficial 0.01»): sin
// `official.declaredValidity` una fila 0.01 sin declaración se selecciona como
// oficial. El contrato vive en ./read-capabilities.mjs y
// `validateCapabilityAssessment` rechaza un assessment de lectura que no
// exponga todas las salidas exigidas, conservando el bloqueo.

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

// Uso autorizado de los datos EEX disponibles: decisión del owner P-005
// (pizarrón de la Oficina, resuelta 2026-09-23T13:22:22.031Z), copiada literal
// en el archivo citado. No es un documento contractual ni acredita una fuente
// de settlement oficial.
export const EEX_DATA_USAGE_AUTHORIZATION = Object.freeze({
  kind: "owner-decision",
  ref: "operations/audit/IMP-04/OWNER-DECISION-P-005-EEX-RIGHTS.md",
  sha256: "874488c4a91a3813ab322a51c6ee1af4244d0391c6f467b382c9b0225cf8c564",
});
const EEX_DATA_USAGE_EVIDENCE = `${EEX_DATA_USAGE_AUTHORIZATION.ref}#sha256=${EEX_DATA_USAGE_AUTHORIZATION.sha256} (Bru P-005: «los datos EEX disponibles para Energy Markets están autorizados para este uso dentro del proyecto»)`;

// Herramienta 2: script de lectura EEX reportado por el audit. Su QUERY lee y
// deduplica filas de `eex_derivative_trade` (DEBM/DEBQ/G0BM/G0BQ, sin Delete),
// pero su interfaz sólo emite velas 4H: precio y hora de cada trade no salen
// del script, así que NO cubre reference.read.trades. Tampoco lee top-of-book
// ni settlements oficiales.
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
    status: "permitted",
    evidenceRef: EEX_DATA_USAGE_EVIDENCE,
  }),
  // Juicio de auditoría IMP-04, no afirmación de Bru.
  ipExposure: Object.freeze({
    assessment: "none",
    rationale: "Script del paquete privado power-markets-explorer (package.json \"private\": true) que se ejecuta localmente sobre archivos locales del lago; no usa modelo propietario de terceros ni envía datos fuera de BruNode.",
  }),
  minimallyExtendable: false,
  limitations: Object.freeze([
    "No cubre reference.read.trades: lee y deduplica trades internamente (CTE valid_trades), pero su interfaz sólo expone velas 4H; sin precio ni hora por trade no se puede calcular T̂ en la ventana 17:05–17:15 de §5.2.",
    "Su deduplicación (CTE `deduplicated`/`live_events`) sólo trata trades y es interna; no es la regla de §5.2 para top-of-book ni se expone como capacidad.",
    "El uso autorizado cubre los datos EEX disponibles (P-005); no acredita DATA_READY, PIT, calendario contractual ni vínculo al mandato (§6.5, DEP-06/07).",
  ]),
  evidenceRefs: Object.freeze([
    Object.freeze({ kind: "source", ref: "/home/op/apps/power-markets-explorer/scripts/generate_eex_snapshot.py", sha256: "01353f730d1bcba4a6cf83098b43914ee743212006aedf7ce8e548a95e491740" }),
    Object.freeze({ kind: "package-manifest", ref: "/home/op/apps/power-markets-explorer/package.json", sha256: "7b74c57654ddcb4465d526e8a04e428a7c9b78000b42a0898f26be0278d69037" }),
    EEX_DATA_USAGE_AUTHORIZATION,
    Object.freeze({ kind: "spec", ref: "docs/canonical/v1_1_1/PROCUREMENT_RESEARCH_CANONICAL_ENGINEERING_SPEC_v1_1_1.md", sha256: CANONICAL_SPEC_IDENTITY.sha256 }),
  ]),
});

// Herramienta 3: "su entorno de lectura" (SPEC §6.5 «Tooling y benchmark»).
// HIPÓTESIS, no nombrada por §6.5 ni U-AUDIT: es el venv `.venv-data` del
// proyecto (DuckDB 1.5.5 MIT, pyarrow 25.0.1 Apache-2.0), porque el script
// importa duckdb y el python3 del sistema no lo tiene. Columnas verificadas con
// DuckDB DESCRIBE sobre las particiones reales de EEX_LAKE_SCHEMA_SAMPLES
// (review IMP-04 2026-09-23, revisión 8: top-of-book se daba por no cubierto
// sin inspeccionar su esquema).
export const EEX_READ_ENVIRONMENT_TRADE_COLUMNS = Object.freeze({
  "trade.price": "Px",
  "trade.eventTime": "Tm",
  "trade.instrument": "InstrumentISIN",
  "trade.instrumentType": "InstrumentType",
  "trade.shortCode": "ShortCode",
  "trade.maturity": "Maturity",
  "trade.tradeDate": "TrdDate",
  "trade.tradeId": "TrdID",
  "trade.size": "Sz",
  "trade.updateAction": "UpdtAct",
  "trade.retrievedAt": "_retrieved_at_utc",
  "trade.rowHash": "_row_sha256",
});

export const EEX_READ_ENVIRONMENT_TOP_OF_BOOK_COLUMNS = Object.freeze({
  "topOfBook.bid": "BidPx",
  "topOfBook.ask": "AskPx",
  "topOfBook.eventTime": "Tm",
  "topOfBook.instrument": "InstrumentISIN",
  "topOfBook.instrumentType": "InstrumentType",
  "topOfBook.shortCode": "ShortCode",
  "topOfBook.maturity": "Maturity",
  "topOfBook.tradeDate": "TrdDate",
  "topOfBook.retrievedAt": "_retrieved_at_utc",
  "topOfBook.rowHash": "_row_sha256",
});

// Particiones reales inspeccionadas (2026-09-23) con el DuckDB del venv.
export const EEX_LAKE_SCHEMA_SAMPLES = Object.freeze([
  Object.freeze({ table: "eex_derivative_trade", ref: "/srv/hot-data/EEX/table=eex_derivative_trade/cmdty=NATGAS/area=THE/trd_date=2025-11-20/pull_id=f37a4cac7f0812684038cef091d7083dc3049e0dc188e8f47cd398488c2f19cc/part.parquet", sha256: "87af47d82a5af9238b92104539dacd860c872fb95c88c12e94292a0aadf0810f" }),
  Object.freeze({ table: "eex_derivative_top_of_book", ref: "/srv/hot-data/EEX/table=eex_derivative_top_of_book/cmdty=NATGAS/area=THE/trd_date=2025-11-20/pull_id=e01c6c9e189310e3a4bf798f7c328b64235218a210537ae3ca5b4362a3d4ce43/part.parquet", sha256: "8452f2afa426df01f0f871b11b28f95c3c9dd5c691087280bbff16937a116586" }),
  Object.freeze({ table: "eex_derivative_top_of_book", ref: "/srv/hot-data/EEX/table=eex_derivative_top_of_book/cmdty=POWER/area=DE/trd_date=2025-08-12/pull_id=2d7ccdf51049f3ac2e5dd111e38f379f065f8b13010048b13fbc632904815e66/part.parquet", sha256: "7337bfa59f57dbe0984b355f3bb3bad5a4b3933eff5830a837a80026610db9af" }),
]);

export const EEX_VENV_PYTHON = "/home/op/apps/power-markets-explorer/.venv-data/bin/python";

const EEX_READ_ENVIRONMENT_OUTPUTS = Object.freeze([
  ...Object.keys(EEX_READ_ENVIRONMENT_TRADE_COLUMNS),
  ...Object.keys(EEX_READ_ENVIRONMENT_TOP_OF_BOOK_COLUMNS),
]);

const EEX_READ_ENVIRONMENT = Object.freeze({
  componentId: "power-markets-explorer.venv-data.duckdb",
  componentVersion: Object.freeze({
    contentHash: "585ea64989741e6a35be3d3912dc8158c6ecac777857e666464428945a12fe8f",
    algorithm: "sha256 de duckdb-1.5.5.dist-info/RECORD (manifest de archivos instalados con sus hashes)",
  }),
  role: "Entorno de lectura del script EEX (identificación como .venv-data: hipótesis): DuckDB read_parquet sobre las particiones Parquet del lago EEX.",
  interfaceContract: Object.freeze({
    inputs: Object.freeze([
      "/srv/hot-data/EEX/table=eex_derivative_trade/cmdty=POWER/area=DE/**/*.parquet",
      "/srv/hot-data/EEX/table=eex_derivative_trade/cmdty=NATGAS/area=THE/**/*.parquet",
      "/srv/hot-data/EEX/table=eex_derivative_top_of_book/cmdty=POWER/area=DE/**/*.parquet",
      "/srv/hot-data/EEX/table=eex_derivative_top_of_book/cmdty=NATGAS/area=THE/**/*.parquet",
    ]),
    outputs: EEX_READ_ENVIRONMENT_OUTPUTS,
    capabilityOutputs: Object.freeze({
      "reference.read.trades": REFERENCE_READ_REQUIRED_OUTPUTS["reference.read.trades"],
      "reference.read.top_of_book": REFERENCE_READ_REQUIRED_OUTPUTS["reference.read.top_of_book"],
    }),
  }),
  declaredCapabilities: Object.freeze(["reference.read.trades", "reference.read.top_of_book"]),
  usageRights: Object.freeze({
    status: "permitted",
    // Las licencias del motor (MIT/Apache-2.0) no acreditan derechos sobre los
    // datos; los acredita P-005.
    evidenceRef: EEX_DATA_USAGE_EVIDENCE,
  }),
  // Juicio de auditoría IMP-04, no afirmación de Bru.
  ipExposure: Object.freeze({
    assessment: "none",
    rationale: "Motor open-source (DuckDB MIT y pyarrow Apache-2.0 según sus dist-info/METADATA) ejecutado localmente sobre archivos locales; no usa modelo propietario ni envía datos fuera de BruNode.",
  }),
  minimallyExtendable: false,
  limitations: Object.freeze([
    "Que .venv-data sea el entorno de lectura que reporta §6.5 es hipótesis: ni la SPEC ni U-AUDIT lo nombran.",
    "Lee filas crudas: todas las columnas son VARCHAR (verificado con DESCRIBE); el filtro por producto/fecha exactos, la deduplicación, la ventana 17:05/17:00–17:15 CE(S)T con conversión UTC/DST, las medias y el fallback de §5.2 son capacidades del soporte de cálculo.",
    "Top-of-book incluye spreads (InstrumentType «Futures Spread», verificado en la partición POWER/DE); el filtro de producto exacto debe excluirlos.",
    "reference.read.official no aplica: el lago sólo tiene las tablas eex_derivative_trade y eex_derivative_top_of_book, sin settlement oficial.",
    "El uso autorizado cubre los datos EEX disponibles (P-005); no acredita DATA_READY, PIT, calendario contractual ni vínculo al mandato (§6.5, DEP-06/07).",
  ]),
  evidenceRefs: Object.freeze([
    Object.freeze({ kind: "source", ref: "/home/op/apps/power-markets-explorer/scripts/generate_eex_snapshot.py", sha256: "01353f730d1bcba4a6cf83098b43914ee743212006aedf7ce8e548a95e491740" }),
    Object.freeze({ kind: "installed-package", ref: "/home/op/apps/power-markets-explorer/.venv-data/lib/python3.13/site-packages/duckdb-1.5.5.dist-info/RECORD", sha256: "585ea64989741e6a35be3d3912dc8158c6ecac777857e666464428945a12fe8f" }),
    Object.freeze({ kind: "installed-package", ref: "/home/op/apps/power-markets-explorer/.venv-data/lib/python3.13/site-packages/pyarrow-25.0.1.dist-info/RECORD", sha256: "c2658c5e3b843700ad96e5173d6006a889edeaa2f4a8351118f64fb25a3b55ca" }),
    ...EEX_LAKE_SCHEMA_SAMPLES.map(({ ref, sha256 }) => Object.freeze({ kind: "data-schema-sample", ref, sha256 })),
    EEX_DATA_USAGE_AUTHORIZATION,
    Object.freeze({ kind: "spec", ref: "docs/canonical/v1_1_1/PROCUREMENT_RESEARCH_CANONICAL_ENGINEERING_SPEC_v1_1_1.md", sha256: CANONICAL_SPEC_IDENTITY.sha256 }),
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
    Object.freeze({ kind: "spec", ref: "docs/canonical/v1_1_1/PROCUREMENT_RESEARCH_CANONICAL_ENGINEERING_SPEC_v1_1_1.md#6.5-tooling-y-benchmark", sha256: CANONICAL_SPEC_IDENTITY.sha256 }),
  ]),
});

export const REAL_SELECTION_EVIDENCE = Object.freeze([
  Object.freeze({ kind: "accepted-receipt", ref: "operations/receipts/IMP-08-IMP_RECEIPT.json", sha256: "43b56173f021331a889393d3697f1ca8bdf40491e450798238044ac8decc9625" }),
  Object.freeze({ kind: "spec", ref: "docs/canonical/v1_1_1/PROCUREMENT_RESEARCH_CANONICAL_ENGINEERING_SPEC_v1_1_1.md", sha256: CANONICAL_SPEC_IDENTITY.sha256 }),
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
// Revisión 11: fila oficial SIN declaración de validez. El componente la
// promueve por defecto (default de compatibilidad de declaredValidity());
// el fixture registra ese comportamiento observado y la capacidad de guard
// de §5.3 queda como añadido del EXTEND, no como capacidad cubierta.
const OFFICIAL_0_01_MISSING_VALIDITY_ROWS = Object.freeze([
  Object.freeze({ value: 0.01, providerTimestamp: "2026-01-05T17:30:00Z" }),
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
  // Review IMP-04 2026-09-23 (revisión 11): el componente PROMUEVE una fila
  // sin declaración de validez (default de compatibilidad); §5.3 exige fila
  // oficial VÁLIDA. El valor esperado registra el comportamiento real del
  // componente con cómputo manual independiente (fixture documental
  // sintético de §19.3.1); la capacidad de guard conforme a §5.3 es un
  // añadido del EXTEND, no una capacidad cubierta.
  fixture("official001MissingValidityValue", 0.01, "SINTHETIC §19.3.1: fila 0.01 SIN declaredValidity; el componente la promueve por defecto (comportamiento observado, con el default documentado en declaredValidity()), así que el valor observado es 0.01 como oficial. La capacidad de guard de §5.3 (reference.select.validity_guard) NO está demostrada: es añadido del EXTEND"),
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
  // Revisión 11: fila sin declaración de validez — el componente la promueve
  // por defecto; el guard conforme a §5.3 es un añadido del EXTEND.
  const official001Missing = selectDailyReference({ officialRows: OFFICIAL_0_01_MISSING_VALIDITY_ROWS, proxy: proxyReference({ tradesMean: 100 }) });

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
      { outputId: "official001MissingValidityValue", value: official001Missing.value },
    ],
    fixtures: REAL_RECONCILIATION_FIXTURES.map((item) => ({ ...item, expectedValue: Array.isArray(item.expectedValue) ? [...item.expectedValue] : item.expectedValue })),
  };
}

// Fixtures sintéticos para reconciliar el entorno de lectura (§25.1 IMP-04:
// «Interfaces reales, fixtures sintéticos»). Valores inventados y marcados
// SYNTHETIC, con la forma del lago (todas las columnas VARCHAR). pyarrow los
// escribe en Parquet con particiones hive como las del lago; DuckDB los lee
// con las mismas opciones que el script EEX. El esperado es el valor escrito,
// así que la comparación prueba que el lector devuelve cada columna sin
// alterarla.
const SYNTHETIC_TRADE_ROWS = Object.freeze([
  Object.freeze({ Px: "100.25", Tm: "2026-01-05T16:07:00.000000Z", InstrumentISIN: "SYNTHETIC-ISIN-DEBM-202602", InstrumentType: "Simple Instrument", ShortCode: "DEBM", Maturity: "202602", TrdDate: "2026-01-05", TrdID: "SYNTHETIC-T1", Sz: "1.0", UpdtAct: "New", _retrieved_at_utc: "2026-01-06T00:00:00.0000000+00:00", _row_sha256: "a".repeat(64) }),
  Object.freeze({ Px: "101.75", Tm: "2026-01-05T16:12:30.500000Z", InstrumentISIN: "SYNTHETIC-ISIN-DEBM-202602", InstrumentType: "Simple Instrument", ShortCode: "DEBM", Maturity: "202602", TrdDate: "2026-01-05", TrdID: "SYNTHETIC-T2", Sz: "2.0", UpdtAct: "Delete", _retrieved_at_utc: "2026-01-06T00:00:01.0000000+00:00", _row_sha256: "b".repeat(64) }),
]);
const SYNTHETIC_TOP_OF_BOOK_ROWS = Object.freeze([
  Object.freeze({ BidPx: "99.5", AskPx: "100.5", Tm: "2026-01-05T16:06:00.000000Z", InstrumentISIN: "SYNTHETIC-ISIN-DEBM-202602", InstrumentType: "Simple Instrument", ShortCode: "DEBM", Maturity: "202602", TrdDate: "2026-01-05", _retrieved_at_utc: "2026-01-06T00:00:02.0000000+00:00", _row_sha256: "c".repeat(64) }),
  Object.freeze({ BidPx: "-9.71", AskPx: "-9.25", Tm: "2026-01-05T16:14:59.999999Z", InstrumentISIN: "SYNTHETIC-ISIN-DEBM-SPREAD", InstrumentType: "Futures Spread", ShortCode: "DEBM", Maturity: "202602", TrdDate: "2026-01-05", _retrieved_at_utc: "2026-01-06T00:00:03.0000000+00:00", _row_sha256: "d".repeat(64) }),
]);

const EEX_READ_PROBE = String.raw`
import json, sys
from pathlib import Path
import duckdb
import pyarrow as pa
import pyarrow.parquet as pq

spec = json.load(sys.stdin)
root = Path(spec["dir"])
result = {}
for table in spec["tables"]:
    partition = root / f"table={table['name']}" / "cmdty=POWER" / "area=DE" / "trd_date=2026-01-05" / "pull_id=synthetic"
    partition.mkdir(parents=True)
    arrays = {column: pa.array([row[column] for row in table["rows"]], type=pa.string()) for column in table["columns"]}
    pq.write_table(pa.table(arrays), partition / "part.parquet")
    selected = ", ".join(table["columns"])
    source = str(root / f"table={table['name']}" / "**" / "*.parquet")
    relation = duckdb.execute(
        f"SELECT {selected} FROM read_parquet(?, hive_partitioning=true, union_by_name=true) ORDER BY _row_sha256",
        [source],
    )
    rows = relation.fetchall()
    result[table["name"]] = {column: [row[index] for row in rows] for index, column in enumerate(table["columns"])}
json.dump(result, sys.stdout)
`;

function readThroughEnvironment(python) {
  const directory = mkdtempSync(join(tmpdir(), "imp04-eex-read-"));
  try {
    const tables = [
      { name: "eex_derivative_trade", columns: Object.values(EEX_READ_ENVIRONMENT_TRADE_COLUMNS), rows: SYNTHETIC_TRADE_ROWS },
      { name: "eex_derivative_top_of_book", columns: Object.values(EEX_READ_ENVIRONMENT_TOP_OF_BOOK_COLUMNS), rows: SYNTHETIC_TOP_OF_BOOK_ROWS },
    ];
    const stdout = execFileSync(python, ["-c", EEX_READ_PROBE], { input: JSON.stringify({ dir: directory, tables }), encoding: "utf8" });
    return JSON.parse(stdout);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function syntheticFixtures(columnsByOutput, rows) {
  const sortedRows = [...rows].sort((left, right) => left._row_sha256.localeCompare(right._row_sha256));
  return Object.entries(columnsByOutput).map(([outputId, column]) => fixture(
    outputId,
    sortedRows.map((row) => row[column]),
    `valor sintético escrito con pyarrow en la columna ${column} (fixture sintético, §25.1 IMP-04), ordenado por _row_sha256`,
  ));
}

// Ejecuta el entorno de lectura real (DuckDB del venv) sobre los fixtures
// sintéticos y devuelve la evidencia cruda de reconciliación. `python` se
// inyecta sólo para probar el rechazo de un lector divergente.
export function buildEexReadEnvironmentReconciliation({ python = EEX_VENV_PYTHON } = {}) {
  const read = readThroughEnvironment(python);
  const outputsFor = (columnsByOutput, tableName) => Object.entries(columnsByOutput).map(([outputId, column]) => ({ outputId, value: read[tableName][column] }));
  return {
    componentId: REAL_EEX_READ_ENVIRONMENT_COMPONENT_ID,
    outputs: [
      ...outputsFor(EEX_READ_ENVIRONMENT_TRADE_COLUMNS, "eex_derivative_trade"),
      ...outputsFor(EEX_READ_ENVIRONMENT_TOP_OF_BOOK_COLUMNS, "eex_derivative_top_of_book"),
    ],
    fixtures: [
      ...syntheticFixtures(EEX_READ_ENVIRONMENT_TRADE_COLUMNS, SYNTHETIC_TRADE_ROWS),
      ...syntheticFixtures(EEX_READ_ENVIRONMENT_TOP_OF_BOOK_COLUMNS, SYNTHETIC_TOP_OF_BOOK_ROWS),
    ],
  };
}

export const REAL_READ_SELECTION_EVIDENCE = Object.freeze([
  EEX_DATA_USAGE_AUTHORIZATION,
  ...EEX_LAKE_SCHEMA_SAMPLES.map(({ ref, sha256 }) => Object.freeze({ kind: "data-schema-sample", ref, sha256 })),
  Object.freeze({ kind: "spec", ref: "docs/canonical/v1_1_1/PROCUREMENT_RESEARCH_CANONICAL_ENGINEERING_SPEC_v1_1_1.md", sha256: CANONICAL_SPEC_IDENTITY.sha256 }),
]);

// Búsqueda de la fuente oficial de settlement en fuentes canónicas y
// accesibles, como pide P-005 antes de preguntar a Bru. Ninguna la nombra.
export const EEX_LAKE_ROOT = "/srv/hot-data/EEX";
export const OFFICIAL_SETTLEMENT_SOURCE_SEARCH = Object.freeze([
  Object.freeze({ kind: "spec", ref: "docs/canonical/v1_1_1/PROCUREMENT_RESEARCH_CANONICAL_ENGINEERING_SPEC_v1_1_1.md", sha256: CANONICAL_SPEC_IDENTITY.sha256, finding: "§5.4 exige alinear el proxy «con un feed oficial o externo autorizado» sin nombrarlo; §6.5 sólo registra raíces eex_derivative_trade y eex_derivative_top_of_book." }),
  Object.freeze({ kind: "data-lake-listing", ref: EEX_LAKE_ROOT, finding: "El lago sólo contiene table=eex_derivative_trade y table=eex_derivative_top_of_book; no hay tabla de settlement." }),
  Object.freeze({ kind: "audit-input", ref: "docs/canonical/v1_1_1/sources/AUDIT_INPUTS_ENERGY_MARKETS.md", sha256: "96e0b76356f901acdaf4fed9634908818ecd4d78627955d7217792367143710f", finding: "§9 punto 3 lista «fuente oficial de settlement y sus revisiones/publication timestamps» como paquete externo pendiente." }),
  Object.freeze({ kind: "historical-provenance", ref: "/srv/hot-data/energy-markets/reference/documentation/eex-reference-price.md", sha256: "dfa9cfc8e84f27ea5440ff6c5968654999b71e0c6c7370ec6653178c8e71e260", finding: "D16 §4: la credencial recibió históricamente HTTP 403 en el endpoint de settlement «spr»; por eso existe el camino derivado." }),
  Object.freeze({ kind: "accepted-audit", ref: "operations/audit/IMP-03/audit-report.md", sha256: "3fad9a93ee235f1c3a6745365736071ebb214c4393cdd41fcb53c3355f95758d", finding: "IMP-03 registra el HTTP 403 histórico del endpoint de settlement como hallazgo, no como fuente disponible." }),
  Object.freeze({ ...EEX_DATA_USAGE_AUTHORIZATION, finding: "P-005 autoriza los datos EEX disponibles y declara que la fuente oficial concreta de settlement no fue especificada." }),
]);

// Soporte de lectura del settlement oficial. Ningún componente inventariado
// lo cubre y no hay fuente identificada: construir un lector sin saber qué
// feed, formato ni entitlement leer no es necesidad demostrada (§6.4), así que
// queda bloqueado (fail-closed). IMP-05 puede seguir con B provisional (§5.4,
// §25.2.2 IMP-05 «Un benchmark aún provisional conserva esa condición»).
// Revisión 11: el bloqueo distingue tres estados que no se equiparan —
// (a) hecho auditado DENTRO del inventario de §6.5 (ningún componente cubre
// la capacidad), (b) desconocido FUERA del inventario (su completitud
// descansa en §6.5/U-AUDIT, no en un escaneo del entorno: los componentes no
// inventariados son desconocidos, no ausentes) y (c) la dependencia externa
// P-007 (fuente autorizada de settlement, esperando al cliente), que bloquea
// IMP-05 pero NO convierte la capacidad en disponible ni fabrica su formato.
function deriveOfficialReadDecision() {
  const derived = deriveToolingDecision({
    requiredCapabilities: IMP05_OFFICIAL_READ_CAPABILITIES,
    assessments: REAL_TOOLING_ASSESSMENTS,
    auditInventory: REAL_TOOLING_INVENTORY,
  });
  if (derived.code !== "MISSING_NECESSITY") {
    return derived;
  }
  return {
    ok: false,
    code: "BLOCKED_PENDING_OFFICIAL_SETTLEMENT_SOURCE",
    message: "Ningún componente del inventario auditado (§6.5) lee settlement oficial y ninguna fuente canónica identifica el feed oficial autorizado: no se construye un lector para una fuente desconocida.",
    uncoveredCapabilities: [...IMP05_OFFICIAL_READ_CAPABILITIES],
    capabilityStatus: Object.fromEntries(IMP05_OFFICIAL_READ_CAPABILITIES.map((capability) => [capability, {
      auditedWithinInventory: "no cubierta por ningún componente del inventario auditado de §6.5 (hecho, verificado contra assessments e interfaz real)",
      unknownOutsideInventory: "componentes fuera del inventario de §6.5 no están auditados: su existencia es DESCONOCIDA, no ausente; la completitud del inventario descansa en §6.5/U-AUDIT",
      externalDependency: "P-007",
    }])),
    externalDependency: {
      id: "P-007",
      waitingOn: "cliente",
      blocks: "IMP-05",
      note: "La capacidad de leer/verificar la fuente oficial sigue sin demostrarse (REF: P-007, solicitud ya enviada); no se declara reader oficial disponible ni se fabrica formato/entitlement.",
    },
    derivationCode: derived.code,
    sourceSearch: OFFICIAL_SETTLEMENT_SOURCE_SEARCH,
    auditTrace: derived.auditTrace,
  };
}

// Decisión factual DEP-10 para los tres soportes de IMP-05.
export function deriveRealImp05ToolingDecisions() {
  return {
    calculation: selectMinimumTooling({
      requiredCapabilities: IMP05_CALCULATION_CAPABILITIES,
      assessments: REAL_TOOLING_ASSESSMENTS,
      auditInventory: REAL_TOOLING_INVENTORY,
      reconciliation: buildRealToolingReconciliation(),
      evidenceRefs: REAL_SELECTION_EVIDENCE,
    }),
    referenceRead: selectMinimumTooling({
      requiredCapabilities: IMP05_REFERENCE_READ_CAPABILITIES,
      assessments: REAL_TOOLING_ASSESSMENTS,
      auditInventory: REAL_TOOLING_INVENTORY,
      reconciliation: buildEexReadEnvironmentReconciliation(),
      evidenceRefs: REAL_READ_SELECTION_EVIDENCE,
    }),
    officialRead: deriveOfficialReadDecision(),
  };
}
