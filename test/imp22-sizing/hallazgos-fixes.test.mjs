// Tests de cierre de los hallazgos del review IMP22-H1..H7. Cada test cita
// el hallazgo que reproduce y la sección de SPEC que el contrato encarna.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";

import { validateExperimentDesign, validateFreezeBeforeEvaluation } from "../../src/imp22-sizing/experiment-design.mjs";
import { createImp22DesignRegistry } from "../../src/imp22-sizing/registry.mjs";
import { DESIGN_IDS, getDesign } from "../../src/imp22-sizing/designs.mjs";
import { IMP22_SPEC_IDENTITY, validateIdentity } from "../../src/imp22-sizing/identity.mjs";
import { COVERAGE_IDENTITY, validateCoverageDeclarations, validateCoverageTrace, validateGuardCoverage } from "../../src/imp22-sizing/coverage.mjs";
import { candidateWithAudit, reservedStateFor, attributionArmsFor, frozenStateFor, deepCloneDesign } from "./fixtures.mjs";

test("H3 binding: el hash de SPEC de la identidad IMP-22 coincide con los bytes del doc canónico", () => {
  const docPath = "docs/canonical/v1_1_1/PROCUREMENT_RESEARCH_CANONICAL_ENGINEERING_SPEC_v1_1_1.md";
  const actualSha256 = createHash("sha256").update(readFileSync(docPath)).digest("hex");
  assert.equal(IMP22_SPEC_IDENTITY.sha256, actualSha256, "la identidad IMP-22 declara el doc canónico exacto");
  assert.equal(validateIdentity({ ...identityFixture(), parentImp: "IMP-20" }).ok, false);
});

test("H2: sin desconocidos visibles declarados o con su scope de referencia desligado, fail-closed", () => {
  const design = deepCloneDesign(getDesign(DESIGN_IDS.GAS_MONTHLY));
  design.honestUnknowns = [];
  const empty = validateExperimentDesign(design);
  assert.equal(empty.ok, false);
  assert.ok(empty.errors.some((error) => error.code === "UNKNOWN_NOT_VISIBLE"));

  design.honestUnknownReferenceScope = [];
  const unlinked = validateExperimentDesign(design);
  assert.ok(unlinked.errors.some((error) => error.code === "REFERENCE_SCOPE_REQUIRED"));
});

test("H4: el bloque mission del diseño es vivo: declaraciones false se rechazan", () => {
  const design = deepCloneDesign(getDesign(DESIGN_IDS.GAS_MONTHLY));
  design.mission.ownBenchmarkBDeclaration = false;
  design.mission.separateEvaluationDeclaration = false;
  const result = validateExperimentDesign(design);
  assert.equal(result.ok, false);
  const codes = result.errors.filter((error) => error.code === "MISSION_DECLARATION_REQUIRED");
  assert.equal(codes.length, 2);

  design.mission.missionId = "POWER-MONTHLY";
  const mismatch = validateExperimentDesign(design);
  assert.ok(mismatch.errors.some((error) => error.code === "MISSION_MISMATCH"));
});

test("H5: el registro detecta colisión de sizingCandidateId entre experimentos", () => {
  const registry = createImp22DesignRegistry();
  assert.equal(registry.register(getDesign(DESIGN_IDS.GAS_MONTHLY)).ok, true);
  assert.equal(registry.register(getDesign(DESIGN_IDS.POWER_MONTHLY)).ok, true);

  // El candidato Gas clonado en un experimento nuevo de Mission distinta:
  // misma identidad de sizing en dos unidades separadas se rechaza.
  const third = deepCloneDesign(getDesign(DESIGN_IDS.GAS_MONTHLY));
  third.identity.experimentId = "IMP22-EX-SZ03-01";
  const clash = registry.register(third);
  assert.equal(clash.ok, false);
  assert.equal(clash.code, "SIZING_CANDIDATE_ID_COLLISION");
  assert.equal(registry.ownerOf("IMP22-SZ-01-01"), "IMP22-EX-SZ01-01");
  assert.equal(registry.get("IMP22-EX-SZ03-01"), null);
});

test("H7 declarations: el diseño declara identidad de cobertura y no-doble-conteo ex-ante", () => {
  for (const designId of Object.values(DESIGN_IDS)) {
    const design = getDesign(designId);
    assert.deepEqual(validateCoverageDeclarations(design.coverage), [], designId);
    assert.equal(design.coverage.identity, COVERAGE_IDENTITY);
  }
  assert.ok(validateCoverageDeclarations(null).some((error) => error.code === "COVERAGE_DECLARED_REQUIRED"));
});

test("H7 trace: Opening = Executed + Remaining se verifica, y el re-conteo se detecta (§4.3)", () => {
  const valid = validateCoverageTrace({
    obligationId: "OB-SYNTH-GAS-MONTHLY",
    openingVolume: 100,
    steps: [
      { executedVolume: 30, remainingVolume: 70, source: "opportunity-1" },
      { executedVolume: 30, remainingVolume: 40, source: "opportunity-2" },
      { executedVolume: 40, remainingVolume: 0, source: "opportunity-3" },
    ],
  });
  assert.equal(valid.ok, true, JSON.stringify(valid.errors));
  assert.equal(valid.finalRemaining, 0);

  const identityViolated = validateCoverageTrace({
    obligationId: "OB-X",
    openingVolume: 100,
    steps: [{ executedVolume: 30, remainingVolume: 60 }],
  });
  assert.ok(identityViolated.errors.some((error) => error.code === "COVERAGE_IDENTITY_VIOLATION"));

  const doubleCount = validateCoverageTrace({
    obligationId: "OB-X",
    openingVolume: 50,
    steps: [
      { executedVolume: 40, remainingVolume: 10 },
      { executedVolume: 20, remainingVolume: 0 },
    ],
  });
  assert.ok(doubleCount.errors.some((error) => error.code === "DOUBLE_COUNT_DETECTED" || error.code === "COVERAGE_IDENTITY_VIOLATION"));

  const ghostVolume = validateCoverageTrace({
    obligationId: "OB-X",
    openingVolume: 30,
    steps: [{ executedVolume: 10, remainingVolume: 40 }],
  });
  assert.ok(ghostVolume.errors.some((error) => error.code === "COVERAGE_IDENTITY_VIOLATION"));
});

test("H7 guard: las reglas de cobertura del guard se declaran y versionan cuando están auditadas", () => {
  assert.deepEqual(validateGuardCoverage({ lotSizeRuleVersion: "LOT-1", roundingRuleVersion: "ROUND-1", deadlineRuleVersion: "DL-1" }), []);

  const missingDeadline = validateGuardCoverage({ lotSizeRuleVersion: "LOT-1", roundingRuleVersion: "ROUND-1" });
  assert.ok(missingDeadline.some((error) => error.code === "GUARD_COVERAGE_UNDECLARED" && error.field === "coverage.guardContract.deadlineRuleVersion"));
});

test("H1/H2/H4/H7 cadena: el diseño completo pasa la validación y el gate de freeze tras arrumarlos", () => {
  const design = candidateWithAudit(frozenStateFor(reservedStateFor(deepCloneDesign(getDesign(DESIGN_IDS.GAS_MONTHLY)))));
  design.attribution.arms = attributionArmsFor(design, {}).attribution.arms;
  assert.equal(validateExperimentDesign(design).ok, true, JSON.stringify(validateExperimentDesign(design).errors));
  const freeze = validateFreezeBeforeEvaluation(design);
  assert.equal(freeze.ok, true, JSON.stringify(freeze.errors));
});

function identityFixture() {
  return {
    experimentId: "IMP22-EX-SZ09-01",
    missionId: "GAS-QUARTERLY",
    actionSpaceVersion: "BUY-WAIT-V1",
    createdAt: "2026-09-24T00:00:00.000Z",
    specId: IMP22_SPEC_IDENTITY.id,
    specVersion: IMP22_SPEC_IDENTITY.version,
    specSha256: IMP22_SPEC_IDENTITY.sha256,
    parentImp: "IMP-22",
    scope: "Sizing research",
    objectVersion: "1.0",
    protocolVersion: "1.0",
  };
}
