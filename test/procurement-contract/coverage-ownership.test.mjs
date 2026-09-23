import { test } from "node:test";
import assert from "node:assert/strict";

import {
  COVERAGE_STATUSES,
  MONTHLY_QUARTERLY_RELATION_STATES,
  applyFilledQuantity,
  computeRemainingVolume,
  mapCoverageOwnership,
  reconcileOwnershipWithExecutedVolume,
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
    { fillId: "SYN-F1", obligationId: "SYN-Q1", quantity: 10, unit: "MWh" },
    { fillId: "SYN-F2", obligationId: "SYN-M1", quantity: 5, unit: "MWh" },
  ]);
  // Una sola verdad: el mapa derivado cumple el contrato del mapa de la ficha.
  assert.deepEqual(validateOwnershipAssignments(outcome.assignments), []);
});

// Regresión de la revisión 6: un fill negativo sin unidad producía
// asignaciones sin cantidad ni unidad que validateOwnershipAssignments rechaza.
test("un fill sin filled quantity positiva o sin unidad se rechaza y no se asigna (§14.5)", () => {
  const invalidFills = [
    { fillId: "SYN-F1", quantity: -10 },
    { fillId: "SYN-F1", quantity: -10, unit: "MWh" },
    { fillId: "SYN-F1", quantity: 0, unit: "MWh" },
    { fillId: "SYN-F1", quantity: 10 },
    { fillId: "SYN-F1", quantity: "10", unit: "MWh" },
    { fillId: "SYN-F1", quantity: Number.NaN, unit: "MWh" },
  ];
  for (const fill of invalidFills) {
    const outcome = mapCoverageOwnership({
      relationMonthlyQuarterly: { availability: "UNAVAILABLE", reason: "relación Monthly/Quarterly sin mandato real" },
      obligations: [{ obligationId: "SYN-Q1", fills: ["SYN-F1"] }],
      fills: [fill],
    });
    assert.equal(outcome.ok, false, JSON.stringify(fill));
    assert.deepEqual(outcome.errors.map((error) => error.code), ["INVALID_FILL_QUANTITY"], JSON.stringify(fill));
    assert.deepEqual(outcome.assignments, [], JSON.stringify(fill));
  }
});

// Regresión de la validación adversarial: el mapa derivado sumaba MW y MWh en
// una obligación, fusionaba obligationId repetidos y aceptaba " MW ".
test("el mapa derivado no mezcla unidades, no fusiona obligaciones y exige unidad canónica", () => {
  const relation = { availability: "UNAVAILABLE", reason: "relación Monthly/Quarterly sin mandato real" };
  const mixed = mapCoverageOwnership({
    relationMonthlyQuarterly: relation,
    obligations: [{ obligationId: "O1", fills: ["F1", "F2"] }],
    fills: [{ fillId: "F1", quantity: 5, unit: "MW" }, { fillId: "F2", quantity: 5, unit: "MWh" }],
  });
  assert.equal(mixed.ok, false);
  assert.ok(mixed.errors.some((error) => error.code === "ASSIGNMENT_UNIT_MISMATCH"));
  assert.deepEqual(mixed.assignments, [{ fillId: "F1", obligationId: "O1", quantity: 5, unit: "MW" }]);

  const duplicated = mapCoverageOwnership({
    relationMonthlyQuarterly: relation,
    obligations: [{ obligationId: "O1", fills: ["F1"] }, { obligationId: "O1", fills: ["F2"] }],
    fills: [{ fillId: "F1", quantity: 5, unit: "MW" }, { fillId: "F2", quantity: 5, unit: "MW" }],
  });
  assert.ok(duplicated.errors.some((error) => error.code === "DUPLICATE_OBLIGATION"));

  const spacedUnit = mapCoverageOwnership({
    relationMonthlyQuarterly: relation,
    obligations: [{ obligationId: "O1", fills: ["F1"] }],
    fills: [{ fillId: "F1", quantity: 5, unit: " MW " }],
  });
  assert.deepEqual(spacedUnit.errors.map((error) => error.code), ["INVALID_FILL_QUANTITY"]);
  assert.deepEqual(validateOwnershipAssignments([{ fillId: "F1", obligationId: "O1", quantity: 5, unit: " MW " }]).map((error) => error.code), ["ASSIGNMENT_QUANTITY_INVALID"]);
});

test("IDs de fill u obligación no canónicos se rechazan en el mapa derivado", () => {
  const relation = { availability: "UNAVAILABLE", reason: "relación Monthly/Quarterly sin mandato real" };
  const badFill = mapCoverageOwnership({ relationMonthlyQuarterly: relation, obligations: [], fills: [{ fillId: "SYN-F1 ", quantity: 1, unit: "MWh" }] });
  assert.ok(badFill.errors.some((error) => error.code === "INVALID_FILL"));
  const badObligation = mapCoverageOwnership({
    relationMonthlyQuarterly: relation,
    obligations: [{ obligationId: "SYN-Q1 ", fills: ["SYN-F1"] }],
    fills: [{ fillId: "SYN-F1", quantity: 1, unit: "MWh" }],
  });
  assert.ok(badObligation.errors.some((error) => error.code === "INVALID_OBLIGATION"));
  assert.deepEqual(badObligation.assignments, []);
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
    { fillId: "F1", obligationId: "O1", quantity: 10, unit: "MW" },
    { fillId: "F2", obligationId: "O2", quantity: 5, unit: "MW" },
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

test("reconcileOwnershipWithExecutedVolume exige que lo asignado a la obligación sea el volumen ejecutado", () => {
  const own = (quantity, unit = "MW") => ({ fillId: `F-${quantity}`, obligationId: "O1", quantity, unit });
  assert.deepEqual(reconcileOwnershipWithExecutedVolume({ assignments: [own(5), own(15)], obligationId: "O1", executedVolume: 20, unit: "MW" }), []);
  assert.deepEqual(reconcileOwnershipWithExecutedVolume({ assignments: [], obligationId: "O1", executedVolume: 0, unit: "MW" }), []);
  const codes = (input) => reconcileOwnershipWithExecutedVolume(input).map((error) => error.code);
  assert.deepEqual(codes({ assignments: [], obligationId: "O1", executedVolume: 20, unit: "MW" }), ["OWNERSHIP_EXECUTED_MISMATCH"]);
  assert.deepEqual(codes({ assignments: [own(25)], obligationId: "O1", executedVolume: 20, unit: "MW" }), ["OWNERSHIP_EXECUTED_MISMATCH"]);
  assert.deepEqual(codes({ assignments: [own(20, "MWh")], obligationId: "O1", executedVolume: 20, unit: "MW" }), ["ASSIGNMENT_UNIT_MISMATCH"]);
  assert.deepEqual(codes({ assignments: [own(-5), own(25)], obligationId: "O1", executedVolume: 20, unit: "MW" }), ["ASSIGNMENT_QUANTITY_INVALID"]);
  assert.deepEqual(codes({ assignments: [own(0)], obligationId: "O1", executedVolume: 0, unit: "MW" }), ["ASSIGNMENT_QUANTITY_INVALID"]);
  assert.deepEqual(codes({ assignments: [own(20)], obligationId: "", executedVolume: 20, unit: "MW" }), ["OBLIGATION_ID_MISSING"]);
  assert.deepEqual(codes({ assignments: [own(20)], obligationId: "O1", executedVolume: null, unit: "MW" }), ["EXECUTED_VOLUME_MISSING"]);
  assert.deepEqual(codes({ assignments: [own(20)], obligationId: "O1", executedVolume: 20, unit: null }), ["EXECUTED_VOLUME_MISSING"]);
  assert.deepEqual(codes({ assignments: "x", obligationId: "O1", executedVolume: 20, unit: "MW" }), ["ASSIGNMENTS_NOT_ARRAY"]);
});

// Regresión de la validación adversarial: IDs con espacios en los extremos
// ("F1 ", "OBL-A ") escapaban al doble conteo y a la reconciliación, y las
// asignaciones a otras obligaciones no se revisaban.
test("validateOwnershipAssignments exige IDs canónicos y filled quantity en toda asignación", () => {
  const codes = (assignments) => validateOwnershipAssignments(assignments).map((error) => error.code);
  assert.deepEqual(codes([{ fillId: "F1 ", obligationId: "O1", quantity: 1, unit: "MW" }]), ["INVALID_ASSIGNMENT"]);
  assert.deepEqual(codes([{ fillId: "F1", obligationId: "O1 ", quantity: 1, unit: "MW" }]), ["INVALID_ASSIGNMENT"]);
  assert.deepEqual(codes([{ fillId: "F1\u200b", obligationId: "O1", quantity: 1, unit: "MW" }]), ["INVALID_ASSIGNMENT"]);
  assert.deepEqual(codes([{ fillId: "F1", obligationId: "O\u00a01", quantity: 1, unit: "MW" }]), ["INVALID_ASSIGNMENT"]);
  assert.deepEqual(codes([{ fillId: "F1", obligationId: "OTRA" }]), ["ASSIGNMENT_QUANTITY_INVALID"]);
  assert.deepEqual(codes([{ fillId: "F1", obligationId: "OTRA", quantity: -999, unit: "MWh" }]), ["ASSIGNMENT_QUANTITY_INVALID"]);
  assert.deepEqual(codes([{ fillId: "F1", obligationId: "OTRA", quantity: 5 }]), ["ASSIGNMENT_QUANTITY_INVALID"]);
  assert.deepEqual(codes([{ fillId: "F1", obligationId: "OTRA", quantity: "5", unit: "MW" }]), ["ASSIGNMENT_QUANTITY_INVALID"]);
});

test("reconcileOwnershipWithExecutedVolume rechaza un obligationId no canónico", () => {
  for (const obligationId of ["O1 ", "O1\u200b"]) {
    const errors = reconcileOwnershipWithExecutedVolume({ assignments: [], obligationId, executedVolume: 0, unit: "MW" });
    assert.deepEqual(errors.map((error) => error.code), ["OBLIGATION_ID_MISSING"], JSON.stringify(obligationId));
  }
});
