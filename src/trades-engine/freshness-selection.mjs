// TR-09. Métrica predeclarada antes de inspeccionar resultados: por misión,
// maximizar la mejora media pareada de precio de DIP10 y HOUR frente a A0,
// usando sólo campaigns de Development con los tres brazos completos. Empates:
// más pares completos, después menor antigüedad. La unidad es la campaign.
import { FRESHNESS_LIMIT_CANDIDATES_SECONDS, OBSERVATION_RULE_LIST } from "../trades-bridge/constants.mjs";
import { ZONES } from "../oos-reservation/trades-zones.mjs";

export const FRESHNESS_SELECTION_METRIC = Object.freeze({
  id: "DEVELOPMENT_PAIRED_FILL_IMPROVEMENT_V1",
  zone: ZONES.DEVELOPMENT,
  unit: "EUR/MWh per campaign",
  objective: "MAXIMIZE_MEAN_BASELINE_MINUS_MEAN_DIP10_HOUR",
  tieBreak: ["MORE_COMPLETE_PAIRS", "SHORTER_FRESHNESS_SECONDS"],
  rules: OBSERVATION_RULE_LIST,
});

function scoreResult(result, rule, missionKey, expectedCampaignIds, seconds, expectedCandidateHash) {
  if (result?.ok !== true || result.zone !== ZONES.DEVELOPMENT || result.observationRule !== rule || result.missionKey !== missionKey || !Array.isArray(result.episodes)) return null;
  if (result.freshnessCandidateSeconds !== seconds || (expectedCandidateHash && result.candidateConfigHash !== expectedCandidateHash)) return null;
  const episodes = [...result.episodes].sort((a, b) => String(a.campaign?.windowStart).localeCompare(String(b.campaign?.windowStart)));
  const ids = episodes.map((episode) => episode.campaign?.campaignId).sort();
  if (new Set(ids).size !== ids.length || (expectedCampaignIds && JSON.stringify(ids) !== JSON.stringify([...expectedCampaignIds].sort()))) return null;
  let sum = 0;
  let count = 0;
  for (const episode of episodes) {
    if (episode.zone !== ZONES.DEVELOPMENT || episode.campaign?.zone !== ZONES.DEVELOPMENT) return null;
    const prices = ["BASELINE", "DIP10", "HOUR"].map((arm) => episode.arms?.[arm]?.summary);
    if (prices.every((entry) => entry?.complete === true && Number.isFinite(entry.avgPriceEurMwh))) {
      sum += prices[0].avgPriceEurMwh - (prices[1].avgPriceEurMwh + prices[2].avgPriceEurMwh) / 2;
      count += 1;
    }
  }
  return { sum, count };
}

// `resultsByLimit[seconds][rule]` must contain the actual Development result of
// that candidate. No bridge/OOS result is accepted. Incomplete grid stays HOLD.
export function selectDevelopmentFreshness({ missionKey, resultsByLimit = {}, expectedCampaignIds = null, expectedCandidateHash = null } = {}) {
  const scores = [];
  for (const seconds of FRESHNESS_LIMIT_CANDIDATES_SECONDS) {
    const byRule = resultsByLimit[String(seconds)];
    if (!byRule) return { status: "HOLD", code: "INCOMPLETE_DEVELOPMENT_GRID", missionKey, selectedSeconds: null, scores };
    let sum = 0;
    let count = 0;
    for (const rule of OBSERVATION_RULE_LIST) {
      const scored = scoreResult(byRule[rule], rule, missionKey, expectedCampaignIds, seconds, expectedCandidateHash);
      if (scored === null) return { status: "HOLD", code: "NON_DEVELOPMENT_OR_INVALID_RESULT", missionKey, selectedSeconds: null, scores };
      sum += scored.sum;
      count += scored.count;
    }
    scores.push({ seconds, completePairs: count, meanImprovementEurMwh: count > 0 ? sum / count : null });
  }
  const eligible = scores.filter((entry) => entry.completePairs > 0);
  if (eligible.length === 0) return { status: "HOLD", code: "NO_COMPLETE_DEVELOPMENT_PAIRS", missionKey, selectedSeconds: null, scores };
  eligible.sort((a, b) => b.meanImprovementEurMwh - a.meanImprovementEurMwh || b.completePairs - a.completePairs || a.seconds - b.seconds);
  return { status: "SELECTED", code: null, missionKey, zone: ZONES.DEVELOPMENT, metric: FRESHNESS_SELECTION_METRIC, selectedSeconds: eligible[0].seconds, scores };
}
