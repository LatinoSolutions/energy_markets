import test from "node:test";
import assert from "node:assert/strict";
import {
  IDENTITY, MISSIONS, SEMANTIC_VERSION, H_S1_01,
  clientFor, benchmarkFor, controlFor, resolveLegacyAlias, compareAblation,
} from "../../src/backtesting-semantics/contract.mjs";
import { buildBacktestsViewModel } from "../../src/ui/view-models.mjs";
import { renderBacktestsPage } from "../../src/ui/render.mjs";

test("four obligations retain separate client and benchmark identities without invented economics", () => {
  assert.deepEqual(MISSIONS.map(({ id }) => id), ["GAS_QUARTERLY", "GAS_MONTHLY", "POWER_QUARTERLY", "POWER_MONTHLY"]);
  for (const mission of MISSIONS) {
    const client = clientFor(mission.id);
    const benchmark = benchmarkFor(mission.id);
    assert.equal(client.kind, IDENTITY.CLIENT);
    assert.equal(client.confirmed.purchaseTime, "11:00");
    assert.deepEqual(Object.values(client.unknown), Array(5).fill("UNKNOWN"));
    assert.equal(client.economics, null);
    assert.equal(client.scopeStatus, "UNAVAILABLE");
    assert.equal(benchmark.kind, IDENTITY.BENCHMARK);
    assert.equal(benchmark.id, "BENCHMARK");
    assert.equal(benchmark.value, null);
    assert.equal(benchmark.window, mission.cadence === "QUARTERLY" ? "3-1-3" : "1-0-1");
    assert.equal(benchmark.decisionAuthority, "NONE");
    assert.equal(client.version, SEMANTIC_VERSION);
  }
  assert.equal(clientFor("UNKNOWN").ok, false);
  assert.equal(clientFor("GAS_QUARTERLY", { campaignId: "c1" }).code, "INCOMPLETE_CLIENT_SCOPE");
  assert.equal(clientFor("GAS_QUARTERLY", { campaignId: "c1", obligationId: "o1" }).scopeStatus, "BOUND");
});

test("one benchmark identity retains provisional/official status under it", () => {
  const sha = "a".repeat(64);
  const provisional = benchmarkFor("GAS_QUARTERLY", { campaignId: "c1", obligationId: "o1", status: "BENCHMARK_PROVISIONAL", value: 42, referenceVersion: "r1", provenance: sha });
  assert.equal(provisional.id, "BENCHMARK");
  assert.equal(provisional.status, "BENCHMARK_PROVISIONAL");
  assert.equal(benchmarkFor("GAS_QUARTERLY", { status: "RECONCILED_OFFICIAL", value: 42 }).code, "UNBOUND_BENCHMARK_VALUE");
  assert.equal(benchmarkFor("GAS_QUARTERLY", { campaignId: "c1", obligationId: "o1", status: "RECONCILED_OFFICIAL" }).code, "UNBOUND_BENCHMARK_VALUE");
  assert.equal(benchmarkFor("GAS_QUARTERLY", { status: "UNAVAILABLE", value: 0, referenceVersion: "r1", provenance: sha }).code, "UNBOUND_BENCHMARK_VALUE");
});

test("CONTROL is run-bound, price-blind and cannot become client or production fallback", () => {
  const pair = { hypothesisId: "H-S1-01", runId: "r1", populationId: "p1", obligationId: "gq1", calendarVersion: "c1", sizingVersion: "s1", executionVersion: "e1", benchmarkVersion: "b1" };
  const control = controlFor(pair);
  assert.equal(control.kind, IDENTITY.CONTROL);
  assert.equal(control.timing, "CALENDAR_ONLY_PRICE_BLIND");
  assert.equal(control.requestedQuantity, "remainingVolume / remainingScheduledOpportunities");
  assert.equal(control.productionFallbackAuthorized, false);
  assert.equal(controlFor({ ...pair, executionVersion: null }).code, "CONTROL_BINDING_INCOMPLETE");
  assert.equal(H_S1_01.strategy, "S1");
  assert.equal(H_S1_01.result, null);
  assert.equal(H_S1_01.parameters.tau, "CONFIGURABLE");
  assert.equal(H_S1_01.parameters.N, "CONFIGURABLE");
});

test("legacy alias needs artifact, protocol, run and explicit mapping", () => {
  const artifactSha256 = "b".repeat(64);
  assert.equal(resolveLegacyAlias({ alias: "A0", artifactSha256, protocolVersion: "P5-v1" }).code, "UNBOUND_LEGACY_ALIAS");
  const mapping = { alias: "A0", artifactSha256, protocolVersion: "P5-v1", kind: "CONTROL", hypothesisId: "H-S1-01", runId: "r1", provenance: "receipt" };
  assert.equal(resolveLegacyAlias({ alias: "A0", artifactSha256, protocolVersion: "P5-v1", mapping }).kind, "CONTROL");
  assert.equal(resolveLegacyAlias({ alias: "ARM_A", artifactSha256, protocolVersion: "P5-v1", mapping }).ok, false);
  assert.equal(resolveLegacyAlias({ alias: "A0", artifactSha256: "c".repeat(64), protocolVersion: "P5-v1", mapping }).ok, false);
});

test("Delta V requires comparable pair and valid complete economics; relative improvement is not PASS", () => {
  const fields = { hypothesisId: "H-S1-01", runId: "r1", populationId: "p1", obligationId: "gq1", calendarVersion: "c1", sizingVersion: "s1", executionVersion: "e1", benchmarkVersion: "b1" };
  const control = controlFor(fields);
  const active = { kind: "HYPOTHESIS", id: "H-S1-01", ...Object.fromEntries(Object.entries(fields).filter(([key]) => key !== "hypothesisId")) };
  const economy = (H, status = "RECONCILED_OFFICIAL") => ({ status: "VALID_RUN", benchmarkStatus: status, costCompleteness: "FULL", B: 100, H, V: 100 - H });
  assert.equal(compareAblation({ control, active: { ...active, executionVersion: "other" } }).code, "PAIR_NOT_COMPARABLE");
  assert.equal(compareAblation({ control, active, controlEconomics: economy(92, "BENCHMARK_PROVISIONAL"), activeEconomics: economy(90) }).verdict, "HOLD");
  assert.equal(compareAblation({ control, active, controlEconomics: economy(92), activeEconomics: { ...economy(90), H: null } }).verdict, "HOLD");
  const result = compareAblation({ control, active, controlEconomics: economy(92), activeEconomics: economy(90) });
  assert.equal(result.deltaV, 2);
  assert.equal(result.equivalentCostDifference, 2);
  assert.equal(result.absolutePass, false);
  assert.equal(result.verdict, "HOLD");
});

test("main Backtests table uses three primary identities and keeps aliases in historical detail", () => {
  const vm = buildBacktestsViewModel();
  assert.equal(vm.semanticComparison.length, 4);
  const html = renderBacktestsPage(vm);
  const start = html.indexOf('data-semantic="SEM-1/2026-09-28/v1"');
  const end = html.indexOf('data-semantic="legacy-provenance"');
  assert.ok(start > 0 && end > start);
  const primary = html.slice(start, end);
  assert.match(primary, /Client \/ Benchmark \/ Hypotheses/);
  assert.match(primary, /H-S1-01 is a research question/);
  assert.doesNotMatch(primary, /H-S1-01 · PASS|Arm A|Arm B|BASELINE|B\*/);
  assert.match(html, /<details data-semantic="legacy-provenance"/);
});
