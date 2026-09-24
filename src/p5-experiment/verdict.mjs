// Veredicto de research del experimento P5 sobre la serie Delta V. Fuente:
// SPEC v1.1.1 §5.6 (fórmulas de scoring), §5.7 (mínima evidencia Quarterly),
// §5.8 (PASS/HOLD/FAIL/INVALID con gates predeclarados; FAIL/HOLD/INVALID no
// se ocultan), §13.9 (refutación por ΔV con B compartido) y §25.2 fila
// IMP-16 (DEP-13/14: "resultado A0/A1, Delta V, métricas, costes,
// concentración/estabilidad y verdict con límites").
//
// El veredicto evalúa la serie V_q = Delta V por trimestre (mejora de A1
// frente a A0 con B compartido): mu > 0 exige mejora; el screen Sortino > 1
// estricto es el predeclarado en §5.6. Los umbrales NO se re-cablean: vienen
// del módulo scoring de IMP-08 (quarterlyResearchVerdict), que no fabrica
// PASS. La calidad de datos tampoco se auto-atestúa: se DERIVA del manifest
// congelado y de los runs reales (§5.8, §13.6 regla 5).

import {
  scoreQuarterly,
  minimumEvidence,
  quarterlyResearchVerdict,
} from "../economic-calculation/scoring.mjs";

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

const CAMPAIGN_ID_PATTERN = /^GAS-Q-(\d{4})Q[1-4]$/;

// Serie de ΔV por campaña OOS sellada para el scoring Quarterly. Cada entrada
// proviene de un run real de IMP-16 (run receipt id + ΔV definido con B
// compartido); una entrada sin esos mínimos no entra a la población (§5.6 no
// se mascara).
export function deltaVSeriesFromRuns({ series = [] } = {}) {
  const values = [];
  const problems = [];
  for (const [index, entry] of series.entries()) {
    if (!entry || typeof entry !== "object" || typeof entry.campaignId !== "string") {
      problems.push(`series[${index}]: sin campaignId`);
      continue;
    }
    if (!isFiniteNumber(entry.deltaV)) {
      problems.push(`series[${index}] (${entry.campaignId}): deltaV indefinido o no finito — no entra a la población (§5.6)`);
      continue;
    }
    values.push({ campaignId: entry.campaignId, runReceiptId: entry.runReceiptId ?? null, deltaV: entry.deltaV });
  }
  return { values, problems };
}

// Calidad de datos del veredicto, derivada (no declarada a mano):
//  - benchmarkProvisional: true si el benchmark congelado no está
//    reconciliado oficial o si P5.6 tiene parámetros sin evidencia auditada
//    (§13.6 regla 5 + §14.10 BENCHMARK_PROVISIONAL).
//  - coverage: "full" sólo si AMBOS brazos terminan COVERED; si no,
//    "incomplete" (§5.8: la cobertura incompleta no se compensa).
export function deriveDatasetQuality({ frozen = null, runOutcome = null } = {}) {
  if (!frozen || frozen.artifactKind !== "IMP-16_P5_EXPERIMENT_MANIFEST") {
    return {
      ok: false,
      dataQuality: { coverage: "incomplete", benchmarkProvisional: true, declaredScope: null },
      problems: ["MISSING_FROZEN_EXPERIMENT"],
      detail: { coverageStatuses: [] },
    };
  }
  const benchmarkUnreconciled = frozen.benchmark.status !== "RECONCILED_OFFICIAL";
  const p56Blockers = frozen.execution?.p56Validity?.blockers ?? [];
  const benchmarkProvisional = benchmarkUnreconciled || p56Blockers.length > 0;
  const coverageStatuses = ["A0", "A1"].map((armId) =>
    runOutcome?.arms?.[armId]?.evaluation?.coverage?.status ?? null);
  const bothCovered = coverageStatuses.length === 2
    && coverageStatuses.every((status) => status === "COVERED");
  return {
    ok: true,
    dataQuality: {
      coverage: bothCovered ? "full" : "incomplete",
      benchmarkProvisional,
      declaredScope: frozen.scope,
    },
    problems: [],
    detail: { benchmarkUnreconciled, p56Blockers: p56Blockers.map((blocker) => blocker.parameter), coverageStatuses },
  };
}

// Evaluación de research P3 sobre la serie ΔV. Cada entry de la serie es un
// quarter OOS sellado (un V_q del experimento, §13.9); los años calendario se
// derivan del campaignId canónico GAS-Q-YYYYQn (identidad determinista
// P-006, record IMP-02). La evidencia mínima §5.7 (≥8 trimestres, ≥2 años)
// se verifica contra la población real puntuada.
export function p5ResearchEvaluation({ series = [], dataQuality = null } = {}) {
  const assembled = deltaVSeriesFromRuns({ series });
  if (assembled.problems.length > 0) {
    return {
      ok: false,
      code: "DELTA_V_SERIES_ISSUES",
      issues: assembled.problems,
      scoring: null,
      verdict: "HOLD",
      verdictReason: "La serie ΔV tiene entradas malformadas o indefinidas: HOLD, sin PASS fabricado (§5.7).",
    };
  }

  const quarterValues = assembled.values.map((entry) => entry.deltaV);
  const scoring = scoreQuarterly(quarterValues);

  const calendarYears = new Set(
    assembled.values
      .map((entry) => (CAMPAIGN_ID_PATTERN.test(entry.campaignId) ? Number(entry.campaignId.slice(6, 10)) : null))
      .filter((year) => year !== null),
  );
  const evidence = {
    mission: "Quarterly",
    quartersCompleted: scoring.nTotal,
    calendarYearsCovered: calendarYears.size,
    populationMission: "Quarterly",
    products: ["Gas"],
  };
  // Evidencia mínima predeclarada (§5.7); el resultado queda explícito y se
  // cruza con la población puntuada en quarterlyResearchVerdict.
  const minimum = minimumEvidence({
    mission: "Quarterly",
    quartersCompleted: evidence.quartersCompleted,
    calendarYearsCovered: evidence.calendarYearsCovered,
  });
  const evidenceForVerdict = {
    ...evidence,
    minimumEvidenceMet: minimum.minimumEvidenceMet,
  };
  // dataQuality (coverage + benchmarkProvisional) proviene de
// deriveDatasetQuality (derivada del frozen + runs reales); sin él el
// veredicto no puede declarar cobertura full ni benchmark no-provisional.
  const verdict = quarterlyResearchVerdict({
    scoring,
    dataQuality,
    evidence: evidenceForVerdict,
  });

  return {
    ok: true,
    code: "P3_DELTA_V_EVALUATION_COMPLETED",
    scoring,
    minimumEvidence: minimum,
    dataQuality,
    campaignYearsDerived: [...calendarYears].sort((left, right) => left - right),
    verdict: verdict.verdict,
    verdictReason: verdict.reason,
    limits: {
      sortinoScreenAuthority: "§5.6 Sortino > 1 estricto, denominador n-1, target 0, sin epsilon",
      note: "El veredicto acompaña los límites del resultado real: FAIL/HOLD/INVALID no se ocultan ni se convierten en PASS para cerrar un gate posterior (§25.2 DEP-13/14).",
    },
  };
}
