// Tests de la valicación integral de diseños IMP-22 y su registro fail-closed.

import { test } from "node:test";
import assert from "node:assert/strict";

import { validateExperimentDesign, validateFreezeBeforeEvaluation } from "../../src/imp22-sizing/experiment-design.mjs";
import { createImp22DesignRegistry } from "../../src/imp22-sizing/registry.mjs";
import { DESIGN_IDS, EXPERIMENT_DESIGNS, getDesign } from "../../src/imp22-sizing/designs.mjs";
import { reservedStateFor, candidateWithAudit, frozenStateFor, attributionArmsFor, deepCloneDesign } from "./fixtures.mjs";

test("los diseños predeclarados pasan la validación estructural completa", () => {
  for (const design of EXPERIMENT_DESIGNS) {
    const result = validateExperimentDesign(design);
    assert.equal(result.ok, true, JSON.stringify(result.errors));
  }
});

test("un diseño nuevo de Mission Quarterly usa los mínimos DEP-12 canónicos, no los de otra Mission", () => {
  const design = getDesign(DESIGN_IDS.GAS_MONTHLY);
  design.identity.missionId = "POWER-QUARTERLY";
  design.reserve.missionId = "POWER-QUARTERLY";
  design.reserve.minimumEvidence = { cadence: "QUARTERLY", minCompleteQuartersOos: 8, minCalendarYearsOos: 2 };
  design.candidates = design.candidates.map((candidate) => ({ ...candidate, identity: { ...candidate.identity, missionId: "POWER-QUARTERLY" } }));
  const result = validateExperimentDesign(design);
  assert.equal(result.ok, true, JSON.stringify(result.errors));
});

test("acortar el estándar estadístico de la Mission o reutilizar la reserva IMP-09 se rechaza", () => {
  const design = getDesign(DESIGN_IDS.GAS_MONTHLY);
  design.reserve.minimumEvidence = { cadence: "MONTHLY", minMonthsOos: 12 };
  const result = validateExperimentDesign(design);
  assert.equal(result.ok, false);
  const codes = new Set(result.errors.map((error) => error.code));
  assert.ok(codes.has("MINIMUM_STANDARD_DOWNGRADE"));

  const reuse = getDesign(DESIGN_IDS.POWER_MONTHLY);
  reuse.reserve.reusesGasQuarterlyImp09Reservation = true;
  const reuseResult = validateExperimentDesign(reuse);
  assert.equal(reuseResult.ok, false);
  assert.ok(reuseResult.errors.some((error) => error.code === "OOS_REUSE_FORBIDDEN"));
});

test("sin reserva propia registrada el diseño se queda fail-closed en HOLD estructural", () => {
  const design = getDesign(DESIGN_IDS.GAS_MONTHLY);
  design.reserve.status = "NOT_A_STATUS";
  design.reserve.split = null;
  const result = validateExperimentDesign(design);
  assert.equal(result.ok, false);
  const codes = new Set(result.errors.map((error) => error.code));
  assert.ok(codes.has("STATUS_KNOWN"));
  assert.ok(codes.has("SPLIT_REQUIRED"));
});

test("un candidato de sizing sin guard de obligación restante o standalone se rechaza (§4.2; §13.6)", () => {
  const design = getDesign(DESIGN_IDS.GAS_MONTHLY);
  const candidate = design.candidates[0];
  candidate.constraints.guardFunction = (projectedQuantity) => projectedQuantity;
  const result = validateExperimentDesign(design);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.code === "GUARD_INVARIANTS_FAILED"));
});

test("registro: reject no colisiona, y registrar no ejecuta ni admite el IMP", () => {
  const registry = createImp22DesignRegistry();
  const first = getDesign(DESIGN_IDS.GAS_MONTHLY);
  const second = deepCloneDesign(first);

  assert.equal(registry.register(first).ok, true);
  assert.equal(registry.register(second).ok, false);
  assert.notEqual(registry.get(DESIGN_IDS.GAS_MONTHLY), second, "la colisión no sobrescribe la entrada registrada");
  assert.ok(registry.trades().some((trade) => trade.code === "IDENTITY_COLLISION"));

  const invalid = getDesign(DESIGN_IDS.POWER_MONTHLY);
  invalid.identity.missionId = "GAS-SQUARED";
  const invalidResult = registry.register(invalid);
  assert.equal(invalidResult.ok, false);
  assert.equal(registry.get(DESIGN_IDS.POWER_MONTHLY), null);
  assert.ok(registry.trades().filter((trade) => trade.rejected).length >= 2);
});

test("freeze excluye STATE act-over: exige reserva RESERVED, brazos paritarios y predeclaración (DEP-12; §13.9)", () => {
  const design = deepCloneDesign(getDesign(DESIGN_IDS.GAS_MONTHLY));
  const missing = validateFreezeBeforeEvaluation(design);
  assert.equal(missing.ok, false);
  const codes = new Set(missing.errors.map((error) => error.code));
  assert.ok(codes.has("FREEZE_REQUIRED"));
  assert.ok(codes.has("RESERVE_NOT_READY"));
  assert.ok(codes.has("ARMS_REQUIRED_BEFORE_EVALUATION"));

  // Freeze declarado pero reserva aún HOLD: reorder falla cerrado.
  const holdReserve = frozenStateFor(deepCloneDesign(design));
  const heldCheck = validateFreezeBeforeEvaluation(holdReserve);
  assert.equal(heldCheck.ok, false);
  assert.ok(heldCheck.errors.some((error) => error.code === "RESERVE_NOT_READY"));

  // Reserva sin frontera no hace freeze válido ni entonces (DEP-12).
  const boundaryless = frozenStateFor(reservedStateFor(deepCloneDesign(design)));
  boundaryless.reserve.split.boundary = null;
  const boundaryCheck = validateFreezeBeforeEvaluation(boundaryless);
  assert.equal(boundaryCheck.ok, false);
  assert.ok(boundaryCheck.errors.some((error) => error.code === "SPLIT_BOUNDARY_REQUIRED"));

  // Cadena completa: reserva RESERVED + frontera + brazos paritarios + freeze.
  const complete = validateFreezeBeforeEvaluation(attributionArmsFor(frozenStateFor(reservedStateFor(deepCloneDesign(design))), {}));
  assert.equal(complete.ok, true, JSON.stringify(complete.errors));
});

test("paridad rota entre brazos bloquea la evaluación aunque el freeze esté declarado (§13.9)", () => {
  const design = attributionArmsFor(frozenStateFor(reservedStateFor(deepCloneDesign(getDesign(DESIGN_IDS.POWER_MONTHLY)))), {});
  design.attribution.arms.timingOnly.benchmarkBVersion = "B-SYNTH-V2";
  const result = validateFreezeBeforeEvaluation(design);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.code === "PARITY_VIOLATION"));
});

test("cadena de cierre honesta: reserva RESERVED + candidato AUDITED + freeze completos validan", () => {
  const design = candidateWithAudit(frozenStateFor(reservedStateFor(getDesign(DESIGN_IDS.POWER_MONTHLY))));
  design.attribution.arms = attributionArmsFor(design, {}).attribution.arms;
  const freeze = validateFreezeBeforeEvaluation(design);
  assert.equal(freeze.ok, true, JSON.stringify(freeze.errors));

  // El freeze/atribución es talón técnico: los datos reales de la Mission
  // siguen AUDIT-DEPENDENT en honestUnknownReferenceScope hasta que exista
  // evidencia (§0.3; regla 4 P5.6 en pie).
  assert.ok(Array.isArray(design.honestUnknownReferenceScope) && design.honestUnknownReferenceScope.length > 0);
  assert.ok(design.honestUnknownReferenceScope.some((entry) => entry.startsWith("DEP-08")), "El benchmark B propio del nuevo experimento queda en el registro de faltantes");
});
