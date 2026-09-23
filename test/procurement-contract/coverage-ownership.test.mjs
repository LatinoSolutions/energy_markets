import { test } from "node:test";
import assert from "node:assert/strict";

import {
  COVERAGE_STATUSES,
  MONTHLY_QUARTERLY_RELATION_STATES,
  applyFilledQuantity,
  computeRemainingVolume,
  mapCoverageOwnership,
  reconcileCoverage,
  validateOwnershipAssignments,
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
  assert.equal(outcome.coverageStatus, "NOT_COMPUTABLE");
  assert.ok(outcome.errors.some((error) => error.code === "CONSERVATION_VIOLATION"));
});

test("un restante declarado en cero que no reconcilia no se declara COVERED", () => {
  // Hallazgo de la validación adversarial: opening 60, executed 50,
  // remaining 0 devolvía COVERED con un residual real de 10.
  for (const closeOutFill of [undefined, { quantity: 10, unit: "MW" }]) {
    const outcome = reconcileCoverage({ openingObligation: 60, executedVolume: 50, remainingVolume: 0, unit: "MW", terminalRuleStatus: "VERIFIED", closeOutFill });
    assert.equal(outcome.ok, false);
    assert.notEqual(outcome.coverageStatus, "COVERED");
    assert.ok(outcome.errors.some((error) => error.code === "CONSERVATION_VIOLATION"));
  }
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

test("un close-out fill con residual aún positivo no cierra COVERED (§14.5: fill fuera de executedVolume)", () => {
  // Regresión del review: el fill de cierre de 60 no figuraba en
  // executedVolume (40) y remainingVolume seguía en 60, pero se declaraba
  // COVERED. Coverage sólo cambia por filled quantity registrada.
  const outcome = reconcileCoverage({
    openingObligation: 100,
    executedVolume: 40,
    remainingVolume: 60,
    unit: "MWh",
    terminalRuleStatus: "VERIFIED",
    closeOutFill: { quantity: 60, unit: "MWh" },
  });
  assert.equal(outcome.ok, false);
  assert.equal(outcome.coverageStatus, "COVERAGE_INCOMPLETE");
  assert.ok(outcome.errors.some((error) => error.code === "CLOSEOUT_NOT_IN_EXECUTED_VOLUME"));
  assert.ok(outcome.errors.some((error) => error.code === "CLOSEOUT_WITH_POSITIVE_RESIDUAL"));
});

test("un close-out fill contado en executedVolume con restante cero cierra COVERED", () => {
  const outcome = reconcileCoverage({
    openingObligation: 100,
    executedVolume: 100,
    remainingVolume: 0,
    unit: "MWh",
    terminalRuleStatus: "VERIFIED",
    closeOutFill: { quantity: 60, unit: "MWh" },
  });
  assert.equal(outcome.ok, true);
  assert.equal(outcome.coverageStatus, "COVERED");
});

test("un close-out fill mayor que executedVolume no está en el ledger y no cubre", () => {
  const outcome = reconcileCoverage({
    openingObligation: 100,
    executedVolume: 100,
    remainingVolume: 0,
    unit: "MWh",
    terminalRuleStatus: "VERIFIED",
    closeOutFill: { quantity: 120, unit: "MWh" },
  });
  assert.equal(outcome.ok, false);
  assert.equal(outcome.coverageStatus, "COVERAGE_INCOMPLETE");
  assert.ok(outcome.errors.some((error) => error.code === "CLOSEOUT_NOT_IN_EXECUTED_VOLUME"));
});

test("un close-out fill con restante cero pero sin terminal rule válida no es cobertura real", () => {
  const outcome = reconcileCoverage({
    openingObligation: 100,
    executedVolume: 100,
    remainingVolume: 0,
    unit: "MWh",
    terminalRuleStatus: "UNKNOWN",
    closeOutFill: { quantity: 60, unit: "MWh" },
  });
  assert.equal(outcome.ok, false);
  assert.equal(outcome.coverageStatus, "COVERAGE_INCOMPLETE");
  assert.ok(outcome.errors.some((error) => error.code === "CLOSEOUT_WITH_UNKNOWN_TERMINAL_RULE"));
});

test("un close-out fill parcial deja el residual COVERAGE_INCOMPLETE", () => {
  const outcome = reconcileCoverage({
    openingObligation: 100,
    executedVolume: 70,
    remainingVolume: 30,
    unit: "MWh",
    terminalRuleStatus: "VERIFIED",
    closeOutFill: { quantity: 30, unit: "MWh" },
  });
  assert.equal(outcome.ok, false);
  assert.equal(outcome.coverageStatus, "COVERAGE_INCOMPLETE");
  assert.ok(outcome.errors.some((error) => error.code === "CLOSEOUT_WITH_POSITIVE_RESIDUAL"));
});

test("un close-out fill en otra unidad no cuenta como cobertura", () => {
  const outcome = reconcileCoverage({
    openingObligation: 100,
    executedVolume: 100,
    remainingVolume: 0,
    unit: "MWh",
    terminalRuleStatus: "VERIFIED",
    closeOutFill: { quantity: 60, unit: "MW" },
  });
  assert.equal(outcome.ok, false);
  assert.equal(outcome.coverageStatus, "COVERAGE_INCOMPLETE");
  assert.ok(outcome.errors.some((error) => error.code === "CLOSEOUT_NOT_IN_EXECUTED_VOLUME"));
});

test("un close-out fill sin unidad declarada no cuenta como cobertura (sin inferir unidades)", () => {
  // §25.1 IMP-02 acceptance: remaining volume sin inferir unidades. Aceptar
  // unidad ausente sería asumirla igual al residual (§4.1).
  const outcome = reconcileCoverage({
    openingObligation: 100,
    executedVolume: 100,
    remainingVolume: 0,
    unit: "MWh",
    terminalRuleStatus: "VERIFIED",
    closeOutFill: { quantity: 60 },
  });
  assert.equal(outcome.ok, false);
  assert.equal(outcome.coverageStatus, "COVERAGE_INCOMPLETE");
  assert.ok(outcome.errors.some((error) => error.code === "CLOSEOUT_NOT_IN_EXECUTED_VOLUME"));
});

test("una enmienda que declara la cantidad cancelada cierra como RESIDUAL_CANCELLED", () => {
  const outcome = reconcileCoverage({
    openingObligation: 100,
    executedVolume: 40,
    remainingVolume: 60,
    unit: "MWh",
    terminalRuleStatus: "VERIFIED",
    residualAmendment: { authority: "Bru (owner)", locator: "mandato firmado p.1", cancelledVolume: 60, unit: "MWh" },
  });
  assert.equal(outcome.ok, true);
  // §4.3: la cobertura se informa separadamente; cancelar no es cubrir y el
  // downstream (ledgers P6) debe distinguirlos.
  assert.equal(outcome.coverageStatus, "RESIDUAL_CANCELLED");
  assert.ok(COVERAGE_STATUSES.includes("RESIDUAL_CANCELLED"));
});

test("una enmienda en blanco no cierra el residual (§14.5: ajuste correspondiente)", () => {
  // Regresión del hallazgo del review: authority+locator sin cantidad
  // declarada cerraba 99 de 100 como COVERED.
  const outcome = reconcileCoverage({
    openingObligation: 100,
    executedVolume: 1,
    remainingVolume: 99,
    unit: "MWh",
    terminalRuleStatus: "VERIFIED",
    residualAmendment: { authority: "x", locator: "y" },
  });
  assert.equal(outcome.ok, false);
  assert.equal(outcome.coverageStatus, "COVERAGE_INCOMPLETE");
  assert.ok(outcome.errors.some((error) => error.code === "RESIDUAL_CLOSE_NOT_EVIDENCED"));
});

test("una enmienda sin provenance no cierra el residual", () => {
  const outcome = reconcileCoverage({
    openingObligation: 100,
    executedVolume: 40,
    remainingVolume: 60,
    unit: "MWh",
    terminalRuleStatus: "VERIFIED",
    residualAmendment: { authority: "Bru (owner)", cancelledVolume: 60, unit: "MWh" },
  });
  assert.equal(outcome.ok, false);
  assert.ok(outcome.errors.some((error) => error.code === "RESIDUAL_CLOSE_NOT_EVIDENCED"));
});

test("una enmienda que cancela menos que el residual no lo cierra", () => {
  const outcome = reconcileCoverage({
    openingObligation: 100,
    executedVolume: 40,
    remainingVolume: 60,
    unit: "MWh",
    terminalRuleStatus: "VERIFIED",
    residualAmendment: { authority: "a", locator: "l", cancelledVolume: 20, unit: "MWh" },
  });
  assert.equal(outcome.ok, false);
  assert.equal(outcome.coverageStatus, "COVERAGE_INCOMPLETE");
  assert.ok(outcome.errors.some((error) => error.code === "RESIDUAL_CLOSE_NOT_EVIDENCED"));
});

test("una enmienda en otra unidad no cierra el residual", () => {
  const outcome = reconcileCoverage({
    openingObligation: 100,
    executedVolume: 40,
    remainingVolume: 60,
    unit: "MWh",
    terminalRuleStatus: "VERIFIED",
    residualAmendment: { authority: "a", locator: "l", cancelledVolume: 60, unit: "MW" },
  });
  assert.equal(outcome.ok, false);
  assert.ok(outcome.errors.some((error) => error.code === "RESIDUAL_CLOSE_NOT_EVIDENCED"));
});

test("un residual con close-out fill y enmienda a la vez no se cierra (doble cierre)", () => {
  const outcome = reconcileCoverage({
    openingObligation: 100,
    executedVolume: 40,
    remainingVolume: 60,
    unit: "MWh",
    terminalRuleStatus: "VERIFIED",
    closeOutFill: { quantity: 60, unit: "MWh" },
    residualAmendment: { authority: "a", locator: "l", cancelledVolume: 60, unit: "MWh" },
  });
  assert.equal(outcome.ok, false);
  assert.equal(outcome.coverageStatus, "COVERAGE_INCOMPLETE");
  assert.ok(outcome.errors.some((error) => error.code === "CLOSEOUT_WITH_POSITIVE_RESIDUAL"));
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

test("validateOwnershipAssignments aplica el invariante de doble conteo (fuente única)", () => {
  assert.deepEqual(validateOwnershipAssignments([
    { fillId: "F1", obligationId: "O1" },
    { fillId: "F2", obligationId: "O2" },
  ]), []);
  assert.ok(validateOwnershipAssignments("no-array").some((error) => error.code === "ASSIGNMENTS_NOT_ARRAY"));
  const doubleCount = validateOwnershipAssignments([
    { fillId: "F1", obligationId: "O1" },
    { fillId: "F1", obligationId: "O2" },
  ]);
  assert.ok(doubleCount.some((error) => error.code === "DUPLICATE_OWNERSHIP"));
  const repeated = validateOwnershipAssignments([
    { fillId: "F1", obligationId: "O1" },
    { fillId: "F1", obligationId: "O1" },
  ]);
  assert.ok(repeated.some((error) => error.code === "DUPLICATE_OWNERSHIP"));
  assert.ok(validateOwnershipAssignments([{ obligationId: "O1" }]).some((error) => error.code === "INVALID_ASSIGNMENT"));
});
