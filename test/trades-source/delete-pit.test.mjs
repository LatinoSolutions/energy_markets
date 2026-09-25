import { test } from "node:test";
import assert from "node:assert/strict";

import {
  DELETE_TM_SEMANTICS,
  buildDeleteIndex,
  eligibleTradesAt,
  isEligibleAt,
  measureDeleteTmSemantics,
  tradeEpochMs,
} from "../../src/trades-source/index.mjs";
import { deleteRow, tradeRow } from "./fixtures.mjs";

const at = (iso) => tradeEpochMs(iso);

test("el trade es elegible hasta el Delete y deja de serlo en el instante del borrado", () => {
  const rows = [tradeRow({ Tm: "2025-11-20T10:00:00Z" }), deleteRow({ Tm: "2025-11-20T10:30:00Z" })];
  const index = buildDeleteIndex(rows);
  const trade = rows[0];

  assert.equal(isEligibleAt(trade, at("2025-11-20T10:00:00Z"), index), true);
  assert.equal(isEligibleAt(trade, at("2025-11-20T10:29:59Z"), index), true);
  assert.equal(isEligibleAt(trade, at("2025-11-20T10:30:00Z"), index), false);
  assert.equal(isEligibleAt(trade, at("2025-11-20T11:00:00Z"), index), false);
});

test("la fila Delete no es una observación y no entra en eligibleTradesAt", () => {
  const rows = [tradeRow({ TrdID: "1" }), deleteRow({ TrdID: "2" })];
  const eligible = eligibleTradesAt(rows, at("2025-11-20T10:45:00Z"));
  assert.equal(eligible.length, 1);
  assert.equal(eligible[0].TrdID, "1");
});

test("excluir antes del Delete sería look-ahead: nunca se filtra antes del momento del borrado", () => {
  const rows = [tradeRow({ Tm: "2025-11-20T10:00:00Z" }), deleteRow({ Tm: "2025-11-20T12:00:00Z" })];
  const eligible = eligibleTradesAt(rows, at("2025-11-20T11:00:00Z"));
  assert.equal(eligible.length, 1);
});

test("un Delete retira todas las filas New de la misma pata", () => {
  const rows = [
    tradeRow({ TrdID: "7", Maturity: "202512", Tm: "2025-11-20T09:00:00Z" }),
    tradeRow({ TrdID: "7", Maturity: "202512", Tm: "2025-11-20T09:30:00Z" }),
    deleteRow({ TrdID: "7", Maturity: "202512", Tm: "2025-11-20T10:00:00Z" }),
  ];
  assert.equal(eligibleTradesAt(rows, at("2025-11-20T09:45:00Z")).length, 2);
  assert.equal(eligibleTradesAt(rows, at("2025-11-20T10:30:00Z")).length, 0);
});

test("measureDeleteTmSemantics detecta la hora del borrado y la reporta como evidencia", () => {
  const rows = [
    tradeRow({ TrdID: "1", Tm: "2025-11-20T09:28:37Z" }),
    deleteRow({ TrdID: "1", Tm: "2025-11-20T10:04:53Z" }),
  ];
  const measurement = measureDeleteTmSemantics(rows);
  assert.equal(DELETE_TM_SEMANTICS, "deletion-time");
  assert.equal(measurement.deleteRows, 1);
  assert.equal(measurement.deletesWithNewSibling, 1);
  assert.equal(measurement.deleteAfterNew, 1);
  assert.equal(measurement.deleteBeforeNew, 0);
  assert.equal(measurement.deletionTimeObserved, true);
});

test("un Tm de Delete no parseable se cuenta aparte y no niega deletionTimeObserved", () => {
  const rows = [
    tradeRow({ TrdID: "1", Tm: "2025-11-20T09:28:37Z" }),
    deleteRow({ TrdID: "1", Tm: "no-es-fecha" }),
    deleteRow({ TrdID: "2", Tm: "2025-11-20T10:04:53Z" }),
    tradeRow({ TrdID: "2", Tm: "2025-11-20T09:30:00Z" }),
  ];
  const measurement = measureDeleteTmSemantics(rows);
  assert.equal(measurement.deletesWithNewSibling, 2);
  assert.equal(measurement.deleteUnparsableTm, 1);
  assert.equal(measurement.deleteBeforeNew, 0);
  assert.equal(measurement.deleteAfterNew, 1);
  assert.equal(measurement.deletionTimeObserved, true);
});

test("un Delete anterior al alta sí niega deletionTimeObserved", () => {
  const rows = [
    tradeRow({ TrdID: "1", Tm: "2025-11-20T10:00:00Z" }),
    deleteRow({ TrdID: "1", Tm: "2025-11-20T09:00:00Z" }),
  ];
  const measurement = measureDeleteTmSemantics(rows);
  assert.equal(measurement.deleteBeforeNew, 1);
  assert.equal(measurement.deleteUnparsableTm, 0);
  assert.equal(measurement.deletionTimeObserved, false);
});
