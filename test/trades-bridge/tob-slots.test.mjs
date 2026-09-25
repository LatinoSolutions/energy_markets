import { test } from "node:test";
import assert from "node:assert/strict";

import { buildTobSlotSeries, tobContractKey, tobSlotsForDay } from "../../src/trades-bridge/tob-slots.mjs";
import { tobRow } from "./fixtures.mjs";

const PRODUCTS = new Set(["G0BQ", "G0BM"]);

test("tobContractKey usa producto (4 primeras) y maturity exacta", () => {
  assert.equal(tobContractKey(tobRow()), "G0BQ|202601");
  assert.equal(tobContractKey(tobRow({ ShortCode: "G0BQXXX" })), "G0BQ|202601");
  assert.equal(tobContractKey(tobRow({ Maturity: "" })), "");
});

test("el slot toma el último quote <= slot dentro de los 15 min y descarta lo viejo", () => {
  const rows = [
    // 08:44 Berlin = 06:44Z: a 16 min del slot 09:00 (07:00Z) -> fuera de edad.
    tobRow({ Tm: "2025-09-01T06:44:00Z", AskPx: "111" }),
  ];
  const fresh = tobRow({ Tm: "2025-09-01T06:46:00Z", AskPx: "100" });
  const slots = tobSlotsForDay([...rows, fresh], "2025-09-01", { productCodes: PRODUCTS }).get("G0BQ|202601");
  assert.equal(slots[2].ask, 100);
});

test("un quote de más de 15 min no llena el slot (null, no se arrastra)", () => {
  const rows = [tobRow({ Tm: "2025-09-01T05:00:00Z", AskPx: "100" })];
  const slots = tobSlotsForDay(rows, "2025-09-01", { productCodes: PRODUCTS }).get("G0BQ|202601");
  assert.equal(slots[0], null);
  assert.equal(slots[1], null);
});

test("a igual Tm gana el menor ask; a igual ask el menor AskSz", () => {
  const rows = [
    tobRow({ Tm: "2025-09-01T06:59:00Z", AskPx: "100", AskSz: "5", BidPx: "90" }),
    tobRow({ Tm: "2025-09-01T06:59:00Z", AskPx: "99", AskSz: "2", BidPx: "90" }),
    tobRow({ Tm: "2025-09-01T06:59:00Z", AskPx: "99", AskSz: "1", BidPx: "90" }),
  ];
  const slots = tobSlotsForDay(rows, "2025-09-01", { productCodes: PRODUCTS }).get("G0BQ|202601");
  assert.equal(slots[2].ask, 99);
  assert.equal(slots[2].askSz, 1);
});

test("excluye spreads, ask no positivo, libro cruzado y producto ajeno", () => {
  const rows = [
    tobRow({ InstrumentType: "Spread", Tm: "2025-09-01T06:59:00Z" }),
    tobRow({ AskPx: "0", Tm: "2025-09-01T06:59:00Z" }),
    tobRow({ AskPx: "100", BidPx: "100", Tm: "2025-09-01T06:59:00Z" }),
    tobRow({ ShortCode: "XXZZ", Tm: "2025-09-01T06:59:00Z" }),
  ];
  const slots = tobSlotsForDay(rows, "2025-09-01", { productCodes: PRODUCTS });
  assert.equal(slots.size, 0);
});

test("buildTobSlotSeries separa por contrato y día", () => {
  const rows = [
    tobRow({ Tm: "2025-09-01T06:59:00Z", AskPx: "100" }),
    tobRow({ Maturity: "202604", Tm: "2025-09-01T06:59:00Z", AskPx: "200" }),
    tobRow({ TrdDate: "2025-09-02", Tm: "2025-09-02T06:59:00Z", AskPx: "101" }),
  ];
  const series = buildTobSlotSeries(rows, { productCodes: PRODUCTS });
  assert.deepEqual([...series.keys()].sort(), ["G0BQ|202601", "G0BQ|202604"]);
  assert.equal(series.get("G0BQ|202601").get("2025-09-01")[2].ask, 100);
  assert.equal(series.get("G0BQ|202601").get("2025-09-02")[2].ask, 101);
  assert.equal(series.get("G0BQ|202604").get("2025-09-01")[2].ask, 200);
});
