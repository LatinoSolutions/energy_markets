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
  createGasQuarterlyValidationFicha,
  episodeObligationIdFor,
  evaluateImp02Acceptance,
  IMP02_REQUIRED_FACT_IDS,
  mapCoverageOwnership,
  resolveObligationDeadline,
  researchCampaignIdFor,
  validateCampaignContract,
  validateQuarterlyEpisodeSequence,
} from "../../src/procurement-contract/index.mjs";

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

  // §4.1 línea 281: cantidad Y unidad confirmadas en la tabla.
  const unit = fact(ficha, "campaign.obligation.unit");
  assert.equal(unit.availability, "AVAILABLE_NOW");
  assert.equal(unit.value, "MW");

  // §4.1 línea 280: identidad (producto, Mission) AUDIT-DEPENDENT; coincide
  // con el artefacto IMP-02 v1.1 que las declara MISSING.
  for (const factId of ["campaign.identity.productFamily", "campaign.identity.mission"]) {
    const entry = fact(ficha, factId);
    assert.equal(entry.availability, "UNAVAILABLE", factId);
    assert.ok(entry.reason.includes("AUDIT-DEPENDENT"), factId);
    assert.ok(entry.reason.includes("operations/audit/IMP-02/campaign-contract.json"), factId);
  }

  for (const factId of ["campaign.identity.campaignId", "campaign.identity.productContract", "campaign.obligation.deliveryPeriod", "campaign.calendar.deadline", "campaign.coverage.fillToObligationAssignment"]) {
    const entry = fact(ficha, factId);
    assert.equal(entry.availability, "UNAVAILABLE", factId);
    assert.ok(entry.reason && entry.reason.length > 0, factId);
  }
});

// §25.1/§25.2: la ficha reconcilia con el paquete verificado del cliente los
// parámetros que documenta a nivel del caso Fundamental: hub/market
// NATGAS / THE Quarterly y la estructura 3-1-3. Verificación del paquete:
// OFICINA_INTAKE_VERIFICATION.json (ESTADO_INPUTS.csv; gas_quarterly.md;
// 01_shared_campaign_rules.md §1). Permanecen falsos criterionMet y
// campaignIdentified: el paquete no aporta Campaign ID, maturity ni ownership.
test("la ficha documenta el hub/market y la pausa 3-1-3 con provenance del paquete del cliente", () => {
  const ficha = createGasQuarterlyFicha();
  const hub = fact(ficha, "campaign.identity.hubMarket");
  assert.equal(hub.availability, "AVAILABLE_NOW");
  assert.ok(hub.value.includes("NATGAS / THE Quarterly"));
  assert.ok(hub.value.includes("THE"));
  assert.equal(hub.source.authority.includes("Fundamental (cliente)"), true);
  assert.ok(hub.source.locator.includes("ESTADO_INPUTS.csv"));
  assert.ok(hub.source.locator.includes("01_campaigns/gas_quarterly.md"));
  const pause = fact(ficha, "campaign.calendar.pauseExclusion");
  assert.equal(pause.availability, "AVAILABLE_NOW");
  assert.ok(pause.value.includes("3-1-3"));
  assert.ok(pause.source.locator.includes("01_shared_campaign_rules.md"));
  const outcome = validateCampaignContract(ficha);
  assert.equal(outcome.ok, true);
  assert.equal(outcome.campaignIdentified, false);
  const criterion = evaluateImp02Acceptance(ficha);
  assert.equal(criterion.criterionMet, false);
  // El paquete identifica el hub pero no la campaña: el criterio no cambia.
  assert.deepEqual(criterion.auditedContract.blockedBy.includes("campaign.identity"), true);
});

// Regresión del hallazgo IMP-02-HUBMARKET-PROVENANCE-007: el valor del
// hub/market añadía "(Trading Hub Europe, vía futuros EEX)", una expansión que
// no sostiene su provenance. El cliente documenta la clase de producto
// exactamente como "NATGAS / THE Quarterly EEX futures" (ESTADO_INPUTS.csv
// fila "Product mapping — Gas Quarterly"; gas_quarterly.md "Relevant EEX
// product class"); ninguna fuente del paquete ni la SPEC expande "THE".
test("el valor del hub/market no excede su provenance documentada", () => {
  const hub = fact(createGasQuarterlyFicha(), "campaign.identity.hubMarket");
  assert.equal(hub.value, "NATGAS / THE Quarterly EEX futures");
  assert.equal(hub.value, hub.source.quote);
  assert.ok(!hub.value.includes("Trading Hub Europe"));
  assert.ok(!hub.value.includes("vía futuros"));
  const quote = hub.source.quote.toLowerCase();
  for (const token of hub.value.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)) {
    assert.ok(quote.includes(token), `token fuera de la provenance citada: ${token}`);
  }
});

test("el hub/market y la pausa 3-1-3 citan el paquete del cliente, no la confirmación del owner", () => {
  const ficha = createGasQuarterlyFicha();
  for (const factId of ["campaign.identity.hubMarket", "campaign.calendar.pauseExclusion"]) {
    const entry = fact(ficha, factId);
    assert.ok(entry.source.authority.includes("Fundamental"), factId);
    assert.ok(!entry.source.authority.includes("Bru (owner)"), factId);
    assert.ok(entry.source.locator.length > 0, factId);
    assert.equal(entry.reason, null, factId);
  }
});

// Regresión del hallazgo IMP-02-CLIENT-FACTS-006: la ficha declaraba
// UNAVAILABLE el hub/market y la estructura de pausa que el paquete ya
// documenta; esas razones de ausencia contradictorias ya no aparecen.
test("la ficha ya no afirma ausencia del hub/market ni de la estructura 3-1-3", () => {
  const ficha = createGasQuarterlyFicha();
  assert.ok(!JSON.stringify(ficha).includes("No hay mercado/hub aplicable confirmado"));
  assert.ok(!JSON.stringify(ficha).includes("Falta la estructura de pausa/mes excluido"));
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
  fact(ficha, "campaign.obligation.totalVolumeKnown").source = null;
  const outcome = validateCampaignContract(ficha);
  assert.equal(outcome.ok, false);
  assert.ok(outcome.errors.some((error) => error.code === "NO_PROVENANCE" && error.factId === "campaign.obligation.totalVolumeKnown"));
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
  fact(ficha, "campaign.calendar.deadline").reason = "";
  const outcome = validateCampaignContract(ficha);
  assert.equal(outcome.ok, false);
  assert.ok(outcome.errors.some((error) => error.code === "MISSING_NOT_DOCUMENTED" && error.factId === "campaign.calendar.deadline"));
});

test("una fact con availability no declarada se rechaza", () => {
  const ficha = createGasQuarterlyFicha();
  fact(ficha, "campaign.identity.mission").availability = "PROBABLY_TRUE";
  const outcome = validateCampaignContract(ficha);
  assert.equal(outcome.ok, false);
  assert.ok(outcome.errors.some((error) => error.code === "UNKNOWN_AVAILABILITY"));
});

test("las availability del namespace no soportadas para fichas se rechazan (PROXY, FORWARD_CAPTURE)", () => {
  // §3.2: el namespace declara cuatro valores; sólo AVAILABLE_NOW y
  // UNAVAILABLE materializan la ficha (campaign-contract.mjs). PROXY y
  // FORWARD_CAPTURE son del namespace pero no materializan.
  for (const availability of ["PROXY", "FORWARD_CAPTURE"]) {
    const ficha = createGasQuarterlyFicha();
    fact(ficha, "campaign.identity.campaignId").availability = availability;
    const outcome = validateCampaignContract(ficha);
    assert.equal(outcome.ok, false, availability);
    assert.ok(outcome.errors.some((error) => error.code === "UNSUPPORTED_AVAILABILITY" && error.factId === "campaign.identity.campaignId"), availability);
  }
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

const SYNTHETIC_SOURCE = { authority: "Bru (owner)", locator: "fixture sintético" };
const FLAT_PROFILE = { shape: "FLAT", hours: 24, source: SYNTHETIC_SOURCE };

test("MW no se convierte a MWh sin horas y perfil de entrega", () => {
  assert.equal(convertMwToMwh({ quantityMw: 60 }).code, "UNIT_INFERENCE_WITHOUT_HOURS_PROFILE");
  assert.equal(convertMwToMwh({ quantityMw: 60, deliveryProfile: { shape: "FLAT", source: SYNTHETIC_SOURCE } }).code, "UNIT_INFERENCE_WITHOUT_HOURS_PROFILE");
  assert.equal(convertMwToMwh({ quantityMw: 60, deliveryProfile: { ...FLAT_PROFILE, hours: 0 } }).code, "UNIT_INFERENCE_WITHOUT_HOURS_PROFILE");
  const ok = convertMwToMwh({ quantityMw: 60, deliveryProfile: FLAT_PROFILE });
  assert.equal(ok.ok, true);
  assert.equal(ok.mwh, 1440);
});

test("un perfil de entrega en texto libre no justifica la conversión (\"unknown\" no da 1440 MWh)", () => {
  // Regresión del review: "unknown" convertía 60 MW a 1440 MWh (§4.1).
  for (const deliveryProfile of ["unknown", "baseload", { shape: "FLAT", hours: 24 }, { shape: "FLAT", hours: 24, source: { authority: "x" } }]) {
    const outcome = convertMwToMwh({ quantityMw: 60, deliveryProfile });
    assert.equal(outcome.ok, false, JSON.stringify(deliveryProfile));
    assert.equal(outcome.mwh, null);
    assert.equal(outcome.code, "DELIVERY_PROFILE_NOT_JUSTIFIED", JSON.stringify(deliveryProfile));
  }
});

test("las horas salen del perfil justificado, no de un parámetro suelto", () => {
  // §4.1: horas Y perfil justifican la conversión; unas horas sueltas no
  // sustituyen a las del perfil con evidencia.
  const outcome = convertMwToMwh({ quantityMw: 60, deliveryHours: 144, deliveryProfile: FLAT_PROFILE });
  assert.equal(outcome.mwh, 1440);
});

test("un perfil con forma distinta de FLAT no se convierte por MW × horas", () => {
  for (const shape of ["PEAK", "SHAPED", "flat", undefined]) {
    const outcome = convertMwToMwh({ quantityMw: 60, deliveryProfile: { ...FLAT_PROFILE, shape } });
    assert.equal(outcome.ok, false, String(shape));
    assert.equal(outcome.code, "DELIVERY_PROFILE_NOT_CONVERTIBLE", String(shape));
  }
});

test("una cantidad negativa no se convierte", () => {
  assert.equal(convertMwToMwh({ quantityMw: -60, deliveryProfile: FLAT_PROFILE }).code, "MISSING_QUANTITY");
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

  // Regresión del review energy-markets-IMP-02-20260923-193314 (§13.4): el
  // texto-regla del paquete no cuenta como deadline determinado.
  const deadlineRuleText = "Exact target position by the end of the final effective trading day";
  Object.assign(fact(ficha, "campaign.calendar.deadline"), {
    availability: "AVAILABLE_NOW",
    value: deadlineRuleText,
    source: { authority: "Fundamental (cliente)", locator: "ESTADO_INPUTS.csv fila Terminal requirement" },
    reason: null,
  });
  const ruleOutcome = resolveObligationDeadline(ficha);
  assert.equal(ruleOutcome.determined, false);
  assert.equal(ruleOutcome.deadline, null);
  assert.equal(ruleOutcome.ruleText, deadlineRuleText);
  const ruleCriterion = evaluateImp02Acceptance(ficha);
  assert.equal(ruleCriterion.deadline.determined, false);
  assert.ok(ruleCriterion.deadline.reason.includes("§13.4"), ruleCriterion.deadline.reason);
  assert.equal(ruleCriterion.criterionMet, false);
});

// Regresión del review energy-markets-IMP-02-20260923-195314
// (HALLAZGO_TECNICO IMP02-DEADLINE-ISO-CALENDAR, §13.4): la forma ISO 8601 no
// instancia una fecha; "2026-13-45" no existe en el calendario y no es un
// deadline determinado.
test("una fecha imposible de calendario no determina deadline ni criterio", () => {
  for (const impossible of ["2026-13-45", "2021-02-30", "2021-02-29", "0000-00-00"]) {
    const ficha = createGasQuarterlyFicha();
    Object.assign(fact(ficha, "campaign.calendar.deadline"), {
      availability: "AVAILABLE_NOW",
      value: impossible,
      source: { authority: "Bru (owner)", locator: "fixture sintético" },
      reason: null,
    });
    const outcome = resolveObligationDeadline(ficha);
    assert.equal(outcome.determined, false, impossible);
    assert.equal(outcome.deadline, null, impossible);
    assert.ok(outcome.reason.includes("no instancia una fecha real"), outcome.reason);
    const criterion = evaluateImp02Acceptance(ficha);
    assert.equal(criterion.criterionMet, false, impossible);
    assert.equal(criterion.deadline.determined, false, impossible);
  }
});

// Regresión del review 195314: un deadline válido-pero-ajeno a la maturity
// (convención 3-1-3 del paquete cliente) no instancia el cierre del episodio.
test("un deadline fuera de la ventana de trading del episodio no determina deadline ni criterio", () => {
  for (const deadlineValue of ["1999-01-01", "2020-12-31", "2021-01-01", "2026-12-31"]) {
    const ficha = createGasQuarterlyValidationFicha("2021Q1");
    Object.assign(fact(ficha, "campaign.calendar.deadline"), {
      availability: "AVAILABLE_NOW",
      value: deadlineValue,
      source: { authority: "Bru (owner)", locator: "fixture sintético" },
      reason: null,
    });
    const outcome = resolveObligationDeadline(ficha);
    assert.equal(outcome.determined, false, deadlineValue);
    assert.equal(outcome.deadline, null, deadlineValue);
    assert.ok(outcome.reason.includes("ventana de trading"), outcome.reason);
    const criterion = evaluateImp02Acceptance(ficha);
    assert.equal(criterion.criterionMet, false, deadlineValue);
    assert.equal(criterion.deadline.determined, false, deadlineValue);
  }
});

// El deadline del episodio 2021Q1 (trading en sep/oct/nov-2020, gap dic-2020,
// entrega 2021Q1) sólo instancia el cierre dentro de su ventana de trading; con
// fecha instanciable y dentro de la ventana el deadline queda determinado.
test("un deadline real dentro de la ventana de trading del episodio se determina", () => {
  for (const deadlineValue of ["2020-09-01", "2020-11-30", "2020-11-30T23:00Z"]) {
    const ficha = createGasQuarterlyValidationFicha("2021Q1");
    Object.assign(fact(ficha, "campaign.calendar.deadline"), {
      availability: "AVAILABLE_NOW",
      value: deadlineValue,
      source: { authority: "Bru (owner)", locator: "fixture sintético" },
      reason: null,
    });
    const outcome = resolveObligationDeadline(ficha);
    assert.equal(outcome.determined, true, deadlineValue);
    assert.equal(outcome.deadline, deadlineValue, deadlineValue);
  }
});

test("una fact de texto con valor no textual se rechaza", () => {
  const ficha = createGasQuarterlyFicha();
  fact(ficha, "campaign.obligation.unit").value = { invented: "objeto" };
  const outcome = validateCampaignContract(ficha);
  assert.equal(outcome.ok, false);
  assert.ok(outcome.errors.some((error) => error.code === "VALUE_TYPE_MISMATCH" && error.factId === "campaign.obligation.unit"));
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

test("una ficha con mapa MATERIALIZED válido pasa", () => {
  const ficha = materializedFicha({
    executed: 20,
    assignments: [
      { fillId: "FILL-1", obligationId: "OBL-QUARTERLY", quantity: 5, unit: "MW" },
      { fillId: "FILL-2", obligationId: "OBL-QUARTERLY", quantity: 15, unit: "MW" },
    ],
  });
  const outcome = validateCampaignContract(ficha);
  assert.deepEqual(outcome.errors, []);
  assert.equal(outcome.ok, true);
});

// Regresión de la revisión 5: 20 MW ejecutados con assignments: [] pasaban
// como ownership determinado y criterionMet: true.
test("un mapa MATERIALIZED vacío con volumen ejecutado no determina ownership ni valida", () => {
  const ficha = materializedFicha({ executed: 20, assignments: [] });
  assert.equal(ficha.acceptanceCriterion.coverageOwnership.determined, false);
  assert.ok(ficha.acceptanceCriterion.coverageOwnership.blockedBy.includes("coverageOwnership.assignments"));
  assert.equal(ficha.acceptanceCriterion.criterionMet, false);
  const outcome = validateCampaignContract(ficha);
  assert.equal(outcome.ok, false);
  assert.ok(outcome.errors.some((error) => error.code === "OWNERSHIP_EXECUTED_MISMATCH" && error.factId === "coverageOwnership"));
});

test("asignaciones que cubren sólo parte o más del volumen ejecutado se rechazan", () => {
  for (const quantity of [10, 30]) {
    const ficha = materializedFicha({
      executed: 20,
      assignments: [{ fillId: "FILL-1", obligationId: "OBL-QUARTERLY", quantity, unit: "MW" }],
    });
    assert.equal(ficha.acceptanceCriterion.criterionMet, false, String(quantity));
    assert.ok(codesOf(ficha).includes("OWNERSHIP_EXECUTED_MISMATCH"), String(quantity));
  }
});

test("asignaciones a otra obligación no cuentan para el volumen ejecutado de la ficha", () => {
  const ficha = materializedFicha({
    executed: 20,
    assignments: [
      { fillId: "FILL-1", obligationId: "OBL-QUARTERLY", quantity: 20, unit: "MW" },
      { fillId: "FILL-2", obligationId: "OBL-MONTHLY", quantity: 10, unit: "MW" },
    ],
  });
  assert.equal(ficha.acceptanceCriterion.criterionMet, true);
  assert.deepEqual(validateCampaignContract(ficha).errors, []);
  const misattributed = materializedFicha({
    executed: 20,
    assignments: [{ fillId: "FILL-1", obligationId: "OBL-MONTHLY", quantity: 20, unit: "MW" }],
  });
  assert.equal(misattributed.acceptanceCriterion.criterionMet, false);
  assert.ok(codesOf(misattributed).includes("OWNERSHIP_EXECUTED_MISMATCH"));
});

test("una asignación sin filled quantity o en otra unidad se rechaza", () => {
  const withoutQuantity = materializedFicha({ executed: 20, assignments: [{ fillId: "FILL-1", obligationId: "OBL-QUARTERLY", unit: "MW" }] });
  assert.ok(codesOf(withoutQuantity).includes("ASSIGNMENT_QUANTITY_INVALID"));
  assert.equal(withoutQuantity.acceptanceCriterion.criterionMet, false);
  const otherUnit = materializedFicha({ executed: 20, assignments: [{ fillId: "FILL-1", obligationId: "OBL-QUARTERLY", quantity: 20, unit: "MWh" }] });
  assert.ok(codesOf(otherUnit).includes("ASSIGNMENT_UNIT_MISMATCH"));
  assert.equal(otherUnit.acceptanceCriterion.criterionMet, false);
});

test("un mapa MATERIALIZED sin obligationId de la ficha se rechaza", () => {
  const ficha = materializedFicha({ executed: 20, assignments: [{ fillId: "FILL-1", obligationId: "OBL-QUARTERLY", quantity: 20, unit: "MW" }] });
  delete ficha.coverageOwnership.obligationId;
  ficha.acceptanceCriterion = evaluateImp02Acceptance(ficha);
  assert.equal(ficha.acceptanceCriterion.criterionMet, false);
  assert.ok(codesOf(ficha).includes("OBLIGATION_ID_MISSING"));
});

test("un mapa MATERIALIZED sin volumen ejecutado disponible se rechaza", () => {
  const ficha = materializedFicha({ executed: 20, assignments: [{ fillId: "FILL-1", obligationId: "OBL-QUARTERLY", quantity: 20, unit: "MW" }] });
  Object.assign(fact(ficha, "campaign.coverage.executedVolume"), { availability: "UNAVAILABLE", value: null, unit: null, source: null, reason: "sin ledger" });
  Object.assign(fact(ficha, "campaign.coverage.remainingVolume"), { availability: "UNAVAILABLE", value: null, unit: null, source: null, reason: "sin ledger" });
  ficha.acceptanceCriterion = evaluateImp02Acceptance(ficha);
  assert.equal(ficha.acceptanceCriterion.coverageOwnership.determined, false);
  assert.ok(codesOf(ficha).includes("EXECUTED_VOLUME_MISSING"));
});

test("sin fills ejecutados un mapa MATERIALIZED vacío reconcilia", () => {
  const ficha = materializedFicha({ executed: 0, assignments: [] });
  assert.equal(ficha.acceptanceCriterion.coverageOwnership.determined, true);
  assert.deepEqual(validateCampaignContract(ficha).errors, []);
});

test("el criterio no se deriva como cumplido con doble conteo aunque el mapa se declare MATERIALIZED", () => {
  const ficha = materializedFicha({
    executed: 20,
    assignments: [
      { fillId: "FILL-1", obligationId: "OBL-QUARTERLY", quantity: 20, unit: "MW" },
      { fillId: "FILL-1", obligationId: "OBL-MONTHLY", quantity: 20, unit: "MW" },
    ],
  });
  assert.equal(ficha.acceptanceCriterion.coverageOwnership.determined, false);
  assert.equal(ficha.acceptanceCriterion.criterionMet, false);
});

test("el criterio no se deriva como cumplido con una relación AVAILABLE_NOW inválida", () => {
  const ficha = materializedFicha({ executed: 20, assignments: [{ fillId: "FILL-1", obligationId: "OBL-QUARTERLY", quantity: 20, unit: "MW" }] });
  ficha.coverageOwnership.relationMonthlyQuarterly = { availability: "AVAILABLE_NOW" };
  const criterion = evaluateImp02Acceptance(ficha);
  assert.equal(criterion.coverageOwnership.determined, false);
  assert.ok(criterion.coverageOwnership.blockedBy.includes("coverageOwnership.relationMonthlyQuarterly"));
});

// Regresión de la validación adversarial: con un ID de obligación con espacio
// final ("OBL-QUARTERLY ") o una asignación a otra obligación sin volumen, la
// ficha validaba y el criterio se derivaba cumplido.
test("una asignación con ID no canónico u otra obligación sin volumen no cumple el criterio", () => {
  const variants = [
    { fillId: "FILL-2", obligationId: "OBL-QUARTERLY ", quantity: 20, unit: "MW" },
    { fillId: "FILL-1 ", obligationId: "OBL-MONTHLY", quantity: 20, unit: "MW" },
    { fillId: "FILL-2", obligationId: "OBL-MONTHLY" },
    { fillId: "FILL-2", obligationId: "OBL-MONTHLY", quantity: -999, unit: "MWh" },
  ];
  for (const extra of variants) {
    const ficha = materializedFicha({
      executed: 20,
      assignments: [{ fillId: "FILL-1", obligationId: "OBL-QUARTERLY", quantity: 20, unit: "MW" }, extra],
    });
    assert.equal(ficha.acceptanceCriterion.criterionMet, false, JSON.stringify(extra));
    assert.equal(validateCampaignContract(ficha).ok, false, JSON.stringify(extra));
  }
});

// Regresión de la validación adversarial: evaluateImp02Acceptance sola
// derivaba criterionMet true en fichas que el contrato rechaza.
test("evaluateImp02Acceptance no deriva el criterio cumplido sobre una ficha que rompe el contrato", () => {
  const breakers = {
    "mapa sin provenance": (ficha) => { delete ficha.coverageOwnership.authority; },
    "fact de asignación UNAVAILABLE": (ficha) => {
      Object.assign(fact(ficha, "campaign.coverage.fillToObligationAssignment"), { availability: "UNAVAILABLE", value: null, source: null, reason: "sin ledger" });
    },
    "familia contradictoria": (ficha) => { fact(ficha, "campaign.identity.productFamily").value = "Power"; },
    "campaignId no textual": (ficha) => { fact(ficha, "campaign.identity.campaignId").value = 123; },
    "total distinto del confirmado": (ficha) => {
      fact(ficha, "campaign.obligation.totalVolumeKnown").value = 100;
      fact(ficha, "campaign.coverage.remainingVolume").value = 80;
    },
  };
  for (const [name, breakFicha] of Object.entries(breakers)) {
    const ficha = materializedFicha({ executed: 20, assignments: [{ fillId: "FILL-1", obligationId: "OBL-QUARTERLY", quantity: 20, unit: "MW" }] });
    breakFicha(ficha);
    const criterion = evaluateImp02Acceptance(ficha);
    assert.equal(criterion.contractValid, false, name);
    assert.equal(criterion.criterionMet, false, name);
  }
});

test("con una fact duplicada campaignIdentified del validador y del criterio usan la misma copia", () => {
  const ficha = createGasQuarterlyFicha();
  ficha.facts.push({ ...fact(ficha, "campaign.identity.campaignId"), availability: "AVAILABLE_NOW", value: "SYNTH-1", source: { authority: "a", locator: "l" }, reason: null });
  for (const factId of ["campaign.identity.productContract", "campaign.identity.hubMarket"]) {
    makeAvailable(ficha, factId, "SYNTH");
  }
  makeAvailable(ficha, "campaign.identity.productFamily", "Gas");
  makeAvailable(ficha, "campaign.identity.mission", "Quarterly");
  ficha.acceptanceCriterion = evaluateImp02Acceptance(ficha);
  const outcome = validateCampaignContract(ficha);
  assert.equal(outcome.ok, false);
  assert.ok(outcome.errors.some((error) => error.code === "DUPLICATE_FACT"));
  assert.equal(outcome.campaignIdentified, false);
  assert.equal(ficha.acceptanceCriterion.campaignIdentified, false);
});

test("el restante no se deriva como determinado si rompe la conservación", () => {
  const ficha = materializedFicha({ executed: 20, assignments: [{ fillId: "FILL-1", obligationId: "OBL-QUARTERLY", quantity: 20, unit: "MW" }] });
  fact(ficha, "campaign.coverage.remainingVolume").value = 50;
  const criterion = evaluateImp02Acceptance(ficha);
  assert.equal(criterion.remainingVolume.determined, false);
  assert.ok(criterion.remainingVolume.blockedBy.includes("campaign.coverage.reconciliation"));
  assert.equal(criterion.criterionMet, false);
});

test("una cobertura no pertenece dos veces a obligaciones dentro de la ficha (§25.1 IMP-02)", () => {
  const ficha = createGasQuarterlyFicha();
  ficha.coverageOwnership.mapState = "MATERIALIZED";
  ficha.coverageOwnership.assignments = [
    { fillId: "FILL-1", obligationId: "OBL-QUARTERLY" },
    { fillId: "FILL-1", obligationId: "OBL-MONTHLY" },
  ];
  ficha.coverageOwnership.authority = "Bru (owner)";
  ficha.coverageOwnership.locator = "mandato firmado p.1";
  const outcome = validateCampaignContract(ficha);
  assert.equal(outcome.ok, false);
  const violation = outcome.errors.find((error) => error.code === "DUPLICATE_OWNERSHIP" && error.factId === "coverageOwnership");
  assert.ok(violation);
  assert.ok(violation.message.includes("FILL-1"));
});

test("una asignación del mapa MATERIALIZED sin fillId u obligationId se rechaza", () => {
  const ficha = createGasQuarterlyFicha();
  ficha.coverageOwnership.mapState = "MATERIALIZED";
  ficha.coverageOwnership.assignments = [{ fillId: "FILL-1" }];
  ficha.coverageOwnership.authority = "Bru (owner)";
  ficha.coverageOwnership.locator = "mandato firmado p.1";
  const outcome = validateCampaignContract(ficha);
  assert.equal(outcome.ok, false);
  assert.ok(outcome.errors.some((error) => error.code === "INVALID_ASSIGNMENT"));
});

test("la ficha materializada en v1_1_1 se valida y coincide con el builder", () => {
  const path = resolve(repoRoot, "operations/audit/IMP-02/v1_1_1/gas-quarterly-campaign-ficha.json");
  const artifact = JSON.parse(readFileSync(path, "utf8"));
  const outcome = validateCampaignContract(artifact);
  assert.equal(outcome.ok, true);
  assert.equal(outcome.campaignIdentified, false);
  assert.deepEqual(artifact, createGasQuarterlyFicha());
});

function makeAvailable(ficha, factId, value, unit = null) {
  Object.assign(fact(ficha, factId), {
    availability: "AVAILABLE_NOW",
    value,
    unit,
    source: { authority: "Bru (owner)", locator: "fixture sintético" },
    reason: null,
  });
}

// §25.2 fila IMP-02: el resto de DEP-01–04 (contrato, delivery, liquidación,
// vínculo, vigencia, calendario, enmiendas, terminal rule) auditado. Valores
// sintéticos: prueban la derivación, no son datos de una campaña real.
function makeRestOfAuditedContractAvailable(ficha) {
  makeAvailable(ficha, "campaign.obligation.deliveryPeriod", "SYNTH-DELIVERY");
  makeAvailable(ficha, "campaign.obligation.settlement", "SYNTH-SETTLEMENT");
  makeAvailable(ficha, "campaign.obligation.validity", "SYNTH-VALIDITY");
  makeAvailable(ficha, "campaign.obligation.campaignLink", "SYNTH-1");
  makeAvailable(ficha, "campaign.obligation.amendments", "SYNTH-AMENDMENTS");
  makeAvailable(ficha, "campaign.calendar.openClose", "SYNTH-OPEN-CLOSE");
  makeAvailable(ficha, "campaign.calendar.decisionOpportunities", "SYNTH-OPPORTUNITIES");
  makeAvailable(ficha, "campaign.calendar.pauseExclusion", "SYNTH-PAUSE");
  makeAvailable(ficha, "campaign.feasibility.terminalCoverageRule", "SYNTH-TERMINAL-RULE");
}

// Fixture sintético de una campaña identificada con mapa MATERIALIZED; prueba
// la reconciliación, no es una campaña real.
function materializedFicha({ executed, assignments }) {
  const ficha = createGasQuarterlyFicha();
  makeAvailable(ficha, "campaign.identity.campaignId", "SYNTH-1");
  makeAvailable(ficha, "campaign.identity.productContract", "SYNTH-CONTRACT");
  makeAvailable(ficha, "campaign.identity.productFamily", "Gas");
  makeAvailable(ficha, "campaign.identity.mission", "Quarterly");
  makeAvailable(ficha, "campaign.identity.hubMarket", "SYNTH-HUB");
  makeAvailable(ficha, "campaign.calendar.deadline", "2026-12-31");
  makeAvailable(ficha, "campaign.coverage.executedVolume", executed, "MW");
  makeAvailable(ficha, "campaign.coverage.remainingVolume", 60 - executed, "MW");
  makeAvailable(ficha, "campaign.coverage.fillToObligationAssignment", assignments);
  makeRestOfAuditedContractAvailable(ficha);
  ficha.coverageOwnership = {
    mapState: "MATERIALIZED",
    obligationId: "OBL-QUARTERLY",
    assignments,
    authority: "Bru (owner)",
    locator: "fixture sintético",
    relationMonthlyQuarterly: { availability: "AVAILABLE_NOW", relationType: "ADDITIONAL", value: "adicional", authority: "Bru (owner)", locator: "fixture sintético" },
  };
  ficha.acceptanceCriterion = evaluateImp02Acceptance(ficha);
  return ficha;
}

function codesOf(ficha) {
  return validateCampaignContract(ficha).errors.map((error) => error.code);
}

test("totalVolumeKnown en MW con obligation.unit MWh se rechaza por incoherencia de unidad", () => {
  // Regresión del review: validaba ok:true con unidades distintas (§4.1).
  const ficha = createGasQuarterlyFicha();
  fact(ficha, "campaign.obligation.unit").value = "MWh";
  const outcome = validateCampaignContract(ficha);
  assert.equal(outcome.ok, false);
  assert.ok(outcome.errors.some((error) => error.code === "UNIT_INCOHERENT" && error.factId === "campaign.obligation.totalVolumeKnown"));
});

test("una cantidad publicada sin obligation.unit disponible se rechaza (sin inferir unidad)", () => {
  const ficha = createGasQuarterlyFicha();
  Object.assign(fact(ficha, "campaign.obligation.unit"), { availability: "UNAVAILABLE", value: null, source: null, reason: "fixture" });
  assert.ok(codesOf(ficha).includes("OBLIGATION_UNIT_MISSING"));
});

test("un total distinto de la cantidad confirmada por Bru para Gas Quarterly se rechaza", () => {
  const ficha = createGasQuarterlyFicha();
  fact(ficha, "campaign.obligation.totalVolumeKnown").value = 10;
  assert.ok(codesOf(ficha).includes("CONFIRMED_QUANTITY_MISMATCH"));
});

test("una identidad publicada que contradice el producto/Mission de la ficha se rechaza", () => {
  const ficha = createGasQuarterlyFicha();
  makeAvailable(ficha, "campaign.identity.productFamily", "Power");
  makeAvailable(ficha, "campaign.identity.mission", "Monthly");
  const incoherent = validateCampaignContract(ficha).errors.filter((error) => error.code === "IDENTITY_INCOHERENT");
  assert.equal(incoherent.length, 2);
});

test("un restante publicado sin volumen ejecutado no se acepta", () => {
  const ficha = createGasQuarterlyFicha();
  makeAvailable(ficha, "campaign.coverage.remainingVolume", 60, "MW");
  assert.ok(codesOf(ficha).includes("REMAINING_NOT_DERIVABLE"));
});

test("un restante publicado que rompe apertura = ejecutado + restante se rechaza", () => {
  const ficha = createGasQuarterlyFicha();
  makeAvailable(ficha, "campaign.coverage.executedVolume", 20, "MW");
  makeAvailable(ficha, "campaign.coverage.remainingVolume", 50, "MW");
  assert.ok(codesOf(ficha).includes("CONSERVATION_VIOLATION"));
});

test("la fact de asignación y coverageOwnership.mapState deben coincidir", () => {
  const ficha = createGasQuarterlyFicha();
  makeAvailable(ficha, "campaign.coverage.fillToObligationAssignment", [{ fillId: "FILL-1", obligationId: "OBL-QUARTERLY", quantity: 5, unit: "MW" }]);
  assert.ok(codesOf(ficha).includes("OWNERSHIP_STATE_INCOHERENT"));
});

// Regresión del review: la fact de asignación sólo se comparaba por
// disponibilidad con mapState; podía declarar FILL-A→OBL-1 y el mapa
// materializado FILL-B→OBL-1 sin que la ficha los reconciliara.
test("la fact de asignación no puede contradecir el mapa materializado (§4.3/DEP-02)", () => {
  const ficha = materializedFicha({
    executed: 20,
    assignments: [{ fillId: "FILL-1", obligationId: "OBL-QUARTERLY", quantity: 20, unit: "MW" }],
  });
  fact(ficha, "campaign.coverage.fillToObligationAssignment").value = [{ fillId: "FILL-2", obligationId: "OBL-QUARTERLY", quantity: 20, unit: "MW" }];
  const outcome = validateCampaignContract(ficha);
  assert.equal(outcome.ok, false);
  assert.ok(outcome.errors.some((error) => error.code === "OWNERSHIP_ASSIGNMENT_MISMATCH" && error.factId === "campaign.coverage.fillToObligationAssignment"));
  assert.equal(evaluateImp02Acceptance(ficha).criterionMet, false);
});

test("la fact de asignación coherente con el mapa materializado no se rechaza", () => {
  const ficha = materializedFicha({
    executed: 20,
    assignments: [
      { fillId: "FILL-1", obligationId: "OBL-QUARTERLY", quantity: 15, unit: "MW" },
      { fillId: "FILL-2", obligationId: "OBL-QUARTERLY", quantity: 5, unit: "MW" },
    ],
  });
  assert.ok(!codesOf(ficha).includes("OWNERSHIP_ASSIGNMENT_MISMATCH"));
  assert.deepEqual(validateCampaignContract(ficha).errors, []);
});

test("la ficha declara explícitamente que el criterio de aceptación de IMP-02 no se cumple", () => {
  // §25.1 IMP-02: remaining volume, deadline y ownership no determinables con
  // el material inspeccionado; se declaran como tales, no como hechos.
  const ficha = createGasQuarterlyFicha();
  const criterion = ficha.acceptanceCriterion;
  assert.equal(criterion.criterionMet, false);
  assert.equal(criterion.campaignIdentified, false);
  for (const part of [criterion.remainingVolume, criterion.deadline, criterion.coverageOwnership]) {
    assert.equal(part.determined, false);
    assert.ok(part.blockedBy.length > 0);
    assert.ok(part.reason.startsWith("No determinable"));
  }
  assert.equal(criterion.remainingVolume.value, null);
  assert.equal(criterion.deadline.value, null);
  assert.deepEqual(criterion.remainingVolume.blockedBy, ["campaign.identity", "campaign.coverage.executedVolume", "campaign.coverage.remainingVolume"]);
});

test("una ficha que afirma el criterio cumplido sin facts que lo sostengan se rechaza", () => {
  const ficha = createGasQuarterlyFicha();
  ficha.acceptanceCriterion.criterionMet = true;
  ficha.acceptanceCriterion.deadline = { determined: true, value: "2026-12-31", blockedBy: [], reason: null };
  assert.ok(codesOf(ficha).includes("ACCEPTANCE_CRITERION_INCOHERENT"));
});

test("una ficha sin declaración del criterio de aceptación se rechaza", () => {
  const ficha = createGasQuarterlyFicha();
  delete ficha.acceptanceCriterion;
  assert.ok(codesOf(ficha).includes("ACCEPTANCE_CRITERION_MISSING"));
});

test("con la ficha completa DEP-01–04 coherente el criterio se deriva como cumplido", () => {
  // Fixture sintético: prueba la derivación, no es una campaña real.
  const ficha = materializedFicha({ executed: 20, assignments: [{ fillId: "FILL-1", obligationId: "OBL-QUARTERLY", quantity: 20, unit: "MW" }] });
  for (const factId of IMP02_REQUIRED_FACT_IDS) {
    assert.equal(fact(ficha, factId).availability, "AVAILABLE_NOW", factId);
  }
  assert.equal(ficha.acceptanceCriterion.criterionMet, true);
  assert.deepEqual(ficha.acceptanceCriterion.auditedContract, { determined: true, blockedBy: [], documentedAbsences: [], reason: null });
  assert.deepEqual(ficha.acceptanceCriterion.remainingVolume, { determined: true, value: 40, unit: "MW", blockedBy: [], reason: null });
  assert.deepEqual(validateCampaignContract(ficha).errors, []);
});

// Regresión de la revisión 6: criterionMet true con vínculo de campaña,
// delivery y terminal rule UNAVAILABLE. §25.2 fila IMP-02 exige DEP-01–04
// resueltas para la campaña examinada.
test("cualquier fact DEP-01–04 sin auditar impide el criterio (§25.2 IMP-02)", () => {
  for (const factId of ["campaign.obligation.campaignLink", "campaign.obligation.deliveryPeriod", "campaign.feasibility.terminalCoverageRule", "campaign.obligation.settlement", "campaign.calendar.openClose", "campaign.obligation.amendments"]) {
    const ficha = materializedFicha({ executed: 20, assignments: [{ fillId: "FILL-1", obligationId: "OBL-QUARTERLY", quantity: 20, unit: "MW" }] });
    Object.assign(fact(ficha, factId), { availability: "UNAVAILABLE", value: null, unit: null, source: null, reason: "fixture: sin auditar" });
    const criterion = evaluateImp02Acceptance(ficha);
    assert.equal(criterion.contractValid, true, factId);
    assert.equal(criterion.criterionMet, false, factId);
    assert.equal(criterion.auditedContract.determined, false, factId);
    assert.deepEqual(criterion.auditedContract.blockedBy, [factId]);
  }
});

test("DEP-01–04 son las facts requeridas; DEP-05 queda para IMP-07 (§25.2)", () => {
  const dep05 = ["campaign.feasibility.lots", "campaign.feasibility.rounding", "campaign.execution.contract"];
  for (const factId of dep05) {
    assert.ok(!IMP02_REQUIRED_FACT_IDS.includes(factId), factId);
  }
  assert.equal(IMP02_REQUIRED_FACT_IDS.length, CAMPAIGN_CONTRACT_FACTS.length - dep05.length);
  const ficha = materializedFicha({ executed: 20, assignments: [{ fillId: "FILL-1", obligationId: "OBL-QUARTERLY", quantity: 20, unit: "MW" }] });
  assert.equal(fact(ficha, "campaign.execution.contract").availability, "UNAVAILABLE");
  assert.equal(ficha.acceptanceCriterion.criterionMet, true);
});

test("la terminal rule y las enmiendas se resuelven con ausencia documentada; el deadline no", () => {
  // §25.2 IMP-02: "incluida constatación documentada de ausencia cuando corresponda".
  const ficha = materializedFicha({ executed: 20, assignments: [{ fillId: "FILL-1", obligationId: "OBL-QUARTERLY", quantity: 20, unit: "MW" }] });
  for (const factId of ["campaign.feasibility.terminalCoverageRule", "campaign.obligation.amendments"]) {
    makeAvailable(ficha, factId, "El contrato versionado no contiene esta cláusula (fixture sintético).");
    fact(ficha, factId).documentedAbsence = true;
  }
  ficha.acceptanceCriterion = evaluateImp02Acceptance(ficha);
  assert.equal(ficha.acceptanceCriterion.criterionMet, true);
  // La ausencia de terminal rule queda publicada, no leída como regla.
  assert.deepEqual(ficha.acceptanceCriterion.auditedContract.documentedAbsences, ["campaign.obligation.amendments", "campaign.feasibility.terminalCoverageRule"]);
  assert.deepEqual(validateCampaignContract(ficha).errors, []);

  // §13.4: "la estructura documentada de pausa/mes excluido" no admite ausencia.
  for (const factId of ["campaign.calendar.deadline", "campaign.calendar.pauseExclusion", "campaign.obligation.settlement"]) {
    const other = materializedFicha({ executed: 20, assignments: [{ fillId: "FILL-1", obligationId: "OBL-QUARTERLY", quantity: 20, unit: "MW" }] });
    fact(other, factId).documentedAbsence = true;
    assert.ok(codesOf(other).includes("ABSENCE_NOT_ALLOWED"), factId);
  }
});

test("una ausencia sin auditar (UNAVAILABLE) o no booleana no se acepta como constatada", () => {
  for (const flag of [true, "true", null]) {
    const unavailable = createGasQuarterlyFicha();
    fact(unavailable, "campaign.feasibility.terminalCoverageRule").documentedAbsence = flag;
    assert.ok(codesOf(unavailable).includes("ABSENCE_NOT_ALLOWED"), String(flag));
  }
  const ficha = materializedFicha({ executed: 20, assignments: [{ fillId: "FILL-1", obligationId: "OBL-QUARTERLY", quantity: 20, unit: "MW" }] });
  fact(ficha, "campaign.feasibility.terminalCoverageRule").documentedAbsence = "sí";
  assert.ok(codesOf(ficha).includes("ABSENCE_NOT_ALLOWED"));
});

// Regresión de la revisión 6: la tabla §4.1 se exigía a toda ficha Gas
// Quarterly; §4.1 "Alcance": "No se extrapolan estas cantidades a todas las
// campañas históricas".
test("la cantidad confirmada sólo gobierna el total que la cita como fuente", () => {
  const ownMandate = materializedFicha({ executed: 20, assignments: [{ fillId: "FILL-1", obligationId: "OBL-QUARTERLY", quantity: 20, unit: "MW" }] });
  makeAvailable(ownMandate, "campaign.obligation.totalVolumeKnown", 45, "MW");
  fact(ownMandate, "campaign.obligation.totalVolumeKnown").source = { authority: "Mandato sintético SYNTH-1", locator: "fixture p.1" };
  makeAvailable(ownMandate, "campaign.coverage.remainingVolume", 25, "MW");
  ownMandate.acceptanceCriterion = evaluateImp02Acceptance(ownMandate);
  assert.ok(!codesOf(ownMandate).includes("CONFIRMED_QUANTITY_MISMATCH"));
  assert.deepEqual(validateCampaignContract(ownMandate).errors, []);

  const citesOwner = createGasQuarterlyFicha();
  fact(citesOwner, "campaign.obligation.totalVolumeKnown").value = 45;
  assert.ok(codesOf(citesOwner).includes("CONFIRMED_QUANTITY_MISMATCH"));
});

// Regresión de la validación adversarial: un espacio en el locator o citar
// sólo la frase de la tabla saltaba la comprobación.
test("un total atribuido a Bru con otro locator sigue gobernado por la tabla §4.1", () => {
  const sources = [
    { authority: "Bru (owner)", locator: "§4.1 tabla de cantidades confirmadas, 2026-09-22 " },
    { authority: "Owner", locator: "Confirmación de Bru, 2026-09-22" },
  ];
  for (const source of sources) {
    const ficha = createGasQuarterlyFicha();
    Object.assign(fact(ficha, "campaign.obligation.totalVolumeKnown"), { value: 999, source });
    assert.ok(codesOf(ficha).includes("CONFIRMED_QUANTITY_MISMATCH"), JSON.stringify(source));
  }
});

test("citar la confirmación de Bru para un producto/Mission sin cantidad confirmada se rechaza", () => {
  const ficha = createGasQuarterlyFicha();
  ficha.product = "Oil";
  assert.ok(codesOf(ficha).includes("CONFIRMED_QUANTITY_MISMATCH"));
});

test("la ficha declara la liquidación como faltante explícito (DEP-01)", () => {
  const settlement = fact(createGasQuarterlyFicha(), "campaign.obligation.settlement");
  assert.equal(settlement.availability, "UNAVAILABLE");
  assert.equal(settlement.value, null);
  assert.ok(settlement.reason.includes("DEP-01"));
});

test("la terminal rule no verificada no se afirma como inexistente", () => {
  // Regresión del review: el audit sólo establece que no se ha verificado
  // (AUDIT_INPUTS §5 "No encontrado en el alcance inspeccionado").
  const reason = fact(createGasQuarterlyFicha(), "campaign.feasibility.terminalCoverageRule").reason;
  assert.ok(!reason.includes("No existe"));
  assert.ok(reason.includes("No se ha verificado"));
  assert.ok(reason.includes("no se afirma ni se niega"));
  assert.ok(reason.includes("COVERAGE_INCOMPLETE"));
});

test("un restante publicado sin campaña identificada se rechaza y no cuenta como determinado", () => {
  // Hallazgo de la validación adversarial: un restante coherente de una
  // campaña no identificada pasaba como determinado.
  const ficha = createGasQuarterlyFicha();
  makeAvailable(ficha, "campaign.coverage.executedVolume", 0, "MW");
  makeAvailable(ficha, "campaign.coverage.remainingVolume", 60, "MW");
  ficha.acceptanceCriterion = evaluateImp02Acceptance(ficha);
  assert.equal(ficha.acceptanceCriterion.remainingVolume.determined, false);
  assert.ok(ficha.acceptanceCriterion.remainingVolume.blockedBy.includes("campaign.identity"));
  const outcome = validateCampaignContract(ficha);
  assert.equal(outcome.ok, false);
  assert.ok(outcome.errors.some((error) => error.code === "CAMPAIGN_NOT_IDENTIFIED" && error.factId === "campaign.coverage.remainingVolume"));
});

test("un deadline sin provenance no cuenta como determinado", () => {
  const ficha = createGasQuarterlyFicha();
  Object.assign(fact(ficha, "campaign.calendar.deadline"), { availability: "AVAILABLE_NOW", value: "2026-12-31", source: null, reason: null });
  assert.equal(resolveObligationDeadline(ficha).determined, false);
  assert.equal(evaluateImp02Acceptance(ficha).deadline.determined, false);
});

test("la ficha no afirma como hecho la ausencia de lo que el audit sólo no encontró", () => {
  const ficha = createGasQuarterlyFicha();
  const texts = [...ficha.facts.map((entry) => entry.reason ?? ""), ficha.coverageOwnership.reason];
  for (const text of texts) {
    assert.ok(!/No existe|No hay fills|No hay execution ledger|ninguna campaña real/.test(text), text);
  }
});

test("campaignIdentified del validador exige provenance en la identidad", () => {
  const ficha = createGasQuarterlyFicha();
  for (const factId of ["campaign.identity.campaignId", "campaign.identity.productContract", "campaign.identity.hubMarket"]) {
    makeAvailable(ficha, factId, "SYNTH");
  }
  makeAvailable(ficha, "campaign.identity.productFamily", "Gas");
  makeAvailable(ficha, "campaign.identity.mission", "Quarterly");
  fact(ficha, "campaign.identity.campaignId").source = null;
  ficha.acceptanceCriterion = evaluateImp02Acceptance(ficha);
  const outcome = validateCampaignContract(ficha);
  assert.equal(outcome.campaignIdentified, false);
  assert.equal(outcome.campaignIdentified, ficha.acceptanceCriterion.campaignIdentified);
});

test("un vínculo a campaña publicado sin campaña identificada se rechaza", () => {
  const ficha = createGasQuarterlyFicha();
  makeAvailable(ficha, "campaign.obligation.campaignLink", "SYNTH-1");
  assert.ok(codesOf(ficha).includes("CAMPAIGN_NOT_IDENTIFIED"));
});

// Regresión del review: producto y Mission coincidían, pero el campaignLink
// podía declarar la Campaign ID de otra campaña y superar la comprobación.
test("un campaignLink con otra Campaign ID se rechaza (§4.1: el vínculo declara la Campaign ID)", () => {
  const ficha = materializedFicha({ executed: 20, assignments: [{ fillId: "FILL-1", obligationId: "OBL-QUARTERLY", quantity: 20, unit: "MW" }] });
  fact(ficha, "campaign.obligation.campaignLink").value = "SYNTH-OTHER";
  const outcome = validateCampaignContract(ficha);
  assert.equal(outcome.ok, false);
  const incoherent = outcome.errors.filter((error) => error.code === "CAMPAIGN_LINK_INCOHERENT");
  assert.equal(incoherent.length, 1);
  assert.ok(incoherent[0].message.includes("SYNTH-OTHER"));
  assert.ok(incoherent[0].message.includes("SYNTH-1"));
  // La incoherencia rompe el contrato completo, así que el criterio derivado
  // sobre la ficha alterada ya no se cumple.
  assert.equal(evaluateImp02Acceptance(ficha).criterionMet, false);
});

test("un campaignLink igual al Campaign ID de la ficha pasa la coherencia", () => {
  const ficha = materializedFicha({ executed: 20, assignments: [{ fillId: "FILL-1", obligationId: "OBL-QUARTERLY", quantity: 20, unit: "MW" }] });
  fact(ficha, "campaign.obligation.campaignLink").value = "SYNTH-1";
  assert.ok(!codesOf(ficha).includes("CAMPAIGN_LINK_INCOHERENT"));
});

test("la coherencia campaignLink–Campaign ID no exige Campaign ID si el vínculo no lo declara", () => {
  // Con sólo una de las dos facts publicadas no hay dos verdades que comparar;
  // el caso ya lo cubre CAMPAIGN_NOT_IDENTIFIED y no debe falsear aquí.
  const onlyLink = createGasQuarterlyFicha();
  makeAvailable(onlyLink, "campaign.obligation.campaignLink", "SYNTH-1");
  makeAvailable(onlyLink, "campaign.identity.productFamily", "Gas");
  makeAvailable(onlyLink, "campaign.identity.mission", "Quarterly");
  makeAvailable(onlyLink, "campaign.identity.productContract", "SYNTH-C");
  makeAvailable(onlyLink, "campaign.identity.hubMarket", "SYNTH-HUB");
  assert.ok(!codesOf(onlyLink).includes("CAMPAIGN_LINK_INCOHERENT"));
});

test("sin provenance en una de las dos facts no se declara la incoherencia del vínculo", () => {
  // availableFact exige provenance; la ficha ya queda rechazada por NO_PROVENANCE
  // y no se suma una segunda verdad derivada de facts sin fuente.
  const noSource = materializedFicha({ executed: 20, assignments: [{ fillId: "FILL-1", obligationId: "OBL-QUARTERLY", quantity: 20, unit: "MW" }] });
  fact(noSource, "campaign.obligation.campaignLink").value = "SYNTH-OTHER";
  fact(noSource, "campaign.obligation.campaignLink").source = null;
  const outcome = validateCampaignContract(noSource);
  assert.ok(outcome.errors.some((error) => error.code === "NO_PROVENANCE"));
  assert.ok(!outcome.errors.some((error) => error.code === "CAMPAIGN_LINK_INCOHERENT"));
});

const DOCUMENTED_AMENDMENT = {
  amendmentId: "AMD-1",
  obligationId: "OBL-QUARTERLY",
  cancelledVolume: 40,
  unit: "MW",
  authority: "Bru (owner)",
  locator: "enmienda firmada p.2",
};

// Fixture sintético: la ficha materializada cierra su residual (40 MW) con una
// enmienda documentada en campaign.obligation.amendments.
function fichaWithResidualAmendment({ documentedAmendments, residualAmendment }) {
  const ficha = materializedFicha({ executed: 20, assignments: [{ fillId: "FILL-1", obligationId: "OBL-QUARTERLY", quantity: 20, unit: "MW" }] });
  fact(ficha, "campaign.obligation.amendments").amendments = documentedAmendments;
  ficha.coverageOwnership.residualAmendment = residualAmendment;
  ficha.acceptanceCriterion = evaluateImp02Acceptance(ficha);
  return ficha;
}

// Regresión del review: reconcileCoverage declaraba RESIDUAL_CANCELLED con una
// enmienda de texto libre sin vincularla a la obligación ni a las enmiendas
// documentadas de la ficha.
test("una enmienda documentada de la obligación cierra el residual en la ficha (§4.3/§14.5)", () => {
  const ficha = fichaWithResidualAmendment({
    documentedAmendments: [DOCUMENTED_AMENDMENT],
    residualAmendment: DOCUMENTED_AMENDMENT,
  });
  assert.deepEqual(validateCampaignContract(ficha).errors, []);
});

test("una enmienda de otra obligación no cierra el residual de la ficha", () => {
  const ficha = fichaWithResidualAmendment({
    documentedAmendments: [DOCUMENTED_AMENDMENT],
    residualAmendment: { ...DOCUMENTED_AMENDMENT, obligationId: "OBL-MONTHLY" },
  });
  const outcome = validateCampaignContract(ficha);
  assert.equal(outcome.ok, false);
  assert.ok(outcome.errors.some((error) => error.code === "AMENDMENT_NOT_BOUND_TO_OBLIGATION" && error.factId === "coverageOwnership.residualAmendment"));
});

test("una enmienda ausente de campaign.obligation.amendments no cierra el residual de la ficha", () => {
  const ficha = fichaWithResidualAmendment({
    documentedAmendments: [],
    residualAmendment: DOCUMENTED_AMENDMENT,
  });
  const outcome = validateCampaignContract(ficha);
  assert.equal(outcome.ok, false);
  assert.ok(outcome.errors.some((error) => error.code === "AMENDMENT_NOT_DOCUMENTED" && error.factId === "coverageOwnership.residualAmendment"));
});

test("una enmienda documentada malformada se rechaza", () => {
  const ficha = fichaWithResidualAmendment({
    documentedAmendments: [{ amendmentId: "AMD-1" }],
    residualAmendment: DOCUMENTED_AMENDMENT,
  });
  assert.ok(codesOf(ficha).includes("INVALID_AMENDMENT"));
});

test("una fact de asignaciones con valor no estructurado se rechaza", () => {
  const ficha = materializedFicha({ executed: 20, assignments: [{ fillId: "FILL-1", obligationId: "OBL-QUARTERLY", quantity: 20, unit: "MW" }] });
  fact(ficha, "campaign.coverage.fillToObligationAssignment").value = "FILL-1 → OBL-QUARTERLY";
  const outcome = validateCampaignContract(ficha);
  assert.equal(outcome.ok, false);
  assert.ok(outcome.errors.some((error) => error.code === "VALUE_TYPE_MISMATCH" && error.factId === "campaign.coverage.fillToObligationAssignment"));
});

// ---------------------------------------------------------------------------
// Aclaración P-006 (23-sep-2026): mandato rolling de Gas Quarterly; cada
// maturity histórica es un episodio de VALIDACIÓN con identidad determinista.
// Pruebas negativas por cada invariante derivable de la decisión del owner.

test("la identidad de campaña de research es determinista por producto/Mission/maturity", () => {
  assert.equal(researchCampaignIdFor("Gas", "Quarterly", "2021Q1"), "GAS-Q-2021Q1");
  assert.equal(researchCampaignIdFor("Gas", "Quarterly", "2026Q4"), "GAS-Q-2026Q4");
  // Mismo maturity → misma identidad; distinto maturity → campañas distintas.
  assert.equal(researchCampaignIdFor("Gas", "Quarterly", "2021Q1"), researchCampaignIdFor("Gas", "Quarterly", "2021Q1"));
  assert.notEqual(researchCampaignIdFor("Gas", "Quarterly", "2021Q1"), researchCampaignIdFor("Gas", "Quarterly", "2021Q2"));
  assert.equal(researchCampaignIdFor("Gas", "Monthly", "2020-12"), "GAS-M-2020-12");
});

test("una maturity fuera de la forma YYYYQn no produce identidad", () => {
  for (const bad of ["2021Q5", "2021Q0", "21Q1", "2021-Q1", "2021q3", " 2021Q1", "2021Q1 ", "Q1 2021", "", null, undefined, "2021-03"]) {
    assert.equal(researchCampaignIdFor("Gas", "Quarterly", bad), null, String(bad));
  }
  for (const bad of ["2021Q1", "2020-00", "2020/12", "2021/13"]) {
    assert.equal(researchCampaignIdFor("Gas", "Monthly", bad), null, String(bad));
  }
});

test("la obligación del episodio deriva de la identidad de campaña", () => {
  assert.equal(episodeObligationIdFor("GAS-Q-2021Q1"), "OBL-GAS-Q-2021Q1");
  assert.equal(episodeObligationIdFor(""), null);
  assert.equal(episodeObligationIdFor(null), null);
});

test("la ficha de episodio de validación materializa el criterio sin datos inventados", () => {
  const ficha = createGasQuarterlyValidationFicha("2021Q1");
  const outcome = validateCampaignContract(ficha);
  assert.equal(outcome.ok, true);
  for (const error of outcome.errors) {
    assert.fail(`${error.code}: ${error.message}`);
  }
  assert.equal(outcome.campaignIdentified, true);
  // Apertura 0 MW → ejecutado 0, restante 60: conservación §4.3.
  assert.equal(fact(ficha, "campaign.coverage.executedVolume").value, 0);
  assert.equal(fact(ficha, "campaign.coverage.remainingVolume").value, 60);
  assert.equal(fact(ficha, "campaign.obligation.totalVolumeKnown").value, 60);
  // Los DEP-01–04 del episodio quedan auditadas con el paquete verificado y
  // la aclaración del owner; pero la fecha real del deadline no está
  // instanciada (§13.4): el criterio no se declara cumplido hasta tenerla.
  assert.equal(fact(ficha, "campaign.calendar.deadline").availability, "AVAILABLE_NOW");
  assert.equal(ficha.acceptanceCriterion.deadline.determined, false);
  assert.ok(ficha.acceptanceCriterion.deadline.reason.startsWith("No determinable"), ficha.acceptanceCriterion.deadline.reason);
  assert.equal(ficha.acceptanceCriterion.criterionMet, false);
  // La ausencia de enmiendas está documentada (§7 Mandate changes), no leída
  // como regla.
  assert.deepEqual(ficha.acceptanceCriterion.auditedContract.documentedAbsences, ["campaign.obligation.amendments"]);
});

test("la ficha de episodio es idéntica para la misma maturity (determinista)", () => {
  assert.deepEqual(createGasQuarterlyValidationFicha("2023Q2"), createGasQuarterlyValidationFicha("2023Q2"));
  assert.notDeepEqual(createGasQuarterlyValidationFicha("2023Q1"), createGasQuarterlyValidationFicha("2023Q2"));
});

test("una maturity no canónica impide construir la ficha de episodio", () => {
  for (const bad of ["2021Q5", "Q1 2021", "", null]) {
    assert.throws(() => createGasQuarterlyValidationFicha(bad), TypeError, String(bad));
  }
});

test("una ficha de episodio editada a mano no renombra la campaña (§25.1/P-006 punto 6)", () => {
  // Regresión del review 193314: con id + vínculo coherentes entre sí pero no
  // canónicos, la ficha validaba ok:true con criterionMet derivado.
  const edited = createGasQuarterlyValidationFicha("2021Q1");
  for (const factId of ["campaign.identity.campaignId", "campaign.obligation.campaignLink"]) {
    fact(edited, factId).value = "MY-CAMPAIGN-EDITED";
  }
  edited.acceptanceCriterion = evaluateImp02Acceptance(edited);
  const outcome = validateCampaignContract(edited);
  assert.equal(outcome.ok, false);
  assert.ok(outcome.errors.some((error) => error.code === "CAMPAIGN_ID_NOT_CANONICAL" && error.factId === "campaign.identity.campaignId"));
  assert.equal(edited.acceptanceCriterion.criterionMet, false);
});

test("una maturity fuera del horizonte histórico no pasa como episodio de validación", () => {
  // El horizonte documentado empieza en Q1 2021 (campaign_rules.csv).
  assert.throws(() => createGasQuarterlyValidationFicha("2020Q4"), TypeError);
  const handMade = createGasQuarterlyValidationFicha("2021Q1");
  handMade.episode.maturity = "2020Q4";
  handMade.acceptanceCriterion = evaluateImp02Acceptance(handMade);
  const outcome = validateCampaignContract(handMade);
  assert.equal(outcome.ok, false);
  assert.ok(outcome.errors.some((error) => error.code === "EPISODE_IDENTITY_NOT_DETERMINISTIC" || error.code === "EPISODE_MATURITY_OUTSIDE_HORIZON" || error.code === "CAMPAIGN_ID_NOT_CANONICAL"));
});

test("el mapa del episodio no atribuye volumen a una obligación ajena a la identidad", () => {
  const handMade = createGasQuarterlyValidationFicha("2021Q1");
  handMade.coverageOwnership.obligationId = "OBL-OTHER";
  handMade.acceptanceCriterion = evaluateImp02Acceptance(handMade);
  const outcome = validateCampaignContract(handMade);
  assert.equal(outcome.ok, false);
  assert.ok(outcome.errors.some((error) => error.code === "OBLIGATION_ID_NOT_CANONICAL"));
});

test("la secuencia de episodios se evalúa cronológica y completamente", () => {
  // Secuencia válida.
  assert.deepEqual(validateQuarterlyEpisodeSequence(["2021Q1", "2021Q2", "2021Q3"]), []);
  // Fuera de orden o repetida: el invariante cronológico se rechaza.
  const disordered = validateQuarterlyEpisodeSequence(["2021Q2", "2021Q1"]);
  assert.ok(disordered.some((error) => error.code === "EPISODES_NOT_CHRONOLOGICAL"));
  const duplicated = validateQuarterlyEpisodeSequence(["2021Q1", "2021Q1"]);
  assert.ok(duplicated.some((error) => error.code === "DUPLICATE_EPISODE"));
  const invalid = validateQuarterlyEpisodeSequence(["2021Q1", "2021Q5"]);
  assert.ok(invalid.some((error) => error.code === "INVALID_EPISODE_MATURITY"));
  // Con continuidad exigida, seleccionar episodios salteando quarters se
  // rechaza: no se eligen sólo períodos favorecidos (P-006 punto 4).
  const gaps = validateQuarterlyEpisodeSequence(["2021Q1", "2021Q4"], { requireContiguity: true });
  assert.ok(gaps.some((error) => error.code === "EPISODE_SEQUENCE_GAP"));
  assert.deepEqual(validateQuarterlyEpisodeSequence(["2021Q1", "2021Q4"]), []);
});

test("los guards del mandato rolling rechazan coverage compartido y evaluación selectiva", () => {
  const shared = createGasQuarterlyValidationFicha("2021Q1");
  shared.guards.missionsShareCoverage = true;
  const sharedOutcome = validateCampaignContract(shared);
  assert.equal(sharedOutcome.ok, false);
  assert.ok(sharedOutcome.errors.some((error) => error.code === "MISSIONS_SHARE_COVERAGE"));

  const selective = createGasQuarterlyValidationFicha("2021Q1");
  selective.guards.selectiveEpisodeEvaluation = true;
  const selectiveOutcome = validateCampaignContract(selective);
  assert.equal(selectiveOutcome.ok, false);
  assert.ok(selectiveOutcome.errors.some((error) => error.code === "SELECTIVE_EPISODE_EVALUATION"));
});

test("los valores publicados de la ficha de episodio no exceden su provenance", () => {
  // Regresión del patrón del hallazgo HUBMARKET-007: los valores documentados
  // replican la cita; la identidad del episodio es la instancia determinista
  // que el owner sanciona (P-006 punto 6).
  const ficha = createGasQuarterlyValidationFicha("2021Q1");
  assert.equal(factOf(ficha, "campaign.identity.campaignId").value, "GAS-Q-2021Q1");
  assert.equal(factOf(ficha, "campaign.obligation.campaignLink").value, "GAS-Q-2021Q1");
  assert.equal(
    factOf(ficha, "campaign.identity.campaignId").source.quote,
    "La identidad de una campaña de research puede ser determinista por producto + período/maturity (por ejemplo GAS-Q-YYYYQn)",
  );
  for (const definition of CAMPAIGN_CONTRACT_FACTS) {
    if (definition.kind !== "text") {
      continue;
    }
    if (definition.factId === "campaign.identity.campaignId" || definition.factId === "campaign.obligation.campaignLink") {
      continue;
    }
    const fact = factOf(ficha, definition.factId);
    assert.equal(fact.availability, "AVAILABLE_NOW", definition.factId);
    // El valor documentado replica la cita del paquete verificado; para la
    // familia, Mission y unidad el valor es el token confirmado por su fuente
    // (la tabla §4.1/la fila del paquete), no una réplica de la cita.
    if (["campaign.identity.productFamily", "campaign.identity.mission", "campaign.obligation.unit"].includes(definition.factId)) {
      assert.ok(
        fact.value === fact.source.quote || fact.source.quote.includes(fact.value),
        definition.factId,
      );
      continue;
    }
    assert.equal(fact.value, fact.source.quote, definition.factId);
  }
  // La fecha del deadline no está instanciada en el paquete (§13.4): el
  // texto-regla se publica como regla, no como deadline determinado.
  const deadline = resolveObligationDeadline(ficha);
  assert.equal(deadline.determined, false);
  assert.equal(deadline.deadline, null);
  assert.equal(deadline.ruleText, factOf(ficha, "campaign.calendar.deadline").value);
});

test("Monthly y Quarterly no comparten coverage a nivel de mapa (§4.3/P-006 punto 5)", () => {
  const relation = { availability: "AVAILABLE_NOW", relationType: "ADDITIONAL", value: "mandatos separados sin coverage compartido", authority: "Bru (owner); aclaración P-006", locator: "Decisión del owner 23-sep-2026 (punto 5)" };
  const outcome = mapCoverageOwnership({
    relationMonthlyQuarterly: relation,
    // Un mismo fill referenciado por una obligación Gas Quarterly y una Gas
    // Monthly: la cobertura no puede pertenecer a dos mandatos.
    obligations: [
      { obligationId: "OBL-GAS-Q-2021Q1", fills: ["FILL-1"] },
      { obligationId: "OBL-GAS-M-2021-01", fills: ["FILL-1"] },
    ],
    fills: [{ fillId: "FILL-1", quantity: 5, unit: "MW" }],
  });
  assert.equal(outcome.ok, false);
  assert.ok(outcome.errors.some((error) => error.code === "DUPLICATE_OWNERSHIP"));
});

test("dos episodios de Quarterly tampoco comparten un fill", () => {
  const relation = { availability: "AVAILABLE_NOW", relationType: "ADDITIONAL", value: "mandatos separados sin coverage compartido", authority: "Bru (owner); aclaración P-006", locator: "Decisión del owner 23-sep-2026 (punto 5)" };
  const outcome = mapCoverageOwnership({
    relationMonthlyQuarterly: relation,
    obligations: [
      { obligationId: "OBL-GAS-Q-2021Q1", fills: ["FILL-1"] },
      { obligationId: "OBL-GAS-Q-2021Q2", fills: ["FILL-1"] },
    ],
    fills: [{ fillId: "FILL-1", quantity: 5, unit: "MW" }],
  });
  assert.equal(outcome.ok, false);
  assert.ok(outcome.errors.some((error) => error.code === "DUPLICATE_OWNERSHIP"));
});

function factOf(ficha, factId) {
  return ficha.facts.find((entry) => entry.factId === factId);
}

test("el artefacto publicado del episodio 2021Q1 se valida y coincide con el builder", () => {
  const path = resolve(repoRoot, "operations/audit/IMP-02/v1_1_1/gas-quarterly-validation-episode-ficha-2021Q1.json");
  const artifact = JSON.parse(readFileSync(path, "utf8"));
  const outcome = validateCampaignContract(artifact);
  assert.equal(outcome.ok, true);
  assert.equal(outcome.campaignIdentified, true);
  assert.deepEqual(artifact, createGasQuarterlyValidationFicha("2021Q1"));
});
