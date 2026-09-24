// Tests de soporte/estado (IMP-19, DEP-20). Fuente: SPEC v1.1.1 §11.2 y
// §25.2.3 IMP-19 ("si el support es insuficiente... se registra el resultado;
// no se inventa suficiencia").

import test from "node:test";
import assert from "node:assert/strict";

import {
  SUPPORT_STATUS,
  evaluateActionSupport,
  evaluateCampaignSamples,
  evaluateMarkovAdequacy,
  evaluateSupportSufficiency,
} from "../../src/learning/index.mjs";
import { supportCorpus, syntheticExperienceRecord, markovStateDeclaration } from "./fixtures.mjs";

test("IMP-19 §11.2 · una acción sin soporte histórico limita la inferencia", () => {
  const onlyBuy = [syntheticExperienceRecord({ action: "BUY" })];
  const outcome = evaluateActionSupport({ records: onlyBuy });
  assert.equal(outcome.ok, true);
  assert.equal(outcome.status, SUPPORT_STATUS.INSUFFICIENT);
  assert.deepEqual(outcome.missingActions, ["WAIT"]);
});

test("IMP-19 §11.2 · corpus vacío queda UNDETERMINED, nunca SUFFICIENT", () => {
  const outcome = evaluateActionSupport({ records: [] });
  assert.equal(outcome.status, SUPPORT_STATUS.UNDETERMINED);
});

test("IMP-19 §11.2 · muchos decision points no equivalen a campañas independientes", () => {
  const manyPointsOneCampaign = [
    syntheticExperienceRecord({ campaignId: "GAS-Q-2024Q1", action: "BUY" }),
    syntheticExperienceRecord({ campaignId: "GAS-Q-2024Q1", action: "BUY" }),
    syntheticExperienceRecord({ campaignId: "GAS-Q-2024Q1", action: "WAIT" }),
  ];
  const outcome = evaluateCampaignSamples({ records: manyPointsOneCampaign, minimumCampaigns: 2 });
  assert.equal(outcome.decisionPoints, 3);
  assert.equal(outcome.distinctCampaigns, 1);
  assert.equal(outcome.status, SUPPORT_STATUS.INSUFFICIENT);
});

test("IMP-19 §11.2 · sin mínimo predeclarado la muestra de campañas es UNDETERMINED", () => {
  const outcome = evaluateCampaignSamples({ records: supportCorpus(), minimumCampaigns: null });
  assert.equal(outcome.status, SUPPORT_STATUS.UNDETERMINED);
});

test("IMP-19 §11.2 · no se asume Markov-like sin declaración", () => {
  const outcome = evaluateMarkovAdequacy({ records: supportCorpus(), stateDeclaration: null });
  assert.equal(outcome.status, SUPPORT_STATUS.UNDETERMINED);
});

test("IMP-19 §11.2 · memoria relevante se registra como insuficiente, no se aprueba", () => {
  const outcome = evaluateMarkovAdequacy({
    records: supportCorpus(),
    stateDeclaration: { stateEncoding: "x", memory: { kind: "MEMORY_REQUIRED" } },
  });
  assert.equal(outcome.status, SUPPORT_STATUS.INSUFFICIENT);
  assert.match(outcome.reason, /secuencia|belief-state/);
});

test("IMP-19 §11.2/§25.2.3 · suficiencia agregada sólo con las tres dimensiones", () => {
  const sufficient = evaluateSupportSufficiency({
    records: supportCorpus(),
    stateDeclaration: markovStateDeclaration(),
    minimumCampaigns: 2,
  });
  assert.equal(sufficient.ok, true);
  assert.equal(sufficient.status, SUPPORT_STATUS.SUFFICIENT);
  assert.equal(sufficient.sufficient, true);

  const insufficient = evaluateSupportSufficiency({
    records: supportCorpus(),
    stateDeclaration: null,
    minimumCampaigns: 2,
  });
  assert.equal(insufficient.sufficient, false);
  assert.notEqual(insufficient.status, SUPPORT_STATUS.SUFFICIENT);
  assert.match(insufficient.note, /no se inventa suficiencia/);
});