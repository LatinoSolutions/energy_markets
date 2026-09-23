import { test } from "node:test";
import assert from "node:assert/strict";

import {
  chronologicalEligibleComplete,
  parseIsoDate,
  quarterIndex,
  validateEligibilityRegister,
} from "../../src/oos-reservation/campaign-register.mjs";
import { gasQuarterlyCampaign, gasQuarterlyRegister, quarterlyWindow } from "./fixtures.mjs";

test("un episodio Gas Quarterly canónico valida sin errores", () => {
  const register = gasQuarterlyRegister({ year: 2021, quarter: 1, count: 3 });
  const outcome = validateEligibilityRegister(register);
  assert.equal(outcome.ok, true);
  assert.deepEqual(outcome.errors, []);
});

test("la Campaign ID debe ser la identidad determinista del episodio", () => {
  const register = gasQuarterlyRegister({ year: 2022, quarter: 3, count: 1 });
  register[0].campaignId = "GAS-Q-2022Q4";
  const outcome = validateEligibilityRegister(register);
  assert.equal(outcome.ok, false);
  assert.ok(outcome.errors.some((error) => error.code === "CAMPAIGN_ID_NOT_CANONICAL"));
});

test("se rechaza producto o Mission que no sea Gas Quarterly (§13.3)", () => {
  const power = gasQuarterlyCampaign({ year: 2021, quarter: 1, product: "Power" });
  const monthly = gasQuarterlyCampaign({ year: 2021, quarter: 1, mission: "Monthly", maturity: "2021-01" });
  const outcome = validateEligibilityRegister([power, monthly]);
  assert.equal(outcome.ok, false);
  assert.equal(outcome.errors.filter((error) => error.code === "NOT_GAS_QUARTERLY").length, 2);
});

test("un campo de outcome en el registro se rechaza antes de reservar (IMP-09 MUST NOT)", () => {
  const campaign = gasQuarterlyCampaign({ year: 2021, quarter: 1, pnl: 12.5 });
  const outcome = validateEligibilityRegister([campaign]);
  assert.equal(outcome.ok, false);
  assert.ok(outcome.errors.some((error) => error.code === "OUTCOME_FIELD_PRESENT"));
});

test("maturity repetida y ventana invertida se rechazan", () => {
  const first = gasQuarterlyCampaign({ year: 2021, quarter: 1 });
  const duplicate = { ...first };
  const inverted = gasQuarterlyCampaign({ year: 2021, quarter: 2, windowStart: "2030-01-01", deadline: "2020-01-01" });
  const outcome = validateEligibilityRegister([first, duplicate, inverted]);
  assert.equal(outcome.ok, false);
  assert.ok(outcome.errors.some((error) => error.code === "DUPLICATE_EPISODE"));
  assert.ok(outcome.errors.some((error) => error.code === "INVALID_WINDOW_RANGE"));
});

test("sin provenance auditada no se sostiene la elegibilidad", () => {
  const campaign = gasQuarterlyCampaign({ year: 2021, quarter: 1 });
  delete campaign.provenance;
  const outcome = validateEligibilityRegister([campaign]);
  assert.equal(outcome.ok, false);
  assert.ok(outcome.errors.some((error) => error.code === "MISSING_PROVENANCE"));
});

test("etiqueta ELIGIBLE sin evidencia se rechaza (H2: no hay etiquetas a secas)", () => {
  const withoutEligibilityEvidence = gasQuarterlyCampaign({ year: 2021, quarter: 1 });
  delete withoutEligibilityEvidence.eligibilityEvidence;
  const outcome = validateEligibilityRegister([withoutEligibilityEvidence]);
  assert.equal(outcome.ok, false);
  assert.ok(outcome.errors.some((error) => error.code === "ELIGIBILITY_WITHOUT_EVIDENCE"));
});

test("etiqueta COMPLETE sin evidencia se rechaza (H2: no hay etiquetas a secas)", () => {
  const withoutCompletenessEvidence = gasQuarterlyCampaign({ year: 2021, quarter: 2 });
  withoutCompletenessEvidence.completenessEvidence = null;
  const outcome = validateEligibilityRegister([withoutCompletenessEvidence]);
  assert.equal(outcome.ok, false);
  assert.ok(outcome.errors.some((error) => error.code === "COMPLETENESS_WITHOUT_EVIDENCE"));
});

test("evidencia sin authority y locator no cuenta como evidencia", () => {
  const incomplete = gasQuarterlyCampaign({ year: 2021, quarter: 3, eligibilityEvidence: { authority: "SYN", locator: " " } });
  const outcome = validateEligibilityRegister([incomplete]);
  assert.equal(outcome.ok, false);
  assert.ok(outcome.errors.some((error) => error.code === "ELIGIBILITY_WITHOUT_EVIDENCE"));
});

test("la selección cronológica excluye no elegibles e incompletas", () => {
  const register = gasQuarterlyRegister({ year: 2021, quarter: 1, count: 4 });
  register[1].eligibility = "INELIGIBLE";
  register[3].completeness = "INCOMPLETE";
  const ordered = chronologicalEligibleComplete(register);
  assert.deepEqual(ordered.map((episode) => episode.maturity), ["2021Q1", "2021Q3"]);
});

test("fechas ISO imposibles no se normalizan", () => {
  assert.equal(parseIsoDate("2020-02-30").ok, false);
  assert.equal(parseIsoDate("2020-02-29").ok, true);
  assert.equal(parseIsoDate("2020-13-01").ok, false);
  assert.equal(parseIsoDate("20-01-01").ok, false);
});

test("la ventana 3-1-3 deriva meses de trading previos al gap", () => {
  // 2021Q1: delivery arranca en enero; trading = sep-nov 2020.
  assert.deepEqual(quarterlyWindow(2021, 1), { windowStart: "2020-09-01", deadline: "2020-11-30" });
  assert.deepEqual(quarterlyWindow(2021, 2), { windowStart: "2020-12-01", deadline: "2021-02-28" });
  assert.ok(quarterIndex("2021Q2") > quarterIndex("2021Q1"));
});
