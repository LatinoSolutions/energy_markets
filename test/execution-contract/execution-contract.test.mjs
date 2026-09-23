import { test } from "node:test";
import assert from "node:assert/strict";

import {
  EXECUTION_PARAMETER_DEFINITIONS,
  GAS_QUARTERLY_EXECUTION_PARAMETERS,
  IMP07_ACCEPTANCE_TEST,
  P56_FROZEN_RULES,
  assertArmParity,
  createGasQuarterlyExecutionContract,
  evaluateP56Validity,
  executionParameterOf,
  validateExecutionContract,
  versionKeyOf,
} from "../../src/execution-contract/index.mjs";

function parameter(contract, key) {
  return executionParameterOf(contract, key);
}

test("el contrato Gas Quarterly se pobla con el paquete del cliente y valida su schema", () => {
  const contract = createGasQuarterlyExecutionContract();
  const outcome = validateExecutionContract(contract);
  assert.equal(outcome.ok, true);
  assert.deepEqual(outcome.errors, []);
  assert.equal(contract.contractVersion, "v1.0");
  assert.equal(contract.versionStatus, "PROVISIONAL");
  assert.match(contract.contentHash, /^[0-9a-f]{64}$/);
});

test("el contrato declara exactamente las cinco reglas frozen de §13.6", () => {
  const contract = createGasQuarterlyExecutionContract();
  assert.deepEqual(contract.frozenRules, P56_FROZEN_RULES.map((rule) => rule.id));
  assert.equal(P56_FROZEN_RULES.length, 5);
});

test("slippage es provisional 0.15 EUR/MWh con provenance del cliente", () => {
  const contract = createGasQuarterlyExecutionContract();
  const slippage = parameter(contract, "slippage");
  assert.equal(slippage.status, "PROVISIONAL");
  assert.equal(slippage.value, 0.15);
  assert.equal(slippage.unit, "EUR/MWh");
  assert.ok(slippage.source.authority.includes("Fundamental"));
  assert.ok(slippage.source.locator.includes("02_execution_costs"));
});

test("fees queda UNKNOWN/excluded sin valor, nunca cero", () => {
  const contract = createGasQuarterlyExecutionContract();
  const fees = parameter(contract, "fees");
  assert.equal(fees.status, "UNKNOWN");
  assert.equal(fees.value, null);
  assert.equal(fees.excluded, true);
  assert.ok(fees.reason.includes("excluded"));
});

test("latency queda UNKNOWN porque el paquete no entrega un valor auditado", () => {
  const contract = createGasQuarterlyExecutionContract();
  const latency = parameter(contract, "latency");
  assert.equal(latency.status, "UNKNOWN");
  assert.equal(latency.value, null);
  assert.ok(latency.reason.length > 0);
});

test("HT-IMP-07-01: la cita de rounding declara el archivo que la contiene", () => {
  const contract = createGasQuarterlyExecutionContract();
  const rounding = parameter(contract, "rounding");
  assert.equal(rounding.source.quote, "Lot / quantity increment: 1 MW minimum and 1 MW increments.");
  assert.ok(
    rounding.source.locator.split(";").map((entry) => entry.trim()).includes("ESTADO_INPUTS.csv"),
    "el locator de rounding debe incluir ESTADO_INPUTS.csv, de donde sale la cita",
  );
});

test("§13.6 regla 5: con parámetros provisionales o desconocidos la interpretación es HOLD", () => {
  const contract = createGasQuarterlyExecutionContract();
  const validity = evaluateP56Validity(contract);
  assert.equal(validity.valid, false);
  assert.equal(validity.status, "HOLD");
  const blocked = validity.blockers.map((blocker) => blocker.parameter).sort();
  assert.deepEqual(blocked, ["dailyQuantityCap", "fees", "latency", "slippage"]);
});

test("un fee desconocido representado como cero se rechaza", () => {
  const contract = createGasQuarterlyExecutionContract();
  const fees = parameter(contract, "fees");
  fees.value = 0;
  const outcome = validateExecutionContract(contract);
  assert.equal(outcome.ok, false);
  assert.ok(outcome.errors.some((error) => error.field === "fees" && error.code === "INVENTED_ZERO_COST"));
});

test("un parámetro AUDITED sin provenance se rechaza", () => {
  const contract = createGasQuarterlyExecutionContract();
  delete parameter(contract, "slippage").source;
  const outcome = validateExecutionContract(contract);
  assert.equal(outcome.ok, false);
  assert.ok(outcome.errors.some((error) => error.field === "slippage" && error.code === "NO_PROVENANCE"));
});

test("un contrato que omite una regla frozen se rechaza", () => {
  const contract = createGasQuarterlyExecutionContract();
  contract.frozenRules = contract.frozenRules.filter((id) => id !== "CAUSAL_EXECUTION");
  const outcome = validateExecutionContract(contract);
  assert.equal(outcome.ok, false);
  assert.ok(outcome.errors.some((error) => error.code === "MISSING_FROZEN_RULE"));
});

test("un contrato sin versión congelable se rechaza", () => {
  const contract = createGasQuarterlyExecutionContract();
  contract.contractVersion = "";
  const outcome = validateExecutionContract(contract);
  assert.equal(outcome.ok, false);
  assert.ok(outcome.errors.some((error) => error.field === "contractVersion" && error.code === "MISSING_VERSION"));
});

test("un parámetro repetido se rechaza (una sola verdad por parámetro)", () => {
  const contract = createGasQuarterlyExecutionContract();
  contract.parameters.push({ ...parameter(contract, "slippage") });
  const outcome = validateExecutionContract(contract);
  assert.equal(outcome.ok, false);
  assert.ok(outcome.errors.some((error) => error.code === "DUPLICATE_PARAMETER"));
});

test("fixture sintético con todos los parámetros auditados habilita READY", () => {
  const contract = createGasQuarterlyExecutionContract();
  const syntheticSource = { authority: "fixture sintético (test)", locator: "test/execution-contract", quote: "synthetic" };
  for (const definition of EXECUTION_PARAMETER_DEFINITIONS) {
    const entry = parameter(contract, definition.key);
    entry.status = "AUDITED";
    entry.source = syntheticSource;
    if (definition.kind === "quantity") {
      entry.value = entry.value ?? 0;
      entry.unit = definition.unit;
    } else {
      entry.value = entry.value ?? "fixture";
    }
    delete entry.reason;
    delete entry.excluded;
  }
  const validity = evaluateP56Validity(contract);
  assert.equal(validity.valid, true);
  assert.equal(validity.status, "READY");
  assert.deepEqual(validity.blockers, []);
});

test("la paridad A0/A1 exige la misma versión de contrato y de ledger", () => {
  const ok = assertArmParity({
    a0: { executionContractVersion: "v1.0", costLedgerVersion: "v1.0" },
    a1: { executionContractVersion: "v1.0", costLedgerVersion: "v1.0" },
  });
  assert.equal(ok.ok, true);

  const broken = assertArmParity({
    a0: { executionContractVersion: "v1.0", costLedgerVersion: "v1.0" },
    a1: { executionContractVersion: "v2.0", costLedgerVersion: "v1.0" },
  });
  assert.equal(broken.ok, false);
  assert.ok(broken.errors.some((error) => error.code === "PARITY_VIOLATION"));
});

test("versionKeyOf normaliza strings y content-hashes", () => {
  assert.equal(versionKeyOf("v1.0"), "v1.0");
  assert.equal(versionKeyOf({ contentHash: "a".repeat(64) }), `hash:${"a".repeat(64)}`);
  assert.equal(versionKeyOf(null), null);
});

test("el acceptance de IMP-07 se cita literalmente", () => {
  assert.equal(IMP07_ACCEPTANCE_TEST, "Cada coste entra una vez; ningún fill requiere precio anterior no disponible o futuro seleccionado a conveniencia.");
});

test("los parámetros poblados son los diez exigidos por §13.6", () => {
  const contract = createGasQuarterlyExecutionContract();
  assert.deepEqual(
    contract.parameters.map((entry) => entry.key),
    EXECUTION_PARAMETER_DEFINITIONS.map((definition) => definition.key),
  );
  assert.equal(GAS_QUARTERLY_EXECUTION_PARAMETERS.length, EXECUTION_PARAMETER_DEFINITIONS.length);
});
