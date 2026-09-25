// Streaming adapter to the accepted IMP-05 calculation. The extractor sends
// one campaign/date at a time so the large EEX row population is not retained.
import { createInterface } from "node:readline";
import { createHash } from "node:crypto";
import {
  berlinLocalTimeSecondsFromUtc,
  intradayProxyReference,
  strictProxyWindowBounds,
} from "../../../src/economic-calculation/index.mjs";

function contentKey(row) {
  return JSON.stringify([row?.tmUtc, row?.price, row?.bid, row?.ask].map((value) => String(value ?? "")));
}

function usable(row) {
  return Number.isFinite(row?.price) || (Number.isFinite(row?.bid) && Number.isFinite(row?.ask));
}

function counts(rows) {
  return {
    trades: rows.filter((row) => Number.isFinite(row?.price)).length,
    midpoints: rows.filter((row) => Number.isFinite(row?.bid) && Number.isFinite(row?.ask)).length,
  };
}

// IMP-05 currently performs its row deduplication with an O(n²) search. These
// raw snapshots can contain tens of thousands of events per day. Deduplicate
// and aggregate the same selected observations first, then pass their exact
// means through IMP-05's reference formula and keep raw counts for the receipt.
function calculateProxy(record) {
  const normalized = record.rows.map((row) => ({
    ...row,
    product: record.campaignKey,
    accessible: true, // Accepted P-005 rights decision, as in IMP-05.
  }));
  const seen = new Set();
  const deduplicated = normalized.filter((row) => {
    const key = contentKey(row);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const bounds = strictProxyWindowBounds({ productClass: "gas" });
  const fallbackCenter = 17 * 3600 + 15 * 60;
  const strictRows = [];
  const fallbackRows = [];
  for (const row of deduplicated) {
    const local = berlinLocalTimeSecondsFromUtc({ utcTimestamp: row.tmUtc });
    if (local === null) continue;
    if (local.secondsOfDay >= bounds.startSeconds && local.secondsOfDay <= bounds.endSeconds) {
      strictRows.push(row);
    } else if (Math.abs(local.secondsOfDay - fallbackCenter) <= 3600) {
      fallbackRows.push(row);
    }
  }

  const selected = strictRows.some(usable) ? strictRows : fallbackRows;
  const selectedUsable = selected.filter(usable);
  const tradeRows = selectedUsable.filter((row) => Number.isFinite(row.price));
  const midpointRows = selectedUsable.filter((row) => Number.isFinite(row.bid) && Number.isFinite(row.ask));
  const rows = [];
  const tmUtc = selectedUsable[0]?.tmUtc ?? "";
  if (tradeRows.length) {
    rows.push({ product: record.campaignKey, trdDate: record.trdDate, tmUtc, instrumentType: "Simple Instrument", accessible: true,
      price: tradeRows.reduce((sum, row) => sum + row.price, 0) / tradeRows.length, bid: null, ask: null });
  }
  if (midpointRows.length) {
    const meanMidpoint = midpointRows.reduce((sum, row) => sum + (row.bid + row.ask) / 2, 0) / midpointRows.length;
    rows.push({ product: record.campaignKey, trdDate: record.trdDate, tmUtc, instrumentType: "Simple Instrument", accessible: true,
      price: null, bid: meanMidpoint, ask: meanMidpoint });
  }
  const proxy = intradayProxyReference({
    rows,
    product: record.campaignKey,
    trdDate: record.trdDate,
    productClass: "gas",
    requireAccessible: true,
  });
  return {
    ...proxy,
    strictCounts: counts(strictRows),
    fallbackCounts: counts(fallbackRows),
  };
}

const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
for await (const line of input) {
  if (!line) continue;
  const record = JSON.parse(line);
  const proxy = calculateProxy(record);
  const rowHashes = [...new Set(record.rows.map((row) => row.rowHash).filter(Boolean))].sort();
  process.stdout.write(`${JSON.stringify({
    trdDate: record.trdDate,
    instrumentIdentities: [...new Set(record.rows.map((row) => row.instrument).filter(Boolean))].sort(),
    sourceRows: record.rows.length,
    sourceRowHashCount: rowHashes.length,
    sourceRowHashesDigest: createHash("sha256").update(rowHashes.join("\n")).digest("hex"),
    sourceFiles: record.sourceFiles,
    sourceCounts: record.sourceCounts,
    strictCounts: proxy.strictCounts,
    fallbackCounts: proxy.fallbackCounts,
    windowUsed: proxy.windowUsed,
    fallbackUsed: proxy.fallbackUsed,
    sourceLabel: proxy.sourceLabel,
    dailyReference: proxy.defined ? proxy.value : null,
    defined: proxy.defined,
    reason: proxy.reason,
  })}\n`);
}
