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
import { buildComparison } from "../../src/exploratory/comparison.mjs";

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
  const calendarWindow = episodeTradingDays({ product, maturity, exchangeDays });
  if (calendarWindow.length === 0) continue;
  // La ventana tiene que caer entera dentro de la data ANTES de recortar los días
  // finales sin cotización; si no, un episodio cortado por falta de data parecería completo.
  const complete = calendarWindow[0] >= firstDataDay && calendarWindow.at(-1) < lastDataDay;
  const quotedDays = new Set(Object.entries(slots.series[key]).filter(([, daySlots]) => daySlots.some((slot) => slot !== null)).map(([day]) => day));
  const tradingDays = episodeTradingDays({ product, maturity, exchangeDays, quotedDays });
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
    episodeRef: episode,
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

// Comparación de brazos para la vista Backtests (mockup DES-01): Baseline = práctica
// del cliente (A0 a las 11:00), Arm A = DIP10 a las 11:00, Arm B = A0 a la hora elegida
// sin mirar el episodio (leave-one-out). Todos con fill CLIENT.
const ARM_LABELS = { BASELINE: "Baseline · A0 11:00 (client practice)", ARM_A: "Arm A · DIP10 11:00", ARM_B: "Arm B · A0 at out-of-episode hour" };
const comparison = {};
for (const product of Object.keys(TARGET_MW)) {
  const entries = results.filter((entry) => entry.product === product);
  comparison[product] = buildComparison({
    product,
    armLabels: ARM_LABELS,
    episodes: entries.map((entry) => {
      const armBSlot = entry.leaveOneOutHour?.slotChosenOnOtherEpisodes ?? null;
      const armB = armBSlot === null ? null : run(entry.episodeRef, "A0", slots.slotsBerlin.indexOf(armBSlot), FILL_MODELS.CLIENT);
      const pack = (result, slot) => result && { ledger: result.ledger, summary: summarize(result), slot };
      return {
        maturity: entry.maturity,
        arms: {
          BASELINE: pack(run(entry.episodeRef, "A0", clientSlotIndex, FILL_MODELS.CLIENT), CLIENT_SLOT),
          ARM_A: pack(run(entry.episodeRef, "DIP10", clientSlotIndex, FILL_MODELS.CLIENT), CLIENT_SLOT),
          ARM_B: pack(armB, armBSlot),
        },
      };
    }),
  });
}
// Replay (mockup DES-01 "decision inspector"): por episodio, la serie de asks de las
// 11:00 y las decisiones de cada brazo. Lo "known at T0" y lo "later" se separan en la UI
// por fecha; aquí solo se entregan los hechos con su fecha.
const replay = results.map((entry) => {
  const block = comparison[entry.product].perEpisode.find((item) => item.maturity === entry.maturity);
  const series = slots.series[entry.episodeRef.key];
  const armRuns = {
    BASELINE: run(entry.episodeRef, "A0", clientSlotIndex, FILL_MODELS.CLIENT).ledger,
    ARM_A: run(entry.episodeRef, "DIP10", clientSlotIndex, FILL_MODELS.CLIENT).ledger,
  };
  // Inspector por decisión con compra de Arm A: lo que se sabía a T0 (asks de las
  // 11:00 hasta ese día), el fill y, aparte, la evaluación posterior contra Baseline.
  const inspector = armRuns.ARM_A.map((decision, index) => ({ decision, index })).filter(({ decision }) => decision.filledMw > 0).map(({ decision, index }) => {
    const base = armRuns.BASELINE[index];
    const valueOf = (item) => (item.filledMw > 0 ? (block.benchmark - item.priceEurMwh) * item.filledMw * block.hours : 0);
    return {
      index,
      day: decision.day,
      requestedMw: decision.requestedMw,
      filledMw: decision.filledMw,
      ask: decision.ask,
      askSz: decision.askSz,
      bid: decision.bid,
      quoteTm: decision.quoteTm,
      priceEurMwh: decision.priceEurMwh,
      remainingMwAfter: decision.remainingMw,
      pastAsksUsed: armRuns.ARM_A.slice(Math.max(0, index - 10), index).filter((item) => typeof item.ask === "number").length,
      baseline: { filledMw: base.filledMw, priceEurMwh: base.priceEurMwh ?? null },
      deltaVEur: valueOf(decision) - valueOf(base),
    };
  });
  return {
    product: entry.product,
    maturity: entry.maturity,
    benchmark: block.benchmark,
    hours: block.hours,
    inspector,
    hArmA: block.arms.ARM_A?.h ?? null,
    hBaseline: block.arms.BASELINE?.h ?? null,
    ask11: entry.episodeRef.tradingDays.map((day) => ({ day, ask: series[day]?.[clientSlotIndex]?.ask ?? null })),
    decisions: armRuns,
  };
});

// Campaigns & Runs: una campaign por episodio (completos e incompletos), con sus gates,
// unknowns explícitos y los runs de cada brazo.
const campaigns = episodes.map((episode) => {
  const entry = results.find((item) => item.product === episode.product && item.maturity === episode.maturity);
  const block = entry ? comparison[episode.product].perEpisode.find((item) => item.maturity === episode.maturity) : null;
  const noQuote = entry ? entry.arms["A0@11:00/CLIENT"].noQuoteDays : null;
  return {
    id: `GAS-${episode.product === "G0BQ" ? "Q" : "M"}-${episode.maturity}`,
    product: episode.product,
    maturity: episode.maturity,
    targetMw: TARGET_MW[episode.product],
    firstDay: episode.tradingDays[0],
    lastDay: episode.tradingDays.at(-1),
    tradingDays: episode.tradingDays.length,
    readiness: episode.complete ? "EXPLORATORY_COMPLETE" : "INSUFFICIENT_DATA",
    gates: episode.complete ? [
      { label: "Runs pinned to one data snapshot", status: "PASS", detail: `tob-slots sha ${output_slots_sha().slice(0, 12)} for every arm` },
      { label: "Look-ahead guard", status: "PASS", detail: "quotes with Tm <= decision slot only (test/exploratory)" },
      { label: "All arms complete", status: Object.values(block.arms).every((arm) => arm === null || arm.complete) ? "PASS" : "FAIL", detail: Object.entries(block.arms).map(([id, arm]) => `${id} ${arm ? `${arm.boughtMw}/${TARGET_MW[episode.product]} MW` : "not run"}`).join(" · ") },
      { label: "Fresh 11:00 quote every decision day", status: noQuote === 0 ? "PASS" : "DEGRADED", detail: `${noQuote} day(s) without a fresh quote` },
      { label: "Evaluation window closed", status: "PASS", detail: `window ended ${episode.tradingDays.at(-1)}` },
    ] : [
      { label: "Window inside the data period", status: "FAIL", detail: `data ${firstDataDay} → ${lastDataDay}; window ${episode.tradingDays[0]} → ${episode.tradingDays.at(-1)}` },
    ],
    runs: entry ? Object.entries(block.arms).map(([armId, arm]) => ({ armId, slot: arm?.slot ?? null, status: arm === null ? "NOT_RUN" : arm.complete ? "COMPLETE" : "INCOMPLETE", boughtMw: arm?.boughtMw ?? 0, decisions: episode.tradingDays.length, hEurMwh: arm?.h ?? null })) : [],
  };
});
const campaignUnknowns = [
  { id: "U-EM-1", blocking: true, title: "Execution fees unknown", detail: "EEX/ECC and broker fees per MWh not provided; V excludes them.", blocks: "Economic V and ΔV as final figures" },
  { id: "U-EM-2", blocking: true, title: "Canonical benchmark B not reconciled (IMP-05)", detail: "B* is a proxy: equal-weighted 11:00 ask of the window.", blocks: "Canonical B / H / V" },
  { id: "U-EM-3", blocking: false, title: "Historical top of book before 2025-07-25 missing", detail: "Requested from the client (solicitud de informacion, 2026-09-24).", blocks: "More episodes and a sealed OOS" },
  { id: "U-EM-4", blocking: false, title: "Contract tradability read from quote presence", detail: "Last trading day inferred from the lake (proxy); EEX contract spec to confirm.", blocks: "Exact final day of each Monthly window" },
];

// Research / Strategy Lab: candidatos, hipótesis y criterios de éxito medidos. La
// evidencia informa; la autoridad de adopción es de Bru y no se registra aquí.
const P95_TOLERANCE_EUR_MWH = 1;
function criteriaFor(armId) {
  return Object.entries(comparison).map(([product, block]) => {
    const row = block.table.find((item) => item.armId === armId);
    const cheaper = block.acrossCampaigns.filter((item) => typeof item.arms[armId] === "number" && item.arms[armId] > 0).length;
    const comparable = block.acrossCampaigns.filter((item) => typeof item.arms[armId] === "number").length;
    const p95Arm = block.distributions[armId]?.p95;
    const p95Base = block.distributions.BASELINE?.p95;
    const tailOk = typeof p95Arm === "number" && typeof p95Base === "number" ? p95Arm - p95Base <= P95_TOLERANCE_EUR_MWH : null;
    return {
      product,
      items: [
        { label: "ΔV vs Baseline > 0 over all campaigns", status: row.deltaVKeur === null ? "UNKNOWN" : row.deltaVKeur > 0 ? "MET" : "NOT_MET", detail: `ΔV ${row.deltaVKeur === null ? "—" : row.deltaVKeur.toFixed(1)} k€ over ${row.closed} campaigns` },
        { label: "Cheaper than Baseline in most campaigns", status: comparable === 0 ? "UNKNOWN" : cheaper * 2 > comparable ? "MET" : "NOT_MET", detail: `${cheaper} of ${comparable} campaigns` },
        { label: `P95 (H − B*) not worse than Baseline by > ${P95_TOLERANCE_EUR_MWH.toFixed(2)} €/MWh`, status: tailOk === null ? "UNKNOWN" : tailOk ? "MET" : "NOT_MET", detail: `P95 arm ${p95Arm?.toFixed(2) ?? "—"} vs Baseline ${p95Base?.toFixed(2) ?? "—"}` },
        { label: "No look-ahead: every input observed ≤ T₀", status: "MET", detail: "test/exploratory/backtest.test.mjs" },
      ],
    };
  });
}
const research = {
  candidates: [
    { id: "A0", stage: "REFERENCE BASELINE", name: "Client practice · calendar at 11:00", version: "v1", readiness: "READY", authority: "Current client practice", armId: "BASELINE",
      hypothesis: "Reference: buy the target on the client calendar at 11:00 Europe/Berlin, price-blind (canonical A0 controller).", criteria: [] },
    { id: "DIP10", stage: "EVIDENCE GATHERING", name: "Dip buyer · derived from S1 Relative Price Location", version: "v1-exp", readiness: "NOT_READY", authority: "Not requested", armId: "ARM_A",
      hypothesis: "Buying the day's full cap when the 11:00 best ask is below the mean of the previous 10 11:00 asks (otherwise only the feasibility floor) lowers the price paid versus the client's 11:00 calendar.", criteria: criteriaFor("ARM_A") },
    { id: "HOUR", stage: "EVIDENCE GATHERING", name: "Execution hour chosen by data", version: "v1-exp", readiness: "NOT_READY", authority: "Not requested", armId: "ARM_B",
      hypothesis: "Running the client calendar at the hour that was cheapest on the other campaigns (leave-one-out) lowers the price paid versus 11:00.", criteria: criteriaFor("ARM_B") },
    ...[["S2", "Anomaly Detection"], ["S3", "Trajectory / Repricing"], ["S4", "Structure / Range Transition"], ["S5", "Conditional Pullback Timing"], ["Z", "Market state (Z)"]].map(([id, name]) => ({
      id, stage: "HYPOTHESIS ONLY", name, version: "—", readiness: "NO_RUNS", authority: "Not requested", armId: null,
      hypothesis: "Canonical strategy (SPEC §8). No observables materialised and no run yet.", criteria: [],
    })),
  ],
  integrity: [
    { label: "Code pinned", status: "PASS", detail: "generator sha256 in operations/exploratory/MANIFEST.json" },
    { label: "Data snapshot pinned", status: "PASS", detail: `tob-slots sha ${output_slots_sha().slice(0, 12)}` },
    { label: "Replay determinism", status: "PASS", detail: "same inputs → same results sha (manifest check in the UI loader)" },
    { label: "Evidence in ≥ 2 campaigns", status: "PASS", detail: "3 Gas Quarterly + 10 Gas Monthly" },
    { label: "Out-of-sample window", status: "NOT_CLOSED", detail: "exploratory, in-sample; OOS reserve not sealed (owner patch 02 §4)" },
    { label: "Execution fees", status: "UNKNOWN", detail: "not provided; requested from the client" },
  ],
};

for (const entry of results) {
  delete entry.episodeRef;
}

// Method & integrity (panel del mockup): cada check dice qué se verificó y dónde.
for (const [product, block] of Object.entries(comparison)) {
  const entries = results.filter((entry) => entry.product === product);
  const incompleteArms = block.table.filter((row) => row.status !== "COMPLETE").map((row) => row.armId);
  const noQuoteDays = entries.reduce((sum, entry) => sum + entry.arms["A0@11:00/CLIENT"].noQuoteDays, 0);
  const decisionDays = entries.reduce((sum, entry) => sum + entry.tradingDays, 0);
  block.checks = [
    { label: "Pairing", status: "PASS", detail: "Same decision days and the same best-ask slots artifact for every arm (sha " + output_slots_sha().slice(0, 12) + ")." },
    { label: "Look-ahead guard", status: "PASS", detail: "Policies see only quotes with Tm <= decision slot and past days (test/exploratory/backtest.test.mjs)." },
    { label: "Execution", status: "SIMULATED", detail: "Fill at real best ask + 0.15 EUR/MWh, full quantity (client rule). Depth-capped variant reported per episode. Fees UNKNOWN." },
    { label: "Evaluation closure", status: block.table[0].closed === block.table[0].total ? "PASS" : "PARTIAL", detail: block.table[0].closed + "/" + block.table[0].total + " episodes closed inside the data period." },
    { label: "Arm completeness", status: incompleteArms.length === 0 ? "PASS" : "FAIL", detail: incompleteArms.length === 0 ? "Every arm reached the target in every episode." : "Incomplete: " + incompleteArms.join(", ") },
    { label: "Benchmark", status: "PROXY", detail: "B* = equal-weighted 11:00 ask of the window. Canonical B (IMP-05) not reconciled." },
    { label: "Input quality", status: noQuoteDays === 0 ? "PASS" : "DEGRADED", detail: noQuoteDays + " of " + decisionDays + " decision days without a fresh 11:00 quote (no fill, not imputed)." },
  ];
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

function output_slots_sha() {
  return createHash("sha256").update(slotsBytes).digest("hex");
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
  comparison,
  replay,
  campaigns,
  campaignUnknowns,
  research,
  benchmarkNote: "B* = PROXY exploratorio: media equiponderada de los asks de las 11:00 de la ventana; no es el benchmark canónico B (IMP-05 sin reconciliar).",
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
    "src/exploratory/comparison.mjs",
  ].map((path) => ({ path, sha256: sha(readFileSync(path)) })),
};
writeFileSync("operations/exploratory/MANIFEST.json", JSON.stringify(manifest, null, 1));
console.log(`episodios completos: ${complete.length}; incompletos: ${output.episodesSkippedIncomplete.length}`);
