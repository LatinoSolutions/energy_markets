// Brazo HOUR del motor TRADES (TR-05): walk-forward cronológico dentro de
// Development. Fuente:
// docs/canonical/v1_1_1/OWNER_PATCH_TRADES_MODE_2026-09-25.md
// (EM-SPEC-OWNER-PATCH-2026-09-25-03) §5.4 ("En TRADES se sustituye por
// walk-forward: la hora de cada episodio se elige solo con episodios de
// Development anteriores a él; nunca ve OOS ni puente") y TRADES_MODE_PLAN.md
// TR-05 ("Brazo HOUR: walk-forward dentro de Development (patch 03 §5.4), no
// leave-one-out").
//
// Diferencia con el release v2: v2 elige la hora con leave-one-episode-out, que
// usa episodios FUTUROS. Aquí la elección de cada episodio sólo mira episodios
// de Development ANTERIORES; OOS, embargo, puente y post-puente nunca entran en
// la historia y sólo consumen la historia previa.

import { CLIENT_SLOT } from "../exploratory/backtest.mjs";
import { compareIsoDates } from "../oos-reservation/campaign-register.mjs";
import { ZONES } from "../oos-reservation/trades-zones.mjs";

function relativeToClient(profile, slot, clientSlot) {
  const client = profile.find((entry) => entry.slot === clientSlot);
  const candidate = profile.find((entry) => entry.slot === slot);
  if (!client?.complete || !candidate?.complete) return null;
  return candidate.avgPriceEurMwh - client.avgPriceEurMwh;
}

// Elige la hora con menor diferencia media contra A0@clientSlot sobre la
// HISTORIA (episodios anteriores). Sólo cuentan los episodios donde ambas horas
// completan el target; una hora que no completa en alguno de los pares se
// descarta. Sin historia no se elige hora (null): el brazo HOUR no se corre y
// queda en su propio estado NOT_RUN_NO_HISTORY (no es un fallo de la
// estrategia; revisión TR05-HOUR-STUB-07). El primer episodio de Development,
// por tanto, no tiene brazo HOUR.
export function chooseHourFromHistory({ history = [], slotLabels, clientSlot = CLIENT_SLOT } = {}) {
  if (history.length === 0) return null;
  let bestSlot = null;
  let bestMean = Infinity;
  for (const slot of slotLabels) {
    const diffs = [];
    let comparable = true;
    for (const entry of history) {
      const diff = relativeToClient(entry.profile, slot, clientSlot);
      if (diff === null) {
        comparable = false;
        break;
      }
      diffs.push(diff);
    }
    if (!comparable || diffs.length === 0) continue;
    const mean = diffs.reduce((sum, value) => sum + value, 0) / diffs.length;
    if (mean < bestMean) {
      bestMean = mean;
      bestSlot = slot;
    }
  }
  return bestSlot === null ? null : { slot: bestSlot, meanDiffEurMwh: bestMean, historySize: history.length };
}

// Asigna la hora de cada episodio en orden cronológico. Devuelve por campaign:
// zona, hora elegida, tamaño de historia y la garantía de que la historia sólo
// contiene episodios de Development.
export function assignWalkForwardHours({
  episodes = [],
  hourProfileOf,
  slotLabels,
  clientSlot = CLIENT_SLOT,
  zoneOf = (episode) => episode.zone,
} = {}) {
  const ordered = episodes
    .slice()
    .sort((left, right) => compareIsoDates(left.windowStart, right.windowStart)
      || (left.campaignId < right.campaignId ? -1 : 1));
  const assignments = {};
  const history = [];
  for (const episode of ordered) {
    const zone = zoneOf(episode);
    const choice = chooseHourFromHistory({ history, slotLabels, clientSlot });
    assignments[episode.campaignId] = {
      zone,
      chosenSlot: choice?.slot ?? null,
      meanDiffOnHistoryEurMwh: choice?.meanDiffEurMwh ?? null,
      historySize: history.length,
      historyOnlyDevelopment: history.every((entry) => entry.zone === ZONES.DEVELOPMENT),
    };
    // Sólo Development alimenta la historia: OOS/puente nunca son "pasado" para
    // una elección de hora (patch 03 §5.4).
    if (zone === ZONES.DEVELOPMENT) {
      history.push({ zone, profile: hourProfileOf(episode) });
    }
  }
  return assignments;
}
