import { test } from "node:test";
import assert from "node:assert/strict";

import { aggregateNdjson } from "../../operations/trades/TR-01/aggregate-trades-rows.mjs";
import { tradeRow } from "./fixtures.mjs";

test("aggregateNdjson separa la cabecera _meta y agrega las filas con las reglas de src/trades-source", () => {
  const meta = { artifactKind: "TR-01_TRADES_ROWS", source: "lake", dateMin: "2025-11-20", dateMax: "2025-11-21" };
  const lines = [
    JSON.stringify({ _meta: meta }),
    JSON.stringify(tradeRow({ TrdID: "1", Tm: "2025-11-20T10:00:00Z" })),
    JSON.stringify(tradeRow({ TrdID: "2", TrdDate: "2025-11-21", Tm: "2025-11-21T10:00:00Z", FromBrokenSpread: "true", AgrsrAct: "" })),
  ];
  const measurement = aggregateNdjson(lines.join("\n"));
  assert.equal(measurement.sourceMeta.source, "lake");
  assert.equal(measurement.dedup.inputCount, 2);
  assert.equal(measurement.eligibility.eligible, 2);
  assert.equal(measurement.eligibility.eligibleUnknownAggressor, 1);
  assert.equal(measurement.coverage.length, 2);
});

test("aggregateNdjson acepta un calendario esperado para densidad", () => {
  const lines = [
    JSON.stringify({ _meta: { dateMin: "2025-11-20", dateMax: "2025-11-24" } }),
    JSON.stringify(tradeRow({ TrdID: "1", TrdDate: "2025-11-20" })),
    JSON.stringify(tradeRow({ TrdID: "2", TrdDate: "2025-11-24" })),
  ];
  const measurement = aggregateNdjson(lines.join("\n"), {
    expectedDays: ["2025-11-20", "2025-11-21", "2025-11-24"],
  });
  const summary = measurement.instrumentSummaries.find((entry) => entry.instrument === "ISIN-DEFAULT");
  assert.equal(summary.daysWithTrades, 2);
  assert.equal(summary.daysWithoutTrades, 1);
  assert.equal(summary.density, 2 / 3);
});
