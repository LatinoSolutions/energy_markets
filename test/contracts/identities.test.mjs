import { test } from "node:test";
import assert from "node:assert/strict";

import {
  isVersionString,
  isVersionLike,
  validateSpecIdentity,
  validateWorkPacket,
  validateStReceipt,
  validateImpReceipt,
  linkStReceiptToPacket,
} from "../../src/contracts/identities.mjs";

const SPEC = {
  id: "PROCUREMENT_RESEARCH_CANONICAL_ENGINEERING_SPEC_v1_1.md",
  version: "1.1",
  sha256: "86c4bd4eeb5f9d0ebad94763128b221eb64525a2b7fff1007dab0af88b39cb6c",
};

function validPacket() {
  return {
    packetId: "WP-IMP-01-ST-1-v1.1",
    project: "96bbd5b1-94da-4781-8c2b-455fdfb28d1a",
    spec: { ...SPEC },
    parentImp: "IMP-01",
    subtaskId: "ST-01.1",
    objective: "Materializar contratos de identidad, versiones y namespaces.",
    allowedScope: "src/contracts/**, test/contracts/**",
    prohibitedScope: "canonical docs read-only; no commits",
    inputs: ["SPEC §§0-3,13-14"],
    sourceSections: "§§0-3,13-14; §20.2.7-.10; §25.1/25.2",
    dependenciesConsumed: "REQUIRES=current verified SPEC",
    frozenDecisions: "P1-P7, D1-D5, terminology",
    mustNotChange: "nombres canónicos, separación de estados y scopes",
    expectedOutputs: "schemas/validadores",
    subtaskAcceptance: "rechaza colisiones, versiones ausentes y campos desconocidos",
    parentAcceptanceContext: "IMP-01 gate",
    requiredTests: "/opt/node/bin/node --test test/contracts/*.test.mjs",
    requiredEvidence: "comandos, hashes, boundary cases",
    baselineVersion: "1.1",
    handoffFormat: "ST_RECEIPT §20.2.8",
  };
}

function validReceipt() {
  return {
    packetSubtaskParentIdentity: {
      packetId: "WP-IMP-01-ST-1-v1.1",
      subtaskId: "ST-01.1",
      parentImp: "IMP-01",
      project: "96bbd5b1-94da-4781-8c2b-455fdfb28d1a",
      specId: SPEC.id,
      specVersion: SPEC.version,
      specSha256: SPEC.sha256,
    },
    workerModelRoute: "Emergency Cheap Production Worker / DeepSeek V4.1 Flash",
    startingBaseline: "empty main, no commits",
    resultingVersion: { contentHash: "a".repeat(64) },
    inputsUsed: ["SPEC §§0-3,13-14"],
    artifactsChanged: ["src/contracts/namespaces.mjs"],
    result: "contratos materializados",
    testsRun: ["node --test test/contracts/*.test.mjs"],
    testResults: ["pass"],
    evidenceProduced: ["test output"],
    assumptions: [],
    deviations: [],
    dependencyFindings: [],
    failuresRetries: [],
    recommendedStatus: "in_review",
  };
}

test("isVersionString acepta 1.1 y rechaza vacío", () => {
  assert.equal(isVersionString("1.1"), true);
  assert.equal(isVersionString("v1.0.3"), true);
  assert.equal(isVersionString(""), false);
  assert.equal(isVersionString("latest"), false);
});

test("isVersionLike acepta content-hash", () => {
  assert.equal(isVersionLike({ contentHash: "b".repeat(64) }), true);
  assert.equal(isVersionLike({ contentHash: "xyz" }), false);
  assert.equal(isVersionLike(null), false);
});

test("validateSpecIdentity exige id, version y sha256", () => {
  assert.equal(validateSpecIdentity(SPEC).ok, true);
  const missingVersion = validateSpecIdentity({ id: SPEC.id, sha256: SPEC.sha256 });
  assert.equal(missingVersion.ok, false);
  assert.ok(missingVersion.errors.some((error) => error.field === "spec.version"));
  const badHash = validateSpecIdentity({ ...SPEC, sha256: "1234" });
  assert.equal(badHash.ok, false);
  assert.ok(badHash.errors.some((error) => error.field === "spec.sha256"));
});

test("validateWorkPacket acepta un packet completo", () => {
  assert.equal(validateWorkPacket(validPacket()).ok, true);
});

test("validateWorkPacket rechaza versiones ausentes y campos faltantes", () => {
  const packet = validPacket();
  delete packet.baselineVersion;
  delete packet.objective;
  const outcome = validateWorkPacket(packet);
  assert.equal(outcome.ok, false);
  assert.ok(outcome.errors.some((error) => error.field === "baselineVersion"));
  assert.ok(outcome.errors.some((error) => error.field === "objective"));
});

test("validateStReceipt acepta un receipt completo", () => {
  assert.equal(validateStReceipt(validReceipt()).ok, true);
});

test("baselineVersion y resultingVersion admiten content-hash de extremo a extremo", () => {
  const packet = validPacket();
  packet.baselineVersion = { contentHash: "d".repeat(64), algorithm: "sha256" };
  assert.equal(validateWorkPacket(packet).ok, true);

  const receipt = validReceipt();
  receipt.startingBaseline = { contentHash: "e".repeat(64) };
  receipt.resultingVersion = { contentHash: "f".repeat(64) };
  assert.equal(validateStReceipt(receipt).ok, true);
  assert.equal(linkStReceiptToPacket(packet, receipt).ok, true);
});

test("una versión content-hash malformada se rechaza en vez de aceptarse como texto", () => {
  const packet = validPacket();
  packet.baselineVersion = { contentHash: "no-es-sha256" };
  const outcome = validateWorkPacket(packet);
  assert.equal(outcome.ok, false);
  assert.ok(outcome.errors.some((error) => error.field === "baselineVersion"));
});

test("assumptions, deviations y failuresRetries vacíos son legítimos", () => {
  const receipt = validReceipt();
  receipt.assumptions = [];
  receipt.deviations = [];
  receipt.failuresRetries = [];
  assert.equal(validateStReceipt(receipt).ok, true);
});

test("validateStReceipt rechaza un receipt sin resultado de tests", () => {
  const receipt = validReceipt();
  delete receipt.testResults;
  const outcome = validateStReceipt(receipt);
  assert.equal(outcome.ok, false);
  assert.ok(outcome.errors.some((error) => error.field === "testResults"));
});

test("linkStReceiptToPacket acepta el linkage correcto", () => {
  assert.equal(linkStReceiptToPacket(validPacket(), validReceipt()).ok, true);
});

test("linkStReceiptToPacket rechaza subtask o hash que no coinciden", () => {
  const receipt = validReceipt();
  receipt.packetSubtaskParentIdentity.subtaskId = "ST-99.9";
  receipt.packetSubtaskParentIdentity.specSha256 = "c".repeat(64);
  const outcome = linkStReceiptToPacket(validPacket(), receipt);
  assert.equal(outcome.ok, false);
  assert.ok(outcome.errors.some((error) => error.field.endsWith("subtaskId")));
  assert.ok(outcome.errors.some((error) => error.field.endsWith("specSha256")));
});

test("validateStReceipt rechaza una identidad de packet/subtask/parent vacía", () => {
  const receipt = validReceipt();
  receipt.packetSubtaskParentIdentity = {};
  const outcome = validateStReceipt(receipt);
  assert.equal(outcome.ok, false);
  assert.ok(outcome.errors.some((error) => error.field === "packetSubtaskParentIdentity.packetId"));
});

test("validateStReceipt rechaza identidad sin proyecto, SPEC ID o versión", () => {
  for (const field of ["project", "specId", "specVersion", "specSha256"]) {
    const receipt = validReceipt();
    delete receipt.packetSubtaskParentIdentity[field];
    const outcome = validateStReceipt(receipt);
    assert.equal(outcome.ok, false, field);
    assert.ok(outcome.errors.some((error) => error.field === `packetSubtaskParentIdentity.${field}`), field);
  }
});

test("validateStReceipt rechaza specVersion y specSha256 malformados", () => {
  const badVersion = validReceipt();
  badVersion.packetSubtaskParentIdentity.specVersion = "latest";
  assert.equal(validateStReceipt(badVersion).ok, false);

  const badHash = validReceipt();
  badHash.packetSubtaskParentIdentity.specSha256 = "xyz";
  const outcome = validateStReceipt(badHash);
  assert.equal(outcome.ok, false);
  assert.ok(outcome.errors.some((error) => error.field === "packetSubtaskParentIdentity.specSha256"));
});

test("linkStReceiptToPacket rechaza proyecto y SPEC ID/versión en conflicto con hash válido", () => {
  for (const [key, wrong] of [["project", "synthetic-wrong-project"], ["specId", "synthetic-wrong-spec"], ["specVersion", "9.9"]]) {
    const receipt = validReceipt();
    receipt.packetSubtaskParentIdentity[key] = wrong;
    const outcome = linkStReceiptToPacket(validPacket(), receipt);
    assert.equal(outcome.ok, false, key);
    assert.ok(outcome.errors.some((error) => error.field === `packetSubtaskParentIdentity.${key}`), key);
  }
});

test("validateImpReceipt exige identidad de SPEC y límites no resueltos", () => {
  const receipt = {
    specIdentity: { ...SPEC },
    impIdentity: "IMP-01",
    scope: "identity/version/namespace contracts",
    version: "1.1",
    requiredStIdentities: ["ST-01.1"],
    reviewerRunIdentities: ["Independent Reviewer Opus", "Tech Lead Astra"],
    evidenceTestHashes: ["a".repeat(64)],
    prerequisiteChecks: ["IMP-01 REQUIRES satisfied"],
    outcome: "accepted_with_limits",
    unresolvedLimits: ["no broader IMP scope"],
  };
  assert.equal(validateImpReceipt(receipt).ok, true);
  const broken = { ...receipt, unresolvedLimits: undefined };
  assert.equal(validateImpReceipt(broken).ok, false);
});