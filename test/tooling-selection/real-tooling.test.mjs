import { test } from "node:test";
import assert from "node:assert/strict";

import { selectMinimumTooling, TOOLING_DECISION } from "../../src/tooling-selection/decision.mjs";
import { isCapabilityAssessmentUsable, validateCapabilityAssessment } from "../../src/tooling-selection/capability.mjs";
import {
  REAL_BENCHMARK_COMPONENT_ID,
  REAL_REQUIRED_CAPABILITIES,
  REAL_SELECTION_EVIDENCE,
  REAL_TOOLING_ASSESSMENTS,
  buildRealToolingReconciliation,
} from "../../src/tooling-selection/real-tooling.mjs";

// DEP-10 de IMP-04 (SPEC §6.4/§6.5, §25.1): el entregable no es sólo el
// framework. Aquí se audita un componente real del entorno (el benchmark en
// repo, aceptado por IMP-08) con sus interfaces y constraints reales, y se
// emite la decisión factual reutilizar/extender/construir.

function assessmentFor(componentId) {
  return REAL_TOOLING_ASSESSMENTS.find((assessment) => assessment.componentId === componentId) ?? null;
}

test("DEP-10: el assessment del componente real aceptado es válido y usable", () => {
  const benchmark = assessmentFor(REAL_BENCHMARK_COMPONENT_ID);
  assert.ok(benchmark, "assessment real del benchmark presente");
  assert.equal(validateCapabilityAssessment(benchmark).ok, true);
  assert.equal(isCapabilityAssessmentUsable(benchmark).usable, true);
});

test("DEP-10: el script de lectura EEX se audita pero no se adopta sin derechos", () => {
  const reader = assessmentFor("power-markets-explorer.generate_eex_snapshot");
  assert.ok(reader, "assessment real del script de lectura presente");
  assert.equal(validateCapabilityAssessment(reader).ok, true);
  assert.equal(isCapabilityAssessmentUsable(reader).usable, false, "derechos/datos legibles no prueban entitlements");
});

test("DEP-10: la decisión factual reutiliza el componente real tras reconciliar sus salidas", () => {
  const reconciliation = buildRealToolingReconciliation();
  // Salidas observadas realmente producidas por benchmarkB() sobre la entrada
  // documentada (media manual esperada 102).
  assert.deepEqual(
    reconciliation.outputs.map((output) => [output.outputId, output.value]),
    [["B", 102], ["count", 3], ["coverage", "3/3"]],
  );

  const result = selectMinimumTooling({
    requiredCapabilities: REAL_REQUIRED_CAPABILITIES,
    assessments: REAL_TOOLING_ASSESSMENTS,
    reconciliation,
    evidenceRefs: REAL_SELECTION_EVIDENCE,
  });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.selection.decision, TOOLING_DECISION.REUSE);
  assert.equal(result.selection.targetComponentId, REAL_BENCHMARK_COMPONENT_ID);
  assert.equal(result.selection.grantsProductionAuthority, false);
  assert.equal(result.selection.targetAssessment.componentId, REAL_BENCHMARK_COMPONENT_ID);
});

test("DEP-10: la decisión real no se aprueba sin reconciliación", () => {
  const result = selectMinimumTooling({
    requiredCapabilities: REAL_REQUIRED_CAPABILITIES,
    assessments: REAL_TOOLING_ASSESSMENTS,
    evidenceRefs: REAL_SELECTION_EVIDENCE,
  });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.code === "RECONCILIATION_NOT_VERIFIABLE" || error.code === "MISSING_RECONCILIATION"));
});

test("DEP-10: una reconciliación fabricada no sostiene la decisión real", () => {
  const fabricated = { componentId: REAL_BENCHMARK_COMPONENT_ID, reconciled: true, comparisons: [{ outputId: "B", agreed: true }] };
  const result = selectMinimumTooling({
    requiredCapabilities: REAL_REQUIRED_CAPABILITIES,
    assessments: REAL_TOOLING_ASSESSMENTS,
    reconciliation: fabricated,
    evidenceRefs: REAL_SELECTION_EVIDENCE,
  });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.code === "RECONCILIATION_NOT_VERIFIABLE"));
});
