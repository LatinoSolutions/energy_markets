// Tests IMP-16 parte 2: congelación ex-ante del bundle P5. Fuente: SPEC
// v1.1.1 §25.1 ("Antes del run constan versiones definitivas"), §13.8
// (thresholds frozen antes de OOS), §13.9 (A1 = A0 + S1, mismo controller), y
// §13.6 regla 5 (P5.6 HOLD con parámetros provisionales; scope declarado).
// Fixtures sintéticos declarados.

import test from "node:test";
import assert from "node:assert/strict";

import {
  freezeP5Experiment,
  P5_EXPERIMENT_MANIFEST_KIND,
  DELTA_V_DECLARATION,
} from "../../src/p5-experiment/index.mjs";
import { buildExperimentFixture } from "./fixtures.mjs";

test("§25.1: el manifest ex-ante congela reserva, configuración S1, contratos y los dos bundles", () => {
  const fx = buildExperimentFixture({});
  const frozen = freezeP5Experiment(fx.freezeInput);
  assert.equal(frozen.ok, true);

  const manifest = frozen.frozen;
  assert.equal(manifest.artifactKind, P5_EXPERIMENT_MANIFEST_KIND);
  assert.equal(manifest.status, "FROZEN_PRE_EXPERIMENT");
  assert.equal(manifest.scope, "SYNTHETIC_FIXTURE");
  assert.ok(manifest.contentHash);

  // Reserva confirmada intacta dentro del manifest.
  assert.equal(manifest.oosReservation.contentHash, fx.frozenReservation.contentHash);
  assert.equal(manifest.oosReservation.sealedOosCount, 8);
  assert.equal(manifest.oosReservation.intactCode, "OOS_RESERVATION_CONFIRMED_INTACT");
  assert.ok(manifest.oosReservation.sealedOosCampaignIds.includes("GAS-Q-2021Q3"));

  // Configuración S1 frozen y controller: identidad ex-ante, no re-wireada.
  assert.equal(manifest.s1Configuration.artifactHash, fx.freezeInput.s1Configuration.contentHash);
  assert.equal(manifest.s1Configuration.thresholdFeature, "signedDistanceToReference");
  assert.equal(manifest.sizingController.contentHash, fx.freezeInput.controller.contentHash);

  // Ejecución P5.6: PROVISIONAL declared, no escondido.
  assert.equal(manifest.execution.p56Validity.status, "HOLD");
  assert.ok(Array.isArray(manifest.execution.p56Validity.blockers));
  assert.ok(manifest.execution.p56Validity.blockers.length > 0);

  // Los dos bundles quedan congelados con identidad distinta (brazos distintos)
  // pero comparables: idénticos una vez retirado el brazo (§13.4).
  assert.equal(manifest.arms.a0.bundleContentHash, manifest.frozenBundles.a0.contentHash);
  assert.equal(manifest.arms.a1.bundleContentHash, manifest.frozenBundles.a1.contentHash);
  assert.notEqual(manifest.arms.a0.bundleContentHash, manifest.arms.a1.bundleContentHash);
  const stripped0 = { ...manifest.frozenBundles.a0 };
  delete stripped0.arm;
  delete stripped0.contentHash;
  const stripped1 = { ...manifest.frozenBundles.a1 };
  delete stripped1.arm;
  delete stripped1.contentHash;
  assert.equal(JSON.stringify(stripped0), JSON.stringify(stripped1));

  // ΔV predeclarado y no-rescue, ANTES del run (§25.1 MUST NOT).
  assert.deepStrictEqual(manifest.deltaVDeclaration, DELTA_V_DECLARATION);
  assert.ok(manifest.noRescue.includes("No rescue"));

  // Plan S1: 4 fronteras resueltas del manifest PIT.
  assert.equal(manifest.s1FeaturePlan.entriesAvailable, 4);
  assert.equal(manifest.s1FeaturePlan.entriesUnavailable, 0);
});

test("fail-closed: sin identidad/scope de experimento no se congela", () => {
  const fx = buildExperimentFixture({});
  const withoutIdentity = freezeP5Experiment({ ...fx.freezeInput, experiment: { experimentId: undefined, experimentVersion: "v1.0" } });
  assert.equal(withoutIdentity.ok, false);
  assert.equal(withoutIdentity.failures[0].code, "MISSING_EXPERIMENT_IDENTITY");

  const withoutScope = freezeP5Experiment({ ...fx.freezeInput, scope: undefined });
  assert.equal(withoutScope.ok, false);
  assert.equal(withoutScope.failures[0].code, "MISSING_EXPERIMENT_SCOPE");
});

test("fail-closed: frozenAtUtc no anclado no congela el manifest", () => {
  const fx = buildExperimentFixture({});
  const outcome = freezeP5Experiment({ ...fx.freezeInput, frozenAtUtc: "2021-02-01 hace un rato" });
  assert.equal(outcome.ok, false);
  assert.equal(outcome.failures[0].code, "NOT_UTC_ANCHORED");
});

test("fail-closed: reserva ausente o en HOLD aborta la congelación (DEP-12)", () => {
  const fx = buildExperimentFixture({});
  const hold = freezeP5Experiment({
    ...fx.freezeInput,
    oosReservation: { decision: "HOLD", blockedBy: ["INSUFFICIENT_ELIGIBLE_COMPLETE_CAMPAIGNS"] },
    oosReservationDerivation: null,
  });
  assert.equal(hold.ok, false);
  assert.equal(hold.failures[0].code, "OOS_RESERVATION_NOT_INTACT");
});

test("fail-closed: configuración S1 no frozen aborta (DEP-11)", () => {
  const fx = buildExperimentFixture({});
  const outcome = freezeP5Experiment({ ...fx.freezeInput, s1Configuration: {} });
  assert.equal(outcome.ok, false);
  assert.equal(outcome.failures[0].code, "CONFIGURATION_NOT_FROZEN");
});

test("§13.6 regla 5: contrato P5.6 inválido aborta, y REAL_DATA exige P5.6 READY", () => {
  const fx = buildExperimentFixture({});
  // El alcance sintético admite P5.6 HOLD (limitación DECLARADA>, no oculta);
  // pero un contrato que no satisface su schema no se congela nunca.
  const invalidContract = { ...fx.freezeInput.executionContract, frozenRules: [] };
  const outcome = freezeP5Experiment({ ...fx.freezeInput, executionContract: invalidContract });
  assert.equal(outcome.ok, false);
  assert.equal(outcome.failures[0].code, "P56_CONTRACT_INVALID");

  // El caso REAL con datos reales exige P5.6 READY: parámetros provisionales
  // o UNKNOWN no admiten el experimento real (§13.6 regla 5).
  const real = freezeP5Experiment({ ...fx.freezeInput, scope: "REAL_DATA" });
  assert.equal(real.ok, false);
  assert.equal(real.failures[0].code, "P56_NOT_READY");
});

test("§13.8: una configuración S1 congelada DESPUÉS de la frontera OOS no congela", () => {
  // La frontera sellada arranca en 2021-03-01 (primera ventana sellada
  // 2021Q3): una configuración congelada el 2021-05-01 quedó DENTRO del OOS.
  const fx = buildExperimentFixture({ configurationFrozenAtUtc: "2021-05-01T00:00:00Z" });
  const outcome = freezeP5Experiment(fx.freezeInput);
  assert.equal(outcome.ok, false);
  assert.equal(outcome.failures[0].code, "THRESHOLDS_FROZEN_AFTER_OOS");
});

test("§8.1/§14.3: una key PIT sin valor deja la feature UNAVAILABLE (visible, no silenciada)", () => {
  const fx = buildExperimentFixture({});
  const declarations = fx.freezeInput.s1FeatureInputDeclarations.map((entry) => (
    entry.frontierDate === "2021-06-23"
      ? { ...entry, decisionPricePitKey: "S1.P5.decision.KEY-INEXISTENTE" }
      : entry));
  const outcome = freezeP5Experiment({ ...fx.freezeInput, s1FeatureInputDeclarations: declarations });
  assert.equal(outcome.ok, true);
  const plan = outcome.frozen.s1FeaturePlan;
  assert.equal(plan.entriesAvailable, 3);
  assert.equal(plan.entriesUnavailable, 1);
  assert.equal(plan.unavailability[0].frontierDate, "2021-06-23");
  assert.equal(plan.unavailability[0].status, "UNAVAILABLE_FEATURES");
});
