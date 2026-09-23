import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";

import { reconcileKeyOutputs } from "../../src/tooling-selection/reconciliation.mjs";
import { selectDailyReference } from "../../src/economic-calculation/index.mjs";
import { deriveToolingDecision, selectMinimumTooling, TOOLING_DECISION } from "../../src/tooling-selection/decision.mjs";
import { isCapabilityAssessmentUsable, validateCapabilityAssessment } from "../../src/tooling-selection/capability.mjs";
import {
  EEX_DATA_USAGE_AUTHORIZATION,
  EEX_LAKE_ROOT,
  EEX_LAKE_SCHEMA_SAMPLES,
  EEX_READ_ENVIRONMENT_TOP_OF_BOOK_COLUMNS,
  EEX_READ_ENVIRONMENT_TRADE_COLUMNS,
  EEX_READER_INTERFACE_OUTPUTS,
  EEX_VENV_PYTHON,
  IMP05_CALCULATION_CAPABILITIES,
  IMP05_CAPABILITY_SOURCES,
  IMP05_OFFICIAL_READ_CAPABILITIES,
  IMP05_REFERENCE_READ_CAPABILITIES,
  OFFICIAL_SETTLEMENT_SOURCE_SEARCH,
  REAL_BENCHMARK_COMPONENT_ID,
  REAL_EEX_READER_COMPONENT_ID,
  REAL_EEX_READ_ENVIRONMENT_COMPONENT_ID,
  REAL_READ_SELECTION_EVIDENCE,
  REAL_SELECTION_EVIDENCE,
  REAL_TOOLING_ASSESSMENTS,
  REAL_TOOLING_INVENTORY,
  REFERENCE_READ_REQUIRED_OUTPUTS,
  buildEexReadEnvironmentReconciliation,
  buildRealToolingReconciliation,
  deriveRealImp05ToolingDecisions,
} from "../../src/tooling-selection/real-tooling.mjs";

// DEP-10 de IMP-04 (SPEC v1.1.1 §6.4/§6.5, §25.1): capability assessment de
// componentes reales y decisión factual para los soportes que IMP-05 consume.

// Verificado contra src/economic-calculation/*.mjs: ninguna de estas existe
// como capacidad completa (ver comentario de IN_REPO_BENCHMARK).
const EXPECTED_ADDITIONS = [
  "benchmark.calendar.missing_dates",
  "benchmark.status.provisional",
  "benchmark.window.derive",
  "reference.proxy.rows.exact_product_date",
  "reference.proxy.rows.deduplicate",
  "reference.proxy.window.strict",
  "reference.proxy.means",
  "reference.proxy.window.fallback",
  "reconciliation.official_proxy",
  "benchmark.version",
];

const sha256Of = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");

function describeColumns(parquetPath) {
  const probe = "import duckdb, json, sys; print(json.dumps([row[0] for row in duckdb.execute(\"DESCRIBE SELECT * FROM read_parquet(?)\", [sys.argv[1]]).fetchall()]))";
  return JSON.parse(execFileSync(EEX_VENV_PYTHON, ["-c", probe, parquetPath], { encoding: "utf8" }));
}

const SPEC_PATH = "docs/canonical/v1_1_1/PROCUREMENT_RESEARCH_CANONICAL_ENGINEERING_SPEC_v1_1_1.md";
const EEX_SCRIPT_PATH = "/home/op/apps/power-markets-explorer/scripts/generate_eex_snapshot.py";
const EEX_VENV_SITE_PACKAGES = "/home/op/apps/power-markets-explorer/.venv-data/lib/python3.13/site-packages";
const INVENTORY_IDS = [REAL_BENCHMARK_COMPONENT_ID, REAL_EEX_READER_COMPONENT_ID, REAL_EEX_READ_ENVIRONMENT_COMPONENT_ID];

function assessmentFor(componentId) {
  return REAL_TOOLING_ASSESSMENTS.find((assessment) => assessment.componentId === componentId) ?? null;
}

function calculationSelection(overrides = {}) {
  return selectMinimumTooling({
    requiredCapabilities: IMP05_CALCULATION_CAPABILITIES,
    assessments: REAL_TOOLING_ASSESSMENTS,
    auditInventory: REAL_TOOLING_INVENTORY,
    reconciliation: buildRealToolingReconciliation(),
    evidenceRefs: REAL_SELECTION_EVIDENCE,
    ...overrides,
  });
}

test("IMP-05: cada capacidad requerida tiene fuente en la SPEC v1.1.1 y las secciones citadas existen", () => {
  const spec = readFileSync(SPEC_PATH, "utf8");
  const required = [...IMP05_CALCULATION_CAPABILITIES, ...IMP05_REFERENCE_READ_CAPABILITIES, ...IMP05_OFFICIAL_READ_CAPABILITIES];
  assert.deepEqual(Object.keys(IMP05_CAPABILITY_SOURCES).sort(), [...required].sort());
  for (const capability of required) {
    const source = IMP05_CAPABILITY_SOURCES[capability];
    const sections = source.match(/§\d+(\.\d+)*/g) ?? [];
    assert.ok(sections.length > 0, `${capability} sin sección citada`);
    for (const section of sections) {
      const heading = new RegExp(`^#{1,3} ${section.slice(1).replaceAll(".", "\\.")}[ .]`, "m");
      assert.match(spec, heading, `${capability} cita ${section}, que no existe en la SPEC v1.1.1`);
    }
  }
});

// Review IMP-04 2026-09-23: la lista anterior omitía estas capacidades de
// §25.1 IMP-05 / §5.4.
test("IMP-05: la reconciliación official/proxy, el caso 0.01 y la lectura de referencias reales son requeridas", () => {
  for (const capability of ["reconciliation.official_proxy", "benchmark.version", "official.value_0_01.treatment", "benchmark.window.derive", "benchmark.calendar.missing_dates", "benchmark.status.provisional"]) {
    assert.ok(IMP05_CALCULATION_CAPABILITIES.includes(capability), capability);
  }
  assert.deepEqual([...IMP05_REFERENCE_READ_CAPABILITIES], ["reference.read.trades", "reference.read.top_of_book"]);
  assert.deepEqual([...IMP05_OFFICIAL_READ_CAPABILITIES], ["reference.read.official"]);
});

// Review IMP-04 2026-09-23 (revisión 8): obtener T̂/M̂ desde filas es parte
// del cálculo que IMP-05 necesita (§5.2), no una media ya dada.
test("IMP-05: obtener las medias del proxy desde filas (producto/fecha exactos, dedup, ventana estricta, fallback) es requerido", () => {
  for (const capability of ["reference.proxy.rows.exact_product_date", "reference.proxy.rows.deduplicate", "reference.proxy.window.strict", "reference.proxy.means", "reference.proxy.window.fallback"]) {
    assert.ok(IMP05_CALCULATION_CAPABILITIES.includes(capability), capability);
    assert.match(IMP05_CAPABILITY_SOURCES[capability], /§5\.2/);
  }
  const spec = readFileSync(SPEC_PATH, "utf8");
  assert.ok(spec.includes("El proxy utiliza filas accesibles y deduplicadas del producto y fecha exactos"));
  assert.ok(spec.includes("`nearby-60m` / `eex-derived-reference`"));
});

// El benchmark aceptado en IMP-08 recibe medias ya calculadas y sus predicados
// de ventana no aplican la regla completa: por eso esas capacidades son
// añadidos del EXTEND, no capacidades cubiertas.
test("DEP-10: el benchmark en repo no calcula el proxy desde filas intradía", () => {
  const reference = readFileSync("src/economic-calculation/reference.mjs", "utf8");
  assert.match(reference, /export function proxyReference\(\{ tradesMean, midpointsMean \} = \{\}\)/);
  const calculation = ["benchmark.mjs", "reference.mjs", "index.mjs"].map((file) => readFileSync(`src/economic-calculation/${file}`, "utf8")).join("\n");
  for (const absent of ["nearby-60m", "eex-derived-reference", "17:05", "bid", "_row_sha256", "Europe/Berlin"]) {
    assert.ok(!calculation.includes(absent), `${absent} no aparece en economic-calculation`);
  }
  const benchmark = assessmentFor(REAL_BENCHMARK_COMPONENT_ID);
  for (const capability of EXPECTED_ADDITIONS) {
    assert.ok(!benchmark.declaredCapabilities.includes(capability), capability);
  }
  assert.match(benchmark.extensionRationale, /isWithinWindow\(\) e isWithinFallbackWindow\(\)/);
});

// Validación adversarial IMP-04 2026-09-23: quitar un componente del conjunto
// cambia la decisión. El inventario real es lo que reporta §6.5 «Tooling y
// benchmark» (script EEX «y su entorno de lectura», benchmark en repo), y la
// decisión exige haberlo auditado todo.
test("DEP-10: el inventario y el conjunto auditado son las herramientas reportadas en SPEC §6.5", () => {
  const spec = readFileSync(SPEC_PATH, "utf8");
  assert.ok(spec.includes("src/economic-calculation/benchmark.mjs"));
  assert.ok(spec.includes(`${EEX_SCRIPT_PATH}\` y su entorno de lectura como herramientas existentes`));
  assert.deepEqual([...REAL_TOOLING_INVENTORY.componentIds], INVENTORY_IDS);
  assert.equal(REAL_TOOLING_INVENTORY.evidenceRefs[0].sha256, createHash("sha256").update(readFileSync(SPEC_PATH)).digest("hex"));
  assert.deepEqual(REAL_TOOLING_ASSESSMENTS.map((assessment) => assessment.componentId), [...REAL_TOOLING_INVENTORY.componentIds]);
});

// Review IMP-04 2026-09-23 (revisión 7): sin auditar el lector EEX, la lectura
// salía BUILD con un assessment irrelevante. Con el inventario, retirar un
// componente inventariado deja la auditoría incompleta.
test("DEP-10: retirar del audit un componente inventariado impide decidir, también BUILD", () => {
  const onlyBenchmark = REAL_TOOLING_ASSESSMENTS.filter((assessment) => assessment.componentId === REAL_BENCHMARK_COMPONENT_ID);
  const outcome = deriveToolingDecision({
    requiredCapabilities: IMP05_REFERENCE_READ_CAPABILITIES,
    assessments: onlyBenchmark,
    auditInventory: REAL_TOOLING_INVENTORY,
    buildNecessity: { demonstrated: true, rationale: "Autodeclarada.", evidenceRefs: [{ kind: "audit", ref: "X" }] },
  });
  assert.equal(outcome.ok, false);
  assert.equal(outcome.code, "INVENTORY_NOT_AUDITED");
  assert.deepEqual(outcome.componentIds, [REAL_EEX_READER_COMPONENT_ID, REAL_EEX_READ_ENVIRONMENT_COMPONENT_ID]);

  const withoutInventory = deriveToolingDecision({
    requiredCapabilities: IMP05_REFERENCE_READ_CAPABILITIES,
    assessments: onlyBenchmark,
    buildNecessity: { demonstrated: true, rationale: "Autodeclarada.", evidenceRefs: [{ kind: "audit", ref: "X" }] },
  });
  assert.equal(withoutInventory.ok, false);
  assert.equal(withoutInventory.code, "MISSING_AUDIT_INVENTORY");
});

// Review IMP-04 2026-09-23 (revisión 7): la capacidad se comprueba contra la
// interfaz REAL del script, no contra la clasificación declarada.
test("DEP-10: la interfaz real del lector EEX son velas 4H, leída del script con el hash evaluado", () => {
  const scriptBytes = readFileSync(EEX_SCRIPT_PATH);
  const reader = assessmentFor(REAL_EEX_READER_COMPONENT_ID);
  assert.equal(createHash("sha256").update(scriptBytes).digest("hex"), reader.componentVersion.contentHash, "el script cambió: rehacer el assessment");

  const script = scriptBytes.toString("utf8");
  const dictKeys = (opening) => {
    const start = script.indexOf(opening);
    assert.ok(start >= 0, opening);
    const body = script.slice(start + opening.length, script.indexOf("}", start));
    return [...body.matchAll(/"(\w+)":/g)].map((match) => match[1]);
  };
  const instrumentKeys = dictKeys("instruments[key] = {").filter((key) => key !== "candles4h");
  const candleKeys = dictKeys("candle = {");
  assert.deepEqual(candleKeys, ["time", "open", "high", "low", "close", "volume"]);
  assert.match(script, /floor\(epoch\(event_time\) \/ 14400\)/, "las velas agregan en cubos de 4H");
  assert.deepEqual(
    [...EEX_READER_INTERFACE_OUTPUTS],
    [...instrumentKeys.map((key) => `instrument.${key}`), ...candleKeys.map((key) => `instrument.candles4h.${key}`)],
  );
  assert.deepEqual([...reader.interfaceContract.outputs], [...EEX_READER_INTERFACE_OUTPUTS]);
});

// Validación adversarial IMP-04 2026-09-23: §6.5 también reporta «su entorno
// de lectura». Es el venv del script (DuckDB 1.5.5 + pyarrow 25.0.1).
// Review revisión 8: top-of-book se clasificaba sin inspeccionar su esquema;
// ahora las columnas de trades y top-of-book se comprueban con DuckDB DESCRIBE
// sobre particiones reales del lago con hash.
test("DEP-10: el entorno de lectura (venv DuckDB) expone trades y top-of-book, verificado sobre el esquema real del lago", () => {
  const environment = assessmentFor(REAL_EEX_READ_ENVIRONMENT_COMPONENT_ID);
  const record = readFileSync(`${EEX_VENV_SITE_PACKAGES}/duckdb-1.5.5.dist-info/RECORD`);
  assert.equal(createHash("sha256").update(record).digest("hex"), environment.componentVersion.contentHash, "DuckDB instalado cambió: rehacer el assessment");
  for (const ref of environment.evidenceRefs) {
    if (ref.ref.startsWith("/")) {
      assert.equal(sha256Of(ref.ref), ref.sha256, ref.ref);
    }
  }

  const columnsByTable = {
    eex_derivative_trade: Object.values(EEX_READ_ENVIRONMENT_TRADE_COLUMNS),
    eex_derivative_top_of_book: Object.values(EEX_READ_ENVIRONMENT_TOP_OF_BOOK_COLUMNS),
  };
  assert.deepEqual([...new Set(EEX_LAKE_SCHEMA_SAMPLES.map((sample) => sample.table))].sort(), Object.keys(columnsByTable).sort());
  for (const sample of EEX_LAKE_SCHEMA_SAMPLES) {
    assert.equal(sha256Of(sample.ref), sample.sha256, sample.ref);
    const described = describeColumns(sample.ref);
    for (const column of columnsByTable[sample.table]) {
      assert.ok(described.includes(column), `${sample.table} expone ${column}`);
    }
  }
  assert.deepEqual([...environment.interfaceContract.outputs], [...Object.keys(EEX_READ_ENVIRONMENT_TRADE_COLUMNS), ...Object.keys(EEX_READ_ENVIRONMENT_TOP_OF_BOOK_COLUMNS)]);
  assert.deepEqual([...environment.declaredCapabilities], ["reference.read.trades", "reference.read.top_of_book"]);
  assert.equal(isCapabilityAssessmentUsable(environment).usable, true);

  const metadata = (name) => readFileSync(`${EEX_VENV_SITE_PACKAGES}/${name}/METADATA`, "utf8");
  assert.match(metadata("duckdb-1.5.5.dist-info"), /License :: OSI Approved :: MIT License/);
  assert.match(metadata("pyarrow-25.0.1.dist-info"), /License-Expression: Apache-2\.0/);
});

test("DEP-10: ningún componente real declara una capacidad de lectura que su interfaz no expone", () => {
  for (const assessment of REAL_TOOLING_ASSESSMENTS) {
    for (const capability of [...IMP05_REFERENCE_READ_CAPABILITIES, ...IMP05_OFFICIAL_READ_CAPABILITIES]) {
      const requiredOutputs = REFERENCE_READ_REQUIRED_OUTPUTS[capability];
      const exposesAll = requiredOutputs.every((outputId) => assessment.interfaceContract.outputs.includes(outputId));
      assert.equal(assessment.declaredCapabilities.includes(capability), exposesAll, `${assessment.componentId} / ${capability}`);
    }
  }
  const reader = assessmentFor(REAL_EEX_READER_COMPONENT_ID);
  assert.ok(!reader.declaredCapabilities.includes("reference.read.trades"));
});

// Review IMP-04 2026-09-23 (revisión 8): las capacidades declaradas deben
// comprobarse contra la fuente real, no darse por buenas. El mismo principio
// aplica a la procedencia: todo hash de evidencia de cada assessment se
// comprueba contra los bytes reales. Antes, los hashes del benchmark
// (benchmark.mjs, reference.mjs, index.mjs y el receipt IMP-08) no se
// verificaban en ningún test.
test("DEP-10: cada hash de procedencia declarado por un assessment coincide con los bytes reales", () => {
  for (const assessment of REAL_TOOLING_ASSESSMENTS) {
    for (const ref of assessment.evidenceRefs) {
      if (ref.sha256 !== undefined) {
        assert.equal(sha256Of(ref.ref), ref.sha256, `${assessment.componentId} / ${ref.ref}`);
      }
    }
  }
});

// Bru P-005 (2026-09-23): los datos EEX disponibles están autorizados para este
// uso dentro del proyecto. La evidencia es el registro literal de esa decisión.
test("DEP-10: los assessments reales son válidos y usables; el uso de datos EEX lo acredita la decisión P-005", () => {
  for (const assessment of REAL_TOOLING_ASSESSMENTS) {
    assert.equal(validateCapabilityAssessment(assessment).ok, true, assessment.componentId);
    assert.equal(isCapabilityAssessmentUsable(assessment).usable, true, assessment.componentId);
  }

  assert.equal(sha256Of(EEX_DATA_USAGE_AUTHORIZATION.ref), EEX_DATA_USAGE_AUTHORIZATION.sha256);
  const decision = readFileSync(EEX_DATA_USAGE_AUTHORIZATION.ref, "utf8");
  assert.ok(decision.includes("los datos EEX disponibles para Energy Markets están autorizados para este"));
  assert.ok(decision.includes("La fuente oficial concreta de settlement no fue especificada por Bru"));
  for (const componentId of [REAL_EEX_READER_COMPONENT_ID, REAL_EEX_READ_ENVIRONMENT_COMPONENT_ID]) {
    const assessment = assessmentFor(componentId);
    assert.ok(assessment.usageRights.evidenceRef.startsWith(`${EEX_DATA_USAGE_AUTHORIZATION.ref}#sha256=${EEX_DATA_USAGE_AUTHORIZATION.sha256}`), componentId);
    assert.ok(assessment.evidenceRefs.includes(EEX_DATA_USAGE_AUTHORIZATION), componentId);
  }
  const reader = assessmentFor(REAL_EEX_READER_COMPONENT_ID);
  for (const ref of reader.evidenceRefs.filter((item) => item.ref.startsWith("/"))) {
    assert.equal(sha256Of(ref.ref), ref.sha256, ref.ref);
  }
  assert.equal(JSON.parse(readFileSync("/home/op/apps/power-markets-explorer/package.json", "utf8")).private, true);
});

test("DEP-10: las salidas reales del componente coinciden con los fixtures documentales de §19.3.1", () => {
  const reconciliation = buildRealToolingReconciliation();
  assert.deepEqual(
    Object.fromEntries(reconciliation.outputs.map((output) => [output.outputId, output.value])),
    {
      B: 105,
      count: 2,
      coverage: "2/3",
      BAfterOfficialCorrection: 106.5,
      windowSelection: ["2026-01-05"],
      referenceSelection: ["2026-01-05", "2026-01-06"],
      excludedSelectionCount: 1,
      dailyReferenceValue: 103,
      dailyReferenceSource: "official",
      proxyValue: 101,
      proxySourceLabel: "proxy",
      official001Value: 0.01,
      official001UnknownValidityValue: 100,
      official001UnknownValiditySource: "trades-only",
    },
  );
  const benchmark = assessmentFor(REAL_BENCHMARK_COMPONENT_ID);
  const recomputed = reconcileKeyOutputs({ ...reconciliation, keyOutputs: benchmark.interfaceContract.outputs });
  assert.equal(recomputed.reconciled, true, JSON.stringify(recomputed));
});

// Review IMP-04 2026-09-23: el REUSE anterior no cubría §5.4. Con la lista
// completa el componente no es suficiente: la decisión es EXTEND y añade
// exactamente las capacidades que el código no tiene.
test("DEP-10: el soporte de cálculo de IMP-05 es EXTEND del benchmark en repo, no REUSE", () => {
  const result = calculationSelection();
  assert.equal(result.ok, true, JSON.stringify(result));
  const { selection } = result;
  assert.equal(selection.decision, TOOLING_DECISION.EXTEND);
  assert.equal(selection.targetComponentId, REAL_BENCHMARK_COMPONENT_ID);
  assert.deepEqual(selection.additions, EXPECTED_ADDITIONS);
  assert.equal(selection.grantsProductionAuthority, false);
  assert.equal(selection.targetAssessment.componentId, REAL_BENCHMARK_COMPONENT_ID);

  const benchmarkTrace = selection.auditTrace.find((entry) => entry.componentId === REAL_BENCHMARK_COMPONENT_ID);
  assert.deepEqual(benchmarkTrace.missing, EXPECTED_ADDITIONS);
  const readerTrace = selection.auditTrace.find((entry) => entry.componentId === REAL_EEX_READER_COMPONENT_ID);
  assert.deepEqual(readerTrace.covered, []);
  const environmentTrace = selection.auditTrace.find((entry) => entry.componentId === REAL_EEX_READ_ENVIRONMENT_COMPONENT_ID);
  assert.deepEqual(environmentTrace.covered, [], "el lector no cubre capacidades de cálculo");

  for (const addition of selection.additions) {
    assert.ok(selection.rationale.includes(addition), `rationale nombra ${addition}`);
  }
  assert.ok(selection.rationale.includes(REAL_BENCHMARK_COMPONENT_ID));
});

// Con el uso autorizado (P-005) y el esquema inspeccionado, el entorno de
// lectura cubre trades y top-of-book: REUSE, reconciliado con fixtures
// sintéticos escritos por pyarrow y leídos por DuckDB.
test("DEP-10: la lectura de trades y top-of-book es REUSE del entorno DuckDB, reconciliada", () => {
  const { referenceRead } = deriveRealImp05ToolingDecisions();
  assert.equal(referenceRead.ok, true, JSON.stringify(referenceRead));
  const { selection } = referenceRead;
  assert.equal(selection.decision, TOOLING_DECISION.REUSE);
  assert.equal(selection.targetComponentId, REAL_EEX_READ_ENVIRONMENT_COMPONENT_ID);
  assert.deepEqual(selection.additions, []);
  assert.equal(selection.grantsProductionAuthority, false);
  assert.deepEqual(selection.evidenceRefs, [...REAL_READ_SELECTION_EVIDENCE]);
  const readerTrace = selection.auditTrace.find((entry) => entry.componentId === REAL_EEX_READER_COMPONENT_ID);
  assert.deepEqual(readerTrace.covered, [], "el script sólo emite velas 4H");

  const environment = assessmentFor(REAL_EEX_READ_ENVIRONMENT_COMPONENT_ID);
  const recomputed = reconcileKeyOutputs({ ...selection.reconciliation, keyOutputs: environment.interfaceContract.outputs });
  assert.equal(recomputed.reconciled, true, JSON.stringify(recomputed.mismatches));
  const byId = Object.fromEntries(selection.reconciliation.outputs.map((output) => [output.outputId, output.value]));
  assert.deepEqual(byId["topOfBook.bid"], ["99.5", "-9.71"]);
  assert.deepEqual(byId["topOfBook.instrumentType"], ["Simple Instrument", "Futures Spread"]);
  assert.deepEqual(byId["trade.updateAction"], ["New", "Delete"]);
});

test("DEP-10: una lectura divergente o sin top-of-book impide el REUSE del entorno", () => {
  const readSelection = (reconciliation) => selectMinimumTooling({
    requiredCapabilities: IMP05_REFERENCE_READ_CAPABILITIES,
    assessments: REAL_TOOLING_ASSESSMENTS,
    auditInventory: REAL_TOOLING_INVENTORY,
    reconciliation,
    evidenceRefs: REAL_READ_SELECTION_EVIDENCE,
  });
  const full = buildEexReadEnvironmentReconciliation();
  assert.equal(readSelection(full).ok, true);

  const divergent = { ...full, outputs: full.outputs.map((output) => (output.outputId === "topOfBook.ask" ? { ...output, value: ["100.5", "-9.26"] } : output)) };
  const divergentResult = readSelection(divergent);
  assert.equal(divergentResult.ok, false);
  assert.ok(divergentResult.errors.some((error) => error.code === "NOT_RECONCILED" && error.mismatches.some((mismatch) => mismatch.outputId === "topOfBook.ask")));

  const withoutTopOfBook = {
    componentId: full.componentId,
    outputs: full.outputs.filter((output) => !output.outputId.startsWith("topOfBook.")),
    fixtures: full.fixtures.filter((item) => !item.outputId.startsWith("topOfBook.")),
  };
  const missing = readSelection(withoutTopOfBook);
  assert.equal(missing.ok, false);
  const notCovered = missing.errors.find((error) => error.code === "KEY_OUTPUTS_NOT_COVERED");
  assert.deepEqual(notCovered.uncoveredKeyOutputs, Object.keys(EEX_READ_ENVIRONMENT_TOP_OF_BOOK_COLUMNS));
});

// Review IMP-04 2026-09-23 (revisión 9): la lectura del settlement oficial
// necesita el timestamp de proveedor de la fila elegida, porque §5.3 decide
// «entre correcciones oficiales prevalece el timestamp de proveedor más
// reciente». La lista anterior (precio, fecha e instrumento) no permitía
// aplicar la selección y ningún test la contrastaba contra la SPEC ni contra
// el contrato real de selectDailyReference().
test("DEP-10: la lectura del settlement oficial exige el timestamp de proveedor de §5.3", () => {
  const spec = readFileSync(SPEC_PATH, "utf8");
  assert.ok(spec.includes("entre correcciones oficiales prevalece el timestamp de proveedor más reciente"));

  const required = REFERENCE_READ_REQUIRED_OUTPUTS["reference.read.official"];
  assert.ok(required.includes("official.providerTimestamp"), JSON.stringify(required));

  // El contrato requerido no puede ser más laxo que la función real que aplica
  // §5.3: selectDailyReference() elige por providerTimestamp y lo devuelve.
  const selected = selectDailyReference({
    officialRows: [
      { value: 102, providerTimestamp: "2026-01-05T17:30:00Z" },
      { value: 103, providerTimestamp: "2026-01-06T09:00:00Z" },
    ],
  });
  assert.equal(selected.value, 103);
  assert.equal(selected.providerTimestamp, "2026-01-06T09:00:00Z");

  // Adversarial: la interfaz anterior (sin timestamp) no cubre la capacidad.
  const previousInterface = ["official.dailySettlementPrice", "official.tradeDate", "official.instrument"];
  const exposesAll = required.every((outputId) => previousInterface.includes(outputId));
  assert.equal(exposesAll, false, "sin official.providerTimestamp no se cubre la selección de §5.3");
});

// P-005: la fuente oficial de settlement se busca primero en fuentes canónicas.
// Ninguna la nombra y el lago no la contiene: el soporte queda bloqueado
// (fail-closed), sin BUILD de un lector para una fuente desconocida.
test("DEP-10: la lectura del settlement oficial queda BLOQUEADA por fuente no identificada, con la búsqueda trazada", () => {
  const { officialRead } = deriveRealImp05ToolingDecisions();
  assert.equal(officialRead.ok, false);
  assert.equal(officialRead.code, "BLOCKED_PENDING_OFFICIAL_SETTLEMENT_SOURCE");
  assert.equal(officialRead.derivationCode, "MISSING_NECESSITY");
  assert.deepEqual(officialRead.uncoveredCapabilities, ["reference.read.official"]);
  assert.ok(officialRead.auditTrace.every((entry) => entry.covered.length === 0 && entry.usable));
  assert.equal(officialRead.decision, undefined);

  const tables = readdirSync(EEX_LAKE_ROOT).filter((name) => name.startsWith("table="));
  assert.deepEqual(tables.sort(), ["table=eex_derivative_top_of_book", "table=eex_derivative_trade"]);
  for (const ref of OFFICIAL_SETTLEMENT_SOURCE_SEARCH.filter((item) => item.sha256)) {
    assert.equal(sha256Of(ref.ref), ref.sha256, ref.ref);
  }
  const text = (ref) => readFileSync(OFFICIAL_SETTLEMENT_SOURCE_SEARCH.find((item) => item.ref === ref).ref, "utf8");
  assert.ok(text("/srv/hot-data/energy-markets/reference/documentation/eex-reference-price.md").includes("HTTP 403 for the settlement spr endpoint"));
  assert.ok(text("docs/canonical/v1_1_1/sources/AUDIT_INPUTS_ENERGY_MARKETS.md").includes("fuente oficial de settlement y sus revisiones/publication timestamps"));
  assert.ok(text(SPEC_PATH).includes("con un feed oficial o externo autorizado"));
});

test("DEP-10: una salida divergente del componente real impide la selección", () => {
  for (const [outputId, divergentValue] of [
    ["referenceSelection", ["2026-01-05", "2026-01-06", "2026-01-07"]],
    ["excludedSelectionCount", 0],
    ["dailyReferenceValue", 102],
    ["dailyReferenceSource", "proxy"],
    ["proxyValue", 100],
    ["official001Value", 100],
    ["official001UnknownValidityValue", 0.01],
    ["official001UnknownValiditySource", "official"],
    ["BAfterOfficialCorrection", 106],
  ]) {
    const full = buildRealToolingReconciliation();
    const divergent = {
      ...full,
      outputs: full.outputs.map((output) => (output.outputId === outputId ? { ...output, value: divergentValue } : output)),
    };
    const result = calculationSelection({ reconciliation: divergent });
    assert.equal(result.ok, false, outputId);
    assert.ok(result.errors.some((error) => error.code === "NOT_RECONCILED" && error.mismatches.some((mismatch) => mismatch.outputId === outputId)), outputId);
  }
});

test("DEP-10: la decisión real no se aprueba sin reconciliación o con reconciliación fabricada", () => {
  const without = calculationSelection({ reconciliation: null });
  assert.equal(without.ok, false);
  assert.ok(without.errors.some((error) => error.code === "MISSING_RECONCILIATION"));

  const fabricated = calculationSelection({ reconciliation: { componentId: REAL_BENCHMARK_COMPONENT_ID, reconciled: true, comparisons: [{ outputId: "B", agreed: true }] } });
  assert.equal(fabricated.ok, false);
  assert.ok(fabricated.errors.some((error) => error.code === "RECONCILIATION_NOT_VERIFIABLE"));
});

test("DEP-10: retirar la evidencia de una capacidad cubierta (reference.select, 0.01) impide la selección", () => {
  const benchmark = assessmentFor(REAL_BENCHMARK_COMPONENT_ID);
  for (const capability of ["reference.select", "official.value_0_01.treatment"]) {
    const capabilityOutputs = benchmark.interfaceContract.capabilityOutputs[capability];
    const full = buildRealToolingReconciliation();
    const stripped = {
      componentId: full.componentId,
      outputs: full.outputs.filter((output) => !capabilityOutputs.includes(output.outputId)),
      fixtures: full.fixtures.filter((item) => !capabilityOutputs.includes(item.outputId)),
    };
    const result = calculationSelection({ reconciliation: stripped });
    assert.equal(result.ok, false, capability);
    const notCovered = result.errors.find((error) => error.code === "KEY_OUTPUTS_NOT_COVERED");
    assert.ok(notCovered, capability);
    assert.deepEqual(notCovered.uncoveredKeyOutputs, [...capabilityOutputs]);
  }
});

test("DEP-10: el assessment que no liga una capacidad cubierta a salidas reconciliadas se rechaza", () => {
  const benchmark = assessmentFor(REAL_BENCHMARK_COMPONENT_ID);
  const { "reference.select": _removed, ...otherCapabilityOutputs } = benchmark.interfaceContract.capabilityOutputs;
  const unlinked = { ...benchmark, interfaceContract: { ...benchmark.interfaceContract, capabilityOutputs: otherCapabilityOutputs } };
  const assessments = REAL_TOOLING_ASSESSMENTS.map((assessment) => (assessment.componentId === REAL_BENCHMARK_COMPONENT_ID ? unlinked : assessment));
  const result = calculationSelection({ assessments });
  assert.equal(result.ok, false);
  const undeclared = result.errors.find((error) => error.code === "CAPABILITY_OUTPUTS_UNDECLARED");
  assert.ok(undeclared, JSON.stringify(result));
  assert.deepEqual(undeclared.capabilities, ["reference.select"]);
});
