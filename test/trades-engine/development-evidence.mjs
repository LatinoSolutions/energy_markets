// Synthetic evidence for contract/runner tests. This is never a market run or
// an owner approval; it exercises the shape and binding of a completed grid.
import { contentHashOf } from "../../src/execution-contract/execution-contract.mjs";
import { buildTradesFreezeCandidate } from "../../src/execution-contract/trades-contract.mjs";
import { FRESHNESS_LIMIT_CANDIDATES_SECONDS, OBSERVATION_RULE_LIST } from "../../src/trades-bridge/constants.mjs";
import { TRADES_MISSIONS } from "../../src/oos-reservation/trades-windows.mjs";

export function syntheticDevelopmentEvidence(measurement, sourceDecision, inputsPresent = { measurement: true, sourceDecision: false }) {
  const zonePlanSha256 = "b".repeat(64);
  const candidateConfigHash = buildTradesFreezeCandidate({
    measurement, sourceDecision,
    deleteTmSemantics: sourceDecision?.measurements?.deleteTmSemantics?.value ?? sourceDecision?.deleteTmSemantics ?? null,
    generatedFrom: { bridgeMeasurement: inputsPresent.measurement ? "operations/trades/TR-03/bridge-measurement.json" : null, bridgeMeasurementSha256: contentHashOf(measurement), sourceDecision: inputsPresent.sourceDecision ? "operations/trades/TR-01/DATA_SOURCE_DECISION.json" : null, developmentSelectionSha256: null },
  }).configHash;
  const missions = {};
  const byMission = {};
  for (const missionKey of Object.keys(TRADES_MISSIONS)) {
    const campaignId = `DEV-${missionKey}`;
    missions[missionKey] = { zones: { DEVELOPMENT: [{ campaignId }] } };
    byMission[missionKey] = Object.fromEntries(FRESHNESS_LIMIT_CANDIDATES_SECONDS.map((seconds) => [String(seconds), Object.fromEntries(OBSERVATION_RULE_LIST.map((rule) => [rule, {
      ok: true, zone: "DEVELOPMENT", missionKey, observationRule: rule, freshnessCandidateSeconds: seconds, candidateConfigHash,
      episodes: [{ zone: "DEVELOPMENT", campaign: { campaignId, zone: "DEVELOPMENT", windowStart: "2023-01-01" }, arms: Object.fromEntries(["BASELINE", "DIP10", "HOUR"].map((arm) => [arm, { summary: { complete: true, avgPriceEurMwh: 100 } }])) }],
    }]))]));
  }
  return {
    zonePlan: { decision: "RESERVED", missions },
    zonePlanSha256,
    developmentResults: {
      candidateConfigHash,
      sources: { measurement: { sha256: contentHashOf(measurement) }, sourceDecision: { sha256: contentHashOf(sourceDecision) }, zonePlan: { sha256: zonePlanSha256 } },
      byMission,
    },
  };
}
