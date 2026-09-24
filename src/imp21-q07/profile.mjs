// Entry-hour performance profile del experimento Q07 separado (IMP-21).
// Fuente: SPEC v1.1.1 §25.2.2 fila IMP-21, PRODUCES_EVIDENCE "DEP-17
// [experimento Q07]: ventanas/candidatos, métricas/buckets/muestra
// predeclarados y entry-hour profile bajo lógica/obligación/ejecución
// comparables"; §25.2.3 IMP-21 (bloqueo sin audit intradía); §25.1
// ("No fijar 11:00 ni settlement como hora óptima por documentación").
//
// El profile es descriptivo/informativo: no autoriza horas, no elige "óptima"
// y no concede autoridad operativa (§15). La suficiencia por bucket respeta
// el mínimo predeclarado; bajo el mínimo el estado es INSUFFICIENT_EVIDENCE,
// no se enmascara.

import { contentHashOf } from "../execution-contract/execution-contract.mjs";
import { verifyFrozenQ07Protocol, evaluateBucketPredicate } from "./protocol.mjs";
import { runQ07HourArm, assertHourArmsParity } from "./intraday-execution.mjs";
import { evaluateIntradayAuditGate, consumeIntradayAuditBinding } from "./gates.mjs";

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

// Suficiencia de muestra por bucket contra el mínimo predeclarado
// (§25.2.2 IMP-21: métricas/buckets/muestra predeclarados).
export function bucketSufficiencyOf({ observationCount, minObservations }) {
  if (!isFiniteNumber(observationCount) || observationCount < 0) {
    return { status: "INVALID_BUCKET_INPUT", eligible: false };
  }
  if (observationCount < minObservations) {
    return { status: "INSUFFICIENT_EVIDENCE_BELOW_MIN", eligible: false };
  }
  return { status: "SUFFICIENT", eligible: true };
}

// Construye el profile: corre cada brazo de hora, verifica paridad y
// produce H/V/delta por candidato con buckets predeclarados.
export function buildEntryHourProfile({ frozen = null, snapshotRegistry = null, intradayAudit = null, benchmarkB = null } = {}) {
  const frozenProtocol = frozen?.artifactKind === "IMP-21_Q07_PROTOCOL" ? frozen : frozen?.frozen ?? frozen;
  if (!frozenProtocol || frozenProtocol.artifactKind !== "IMP-21_Q07_PROTOCOL"
    || frozenProtocol.status !== "FROZEN_PRE_EXPERIMENT") {
    return { ok: false, code: "PROTOCOL_NOT_FROZEN", profile: null };
  }

  // Anti-mutación (§14.9): el perfil consume el protocolo congelado SÓLO si su
  // contentHash coincide con su contenido. Un contentHash falsificado o un
  // protocolo alterado post-freeze no alimenta la evaluación; así el
  // protocolContentHash emitido corresponde al contenido realmente usado.
  const verification = verifyFrozenQ07Protocol(frozenProtocol);
  if (!verification.ok) {
    return { ok: false, code: verification.code ?? "PROTOCOL_NOT_VERIFIED", profile: null };
  }

  // REQUIRES_AUDIT DEP-17 [data audit intradía]: sin audit aceptado de las
  // fuentes, la evaluación dependiente queda BLOQUEADA y el faltante se
  // conserva explícito (§25.2.3 IMP-21). No se fabrica profile con datos
  // no auditados.
  const gate = evaluateIntradayAuditGate({ intradayAudit });
  const auditConsumption = consumeIntradayAuditBinding({ gate });
  if (!gate.ok) {
    return {
      ok: false,
      code: "EVALUATION_BLOCKED_NO_INTRADAY_AUDIT",
      blocker: gate.blocker ?? gate.message ?? null,
      auditGate: gate,
      supportOnly: true,
      profile: null,
      remainingWork: "Materialización de soporte continúa (protocolo/fixtures/estructura causal); la evaluación depende del audit intradía (§25.2.3 IMP-21).",
    };
  }

  if (!isFiniteNumber(benchmarkB)) {
    return { ok: false, code: "INVALID_BENCHMARK_B", profile: null };
  }

  const arms = [];
  for (const candidate of frozenProtocol.candidates) {
    const arm = runQ07HourArm({ frozen: frozenProtocol, hourId: candidate.hourId, snapshotRegistry });
    if (!arm.ok) {
      return {
        ok: false,
        code: arm.code ?? "HOUR_ARM_FAILED",
        hourId: arm?.hourId ?? candidate.hourId,
        details: arm,
        profile: null,
      };
    }
    arms.push(arm);
  }

  const parity = assertHourArmsParity(arms);
  if (!parity.ok) {
    return { ok: false, code: parity.code ?? "HOUR_ARM_PARITY_BROKEN", hourId: parity.hourId ?? null, profile: null };
  }

  const hourRows = [];
  for (const arm of arms) {
    const V = benchmarkB - arm.H;
    const observationCount = arm.decisionSequence.length;
    const hourlyBuckets = [];
    for (const bucket of frozenProtocol.buckets) {
      const metric = frozenProtocol.metrics.find((item) => item.metricId === bucket.metricId);
      const evaluation = evaluateBucketPredicate({
        predicate: bucket.predicate,
        context: {
          deniedFillsCount: arm.deniedFills.length,
          coverageFraction: arm.coverageFraction,
          filledVolumeMw: arm.filledVolumeMw,
          observationCount: arm.decisionSequence.length,
          H: arm.H,
          V,
        },
      });
      const passes = evaluation.ok ? evaluation.passes : false;
      const bucketObservations = passes ? observationCount : 0;
      const sufficiency = bucketSufficiencyOf({ observationCount: bucketObservations, minObservations: frozenProtocol.minObservations });
      hourlyBuckets.push({
        bucketId: bucket.bucketId,
        metricId: bucket.metricId,
        metricKind: metric?.kind ?? null,
        passesMetric: passes,
        observedValue: evaluation.observedValue ?? null,
        sufficiency,
      });
    }
    hourRows.push({
      hourId: arm.hourId,
      kind: arm.kind,
      H: arm.H,
      V,
      deltaVsBenchmarkB: V,
      coverageFraction: arm.coverageFraction,
      fills: arm.fills,
      deniedFills: arm.deniedFills,
      observationCount,
      sufficiency: bucketSufficiencyOf({ observationCount, minObservations: frozenProtocol.minObservations }),
      buckets: hourlyBuckets,
    });
  }

  const referenceRow = frozenProtocol.referenceHourId
    ? hourRows.find((row) => row.hourId === frozenProtocol.referenceHourId) ?? null
    : null;
  for (const row of hourRows) {
    row.deltaVsReferenceHour = referenceRow && referenceRow.H !== null && row.hourId !== referenceRow.hourId
      ? row.H - referenceRow.H
      : null;
  }

  const profile = {
    artifactKind: "IMP-21_Q07_ENTRY_HOUR_PROFILE",
    protocolId: frozenProtocol.protocolId,
    protocolVersion: frozenProtocol.protocolVersion,
    protocolContentHash: frozenProtocol.contentHash,
    benchmarkBFrozen: benchmarkB,
    sampleBinding: { ...frozenProtocol.sampleBinding },
    hourRows,
    referenceHourId: frozenProtocol.referenceHourId ?? null,
    evaluatedAtImp: "IMP-21",
    auditConsumption,
    interpretationGuard: {
      noAutomaticHourSelection: "El profile DESCRIBE rendimiento por hora con criterios predeclarados; no declara hora óptima ni concede autoridad (§25.1; §16-18 requieren sus propios gates).",
      comparability: "Lógica/parámetros/obligación compartidos; sólo timing de ejecución varía entre candidatos (paridad verificada; §25.2.2 IMP-21).",
    },
    contentHash: null,
  };
  profile.contentHash = contentHashOf({
    hourRows: profile.hourRows.map((row) => ({ hourId: row.hourId, H: row.H, coverageFraction: row.coverageFraction, buckets: row.buckets.map((b) => ({ bucketId: b.bucketId, sufficiency: b.sufficiency.status })) })),
    referenceHourId: profile.referenceHourId,
  });

  return { ok: true, code: "Q07_ENTRY_HOUR_PROFILE_BUILT", profile };
}

// Guard explícito: el profile no emite ninguna fila marcada como "óptima" ni
// selección automática (§25.1 MUST NOT CHANGE).
export function assertProfileProducesNoSelection(profile) {
  if (!profile || profile.artifactKind !== "IMP-21_Q07_ENTRY_HOUR_PROFILE") {
    return { ok: false, code: "PROFILE_MISSING" };
  }
  const encoded = JSON.stringify(profile).toLowerCase();
  if (encoded.includes('"selectedhour"') || encoded.includes('"opthour"') || encoded.includes('"optimalhour"')) {
    return { ok: false, code: "SELECTION_LEAKED_INTO_PROFILE" };
  }
  return { ok: true, code: "NO_MANDATED_HOUR_SELECTION" };
}
