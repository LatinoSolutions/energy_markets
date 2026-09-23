// Decisión de herramienta mínima suficiente (IMP-04). Fuente: SPEC v1.1 §6.4
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

// Deriva la decisión de las capacidades auditadas y de la necesidad
// demostrada. Devuelve `decision: null` cuando el audit es ambiguo o
// insuficiente: no se elige por preferencia ni por conveniencia.
export function deriveToolingDecision({ requiredCapabilities = [], assessments = [], buildNecessity = null } = {}) {
  const requiredOutcome = validateRequiredCapabilities(requiredCapabilities);
  if (!requiredOutcome.ok) {
    return requiredOutcome;
  }
  if (!Array.isArray(assessments)) {
    return fail("INVALID_ASSESSMENTS", "Los assessments auditados deben ser una lista.");
  }

  const structured = [];
  for (const assessment of assessments) {
    const outcome = validateCapabilityAssessment(assessment);
    if (!outcome.ok) {
      return fail("INVALID_ASSESSMENT", "Un capability assessment no satisface su contrato.", {
        componentId: assessment?.componentId ?? null,
        errors: outcome.errors,
      });
    }
    structured.push(assessment);
  }

  const usable = structured.filter((assessment) => isCapabilityAssessmentUsable(assessment).usable);
  const coverage = usable.map((assessment) => ({
    assessment,
    ...evaluateCapabilityCoverage(assessment, requiredCapabilities),
  }));

  const sufficient = coverage.filter((entry) => entry.sufficient);
  if (sufficient.length === 1) {
    return { ok: true, decision: TOOLING_DECISION.REUSE, targetComponentId: sufficient[0].assessment.componentId, additions: [] };
  }
  if (sufficient.length > 1) {
    return fail("MULTIPLE_SUFFICIENT", "Más de un componente suficiente: la selección exige un criterio auditado explícito, no preferencia tecnológica.", {
      candidateComponentIds: sufficient.map((entry) => entry.assessment.componentId),
    });
  }

  const extendable = coverage.filter((entry) => entry.assessment.minimallyExtendable && entry.covered.length > 0);
  if (extendable.length === 1) {
    return {
      ok: true,
      decision: TOOLING_DECISION.EXTEND,
      targetComponentId: extendable[0].assessment.componentId,
      additions: extendable[0].missing,
    };
  }
  if (extendable.length > 1) {
    return fail("MULTIPLE_EXTENDABLE", "Más de un componente casi suficiente: la selección exige un criterio auditado explícito, no preferencia tecnológica.", {
      candidateComponentIds: extendable.map((entry) => entry.assessment.componentId),
    });
  }

  const necessityOutcome = validateBuildNecessity(buildNecessity);
  if (!necessityOutcome.ok) {
    return necessityOutcome;
  }
  return {
    ok: true,
    decision: TOOLING_DECISION.BUILD,
    targetComponentId: null,
    additions: [...requiredCapabilities],
    buildNecessity,
  };
}

// §25.1 IMP-04 / DEP-10: la reconciliación que sostiene una selección debe ser
// verificable, no declarada. No se acepta un resultado con `reconciled: true`
// (ni comparaciones escritas a mano): la evidencia debe aportar las salidas
// reales del componente y los fixtures permitidos, y aquí se recalcula con
// `reconcileKeyOutputs`. Eso exige fixtures `permitted` con
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
export function validateToolingSelection(selection, { requiredCapabilities = [], assessments = [] } = {}) {
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

  return { ok: errors.length === 0, errors };
}

// Ensambla y congela la decisión. Aplica el MUST NOT CHANGE de IMP-04: sin
// preferencia, sin autoridad productiva y sin exposición de IP implícita.
export function selectMinimumTooling({ requiredCapabilities = [], assessments = [], buildNecessity = null, reconciliation = null, evidenceRefs = [] } = {}) {
  const derived = deriveToolingDecision({ requiredCapabilities, assessments, buildNecessity });
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
    grantsProductionAuthority: false,
    authority: NO_PRODUCTION_AUTHORITY,
  };

  // Entregable IMP-04 (§25.1/§25.2.2): el record conserva el capability
  // assessment del componente elegido y la decisión fundamentada
  // reutilizar/extender/construir. No expone IP: sólo lo ya declarado
  // auditadamente en el assessment.
  if (derived.decision !== TOOLING_DECISION.BUILD) {
    selection.targetAssessment = assessmentById(assessments, derived.targetComponentId);
    selection.rationale = derived.decision === TOOLING_DECISION.REUSE
      ? "Auditoría: exactamente un componente usable cubre todas las capacidades requeridas."
      : "Auditoría: exactamente un componente casi suficiente cubre parte de lo requerido; se añade sólo lo que falta.";
  } else {
    selection.targetAssessment = null;
    selection.rationale = "Auditoría: ningún componente usable es suficiente o casi suficiente; la necesidad de construir está demostrada.";
  }

  const validation = validateToolingSelection(selection, { requiredCapabilities, assessments });
  if (!validation.ok) {
    return fail("INVALID_SELECTION", "La selección derivada no satisface el contrato de IMP-04.", { errors: validation.errors });
  }
  return { ok: true, selection: Object.freeze(selection) };
}
