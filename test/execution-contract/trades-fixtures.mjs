// Fixtures sintéticas compartidas por los tests de TR-04. NO son la medición
// real del puente (TR-03 es un job que lanza Bru) ni una aprobación real de Bru.

import { FRESHNESS_LIMIT_CANDIDATES_SECONDS } from "../../src/trades-bridge/constants.mjs";
import { TRADES_FREEZE_SCOPE } from "../../src/execution-contract/index.mjs";

function coverageFor(targetLimit) {
  const byLimit = {};
  for (const limit of FRESHNESS_LIMIT_CANDIDATES_SECONDS) {
    byLimit[String(limit)] = {
      slotsWithObservationWithinLimit: limit >= targetLimit ? 990 : 400,
      coverage: limit >= targetLimit ? 0.99 : 0.4,
    };
  }
  return { slotsTotal: 1000, slotsWithObservation: 990, coverage: 0.99, coverageByLimit: byLimit, ageSeconds: { count: 990 } };
}

function missionMeasurement({ penaltyEurMwh, observations, targetLimit }) {
  const buyCount = Math.floor(observations / 2);
  const sellCount = Math.floor(observations / 4);
  const unknownCount = observations - buyCount - sellCount;
  return {
    coverage: { LAST_TRADE: coverageFor(targetLimit), SLOT_VWAP: coverageFor(targetLimit) },
    gaps: {
      LAST_TRADE: {
        byDip10StateByAggressor: [
          { combination: "BELOW_MEAN|BUY", count: buyCount, mean: -penaltyEurMwh },
          { combination: "BELOW_MEAN|SELL", count: sellCount, mean: -penaltyEurMwh },
          { combination: "BELOW_MEAN|UNKNOWN", count: unknownCount, mean: -penaltyEurMwh },
          { combination: "NOT_BELOW_MEAN|BUY", count: 500, mean: -penaltyEurMwh },
        ],
      },
      SLOT_VWAP: { byDip10StateByAggressor: [] },
    },
  };
}

export function measurementFixture({ gasQuarterly = 2, gasMonthly = 2.5, powerQuarterly = 1, powerMonthly = 0.5, observations = 40, targetLimit = 1800 } = {}) {
  return {
    artifactKind: "TR-03_BRIDGE_MEASUREMENT",
    markets: {
      GAS_THE: {
        missions: {
          GAS_QUARTERLY: missionMeasurement({ penaltyEurMwh: gasQuarterly, observations, targetLimit }),
          GAS_MONTHLY: missionMeasurement({ penaltyEurMwh: gasMonthly, observations, targetLimit }),
        },
      },
      POWER_DE: {
        missions: {
          POWER_QUARTERLY: missionMeasurement({ penaltyEurMwh: powerQuarterly, observations, targetLimit }),
          POWER_MONTHLY: missionMeasurement({ penaltyEurMwh: powerMonthly, observations, targetLimit }),
        },
      },
    },
  };
}

// FIXTURE: aprobación sintética, NO es una decisión real de Bru.
export function approvalFor(configHash) {
  return {
    approvalRef: "OWNER-DECISION-TR-04-FIXTURE",
    approvedBy: { authority: "Bru", role: "owner" },
    decision: "APPROVED",
    scope: TRADES_FREEZE_SCOPE,
    approvedAtUtc: "2026-09-25T00:00:00Z",
    configHash,
  };
}

export function frozenInput(overrides = {}) {
  return {
    measurement: measurementFixture(),
    brokenSpreadPolicy: "INCLUDE",
    deleteTmSemantics: "deletion-time",
    ...overrides,
  };
}
