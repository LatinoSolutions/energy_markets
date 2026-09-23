import { test } from "node:test";
import assert from "node:assert/strict";

import {
  createGasQuarterlyCostLedger,
  sumKnownLedgerCosts,
  validateCostLedger,
} from "../../src/execution-contract/index.mjs";

function entry(ledger, costId) {
  return ledger.entries.find((row) => row.costId === costId);
}

test("el cost ledger Gas Quarterly se pobla con slippage conocido y fees unknown/excluded", () => {
  const ledger = createGasQuarterlyCostLedger();
  const outcome = validateCostLedger(ledger);
  assert.equal(outcome.ok, true);
  assert.deepEqual(outcome.errors, []);

  const slippage = entry(ledger, "cost.slippage.virtual");
  assert.equal(slippage.status, "KNOWN");
  assert.equal(slippage.amount, 0.15);
  assert.equal(slippage.unit, "EUR/MWh");

  const fees = entry(ledger, "cost.fees.other");
  assert.equal(fees.status, "UNKNOWN");
  assert.equal(fees.amount, null);
  assert.equal(fees.excluded, true);
});

test("§13.6 regla 2: dos filas con la misma kind+appliedTo son doble contabilidad", () => {
  const ledger = createGasQuarterlyCostLedger();
  ledger.entries.push({
    costId: "cost.slippage.duplicate",
    kind: "VIRTUAL_SLIPPAGE",
    status: "KNOWN",
    amount: 0.15,
    unit: "EUR/MWh",
    appliedTo: "all-fills",
    source: { authority: "test", locator: "test" },
  });
  const outcome = validateCostLedger(ledger);
  assert.equal(outcome.ok, false);
  assert.ok(outcome.errors.some((error) => error.code === "DUPLICATE_COST_ACCOUNTING"));
});

test("un costId repetido se rechaza", () => {
  const ledger = createGasQuarterlyCostLedger();
  ledger.entries.push({ ...entry(ledger, "cost.fees.other") });
  const outcome = validateCostLedger(ledger);
  assert.equal(outcome.ok, false);
  assert.ok(outcome.errors.some((error) => error.code === "DUPLICATE_COST_ID"));
});

test("un coste UNKNOWN con importe cero se rechaza", () => {
  const ledger = createGasQuarterlyCostLedger();
  entry(ledger, "cost.fees.other").amount = 0;
  const outcome = validateCostLedger(ledger);
  assert.equal(outcome.ok, false);
  assert.ok(outcome.errors.some((error) => error.field === "cost.fees.other" && error.code === "INVENTED_ZERO_COST"));
});

test("un coste KNOWN sin importe finito o sin unidad se rechaza", () => {
  const ledger = createGasQuarterlyCostLedger();
  const slippage = entry(ledger, "cost.slippage.virtual");
  slippage.amount = Number.NaN;
  let outcome = validateCostLedger(ledger);
  assert.equal(outcome.ok, false);
  assert.ok(outcome.errors.some((error) => error.code === "VALUE_TYPE_MISMATCH"));

  slippage.amount = 0.15;
  slippage.unit = "";
  outcome = validateCostLedger(ledger);
  assert.equal(outcome.ok, false);
  assert.ok(outcome.errors.some((error) => error.code === "QUANTITY_WITHOUT_UNIT"));
});

test("el ledger debe declarar la versión del contrato que aplica", () => {
  const ledger = createGasQuarterlyCostLedger();
  ledger.contractVersion = "";
  const outcome = validateCostLedger(ledger);
  assert.equal(outcome.ok, false);
  assert.ok(outcome.errors.some((error) => error.field === "contractVersion" && error.code === "MISSING_VERSION"));
});

test("sumKnownLedgerCosts no omite el coste desconocido ni lo cuenta como cero", () => {
  const ledger = createGasQuarterlyCostLedger();
  const summary = sumKnownLedgerCosts(ledger);
  assert.equal(summary.total, 0.15);
  assert.equal(summary.unit, "EUR/MWh");
  assert.equal(summary.complete, false);
  assert.deepEqual(summary.unknownKinds, ["OTHER_FEE"]);
});

test("sumKnownLedgerCosts es completo cuando todos los costes son conocidos", () => {
  const ledger = createGasQuarterlyCostLedger();
  ledger.entries = ledger.entries.filter((row) => row.status === "KNOWN");
  const summary = sumKnownLedgerCosts(ledger);
  assert.equal(summary.complete, true);
  assert.equal(summary.total, 0.15);
  assert.equal(summary.reason, null);
});

test("sin costes conocidos el total es indeterminado, nunca cero", () => {
  const ledger = createGasQuarterlyCostLedger();
  ledger.entries = ledger.entries.filter((row) => row.status === "UNKNOWN");
  const summary = sumKnownLedgerCosts(ledger);
  assert.equal(summary.total, null);
  assert.equal(summary.complete, false);
  assert.deepEqual(summary.unknownKinds, ["OTHER_FEE"]);
});
