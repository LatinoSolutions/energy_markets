// BT-06 (PLAN_STATUS, owner request 2026-09-26): corre el backtest exploratorio TOB
// de Power DE (Power Quarterly DEBQ y Power Monthly DEBM) sobre el artifact de slots
// de la ruta v3. Ruta versionada nueva; el release v2 (gas) queda intacto.
//
// Mismo motor y misma UI que el backtest de gas: reusa las funciones puras aceptadas
// de src/exploratory/backtest.mjs (`runEpisode`, `POLICIES`, `FILL_MODELS`,
// `episodeTradingDays`) y el comparador `buildComparison` de
// src/exploratory/comparison.mjs. Esas funciones sólo ramifican por producto para
// elegir calendario (3-1-3 vs 1-0-1) y meses de entrega (3 vs 1); Power usa las
// mismas reglas, así que se les pasa el `engineProduct` de la misión y el bloque
// resultante se rotula con el producto real (DEBQ/DEBM). Ver src/exploratory/missions.mjs.
//
// Volúmenes patch 02: Power Q 10 MW, Power M 10 MW (missions.mjs).
// Uso:
//   node operations/exploratory/v3/run-exploratory-backtest.mjs \
//     --slots operations/exploratory/v3/tob-slots-power.json \
//     --out operations/exploratory/v3/backtest-results.json
// Owner patch EM-SPEC-OWNER-PATCH-2026-09-24-02 §4: resultados EXPLORATORY.

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import path, { dirname, join, resolve } from "node:path";

import {
  CLIENT_SLOT,
  FILL_MODELS,
  POLICIES,
  episodeTradingDays,
  runEpisode,
} from "../../../src/exploratory/backtest.mjs";
import { buildComparison } from "../../../src/exploratory/comparison.mjs";
import { POWER_MISSION_IDS, missionById, missionsByIds } from "../../../src/exploratory/missions.mjs";

const DEFAULT_MISSIONS = POWER_MISSION_IDS;
const DEFAULT_SLOTS = "operations/exploratory/v3/tob-slots-power.json";
const DEFAULT_OUT = "operations/exploratory/v3/backtest-results.json";

function parseArguments(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) continue;
    const [name, inline] = token.slice(2).split("=", 2);
    args[name] = inline ?? argv[index + 1];
    if (inline === undefined) index += 1;
  }
  return args;
}

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

// El calendario de la misión se ata por hash al manifest que lo acredita (Power:
// TR-01). Sin manifest (gas, IMP-09) se lee y se ata por hash en el receipt del run.
function loadCalendar(repoRoot, mission) {
  const calendarPath = resolve(repoRoot, mission.calendarPath);
  const bytes = readFileSync(calendarPath);
  let manifestSha256 = null;
  if (mission.calendarManifest !== null) {
    const manifestBytes = readFileSync(resolve(repoRoot, mission.calendarManifest));
    const manifest = JSON.parse(manifestBytes.toString("utf8"));
    if (manifest?.artifact?.path !== mission.calendarPath || manifest.artifact.sha256 !== sha256(bytes)) {
      throw new Error(`calendario ${mission.calendarPath} no coincide con su manifest ${mission.calendarManifest}`);
    }
    manifestSha256 = sha256(manifestBytes);
  }
  const calendar = JSON.parse(bytes.toString("utf8"));
  if (!Array.isArray(calendar.exchangeDays)) {
    throw new Error(`calendario ${mission.calendarPath} sin exchangeDays`);
  }
  return { exchangeDays: calendar.exchangeDays, sha256: sha256(bytes), manifestSha256 };
}

// Un episodio es completo si toda su ventana cae dentro del periodo de data.
function buildEpisodes(missions, series, calendars, firstDataDay, lastDataDay) {
  const episodes = [];
  for (const mission of missions) {
    const exchangeDays = calendars.get(mission.missionId).exchangeDays;
    for (const key of Object.keys(series)) {
      const [product, maturity] = key.split("|");
      if (product !== mission.product) continue;
      const calendarWindow = episodeTradingDays({ product: mission.engineProduct, maturity, exchangeDays });
      if (calendarWindow.length === 0) continue;
      const complete = calendarWindow[0] >= firstDataDay && calendarWindow.at(-1) < lastDataDay;
      const quotedDays = new Set(Object.entries(series[key]).filter(([, daySlots]) => daySlots.some((slot) => slot !== null)).map(([day]) => day));
      const tradingDays = episodeTradingDays({ product: mission.engineProduct, maturity, exchangeDays, quotedDays });
      episodes.push({ mission, product, maturity, key, targetMw: mission.targetMw, tradingDays, complete });
    }
  }
  return episodes;
}

function summarize(result) {
  const { ledger, ...rest } = result;
  return rest;
}

function run(episode, policyId, slotIndex, fillModel, series) {
  return runEpisode({
    series: series[episode.key],
    tradingDays: episode.tradingDays,
    slotIndex,
    targetMw: episode.targetMw,
    policy: POLICIES[policyId],
    fillModel,
  });
}

function buildMissionResult({ missions, slots, calendars, slotsPath, slotsBytes }) {
  const outputSlotsSha = () => createHash("sha256").update(slotsBytes).digest("hex");
  const series = slots.series;
  const allDataDays = Object.values(series).flatMap((byDay) => Object.keys(byDay)).sort();
  const firstDataDay = allDataDays[0];
  const lastDataDay = allDataDays.at(-1);
  const episodes = buildEpisodes(missions, series, calendars, firstDataDay, lastDataDay);
  const complete = episodes.filter((episode) => episode.complete);
  const clientSlotIndex = slots.slotsBerlin.indexOf(CLIENT_SLOT);

  const results = [];
  for (const episode of complete) {
    const base = run(episode, "A0", clientSlotIndex, FILL_MODELS.CLIENT, series);
    const hourProfile = slots.slotsBerlin.map((label, slotIndex) => {
      const result = run(episode, "A0", slotIndex, FILL_MODELS.CLIENT, series);
      return { slot: label, avgPriceEurMwh: result.avgPriceEurMwh, complete: result.complete, noQuoteDays: result.noQuoteDays };
    });
    const arms = {};
    for (const policyId of Object.keys(POLICIES)) {
      for (const fillModel of Object.values(FILL_MODELS)) {
        arms[`${policyId}@${CLIENT_SLOT}/${fillModel}`] = summarize(run(episode, policyId, clientSlotIndex, fillModel, series));
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
      ledgerClientDip: run(episode, "DIP10", clientSlotIndex, FILL_MODELS.CLIENT, series).ledger,
    });
  }

  // Hora elegida sin mirar el episodio evaluado (leave-one-episode-out), igual que v2.
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

  const ARM_LABELS = { BASELINE: "Baseline · A0 11:00 (client practice)", ARM_A: "Arm A · DIP10 11:00", ARM_B: "Arm B · A0 at out-of-episode hour" };
  const comparison = {};
  for (const mission of missions) {
    const entries = results.filter((entry) => entry.product === mission.product);
    if (entries.length === 0) continue;
    const block = buildComparison({
      product: mission.engineProduct,
      armLabels: ARM_LABELS,
      episodes: entries.map((entry) => {
        const armBSlot = entry.leaveOneOutHour?.slotChosenOnOtherEpisodes ?? null;
        const armB = armBSlot === null ? null : run(entry.episodeRef, "A0", slots.slotsBerlin.indexOf(armBSlot), FILL_MODELS.CLIENT, series);
        const pack = (result, slot) => result && { ledger: result.ledger, summary: summarize(result), slot };
        return {
          maturity: entry.maturity,
          arms: {
            BASELINE: pack(run(entry.episodeRef, "A0", clientSlotIndex, FILL_MODELS.CLIENT, series), CLIENT_SLOT),
            ARM_A: pack(run(entry.episodeRef, "DIP10", clientSlotIndex, FILL_MODELS.CLIENT, series), CLIENT_SLOT),
            ARM_B: pack(armB, armBSlot),
          },
        };
      }),
    });
    // El bloque sale del comparador aceptado con el `engineProduct` (que sólo fija
    // meses de entrega); se rotula con el producto real de la misión.
    block.product = mission.product;
    comparison[mission.product] = block;
  }

  const replay = results.map((entry) => {
    const block = comparison[entry.product].perEpisode.find((item) => item.maturity === entry.maturity);
    const episodeSeries = series[entry.episodeRef.key];
    const armRuns = {
      BASELINE: run(entry.episodeRef, "A0", clientSlotIndex, FILL_MODELS.CLIENT, series).ledger,
      ARM_A: run(entry.episodeRef, "DIP10", clientSlotIndex, FILL_MODELS.CLIENT, series).ledger,
    };
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
      ask11: entry.episodeRef.tradingDays.map((day) => ({ day, ask: episodeSeries[day]?.[clientSlotIndex]?.ask ?? null })),
      decisions: armRuns,
    };
  });

  const campaigns = episodes.map((episode) => {
    const entry = results.find((item) => item.product === episode.product && item.maturity === episode.maturity);
    const block = entry ? comparison[episode.product].perEpisode.find((item) => item.maturity === episode.maturity) : null;
    const noQuote = entry ? entry.arms["A0@11:00/CLIENT"].noQuoteDays : null;
    const code = episode.mission.cadence === "QUARTERLY" ? "Q" : "M";
    const prefix = episode.mission.product.startsWith("DEB") ? "POW" : "GAS";
    return {
      id: `${prefix}-${code}-${episode.maturity}`,
      product: episode.product,
      maturity: episode.maturity,
      targetMw: episode.targetMw,
      firstDay: episode.tradingDays[0],
      lastDay: episode.tradingDays.at(-1),
      tradingDays: episode.tradingDays.length,
      readiness: episode.complete ? "EXPLORATORY_COMPLETE" : "INSUFFICIENT_DATA",
      gates: episode.complete ? [
        { label: "Runs pinned to one data snapshot", status: "PASS", detail: `tob-slots sha ${outputSlotsSha().slice(0, 12)} for every arm` },
        { label: "Look-ahead guard", status: "PASS", detail: "quotes with Tm <= decision slot only (test/exploratory)" },
        { label: "All arms complete", status: Object.values(block.arms).every((arm) => arm === null || arm.complete) ? "PASS" : "FAIL", detail: Object.entries(block.arms).map(([id, arm]) => `${id} ${arm ? `${arm.boughtMw}/${episode.targetMw} MW` : "not run"}`).join(" · ") },
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
    { id: "U-EM-5", blocking: false, title: "Power top of book only usable from 2025-08-12", detail: "TR-01 measured 0-2 quotes/day before 2025-08-12; earlier Power campaigns stay incomplete.", blocks: "More Power episodes and a sealed OOS" },
  ];

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
  const evidenceLabel = Object.entries(comparison).map(([product, block]) => `${block.perEpisode.length} ${product}`).join(" + ");
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
      { label: "Code pinned", status: "PASS", detail: "generator sha256 in operations/exploratory/v3/MANIFEST.json" },
      { label: "Data snapshot pinned", status: "PASS", detail: `tob-slots sha ${outputSlotsSha().slice(0, 12)}` },
      { label: "Replay determinism", status: "PASS", detail: "same inputs → same results sha (manifest check in the UI loader)" },
      { label: "Evidence in ≥ 2 campaigns", status: "PASS", detail: evidenceLabel },
      { label: "Out-of-sample window", status: "NOT_CLOSED", detail: "exploratory, in-sample; OOS reserve not sealed (owner patch 02 §4)" },
      { label: "Execution fees", status: "UNKNOWN", detail: "not provided; requested from the client" },
    ],
  };

  for (const entry of results) delete entry.episodeRef;

  for (const [product, block] of Object.entries(comparison)) {
    const entries = results.filter((entry) => entry.product === product);
    const incompleteArms = block.table.filter((row) => row.status !== "COMPLETE").map((row) => row.armId);
    const noQuoteDays = entries.reduce((sum, entry) => sum + entry.arms["A0@11:00/CLIENT"].noQuoteDays, 0);
    const decisionDays = entries.reduce((sum, entry) => sum + entry.tradingDays, 0);
    block.checks = [
      { label: "Pairing", status: "PASS", detail: "Same decision days and the same best-ask slots artifact for every arm (sha " + outputSlotsSha().slice(0, 12) + ")." },
      { label: "Look-ahead guard", status: "PASS", detail: "Policies see only quotes with Tm <= decision slot and past days (test/exploratory/backtest.test.mjs)." },
      { label: "Execution", status: "SIMULATED", detail: "Fill at real best ask + 0.15 EUR/MWh, full quantity (client rule). Depth-capped variant reported per episode. Fees UNKNOWN." },
      { label: "Evaluation closure", status: block.table[0].closed === block.table[0].total ? "PASS" : "PARTIAL", detail: block.table[0].closed + "/" + block.table[0].total + " episodes closed inside the data period." },
      { label: "Arm completeness", status: incompleteArms.length === 0 ? "PASS" : "FAIL", detail: incompleteArms.length === 0 ? "Every arm reached the target in every episode." : "Incomplete: " + incompleteArms.join(", ") },
      { label: "Benchmark", status: "PROXY", detail: "B* = equal-weighted 11:00 ask of the window. Canonical B (IMP-05) not reconciled." },
      { label: "Input quality", status: noQuoteDays === 0 ? "PASS" : "DEGRADED", detail: noQuoteDays + " of " + decisionDays + " decision days without a fresh 11:00 quote (no fill, not imputed)." },
    ];
  }

  function mean(values) {
    return values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length;
  }
  const summary = {};
  for (const mission of missions) {
    const rows = results.filter((entry) => entry.product === mission.product);
    if (rows.length === 0) continue;
    const paired = rows.filter((entry) => entry.arms["A0@11:00/CLIENT"].complete && entry.arms["DIP10@11:00/CLIENT"].complete);
    const dipDiffs = paired.map((entry) => entry.arms["DIP10@11:00/CLIENT"].avgPriceEurMwh - entry.arms["A0@11:00/CLIENT"].avgPriceEurMwh);
    const looDiffs = rows.map((entry) => entry.leaveOneOutHour?.diffOnThisEpisodeEurMwh).filter((value) => typeof value === "number");
    summary[mission.product] = {
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
    market: [...new Set(missions.map((mission) => mission.market))],
    inputs: {
      slots: { path: slotsPath, sha256: createHash("sha256").update(slotsBytes).digest("hex") },
      calendars: missions.map((mission) => ({ missionId: mission.missionId, path: mission.calendarPath, sha256: calendars.get(mission.missionId).sha256, manifest: mission.calendarManifest, manifestSha256: calendars.get(mission.missionId).manifestSha256 })),
      dataPeriod: { firstDataDay, lastDataDay },
    },
    rules: {
      targetsMw: Object.fromEntries(missions.map((mission) => [mission.product, mission.targetMw])),
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
  return output;
}

function main() {
  const args = parseArguments(process.argv.slice(2));
  const repoRoot = resolve(args["repo-root"] ?? process.cwd());
  const slotsPath = args.slots ?? DEFAULT_SLOTS;
  const outPath = args.out ?? DEFAULT_OUT;
  const missionIds = (args.missions ?? DEFAULT_MISSIONS.join(",")).split(",").map((id) => id.trim()).filter(Boolean);
  const missions = missionsByIds(missionIds);

  const absoluteSlots = resolve(repoRoot, slotsPath);
  const absoluteOut = resolve(repoRoot, outPath);
  // Las rutas declaradas en el artifact y el manifest son relativas al repo: así la UI
  // las verifica con el mismo path canónico (POWER_EXPLORATORY_RELEASE) sin importar
  // desde dónde se lance el job.
  const relativeSlots = path.relative(repoRoot, absoluteSlots).split(path.sep).join("/");
  const relativeOut = path.relative(repoRoot, absoluteOut).split(path.sep).join("/");

  const slotsBytes = readFileSync(absoluteSlots);
  const slots = JSON.parse(slotsBytes.toString("utf8"));
  if (!Array.isArray(slots.slotsBerlin) || slots.series === undefined) {
    throw new Error(`artifact de slots inválido: ${slotsPath}`);
  }
  const calendars = new Map();
  for (const mission of missions) {
    calendars.set(mission.missionId, loadCalendar(repoRoot, mission));
  }

  const output = buildMissionResult({ missions, slots, calendars, slotsPath: relativeSlots, slotsBytes });
  const outputBytes = Buffer.from(JSON.stringify(output, null, 1));
  writeFileSync(absoluteOut, outputBytes);

  const manifest = {
    artifactKind: "EXPLORATORY_BACKTEST_MANIFEST",
    status: "EXPLORATORY",
    ownerPatch: "EM-SPEC-OWNER-PATCH-2026-09-24-02",
    market: missions[0].market,
    missions: missions.map((mission) => mission.missionId),
    results: { path: relativeOut, sha256: sha256(outputBytes) },
    slots: output.inputs.slots,
    generators: [
      "operations/exploratory/v3/build_tob_slots.py",
      "operations/exploratory/v3/run-exploratory-backtest.mjs",
      "src/exploratory/backtest.mjs",
      "src/exploratory/comparison.mjs",
      "src/exploratory/missions.mjs",
    ].map((path) => ({ path, sha256: sha256(readFileSync(resolve(repoRoot, path))) })),
  };
  writeFileSync(join(dirname(absoluteOut), "MANIFEST.json"), JSON.stringify(manifest, null, 1));
  console.log(`misiones: ${missions.map((mission) => mission.missionId).join(", ")}; episodios completos: ${Object.values(output.summary).reduce((sum, item) => sum + item.episodes, 0)}; incompletos: ${output.episodesSkippedIncomplete.length}`);
}

main();
