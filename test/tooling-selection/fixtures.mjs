// Fixtures sintéticas para la selección de herramienta mínima suficiente
// (IMP-04). Componentes, capacidades, derechos y fixtures son explícitamente
// sintéticos: no representan herramientas reales, capacidades auditadas ni
// autorización alguna.

export function makeAssessment(overrides = {}) {
  const base = {
    componentId: "SYN-TOOL-A",
    componentVersion: "0.1.0",
    role: "Synthetic benchmark calculator.",
    interfaceContract: {
      inputs: ["SYN-input-price"],
      outputs: ["SYN-output-B"],
    },
    declaredCapabilities: ["benchmark.calculate", "reference.proxy"],
    usageRights: { status: "permitted", evidenceRef: "SYN-RIGHTS-1" },
    ipExposure: { assessment: "none", rationale: "Synthetic declaration; no proprietary model." },
    minimallyExtendable: false,
    limitations: [],
    evidenceRefs: [{ kind: "audit", ref: "SYN-AUDIT-1" }],
  };
  return { ...base, ...overrides };
}

export function makeReconciliation(componentId, overrides = {}) {
  return {
    componentId,
    reconciled: true,
    rejected: false,
    comparisons: [{ outputId: "SYN-output-B", observed: 105, expected: 105, agreed: true, tolerance: 0 }],
    mismatches: [],
    edgeAttributed: false,
    productionAuthority: false,
    requiresPermittedFixtures: true,
    ...overrides,
  };
}

export function makeOutputs(overrides = {}) {
  return [{ outputId: "SYN-output-B", value: 105, ...overrides }];
}

export function makeFixtures(overrides = {}) {
  return [
    {
      outputId: "SYN-output-B",
      expectedValue: 105,
      permitted: true,
      independentComputation: "SYN-independent-hand-calculation",
      ...overrides,
    },
  ];
}

export const SELECTION_EVIDENCE = [{ kind: "audit", ref: "SYN-AUDIT-SELECTION-1" }];
