// Synthetic, structurally bound BT-08 result for backend and API tests. This
// fixture asserts transport semantics only; it is never real research evidence.
import { controlFor } from "../../src/backtesting-semantics/contract.mjs";

const sha = (letter) => letter.repeat(64);

export function boundDevelopmentResult({ missionId = "GAS_MONTHLY", runId = `HYP-RUN-${sha("a")}`, overrides = {} } = {}) {
  const root = `operations/backtest-runs/${runId}/attempt-1`;
  const parity = {
    hypothesisId: "H-S1-01", experimentId: `H-S1-01|${missionId}|${runId}`,
    missionId, runId, populationId: `population-${missionId}`,
    campaignId: `campaign-${missionId}`, obligationId: `obligation-${missionId}`,
    calendarVersion: "calendar-v1", sizingVersion: "sizing-v1",
    executionVersion: "execution-v1", benchmarkVersion: "benchmark-v1",
    constraintsVersion: "constraints-v1",
  };
  const active = { ok: true, kind: "HYPOTHESIS", id: "H-S1-01", ...parity, hypothesisLayer: "H-S1-01", artifactSha256: sha("d") };
  const ablation = {
    paired: true, ok: true, verdict: "HOLD", deltaV: 1.234,
    equivalentCostDifference: 1.234, absolutePass: false,
    experimentBinding: {
      hypothesisId: "H-S1-01", missionId, experimentId: parity.experimentId, runId,
      control: controlFor({ ...parity, active, artifactSha256: sha("c") }),
      active,
    },
  };
  return {
    sourceKind: "HYPOTHESIS_DEVELOPMENT",
    family: `H-S1-01|${missionId}|DEVELOPMENT|TOB`,
    hypothesisId: "H-S1-01", hypothesisVersion: "H-S1-01/phase-A/v2",
    missionId, runId, phase: "DEVELOPMENT", dataMode: "TOB",
    status: "SUCCEEDED", validComparison: true, retention: { state: "CURRENT" },
    receiptPath: `${root}/RUN_RECEIPT.json`,
    resultPath: `${root}/output/output/hypothesis-development-results.json`, resultSha256: sha("e"),
    manifestPath: `${root}/output/output/hypothesis-development-results.MANIFEST.json`, manifestSha256: sha("f"),
    ablation,
    ...overrides,
  };
}
