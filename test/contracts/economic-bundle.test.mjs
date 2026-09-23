import { test } from "node:test";
import assert from "node:assert/strict";

import {
  REQUIRED_BUNDLE_INPUTS,
  validateEconomicBundle,
} from "../../src/contracts/economic-bundle.mjs";

function valueForKind(kind, field) {
  switch (kind) {
    case "list":
      return ["2026-01-02"];
    case "boolean":
      return true;
    case "number":
      return 1;
    case "version":
      return "1.0";
    case "manifest":
      return "synthetic-pit-manifest";
    case "obligation":
      return "synthetic-opening-obligation";
    default:
      return `synthetic-${field}`;
  }
}

function fieldsFor(input) {
  const fields = {};
  for (const field of input.requiredFields) {
    fields[field] = valueForKind(input.fieldKinds?.[field] ?? "text", field);
  }
  return fields;
}

function completeBundle() {
  const bundle = {};
  for (const input of REQUIRED_BUNDLE_INPUTS) {
    if (input.optional) {
      continue;
    }
    bundle[input.key] = {
      identity: `synthetic-${input.key}`,
      version: "1.0",
      availability: "AVAILABLE_NOW",
      fields: fieldsFor(input),
    };
  }
  return bundle;
}

test("un bundle completo con todo AVAILABLE_NOW es válido y no bloquea", () => {
  const outcome = validateEconomicBundle(completeBundle());
  assert.equal(outcome.ok, true);
  assert.equal(outcome.blocked, false);
  assert.deepEqual(outcome.errors, []);
});

test("un required input UNAVAILABLE con razón se preserva y bloquea el bundle", () => {
  const bundle = completeBundle();
  bundle.data.availability = "UNAVAILABLE";
  bundle.data.reason = "PIT manifest no auditado todavía";
  bundle.data.fields = {};
  const outcome = validateEconomicBundle(bundle);
  assert.equal(outcome.ok, true);
  assert.equal(outcome.blocked, true);
  assert.equal(outcome.unavailable[0].key, "data");
  assert.equal(outcome.unavailable[0].reason, "PIT manifest no auditado todavía");
  assert.ok(outcome.missing.some((entry) => entry.key === "data" && entry.reason === "PIT manifest no auditado todavía"));
});

test("UNAVAILABLE sin razón se rechaza en vez de inventar un default", () => {
  const bundle = completeBundle();
  bundle.benchmark.availability = "UNAVAILABLE";
  bundle.benchmark.fields = {};
  const outcome = validateEconomicBundle(bundle);
  assert.equal(outcome.ok, false);
  assert.ok(outcome.errors.some((error) => error.code === "MISSING_REASON"));
});

test("UNAVAILABLE con valor numérico se rechaza como default inventado", () => {
  const bundle = completeBundle();
  bundle.costs.availability = "UNAVAILABLE";
  bundle.costs.reason = "fees sin auditar";
  bundle.costs.value = 0;
  bundle.costs.fields = {};
  const outcome = validateEconomicBundle(bundle);
  assert.equal(outcome.ok, false);
  assert.ok(outcome.errors.some((error) => error.code === "INVENTED_DEFAULT" && error.field === "costs.value"));
});

test("declarar un default explícito se rechaza", () => {
  const bundle = completeBundle();
  bundle.sizing.default = 1;
  const outcome = validateEconomicBundle(bundle);
  assert.equal(outcome.ok, false);
  assert.ok(outcome.errors.some((error) => error.code === "INVENTED_DEFAULT" && error.field === "sizing.default"));
});

test("un required input ausente se rechaza", () => {
  const bundle = completeBundle();
  delete bundle.execution;
  const outcome = validateEconomicBundle(bundle);
  assert.equal(outcome.ok, false);
  assert.ok(outcome.errors.some((error) => error.code === "MISSING_REQUIRED_INPUT" && error.field === "execution"));
});

test("un required input sin versión se rechaza", () => {
  const bundle = completeBundle();
  delete bundle.campaign.version;
  const outcome = validateEconomicBundle(bundle);
  assert.equal(outcome.ok, false);
  assert.ok(outcome.errors.some((error) => error.code === "MISSING_VERSION" && error.field === "campaign.version"));
});

test("un campo obligatorio ausente en un input disponible se rechaza", () => {
  const bundle = completeBundle();
  delete bundle.openingContract.fields.deadline;
  const outcome = validateEconomicBundle(bundle);
  assert.equal(outcome.ok, false);
  assert.ok(outcome.errors.some((error) => error.code === "MISSING_REQUIRED_FIELD" && error.field === "openingContract.deadline"));
});

test("stochasticity es opcional: su ausencia no bloquea", () => {
  const bundle = completeBundle();
  assert.equal(Object.prototype.hasOwnProperty.call(bundle, "stochasticity"), false);
  assert.equal(validateEconomicBundle(bundle).ok, true);
});

test("un bundle ausente se rechaza", () => {
  const outcome = validateEconomicBundle(null);
  assert.equal(outcome.ok, false);
  assert.equal(outcome.blocked, true);
  assert.equal(outcome.errors[0].code, "MISSING_BUNDLE");
});

test("un campo obligatorio con objeto vacío no cuenta como valor conocido", () => {
  for (const [key, field] of [["openingContract", "openingObligation"], ["costs", "ledgerConfiguration"], ["execution", "contractVersion"]]) {
    const bundle = completeBundle();
    bundle[key].fields[field] = {};
    const outcome = validateEconomicBundle(bundle);
    assert.equal(outcome.ok, false, `${key}.${field}`);
    assert.ok(outcome.errors.some((error) => error.code === "MISSING_REQUIRED_FIELD" && error.field === `${key}.${field}`), `${key}.${field}`);
  }
});

test("un campo obligatorio con UNAVAILABLE y razón bloquea y preserva la razón", () => {
  const bundle = completeBundle();
  bundle.openingContract.fields.openingObligation = { availability: "UNAVAILABLE", reason: "synthetic obligation missing" };
  const outcome = validateEconomicBundle(bundle);
  assert.equal(outcome.ok, true);
  assert.equal(outcome.blocked, true);
  assert.ok(outcome.unavailable.some((entry) => entry.field === "openingObligation" && entry.reason === "synthetic obligation missing"));
  assert.ok(outcome.missing.some((entry) => entry.field === "openingObligation" && entry.reason === "synthetic obligation missing"));
});

test("un campo obligatorio con UNAVAILABLE sin razón se rechaza", () => {
  const bundle = completeBundle();
  bundle.openingContract.fields.openingObligation = { availability: "UNAVAILABLE" };
  const outcome = validateEconomicBundle(bundle);
  assert.equal(outcome.ok, false);
  assert.ok(outcome.errors.some((error) => error.code === "MISSING_REASON" && error.field === "openingContract.openingObligation"));
});

test("un campo obligatorio que sólo declara availability no es contenido conocido", () => {
  const bundle = completeBundle();
  bundle.costs.fields.ledgerConfiguration = { availability: "AVAILABLE_NOW" };
  const outcome = validateEconomicBundle(bundle);
  assert.equal(outcome.ok, false);
  assert.ok(outcome.errors.some((error) => error.code === "MISSING_REQUIRED_FIELD" && error.field === "costs.ledgerConfiguration"));
});

test("las referencias de versión obligatorias usan las reglas de versión/content-hash", () => {
  const versionFields = [];
  for (const input of REQUIRED_BUNDLE_INPUTS) {
    for (const field of input.requiredFields) {
      if (input.fieldKinds?.[field] === "version") {
        versionFields.push([input.key, field]);
      }
    }
  }
  assert.ok(versionFields.length >= 3);
  for (const [key, field] of versionFields) {
    for (const bad of ["", "latest", { contentHash: "not-a-sha256" }, { contentHash: null }]) {
      const bundle = completeBundle();
      bundle[key].fields[field] = bad;
      assert.equal(validateEconomicBundle(bundle).ok, false, `${key}.${field}=${JSON.stringify(bad)}`);
    }
    const good = completeBundle();
    good[key].fields[field] = { contentHash: "a".repeat(64) };
    assert.equal(validateEconomicBundle(good).ok, true, `${key}.${field} content-hash`);
  }
});

test("la obligación de apertura exige valor numérico finito y unidad", () => {
  for (const bad of [{ value: null, unit: "MWh" }, { value: 100 }, { unit: "MWh" }, { value: "100", unit: "MWh" }]) {
    const bundle = completeBundle();
    bundle.openingContract.fields.openingObligation = bad;
    assert.equal(validateEconomicBundle(bundle).ok, false, JSON.stringify(bad));
  }
  const good = completeBundle();
  good.openingContract.fields.openingObligation = { value: 100, unit: "MWh" };
  assert.equal(validateEconomicBundle(good).ok, true);
});

test("gasQuarterly debe ser booleano y no un texto arbitrario", () => {
  const bundle = completeBundle();
  bundle.campaign.fields.gasQuarterly = "yes";
  const outcome = validateEconomicBundle(bundle);
  assert.equal(outcome.ok, false);
  assert.ok(outcome.errors.some((error) => error.code === "INVALID_REQUIRED_FIELD" && error.field === "campaign.gasQuarterly"));
});

test("el PIT manifest exige id y versión válida", () => {
  for (const bad of [{ version: "1.0" }, { id: "synthetic-pit" }, { id: "synthetic-pit", version: "not-a-version" }]) {
    const bundle = completeBundle();
    bundle.data.fields.pitManifest = bad;
    assert.equal(validateEconomicBundle(bundle).ok, false, JSON.stringify(bad));
  }
  const good = completeBundle();
  good.data.fields.pitManifest = { id: "synthetic-pit", version: { contentHash: "b".repeat(64) } };
  assert.equal(validateEconomicBundle(good).ok, true);
});

test("el seed estocástico, cuando existe, debe ser numérico", () => {
  const bad = completeBundle();
  bad.stochasticity = { version: "1.0", availability: "AVAILABLE_NOW", fields: { seed: "abc" } };
  assert.equal(validateEconomicBundle(bad).ok, false);

  const good = completeBundle();
  good.stochasticity = { version: "1.0", availability: "AVAILABLE_NOW", fields: { seed: 7 } };
  assert.equal(validateEconomicBundle(good).ok, true);
});