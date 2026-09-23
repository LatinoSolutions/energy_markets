// Superficie pública del cálculo económico de IMP-08 / ST-08.2. Fuente: SPEC
// v1.1 §§5.1–5.8, 6.1 y 19.3.1. Funciones genéricas de cálculo sintético de
// referencia/benchmark, B/H/V y scoring; no hay búsqueda de resultados
// esperados, despacho por fixture ni verificación del oráculo dentro del
// módulo. H es un valor all-in suministrado; no se implementa ninguna fórmula
// de ledger real.

export { proxyReference, selectDailyReference } from "./reference.mjs";

export {
  benchmarkB,
  benchmarkBFromRows,
  classifyOfficialValidity,
  isDecisionConsumable,
  isWithinFallbackWindow,
  isWithinWindow,
  selectBenchmarkReferences,
} from "./benchmark.mjs";

export { classifyCoverage, computeAllInH, computeTotalEur, computeV } from "./bhv.mjs";

export {
  cDiagnostic,
  minimumEvidence,
  monthlyDiagnostics,
  quarterlyResearchVerdict,
  scoreQuarterly,
} from "./scoring.mjs";
