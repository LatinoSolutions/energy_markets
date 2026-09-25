import { test } from "node:test";
import assert from "node:assert/strict";

import {
  dedupTrades,
  tradeObservationKey,
} from "../../src/trades-source/index.mjs";
import { tradeRow } from "./fixtures.mjs";

test("la clave de observación ignora las columnas de provenance (_)", () => {
  const row = tradeRow();
  const other = { ...row, _pull_id: "pull-a", _retrieved_at_utc: "2026-09-25T10:00:00Z", _row_sha256: "aaaa" };
  const another = { ...row, _pull_id: "pull-b", _retrieved_at_utc: "2026-09-25T11:00:00Z", _row_sha256: "bbbb" };
  assert.equal(tradeObservationKey(other), tradeObservationKey(another));
});

test("dedup colapsa la misma observación traída por dos pulls", () => {
  const row = tradeRow();
  const result = dedupTrades([
    { ...row, _pull_id: "pull-a" },
    { ...row, _pull_id: "pull-b" },
  ]);
  assert.equal(result.inputCount, 2);
  assert.equal(result.uniqueCount, 1);
  assert.equal(result.duplicates, 1);
});

test("trades distintos no se colapsan: distinto TrdID o distinta pata", () => {
  const a = tradeRow({ TrdID: "1", Maturity: "202512", Px: "32.5" });
  const b = tradeRow({ TrdID: "2", Maturity: "202512", Px: "32.5" });
  const c = tradeRow({ TrdID: "1", Maturity: "202601", Px: "32.8" });
  const result = dedupTrades([a, b, c]);
  assert.equal(result.uniqueCount, 3);
  assert.equal(result.duplicates, 0);
});

test("un spread con TrdID compartido entre patas no se colapsa", () => {
  const leg1 = tradeRow({ TrdID: "9", Maturity: "202512", Px: "32.7" });
  const leg2 = tradeRow({ TrdID: "9", Maturity: "202601", Px: "32.9" });
  const result = dedupTrades([leg1, leg2]);
  assert.equal(result.uniqueCount, 2);
});

test("un Delete y su New no se colapsan (distinto UpdtAct)", () => {
  const newRow = tradeRow({ TrdID: "5" });
  const delRow = { ...newRow, UpdtAct: "Delete", Tm: "2025-11-20T10:30:00.000000Z" };
  const result = dedupTrades([newRow, delRow]);
  assert.equal(result.uniqueCount, 2);
});
