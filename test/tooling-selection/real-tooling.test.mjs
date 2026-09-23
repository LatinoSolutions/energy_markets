import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { reconcileKeyOutputs } from "../../src/tooling-selection/reconciliation.mjs";
import { deriveToolingDecision, selectMinimumTooling, TOOLING_DECISION } from "../../src/tooling-selection/decision.mjs";
import { isCapabilityAssessmentUsable, validateCapabilityAssessment } from "../../src/tooling-selection/capability.mjs";
import {
  EEX_READ_ENVIRONMENT_TRADE_COLUMNS,
  EEX_READER_INTERFACE_OUTPUTS,
  IMP05_CALCULATION_CAPABILITIES,
  IMP05_CAPABILITY_SOURCES,
  IMP05_REFERENCE_READ_CAPABILITIES,
  REAL_BENCHMARK_COMPONENT_ID,
  REAL_EEX_READER_COMPONENT_ID,
  REAL_EEX_READ_ENVIRONMENT_COMPONENT_ID,
  REAL_SELECTION_EVIDENCE,
  REAL_TOOLING_ASSESSMENTS,
  REAL_TOOLING_INVENTORY,
  REFERENCE_READ_REQUIRED_OUTPUTS,
  buildRealToolingReconciliation,
  deriveRealImp05ToolingDecisions,
} from "../../src/tooling-selection/real-tooling.mjs";

// DEP-10 de IMP-04 (SPEC v1.1.1 §6.4/§6.5, §25.1): capability assessment de
// componentes reales y decisión factual para los soportes que IMP-05 consume.

// Verificado contra src/economic-calculation/*.mjs: ninguna de estas existe.
const EXPECTED_ADDITIONS = [
  "benchmark.calendar.missing_dates",
  "benchmark.status.provisional",
  "benchmark.window.derive",
  "reconciliation.official_proxy",
  "benchmark.version",
];

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
  const required = [...IMP05_CALCULATION_CAPABILITIES, ...IMP05_REFERENCE_READ_CAPABILITIES];
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
  assert.deepEqual([...IMP05_REFERENCE_READ_CAPABILITIES], ["reference.read.trades", "reference.read.top_of_book", "reference.read.official"]);
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
// de lectura». Es el venv del script (DuckDB 1.5.5 + pyarrow 25.0.1); su
// read_parquet expone las columnas por trade que el QUERY selecciona.
test("DEP-10: el entorno de lectura (venv DuckDB) expone precio y hora por trade, verificado contra el script y el venv", () => {
  const environment = assessmentFor(REAL_EEX_READ_ENVIRONMENT_COMPONENT_ID);
  const record = readFileSync(`${EEX_VENV_SITE_PACKAGES}/duckdb-1.5.5.dist-info/RECORD`);
  assert.equal(createHash("sha256").update(record).digest("hex"), environment.componentVersion.contentHash, "DuckDB instalado cambió: rehacer el assessment");
  for (const ref of environment.evidenceRefs) {
    if (ref.ref.startsWith("/")) {
      assert.equal(createHash("sha256").update(readFileSync(ref.ref)).digest("hex"), ref.sha256, ref.ref);
    }
  }

  const script = readFileSync(EEX_SCRIPT_PATH, "utf8");
  const baseSelect = script.slice(script.indexOf("WITH base AS ("), script.indexOf("FROM read_parquet(?"));
  for (const column of Object.values(EEX_READ_ENVIRONMENT_TRADE_COLUMNS)) {
    assert.match(baseSelect, new RegExp(`^\\s+${column},`, "m"), `el QUERY lee ${column} de read_parquet`);
  }
  assert.deepEqual([...environment.interfaceContract.outputs], Object.keys(EEX_READ_ENVIRONMENT_TRADE_COLUMNS));
  assert.deepEqual([...environment.declaredCapabilities], ["reference.read.trades"]);
  const usability = isCapabilityAssessmentUsable(environment);
  assert.equal(usability.usable, false, "licencias del motor no acreditan derechos sobre los datos");
  assert.equal(usability.rightsUnresolved, true);
});

test("DEP-10: ningún componente real declara una capacidad de lectura que su interfaz no expone", () => {
  for (const assessment of REAL_TOOLING_ASSESSMENTS) {
    for (const capability of IMP05_REFERENCE_READ_CAPABILITIES) {
      const requiredOutputs = REFERENCE_READ_REQUIRED_OUTPUTS[capability];
      const exposesAll = requiredOutputs.every((outputId) => assessment.interfaceContract.outputs.includes(outputId));
      assert.equal(assessment.declaredCapabilities.includes(capability), exposesAll, `${assessment.componentId} / ${capability}`);
    }
  }
  const reader = assessmentFor(REAL_EEX_READER_COMPONENT_ID);
  assert.ok(!reader.declaredCapabilities.includes("reference.read.trades"));
});

test("DEP-10: los assessments reales son válidos; el benchmark es usable y el lector EEX no", () => {
  const benchmark = assessmentFor(REAL_BENCHMARK_COMPONENT_ID);
  assert.equal(validateCapabilityAssessment(benchmark).ok, true);
  assert.equal(isCapabilityAssessmentUsable(benchmark).usable, true);

  const reader = assessmentFor(REAL_EEX_READER_COMPONENT_ID);
  assert.equal(validateCapabilityAssessment(reader).ok, true);
  const readerUsability = isCapabilityAssessmentUsable(reader);
  assert.equal(readerUsability.usable, false, "datos legibles no prueban entitlements");
  assert.equal(readerUsability.rightsUnresolved, true);
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
  assert.equal(readerTrace.usable, false);

  for (const addition of selection.additions) {
    assert.ok(selection.rationale.includes(addition), `rationale nombra ${addition}`);
  }
  assert.ok(selection.rationale.includes(REAL_BENCHMARK_COMPONENT_ID));
});

// El script EEX sólo da velas 4H; el entorno de lectura sí cubre trades, pero
// con derechos unknown sobre el lago. Top-of-book y oficial no los cubre
// ningún componente auditado. No se construye ni extiende mientras tanto.
test("DEP-10: la lectura de referencias reales queda BLOQUEADA por derechos pendientes, aun con necesidad declarada", () => {
  const { referenceRead } = deriveRealImp05ToolingDecisions();
  assert.equal(referenceRead.ok, false);
  assert.equal(referenceRead.code, "BLOCKED_PENDING_RIGHTS_AUDIT");
  assert.deepEqual(referenceRead.candidateComponentIds, [REAL_EEX_READ_ENVIRONMENT_COMPONENT_ID]);
  assert.deepEqual(referenceRead.blockedCapabilities, ["reference.read.trades"]);
  assert.deepEqual(referenceRead.uncoveredCapabilities, ["reference.read.top_of_book", "reference.read.official"]);
  const readerTrace = referenceRead.auditTrace.find((entry) => entry.componentId === REAL_EEX_READER_COMPONENT_ID);
  assert.deepEqual(readerTrace.covered, []);

  const withSelfDeclaredNecessity = deriveToolingDecision({
    requiredCapabilities: IMP05_REFERENCE_READ_CAPABILITIES,
    assessments: REAL_TOOLING_ASSESSMENTS,
    auditInventory: REAL_TOOLING_INVENTORY,
    buildNecessity: { demonstrated: true, rationale: "Autodeclarada.", evidenceRefs: [{ kind: "audit", ref: "X" }] },
  });
  assert.equal(withSelfDeclaredNecessity.ok, false);
  assert.equal(withSelfDeclaredNecessity.code, "BLOCKED_PENDING_RIGHTS_AUDIT");
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
