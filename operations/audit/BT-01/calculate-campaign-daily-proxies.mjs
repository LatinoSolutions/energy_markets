// Bounded-memory adapter to the accepted IMP-05 calculation. The extractor
// sends a campaign/date header, row chunks, then a trailer. Only deduplication
// keys and numeric/hash accumulators survive each chunk; decoded EEX rows do
// not accumulate in Python or Node memory.
import { createInterface } from "node:readline";
import { createHash } from "node:crypto";
import {
  berlinLocalTimeSecondsFromUtc,
  observationIdentity,
  proxyReference,
  strictProxyWindowBounds,
} from "../../../src/economic-calculation/index.mjs";

function makeState(record) {
  return {
    campaignKey: record.campaignKey,
    trdDate: record.trdDate,
    seen: new Set(),
    rowHashes: new Set(),
    instruments: new Set(),
    sourceRows: 0,
    strict: { tradeSum: 0, trades: 0, midpointSum: 0, midpoints: 0 },
    fallback: { tradeSum: 0, trades: 0, midpointSum: 0, midpoints: 0 },
    sourceCounts: {},
    sourceFiles: [],
    exclusions: {},
  };
}

function addRows(state, rows) {
  const bounds = strictProxyWindowBounds({ productClass: "gas" });
  const fallbackCenter = 17 * 3600 + 15 * 60;
  for (const row of rows) {
    state.sourceRows += 1;
    state.instruments.add(row.instrument);
    if (row.rowHash) state.rowHashes.add(row.rowHash);
    // Same dedup identity as the IMP-05 function (BT04-C1-PROXY-WINDOW-DEDUP).
    const key = observationIdentity(row);
    if (state.seen.has(key)) continue;
    state.seen.add(key);
    const local = berlinLocalTimeSecondsFromUtc({ utcTimestamp: row.tmUtc });
    if (local === null) continue;
    const target = local.secondsOfDay >= bounds.startSeconds && local.secondsOfDay <= bounds.endSeconds
      ? state.strict
      : Math.abs(local.secondsOfDay - fallbackCenter) <= 3600 ? state.fallback : null;
    if (!target) continue;
    if (Number.isFinite(row.price)) {
      target.tradeSum += row.price;
      target.trades += 1;
    }
    if (Number.isFinite(row.bid) && Number.isFinite(row.ask)) {
      target.midpointSum += (row.bid + row.ask) / 2;
      target.midpoints += 1;
    }
  }
}

function summarize(state, trailer = {}) {
  const selected = state.strict.trades + state.strict.midpoints > 0 ? state.strict : state.fallback;
  const hasUsable = selected.trades > 0 || selected.midpoints > 0;
  const proxy = proxyReference({
    tradesMean: selected.trades ? selected.tradeSum / selected.trades : null,
    midpointsMean: selected.midpoints ? selected.midpointSum / selected.midpoints : null,
  });
  const hashes = [...state.rowHashes].sort();
  return {
    trdDate: state.trdDate,
    instrumentIdentities: [...state.instruments].sort(),
    sourceRows: state.sourceRows,
    sourceRowHashCount: hashes.length,
    sourceRowHashesDigest: createHash("sha256").update(hashes.join("\n")).digest("hex"),
    sourceFiles: trailer.sourceFiles ?? [],
    sourceCounts: trailer.sourceCounts ?? {},
    exclusions: trailer.exclusions ?? {},
    strictCounts: { trades: state.strict.trades, midpoints: state.strict.midpoints },
    fallbackCounts: { trades: state.fallback.trades, midpoints: state.fallback.midpoints },
    windowUsed: hasUsable ? (selected === state.strict ? "strict" : "nearby-60m") : "none",
    fallbackUsed: hasUsable && selected === state.fallback,
    sourceLabel: proxy.sourceLabel,
    dailyReference: proxy.defined ? proxy.value : null,
    defined: proxy.defined,
    reason: proxy.reason,
  };
}

function calculateProxy(record) {
  const state = makeState(record);
  addRows(state, record.rows ?? []);
  return summarize(state, record);
}

const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
const states = new Map();
for await (const line of input) {
  if (!line) continue;
  const record = JSON.parse(line);
  if (record.type === "begin") {
    if (states.has(record.campaignKey)) throw new Error(`BT-01 recibió begin duplicado para ${record.campaignKey}.`);
    states.set(record.campaignKey, makeState(record));
  } else if (record.type === "rows") {
    const state = states.get(record.campaignKey);
    if (!state) throw new Error(`BT-01 recibió filas sin begin para ${record.campaignKey}.`);
    addRows(state, record.rows ?? []);
  } else if (record.type === "end") {
    const state = states.get(record.campaignKey);
    if (!state) throw new Error(`BT-01 recibió end sin begin para ${record.campaignKey}.`);
    process.stdout.write(`${JSON.stringify(summarize(state, record))}\n`);
    states.delete(record.campaignKey);
  } else {
    // Small deterministic fixtures and direct callers may use a single record.
    process.stdout.write(`${JSON.stringify(calculateProxy(record))}\n`);
  }
}
if (states.size > 0) throw new Error(`BT-01 terminó con fechas sin trailer end: ${[...states.keys()].join(", ")}.`);
