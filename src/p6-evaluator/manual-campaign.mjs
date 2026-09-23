// Campaign manual end-to-end y comparativa manual/evaluator (IMP-15). Fuente:
// SPEC v1.1.1 §25.1 fila IMP-15 ("Closure receipt P6, comparativa
// manual/evaluator"; acuerdos: "volumen/costes cuadran, vistas separadas,
// paridad, cero convenience fills; B/H/V/coverage manual coinciden"), §25.2
// fila IMP-15 ("coincidencia manual/evaluator en B/H/V/coverage para la
// campaña"), §14.6 (H derivado del execution ledger; V conserva B−H en
// unidades compatibles; cobertura se presenta separada), §14.5 (opening =
// executed + remaining) y §13.6/§5.5 (cada coste entra una sola vez; unknown
// nunca cero; H exige la lista de costes completa).
//
// Este módulo es la vía INDEPENDIENTE del closure: la evaluación manual parte
// de filas capturadas a mano (no de los ledgers del replay) y usa aritmética
// propia; la evaluación derivada del run parte de los ledgers reales del run.
// El comparador exige coincidencia en B, H, V y coverage; cualquier
// divergencia queda explícita y no se suaviza.

import { computeV } from "../economic-calculation/bhv.mjs";
import { benchmarkBFromRows } from "../economic-calculation/benchmark.mjs";
import { contentHashOf } from "../execution-contract/execution-contract.mjs";

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

const H_UNIT = "EUR/MWh";

// --- Evaluación manual independiente -----------------------------------------

// Evaluación manual de la campaña a partir de una captura escrita a mano:
// fills con precio y costes unitarios conocidos por fill, y closes diarios de
// benchmark seleccionados a mano (ventana ya decidida por quien captura).
// No consume ledgers del replay (§14.6: H se reconcilia aquí por su propio
// camino; la coincidencia con el run se prueba después en el comparador).
export function evaluateCampaignManually({ manualFills, benchmarkCloses, openingObligation, unit = "MW", manualBenchmarkWindow = null } = {}) {
  const errors = [];
  const reasons = [];

  if (!Array.isArray(manualFills) || !Array.isArray(benchmarkCloses)
    || !isFiniteNumber(openingObligation) || !isNonEmptyString(unit)) {
    return { ok: false, code: "INVALID_MANUAL_INPUT", errors: ["La captura manual exige lista de fills, closes de benchmark, opening obligation y unit."], provided: { pending: true } };
  }
  if (manualFills.length === 0) {
    errors.push("La captura manual no declara ningún fill: una campaña manual vacía no demuestra el cierre (no se inventa coverage).");
  }
  if (benchmarkCloses.length === 0) {
    errors.push("La captura manual no declara closes de benchmark: B se queda undefined (no se rellena con cero, §5.3).");
  }

  let executed = 0;
  let notional = 0;
  const manualCostTotals = {};
  const manualCostRows = [];
  for (const [index, fill] of manualFills.entries()) {
    if (!isFiniteNumber(fill?.price) || !isFiniteNumber(fill?.filledQuantity) || fill.filledQuantity <= 0
      || !isNonEmptyString(fill?.decisionDate)) {
      errors.push(`manualFills[${index}] inválido: exige decisionDate, price y filledQuantity > 0.`);
      continue;
    }
    executed += fill.filledQuantity;
    notional += fill.filledQuantity * fill.price;
    for (const cost of fill.knownUnitCosts ?? []) {
      if (!isNonEmptyString(cost?.costId) || !isFiniteNumber(cost?.amount) || cost.amount < 0
        || cost.unit !== H_UNIT) {
        errors.push(`manualFills[${index}] coste inválido: exige costId, amount >= 0 y unit "${H_UNIT}"; sin eso no entra a H.`);
        continue;
      }
      // Cada coste aplicado a este fill entra una sola vez; acumular por fill
      // es exactamente una aplicación (§13.6/§14.4).
      const costEur = cost.amount * fill.filledQuantity;
      manualCostTotals[cost.costId] = (manualCostTotals[cost.costId] ?? 0) + costEur;
      manualCostRows.push({ decisionDate: fill.decisionDate, costId: cost.costId, costEur, countedOnce: true });
    }
  }

  const remaining = openingObligation - executed;
  if (remaining < 0) {
    reasons.push("La captura manual ejecuta más que la obligación de apertura: no concilia (§14.5).");
  }

  // B manual: media con peso diario igual de los closes de la ventana (§5.3).
  const finiteCloses = benchmarkCloses.filter((close) => isFiniteNumber(close?.selected ?? close));
  const closeCount = finiteCloses.length;
  if (closeCount === 0) {
    errors.push("Ningún close de benchmark es finito: B indefinido (no se rellena).");
  }
  const closingSum = finiteCloses.reduce((sum, close) => sum + (close.selected ?? close), 0);
  const B = closeCount > 0 ? closingSum / closeCount : null;

  // H manual: coste all-in unitario = (notional + costes EUR totales) / volumen
  // ejecutado (§14.6: H derivado del execution path; §5.5).
  const costsEurTotal = manualCostRows.reduce((sum, row) => sum + row.costEur, 0);
  let H = null;
  if (executed > 0 && Number.isFinite(notional + costsEurTotal)) {
    H = (notional + costsEurTotal) / executed;
  } else if (executed === 0) {
    errors.push("Volumen ejecutado manual 0: H no está definido (no se mascara).");
  }

  const V = computeV({ B, BUnit: H_UNIT, H, HUnit: H_UNIT });
  const coverageStatus = remaining === 0 ? "COVERED" : "COVERAGE_INCOMPLETE";

  const manualEvaluation = {
    ok: errors.length === 0,
    errors: [...errors, ...reasons],
    source: "MANUAL_CAPTURE",
    unit,
    B,
    H,
    V: V.V,
    vDefined: V.defined,
    costsByKindEur: { ...manualCostTotals },
    costsCountedOnceRows: manualCostRows,
    coverage: {
      openingObligation,
      executedVolume: executed,
      remainingVolume: remaining,
      unit,
      status: remaining === 0 ? "COVERED" : "COVERAGE_INCOMPLETE",
    },
    manualBenchmarkWindow: manualBenchmarkWindow,
  };
  if (manualBenchmarkWindow === null) {
    delete manualEvaluation.manualBenchmarkWindow;
  }
  return manualEvaluation;
}

// --- Evaluación B/H/V/coverage derivada del run -----------------------------

// §14.6 + §14.10: la evaluación de la campaña se deriva de los ledgers reales
// del run (H desde el execution ledger y sus costes KNOWN; B del benchmark
// consumido únicamente para evaluación; coverage del terminal ledger). Es la
// evaluación del evaluator; su coincidencia con la vía manual se prueba en el
// comparador de abajo.
export function evaluateCampaignFromRun({ replayOutcome, benchmarkRows, product = null, windowStart = null, windowEnd = null, expectedBenchmarkDates = null } = {}) {
  if (!replayOutcome || typeof replayOutcome !== "object" || replayOutcome.ok !== true || !replayOutcome.replay) {
    return { ok: false, code: "MISSING_REPLAY_OUTCOME", message: "La evaluación de campaña se deriva del outcome real de runP6Replay (§14.1)." };
  }
  if (!Array.isArray(benchmarkRows)) {
    return { ok: false, code: "MISSING_BENCHMARK_ROWS", message: "B se evalúa del benchmark consumido para evaluación (§14.6); sin filas no hay B (no relleno)." };
  }

  const replay = replayOutcome.replay;
  const executionRows = replay.ledgers.execution;
  const unit = replay.terminalCoverage.unit;

  let executedVolume = 0;
  let notional = 0;
  const costsByKindEur = {};
  for (const row of executionRows) {
    if (row.noFill === true || !isFiniteNumber(row.executionPrice) || !isFiniteNumber(row.filledQuantity) || row.filledQuantity <= 0) {
      continue;
    }
    executedVolume += row.filledQuantity;
    notional += row.filledQuantity * row.executionPrice;
    for (const cost of row.executionCosts ?? []) {
      if (cost.status === "KNOWN" && cost.countedOnce === true && isFiniteNumber(cost.amount) && cost.unit === H_UNIT) {
        costsByKindEur[cost.costId] = (costsByKindEur[cost.costId] ?? 0) + cost.amount * row.filledQuantity;
      }
    }
  }

  const openingObligation = replay.terminalCoverage.openingObligation;
  const remainingVolume = replay.terminalCoverage.remainingVolume;

  let H = null;
  if (executedVolume > 0 && Number.isFinite(notional)) {
    H = notional / executedVolume; // precio bruto medio
    const costsEurTotal = Object.values(costsByKindEur).reduce((sum, value) => sum + value, 0);
    H = (H * executedVolume + costsEurTotal) / executedVolume;
  }

  const benchmark = benchmarkBFromRows({
    rows: benchmarkRows,
    product,
    windowStart,
    windowEnd,
    requireAccessible: false,
  });
  const B = benchmark.B;

  const V = computeV({ B, BUnit: H_UNIT, H, HUnit: H_UNIT });

  return {
    ok: true,
    source: "P6_RUN_LEDGERS",
    evaluatorId: replay.receipt.evaluatorId,
    runReceipt: replay.receipt,
    unit,
    B,
    benchmarkCount: benchmark.count,
    benchmarkCoverage: benchmark.coverage ?? (expectedBenchmarkDates === null ? null : `${benchmark.count}/${expectedBenchmarkDates}`),
    H,
    V: V.V,
    vDefined: V.defined,
    costsByKindEur,
    coverage: {
      openingObligation,
      executedVolume,
      remainingVolume,
      unit,
      status: remainingVolume === 0 ? "COVERED" : "COVERAGE_INCOMPLETE",
      coverageStatusFromRun: replay.terminalCoverage.coverageStatus,
      runStatus: replay.status,
    },
  };
}

// --- Comparativa manual/evaluator -------------------------------------------------

// §25.1/§25.2 IMP-15: coincidencia manual/evaluator en B/H/V/coverage. La
// comparación exige que AMBAS vías produzcan valores definidos; una sola vía
// definida no prueba paridad (fail-closed). Una divergencia no se corrige aquí:
// queda como item de comparativa falsa y el gate no cierra.
export function compareManualVsEvaluator({ manualEvaluation, campaignEvaluation, tolerance = 1e-9 } = {}) {
  if (!manualEvaluation?.ok || !campaignEvaluation?.ok) {
    const manualOk = manualEvaluation?.ok === true ? "ok" : (manualEvaluation?.provided?.pending === true ? "pendiente-de-captura" : "errores");
    const runOk = campaignEvaluation?.ok === true ? "ok" : "errores";
    return {
      ok: false,
      code: "EVALUATIONS_NOT_READY",
      message: `La comparativa exige evaluación manual (${manualOk}) y evaluación derivada del run (${runOk}) completas.`,
      components: [],
    };
  }

  const components = [];
  const numeric = (name, manual, evaluator, unit) => {
    const agreed = isFiniteNumber(manual) && isFiniteNumber(evaluator)
      && Math.abs(manual - evaluator) <= tolerance;
    components.push({ component: name, manual, evaluator, unit, agree: agreed });
  };
  const categorical = (name, manualValue, evaluatorValue) => {
    components.push({ component: name, manual: manualValue, evaluator: evaluatorValue, agree: manualValue === evaluatorValue });
  };

  categorical("coverage.executedVolume", manualEvaluation.coverage.executedVolume, campaignEvaluation.coverage.executedVolume);
  categorical("coverage.remainingVolume", manualEvaluation.coverage.remainingVolume, campaignEvaluation.coverage.remainingVolume);
  categorical("coverage.status", manualEvaluation.coverage.status, campaignEvaluation.coverage.status);
  numeric("H", manualEvaluation.H, campaignEvaluation.H, H_UNIT);
  numeric("B", manualEvaluation.B, campaignEvaluation.B, H_UNIT);
  numeric("V", manualEvaluation.V, campaignEvaluation.V, H_UNIT);

  const agreeAll = components.every((component) => component.agree === true);
  return {
    ok: agreeAll && manualEvaluation.ok === true && campaignEvaluation.ok === true,
    code: agreeAll ? "MANUAL_EVALUATOR_AGREEMENT" : "MANUAL_EVALUATOR_MISMATCH",
    components,
    declared: {
      manualSource: manualEvaluation.source,
      evaluatorSource: campaignEvaluation.source,
    },
  };
}

// Content digest de la comparativa para materializarla en el closure receipt
// sin duplicar sus componentes completos.
export function manualComparisonDigest(manualComparison) {
  if (!manualComparison || typeof manualComparison !== "object") return null;
  return contentHashOf({ components: manualComparison.components, code: manualComparison.code });
}
