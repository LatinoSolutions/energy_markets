// Decisión de herramienta mínima suficiente (IMP-04). Fuente: SPEC v1.1.1 §6.4
// ("reutilizar un componente suficiente; añadir únicamente lo que falta si es
// casi suficiente; construir un engine completo sólo si la auditoría demuestra
// necesidad. Esta decisión de tooling no concede autoridad de producción"),
// §20.1 y §25.1 IMP-04 (MUST NOT CHANGE: P4.5; no elección por preferencia
// tecnológica ni exposición de IP implícita). Este módulo materializa el
// framework audit-first: deriva la decisión de assessments auditados y falla
// explícitamente cuando la evidencia no alcanza para elegir. Las assessments de
// herramientas reales del entorno viven en ./real-tooling.mjs (entregable
// DEP-10); aquí sólo se consume su contrato.

import {
  outputsForCapability,
  validateEvidenceRef,
  evaluateCapabilityCoverage,
  isCapabilityAssessmentUsable,
  validateCapabilityAssessment,
} from "./capability.mjs";
import { isDeepStrictEqual } from "node:util";

import { reconcileKeyOutputs } from "./reconciliation.mjs";

export const TOOLING_DECISION = Object.freeze({
  REUSE: "REUSE",
  EXTEND: "EXTEND",
  BUILD: "BUILD",
});

// §25.1 IMP-04: la elección no puede fundarse en preferencia tecnológica.
export const SELECTION_BASIS = Object.freeze({
  AUDIT: "audit",
  PREFERENCE: "preference",
});

export const NO_PRODUCTION_AUTHORITY = "NONE_TOOLING_SELECTION";

function fail(code, message, details = {}) {
  return { ok: false, code, message, ...details };
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function isNonEmptyList(value) {
  return Array.isArray(value) && value.length > 0;
}

function hasDuplicates(list) {
  return new Set(list).size !== list.length;
}

// Igualdad de conjuntos sin duplicados: ["a","a"] no equivale a ["a","b"]
// (review IMP-04 2026-09-23: EXTEND validaba ["missing.A","missing.A"] con
// missing.B pendiente).
function sameStringSet(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right)) {
    return false;
  }
  if (hasDuplicates(left) || hasDuplicates(right)) {
    return false;
  }
  if (left.length !== right.length) {
    return false;
  }
  const rightSet = new Set(right);
  return left.every((item) => rightSet.has(item));
}

function deepFreeze(value) {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    Object.values(value).forEach(deepFreeze);
  }
  return value;
}

function assessmentById(assessments, componentId) {
  return assessments.find((assessment) => assessment.componentId === componentId) ?? null;
}

function validateRequiredCapabilities(requiredCapabilities) {
  if (!isNonEmptyList(requiredCapabilities) || !requiredCapabilities.every(isNonEmptyString)) {
    return fail("MISSING_REQUIRED_CAPABILITIES", "Las capacidades requeridas por el consumidor deben ser una lista no vacía de identificadores.");
  }
  if (hasDuplicates(requiredCapabilities)) {
    return fail("DUPLICATE_REQUIRED_CAPABILITIES", "Las capacidades requeridas no pueden repetirse: son un conjunto.");
  }
  return { ok: true };
}

function validateBuildNecessity(buildNecessity) {
  if (!buildNecessity || typeof buildNecessity !== "object" || Array.isArray(buildNecessity)) {
    return fail("MISSING_NECESSITY", "Construir una plataforma exige evidencia de necesidad auditada.");
  }
  if (buildNecessity.demonstrated !== true) {
    return fail("NECESSITY_NOT_DEMONSTRATED", "La auditoría no demuestra necesidad de construir; no se construye por preferencia.");
  }
  if (!isNonEmptyString(buildNecessity.rationale)) {
    return fail("MISSING_NECESSITY_RATIONALE", "La necesidad de construir exige justificación trazable.");
  }
  if (!isNonEmptyList(buildNecessity.evidenceRefs)) {
    return fail("MISSING_NECESSITY_EVIDENCE", "La necesidad de construir exige evidencia de auditoría.");
  }
  for (const ref of buildNecessity.evidenceRefs) {
    const outcome = validateEvidenceRef(ref);
    if (!outcome.ok) {
      return fail("INVALID_NECESSITY_EVIDENCE", "La evidencia de necesidad de construir no satisface su contrato.", { errors: outcome.errors });
    }
  }
  return { ok: true };
}

// §25.1 IMP-04 "nueva plataforma sólo si audit demuestra necesidad": la
// necesidad sólo se demuestra si se auditaron TODOS los componentes que el
// inventario (con evidencia) reporta para el soporte, y ninguno más. Sin eso,
// un único assessment irrelevante bastaba para construir (review IMP-04
// 2026-09-23, acceptance.test.mjs:80).
function validateAuditInventory(auditInventory, assessments) {
  if (!auditInventory || typeof auditInventory !== "object" || Array.isArray(auditInventory)) {
    return fail("MISSING_AUDIT_INVENTORY", "La decisión exige el inventario de componentes existentes para el soporte, con evidencia.");
  }
  const { componentIds, evidenceRefs } = auditInventory;
  if (!isNonEmptyList(componentIds) || !componentIds.every(isNonEmptyString) || hasDuplicates(componentIds)) {
    return fail("INVALID_AUDIT_INVENTORY", "auditInventory.componentIds debe ser una lista no vacía de identificadores sin repetir.");
  }
  if (!isNonEmptyList(evidenceRefs)) {
    return fail("MISSING_AUDIT_INVENTORY_EVIDENCE", "El inventario exige la fuente que lo reporta.");
  }
  for (const ref of evidenceRefs) {
    const outcome = validateEvidenceRef(ref);
    if (!outcome.ok) {
      return fail("INVALID_AUDIT_INVENTORY_EVIDENCE", "La evidencia del inventario no satisface su contrato.", { errors: outcome.errors });
    }
  }
  const auditedIds = assessments.map((assessment) => assessment.componentId);
  const notAudited = componentIds.filter((componentId) => !auditedIds.includes(componentId));
  if (notAudited.length > 0) {
    return fail("INVENTORY_NOT_AUDITED", "Hay componentes del inventario sin capability assessment: la auditoría está incompleta.", { componentIds: notAudited });
  }
  const notInventoried = auditedIds.filter((componentId) => !componentIds.includes(componentId));
  if (notInventoried.length > 0) {
    return fail("ASSESSMENT_NOT_INVENTORIED", "Hay assessments de componentes que el inventario no reporta: no se decide sobre componentes ajenos al soporte.", { componentIds: notInventoried });
  }
  return { ok: true };
}

function describeCoverage(assessment, requiredCapabilities) {
  const usability = isCapabilityAssessmentUsable(assessment);
  const coverage = evaluateCapabilityCoverage(assessment, requiredCapabilities);
  return {
    componentId: assessment.componentId,
    usable: usability.usable,
    rightsUnresolved: usability.rightsUnresolved,
    usabilityReasons: usability.reasons,
    covered: coverage.covered,
    missing: coverage.missing,
    sufficient: coverage.sufficient,
    minimallyExtendable: assessment.minimallyExtendable === true,
  };
}

// Componentes con derechos/IP pendientes de auditar que ya cubren alguna de
// `capabilities`. Mientras existan, añadir o construir esas capacidades sería
// decidir sin audit: "unknown" no se degrada ni a permiso ni a ausencia.
function unresolvedCandidates(auditTrace, capabilities) {
  return auditTrace.filter((entry) => entry.rightsUnresolved && entry.covered.some((capability) => capabilities.includes(capability)));
}

// Componentes usables (distintos de `exceptId`) que ya cubren alguna de
// `capabilities`. Añadir o construir esas capacidades reimplementaría algo
// existente y permitido; §6.4 sólo admite construir "si la auditoría demuestra
// necesidad", y un booleano autodeclarado no lo demuestra (validación
// adversarial IMP-04 2026-09-23: cobertura repartida entre X e Y daba BUILD).
function existingCoverage(auditTrace, capabilities, exceptId = null) {
  return auditTrace.filter((entry) => entry.usable && entry.componentId !== exceptId && entry.covered.some((capability) => capabilities.includes(capability)));
}

function existingCoverageNotResolved(covering, capabilities, auditTrace) {
  return fail("EXISTING_COVERAGE_NOT_RESOLVED", "Componentes usables ya cubren parte de lo que se añadiría o construiría: la auditoría debe resolver cómo reutilizarlos, no reimplementarlos.", {
    candidateComponentIds: covering.map((entry) => entry.componentId),
    coveredCapabilities: capabilities.filter((capability) => covering.some((entry) => entry.covered.includes(capability))),
    auditTrace,
  });
}

function blockedPendingRights(blocking, capabilities, auditTrace) {
  const blockedCapabilities = capabilities.filter((capability) => blocking.some((entry) => entry.covered.includes(capability)));
  const uncoveredCapabilities = capabilities.filter((capability) => !auditTrace.some((entry) => entry.covered.includes(capability)));
  return fail("BLOCKED_PENDING_RIGHTS_AUDIT", "Un componente auditado cubre capacidades requeridas pero sus derechos/IP siguen sin acreditar: no se extiende ni se construye hasta resolverlos.", {
    candidateComponentIds: blocking.map((entry) => entry.componentId),
    blockedCapabilities,
    uncoveredCapabilities,
    auditTrace,
  });
}

// Deriva la decisión de las capacidades auditadas y de la necesidad
// demostrada. Falla (sin `decision`) cuando el audit es ambiguo, insuficiente o
// tiene derechos pendientes: no se elige por preferencia ni por conveniencia.
export function deriveToolingDecision({ requiredCapabilities = [], assessments = [], buildNecessity = null, auditInventory = null } = {}) {
  const requiredOutcome = validateRequiredCapabilities(requiredCapabilities);
  if (!requiredOutcome.ok) {
    return requiredOutcome;
  }
  if (!Array.isArray(assessments)) {
    return fail("INVALID_ASSESSMENTS", "Los assessments auditados deben ser una lista.");
  }
  for (const assessment of assessments) {
    const outcome = validateCapabilityAssessment(assessment);
    if (!outcome.ok) {
      return fail("INVALID_ASSESSMENT", "Un capability assessment no satisface su contrato.", {
        componentId: assessment?.componentId ?? null,
        errors: outcome.errors,
      });
    }
  }
  const componentIds = assessments.map((assessment) => assessment.componentId);
  if (hasDuplicates(componentIds)) {
    return fail("DUPLICATE_ASSESSMENTS", "Un componente no puede auditarse dos veces en el mismo conjunto.");
  }

  const inventoryOutcome = auditInventory === null ? null : validateAuditInventory(auditInventory, assessments);
  if (inventoryOutcome !== null && !inventoryOutcome.ok) {
    return inventoryOutcome;
  }

  const auditTrace = assessments.map((assessment) => describeCoverage(assessment, requiredCapabilities));
  const usable = auditTrace.filter((entry) => entry.usable);

  const sufficient = usable.filter((entry) => entry.sufficient);
  if (sufficient.length === 1) {
    return { ok: true, decision: TOOLING_DECISION.REUSE, targetComponentId: sufficient[0].componentId, additions: [], auditTrace };
  }
  if (sufficient.length > 1) {
    return fail("MULTIPLE_SUFFICIENT", "Más de un componente suficiente: la selección exige un criterio auditado explícito, no preferencia tecnológica.", {
      candidateComponentIds: sufficient.map((entry) => entry.componentId),
      auditTrace,
    });
  }

  const extendable = usable.filter((entry) => entry.minimallyExtendable && entry.covered.length > 0);
  if (extendable.length > 1) {
    return fail("MULTIPLE_EXTENDABLE", "Más de un componente casi suficiente: la selección exige un criterio auditado explícito, no preferencia tecnológica.", {
      candidateComponentIds: extendable.map((entry) => entry.componentId),
      auditTrace,
    });
  }
  if (extendable.length === 1) {
    const additions = extendable[0].missing;
    const blocking = unresolvedCandidates(auditTrace, additions);
    if (blocking.length > 0) {
      return blockedPendingRights(blocking, additions, auditTrace);
    }
    const covering = existingCoverage(auditTrace, additions, extendable[0].componentId);
    if (covering.length > 0) {
      return existingCoverageNotResolved(covering, additions, auditTrace);
    }
    return { ok: true, decision: TOOLING_DECISION.EXTEND, targetComponentId: extendable[0].componentId, additions, auditTrace };
  }

  // §6.4 / §25.1 IMP-04: "nueva plataforma sólo si audit demuestra
  // necesidad". Sin componentes auditados no hay audit que lo demuestre
  // (review IMP-04 2026-09-23: `assessments: []` + `demonstrated: true`
  // producía BUILD).
  if (assessments.length === 0) {
    return fail("NO_COMPONENTS_AUDITED", "Construir exige haber auditado los componentes existentes; una necesidad autodeclarada sin audit no la demuestra.");
  }
  const blocking = unresolvedCandidates(auditTrace, requiredCapabilities);
  if (blocking.length > 0) {
    return blockedPendingRights(blocking, requiredCapabilities, auditTrace);
  }
  const covering = existingCoverage(auditTrace, requiredCapabilities);
  if (covering.length > 0) {
    return existingCoverageNotResolved(covering, requiredCapabilities, auditTrace);
  }
  if (auditInventory === null) {
    return fail("MISSING_AUDIT_INVENTORY", "Construir exige demostrar que se auditaron todos los componentes existentes del soporte: falta el inventario con evidencia.", { auditTrace });
  }
  // §6.4 sólo pide demostrar necesidad para construir: con un componente
  // inventariado de derechos pendientes su assessment no está cerrado y la
  // necesidad no queda demostrada, aunque hoy no cubra nada. EXTEND no exige
  // demostrar necesidad (sí casi suficiencia y reconciliación), por eso ahí sólo
  // bloquea el pendiente que cubre lo que se añadiría (review IMP-04 2026-09-23).
  const pendingRights = auditTrace.filter((entry) => entry.rightsUnresolved);
  if (pendingRights.length > 0) {
    return blockedPendingRights(pendingRights, requiredCapabilities, auditTrace);
  }
  const necessityOutcome = validateBuildNecessity(buildNecessity);
  if (!necessityOutcome.ok) {
    return { ...necessityOutcome, auditTrace };
  }
  return {
    ok: true,
    decision: TOOLING_DECISION.BUILD,
    targetComponentId: null,
    additions: [...requiredCapabilities],
    buildNecessity,
    auditTrace,
  };
}

// §25.1 IMP-04 / DEP-10: la reconciliación que sostiene una selección se
// recalcula, no se acepta declarada. No vale un resultado con `reconciled: true`
// (ni comparaciones escritas a mano): la evidencia debe aportar las salidas
// del componente y los fixtures permitidos, y aquí se recalcula con
// `reconcileKeyOutputs`. La procedencia de esas salidas (que las produjo el
// componente y versión evaluados) no se verifica aquí: OPEN_ITEM del audit. Eso exige fixtures `permitted` con
// `independentComputation`, cobertura de TODAS las salidas clave declaradas por
// la interfaz real del componente evaluado y coincidencia observado/esperado.
// Un objeto `{componentId, reconciled: true, comparisons:[{outputId,
// agreed:true}]}` sin valores ni procedencia es fabricado y no sostiene la
// decisión. Además, cada capacidad requerida que el componente cubre debe
// ligarse (interfaceContract.capabilityOutputs) a salidas que entren en la
// reconciliación: una capacidad declarada sin salida reconciliada no está
// evidenciada (review IMP-04 2026-09-23, `reference.select`).
function validateReconciliation(reconciliation, targetAssessment, coveredCapabilities = []) {
  const errors = [];
  if (!reconciliation || typeof reconciliation !== "object" || Array.isArray(reconciliation)) {
    return { ok: false, errors: [{ field: "reconciliation", code: "MISSING_RECONCILIATION", message: "Reutilizar/extender exige reconciliar de forma independiente las salidas clave del componente evaluado." }] };
  }
  if (targetAssessment !== null && reconciliation.componentId !== targetAssessment.componentId) {
    errors.push({ field: "reconciliation.componentId", code: "RECONCILIATION_COMPONENT_MISMATCH", message: "La reconciliación no corresponde al componente evaluado." });
  }
  const outputs = reconciliation.outputs;
  const fixtures = reconciliation.fixtures;
  if (!Array.isArray(outputs) || outputs.length === 0 || !Array.isArray(fixtures) || fixtures.length === 0) {
    errors.push({
      field: "reconciliation",
      code: "RECONCILIATION_NOT_VERIFIABLE",
      message: "La reconciliación debe aportar las salidas reales del componente y los fixtures permitidos con los que recalcularse; un resultado declarado no es verificable.",
    });
    return { ok: false, errors };
  }
  let keyOutputs = null;
  if (targetAssessment !== null) {
    const unevidenced = coveredCapabilities.filter((capability) => outputsForCapability(targetAssessment, capability) === null);
    if (unevidenced.length > 0) {
      errors.push({
        field: "targetAssessment.interfaceContract.capabilityOutputs",
        code: "CAPABILITY_OUTPUTS_UNDECLARED",
        message: "Cada capacidad requerida cubierta debe ligarse a salidas de la interfaz que se reconcilien.",
        capabilities: unevidenced,
      });
    }
    // Unión defensiva: validateToolingSelection puede recibir assessments no
    // validados cuyas salidas ligadas no estén en interfaceContract.outputs.
    const capabilityOutputIds = coveredCapabilities.flatMap((capability) => outputsForCapability(targetAssessment, capability) ?? []);
    keyOutputs = [...new Set([...(targetAssessment.interfaceContract?.outputs ?? []), ...capabilityOutputIds])];
  }
  const recomputed = reconcileKeyOutputs({
    componentId: reconciliation.componentId,
    outputs,
    fixtures,
    keyOutputs,
  });
  if (recomputed.reconciled !== true) {
    errors.push({
      field: "reconciliation",
      code: recomputed.code ?? "NOT_RECONCILED",
      message: recomputed.message ?? "Las salidas clave del componente evaluado no se reconcilian contra los fixtures permitidos.",
      mismatches: recomputed.mismatches ?? null,
      uncoveredKeyOutputs: recomputed.uncoveredKeyOutputs ?? null,
    });
  }
  return { ok: errors.length === 0, errors };
}

// Valida una decisión de selección ya emitida contra los hechos auditados.
// Un BUILD no puede coexistir con un componente usable que cubra lo requerido;
// un REUSE/EXTEND exige derechos, IP nula y reconciliación independiente.
export function validateToolingSelection(selection, { requiredCapabilities = [], assessments = [], auditInventory = null } = {}) {
  const errors = [];
  if (!selection || typeof selection !== "object" || Array.isArray(selection)) {
    return { ok: false, errors: [{ field: "(selection)", code: "MISSING_SELECTION", message: "Selección de herramienta ausente." }] };
  }
  const requiredOutcome = validateRequiredCapabilities(requiredCapabilities);
  if (!requiredOutcome.ok) {
    errors.push({ field: "requiredCapabilities", code: requiredOutcome.code, message: requiredOutcome.message });
  }
  if (!Object.values(TOOLING_DECISION).includes(selection.decision)) {
    errors.push({ field: "decision", code: "INVALID_DECISION", message: `decision debe ser uno de ${Object.values(TOOLING_DECISION).join(", ")}.` });
  }
  // §25.1 IMP-04 MUST NOT CHANGE.
  if (selection.selectionBasis !== SELECTION_BASIS.AUDIT) {
    errors.push({ field: "selectionBasis", code: "PREFERENCE_BASED_SELECTION", message: "La selección debe fundarse en auditoría, no en preferencia tecnológica." });
  }
  if (selection.grantsProductionAuthority !== false) {
    errors.push({ field: "grantsProductionAuthority", code: "PRODUCTION_AUTHORITY_FORBIDDEN", message: "La decisión de tooling no concede autoridad de producción (§6.4)." });
  }
  if (!isNonEmptyList(selection.evidenceRefs)) {
    errors.push({ field: "evidenceRefs", code: "MISSING_EVIDENCE", message: "La selección exige fuentes de auditoría." });
  } else {
    for (const ref of selection.evidenceRefs) {
      const outcome = validateEvidenceRef(ref);
      if (!outcome.ok) {
        errors.push(...outcome.errors);
      }
    }
  }

  const target = selection.targetComponentId ? assessmentById(assessments, selection.targetComponentId) : null;
  const targetCoverage = target ? evaluateCapabilityCoverage(target, requiredCapabilities) : null;

  if (selection.decision === TOOLING_DECISION.REUSE || selection.decision === TOOLING_DECISION.EXTEND) {
    if (!target) {
      errors.push({ field: "targetComponentId", code: "UNKNOWN_COMPONENT", message: "La decisión apunta a un componente no auditado en el conjunto." });
    } else {
      const usable = isCapabilityAssessmentUsable(target);
      if (!usable.usable) {
        errors.push({ field: "targetComponentId", code: "TARGET_NOT_USABLE", message: "El componente objetivo no acredita uso permitido e IP nula.", reasons: usable.reasons });
      }
      const coverage = targetCoverage;
      if (selection.decision === TOOLING_DECISION.REUSE && !coverage.sufficient) {
        errors.push({ field: "decision", code: "REUSE_NOT_SUFFICIENT", message: "REUSE exige que el componente cubra todas las capacidades requeridas.", missing: coverage.missing });
      }
      if (selection.decision === TOOLING_DECISION.EXTEND) {
        // §6.4: la selección mínima reutiliza un componente suficiente antes
        // que extender uno casi suficiente; si la auditoría muestra un
        // componente usable que ya cubre todas las capacidades requeridas,
        // EXTEND no es mínima (review IMP-04 2026-09-23).
        const reuseCandidates = assessments
          .filter((assessment) => isCapabilityAssessmentUsable(assessment).usable)
          .filter((assessment) => evaluateCapabilityCoverage(assessment, requiredCapabilities).sufficient);
        if (reuseCandidates.length > 0) {
          errors.push({
            field: "decision",
            code: "REUSE_AVAILABLE",
            message: "Existe un componente usable que cubre todas las capacidades requeridas: la selección mínima es REUSE, no EXTEND (§6.4).",
            candidateComponentIds: reuseCandidates.map((assessment) => assessment.componentId),
          });
        }
        if (coverage.covered.length === 0) {
          errors.push({ field: "decision", code: "EXTEND_NOT_BASED_ON_EXISTING", message: "EXTEND exige que el componente ya cubra parte de lo requerido." });
        }
        if (!target.minimallyExtendable) {
          errors.push({ field: "targetComponentId", code: "TARGET_NOT_EXTENDABLE", message: "EXTEND exige declaración auditada de que el componente es casi suficiente." });
        }
        const additions = selection.additions ?? [];
        if (!sameStringSet(additions, coverage.missing)) {
          errors.push({ field: "additions", code: "ADDITIONS_NOT_MINIMAL", message: "EXTEND sólo añade exactamente lo que falta; no reimplementa capacidades existentes.", expected: coverage.missing, received: additions });
        }
      }
    }
    const reconciliationOutcome = validateReconciliation(selection.reconciliation, target, targetCoverage?.covered ?? []);
    if (!reconciliationOutcome.ok) {
      errors.push(...(reconciliationOutcome.errors ?? [reconciliationOutcome]));
    }
  }

  if (selection.decision === TOOLING_DECISION.BUILD) {
    const necessityOutcome = validateBuildNecessity(selection.buildNecessity);
    if (!necessityOutcome.ok) {
      errors.push(...(necessityOutcome.errors ?? [necessityOutcome]));
    }
    // Un BUILD sólo procede si ningún componente usable cubre lo requerido ni
    // es casi suficiente: si lo hubiera, sería una elección por preferencia.
    const usable = assessments.filter((assessment) => isCapabilityAssessmentUsable(assessment).usable);
    const blocking = usable.filter((assessment) => {
      const coverage = evaluateCapabilityCoverage(assessment, requiredCapabilities);
      return coverage.sufficient || (assessment.minimallyExtendable && coverage.covered.length > 0);
    });
    if (blocking.length > 0) {
      errors.push({
        field: "decision",
        code: "BUILD_UNNECESSARY",
        message: "Existe un componente usable suficiente o casi suficiente: no se construye plataforma nueva.",
        candidateComponentIds: blocking.map((assessment) => assessment.componentId),
      });
    }
    if (!sameStringSet(selection.additions ?? [], requiredCapabilities)) {
      errors.push({ field: "additions", code: "BUILD_ADDITIONS_INCOMPLETE", message: "BUILD debe construir todas las capacidades requeridas." });
    }
  }

  // API pública: una selección armada a mano sólo es válida si coincide con la
  // que se deriva de los mismos hechos auditados. Esto cierra, en un único
  // punto, elegir por preferencia entre varios suficientes, BUILD sin
  // componentes auditados y assessments del objetivo sin contrato (versión,
  // derechos, evidenceRefs) (review IMP-04 2026-09-23).
  const derived = deriveToolingDecision({ requiredCapabilities, assessments, buildNecessity: selection.buildNecessity ?? null, auditInventory });
  if (!derived.ok) {
    const { ok: _ok, auditTrace: _trace, ...details } = derived;
    errors.push({ field: "decision", ...details });
  } else {
    const matchesDerived = derived.decision === selection.decision
      && derived.targetComponentId === (selection.targetComponentId ?? null)
      && sameStringSet(derived.additions, selection.additions ?? []);
    if (!matchesDerived) {
      errors.push({
        field: "decision",
        code: "DECISION_NOT_DERIVED_FROM_AUDIT",
        message: "La selección no coincide con la decisión que se deriva de la auditoría.",
        expected: { decision: derived.decision, targetComponentId: derived.targetComponentId, additions: derived.additions },
      });
    } else {
      errors.push(...validateRecordFacts(selection, derived, requiredCapabilities, assessments, auditInventory));
    }
  }

  return { ok: errors.length === 0, errors };
}

// El record es el entregable que consume IMP-05: sus campos descriptivos
// (capacidades, assessment elegido, traza, rationale, autoridad) deben decir
// lo mismo que los hechos auditados (validación adversarial IMP-04
// 2026-09-23: un REUSE con `requiredCapabilities`, `targetAssessment`,
// `auditTrace`, `rationale` y `authority` falsos pasaba).
function validateRecordFacts(selection, derived, requiredCapabilities, assessments, auditInventory) {
  const errors = [];
  const mismatch = (field, message) => errors.push({ field, code: "RECORD_CONTRADICTS_AUDIT", message });
  if (!sameStringSet(selection.requiredCapabilities, requiredCapabilities)) {
    mismatch("requiredCapabilities", "El record debe declarar exactamente las capacidades requeridas con las que se auditó.");
  }
  if (selection.authority !== NO_PRODUCTION_AUTHORITY) {
    mismatch("authority", `La decisión de tooling no concede autoridad: authority debe ser ${NO_PRODUCTION_AUTHORITY}.`);
  }
  const expectedTarget = derived.decision === TOOLING_DECISION.BUILD ? null : assessmentById(assessments, derived.targetComponentId);
  if (!isDeepStrictEqual(selection.targetAssessment, expectedTarget)) {
    mismatch("targetAssessment", "El assessment del record debe ser el auditado del componente elegido.");
  }
  if (!isDeepStrictEqual(selection.auditInventory ?? null, auditInventory)) {
    mismatch("auditInventory", "El inventario del record debe ser el mismo con el que se auditó.");
  }
  if (!isDeepStrictEqual(selection.auditTrace, derived.auditTrace)) {
    mismatch("auditTrace", "La traza de cobertura del record no coincide con la auditoría.");
  }
  if (selection.rationale !== explainDecision(derived, requiredCapabilities)) {
    mismatch("rationale", "El rationale del record debe derivarse de la auditoría, no redactarse a mano.");
  }
  return errors;
}

function explainDecision(derived, requiredCapabilities) {
  const auditedIds = derived.auditTrace.map((entry) => entry.componentId).join(", ");
  if (derived.decision === TOOLING_DECISION.REUSE) {
    return `Auditoría de [${auditedIds}]: ${derived.targetComponentId} es el único componente usable que cubre [${requiredCapabilities.join(", ")}].`;
  }
  if (derived.decision === TOOLING_DECISION.EXTEND) {
    const target = derived.auditTrace.find((entry) => entry.componentId === derived.targetComponentId);
    return `Auditoría de [${auditedIds}]: ningún componente usable es suficiente; ${derived.targetComponentId} cubre [${target.covered.join(", ")}] y es casi suficiente; se añade sólo [${derived.additions.join(", ")}].`;
  }
  return `Auditoría completa del inventario [${auditedIds}]: ningún componente usable es suficiente o casi suficiente, ninguno cubre parte de lo requerido y ninguno tiene derechos pendientes; necesidad: ${derived.buildNecessity.rationale}`;
}

// Ensambla y congela la decisión. Aplica el MUST NOT CHANGE de IMP-04: sin
// preferencia, sin autoridad productiva y sin exposición de IP implícita.
export function selectMinimumTooling({ requiredCapabilities = [], assessments = [], buildNecessity = null, auditInventory = null, reconciliation = null, evidenceRefs = [] } = {}) {
  const derived = deriveToolingDecision({ requiredCapabilities, assessments, buildNecessity, auditInventory });
  if (!derived.ok) {
    return derived;
  }

  const selection = {
    requiredCapabilities: [...requiredCapabilities],
    decision: derived.decision,
    selectionBasis: SELECTION_BASIS.AUDIT,
    targetComponentId: derived.targetComponentId,
    additions: [...derived.additions],
    buildNecessity: derived.decision === TOOLING_DECISION.BUILD ? derived.buildNecessity : null,
    reconciliation,
    evidenceRefs: [...evidenceRefs],
    auditInventory,
    grantsProductionAuthority: false,
    authority: NO_PRODUCTION_AUTHORITY,
  };

  // Entregable IMP-04 (§25.1/§25.2.2): el record conserva el capability
  // assessment del componente elegido, la traza de cobertura de TODOS los
  // componentes auditados y la decisión fundamentada en esa traza.
  selection.targetAssessment = derived.decision === TOOLING_DECISION.BUILD ? null : assessmentById(assessments, derived.targetComponentId);
  selection.auditTrace = derived.auditTrace;
  selection.rationale = explainDecision(derived, requiredCapabilities);

  const validation = validateToolingSelection(selection, { requiredCapabilities, assessments, auditInventory });
  if (!validation.ok) {
    return fail("INVALID_SELECTION", "La selección derivada no satisface el contrato de IMP-04.", { errors: validation.errors });
  }
  // Congelado en profundidad sobre una copia: IMP-05 consume el record y no
  // puede alterarlo después de validado (validación adversarial IMP-04
  // 2026-09-23: `selection.additions.push(...)` funcionaba), ni se congelan
  // los objetos del llamador.
  return { ok: true, selection: deepFreeze(structuredClone(selection)) };
}
