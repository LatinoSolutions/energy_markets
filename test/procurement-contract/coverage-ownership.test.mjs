import { test } from "node:test";
import assert from "node:assert/strict";

import {
  applyFilledQuantity,
  computeRemainingVolume,
  mapCoverageOwnership,
  reconcileCoverage,
} from "../../src/procurement-contract/coverage-ownership.mjs";

test("el volumen restante se deriva sólo con magnitudes y unidad compatibles", () => {
  const outcome = computeRemainingVolume({ openingObligation: 100, executedVolume: 40, unit: "MWh" });
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

test("magnitudes no finitas dejan el restante no computable", () => {
  const outcome = computeRemainingVolume({ openingObligation: 100, executedVolume: null, unit: "MWh" });
  assert.equal(outcome.computed, false);
  assert.equal(outcome.code, "MISSING_MAGNITUDES");
});

test("ejecutado mayor que la obligación se rechaza por conservación", () => {
  const outcome = computeRemainingVolume({ openingObligation: 40, executedVolume: 100, unit: "MWh" });
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

test("un partial fill conserva el residual no ejecutado", () => {
  const outcome = applyFilledQuantity({ openingObligation: 100, executedVolume: 40, filledQuantity: 15, unit: "MWh" });
  assert.equal(outcome.updated, true);
  assert.equal(outcome.executedVolume, 55);
  assert.equal(outcome.remainingVolume, 45);
});

test("un fill no puede exceder la obligación de apertura", () => {
  const outcome = applyFilledQuantity({ openingObligation: 100, executedVolume: 90, filledQuantity: 20, unit: "MWh" });
  assert.equal(outcome.updated, false);
  assert.equal(outcome.code, "CONSERVATION_VIOLATION");
});
