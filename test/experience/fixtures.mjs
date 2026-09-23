// Fixtures sintéticos para tests de Experience (IMP-17). Ninguno son datos
// reales del cliente; todos marcan synthetic: true, y conforme a la nota
// §25.2 fila IMP-17 no generan Real Experience ni cierran DEP-22.

const PROVENANCE = {
  authority: "test-fixture (sintético, IMP-17)",
  locator: "test/experience/fixtures.mjs",
};

export function syntheticSnapshot(overrides = {}) {
  return {
    frontierUtc: "2026-01-05T11:00:00Z",
    frontierDate: "2026-01-05",
    pitReferences: [],
    dataReference: {
      kind: "PIT_DATA_MANIFEST",
      manifestId: "FIXTURE-MANIFEST",
      manifestVersion: "v1",
    },
    ...overrides,
  };
}

// Record Replay sintético (simulated Experience) con fill simulado.
export function syntheticReplayRecord(overrides = {}) {
  return {
    artifactKind: "EXPERIENCE_RECORD",
    recordState: "OPEN",
    sourceType: "REPLAY",
    policyVersion: "policy-v1",
    stateSnapshot: syntheticSnapshot(),
    strategyOutputs: [],
    recommendedAction: "BUY",
    execution: {
      executedAction: "BUY",
      fills: [{
        evidenceKind: "SIMULATED_FILL",
        quantity: 10,
        price: 24.35,
        timestampUtc: "2026-01-05T11:04:00Z",
      }],
    },
    nextState: {
      source: "test-fixture",
      executedVolume: 10,
      remainingVolume: 50,
      unit: "MW",
    },
    recommendedAtUtc: "2026-01-05T11:00:00Z",
    recordedAtUtc: "2026-01-05T11:05:00Z",
    synthetic: true,
    provenance: {
      kind: "test-fixture-assertion",
      ...PROVENANCE,
    },
    ...overrides,
  };
}

// Record Shadow sintético: recomendación emitida antes de conocer el mercado
// posterior, fills hipotéticos siguen simulados (§12.1).
export function syntheticShadowRecord(overrides = {}) {
  return syntheticReplayRecord({
    sourceType: "SHADOW",
    ...overrides,
  });
}

// Record Real sintético: NOTE — la fixtures lo marca synthetic:true, que el
// schema prohíbe cruzar con REAL_EXECUTION (§25.2 nota). Para probar el sello
// Real legítimo el test construye el objeto a mano con realExecutionEvidence;
// eso es una PRUEBA del schema, no Real Experience generada por el test.
export function syntheticRealRecord(overrides = {}) {
  return {
    ...syntheticReplayRecord({ ...overrides }),
    sourceType: "REAL_EXECUTION",
    synthetic: false,
    provenance: {
      kind: "REAL_EXECUTIONLedger",
      realExecutionEvidence: {
        authority: "frozen synthetic-evidence (schema test only)",
        effectiveActionRef: "ref-effective-action-1",
      },
    },
    ...overrides,
  };
}
