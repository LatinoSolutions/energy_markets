// Tests de atribución (IMP-17). Fuente: SPEC v1.1.1 §12.3 ("Una intervención
// humana no puede desaparecer del dataset de aprendizaje... el outcome
// efectivamente observado no se atribuye sin más a la Candidate Policy
// original"; "la recomendación y la ejecución permanecen separadas"; el éxito
// no acredita automáticamente a las Strategies). Fixtures sintéticos
// explícitos.

import test from "node:test";
import assert from "node:assert/strict";

import {
  buildExperienceRecord,
  attributeOutcome,
  recommendationVsExecution,
  strategyCreditClaim,
} from "../../src/experience/index.mjs";
import { syntheticReplayRecord } from "./fixtures.mjs";

test("IMP-17 · recomendación y ejecución permanecen separadas (§12.3)", () => {
  const record = buildExperienceRecord(syntheticReplayRecord()).record;
  const separated = recommendationVsExecution(record);
  assert.equal(separated.ok, true);
  assert.deepEqual(separated.recommended, { action: "BUY", policyVersion: "policy-v1" });
  assert.equal(separated.executed.action, "BUY");
  assert.equal(separated.executed.hasFills, true);
});

test("IMP-17 · outcome sin intervención y con ejecución coherente se atribuye a la policy (§12.3)", () => {
  const record = buildExperienceRecord(syntheticReplayRecord()).record;
  const attributed = attributeOutcome(record);
  assert.equal(attributed.ok, true, JSON.stringify(attributed.errors ?? ""));
  assert.equal(attributed.attribution.attributionCode, "POLICY_ATTRIBUTED");
  assert.equal(attributed.attribution.attributedToPolicyVersion, "policy-v1");
});

test("IMP-17 · intervención humana: el outcome NO se atribuye a la policy original (§12.3)", () => {
  const intervened = buildExperienceRecord(syntheticReplayRecord({
    humanIntervention: {
      kind: "MODIFICATION",
      timestampUtc: "2026-01-05T11:30:00Z",
      reason: "driver veto/retardo por ventana operativa (fixture sintético)",
      provenance: { authority: "test-fixture (sintético)", locator: "test/experience/fixtures.mjs" },
    },
  })).record;
  const attributed = attributeOutcome(intervened);
  assert.equal(attributed.ok, true);
  assert.equal(attributed.attribution.attributionCode, "HUMAN_INTERVENTION");
  // La atribución a la Candidate Policy original queda explícitamente vacía:
  // el outcome observado de una actuación modificada no se atribuye sin más
  // (§12.3 y "The result of a modified actuation is not silently attributed
  // to the original recommendation").
  assert.equal(attributed.attribution.attributedToPolicyVersion, null);
  // La intervención no desaparece del dataset: queda documentada completa.
  assert.equal(attributed.attribution.executed.intervention.kind, "MODIFICATION");
  assert.ok(attributed.attribution.executed.intervention.timestampUtc);
  assert.ok(attributed.attribution.executed.intervention.reason);
  assert.ok(attributed.attribution.executed.intervention.provenance);
});

test("IMP-17 · divergencia recomendación/ejecución sin intervención documentada: sin atribución (fail-closed)", () => {
  const divergent = buildExperienceRecord(syntheticReplayRecord({
    recommendedAction: "BUY",
    execution: { executedAction: "WAIT", fills: [] },
  })).record;
  const attributed = attributeOutcome(divergent);
  assert.equal(attributed.ok, true);
  assert.equal(attributed.attribution.attributionCode, "UNATTRIBUTED_DIVERGENCE");
  assert.equal(attributed.attribution.attributedToPolicyVersion, null);
});

test("IMP-17 · registro sin ejecución no inventa atribución de outcome", () => {
  const openNoExecution = buildExperienceRecord(syntheticReplayRecord({
    execution: null,
  })).record;
  const attributed = attributeOutcome(openNoExecution);
  assert.equal(attributed.ok, true);
  assert.equal(attributed.attribution.attributionCode, "NO_EXECUTION");
  assert.equal(attributed.attribution.attributedToPolicyVersion, null);
});

test("IMP-17 · BUY declarado con noFill: sin actuación efectiva, no se atribuye a la policy (§12.3)", () => {
  // HALLAZGO_TECNICO IMP17-PROJ-ATTRIB-01: un executedAction "BUY" declarado
  // junto a noFill:true y fills vacíos NO es una actuación efectiva (§4.2:
  // una solicitud no equivale a cobertura). Fail-closed.
  const noFillBuy = buildExperienceRecord(syntheticReplayRecord({
    execution: { executedAction: "BUY", noFill: true, fills: [] },
  })).record;
  const attributed = attributeOutcome(noFillBuy);
  assert.equal(attributed.ok, true);
  assert.equal(attributed.attribution.attributionCode, "NO_EXECUTION");
  assert.equal(attributed.attribution.attributedToPolicyVersion, null);
});

test("IMP-17 · BUY declarado sin fills y sin noFill: contrato fail-closed NO_EXECUTION", () => {
  const buyEmptyFills = buildExperienceRecord(syntheticReplayRecord({
    execution: { executedAction: "BUY", fills: [] },
  })).record;
  const attributed = attributeOutcome(buyEmptyFills);
  assert.equal(attributed.ok, true);
  assert.equal(attributed.attribution.attributionCode, "NO_EXECUTION");
  assert.equal(attributed.attribution.attributedToPolicyVersion, null);
});

test("IMP-17 · frontera sin recomendación: ejecución con fill no se atribuye a la policy (IMP17-ATTRIB-NOREC-01)", () => {
  // HALLAZGO_TECNICO IMP17-ATTRIB-NOREC-01: recommendedAction null (razón
  // documentada en noRecommendationReason, §12.2) + execution con fill →
  // fail-closed: la policy nunca recomendó; el outcome observado no se le
  // atribuye (§12.3). Nunca POLICY_ATTRIBUTED.
  const noRecommendation = buildExperienceRecord(syntheticReplayRecord({
    recommendedAction: null,
    noRecommendationReason: "DATA_BLOCKED",
  })).record;
  const attributed = attributeOutcome(noRecommendation);
  assert.equal(attributed.ok, true);
  assert.equal(attributed.attribution.attributionCode, "NO_RECOMMENDATION");
  assert.equal(attributed.attribution.attributedToPolicyVersion, null);
  assert.equal(attributed.attribution.recommendation.noRecommendationReason, "DATA_BLOCKED");
  assert.equal(attributed.attribution.executed.action, "BUY");
});

test("IMP-17 · intervención incompleta no desaparece ni se registra sin trazabilidad", () => {
  const partial = buildExperienceRecord(syntheticReplayRecord({
    humanIntervention: {
      kind: "VETO",
      timestampUtc: "2026-01-05T11:30:00Z",
      reason: null, // falta razón
      provenance: { authority: "test" },
    },
  }));
  assert.equal(partial.ok, false);
  assert.ok(partial.errors.some((e) => (e.field ?? "").includes("reason") || (e.field ?? "").includes("humanIntervention")));
});

test("IMP-17 · el éxito no atribuye automáticamente crédito a las Strategies (§12.3)", () => {
  const record = buildExperienceRecord(syntheticReplayRecord()).record;
  const claim = strategyCreditClaim(record);
  assert.equal(claim.ok, false);
  assert.equal(claim.code, "NO_AUTOMATIC_STRATEGY_CREDIT");
});
