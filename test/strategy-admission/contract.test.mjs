import { test } from "node:test";
import assert from "node:assert/strict";

import {
  RESERVED_STRATEGY_IDS,
  STRATEGY_CONTRACT_FIELDS,
  missingContractContent,
  validateStrategyCandidate,
  validateStrategyRegistration,
} from "../../src/strategy-admission/contract.mjs";
import { CHANNEL } from "../../src/strategy-admission/channels.mjs";
import {
  makeCandidate,
  makeChannel1Candidate,
  makeChannel2Candidate,
  makeChannel3Candidate,
} from "./fixtures.mjs";

test("el contrato enumera todas las filas semánticas de §8.7.2", () => {
  assert.equal(STRATEGY_CONTRACT_FIELDS.length, 24);
  const keys = STRATEGY_CONTRACT_FIELDS.map((field) => field.key);
  for (const required of [
    "strategyId",
    "canonicalName",
    "intakeChannel",
    "provenance",
    "role",
    "exactQuestion",
    "rationale",
    "validationProposition",
    "observableInputs",
    "pointInTimeRequirements",
    "dataDependencies",
    "evidenceOutput",
    "uncertaintySemantics",
    "parameters",
    "calibrationBoundaries",
    "refutationCriteria",
    "relationshipToExisting",
    "redundancyAssessment",
    "comparatorBaseline",
    "ablationDesign",
    "economicEvaluationContract",
    "implementationScope",
    "version",
    "admissionStatus",
  ]) {
    assert.ok(keys.includes(required), required);
  }
});

test("un candidato completo es válido en los tres canales", () => {
  for (const candidate of [makeChannel1Candidate(), makeChannel2Candidate(), makeChannel3Candidate()]) {
    assert.equal(validateStrategyCandidate(candidate).ok, true, candidate.strategyId);
  }
});

test("la ausencia de cualquier contenido obligatorio se rechaza", () => {
  for (const field of STRATEGY_CONTRACT_FIELDS) {
    const candidate = makeCandidate();
    delete candidate[field.key];
    const outcome = validateStrategyCandidate(candidate);
    assert.equal(outcome.ok, false, field.key);
    assert.ok(
      outcome.errors.some((error) => error.field === field.key),
      `${field.key}: ${JSON.stringify(outcome.errors)}`,
    );
  }
});

test("las listas obligatorias vacías cuentan como contenido faltante", () => {
  const candidate = makeCandidate({ observableInputs: [] });
  const outcome = validateStrategyCandidate(candidate);
  assert.equal(outcome.ok, false);
  assert.ok(outcome.errors.some((error) => error.field === "observableInputs"));

  const parameters = makeCandidate({ parameters: [] });
  assert.equal(validateStrategyCandidate(parameters).ok, true, "parameters puede ser explícitamente vacío");
});

test("se rechaza la colisión de identidad con S1–S5", () => {
  for (const reserved of RESERVED_STRATEGY_IDS) {
    const candidate = makeCandidate({ strategyId: reserved });
    const outcome = validateStrategyCandidate(candidate);
    assert.equal(outcome.ok, false, reserved);
    assert.ok(outcome.errors.some((error) => error.code === "IDENTITY_COLLISION"));
  }
});

test("se rechaza una versión ausente o malformada", () => {
  const missing = makeCandidate();
  delete missing.version;
  assert.equal(validateStrategyRegistration(missing).ok, false);

  const malformed = makeCandidate({ version: "latest" });
  const outcome = validateStrategyCandidate(malformed);
  assert.equal(outcome.ok, false);
  assert.ok(outcome.errors.some((error) => error.field === "version"));
});

test("se rechaza provenance ausente y provenance de otro canal", () => {
  const noProvenance = makeCandidate();
  delete noProvenance.provenance;
  assert.equal(validateStrategyRegistration(noProvenance).ok, false);

  const wrongChannel = makeChannel3Candidate({ provenance: { sourceRef: "SYN-SOURCE" } });
  const outcome = validateStrategyCandidate(wrongChannel);
  assert.equal(outcome.ok, false);
  assert.ok(outcome.errors.some((error) => error.field === "provenance.discoveryOmitted"));
});

test("se rechaza un admissionStatus sin namespace o con namespace desconocido", () => {
  const bare = makeCandidate({ admissionStatus: "PROPOSED" });
  assert.equal(validateStrategyCandidate(bare).ok, false);

  const wrongNamespace = makeCandidate({
    admissionStatus: { namespace: "research_verdict", value: "PASS" },
  });
  const outcome = validateStrategyCandidate(wrongNamespace);
  assert.equal(outcome.ok, false);
  assert.ok(outcome.errors.some((error) => error.field === "admissionStatus"));
});

test("ablation design debe existir o declararse explícitamente no aplicable con razón", () => {
  const missing = makeCandidate();
  delete missing.ablationDesign;
  assert.equal(validateStrategyCandidate(missing).ok, false);

  const withoutRationale = makeCandidate({ ablationDesign: { applicable: false } });
  assert.equal(validateStrategyCandidate(withoutRationale).ok, false);

  const declaredNotApplicable = makeCandidate({
    ablationDesign: { applicable: false, rationale: "Synthetic single-layer candidate." },
  });
  assert.equal(validateStrategyCandidate(declaredNotApplicable).ok, true);
});

test("el canal 3 no puede omitir la validación", () => {
  const noProposition = makeChannel3Candidate();
  delete noProposition.validationProposition;
  const outcome = validateStrategyCandidate(noProposition);
  assert.equal(outcome.ok, false);
  assert.ok(outcome.errors.some((error) => error.field === "validationProposition"));
  assert.ok(missingContractContent(noProposition).includes("validationProposition"));
});

test("un candidato de canal desconocido se rechaza en el contrato", () => {
  const candidate = makeCandidate({ intakeChannel: "SYNTHETIC_CHANNEL" });
  const outcome = validateStrategyCandidate(candidate);
  assert.equal(outcome.ok, false);
  assert.ok(outcome.errors.some((error) => error.code === "UNKNOWN_CHANNEL"));
});

test("CHANNEL expone los tres identificadores canónicos", () => {
  assert.equal(CHANNEL.HYPOTHESIS_TO_CANDIDATE, "HYPOTHESIS_TO_CANDIDATE");
  assert.equal(CHANNEL.RESEARCH_DISCOVERY, "RESEARCH_DISCOVERY");
  assert.equal(CHANNEL.PREDEFINED_STRATEGY_BY_BRU, "PREDEFINED_STRATEGY_BY_BRU");
});
