import { test } from "node:test";
import assert from "node:assert/strict";

import {
  ACCOUNTING_FIELDS,
  COMPARATOR_RULE,
  MARGINAL_VALUE_DECLARATION,
  REDUNDANCY_DECLARATION,
  validateAccountingParity,
} from "../../src/imp20-experiments/accounting.mjs";
import { EXPERIMENT_DESIGNS } from "../../src/imp20-experiments/designs.mjs";

test("cada diseño declara la contabilidad completa: B, controller/sizing, execution, evaluator, OOS y reward global (§8.6/§13.6/§10.1/§15)", () => {
  for (const design of EXPERIMENT_DESIGNS) {
    for (const field of ACCOUNTING_FIELDS) {
      const value = design.accountingIdentity?.[field.key];
      assert.ok(value !== undefined && value !== null, `${design.identity.experimentId} sin accounting ${field.key}`);
      assert.match(value, /UNKNOWN|IMP-16|GLOBAL|§|compartido|compartida|P5\.6|P6|OOS/, `${design.identity.experimentId}: ${field.key} sin referencia`);
    }
  }
});

test("los campos de contabilidad del catálogo citan su fuente normativa", () => {
  for (const field of ACCOUNTING_FIELDS) {
    assert.match(field.specCitation, /§/);
  }
});

test("una arm que declara contabilidad distinta rompe la comparación y se rechaza", () => {
  const design = EXPERIMENT_DESIGNS[0];
  const tamperedArms = structuredClone(design.arms).map((arm, index) =>
    index === 0 ? { ...arm, accounting: { benchmarkIdentity: "otros datos", controllerAndSizing: "otro", executionContract: "otro", evaluatorIdentity: "otro", oosFrontier: "otro", rewardIdentity: "otro" } } : arm
  );
  const result = validateAccountingParity(tamperedArms, design.accountingIdentity);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.code === "ACCOUNTING_PARITY_BROKEN"));
});

test("el comparador es la evidencia previa del núcleo IMP-16 consumida read-only (§25.2 REQUIRES_EVIDENCE)", () => {
  for (const design of EXPERIMENT_DESIGNS) {
    assert.equal(design.comparator.consumedReadOnly, true);
    assert.equal(design.comparator.complianceNote, COMPARATOR_RULE.specCitation);
    assert.match(design.comparator.coreEvidenceReference, /IMP-16/);
  }
  assert.match(COMPARATOR_RULE.complianceNote ?? COMPARATOR_RULE.specCitation, /§25\.2/);
});

test("marginal: Contribution_i con la misma contabilidad; redundancia ídem (§10.2/§25.1)", () => {
  assert.equal(MARGINAL_VALUE_DECLARATION.specCitation.includes("§10.2"), true);
  assert.match(MARGINAL_VALUE_DECLARATION.method, /Contribution_i|Delta V/);
  assert.equal(REDUNDANCY_DECLARATION.specCitation.includes("§25.1"), true);
});
