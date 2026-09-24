// Congelación ex-ante del bundle P5 completo (IMP-16). Fuente: SPEC v1.1.1
// §25.1 fila IMP-16 ("Antes del run constan versiones definitivas"; inputs
// "Configuración development frozen, campaigns reservadas y P6/P5.6 válidos";
// MUST NOT "No rescue; no mover thresholds, población, baseline ni frontera por
// resultados"), §13.8/§15.2 (reserva sellada antes de calibrar; thresholds
// congelados antes de la frontera OOS), §13.9 (A1 = A0 + S1, mismo controller
// y calendario) y §13.6 regla 5 (P5.6 HOLD mientras parámetros sean
// provisionales/unknow).
//
// El manifest IMP-16 no sustituye los contratos de IMP-09/11/12: los consume
// materializados, cruza sus hashes en una sola verdad ex-ante y congela los
// bundles P6 de los dos brazos (A0 y A1) ANTES del primer run. Scope
// declarado: SYNTHETIC_FIXTURE admite P5.6 en HOLD (limitación visible);
// REAL_DATA exige P5.6 READY (§13.6 regla 5) — sin datos reales sellados no
// hay brazo real.

import {
  contentHashOf,
  versionKeyOf,
  evaluateP56Validity,
} from "../execution-contract/execution-contract.mjs";
import { buildReplayBundle } from "../p6-evaluator/input-bundle.mjs";
import { createA0Baseline } from "../sizing-controller/a0-baseline.mjs";
import { assertConfigurationFrozen } from "../s1-strategy/configuration.mjs";
import { assertThresholdsFrozenBeforeOos } from "../s1-strategy/calibration.mjs";
import { createA1Arm, assertA1IsA0PlusS1 } from "../s1-strategy/a1-arm.mjs";
import { confirmOosReservationIntact } from "./oos-intact.mjs";
import { deriveS1FeaturePlan } from "./s1-features.mjs";
import { toUtcTimestamp } from "../pit-views/time.mjs";

export const P5_EXPERIMENT_MANIFEST_KIND = "IMP-16_P5_EXPERIMENT_MANIFEST";
export const P5_EXPERIMENT_SCOPES = {
  SYNTHETIC_FIXTURE: { declared: "SYNTHETIC_FIXTURE", requiresP56Ready: false },
  REAL_DATA: { declared: "REAL_DATA", requiresP56Ready: true },
};
// §25.1 IMP-16/§13.9: la fórmula del ΔV se predeclara ANTES del run y no se
// re-elige después por resultados.
export const DELTA_V_DECLARATION = {
  formula: "Delta V = H_A0 - H_A1 con B compartido (equivalente a V_A1 - V_A0 cuando B es el mismo)",
  authority: "SPEC v1.1.1 §25.1 IMP-16; §13.9",
};
export const NO_RESCUE_DECLARATION = "No rescue: no se mueve thresholds, población, baseline ni frontera por resultados (§25.1 MUST NOT).";

function isCanonicalId(value) {
  return typeof value === "string" && value.trim().length > 0
    && /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value);
}

// Congela el experimento P5 ex-ante: reserva OOS intacta + re-derivable,
// configuración S1 frozen (y congelada ANTES de la frontera OOS), controller,
// execution contract P5.6 y cost ledger versionados, y los dos frozen bundles
// P6 (A0/A1) idénticos salvo el brazo. Devuelve el manifest congelado con su
// contentHash o las fallas sin suavizar.
export function freezeP5Experiment(input = {}) {
  // Sello UTC anclado de congelación ex-ante: sin reloj no hay momento
  // demostrable "antes del run" (§25.1 "antes del run constan versiones").
  const frozenAt = toUtcTimestamp(input.frozenAtUtc);
  if (!frozenAt.ok) {
    return { ok: false, failures: [
      { code: frozenAt.code ?? "MISSING_FROZEN_AT_UTC", message: "El experimento exige un frozenAtUtc UTC anclado a zona explícita (§6.1)." },
    ] };
  }
  const experiment = input.experiment ?? null;
  if (!experiment || typeof experiment !== "object" || !isCanonicalId(experiment.experimentId)
    || typeof experiment.experimentVersion !== "string") {
    return { ok: false, failures: [
      { code: "MISSING_EXPERIMENT_IDENTITY", message: "El experimento debe declarar experimentId canónico y experimentVersion (§14.2)." },
    ] };
  }
  const scopeOutcome = P5_EXPERIMENT_SCOPES[input.scope ?? null];  if (!scopeOutcome) {
    return { ok: false, failures: [
      { code: "MISSING_EXPERIMENT_SCOPE", message: "El experimento debe declarar scope SYNTHETIC_FIXTURE o REAL_DATA; sintético declarado permite P5.6 HOLD con limitación visible, datos reales exigen P5.6 READY (§13.6 regla 5)." },
    ] };
  }

  // 1. Reserva OOS intacta, con re-derivación verificable cuando se provee.
  const oosCheck = confirmOosReservationIntact({
    reservation: input.oosReservation ?? null,
    derivationInput: input.oosReservationDerivation ?? null,
  });
  if (!oosCheck.ok) {
    return { ok: false, failures: [
      { code: oosCheck.code, message: "La reserva OOS no se confirma intacta (fail-closed, §25.2 DEP-12); el experimento no se congela sobre ella.", reasons: oosCheck.reasons },
    ] };
  }

  // 2. Configuración S1 frozen (IMP-11, DEP-11).
  const configuration = input.s1Configuration ?? null;
  const configGuard = assertConfigurationFrozen(configuration);
  if (!configGuard.ok) {
    return { ok: false, failures: [{ code: configGuard.code, message: configGuard.message }] };
  }

  // 3. Thresholds congelados ANTES de la frontera OOS (§13.8).
  const thresholdGuard = assertThresholdsFrozenBeforeOos(configuration, oosCheck.reservation);
  if (!thresholdGuard.ok) {
    return { ok: false, failures: [{ code: thresholdGuard.code, message: thresholdGuard.message }] };
  }

  // 4. Execution contract P5.6 y cost ledger materializados y válidos en su
  // schema; REAL_DATA además exige P5.6 READY (§13.6 regla 5).
  const executionContract = input.executionContract ?? null;
  const costLedger = input.costLedger ?? null;
  if (!executionContract || typeof executionContract !== "object" || !costLedger || typeof costLedger !== "object") {
    return { ok: false, failures: [
      { code: "MISSING_EXECUTION_ARTIFACTS", message: "Falta el execution contract P5.6 o el cost ledger materializados (§14.2)." },
    ] };
  }
  const p56 = evaluateP56Validity(executionContract);
  if ((p56.errors?.length ?? 0) > 0) {
    return { ok: false, failures: [
      { code: "P56_CONTRACT_INVALID", message: "El execution contract no satisface su propio schema P5.6: ni siquiera en scope sintético hace falta (§14.2/§13.6).", errors: p56.errors ?? [] },
    ] };
  }
  if (scopeOutcome.requiresP56Ready && !p56.valid) {
    return { ok: false, failures: [
      { code: "P56_NOT_READY", message: `Scope REAL_DATA exige P5.6 READY; estado ${p56.status}. Blockers: ${(p56.blockers ?? []).map((blocker) => blocker.parameter).join(", ")}. (§13.6 regla 5)` },
    ] };
  }

  // 5. Brazos: A0 calendar-only y A1 = A0 + S1, compartiendo controller y
  // calendario (§13.9).
  const controller = input.controller ?? null;
  const decisionCalendar = input.decisionCalendar ?? null;
  if (!controller || typeof controller.contentHash !== "string") {
    return { ok: false, failures: [
      { code: "MISSING_SIZING_CONTROLLER", message: "Falta el sizing controller frozen de IMP-10 con su content hash (§13.6 paridad)." },
    ] };
  }
  const a0Outcome = createA0Baseline({ controller, calendar: decisionCalendar });
  if (!a0Outcome.ok) {
    return { ok: false, failures: [{ code: "A0_ARM_NOT_CREATED", message: "El brazo A0 no se materializa." }] };
  }
  // §14.2: el bundle exige la versión del brazo congelado; la identidad es la
  // del controller común (A0 es calendar-only sobre ese controller).
  const a0Arm = { ...a0Outcome.arm, armVersion: versionKeyOf({ contentHash: controller.contentHash }) };
  const a1Wrapped = createA1Arm({ a0Arm, configuration, controller });
  if (!a1Wrapped.ok) {
    return { ok: false, failures: [{ code: a1Wrapped.code ?? "A1_ARM_NOT_CREATED", message: a1Wrapped.message ?? "El brazo A1 no se materializa." }] };
  }
  const a1Arm = { ...a1Wrapped.arm, armVersion: `hash:${configuration.contentHash}` };
  const parityGuard = assertA1IsA0PlusS1({
    a0Arm,
    a1Arm,
    a0ControllerVersion: controller.contentHash,
    a1ControllerVersion: controller.contentHash,
  });
  if (!parityGuard.ok) {
    return { ok: false, failures: [{ code: parityGuard.code, message: parityGuard.message }] };
  }

  // 5b. Plan de features S1 por frontera, derivado del manifest PIT real
  // congelado en cada frontera exacta (§8.1); las keys las declara el caller
  // desde la evidencia del lago, el valor lo lee IMP-16 del manifest.
  const featurePlan = deriveS1FeaturePlan({
    decisionCalendar,
    dataManifest: input.dataManifest ?? null,
    configuration,
    featureInputDeclarations: input.s1FeatureInputDeclarations ?? [],
  });
  if (!featurePlan.ok) {
    return { ok: false, failures: [{ code: featurePlan.code, message: "El plan de features S1 no es derivable del manifest PIT congelado.", offendingDate: featurePlan.offendingDate ?? null }] };
  }
  const featuresByFrontier = Object.fromEntries(
    featurePlan.entries.map((entry) => [entry.frontierDate, entry.ok === true ? entry.features : null]),
  );
  const featureUnavailability = featurePlan.entries
    .filter((entry) => entry.status !== "AVAILABLE_FEATURES")
    .map((entry) => ({ frontierDate: entry.frontierDate, status: entry.status, reason: entry.reason ?? null }));

  const a1TimingArm = {
    ...a1Arm,
    timingFeaturesSource: "FROZEN_S1_FEATURE_PLAN",
    decideAtOpportunity(state = {}) {
      const features = featuresByFrontier?.[state?.currentDate] ?? state?.s1Features ?? null;
      // §14.3 paso 2: las features S1 vienen del plan derivado DEL MANIFEST
      // PIT congelado; sin devolución para esta frontera, cae al A0 (UNKNOWN).
      return a1Arm.decideAtOpportunity({ ...state, s1Features: features });
    },
  };

  // 6. Frozen bundle P6 por brazo. Comparables: idénticos salvo el brazo
  // (§13.4). Cada bundle queda congelado con su contentHash y se verifica que
  // son el mismo bundle una vez retirado el brazo.
  const bundleInputOf = (arm) => ({
    experiment,
    campaign: input.campaign,
    openingContract: input.openingContract,
    decisionCalendar,
    arm,
    sizingConfiguration: controller,
    execution: input.execution,
    executionContract,
    costLedger,
    data: { manifest: input.dataManifest },
    priceObservations: input.priceObservations ?? [],
    benchmark: input.benchmark,
    evaluator: input.evaluator,
    stochasticity: input.stochasticity ?? null,
  });
  const a0BundleOutcome = buildReplayBundle(bundleInputOf(a0Arm));
  const a1BundleOutcome = buildReplayBundle(bundleInputOf(a1TimingArm));
  if (!a0BundleOutcome.ok || !a1BundleOutcome.ok) {
    return { ok: false, failures: [
      !a0BundleOutcome.ok ? { code: "A0_BUNDLE_INVALID", message: "El frozen bundle del brazo A0 no se construye (§14.2).", errors: a0BundleOutcome.errors ?? [] } : null,
      !a1BundleOutcome.ok ? { code: "A1_BUNDLE_INVALID", message: "El frozen bundle del brazo A1 no se construye (§14.2).", errors: a1BundleOutcome.errors ?? [] } : null,
    ].filter(Boolean) };
  }
  const stripArm = (bundle) => {
    const { arm, contentHash, ...rest } = bundle;
    return rest;
  };
  if (contentHashOf(stripArm(a0BundleOutcome.bundle)) !== contentHashOf(stripArm(a1BundleOutcome.bundle))) {
    return { ok: false, failures: [
      { code: "ARM_BUNDLE_COMPARABILITY_BROKEN", message: "Los bundles de A0 y A1 no son idénticos una vez retirado el brazo: la comparación A0 frente a A1 consume el mismo material y sólo puede diferir por el timing S1 (§13.4)." },
    ] };
  }

  // 7. Manifest ex-ante con las versiones definitivas de cada artefacto.
  const core = {
    artifactKind: P5_EXPERIMENT_MANIFEST_KIND,
    schemaVersion: "1.0",
    experiment: { experimentId: experiment.experimentId, experimentVersion: experiment.experimentVersion },
    scope: scopeOutcome.declared,
    frozenAtUtc: frozenAt.utc,
    provenance: input.provenance ?? null,
    oosReservation: {
      reservationId: oosCheck.reservation?.reservationId ?? null,
      contentHash: oosCheck.reservationHash,
      sealedOosCount: oosCheck.sealedOosCount,
      sealedOosCampaignIds: oosCheck.sealedOosCampaignIds,
      protectedFromIso: oosCheck.protectedFromIso,
      intactCode: oosCheck.code,
      derivationChecked: oosCheck.derivation !== null,
    },
    s1Configuration: {
      artifactHash: configuration.contentHash,
      thresholdFeature: configuration.thresholds.feature,
      thresholdsFrozenAtUtc: configuration.frozenAtUtc,
    },
    sizingController: { contentHash: controller.contentHash, ruleId: controller.ruleId ?? null },
    execution: {
      contractVersion: versionKeyOf(executionContract.contractVersion ?? null) ?? null,
      contractContentHash: executionContract.contentHash ?? null,
      costLedgerVersion: versionKeyOf(costLedger.ledgerVersion ?? null) ?? null,
      costLedgerContentHash: costLedger.contentHash ?? null,
      p56Validity: { status: p56.status, valid: p56.valid, blockers: p56.blockers ?? [], reason: p56.reason ?? null },
    },
    datasetManifest: {
      manifestId: input.dataManifest?.manifestId ?? null,
      manifestVersion: input.dataManifest?.manifestVersion ?? null,
    },
    benchmark: {
      sourceVersion: input.benchmark?.sourceVersion ?? null,
      status: input.benchmark?.status ?? null,
    },
    evaluatorVersion: input.evaluator?.evaluatorVersion ?? null,
    arms: {
      a0: { armId: "A0", bundleContentHash: a0BundleOutcome.bundle.contentHash },
      a1: { armId: "A1", configurationHash: configuration.contentHash, bundleContentHash: a1BundleOutcome.bundle.contentHash },
    },
    s1FeaturePlan: {
      entriesAvailable: featurePlan.entries.filter((entry) => entry.status === "AVAILABLE_FEATURES").length,
      entriesUnavailable: featureUnavailability.length,
      unavailability: featureUnavailability,
    },
    deltaVDeclaration: DELTA_V_DECLARATION,
    noRescue: NO_RESCUE_DECLARATION,
    frozenBundles: { a0: a0BundleOutcome.bundle, a1: a1BundleOutcome.bundle },
  };
  if (!frozenAt.ok) {
    return { ok: false, failures: [
      { code: frozenAt.code ?? "MISSING_FROZEN_AT_UTC", message: "El manifest exige un sello UTC anclado de congelación ex-ante." },
    ] };
  }
  core.status = "FROZEN_PRE_EXPERIMENT";
  core.contentHash = contentHashOf(core);
  return { ok: true, frozen: Object.freeze(core) };
}
