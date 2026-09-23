import { test } from "node:test";
import assert from "node:assert/strict";

import {
  MONTHLY_QUARTERLY_RELATION_STATES,
  applyFilledQuantity,
  computeRemainingVolume,
  mapCoverageOwnership,
  reconcileCoverage,
  validateRelationDeclaration,
} from "../../src/procurement-contract/coverage-ownership.mjs";

test("el volumen restante se deriva sólo con magnitudes y unidad compatibles", () => {
  const outcome = computeRemainingVolume({ openingObligation: 100, executedVolume: 40, openingUnit: "MWh", executedUnit: "MWh" });
  assert.equal(outcome.computed, true);
  assert.equal(outcome.remainingVolume, 60);
  assert.equal(outcome.unit, "MWh");
});

test("sin unidad el volumen restante no se computa ni se convierte", () => {
  const outcome = computeRemainingVolume({ openingObligation: 100, executedVolume: 40 });
  assert.equal(outcome.computed, false);
  assert.equal(outcome.remainingVolume, null);
  assert.equal(outcome.code, "MISSING_UNIT");
});

test("unidades incompatibles no producen un restante aparentemente válido", () => {
  const outcome = computeRemainingVolume({ openingObligation: 100, executedVolume: 40, openingUnit: "MW", executedUnit: "MWh" });
  assert.equal(outcome.computed, false);
  assert.equal(outcome.remainingVolume, null);
  assert.equal(outcome.code, "UNIT_MISMATCH");
});

test("magnitudes no finitas dejan el restante no computable", () => {
  const outcome = computeRemainingVolume({ openingObligation: 100, executedVolume: null, openingUnit: "MWh", executedUnit: "MWh" });
  assert.equal(outcome.computed, false);
  assert.equal(outcome.code, "MISSING_MAGNITUDES");
});

test("una obligación de apertura negativa no reconcilia", () => {
  const outcome = computeRemainingVolume({ openingObligation: -100, executedVolume: 40, openingUnit: "MWh", executedUnit: "MWh" });
  assert.equal(outcome.computed, false);
  assert.equal(outcome.code, "NEGATIVE_MAGNITUDE");
});

test("un volumen ejecutado negativo no reconcilia", () => {
  const outcome = computeRemainingVolume({ openingObligation: 100, executedVolume: -40, openingUnit: "MWh", executedUnit: "MWh" });
  assert.equal(outcome.computed, false);
  assert.equal(outcome.code, "NEGATIVE_MAGNITUDE");
});

test("ejecutado mayor que la obligación se rechaza por conservación", () => {
  const outcome = computeRemainingVolume({ openingObligation: 40, executedVolume: 100, openingUnit: "MWh", executedUnit: "MWh" });
  assert.equal(outcome.computed, false);
  assert.equal(outcome.code, "CONSERVATION_VIOLATION");
});

test("la reconciliación válida conserva la identidad de §4.3", () => {
  const outcome = reconcileCoverage({ openingObligation: 100, executedVolume: 100, remainingVolume: 0, unit: "MWh", terminalRuleStatus: "VERIFIED" });
  assert.equal(outcome.ok, true);
  assert.equal(outcome.coverageStatus, "COVERED");
  assert.deepEqual(outcome.errors, []);
});

test("una violación de conservación se detecta", () => {
  const outcome = reconcileCoverage({ openingObligation: 100, executedVolume: 40, remainingVolume: 50, unit: "MWh", terminalRuleStatus: "VERIFIED" });
  assert.equal(outcome.ok, false);
  assert.ok(outcome.errors.some((error) => error.code === "CONSERVATION_VIOLATION"));
});

test("con residual y sin terminal rule válida queda COVERAGE_INCOMPLETE", () => {
  const outcome = reconcileCoverage({ openingObligation: 100, executedVolume: 30, remainingVolume: 70, unit: "MWh", terminalRuleStatus: "MISSING" });
  assert.equal(outcome.coverageStatus, "COVERAGE_INCOMPLETE");
  assert.equal(outcome.ok, true);
});

test("sin terminal rule válida no se fabrica un fill de cierre", () => {
  const outcome = reconcileCoverage({
    openingObligation: 100,
    executedVolume: 30,
    remainingVolume: 70,
    unit: "MWh",
    terminalRuleStatus: "MISSING",
    closeOutFill: { quantity: 70, unit: "MWh" },
  });
  assert.equal(outcome.ok, false);
  assert.ok(outcome.errors.some((error) => error.code === "CLOSEOUT_WITH_UNKNOWN_TERMINAL_RULE"));
});

test("un fill pertenece a lo sumo a una obligación", () => {
  const outcome = mapCoverageOwnership({
    relationMonthlyQuarterly: { availability: "UNAVAILABLE", reason: "relación Monthly/Quarterly sin mandato real" },
    obligations: [
      { obligationId: "SYN-Q1", fills: ["SYN-F1"] },
      { obligationId: "SYN-M1", fills: ["SYN-F2"] },
    ],
    fills: [
      { fillId: "SYN-F1", quantity: 10, unit: "MWh" },
      { fillId: "SYN-F2", quantity: 5, unit: "MWh" },
    ],
  });
  assert.equal(outcome.ok, true);
  assert.deepEqual(outcome.assignments, [
    { fillId: "SYN-F1", obligationId: "SYN-Q1" },
    { fillId: "SYN-F2", obligationId: "SYN-M1" },
  ]);
});

test("el doble conteo entre obligaciones se rechaza", () => {
  const outcome = mapCoverageOwnership({
    obligations: [
      { obligationId: "SYN-Q1", fills: ["SYN-F1"] },
      { obligationId: "SYN-M1", fills: ["SYN-F1"] },
    ],
    fills: [{ fillId: "SYN-F1", quantity: 10, unit: "MWh" }],
  });
  assert.equal(outcome.ok, false);
  assert.ok(outcome.errors.some((error) => error.code === "DUPLICATE_OWNERSHIP"));
});

test("un fill inexistente no se asigna en silencio", () => {
  const outcome = mapCoverageOwnership({ obligations: [{ obligationId: "SYN-Q1", fills: ["SYN-F9"] }], fills: [] });
  assert.equal(outcome.ok, false);
  assert.ok(outcome.errors.some((error) => error.code === "UNKNOWN_FILL"));
});

test("la relación Monthly/Quarterly sin razón documentada se rechaza", () => {
  const outcome = mapCoverageOwnership({ relationMonthlyQuarterly: { availability: "UNAVAILABLE" }, obligations: [], fills: [] });
  assert.equal(outcome.ok, false);
  assert.ok(outcome.errors.some((error) => error.code === "MISSING_NOT_DOCUMENTED"));
});

test("la ausencia total de la relación Monthly/Quarterly se documenta, no se asume", () => {
  const outcome = mapCoverageOwnership({ obligations: [], fills: [] });
  assert.equal(outcome.ok, false);
  assert.ok(outcome.errors.some((error) => error.code === "MISSING_NOT_DOCUMENTED"));
});

test("un partial fill conserva el residual no ejecutado", () => {
  const outcome = applyFilledQuantity({ openingObligation: 100, executedVolume: 40, filledQuantity: 15, unit: "MWh" });
  assert.equal(outcome.updated, true);
  assert.equal(outcome.executedVolume, 55);
  assert.equal(outcome.remainingVolume, 45);
});

test("un fill negativo no reduce el volumen ejecutado", () => {
  const outcome = applyFilledQuantity({ openingObligation: 100, executedVolume: 40, filledQuantity: -15, unit: "MWh" });
  assert.equal(outcome.updated, false);
  assert.equal(outcome.code, "NEGATIVE_MAGNITUDE");
});

test("un volumen ejecutado negativo no admite fills", () => {
  const outcome = applyFilledQuantity({ openingObligation: 100, executedVolume: -10, filledQuantity: 5, unit: "MWh" });
  assert.equal(outcome.updated, false);
  assert.equal(outcome.code, "NEGATIVE_MAGNITUDE");
});

test("un fill no puede exceder la obligación de apertura", () => {
  const outcome = applyFilledQuantity({ openingObligation: 100, executedVolume: 90, filledQuantity: 20, unit: "MWh" });
  assert.equal(outcome.updated, false);
  assert.equal(outcome.code, "CONSERVATION_VIOLATION");
});

test("magnitudes negativas no reconcilian aunque la aritmética conserve", () => {
  const outcome = reconcileCoverage({ openingObligation: -100, executedVolume: -40, remainingVolume: -60, unit: "MWh" });
  assert.equal(outcome.ok, false);
  assert.equal(outcome.coverageStatus, "NOT_COMPUTABLE");
  assert.ok(outcome.errors.some((error) => error.code === "NEGATIVE_MAGNITUDE"));
});

test("un residual parcial negativo tampoco reconcilia", () => {
  const outcome = reconcileCoverage({ openingObligation: 100, executedVolume: 40, remainingVolume: -60, unit: "MWh" });
  assert.equal(outcome.ok, false);
  assert.ok(outcome.errors.some((error) => error.code === "NEGATIVE_MAGNITUDE"));
});

test("terminal rule VERIFIED sin evidencia de cierre deja el residual COVERAGE_INCOMPLETE", () => {
  const outcome = reconcileCoverage({ openingObligation: 100, executedVolume: 40, remainingVolume: 60, unit: "MWh", terminalRuleStatus: "VERIFIED" });
  assert.equal(outcome.ok, false);
  assert.equal(outcome.coverageStatus, "COVERAGE_INCOMPLETE");
  assert.ok(outcome.errors.some((error) => error.code === "RESIDUAL_CLOSE_NOT_EVIDENCED"));
});

test("un close-out fill que cubre exactamente el residual con regla VERIFIED cierra COVERED", () => {
  const outcome = reconcileCoverage({
    openingObligation: 100,
    executedVolume: 40,
    remainingVolume: 60,
    unit: "MWh",
    terminalRuleStatus: "VERIFIED",
    closeOutFill: { quantity: 60, unit: "MWh" },
  });
  assert.equal(outcome.ok, true);
  assert.equal(outcome.coverageStatus, "COVERED");
});

test("un close-out fill que no cubre el residual completo no cierra COVERED", () => {
  const outcome = reconcileCoverage({
    openingObligation: 100,
    executedVolume: 40,
    remainingVolume: 60,
    unit: "MWh",
    terminalRuleStatus: "VERIFIED",
    closeOutFill: { quantity: 30, unit: "MWh" },
  });
  assert.equal(outcome.ok, false);
  assert.equal(outcome.coverageStatus, "COVERAGE_INCOMPLETE");
  assert.ok(outcome.errors.some((error) => error.code === "RESIDUAL_CLOSE_NOT_EVIDENCED"));
});

test("un close-out fill en otra unidad no cierra el residual", () => {
  const outcome = reconcileCoverage({
    openingObligation: 100,
    executedVolume: 40,
    remainingVolume: 60,
    unit: "MWh",
    terminalRuleStatus: "VERIFIED",
    closeOutFill: { quantity: 60, unit: "MW" },
  });
  assert.equal(outcome.ok, false);
  assert.ok(outcome.errors.some((error) => error.code === "RESIDUAL_CLOSE_NOT_EVIDENCED"));
});

test("una enmienda documentada del residual cierra COVERED", () => {
  const outcome = reconcileCoverage({
    openingObligation: 100,
    executedVolume: 40,
    remainingVolume: 60,
    unit: "MWh",
    terminalRuleStatus: "VERIFIED",
    residualAmendment: { authority: "Bru (owner)", locator: "D02 P6.5 enmienda real" },
  });
  assert.equal(outcome.ok, true);
  assert.equal(outcome.coverageStatus, "COVERED");
});

test("una enmienda sin provenance no cierra el residual", () => {
  const outcome = reconcileCoverage({
    openingObligation: 100,
    executedVolume: 40,
    remainingVolume: 60,
    unit: "MWh",
    terminalRuleStatus: "VERIFIED",
    residualAmendment: { authority: "Bru (owner)" },
  });
  assert.equal(outcome.ok, false);
  assert.ok(outcome.errors.some((error) => error.code === "RESIDUAL_CLOSE_NOT_EVIDENCED"));
});

test("la relación Monthly/Quarterly AVAILABLE_NOW sin tipo, valor ni provenance se rechaza", () => {
  const outcome = mapCoverageOwnership({ relationMonthlyQuarterly: { availability: "AVAILABLE_NOW" }, obligations: [], fills: [] });
  assert.equal(outcome.ok, false);
  const codes = outcome.errors.map((error) => error.code);
  assert.ok(codes.includes("RELATION_TYPE_NOT_DECLARED"));
  assert.ok(codes.includes("AVAILABLE_WITHOUT_VALUE"));
  assert.ok(codes.includes("NO_PROVENANCE"));
});

test("la relación AVAILABLE_NOW materializa su estado resuelto con provenance", () => {
  for (const relationType of MONTHLY_QUARTERLY_RELATION_STATES) {
    const errors = validateRelationDeclaration({
      availability: "AVAILABLE_NOW",
      relationType,
      value: `mandato declara relación ${relationType}`,
      authority: "Bru (owner)",
      locator: "mandato firmado p.1",
    });
    assert.deepEqual(errors, [], relationType);
  }
});

test("la relación AVAILABLE_NOW con un tipo no declarado se rechaza", () => {
  const outcome = mapCoverageOwnership({
    relationMonthlyQuarterly: { availability: "AVAILABLE_NOW", relationType: "SAME", value: "x", authority: "a", locator: "l" },
    obligations: [],
    fills: [],
  });
  assert.equal(outcome.ok, false);
  assert.ok(outcome.errors.some((error) => error.code === "RELATION_TYPE_NOT_DECLARED"));
});
