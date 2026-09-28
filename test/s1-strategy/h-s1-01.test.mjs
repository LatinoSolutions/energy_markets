import test from "node:test";
import assert from "node:assert/strict";
import {
  H_S1_01, H_S1_01_MISSIONS, predeclareHS1SearchSpace,
  createHS1Candidate, evaluateHS1Location, decideHS1AgainstControl,
  materializeHS1MissionRegistry,
} from "../../src/s1-strategy/index.mjs";
import { buildDecisionCalendar, createA0Baseline, createSizingController } from "../../src/sizing-controller/index.mjs";

const h = "a".repeat(64);
const z = "b".repeat(64);
const days = Array.from({ length: 21 }, (_, i) => `2025-01-${String(i + 1).padStart(2, "0")}`);
const availability = (mission, count, hour = "10:00") => days.slice(0, count).map((day) => ({
  mission, atUtc: `${day}T${hour}:00Z`, sessionDate: day, anchor: hour,
  available: true, pitAvailableAtUtc: `${day}T${hour}:00Z`, sourceHash: h,
}));
const spaceFor = (mission, count = 11) => predeclareHS1SearchSpace({
  mission, developmentEndUtc: "2025-02-01T00:00:00Z",
  session: { mission, zone: "UTC", anchors: ["10:00", "11:00"], sourceHash: z },
  availability: availability(mission, count),
  provenance: { authority: "SYNTHETIC_FIXTURE", locator: "test/s1-strategy/h-s1-01.test.mjs", sourceHash: h },
});
const candidateFor = (mission, N = 3) => {
  const space = spaceFor(mission).searchSpace;
  return createHS1Candidate({ searchSpace: space, tau: { zone: "UTC", localTime: "10:00" }, N }).candidate;
};
const history = (mission) => [35, 30, 40].map((price, i) => ({
  mission, atUtc: `${days[i]}T10:00:00Z`, pitAvailableAtUtc: `${days[i]}T10:00:00Z`, price, sourceHash: h,
}));

test("H01/H02/H08: identity, refutation and four isolated mission slots remain unrun", () => {
  assert.equal(H_S1_01.hypothesisId, "H-S1-01");
  assert.match(H_S1_01.refutation, /OOS/);
  assert.equal(H_S1_01.economicResult, null);
  assert.equal(new Set(H_S1_01_MISSIONS).size, 4);
  const spaces = Object.fromEntries(H_S1_01_MISSIONS.map((mission) => [mission, spaceFor(mission).searchSpace]));
  const registry = materializeHS1MissionRegistry(spaces);
  assert.equal(registry.ok, true);
  assert.equal(new Set(Object.values(registry.missions).map((row) => row.searchSpaceHash)).size, 4);
  for (const row of Object.values(registry.missions)) {
    assert.equal(row.status, "PREDECLARED_UNCALIBRATED");
    assert.equal(row.calibration, null);
    assert.equal(row.backtest, null);
    assert.equal(row.evidence, null);
    assert.equal(row.economicResult, null);
  }
  const blocked = materializeHS1MissionRegistry();
  assert.equal(Object.values(blocked.missions).every((row) => row.status === "DATA_BLOCKED"), true);
  const tampered = materializeHS1MissionRegistry({ "Gas Monthly": { ...spaces["Gas Monthly"], mission: "Power Monthly" } });
  assert.equal(tampered.missions["Gas Monthly"].status, "INTEGRITY_BLOCKED");
});

test("H04: tau and N derive from Development support, never from outcomes or 11:00 default", () => {
  for (const mission of H_S1_01_MISSIONS) {
    const seven = spaceFor(mission, 7);
    assert.deepEqual(seven.searchSpace.candidates.map((p) => p.N), [3, 5]);
    assert.deepEqual(seven.searchSpace.candidates.map((p) => p.tau.localTime), ["10:00", "10:00"]);
    assert.deepEqual(spaceFor(mission, 11).searchSpace.candidates.map((p) => p.N), [3, 5, 10]);
    assert.equal(createHS1Candidate({ searchSpace: seven.searchSpace, tau: { zone: "UTC", localTime: "10:00" }, N: 10 }).code, "OUTSIDE_PREDECLARED_SPACE");
    assert.equal(spaceFor(mission, 2).searchSpace.status, "DATA_BLOCKED");
  }
  const bad = spaceFor("Gas Monthly");
  const leaked = predeclareHS1SearchSpace({
    mission: "Gas Monthly", developmentEndUtc: "2025-02-01T00:00:00Z",
    session: { mission: "Gas Monthly", zone: "UTC", anchors: ["10:00"], sourceHash: z },
    availability: [{ ...availability("Gas Monthly", 1)[0], outcome: 42 }],
    provenance: { authority: "fixture", locator: "fixture", sourceHash: h },
  });
  assert.equal(bad.ok, true);
  assert.equal(leaked.code, "INVALID_AVAILABILITY_ROW");
  assert.equal(predeclareHS1SearchSpace({
    mission: "Gas Monthly", developmentEndUtc: "2025-02-01T00:00:00Z",
    session: { mission: "Gas Monthly", zone: "UTC", anchors: ["10:00"], sourceHash: z },
    availability: availability("Power Monthly", 4),
    provenance: { authority: "fixture", locator: "fixture", sourceHash: h },
  }).code, "INVALID_AVAILABILITY_ROW");
  assert.equal(H_S1_01.legacy.N, 10);
  assert.equal(H_S1_01.legacy.status, "EXPLORATORY_PROVENANCE_ONLY");
});

test("H03/H05/H06: N prior same-anchor PIT observations, strict rule and warm-up", () => {
  const candidate = candidateFor("Power Quarterly");
  const args = { candidate, asOfUtc: "2025-01-04T10:00:00Z", decisionPriceAvailableAtUtc: "2025-01-04T10:00:00Z",
    decisionPriceMission: "Power Quarterly", decisionPriceSourceHash: h, history: history("Power Quarterly") };
  const buy = evaluateHS1Location({ ...args, decisionPrice: 30 });
  assert.equal(buy.action, "BUY");
  assert.equal(buy.reference, 35);
  assert.equal(buy.features.signedDistanceToReference, -5);
  assert.equal(buy.windowCount, 3);
  assert.equal(evaluateHS1Location({ ...args, decisionPrice: 35 }).action, "WAIT");
  assert.equal(evaluateHS1Location({ ...args, decisionPrice: 40 }).action, "WAIT");
  const warm = evaluateHS1Location({ ...args, decisionPrice: 30, history: history("Power Quarterly").slice(0, 2) });
  assert.deepEqual([warm.status, warm.action, warm.reference], ["UNIDENTIFIABLE", "ABSTAIN", null]);
  assert.equal(evaluateHS1Location({ ...args, decisionPrice: 30, history: [...history("Power Quarterly"), { ...history("Power Quarterly")[0], atUtc: "2025-01-04T10:00:00Z" }] }).code, "HISTORY_ANCHOR_OR_DUPLICATE_DAY");
  assert.equal(evaluateHS1Location({ ...args, decisionPrice: 30, history: [{ ...history("Power Quarterly")[0], atUtc: "2025-01-01T11:00:00Z" }] }).code, "HISTORY_ANCHOR_OR_DUPLICATE_DAY");
  assert.equal(evaluateHS1Location({ ...args, decisionPrice: 30, history: [{ ...history("Power Quarterly")[0], pitAvailableAtUtc: "2025-01-02T10:00:00Z" }] }).code, "HISTORY_NOT_CAUSAL");
  assert.equal(evaluateHS1Location({ ...args, decisionPrice: 30, history: history("Gas Quarterly") }).code, "INVALID_HISTORY_ROW");
  assert.equal(evaluateHS1Location({ ...args, decisionPrice: 30, decisionPriceMission: "Gas Quarterly" }).code, "INVALID_DECISION_PRICE");
  assert.equal(evaluateHS1Location({ ...args, decisionPrice: 30, decisionPriceAvailableAtUtc: "2025-01-04T10:01:00Z" }).code, "DECISION_PRICE_NOT_PIT");
});

test("H04/H05: 11:00 Berlin is only an optional candidate and retains DST alignment", () => {
  const mission = "Gas Monthly";
  const stamps = [
    ["2025-01-01", "2025-01-01T10:00:00Z"],
    ["2025-01-02", "2025-01-02T10:00:00Z"],
    ["2025-06-01", "2025-06-01T09:00:00Z"],
    ["2025-06-02", "2025-06-02T09:00:00Z"],
  ];
  const rows = stamps.map(([sessionDate, atUtc]) => ({ mission, sessionDate, atUtc,
    anchor: "11:00", pitAvailableAtUtc: atUtc, available: true, sourceHash: h }));
  const built = predeclareHS1SearchSpace({ mission, developmentEndUtc: "2025-07-01T00:00:00Z",
    session: { mission, zone: "Europe/Berlin", anchors: ["11:00"], sourceHash: z },
    availability: rows, provenance: { authority: "SYNTHETIC_FIXTURE", locator: "DST", sourceHash: h } });
  assert.equal(built.ok, true);
  assert.deepEqual(built.searchSpace.candidates.map((point) => point.N), [3]);
  const candidate = createHS1Candidate({ searchSpace: built.searchSpace,
    tau: { zone: "Europe/Berlin", localTime: "11:00" }, N: 3 }).candidate;
  const result = evaluateHS1Location({ candidate, asOfUtc: stamps[3][1],
    decisionPriceMission: mission, decisionPriceSourceHash: h,
    decisionPrice: 20, decisionPriceAvailableAtUtc: stamps[3][1],
    history: rows.slice(0, 3).map((row, i) => ({ mission, atUtc: row.atUtc,
      pitAvailableAtUtc: row.pitAvailableAtUtc, price: [30, 40, 50][i], sourceHash: h })) });
  assert.equal(result.reference, 40);
  assert.equal(result.action, "BUY");
});

test("H07: all four missions reuse CONTROL's sizing and execution, only timing changes", () => {
  for (const mission of H_S1_01_MISSIONS) {
    const candidate = candidateFor(mission);
    const controller = createSizingController({ lotSizeMw: 1, dailyCapMw: 12,
      provenance: { authority: "SYNTHETIC_FIXTURE", locator: "test/s1-strategy/h-s1-01.test.mjs" } }).controller;
    const calendar = buildDecisionCalendar({ campaignId: `FIXTURE-${mission}`, tradingDates: ["2025-01-04", "2025-01-05", "2025-01-06"] }).calendar;
    const a0 = createA0Baseline({ controller, calendar }).arm;
    const control = { identity: "CONTROL", timing: "CALENDAR_ONLY_PRICE_BLIND", mission,
      controllerHash: controller.contentHash, calendarHash: z, executionContractHash: h };
    const inputs = { candidate, asOfUtc: "2025-01-04T10:00:00Z", decisionPriceAvailableAtUtc: "2025-01-04T10:00:00Z",
      decisionPriceMission: mission, decisionPriceSourceHash: h, history: history(mission) };
    const location = evaluateHS1Location({ ...inputs, decisionPrice: 30 });
    const unfavorable = evaluateHS1Location({ ...inputs, decisionPrice: 40 });
    const unknown = evaluateHS1Location({ ...inputs, decisionPrice: 30, history: history(mission).slice(0, 2) });
    for (const remainingVolumeMw of [3, 9, 18]) {
      const controlDecision = a0.decideAtOpportunity({ currentDate: "2025-01-04", remainingVolumeMw });
      assert.equal(controlDecision.action, "BUY");
      const favorable = decideHS1AgainstControl({ mission, candidate, control, controlDecision, location, asOfUtc: inputs.asOfUtc });
      assert.equal(favorable.requestedQuantityMw, controlDecision.requestedQuantityMw);
      assert.equal(favorable.executionContractHash, control.executionContractHash);
      assert.equal(favorable.controllerHash, control.controllerHash);
      const wait = decideHS1AgainstControl({ mission, candidate, control, controlDecision, location: unfavorable, asOfUtc: inputs.asOfUtc });
      assert.equal(wait.action, "WAIT");
      assert.equal(wait.requestedQuantityMw, 0);
      const abstain = decideHS1AgainstControl({ mission, candidate, control, controlDecision, location: unknown, asOfUtc: inputs.asOfUtc });
      assert.equal(abstain.action, "ABSTAIN");
      assert.equal(abstain.requestedQuantityMw, 0);
    }
    assert.equal(decideHS1AgainstControl({ mission, candidate, control,
      controlDecision: a0.decideAtOpportunity({ currentDate: "2025-01-04", remainingVolumeMw: 9 }),
      location: { ...location, candidateHash: z }, asOfUtc: inputs.asOfUtc }).code, "INVALID_ABLATION_CONTEXT");
    assert.equal(decideHS1AgainstControl({ mission, candidate, control: { ...control, mission: "INVALID" },
      controlDecision: a0.decideAtOpportunity({ currentDate: "2025-01-04", remainingVolumeMw: 9 }), location,
      asOfUtc: inputs.asOfUtc }).code, "INVALID_ABLATION_CONTEXT");
    assert.equal(decideHS1AgainstControl({ mission, candidate, control,
      controlDecision: { ...a0.decideAtOpportunity({ currentDate: "2025-01-04", remainingVolumeMw: 9 }), controllerVersion: z },
      location, asOfUtc: inputs.asOfUtc }).code, "INVALID_ABLATION_CONTEXT");
    assert.equal(decideHS1AgainstControl({ mission, candidate, control,
      controlDecision: a0.decideAtOpportunity({ currentDate: "2025-01-04", remainingVolumeMw: 9 }),
      location, asOfUtc: "2025-01-05T10:00:00Z" }).code, "INVALID_ABLATION_CONTEXT");
  }
});
