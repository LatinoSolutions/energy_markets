// Cuatro clases candidatas de rol de §11.6.1 y su contrato de admisión. Fuente:
// SPEC v1.1 §11.6.1 (tabla), §11.6.3 (evaluación inicial sin autoridad) y
// §11.6.4 (outcomes por rol y autoridad). Un componente no recibe un rol por
// defecto: el rol se declara explícitamente al registrar la evaluación, y la
// admisión de un rol no se extiende a otro. No existe S6 ni clasificación
// automática de JEV (§11.6, primer párrafo).

export const ROLE_CLASS = Object.freeze({
  STRATEGY_EVIDENCE: "STRATEGY_EVIDENCE",
  REPRESENTATION_LEARNING: "REPRESENTATION_LEARNING",
  ENGINEERING_ORCHESTRATION: "ENGINEERING_ORCHESTRATION",
  EXECUTION_GOVERNANCE: "EXECUTION_GOVERNANCE",
});

// Dominio del valor que cada rol puede reclamar. §11.6.3: una herramienta de
// ingeniería no demuestra edge de procurement, ni su throughput valida una
// Strategy. Ese límite se hace explícito para poder rechazar la etiqueta
// equivocada en lugar de confiar en que el autor no la use.
export const VALUE_DOMAIN = Object.freeze({
  PROCUREMENT_EDGE: "PROCUREMENT_EDGE",
  LEARNING_MECHANISM: "LEARNING_MECHANISM",
  OPERATIONAL: "OPERATIONAL",
  AUTHORITY_GOVERNANCE: "AUTHORITY_GOVERNANCE",
});

export const ROLE_CLASSES = Object.freeze({
  [ROLE_CLASS.STRATEGY_EVIDENCE]: Object.freeze({
    id: ROLE_CLASS.STRATEGY_EVIDENCE,
    label: "A. Strategy / Evidence Extension",
    section: "§11.6.1",
    comparatorScope:
      "Comparador research/baseline vigente para ese objeto; valor incremental bajo la disciplina canónica de experimentación y evaluación de procurement.",
    admissionContract:
      "Strategy / Capability Extension Contract de §8.7, incluidos datos PIT, refutación, redundancia y ablation cuando corresponda.",
    admissionContractSection: "§8.7",
    requiresStrategyAdmissionGate: true,
    requiresSeparateAuthorityValidation: false,
    valueDomain: VALUE_DOMAIN.PROCUREMENT_EDGE,
  }),
  [ROLE_CLASS.REPRESENTATION_LEARNING]: Object.freeze({
    id: ROLE_CLASS.REPRESENTATION_LEARNING,
    label: "B. Representation / Learning Component",
    section: "§11.6.1",
    comparatorScope:
      "Mecanismo de aprendizaje actual y baselines de aprendizaje/valor más simples; mejora medible sin vulnerar el Global Procurement Reward.",
    admissionContract: "Contratos de §§10–12, OOS/revalidación y límites de autoridad aplicables.",
    admissionContractSection: "§§10–12",
    requiresStrategyAdmissionGate: false,
    requiresSeparateAuthorityValidation: false,
    valueDomain: VALUE_DOMAIN.LEARNING_MECHANISM,
  }),
  [ROLE_CLASS.ENGINEERING_ORCHESTRATION]: Object.freeze({
    id: ROLE_CLASS.ENGINEERING_ORCHESTRATION,
    label: "C. Engineering / Orchestration Tool",
    section: "§11.6.1",
    comparatorScope:
      "Mecanismo existente para el trabajo: calidad, fiabilidad, throughput, coste, reproducibilidad u otra métrica operacional pertinente, predeclarada.",
    admissionContract: "Frontera de implementación y autoridad de la SPEC y del handoff Astra/Paperclip.",
    admissionContractSection: "§20.2",
    requiresStrategyAdmissionGate: false,
    requiresSeparateAuthorityValidation: false,
    valueDomain: VALUE_DOMAIN.OPERATIONAL,
  }),
  [ROLE_CLASS.EXECUTION_GOVERNANCE]: Object.freeze({
    id: ROLE_CLASS.EXECUTION_GOVERNANCE,
    label: "D. Execution / Governance Component",
    section: "§11.6.1",
    comparatorScope:
      "Mecanismo actual para la función y evidencia específica de seguridad/governance; no basta una mejora operacional o económica aislada.",
    admissionContract: "Revisión de autoridad y seguridad más estricta; validación separada de §§16–18 antes de conceder autoridad real.",
    admissionContractSection: "§§16–18",
    requiresStrategyAdmissionGate: false,
    requiresSeparateAuthorityValidation: true,
    valueDomain: VALUE_DOMAIN.AUTHORITY_GOVERNANCE,
  }),
});

export const ROLE_CLASS_IDS = Object.freeze(Object.keys(ROLE_CLASSES));

function fail(code, message, details = {}) {
  return { ok: false, code, message, ...details };
}

export function isRoleClassId(value) {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(ROLE_CLASSES, value);
}

export function resolveRoleClass(value) {
  if (!isRoleClassId(value)) {
    return fail("UNKNOWN_ROLE_CLASS", `"${value}" no es una de las cuatro clases candidatas de §11.6.1.`, {
      allowedRoleClasses: ROLE_CLASS_IDS,
    });
  }
  return { ok: true, roleClass: value, ...ROLE_CLASSES[value] };
}

export function canClaimProcurementEdge(roleClassId) {
  return roleClassId === ROLE_CLASS.STRATEGY_EVIDENCE;
}

export function roleRequiresStrategyAdmissionGate(roleClassId) {
  return ROLE_CLASSES[roleClassId]?.requiresStrategyAdmissionGate === true;
}

export function roleRequiresSeparateAuthorityValidation(roleClassId) {
  return ROLE_CLASSES[roleClassId]?.requiresSeparateAuthorityValidation === true;
}

// §11.6.3: la mejora de throughput de una herramienta de ingeniería no valida
// una Strategy ni se presenta como procurement edge. El claim se contrasta
// contra el dominio de valor del rol declarado.
export function validateValueClaimDomain(roleClassId, claimDomain) {
  const resolved = resolveRoleClass(roleClassId);
  if (!resolved.ok) {
    return resolved;
  }
  if (typeof claimDomain !== "string" || claimDomain.length === 0) {
    return fail("MISSING_VALUE_DOMAIN", "El claim de valor debe declarar su dominio.", { allowedValueDomains: Object.keys(VALUE_DOMAIN) });
  }
  if (!Object.prototype.hasOwnProperty.call(VALUE_DOMAIN, claimDomain)) {
    return fail("UNKNOWN_VALUE_DOMAIN", `"${claimDomain}" no es un dominio de valor declarado.`, {
      allowedValueDomains: Object.keys(VALUE_DOMAIN),
    });
  }
  if (claimDomain === VALUE_DOMAIN.PROCUREMENT_EDGE && !canClaimProcurementEdge(roleClassId)) {
    return fail(
      "PROCUREMENT_EDGE_NOT_ALLOWED",
      `El rol "${roleClassId}" no puede reclamar procurement edge (§11.6.1/§11.6.3).`,
      { roleClass: roleClassId, valueDomain: claimDomain },
    );
  }
  return { ok: true, roleClass: roleClassId, claimDomain };
}