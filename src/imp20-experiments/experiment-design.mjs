// Contrato de diseño predeclarado de experimentos "después" (S2–S5 y
// Z/drivers admitidos). Fuente: SPEC v1.1.1 §25.1 fila IMP-20 (objetivo y
// acceptance: experimentos independientes, paralelos o seriales PREDECLARADOS;
// valor marginal y redundancia con la misma contabilidad; desconocidos
// visibles), §25.2 fila IMP-20 (REQUIRES/PRODUCES), DEP-15/16 (§24), §8.6
// (calibración compartida), §19.4 (predeclaración, OOS, conservación de FAIL).

import { validateExperimentIdentity } from "./identity.mjs";
import { isTopologyId, getTopology } from "./topologies.mjs";
import { validateAccountingParity, COMPARATOR_RULE } from "./accounting.mjs";
import { validateUnknownsRegistry } from "./unknowns.mjs";
import {
  assertNoP5Ampliation,
  assertNoMandatory23Drivers,
  assertNoAutomaticAuthority,
  assertLayersAreRegisteredAndFrozen,
} from "./constraints.mjs";

// Campos semánticos derivados de §25.1/§25.2/§24. El contenido obligatorio
// completo; la serialización es implementación.
export const EXPERIMENT_DESIGN_FIELDS = Object.freeze([
  { key: "identity", source: "§25.2.1 instancia de ejecución" },
  { key: "objective", source: "§25.1 experimento independiente/paralelo/serial predeclarado" },
  { key: "layers", source: "§8.2–8.5, §7.1/§7.2, §24 DEP-15/16" },
  { key: "topology", source: "§8.6 topologías; MUST NOT CHANGE §25.1" },
  { key: "comparator", source: "§25.2 REQUIRES_EVIDENCE: evidencia previa del núcleo" },
  { key: "arms", source: "§13.9/§10.2 ablation; §8.6 comparaciones" },
  { key: "accountingIdentity", source: "§25.1 misma contabilidad; §8.6; §10.1" },
  { key: "marginalValueMethod", source: "§10.2 Contribution_i; §25.1 valor marginal" },
  { key: "redundancyMethod", source: "§25.1 redundancia; §8.4/§8.8" },
  { key: "refutationCriteria", source: "§8.2–8.5 refutation; §13.7/§5.8; predeclarado §8.6/§19.4" },
  { key: "dataMapping", source: "§25.2 REQUIRES_AUDIT DEP-06/07 [inputs de las capas concretas]; §7.2.1 STATE/CHANGE/SURPRISE/Uncertainty" },
  { key: "requiredAuditScopes", source: "§25.2 REQUIRES_AUDIT + audit/mapping requerido por el experimento nuevo" },
  { key: "unknowns", source: "§25.1 desconocidos visibles; §6.2 preservación de razón" },
  { key: "admissionPath", source: "§25.2 UNLOCKS: evaluación/admisión posterior bajo contratos vigentes; §8.7" },
  { key: "gatesChecklist", source: "§19.1 bloques de validación" },
  { key: "nonAmpliation", source: "§25.1 MUST NOT CHANGE no ampliar P5" },
  { key: "predeclared", source: "§25.1 experimentos predeclarados; §19.4 congelar antes de OOS" },
]);

function requireDesignField(fieldName, value, errors, message) {
  if (value === undefined || value === null) {
    errors.push({ field: fieldName, code: "MISSING_REQUIRED", message: `Falta el campo obligatorio "${fieldName}" (${message}).` });
  }
}

function validateLayersField(design, errors) {
  if (!Array.isArray(design.layers) || design.layers.length === 0) {
    errors.push({ field: "layers", code: "MISSING_REQUIRED", message: "El experimento debe declarar al menos una capa ensayada (S2–S5 / Z / DRIVERS)." });
    return;
  }
  const seen = new Set();
  for (const layer of design.layers) {
    if (seen.has(layer?.layerId)) {
      errors.push({ field: "layers[].layerId", code: "DUPLICATE_LAYER", message: `Capa duplicada en el diseño: ${layer?.layerId}.` });
    }
    seen.add(layer?.layerId);
  }
}

function validateComparator(design, errors) {
  requireDesignField("comparator", design.comparator, errors, "§25.2 REQUIRES_EVIDENCE");
  if (design.comparator === undefined) {
    return;
  }
  if (typeof design.comparator.coreEvidenceReference !== "string" || design.comparator.coreEvidenceReference.trim().length === 0) {
    errors.push({
      field: "comparator.coreEvidenceReference",
      code: "MISSING_COMPARATOR",
      message: "El comparator debe referenciar la evidencia previa disponible del núcleo de IMP-16 (resultado y límites conservados), read-only.",
    });
  }
  if (design.comparator.consumedReadOnly !== true) {
    errors.push({
      field: "comparator.consumedReadOnly",
      code: "COMPARATOR_MUTATED",
      message: "La evidencia del núcleo se consume read-only; el diseño no redeclara ni amplía su resultado (§25.2 REQUIRES).",
    });
  }
  if (design.comparator.complianceNote !== COMPARATOR_RULE.specCitation) {
    errors.push({
      field: "comparator.complianceNote",
      code: "COMPARATOR_RULE_MISMATCH",
      message: "El comparator debe citar la regla de §25.2 IMP-20 REQUIRES_EVIDENCE (COMPARATOR_RULE.specCitation).",
    });
  }
}

function validateArms(design, errors) {
  if (!Array.isArray(design.arms)) {
    errors.push({ field: "arms", code: "MISSING_REQUIRED", message: "Las arms del experimento deben declararse ex-ante (§8.6)." });
    return;
  }
  for (const arm of design.arms) {
    if (typeof arm?.armId !== "string" || arm.armId.trim().length === 0) {
      errors.push({ field: "arms[].armId", code: "MISSING_REQUIRED", message: "Cada arm necesita un armId estable." });
    }
    if (!Array.isArray(arm?.ablationDesign) || arm.ablationDesign.length === 0) {
      errors.push({
        field: "arms[].ablationDesign",
        code: "MISSING_ABLATION",
        message: "Cada arm declara su diseño de ablation/rol: qué se añade y frente a qué se compara (§10.2; §25.2 DEP-15/16).",
      });
    }
  }
  const armIds = design.arms.map((arm) => arm?.armId).filter(Boolean);
  if (armIdsExactly(armIds) === false) {
    errors.push({ field: "arms[].armId", code: "DUPLICATE_ARM", message: "Arms con armId duplicado rompen la comparación ex-ante." });
  }
}

function armIdsExactly(armIds) {
  return new Set(armIds).size === armIds.length;
}

function validateRefutationCriteria(design, errors) {
  if (typeof design.refutationCriteria !== "string" || design.refutationCriteria.trim().length === 0) {
    errors.push({
      field: "refutationCriteria",
      code: "MISSING_REQUIRED",
      message: "Los criteria de refutation deben estar predeclarados antes del run (§8.2–8.5; §19.4; §8.6).",
    });
  }
}

function validateDataMapping(design, errors) {
  if (design.dataMapping === undefined || design.dataMapping === null) {
    errors.push({
      field: "dataMapping",
      code: "MISSING_REQUIRED",
      message: "El diseño necesita su mapping de datos (§25.1: mapping de datos y evidencia previa como input; §25.2 REQUIRES_AUDIT).",
    });
    return;
  }
  if (typeof design.dataMapping.policySummary !== "string" || design.dataMapping.policySummary.trim().length === 0) {
    errors.push({ field: "dataMapping.policySummary", code: "MISSING_REQUIRED", message: "dataMapping necesita su resumen de política de datos." });
  }
  if (design.dataMapping.noInventedData !== true) {
    errors.push({
      field: "dataMapping.noInventedData",
      code: "INVENTED_DATA_UNDECLARED",
      message: "El mapping debe declarar explícitamente que no inventa datos (§0.2; regla del owner).",
    });
  }
}

function validateRequiredAuditScopes(design, errors) {
  if (!Array.isArray(design.requiredAuditScopes) || design.requiredAuditScopes.length === 0) {
    errors.push({
      field: "requiredAuditScopes",
      code: "MISSING_REQUIRED",
      message: "El diseño debe declarar los scopes de audit/mapping que el experimento consume (§25.2 REQUIRES_AUDIT: DEP-06/07 [inputs de las capas concretas que se ensayan]).",
    });
    return;
  }
  for (const scope of design.requiredAuditScopes) {
    if (!scope || typeof scope.depId !== "string" || scope.depId.length === 0) {
      errors.push({ field: "requiredAuditScopes[].depId", code: "MISSING_REQUIRED", message: "Cada scope de audit declara su ID de DEP." });
    }
    if (!scope || typeof scope.scope !== "string" || scope.scope.length === 0) {
      errors.push({ field: "requiredAuditScopes[].scope", code: "MISSING_REQUIRED", message: "Cada scope de audit declara su componente [inputs...] concreto." });
    }
    if (!scope || scope.resolvesAudit !== false) {
      errors.push({
        field: "requiredAuditScopes[].resolvesAudit",
        code: "MISCHARACTERIZED_DEPENDENCY",
        message:
          "REQUIRES_AUDIT identifica hallazgos auditados que el experimento necesita satisfechos antes de comenzar; no son RESOLVES_AUDIT del experimento (resolvesAudit=false explícito; §25.2 filas IMP-20/IMP-03; §25.2.1).",
      });
    }
  }
}

function validateAdmissionPath(design, errors) {
  requireDesignField("admissionPath", design.admissionPath, errors, "§25.2 UNLOCKS / §8.7");
  if (design.admissionPath === undefined) {
    return;
  }
  if (typeof design.admissionPath !== "object" || Array.isArray(design.admissionPath)) {
    errors.push({ field: "admissionPath", code: "INVALID_TYPE", message: "admissionPath debe ser la declaración de evaluación/admisión posterior." });
    return;
  }
  if (design.admissionPath.viaContract !== "§8.7" || design.admissionPath.automatic === true) {
    errors.push({
      field: "admissionPath",
      code: "INVALID_ADMISSION_PATH",
      message: "La admisión posterior sigue los contratos vigentes (§8.7 lifecycle; evaluación/admisión bajo contratos, sin cambio automático de P5 o autoridad).",
    });
  }
  if (!design.admissionPath.noAutomaticP5AuthorityChange) {
    errors.push({
      field: "admissionPath.noAutomaticP5AuthorityChange",
      code: "MISSING_REQUIRED",
      message: "admissionPath debe declarar que ningún outcome automático cambia P5 o autoridad.",
    });
  }
}

function validateGatesChecklist(design, errors) {
  if (!Array.isArray(design.gatesChecklist) || design.gatesChecklist.length === 0) {
    errors.push({ field: "gatesChecklist", code: "MISSING_REQUIRED", message: "El diseño declara los bloques de validación aplicables (§19.1)." });
    return;
  }
  const requiredBlocks = ["Data / PIT", "Evaluator", "Execution parity", "Hypothesis", "Research acceptance", "Forward / governance"];
  const declared = new Set();
  for (const gate of design.gatesChecklist) {
    if (gate && typeof gate.block === "string") {
      declared.add(gate.block);
    }
  }
  for (const block of requiredBlocks) {
    if (!declared.has(block)) {
      errors.push({
        field: "gatesChecklist",
        code: "MISSING_VALIDATION_BLOCK",
        message: `El checklist debe cubrir el bloque de validación "${block}" (§19.1).`,
      });
    }
  }
}

function validatePredeclared(design, errors) {
  if (design.predeclared !== true) {
    errors.push({
      field: "predeclared",
      code: "NOT_PREDECLARED",
      message: "El criterio de aceptación exige experimentos PREDECLARADOS: semántica, espacio de búsqueda, arms, refutation y calibración congelados antes de calibrar/oos (§8.6 protocolo; §19.4).",
    });
  }
  if (design.freezingOrder !== "SEMANTICS_AND_REFUTATION_FIRST") {
    errors.push({
      field: "freezingOrder",
      code: "INVALID_FREEZING_ORDER",
      message: "El protocolo compartido congelar semántica y refutación primero, elegir parámetros en development cronológico, congelar, y su espacio de búsqueda predeclarado (§8.6).",
    });
  }
}

// Validación completa de un diseño de experimento IMP-20. Devuelve el primer
// error dominante como `code` para que la Oficina lo gestione por tipo.
// Requiere todos los guards de constraints y la validación de desconocidos;
// los fallos son acumulativos para el review.
export function validateExperimentDesign(design) {
  const errors = [];

  if (!design || typeof design !== "object" || Array.isArray(design)) {
    return { ok: false, code: "INVALID_DESIGN", errors: [{ field: "design", code: "INVALID_DESIGN", message: "El diseño del experimento es mandatorio." }] };
  }

  requireDesignField("identity", design.identity, errors, "§25.2.1");
  requireDesignField("objective", design.objective, errors, "§25.1");
  requireDesignField("marginalValueMethod", design.marginalValueMethod, errors, "§10.2/§25.1");
  requireDesignField("redundancyMethod", design.redundancyMethod, errors, "§25.1");

  validateLayersField(design, errors);
  if (design.topology === undefined || !isTopologyId(design.topology)) {
    errors.push({
      field: "topology",
      code: "INVALID_TOPOLOGY",
      message: "El diseño declara una topología de las cuatro candidatas de §8.6 (independent ablation, parallel evidence producers, selected serial compositions, hybrid meta-policy).",
    });
  }

  validateComparator(design, errors);
  validateArms(design, errors);
  validateRefutationCriteria(design, errors);
  validateDataMapping(design, errors);
  validateRequiredAuditScopes(design, errors);
  validateAdmissionPath(design, errors);
  validateGatesChecklist(design, errors);
  validatePredeclared(design, errors);

  const identityResult = design.identity ? validateExperimentIdentity(design.identity) : { ok: false, errors: [] };
  if (!identityResult.ok) {
    errors.push(...identityResult.errors);
  }

  for (const guard of [assertLayersAreRegisteredAndFrozen, assertNoP5Ampliation, assertNoMandatory23Drivers, assertNoAutomaticAuthority]) {
    const result = guard(design);
    if (!result.ok) {
      errors.push(...result.errors);
    }
  }

  const accountingResult = validateAccountingParity(design.arms, design.accountingIdentity);
  if (!accountingResult.ok) {
    errors.push(...accountingResult.errors);
  }

  const unknownsResult = validateUnknownsRegistry(design.unknowns);
  if (!unknownsResult.ok) {
    errors.push(...unknownsResult.errors);
  }

  const marginalValue = design.marginalValueMethod;
  if (marginalValue && typeof marginalValue === "object" && marginalValue.sameAccounting !== true) {
    errors.push({
      field: "marginalValueMethod.sameAccounting",
      code: "MARGINAL_VALUE_ACCOUNTING_MISMATCH",
      message: "El valor marginal se mide con la misma contabilidad (sameAccounting=true), bajo §25.1.",
    });
  }
  const redundancy = design.redundancyMethod;
  if (redundancy && typeof redundancy === "object" && redundancy.sameAccounting !== true) {
    errors.push({
      field: "redundancyMethod.sameAccounting",
      code: "REDUNDANCY_ACCOUNTING_MISMATCH",
      message: "La redundancia se mide con la misma contabilidad (sameAccounting=true), bajo §25.1.",
    });
  }

  const code = errors.length > 0 ? errors[0].code : "VALID";
  return { ok: errors.length === 0, code, errors };
}

