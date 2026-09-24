// Corre el backtest exploratorio sobre el artifact de slots y escribe los
// resultados. Uso:
//   node operations/exploratory/run-exploratory-backtest.mjs <slots.json> <salida.json>
// Owner patch EM-SPEC-OWNER-PATCH-2026-09-24-02 §4: resultados EXPLORATORY.

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

import {
  CLIENT_SLOT,
  FILL_MODELS,
  POLICIES,
  TARGET_MW,
  episodeTradingDays,
  runEpisode,
} from "../../src/exploratory/backtest.mjs";

const [slotsPath, outPath] = process.argv.slice(2);
const slotsBytes = readFileSync(slotsPath);
const slots = JSON.parse(slotsBytes);
const calendar = JSON.parse(readFileSync("operations/audit/IMP-09/eex-exchange-calendar.json", "utf8"));
const exchangeDays = calendar.exchangeDays;
const clientSlotIndex = slots.slotsBerlin.indexOf(CLIENT_SLOT);

const allDataDays = Object.values(slots.series).flatMap((series) => Object.keys(series)).sort();
const firstDataDay = allDataDays[0];
const lastDataDay = allDataDays.at(-1);

// Un episodio es completo si toda su ventana cae dentro del periodo de data.
const episodes = [];
for (const key of Object.keys(slots.series)) {
  const [product, maturity] = key.split("|");
  const tradingDays = episodeTradingDays({ product, maturity, exchangeDays });
  if (tradingDays.length === 0) continue;
  const complete = tradingDays[0] >= firstDataDay && tradingDays.at(-1) < lastDataDay;
  episodes.push({ product, maturity, key, tradingDays, complete });
}
const complete = episodes.filter((episode) => episode.complete);

function summarize(result) {
  const { ledger, ...rest } = result;
  return rest;
}

function run(episode, policyId, slotIndex, fillModel) {
  return runEpisode({
    series: slots.series[episode.key],
    tradingDays: episode.tradingDays,
    slotIndex,
    targetMw: TARGET_MW[episode.product],
    policy: POLICIES[policyId],
    fillModel,
  });
}

const results = [];
for (const episode of complete) {
  const base = run(episode, "A0", clientSlotIndex, FILL_MODELS.CLIENT);
  const hourProfile = slots.slotsBerlin.map((label, slotIndex) => {
    const result = run(episode, "A0", slotIndex, FILL_MODELS.CLIENT);
    return { slot: label, avgPriceEurMwh: result.avgPriceEurMwh, complete: result.complete, noQuoteDays: result.noQuoteDays };
  });
  const arms = {};
  for (const policyId of Object.keys(POLICIES)) {
    for (const fillModel of Object.values(FILL_MODELS)) {
      arms[`${policyId}@${CLIENT_SLOT}/${fillModel}`] = summarize(run(episode, policyId, clientSlotIndex, fillModel));
    }
  }
  results.push({
    product: episode.product,
    maturity: episode.maturity,
    tradingDays: episode.tradingDays.length,
    firstDay: episode.tradingDays[0],
    lastDay: episode.tradingDays.at(-1),
    arms,
    hourProfile,
    ledgerClientA0: base.ledger,
    ledgerClientDip: run(episode, "DIP10", clientSlotIndex, FILL_MODELS.CLIENT).ledger,
  });
}

// Hora elegida sin mirar el episodio evaluado (leave-one-episode-out): se elige la
// hora con menor diferencia media contra A0@11:00 en los OTROS episodios del
// mismo producto, y se mide en el episodio excluido.
function relativeToClient(entry, slot) {
  const client = entry.hourProfile.find((item) => item.slot === CLIENT_SLOT);
  const other = entry.hourProfile.find((item) => item.slot === slot);
  if (!other?.complete || !client?.complete) return null;
  return other.avgPriceEurMwh - client.avgPriceEurMwh;
}
for (const entry of results) {
  const peers = results.filter((other) => other.product === entry.product && other !== entry);
  let bestSlot = null;
  let bestMean = Infinity;
  // Solo cuentan los episodios pares donde ambas horas completan el target; una hora
  // que no completa en alguno de esos pares queda descartada.
  const comparablePeers = peers.filter((peer) => relativeToClient(peer, CLIENT_SLOT) !== null);
  for (const slot of slots.slotsBerlin) {
    const diffs = comparablePeers.map((peer) => relativeToClient(peer, slot));
    if (comparablePeers.length === 0 || diffs.some((value) => value === null)) continue;
    const mean = diffs.reduce((sum, value) => sum + value, 0) / diffs.length;
    if (mean < bestMean) {
      bestMean = mean;
      bestSlot = slot;
    }
  }
  entry.leaveOneOutHour = bestSlot === null ? null : {
    slotChosenOnOtherEpisodes: bestSlot,
    meanDiffOnOtherEpisodesEurMwh: bestMean,
    diffOnThisEpisodeEurMwh: relativeToClient(entry, bestSlot),
  };
}

// Resumen por producto: solo episodios donde los dos brazos completan el target,
// para no comparar precios medios de cantidades distintas.
function mean(values) {
  return values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length;
}
const summary = {};
for (const product of Object.keys(TARGET_MW)) {
  const rows = results.filter((entry) => entry.product === product);
  const paired = rows.filter((entry) => entry.arms["A0@11:00/CLIENT"].complete && entry.arms["DIP10@11:00/CLIENT"].complete);
  const dipDiffs = paired.map((entry) => entry.arms["DIP10@11:00/CLIENT"].avgPriceEurMwh - entry.arms["A0@11:00/CLIENT"].avgPriceEurMwh);
  const looDiffs = rows.map((entry) => entry.leaveOneOutHour?.diffOnThisEpisodeEurMwh).filter((value) => typeof value === "number");
  summary[product] = {
    episodes: rows.length,
    episodesA0Complete: rows.filter((entry) => entry.arms["A0@11:00/CLIENT"].complete).length,
    dipVsA0: { pairedEpisodes: paired.length, meanDiffEurMwh: mean(dipDiffs), episodesCheaper: dipDiffs.filter((value) => value < 0).length, diffsEurMwh: dipDiffs },
    dipDepthCompleteEpisodes: rows.filter((entry) => entry.arms["DIP10@11:00/DEPTH"].complete).length,
    leaveOneOutHour: { evaluatedEpisodes: looDiffs.length, meanDiffEurMwh: mean(looDiffs), diffsEurMwh: looDiffs },
  };
}

const output = {
  artifactKind: "EXPLORATORY_BACKTEST_RESULTS",
  status: "EXPLORATORY",
  ownerPatch: "EM-SPEC-OWNER-PATCH-2026-09-24-02",
  inputs: {
    slots: { path: slotsPath, sha256: createHash("sha256").update(slotsBytes).digest("hex") },
    calendar: "operations/audit/IMP-09/eex-exchange-calendar.json",
    dataPeriod: { firstDataDay, lastDataDay },
  },
  rules: {
    targetsMw: TARGET_MW,
    clientSlotBerlin: CLIENT_SLOT,
    slippageEurMwh: 0.15,
    dailyCapMw: 12,
    lotMw: 1,
    feesEurMwh: "UNKNOWN (no incluidos; pedidos al cliente)",
    fillModels: { CLIENT: "cantidad completa al ask + slippage", DEPTH: "máximo AskSz visible del quote" },
  },
  summary,
  episodesSkippedIncomplete: episodes.filter((episode) => !episode.complete).map((episode) => `${episode.product} ${episode.maturity}`),
  results,
};
const outputBytes = Buffer.from(JSON.stringify(output, null, 1));
writeFileSync(outPath, outputBytes);
// El manifest ata resultados, input y generadores por sha256; la UI solo acepta
// resultados cuyo hash coincide con este manifest commiteado.
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const manifest = {
  artifactKind: "EXPLORATORY_BACKTEST_MANIFEST",
  status: "EXPLORATORY",
  ownerPatch: "EM-SPEC-OWNER-PATCH-2026-09-24-02",
  results: { path: outPath, sha256: sha(outputBytes) },
  slots: output.inputs.slots,
  generators: [
    "operations/exploratory/build_tob_slots.py",
    "operations/exploratory/run-exploratory-backtest.mjs",
    "src/exploratory/backtest.mjs",
  ].map((path) => ({ path, sha256: sha(readFileSync(path)) })),
};
writeFileSync("operations/exploratory/MANIFEST.json", JSON.stringify(manifest, null, 1));
console.log(`episodios completos: ${complete.length}; incompletos: ${output.episodesSkippedIncomplete.length}`);
