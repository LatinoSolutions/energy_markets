// Receipt de research del experimento P5 (IMP-16). Fuente: SPEC v1.1.1
// §25.1 fila IMP-16 ("Bundle ex-ante, Delta V, P3 metrics, validity y research
// verdict") y §25.2 DEP-13/14 ("resultado A0/A1, Delta V, métricas, costes,
// concentración/estabilidad y verdict con límites; FAIL/HOLD/INVALID no se
// ocultan ni se convierten en PASS para cerrar un gate posterior").
//
// El receipt materializa lo que el experimento produjo realmente (output
// bundles, evaluaciones y ΔV del runner) más el veredicto P3 de la serie ΔV
// cuando se provea; sin veredicto queda declarado como no evaluado (nunca
// fabricado). Ningún resultado se elimina ni se re-etiqueta: el scope
// sintético declarado y los límites P5.6/benchmark quedan dentro del record.

import { contentHashOf } from "../execution-contract/execution-contract.mjs";
import { deriveDatasetQuality } from "./verdict.mjs";

// receiptKind del receipt de research P5 (IMP-16): la etiqueta que el governor
// de IMP-24 consume para discriminar la etapa OOS. Se declara UNA vez aquí y
// quien la consuma la importa, no la re-declara (corrección IMP24-SHADOW-KIND).
export const P5_EXPERIMENT_RECEIPT_KIND = "IMP-16_P5_EXPERIMENT_RECEIPT";

// IMP16-H10 (§13.6 regla 5 / §25.2 DEP-13/14): el receipt no puede
// materializarse contradiciendo su propio manifest congelado — un veredicto
// PASS exige calidad de datos derivada full y no-provisional, y el dataQuality
// del veredicto debe coincidir con el derivado del frozen + runs reales.
export function gateResearchEvaluationAgainstFrozen({ frozen, runOutcome, researchEvaluation }) {
  const derived = deriveDatasetQuality({ frozen, runOutcome });
  if (!derived.ok) {
    return { ok: false, code: "RECEIPT_DATA_QUALITY_NOT_DERIVABLE", message: "La calidad de datos no es derivable del manifest congelado (§13.6 regla 5)." };
  }
  const declared = researchEvaluation?.dataQuality ?? null;
  if (declared
    && (declared.coverage !== derived.dataQuality.coverage
      || declared.benchmarkProvisional !== derived.dataQuality.benchmarkProvisional)) {
    return { ok: false, code: "RECEIPT_DATA_QUALITY_NOT_BOUND_TO_FROZEN", message: "El dataQuality declarado en el veredicto no coincide con el derivado del manifest congelado: la calidad no se atestúa a mano (§13.6 regla 5)." };
  }
  const verdict = researchEvaluation?.verdict ?? null;
  if (verdict === "PASS"
    && (derived.dataQuality.benchmarkProvisional || derived.dataQuality.coverage !== "full")) {
    return { ok: false, code: "RECEIPT_VERDICT_CONTRADICTS_FROZEN", message: `El manifest congelado declara benchmark provisional o cobertura incompleta (${JSON.stringify(derived.dataQuality)}): un veredicto PASS contradice al receipt (§25.2 DEP-13/14).` };
  }
  return { ok: true, derived: derived.dataQuality };
}

export function materializeP5ExperimentReceipt({ frozen = null, runOutcome = null, researchEvaluation = null, runTimestampUtc = null, closureNote = null } = {}) {
  if (!frozen || frozen.artifactKind !== "IMP-16_P5_EXPERIMENT_MANIFEST") {
    return { ok: false, code: "MISSING_FROZEN_EXPERIMENT", message: "El receipt de IMP-16 se materializa desde el manifest P5 congelado ex-ante (§25.1)." };
  }
  if (!runOutcome || runOutcome.ok !== true) {
    return { ok: false, code: "MISSING_RUN_OUTCOME", message: "El receipt se materializa desde el resultado real de runP5Experiment; sin run no se fabrica evidencia (§14.1)." };
  }
  if (researchEvaluation !== null) {
    const gate = gateResearchEvaluationAgainstFrozen({ frozen, runOutcome, researchEvaluation });
    if (!gate.ok) {
      return { ok: false, code: gate.code, message: gate.message };
    }
  }

  const armRows = ["A0", "A1"].map((armId) => {
    const arm = runOutcome.arms?.[armId] ?? null;
    if (!arm || arm.armId !== armId) {
      return { armId, code: "MISSING_ARM_OUTCOME" };
    }
    const evaluation = arm.evaluation ?? {};
    return {
      armId,
      configurationHash: armId === "A1" ? frozen.s1Configuration.artifactHash : null,
      bundleContentHash: arm.outputBundle?.receipt?.frozenBundleContentHash ?? null,
      runReceiptId: arm.outputBundle?.receipt?.receiptId ?? arm.receiptId ?? null,
      runStatus: arm.runStatus ?? null,
      bhv: {
        B: evaluation.B ?? null,
        H: evaluation.H ?? null,
        V: evaluation.V ?? null,
        vDefined: evaluation.vDefined ?? null,
        executedVolume: evaluation.coverage?.executedVolume ?? null,
        remainingVolume: evaluation.coverage?.remainingVolume ?? null,
        coverageStatus: evaluation.coverage?.status ?? null,
      },
      costsByKindAdditiveEur: evaluation.costsByKindEur ?? {},
      costsByKindEmbeddedEur: evaluation.embeddedCostsByKindEur ?? {},
      concentration: runOutcome.concentration?.[armId] ?? null,
    };
  });

  const receipt = {
    receiptKind: P5_EXPERIMENT_RECEIPT_KIND,
    schemaVersion: "1.0",
    experiment: frozen.experiment,
    scope: frozen.scope,
    exAnteManifest: {
      manifestContentHash: frozen.contentHash,
      frozenAtUtc: frozen.frozenAtUtc,
      deltaVDeclaration: frozen.deltaVDeclaration,
      noRescue: frozen.noRescue,
    },
    oosReservation: {
      contentHash: frozen.oosReservation.contentHash,
      sealedOosCount: frozen.oosReservation.sealedOosCount,
      sealedOosCampaignIds: [...(frozen.oosReservation.sealedOosCampaignIds ?? [])],
      protectedFromIso: frozen.oosReservation.protectedFromIso,
      intactCodeAtFreeze: frozen.oosReservation.intactCode,
      intactAfterRun: runOutcome.oosReservation?.intactAfterRun ?? null,
      intactReasonsAfterRun: runOutcome.oosReservation?.intactReasonsAfterRun ?? [],
    },
    s1ConfigurationHash: frozen.s1Configuration.artifactHash,
    arms: Object.fromEntries(armRows.map((row) => [row.armId, row])),
    executionValidity: {
      p56Status: frozen.execution.p56Validity.status,
      p56Valid: frozen.execution.p56Validity.valid,
      blockers: frozen.execution.p56Validity.blockers,
      authorityNote: "§13.6 regla 5: parámetros sin evidencia auditada mantienen la interpretación económica en HOLD; no se eleva por tener valor numérico.",
    },
    benchmark: { sharedB: runOutcome.benchmark.sharedB, sourceVersion: frozen.benchmark.sourceVersion, status: frozen.benchmark.status },
    deltaV: runOutcome.deltaV,
    p3ResearchEvaluation: researchEvaluation === null
      ? {
          evaluated: false,
          code: "RESEARCH_EVALUATION_NOT_PROVIDED",
          note: "Veredicto P3 no evaluado en este run del experimento: se declara explícitamente, nunca fabricado (§14.7/§5.8).",
        }
      : {
          evaluated: true,
          verdict: researchEvaluation.verdict ?? null,
          verdictReason: researchEvaluation.verdictReason ?? null,
          scoringDigest: researchEvaluation.scoring === null ? null : contentHashOf(Object.fromEntries(Object.entries(researchEvaluation.scoring).filter(([, value]) => typeof value !== "function"))),
          minimumEvidence: researchEvaluation.minimumEvidence ?? null,
          dataQuality: researchEvaluation.dataQuality ?? null,
          limits: researchEvaluation.limits ?? null,
        },
    runTimestampUtc,
    invalidRuns: runOutcome.invalidRuns ?? [],
  };
  receipt.receiptId = contentHashOf(receipt);
  return { ok: true, receipt: Object.freeze(receipt), closureNote: closureNote ?? null };
}
