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
      capabilityOutputs: {
        "benchmark.calculate": ["SYN-output-B"],
        "reference.proxy": ["SYN-output-B"],
      },
    },
    declaredCapabilities: ["benchmark.calculate", "reference.proxy"],
    usageRights: { status: "permitted", evidenceRef: "SYN-RIGHTS-1" },
    ipExposure: { assessment: "none", rationale: "Synthetic declaration; no proprietary model." },
    minimallyExtendable: false,
    extensionRationale: "SYN-extension-rationale",
    limitations: [],
    evidenceRefs: [{ kind: "audit", ref: "SYN-AUDIT-1" }],
  };
  return { ...base, ...overrides };
}

// La reconciliación se aporta como evidencia cruda (salidas reales del
// componente + fixtures permitidos), no como resultado declarado: el validador
// recalcula con `reconcileKeyOutputs` y no confía en `agreed:true` escrito a
// mano.
export function makeReconciliationEvidence(componentId, overrides = {}) {
  return {
    componentId,
    outputs: makeOutputs(),
    fixtures: makeFixtures(),
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

// Inventario sintético del soporte: exactamente los componentes auditados.
export function inventoryOf(assessments) {
  return {
    componentIds: assessments.map((assessment) => assessment.componentId),
    evidenceRefs: [{ kind: "audit", ref: "SYN-INVENTORY-1" }],
  };
}
