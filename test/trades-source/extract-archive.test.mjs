import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const SCRIPT = fileURLToPath(new URL("../../operations/trades/TR-01/extract-trades-rows.py", import.meta.url));

function classify(member, areaArgument) {
  const output = execFileSync("python3", [SCRIPT, "--classify-member", member, "--area", areaArgument], {
    encoding: "utf8",
  });
  return JSON.parse(output);
}

const TRADE = "data/lake/v1/table=eex_derivative_trade/cmdty=NATGAS/area=THE/trd_date=2025-11-20/pull_id=abc/part.parquet";

test("solo la tabla de trades con area exacta se clasifica como trade", () => {
  const result = classify(TRADE, "cmdty=NATGAS/area=THE");
  assert.equal(result.kind, "trade");
  assert.equal(result.table, "eex_derivative_trade");
  assert.equal(result.cmdty, "NATGAS");
  assert.equal(result.area, "THE");
});

test("el filtro por substring no admite area=THE___TTF", () => {
  const member = TRADE.replace("/area=THE/", "/area=THE___TTF/");
  const result = classify(member, "cmdty=NATGAS/area=THE");
  assert.equal(result.kind, "other_area");
});

test("una tabla distinta de trades no se emite como trade", () => {
  const member = TRADE.replace("table=eex_derivative_trade", "table=eex_derivative_top_of_book");
  const result = classify(member, "cmdty=NATGAS/area=THE");
  assert.equal(result.kind, "other_table");
  assert.equal(result.table, "eex_derivative_top_of_book");
});

test("eex_derivative_reference se inventaria aparte y nunca como trade", () => {
  const member = TRADE.replace("table=eex_derivative_trade", "table=eex_derivative_reference");
  const result = classify(member, "cmdty=NATGAS/area=THE");
  assert.equal(result.kind, "reference");
  assert.equal(result.table, "eex_derivative_reference");
});

test("POWER/DE se clasifica con su propia area exacta", () => {
  const member =
    "data/lake/v1/table=eex_derivative_trade/cmdty=POWER/area=DE/trd_date=2025-11-20/pull_id=abc/part.parquet";
  assert.equal(classify(member, "cmdty=POWER/area=DE").kind, "trade");
  assert.equal(classify(member, "cmdty=POWER/area=DE___AT").kind, "other_area");
});
