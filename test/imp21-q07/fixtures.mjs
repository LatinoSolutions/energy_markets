// Fixtures sintéticas del experimento Q07 (IMP-21). Declaración: FIXTURES
// SINTÉTICAS — no son evidencia de edge ni de campaña real (§19; §14 IMP-13).
// Deben contrastarse a mano ANTES de codificar cada expected (orden interno
// IMP-13; aquí los valores esperados se derivan de las tablas del fixture).

import { contentHashOf } from "../../src/execution-contract/execution-contract.mjs";
import { freezeQ07Protocol } from "../../src/imp21-q07/protocol.mjs";

export const SYNTHETIC_DECLARATION = {
  fixtureNature: "SYNTHETIC",
  evidenceClaim: "NINGUNO: prueban estructura del protocolo Q07, no edge ni datos de campaña real",
};

export const SPEC_SHA256 = "c0b30937cbf668cf6335849132142077ef1ca39cd11774da83116596ec7b3a09";

// Obligación sintética: 60 MW (Gas Quarterly análogo §4.1, confirmado; NO es
// campaña real), 5 decisiones calendario, 12 MW/day, lote 12.
export const FIXTURE_OBLIGATION = {
  campaignId: "GAS-Q-FIXTURE-Q07-01",
  product: "GAS_QUARTERLY_FIXTURE",
  openingObligationMw: 60,
  windowStart: "2026-10-01",
  windowEnd: "2026-12-15",
  deadlineDate: "2026-12-15",
};

export const FIXTURE_DECISION_DATES = [
  "2026-10-02", "2026-10-09", "2026-10-16", "2026-10-23", "2026-10-30",
];

export const FIXTURE_CONTROLLER = {
  ruleId: "GAS_Q_FIXTURE_CONTROLLER_V1",
  contentHash: contentHashOf({ ruleId: "GAS_Q_FIXTURE_CONTROLLER_V1", lotSizeMw: 12, dailyCapMw: 12 }),
  lotSizeMw: 12,
  dailyCapMw: 12,
};

// Candidatos predeclarados: dos horas fijas y una ventana dinámica. No son
// horas "óptimas": son candidatos del test declarados ex-ante.
export const FIXTURE_CANDIDATES = [
  { hourId: "H_09_15", kind: "FIXED_HOUR_AND_MINUTES", hour: 9, minutes: 15 },
  { hourId: "H_13_45", kind: "FIXED_HOUR_AND_MINUTES", hour: 13, minutes: 45 },
  { hourId: "W_09_17", kind: "DYNAMIC_WINDOW", windowStartHour: 9, windowEndHour: 17 },
];

// Snapshots sintéticos intradía: dos snapshot por día de decisión, precios
// alrededor de 11.00 y 12.00. 11:00 es SÓLO un dato del fixture, no una
// preferencia normativa.
function snap(date, time, price, id) {
  return { snapshotId: id, asOfUtc: `${date}T${time}:00Z`, priceEurPerMwh: price };
}

export const FIXTURE_SNAPSHOTS = [
  snap("2026-10-02", "08:00", 34.0, "S1-1"),
  snap("2026-10-02", "12:00", 33.0, "S1-2"),
  snap("2026-10-09", "08:00", 36.0, "S2-1"),
  snap("2026-10-09", "12:00", 35.0, "S2-2"),
  snap("2026-10-16", "08:00", 31.0, "S3-1"),
  snap("2026-10-16", "12:00", 30.0, "S3-2"),
  snap("2026-10-23", "08:00", 37.0, "S4-1"),
  snap("2026-10-23", "12:00", 36.0, "S4-2"),
  snap("2026-10-30", "08:00", 34.0, "S5-1"),
  snap("2026-10-30", "12:00", 33.0, "S5-2"),
];

// Expected a mano (IMP-13: cálculo independiente antes del test):
// cantidad por BUY: min(remaining/opp, cap) floored a lote 12 → 12 MW/día.
// 5 decisiones × 12 MW = 60 MW cubiertos si hay snapshot causal.
// H_09_15 usa precio 08:00 (causal): filas S*-1 → H = 12*(34+36+31+37+34) = 2064.
// H_13_45 usa precio 12:00 → H = 12*(33+35+30+36+33) = 2004.
// W_09_17 usa último snapshot dentro de 9..17 → el de 12:00 → H = 2004.
export const EXPECTED_HARM_BY_HOUR_ID = {
  H_09_15: { H: 2064, filledVolumeMw: 60, coverageFraction: 1, fills: 5 },
  H_13_45: { H: 2004, filledVolumeMw: 60, coverageFraction: 1, fills: 5 },
  W_09_17: { H: 2004, filledVolumeMw: 60, coverageFraction: 1, fills: 5 },
};

export const FIXTURE_BENCHMARK_B = 2400;

export function createSyntheticIntradayAudit() {
  return {
    auditScope: "DEP-17_INTRA_DAY_DATA_AUDIT",
    status: "ACCEPTED",
    producedByImp: "IMP-03",
    sourcesAreCovered: true,
    contentHash: contentHashOf({ sourcesAreCovered: true }),
    declaredSource: "FIXTURE (sintetica): sólo estructura del gate, no audit real",
  };
}

export function freezeSyntheticProtocol(overrides = {}) {
  const base = {
    artifactKind: "IMP-21_Q07_PROTOCOL",
    protocolId: "Q07_INTRA_DAY_ENTRY_HOUR",
    protocolVersion: "v1.0.0",
    specSha256: SPEC_SHA256,
    createdFromImp: "IMP-21",
    obligationBinding: { ...FIXTURE_OBLIGATION },
    controllerBinding: {
      ruleId: FIXTURE_CONTROLLER.ruleId,
      contentHash: FIXTURE_CONTROLLER.contentHash,
      lotSizeMw: FIXTURE_CONTROLLER.lotSizeMw,
      dailyCapMw: FIXTURE_CONTROLLER.dailyCapMw,
    },
    decisionDates: [...FIXTURE_DECISION_DATES],
    candidates: FIXTURE_CANDIDATES.map((candidate) => ({ ...candidate })),
    metrics: [
      { metricId: "CONTAINS_DENIALS", kind: "BOOLEAN", description: "el brazo quedó con fills denegados por snapshot causal ausente" },
      { metricId: "COVERAGE_COMPLETE", kind: "BOOLEAN", description: "cobertura del volumen solicitado completa" },
    ],
    buckets: [
      { bucketId: "B_NO_DENIED", metricId: "CONTAINS_DENIALS", predicate: ({ arm }) => arm.deniedFills.length === 0 },
      { bucketId: "B_COVERAGE_COMPLETE", metricId: "COVERAGE_COMPLETE", predicate: ({ arm }) => arm.coverageFraction === 1 },
    ],
    minObservations: 5,
    sampleBinding: {
      source: "SYNTHETIC_FIXTURE_GAS_Q_2026",
      contentHash: contentHashOf(SYNTHETIC_DECLARATION),
      oosPolicy: "SAMPLE_ONLY_DEVELOPMENT",
    },
    referenceHourId: "H_09_15",
    allowedTimingChange: { kind: "INTRADAY_ENTRY_TIMING_ONLY" },
  };
  return freezeSyntheticMerged(base, overrides);
}

function freezeSyntheticMerged(base, overrides) {
  const merged = { ...base, ...overrides };
  const outcome = freezeQ07Protocol(merged);
  if (!outcome.ok) {
    throw new Error(`FIXTURE protocolo sintético inválido: ${outcome.code}`);
  }
  return outcome.frozen;
}

// Protocolo sintético congelado, listo para correr.
export function createSyntheticFrozenProtocol(overrides = {}) {
  return freezeSyntheticProtocol(overrides);
}

// A partir de un objeto frozen, muta el campo pedido (para validaciones
// negativas). Devuelve el objeto MUTADO SIN RE-HASHEAR: la verificación del
// hash es la herramienta anti-mutación (§14.9), re-hash sería esconder la
// mutación.
export function mutateFrozen(frozen, mutator) {
  const mutado = { ...frozen };
  mutator(mutado);
  return mutado;
}

