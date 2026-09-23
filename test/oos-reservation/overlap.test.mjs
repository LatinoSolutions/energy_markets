import { test } from "node:test";
import assert from "node:assert/strict";

import { detectOverlaps, resolveOverlaps } from "../../src/oos-reservation/overlap.mjs";
import { chronologicalEligibleComplete } from "../../src/oos-reservation/campaign-register.mjs";
import { gasQuarterlyRegister, realDurationResolution, withNestedWindowOverlap, withWindowOverlap, gasQuarterlyCampaign } from "./fixtures.mjs";

function split(register) {
  const ordered = chronologicalEligibleComplete(register);
  return { sealedOos: ordered.slice(-8), development: ordered.slice(0, -8) };
}

test("la estructura 3-1-3 consecutiva no produce solapamientos", () => {
  const register = gasQuarterlyRegister({ year: 2021, quarter: 1, count: 10 });
  const { sealedOos, development } = split(register);
  assert.deepEqual(detectOverlaps({ sealedOos, development }), []);
});

test("detecta el solapamiento de ventanas entre campañas reservadas", () => {
  const register = withWindowOverlap(gasQuarterlyRegister({ year: 2021, quarter: 1, count: 10 }), "2021Q3", "2021Q4");
  const { sealedOos, development } = split(register);
  const overlaps = detectOverlaps({ sealedOos, development });
  assert.equal(overlaps.length, 1);
  assert.equal(overlaps[0].kind, "PROCUREMENT_WINDOW");
  assert.deepEqual(overlaps[0].between, ["GAS-Q-2021Q3", "GAS-Q-2021Q4"]);
});

test("detecta un solapamiento anidado entre campañas selladas no adyacentes", () => {
  const register = withNestedWindowOverlap(gasQuarterlyRegister({ year: 2021, quarter: 1, count: 10 }), "2022Q1", "2023Q1");
  const { sealedOos, development } = split(register);
  const overlaps = detectOverlaps({ sealedOos, development });
  assert.equal(overlaps.length, 1);
  assert.equal(overlaps[0].kind, "PROCUREMENT_WINDOW");
  assert.deepEqual(overlaps[0].between, ["GAS-Q-2022Q1", "GAS-Q-2023Q1"]);
});

test("detecta una ventana de development intermedia que invade el sealed OOS", () => {
  const register = gasQuarterlyRegister({ year: 2021, quarter: 1, count: 10 });
  // development[0] (2021Q1) no es la última de development; su deadline se
  // extiende hasta la primera ventana sellada (2021Q3, desde 2021-03-01).
  register[0].deadline = "2021-03-15";
  const { sealedOos, development } = split(register);
  const overlaps = detectOverlaps({ sealedOos, development });
  assert.ok(overlaps.some((detected) => detected.kind === "DEVELOPMENT_OOS_BOUNDARY" && detected.between[0] === "GAS-Q-2021Q1"));
});

test("detecta el solapamiento de la frontera development/OOS", () => {
  const register = gasQuarterlyRegister({ year: 2021, quarter: 1, count: 10 });
  // register[2] es el primer sealed (2021Q3); se adelanta su ventana para tocar
  // el deadline del último development (2021Q2, 2021-02-28).
  register[2].windowStart = "2021-02-01";
  const { sealedOos, development } = split(register);
  const overlaps = detectOverlaps({ sealedOos, development });
  assert.ok(overlaps.some((overlap) => overlap.kind === "DEVELOPMENT_OOS_BOUNDARY"));
});

test("detecta feature histories que alcanzan material de development", () => {
  const register = gasQuarterlyRegister({ year: 2021, quarter: 1, count: 10 });
  register[8].featureHistoryStart = "2020-01-01";
  const { sealedOos, development } = split(register);
  const overlaps = detectOverlaps({ sealedOos, development });
  assert.ok(overlaps.some((overlap) => overlap.kind === "FEATURE_HISTORY"));
});

test("un solapamiento sin intervención queda abierto", () => {
  const register = withWindowOverlap(gasQuarterlyRegister({ year: 2021, quarter: 1, count: 10 }), "2021Q3", "2021Q4");
  const { sealedOos, development } = split(register);
  const overlaps = detectOverlaps({ sealedOos, development });
  const outcome = resolveOverlaps(overlaps, []);
  assert.equal(outcome.ok, false);
  assert.equal(outcome.unresolved.length, 1);
});

test("un embargo sin duración real no resuelve (§13.8 prohíbe inventar días)", () => {
  const register = withWindowOverlap(gasQuarterlyRegister({ year: 2021, quarter: 1, count: 10 }), "2021Q3", "2021Q4");
  const { sealedOos, development } = split(register);
  const overlaps = detectOverlaps({ sealedOos, development });
  const outcome = resolveOverlaps(overlaps, realDurationResolution(overlaps, "EMBARGO"));
  assert.equal(outcome.ok, false);
  assert.ok(outcome.errors.some((error) => error.code === "EMBARGO_WITHOUT_REAL_DURATION"));
});

test("una intervención sin fundamento auditado no resuelve", () => {
  const register = withWindowOverlap(gasQuarterlyRegister({ year: 2021, quarter: 1, count: 10 }), "2021Q3", "2021Q4");
  const { sealedOos, development } = split(register);
  const overlaps = detectOverlaps({ sealedOos, development });
  const withoutBasis = overlaps.map((detected) => ({ kind: detected.kind, between: detected.between, action: "PURGE" }));
  const outcome = resolveOverlaps(overlaps, withoutBasis);
  assert.equal(outcome.ok, false);
  assert.ok(outcome.errors.some((error) => error.code === "OVERLAP_RESOLUTION_WITHOUT_BASIS"));
});

test("un embargo con duración real y fundamento resuelve el solapamiento", () => {
  const register = withWindowOverlap(gasQuarterlyRegister({ year: 2021, quarter: 1, count: 10 }), "2021Q3", "2021Q4");
  const { sealedOos, development } = split(register);
  const overlaps = detectOverlaps({ sealedOos, development });
  const outcome = resolveOverlaps(overlaps, realDurationResolution(overlaps, "EMBARGO", { embargoDays: 10 }));
  assert.equal(outcome.ok, true);
  assert.equal(outcome.resolved.length, 1);
  assert.equal(outcome.resolved[0].action, "EMBARGO");
});

test("una intervención stale que no corresponde a ningún solapamiento se rechaza", () => {
  const register = gasQuarterlyRegister({ year: 2021, quarter: 1, count: 10 });
  const { sealedOos, development } = split(register);
  const stale = [{
    kind: "PROCUREMENT_WINDOW",
    between: ["GAS-Q-2021Q1", "GAS-Q-2021Q2"],
    action: "PURGE",
    purgedInterval: { start: "2020-09-01", end: "2020-11-30" },
    basis: { authority: "SYNTHETIC", locator: "fixtures" },
  }];
  const outcome = resolveOverlaps(detectOverlaps({ sealedOos, development }), stale);
  assert.equal(outcome.ok, false);
  assert.ok(outcome.errors.some((error) => error.code === "UNMATCHED_OVERLAP_RESOLUTION"));
});

test("el purge exige el intervalo real purgado", () => {
  const register = withWindowOverlap(gasQuarterlyRegister({ year: 2021, quarter: 1, count: 10 }), "2021Q3", "2021Q4");
  const { sealedOos, development } = split(register);
  const overlaps = detectOverlaps({ sealedOos, development });
  const outcome = resolveOverlaps(overlaps, realDurationResolution(overlaps, "PURGE"));
  assert.equal(outcome.ok, false);
  assert.ok(outcome.errors.some((error) => error.code === "PURGE_WITHOUT_REAL_INTERVAL"));
});

test("sin campañas selladas no hay solapamientos que detectar", () => {
  assert.deepEqual(detectOverlaps({ sealedOos: [], development: [gasQuarterlyCampaign({ year: 2021, quarter: 1 })] }), []);
});
