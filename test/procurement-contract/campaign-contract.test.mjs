import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import {
  CAMPAIGN_CONTRACT_FACTS,
  CONFIRMED_OBLIGATIONS,
  confirmedQuantityFor,
  convertMwToMwh,
  createGasQuarterlyFicha,
  resolveObligationDeadline,
  validateCampaignContract,
} from "../../src/procurement-contract/campaign-contract.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..");

function fact(ficha, factId) {
  return ficha.facts.find((entry) => entry.factId === factId);
}

test("las cuatro cantidades confirmadas coinciden con §4.1 (10/10/60/20 MW)", () => {
  const byKey = new Map(CONFIRMED_OBLIGATIONS.map((entry) => [`${entry.product}/${entry.mission}`, entry]));
  assert.equal(byKey.get("Gas/Monthly").quantity, 10);
  assert.equal(byKey.get("Power/Monthly").quantity, 10);
  assert.equal(byKey.get("Gas/Quarterly").quantity, 60);
  assert.equal(byKey.get("Power/Quarterly").quantity, 20);
  for (const entry of CONFIRMED_OBLIGATIONS) {
    assert.equal(entry.unit, "MW");
    assert.equal(entry.source.authority, "Bru (owner)");
  }
  assert.equal(confirmedQuantityFor("Gas", "Quarterly").quantity, 60);
  assert.equal(confirmedQuantityFor("Gas", "Yearly"), null);
});

test("la ficha Gas Quarterly incorpora lo confirmado y deja el resto faltante explícito", () => {
  const ficha = createGasQuarterlyFicha();
  const outcome = validateCampaignContract(ficha);
  assert.equal(outcome.ok, true);
  assert.deepEqual(outcome.errors, []);
  assert.equal(outcome.campaignIdentified, false);

  const quantity = fact(ficha, "campaign.obligation.totalVolumeKnown");
  assert.equal(quantity.availability, "AVAILABLE_NOW");
  assert.equal(quantity.value, 60);
  assert.equal(quantity.unit, "MW");

  assert.equal(fact(ficha, "campaign.identity.productFamily").value, "Gas");
  assert.equal(fact(ficha, "campaign.identity.mission").value, "Quarterly");

  for (const factId of ["campaign.identity.campaignId", "campaign.identity.productContract", "campaign.identity.hubMarket", "campaign.obligation.deliveryPeriod", "campaign.calendar.deadline", "campaign.coverage.fillToObligationAssignment"]) {
    const entry = fact(ficha, factId);
    assert.equal(entry.availability, "UNAVAILABLE", factId);
    assert.ok(entry.reason && entry.reason.length > 0, factId);
  }
});

test("la ficha cubre todas las facts obligatorias del contrato de campaña", () => {
  const ficha = createGasQuarterlyFicha();
  const present = new Set(ficha.facts.map((entry) => entry.factId));
  for (const definition of CAMPAIGN_CONTRACT_FACTS) {
    assert.ok(present.has(definition.factId), definition.factId);
  }
  for (const section of ["Identidad", "Obligación", "Calendario", "Factibilidad", "Ejecución", "Estado de cobertura"]) {
    assert.ok(ficha.facts.some((entry) => entry.section === section), section);
  }
});

test("una fact obligatoria ausente se rechaza", () => {
  const ficha = createGasQuarterlyFicha();
  ficha.facts = ficha.facts.filter((entry) => entry.factId !== "campaign.calendar.deadline");
  const outcome = validateCampaignContract(ficha);
  assert.equal(outcome.ok, false);
  assert.ok(outcome.errors.some((error) => error.code === "MISSING_FACT" && error.factId === "campaign.calendar.deadline"));
});

test("una cantidad AVAILABLE_NOW sin unidad se rechaza", () => {
  const ficha = createGasQuarterlyFicha();
  fact(ficha, "campaign.obligation.totalVolumeKnown").unit = null;
  const outcome = validateCampaignContract(ficha);
  assert.equal(outcome.ok, false);
  assert.ok(outcome.errors.some((error) => error.code === "QUANTITY_WITHOUT_UNIT"));
});

test("una fact AVAILABLE_NOW sin provenance se rechaza", () => {
  const ficha = createGasQuarterlyFicha();
  fact(ficha, "campaign.identity.productFamily").source = null;
  const outcome = validateCampaignContract(ficha);
  assert.equal(outcome.ok, false);
  assert.ok(outcome.errors.some((error) => error.code === "NO_PROVENANCE" && error.factId === "campaign.identity.productFamily"));
});

test("una fact UNAVAILABLE con valor se rechaza como fabricada", () => {
  const ficha = createGasQuarterlyFicha();
  fact(ficha, "campaign.identity.campaignId").value = "CAMP-INVENTED";
  const outcome = validateCampaignContract(ficha);
  assert.equal(outcome.ok, false);
  assert.ok(outcome.errors.some((error) => error.code === "INVENTED_VALUE" && error.factId === "campaign.identity.campaignId"));
});

test("una fact UNAVAILABLE sin razón se rechaza", () => {
  const ficha = createGasQuarterlyFicha();
  fact(ficha, "campaign.identity.hubMarket").reason = "";
  const outcome = validateCampaignContract(ficha);
  assert.equal(outcome.ok, false);
  assert.ok(outcome.errors.some((error) => error.code === "MISSING_NOT_DOCUMENTED" && error.factId === "campaign.identity.hubMarket"));
});

test("una fact con availability no declarada se rechaza", () => {
  const ficha = createGasQuarterlyFicha();
  fact(ficha, "campaign.identity.mission").availability = "PROBABLY_TRUE";
  const outcome = validateCampaignContract(ficha);
  assert.equal(outcome.ok, false);
  assert.ok(outcome.errors.some((error) => error.code === "UNKNOWN_AVAILABILITY"));
});

test("los guards prohibidos se rechazan", () => {
  const cases = [
    ["totalObligationIsPerBuySizing", "TOTAL_SIZING_CONFLATION"],
    ["benchmarkWindowIsExecutionPermission", "BENCHMARK_WINDOW_AS_PERMISSION"],
    ["unknownTerminalRuleFabricatesCloseOutFill", "CLOSEOUT_WITH_UNKNOWN_TERMINAL_RULE"],
    ["assumedMwToMwhConversion", "UNIT_INFERENCE_WITHOUT_HOURS_PROFILE"],
  ];
  for (const [guard, code] of cases) {
    const ficha = createGasQuarterlyFicha();
    ficha.guards[guard] = true;
    const outcome = validateCampaignContract(ficha);
    assert.equal(outcome.ok, false, guard);
    assert.ok(outcome.errors.some((error) => error.code === code), guard);
  }
});

test("MW no se convierte a MWh sin horas y perfil de entrega", () => {
  assert.equal(convertMwToMwh({ quantityMw: 60 }).code, "UNIT_INFERENCE_WITHOUT_HOURS_PROFILE");
  assert.equal(convertMwToMwh({ quantityMw: 60, deliveryHours: 24 }).code, "UNIT_INFERENCE_WITHOUT_HOURS_PROFILE");
  assert.equal(convertMwToMwh({ quantityMw: 60, deliveryProfile: "baseload" }).code, "UNIT_INFERENCE_WITHOUT_HOURS_PROFILE");
  assert.equal(convertMwToMwh({ quantityMw: 60, deliveryHours: 0, deliveryProfile: "baseload" }).code, "UNIT_INFERENCE_WITHOUT_HOURS_PROFILE");
  const ok = convertMwToMwh({ quantityMw: 60, deliveryHours: 24, deliveryProfile: "baseload" });
  assert.equal(ok.ok, true);
  assert.equal(ok.mwh, 1440);
});

test("el deadline no se infiere cuando el calendario no lo aporta", () => {
  const ficha = createGasQuarterlyFicha();
  const outcome = resolveObligationDeadline(ficha);
  assert.equal(outcome.determined, false);
  assert.equal(outcome.deadline, null);

  fact(ficha, "campaign.calendar.deadline").availability = "AVAILABLE_NOW";
  fact(ficha, "campaign.calendar.deadline").value = "2026-12-31";
  fact(ficha, "campaign.calendar.deadline").source = { authority: "Bru (owner)", locator: "synthetic" };
  const determined = resolveObligationDeadline(ficha);
  assert.equal(determined.determined, true);
  assert.equal(determined.deadline, "2026-12-31");
});

test("una fact de texto con valor no textual se rechaza", () => {
  const ficha = createGasQuarterlyFicha();
  fact(ficha, "campaign.identity.mission").value = { invented: "objeto" };
  const outcome = validateCampaignContract(ficha);
  assert.equal(outcome.ok, false);
  assert.ok(outcome.errors.some((error) => error.code === "VALUE_TYPE_MISMATCH" && error.factId === "campaign.identity.mission"));
});

test("una cantidad AVAILABLE_NOW negativa o no numérica se rechaza", () => {
  for (const badValue of [-10, "60", { value: 60 }]) {
    const ficha = createGasQuarterlyFicha();
    fact(ficha, "campaign.obligation.totalVolumeKnown").value = badValue;
    const outcome = validateCampaignContract(ficha);
    assert.equal(outcome.ok, false, JSON.stringify(badValue));
    assert.ok(outcome.errors.some((error) => error.code === "VALUE_TYPE_MISMATCH" && error.factId === "campaign.obligation.totalVolumeKnown"), JSON.stringify(badValue));
  }
});

test("la ficha declara el estado de la relación Monthly/Quarterly y del mapa de ownership (DEP-02)", () => {
  const ficha = createGasQuarterlyFicha();
  assert.equal(ficha.coverageOwnership.mapState, "UNAVAILABLE");
  assert.ok(ficha.coverageOwnership.reason.length > 0);
  assert.equal(ficha.coverageOwnership.relationMonthlyQuarterly.availability, "UNAVAILABLE");
  assert.ok(ficha.coverageOwnership.relationMonthlyQuarterly.reason.includes("adicionales, solapadas o alternativas"));
  const outcome = validateCampaignContract(ficha);
  assert.equal(outcome.ok, true);
});

test("una ficha sin bloque coverageOwnership se rechaza", () => {
  const ficha = createGasQuarterlyFicha();
  delete ficha.coverageOwnership;
  const outcome = validateCampaignContract(ficha);
  assert.equal(outcome.ok, false);
  assert.ok(outcome.errors.some((error) => error.code === "COVERAGE_OWNERSHIP_MAP_STATE_MISSING"));
});

test("una ficha con coverageOwnership sin razón se rechaza", () => {
  const ficha = createGasQuarterlyFicha();
  ficha.coverageOwnership.reason = "";
  const outcome = validateCampaignContract(ficha);
  assert.equal(outcome.ok, false);
  assert.ok(outcome.errors.some((error) => error.code === "MISSING_NOT_DOCUMENTED" && error.factId === "coverageOwnership"));
});

test("una ficha con mapa MATERIALIZED sin asignaciones ni provenance se rechaza", () => {
  const ficha = createGasQuarterlyFicha();
  ficha.coverageOwnership.mapState = "MATERIALIZED";
  ficha.coverageOwnership.reason = null;
  const outcome = validateCampaignContract(ficha);
  assert.equal(outcome.ok, false);
  const codes = outcome.errors.map((error) => error.code);
  assert.ok(codes.includes("COVERAGE_OWNERSHIP_MAP_NOT_MATERIALIZED"));
  assert.ok(codes.includes("NO_PROVENANCE"));
});

test("la ficha materializada en v1_1_1 se valida y coincide con el builder", () => {
  const path = resolve(repoRoot, "operations/audit/IMP-02/v1_1_1/gas-quarterly-campaign-ficha.json");
  const artifact = JSON.parse(readFileSync(path, "utf8"));
  const outcome = validateCampaignContract(artifact);
  assert.equal(outcome.ok, true);
  assert.equal(outcome.campaignIdentified, false);
  assert.deepEqual(artifact, createGasQuarterlyFicha());
});
