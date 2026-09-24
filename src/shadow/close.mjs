// Cierre Shadow y comparación al cerrar campaña (IMP-18). Fuente: SPEC v1.1.1
// §15.3 ("Compara con baseline y closed benchmark cuando estén disponibles y
// conserva por separado revisiones y correcciones tardías"), §12.2 (outcome y
// benchmark version al cierre; pieza registrada sólo cuando existe), §14.5
// (opening = executed + remaining), §25.1 fila IMP-18 ("Shadow evidence y
// comparación al cerrar campaña; correcciones en receipts separados") y §25.2
// nota IMP-17 ("Casos sintéticos no cierran DEP-22").
//
// El cierre no fabrica benchmark ni precio: lo disponible se compara, lo no
// disponible se declara UNAVAILABLE. Las correcciones generan receipts nuevos
// sin tocar el receipt original ni los registros originales.

import { contentHashOf } from "../execution-contract/execution-contract.mjs";
import { runP6Replay } from "../p6-evaluator/replay.mjs";
import { toUtcTimestamp } from "../pit-views/time.mjs";
import { closeExperienceRecord, RECORD_STATES } from "../experience/record.mjs";
import { SHADOW_SESSION_KIND } from "./session.mjs";
import { verifyShadowNonInterference } from "./non-interference.mjs";

export const SHADOW_EVIDENCE_RECEIPT_KIND = "IMP-18_SHADOW_EVIDENCE_RECEIPT";

function fail(code, message, extra = {}) {
  return { ok: false, code, message, ...extra };
}

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

// §14.5/§12.2: el estado terminal del cierre se DERIVA de los pasos/registros
// capturados, no se confía al caller. Cada step referencia un registro; el
// último registro aporta executed/remaining, y la conservación opening =
// executed + remaining debe cumplirse. Un estado incoherente no cierra.
function deriveTerminalState({ records, steps, openingObligation }) {
  if (!Array.isArray(steps) || steps.length === 0) {
    return fail("EMPTY_SHADOW_CAPTURE", "Una sesión Shadow sin pasos capturados no produce evidencia (§15.3).");
  }
  const recordById = new Map(records.map((record) => [record?.recordId ?? null, record]));
  let terminalRecord = null;
  for (const [index, step] of steps.entries()) {
    const record = step?.recordId != null ? recordById.get(step.recordId) : null;
    if (!record) {
      return fail("STEP_RECORD_MISSING", `El step ${step?.sequence ?? index + 1} no referencia un registro capturado (§12.2).`);
    }
    if (step?.sequence !== index + 1) {
      return fail("STEP_SEQUENCE_BROKEN", `El step ${step?.sequence ?? index + 1} rompe la cronología capturada (§13.2).`);
    }
    terminalRecord = record;
  }
  const executedVolume = terminalRecord?.nextState?.executedVolume;
  const remainingVolume = terminalRecord?.nextState?.remainingVolume;
  if (!isFiniteNumber(executedVolume) || !isFiniteNumber(remainingVolume)) {
    return fail("TERMINAL_STATE_UNREADABLE", "El estado terminal hipotético del último registro capturado no es legible (§14.5).");
  }
  if (executedVolume + remainingVolume !== openingObligation) {
    return fail("SHADOW_CONSERVATION_VIOLATION", `Opening ${openingObligation} ≠ executed ${executedVolume} + remaining ${remainingVolume} sobre la captura (§14.5).`);
  }
  return { ok: true, executedVolume, remainingVolume };
}

// §15.3: comparación con el baseline (A0 calendar-only del manifest congelado)
// por frontera: acción y cantidad solicitada. Las divergencias se conservan,
// no se suavizan.
function compareWithBaseline({ frozen, steps }) {
  const replay = runP6Replay(frozen.frozenBundles.a0, { runTimestampUtc: null });
  if (!replay?.ok) {
    return { status: "BASELINE_NOT_DERIVABLE", components: [], divergences: [], note: "el baseline del manifest congelado no corre; sin comparación (§15.3)." };
  }
  const baselineByFrontier = new Map(
    replay.replay.ledgers.decision.map((row) => [row.frontier, row]),
  );
  const components = steps.map((step) => {
    const baselineRow = baselineByFrontier.get(step.frontier) ?? null;
    return {
      frontier: step.frontier,
      shadowAction: step.recommendedAction,
      baselineAction: baselineRow?.action ?? null,
      shadowRequestedQuantity: step.requestedQuantity,
      baselineRequestedQuantity: baselineRow?.requestedQuantity ?? null,
      agreeActions: step.recommendedAction === (baselineRow?.action ?? null),
      agreeQuantities: step.requestedQuantity === (baselineRow?.requestedQuantity ?? null),
    };
  });
  const divergences = components
    .filter((component) => !component.agreeActions || !component.agreeQuantities)
    .map((component) => ({
      frontier: component.frontier,
      kind: !component.agreeActions ? "ACTION_DIVERGENCE" : "REQUESTED_QUANTITY_DIVERGENCE",
      shadow: component.shadowAction,
      baseline: component.baselineAction,
    }));
  return { status: "BASELINE_COMPARED", components, divergences };
}

// §15.3: comparación con el closed benchmark cuando esté disponible (closes
// diarios provistos por el caller). Sin disponibles → UNAVAILABLE, nunca un
// sustituto.
function compareWithClosedBenchmark({ benchmarkDailyCloses, steps }) {
  if (!Array.isArray(benchmarkDailyCloses)) {
    return {
      status: "UNAVAILABLE_AT_CLOSE",
      fillComparisons: [],
      note: "sin closed benchmark disponible al cierre; no se fabrica comparación (§15.3).",
    };
  }
  for (const close of benchmarkDailyCloses) {
    if (!close || !isNonEmptyString(close.date) || !isFiniteNumber(close.close)) {
      return {
        status: "INVALID_BENCHMARK_INPUT",
        fillComparisons: [],
        note: "closes de benchmark con date/close inválidos; la comparación no se fabrica.",
      };
    }
  }
  const closeByDate = new Map(benchmarkDailyCloses.map((close) => [close.date, close.close]));
  const fillComparisons = [];
  for (const step of steps) {
    const execution = step.hypotheticalExecution;
    const fill = execution?.fills?.[0] ?? null;
    if (!execution || !isFiniteNumber(fill?.quantity) || fill.quantity <= 0) {
      continue;
    }
    const benchmarkClose = closeByDate.get(step.frontier) ?? null;
    fillComparisons.push({
      frontier: step.frontier,
      hypotheticalExecutionPrice: fill.price,
      benchmarkClose,
      premiumDefined: benchmarkClose !== null,
      premium: benchmarkClose !== null ? fill.price - benchmarkClose : null,
    });
  }
  return {
    status: "COMPARED_TO_DAILY_REFERENCE_CLOSES",
    fillComparisons,
    note: "premium = precio hipotético del fill − close diario del benchmark; sin verdict económico: Shadow es evidencia, no admisión (§15.1).",
  };
}

// §12.2: el cierre del record produce un registro CLOSED NUEVO (el original
// no se edita; ambos se conservan append-only). El outcome declara la versión
// de benchmark utilizada al cierre; el reward queda pending de evaluación
// downstream (§14.6).
function closingOutcomeFor(benchmarkDailyCloses) {
  return {
    reward: null,
    benchmarkVersion: Array.isArray(benchmarkDailyCloses)
      ? "DAILY_REFERENCE_CLOSES_AT_SESSION_CLOSE"
      : "BENCHMARK_UNAVAILABLE_AT_CLOSE",
  };
}

// Cierre de la sesión Shadow: non-interference verificada, registros
// Experience cerrados (identidades nuevas, originales preservados),
// comparaciones por §15.3 y receipt content-addressed. Fail-closed ante
// sesión vacía, non-interference rota o progreso ajeno a la sesión.
export function closeShadowSession({ session, frozen, progress, records = [], steps = [], closedAtUtc, benchmarkDailyCloses = null, trainingEvents = null } = {}) {
  if (!Array.isArray(records) || records.length === 0) {
    return fail("EMPTY_SHADOW_CAPTURE", "Una sesión Shadow sin registros no produce evidencia; el cierre vacío no se fabrica (§15.3).");
  }
  const nonInterference = verifyShadowNonInterference({ session, frozen, records, steps, trainingEvents });
  if (!nonInterference.ok) {
    return fail(nonInterference.code, "El cierre exige non-interference verificada: se demuestra comparando, no afirmando (§25.1).", { nonInterference });
  }
  const opening = frozen.frozenBundles.a1.openingContract;
  const terminal = deriveTerminalState({ records, steps, openingObligation: opening.openingObligation });
  if (!terminal.ok) {
    return terminal;
  }
  if (!progress || progress?.sessionId !== session?.sessionId
    || progress?.sessionContentHash !== session?.contentHash
    || !isFiniteNumber(progress.executedVolume) || !isFiniteNumber(progress.remainingVolume)
    || progress.executedVolume !== terminal.executedVolume
    || progress.remainingVolume !== terminal.remainingVolume) {
    return fail("SHADOW_PROGRESS_INCONSISTENT", "El progreso del cierre no coincide con el estado terminal derivado de los pasos/registros capturados (§14.5/§12.2).");
  }
  const closedAt = toUtcTimestamp(closedAtUtc);
  if (!closedAt.ok) {
    return fail(closedAt.code ?? "MISSING_CLOSED_AT_UTC", "El cierre exige un closedAtUtc anclado a zona explícita (§6.1).");
  }

  const closedRecords = [];
  for (const record of records) {
    if (record?.recordState !== RECORD_STATES.OPEN) {
      return fail("RECORD_NOT_OPEN", `El registro ${record?.recordId ?? "?"} no está OPEN: el cierre consume la captura, no una doble edición (§12.2).`, { closedRecords });
    }
    const closed = closeExperienceRecord({
      record,
      outcome: closingOutcomeFor(benchmarkDailyCloses),
      nextState: record.nextState,
    });
    if (!closed.ok) {
      return fail("CLOSED_RECORD_BUILD_FAILED", `El registro ${record?.recordId ?? "?"} no cierra conforme §12.2.`, { errors: closed.errors });
    }
    closedRecords.push(closed.record);
  }

  const comparisons = {
    baseline: compareWithBaseline({ frozen, steps }),
    benchmark: compareWithClosedBenchmark({ benchmarkDailyCloses, steps }),
  };
  const terminalCoverage = {
    openingObligation: opening.openingObligation,
    executedVolume: terminal.executedVolume,
    remainingVolume: terminal.remainingVolume,
    unit: opening.unit,
    conservationDeclaration: "Opening = Executed(hypothetical) + Remaining (§14.5 sobre el estado hipotético Shadow)",
    status: terminal.remainingVolume === 0 ? "COVERED" : "COVERAGE_INCOMPLETE",
  };

  const core = {
    artifactKind: SHADOW_EVIDENCE_RECEIPT_KIND,
    schemaVersion: "1.0",
    receiptKind: "SHADOW_EVIDENCE_RECEIPT",
    sessionId: session.sessionId,
    experiment: session.experiment,
    campaignId: session.campaignId,
    policyVersion: session.policyVersion,
    synthetic: session.synthetic,
    closedAtUtc: closedAt.utc,
    originalRecordIds: records.map((record) => record.recordId),
    closedRecordIds: closedRecords.map((record) => record.recordId),
    stepCount: steps.length,
    stepsDigest: contentHashOf(steps),
    nonInterference: {
      verdict: nonInterference.code,
      checks: nonInterference.checks,
    },
    comparisons,
    terminalCoverage,
    corrections: [],
    dep22Scope: {
      dep22ClosedByThisReceipt: false,
      note: "DEP-22 [Shadow] se cierra con campañas prospectivas observadas de la versión; este receipt materializa el mecanismo de captura, su non-interference y la comparación al cierre. Sin evidencia Real; no basta para ningún nivel de autonomía (§15.1/§25.2).",
    },
  };
  const contentHash = contentHashOf(core);
  return { ok: true, receipt: Object.freeze({ ...core, contentHash }), closedRecords };
}

// §15.3/§25.1: las correcciones tardías viven en receipts SEPARADOS. La
// corrección referencia el registro corregido y declara el record corregido
// nuevo; el receipt original y sus registros no se tocan.
export function applyShadowCorrection({ receipt, correction } = {}) {
  if (!receipt || receipt.artifactKind !== SHADOW_EVIDENCE_RECEIPT_KIND) {
    return fail("RECEIPT_NOT_SHADOW_EVIDENCE", "La corrección aplica a un receipt de evidencia Shadow (§15.3).");
  }
  const { contentHash, ...core } = receipt;
  if (typeof contentHash !== "string" || contentHashOf(core) !== contentHash) {
    return fail("RECEIPT_CONTENT_HASH_MISMATCH", "El receipt residente no es el sellado; corrección sobre un receipt mutado no existe (§15.3).");
  }
  if (!correction || typeof correction !== "object" || Array.isArray(correction)
    || !isNonEmptyString(correction.reason)) {
    return fail("INVALID_CORRECTION", "Cada corrección lleva su razón (§15.3: revisiones y correcciones tardías conservadas por separado).");
  }
  if (!isNonEmptyString(correction.targetRecordId) || !receipt.originalRecordIds.includes(correction.targetRecordId)) {
    return fail("CORRECTION_TARGET_UNKNOWN", `targetRecordId ${correction.targetRecordId ?? null} no pertenece a los registros del receipt (fail-closed).`);
  }
  if (!isNonEmptyString(correction.correctedRecordId)) {
    return fail("CORRECTION_RECORD_MISSING", "La corrección declara el record corregido nuevo; sin él no hay corrección, sólo una nota.");
  }
  const correctedCore = {
    ...core,
    corrections: [...(core.corrections ?? []), { ...correction }],
  };
  const correctedHash = contentHashOf(correctedCore);
  return {
    ok: true,
    originalReceiptHash: receipt.contentHash,
    correctedReceipt: Object.freeze({ ...correctedCore, contentHash: correctedHash }),
  };
}
