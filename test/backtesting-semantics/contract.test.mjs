import test from "node:test";
import assert from "node:assert/strict";
import {
  IDENTITY, MISSIONS, SEMANTIC_VERSION, H_S1_01,
  clientFor, benchmarkFor, controlFor, resolveLegacyAlias, compareAblation,
} from "../../src/backtesting-semantics/contract.mjs";
import { buildBacktestsViewModel } from "../../src/ui/view-models.mjs";
import { renderBacktestsPage } from "../../src/ui/render.mjs";
import { withBacktestJobControl } from "../../src/ui/backtest-job-panel.mjs";

test("four obligations retain separate client and benchmark identities without invented economics", () => {
  assert.deepEqual(MISSIONS.map(({ id }) => id), ["GAS_QUARTERLY", "GAS_MONTHLY", "POWER_QUARTERLY", "POWER_MONTHLY"]);
  for (const mission of MISSIONS) {
    const client = clientFor(mission.id);
    const benchmark = benchmarkFor(mission.id);
    assert.equal(client.kind, IDENTITY.CLIENT);
    assert.equal(client.confirmed.purchaseTime, mission.id === "GAS_QUARTERLY" ? "11:00" : undefined);
    assert.deepEqual(Object.values(client.unknown), Array(mission.id === "GAS_QUARTERLY" ? 5 : 6).fill("UNKNOWN"));
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
  const historical = clientFor("GAS_QUARTERLY", { campaignId: "historical", obligationId: "o1" });
  assert.equal(historical.confirmed.purchaseTime, undefined);
  assert.equal(historical.unknown.purchaseTime, "UNKNOWN");
  const evidence = { kind: "CLIENT_PURCHASE_TIME", missionId: "GAS_QUARTERLY", campaignId: "historical", obligationId: "o1", purchaseTime: "10:30", timezone: "Europe/Berlin", provenance: "client-receipt" };
  assert.equal(clientFor("GAS_QUARTERLY", { campaignId: "historical", obligationId: "o1", behaviorEvidence: { ...evidence, campaignId: "other" } }).unknown.purchaseTime, "UNKNOWN");
  assert.equal(clientFor("GAS_QUARTERLY", { campaignId: "historical", obligationId: "o1", behaviorEvidence: evidence }).confirmed.purchaseTime, "10:30");
});

test("one benchmark identity retains provisional/official status under it", () => {
  const sha = "a".repeat(64);
  const provisional = benchmarkFor("GAS_QUARTERLY", { campaignId: "c1", obligationId: "o1", status: "BENCHMARK_PROVISIONAL", value: 42, referenceVersion: "r1", provenance: sha });
  assert.equal(provisional.id, "BENCHMARK");
  assert.equal(provisional.status, "BENCHMARK_PROVISIONAL");
  assert.equal(benchmarkFor("GAS_QUARTERLY", { status: "RECONCILED_OFFICIAL", value: 42 }).code, "UNBOUND_BENCHMARK_VALUE");
  assert.equal(benchmarkFor("GAS_QUARTERLY", { campaignId: "c1", obligationId: "o1", status: "RECONCILED_OFFICIAL" }).code, "UNBOUND_BENCHMARK_VALUE");
  assert.equal(benchmarkFor("GAS_QUARTERLY", { campaignId: "c1", obligationId: "o1", status: "RECONCILED_OFFICIAL", referenceVersion: "r1", provenance: sha, value: null }).code, "UNBOUND_BENCHMARK_VALUE");
  assert.equal(benchmarkFor("GAS_QUARTERLY", { campaignId: "c1", obligationId: "o1", status: "BENCHMARK_PROVISIONAL", referenceVersion: "r1", provenance: sha, value: null }).code, "UNBOUND_BENCHMARK_VALUE");
  assert.equal(benchmarkFor("GAS_QUARTERLY", { status: "UNAVAILABLE", value: 0, referenceVersion: "r1", provenance: sha }).code, "UNBOUND_BENCHMARK_VALUE");
});

test("CONTROL is run-bound, price-blind and cannot become client or production fallback", () => {
  const pair = { hypothesisId: "H-S1-01", runId: "r1", populationId: "p1", campaignId: "camp1", obligationId: "gq1", calendarVersion: "c1", sizingVersion: "s1", executionVersion: "e1", benchmarkVersion: "b1", artifactSha256: "c".repeat(64) };
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
  assert.equal(resolveLegacyAlias({ alias: "A0", artifactSha256, protocolVersion: "P5-v1", mapping: { ...mapping, kind: "HYPOTHESIS" } }).ok, false);
  assert.equal(resolveLegacyAlias({ alias: "A1", artifactSha256, protocolVersion: "P5-v1", mapping: { ...mapping, alias: "A1", kind: "CONTROL" } }).ok, false);
  assert.equal(resolveLegacyAlias({ alias: "ARM_A", artifactSha256, protocolVersion: "P5-v1", mapping }).ok, false);
  assert.equal(resolveLegacyAlias({ alias: "A0", artifactSha256: "c".repeat(64), protocolVersion: "P5-v1", mapping }).ok, false);
});

test("Delta V requires comparable pair and valid complete economics; relative improvement is not PASS", () => {
  const fields = { hypothesisId: "H-S1-01", runId: "r1", populationId: "p1", campaignId: "camp1", obligationId: "gq1", calendarVersion: "c1", sizingVersion: "s1", executionVersion: "e1", benchmarkVersion: "b1", artifactSha256: "c".repeat(64) };
  const control = controlFor(fields);
  const active = { kind: "HYPOTHESIS", id: "H-S1-01", ...Object.fromEntries(Object.entries(fields).filter(([key]) => key !== "hypothesisId")), artifactSha256: "d".repeat(64) };
  const economy = (arm, H, status = "RECONCILED_OFFICIAL") => ({ status: "VALID_RUN", benchmarkStatus: status, costCompleteness: "FULL", campaignId: arm.campaignId, obligationId: arm.obligationId, runId: arm.runId, artifactSha256: arm.artifactSha256, benchmarkVersion: arm.benchmarkVersion, benchmarkArtifactSha256: "e".repeat(64), unit: "EUR/MWh", B: 100, H, V: 100 - H });
  assert.equal(compareAblation({ control, active: { ...active, executionVersion: "other" } }).code, "PAIR_NOT_COMPARABLE");
  const c = economy(control, 92);
  const a = economy(active, 90);
  assert.equal(compareAblation({ control, active, controlEconomics: { ...c, benchmarkStatus: "BENCHMARK_PROVISIONAL" }, activeEconomics: a }).verdict, "HOLD");
  assert.equal(compareAblation({ control, active, controlEconomics: c, activeEconomics: { ...a, H: null } }).verdict, "HOLD");
  for (const tampered of [{ ...a, unit: "EUR/MW" }, { ...a, campaignId: "other" }, { ...a, artifactSha256: "f".repeat(64) }, { ...a, benchmarkArtifactSha256: "f".repeat(64) }]) {
    const result = compareAblation({ control, active, controlEconomics: c, activeEconomics: tampered });
    assert.equal(result.verdict, "HOLD");
    assert.equal(result.deltaV, undefined);
  }
  const result = compareAblation({ control, active, controlEconomics: c, activeEconomics: a });
  assert.equal(result.deltaV, 2);
  assert.equal(result.equivalentCostDifference, 2);
  assert.equal(result.absolutePass, false);
  assert.equal(result.verdict, "HOLD");
});

test("main Backtests table uses three primary identities and keeps aliases in historical detail", () => {
  const vm = buildBacktestsViewModel();
  assert.equal(vm.semanticComparison.length, 4);
  const html = renderBacktestsPage(vm);
  // UI-08: the primary comparison lives in the Results/Comparison section; the
  // legacy aliases only appear below, inside the historical provenance details.
  const start = html.indexOf('data-section="results"');
  const end = html.indexOf('<details data-semantic="legacy-provenance"');
  assert.ok(start > 0 && end > start);
  const primary = html.slice(start, end);
  assert.match(primary, /Client \/ Benchmark \/ Hypotheses/);
  assert.doesNotMatch(primary, /H-S1-01 · PASS|Arm A|Arm B|BASELINE|B\*/);
  assert.match(html, /<details data-semantic="legacy-provenance"/);
  const currentPanels = html.match(/<div data-kind="current-backtest-panels"[\s\S]*?<\/div>\s*<section/);
  assert.ok(currentPanels, "observation panels render as a block");
  assert.match(currentPanels[0], /TRADES/);
  const withJob = withBacktestJobControl(html, { trades: { gate: { ok: true } } }, { mode: "TRADES" });
  assert.match(withJob, /data-job-start>Run TRADES backtest<\/button>/);
  assert.match(withBacktestJobControl(html, {}, { mode: "TOB" }), /data-job-start>Run legacy TOB backtest<\/button>/);
});
