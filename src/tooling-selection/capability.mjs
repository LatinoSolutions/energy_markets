// Capability assessment de la herramienta/entorno evaluada (IMP-04). Fuente:
// SPEC v1.1 §6.4 (auditar productos/series/permisos de uso y capacidades del
// backtesting existente; la elección técnica sigue esa evidencia), §20.1 B02
// (capability assessment audit-first) y §24 DEP-10 (capacidades, interfaces,
// derechos; "datos legibles no prueban derechos"). Los IDs de capacidad son
// opacos: este módulo no inventa capacidades ni afirma derechos reales; sólo
// exige que la auditoría los declare de forma trazable.

import { isVersionLike, isSha256 } from "../contracts/identities.mjs";

export const RIGHTS_STATUS = Object.freeze({
  PERMITTED: "permitted",
  DENIED: "denied",
  UNKNOWN: "unknown",
});

// "No exposición de IP implícita" (IMP-04 MUST NOT CHANGE): una adopción sólo
// procede si la auditoría declara exposición nula. `implicit`/`unknown` no son
// una afirmación de seguridad y por eso no habilitan reutilizar/extender.
export const IP_EXPOSURE = Object.freeze({
  NONE: "none",
  IMPLICIT: "implicit",
  UNKNOWN: "unknown",
});

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function isNonEmptyObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length > 0;
}

function isCapabilityIdList(value) {
  return Array.isArray(value) && value.length > 0 && value.every(isNonEmptyString);
}

export function validateEvidenceRef(ref) {
  const errors = [];
  if (!ref || typeof ref !== "object" || Array.isArray(ref)) {
    return { ok: false, errors: [{ field: "evidenceRef", code: "INVALID_EVIDENCE_REF", message: "Evidence ref ausente o no es objeto." }] };
  }
  if (!isNonEmptyString(ref.kind)) {
    errors.push({ field: "evidenceRef.kind", code: "MISSING_EVIDENCE_KIND", message: "Evidence ref sin kind." });
  }
  if (!isNonEmptyString(ref.ref)) {
    errors.push({ field: "evidenceRef.ref", code: "MISSING_EVIDENCE_REF", message: "Evidence ref sin referencia." });
  }
  if (ref.sha256 !== undefined && !isSha256(ref.sha256)) {
    errors.push({ field: "evidenceRef.sha256", code: "INVALID_SHA256", message: "evidenceRef.sha256 malformado." });
  }
  return { ok: errors.length === 0, errors };
}

function validateEvidenceList(evidenceRefs) {
  const errors = [];
  if (!Array.isArray(evidenceRefs) || evidenceRefs.length === 0) {
    return { ok: false, errors: [{ field: "evidenceRefs", code: "MISSING_EVIDENCE", message: "La evaluación exige fuentes de auditoría trazables." }] };
  }
  for (const ref of evidenceRefs) {
    const outcome = validateEvidenceRef(ref);
    if (!outcome.ok) {
      errors.push(...outcome.errors);
    }
  }
  return { ok: errors.length === 0, errors };
}

function validateInterfaceContract(contract, errors) {
  if (!isNonEmptyObject(contract)) {
    errors.push({ field: "interfaceContract", code: "MISSING_REQUIRED", message: "Falta el contrato de interfaces reales de la herramienta." });
    return;
  }
  if (!Array.isArray(contract.inputs) || contract.inputs.length === 0 || !contract.inputs.every(isNonEmptyString)) {
    errors.push({ field: "interfaceContract.inputs", code: "MISSING_REQUIRED", message: "El contrato de interfaces exige inputs reales." });
  }
  if (!Array.isArray(contract.outputs) || contract.outputs.length === 0 || !contract.outputs.every(isNonEmptyString)) {
    errors.push({ field: "interfaceContract.outputs", code: "MISSING_REQUIRED", message: "El contrato de interfaces exige outputs reales." });
  }
  if (contract.capabilityOutputs !== undefined) {
    validateCapabilityOutputs(contract.capabilityOutputs, contract.outputs, errors);
  }
}

// `capabilityOutputs`: { capabilityId: [outputId] }. Liga cada capacidad
// declarada a las salidas de la interfaz que la evidencian, para que la
// reconciliación no pueda omitir la salida de una capacidad requerida
// (review IMP-04 2026-09-23: `reference.select` aprobaba REUSE sin evidencia).
function validateCapabilityOutputs(capabilityOutputs, outputs, errors) {
  if (!isNonEmptyObject(capabilityOutputs)) {
    errors.push({ field: "interfaceContract.capabilityOutputs", code: "INVALID_CAPABILITY_OUTPUTS", message: "capabilityOutputs debe ser un objeto capacidad → salidas." });
    return;
  }
  const interfaceOutputs = new Set(Array.isArray(outputs) ? outputs : []);
  for (const [capability, capabilityOutputIds] of Object.entries(capabilityOutputs)) {
    if (!isCapabilityIdList(capabilityOutputIds)) {
      errors.push({ field: `interfaceContract.capabilityOutputs.${capability}`, code: "INVALID_CAPABILITY_OUTPUTS", message: "Cada capacidad debe ligarse a una lista no vacía de salidas." });
      continue;
    }
    const undeclared = capabilityOutputIds.filter((outputId) => !interfaceOutputs.has(outputId));
    if (undeclared.length > 0) {
      errors.push({ field: `interfaceContract.capabilityOutputs.${capability}`, code: "CAPABILITY_OUTPUT_NOT_IN_INTERFACE", message: "Las salidas de una capacidad deben figurar entre las salidas de la interfaz.", undeclared });
    }
  }
}

// Salidas de interfaz que evidencian cada capacidad. `null` si el assessment
// no liga la capacidad a ninguna salida.
export function outputsForCapability(assessment, capability) {
  const capabilityOutputs = assessment?.interfaceContract?.capabilityOutputs;
  if (!capabilityOutputs || !Object.hasOwn(capabilityOutputs, capability)) {
    return null;
  }
  const outputIds = capabilityOutputs[capability];
  return isCapabilityIdList(outputIds) ? outputIds : null;
}

function validateUsageRights(usageRights, errors) {
  if (!isNonEmptyObject(usageRights)) {
    errors.push({ field: "usageRights", code: "MISSING_REQUIRED", message: "Faltan las restricciones de uso/derechos de la herramienta." });
    return;
  }
  if (!Object.values(RIGHTS_STATUS).includes(usageRights.status)) {
    errors.push({
      field: "usageRights.status",
      code: "INVALID_RIGHTS_STATUS",
      message: `usageRights.status debe ser uno de ${Object.values(RIGHTS_STATUS).join(", ")}.`,
    });
  }
  if (!isNonEmptyString(usageRights.evidenceRef)) {
    errors.push({ field: "usageRights.evidenceRef", code: "MISSING_RIGHTS_EVIDENCE", message: "Datos legibles no prueban derechos: falta evidencia de uso autorizado." });
  }
}

function validateIpExposure(ipExposure, errors) {
  if (!isNonEmptyObject(ipExposure)) {
    errors.push({ field: "ipExposure", code: "MISSING_REQUIRED", message: "Falta la evaluación de exposición de IP." });
    return;
  }
  if (!Object.values(IP_EXPOSURE).includes(ipExposure.assessment)) {
    errors.push({
      field: "ipExposure.assessment",
      code: "INVALID_IP_EXPOSURE",
      message: `ipExposure.assessment debe ser uno de ${Object.values(IP_EXPOSURE).join(", ")}.`,
    });
  }
  if (!isNonEmptyString(ipExposure.rationale)) {
    errors.push({ field: "ipExposure.rationale", code: "MISSING_REQUIRED", message: "La evaluación de IP exige justificación." });
  }
}

// Validación semántica de una capability assessment. No acredita suficiencia
// para el consumidor: eso se calcula contra sus required capabilities.
export function validateCapabilityAssessment(assessment) {
  const errors = [];
  if (!assessment || typeof assessment !== "object" || Array.isArray(assessment)) {
    return { ok: false, errors: [{ field: "(assessment)", code: "MISSING_ASSESSMENT", message: "Capability assessment ausente." }] };
  }
  if (!isNonEmptyString(assessment.componentId)) {
    errors.push({ field: "componentId", code: "MISSING_REQUIRED", message: "Falta la identidad del componente evaluado." });
  }
  if (!isVersionLike(assessment.componentVersion)) {
    errors.push({ field: "componentVersion", code: "MISSING_VERSION", message: "componentVersion ausente o sin forma de versión." });
  }
  if (!isNonEmptyString(assessment.role)) {
    errors.push({ field: "role", code: "MISSING_REQUIRED", message: "Falta el rol/función del componente en el entorno." });
  }
  validateInterfaceContract(assessment.interfaceContract, errors);
  if (!isCapabilityIdList(assessment.declaredCapabilities)) {
    errors.push({ field: "declaredCapabilities", code: "MISSING_REQUIRED", message: "El assessment exige capacidades declaradas no vacías." });
  }
  validateUsageRights(assessment.usageRights, errors);
  validateIpExposure(assessment.ipExposure, errors);
  if (typeof assessment.minimallyExtendable !== "boolean") {
    errors.push({ field: "minimallyExtendable", code: "MISSING_REQUIRED", message: "La auditoría debe declarar explícitamente si el componente es casi suficiente (extensible al mínimo)." });
  }
  if (!Array.isArray(assessment.limitations)) {
    errors.push({ field: "limitations", code: "MISSING_REQUIRED", message: "Las limitaciones/desconocidos deben listarse explícitamente (lista, aunque sea vacía)." });
  }
  const evidenceOutcome = validateEvidenceList(assessment.evidenceRefs);
  if (!evidenceOutcome.ok) {
    errors.push(...evidenceOutcome.errors);
  }
  return { ok: errors.length === 0, errors };
}

// Un componente es *usable* sólo si se permite su uso y no expone IP de forma
// implícita/desconocida. `unknown` nunca se degrada a permiso.
export function isCapabilityAssessmentUsable(assessment) {
  const reasons = [];
  if (assessment?.usageRights?.status !== RIGHTS_STATUS.PERMITTED) {
    reasons.push("usageRights no está permitido con evidencia.");
  }
  if (assessment?.ipExposure?.assessment !== IP_EXPOSURE.NONE) {
    reasons.push("ipExposure no declara exposición nula.");
  }
  return { usable: reasons.length === 0, reasons };
}

// Cobertura factual de capacidades requeridas por el consumidor. Es una
// operación de conjuntos: no puntúa ni prioriza por preferencia tecnológica.
export function evaluateCapabilityCoverage(assessment, requiredCapabilities) {
  const declared = new Set(assessment?.declaredCapabilities ?? []);
  const required = requiredCapabilities ?? [];
  const covered = required.filter((capability) => declared.has(capability));
  const missing = required.filter((capability) => !declared.has(capability));
  return { covered, missing, sufficient: required.length > 0 && missing.length === 0 };
}
