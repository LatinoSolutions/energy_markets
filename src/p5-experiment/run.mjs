// Ejecución del experimento P5: A0 frente a A1 sobre el manifest congelado
// ex-ante. Fuente: SPEC v1.1.1 §25.1 fila IMP-16 ("Antes del run constan
// versiones definitivas; Delta V = H_A0 - H_A1 con B compartido; refutación y
// aceptación respetan §5/§13; concentración/costes explícitos"), §13.4/§13.9
// (paridad: misma obligación, deadline, oportunidades, controller y ejecución;
// A1 difiere únicamente por timing S1), §14 (replay, receipts y output
// bundles) y §14.6 (B/H/V derivado de los ledgers reales del run).
//
// El runner no repara el diseño frozen, no elige thresholds ni recalcula
// ledgers: los re-verifica (hash ex-ante + anti-mutación del bundle) y deriva
// de ellos B/H/V por brazo, el Delta V con B compartido y el conteo explícito
// de costes y concentración de fills.

import { contentHashOf, assertArmParity } from "../execution-contract/execution-contract.mjs";
import { runP6Replay } from "../p6-evaluator/replay.mjs";
import { buildOutputBundle } from "../p6-evaluator/run-receipts.mjs";
import { evaluateCampaignFromRun } from "../p6-evaluator/manual-campaign.mjs";
import { isReservationIntact } from "../oos-reservation/reservation.mjs";

const TOLERANCE = 1e-9;

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

// Anti-mutación del manifest congelado y de cada frozen bundle (§14.9): un
// manifest alterado después de congelarse no corre experimentos.
export function verifyFrozenIntegrity(frozen) {
  if (!frozen || typeof frozen !== "object" || Array.isArray(frozen)
    || frozen.artifactKind !== "IMP-16_P5_EXPERIMENT_MANIFEST"
    || frozen.status !== "FROZEN_PRE_EXPERIMENT") {
    return { ok: false, code: "MISSING_FROZEN_EXPERIMENT" };
  }
  const { contentHash, ...core } = frozen;
  if (typeof contentHash !== "string" || contentHashOf(core) !== contentHash) {
    return { ok: false, code: "FROZEN_EXPERIMENT_HASH_MISMATCH" };
  }
  for (const armKey of ["a0", "a1"]) {
    const bundle = core.frozenBundles?.[armKey] ?? null;
    if (!bundle || bundle.status !== "FROZEN_PRE_RUN") {
      return { ok: false, code: "MISSING_FROZEN_BUNDLE", arm: armKey.toUpperCase() };
    }
    const { contentHash: bundleHash, ...bundleContent } = bundle;
    if (typeof bundleHash !== "string" || contentHashOf(bundleContent) !== bundleHash) {
      return { ok: false, code: "FROZEN_BUNDLE_HASH_MISMATCH", arm: armKey.toUpperCase() };
    }
  }
  return { ok: true, code: "OK", core };
}

// Run de un brazo: replay P6 (IMP-12) + run receipt/output bundle (IMP-14,
// §14.9/§14.10). Si el replay da INVALID_RUN el output bundle igualmente se
// materializa: la invalidación queda explícita en el receipt y el Delta V no
// se define (el runner no repararuns ni oculta estados).
function materializeArmRun({ armId, bundle, runTimestampUtc }) {
  const replayOutcome = runP6Replay(bundle, { runTimestampUtc });
  const outputOutcome = buildOutputBundle({ bundle, replayOutcome });
  if (!outputOutcome.ok) {
    return { ok: false, code: outputOutcome.code, message: outputOutcome.message ?? null };
  }
  return {
    ok: true,
    armId,
    replayOutcome,
    outputBundle: outputOutcome.outputBundle,
    receiptId: outputOutcome.receiptId,
  };
}

// Paridad operacional P5.6 entre los bundles congelados de A0 y A1
// (§13.6 regla 3: mismo execution contract y cost ledger).
function executionParityOf({ frozen }) {
  return assertArmParity({
    a0: frozen.frozenBundles.a0.execution,
    a1: frozen.frozenBundles.a1.execution,
  });
}

// Costes contables del brazo: additive y embedded por separado (§13.6 regla 1
// — el slippage virtual ya va dentro de executionPrice; nunca doble conteo).
export function costsOf(armEvaluation) {
  return {
    additive: armEvaluation?.costsByKindEur ?? {},
    embedded: armEvaluation?.embeddedCostsByKindEur ?? {},
    accountingNote: "Los costes embedded se reportan aparte y NO se re-suman: ya están en executionPrice (§14.6).",
  };
}

// Concentración de fills de un brazo: volumen por frontera y máximo share de
// una sola oportunidad (§25.1 IMP-16 "concentración explícita").
export function concentrationOf({ fills, openingObligation } = {}) {
  if (!Array.isArray(fills)) {
    return { frontierSeries: [], maxFrontierShare: null, note: "fills debe ser la lista de la execution ledger (§14.4)." };
  }
  const frontierSeries = [];
  for (const row of fills) {
    if (row.noFill === true || !(isFiniteNumber(row.filledQuantity) && row.filledQuantity > 0)) {
      continue;
    }
    const existing = frontierSeries.find((entry) => entry.frontier === row.decisionTimestamp);
    if (existing) {
      existing.filledQuantity += row.filledQuantity;
    } else {
      frontierSeries.push({ frontier: row.decisionTimestamp, filledQuantity: row.filledQuantity });
    }
  }
  const hasObligation = isFiniteNumber(openingObligation) && openingObligation > 0;
  const maxFrontierShare = hasObligation
    ? frontierSeries.reduce((max, row) => Math.max(max, row.filledQuantity / openingObligation), 0)
    : null;
  return {
    frontierSeries,
    maxFrontierShare,
    definition: "share del opening obligation que se llena en una sola frontera de decisión; null sin opening obligación positiva.",
  };
}

// Verifica que el objeto residente de la reserva sigue siendo EL sellado por
// el manifest; el run necesita el objeto para re-verificar intactness
// después (DEP-12).
function verifyReservationBinding({ frozen, oosReservation }) {
  if (!oosReservation || typeof oosReservation !== "object") {
    return { ok: false, code: "MISSING_OOS_RESERVATION" };
  }
  if (oosReservation.contentHash !== frozen.oosReservation.contentHash) {
    return { ok: false, code: "OOS_RESERVATION_HASH_MISMATCH" };
  }
  return { ok: true };
}

// Ejecuta el experimento congelado. Devuelve los output bundles y receipts
// por brazo, la evaluación B/H/V/coverage por brazo (§14.6) y el Delta V con
// B compartido cuando esté definido (§25.1). Con fallas estructurales
// devuelve {ok:false} sin resultados fabricados.
export function runP5Experiment({ frozen = null, oosReservation = null, runTimestampUtc = null, benchmarkRows = null, product = null, windowStart = null, windowEnd = null } = {}) {
  const integrity = verifyFrozenIntegrity(frozen);
  if (!integrity.ok) {
    return {
      ok: false,
      code: integrity.code,
      arm: integrity.arm ?? null,
      message: "La ejecución exige el manifest y los bundles congelados sin mutación (§14.9/§25.1).",
    };
  }

  const reservationBinding = verifyReservationBinding({ frozen: integrity.core, oosReservation });
  if (!reservationBinding.ok) {
    return {
      ok: false,
      code: reservationBinding.code,
      message: "El experimento corre contra la reserva OOS sellada del manifest; sin el objeto residente no hay frontera que re-verificar (§25.2 DEP-12).",
    };
  }

  // Runs por brazo en orden determinista A0 → A1 sobre bundles idénticos
  // salvo el brazo (§13.4).
  const armsById = {};
  const armRuns = [];
  for (const armId of ["A0", "A1"]) {
    const armKey = armId === "A0" ? "a0" : "a1";
    const outcome = materializeArmRun({
      armId,
      bundle: integrity.core.frozenBundles[armKey],
      runTimestampUtc,
    });
    if (!outcome.ok) {
      return {
        ok: false,
        code: "ARM_OUTPUT_BUNDLE_FAILED",
        arm: outcome.armId ?? null,
        details: { code: outcome.code, message: outcome.message },
      };
    }
    armsById[armId] = outcome;
    armRuns.push(outcome);
  }

  const executionParity = executionParityOf({ frozen: integrity.core });
  if (!executionParity.ok) {
    return {
      ok: false,
      code: executionParity.code ?? "EXECUTION_PARITY_BROKEN",
      message: "La paridad operacional P5.6 entre brazos está rota: no hay comparación A0 vs A1 (§13.6).",
    };
  }

  // Evaluación B/H/V/coverage por brazo sobre los ledgers reales, con las
  // MISMAS filas de benchmark: B compartido por construcción y verificado
  // abajo (§14.6; precedente IMP-15).
  for (const armId of ["A0", "A1"]) {
    armsById[armId].evaluation = evaluateCampaignFromRun({
      replayOutcome: armsById[armId].replayOutcome,
      benchmarkRows,
      product,
      windowStart,
      windowEnd,
    });
  }
  const failedArms = ["A0", "A1"].filter((armId) => armsById[armId].evaluation.ok !== true);
  if (failedArms.length > 0) {
    return {
      ok: false,
      code: "ARM_EVALUATION_FAILED",
      details: Object.fromEntries(failedArms.map((armId) => [
        armId,
        { code: armsById[armId].evaluation.code ?? "EVALUATION_FAILED", message: armsById[armId].evaluation.message ?? null },
      ])),
    };
  }

  // B compartido: mismas filas de benchmark → mismo B; una divergencia no se
  // concilia al vuelo: la comparación se aborta (§25.1 "con B compartido").
  const bA0 = armsById.A0.evaluation.B;
  const bA1 = armsById.A1.evaluation.B;
  const benchmarkShared = isFiniteNumber(bA0) && isFiniteNumber(bA1)
    && Math.abs(bA0 - bA1) <= TOLERANCE;
  if (!benchmarkShared) {
    return {
      ok: false,
      code: "BENCHMARK_NOT_SHARED",
      message: "Los brazos deben compartir el mismo B (§13.9/§25.1 Delta V con B compartido); una divergencia no se concilia al vuelo.",
      benchmark: { A0: bA0, A1: bA1 },
    };
  }

  // Delta V con B compartido (§25.1 IMP-16): H_A0 - H_A1, equivalente a
  // V_A1 - V_A0 con el mismo B. Definido sólo con ambas H finitas; el
  // cross-check de las dos representaciones es obligatorio (una divergencia
  // rompe el accounting: no se corrige al vuelo).
  const hA0 = armsById.A0.evaluation.H;
  const hA1 = armsById.A1.evaluation.H;
  const hDefined = isFiniteNumber(hA0) && isFiniteNumber(hA1);
  const deltaV = hDefined ? hA0 - hA1 : null;
  const vDelta = hDefined ? armsById.A1.evaluation.V - armsById.A0.evaluation.V : null;
  const representationsConsistent = !hDefined
    || (isFiniteNumber(vDelta) && Math.abs(deltaV - (vDelta ?? NaN)) <= TOLERANCE);
  if (hDefined && !representationsConsistent) {
    return {
      ok: false,
      code: "DELTA_V_REPRESENTATION_INCONSISTENT",
      message: "Las dos representaciones del ΔV (H_A0-H_A1 y V_A1-V_A0 con B compartido) divergen: el accounting de los brazos no reconcilia (§13.9).",
      deltaV,
      vDelta,
    };
  }

  // Concentración y costes explícitos por brazo (§25.1).
  const concentration = {};
  for (const armId of ["A0", "A1"]) {
    concentration[armId] = concentrationOf({
      fills: armsById[armId].replayOutcome.replay.ledgers.execution,
      openingObligation: armsById[armId].replayOutcome.replay.terminalCoverage.openingObligation,
    });
  }
  const costsByArm = {
    A0: costsOf(armsById.A0.evaluation),
    A1: costsOf(armsById.A1.evaluation),
  };

  // La frontera OOS sigue sellada después del run: ningún acceso que consuma
  // el OOS se registró durante el experimento (§13.8/§15.2).
  const intactAfterRun = isReservationIntact(oosReservation);

  // Estados de run por brazo: validez separada, no agregada.
  const invalidRuns = armRuns
    .filter((run) => run.replayOutcome.replay.status.validity !== "VALID_RUN")
    .map((run) => ({
      arm: run.armId,
      invalidityReasons: run.replayOutcome.replay.receipt.invalidityReasons ?? [],
    }));

  return {
    ok: true,
    code: "P5_EXPERIMENT_RUN_COMPLETED",
    experiment: { experimentId: frozen.experiment.experimentId, experimentVersion: frozen.experiment.experimentVersion },
    arms: Object.fromEntries(["A0", "A1"].map((armId) => [
      armId,
      {
        armId,
        configurationHash: armId === "A1" ? frozen.s1Configuration.artifactHash : null,
        outputBundle: armsById[armId].outputBundle,
        receiptId: armsById[armId].receiptId,
        runStatus: armsById[armId].replayOutcome.replay.status,
        evaluation: armsById[armId].evaluation,
      },
    ])),
    executionParity,
    benchmark: {
      sharedB: bA0,
      benchmarkCount: armsById.A0.evaluation.benchmarkCount ?? null,
      benchmarkCoverage: armsById.A0.evaluation.benchmarkCoverage ?? null,
    },
    deltaV: {
      definition: "H_A0 - H_A1 con B compartido (§25.1 IMP-16)",
      defined: hDefined && representationsConsistent,
      value: hDefined && representationsConsistent ? deltaV : null,
      components: hDefined ? { H_A0: hA0, H_A1: hA1, B: bA0 } : { H_A0: hA0, H_A1: hA1, B: bA0, note: "H de algún brazo indefinido (§14.6): Delta V no definido, no se mascara." },
      fromValues: hDefined ? vDelta : null,
      crossCheck: hDefined
        ? (representationsConsistent
          ? "V_A1 - V_A0 = Delta V (B compartido): verificada"
          : "divergencia entre representaciones del ΔV: no se corrige al vuelo (§14.6)")
        : "no aplicable: H de algún brazo indefinido (§14.6 no se mascara).",
    },
    costsByArm,
    concentration,
    oosReservation: {
      reservationHash: frozen.oosReservation.contentHash,
      intactCodeAtFreeze: frozen.oosReservation.intactCode,
      intactAfterRun: intactAfterRun.intact,
      intactReasonsAfterRun: intactAfterRun.reasons,
    },
    invalidRuns,
  };
}
