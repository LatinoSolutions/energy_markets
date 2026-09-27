import { FRESHNESS_LIMIT_CANDIDATES_SECONDS, OBSERVATION_RULE_LIST } from "../trades-bridge/constants.mjs";
import { ZONES } from "../oos-reservation/trades-zones.mjs";
import { selectDevelopmentFreshness } from "./freshness-selection.mjs";
import { runTradesMission } from "./run.mjs";

const DEVELOPMENT_END = "2024-05-31";

// The input must already be restricted to Development. Reject rather than read
// any historical OOS/bridge row while selecting the freshness.
export function measureDevelopmentGrid({ missionKey, campaigns = [], rows = [], exchangeDays = [], candidate } = {}) {
  if (!candidate || campaigns.length === 0 || campaigns.some((c) => c.zone !== ZONES.DEVELOPMENT || c.windowEnd > DEVELOPMENT_END)
    || rows.some((row) => typeof row.TrdDate !== "string" || row.TrdDate > DEVELOPMENT_END)
    || [...exchangeDays].some((day) => day > DEVELOPMENT_END)) {
    return { status: "HOLD", code: "NON_DEVELOPMENT_INPUT", byLimit: null, selection: null };
  }
  const byLimit = {};
  for (const seconds of FRESHNESS_LIMIT_CANDIDATES_SECONDS) {
    byLimit[String(seconds)] = {};
    for (const rule of OBSERVATION_RULE_LIST) {
      const result = runTradesMission({ missionKey, zone: ZONES.DEVELOPMENT, observationRule: rule, campaigns, rows, exchangeDays, frozenContract: { decision: "HOLD", candidate }, freshnessCandidateSeconds: seconds });
      if (!result.ok) return { status: "HOLD", code: result.code, byLimit: null, selection: null };
      byLimit[String(seconds)][rule] = {
        ok: true, zone: result.zone, missionKey, observationRule: rule, freshnessCandidateSeconds: seconds, candidateConfigHash: candidate.configHash,
        episodes: result.episodes.map((episode) => ({
          zone: episode.zone,
          campaign: { campaignId: episode.campaign.campaignId, zone: episode.campaign.zone, windowStart: episode.campaign.windowStart },
          arms: Object.fromEntries(Object.entries(episode.arms).map(([arm, value]) => [arm, { summary: value?.summary ?? null }])),
        })),
      };
    }
  }
  const selection = selectDevelopmentFreshness({ missionKey, resultsByLimit: byLimit, expectedCampaignIds: campaigns.map((campaign) => campaign.campaignId), expectedCandidateHash: candidate.configHash });
  return { status: selection.status, code: selection.code, byLimit, selection };
}
