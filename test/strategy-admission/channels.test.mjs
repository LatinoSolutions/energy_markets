import { test } from "node:test";
import assert from "node:assert/strict";

import {
  CHANNEL,
  CHANNEL_IDS,
  INTAKE_CHANNELS,
  isChannelId,
  validateChannelProvenance,
} from "../../src/strategy-admission/channels.mjs";
import { createStrategyAdmissionRegistry } from "../../src/strategy-admission/registry.mjs";
import {
  makeChannel1Candidate,
  makeChannel2Candidate,
  makeChannel3Candidate,
} from "./fixtures.mjs";

test("existen exactamente los tres canales canónicos de §8.7.1", () => {
  assert.equal(CHANNEL_IDS.length, 3);
  assert.deepEqual([...CHANNEL_IDS].sort(), [
    CHANNEL.HYPOTHESIS_TO_CANDIDATE,
    CHANNEL.PREDEFINED_STRATEGY_BY_BRU,
    CHANNEL.RESEARCH_DISCOVERY,
  ]);
  assert.equal(isChannelId(CHANNEL.RESEARCH_DISCOVERY), true);
  assert.equal(isChannelId("SYNTHETIC_CHANNEL"), false);
});

test("el canal 3 puede omitir discovery pero debe declararlo explícitamente", () => {
  assert.equal(INTAKE_CHANNELS[CHANNEL.PREDEFINED_STRATEGY_BY_BRU].discoveryRequired, false);

  const declared = validateChannelProvenance(CHANNEL.PREDEFINED_STRATEGY_BY_BRU, {
    sourceRef: "SYN-SOURCE",
    discoveryOmitted: true,
  });
  assert.equal(declared.ok, true);

  const undeclared = validateChannelProvenance(CHANNEL.PREDEFINED_STRATEGY_BY_BRU, {
    sourceRef: "SYN-SOURCE",
  });
  assert.equal(undeclared.ok, false);
  assert.ok(undeclared.errors.some((error) => error.field === "provenance.discoveryOmitted"));
});

test("los canales 1 y 2 no pueden omitir discovery", () => {
  const outcome = validateChannelProvenance(CHANNEL.HYPOTHESIS_TO_CANDIDATE, {
    hypothesisRef: "SYN-HYP",
    experimentRef: "SYN-EXP",
    outcomeRef: "SYN-OUT",
    discoveryOmitted: true,
  });
  assert.equal(outcome.ok, false);
  assert.ok(outcome.errors.some((error) => error.code === "DISCOVERY_REQUIRED"));
});

test("cada canal exige su provenance específica", () => {
  const missingChannel1 = validateChannelProvenance(CHANNEL.HYPOTHESIS_TO_CANDIDATE, {});
  assert.equal(missingChannel1.ok, false);
  assert.ok(missingChannel1.errors.some((error) => error.field === "provenance.hypothesisRef"));

  const missingChannel2 = validateChannelProvenance(CHANNEL.RESEARCH_DISCOVERY, {
    hypothesisRef: "SYN-HYP",
  });
  assert.equal(missingChannel2.ok, false);
  assert.ok(missingChannel2.errors.some((error) => error.field === "provenance.discoveryRef"));
  assert.ok(missingChannel2.errors.some((error) => error.field === "provenance.researchQuestionRef"));
});

test("un canal desconocido y un provenance ausente se rechazan", () => {
  const unknown = validateChannelProvenance("SYNTHETIC_CHANNEL", { sourceRef: "x" });
  assert.equal(unknown.ok, false);
  assert.equal(unknown.errors[0].code, "UNKNOWN_CHANNEL");

  const absent = validateChannelProvenance(CHANNEL.PREDEFINED_STRATEGY_BY_BRU, null);
  assert.equal(absent.ok, false);
  assert.equal(absent.errors[0].code, "MISSING_PROVENANCE");
});

test("los tres canales convergen en el mismo registro y contrato", () => {
  const registry = createStrategyAdmissionRegistry();
  const candidates = [makeChannel1Candidate(), makeChannel2Candidate(), makeChannel3Candidate()];

  for (const candidate of candidates) {
    const outcome = registry.register(candidate);
    assert.equal(outcome.ok, true, candidate.strategyId);
    assert.equal(outcome.record.channel, candidate.intakeChannel);
  }

  assert.equal(registry.list().length, 3);
  for (const candidate of candidates) {
    const record = registry.get(candidate.strategyId);
    assert.equal(record.lifecycle.value, "PROPOSED");
    assert.equal(record.admission.value, "NOT_ADMITTED");
  }
});
